// Noms d'intervalles : découpe en énoncés, apprentissage d'une série et vérification, sur des « mots » de synthèse
// (suites de voyelles artificielles). L'essai sur une vraie voix est dans e2e_noms.py, hors dépôt.
import { Ecoute, Voix, traits, apprendre, emballer, deballer } from '../noms.js';
let ok = true;
const check = (nom, v, attendu) => { const bon = String(v) === String(attendu); ok = ok && bon; console.log(`${bon ? 'ok ' : 'ÉCHEC'} ${nom} : ${v}${bon ? '' : `  (attendu : ${attendu})`}`); };
let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
const sr = 16000;
// une « voyelle » : fondamentale à 120 Hz environ, harmoniques pesés par deux formants
function voyelle(dur, f1, f2, f0) {
  const n = Math.round(dur * sr), x = new Float32Array(n);
  for (let h = 1; h * f0 < 4000; h++) {
    const f = h * f0, a = Math.exp(-(((f - f1) / 180) ** 2)) + 0.7 * Math.exp(-(((f - f2) / 250) ** 2)) + 0.02;
    for (let i = 0; i < n; i++) x[i] += 0.05 * a * Math.sin(2 * Math.PI * f * i / sr) * Math.min(1, i / 300, (n - i) / 300);
  }
  return x;
}
const MOTS = [[[700, 1200], [300, 2300]], [[300, 2300], [700, 1200], [400, 900]], [[400, 900], [500, 1900]], [[500, 1500], [300, 800], [650, 1700]]];
const pcm = [], journal = [];
let t = 0;
const bruit = (dur) => Float32Array.from({ length: Math.round(dur * sr) }, () => 0.0006 * (rnd() * 2 - 1));
for (let rep = 0; rep < 4; rep++) for (let m = 0; m < MOTS.length; m++) {
  journal.push([Math.round(t * 1000), m]);
  pcm.push(bruit(0.6 + 0.3 * rnd())); const f0 = 110 + 25 * rnd();
  for (const [f1, f2] of MOTS[m]) pcm.push(voyelle(0.22 + 0.1 * rnd(), f1 * (0.97 + 0.06 * rnd()), f2 * (0.97 + 0.06 * rnd()), f0));
  pcm.push(bruit(1.0));
  t = pcm.reduce((a, b) => a + b.length, 0) / sr;
}
const ex = apprendre(pcm, journal, 2500);
check('énoncés trouvés, un par nom affiché', ex.length, 16);
const E = ex.map((e) => ({ cls: e.cls, f: traits(deballer(emballer(e.c))) })), r = new Voix(E).verifier();
check('chaque exemple retrouve son nom parmi les autres', `${r.ok}/${r.n}`, '16/16');
const ec = new Ecoute(); let n = 0; ec.onEnonce = () => { n++; }; ec.push(bruit(5));
check('cinq secondes de fond sonore : aucun énoncé', n, 0);
const c = ex[0].c, d = deballer(emballer(c));
check('stockage sur un octet : même nombre de trames', d.length, c.length);
process.exit(ok ? 0 : 1);
