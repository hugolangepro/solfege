// Chant d'intervalles : choix des intervalles, place d'une hauteur chantée sur la portée, jugement de la tenue.
// Sans accès à la page ni au son : tout se teste sous Node.
import { centsToClass } from './pitch.js';

// Notes naturelles en clé de sol : position 0 sur la ligne du bas (mi), +1 par degré ; do sous la portée = −2.
const SEMIS = [0, 2, 4, 5, 7, 9, 11];
export const midiOf = (p) => { const d = p + 2; return 60 + 12 * Math.floor(d / 7) + SEMIS[((d % 7) + 7) % 7]; };

// Intervalles par niveau : [nombre de degrés, demi-tons]. Les notes restent naturelles, la qualité vient de leur place.
const M2 = [1, 2], M3 = [2, 4], P5 = [4, 7], P8 = [7, 12], P4 = [3, 5];
const TOUS = [[1, 1], M2, [2, 3], M3, P4, [3, 6], [4, 6], P5, [5, 8], [5, 9], [6, 10], [6, 11], P8];
export const NIVEAUX = [
  { nom: 'Niveau 1', texte: 'Secondes et tierces majeures, quintes, octaves, en montant.', jeu: [M2, M3, P5, P8], sens: [1] },
  { nom: 'Niveau 2', texte: 'Les mêmes et la quarte, en montant et en descendant.', jeu: [M2, M3, P4, P5, P8], sens: [1, -1] },
  { nom: 'Niveau 3', texte: 'Tous les intervalles entre notes naturelles, dans les deux sens.', jeu: TOUS, sens: [1, -1] },
];
const NOMS = { '1:1': 'seconde mineure', '1:2': 'seconde majeure', '2:3': 'tierce mineure', '2:4': 'tierce majeure', '3:5': 'quarte juste', '3:6': 'triton',
  '4:6': 'triton', '4:7': 'quinte juste', '5:8': 'sixte mineure', '5:9': 'sixte majeure', '6:10': 'septième mineure', '6:11': 'septième majeure', '7:12': 'octave' };
export function nomIntervalle(a, b) {
  const nom = NOMS[`${Math.abs(b - a)}:${Math.abs(midiOf(b) - midiOf(a))}`], e = nom === 'triton' ? '' : 'e';
  return `${nom} ${b > a ? 'montant' : 'descendant'}${e}`;
}

// n intervalles : {ref, cible} en positions sur la portée, entre le do sous la portée (−2) et le la au-dessus (10).
export function buildIntervals(niveau, n, rnd = Math.random) {
  const { jeu, sens } = NIVEAUX[niveau], out = [];
  const paires = [];
  for (let a = -2; a <= 10; a++) for (const [deg, st] of jeu) for (const s of sens) {
    const b = a + s * deg;
    if (b >= -2 && b <= 10 && Math.abs(midiOf(b) - midiOf(a)) === st) paires.push({ ref: a, cible: b, cle: `${deg}:${st}:${s}` });
  }
  // d'abord le type d'intervalle, puis une paire de ce type : chaque intervalle du niveau revient aussi souvent
  const types = [...new Set(paires.map((q) => q.cle))];
  let prev = null;
  while (out.length < n) {
    const t = types[Math.floor(rnd() * types.length)], choix = paires.filter((q) => q.cle === t);
    const q = choix[Math.floor(rnd() * choix.length)];
    if (prev && prev.ref === q.ref && prev.cible === q.cible) continue;
    out.push({ ref: q.ref, cible: q.cible }); prev = q;
  }
  return out;
}

// Position sur la portée (en degrés, fractionnaire) d'une hauteur MIDI quelconque : entre deux notes naturelles, on interpole.
export function staffPos(midi) {
  const o = Math.floor((midi - 60) / 12), s = midi - 60 - 12 * o, N = [...SEMIS, 12];
  let i = 0;
  while (i < 6 && s >= N[i + 1]) i++;
  return -2 + 7 * o + i + (s - N[i]) / (N[i + 1] - N[i]);
}

// Jugement d'une note chantée, sans chronomètre. Chaque appel reçoit une mesure de hauteur (toutes les 10 ms).
// La note compte quand la voix tient `holdMs` dans la bande de ±`tol` cents autour de la cible, à l'octave près :
// on écarte les `skipMs` premières millisecondes d'une émission (la voix cherche), on juge la médiane (le vibrato passe),
// et on demande une hauteur stable (un glissando qui traverse la bande ne compte pas).
export class Hold {
  constructor({ tol = 50, holdMs = 300, skipMs = 150, clarity = 0.75, rmsMin = 0.002, hopMs = 10, spread = 80 } = {}) {
    Object.assign(this, { tol, holdMs, skipMs, clarity, rmsMin, hopMs, spread });
    this.reset();
  }
  reset() { this.run = []; this.gap = 0; this.last = null; }
  // Rend { cents, voiced, done, median } : cents = écart à la cible replié à l'octave, null si la voix ne chante pas.
  push({ f0, clarity, rms }, midi) {
    const voiced = f0 > 0 && clarity >= this.clarity && rms >= this.rmsMin;
    if (!voiced) {
      if (++this.gap > 3) this.run = [];                        // plus de 30 ms sans voix : l'émission est finie
      return { cents: null, voiced: false, done: false, median: null };
    }
    const c = centsToClass(f0, midi);
    if (this.last !== null && this.gap <= 3 && Math.abs(c - this.last) > 150) this.run = [];   // saut de hauteur : nouvelle note
    this.gap = 0; this.last = c; this.run.push(c);
    const skip = Math.round(this.skipMs / this.hopMs), need = Math.round(this.holdMs / this.hopMs);
    let done = false, median = null;
    if (this.run.length >= skip + need) {
      const w = this.run.slice(-need).sort((a, b) => a - b);
      median = w[w.length >> 1];
      const lo = w[Math.floor(0.1 * (w.length - 1))], hi = w[Math.ceil(0.9 * (w.length - 1))];
      done = Math.abs(median) <= this.tol && hi - lo <= this.spread;
    }
    return { cents: c, voiced: true, done, median };
  }
}
