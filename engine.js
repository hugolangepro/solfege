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

// Détecteur de syllabes en flux : reçoit du son à 16 kHz, émet des candidats {frame, time, cls, conf}.
export class Recognizer {
  constructor(model, { thr = 0.3, half = 8 } = {}) {
    this.m = model; this.thr = thr; this.half = half;
    this.buf = new Float32Array(0); this.bufStart = 0; this.frame = 0;
    this.R = 64; this.mel = new Float64Array(this.R * model.n_mels);
    this.rms3 = [0, 0, 0];
    this.LW = model.level.window; this.med = new Float32Array(this.LW);
    this.steps = []; this.stepBase = 0;
    this.x = new Float64Array(model.A.length / model.nIn); this.z = new Float64Array(model.nIn);
    this.hid = new Float64Array(model.hidden); this.out = new Float64Array(model.nOut);
    this.re = new Float32Array(model.n_fft);
    this.onCandidate = null; this.onLevel = null; this.onStep = null;
  }
  get time() { return this.frame * this.m.hop / this.m.sr; }
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
    const nIn = m.nIn, z = this.z;
    for (let c = 0; c < nIn; c++) z[c] = m.b[c];
    for (let i = 0; i < T * nm; i++) { const v = x[i] - mean, o = i * nIn; for (let c = 0; c < nIn; c++) z[c] += v * m.A[o + c]; }
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
    const step = { frame: f, cls, conf };
    if (this.onStep) this.onStep(step);
    this.steps.push(step);
    // pic : au moins le seuil, pas dépassé dans le passé proche, strictement dominant sur le futur proche
    const h = this.half, n = this.steps.length - 1, i = n - h;
    if (i >= 0) {
      const s = this.steps[i];
      if (s.conf >= this.thr) {
        let ok = true;
        for (let j = Math.max(0, i - h); j < i && ok; j++) if (this.steps[j].conf > s.conf) ok = false;
        for (let j = i + 1; j <= n && ok; j++) if (this.steps[j].conf >= s.conf) ok = false;
        if (ok && this.onCandidate) this.onCandidate({ frame: s.frame, time: (s.frame * m.hop + m.n_fft / 2) / m.sr, cls: s.cls, conf: s.conf });
      }
      if (this.steps.length > 4 * h + 8) this.steps.splice(0, this.steps.length - (2 * h + 2));
    }
  }
}

// Suivi des notes attendues : alignement dynamique en ligne entre les syllabes entendues et la page.
export class Follower {
  constructor(expected, { SUB = 1, DEL = 1, maxSkip = 2 } = {}) {
    this.exp = expected; this.N = expected.length;
    this.SUB = SUB; this.DEL = DEL; this.maxSkip = maxSkip;
    this.cost = new Float64Array(this.N + 1).fill(Infinity); this.cost[0] = 0;
    this.prevCost = null; this.back = []; this.dets = [];
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
    this.prevCost = this.cost; this.cost = nw; this.back.push(bp); this.dets.push(d);
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
  // Dernière syllabe restée sans note alors qu'elle était nette : on la compte comme réponse (fausse).
  commitLast(minConf = 0.9) {
    const n = this.dets.length;
    if (!n || this.best() >= this.N) return false;
    const k = this.best(), [, op] = this.back[n - 1][k], d = this.dets[n - 1];
    if (op !== 'ins' || d.conf < minConf) return false;
    this.cost = this.prevCost; this.back.pop(); this.dets.pop();
    this.push(d, 2);
    return true;
  }
}

export const SYLLABES = ['do', 'ré', 'mi', 'fa', 'sol', 'la', 'si'];
