// Chant : intervalles tirés, place d'une hauteur sur la portée, jugement de la tenue sur des voix de synthèse.
import { Pitch } from '../pitch.js';
import { buildIntervals, staffPos, midiOf, nomIntervalle, Hold, NIVEAUX } from '../chant.js';
let ok = true;
const check = (name, got, want) => { const good = String(got) === String(want); ok = ok && good; console.log(`${good ? 'ok ' : 'ÉCHEC'} ${name} : ${got}${good ? '' : `  (attendu : ${want})`}`); };
check('positions → MIDI (do, mi, sol, do aigu, la aigu)', [-2, 0, 2, 5, 10].map(midiOf), '60,64,67,72,81');
check('hauteur → position (mi, fa, fa dièse, sol, do, si bémol)', [64, 65, 66, 67, 72, 70].map((m) => staffPos(m).toFixed(2)), '0.00,1.00,1.50,2.00,5.00,3.50');
let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
for (let niv = 0; niv < 3; niv++) {
  const it = buildIntervals(niv, 400, rnd), noms = {};
  for (const q of it) { const n = nomIntervalle(q.ref, q.cible); noms[n] = (noms[n] || 0) + 1; }
  const borne = it.every((q) => q.ref >= -2 && q.ref <= 10 && q.cible >= -2 && q.cible <= 10);
  console.log(`    ${NIVEAUX[niv].nom} : ${Object.entries(noms).map(([k, v]) => `${k} ${v}`).join(', ')} | dans la portée : ${borne}`);
  ok = ok && borne;
}
// voix de synthèse à 16 kHz : fondamentale + harmoniques, attaque par en dessous, vibrato
const sr = 16000;
function voice(segs) {   // segs : [durée s, fréquence Hz ou 0, {scoop: cents de départ, vib: cents}]
  const out = []; let ph = 0;
  for (const [dur, f, o = {}] of segs) {
    const n = Math.round(dur * sr);
    for (let i = 0; i < n; i++) {
      if (!f) { out.push(0.0005 * (Math.random() * 2 - 1)); continue; }
      const t = i / sr, scoop = (o.scoop || 0) * Math.exp(-t / 0.06), vib = (o.vib || 0) * Math.sin(2 * Math.PI * 5.5 * t), gl = (o.glide || 0) * t / dur;
      const fi = f * Math.pow(2, (scoop + vib + gl) / 1200);
      ph += 2 * Math.PI * fi / sr;
      const env = Math.min(1, t / 0.03) * Math.min(1, (dur - t) / 0.03);
      out.push(env * 0.1 * (Math.sin(ph) + 0.6 * Math.sin(2 * ph) + 0.4 * Math.sin(3 * ph) + 0.2 * Math.sin(5 * ph)) + 0.0005 * (Math.random() * 2 - 1));
    }
  }
  return Float32Array.from(out);
}
function judge(segs, midi, opts) {
  const P = new Pitch({ win: 1024 }), H = new Hold(opts); let doneAt = null, med = null;
  P.onPitch = (q) => { const r = H.push(q, midi); if (r.done && doneAt === null) { doneAt = q.time; med = r.median; } };
  const x = voice(segs);
  for (let i = 0; i < x.length; i += 256) P.push(x.subarray(i, Math.min(x.length, i + 256)));
  return doneAt === null ? 'jamais' : `${doneAt.toFixed(2)} s, médiane ${med.toFixed(0)} cents`;
}
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
console.log('    cible : mi (64). Voix : 0,5 s de silence puis…');
check('mi tenu, à l\'octave du dessous, attaque par en dessous', judge([[0.5, 0], [1.2, hz(52), { scoop: -180 }]], 64), judge([[0.5, 0], [1.2, hz(52), { scoop: -180 }]], 64));
console.log('    ' + ['mi juste, octave écrite : ' + judge([[0.5, 0], [1.0, hz(64)]], 64),
  'mi 30 cents trop bas : ' + judge([[0.5, 0], [1.0, hz(64 - 0.3)]], 64),
  'mi avec vibrato ±40 cents : ' + judge([[0.5, 0], [1.2, hz(52), { vib: 40 }]], 64)].join(' | '));
check('mi 70 cents trop bas', judge([[0.5, 0], [1.0, hz(64 - 0.7)]], 64), 'jamais');
check('fa tenu (un demi-ton au-dessus)', judge([[0.5, 0], [1.0, hz(65)]], 64), 'jamais');
check('glissando qui traverse la bande (ré → fa dièse en 0,8 s)', judge([[0.5, 0], [0.8, hz(62), { glide: 400 }]], 64), 'jamais');
check('note trop courte (0,3 s)', judge([[0.5, 0], [0.3, hz(64)], [0.5, 0]], 64), 'jamais');
const two = judge([[0.5, 0], [0.7, hz(62)], [0.05, 0], [1.0, hz(64)]], 64);
console.log('    ré tenu 0,7 s puis mi : ' + two);
ok = ok && two !== 'jamais' && parseFloat(two) > 1.5;
const slide = judge([[0.5, 0], [0.5, hz(62)], [0.9, hz(64), { scoop: -200 }]], 64);
console.log('    ré puis glisse vers mi sans reprendre son souffle : ' + slide);
ok = ok && slide !== 'jamais';
check('bande réglée à ±25 cents, mi 30 cents trop bas', judge([[0.5, 0], [1.0, hz(64 - 0.3)]], 64, { tol: 25 }), 'jamais');
process.exit(ok ? 0 : 1);
