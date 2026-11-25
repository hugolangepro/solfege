// Solfège : lecture de notes, réponse à la voix ou au clavier MIDI. Interface minimale.
import { loadModel, Recognizer, Resampler, Follower, SYLLABES } from './engine.js';
import { GLYPHS } from './glyphs.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let DEBUG = params.has('debug');
try { if (localStorage.getItem('solfege.debug') === '1') DEBUG = true; } catch (e) { /* stockage indisponible */ }
const TEST_MIDI = params.get('input') === 'midi';      // tests sans clavier branché
const N_SYS = 4, PER = 8, SS = 191;
const INK = '#1C1A17', DONE = 'rgba(28,26,23,0.36)', RED = '#B3261E', BLUE = '#1F4E8C', SOFT = '#6B6457', LINE = 'rgba(28,26,23,0.72)';
const CLEFS = { sol: { glyph: 'gclef', off: 2, base: 4, nom: 'clé de sol' }, fa: { glyph: 'fclef', off: 4, base: 2, nom: 'clé de fa' } };
const SEMIS = [0, 2, 4, 5, 7, 9, 11];
const MIDI_NOMS = ['do', 'do dièse', 'ré', 'mi bémol', 'mi', 'fa', 'fa dièse', 'sol', 'la bémol', 'la', 'si bémol', 'si'];

// ---------- notes ----------
// p = position sur la portée : 0 sur la ligne du bas, +1 par degré.
function noteInfo(clef, p) {
  const d = p + CLEFS[clef].off;                       // degrés au-dessus du do de référence de la clé
  const cls = ((d % 7) + 7) % 7;
  const midi = 12 * (CLEFS[clef].base + Math.floor(d / 7) + 1) + SEMIS[cls];
  return { clef, p, cls, midi };
}

function buildExercise(mode) {
  const forced = params.get('seq');
  if (forced) {
    return forced.split(',').slice(0, N_SYS * PER).map((s) => {
      const cls = SYLLABES.indexOf(s.trim());
      return noteInfo('sol', ((cls - 2) % 7 + 7) % 7);
    });
  }
  const clefs = mode === 'deux' ? ['sol', 'fa', 'sol', 'fa'] : Array(N_SYS).fill(mode);
  const notes = [];
  let prev = null;
  for (let s = 0; s < N_SYS; s++) {
    for (let i = 0; i < PER; i++) {
      let p;
      do { p = -2 + Math.floor(Math.random() * 13); } while (p === prev);
      prev = p;
      notes.push(noteInfo(clefs[s], p));
    }
  }
  return notes;
}

// ---------- portée ----------
const r2 = (v) => Math.round(v * 100) / 100;

// Marges d'une portée : la place des notes hors portée au-dessus, et celle de l'annotation en dessous.
function metrics(s) {
  const fs = Math.max(13, Math.round(s * 1.25));
  return { fs, padTop: Math.round(1.75 * s + 6), padBot: Math.round(1.75 * s + fs + 10) };
}

function systemSVG(notes, states, W, s) {
  const clef = notes[0].clef;
  const { padTop, padBot, fs } = metrics(s);
  const yb = padTop + 4 * s, H = yb + padBot, k = s / SS;
  const x0 = 5.6 * s, xr = W - 1.5 * s, dx = (xr - x0) / (PER - 1);
  const lw = Math.max(0.9, s / 12);
  let o = '';
  for (let i = 0; i < 5; i++) o += `<line x1="0" y1="${r2(yb - i * s)}" x2="${W}" y2="${r2(yb - i * s)}" stroke="${LINE}" stroke-width="${r2(lw)}"/>`;
  const g = GLYPHS[CLEFS[clef].glyph];
  o += `<path d="${g.d}" transform="translate(${r2(3 - g.left * k)} ${r2(yb)}) scale(${k} ${-k}) translate(0 12)" fill="${INK}"/>`;
  const ya = yb + 1.75 * s + fs + 2;
  notes.forEach((n, i) => {
    const st = states[i], x = x0 + i * dx, yc = yb - n.p * s / 2;
    const col = st.kind === 'faux' ? RED : (st.kind === 'ok' || st.kind === 'manque') ? DONE : INK;
    const led = [];
    if (n.p <= -2) for (let q = -2; q >= n.p; q -= 2) led.push(q);
    if (n.p >= 10) for (let q = 10; q <= n.p; q += 2) led.push(q);
    for (const q of led) o += `<line x1="${r2(x - 1.02 * s)}" y1="${r2(yb - q * s / 2)}" x2="${r2(x + 1.02 * s)}" y2="${r2(yb - q * s / 2)}" stroke="${LINE}" stroke-width="${r2(lw * 1.3)}"/>`;
    o += `<path d="${GLYPHS.nhblack.d}" transform="translate(${r2(x - 155 * k)} ${r2(yc + 91 * k)}) scale(${k} ${-k})" fill="${col}"/>`;
    if (st.kind === 'faux') {
      o += `<ellipse cx="${r2(x)}" cy="${r2(yc)}" rx="${r2(1.28 * s)}" ry="${r2(1.02 * s)}" transform="rotate(-14 ${r2(x)} ${r2(yc)})" fill="none" stroke="${RED}" stroke-width="${r2(Math.max(1.3, s / 8))}"/>`;
      o += `<text x="${r2(x)}" y="${r2(ya)}" font-size="${fs}" font-style="italic" fill="${RED}" text-anchor="middle">${st.label}</text>`;
    } else if (st.kind === 'manque') {
      o += `<text x="${r2(x)}" y="${r2(ya)}" font-size="${fs}" font-style="italic" fill="${SOFT}" text-anchor="middle">?</text>`;
    }
    if (st.cur) {
      const yt = yb + 1.75 * s + 4, a = Math.max(6, s * 0.55);
      o += `<polygon points="${r2(x)},${r2(yt)} ${r2(x - a)},${r2(yt + 1.7 * a)} ${r2(x + a)},${r2(yt + 1.7 * a)}" fill="${BLUE}"/>`;
    }
  });
  const label = `Portée en ${CLEFS[clef].nom}, ${notes.length} notes`;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}" font-family="inherit">${o}</svg>`;
}

function layout() {
  const cs = getComputedStyle($('page'));
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight), padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const W = Math.floor(Math.min(window.innerWidth - padX, 760));
  const avail = window.innerHeight - padY - 44 - 104 - (DEBUG ? 60 : 0);
  // hauteur d'une portée ≈ 7,5 interlignes + 30 px ; quatre portées et trois espaces de 8 px
  // quatre portées d'environ 8,75 interlignes + 16 px, séparées d'au moins 8 px
  let s = Math.max(8, Math.min(W / 32, (avail - 4 * 16 - 24) / 35, 20));
  s = Math.floor(s * 2) / 2;
  const m = metrics(s), H = m.padTop + 4 * s + m.padBot;
  const gap = Math.max(8, Math.min((avail - 4 * H) / 3, 2.5 * s));
  return { W, s, gap: Math.floor(gap) };
}

// ---------- état ----------
let S = null;                       // séance en cours
let modelP = null;                  // promesse du modèle vocal
const prefs = { clef: 'sol', input: 'voix' };
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
  if (!S) return [];
  return S.input === 'midi' ? S.v : S.follower.verdicts();
}
function cursor() {
  if (S.over) return -1;
  return S.input === 'midi' ? S.k : S.follower.best();
}

function render() {
  if (!S) return;
  const { W, s, gap } = layout(), v = verdicts(), cur = cursor();
  $('systems').style.gap = gap + 'px';
  let html = '';
  for (let sys = 0; sys * PER < S.notes.length; sys++) {
    const notes = S.notes.slice(sys * PER, sys * PER + PER);
    const states = notes.map((n, i) => {
      const q = v[sys * PER + i];
      if (!q) return { kind: 'next', cur: sys * PER + i === cur };
      const label = q.v === 'faux' ? (S.input === 'midi' ? MIDI_NOMS[q.midi % 12] : 'dit : ' + SYLLABES[q.cls]) : '';
      return { kind: q.v, label, cur: false };
    });
    html += systemSVG(notes, states, W, s);
  }
  $('systems').innerHTML = html;
}

// ---------- son ----------
async function openMic(ctx, onSamples) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  if (ctx.state === 'suspended') await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const mute = ctx.createGain();
  mute.gain.value = 0; mute.connect(ctx.destination);
  let node;
  if (ctx.audioWorklet && window.AudioWorkletNode) {
    await ctx.audioWorklet.addModule('worklet.js');
    node = new AudioWorkletNode(ctx, 'tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    node.port.onmessage = (e) => onSamples(e.data);
  } else {
    node = ctx.createScriptProcessor(1024, 1, 1);
    node.onaudioprocess = (e) => onSamples(new Float32Array(e.inputBuffer.getChannelData(0)));
  }
  src.connect(node); node.connect(mute);
  return { stop() { try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* déjà arrêté */ } try { ctx.close(); } catch (e) { /* déjà fermé */ } } };
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
      const rs = new Resampler(ctx.sampleRate), rec = new Recognizer(model);
      S = { ...base, follower: new Follower(notes.map((n) => n.cls)), rec, heard: [], pcm: [], level: 0, rate: ctx.sampleRate, tStart: Infinity };
      const mine = S;
      rec.onLevel = (rms) => { mine.level = rms; };
      rec.onCandidate = (c) => onCandidate(mine, c);
      S.audio = await openMic(ctx, (x) => {
        if (mine.over) return;
        const y = rs.process(x);
        if (DEBUG && mine.pcm.length < 6000) mine.pcm.push(Int16Array.from(y, (q) => Math.max(-32768, Math.min(32767, Math.round(q * 32768)))));
        rec.push(y);
      });
      S.tStart = rec.time;                                 // les syllabes dites avant l'affichage ne comptent pas
    }
  } catch (e) {
    S = null; $('go').disabled = false;
    if (ctx) { try { ctx.close(); } catch (err) { /* déjà fermé */ } }
    say(e && e.name === 'NotAllowedError'
      ? 'Micro refusé. Autorise le micro pour ce site dans les réglages du navigateur, puis recommence.'
      : 'Impossible d’ouvrir le micro : ' + (e && e.message ? e.message : e));
    return;
  }
  $('result').textContent = ''; $('after').hidden = true; $('share').hidden = true;
  $('debug').hidden = !DEBUG; $('debug').textContent = '';
  show('page'); render(); levelLoop();
  if (navigator.wakeLock) navigator.wakeLock.request('screen').then((l) => { if (S) S.lock = l; }).catch(() => {});
  $('go').disabled = false;
}

function onCandidate(sess, c) {
  if (sess !== S || S.over || c.time < S.tStart) return;
  S.heard.push(c); S.follower.push(c);
  render(); debugLine();
  clearTimeout(S.commitT);
  if (S.follower.best() >= S.N) {
    // dernière note lue : on laisse 0,7 s à une éventuelle correction, sans repousser la fin si d'autres sons arrivent
    if (!S.endT) S.endT = setTimeout(() => finish(), 700);
  } else {
    clearTimeout(S.endT); S.endT = null;
    // une syllabe nette restée sans note pendant 2,5 s compte comme une réponse
    S.commitT = setTimeout(() => {
      if (!S || S.over) return;
      if (S.follower.commitLast()) { render(); if (S.follower.best() >= S.N) finish(); }
    }, 2500);
  }
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
  if (!S || S.over || S.input !== 'voix') { $('mic').style.opacity = S && S.input === 'midi' ? '0' : '0.15'; return; }
  const l = Math.min(1, S.level * 14);
  $('mic').style.opacity = String(0.15 + 0.85 * l);
  $('mic').style.transform = `scale(${0.6 + 0.6 * l})`;
  requestAnimationFrame(levelLoop);
}

function debugLine() {
  if (!DEBUG || !S || S.input !== 'voix') return;
  const last = S.heard.slice(-10).map((c) => `${SYLLABES[c.cls]} ${c.conf.toFixed(2)}`).join(', ');
  $('debug').textContent = `${S.rate} Hz · niveau ${S.level.toFixed(3)} · entendu : ${last}`;
}

function finish() {
  if (!S || S.over) return;
  S.over = true;
  clearTimeout(S.commitT); clearTimeout(S.endT);
  if (S.audio) S.audio.stop();
  if (S.lock) { try { S.lock.release(); } catch (e) { /* déjà libéré */ } }
  const v = verdicts();
  const ok = v.filter((q) => q && q.v === 'ok').length, faux = v.filter((q) => q && q.v === 'faux').length;
  const answered = v.filter((q) => q && q.time !== undefined);
  if (!answered.length) { S = null; show('home'); return; }
  const t0 = S.input === 'midi' ? 0 : S.tStart;
  const dur = Math.max(0.5, Math.max(...answered.map((q) => q.time)) - t0);
  const lues = v.filter(Boolean).length, manque = lues - ok - faux;
  const rate = Math.round(60 * ok / dur), acc = ok + faux ? Math.round(100 * ok / (ok + faux)) : 0;
  let html = `${rate} notes justes par minute · ${acc} %`;
  if (manque) html += `<small>${manque} ${manque > 1 ? 'notes non entendues' : 'note non entendue'}</small>`;
  $('result').innerHTML = html;
  $('after').hidden = false;
  render();
  $('share').hidden = !(DEBUG && S.input === 'voix');
  saveSession({ at: S.at, mode: S.mode, input: S.input, n: S.N, ok, faux, manque, dur: Math.round(dur * 10) / 10, rate, acc,
    notes: S.notes.map((n, i) => ({ c: n.clef, p: n.p, v: v[i] ? v[i].v : null, h: v[i] ? (v[i].cls ?? v[i].midi ?? null) : null, t: v[i] && v[i].time !== undefined ? Math.round((v[i].time - t0) * 1000) : null })) });
}

function saveSession(rec) {
  try {
    const all = JSON.parse(localStorage.getItem('solfege.sessions') || '[]');
    all.push(rec);
    localStorage.setItem('solfege.sessions', JSON.stringify(all.slice(-400)));
  } catch (e) { /* stockage indisponible : la séance n'est pas conservée */ }
}

// Mode diagnostic (?debug) : partage du son de la séance tel que l'app l'a reçu, pour ajuster le modèle.
function wavBlob(chunks) {
  const n = chunks.reduce((a, c) => a + c.length, 0), b = new DataView(new ArrayBuffer(44 + 2 * n));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); b.setUint32(4, 36 + 2 * n, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 16000, true); b.setUint32(28, 32000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, 2 * n, true);
  let o = 44;
  for (const c of chunks) for (let i = 0; i < c.length; i++) { b.setInt16(o, c[i], true); o += 2; }
  return new Blob([b], { type: 'audio/wav' });
}
async function shareAudio() {
  if (!S || !S.pcm) return;
  const stamp = S.at.replace(/[:.]/g, '-');
  const meta = { at: S.at, rate: S.rate, tStart: S.tStart, attendu: S.notes.map((n) => SYLLABES[n.cls]), entendu: S.heard.map((c) => [Math.round(c.time * 1000), SYLLABES[c.cls], Math.round(c.conf * 100) / 100]), verdicts: verdicts().map((q) => (q ? q.v : null)) };
  const files = [new File([wavBlob(S.pcm)], `solfege-${stamp}.wav`, { type: 'audio/wav' }), new File([JSON.stringify(meta)], `solfege-${stamp}.json`, { type: 'application/json' })];
  try {
    if (navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  for (const f of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
  }
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
wireChoice('clef', 'clef');
if (navigator.requestMIDIAccess) {
  $('input').hidden = false;
  wireChoice('input', 'input', async (v) => {
    if (v !== 'midi') { say(''); return; }
    try { say((await midi.open()) ? '' : 'Aucun clavier MIDI détecté. Branche-le, puis choisis à nouveau « Au clavier ».'); }
    catch (e) { say('Accès MIDI refusé par le navigateur.'); }
  });
  if (prefs.input === 'midi') midi.open().catch(() => {});
} else {
  prefs.input = 'voix';
}
$('go').addEventListener('click', start);
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
$('quit').addEventListener('click', () => { if (S && !S.over) finish(); else { S = null; show('home'); } });
$('again').addEventListener('click', start);
$('done').addEventListener('click', () => { S = null; show('home'); });
$('share').addEventListener('click', shareAudio);
window.addEventListener('resize', render);
document.addEventListener('visibilitychange', () => { if (document.hidden && S && !S.over && S.input === 'voix') finish(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.__solfege = { get session() { return S; }, verdicts, onMidiNote };
