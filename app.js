// Solfège : lecture de notes et chant, sans fin. Interface minimale.
import { loadModel, Recognizer, Resampler, Suivi, SYLLABES } from './engine.js';
import { Pitch } from './pitch.js';
import { INTERVALLES, ACCORDS, GAMMES, gammeCourt, gammeDit, memesNotes, sensDe, chiffrage, racineNom, racineParlee, tirerIntervalle, tirerPortee, tirerAccord, tirerGamme, midiOf, Hold } from './chant.js';
import { chargerPiano, jouer, couper } from './piano.js';
import { Ecoute, Voix, traits, apprendre, emballer, deballer } from './noms.js';
import { PER, P_MIN, P_MAX, CLEFS, INK, DONE, RED, GREEN, BLUE, SOFT, LINE, r2, noteInfo, metrics, systemSVG, miniPortee, porteeChant } from './portee.js';

const VERSION = '2026-11-28.3';
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let DEBUG = params.has('debug');
try { if (localStorage.getItem('solfege.debug') === '1') DEBUG = true; } catch (e) { /* stockage indisponible */ }
const TEST_MIDI = params.get('input') === 'midi';      // tests sans clavier branché
const N_SYS = 4, N_SYS_PIANO = 3;
const RED_CONF = 0.9;                                  // une syllabe au moins aussi nette colore la note en rouge sans attendre la suivante
const COMMIT_MS = 2500;                                // silence après lequel une syllabe nette restée sans note compte comme réponse
const TOURNE = 2;                                      // notes lues sur une portée avant que la portée précédente soit renouvelée
// chant : durée de la note de référence, silence gardé après elle, pause avant l'exercice suivant, courbe affichée
const REF_MS = 1200, REF_TAIL_MS = 200, TRACE_S = 3;
// Réponse juste : elle passe au vert et la question suivante vient vite ; après une erreur, on laisse le temps de voir la correction.
const ENCHAINE_MS = 280, APRES_ERREUR_MS = 900;
const TOL = +params.get('tol') || 50;                  // bande en cents
// pas à tâtons : après une note tenue, la suivante doit l'être dans la tenue + CHERCHE_MS, sinon on reprend à la première
const CHERCHE_MS = 2000;
const PROMPT_MS = 2500, SERIE = 4;                     // enregistrement : un nom toutes les 2,5 s, chaque nom quatre fois par série
const MAX_SESSIONS = 2000;                             // séances gardées sur l'appareil
const DIAG_MAX = 16000 * (+params.get('morceau') || 300);   // son gardé : par morceaux de cinq minutes

// ---------- préférences ----------
const TOUS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const prefs = {
  exo: 'notes', tenue: 700, courbe: true, accordsVus: ACCORDS.map((a) => a.id),
  notes: { clef: 'sol', input: 'voix', sol: [-2, 10], fa: [-2, 10], garderSon: true },
  intervalles: { iv: TOUS.slice(), montant: true, descendant: true, depart: true },
  portee: { iv: TOUS.slice(), montant: true, descendant: true },
  accords: { types: ACCORDS.map((a) => a.id) },
  noms: { clef: 'sol', iv: TOUS.slice(), reponse: 'voix', alterations: false },
  gammes: { types: ['majeure', 'mineure', 'harmonique', 'pentaMaj', 'pentaMin'], montant: true, descendant: false },
  rIntervalles: { iv: TOUS.slice(), melodique: true, harmonique: false, montant: true, descendant: true, ecart: 600 },
  rAccords: { types: ACCORDS.map((a) => a.id), plaque: true, arpege: false },
  rGammes: { types: ['majeure', 'mineure', 'harmonique', 'pentaMaj', 'pentaMin'], montant: true, descendant: false },
};
try {
  const lu = JSON.parse(localStorage.getItem('solfege.prefs') || '{}') || {};
  if (typeof lu.clef === 'string') { prefs.notes.clef = lu.clef; if (lu.input) prefs.notes.input = lu.input; }   // préférences d'avant les réglages par exercice
  for (const k of ['notes', 'intervalles', 'portee', 'accords', 'noms', 'gammes', 'rIntervalles', 'rAccords', 'rGammes']) if (lu[k] && typeof lu[k] === 'object') Object.assign(prefs[k], lu[k]);
  if (typeof lu.tenue === 'number') prefs.tenue = lu.tenue;
  if (typeof lu.courbe === 'boolean') prefs.courbe = lu.courbe;
  // un accord ajouté à la liste depuis la dernière visite est coché une fois dans les exercices d'accords ; ensuite, le choix est libre
  const vus = Array.isArray(lu.accordsVus) ? lu.accordsVus : ['maj', 'min', 'aug', 'dim', 'sus4', 'm7', 'maj7', '7', 'mMaj7', '6'];
  for (const a of ACCORDS) if (!vus.includes(a.id)) for (const k of ['accords', 'rAccords']) if (!prefs[k].types.includes(a.id)) prefs[k].types.push(a.id);
  delete prefs.accords.notation;
  if (['notes', 'noms', 'intervalles', 'portee', 'accords', 'gammes', 'rIntervalles', 'rAccords', 'rGammes'].includes(lu.exo)) prefs.exo = lu.exo;
} catch (e) { /* préférences absentes */ }
const savePrefs = () => { try { localStorage.setItem('solfege.prefs', JSON.stringify(prefs)); } catch (e) { /* stockage indisponible */ } };
const tenue = () => +params.get('tenue') || prefs.tenue;

// ---------- icônes ----------
// Trait de 1,5 dans un carré de 24, couleur du texte : même dessin que le micro et la roue des réglages.
const svg = (corps, t = 24) => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corps}</svg>`;
const tete = (x, y) => `<ellipse cx="${x}" cy="${y}" rx="2.6" ry="1.9" transform="rotate(-20 ${x} ${y})" fill="currentColor" stroke="none"/>`;
const ICONE = {
  ecouter: (t) => svg('<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/>', t),
  ensemble: (t) => svg(tete(10.5, 18) + tete(10.5, 13.5) + tete(10.5, 9) + '<path d="M13 18V3.5"/>', t),
  suite: (t) => svg(tete(5, 18) + tete(12, 13) + tete(19, 8), t),
  suivant: (t) => svg('<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>', t),
  ecouteurs: (t) => svg('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3.5" y="14" width="4" height="6.5" rx="1.6"/><rect x="16.5" y="14" width="4" height="6.5" rx="1.6"/>', t),
};

// ---------- état ----------
let S = null;                       // séance en cours
let AU = null;                      // son : contexte audio et micro, gardés ouverts tant qu'on reste dans les exercices
let occupe = false;                 // un démarrage est en cours
let modelP = null;                  // promesse du modèle vocal
// Le filtre « syllabe dite ou autre son » peut se tromper sur un micro qu'il ne connaît pas et écarter la voix. L'app le
// surveille (voir watchGate) ; s'il est pris en défaut sur cet appareil, il reste coupé jusqu'au prochain modèle.
let gateOff = null;                 // clé du modèle pour lequel le filtre a été coupé, ou null
try { gateOff = (JSON.parse(localStorage.getItem('solfege.gate') || 'null') || {}).model || null; } catch (e) { /* stockage indisponible */ }
const gateKey = (m) => (m.gate ? `${m.version}:${m.gate.trained}:${m.gate.tau}` : '');
const say = (t) => { $('msg').textContent = t; };
const nouvelId = (at) => at + '-' + Math.random().toString(36).slice(2, 8);
const maj = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function show(view) {
  $('home').hidden = view !== 'home';
  $('page').hidden = view !== 'page';
  if (view !== 'page') $('sheet').hidden = true;
}

// ---------- son ----------
// Le micro peut être rendu (coupe) puis repris (rouvre) sans fermer le son : l'iPhone éteint son témoin orange dès que le micro
// est rendu, et le piano continue de jouer.
async function openMic(ctx, onSamples) {
  const demander = () => navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const rendre = (st) => { try { st.getTracks().forEach((t) => t.stop()); } catch (e) { /* déjà arrêté */ } };
  let stream = await demander(), src = null;
  try {
    // la reprise peut rester en attente d'un geste : on ne l'attend pas plus d'une seconde
    if (ctx.state !== 'running') await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 1000))]);
    const mute = ctx.createGain();
    mute.gain.value = 0; mute.connect(ctx.destination);
    let node;
    if (ctx.audioWorklet && window.AudioWorkletNode) {
      await ctx.audioWorklet.addModule('worklet-2.js');      // nouveau nom à chaque changement de format : une page déjà ouverte garde l'ancien
      node = new AudioWorkletNode(ctx, 'tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      node.port.onmessage = (e) => (e.data.x ? onSamples(e.data.x, e.data.t) : onSamples(e.data));
    } else {
      node = ctx.createScriptProcessor(1024, 1, 1);
      node.onaudioprocess = (e) => onSamples(new Float32Array(e.inputBuffer.getChannelData(0)));
    }
    node.connect(mute);
    const brancher = () => { src = ctx.createMediaStreamSource(stream); src.connect(node); };
    brancher();
    const track = stream.getAudioTracks()[0];
    const st = track && track.getSettings ? track.getSettings() : {};
    const info = { nom: track ? track.label : '' };
    for (const k of ['sampleRate', 'channelCount', 'echoCancellation', 'noiseSuppression', 'autoGainControl']) info[k] = st[k] ?? null;
    return {
      info,
      get ouvert() { return !!stream; },
      coupe() { if (!stream) return; try { src.disconnect(); } catch (e) { /* déjà débranché */ } rendre(stream); stream = null; },
      async rouvre() { if (stream) return; stream = await demander(); brancher(); },
      stop() { if (stream) rendre(stream); stream = null; try { ctx.close(); } catch (e) { /* déjà fermé */ } },
    };
  } catch (e) { rendre(stream); throw e; }
}

// Le micro reste ouvert d'un exercice à l'autre : changer d'exercice ne redemande rien. `sink` reçoit le son à 16 kHz.
async function ouvrirSon(micro = true) {
  if (AU && AU.micro !== micro) fermerSon();              // un exercice au toucher n'ouvre pas le micro
  if (AU && AU.ctx.state !== 'closed') {
    if (AU.ctx.state !== 'running') AU.ctx.resume().catch(() => {});
    if (micro && !AU.mic.ouvert) await AU.mic.rouvre();     // rendu pendant une coupure ou les réglages
    return AU;
  }
  if (AU) AU = null;
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC({ latencyHint: 'interactive' });
  ctx.resume().catch(() => {});                           // dans le geste de l'utilisateur
  // iPhone : micro et haut-parleur ensemble, sans traitement de la voix ; sans micro, le son seul (il passe même en mode silencieux)
  try { if (navigator.audioSession) navigator.audioSession.type = micro ? 'play-and-record' : 'playback'; } catch (e) { /* réglage absent */ }
  nommer();
  if (!micro) { AU = { ctx, micro, got: true, sink: null, lag: null, mic: { info: null, ouvert: true, coupe() {}, async rouvre() {}, stop() { try { ctx.close(); } catch (e) { /* déjà fermé */ } } } }; return AU; }
  const au = { ctx, micro, rs: new Resampler(ctx.sampleRate), sink: null, got: false, lag: null };
  try {
    au.mic = await openMic(ctx, (x, t) => {
      au.got = true;
      // diagnostic : temps mis par un bloc de son pour aller du micro (horloge audio) jusqu'ici
      if (au.lag && t !== undefined && au.lag.length < 60000) au.lag.push(Math.max(0, ctx.currentTime - t));
      const y = au.rs.process(x);
      if (au.sink) au.sink(y);
    });
  } catch (e) { try { ctx.close(); } catch (err) { /* déjà fermé */ } throw e; }
  AU = au;
  return au;
}
// Quand le son de l'app paraît dans le lecteur de l'écran verrouillé et du centre de contrôle, il y porte le nom et l'icône de l'app.
function nommer() {
  try {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Solfège', artwork: [192, 512].map((t) => ({ src: `icons/icon-${t}.png`, sizes: `${t}x${t}`, type: 'image/png' })) });
  } catch (e) { /* lecteur absent */ }
}
function fermerSon() {
  if (!AU) return;
  AU.sink = null; AU.mic.stop(); AU = null;
}
// En diagnostic, le son reçu est gardé (16 bits) ; le moteur écoute exactement ces échantillons : le rejeu hors de l'app donne le même résultat.
function garder(s, y) {
  if (s.pcmN + y.length > DIAG_MAX) { if (s.garde) ranger(s); else return y; }
  const q = Int16Array.from(y, (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32768))));
  s.pcm.push(q); s.pcmN += q.length;
  return Float32Array.from(q, (v) => v / 32768);
}

// ---------- démarrage et arrêt d'un exercice ----------
async function lancer(exo, opts = {}) {
  if (occupe) return;
  occupe = true; say('');
  try {
    arreter();
    if (!['enreg', 'ml', 'menuML'].includes(exo)) { prefs.exo = exo; savePrefs(); }
    if (exo === 'notes') await startNotes();
    else if (exo === 'noms') await startNoms();
    else if (exo === 'enreg') await startEnreg(opts.vocab || 'noms');
    else if (exo === 'ml') await startMainsLibres();
    else if (exo === 'menuML') await startMenuML();
    else if (exo[0] === 'r') await startReco(exo, !!opts.mains);
    else await startChant(exo, !!opts.mains);
    $('result').textContent = ''; delete $('result').dataset.alerte;
    $('debug').hidden = !DEBUG; $('debug').textContent = '';
    $('regler').hidden = ['enreg', 'ml', 'menuML'].includes(S.kind); $('aides').hidden = S.kind !== 'chant';
    const pl = $('aides').querySelector('[data-h="plaque"]'), ar = $('aides').querySelector('[data-h="arpege"]');
    pl.hidden = S.exo === 'gammes'; pl.innerHTML = ICONE.ensemble();
    ar.innerHTML = S.exo === 'gammes' ? ICONE.ecouter() : ICONE.suite(); ar.setAttribute('aria-label', S.exo === 'gammes' ? 'Écouter la gamme' : 'Les notes l\'une après l\'autre');
    $('mic').hidden = direct(S) || S.input === 'toucher' || S.kind === 'ml'; $('clavier').hidden = !(S.kind === 'notes' && S.input === 'touches'); $('mic').disabled = S.kind === 'enreg'; $('mic').setAttribute('aria-pressed', 'false'); $('mic').setAttribute('aria-label', 'Couper le micro');
    show('page'); render(); ligne(); levelLoop();
    if (navigator.wakeLock && !verrou) navigator.wakeLock.request('screen').then((l) => { verrou = l; }).catch(() => {});
    if (S && !direct(S) && S.input !== 'toucher') {
      // aucun son reçu après trois secondes : le contexte audio attend un geste, une touche sur la page le relance
      const mine = S;
      setTimeout(() => {
        if (S !== mine || !AU || AU.got) return;
        $('result').textContent = 'Le micro ne répond pas. Touche la page.'; $('result').dataset.alerte = '1';
      }, 3000);
    }
  } catch (e) {
    S = null; fermerSon(); show('home');
    say(e && e.name === 'NotAllowedError'
      ? 'Micro refusé. Autorise le micro pour ce site dans les réglages du navigateur, puis recommence.'
      : 'Démarrage impossible : ' + (e && e.message ? e.message : e));
  } finally { occupe = false; }
}
let verrou = null;
// Fin de la séance en cours : elle est enregistrée, le micro reste ouvert.
function arreter() {
  if (!S) return;
  const s = S;
  s.over = true; clearTimeout(s.commitT); clearTimeout(s.nextT); clearTimeout(s.promptT); clearTimeout(s.relance);
  if (s.mains) taire();
  if (AU) { AU.sink = null; couper(AU.ctx); }
  if (s.kind === 'notes' && s.garde && s.pcmN) ranger(s);
  sauver(s);
  S = null;
}
function quitter() {
  arreter(); fermerSon();
  if (verrou) { try { verrou.release(); } catch (e) { /* déjà libéré */ } verrou = null; }
  $('systems').className = ''; $('systems').innerHTML = '';
  show('home');
}

// ---------- lecture de notes, sans fin ----------
// Les notes sont tirées au fur et à mesure, dans l'étendue choisie pour chaque clé ; jamais deux fois de suite la même.
function noteAt(s, i) {
  while (s.notes.length <= i) {
    const j = s.notes.length, prev = s.notes[j - 1];
    if (s.forced && j < s.forced.length) { s.notes.push(s.forced[j]); continue; }
    let clef, p;
    do {
      clef = s.clefs.length > 1 ? (Math.random() < 0.5 ? 'sol' : 'fa') : s.clefs[0];
      const [lo, hi] = s.et[clef];
      p = lo + Math.floor(Math.random() * (hi - lo + 1));
    } while (prev && prev.clef === clef && prev.p === p);
    s.notes.push(noteInfo(clef, p));
  }
  return s.notes[i];
}

async function startNotes() {
  const r = prefs.notes;
  const input = TEST_MIDI ? 'midi' : r.input === 'touches' ? 'touches' : r.input === 'midi' && midi.inputs().length ? 'midi' : 'voix';
  const clefs = r.clef === 'deux' ? ['sol', 'fa'] : [r.clef === 'fa' ? 'fa' : 'sol'];
  const at = new Date().toISOString();
  // ?seq= impose les premières notes (tests)
  const forced = params.get('seq') ? params.get('seq').split(',').map((t, i) => {
    const cls = SYLLABES.indexOf(t.trim()), clef = clefs.length > 1 ? (i % 3 === 1 ? 'fa' : 'sol') : clefs[0];
    return noteInfo(clef, ((cls - CLEFS[clef].off) % 7 + 7) % 7);
  }) : null;
  const base = { kind: 'notes', exo: 'notes', input, mode: r.clef, clefs, et: { sol: r.sol.slice(), fa: r.fa.slice() }, notes: [], forced,
    over: false, pause: false, at, id: nouvelId(at), rec0: 0, saved: 0 };
  if (input !== 'voix') {                                  // clavier MIDI ou clavier à l'écran : pas de micro
    fermerSon();
    S = { ...base, v: [], k: 0, t0: performance.now() };
    return;
  }
  const au = await ouvrirSon(), model = await modelP;
  const rec = new Recognizer(model, params.has('tau') ? { tau: +params.get('tau') } : {});
  const bypass = !model.gate || gateOff === gateKey(model);
  const s = { ...base, rec, model, heard: [], raw: [], bypass, pcm: [], pcmN: 0, level: 0, rate: au.ctx.sampleRate, tStart: 0, draw: DEBUG ? [] : null,
    garde: r.garderSon !== false, debut: 0, partie: 0 };
  s.suivi = new Suivi((i) => noteAt(s, i).cls);
  // sans filtre : les détections du modèle des syllabes seul et leur propre suivi, pour surveiller le filtre
  s.shadow = bypass ? null : new Suivi((i) => noteAt(s, i).cls);
  rec.onLevel = (rms) => { s.level = rms; };
  rec.onCandidate = (c) => { if (!s.bypass) onCandidate(s, c); };
  rec.onRaw = (c) => onRaw(s, c);
  au.lag = DEBUG ? [] : null;
  S = s;
  au.sink = (y) => { if (!s.over) rec.push(DEBUG || s.garde ? garder(s, y) : y); };
}

const direct = (s) => s.input === 'midi' || s.input === 'touches';
const lus = (s) => (direct(s) ? s.k : s.suivi.best());
const verdictsDe = (s, a, b) => (direct(s) ? Array.from({ length: b - a }, (_, i) => s.v[a + i] ?? null) : s.suivi.verdicts(a, b));
function verdicts() { return S && S.kind === 'notes' ? verdictsDe(S, 0, lus(S)) : []; }

// Taille des portées : la plus grande qui laisse tenir tous les systèmes dans la hauteur de l'écran.
function layout() {
  const nSys = S.clefs.length > 1 ? N_SYS_PIANO : N_SYS;
  const cs = getComputedStyle($('page'));
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight), padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const W = Math.floor(Math.min(window.innerWidth - padX, 760));
  const avail = window.innerHeight - padY - 44 - 52 - (DEBUG ? 60 : 0) - (S.input === 'touches' ? 124 : 0);
  const H = (s) => metrics(s, S.clefs, S.et).H;
  let s = Math.min(Math.floor(W / 32 * 2) / 2, 20);
  while (s > 7 && nSys * H(s) + (nSys - 1) * 8 > avail) s -= 0.5;
  const gap = Math.max(8, Math.min((avail - nSys * H(s)) / Math.max(1, nSys - 1), 3.5 * s));
  return { W, s, gap: Math.floor(gap), nSys };
}

// La page ne s'arrête jamais : les portées gardent leur place, et dès que deux notes sont lues sur une portée,
// la portée précédente est remplacée par la suite. Après la dernière portée, la lecture reprend en haut.
function render() {
  if (!S) return;
  if (S.kind === 'chant') { renderChant(); return; }
  if (S.kind === 'enreg') { renderEnreg(); return; }
  if (S.kind === 'noms') { renderNoms(); return; }
  if (S.kind === 'ml') { renderML(); return; }
  if (S.kind === 'menuML') { renderMenuML(); return; }
  if (S.kind === 'reco') { renderReco(); return; }
  const t0 = performance.now();
  const { W, s, gap, nSys } = layout(), voix = S.input === 'voix';
  // Note en cours, et syllabe nette qui ne lui correspond pas : la note passe au rouge tout de suite. La syllabe suivante
  // tranche : une correction la valide, la note d'après la confirme fausse.
  const k = lus(S), pend = voix ? S.suivi.pending(RED_CONF) : null, cur = pend ? k + 1 : k;
  const L = Math.floor(cur / PER), first = cur % PER < TOURNE && L > 0 ? L - 1 : L;
  const a = first * PER, b = (first + nSys) * PER;
  noteAt(S, b - 1);
  const v = verdictsDe(S, a, b), html = new Array(nSys);
  for (let l = first; l < first + nSys; l++) {
    const notes = S.notes.slice(l * PER, l * PER + PER);
    const states = notes.map((n, i) => {
      const j = l * PER + i, q = v[j - a];
      return { j, kind: q ? q.v : pend && j === k ? 'faux' : 'next', cur: j === cur };
    });
    html[l % nSys] = systemSVG(notes, states, W, s, S.clefs, S.et);
  }
  $('systems').style.gap = gap + 'px';
  $('systems').innerHTML = html.join('');
  if (S.draw && S.draw.length < 60000) S.draw.push(performance.now() - t0);
}

// Cadence et justesse sur les 32 dernières notes lues.
function mesure(v) {
  const rep = v.filter((q) => q && q.time !== undefined), n = rep.length;
  const ok = rep.filter((q) => q.v === 'ok').length, faux = n - ok, manque = v.filter((q) => q && q.v === 'manque').length;
  // Durée de lecture : l'intervalle moyen entre la première et la dernière réponse, compté une fois par note lue.
  const dur = n > 1 ? Math.max(0.5, (rep[n - 1].time - rep[0].time) * n / (n - 1)) : 0.5;
  return { n, ok, faux, manque, dur, rate: Math.round(60 * ok / dur), acc: n ? Math.round(100 * ok / n) : 0 };
}
function ligne() {
  if (!S) return;
  if ($('result').dataset.alerte) { if (!AU || !AU.got) return; delete $('result').dataset.alerte; }
  let t = '';
  if (S.kind === 'notes') {
    const k = lus(S), m = mesure(verdictsDe(S, Math.max(0, k - 32), k));
    if (m.n >= 8) t = `${m.rate} notes justes par minute · ${m.acc} %`;
  } else if (S.kind === 'chant' && S.n) {
    t = `${S.n} ${S.exo === 'accords' ? 'accord' : S.exo === 'gammes' ? 'gamme' : 'intervalle'}${S.n > 1 ? 's' : ''}`;
  } else if (S.kind === 'reco') {
    const m = mesure(S.v.slice(-32));
    if (m.n >= 4) t = `${m.rate} justes par minute · ${m.acc} %`;
  } else if (S.kind === 'noms') {
    const m = mesure(S.v.slice(-32));
    if (m.n >= 4) t = `${m.rate} intervalles justes par minute · ${m.acc} %`;
  }
  $('result').textContent = t;
}

function onCandidate(sess, c) {
  if (sess !== S || S.over || S.pause || S.muet || c.time < S.tStart) return;
  c.delay = S.rec.clock - c.time;                        // son écoulé depuis l'ancre de la syllabe au moment où elle est reconnue
  S.heard.push(c); S.suivi.push(c);
  afterPush();
}

function afterPush() {
  render(); ligne(); debugLine(); jalon(S);
  clearTimeout(S.commitT);
  // une syllabe nette restée sans note compte comme réponse après un silence
  const mine = S;
  S.commitT = setTimeout(() => {
    if (S !== mine || S.over || S.pause || S.muet) return;
    if (S.suivi.commitPending(RED_CONF)) { render(); ligne(); }
  }, COMMIT_MS);
}

// Détection du modèle des syllabes seul, avant le filtre.
function onRaw(sess, c) {
  if (sess !== S || S.over || S.pause || S.muet || c.time < S.tStart) return;
  if (S.bypass) { onCandidate(sess, c); return; }        // filtre coupé : tout passe
  c.delay = S.rec.clock - c.time;
  S.raw.push(c); S.shadow.push(c);
  if (watchGate()) {
    // Le filtre écartait la voix : le suivi sans filtre devient celui de la page, et le filtre reste coupé sur cet appareil.
    S.bypass = true; S.suivi = S.shadow; S.heard = S.raw; S.shadow = null;
    gateOff = gateKey(S.model);
    try { localStorage.setItem('solfege.gate', JSON.stringify({ model: gateOff, at: new Date().toISOString() })); } catch (e) { /* stockage indisponible */ }
    afterPush();
  }
}

// Le filtre est pris en défaut quand cinq détections de suite du modèle seul valident cinq notes de suite de la page
// alors qu'il en a écarté au moins deux : un bruit ne lit pas la page dans l'ordre (une chance sur 7 par note), une voix si.
// La toute dernière détection est laissée de côté, le temps que le filtre rende son avis sur elle.
function watchGate() {
  const t = S.shadow.tail(6);
  if (t.length < 6) return false;
  const w = t.slice(0, 5);
  if (!w.every((q, i) => q.op === 'ok' && q.note === w[0].note + i)) return false;
  const passed = (d) => S.heard.some((g) => g.cls === d.cls && Math.abs(g.frame - d.frame) <= 8);
  return w.filter((q) => !passed(q.det)).length >= 2;
}

// Clavier à l'écran : une octave, la note est jugée par son nom (comme à la voix), quelle que soit l'octave écrite.
function onTouche(cls) {
  if (!S || S.over || S.pause || S.kind !== 'notes' || S.input !== 'touches') return;
  const n = noteAt(S, S.k);
  S.v[S.k] = { v: cls === n.cls ? 'ok' : 'faux', cls, time: (performance.now() - S.t0) / 1000 };
  S.k += 1;
  render(); ligne(); jalon(S);
}
function onMidiNote(note) {
  if (!S || S.over || S.pause || S.kind !== 'notes' || S.input !== 'midi') return;
  const n = noteAt(S, S.k);
  S.v[S.k] = { v: note === n.midi ? 'ok' : 'faux', midi: note, time: (performance.now() - S.t0) / 1000 };
  S.k += 1;
  render(); ligne(); jalon(S);
}

// Le micro de la barre se remplit avec le niveau du son reçu. Le toucher coupe l'écoute : l'app n'entend plus rien, le temps
// de chercher ses notes à part ; le retoucher la rétablit, et un exercice de chant reprend à sa première note.
function levelLoop() {
  const mine = S;
  const tick = () => {
    if (S !== mine || !mine || mine.over) return;
    const l = mine.muet ? 0 : Math.min(1, (mine.level || 0) * 14);
    $('niveau').setAttribute('fill-opacity', String(Math.round(l * 100) / 100));
    requestAnimationFrame(tick);
  };
  if (mine && !direct(mine)) tick();
}
async function micro() {
  if (!S || S.over || S.pause || direct(S) || S.kind === 'enreg') return;
  S.muet = !S.muet;
  const marque = () => { $('mic').setAttribute('aria-pressed', String(S.muet)); $('mic').setAttribute('aria-label', S.muet ? 'Rétablir le micro' : 'Couper le micro'); };
  marque();
  // le micro est vraiment rendu : le témoin de l'iPhone s'éteint
  if (AU && AU.mic) {
    if (S.muet) AU.mic.coupe();
    else {
      const mine = S;
      try { await AU.mic.rouvre(); } catch (e) { if (S === mine) { S.muet = true; marque(); } return; }
      if (S !== mine) return;
    }
  }
  if (S.kind !== 'chant') { if (S.kind === 'notes' && !S.muet && S.rec) S.tStart = S.rec.time; return; }   // ce qui a été dit micro coupé ne compte pas
  if (S.phase === 'vise') { S.j = 0; S.cents = []; S.fauxJ = -1; S.tNote = performance.now(); }
  S.hold.reset(); S.track = []; S.part = 0;
  renderChant();
}

function debugLine() {
  if (!DEBUG || !S || S.kind !== 'notes' || S.input !== 'voix') return;
  const recent = S.heard.slice(-10), last = recent.map((c) => `${SYLLABES[c.cls]} ${c.conf.toFixed(2)}`).join(', ');
  const q = stats(AU && AU.lag), d = stats(S.draw);
  const filtre = !S.model.gate ? 'absent' : S.bypass ? 'coupé' : `actif, ${S.raw.length - S.heard.length} écartées`;
  $('debug').textContent = `v${VERSION} · ${S.rate} Hz · niveau ${S.level.toFixed(3)} · filtre ${filtre} · précoces ${recent.filter((c) => c.early).length}/${recent.length}`
    + ` · livraison ${q ? Math.round(q.med * 1000) : '?'} ms · dessin ${d ? d.med.toFixed(1) : '?'} ms · entendu : ${last}`;
}

// Médiane, 95e centile et maximum d'une série de mesures.
function stats(a) {
  if (!a || !a.length) return null;
  const b = Float64Array.from(a).sort();
  return { n: b.length, med: b[b.length >> 1], p95: b[Math.floor(b.length * 0.95)], max: b[b.length - 1] };
}

// ---------- séances gardées ----------
// La séance en cours est réécrite toutes les 32 notes : rien n'est perdu si la page est fermée. Au-delà de 1024 notes,
// une nouvelle séance commence.
function jalon(s) {
  const k = lus(s);
  if (k - s.saved < 32) return;
  s.saved = k; sauver(s);
  if (k - s.rec0 >= 1024) { s.rec0 = k; s.at = new Date().toISOString(); s.id = nouvelId(s.at); }
}
function sauver(s) {
  if (s.kind === 'notes') {
    const k = lus(s), v = verdictsDe(s, s.rec0, k), m = mesure(v);
    if (!m.n) return;
    const t0 = v.find((q) => q && q.time !== undefined).time;
    // Une note = [clé (0 sol, 1 fa), position sur la portée, verdict (1 juste, 0 faux, -1 non entendue),
    //             réponse (syllabe 0 à 6 à la voix, numéro MIDI au clavier), instant en ms depuis la première réponse]
    const CODE = { ok: 1, faux: 0, manque: -1 };
    // mode : 'sol', 'fa', ou 'piano' pour le système à deux portées
    saveSession({ id: s.id, fmt: 2, app: VERSION, at: s.at, mode: s.mode === 'deux' ? 'piano' : s.mode, input: s.input,
      n: v.length, ok: m.ok, faux: m.faux, manque: m.manque, dur: Math.round(m.dur * 10) / 10, rate: m.rate, acc: m.acc,
      etendue: s.clefs.map((c) => s.et[c]),
      notes: v.map((q, i) => {
        const n = s.notes[s.rec0 + i];
        return [n.clef === 'fa' ? 1 : 0, n.p, q ? CODE[q.v] : null, q ? (q.cls ?? q.midi ?? null) : null, q && q.time !== undefined ? Math.round((q.time - t0) * 1000) : null];
      }) });
  } else if (s.kind === 'reco' && s.v.length) {
    // Une écoute = [ce qui a sonné, 1 si la première réponse est juste, réponse, instant (ms), réécoutes]
    const m = mesure(s.v);
    saveSession({ id: s.id, fmt: 2, app: VERSION, at: s.at, mode: s.exo, input: s.input, n: s.v.length, ok: m.ok, faux: m.faux, rate: m.rate, acc: m.acc,
      items: s.v.slice(-500).map((q) => [q.quoi, q.v === 'ok' ? 1 : 0, q.rep, Math.round(q.time * 1000), q.ecoutes]) });
  } else if (s.kind === 'noms' && s.v.length) {
    // Un intervalle lu = [demi-tons, 1 si la première réponse est juste, réponse en demi-tons, instant (ms)]
    const m = mesure(s.v);
    saveSession({ id: s.id, fmt: 2, app: VERSION, at: s.at, mode: 'noms', input: s.input, n: s.v.length, ok: m.ok, faux: m.faux, rate: m.rate, acc: m.acc,
      items: s.v.slice(-500).map((q) => [q.st, q.v === 'ok' ? 1 : 0, q.cls + 1, Math.round(q.time * 1000)]) });
  } else if (s.kind === 'chant' && s.results.length) {
    // Un exercice chanté = [ce qui était demandé, temps pour le chanter (ms), écart médian de chaque note (cents), réécoutes, reprises, aides]
    saveSession({ id: s.id, fmt: 2, app: VERSION, at: s.at, mode: s.exo, input: 'chant', n: s.results.length, ok: s.results.length,
      tol: TOL, tenue: s.hold.holdMs, items: s.results.slice(-500).map((r) => [r.quoi, r.ms, r.cents, r.replays, r.reprises, r.aides]) });
  }
}
function saveSession(rec) {
  try {
    let all = JSON.parse(localStorage.getItem('solfege.sessions') || '[]');
    if (all.length && all[all.length - 1].id === rec.id) all.pop();
    all.push(rec);
    all = all.slice(-MAX_SESSIONS);
    try { localStorage.setItem('solfege.sessions', JSON.stringify(all)); }
    catch (e) { localStorage.setItem('solfege.sessions', JSON.stringify(all.slice(Math.ceil(all.length / 5)))); }   // place manquante : on cède le cinquième le plus ancien
  } catch (e) { /* stockage indisponible : la séance n'est pas conservée */ }
}

// Un seul fichier à partager : le son tel que l'app l'a reçu (WAV, 16 kHz, mono), suivi d'un bloc « sLFG » qui porte le compte rendu en JSON.
function diagFile(s = S) {
  if (!s || !s.pcm) return null;
  const commun = { app: VERSION, exercice: s.exo, at: s.at, ua: navigator.userAgent,
    installee: (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true,
    rate: s.rate, micro: AU ? AU.mic.info : null, tronque: s.pcmN >= DIAG_MAX, livraison: stats(AU && AU.lag) };
  let meta;
  if (s.kind === 'enreg') {
    // par mot affiché : instant d'affichage (ms depuis le début du son), mot
    meta = { ...commun, vocabulaire: s.vocab, periode: PROMPT_MS, phrases: s.journal };
  } else if (s.kind === 'noms') {
    // par énoncé entendu : instant (ms), nom le plus proche, distance, 1 s'il a été retenu
    meta = { ...commun, seuil: s.seuil, exemples: s.voix.ex.length, entendu: s.entendu };
  } else if (s.kind === 'chant') {
    meta = { ...commun, tol: TOL, tenue: s.hold.holdMs, reglages: s.r,
      // par exercice chanté : ce qui était demandé, temps (ms), écart médian de chaque note (cents), réécoutes
      resultats: s.results.map((r) => [r.quoi, r.ms, r.cents, r.replays, r.reprises, r.aides]) };
  } else {
    const n = Math.min(s.notes.length, s.suivi.best() + 48);
    meta = { ...commun, modele: { version: s.model.version, trained: s.model.trained },
      ecran: [window.innerWidth, window.innerHeight, window.devicePixelRatio], tStart: s.tStart, mode: s.mode,
      attendu: s.notes.slice(0, n).map((q) => SYLLABES[q.cls]), clefs: s.notes.slice(0, n).map((q) => (q.clef === 'fa' ? 1 : 0)),
      // par syllabe entendue : instant (ms), syllabe, confiance, son écoulé avant la reconnaissance (ms), 1 si reconnue sans attendre le sommet
      entendu: s.heard.map((c) => [Math.round(c.time * 1000), SYLLABES[c.cls], Math.round(c.conf * 100) / 100, Math.round(c.delay * 1000), c.early ? 1 : 0]),
      dessin: stats(s.draw),
      // filtre « syllabe dite ou autre son » : son seuil, s'il a été coupé, et les détections du modèle seul (pour voir ce qu'il a écarté)
      filtre: s.model.gate ? { tau: s.rec.tau, coupe: s.bypass, cle: gateKey(s.model) } : null,
      brut: (s.bypass ? [] : s.raw).map((c) => [Math.round(c.time * 1000), SYLLABES[c.cls], Math.round(c.conf * 100) / 100]),
      verdicts: verdictsDe(s, 0, lus(s)).map((q) => (q ? q.v : null)),
      // ce morceau commence à `debut` secondes du début de la séance (une longue séance est gardée en morceaux de cinq minutes)
      debut: s.debut || 0 };
  }
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const n = s.pcm.reduce((a, c) => a + c.length, 0), pad = json.length % 2;
  const buf = new ArrayBuffer(44 + 2 * n + 8 + json.length + pad), b = new DataView(buf);
  const w = (o, t) => { for (let i = 0; i < t.length; i++) b.setUint8(o + i, t.charCodeAt(i)); };
  w(0, 'RIFF'); b.setUint32(4, buf.byteLength - 8, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 16000, true); b.setUint32(28, 32000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, 2 * n, true);
  let o = 44;
  for (const c of s.pcm) for (let i = 0; i < c.length; i++) { b.setInt16(o, c[i], true); o += 2; }
  w(o, 'sLFG'); b.setUint32(o + 4, json.length, true); new Uint8Array(buf, o + 8, json.length).set(json);
  return new File([buf], `solfege-${s.exo}-${s.at.replace(/[:.]/g, '-')}${s.partie ? `-${s.partie + 1}` : ''}.wav`, { type: 'audio/wav' });
}
// ---------- son des séances gardé sur l'appareil ----------
// Pour réentraîner la reconnaissance des notes : le son des séances de lecture à la voix, avec ce qui était écrit et ce que
// l'app a entendu, est gardé sur l'appareil (12 morceaux de cinq minutes au plus, les plus anciens partent). Rien ne quitte
// l'appareil sans passer par le partage, dans les réglages.
const SONS_MAX = 12;
function baseSons() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open('solfege-son', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('morceaux', { keyPath: 'nom' });
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
}
const resultat = (req) => new Promise((ok, ko) => { req.onsuccess = () => ok(req.result); req.onerror = () => ko(req.error); });
async function sonListe() {
  const db = await baseSons(), l = await resultat(db.transaction('morceaux').objectStore('morceaux').getAll());
  return l.sort((a, b) => a.at - b.at);
}
async function sonGarder(f, duree) {
  const db = await baseSons();
  const mettre = () => resultat(db.transaction('morceaux', 'readwrite').objectStore('morceaux').put({ nom: f.name, at: Date.now(), duree, blob: f }));
  try { await mettre(); } catch (e) { const l = await sonListe(); if (l.length) await resultat(db.transaction('morceaux', 'readwrite').objectStore('morceaux').delete(l[0].nom)); await mettre(); }
  const l = await sonListe();
  for (const q of l.slice(0, Math.max(0, l.length - SONS_MAX))) await resultat(db.transaction('morceaux', 'readwrite').objectStore('morceaux').delete(q.nom));
}
async function sonEffacer() { const db = await baseSons(); await resultat(db.transaction('morceaux', 'readwrite').objectStore('morceaux').clear()); }
// Le morceau en cours part sur l'appareil (s'il dure 20 s au moins) et un nouveau commence.
function ranger(s) {
  const duree = s.pcmN / 16000;
  if (duree >= Math.min(20, DIAG_MAX / 32000)) { const f = diagFile(s); s.rangement = sonGarder(f, duree).catch((e) => console.warn('son non gardé', e)); }
  s.debut = (s.debut || 0) + duree; s.pcm = []; s.pcmN = 0; s.partie = (s.partie || 0) + 1;
}
// Réglages : nombre de morceaux gardés, partage et effacement. Le partage doit partir du toucher même : la liste est lue avant.
let sonsPrets = [];
async function majSons() {
  const el = $('sons');
  if (!el) return;
  try { sonsPrets = await sonListe(); } catch (e) { sonsPrets = []; }
  if (!$('sons')) return;
  const min = Math.round(sonsPrets.reduce((a, q) => a + q.duree, 0) / 60);
  $('sons').innerHTML = sonsPrets.length
    ? `<span>${sonsPrets.length} enregistrement${sonsPrets.length > 1 ? 's' : ''} · ${min} min</span><button type="button" data-a="sonsPart">Partager</button><button type="button" data-a="sonsEff">Effacer</button>`
    : '<span>Aucun enregistrement</span>';
}
async function partagerSons() {
  const files = sonsPrets.map((q) => new File([q.blob], q.nom, { type: 'audio/wav' }));
  if (!files.length) return;
  try { if (navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  for (const f of files) { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); }
}

async function shareAudio() {
  const f = (S && S.kind === 'enreg' && S.fichier) || diagFile();
  if (!f) return;
  try {
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f] }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
}

// ---------- chant : intervalles, portée, accords ----------
// Trois temps, sans chronomètre. Écoute : la note de départ sonne au piano (toucher l'exercice la rejoue). Vise : tu cherches
// la note, la courbe bleue montre ta voix autour d'elle, rien n'est jugé faux. Tiens : la note compte après la tenue réglée
// dans la bande de ±TOL cents, à l'octave près. Puis la note suivante, puis l'exercice suivant, sans fin.
async function startChant(exo, mains = false) {
  const au = await ouvrirSon(), banc = await chargerPiano(au.ctx);
  const at = new Date().toISOString(), pitch = new Pitch({ win: 1024 });
  const s = { kind: 'chant', exo, input: 'chant', r: JSON.parse(JSON.stringify(prefs[exo])), banc, pitch, hold: new Hold({ tol: TOL, holdMs: tenue() }),
    forced: params.get(IMPOSE[exo]) ? params.get(IMPOSE[exo]).split(',') : null, it: null, j: 0, n: 0, track: [], results: [], replays: 0, reprises: 0, aides: 0, fauxJ: -1, courbe: prefs.courbe, phase: 'ecoute', part: 0,
    level: 0, rate: au.ctx.sampleRate, pcm: [], pcmN: 0, over: false, pause: false, at, id: nouvelId(at) };
  pitch.onPitch = (q) => onPitch(s, q);
  au.lag = DEBUG ? [] : null;
  if (mains) { s.mains = true; s.input = 'mains'; await preparerVoix(s, ['commandes']); s.ecoute = new Ecoute(); s.ecoute.onEnonce = (u) => entendre(s, u); }
  S = s;
  au.sink = (y) => { if (s.over) return; const z = DEBUG ? garder(s, y) : y; pitch.push(z); if (s.ecoute) s.ecoute.push(z); };
  $('systems').className = 'chant';
  chantLoop();
  if (mains) { dire(`Chant, ${exo}.`).then(() => { if (S === s && !s.over) suivant(); }); return; }
  suivant();
}

// Tire l'exercice suivant. Pour les tests, l'adresse impose les premiers : ?iv=départ:cible (numéros MIDI) pour un intervalle,
// ?pt=position:position:altération pour la portée, ?ac=type@fondamentale pour un accord.
const IMPOSE = { intervalles: 'iv', portee: 'pt', accords: 'ac', gammes: 'gm' };
function suivant() {
  const s = S, f = s.forced && s.forced.length ? s.forced.shift() : null;
  let it;
  if (s.exo === 'intervalles') {
    let q = tirerIntervalle(s.r, Math.random, s.it);
    if (f) { const [a, b] = f.split(':').map(Number); q = { st: Math.abs(b - a), sens: Math.sign(b - a), ref: a, cible: b }; }
    it = { ...q, cibles: s.r.depart ? [q.ref, q.cible] : [q.cible], titre: `${INTERVALLES[q.st].court} ${q.sens > 0 ? '↑' : '↓'}`, dit: `${INTERVALLES[q.st].nom} ${sensDe(q.st, q.sens)}`, quoi: [q.ref, q.cible] };
  } else if (s.exo === 'portee') {
    let q = tirerPortee(s.r, Math.random, s.it);
    if (f) { const [a, b, alt] = f.split(':').map(Number), m1 = midiOf(a), m2 = midiOf(b) + (alt || 0); q = { st: Math.abs(m2 - m1), sens: Math.sign(m2 - m1), notes: [{ p: a, alt: 0, midi: m1 }, { p: b, alt: alt || 0, midi: m2 }] }; }
    it = { ...q, ref: q.notes[0].midi, cibles: q.notes.map((n) => n.midi), quoi: q.notes.map((n) => [n.p, n.alt]) };
  } else if (s.exo === 'gammes') {
    let q = tirerGamme(s.r, Math.random, s.it);
    if (f) { const [id, rac] = f.split('@'); q = { id, racine: +rac, sens: 1, ref: 48 + +rac, notes: [...GAMMES.find((x) => x.id === id).tons, 12].map((t) => 48 + +rac + t) }; }
    it = { ...q, cibles: q.notes, titre: `${gammeCourt(q.id)} ${q.sens > 0 ? '↑' : '↓'}`, dit: `Gamme ${GAMMES.find((x) => x.id === q.id).nom} ${q.sens > 0 ? 'en montant' : 'en descendant'}`, quoi: [q.id, q.racine, q.sens] };
  } else {
    let q = tirerAccord(s.r, Math.random, s.it);
    if (f) { const [id, rac] = f.split('@'), a = ACCORDS.find((x) => x.id === id); q = { id, racine: +rac, ref: 48 + +rac, tons: a.tons.map((t) => 48 + +rac + t) }; }
    it = { ...q, cibles: q.tons, titre: chiffrage(q.racine, q.id), quoi: [q.id, q.racine] };
  }
  s.it = it; s.j = 0; s.replays = 0; s.reprises = 0; s.aides = 0; s.fauxJ = -1; s.tVise = undefined; s.cents = [];
  if (!s.mains) { playRef(); return; }
  // mains libres : l'app dit l'exercice, puis la note de départ sonne
  s.phase = 'ecoute'; s.listenFrom = Infinity; renderChant();
  dire(texteChant(s.exo, it)).then(() => { if (S === s && !s.over && s.it === it) playRef(); });
}
function playRef() {
  const s = S;
  couper(AU.ctx);
  jouer(AU.ctx, s.banc, s.it.ref, REF_MS / 1000);
  if (s.mains) bloquer(REF_MS);
  s.phase = 'ecoute'; s.listenFrom = performance.now() + 30 + REF_MS + REF_TAIL_MS;
  s.hold.reset(); s.track = []; s.part = 0;
  renderChant();
}

// Pas à tâtons : une autre note tenue, ou trop de temps pour trouver la suivante, et l'exercice reprend à sa première note,
// après avoir fait réentendre la note de départ. La note où l'on a buté reste rouge pendant ce temps.
function reprise() {
  const s = S;
  s.reprises += 1; s.fauxJ = s.j; s.j = 0; s.cents = [];
  if (!s.mains) { playRef(); return; }
  bip('faux'); s.phase = 'ecoute'; s.listenFrom = Infinity; renderChant();
  setTimeout(() => { if (S === s && !s.over) playRef(); }, 450);
}
// Aide : toutes les notes ensemble (plaqué) ou l'une après l'autre (arpégé), puis on reprend à la première.
function aide(mode) {
  const s = S;
  if (!s || s.kind !== 'chant' || s.over || s.pause || !s.it || s.phase === 'tenu') return;
  const notes = s.exo === 'accords' ? s.it.tons : s.exo === 'gammes' ? s.it.cibles : s.exo === 'portee' ? s.it.notes.map((n) => n.midi) : [s.it.ref, s.it.cible];
  const pas = mode !== 'arpege' ? 0 : s.exo === 'gammes' ? 0.38 : 0.55, dur = mode === 'arpege' ? (s.exo === 'gammes' ? 0.7 : 1.0) : 1.8;
  couper(AU.ctx);                                        // un second appui remplace le premier, sans superposition
  notes.forEach((m, i) => jouer(AU.ctx, s.banc, m, dur, pas ? 0.9 : 0.9 / Math.sqrt(notes.length), i * pas));
  s.aides += 1; s.j = 0; s.cents = []; s.fauxJ = -1;
  if (s.mains) bloquer(((notes.length - 1) * pas + dur) * 1000);
  s.phase = 'ecoute'; s.listenFrom = performance.now() + 30 + ((notes.length - 1) * pas + dur) * 1000 + REF_TAIL_MS;
  s.hold.reset(); s.track = []; s.part = 0;
  renderChant();
}

// Une mesure de hauteur toutes les 10 ms.
function onPitch(sess, q) {
  if (sess !== S || S.over) return;
  S.level = q.rms;
  if (S.pause || S.muet) return;
  const now = performance.now();
  if (S.phase === 'ecoute') {
    if (now < S.listenFrom) return;                      // le piano sonne : on n'écoute pas la voix
    S.phase = 'vise'; S.hold.reset(); S.fauxJ = -1; S.tNote = now;
    if (S.tVise === undefined) S.tVise = now;
    renderChant();
  }
  if (S.phase !== 'vise') return;
  const cible = S.it.cibles[S.j], r = S.hold.push(q, cible);
  S.part = r.part;
  S.track.push({ t: q.time, c: r.voiced ? r.cents : null });
  if (S.track.length > 100 * (TRACE_S + 1)) S.track.splice(0, 100);
  if (DEBUG) $('debug').textContent = `v${VERSION} · ${S.rate} Hz · ${q.f0 ? q.f0.toFixed(1) + ' Hz' : 'pas de note'} · netteté ${q.clarity.toFixed(2)} · écart ${r.cents === null ? '?' : Math.round(r.cents) + ' cents'} · bande ±${TOL}, tenue ${S.hold.holdMs} ms · reprises ${S.reprises}`;
  if (!r.done) {
    if (S.j > 0 && now - S.tNote > S.hold.holdMs + CHERCHE_MS) { reprise(); return; }
    if (r.faux !== null) {
      // la note précédente, encore tenue, n'est pas une fausse note
      const d = S.j > 0 ? r.faux + 100 * (cible - S.it.cibles[S.j - 1]) : null;
      if (d === null || Math.abs(d - 1200 * Math.round(d / 1200)) > TOL + 25) reprise();
    }
    return;
  }
  S.cents.push(Math.round(r.median) || 0);
  S.j += 1; S.hold.reset(); S.track = []; S.part = 0; S.tNote = now;
  if (S.j < S.it.cibles.length) { if (S.mains) bip('note'); renderChant(); return; }
  if (S.mains) bip('juste');
  S.n += 1;
  S.results.push({ quoi: S.it.quoi, ms: Math.round(now - S.tVise), cents: S.cents, replays: S.replays, reprises: S.reprises, aides: S.aides });
  S.phase = 'tenu'; renderChant(); ligne();
  if (S.n % 8 === 0) sauver(S);
  S.nextT = setTimeout(() => { if (S === sess && !S.over && !S.pause) suivant(); }, S.reprises ? APRES_ERREUR_MS : S.mains ? 600 : ENCHAINE_MS);
}

// En haut : le nom de l'intervalle, le chiffrage de l'accord, ou la portée avec ses notes. Dessous, la courbe de la voix :
// la ligne du milieu est la note à chanter, la bande bleue ce qu'il faut tenir (±TOL cents), les traits fins marquent les demi-tons.
const SPAN = 350;                                          // la courbe montre ±350 cents autour de la cible
function chantLayout() {
  const cs = getComputedStyle($('page'));
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const W = Math.floor(Math.min(window.innerWidth - padX, 760)), s = Math.min(Math.floor(W / 22 * 2) / 2, 20);
  const yb = Math.round(7.4 * s), y0 = Math.round(11.8 * s), hc = Math.round(9 * s);
  return { W, s, yb, y0, hc, H: S && S.courbe === false ? y0 : y0 + hc + 4, xa: 0.4 * s, xb: W - 0.8 * s };
}
function renderChant() {
  if (!S || S.kind !== 'chant' || !S.it) return;
  const { W, s, yb, y0, hc, H, xa, xb } = chantLayout(), it = S.it, n = it.cibles.length;
  const yc = (c) => y0 + hc / 2 - c * (hc / 2) / SPAN, serif = getComputedStyle(document.body).fontFamily.replace(/"/g, "'");
  const vise = S.phase === 'vise';
  let o = '', label;
  if (S.exo === 'portee') {
    // la première note est bleue pendant qu'elle sonne ; une note tenue s'efface en gris ; le repère montre la note à chanter
    const etats = it.notes.map((q, i) => (S.phase === 'tenu' ? GREEN : S.phase === 'ecoute' && i === S.fauxJ ? RED : i < S.j ? DONE : S.phase === 'ecoute' && i === 0 ? BLUE : INK));
    o += porteeChant(it.notes, etats, vise ? S.j : -1, W, s, yb);
    label = `Deux notes à chanter : ${INTERVALLES[it.st].nom} ${sensDe(it.st, it.sens)}.`;
  } else {
    const accord = S.exo === 'accords';
    o += `<text id="titre" x="${r2(W / 2)}" y="${r2(6.6 * s)}" text-anchor="middle" font-family="${serif}" font-size="${r2(Math.min(4.2, W / s / (0.62 * it.titre.length + 1)) * s)}" fill="${INK}">${it.titre}</text>`;
    // une pastille par note à chanter : grise une fois tenue, bleue pour la note en cours, rouge là où l'on a buté
    for (let i = 0; i < n; i++) {
      const x = W / 2 + (i - (n - 1) / 2) * 1.7 * s, fait = i < S.j, cur = vise && i === S.j, bute = S.phase === 'ecoute' && i === S.fauxJ;
      o += `<circle data-c="${i}" cx="${r2(x)}" cy="${r2(9.7 * s)}" r="${r2(0.3 * s)}" fill="${bute ? RED : S.phase === 'tenu' ? GREEN : fait ? DONE : cur ? BLUE : 'none'}" stroke="${bute || fait || S.phase === 'tenu' ? 'none' : cur ? BLUE : LINE}" stroke-width="1.2"/>`;
    }
    label = accord ? `Accord ${it.titre} : ${n} notes à chanter de bas en haut.` : `${it.dit}${S.exo === 'gammes' ? ` : ${n} notes à chanter` : ''}.`;
  }
  if (S.courbe) {
    o += `<rect id="bande" x="${r2(xa)}" y="${r2(yc(TOL))}" width="${r2(xb - xa)}" height="${r2(yc(-TOL) - yc(TOL))}" fill="${BLUE}" opacity="0.16"/>`;
    for (const c of [-300, -200, -100, 100, 200, 300]) o += `<line x1="${r2(xa)}" y1="${r2(yc(c))}" x2="${r2(xb)}" y2="${r2(yc(c))}" stroke="${LINE}" stroke-width="0.6" opacity="0.35"/>`;
    o += `<line x1="${r2(xa)}" y1="${r2(yc(0))}" x2="${r2(xb)}" y2="${r2(yc(0))}" stroke="${BLUE}" stroke-width="1" opacity="0.6"/>`;
    o += `<path id="trace" d="" fill="none" stroke="${BLUE}" stroke-width="${r2(Math.max(2.2, s / 6))}" stroke-linecap="round" stroke-linejoin="round"/>`;
    o += `<circle id="voix" cx="${r2(xb)}" cy="-9999" r="${r2(s * 0.36)}" fill="${BLUE}"/>`;
  }
  $('systems').style.gap = '0px';
  $('systems').innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label} Toucher pour réentendre la note de départ.">${o}</svg>`;
}
// Les TRACE_S dernières secondes de la voix, la plus récente à droite ; hors de l'échelle, la courbe longe le bord.
// La bande fonce à mesure que la note est tenue.
function chantLoop() {
  if (!S || S.over || S.kind !== 'chant') return;
  const tr = $('trace'), dot = $('voix'), bande = $('bande');
  if (bande) bande.setAttribute('opacity', String(r2(0.16 + 0.3 * S.part)));
  if (tr && S.track.length) {
    const { y0, hc, xa, xb } = chantLayout(), tN = S.track[S.track.length - 1].t, px = (xb - xa) / TRACE_S;
    let d = '', pen = false, last = null;
    for (const q of S.track) {
      const x = xb - (tN - q.t) * px;
      if (q.c === null || x < xa) { pen = false; continue; }
      const yy = y0 + hc / 2 - Math.max(-SPAN, Math.min(SPAN, q.c)) * (hc / 2) / SPAN;
      d += `${pen ? 'L' : 'M'}${r2(x)} ${r2(yy)}`; pen = true; last = yy;
    }
    tr.setAttribute('d', d);
    dot.setAttribute('cy', S.track[S.track.length - 1].c === null || last === null ? -9999 : r2(last));
  } else if (tr) { tr.setAttribute('d', ''); dot.setAttribute('cy', -9999); }
  const mine = S;
  requestAnimationFrame(() => { if (S === mine) chantLoop(); });
}

// ---------- lecture d'intervalles ----------
// Dire le nom de l'intervalle écrit. La reconnaissance des noms s'apprend sur l'appareil : une série de 44 noms enregistrée
// ici (ou importée d'un fichier déjà enregistré) donne les exemples auxquels chaque nom dit est comparé. Les exemples
// restent sur l'appareil (solfege.noms), quatre séries au plus.
const NOMS = INTERVALLES.slice(1).map((q) => q.nom);
// Vocabulaires dits à voix haute. mots = ce que l'écran d'enregistrement affiche, qu'on prononce ; classe(mot) = ce qui est appris.
// Chaque vocabulaire peut avoir une voix livrée avec l'app (fichier `livre`, quand il existe) et ses séries enregistrées sur l'appareil.
const COMMANDES = ['encore', 'suivant', 'réponse', 'stop', 'écoute', 'chant', 'intervalles', 'accords', 'gammes'];
const VOCABS = {
  noms: { titre: 'les noms d\'intervalles', mots: NOMS, classe: (m) => NOMS.indexOf(m), cle: 'solfege.noms', livre: 'noms.json' },
  commandes: { titre: 'les commandes', mots: COMMANDES, classe: (m) => (COMMANDES.includes(m) ? m : -1), cle: 'solfege.voix.commandes', livre: null },
  accords: { titre: 'les noms d\'accords', mots: ACCORDS.map((a) => a.dit), classe: (m) => (ACCORDS.find((a) => a.dit === m) || { id: -1 }).id, cle: 'solfege.voix.accords', livre: null },
  gammes: { titre: 'les noms de gammes', mots: GAMMES.map((g) => g.dit || g.nom), classe: (m) => (GAMMES.find((g) => (g.dit || g.nom) === m) || { id: -1 }).id, cle: 'solfege.voix.gammes', livre: null },
};
function lireVoix(id = 'noms') {
  try { const v = JSON.parse(localStorage.getItem(VOCABS[id].cle) || 'null'); return v && v.v === 1 && v.series.length ? v : null; } catch (e) { return null; }
}
// La voix de départ est livrée avec l'app (noms.json, fait par outils/noms_modele.mjs) ; les séries enregistrées sur
// l'appareil s'y ajoutent. Un énoncé est retenu si son score ne dépasse pas 1,08 fois le plus grand score d'un nom retrouvé
// à la vérification, et si le deuxième nom est au moins 3 % plus loin (sinon c'est trop incertain : on le redit).
const livres = {};
const livreDe = (id) => (livres[id] = livres[id] || (!VOCABS[id].livre ? Promise.resolve(null) : fetch(VOCABS[id].livre)).then((r) => (r.ok ? r.json() : null)).catch(() => null));
const exemples = (g) => g.map(([cls, t]) => ({ cls, f: traits(deballer(t)) }));
const voixCaches = {};
async function voixApprise(id = 'noms') {
  const livre = await livreDe(id), v = lireVoix(id);
  const g = [...(livre ? livre.g : []), ...(v ? v.series.flatMap((q) => q.g) : [])];
  if (!g.length) return null;
  const cle = (livre ? livre.fait : '') + (v ? v.series.map((q) => q.at).join() : '');
  if (!voixCaches[id] || voixCaches[id].cle !== cle) voixCaches[id] = { cle, voix: new Voix(exemples(g)), seuil: 1.08 * Math.max(livre ? livre.loin : 0, v ? v.loin : 0) };
  return voixCaches[id];
}
// Apprend une série (son à 16 kHz en blocs, journal [[ms, mot]]) et la vérifie : chaque exemple connu contre tous les autres.
async function enroler(blocs, journal, periode, at, id = 'noms') {
  const V = VOCABS[id], ex = apprendre(blocs, journal.map(([ms, mot]) => [ms, V.classe(mot)]), periode);
  if (ex.length < 0.75 * journal.length) return { ok: false, n: ex.length, total: journal.length };
  const v = lireVoix(id) || { v: 1, series: [] };
  v.series.push({ at, g: ex.map((e) => [e.cls, emballer(e.c)]) });
  v.series = v.series.slice(-4);
  // la nouvelle série est vérifiée contre tout le reste : voix livrée et séries déjà apprises
  const livre = await livreDe(id), avant = [...(livre ? livre.g : []), ...v.series.slice(0, -1).flatMap((q) => q.g)];
  const r = new Voix(exemples([...avant, ...v.series[v.series.length - 1].g])).verifier(avant.length);
  v.loin = Math.max(v.loin || 0, r.loin);
  localStorage.setItem(V.cle, JSON.stringify(v));
  return { ok: true, n: ex.length, total: journal.length, juste: r.ok, sur: r.n, series: v.series.length };
}
// Un enregistrement déjà partagé par l'app : WAV 16 kHz mono et son bloc « sLFG ».
function importer(buf) {
  const b = new DataView(buf), bl = {};
  const tag = (o) => String.fromCharCode(b.getUint8(o), b.getUint8(o + 1), b.getUint8(o + 2), b.getUint8(o + 3));
  if (buf.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('ce n\'est pas un fichier WAV');
  for (let pos = 12; pos + 8 <= buf.byteLength;) { const n = b.getUint32(pos + 4, true); bl[tag(pos)] = [pos + 8, n]; pos += 8 + n + (n & 1); }
  if (!bl.sLFG || !bl.data) throw new Error('ce fichier ne vient pas de l\'écran d\'enregistrement');
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, bl.sLFG[0], bl.sLFG[1])));
  if (!Array.isArray(meta.phrases) || b.getUint32(bl['fmt '][0] + 4, true) !== 16000) throw new Error('ce fichier ne vient pas de l\'écran d\'enregistrement');
  const n = bl.data[1] >> 1, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = b.getInt16(bl.data[0] + 2 * i, true) / 32768;
  return enroler([x], meta.phrases, meta.periode || PROMPT_MS, meta.at || new Date().toISOString(), VOCABS[meta.vocabulaire] ? meta.vocabulaire : 'noms');   // une promesse
}

async function startNoms() {
  const toucher = prefs.noms.reponse === 'toucher', at = new Date().toISOString();
  const base = { kind: 'noms', exo: 'noms', r: JSON.parse(JSON.stringify(prefs.noms)), forced: params.get('nm') ? params.get('nm').split(',').map(Number) : null,
    it: null, etat: 'attend', premier: null, faux: new Set(), v: [], n: 0, entendu: [], level: 0, over: false, pause: false, at, id: nouvelId(at), t0: performance.now() };
  $('systems').className = 'chant';
  if (toucher) {                                           // sans micro : on touche le nom de l'intervalle
    fermerSon();
    S = { ...base, input: 'toucher' };
    suivantNom();
    return;
  }
  const au = await ouvrirSon(), appris = await voixApprise('noms');
  if (!appris) { await startEnreg('noms'); return; }             // ni voix livrée ni série apprise : on commence par enregistrer
  const s = { ...base, input: 'voix', voix: appris.voix, seuil: appris.seuil, ecoute: new Ecoute(), rate: au.ctx.sampleRate, pcm: [], pcmN: 0 };
  s.ecoute.onEnonce = (u) => onNom(s, u);
  au.lag = DEBUG ? [] : null;
  S = s;
  au.sink = (y) => { if (s.over) return; s.ecoute.push(DEBUG ? garder(s, y) : y); s.level = s.ecoute.niveau; };
  suivantNom();
}
// Deux notes à la suite, dans la clé choisie ; ?nm= impose les premiers intervalles, en demi-tons (tests).
function suivantNom() {
  const s = S, f = s.forced && s.forced.length ? s.forced.shift() : null;
  const clef = s.r.clef === 'deux' ? (Math.random() < 0.5 ? 'sol' : 'fa') : s.r.clef === 'fa' ? 'fa' : 'sol';
  const q = tirerPortee(f ? { iv: [f], montant: true, descendant: true } : { iv: s.r.iv, montant: true, descendant: true, alterations: !!s.r.alterations }, Math.random, s.it, clef);
  s.it = { ...q, clef }; s.etat = 'attend'; s.premier = null; s.faux = new Set(); s.bon = null;
  renderNoms();
}
// Un énoncé vient d'être entendu. Trop loin de tout exemple : ce n'est pas un nom, rien ne se passe. Le bon nom grise les
// notes et amène l'intervalle suivant ; un autre nom les met en rouge jusqu'à la bonne réponse. Seule la première réponse compte.
function onNom(sess, u) {
  if (sess !== S || S.over || S.pause || S.muet || S.etat === 'ok' || u.t1 - u.t0 > 2.5) return;
  const r = S.voix.classer(traits(u.c)), retenu = r.dist <= S.seuil && r.autre >= 1.03 * r.dist;
  if (S.entendu.length < 5000) S.entendu.push([Math.round(u.t0 * 1000), NOMS[r.cls], Math.round(r.dist * 100) / 100, retenu ? 1 : 0]);
  if (DEBUG) $('debug').textContent = `v${VERSION} · ${S.rate} Hz · ${S.voix.ex.length} exemples · entendu : ${NOMS[r.cls]} à ${r.dist.toFixed(2)} (seuil ${S.seuil.toFixed(2)}, autre nom à ${r.autre.toFixed(2)})${retenu ? '' : ' · écarté'}`;
  if (!retenu) return;
  const juste = r.cls + 1 === S.it.st;
  if (S.premier === null) { S.premier = juste; S.v.push({ v: juste ? 'ok' : 'faux', cls: r.cls, st: S.it.st, time: (performance.now() - S.t0) / 1000 }); }
  if (!juste) { S.etat = 'faux'; renderNoms(); ligne(); return; }
  S.etat = 'ok'; S.n += 1;
  renderNoms(); ligne();
  if (S.v.length % 16 === 0) sauver(S);
  S.nextT = setTimeout(() => { if (S === sess && !S.over) suivantNom(); }, S.premier ? ENCHAINE_MS : APRES_ERREUR_MS);
}
function renderNoms() {
  if (!S || S.kind !== 'noms' || !S.it) return;
  const { W, s, yb } = chantLayout(), H = Math.round(11.8 * s), col = S.etat === 'ok' ? GREEN : S.etat === 'faux' ? RED : INK;
  $('systems').style.gap = '0px';
  $('systems').innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Deux notes en ${CLEFS[S.it.clef].nom} : ${S.input === 'toucher' ? 'toucher' : 'dire'} le nom de l'intervalle.">${porteeChant(S.it.notes, [col, col], -1, W, s, yb, S.it.clef)}</svg>`
    + (S.input === 'toucher' ? choixHTML(S.r.iv.map((st) => [st, INTERVALLES[st].court])) : '');
}

// ---------- réponses au toucher ----------
// Les réponses proposées sont celles cochées dans les réglages, en notation. Une mauvaise réponse est barrée ; en reconnaissance,
// la toucher à nouveau la fait entendre (même fondamentale), pour comparer. Seule la première réponse compte. Trouvée du
// premier coup, la question suivante vient seule ; trouvée après une erreur, on reste : réécouter, écouter note après note
// si c'était joué ensemble, comparer avec les réponses barrées, puis passer à la suite.
function choixHTML(liste) {
  const ecoute = S.kind === 'reco';
  return `<div id="choix">${liste.map(([v, t]) => { const f = S.faux.has(String(v)); return `<button type="button" data-r="${v}" class="${f ? 'faux' : S.bon === String(v) ? 'bon' : ''}"${f && !ecoute ? ' disabled' : ''}${f && ecoute ? ` aria-label="Écouter ${t}"` : ''}>${t}</button>`; }).join('')}</div>`;
}
function repondre(val) {
  const s = S;
  if (!s || s.over || s.pause || (s.kind !== 'reco' && !(s.kind === 'noms' && s.input === 'toucher'))) return;
  if (s.kind === 'reco' && !s.mains && s.faux.has(String(val))) { ecouterReponse(val); return; }
  if (s.etat === 'ok') return;
  const juste = s.exo === 'rAccords' ? val === s.it.id : s.exo === 'rGammes' ? memesNotes(val, s.it.id) : +val === s.it.st;
  if (s.mains) { repondreMains(s, val, juste); return; }
  if (s.premier === null) {
    s.premier = juste;
    s.v.push({ v: juste ? 'ok' : 'faux', rep: val, cls: +val - 1, st: s.it.st, quoi: s.it.quoi, ecoutes: s.ecoutes || 0, time: (performance.now() - s.t0) / 1000 });
  }
  if (!juste) { s.faux.add(String(val)); s.etat = 'faux'; render(); ligne(); return; }
  s.etat = 'ok'; s.bon = String(val); s.n += 1;
  if (s.kind === 'reco' && s.premier === false) s.attend = true;
  render(); ligne();
  if (s.v.length % 16 === 0) sauver(s);
  if (s.attend) return;
  s.nextT = setTimeout(() => { if (S === s && !s.over) (s.kind === 'noms' ? suivantNom : suivantReco)(); }, s.premier ? ENCHAINE_MS : APRES_ERREUR_MS);
}

// ---------- reconnaissance à l'oreille : intervalles, accords, gammes ----------
// Le piano joue, on touche ce qu'on a entendu. Sans micro. L'icône du haut-parleur rejoue.
async function startReco(exo, mains = false) {
  const au = await ouvrirSon(mains), banc = await chargerPiano(au.ctx), at = new Date().toISOString();
  const s = { kind: 'reco', exo, input: mains ? 'mains' : 'toucher', mains, r: JSON.parse(JSON.stringify(prefs[exo])), banc, it: null, etat: 'attend', premier: null, faux: new Set(), bon: null, ecoutes: 0, attend: false,
    v: [], n: 0, level: 0, over: false, pause: false, at, id: nouvelId(at), t0: performance.now() };
  $('systems').className = 'chant';
  if (mains) {
    await preparerVoix(s, ['commandes', VOC_RECO[exo]]);
    s.ecoute = new Ecoute(); s.ecoute.onEnonce = (u) => entendre(s, u);
    au.sink = (y) => { if (s.over) return; s.ecoute.push(y); s.level = s.ecoute.niveau; };
    S = s;
    dire(`Écoute, ${{ rIntervalles: 'intervalles', rAccords: 'accords', rGammes: 'gammes' }[exo]}.`).then(() => { if (S === s && !s.over) suivantReco(); });
    return;
  }
  S = s;
  suivantReco();
}
function suivantReco() {
  const s = S, r = s.r, un = (a) => a[Math.floor(Math.random() * a.length)];
  let it;
  if (s.exo === 'rIntervalles') {
    const q = tirerIntervalle(r, Math.random, s.it);
    it = { ...q, notes: [q.ref, q.cible], jeu: un([r.melodique !== false && 'mel', r.harmonique && 'harm'].filter(Boolean)), quoi: [q.ref, q.cible] };
  } else if (s.exo === 'rAccords') {
    const q = tirerAccord(r, Math.random, s.it);
    it = { ...q, notes: q.tons, jeu: un([r.plaque !== false && 'harm', r.arpege && 'mel'].filter(Boolean)), quoi: [q.id, q.racine] };
  } else {
    const q = tirerGamme(r, Math.random, s.it);
    it = { ...q, jeu: 'mel', quoi: [q.id, q.racine, q.sens] };
  }
  it.quoi.push(it.jeu);
  s.it = it; s.etat = 'attend'; s.premier = null; s.faux = new Set(); s.bon = null; s.ecoutes = 0; s.attend = false; s.erreurs = 0;
  renderReco(); jouerReco();
  if (s.mains) relancer(s);
}
// Le son a pu être fermé pendant que la page était cachée : il se rouvre au premier son demandé.
async function sonPret() {
  const s = S;
  if (AU && AU.ctx.state !== 'closed') return true;
  try { await ouvrirSon(false); s.banc = await chargerPiano(AU.ctx); } catch (e) { return false; }
  return S === s;
}
async function jouerNotes(notes, jeu) {
  if (!(await sonPret())) return;
  const n = notes.length, mel = jeu === 'mel', gamme = S.exo === 'rGammes';
  // écart entre deux départs de notes : réglable pour les intervalles ; chaque note sonne jusqu'à la suivante au moins
  const pas = gamme ? 0.38 : S.exo === 'rIntervalles' ? (S.r.ecart || 600) / 1000 : 0.6, dur = gamme ? 0.7 : Math.min(2.5, Math.max(1.1, pas + 0.5));
  couper(AU.ctx);
  notes.forEach((m, i) => jouer(AU.ctx, S.banc, m, mel ? dur : 1.8, mel ? 0.9 : 0.9 / Math.sqrt(n), mel ? i * pas : 0));
  const total = (mel ? (n - 1) * pas + dur : 1.8) * 1000;
  if (S.mains) bloquer(total);
  return total;
}
const jouerReco = (jeu) => jouerNotes(S.it.notes, jeu || S.it.jeu);
// Une réponse barrée, jouée sur la même fondamentale, dans le même sens et de la même façon que la question.
function ecouterReponse(val) {
  const it = S.it;
  let notes;
  if (S.exo === 'rIntervalles') notes = [it.ref, it.ref + it.sens * +val];
  else if (S.exo === 'rAccords') notes = ACCORDS.find((a) => a.id === val).tons.map((t) => 48 + it.racine + t);
  else { const h = [...GAMMES.find((g) => g.id === val).tons, 12].map((t) => 48 + it.racine + t); notes = it.sens > 0 ? h : h.reverse(); }
  jouerNotes(notes, it.jeu);
}
function renderReco() {
  if (!S || S.kind !== 'reco' || !S.it) return;
  const r = S.r, it = S.it, liste = S.exo === 'rIntervalles' ? r.iv.map((st) => [st, INTERVALLES[st].court])
    : S.exo === 'rAccords' ? ACCORDS.filter((a) => r.types.includes(a.id)).map((a) => [a.id, chiffrage(it.racine, a.id, racineNom(it.racine, it.id))])   // une seule écriture de la fondamentale : celle de l'accord joué
      : GAMMES.filter((g) => r.types.includes(g.id)).map((g) => [g.id, gammeCourt(g.id)]);
  const b = (e, icone, label, cls = '') => `<button type="button" class="icone ${cls}" data-e="${e}" aria-label="${label}">${icone}</button>`;
  const apres = S.attend ? (it.jeu === 'harm' ? b('suite', ICONE.suite(28), 'Les notes l\'une après l\'autre') : '') + b('suivant', ICONE.suivant(28), 'Question suivante') : '';
  $('systems').style.gap = '0px';
  $('systems').innerHTML = b('rejouer', ICONE.ecouter(48), 'Réécouter', 'grand') + choixHTML(liste) + `<div id="apres">${apres}</div>`;
}

async function startEnreg(vocab = 'noms') {
  const au = await ouvrirSon(), at = new Date().toISOString();
  const s = { kind: 'enreg', exo: vocab === 'noms' ? 'noms' : vocab, vocab, input: 'voix', phase: 'intro', pcm: [], pcmN: 0, journal: [], liste: [], i: -1, level: 0, rate: au.ctx.sampleRate,
    over: false, pause: false, at, id: nouvelId(at) };
  S = s;
  au.sink = (y) => {
    if (s.over) return;
    let e = 0;
    for (let i = 0; i < y.length; i++) e += y[i] * y[i];
    s.level = Math.sqrt(e / Math.max(1, y.length));
    if (s.phase === 'dire') { garder(s, y); if (s.pas && s.pcmN >= s.prochain) s.pas(); }
  };
  $('systems').className = 'dire';
}
function serie() {
  const s = S;
  // chaque nom SERIE fois, dans le désordre, jamais deux fois de suite
  let liste;
  do {
    liste = [];
    for (let k = 0; k < SERIE; k++) liste.push(...VOCABS[s.vocab].mots);
    for (let i = liste.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [liste[i], liste[j]] = [liste[j], liste[i]]; }
  } while (liste.some((q, i) => i && q === liste[i - 1]));
  Object.assign(s, { phase: 'dire', liste, i: -1, pcm: [], pcmN: 0, journal: [], bilan: null, fichier: null, at: new Date().toISOString() });
  renderEnreg();
  const pas = () => {
    if (S !== s || s.over || s.phase !== 'dire') return;
    s.i += 1;
    if (s.i >= s.liste.length) {
      // la série est apprise tout de suite ; le fichier reste partageable
      s.phase = 'fin'; s.fichier = diagFile();
      renderEnreg();
      enroler(s.pcm.map((q) => Float32Array.from(q, (v) => v / 32768)), s.journal, +params.get('periode') || PROMPT_MS, s.at, s.vocab)
        .then((r) => { s.bilan = r; }, (e) => { s.bilan = { ok: false, msg: 'Apprentissage impossible : ' + e.message }; })
        .then(() => { if (S === s) renderEnreg(); });
      return;
    }
    s.journal.push([Math.round(s.pcmN / 16), s.liste[s.i]]);
    renderEnreg();
    s.prochain = s.pcmN + 16 * (+params.get('periode') || PROMPT_MS);
  };
  s.pas = pas; s.prochain = 16 * 900;
}
function renderEnreg() {
  const s = S, V = VOCABS[s.vocab], n = V.mots.length * SERIE, sec = Math.round(n * PROMPT_MS / 1000);
  let h;
  if (s.phase === 'intro') {
    h = `<p class="consigne">Pour reconnaître ${V.titre}, l'app apprend ta voix sur cet appareil. Une série : ${n} mots à lire à voix haute, un toutes les deux secondes et demie (${Math.floor(sec / 60)} min ${sec % 60} s).</p>`
      + '<button type="button" class="primary" data-e="go">Enregistrer une série</button><button type="button" class="lien" data-e="imp">Importer un enregistrement</button>';
  } else if (s.phase === 'dire') {
    h = `<p class="mot">${s.i < 0 ? '' : maj(s.liste[s.i])}</p><p class="compte">${Math.max(0, s.i + 1)} / ${n}</p>`;
  } else {
    const q = s.bilan || { msg: 'Apprentissage en cours…' };
    h = q.ok ? `<p class="consigne">${q.n} mots appris. Vérification : ${q.juste} reconnus sur ${q.sur}.</p><button type="button" class="primary" data-e="exo">Commencer</button>`
      : `<p class="consigne">${q.msg || `Série inexploitable : ${q.n} mots trouvés sur ${q.total}. Recommence au calme.`}</p>`;
    h += '<button type="button" class="lien" data-e="go">Une autre série</button>';
    if (s.fichier) h += '<button type="button" class="lien" data-e="part">Partager l\'enregistrement</button>';
  }
  $('systems').style.gap = ''; $('systems').innerHTML = h;
}

// ---------- mains libres ----------
// Les exercices qui n'ont pas besoin de l'écran : reconnaissance (intervalles, accords, gammes) et chant (intervalles, accords,
// gammes). L'app dit l'exercice (voix du téléphone), on répond à voix haute, un son dit juste ou faux. Commandes : « encore »
// (réécouter), « suivant », « réponse », « stop » (changer d'exercice, puis finir). Le micro ignore ce que joue ou dit l'app.
const VOC_RECO = { rIntervalles: 'noms', rAccords: 'accords', rGammes: 'gammes' };
const ML_EXOS = [['Écoute', [['rIntervalles', 'Intervalles'], ['rAccords', 'Accords'], ['rGammes', 'Gammes']]], ['Chant', [['intervalles', 'Intervalles'], ['accords', 'Accords'], ['gammes', 'Gammes']]]];
let bloques = [], parle = false;
// Fenêtre où le micro est ignoré : piano, voix de l'app, sons (plus 0,3 s d'écho).
function bloquer(ms) { const t = performance.now(); bloques = bloques.filter(([, b]) => b > t - 15000); bloques.push([t, t + ms + 300]); }
const bloque = (a, b) => parle || bloques.some(([x, y]) => x < b && y > a);
// iOS n'autorise la voix de l'app qu'après un premier énoncé lancé par un toucher : on en lance un, vide, au toucher.
function debloquerVoix() { try { if (window.speechSynthesis) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch (e) { /* voix absente */ } }
function taire() { try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* voix absente */ } parle = false; }
function dire(texte) {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance || params.has('muet')) return Promise.resolve();
  return new Promise((ok) => {
    const t0 = performance.now(), u = new SpeechSynthesisUtterance(texte);
    u.lang = 'fr-FR'; u.rate = 1.05;
    const v = speechSynthesis.getVoices().find((q) => q.lang && q.lang.startsWith('fr'));
    if (v) u.voice = v;
    let fini = false;
    const fin = () => { if (fini) return; fini = true; parle = false; bloques.push([t0, performance.now() + 300]); ok(); };
    u.onend = fin; u.onerror = fin;
    setTimeout(fin, 1500 + 90 * texte.length);              // la fin d'énoncé n'arrive pas toujours
    parle = true; speechSynthesis.cancel(); speechSynthesis.speak(u);
  });
}
// Sons : juste (deux notes qui montent), faux (deux notes graves qui descendent), note tenue (petit déclic).
function bip(type) {
  if (!AU || AU.ctx.state === 'closed') return;
  const ctx = AU.ctx, t = ctx.currentTime + 0.01;
  const notes = type === 'juste' ? [[1318.5, 0, 0.09], [1760, 0.09, 0.16]] : type === 'faux' ? [[311.1, 0, 0.14], [233.1, 0.14, 0.24]] : [[1975.5, 0, 0.05]];
  for (const [f, d, l] of notes) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type === 'faux' ? 'triangle' : 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(type === 'note' ? 0.06 : 0.16, t + d + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t + d + l);
    o.connect(g); g.connect(ctx.destination); o.start(t + d); o.stop(t + d + l + 0.02);
  }
  bloquer(450);
}
async function preparerVoix(s, ids) { s.vocs = {}; for (const id of ids) { const v = await voixApprise(id); if (v) s.vocs[id] = v; } }
// Un énoncé entendu : le nom le plus proche parmi ceux admis à cet instant (garder : vocabulaire → filtre), ou rien.
let classerML = function (s, u, garder) {
  const fin = performance.now() - 320, debut = fin - (u.t1 - u.t0) * 1000 - 150;
  if (bloque(debut, fin)) return null;
  const f = traits(u.c);
  let best = null;
  for (const id of Object.keys(garder)) {
    const v = s.vocs && s.vocs[id];
    if (!v) continue;
    const r = v.voix.classer(f, -1, garder[id]);
    if (r.cls !== -1 && r.dist <= v.seuil && r.autre >= 1.03 * r.dist && (!best || r.dist < best.dist)) best = { id, cls: r.cls, dist: r.dist };
  }
  if (DEBUG && best) $('debug').textContent = `v${VERSION} · entendu : ${best.id} ${best.cls} à ${best.dist.toFixed(2)}`;
  return best;
};
const EN_EXO = ['encore', 'suivant', 'réponse', 'stop'];
function entendre(s, u) {
  if (s !== S || s.over || s.pause || s.muet) return;
  if (s.kind === 'chant') {
    if (u.t1 - u.t0 > 1.4) return;                         // une note chantée, pas une commande
    const r = classerML(s, u, { commandes: (c) => EN_EXO.includes(c) });
    if (r) commande(s, r.cls);
    return;
  }
  if (s.kind === 'reco') {
    if (u.t1 - u.t0 > 2.5) return;
    const voc = VOC_RECO[s.exo], admis = s.exo === 'rIntervalles' ? (c) => s.r.iv.includes(c + 1) : (c) => s.r.types.includes(c);
    const r = classerML(s, u, { commandes: (c) => EN_EXO.includes(c), [voc]: admis });
    if (!r) return;
    if (r.id === 'commandes') { commande(s, r.cls); return; }
    clearTimeout(s.relance);
    repondre(voc === 'noms' ? String(r.cls + 1) : r.cls);
    return;
  }
  if (s.kind === 'menuML') entendreMenu(s, u);
}
// Sans réponse au bout de 8 s, l'exercice est rejoué une fois.
function relancer(s) {
  clearTimeout(s.relance);
  s.relance = setTimeout(() => { if (S === s && !s.over && !s.pause && s.etat !== 'ok') { s.ecoutes += 1; jouerReco(); } }, 8000);
}
const reponseDite = (s) => (s.exo === 'rIntervalles' ? INTERVALLES[s.it.st].nom : s.exo === 'rAccords' ? ACCORDS.find((a) => a.id === s.it.id).parle : GAMMES.find((g) => g.id === s.it.id).nom);
function texteChant(exo, it) {
  if (exo === 'intervalles') return `${INTERVALLES[it.st].nom} ${sensDe(it.st, it.sens)}`;
  if (exo === 'gammes') return `Gamme ${GAMMES.find((g) => g.id === it.id).nom}, ${it.sens > 0 ? 'en montant' : 'en descendant'}`;
  return `${racineParlee(racineNom(it.racine, it.id))} ${ACCORDS.find((a) => a.id === it.id).parle}`;
}
// Réponse dite en reconnaissance. Juste : son, puis la suite. Faux : son, puis l'exercice rejoué ; au deuxième faux, l'app
// dit la réponse. Trouvée après une erreur, joué ensemble : on l'entend encore note après note.
function repondreMains(s, val, juste) {
  if (s.premier === null) {
    s.premier = juste;
    s.v.push({ v: juste ? 'ok' : 'faux', rep: val, cls: +val - 1, st: s.it.st, quoi: s.it.quoi, ecoutes: s.ecoutes || 0, time: (performance.now() - s.t0) / 1000 });
  }
  if (!juste) {
    s.faux.add(String(val)); s.etat = 'faux'; s.erreurs = (s.erreurs || 0) + 1; render(); ligne(); bip('faux');
    if (s.erreurs >= 2) { setTimeout(() => { if (S === s && !s.over) donnerReponse(s); }, 400); return; }
    setTimeout(() => { if (S === s && !s.over && s.etat !== 'ok') { jouerReco(); relancer(s); } }, 450);
    return;
  }
  s.etat = 'ok'; s.bon = String(val); s.n += 1; render(); ligne(); bip('juste');
  if (s.v.length % 16 === 0) sauver(s);
  if (s.premier || s.it.jeu !== 'harm') { s.nextT = setTimeout(() => { if (S === s && !s.over) suivantReco(); }, s.premier ? 600 : 1000); return; }
  setTimeout(() => {
    if (S !== s || s.over) return;
    jouerReco('mel').then((ms) => { s.nextT = setTimeout(() => { if (S === s && !s.over) suivantReco(); }, (ms || 1500) + 500); });
  }, 450);
}
async function donnerReponse(s) {
  clearTimeout(s.relance);
  if (s.premier === null) { s.premier = false; s.v.push({ v: 'faux', rep: 'réponse', st: s.it.st, quoi: s.it.quoi, ecoutes: s.ecoutes || 0, time: (performance.now() - s.t0) / 1000 }); }
  s.etat = 'ok'; s.bon = s.exo === 'rIntervalles' ? String(s.it.st) : s.it.id; render(); ligne();
  await dire(reponseDite(s));
  if (S !== s || s.over) return;
  const ms = await jouerReco(s.it.jeu === 'harm' ? 'mel' : undefined);
  s.nextT = setTimeout(() => { if (S === s && !s.over) suivantReco(); }, (ms || 1500) + 700);
}
function commande(s, c) {
  if (c === 'stop') { finExercice(s); return; }
  if (s.kind === 'reco') {
    if (c === 'encore') { s.ecoutes += 1; jouerReco(); relancer(s); }
    else if (c === 'réponse') donnerReponse(s);
    else if (c === 'suivant') {
      if (s.premier === null) s.v.push({ v: 'faux', rep: 'suivant', st: s.it.st, quoi: s.it.quoi, ecoutes: s.ecoutes || 0, time: (performance.now() - s.t0) / 1000 });
      suivantReco();
    }
  } else if (s.kind === 'chant') {
    if (c === 'encore') { s.replays += 1; s.j = 0; s.cents = []; s.fauxJ = -1; playRef(); }
    else if (c === 'réponse') aide('arpege');
    else if (c === 'suivant') suivant();
  }
}
// « stop » dans un exercice : on revient au choix de l'exercice à la voix. Au choix, « stop » finit le mode.
function finExercice(s) { taire(); lancer(s.vocs && s.vocs.commandes ? 'menuML' : 'ml'); }

async function startMainsLibres() {
  fermerSon();
  const pret = {};
  for (const id of ['noms', 'commandes', 'accords', 'gammes']) pret[id] = !!(await voixApprise(id));
  S = { kind: 'ml', exo: 'ml', input: 'toucher', pret, over: false, pause: false };
  $('systems').className = 'dire';
}
function renderML() {
  const p = S.pret, ok = (exo) => (VOC_RECO[exo] ? p[VOC_RECO[exo]] : true);
  let h = `<div class="ml">${ICONE.ecouteurs(56)}`;
  for (const [titre, liste] of ML_EXOS) {
    h += `<p class="rubrique">${titre}</p><div class="exos">${liste.map(([exo, t]) => `<button type="button" data-ml="${exo}"${ok(exo) ? '' : ` class="manque" aria-label="${t} : voix à enregistrer"`}>${t}</button>`).join('')}</div>`;
  }
  h += `<p class="rubrique">Ma voix</p><div class="exos">${[['commandes', 'Commandes'], ['accords', 'Accords'], ['gammes', 'Gammes']].map(([v, t]) => `<button type="button" data-voc="${v}" class="${p[v] ? 'fait' : 'manque'}">${t}</button>`).join('')}</div></div>`;
  h += `<p class="consigne">${p.commandes ? 'Touche un exercice, puis tout passe par la voix. « Stop » pour changer d\'exercice.' : 'Touche un exercice, puis tout passe par la voix. Pour les commandes (« encore », « suivant », « réponse », « stop »), enregistre d\'abord ta voix.'}</p>`;
  $('systems').style.gap = '18px'; $('systems').innerHTML = h;
}
// Choix de l'exercice à la voix : « écoute » ou « chant », puis « intervalles », « accords » ou « gammes ».
async function startMenuML() {
  const au = await ouvrirSon(true);
  const s = { kind: 'menuML', exo: 'menuML', input: 'voix', mains: true, niveau: 1, famille: null, level: 0, over: false, pause: false, ecoute: new Ecoute() };
  await preparerVoix(s, ['commandes', 'accords', 'gammes']);
  s.ecoute.onEnonce = (u) => entendre(s, u);
  au.sink = (y) => { if (s.over) return; s.ecoute.push(y); s.level = s.ecoute.niveau; };
  S = s;
  $('systems').className = 'dire';
  questionMenu(s);
}
function questionMenu(s) {
  render();
  dire(s.niveau === 1 ? 'Écoute ou chant ?' : 'Intervalles, accords ou gammes ?');
  clearTimeout(s.relance);
  s.relance = setTimeout(() => { if (S === s && !s.over) questionMenu(s); }, 15000);
}
function entendreMenu(s, u) {
  if (u.t1 - u.t0 > 2) return;
  const admis = s.niveau === 1 ? ['écoute', 'chant', 'stop'] : ['intervalles', 'accords', 'gammes', 'stop'];
  const r = classerML(s, u, { commandes: (c) => admis.includes(c) });
  if (!r) return;
  if (r.cls === 'stop') { clearTimeout(s.relance); dire('Fin du mode mains libres.').then(() => { if (S === s) lancer('ml'); }); return; }
  if (s.niveau === 1) { s.famille = r.cls; s.niveau = 2; questionMenu(s); return; }
  const exo = s.famille === 'écoute' ? { intervalles: 'rIntervalles', accords: 'rAccords', gammes: 'rGammes' }[r.cls] : r.cls;
  if (VOC_RECO[exo] && !s.vocs[VOC_RECO[exo]]) { dire(`Il faut d'abord enregistrer ta voix pour les ${r.cls}.`); return; }
  clearTimeout(s.relance);
  lancer(exo, { mains: true });
}
// Tests : un mot reconnu, sans passer par le micro.
function entendreMenuTest(s, cls) { const garde = classerML; classerML = () => ({ id: 'commandes', cls, dist: 0 }); try { entendreMenu(s, { t0: 0, t1: 0.5, c: [] }); } finally { classerML = garde; } }
function renderMenuML() {
  const q = S.niveau === 1 ? 'Écoute ou chant ?' : 'Intervalles, accords ou gammes ?';
  $('systems').style.gap = '18px';
  $('systems').innerHTML = `<div class="ml">${ICONE.ecouteurs(56)}</div><p class="mot">${q}</p><p class="consigne">« Stop » pour finir.</p>`;
}

// ---------- réglages ----------
// Ouverts depuis l'exercice, qui attend : seulement les réglages de cet exercice. À la fermeture, il reprend, ou repart
// avec les nouveaux réglages s'ils ont changé. On change d'exercice depuis l'accueil.
let avant = '';
const rang = (titre, corps) => `<div class="rang">${titre ? `<span>${titre}</span>` : ''}${corps}</div>`;
const radios = (k, opts, cur) => `<div class="choice" role="radiogroup">${opts.map(([v, t]) => `<button type="button" role="radio" aria-checked="${v === cur}" data-a="set" data-k="${k}" data-v="${v}">${t}</button>`).join('')}</div>`;
const coches = (k, opts, on) => `<div class="choice">${opts.map(([v, t, l]) => `<button type="button" role="checkbox" aria-checked="${on(v)}" data-a="tog" data-k="${k}" data-v="${v}"${l ? ` aria-label="${l}"` : ''}>${t}</button>`).join('')}</div>`;
const fleches = (k, bas, haut, quoi) => `<button type="button" data-a="pas" data-k="${k}" data-v="-1" aria-label="${quoi} : plus grave"${bas ? '' : ' disabled'}>↓</button>`
  + `<button type="button" data-a="pas" data-k="${k}" data-v="1" aria-label="${quoi} : plus aiguë"${haut ? '' : ' disabled'}>↑</button>`;
function etendueHTML(clef) {
  const [lo, hi] = prefs.notes[clef];
  return `<div class="etendue">${miniPortee(clef, lo, hi, 9)}<div class="pas">${fleches(`${clef}.0`, lo > P_MIN, hi - lo > 2, 'Note la plus grave')}<i></i>${fleches(`${clef}.1`, hi - lo > 2, hi < P_MAX, 'Note la plus aiguë')}</div></div>`;
}
function reglagesHTML() {
  const e = S.exo, r = prefs[e];
  let h = '';
  if (e === 'notes') {
    h += rang('Clé', radios('notes.clef', [['sol', 'Clé de sol'], ['fa', 'Clé de fa'], ['deux', 'Les deux']], r.clef));
    h += rang('Étendue', (r.clef === 'deux' ? ['sol', 'fa'] : [r.clef]).map(etendueHTML).join(''));
    h += rang('Réponse', radios('notes.input', [['voix', 'À la voix'], ['touches', 'Au toucher'], ...(navigator.requestMIDIAccess ? [['midi', 'Clavier MIDI']] : [])], r.input));
    if (r.input === 'midi' && !midi.inputs().length) h += `<p class="consigne">${midi.refus ? 'Accès MIDI refusé par le navigateur.' : 'Aucun clavier MIDI détecté. Branche-le : la lecture reste à la voix en attendant.'}</p>`;
    if (r.input === 'voix') h += rang('Son des séances', coches('notes', [['garderSon', 'Garder pour améliorer la reconnaissance']], (v) => !!r[v]) + '<div id="sons" class="sons"></div>');
  } else if (e === 'noms') {
    h += rang('Réponse', radios('noms.reponse', [['voix', 'À la voix'], ['toucher', 'Au toucher']], r.reponse));
    h += rang('', coches('noms', [['alterations', 'Dièses et bémols']], (v) => !!r[v]));
    h += rang('Clé', radios('noms.clef', [['sol', 'Clé de sol'], ['fa', 'Clé de fa'], ['deux', 'Les deux']], r.clef));
    h += rang('Intervalles', coches('noms.iv', TOUS.map((st) => [st, INTERVALLES[st].court, INTERVALLES[st].nom]), (v) => r.iv.includes(v)));
    if (r.reponse !== 'toucher') h += '<button type="button" class="lien" data-a="serie">Enregistrer une série de plus</button>';
  } else if (e[0] === 'r') {
    const gammes = (k) => rang('Gammes', coches(`${k}.types`, GAMMES.filter((g) => !g.mode).map((g) => [g.id, gammeCourt(g.id)]), (v) => r.types.includes(v)))
      + rang('Modes', coches(`${k}.types`, GAMMES.filter((g) => g.mode).map((g) => [g.id, gammeCourt(g.id)]), (v) => r.types.includes(v)));
    if (e === 'rIntervalles') {
      h += rang('Intervalles', coches(`${e}.iv`, TOUS.map((st) => [st, INTERVALLES[st].court, INTERVALLES[st].nom]), (v) => r.iv.includes(v)));
      h += rang('Notes jouées', coches(e, [['melodique', 'L\'une après l\'autre'], ['harmonique', 'Ensemble']], (v) => !!r[v]));
      const ec = r.ecart || 600;
      h += rang('Temps entre les deux notes', `<div class="pas"><button type="button" data-a="pas" data-k="rIntervalles.ecart" data-v="-1" aria-label="Plus court"${ec > 200 ? '' : ' disabled'}>−</button><output>${(ec / 1000).toFixed(1).replace('.', ',')} s</output>`
        + `<button type="button" data-a="pas" data-k="rIntervalles.ecart" data-v="1" aria-label="Plus long"${ec < 2000 ? '' : ' disabled'}>+</button></div>`);
      h += rang('Sens', coches(e, [['montant', 'Montant'], ['descendant', 'Descendant']], (v) => !!r[v]));
    } else if (e === 'rAccords') {
      h += rang('Accords', coches(`${e}.types`, ACCORDS.map((a) => [a.id, chiffrage(0, a.id)]), (v) => r.types.includes(v)));
      h += rang('Notes jouées', coches(e, [['plaque', 'Ensemble'], ['arpege', 'L\'une après l\'autre']], (v) => !!r[v]));
    } else {
      h += gammes(e) + rang('Sens', coches(e, [['montant', 'Montant'], ['descendant', 'Descendant']], (v) => !!r[v]));
    }
  } else {
    if (e === 'accords') {
      h += rang('Accords', coches('accords.types', ACCORDS.map((a) => [a.id, chiffrage(0, a.id)]), (v) => r.types.includes(v)));
    } else if (e === 'gammes') {
      h += rang('Gammes', coches('gammes.types', GAMMES.filter((g) => !g.mode).map((g) => [g.id, gammeCourt(g.id)]), (v) => r.types.includes(v)));
      h += rang('Modes', coches('gammes.types', GAMMES.filter((g) => g.mode).map((g) => [g.id, gammeCourt(g.id)]), (v) => r.types.includes(v)));
      h += rang('Sens', coches(e, [['montant', 'Montant'], ['descendant', 'Descendant']], (v) => !!r[v]));
    } else {
      h += rang('Intervalles', coches(`${e}.iv`, TOUS.map((st) => [st, INTERVALLES[st].court, INTERVALLES[st].nom]), (v) => r.iv.includes(v)));
      h += rang('Sens', coches(e, [['montant', 'Montant'], ['descendant', 'Descendant']], (v) => !!r[v]));
      if (e === 'intervalles') h += rang('', coches(e, [['depart', 'Chanter d\'abord la note de départ']], (v) => !!r[v]));
    }
    const t = prefs.tenue;
    h += rang('Tenue de la note', `<div class="pas"><button type="button" data-a="pas" data-k="tenue" data-v="-1" aria-label="Tenue plus courte"${t > 300 ? '' : ' disabled'}>−</button><output>${(t / 1000).toFixed(1).replace('.', ',')} s</output>`
      + `<button type="button" data-a="pas" data-k="tenue" data-v="1" aria-label="Tenue plus longue"${t < 2000 ? '' : ' disabled'}>+</button></div>`);
    h += rang('', coches('courbe', [['courbe', 'Courbe de la voix']], () => prefs.courbe));
  }
  if (DEBUG && S && S.pcm && S.pcmN) h += '<button type="button" id="share" data-a="part">Partager l\'audio de la séance</button>';
  return h;
}
function ouvrirReglages() {
  if (!S || occupe) return;
  S.pause = true; clearTimeout(S.promptT);
  if (AU) { couper(AU.ctx); if (S.kind !== 'enreg') AU.mic.coupe(); }
  if (S.kind === 'enreg' && S.phase === 'dire') S.phase = 'intro';     // une série interrompue est à refaire
  if (S.kind === 'notes' && S.garde && S.pcmN) ranger(S);              // ce qui a été lu jusqu'ici est partageable tout de suite
  avant = JSON.stringify(prefs);
  $('reglages').innerHTML = reglagesHTML();
  $('sheet').hidden = false;
  majSons();
}
async function fermerReglages() {
  $('sheet').hidden = true;
  if (!S) return;
  if (JSON.stringify(prefs) !== avant) { savePrefs(); lancer(S.exo); return; }
  if (AU && !S.muet && S.input !== 'toucher' && !direct(S)) { try { await AU.mic.rouvre(); } catch (e) { quitter(); say('Micro refusé.'); return; } }
  S.pause = false;
  if (S.kind === 'notes' && S.rec) S.tStart = S.rec.time;               // ce qui a été dit pendant les réglages ne compte pas
  if (S.kind === 'chant') { if (S.phase === 'tenu') suivant(); else { S.j = 0; S.cents = []; playRef(); } }
  render();
}
function reglage(b) {
  const a = b.dataset.a, k = b.dataset.k, v = b.dataset.v;
  if (a === 'part') { shareAudio(); return; }
  if (a === 'sonsPart') { partagerSons(); return; }
  if (a === 'sonsEff') {
    if (!b.dataset.sur) { b.dataset.sur = '1'; b.textContent = 'Effacer : sûr ?'; return; }
    sonEffacer().catch(() => {}).then(majSons); return;
  }
  if (a === 'serie') { $('sheet').hidden = true; savePrefs(); lancer('enreg', { vocab: 'noms' }); return; }
  if (a === 'set') {
    const [e, c] = k.split('.'); prefs[e][c] = v;
    if (k === 'notes.input' && v === 'midi') midi.open().catch(() => { midi.refus = true; }).then(() => { if (!$('sheet').hidden) $('reglages').innerHTML = reglagesHTML(); });
  } else if (a === 'tog' && k === 'courbe') {
    prefs.courbe = !prefs.courbe;
  } else if (a === 'tog') {
    const [e, c] = k.split('.'), r = prefs[e];
    if (c) {                                                            // liste : intervalles ou accords, il en reste toujours un
      const x = c === 'iv' ? +v : v, i = r[c].indexOf(x);
      if (i < 0) r[c].push(x); else if (r[c].length > 1) r[c].splice(i, 1);
      if (c === 'iv') r[c].sort((p, q) => p - q);
    } else {
      r[v] = !r[v];
      // de chaque paire il reste toujours un choix
      for (const [x, y] of [['montant', 'descendant'], ['melodique', 'harmonique'], ['plaque', 'arpege']]) if ((v === x || v === y) && !r[x] && !r[y]) r[v === x ? y : x] = true;
    }
  } else if (a === 'pas') {
    if (k === 'tenue') prefs.tenue = Math.max(300, Math.min(2000, prefs.tenue + 100 * +v));
    else if (k === 'rIntervalles.ecart') prefs.rIntervalles.ecart = Math.max(200, Math.min(2000, (prefs.rIntervalles.ecart || 600) + 100 * +v));
    else {
      const [clef, i] = k.split('.'), e = prefs.notes[clef];
      e[+i] += +v;
      e[0] = Math.max(P_MIN, Math.min(e[0], P_MAX - 2)); e[1] = Math.min(P_MAX, Math.max(e[1], e[0] + 2));
    }
  }
  $('reglages').innerHTML = reglagesHTML();
  majSons();
}

// ---------- clavier MIDI ----------
const midi = {
  access: null, refus: false,
  inputs() { return this.access ? Array.from(this.access.inputs.values()).filter((i) => i.state !== 'disconnected') : []; },
  async open() {
    if (!navigator.requestMIDIAccess) return false;
    if (!this.access) {
      this.access = await navigator.requestMIDIAccess();
      this.access.onstatechange = () => this.bind();
    }
    this.bind();
    return this.inputs().length > 0;
  },
  bind() {
    for (const i of this.inputs()) i.onmidimessage = (e) => { const [st, note, vel] = e.data; if ((st & 0xf0) === 0x90 && vel > 0) onMidiNote(note); };
  },
};

// ---------- démarrage ----------
modelP = fetch('model.json').then((r) => { if (!r.ok) throw new Error('modèle vocal introuvable'); return r.json(); }).then(loadModel);
modelP.catch((e) => say('Chargement impossible : ' + e.message));
if (navigator.requestMIDIAccess) { if (prefs.notes.input === 'midi') midi.open().catch(() => {}); } else if (prefs.notes.input === 'midi') prefs.notes.input = 'voix';
$('liste').addEventListener('click', (e) => { const b = e.target.closest('button[data-exo]'); if (b) lancer(b.dataset.exo); });
$('clavier').addEventListener('pointerdown', (e) => {
  const k = e.target.closest('[data-t]');
  if (!k) return;
  e.preventDefault();
  k.classList.add('appuyee'); setTimeout(() => k.classList.remove('appuyee'), 120);
  onTouche(+k.dataset.t);
});
document.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || !S || S.input !== 'touches' || !$('sheet').hidden) return;
  const i = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ'].indexOf(e.code);   // rangée du milieu, quelle que soit la disposition
  if (i < 0) return;
  const k = $('clavier').querySelector(`[data-t="${i}"]`);
  k.classList.add('appuyee'); setTimeout(() => k.classList.remove('appuyee'), 120);
  onTouche(i);
});
$('mainslibres').innerHTML = ICONE.ecouteurs(36);
$('mainslibres').addEventListener('click', () => lancer('ml'));
// cinq touches rapides sur le titre : active ou coupe le mode diagnostic (son partageable, syllabes entendues)
let taps = [];
document.querySelector('h1').addEventListener('click', () => {
  const t = Date.now(); taps = taps.filter((q) => t - q < 3000); taps.push(t);
  if (taps.length >= 5) {
    taps = []; DEBUG = !DEBUG;
    try { localStorage.setItem('solfege.debug', DEBUG ? '1' : '0'); } catch (e) { /* stockage indisponible */ }
    say(DEBUG ? 'Mode diagnostic activé.' : 'Mode diagnostic coupé.');
  }
});
$('quit').addEventListener('click', quitter);
$('regler').addEventListener('click', ouvrirReglages);
$('mic').addEventListener('click', micro);
$('aides').addEventListener('click', (e) => { const b = e.target.closest('button[data-h]'); if (b) aide(b.dataset.h); });
$('fermer').addEventListener('click', fermerReglages);
$('reglages').addEventListener('click', (e) => { const b = e.target.closest('button[data-a]'); if (b && !b.disabled) reglage(b); });
$('systems').addEventListener('click', (e) => {
  if (!S || S.over || S.pause) return;
  // chant : toucher l'exercice rejoue la note de départ, et l'on reprend à la première note
  if (S.kind === 'chant' && S.phase === 'vise') { S.replays += 1; S.j = 0; S.cents = []; S.fauxJ = -1; playRef(); return; }
  if (S.kind === 'ml') {
    const m = e.target.closest('button[data-ml]'), v = e.target.closest('button[data-voc]');
    if (m) { const voc = VOC_RECO[m.dataset.ml]; if (voc && !S.pret[voc]) { lancer('enreg', { vocab: voc }); return; } debloquerVoix(); lancer(m.dataset.ml, { mains: true }); }
    else if (v) lancer('enreg', { vocab: v.dataset.voc });
    return;
  }
  const c = e.target.closest('button[data-r]');
  if (c) { repondre(c.dataset.r); return; }
  const b = e.target.closest('button[data-e]');
  if (b && S.kind === 'reco') {
    if (b.dataset.e === 'rejouer') { S.ecoutes += 1; jouerReco(); }
    else if (b.dataset.e === 'suite') jouerReco('mel');
    else if (b.dataset.e === 'suivant') suivantReco();
    return;
  }
  if (b && S.kind === 'enreg') {
    if (b.dataset.e === 'go') serie(); else if (b.dataset.e === 'imp') $('import').click(); else if (b.dataset.e === 'exo') lancer(S.vocab === 'noms' ? 'noms' : 'ml'); else shareAudio();
  }
});
$('page').addEventListener('click', () => {
  if (AU && AU.ctx.state !== 'running') AU.ctx.resume().catch(() => {});
  ligne();
});
$('import').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || !S || S.kind !== 'enreg') return;
  const mine = S;
  try { mine.bilan = await importer(await f.arrayBuffer()); } catch (err) { mine.bilan = { ok: false, msg: 'Import impossible : ' + (err && err.message ? err.message : err) }; }
  if (S !== mine) return;
  mine.phase = 'fin'; mine.fichier = null; renderEnreg();
});
window.addEventListener('resize', render);
// Page masquée : le micro est rendu. Une série enregistrée et pas encore partagée est gardée (le partage lui-même peut masquer la page).
document.addEventListener('visibilitychange', () => {
  if (!document.hidden || !S || direct(S)) return;
  if (S.kind === 'enreg' && S.phase === 'fin') return;
  if (S.input === 'toucher') { if (AU) { couper(AU.ctx); fermerSon(); } return; }   // l'exercice reste, le son se rouvrira au retour
  quitter();
});
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
// ?mains-libres (deuxième icône, raccourci) : on arrive sur l'écran Mains libres
if (params.has('mains-libres')) lancer('ml');
window.__solfege = { VERSION, prefs, sonListe, get session() { return S; }, entendu: (id, cls) => { const s = S; if (!s) return; if (id === 'commandes') { if (s.kind === 'menuML') entendreMenuTest(s, cls); else commande(s, cls); } else if (s.kind === 'reco') repondre(id === 'noms' ? String(cls + 1) : cls); }, get son() { return AU; }, verdicts, onMidiNote, diagFile, get gateOff() { return gateOff; } };
