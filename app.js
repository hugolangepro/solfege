// Solfège : lecture de notes, réponse à la voix ou au clavier MIDI. Interface minimale.
import { loadModel, Recognizer, Resampler, Follower, SYLLABES } from './engine.js';
import { GLYPHS } from './glyphs.js';
import { Pitch } from './pitch.js';
import { buildIntervals, midiOf, nomIntervalle, Hold, NIVEAUX } from './chant.js';

const VERSION = '2026-11-25.6';
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let DEBUG = params.has('debug');
try { if (localStorage.getItem('solfege.debug') === '1') DEBUG = true; } catch (e) { /* stockage indisponible */ }
const TEST_MIDI = params.get('input') === 'midi';      // tests sans clavier branché
const N_SYS = 4, N_SYS_PIANO = 3, PER = 8, SS = 191;
const RED_CONF = 0.9;                                  // une syllabe au moins aussi nette colore la note en rouge sans attendre la suivante
const END_MS = 500, COMMIT_MS = 2500, COMMIT_LAST_MS = 1200;
// chant : nombre d'intervalles, durée de la note de référence, silence gardé après elle, pause avant l'intervalle suivant, courbe affichée
const CHANT_N = 10, REF_MS = 1000, REF_TAIL_MS = 250, NEXT_MS = 700, TRACE_S = 3;
const TOL = +params.get('tol') || 50, TENUE = +params.get('tenue') || 300;     // bande en cents, tenue en ms
const MAX_SESSIONS = 2000;                             // pages gardées sur l'appareil
const DIAG_MAX = 16000 * 300;                          // diagnostic : cinq minutes de son au plus
const INK = '#1C1A17', DONE = 'rgba(28,26,23,0.36)', RED = '#B3261E', BLUE = '#1F4E8C', SOFT = '#6B6457', LINE = 'rgba(28,26,23,0.72)';
const CLEFS = { sol: { glyph: 'gclef', off: 2, base: 4, nom: 'clé de sol' }, fa: { glyph: 'fclef', off: 4, base: 2, nom: 'clé de fa' } };
const SEMIS = [0, 2, 4, 5, 7, 9, 11];

// ---------- notes ----------
// p = position sur la portée : 0 sur la ligne du bas, +1 par degré.
function noteInfo(clef, p) {
  const d = p + CLEFS[clef].off;                       // degrés au-dessus du do de référence de la clé
  const cls = ((d % 7) + 7) % 7;
  const midi = 12 * (CLEFS[clef].base + Math.floor(d / 7) + 1) + SEMIS[cls];
  return { clef, p, cls, midi };
}

// « Les deux » : un système de piano, chaque note sur la portée du haut (clé de sol) ou du bas (clé de fa).
function buildExercise(mode) {
  const n = (mode === 'deux' ? N_SYS_PIANO : N_SYS) * PER;
  const forced = params.get('seq');
  if (forced) {
    return forced.split(',').slice(0, n).map((t, i) => {
      const cls = SYLLABES.indexOf(t.trim());
      const clef = mode === 'fa' || (mode === 'deux' && i % 3 === 1) ? 'fa' : 'sol';
      return noteInfo(clef, ((cls - CLEFS[clef].off) % 7 + 7) % 7);
    });
  }
  const notes = [];
  let prev = '';
  for (let i = 0; i < n; i++) {
    let clef, p;
    do {
      clef = mode === 'deux' ? (Math.random() < 0.5 ? 'sol' : 'fa') : mode;
      p = -2 + Math.floor(Math.random() * 13);
    } while (clef + p === prev);
    prev = clef + p;
    notes.push(noteInfo(clef, p));
  }
  return notes;
}

// ---------- portée ----------
const r2 = (v) => Math.round(v * 100) / 100;

// Hauteurs d'une portée, ou d'un système de piano : la place des notes hors portée au-dessus, celle du repère en dessous.
function metrics(s, grand) {
  const a = Math.max(6, s * 0.55);                                        // demi-largeur du repère
  const padTop = Math.round(1.75 * s + 6), padBot = Math.round(1.75 * s + 1.7 * a + 10);
  const between = grand ? 5 * s : 0;                                      // de la ligne du bas de la clé de sol à la ligne du haut de la clé de fa
  return { a, padTop, between, H: padTop + 4 * s + (grand ? between + 4 * s : 0) + padBot };
}

// Accolade d'un système de piano, dans le rectangle (x, y, w, h).
function bracePath(x, y, w, h) {
  const P = (px, py) => `${r2(x + px * w)} ${r2(y + py * h)}`;
  return `M${P(1, 0)}C${P(0.2, 0.05)} ${P(0.9, 0.45)} ${P(0, 0.5)}C${P(0.9, 0.55)} ${P(0.2, 0.95)} ${P(1, 1)}`
    + `C${P(0.6, 0.92)} ${P(1.3, 0.58)} ${P(0, 0.5)}C${P(1.3, 0.42)} ${P(0.6, 0.08)} ${P(1, 0)}Z`;
}

// Un système : une portée, ou deux portées réunies par une accolade. Une note validée s'efface en gris, une note fausse
// passe en rouge, sans autre marque. Une note que le micro n'a pas entendue reste noire.
function systemSVG(notes, states, W, s, grand) {
  const { a, padTop, between, H } = metrics(s, grand), k = s / SS;
  const xs = grand ? Math.round(1.3 * s) : 0;                             // l'accolade tient dans la marge gauche
  const yb = grand ? { sol: padTop + 4 * s, fa: padTop + 8 * s + between } : { [notes[0].clef]: padTop + 4 * s };
  const yLow = grand ? yb.fa : yb[notes[0].clef];
  const x0 = xs + 5.6 * s, xr = W - 1.5 * s, dx = (xr - x0) / (PER - 1);
  const lw = Math.max(0.9, s / 12);
  let o = '';
  for (const clef of Object.keys(yb)) {
    for (let i = 0; i < 5; i++) o += `<line x1="${xs}" y1="${r2(yb[clef] - i * s)}" x2="${W}" y2="${r2(yb[clef] - i * s)}" stroke="${LINE}" stroke-width="${r2(lw)}"/>`;
    const g = GLYPHS[CLEFS[clef].glyph];
    o += `<path d="${g.d}" transform="translate(${r2(xs + 3 - g.left * k)} ${r2(yb[clef])}) scale(${k} ${-k}) translate(0 12)" fill="${INK}"/>`;
  }
  if (grand) {
    const yTop = yb.sol - 4 * s;
    o += `<line x1="${r2(xs + lw / 2)}" y1="${r2(yTop - lw / 2)}" x2="${r2(xs + lw / 2)}" y2="${r2(yb.fa + lw / 2)}" stroke="${LINE}" stroke-width="${r2(lw * 1.3)}"/>`;
    o += `<path d="${bracePath(0, yTop, xs - 0.35 * s, yb.fa - yTop)}" fill="${INK}"/>`;
  }
  notes.forEach((n, i) => {
    const st = states[i], x = x0 + i * dx, y0 = yb[n.clef], yc = y0 - n.p * s / 2;
    const col = st.kind === 'faux' ? RED : st.kind === 'ok' ? DONE : INK;
    const led = [];
    if (n.p <= -2) for (let q = -2; q >= n.p; q -= 2) led.push(q);
    if (n.p >= 10) for (let q = 10; q <= n.p; q += 2) led.push(q);
    for (const q of led) o += `<line x1="${r2(x - 1.02 * s)}" y1="${r2(y0 - q * s / 2)}" x2="${r2(x + 1.02 * s)}" y2="${r2(y0 - q * s / 2)}" stroke="${LINE}" stroke-width="${r2(lw * 1.3)}"/>`;
    o += `<path data-n="${st.j}" d="${GLYPHS.nhblack.d}" transform="translate(${r2(x - 155 * k)} ${r2(yc + 91 * k)}) scale(${k} ${-k})" fill="${col}"/>`;
    if (st.cur) {
      const yt = yLow + 1.75 * s + 4;
      o += `<polygon points="${r2(x)},${r2(yt)} ${r2(x - a)},${r2(yt + 1.7 * a)} ${r2(x + a)},${r2(yt + 1.7 * a)}" fill="${BLUE}"/>`;
    }
  });
  const label = grand ? `Système de piano, ${notes.length} notes` : `Portée en ${CLEFS[notes[0].clef].nom}, ${notes.length} notes`;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${o}</svg>`;
}

// Taille des portées : la plus grande qui laisse tenir tous les systèmes dans la hauteur de l'écran.
function layout() {
  const grand = S.mode === 'deux', nSys = Math.ceil(S.N / PER);
  const cs = getComputedStyle($('page'));
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight), padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const W = Math.floor(Math.min(window.innerWidth - padX, 760));
  const avail = window.innerHeight - padY - 44 - 104 - (DEBUG ? 60 : 0);
  let s = Math.min(Math.floor(W / 32 * 2) / 2, 20);
  while (s > 7 && nSys * metrics(s, grand).H + (nSys - 1) * 8 > avail) s -= 0.5;
  const gap = Math.max(8, Math.min((avail - nSys * metrics(s, grand).H) / Math.max(1, nSys - 1), 2.5 * s));
  return { W, s, gap: Math.floor(gap), grand };
}

// ---------- état ----------
let S = null;                       // séance en cours
let modelP = null;                  // promesse du modèle vocal
// Le filtre « syllabe dite ou autre son » peut se tromper sur un micro qu'il ne connaît pas et écarter la voix. L'app le
// surveille (voir watchGate) ; s'il est pris en défaut sur cet appareil, il reste coupé jusqu'au prochain modèle.
let gateOff = null;                 // clé du modèle pour lequel le filtre a été coupé, ou null
try { gateOff = (JSON.parse(localStorage.getItem('solfege.gate') || 'null') || {}).model || null; } catch (e) { /* stockage indisponible */ }
const gateKey = (m) => (m.gate ? `${m.version}:${m.gate.trained}:${m.gate.tau}` : '');
const prefs = { clef: 'sol', input: 'voix', exo: 'lecture', niveau: '0' };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('solfege.prefs') || '{}')); } catch (e) { /* préférences absentes */ }

function setChoice(groupId, value) {
  for (const b of $(groupId).querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.v === value));
}
function wireChoice(groupId, key, onChange) {
  $(groupId).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    prefs[key] = b.dataset.v; setChoice(groupId, prefs[key]);
    try { localStorage.setItem('solfege.prefs', JSON.stringify(prefs)); } catch (err) { /* stockage indisponible */ }
    if (onChange) onChange(prefs[key]);
  });
  setChoice(groupId, prefs[key]);
}
const say = (t) => { $('msg').textContent = t; };

function verdicts() {
  if (!S || S.kind === 'chant') return [];
  return S.input === 'midi' ? S.v : S.follower.verdicts();
}
function render() {
  if (!S) return;
  if (S.kind === 'chant') { renderChant(); return; }
  const t0 = performance.now();
  const { W, s, gap, grand } = layout(), v = verdicts();
  // Note en cours, et syllabe nette qui ne lui correspond pas : la note passe au rouge tout de suite. La syllabe suivante
  // tranche : une correction la valide, la note d'après la confirme fausse.
  const k = S.over ? -1 : S.input === 'midi' ? S.k : S.follower.best();
  const pend = !S.over && S.input === 'voix' ? S.follower.pending(RED_CONF) : null;
  const cur = pend ? k + 1 : k;
  $('systems').style.gap = gap + 'px';
  let html = '';
  for (let sys = 0; sys * PER < S.notes.length; sys++) {
    const notes = S.notes.slice(sys * PER, sys * PER + PER);
    const states = notes.map((n, i) => {
      const j = sys * PER + i, q = v[j];
      return { j, kind: q ? q.v : pend && j === k ? 'faux' : 'next', cur: j === cur };
    });
    html += systemSVG(notes, states, W, s, grand);
  }
  $('systems').innerHTML = html;
  if (S.draw) S.draw.push(performance.now() - t0);
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

function show(view) {
  $('home').hidden = view !== 'home';
  $('page').hidden = view !== 'page';
}

async function start() {
  say('');
  $('go').disabled = true;
  const input = TEST_MIDI || (prefs.input === 'midi' && midi.inputs().length) ? 'midi' : 'voix';
  const notes = buildExercise(prefs.clef);
  const base = { input, mode: prefs.clef, notes, N: notes.length, over: false, at: new Date().toISOString() };
  let ctx = null;
  try {
    if (input === 'midi') {
      S = { ...base, v: new Array(notes.length).fill(null), k: 0, t0: performance.now() };
    } else {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC({ latencyHint: 'interactive' });
      ctx.resume().catch(() => {});                       // dans le geste de l'utilisateur
      const model = await modelP;
      const rs = new Resampler(ctx.sampleRate), rec = new Recognizer(model, params.has('tau') ? { tau: +params.get('tau') } : {});
      const expected = notes.map((n) => n.cls), bypass = !model.gate || gateOff === gateKey(model);
      S = { ...base, follower: new Follower(expected), rec, ctx, model, heard: [], pcm: [], pcmN: 0, level: 0, rate: ctx.sampleRate, tStart: Infinity,
        // sans filtre : les détections du modèle des syllabes seul et leur propre suivi, pour surveiller le filtre
        raw: [], shadow: bypass ? null : new Follower(expected), bypass,
        lag: DEBUG ? [] : null, draw: DEBUG ? [] : null };
      const mine = S;
      rec.onLevel = (rms) => { mine.level = rms; };
      rec.onCandidate = (c) => { if (!mine.bypass) onCandidate(mine, c); };
      rec.onRaw = (c) => onRaw(mine, c);
      const audio = await openMic(ctx, (x, t) => {
        if (mine.over) return;
        // diagnostic : temps mis par un bloc de son pour aller du micro (horloge audio) jusqu'ici
        if (mine.lag && t !== undefined && mine.lag.length < 60000) mine.lag.push(Math.max(0, ctx.currentTime - t));
        if (!mine.got) { mine.got = true; if (S === mine && $('result').dataset.alerte) { $('result').textContent = ''; delete $('result').dataset.alerte; } }
        let y = rs.process(x);
        if (DEBUG && mine.pcmN < DIAG_MAX) {
          // en diagnostic, le moteur écoute exactement les échantillons gardés pour le fichier : le rejeu hors de l'app donne le même résultat
          const q = Int16Array.from(y, (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32768))));
          mine.pcm.push(q); mine.pcmN += q.length;
          y = Float32Array.from(q, (v) => v / 32768);
        }
        rec.push(y);
      });
      // séance quittée ou relancée pendant l'ouverture du micro : on le referme et on s'arrête là
      if (S !== mine || mine.over) { audio.stop(); $('go').disabled = false; return; }
      S.audio = audio;
      S.tStart = rec.time;                                 // les syllabes dites avant l'affichage ne comptent pas
    }
  } catch (e) {
    S = null; $('go').disabled = false;
    if (ctx) { try { ctx.close(); } catch (err) { /* déjà fermé */ } }
    say(e && e.name === 'NotAllowedError'
      ? 'Micro refusé. Autorise le micro pour ce site dans les réglages du navigateur, puis recommence.'
      : 'Démarrage impossible : ' + (e && e.message ? e.message : e));
    return;
  }
  $('result').textContent = ''; delete $('result').dataset.alerte; $('after').hidden = true; $('share').hidden = true;
  $('debug').hidden = !DEBUG; $('debug').textContent = '';
  show('page'); render(); levelLoop();
  if (navigator.wakeLock) navigator.wakeLock.request('screen').then((l) => { if (S) S.lock = l; }).catch(() => {});
  if (input === 'voix') {
    // aucun son reçu après trois secondes : le contexte audio attend un geste, une touche sur la page le relance
    const mine = S;
    setTimeout(() => {
      if (S !== mine || mine.over || mine.got) return;
      $('result').textContent = 'Le micro ne répond pas. Touche la page.'; $('result').dataset.alerte = '1';
    }, 3000);
  }
  $('go').disabled = false;
}

function onCandidate(sess, c) {
  if (sess !== S || S.over || c.time < S.tStart) return;
  c.delay = S.rec.clock - c.time;                        // son écoulé depuis l'ancre de la syllabe au moment où elle est reconnue
  S.heard.push(c); S.follower.push(c);
  afterPush();
}

function afterPush() {
  render(); debugLine();
  clearTimeout(S.commitT);
  const k = S.follower.best();
  if (k >= S.N) {
    // dernière note lue : on laisse une demi-seconde à une éventuelle correction, sans repousser la fin si d'autres sons arrivent
    if (!S.endT) S.endT = setTimeout(() => finish(), END_MS);
  } else {
    clearTimeout(S.endT); S.endT = null;
    // une syllabe nette restée sans note compte comme réponse après un silence, plus court sur la dernière note de la page
    S.commitT = setTimeout(() => {
      if (!S || S.over) return;
      if (S.follower.commitPending(RED_CONF)) { render(); if (S.follower.best() >= S.N) finish(); }
    }, k === S.N - 1 ? COMMIT_LAST_MS : COMMIT_MS);
  }
}

// Détection du modèle des syllabes seul, avant le filtre.
function onRaw(sess, c) {
  if (sess !== S || S.over || c.time < S.tStart) return;
  if (S.bypass) { onCandidate(sess, c); return; }        // filtre coupé : tout passe
  c.delay = S.rec.clock - c.time;
  S.raw.push(c); S.shadow.push(c);
  if (watchGate()) {
    // Le filtre écartait la voix : le suivi sans filtre devient celui de la page, et le filtre reste coupé sur cet appareil.
    S.bypass = true; S.follower = S.shadow; S.heard = S.raw; S.shadow = null;
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
  if (!S || S.over || S.input !== 'midi') return;
  const n = S.notes[S.k];
  S.v[S.k] = { v: note === n.midi ? 'ok' : 'faux', midi: note, time: (performance.now() - S.t0) / 1000 };
  S.k += 1;
  render();
  if (S.k >= S.N) finish();
}

function levelLoop() {
  if (!S || S.over || S.input === 'midi') { $('mic').style.opacity = S && S.input === 'midi' ? '0' : '0.15'; return; }
  const l = Math.min(1, S.level * 14);
  $('mic').style.opacity = String(0.15 + 0.85 * l);
  $('mic').style.transform = `scale(${0.6 + 0.6 * l})`;
  requestAnimationFrame(levelLoop);
}

function debugLine() {
  if (!DEBUG || !S || S.input !== 'voix') return;
  const recent = S.heard.slice(-10), last = recent.map((c) => `${SYLLABES[c.cls]} ${c.conf.toFixed(2)}`).join(', ');
  const q = stats(S.lag), d = stats(S.draw);
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

function finish() {
  if (!S || S.over) return;
  if (S.kind === 'chant') { finishChant(); return; }
  S.over = true;
  clearTimeout(S.commitT); clearTimeout(S.endT);
  if (S.audio) S.audio.stop();
  if (S.lock) { try { S.lock.release(); } catch (e) { /* déjà libéré */ } }
  const v = verdicts();
  const ok = v.filter((q) => q && q.v === 'ok').length, faux = v.filter((q) => q && q.v === 'faux').length;
  const answered = v.filter((q) => q && q.time !== undefined);
  if (!answered.length) { S = null; show('home'); return; }
  const t0 = S.input === 'midi' ? 0 : S.tStart;
  // Durée de lecture : l'intervalle moyen entre la première et la dernière réponse, compté une fois par note lue.
  // Le temps de réaction avant la première note n'entre pas dans la cadence.
  const iA = v.findIndex((q) => q && q.time !== undefined), iB = v.findLastIndex((q) => q && q.time !== undefined);
  const dur = iB > iA ? Math.max(0.5, (v[iB].time - v[iA].time) * (iB - iA + 1) / (iB - iA)) : Math.max(0.5, v[iB].time - t0);
  const lues = v.filter(Boolean).length, manque = lues - ok - faux;
  const rate = Math.round(60 * ok / dur), acc = ok + faux ? Math.round(100 * ok / (ok + faux)) : 0;
  let html = `${rate} notes justes par minute · ${acc} %`;
  if (manque) html += `<small>${manque} ${manque > 1 ? 'notes non entendues' : 'note non entendue'}</small>`;
  $('result').innerHTML = html;
  $('after').hidden = false;
  render();
  $('share').hidden = !(DEBUG && S.input === 'voix');
  // Une note = [clé (0 sol, 1 fa), position sur la portée, verdict (1 juste, 0 faux, -1 non entendue, null non lue),
  //             réponse (syllabe 0 à 6 à la voix, numéro MIDI au clavier), instant en ms depuis le début de la page]
  const CODE = { ok: 1, faux: 0, manque: -1 };
  // mode : 'sol', 'fa', ou 'piano' pour le système à deux portées
  saveSession({ id: S.at + '-' + Math.random().toString(36).slice(2, 8), fmt: 2, app: VERSION, at: S.at, mode: S.mode === 'deux' ? 'piano' : S.mode, input: S.input,
    n: S.N, ok, faux, manque, dur: Math.round(dur * 10) / 10, rate, acc,
    notes: S.notes.map((n, i) => {
      const q = v[i];
      return [n.clef === 'fa' ? 1 : 0, n.p, q ? CODE[q.v] : null, q ? (q.cls ?? q.midi ?? null) : null, q && q.time !== undefined ? Math.round((q.time - t0) * 1000) : null];
    }) });
}

function saveSession(rec) {
  try {
    let all = JSON.parse(localStorage.getItem('solfege.sessions') || '[]');
    all.push(rec);
    all = all.slice(-MAX_SESSIONS);
    try { localStorage.setItem('solfege.sessions', JSON.stringify(all)); }
    catch (e) { localStorage.setItem('solfege.sessions', JSON.stringify(all.slice(Math.ceil(all.length / 5)))); }   // place manquante : on cède le cinquième le plus ancien
  } catch (e) { /* stockage indisponible : la séance n'est pas conservée */ }
}

// Mode diagnostic : un seul fichier à partager. C'est le son de la page tel que l'app l'a reçu (WAV, 16 kHz, mono),
// suivi d'un bloc « sLFG » qui porte le compte rendu en JSON : notes attendues, syllabes entendues, verdicts, réglages du micro.
function diagFile() {
  if (!S || !S.pcm) return null;
  const meta = S.kind === 'chant' ? {
    app: VERSION, exercice: 'chant', at: S.at, ua: navigator.userAgent,
    installee: (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true,
    rate: S.rate, micro: S.audio ? S.audio.info : null, tronque: S.pcmN >= DIAG_MAX, niveau: S.niveau + 1, tol: TOL, tenue: TENUE,
    intervalles: S.items.map((q) => [q.ref, q.cible, nomIntervalle(q.ref, q.cible)]),
    // par intervalle trouvé : référence, cible, temps pour trouver (ms), écart médian (cents), réécoutes, niveau et écart de la référence captée par le micro
    resultats: S.results.map((r) => [r.ref, r.cible, r.ms, r.cents, r.replays, r.refRms, r.refCents]),
    livraison: stats(S.lag),
  } : {
    app: VERSION, modele: S.model ? { version: S.model.version, trained: S.model.trained } : null, at: S.at, ua: navigator.userAgent,
    installee: (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true,
    ecran: [window.innerWidth, window.innerHeight, window.devicePixelRatio], rate: S.rate, micro: S.audio ? S.audio.info : null,
    tStart: S.tStart, tronque: S.pcmN >= DIAG_MAX, mode: S.mode,
    attendu: S.notes.map((n) => SYLLABES[n.cls]),
    // par syllabe entendue : instant (ms), syllabe, confiance, son écoulé avant la reconnaissance (ms), 1 si reconnue sans attendre le sommet
    entendu: S.heard.map((c) => [Math.round(c.time * 1000), SYLLABES[c.cls], Math.round(c.conf * 100) / 100, Math.round(c.delay * 1000), c.early ? 1 : 0]),
    livraison: stats(S.lag), dessin: stats(S.draw), clefs: S.notes.map((n) => (n.clef === 'fa' ? 1 : 0)),
    // filtre « syllabe dite ou autre son » : son seuil, s'il a été coupé, et les détections du modèle seul (pour voir ce qu'il a écarté)
    filtre: S.model.gate ? { tau: S.rec.tau, coupe: S.bypass, cle: gateKey(S.model) } : null,
    brut: (S.bypass ? [] : S.raw).map((c) => [Math.round(c.time * 1000), SYLLABES[c.cls], Math.round(c.conf * 100) / 100]),
    verdicts: verdicts().map((q) => (q ? q.v : null)),
  };
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const n = S.pcm.reduce((a, c) => a + c.length, 0), pad = json.length % 2;
  const buf = new ArrayBuffer(44 + 2 * n + 8 + json.length + pad), b = new DataView(buf);
  const w = (o, t) => { for (let i = 0; i < t.length; i++) b.setUint8(o + i, t.charCodeAt(i)); };
  w(0, 'RIFF'); b.setUint32(4, buf.byteLength - 8, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 16000, true); b.setUint32(28, 32000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, 2 * n, true);
  let o = 44;
  for (const c of S.pcm) for (let i = 0; i < c.length; i++) { b.setInt16(o, c[i], true); o += 2; }
  w(o, 'sLFG'); b.setUint32(o + 4, json.length, true); new Uint8Array(buf, o + 8, json.length).set(json);
  return new File([buf], `solfege-${S.at.replace(/[:.]/g, '-')}.wav`, { type: 'audio/wav' });
}
async function shareAudio() {
  const f = diagFile();
  if (!f) return;
  try {
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f] }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
}

// ---------- chant d'intervalles ----------
// Trois temps, sans chronomètre. Écoute : la note de référence sonne (toucher la portée la rejoue). Vise : tu cherches
// la seconde note, la courbe bleue montre ta voix sur la portée, rien n'est jugé. Tiens : la note compte après TENUE ms
// dans la bande de ±TOL cents, à l'octave près.
let WAVE = null;
function playRef() {
  const ctx = S.ctx, it = S.items[S.i];
  if (!WAVE) WAVE = ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0, 0, 0]), new Float32Array([0, 1, 0.45, 0.25, 0.12, 0.06, 0.03]));
  const t0 = ctx.currentTime + 0.03, osc = ctx.createOscillator(), g = ctx.createGain(), d = REF_MS / 1000;
  osc.setPeriodicWave(WAVE); osc.frequency.value = 440 * 2 ** ((midiOf(it.ref) - 69) / 12);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.3, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.12, t0 + d * 0.8); g.gain.linearRampToValueAtTime(0, t0 + d);
  osc.connect(g); g.connect(ctx.destination); osc.start(t0); osc.stop(t0 + d + 0.05);
  S.phase = 'ecoute'; S.listenFrom = performance.now() + 30 + REF_MS + REF_TAIL_MS;
  S.refRms = 0; S.refC = []; S.hold.reset();
  renderChant();
}

async function startChant() {
  say('');
  $('go').disabled = true;
  const niveau = +prefs.niveau || 0;
  const forced = params.get('items');
  const items = forced ? forced.split(',').map((q) => { const [a, b] = q.split(':').map(Number); return { ref: a, cible: b }; }) : buildIntervals(niveau, CHANT_N);
  let ctx = null;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    ctx.resume().catch(() => {});                         // dans le geste de l'utilisateur
    // iPhone : micro et haut-parleur ensemble, sans traitement de la voix
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) { /* réglage absent */ }
    const rs = new Resampler(ctx.sampleRate), pitch = new Pitch({ win: 1024 });
    S = { kind: 'chant', input: 'chant', mode: 'chant', niveau, items, i: 0, N: items.length, over: false, at: new Date().toISOString(), ctx, pitch,
      hold: new Hold({ tol: TOL, holdMs: TENUE }), track: [], results: [], replays: 0, phase: 'ecoute', level: 0, rate: ctx.sampleRate,
      pcm: [], pcmN: 0, lag: DEBUG ? [] : null };
    const mine = S;
    pitch.onPitch = (q) => onPitch(mine, q);
    const audio = await openMic(ctx, (x, t) => {
      if (mine.over) return;
      mine.got = true;
      if (mine.lag && t !== undefined && mine.lag.length < 60000) mine.lag.push(Math.max(0, ctx.currentTime - t));
      const y = rs.process(x);
      if (DEBUG && mine.pcmN < DIAG_MAX) { mine.pcm.push(Int16Array.from(y, (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32768))))); mine.pcmN += y.length; }
      pitch.push(y);
    });
    if (S !== mine || mine.over) { audio.stop(); $('go').disabled = false; return; }
    S.audio = audio;
  } catch (e) {
    S = null; $('go').disabled = false;
    if (ctx) { try { ctx.close(); } catch (err) { /* déjà fermé */ } }
    say(e && e.name === 'NotAllowedError'
      ? 'Micro refusé. Autorise le micro pour ce site dans les réglages du navigateur, puis recommence.'
      : 'Démarrage impossible : ' + (e && e.message ? e.message : e));
    return;
  }
  $('result').textContent = ''; delete $('result').dataset.alerte; $('after').hidden = true; $('share').hidden = true;
  $('debug').hidden = !DEBUG; $('debug').textContent = '';
  $('systems').classList.add('chant');
  show('page'); playRef(); levelLoop(); chantLoop();
  if (navigator.wakeLock) navigator.wakeLock.request('screen').then((l) => { if (S) S.lock = l; }).catch(() => {});
  $('go').disabled = false;
}

// Une mesure de hauteur toutes les 10 ms.
function onPitch(sess, q) {
  if (sess !== S || S.over) return;
  S.level = q.rms;
  const it = S.items[S.i], now = performance.now();
  if (S.phase === 'ecoute') {
    // la référence sonne : on n'écoute pas la voix, mais on note ce que le micro capte d'elle (sort-elle bien du haut-parleur ?)
    if (q.rms > S.refRms) S.refRms = q.rms;
    if (q.clarity >= 0.8 && q.f0 > 0) S.refC.push(1200 * Math.log2(q.f0 / 440) - 100 * (midiOf(it.ref) - 69));
    if (now < S.listenFrom) return;
    S.phase = 'vise'; S.hold.reset();
    if (S.tVise === undefined) S.tVise = now;
    renderChant();
  }
  if (S.phase !== 'vise') return;
  const midi = midiOf(it.cible), r = S.hold.push(q, midi);
  S.track.push({ t: q.time, c: r.voiced ? r.cents : null });
  if (S.track.length > 100 * (TRACE_S + 1)) S.track.splice(0, 100);
  if (DEBUG) $('debug').textContent = `v${VERSION} · ${S.rate} Hz · ${q.f0 ? q.f0.toFixed(1) + ' Hz' : 'pas de note'} · netteté ${q.clarity.toFixed(2)} · écart ${r.cents === null ? '?' : Math.round(r.cents) + ' cents'} · bande ±${TOL}, tenue ${TENUE} ms · référence captée ${S.refRms.toFixed(3)}`;
  if (!r.done) return;
  const c = S.refC.slice().sort((a, b) => a - b), mc = c.length ? c[c.length >> 1] : null;
  S.results.push({ ref: it.ref, cible: it.cible, ms: Math.round(now - S.tVise), cents: Math.round(r.median), replays: S.replays,
    refRms: Math.round(S.refRms * 1000) / 1000, refCents: mc === null ? null : Math.round(mc - 1200 * Math.round(mc / 1200)) });
  S.phase = 'tenu'; renderChant();
  setTimeout(() => {
    if (S !== sess || S.over) return;
    S.i += 1; S.replays = 0; S.tVise = undefined; S.track = [];
    if (S.i >= S.N) finishChant(); else playRef();
  }, NEXT_MS);
}

// La portée porte les deux notes de l'intervalle. Dessous, la courbe de la voix : la ligne du milieu est la note à chanter,
// la bande bleue ce qu'il faut tenir (±TOL cents), les traits fins marquent les demi-tons au-dessus et au-dessous.
const SPAN = 350;                                          // la courbe montre ±350 cents autour de la cible
function chantLayout() {
  const cs = getComputedStyle($('page'));
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const W = Math.floor(Math.min(window.innerWidth - padX, 760)), s = Math.min(Math.floor(W / 22 * 2) / 2, 20);
  const yb = Math.round(3.2 * s) + 4 * s, y0 = yb + Math.round(4.2 * s), hc = Math.round(9 * s);
  return { W, s, yb, y0, hc, H: y0 + hc + 4, x1: 6.2 * s, x2: 9.8 * s, xa: 0.4 * s, xb: W - 0.8 * s };
}
function renderChant() {
  if (!S || S.kind !== 'chant') return;
  const { W, s, yb, y0, hc, H, x1, x2, xa, xb } = chantLayout(), k = s / SS, lw = Math.max(0.9, s / 12);
  const it = S.items[Math.min(S.i, S.N - 1)], y = (p) => yb - p * s / 2, yc = (c) => y0 + hc / 2 - c * (hc / 2) / SPAN;
  let o = '';
  for (let i = 0; i < 5; i++) o += `<line x1="0" y1="${r2(yb - i * s)}" x2="${W}" y2="${r2(yb - i * s)}" stroke="${LINE}" stroke-width="${r2(lw)}"/>`;
  const g = GLYPHS.gclef;
  o += `<path d="${g.d}" transform="translate(${r2(3 - g.left * k)} ${r2(yb)}) scale(${k} ${-k}) translate(0 12)" fill="${INK}"/>`;
  const note = (x, p, col, id) => {
    let q = '';
    const led = [];
    if (p <= -2) for (let v = -2; v >= p; v -= 2) led.push(v);
    if (p >= 10) for (let v = 10; v <= p; v += 2) led.push(v);
    for (const v of led) q += `<line x1="${r2(x - 1.02 * s)}" y1="${r2(y(v))}" x2="${r2(x + 1.02 * s)}" y2="${r2(y(v))}" stroke="${LINE}" stroke-width="${r2(lw * 1.3)}"/>`;
    return q + `<path id="${id}" d="${GLYPHS.nhblack.d}" transform="translate(${r2(x - 155 * k)} ${r2(y(p) + 91 * k)}) scale(${k} ${-k})" fill="${col}"/>`;
  };
  o += note(x1, it.ref, S.phase === 'ecoute' ? BLUE : INK, 'ref');           // bleue pendant qu'elle sonne
  o += note(x2, it.cible, S.phase === 'tenu' ? DONE : INK, 'cible');
  // la courbe
  o += `<rect x="${r2(xa)}" y="${r2(yc(TOL))}" width="${r2(xb - xa)}" height="${r2(yc(-TOL) - yc(TOL))}" fill="${BLUE}" opacity="0.16"/>`;
  for (const c of [-300, -200, -100, 100, 200, 300]) o += `<line x1="${r2(xa)}" y1="${r2(yc(c))}" x2="${r2(xb)}" y2="${r2(yc(c))}" stroke="${LINE}" stroke-width="0.6" opacity="0.35"/>`;
  o += `<line x1="${r2(xa)}" y1="${r2(yc(0))}" x2="${r2(xb)}" y2="${r2(yc(0))}" stroke="${BLUE}" stroke-width="1" opacity="0.6"/>`;
  o += `<path id="trace" d="" fill="none" stroke="${BLUE}" stroke-width="${r2(Math.max(2.2, s / 6))}" stroke-linecap="round" stroke-linejoin="round"/>`;
  o += `<circle id="voix" cx="${r2(xb)}" cy="-99" r="${r2(s * 0.36)}" fill="${BLUE}"/>`;
  const label = `Intervalle ${S.i + 1} sur ${S.N} : ${nomIntervalle(it.ref, it.cible)}. Toucher pour réentendre la première note.`;
  $('systems').style.gap = '0px';
  $('systems').innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${o}</svg>`;
}
// Les TRACE_S dernières secondes de la voix, la plus récente à droite ; hors de l'échelle, la courbe longe le bord.
function chantLoop() {
  if (!S || S.over || S.kind !== 'chant') return;
  const tr = $('trace'), dot = $('voix');
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
  requestAnimationFrame(chantLoop);
}
function finishChant() {
  if (!S || S.over) return;
  S.over = true;
  if (S.audio) S.audio.stop();
  if (S.lock) { try { S.lock.release(); } catch (e) { /* déjà libéré */ } }
  const R = S.results;
  if (!R.length) { S = null; $('systems').classList.remove('chant'); show('home'); return; }
  const sec = R.reduce((a, r) => a + r.ms, 0) / R.length / 1000, cents = Math.round(R.reduce((a, r) => a + Math.abs(r.cents), 0) / R.length);
  $('result').innerHTML = `${R.length} ${R.length > 1 ? 'intervalles' : 'intervalle'} · ${sec.toFixed(1).replace('.', ',')} s pour trouver la note<small>écart moyen : ${cents} cents</small>`;
  $('after').hidden = false;
  $('share').hidden = !DEBUG;
  // Un intervalle = [position de la référence, position de la cible, temps pour trouver (ms), écart médian (cents), réécoutes]
  saveSession({ id: S.at + '-' + Math.random().toString(36).slice(2, 8), fmt: 2, app: VERSION, at: S.at, mode: 'chant', input: 'chant', niveau: S.niveau + 1,
    n: S.N, ok: R.length, tol: TOL, tenue: TENUE, items: R.map((r) => [r.ref, r.cible, r.ms, r.cents, r.replays]) });
}

// ---------- clavier MIDI ----------
const midi = {
  access: null,
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
const exo = () => (params.get('exo') || prefs.exo);
function showHome() {
  const chant = exo() === 'chant';
  $('clef').hidden = chant; $('niveau').hidden = !chant;
  $('input').hidden = chant || !navigator.requestMIDIAccess;
  say(chant ? NIVEAUX[+prefs.niveau || 0].texte + ' La première note sonne, chante la seconde.' : '');
}
wireChoice('exo', 'exo', showHome);
wireChoice('niveau', 'niveau', showHome);
wireChoice('clef', 'clef');
if (navigator.requestMIDIAccess) {
  wireChoice('input', 'input', async (v) => {
    if (v !== 'midi') { say(''); return; }
    try { say((await midi.open()) ? '' : 'Aucun clavier MIDI détecté. Branche-le, puis choisis à nouveau « Au clavier ».'); }
    catch (e) { say('Accès MIDI refusé par le navigateur.'); }
  });
  if (prefs.input === 'midi') midi.open().catch(() => {});
} else {
  prefs.input = 'voix';
}
showHome();
$('go').addEventListener('click', () => (exo() === 'chant' ? startChant() : start()));
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
const goHome = () => { S = null; $('systems').classList.remove('chant'); show('home'); };
$('quit').addEventListener('click', () => { if (S && !S.over) finish(); else goHome(); });
$('again').addEventListener('click', () => (S && S.kind === 'chant' ? startChant() : start()));
$('done').addEventListener('click', goHome);
// chant : toucher la portée rejoue la note de référence
$('systems').addEventListener('click', () => { if (S && S.kind === 'chant' && !S.over && S.phase === 'vise') { S.replays += 1; playRef(); } });
$('share').addEventListener('click', shareAudio);
$('page').addEventListener('click', () => { if (S && !S.over && S.ctx && S.ctx.state !== 'running') S.ctx.resume().catch(() => {}); });
window.addEventListener('resize', render);
document.addEventListener('visibilitychange', () => { if (document.hidden && S && !S.over && S.input !== 'midi') finish(); });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
window.__solfege = { VERSION, get session() { return S; }, verdicts, onMidiNote, diagFile, get gateOff() { return gateOff; } };
