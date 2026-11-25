// Moteur d'écoute : rééchantillonnage, log-mel, modèle vocal, détection des syllabes, suivi des notes attendues.
// Aucune dépendance. Fonctionne dans le navigateur et sous Node (tests).

const b64f32 = (s) => {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(u8.buffer);
};

export function loadModel(j) {
  const m = { ...j };
  for (const k of ['window', 'fb', 'A', 'b', 'W1', 'b1', 'W2', 'b2']) m[k] = b64f32(j[k]);
  const N = m.n_fft, nb = N / 2 + 1;
  m.nBins = nb;
  // bornes utiles du spectre : bins portés par au moins un filtre mel
  let kmin = nb, kmax = 0;
  for (let k = 0; k < nb; k++) {
    let any = false;
    for (let j2 = 0; j2 < m.n_mels; j2++) if (m.fb[j2 * nb + k] > 0) { any = true; break; }
    if (any) { if (k < kmin) kmin = k; if (k > kmax) kmax = k; }
  }
  m.kmin = kmin; m.kmax = kmax;
  m.cosT = new Float32Array(nb * N); m.sinT = new Float32Array(nb * N);
  for (let k = kmin; k <= kmax; k++) for (let n = 0; n < N; n++) {
    const a = 2 * Math.PI * k * n / N;
    m.cosT[k * N + n] = Math.cos(a); m.sinT[k * N + n] = Math.sin(a);
  }
  let ws = 0; for (let n = 0; n < N; n++) ws += m.window[n];
  m.winNorm = 1 / (ws * ws);
  m.hidden = m.b1.length; m.nOut = m.b2.length; m.nIn = m.b.length;
  if (j.gate) {
    const g = { ...j.gate };
    for (const k of ['A', 'b', 'W1', 'b1', 'W2', 'b2']) g[k] = b64f32(j.gate[k]);
    g.k = g.b.length; g.h = g.b1.length;
    m.gate = g;
  }
  return m;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
function bessel0(x) { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; } return s; }

// Rééchantillonneur polyphasé (sinus cardinal fenêtré Kaiser) vers 16 kHz.
export class Resampler {
  constructor(inRate, outRate = 16000, K = 32) {
    const g = gcd(Math.round(inRate), outRate);
    this.up = outRate / g; this.down = Math.round(inRate) / g;
    this.bypass = this.up === 1 && this.down === 1;
    if (this.bypass) return;
    const fc = 0.5 * Math.min(1 / this.up, 1 / this.down) * 0.96;
    const half = K * Math.max(this.up, this.down);
    this.N = 2 * half + 1; this.h = new Float32Array(this.N);
    const beta = 9, i0b = bessel0(beta);
    for (let k = 0; k < this.N; k++) {
      const t = k - half;
      const s = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
      const r = t / half;
      this.h[k] = s * (bessel0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b) * this.up;
    }
    this.n = 0; this.base = 0; this.buf = new Float32Array(0);
  }
  process(input) {
    if (this.bypass) return input;
    const nb = new Float32Array(this.buf.length + input.length);
    nb.set(this.buf); nb.set(input, this.buf.length); this.buf = nb;
    const total = this.base + this.buf.length, out = [];
    const { up, down, N, h } = this;
    for (;;) {
      const t = this.n * down;
      const iMax = Math.floor(t / up);
      if (iMax >= total) break;
      const iMin = Math.max(this.base, Math.ceil((t - (N - 1)) / up));
      let acc = 0;
      for (let i = iMin; i <= iMax; i++) acc += this.buf[i - this.base] * h[t - i * up];
      out.push(acc); this.n++;
    }
    const keep = Math.max(0, Math.ceil((this.n * down - (N - 1)) / up));
    const drop = Math.min(this.buf.length, Math.max(0, keep - this.base));
    if (drop > 0) { this.buf = this.buf.slice(drop); this.base += drop; }
    return Float32Array.from(out);
  }
}

// Règles d'émission d'une détection, sur la probabilité de la meilleure syllabe calculée tous les 20 ms :
// - précoce : dès `run` pas de suite au-dessus de `hi` pour la même syllabe, sans attendre le sommet ;
// - sommet : maximum local au-dessus de `thr`, confirmé `half` pas plus tard (pour les syllabes moins nettes).
// Une détection nette (≥ strong) bloque les suivantes de la même syllabe pendant `refr` pas et tant que
// la probabilité n'est pas retombée (autre syllabe ou < lo) : une syllabe dite ne compte qu'une fois.
class Emitter {
  constructor({ thr = 0.3, half = 8, hi = 0.95, run = 2, lo = 0.5, refr = 10, strong = 0.9 } = {}) {
    this.thr = thr; this.half = half; this.hi = hi; this.run = run; this.lo = lo; this.refr = refr; this.strong = strong;
    this.steps = []; this.n0 = 0;                 // derniers pas, et rang du premier gardé
    this.last = new Array(7).fill(null);          // par syllabe : {a: rang du pas, conf} de la dernière détection
    this.rel = new Array(7).fill(-1);             // par syllabe : rang du premier relâchement depuis, ou -1
    this.early = [];                              // rangs des dernières détections précoces
  }
  _blocked(c, idx) {
    const L = this.last[c];
    if (!L || L.conf < this.strong) return false;
    if (idx - L.a < this.refr) return true;
    return this.rel[c] < 0 || this.rel[c] > idx;
  }
  // Reçoit un pas {frame, cls, conf}, rend les détections qu'il déclenche : [{frame, cls, conf, early}].
  step(step) {
    const out = [], st = this.steps, h = this.half;
    st.push(step);
    if (st.length > 4 * h + 8) { const drop = st.length - (2 * h + 2); st.splice(0, drop); this.n0 += drop; }
    const n0 = this.n0, n = n0 + st.length - 1;                 // rang de ce pas depuis le début
    // relâchement : la syllabe détectée a cédé la place
    for (let c = 0; c < 7; c++) {
      const L = this.last[c];
      if (L && this.rel[c] < 0 && n > L.a && (step.cls !== c || step.conf < this.lo)) this.rel[c] = n;
    }
    // règle précoce
    if (this.hi !== null && st.length >= this.run) {
      let ok = true, mx = 0;
      for (let q = 0; q < this.run; q++) {
        const s = st[st.length - 1 - q];
        if (s.conf < this.hi || s.cls !== step.cls) { ok = false; break; }
        if (s.conf > mx) mx = s.conf;
      }
      const a = n - this.run + 1;
      if (ok && !this._blocked(step.cls, a)) {
        out.push({ frame: st[a - n0].frame, cls: step.cls, conf: mx, early: true });
        this.last[step.cls] = { a, conf: mx }; this.rel[step.cls] = -1;
        this.early.push(a); if (this.early.length > 4) this.early.shift();
      }
    }
    // règle du sommet : au moins le seuil, pas dépassé dans le passé proche, strictement dominant sur le futur proche
    const i = n - h;
    if (i < n0) return out;
    const s = st[i - n0];
    if (s.conf < this.thr) return out;
    for (let j = Math.max(n0, i - h); j < i; j++) if (st[j - n0].conf > s.conf) return out;
    for (let j = i + 1; j <= n; j++) if (st[j - n0].conf >= s.conf) return out;
    if (this.early.some((e) => i < e && e <= n)) return out;      // une détection précoce a démarré pendant l'attente : elle l'emporte
    if (this._blocked(s.cls, i)) return out;
    out.push({ frame: s.frame, cls: s.cls, conf: s.conf, early: false });
    this.last[s.cls] = { a: i, conf: s.conf }; this.rel[s.cls] = -1;
    for (let j = i + 1; j <= n; j++) { const q = st[j - n0]; if (q.cls !== s.cls || q.conf < this.lo) { this.rel[s.cls] = j; break; } }
    return out;
  }
}

// Détecteur de syllabes en flux : reçoit du son à 16 kHz, émet des détections {frame, time, cls, conf, early}.
// Deux petits réseaux lisent la même image de 300 ms : le modèle des syllabes (laquelle ?) et, s'il est fourni,
// le filtre (est-ce une syllabe dite, ou un autre son : touche de clavier, choc, souffle ?). Une détection n'est émise
// par onCandidate que si le filtre laisse passer ses pas. onRaw reçoit les détections du modèle des syllabes seul :
// l'app s'en sert pour vérifier que le filtre n'écarte pas la voix.
export class Recognizer {
  constructor(model, opts = {}) {
    this.m = model;
    this.em = new Emitter(opts);
    this.raw = model.gate ? new Emitter(opts) : null;
    this.tau = opts.tau ?? (model.gate ? model.gate.tau : 0);
    this.buf = new Float32Array(0); this.bufStart = 0; this.frame = 0;
    this.R = 64; this.mel = new Float64Array(this.R * model.n_mels);
    this.rms3 = [0, 0, 0];
    this.LW = model.level.window; this.med = new Float32Array(this.LW);
    this.x = new Float64Array(model.A.length / model.nIn); this.z = new Float64Array(model.nIn);
    this.hid = new Float64Array(model.hidden); this.out = new Float64Array(model.nOut);
    if (model.gate) { this.gz = new Float64Array(model.gate.k); this.gh = new Float64Array(model.gate.h); }
    this.re = new Float32Array(model.n_fft);
    this.onCandidate = null; this.onRaw = null; this.onLevel = null; this.onStep = null;
  }
  get time() { return this.frame * this.m.hop / this.m.sr; }
  get clock() { return (this.frame * this.m.hop + this.m.n_fft) / this.m.sr; }   // fin de la trame en cours de calcul
  push(samples) {
    const nb = new Float32Array(this.buf.length + samples.length);
    nb.set(this.buf); nb.set(samples, this.buf.length); this.buf = nb;
    const { hop, n_fft } = this.m;
    while (this.bufStart + this.buf.length >= this.frame * hop + n_fft) {
      this._frame(this.frame * hop - this.bufStart);
      this.frame++;
    }
    const drop = Math.min(this.buf.length, this.frame * hop - this.bufStart);
    if (drop > 0) { this.buf = this.buf.slice(drop); this.bufStart += drop; }
  }
  _frame(off) {
    const m = this.m, N = m.n_fft, nb = m.nBins, k0 = this.frame, w = this.re;
    let e = 0;
    for (let n = 0; n < N; n++) { const v = this.buf[off + n]; e += v * v; w[n] = v * m.window[n]; }
    const rms = Math.sqrt(e / N);
    const row = (k0 % this.R) * m.n_mels;
    for (let j = 0; j < m.n_mels; j++) this.mel[row + j] = 0;
    for (let k = m.kmin; k <= m.kmax; k++) {
      let re = 0, im = 0; const o = k * N;
      for (let n = 0; n < N; n++) { re += w[n] * m.cosT[o + n]; im += w[n] * m.sinT[o + n]; }
      const p = (re * re + im * im) * m.winNorm;
      for (let j = 0; j < m.n_mels; j++) { const f = m.fb[j * nb + k]; if (f > 0) this.mel[row + j] += f * p; }
    }
    // niveau : médiane sur 3 trames, puis maximum glissant sur 6 s
    this.rms3[0] = this.rms3[1]; this.rms3[1] = this.rms3[2]; this.rms3[2] = rms;
    let med;
    if (k0 === 0) med = rms; else if (k0 === 1) med = this.rms3[1];
    else { const [a, b, c] = this.rms3; med = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)); }
    this.med[k0 % this.LW] = med;
    if (this.onLevel && k0 % 4 === 0) this.onLevel(rms);
    const f = k0 - (m.post - 1);
    if (f >= m.pre && f % 2 === 0) this._anchor(f, k0);
  }
  _anchor(f, k0) {
    const m = this.m, nm = m.n_mels, T = m.pre + m.post, x = this.x;
    let L = 0; const cnt = Math.min(k0 + 1, this.LW);
    for (let i = 0; i < cnt; i++) if (this.med[i] > L) L = this.med[i];
    const g = Math.min(Math.max(m.level.target / Math.max(L, 1e-9), m.level.gmin), m.level.gmax), g2 = g * g;
    let mean = 0;
    for (let t = 0; t < T; t++) {
      const row = ((f - m.pre + t) % this.R) * nm;
      for (let j = 0; j < nm; j++) { const v = Math.log(g2 * this.mel[row + j] + 1e-10); x[t * nm + j] = v; mean += v; }
    }
    mean /= T * nm;
    for (let i = 0; i < T * nm; i++) x[i] -= mean;
    // modèle des syllabes
    const nIn = m.nIn, z = this.z;
    for (let c = 0; c < nIn; c++) z[c] = m.b[c];
    for (let i = 0; i < T * nm; i++) { const v = x[i], o = i * nIn; for (let c = 0; c < nIn; c++) z[c] += v * m.A[o + c]; }
    const H = m.hidden, hid = this.hid;
    for (let u = 0; u < H; u++) hid[u] = m.b1[u];
    for (let c = 0; c < nIn; c++) { const v = z[c], o = c * H; for (let u = 0; u < H; u++) hid[u] += v * m.W1[o + u]; }
    const Q = m.nOut, out = this.out;
    for (let q = 0; q < Q; q++) out[q] = m.b2[q];
    for (let u = 0; u < H; u++) { const v = hid[u]; if (v > 0) { const o = u * Q; for (let q = 0; q < Q; q++) out[q] += v * m.W2[o + q]; } }
    let mx = -Infinity; for (let q = 0; q < Q; q++) if (out[q] > mx) mx = out[q];
    let sum = 0; for (let q = 0; q < Q; q++) { out[q] = Math.exp(out[q] - mx); sum += out[q]; }
    let cls = 0, conf = -1;
    for (let q = 0; q < Q - 1; q++) { const p = out[q] / sum; if (p > conf) { conf = p; cls = q; } }
    // filtre : probabilité que l'image soit une syllabe dite
    let voice = 1;
    const G = m.gate;
    if (G) {
      const gz = this.gz, gh = this.gh, K = G.k, Hg = G.h;
      for (let c = 0; c < K; c++) gz[c] = G.b[c];
      for (let i = 0; i < T * nm; i++) { const v = x[i], o = i * K; for (let c = 0; c < K; c++) gz[c] += v * G.A[o + c]; }
      for (let u = 0; u < Hg; u++) gh[u] = G.b1[u];
      for (let c = 0; c < K; c++) { const v = gz[c], o = c * Hg; for (let u = 0; u < Hg; u++) gh[u] += v * G.W1[o + u]; }
      let y = G.b2[0];
      for (let u = 0; u < Hg; u++) if (gh[u] > 0) y += gh[u] * G.W2[u];
      voice = 1 / (1 + Math.exp(-y));
    }
    const step = { frame: f, cls, conf, voice };
    if (this.onStep) this.onStep(step);
    const emit = (cb, d) => { if (cb) cb({ frame: d.frame, time: (d.frame * m.hop + m.n_fft / 2) / m.sr, cls: d.cls, conf: d.conf, early: d.early }); };
    for (const d of this.em.step({ frame: f, cls, conf: voice >= this.tau ? conf : 0 })) emit(this.onCandidate, d);
    if (this.raw) for (const d of this.raw.step({ frame: f, cls, conf })) emit(this.onRaw, d);
  }
}

// Suivi des notes attendues : alignement dynamique en ligne entre les syllabes entendues et la page.
export class Follower {
  constructor(expected, { SUB = 1, DEL = 1, maxSkip = 2 } = {}) {
    this.exp = expected; this.N = expected.length;
    this.SUB = SUB; this.DEL = DEL; this.maxSkip = maxSkip;
    this.cost = new Float64Array(this.N + 1).fill(Infinity); this.cost[0] = 0;
    this.back = []; this.dets = []; this.ins = [];
  }
  static insCost(d) { return 0.3 + 0.6 * d.conf; }
  push(d, insCost) {
    const N = this.N, c = d.cls, ins = insCost ?? Follower.insCost(d);
    const nw = new Float64Array(N + 1).fill(Infinity), bp = new Array(N + 1).fill(null);
    for (let k = 0; k <= N; k++) {
      const ck = this.cost[k];
      if (!Number.isFinite(ck)) continue;
      let v = ck + ins;
      if (v < nw[k]) { nw[k] = v; bp[k] = [k, 'ins', 0]; }
      for (let skip = 0; skip <= this.maxSkip; skip++) {
        const j = k + skip;
        if (j >= N) break;
        const ok = c === this.exp[j];
        v = ck + skip * this.DEL + (ok ? 0 : this.SUB);
        if (v < nw[j + 1] - 1e-12) { nw[j + 1] = v; bp[j + 1] = [k, ok ? 'ok' : 'sub', skip]; }
      }
    }
    this.cost = nw; this.back.push(bp); this.dets.push(d); this.ins.push(insCost ?? null);
  }
  best() {
    let bk = 0, bv = Infinity;
    for (let k = 0; k <= this.N; k++) { const v = this.cost[k] + 1e-6 * (this.N - k); if (v < bv) { bv = v; bk = k; } }
    return bk;
  }
  // État de chaque note : null (pas encore lue) ou {v: 'ok' | 'faux' | 'manque', cls, time, conf}
  verdicts() {
    const v = new Array(this.N).fill(null);
    let k = this.best();
    for (let i = this.back.length - 1; i >= 0; i--) {
      const [kp, op, skip] = this.back[i][k];
      if (op !== 'ins') {
        const j = kp + skip, d = this.dets[i];
        v[j] = { v: op === 'ok' ? 'ok' : 'faux', cls: d.cls, time: d.time, conf: d.conf };
        for (let q = kp; q < j; q++) v[q] = { v: 'manque' };
      }
      k = kp;
    }
    return v;
  }
  // Les k dernières détections du meilleur chemin, de la plus ancienne à la plus récente : {op: 'ok' | 'sub' | 'ins', note, det}.
  tail(k) {
    const out = [];
    let c = this.best();
    for (let i = this.back.length - 1; i >= 0 && out.length < k; i--) {
      const [kp, op, skip] = this.back[i][c];
      out.push({ op, note: op === 'ins' ? null : kp + skip, det: this.dets[i] });
      c = kp;
    }
    return out.reverse();
  }
  // Syllabe nette restée sans note en fin de chemin : {note, det}, ou null. C'est une réponse fausse probable :
  // l'app colore la note tout de suite, et l'alignement tranche à la syllabe suivante (correction ou note suivante).
  pending(minConf = 0.9) {
    let k = this.best();
    if (k >= this.N) return null;
    const note = k;
    for (let i = this.back.length - 1; i >= 0; i--) {
      const [kp, op] = this.back[i][k];
      if (op !== 'ins') return null;
      if (this.dets[i].conf >= minConf) return { note, det: this.dets[i], index: i };
      k = kp;
    }
    return null;
  }
  // Après un silence, la syllabe en attente compte comme réponse : l'alignement est rejoué sans pouvoir l'écarter.
  commitPending(minConf = 0.9) {
    const p = this.pending(minConf);
    if (!p) return false;
    const dets = this.dets, ins = this.ins;
    ins[p.index] = 2;
    this.cost = new Float64Array(this.N + 1).fill(Infinity); this.cost[0] = 0;
    this.back = []; this.dets = []; this.ins = [];
    for (let q = 0; q < dets.length; q++) this.push(dets[q], ins[q] ?? undefined);
    return true;
  }
}

export const SYLLABES = ['do', 'ré', 'mi', 'fa', 'sol', 'la', 'si'];

// Suivi d'une lecture sans fin : le même alignement, sur une fenêtre de notes qui avance avec la lecture.
// attendu(i) rend la syllabe (0 à 6) de la note d'indice i. Quand `seuil` notes de la fenêtre sont lues, les verdicts des
// plus anciennes sont figés et la fenêtre repart `garde` notes avant la note en cours.
export class Suivi {
  constructor(attendu, { fen = 48, seuil = 24, garde = 8, ...opts } = {}) {
    this.att = attendu; this.fen = fen; this.seuil = seuil; this.garde = garde; this.opts = opts;
    this.base = 0; this.fixes = [];
    this.f = this.fenetre();
  }
  fenetre() {
    const e = [];
    for (let i = 0; i < this.fen; i++) e.push(this.att(this.base + i));
    return new Follower(e, this.opts);
  }
  avance() {
    const f = this.f, k = f.best();
    if (k < this.seuil) return;
    // État atteint après chaque syllabe le long de la meilleure lecture.
    const etats = new Array(f.dets.length);
    let c = k;
    for (let i = f.back.length - 1; i >= 0; i--) { etats[i] = c; c = f.back[i][c][0]; }
    // La fenêtre repart `garde` notes en arrière, et les syllabes dites depuis sont rejouées : deux lectures au coude à coude
    // sur les dernières notes (syllabe sans note, notes répétées) restent toutes les deux en lice.
    let i0 = etats.length - 1;
    while (i0 >= 0 && etats[i0] > k - this.garde) i0--;
    const nb = i0 < 0 ? 0 : etats[i0];
    if (nb <= 0) return;
    const v = f.verdicts();
    for (let i = 0; i < nb; i++) this.fixes.push(v[i] || { v: 'manque' });
    const dets = f.dets.slice(i0 + 1), ins = f.ins.slice(i0 + 1);
    this.base += nb; this.f = this.fenetre();
    dets.forEach((d, i) => this.f.push(d, ins[i] ?? undefined));
  }
  push(d, insCost) { this.f.push(d, insCost); this.avance(); }
  best() { return this.base + this.f.best(); }
  // Verdicts des notes d'indice a à b − 1 (null : pas encore lue).
  verdicts(a, b) {
    const v = this.f.verdicts(), out = [];
    for (let i = a; i < b; i++) out.push(i < this.base ? this.fixes[i] : (v[i - this.base] ?? null));
    return out;
  }
  tail(k) { return this.f.tail(k).map((q) => ({ ...q, note: q.note === null ? null : q.note + this.base })); }
  pending(minConf) { const p = this.f.pending(minConf); return p ? { ...p, note: p.note + this.base } : null; }
  commitPending(minConf) { const r = this.f.commitPending(minConf); if (r) this.avance(); return r; }
}
