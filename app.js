// Solfège : lecture de notes et chant, sans fin. Interface minimale.
import { loadModel, Recognizer, Resampler, Suivi, SYLLABES } from './engine.js';
import { Pitch } from './pitch.js';
import { INTERVALLES, ACCORDS, sensDe, chiffrage, tirerIntervalle, tirerPortee, tirerAccord, midiOf, Hold } from './chant.js';
import { chargerPiano, jouer } from './piano.js';
import { PER, P_MIN, P_MAX, CLEFS, INK, DONE, BLUE, SOFT, LINE, r2, noteInfo, metrics, systemSVG, miniPortee, porteeChant } from './portee.js';

const VERSION = '2026-11-25.8';
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
const REF_MS = 1200, REF_TAIL_MS = 200, NEXT_MS = 700, TRACE_S = 3;
const TOL = +params.get('tol') || 50;                  // bande en cents
const PROMPT_MS = 2500, SERIE = 4;                     // enregistrement : un nom toutes les 2,5 s, chaque nom quatre fois par série
const MAX_SESSIONS = 2000;                             // séances gardées sur l'appareil
const DIAG_MAX = 16000 * 300;                          // son gardé : cinq minutes au plus

// ---------- préférences ----------
const TOUS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const prefs = {
  exo: 'notes', tenue: 700,
  notes: { clef: 'sol', input: 'voix', sol: [-2, 10], fa: [-2, 10] },
  intervalles: { iv: TOUS.slice(), montant: true, descendant: true, depart: true },
  portee: { iv: TOUS.slice(), montant: true, descendant: true },
  accords: { types: ACCORDS.map((a) => a.id), notation: 'lettres' },
};
try {
  const lu = JSON.parse(localStorage.getItem('solfege.prefs') || '{}') || {};
  if (typeof lu.clef === 'string') { prefs.notes.clef = lu.clef; if (lu.input) prefs.notes.input = lu.input; }   // préférences d'avant les réglages par exercice
  for (const k of ['notes', 'intervalles', 'portee', 'accords']) if (lu[k] && typeof lu[k] === 'object') Object.assign(prefs[k], lu[k]);
  if (typeof lu.tenue === 'number') prefs.tenue = lu.tenue;
  if (['notes', 'noms', 'intervalles', 'portee', 'accords'].includes(lu.exo)) prefs.exo = lu.exo;
} catch (e) { /* préférences absentes */ }
const savePrefs = () => { try { localStorage.setItem('solfege.prefs', JSON.stringify(prefs)); } catch (e) { /* stockage indisponible */ } };
const tenue = () => +params.get('tenue') || prefs.tenue;

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
async function openMic(ctx, onSamples) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const release = () => { try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* déjà arrêté */ } };
  try {
    // la reprise peut rester en attente d'un geste : on ne l'attend pas plus d'une seconde
    if (ctx.state !== 'running') await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 1000))]);
    const src = ctx.createMediaStreamSource(stream);
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
    src.connect(node); node.connect(mute);
    const track = stream.getAudioTracks()[0];
    const st = track && track.getSettings ? track.getSettings() : {};
    const info = { nom: track ? track.label : '' };
    for (const k of ['sampleRate', 'channelCount', 'echoCancellation', 'noiseSuppression', 'autoGainControl']) info[k] = st[k] ?? null;
    return { info, stop() { release(); try { ctx.close(); } catch (e) { /* déjà fermé */ } } };
  } catch (e) { release(); throw e; }
}

// Le micro reste ouvert d'un exercice à l'autre : changer d'exercice ne redemande rien. `sink` reçoit le son à 16 kHz.
async function ouvrirSon() {
  if (AU && AU.ctx.state !== 'closed') {
    if (AU.ctx.state !== 'running') AU.ctx.resume().catch(() => {});
    return AU;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC({ latencyHint: 'interactive' });
  ctx.resume().catch(() => {});                           // dans le geste de l'utilisateur
  // iPhone : micro et haut-parleur ensemble, sans traitement de la voix
  try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) { /* réglage absent */ }
  const au = { ctx, rs: new Resampler(ctx.sampleRate), sink: null, got: false, lag: null };
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
function fermerSon() {
  if (!AU) return;
  AU.sink = null; AU.mic.stop(); AU = null;
}
// En diagnostic, le son reçu est gardé (16 bits) ; le moteur écoute exactement ces échantillons : le rejeu hors de l'app donne le même résultat.
function garder(s, y) {
  if (s.pcmN >= DIAG_MAX) return y;
  const q = Int16Array.from(y, (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32768))));
  s.pcm.push(q); s.pcmN += q.length;
  return Float32Array.from(q, (v) => v / 32768);
}

// ---------- démarrage et arrêt d'un exercice ----------
async function lancer(exo) {
  if (occupe) return;
  occupe = true; say('');
  try {
    arreter();
    prefs.exo = exo; savePrefs();
    if (exo === 'notes') await startNotes(); else if (exo === 'noms') await startEnreg(); else await startChant(exo);
    $('result').textContent = ''; delete $('result').dataset.alerte;
    $('debug').hidden = !DEBUG; $('debug').textContent = '';
    show('page'); render(); ligne(); levelLoop();
    if (navigator.wakeLock && !verrou) navigator.wakeLock.request('screen').then((l) => { verrou = l; }).catch(() => {});
    if (S && S.input !== 'midi') {
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
  s.over = true; clearTimeout(s.commitT); clearTimeout(s.nextT); clearTimeout(s.promptT);
  if (AU) AU.sink = null;
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
  const r = prefs.notes, input = TEST_MIDI || (r.input === 'midi' && midi.inputs().length) ? 'midi' : 'voix';
  const clefs = r.clef === 'deux' ? ['sol', 'fa'] : [r.clef === 'fa' ? 'fa' : 'sol'];
  const at = new Date().toISOString();
  // ?seq= impose les premières notes (tests)
  const forced = params.get('seq') ? params.get('seq').split(',').map((t, i) => {
    const cls = SYLLABES.indexOf(t.trim()), clef = clefs.length > 1 ? (i % 3 === 1 ? 'fa' : 'sol') : clefs[0];
    return noteInfo(clef, ((cls - CLEFS[clef].off) % 7 + 7) % 7);
  }) : null;
  const base = { kind: 'notes', exo: 'notes', input, mode: r.clef, clefs, et: { sol: r.sol.slice(), fa: r.fa.slice() }, notes: [], forced,
    over: false, pause: false, at, id: nouvelId(at), rec0: 0, saved: 0 };
  if (input === 'midi') {
    fermerSon();
    S = { ...base, v: [], k: 0, t0: performance.now() };
    return;
  }
  const au = await ouvrirSon(), model = await modelP;
  const rec = new Recognizer(model, params.has('tau') ? { tau: +params.get('tau') } : {});
  const bypass = !model.gate || gateOff === gateKey(model);
  const s = { ...base, rec, model, heard: [], raw: [], bypass, pcm: [], pcmN: 0, level: 0, rate: au.ctx.sampleRate, tStart: 0, draw: DEBUG ? [] : null };
  s.suivi = new Suivi((i) => noteAt(s, i).cls);
  // sans filtre : les détections du modèle des syllabes seul et leur propre suivi, pour surveiller le filtre
  s.shadow = bypass ? null : new Suivi((i) => noteAt(s, i).cls);
  rec.onLevel = (rms) => { s.level = rms; };
  rec.onCandidate = (c) => { if (!s.bypass) onCandidate(s, c); };
  rec.onRaw = (c) => onRaw(s, c);
  au.lag = DEBUG ? [] : null;
  S = s;
  au.sink = (y) => { if (!s.over) rec.push(DEBUG ? garder(s, y) : y); };
}

const lus = (s) => (s.input === 'midi' ? s.k : s.suivi.best());
const verdictsDe = (s, a, b) => (s.input === 'midi' ? Array.from({ length: b - a }, (_, i) => s.v[a + i] ?? null) : s.suivi.verdicts(a, b));
function verdicts() { return S && S.kind === 'notes' ? verdictsDe(S, 0, lus(S)) : []; }

// Taille des portées : la plus grande qui laisse tenir tous les systèmes dans la hauteur de l'écran.
function layout() {
  const nSys = S.clefs.length > 1 ? N_SYS_PIANO : N_SYS;
  const cs = getComputedStyle($('page'));
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight), padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const W = Math.floor(Math.min(window.innerWidth - padX, 760));
  const avail = window.innerHeight - padY - 44 - 52 - (DEBUG ? 60 : 0);
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
    t = `${S.n} ${S.exo === 'accords' ? 'accord' : 'intervalle'}${S.n > 1 ? 's' : ''}`;
  }
  $('result').textContent = t;
}

function onCandidate(sess, c) {
  if (sess !== S || S.over || S.pause || c.time < S.tStart) return;
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
    if (S !== mine || S.over || S.pause) return;
    if (S.suivi.commitPending(RED_CONF)) { render(); ligne(); }
  }, COMMIT_MS);
}

// Détection du modèle des syllabes seul, avant le filtre.
function onRaw(sess, c) {
  if (sess !== S || S.over || S.pause || c.time < S.tStart) return;
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

function onMidiNote(note) {
  if (!S || S.over || S.pause || S.kind !== 'notes' || S.input !== 'midi') return;
  const n = noteAt(S, S.k);
  S.v[S.k] = { v: note === n.midi ? 'ok' : 'faux', midi: note, time: (performance.now() - S.t0) / 1000 };
  S.k += 1;
  render(); ligne(); jalon(S);
}

function levelLoop() {
  const mine = S;
  const tick = () => {
    if (S !== mine || !mine || mine.over) return;
    if (mine.input === 'midi') { $('mic').style.opacity = '0'; return; }
    const l = Math.min(1, (mine.level || 0) * 14);
    $('mic').style.opacity = String(0.15 + 0.85 * l);
    $('mic').style.transform = `scale(${0.6 + 0.6 * l})`;
    requestAnimationFrame(tick);
  };
  tick();
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
  } else if (s.kind === 'chant' && s.results.length) {
    // Un exercice chanté = [ce qui était demandé, temps pour le chanter (ms), écart médian de chaque note (cents), réécoutes]
    saveSession({ id: s.id, fmt: 2, app: VERSION, at: s.at, mode: s.exo, input: 'chant', n: s.results.length, ok: s.results.length,
      tol: TOL, tenue: s.hold.holdMs, items: s.results.slice(-500).map((r) => [r.quoi, r.ms, r.cents, r.replays]) });
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
function diagFile() {
  if (!S || !S.pcm) return null;
  const commun = { app: VERSION, exercice: S.exo, at: S.at, ua: navigator.userAgent,
    installee: (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true,
    rate: S.rate, micro: AU ? AU.mic.info : null, tronque: S.pcmN >= DIAG_MAX, livraison: stats(AU && AU.lag) };
  let meta;
  if (S.kind === 'enreg') {
    // par nom affiché : instant d'affichage (ms depuis le début du son), nom
    meta = { ...commun, periode: PROMPT_MS, phrases: S.journal };
  } else if (S.kind === 'chant') {
    meta = { ...commun, tol: TOL, tenue: S.hold.holdMs, reglages: S.r,
      // par exercice chanté : ce qui était demandé, temps (ms), écart médian de chaque note (cents), réécoutes
      resultats: S.results.map((r) => [r.quoi, r.ms, r.cents, r.replays]) };
  } else {
    const n = Math.min(S.notes.length, S.suivi.best() + 48);
    meta = { ...commun, modele: { version: S.model.version, trained: S.model.trained },
      ecran: [window.innerWidth, window.innerHeight, window.devicePixelRatio], tStart: S.tStart, mode: S.mode,
      attendu: S.notes.slice(0, n).map((q) => SYLLABES[q.cls]), clefs: S.notes.slice(0, n).map((q) => (q.clef === 'fa' ? 1 : 0)),
      // par syllabe entendue : instant (ms), syllabe, confiance, son écoulé avant la reconnaissance (ms), 1 si reconnue sans attendre le sommet
      entendu: S.heard.map((c) => [Math.round(c.time * 1000), SYLLABES[c.cls], Math.round(c.conf * 100) / 100, Math.round(c.delay * 1000), c.early ? 1 : 0]),
      dessin: stats(S.draw),
      // filtre « syllabe dite ou autre son » : son seuil, s'il a été coupé, et les détections du modèle seul (pour voir ce qu'il a écarté)
      filtre: S.model.gate ? { tau: S.rec.tau, coupe: S.bypass, cle: gateKey(S.model) } : null,
      brut: (S.bypass ? [] : S.raw).map((c) => [Math.round(c.time * 1000), SYLLABES[c.cls], Math.round(c.conf * 100) / 100]),
      verdicts: verdicts().map((q) => (q ? q.v : null)) };
  }
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const n = S.pcm.reduce((a, c) => a + c.length, 0), pad = json.length % 2;
  const buf = new ArrayBuffer(44 + 2 * n + 8 + json.length + pad), b = new DataView(buf);
  const w = (o, t) => { for (let i = 0; i < t.length; i++) b.setUint8(o + i, t.charCodeAt(i)); };
  w(0, 'RIFF'); b.setUint32(4, buf.byteLength - 8, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 16000, true); b.setUint32(28, 32000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, 2 * n, true);
  let o = 44;
  for (const c of S.pcm) for (let i = 0; i < c.length; i++) { b.setInt16(o, c[i], true); o += 2; }
  w(o, 'sLFG'); b.setUint32(o + 4, json.length, true); new Uint8Array(buf, o + 8, json.length).set(json);
  return new File([buf], `solfege-${S.exo}-${S.at.replace(/[:.]/g, '-')}.wav`, { type: 'audio/wav' });
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
async function startChant(exo) {
  const au = await ouvrirSon(), banc = await chargerPiano(au.ctx);
  const at = new Date().toISOString(), pitch = new Pitch({ win: 1024 });
  const s = { kind: 'chant', exo, input: 'chant', r: JSON.parse(JSON.stringify(prefs[exo])), banc, pitch, hold: new Hold({ tol: TOL, holdMs: tenue() }),
    forced: params.get(IMPOSE[exo]) ? params.get(IMPOSE[exo]).split(',') : null, it: null, j: 0, n: 0, track: [], results: [], replays: 0, phase: 'ecoute', part: 0,
    level: 0, rate: au.ctx.sampleRate, pcm: [], pcmN: 0, over: false, pause: false, at, id: nouvelId(at) };
  pitch.onPitch = (q) => onPitch(s, q);
  au.lag = DEBUG ? [] : null;
  S = s;
  au.sink = (y) => { if (!s.over) pitch.push(DEBUG ? garder(s, y) : y); };
  $('systems').className = 'chant';
  suivant(); chantLoop();
}

// Tire l'exercice suivant. Pour les tests, l'adresse impose les premiers : ?iv=départ:cible (numéros MIDI) pour un intervalle,
// ?pt=position:position:altération pour la portée, ?ac=type@fondamentale pour un accord.
const IMPOSE = { intervalles: 'iv', portee: 'pt', accords: 'ac' };
function suivant() {
  const s = S, f = s.forced && s.forced.length ? s.forced.shift() : null;
  let it;
  if (s.exo === 'intervalles') {
    let q = tirerIntervalle(s.r, Math.random, s.it);
    if (f) { const [a, b] = f.split(':').map(Number); q = { st: Math.abs(b - a), sens: Math.sign(b - a), ref: a, cible: b }; }
    it = { ...q, cibles: s.r.depart ? [q.ref, q.cible] : [q.cible], titre: maj(INTERVALLES[q.st].nom), sous: sensDe(q.st, q.sens), quoi: [q.ref, q.cible] };
  } else if (s.exo === 'portee') {
    let q = tirerPortee(s.r, Math.random, s.it);
    if (f) { const [a, b, alt] = f.split(':').map(Number), m1 = midiOf(a), m2 = midiOf(b) + (alt || 0); q = { st: Math.abs(m2 - m1), sens: Math.sign(m2 - m1), notes: [{ p: a, alt: 0, midi: m1 }, { p: b, alt: alt || 0, midi: m2 }] }; }
    it = { ...q, ref: q.notes[0].midi, cibles: q.notes.map((n) => n.midi), quoi: q.notes.map((n) => [n.p, n.alt]) };
  } else {
    let q = tirerAccord(s.r, Math.random, s.it);
    if (f) { const [id, rac] = f.split('@'), a = ACCORDS.find((x) => x.id === id); q = { id, racine: +rac, ref: 48 + +rac, tons: a.tons.map((t) => 48 + +rac + t) }; }
    it = { ...q, cibles: q.tons, titre: chiffrage(q.racine, q.id, s.r.notation), quoi: [q.id, q.racine] };
  }
  s.it = it; s.j = 0; s.replays = 0; s.tVise = undefined; s.cents = [];
  playRef();
}
function playRef() {
  const s = S;
  jouer(AU.ctx, s.banc, s.it.ref, REF_MS / 1000);
  s.phase = 'ecoute'; s.listenFrom = performance.now() + 30 + REF_MS + REF_TAIL_MS;
  s.hold.reset(); s.track = []; s.part = 0;
  renderChant();
}

// Une mesure de hauteur toutes les 10 ms.
function onPitch(sess, q) {
  if (sess !== S || S.over) return;
  S.level = q.rms;
  if (S.pause) return;
  const now = performance.now();
  if (S.phase === 'ecoute') {
    if (now < S.listenFrom) return;                      // la référence sonne : on n'écoute pas la voix
    S.phase = 'vise'; S.hold.reset();
    if (S.tVise === undefined) S.tVise = now;
    renderChant();
  }
  if (S.phase !== 'vise') return;
  const r = S.hold.push(q, S.it.cibles[S.j]);
  S.part = r.part;
  S.track.push({ t: q.time, c: r.voiced ? r.cents : null });
  if (S.track.length > 100 * (TRACE_S + 1)) S.track.splice(0, 100);
  if (DEBUG) $('debug').textContent = `v${VERSION} · ${S.rate} Hz · ${q.f0 ? q.f0.toFixed(1) + ' Hz' : 'pas de note'} · netteté ${q.clarity.toFixed(2)} · écart ${r.cents === null ? '?' : Math.round(r.cents) + ' cents'} · bande ±${TOL}, tenue ${S.hold.holdMs} ms`;
  if (!r.done) return;
  S.cents.push(Math.round(r.median) || 0);
  S.j += 1; S.hold.reset(); S.track = []; S.part = 0;
  if (S.j < S.it.cibles.length) { renderChant(); return; }
  S.n += 1;
  S.results.push({ quoi: S.it.quoi, ms: Math.round(now - S.tVise), cents: S.cents, replays: S.replays });
  S.phase = 'tenu'; renderChant(); ligne();
  if (S.n % 8 === 0) sauver(S);
  S.nextT = setTimeout(() => { if (S === sess && !S.over && !S.pause) suivant(); }, NEXT_MS);
}

// En haut : le nom de l'intervalle, le chiffrage de l'accord, ou la portée avec ses notes. Dessous, la courbe de la voix :
// la ligne du milieu est la note à chanter, la bande bleue ce qu'il faut tenir (±TOL cents), les traits fins marquent les demi-tons.
const SPAN = 350;                                          // la courbe montre ±350 cents autour de la cible
function chantLayout() {
  const cs = getComputedStyle($('page'));
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const W = Math.floor(Math.min(window.innerWidth - padX, 760)), s = Math.min(Math.floor(W / 22 * 2) / 2, 20);
  const yb = Math.round(7.4 * s), y0 = Math.round(11.8 * s), hc = Math.round(9 * s);
  return { W, s, yb, y0, hc, H: y0 + hc + 4, xa: 0.4 * s, xb: W - 0.8 * s };
}
function renderChant() {
  if (!S || S.kind !== 'chant' || !S.it) return;
  const { W, s, yb, y0, hc, H, xa, xb } = chantLayout(), it = S.it, n = it.cibles.length;
  const yc = (c) => y0 + hc / 2 - c * (hc / 2) / SPAN, serif = getComputedStyle(document.body).fontFamily.replace(/"/g, "'");
  const vise = S.phase === 'vise';
  let o = '', label;
  if (S.exo === 'portee') {
    // la première note est bleue pendant qu'elle sonne ; une note tenue s'efface en gris ; le repère montre la note à chanter
    const etats = it.notes.map((q, i) => (i < S.j ? DONE : S.phase === 'ecoute' && i === 0 ? BLUE : INK));
    o += porteeChant(it.notes, etats, vise ? S.j : -1, W, s, yb);
    label = `Deux notes à chanter : ${INTERVALLES[it.st].nom} ${sensDe(it.st, it.sens)}.`;
  } else {
    const accord = S.exo === 'accords';
    o += `<text id="titre" x="${r2(W / 2)}" y="${r2((accord ? 6.6 : 5.4) * s)}" text-anchor="middle" font-family="${serif}" font-size="${r2((accord ? 4.2 : Math.min(2.4, W / s / 9.5)) * s)}" ${accord ? '' : 'font-style="italic"'} fill="${INK}">${it.titre}</text>`;
    if (it.sous) o += `<text id="sous" x="${r2(W / 2)}" y="${r2(7.5 * s)}" text-anchor="middle" font-family="${serif}" font-size="${r2(1.2 * s)}" font-style="italic" fill="${SOFT}">${it.sous}</text>`;
    // une pastille par note à chanter : grise une fois tenue, bleue pour la note en cours
    if (n > 1) for (let i = 0; i < n; i++) {
      const x = W / 2 + (i - (n - 1) / 2) * 1.7 * s, fait = i < S.j, cur = vise && i === S.j;
      o += `<circle data-c="${i}" cx="${r2(x)}" cy="${r2(9.7 * s)}" r="${r2(0.3 * s)}" fill="${fait ? DONE : cur ? BLUE : 'none'}" stroke="${fait ? 'none' : cur ? BLUE : LINE}" stroke-width="1.2"/>`;
    }
    label = accord ? `Accord ${it.titre} : ${n} notes à chanter de bas en haut.` : `${it.titre} ${it.sous}.`;
  }
  o += `<rect id="bande" x="${r2(xa)}" y="${r2(yc(TOL))}" width="${r2(xb - xa)}" height="${r2(yc(-TOL) - yc(TOL))}" fill="${BLUE}" opacity="0.16"/>`;
  for (const c of [-300, -200, -100, 100, 200, 300]) o += `<line x1="${r2(xa)}" y1="${r2(yc(c))}" x2="${r2(xb)}" y2="${r2(yc(c))}" stroke="${LINE}" stroke-width="0.6" opacity="0.35"/>`;
  o += `<line x1="${r2(xa)}" y1="${r2(yc(0))}" x2="${r2(xb)}" y2="${r2(yc(0))}" stroke="${BLUE}" stroke-width="1" opacity="0.6"/>`;
  o += `<path id="trace" d="" fill="none" stroke="${BLUE}" stroke-width="${r2(Math.max(2.2, s / 6))}" stroke-linecap="round" stroke-linejoin="round"/>`;
  o += `<circle id="voix" cx="${r2(xb)}" cy="-99" r="${r2(s * 0.36)}" fill="${BLUE}"/>`;
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
    dot.setAttribute('cy', S.track[S.track.length - 1].c === null || last === null ? -99 : r2(last));
  } else if (tr) { tr.setAttribute('d', ''); dot.setAttribute('cy', -99); }
  const mine = S;
  requestAnimationFrame(() => { if (S === mine) chantLoop(); });
}

// ---------- lecture d'intervalles : enregistrement des noms ----------
// La reconnaissance des noms d'intervalles n'existe pas encore : elle s'apprend sur la voix de l'utilisateur. Cet écran
// affiche les noms un par un et garde le son ; le fichier partagé porte l'instant d'affichage de chaque nom.
const NOMS = INTERVALLES.slice(1).map((q) => q.nom);
async function startEnreg() {
  const au = await ouvrirSon(), at = new Date().toISOString();
  const s = { kind: 'enreg', exo: 'noms', input: 'voix', phase: 'intro', pcm: [], pcmN: 0, journal: [], liste: [], i: -1, level: 0, rate: au.ctx.sampleRate,
    over: false, pause: false, at, id: nouvelId(at) };
  S = s;
  au.sink = (y) => {
    if (s.over) return;
    let e = 0;
    for (let i = 0; i < y.length; i++) e += y[i] * y[i];
    s.level = Math.sqrt(e / Math.max(1, y.length));
    if (s.phase === 'dire') garder(s, y);
  };
  $('systems').className = 'dire';
}
function serie() {
  const s = S;
  // chaque nom SERIE fois, dans le désordre, jamais deux fois de suite
  let liste;
  do {
    liste = [];
    for (let k = 0; k < SERIE; k++) liste.push(...NOMS);
    for (let i = liste.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [liste[i], liste[j]] = [liste[j], liste[i]]; }
  } while (liste.some((q, i) => i && q === liste[i - 1]));
  Object.assign(s, { phase: 'dire', liste, i: -1, pcm: [], pcmN: 0, journal: [], at: new Date().toISOString() });
  renderEnreg();
  const pas = () => {
    if (S !== s || s.over || s.phase !== 'dire') return;
    s.i += 1;
    if (s.i >= s.liste.length) { s.phase = 'fin'; s.fichier = diagFile(); renderEnreg(); return; }   // le fichier est fait tout de suite : il reste partageable
    s.journal.push([Math.round(s.pcmN / 16), s.liste[s.i]]);
    renderEnreg();
    s.promptT = setTimeout(pas, +params.get('periode') || PROMPT_MS);
  };
  s.promptT = setTimeout(pas, 900);
}
function renderEnreg() {
  const s = S, n = NOMS.length * SERIE, sec = Math.round(n * PROMPT_MS / 1000);
  let h;
  if (s.phase === 'intro') {
    h = `<p class="consigne">Pour reconnaître les noms d'intervalles, l'app doit d'abord apprendre ta voix. Une série : ${n} noms à lire à voix haute, un toutes les deux secondes et demie (${Math.floor(sec / 60)} min ${sec % 60} s).</p>`
      + '<button type="button" class="primary" data-e="go">Enregistrer une série</button>';
  } else if (s.phase === 'dire') {
    h = `<p class="mot">${s.i < 0 ? '' : maj(s.liste[s.i])}</p><p class="compte">${Math.max(0, s.i + 1)} / ${n}</p>`;
  } else {
    h = '<p class="consigne">Série enregistrée.</p><button type="button" class="primary" data-e="part">Partager l\'enregistrement</button>'
      + '<button type="button" class="lien" data-e="go">Une autre série</button>';
  }
  $('systems').style.gap = ''; $('systems').innerHTML = h;
}

// ---------- réglages ----------
// Ouverts depuis l'exercice, qui attend. On y change d'exercice et tous ses paramètres ; à la fermeture, l'exercice
// reprend, ou repart avec les nouveaux réglages s'ils ont changé.
const EXOS = [['Lecture', [['notes', 'Notes'], ['noms', 'Intervalles']]], ['Chant', [['intervalles', 'Intervalles'], ['portee', 'Portée'], ['accords', 'Accords']]]];
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
  const e = prefs.exo, r = prefs[e];
  let h = EXOS.map(([titre, liste]) => rang(titre, radios('exo', liste, e))).join('');
  if (e === 'notes') {
    h += rang('Clé', radios('notes.clef', [['sol', 'Clé de sol'], ['fa', 'Clé de fa'], ['deux', 'Les deux']], r.clef));
    h += rang('Étendue', (r.clef === 'deux' ? ['sol', 'fa'] : [r.clef]).map(etendueHTML).join(''));
    if (navigator.requestMIDIAccess) {
      h += rang('Réponse', radios('notes.input', [['voix', 'À la voix'], ['midi', 'Au clavier']], r.input));
      if (r.input === 'midi' && !midi.inputs().length) h += `<p class="consigne">${midi.refus ? 'Accès MIDI refusé par le navigateur.' : 'Aucun clavier MIDI détecté. Branche-le : la lecture reste à la voix en attendant.'}</p>`;
    }
  } else if (e === 'noms') {
    h += '<p class="consigne">Cet exercice attend un enregistrement de ta voix.</p>';
  } else {
    if (e === 'accords') {
      h += rang('Accords', coches('accords.types', ACCORDS.map((a) => [a.id, chiffrage(0, a.id, r.notation)]), (v) => r.types.includes(v)));
      h += rang('Écriture', radios('accords.notation', [['lettres', 'Cm7 · Cmaj7'], ['signes', 'C–7 · C∆7']], r.notation));
    } else {
      h += rang('Intervalles', coches(`${e}.iv`, TOUS.map((st) => [st, INTERVALLES[st].court, INTERVALLES[st].nom]), (v) => r.iv.includes(v)));
      h += rang('Sens', coches(e, [['montant', 'Montant'], ['descendant', 'Descendant']], (v) => !!r[v]));
      if (e === 'intervalles') h += rang('', coches(e, [['depart', 'Chanter d\'abord la note de départ']], (v) => !!r[v]));
    }
    const t = prefs.tenue;
    h += rang('Tenue de la note', `<div class="pas"><button type="button" data-a="pas" data-k="tenue" data-v="-1" aria-label="Tenue plus courte"${t > 300 ? '' : ' disabled'}>−</button><output>${(t / 1000).toFixed(1).replace('.', ',')} s</output>`
      + `<button type="button" data-a="pas" data-k="tenue" data-v="1" aria-label="Tenue plus longue"${t < 2000 ? '' : ' disabled'}>+</button></div>`);
  }
  if (DEBUG && S && S.pcm && S.pcmN) h += '<button type="button" id="share" data-a="part">Partager l\'audio de la séance</button>';
  return h;
}
function ouvrirReglages() {
  if (!S || occupe) return;
  S.pause = true; clearTimeout(S.promptT);
  if (S.kind === 'enreg' && S.phase === 'dire') S.phase = 'intro';     // une série interrompue est à refaire
  avant = JSON.stringify(prefs);
  $('reglages').innerHTML = reglagesHTML();
  $('sheet').hidden = false;
}
function fermerReglages() {
  $('sheet').hidden = true;
  if (!S) return;
  if (JSON.stringify(prefs) !== avant) { savePrefs(); lancer(prefs.exo); return; }
  S.pause = false;
  if (S.kind === 'notes' && S.rec) S.tStart = S.rec.time;               // ce qui a été dit pendant les réglages ne compte pas
  if (S.kind === 'chant') { if (S.phase === 'tenu') suivant(); else playRef(); }
  render();
}
function reglage(b) {
  const a = b.dataset.a, k = b.dataset.k, v = b.dataset.v;
  if (a === 'part') { shareAudio(); return; }
  if (a === 'set') {
    if (k === 'exo') prefs.exo = v;
    else { const [e, c] = k.split('.'); prefs[e][c] = v; }
    if (k === 'notes.input' && v === 'midi') midi.open().catch(() => { midi.refus = true; }).then(() => { if (!$('sheet').hidden) $('reglages').innerHTML = reglagesHTML(); });
  } else if (a === 'tog') {
    const [e, c] = k.split('.'), r = prefs[e];
    if (c) {                                                            // liste : intervalles ou accords, il en reste toujours un
      const x = c === 'iv' ? +v : v, i = r[c].indexOf(x);
      if (i < 0) r[c].push(x); else if (r[c].length > 1) r[c].splice(i, 1);
      if (c === 'iv') r[c].sort((p, q) => p - q);
    } else {
      r[v] = !r[v];
      if (!r.montant && !r.descendant) r[v === 'montant' ? 'descendant' : 'montant'] = true;   // il reste toujours un sens
    }
  } else if (a === 'pas') {
    if (k === 'tenue') prefs.tenue = Math.max(300, Math.min(2000, prefs.tenue + 100 * +v));
    else {
      const [clef, i] = k.split('.'), e = prefs.notes[clef];
      e[+i] += +v;
      e[0] = Math.max(P_MIN, Math.min(e[0], P_MAX - 2)); e[1] = Math.min(P_MAX, Math.max(e[1], e[0] + 2));
    }
  }
  $('reglages').innerHTML = reglagesHTML();
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
if (navigator.requestMIDIAccess) { if (prefs.notes.input === 'midi') midi.open().catch(() => {}); } else prefs.notes.input = 'voix';
$('liste').addEventListener('click', (e) => { const b = e.target.closest('button[data-exo]'); if (b) lancer(b.dataset.exo); });
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
$('fermer').addEventListener('click', fermerReglages);
$('reglages').addEventListener('click', (e) => { const b = e.target.closest('button[data-a]'); if (b && !b.disabled) reglage(b); });
$('systems').addEventListener('click', (e) => {
  if (!S || S.over || S.pause) return;
  // chant : toucher l'exercice rejoue la note de départ
  if (S.kind === 'chant' && S.phase === 'vise') { S.replays += 1; playRef(); return; }
  const b = e.target.closest('button[data-e]');
  if (b && S.kind === 'enreg') { if (b.dataset.e === 'go') serie(); else shareAudio(); }
});
$('page').addEventListener('click', () => {
  if (AU && AU.ctx.state !== 'running') AU.ctx.resume().catch(() => {});
  ligne();
});
window.addEventListener('resize', render);
// Page masquée : le micro est rendu. Une série enregistrée et pas encore partagée est gardée (le partage lui-même peut masquer la page).
document.addEventListener('visibilitychange', () => {
  if (!document.hidden || !S || S.input === 'midi') return;
  if (S.kind === 'enreg' && S.phase === 'fin') return;
  quitter();
});
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
window.__solfege = { VERSION, prefs, get session() { return S; }, get son() { return AU; }, verdicts, onMidiNote, diagFile, get gateOff() { return gateOff; } };
