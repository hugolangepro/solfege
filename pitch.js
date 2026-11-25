// Hauteur de la voix en flux : reçoit du son à 16 kHz, donne tous les 10 ms la fréquence fondamentale et sa netteté.
// Méthode de McLeod (autocorrélation normalisée, « NSDF ») après un filtre passe-bas à 1 kHz : il ne garde que la
// fondamentale et ses premières harmoniques, sans quoi les formants d'une voyelle parlée, dont la hauteur glisse, brouillent la mesure.
// La netteté vaut 1 pour un son parfaitement périodique (voyelle tenue), elle est proche de 0 pour un bruit ou un choc.
// Fenêtre : 64 ms pour une note tenue (chant), 32 ms pour suivre une syllabe parlée.
export class Pitch {
  constructor({ sr = 16000, win = 1024, hop = 160, fmin = 70, fmax = 1000, cut = 0.9, lowpass = 1000 } = {}) {
    this.sr = sr; this.W = win; this.hop = hop; this.cut = cut;
    // passe-bas de Butterworth d'ordre 4 : deux cellules du second ordre en cascade
    this.sos = [0.541196100146197, 1.3065629648763766].map((q) => {
      const w = 2 * Math.PI * lowpass / sr, al = Math.sin(w) / 2 * q, c = Math.cos(w), a0 = 1 + al;
      return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: -2 * c / a0, a2: (1 - al) / a0, z1: 0, z2: 0 };
    });
    this.tmin = Math.max(2, Math.floor(sr / fmax)); this.tmax = Math.min(win - 2, Math.ceil(sr / fmin));
    this.buf = new Float32Array(0); this.start = 0; this.frame = 0;
    this.x = new Float64Array(win); this.nsdf = new Float64Array(this.tmax + 2);
    this.keep = 256; this.f0 = new Float32Array(this.keep); this.cl = new Float32Array(this.keep); this.rms = new Float32Array(this.keep);
    this.onPitch = null;
  }
  // Trame p : échantillons [p·hop, p·hop + win). Son centre tombe 32 ms après son début.
  time(p) { return (p * this.hop + this.W / 2) / this.sr; }
  push(samples) {
    const nb = new Float32Array(this.buf.length + samples.length);
    nb.set(this.buf);
    for (let i = 0, o = this.buf.length; i < samples.length; i++) {
      let v = samples[i];
      for (const f of this.sos) { const y = f.b0 * v + f.z1; f.z1 = f.b1 * v - f.a1 * y + f.z2; f.z2 = f.b2 * v - f.a2 * y; v = y; }
      nb[o + i] = v;
    }
    this.buf = nb;
    while (this.start + this.buf.length >= this.frame * this.hop + this.W) {
      this._frame(this.frame * this.hop - this.start);
      this.frame++;
    }
    const drop = Math.min(this.buf.length, this.frame * this.hop - this.start);
    if (drop > 0) { this.buf = this.buf.slice(drop); this.start += drop; }
  }
  // Dernières valeurs gardées (256 trames) : fréquence en Hz (0 si rien de net), netteté, niveau efficace.
  at(p) { const i = ((p % this.keep) + this.keep) % this.keep; return p < 0 || p >= this.frame || p < this.frame - this.keep ? null : { f0: this.f0[i], clarity: this.cl[i], rms: this.rms[i] }; }
  _frame(off) {
    const W = this.W, x = this.x, nsdf = this.nsdf, tmin = this.tmin, tmax = this.tmax;
    let mean = 0;
    for (let j = 0; j < W; j++) mean += this.buf[off + j];
    mean /= W;
    let e = 0;
    for (let j = 0; j < W; j++) { const v = this.buf[off + j] - mean; x[j] = v; e += v * v; }
    const rms = Math.sqrt(e / W);
    let f0 = 0, clarity = 0;
    if (e > 1e-12) {
      // énergie des deux morceaux qui se recouvrent, mise à jour d'un décalage au suivant
      let m = 2 * e;
      for (let t = 1; t < tmin - 1; t++) m -= x[t - 1] * x[t - 1] + x[W - t] * x[W - t];
      for (let t = Math.max(1, tmin - 1); t <= tmax + 1; t++) {
        m -= x[t - 1] * x[t - 1] + x[W - t] * x[W - t];
        let r = 0;
        for (let j = 0, n = W - t; j < n; j++) r += x[j] * x[j + t];
        nsdf[t] = m > 1e-12 ? 2 * r / m : 0;
      }
      // sommets locaux ; le premier qui atteint `cut` fois le plus haut donne la période (évite l'octave du dessous)
      let best = 0;
      for (let t = tmin; t <= tmax; t++) if (nsdf[t] > nsdf[t - 1] && nsdf[t] >= nsdf[t + 1] && nsdf[t] > best) best = nsdf[t];
      if (best > 0) {
        for (let t = tmin; t <= tmax; t++) {
          if (nsdf[t] > nsdf[t - 1] && nsdf[t] >= nsdf[t + 1] && nsdf[t] >= this.cut * best) {
            const a = nsdf[t - 1], b = nsdf[t], c = nsdf[t + 1], den = a - 2 * b + c;
            const d = den < 0 ? 0.5 * (a - c) / den : 0;           // sommet de la parabole passant par les trois points
            f0 = this.sr / (t + d); clarity = b - 0.25 * (a - c) * d;
            break;
          }
        }
      }
    }
    const i = this.frame % this.keep;
    this.f0[i] = f0; this.cl[i] = clarity; this.rms[i] = rms;
    if (this.onPitch) this.onPitch({ frame: this.frame, time: this.time(this.frame), f0, clarity, rms });
  }
}

// Écart en cents entre une fréquence et une note MIDI, replié à l'octave la plus proche (−600 à +600).
export function centsToClass(f0, midi) {
  const c = 1200 * Math.log2(f0 / 440) - 100 * (midi - 69);
  return c - 1200 * Math.round(c / 1200);
}
