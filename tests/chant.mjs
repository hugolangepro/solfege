// Chant : intervalles tirés, place d'une hauteur sur la portée, jugement de la tenue sur des voix de synthèse.
import { Pitch } from '../pitch.js';
import { tirerIntervalle, tirerPortee, tirerAccord, tirerGamme, memesNotes, GAMMES, chiffrage, ACCORDS, INTERVALLES, sensDe, midiOf, Hold } from '../chant.js';
import { Suivi, Follower } from '../engine.js';
let ok = true;
const check = (name, got, want) => { const good = String(got) === String(want); ok = ok && good; console.log(`${good ? 'ok ' : 'ÉCHEC'} ${name} : ${got}${good ? '' : `  (attendu : ${want})`}`); };
check('positions → MIDI (do, mi, sol, do aigu, la aigu)', [-2, 0, 2, 5, 10].map(midiOf), '60,64,67,72,81');
let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
{
  // tirages : bornes, sens, altération de la seconde note sur la portée, fondamentale des accords
  const r = { iv: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], montant: true, descendant: true };
  let bon = true; const vus = new Set(), alt = { '-1': 0, 0: 0, 1: 0 };
  for (let i = 0; i < 5000; i++) {
    const a = tirerIntervalle(r, rnd);
    bon = bon && Math.abs(a.cible - a.ref) === a.st && Math.min(a.ref, a.cible) >= 48 && Math.max(a.ref, a.cible) <= 72 && Math.sign(a.cible - a.ref) === a.sens;
    const p = tirerPortee(r, rnd), [x, y] = p.notes; alt[y.alt]++; vus.add(p.st * p.sens);
    bon = bon && y.midi - x.midi === p.sens * p.st && midiOf(y.p) + y.alt === y.midi && x.alt === 0 && x.midi >= 60 && x.midi <= 76 && y.p >= -4 && y.p <= 12;
    const c = tirerAccord({ types: ACCORDS.map((q) => q.id) }, rnd);
    bon = bon && c.tons[0] === c.ref && c.ref >= 48 && c.ref < 60 && c.tons.every((t, k) => !k || t > c.tons[k - 1]);
  }
  check('5000 tirages de chaque exercice dans les bornes', bon, true);
  check('les 22 intervalles orientés sortent sur la portée', vus.size, 22);
  console.log('    seconde note sur la portée : ' + JSON.stringify(alt) + ' (bémol, naturelle, dièse)');
  check('un seul intervalle choisi, descendant', [1, 2, 3].map(() => { const q = tirerIntervalle({ iv: [6], montant: false, descendant: true }, rnd); return q.st * q.sens; }).join(), '-6,-6,-6');
  check('chiffrages en do', ACCORDS.map((a) => chiffrage(0, a.id)).join(' '), 'C C– C+ C° Csus4 C–7 C∆7 C7 C–∆7 C6');
  check('fondamentales altérées', [1, 6, 8, 10].map((q) => ['maj7', 'm7', '7'].map((id) => chiffrage(q, id)).join(' ')).join(' | '), 'D♭∆7 C♯–7 D♭7 | G♭∆7 F♯–7 F♯7 | A♭∆7 A♭–7 A♭7 | B♭∆7 B♭–7 B♭7');
  { let bon = true; for (let i = 0; i < 2000; i++) { const g = tirerGamme({ types: GAMMES.map((q) => q.id), montant: true, descendant: true }, rnd), n = GAMMES.find((q) => q.id === g.id).tons.length + 1;
      bon = bon && g.notes.length === n && g.notes[g.sens > 0 ? 0 : n - 1] === g.ref && Math.abs(g.notes[n - 1] - g.notes[0]) === 12 && g.ref >= 48 && g.ref < 60; }
    check('2000 gammes tirées : de la tonique à l\'octave, dans les deux sens', bon, true); }
  { const vus = new Set(); let nat = true;
    for (let i = 0; i < 3000; i++) { const p = tirerPortee({ iv: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], montant: true, descendant: true, alterations: false }, rnd); nat = nat && p.notes.every((n) => n.alt === 0); vus.add(p.st); }
    check('sans dièse ni bémol : 3000 tirages en notes naturelles, les 11 intervalles présents', `${nat} ${vus.size}`, 'true 11'); }
  check('mêmes notes sous deux noms', [memesNotes('majeure', 'ionien'), memesNotes('mineure', 'eolien'), memesNotes('majeure', 'lydien')].join(), 'true,true,false');
  check('noms', [5, 6, 7, 10].map((st) => `${INTERVALLES[st].nom} ${sensDe(st, 1)}`).join(', '), 'quarte montante, triton montant, quinte montante, septième mineure montante');
}
{
  // lecture sans fin : 2000 notes, une faute toutes les 13 notes, un son parasite faible toutes les 17. Le suivi par fenêtre
  // doit rendre exactement les verdicts d'un alignement unique sur toute la séquence.
  const notes = Array.from({ length: 2100 }, () => Math.floor(rnd() * 7));
  const sv = new Suivi((i) => notes[i]), f = new Follower(notes);
  let t = 0;
  for (let i = 0; i < 2000; i++) {
    const push = (d) => { sv.push(d); f.push(d); };
    if (i % 17 === 5) push({ cls: (notes[i] + 3) % 7, conf: 0.35, time: (t += 0.2), frame: Math.round(t * 100) });
    push({ cls: i % 13 === 7 ? (notes[i] + 1) % 7 : notes[i], conf: 0.97, time: (t += 0.5), frame: Math.round(t * 100) });
  }
  const v = sv.verdicts(0, 2000), w = f.verdicts();
  let diff = 0;
  for (let i = 0; i < 2000; i++) if ((w[i] && w[i].v) !== (v[i] && v[i].v)) diff++;
  check('suivi sans fin : notes lues', sv.best(), 2000);
  check('suivi sans fin : verdicts différents de l\'alignement unique', diff, 0);
  console.log(`    justes ${v.filter((q) => q.v === 'ok').length}, fausses ${v.filter((q) => q.v === 'faux').length} (154 fautes dites, une avalée par une note répétée) ; fenêtre repartie ${sv.base >> 4} fois`);
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
check('mi tenu, à l\'octave du dessous, attaque par en dessous', judge([[0.5, 0], [1.6, hz(52), { scoop: -180 }]], 64), judge([[0.5, 0], [1.6, hz(52), { scoop: -180 }]], 64));
console.log('    ' + ['mi juste, octave écrite : ' + judge([[0.5, 0], [1.5, hz(64)]], 64),
  'mi 30 cents trop bas : ' + judge([[0.5, 0], [1.5, hz(64 - 0.3)]], 64),
  'mi avec vibrato ±40 cents : ' + judge([[0.5, 0], [1.6, hz(52), { vib: 40 }]], 64)].join(' | '));
check('mi 70 cents trop bas', judge([[0.5, 0], [1.5, hz(64 - 0.7)]], 64), 'jamais');
check('fa tenu (un demi-ton au-dessus)', judge([[0.5, 0], [1.5, hz(65)]], 64), 'jamais');
check('glissando qui traverse la bande (ré → fa dièse en 1,6 s)', judge([[0.5, 0], [1.6, hz(62), { glide: 400 }]], 64), 'jamais');
check('note trop courte (0,6 s)', judge([[0.5, 0], [0.6, hz(64)], [0.5, 0]], 64), 'jamais');
const two = judge([[0.5, 0], [0.7, hz(62)], [0.05, 0], [1.5, hz(64)]], 64);
console.log('    ré tenu 0,7 s puis mi : ' + two);
ok = ok && two !== 'jamais' && parseFloat(two) > 1.5;
const slide = judge([[0.5, 0], [0.5, hz(62)], [1.5, hz(64), { scoop: -200 }]], 64);
console.log('    ré puis glisse vers mi sans reprendre son souffle : ' + slide);
ok = ok && slide !== 'jamais';
check('bande réglée à ±25 cents, mi 30 cents trop bas', judge([[0.5, 0], [1.5, hz(64 - 0.3)]], 64, { tol: 25 }), 'jamais');
// autre note tenue : signalée après 0,15 s d'attaque et 0,5 s de tenue, avec son écart ; ni un glissando ni une note juste ne le sont
function fausse(segs, midi) {
  const P = new Pitch({ win: 1024 }), H = new Hold(); let at = null, ec = null;
  P.onPitch = (q) => { const r = H.push(q, midi); if (r.faux !== null && at === null) { at = q.time; ec = r.faux; } };
  const x = voice(segs);
  for (let i = 0; i < x.length; i += 256) P.push(x.subarray(i, Math.min(x.length, i + 256)));
  return at === null ? 'jamais' : `${at.toFixed(2)} s, ${ec.toFixed(0)} cents`;
}
check('fa tenu au lieu de mi : fausse note signalée', fausse([[0.5, 0], [1.5, hz(65)]], 64), '1.12 s, 100 cents');
check('si bémol tenu au lieu de mi (triton, au repli de l\'octave) : signalée', fausse([[0.5, 0], [1.5, hz(58)]], 64) !== 'jamais', true);
check('mi juste : pas de fausse note', fausse([[0.5, 0], [1.5, hz(64)]], 64), 'jamais');
check('mi 60 cents trop bas (ni validé ni faux : on peut corriger)', fausse([[0.5, 0], [1.5, hz(64 - 0.6)]], 64), 'jamais');
check('glissando ré → fa dièse : pas de fausse note', fausse([[0.5, 0], [1.6, hz(62), { glide: 400 }]], 64), 'jamais');
check('fausse note trop courte (0,5 s)', fausse([[0.5, 0], [0.5, hz(65)], [0.5, 0]], 64), 'jamais');
process.exit(ok ? 0 : 1);
