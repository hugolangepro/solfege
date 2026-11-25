// Chant : intervalles, notes sur la portée, accords. Tirage des exercices et jugement de la note tenue.
// Sans accès à la page ni au son : tout se teste sous Node.
import { centsToClass } from './pitch.js';

// Notes naturelles en clé de sol : position 0 sur la ligne du bas (mi), +1 par degré ; do sous la portée = −2.
const SEMIS = [0, 2, 4, 5, 7, 9, 11];
export const midiOf = (p) => { const d = p + 2; return 60 + 12 * Math.floor(d / 7) + SEMIS[((d % 7) + 7) % 7]; };

// Les onze intervalles, par nombre de demi-tons. deg = nombre de degrés franchis sur la portée (le triton s'écrit des deux façons).
export const INTERVALLES = [null,
  { nom: 'seconde mineure', court: '2m', deg: [1] }, { nom: 'seconde majeure', court: '2M', deg: [1] },
  { nom: 'tierce mineure', court: '3m', deg: [2] }, { nom: 'tierce majeure', court: '3M', deg: [2] },
  { nom: 'quarte', court: '4', deg: [3] }, { nom: 'triton', court: 'triton', deg: [3, 4], masc: true },
  { nom: 'quinte', court: '5', deg: [4] }, { nom: 'sixte mineure', court: '6m', deg: [5] }, { nom: 'sixte majeure', court: '6M', deg: [5] },
  { nom: 'septième mineure', court: '7m', deg: [6] }, { nom: 'septième majeure', court: '7M', deg: [6] }];
export const sensDe = (st, sens) => (sens > 0 ? 'montant' : 'descendant') + (INTERVALLES[st].masc ? '' : 'e');

// Accords : demi-tons au-dessus de la fondamentale, et suffixe du chiffrage dans les deux écritures courantes en jazz
// (lettres : Cm7, Cmaj7 ; signes : C–7, C∆7). mineur = la fondamentale s'écrit comme dans une tonalité mineure.
export const ACCORDS = [
  { id: 'maj', tons: [0, 4, 7], lettres: '', signes: '' },
  { id: 'min', tons: [0, 3, 7], lettres: 'm', signes: '–', mineur: true },
  { id: 'aug', tons: [0, 4, 8], lettres: '+', signes: '+' },
  { id: 'dim', tons: [0, 3, 6], lettres: '°', signes: '°', mineur: true },
  { id: 'sus4', tons: [0, 5, 7], lettres: 'sus4', signes: 'sus4' },
  { id: 'm7', tons: [0, 3, 7, 10], lettres: 'm7', signes: '–7', mineur: true },
  { id: 'maj7', tons: [0, 4, 7, 11], lettres: 'maj7', signes: '∆7' },
  { id: '7', tons: [0, 4, 7, 10], lettres: '7', signes: '7' },
  { id: 'mMaj7', tons: [0, 3, 7, 11], lettres: 'm(maj7)', signes: '–∆7', mineur: true },
  { id: '6', tons: [0, 4, 7, 9], lettres: '6', signes: '6' }];
const RACINES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const RACINES_MIN = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export function chiffrage(racine, id, notation = 'lettres') {
  const a = ACCORDS.find((q) => q.id === id);
  return (a.mineur || id === '7' && racine === 6 ? RACINES_MIN : RACINES)[racine] + a[notation === 'signes' ? 'signes' : 'lettres'];
}

const pick = (a, rnd) => a[Math.floor(rnd() * a.length)];
const ivOk = (iv) => { const a = (iv || []).filter((s) => INTERVALLES[s]); return a.length ? a : [4, 7]; };
const sensOk = (r) => { const a = []; if (r.montant !== false) a.push(1); if (r.descendant) a.push(-1); return a.length ? a : [1]; };

// Un intervalle à chanter : la note de départ sonne (ref), la note à trouver est cible. Les deux tiennent entre do2 et do4 (48 à 72).
export function tirerIntervalle(r, rnd = Math.random, prev = null) {
  for (let essai = 0; ; essai++) {
    const st = pick(ivOk(r.iv), rnd), sens = pick(sensOk(r), rnd), bas = 48 + Math.floor(rnd() * (25 - st));
    const it = { st, sens, ref: sens > 0 ? bas : bas + st, cible: sens > 0 ? bas + st : bas };
    if (essai > 20 || !prev || prev.st !== it.st || prev.ref !== it.ref || prev.sens !== it.sens) return it;
  }
}

// Deux notes écrites en clé de sol. La première est naturelle, entre le do sous la portée et le mi du quatrième interligne ;
// la seconde prend le bémol ou le dièse que demande l'intervalle (alt = −1, 0, 1). Elle reste entre le la grave (−4) et le do aigu (12).
export function tirerPortee(r, rnd = Math.random, prev = null) {
  for (let essai = 0; ; essai++) {
    const st = pick(ivOk(r.iv), rnd), sens = pick(sensOk(r), rnd), deg = pick(INTERVALLES[st].deg, rnd);
    const p1 = -2 + Math.floor(rnd() * 10), p2 = p1 + sens * deg;
    if (p2 < -4 || p2 > 12) continue;
    const m1 = midiOf(p1), m2 = m1 + sens * st, alt = m2 - midiOf(p2);
    if (Math.abs(alt) > 1) continue;
    const it = { st, sens, notes: [{ p: p1, alt: 0, midi: m1 }, { p: p2, alt, midi: m2 }] };
    if (essai > 40 || !prev || prev.st !== st || prev.notes[0].p !== p1 || prev.sens !== sens) return it;
  }
}

// Un accord : la fondamentale sonne (entre do2 et si2), les notes se chantent de bas en haut.
export function tirerAccord(r, rnd = Math.random, prev = null) {
  const types = (r.types || []).filter((id) => ACCORDS.some((a) => a.id === id));
  for (let essai = 0; ; essai++) {
    const id = pick(types.length ? types : ['maj', 'min'], rnd), racine = Math.floor(rnd() * 12);
    if (essai <= 20 && prev && prev.id === id && prev.racine === racine) continue;
    const a = ACCORDS.find((q) => q.id === id);
    return { id, racine, ref: 48 + racine, tons: a.tons.map((t) => 48 + racine + t) };
  }
}

// Jugement d'une note chantée, sans chronomètre. Chaque appel reçoit une mesure de hauteur (toutes les 10 ms).
// La note compte quand la voix tient `holdMs` dans la bande de ±`tol` cents autour de la cible, à l'octave près :
// on écarte les `skipMs` premières millisecondes d'une émission (la voix cherche), on juge la médiane (le vibrato passe),
// et on demande une hauteur stable (un glissando qui traverse la bande ne compte pas).
export class Hold {
  constructor({ tol = 50, holdMs = 700, skipMs = 150, clarity = 0.75, rmsMin = 0.002, hopMs = 10, spread = 80 } = {}) {
    Object.assign(this, { tol, holdMs, skipMs, clarity, rmsMin, hopMs, spread });
    this.reset();
  }
  reset() { this.run = []; this.gap = 0; this.last = null; }
  // Rend { cents, voiced, done, median, part } : cents = écart à la cible replié à l'octave, null si la voix ne chante pas ;
  // part = part de la tenue déjà faite dans la bande (0 à 1), pour l'affichage.
  push({ f0, clarity, rms }, midi) {
    const voiced = f0 > 0 && clarity >= this.clarity && rms >= this.rmsMin;
    if (!voiced) {
      if (++this.gap > 3) this.run = [];                        // plus de 30 ms sans voix : l'émission est finie
      return { cents: null, voiced: false, done: false, median: null, part: 0 };
    }
    const c = centsToClass(f0, midi);
    if (this.last !== null && this.gap <= 3 && Math.abs(c - this.last) > 150) this.run = [];   // saut de hauteur : nouvelle note
    this.gap = 0; this.last = c; this.run.push(c);
    const skip = Math.round(this.skipMs / this.hopMs), need = Math.round(this.holdMs / this.hopMs);
    let done = false, median = null, n = 0;
    for (let i = this.run.length - 1; i >= skip && Math.abs(this.run[i]) <= this.tol; i--) n++;
    if (this.run.length >= skip + need) {
      const w = this.run.slice(-need).sort((a, b) => a - b);
      median = w[w.length >> 1];
      const lo = w[Math.floor(0.1 * (w.length - 1))], hi = w[Math.ceil(0.9 * (w.length - 1))];
      done = Math.abs(median) <= this.tol && hi - lo <= this.spread;
    }
    return { cents: c, voiced: true, done, median, part: Math.min(1, n / need) };
  }
}
