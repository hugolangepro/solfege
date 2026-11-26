// Noms d'intervalles dits à voix haute : la reconnaissance s'apprend sur l'appareil, à partir d'une série enregistrée
// par l'utilisateur. Chaque nom dit est comparé aux exemples appris par alignement temporel (DTW) ; rien ne quitte l'appareil.
// Sans accès à la page ni au son : tout se teste sous Node.
const SR = 16000, WIN = 400, HOP = 160, NFFT = 512, NMEL = 40, NC = 12;

// ---- spectre : fenêtre de 25 ms toutes les 10 ms, 40 bandes mel, 12 coefficients cepstraux ----
const HAM = Float32Array.from({ length: WIN }, (_, i) => 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (WIN - 1)));
const COS = Float64Array.from({ length: NFFT / 2 }, (_, i) => Math.cos(2 * Math.PI * i / NFFT));
const SIN = Float64Array.from({ length: NFFT / 2 }, (_, i) => Math.sin(2 * Math.PI * i / NFFT));
const REV = Uint16Array.from({ length: NFFT }, (_, i) => { let r = 0; for (let b = 0; b < 9; b++) r |= ((i >> b) & 1) << (8 - b); return r; });
function fft(re, im) {
  for (let i = 0; i < NFFT; i++) { const j = REV[i]; if (j > i) { const t = re[i]; re[i] = re[j]; re[j] = t; } }
  for (let size = 2; size <= NFFT; size <<= 1) {
    const half = size >> 1, step = NFFT / size;
    for (let i = 0; i < NFFT; i += size) for (let k = 0; k < half; k++) {
      const c = COS[k * step], s = -SIN[k * step], a = i + k, b = a + half;
      const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
}
const MEL = (() => {
  const m = (f) => 2595 * Math.log10(1 + f / 700), im = (v) => 700 * (10 ** (v / 2595) - 1);
  const pts = Array.from({ length: NMEL + 2 }, (_, i) => Math.floor((NFFT + 1) * im(m(100) + (m(7600) - m(100)) * i / (NMEL + 1)) / SR));
  return Array.from({ length: NMEL }, (_, i) => {
    const [a, b, c] = [pts[i], pts[i + 1], pts[i + 2]], w = [];
    for (let k = a; k < b; k++) w.push([k, (k - a) / Math.max(1, b - a)]);
    for (let k = b; k < c; k++) w.push([k, (c - k) / Math.max(1, c - b)]);
    return w;
  });
})();
const DCT = Array.from({ length: NC }, (_, k) => Float64Array.from({ length: NMEL }, (_, n) => Math.sqrt(2 / NMEL) * Math.cos(Math.PI * (k + 1) * (2 * n + 1) / (2 * NMEL))));

// ---- écoute : découpe le son en énoncés (un nom dit d'un trait) et rend les coefficients de chacun ----
// Un énoncé commence quand le niveau dépasse le fond de `ecartDb` trois trames de suite ; il finit après `finMs` de silence.
export class Ecoute {
  constructor({ ecartDb = 15, finMs = 320, minMs = 200, maxMs = 3000, avant = 8 } = {}) {
    Object.assign(this, { ecartDb, fin: Math.round(finMs / 10), min: Math.round(minMs / 10), max: Math.round(maxMs / 10), avant });
    this.buf = new Float32Array(WIN); this.n = 0; this.prev = 0; this.trame = 0; this.fond = null; this.niveau = 0;
    this.pre = []; this.cur = null; this.haut = 0; this.bas = 0;
    this.re = new Float64Array(NFFT); this.im = new Float64Array(NFFT);
    this.onEnonce = null;
  }
  push(x) {
    for (let i = 0; i < x.length; i++) {
      this.buf[this.n++] = x[i];
      if (this.n === WIN) { this.analyse(); this.buf.copyWithin(0, HOP); this.n = WIN - HOP; }
    }
  }
  analyse() {
    const { buf, re, im } = this;
    let e = 0;
    for (let i = WIN - HOP; i < WIN; i++) e += buf[i] * buf[i];
    const db = 10 * Math.log10(e / HOP + 1e-10);
    this.niveau = Math.sqrt(e / HOP);
    // préaccentuation, fenêtre, spectre de puissance, bandes mel, cepstre
    re.fill(0); im.fill(0);
    for (let i = 0; i < WIN; i++) re[i] = (buf[i] - 0.97 * (i ? buf[i - 1] : this.prev)) * HAM[i];
    this.prev = buf[HOP - 1];
    fft(re, im);
    const lm = new Float64Array(NMEL), c = new Float32Array(NC);
    for (let b = 0; b < NMEL; b++) { let s = 0; for (const [k, w] of MEL[b]) s += w * (re[k] * re[k] + im[k] * im[k]); lm[b] = Math.log(s + 1e-8); }
    for (let k = 0; k < NC; k++) { let s = 0; for (let b = 0; b < NMEL; b++) s += DCT[k][b] * lm[b]; c[k] = s; }
    const t = this.trame++;
    // fond sonore : descend vite vers le niveau du moment (0,1 s), remonte lentement (2 s), et pas pendant un énoncé
    if (this.fond === null) this.fond = Math.max(db, -80);
    else if (db < this.fond) this.fond += 0.1 * (Math.max(db, -80) - this.fond);
    else if (!this.cur) this.fond += 0.005 * (db - this.fond);
    const fort = db > this.fond + this.ecartDb;
    if (!this.cur) {
      this.pre.push(c); if (this.pre.length > this.avant + 3) this.pre.shift();
      this.haut = fort ? this.haut + 1 : 0;
      if (this.haut >= 3) { this.cur = { c: this.pre.slice(), t0: t - 2, dernier: t }; this.pre = []; this.bas = 0; }
      return;
    }
    this.cur.c.push(c);
    if (fort) { this.cur.dernier = t; this.bas = 0; } else this.bas += 1;
    if (this.bas >= this.fin || t - this.cur.t0 >= this.max) {
      const u = this.cur; this.cur = null; this.haut = 0;
      u.c.length = Math.max(1, u.c.length - Math.max(0, this.bas - this.avant));     // on garde `avant` trames de silence à la fin
      if (u.dernier - u.t0 >= this.min && this.onEnonce) this.onEnonce({ c: u.c, t0: u.t0 / 100, t1: u.dernier / 100 });
    }
  }
}

// ---- comparaison ----
// Traits d'un énoncé : coefficients centrés sur leur moyenne (le micro et la pièce s'effacent) et leurs dérivées.
export function traits(c) {
  const n = c.length, m = new Float64Array(NC);
  for (const f of c) for (let k = 0; k < NC; k++) m[k] += f[k] / n;
  const z = c.map((f) => Float32Array.from(f, (v, k) => v - m[k]));
  return z.map((f, i) => {
    const a = z[Math.max(0, i - 1)], b = z[Math.min(n - 1, i + 1)], d = (Math.min(n - 1, i + 1) - Math.max(0, i - 1)) || 1, o = new Float32Array(2 * NC);
    for (let k = 0; k < NC; k++) { o[k] = f[k]; o[NC + k] = 2 * (b[k] - a[k]) / d; }
    return o;
  });
}
// Distance entre deux énoncés : alignement temporel dans une bande, coût moyen par pas. Abandon au-delà de `plafond`.
export function dtw(a, b, plafond = Infinity) {
  const n = a.length, m = b.length, w = Math.max(Math.abs(n - m) + 8, Math.round(0.35 * Math.max(n, m))), D = 2 * NC;
  let prev = new Float64Array(m + 1).fill(Infinity), cur = new Float64Array(m + 1);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    cur.fill(Infinity);
    const c = Math.floor(i * m / n), j0 = Math.max(1, c - w), j1 = Math.min(m, c + w), x = a[i - 1];
    let mini = Infinity;
    for (let j = j0; j <= j1; j++) {
      const y = b[j - 1];
      let d = 0;
      for (let k = 0; k < D; k++) { const q = x[k] - y[k]; d += q * q; }
      const v = Math.sqrt(d) + Math.min(prev[j], cur[j - 1], prev[j - 1]);
      cur[j] = v; if (v < mini) mini = v;
    }
    if (mini / (n + m) > plafond) return Infinity;
    [prev, cur] = [cur, prev];
  }
  return prev[m] / (n + m);
}

// Voix apprise : des exemples { cls, f } (f = traits). Le score d'un nom est la moyenne de ses deux exemples les plus
// proches (un seul exemple voisin par hasard ne suffit pas) ; classer() rend le meilleur nom, son score, et le score du
// deuxième nom. `sauf` écarte un exemple (vérification de chaque exemple contre tous les autres).
export class Voix {
  constructor(exemples) { this.ex = exemples; }
  classer(f, sauf = -1) {
    const par = new Map();
    this.ex.forEach((e, i) => {
      if (i === sauf) return;
      const d = dtw(f, e.f), a = par.get(e.cls) || [Infinity, Infinity];
      if (d < a[0]) { a[1] = a[0]; a[0] = d; } else if (d < a[1]) a[1] = d;
      par.set(e.cls, a);
    });
    let cls = -1, dist = Infinity, autre = Infinity;
    for (const [c, a] of par) {
      const v = a[1] === Infinity ? a[0] : (a[0] + a[1]) / 2;
      if (v < dist) { autre = dist; dist = v; cls = c; } else if (v < autre) autre = v;
    }
    return { cls, dist, autre };
  }
  // Les exemples à partir du rang `depuis`, chacun contre tous les autres : combien retrouvent leur nom, et le plus grand score d'un nom retrouvé.
  verifier(depuis = 0) {
    let ok = 0, loin = 0;
    for (let i = depuis; i < this.ex.length; i++) {
      const r = this.classer(this.ex[i].f, i);
      if (r.cls === this.ex[i].cls) { ok += 1; if (r.dist > loin) loin = r.dist; }
    }
    return { ok, n: this.ex.length - depuis, loin };
  }
}

// Apprend une série : le son (16 kHz) et le journal [[instant d'affichage en ms, rang du nom]]. Pour chaque nom affiché,
// le premier énoncé commencé pendant son affichage. Rend les exemples { cls, c } (coefficients bruts).
export function apprendre(blocs, journal, periodeMs) {
  const ec = new Ecoute(), enonces = [];
  ec.onEnonce = (u) => enonces.push(u);
  for (const b of blocs) ec.push(b);
  ec.push(new Float32Array(SR / 2));                       // un peu de silence pour clore le dernier énoncé
  const out = [];
  journal.forEach(([ms, cls], k) => {
    const a = ms / 1000, b = k + 1 < journal.length ? journal[k + 1][0] / 1000 : a + periodeMs / 1000;
    const u = enonces.find((q) => q.t0 >= a && q.t0 < b);
    if (u && cls >= 0) out.push({ cls, c: u.c });
  });
  return out;
}

// Pour garder les exemples sur l'appareil : coefficients centrés, sur un octet chacun.
export function emballer(c) {
  const n = c.length, m = new Float64Array(NC);
  for (const f of c) for (let k = 0; k < NC; k++) m[k] += f[k] / n;
  let s = '';
  for (const f of c) for (let k = 0; k < NC; k++) s += String.fromCharCode(128 + Math.max(-127, Math.min(127, Math.round((f[k] - m[k]) * 4))));
  return btoa(s);
}
export function deballer(t) {
  const s = atob(t), c = [];
  for (let i = 0; i + NC <= s.length; i += NC) c.push(Float32Array.from({ length: NC }, (_, k) => (s.charCodeAt(i + k) - 128) / 4));
  return c;
}
