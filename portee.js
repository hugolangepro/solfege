// Dessin des portées : un système de lecture, la portée des réglages, une note avec ses lignes supplémentaires et son altération.
import { GLYPHS } from './glyphs.js';

export const PER = 8, SS = 191;                          // notes par système ; un interligne dans les unités des contours
export const P_MIN = -6, P_MAX = 14;                     // positions extrêmes : trois lignes supplémentaires de chaque côté
export const INK = '#1C1A17', DONE = 'rgba(28,26,23,0.36)', RED = '#B3261E', GREEN = '#2E7A3C', BLUE = '#1F4E8C', SOFT = '#6B6457', LINE = 'rgba(28,26,23,0.72)';
export const CLEFS = { sol: { glyph: 'gclef', off: 2, base: 4, nom: 'clé de sol' }, fa: { glyph: 'fclef', off: 4, base: 2, nom: 'clé de fa' } };
const SEMIS = [0, 2, 4, 5, 7, 9, 11];
export const r2 = (v) => Math.round(v * 100) / 100;

// p = position sur la portée : 0 sur la ligne du bas, +1 par degré.
export function noteInfo(clef, p) {
  const d = p + CLEFS[clef].off;                         // degrés au-dessus du do de référence de la clé
  const cls = ((d % 7) + 7) % 7;
  const midi = 12 * (CLEFS[clef].base + Math.floor(d / 7) + 1) + SEMIS[cls];
  return { clef, p, cls, midi };
}

// Hauteurs d'une portée (clefs = ['sol'] ou ['fa']) ou d'un système de piano (['sol', 'fa']). et = étendue des notes par clé,
// [position la plus grave, la plus aiguë] : elle fixe la place gardée au-dessus, en dessous et entre les deux portées.
export function metrics(s, clefs, et) {
  const a = Math.max(6, s * 0.55);                       // demi-largeur du repère
  const haut = (c) => Math.max(1.75, (et[c][1] - 8) / 2 + 0.75), bas = (c) => Math.max(1.75, -et[c][0] / 2 + 0.75);
  const grand = clefs.length > 1, sous = bas(clefs[clefs.length - 1]) * s + 4;
  const padTop = Math.round(haut(clefs[0]) * s + 6), padBot = Math.round(sous + 1.7 * a + 6);
  const between = grand ? Math.max(5, bas('sol') + haut('fa') - 0.5) * s : 0;   // de la ligne du bas de la clé de sol à la ligne du haut de la clé de fa
  return { a, padTop, sous, between, H: padTop + 4 * s + (grand ? between + 4 * s : 0) + padBot };
}

// Accolade d'un système de piano, dans le rectangle (x, y, w, h).
function bracePath(x, y, w, h) {
  const P = (px, py) => `${r2(x + px * w)} ${r2(y + py * h)}`;
  return `M${P(1, 0)}C${P(0.2, 0.05)} ${P(0.9, 0.45)} ${P(0, 0.5)}C${P(0.9, 0.55)} ${P(0.2, 0.95)} ${P(1, 1)}`
    + `C${P(0.6, 0.92)} ${P(1.3, 0.58)} ${P(0, 0.5)}C${P(1.3, 0.42)} ${P(0.6, 0.08)} ${P(1, 0)}Z`;
}

const lw = (s) => Math.max(0.9, s / 12);
function lignes(x1, x2, yb, s) {
  let o = '';
  for (let i = 0; i < 5; i++) o += `<line x1="${r2(x1)}" y1="${r2(yb - i * s)}" x2="${r2(x2)}" y2="${r2(yb - i * s)}" stroke="${LINE}" stroke-width="${r2(lw(s))}"/>`;
  return o;
}
function clef(nom, x, yb, s) {
  const g = GLYPHS[CLEFS[nom].glyph], k = s / SS;
  return `<path d="${g.d}" transform="translate(${r2(x + 3 - g.left * k)} ${r2(yb)}) scale(${k} ${-k}) translate(0 12)" fill="${INK}"/>`;
}

// Une tête de note en x, sur la portée dont la ligne du bas est en yb. alt : −1 bémol, 1 dièse. attr : attributs de la tête.
export function noteSVG(x, yb, p, s, col, alt = 0, attr = '') {
  const k = s / SS, yc = yb - p * s / 2;
  let o = '';
  const led = [];
  if (p <= -2) for (let q = -2; q >= p; q -= 2) led.push(q);
  if (p >= 10) for (let q = 10; q <= p; q += 2) led.push(q);
  for (const q of led) o += `<line x1="${r2(x - 1.02 * s)}" y1="${r2(yb - q * s / 2)}" x2="${r2(x + 1.02 * s)}" y2="${r2(yb - q * s / 2)}" stroke="${LINE}" stroke-width="${r2(lw(s) * 1.3)}"/>`;
  if (alt) {
    const g = GLYPHS[alt > 0 ? 'sharp' : 'flat'], ka = k * g.k;
    o += `<path d="${g.d}" transform="translate(${r2(x - 1.18 * s - (g.x1 - g.x0) * ka)} ${r2(yc)}) scale(${ka} ${-ka}) translate(${-g.x0} ${-g.cy})" fill="${col}"/>`;
  }
  return o + `<path ${attr} d="${GLYPHS.nhblack.d}" transform="translate(${r2(x - 155 * k)} ${r2(yc + 91 * k)}) scale(${k} ${-k})" fill="${col}"/>`;
}
export function repere(x, y, a) {
  return `<polygon points="${r2(x)},${r2(y)} ${r2(x - a)},${r2(y + 1.7 * a)} ${r2(x + a)},${r2(y + 1.7 * a)}" fill="${BLUE}"/>`;
}

// Un système : une portée, ou deux portées réunies par une accolade. Une note validée s'efface en gris, une note fausse
// passe en rouge, sans autre marque. Une note que le micro n'a pas entendue reste noire.
export function systemSVG(notes, states, W, s, clefs, et) {
  const grand = clefs.length > 1, { a, padTop, sous, between, H } = metrics(s, clefs, et);
  const xs = grand ? Math.round(1.3 * s) : 0;                             // l'accolade tient dans la marge gauche
  const yb = grand ? { sol: padTop + 4 * s, fa: padTop + 8 * s + between } : { [clefs[0]]: padTop + 4 * s };
  const yLow = yb[clefs[clefs.length - 1]];
  const x0 = xs + 5.6 * s, xr = W - 1.5 * s, dx = (xr - x0) / (PER - 1);
  let o = '';
  for (const c of clefs) o += lignes(xs, W, yb[c], s) + clef(c, xs, yb[c], s);
  if (grand) {
    const yTop = yb.sol - 4 * s, l = lw(s);
    o += `<line x1="${r2(xs + l / 2)}" y1="${r2(yTop - l / 2)}" x2="${r2(xs + l / 2)}" y2="${r2(yb.fa + l / 2)}" stroke="${LINE}" stroke-width="${r2(l * 1.3)}"/>`;
    o += `<path d="${bracePath(0, yTop, xs - 0.35 * s, yb.fa - yTop)}" fill="${INK}"/>`;
  }
  notes.forEach((n, i) => {
    const st = states[i], x = x0 + i * dx;
    o += noteSVG(x, yb[n.clef], n.p, s, st.kind === 'faux' ? RED : st.kind === 'ok' ? DONE : INK, 0, `data-n="${st.j}"`);
    if (st.cur) o += repere(x, yLow + sous, a);
  });
  const label = grand ? `Système de piano, ${notes.length} notes` : `Portée en ${CLEFS[clefs[0]].nom}, ${notes.length} notes`;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${o}</svg>`;
}

// Réglages : la portée d'une clé avec la note la plus grave et la note la plus aiguë de l'étendue choisie.
export function miniPortee(nom, lo, hi, s) {
  const W = Math.round(13 * s), pad = 3.9 * s, yb = pad + 4 * s, H = Math.round(yb + pad);
  const o = lignes(0, W, yb, s) + clef(nom, 0, yb, s) + noteSVG(7.2 * s, yb, lo, s, INK) + noteSVG(10.6 * s, yb, hi, s, INK);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Étendue en ${CLEFS[nom].nom}">${o}</svg>`;
}

// Chant : une portée en clé de sol avec les notes à chanter. etats[i] = couleur de la note i ; cur = indice de la note en cours, ou −1.
export function porteeChant(notes, etats, cur, W, s, yb, nomClef = 'sol') {
  const a = Math.max(6, s * 0.55), x0 = 6.6 * s, dx = Math.min(4.2 * s, (W - 8.5 * s) / Math.max(1, notes.length - 1));
  let o = lignes(0, W, yb, s) + clef(nomClef, 0, yb, s);
  notes.forEach((n, i) => {
    o += noteSVG(x0 + i * dx, yb, n.p, s, etats[i], n.alt, `data-c="${i}"`);
    if (i === cur) o += repere(x0 + i * dx, yb + 2.9 * s, a);
  });
  return o;
}
