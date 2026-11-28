// Chant : intervalles, notes sur la portée, accords. Tirage des exercices et jugement de la note tenue.
// Sans accès à la page ni au son : tout se teste sous Node.
import { centsToClass } from './pitch.js';

// Notes naturelles en clé de sol : position 0 sur la ligne du bas (mi), +1 par degré ; do sous la portée = −2.
const SEMIS = [0, 2, 4, 5, 7, 9, 11];
export const midiOf = (p) => { const d = p + 2; return 60 + 12 * Math.floor(d / 7) + SEMIS[((d % 7) + 7) % 7]; };

// Les onze intervalles, par nombre de demi-tons. À l'écran, toujours `court` (notation standard) ; `nom` sert aux lecteurs d'écran
// et à l'écran d'enregistrement, où l'on lit le mot à prononcer. deg = nombre de degrés franchis sur la portée (le triton s'écrit des deux façons).
export const INTERVALLES = [null,
  { nom: 'seconde mineure', court: '2m', deg: [1] }, { nom: 'seconde majeure', court: '2M', deg: [1] },
  { nom: 'tierce mineure', court: '3m', deg: [2] }, { nom: 'tierce majeure', court: '3M', deg: [2] },
  { nom: 'quarte', court: '4', deg: [3] }, { nom: 'triton', court: 'TT', deg: [3, 4], masc: true },
  { nom: 'quinte', court: '5', deg: [4] }, { nom: 'sixte mineure', court: '6m', deg: [5] }, { nom: 'sixte majeure', court: '6M', deg: [5] },
  { nom: 'septième mineure', court: '7m', deg: [6] }, { nom: 'septième majeure', court: '7M', deg: [6] }];
export const sensDe = (st, sens) => (sens > 0 ? 'montant' : 'descendant') + (INTERVALLES[st].masc ? '' : 'e');

// Accords : demi-tons au-dessus de la fondamentale, et suffixe du chiffrage dans l'écriture du jazz : – pour mineur,
// ∆ pour la septième majeure. mineur = la fondamentale s'écrit comme dans une tonalité mineure. Une seule liste pour tous
// les exercices. nom = ce qu'on lit sur un bouton de réponse quand le signe seul ne dit rien (sinon le signe).
export const ACCORDS = [
  { id: 'maj', tons: [0, 4, 7], signe: '', nom: 'majeur' },
  { id: 'min', tons: [0, 3, 7], signe: '–', nom: 'mineur', mineur: true },
  { id: 'aug', tons: [0, 4, 8], signe: '+', nom: 'augmenté' },
  { id: 'dim', tons: [0, 3, 6], signe: '°', nom: 'diminué (triade)', mineur: true },
  { id: 'sus4', tons: [0, 5, 7], signe: 'sus4' },
  { id: 'm7', tons: [0, 3, 7, 10], signe: '–7', mineur: true },
  { id: 'maj7', tons: [0, 4, 7, 11], signe: '∆7' },
  { id: '7', tons: [0, 4, 7, 10], signe: '7' },
  { id: 'mMaj7', tons: [0, 3, 7, 11], signe: '–∆7', mineur: true },
  { id: '6', tons: [0, 4, 7, 9], signe: '6' },
  // semi-diminué = mineur 7 bémol 5 ; diminué = septième diminuée, la ♭♭7 sonnant comme une 6 (d'où « mineur 6 bémol 5 »)
  { id: 'm7b5', tons: [0, 3, 6, 10], signe: 'ø7', nom: 'semi-diminué', mineur: true },
  { id: 'dim7', tons: [0, 3, 6, 9], signe: '°7', nom: 'diminué', mineur: true }];
const RACINES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const RACINES_MIN = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const racineNom = (racine, id) => (ACCORDS.find((q) => q.id === id).mineur || id === '7' && racine === 6 ? RACINES_MIN : RACINES)[racine];
export function chiffrage(racine, id, nom = racineNom(racine, id)) {
  return nom + ACCORDS.find((q) => q.id === id).signe;
}

// Gammes et modes : demi-tons au-dessus de la tonique. Une seule liste pour tous les exercices : une gamme ajoutée ici
// apparaît dans les réglages de chacun. Deux noms peuvent désigner les mêmes notes (majeure et ionien). À l'écran : `court`,
// ou le nom du mode, déjà court.
export const gammeCourt = (id) => { const g = GAMMES.find((q) => q.id === id); return g.court || g.nom; };
export const GAMMES = [
  { id: 'majeure', nom: 'majeure', court: 'maj', tons: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'mineure', nom: 'mineure', court: 'min', tons: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'harmonique', nom: 'mineure harmonique', court: 'min harm', tons: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'pentaMaj', nom: 'pentatonique majeure', court: 'penta maj', tons: [0, 2, 4, 7, 9] },
  { id: 'pentaMin', nom: 'pentatonique mineure', court: 'penta min', tons: [0, 3, 5, 7, 10] },
  { id: 'ionien', nom: 'ionien', tons: [0, 2, 4, 5, 7, 9, 11], mode: true },
  { id: 'dorien', nom: 'dorien', tons: [0, 2, 3, 5, 7, 9, 10], mode: true },
  { id: 'phrygien', nom: 'phrygien', tons: [0, 1, 3, 5, 7, 8, 10], mode: true },
  { id: 'lydien', nom: 'lydien', tons: [0, 2, 4, 6, 7, 9, 11], mode: true },
  { id: 'mixolydien', nom: 'mixolydien', tons: [0, 2, 4, 5, 7, 9, 10], mode: true },
  { id: 'eolien', nom: 'éolien', tons: [0, 2, 3, 5, 7, 8, 10], mode: true },
  { id: 'locrien', nom: 'locrien', tons: [0, 1, 3, 5, 6, 8, 10], mode: true }];
export const memesNotes = (a, b) => { const g = (id) => (GAMMES.find((q) => q.id === id) || { tons: [id] }).tons.join(); return g(a) === g(b); };

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
export function tirerPortee(r, rnd = Math.random, prev = null, clef = 'sol') {
  const haut = clef === 'fa' ? (p) => midiOf(p + 2) - 24 : midiOf;      // en clé de fa, la ligne du bas est un sol
  for (let essai = 0; ; essai++) {
    const st = pick(ivOk(r.iv), rnd), sens = pick(sensOk(r), rnd), deg = pick(INTERVALLES[st].deg, rnd);
    const p1 = -2 + Math.floor(rnd() * 10), p2 = p1 + sens * deg;
    if (p2 < -4 || p2 > 12) continue;
    const m1 = haut(p1), m2 = m1 + sens * st, alt = m2 - haut(p2);
    if (r.alterations === false && alt !== 0 && essai < 400) continue;      // sans dièse ni bémol : deux notes naturelles
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

// Une gamme : la tonique sonne (entre do2 et si2), les notes vont jusqu'à l'octave, en montant ou en descendant.
export function tirerGamme(r, rnd = Math.random, prev = null) {
  const types = (r.types || []).filter((id) => GAMMES.some((g) => g.id === id));
  for (let essai = 0; ; essai++) {
    const id = pick(types.length ? types : ['majeure'], rnd), racine = Math.floor(rnd() * 12), sens = pick(sensOk(r), rnd);
    if (essai <= 20 && prev && prev.id === id && prev.racine === racine) continue;
    const haut = [...GAMMES.find((g) => g.id === id).tons, 12].map((t) => 48 + racine + t);
    return { id, racine, sens, ref: 48 + racine, notes: sens > 0 ? haut : haut.reverse() };
  }
}

// Jugement d'une note chantée, sans chronomètre. Chaque appel reçoit une mesure de hauteur (toutes les 10 ms).
// La note compte quand la voix tient `holdMs` dans la bande de ±`tol` cents autour de la cible, à l'octave près :
// on écarte les `skipMs` premières millisecondes d'une émission (la voix cherche), on juge la médiane (le vibrato passe),
// et on demande une hauteur stable (un glissando qui traverse la bande ne compte pas).
// Une autre note, tenue `fauxMs` à `fauxCents` au moins de la cible, est signalée : l'app fait alors reprendre du début.
export class Hold {
  constructor({ tol = 50, holdMs = 700, skipMs = 150, clarity = 0.75, rmsMin = 0.002, hopMs = 10, spread = 80, fauxMs = 500, fauxCents = 75 } = {}) {
    Object.assign(this, { tol, holdMs, skipMs, clarity, rmsMin, hopMs, spread, fauxMs, fauxCents });
    this.reset();
  }
  reset() { this.run = []; this.gap = 0; this.last = null; }
  // Rend { cents, voiced, done, median, part, faux } : cents = écart à la cible replié à l'octave, null si la voix ne chante pas ;
  // part = part de la tenue déjà faite dans la bande (0 à 1), pour l'affichage ; faux = écart d'une autre note tenue, sinon null.
  push({ f0, clarity, rms }, midi) {
    const voiced = f0 > 0 && clarity >= this.clarity && rms >= this.rmsMin;
    if (!voiced) {
      if (++this.gap > 3) this.run = [];                        // plus de 30 ms sans voix : l'émission est finie
      return { cents: null, voiced: false, done: false, median: null, part: 0, faux: null };
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
    // autre note tenue : hauteur stable loin de la cible (les écarts sont comparés autour du dernier, pour passer le repli à ±600)
    let faux = null;
    const nf = Math.round(this.fauxMs / this.hopMs);
    if (!done && this.run.length >= skip + nf) {
      const w = this.run.slice(-nf).map((v) => ((v - c + 1800) % 1200) - 600).sort((a, b) => a - b);
      const med = c + w[w.length >> 1], lo = w[Math.floor(0.1 * (w.length - 1))], hi = w[Math.ceil(0.9 * (w.length - 1))];
      if (Math.abs(med) >= this.fauxCents && hi - lo <= this.spread) faux = med;
    }
    return { cents: c, voiced: true, done, median, part: Math.min(1, n / need), faux };
  }
}
