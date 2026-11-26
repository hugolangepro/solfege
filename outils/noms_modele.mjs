// Fabrique noms.json, la voix livrée avec l'app pour la lecture d'intervalles, à partir de séries enregistrées par
// l'écran d'enregistrement (fichiers hors dépôt) : node outils/noms_modele.mjs sortie.json serie1.wav serie2.wav …
// Affiche aussi ce que vaut la reconnaissance : chaque exemple contre tous les autres, et chaque série contre les autres.
import fs from 'node:fs';
import { Voix, traits, apprendre, emballer, deballer } from '../noms.js';
const NOMS = ['seconde mineure', 'seconde majeure', 'tierce mineure', 'tierce majeure', 'quarte', 'triton', 'quinte', 'sixte mineure', 'sixte majeure', 'septième mineure', 'septième majeure'];
const [sortie, ...fichiers] = process.argv.slice(2);
const series = fichiers.map((f) => {
  const raw = fs.readFileSync(f), bl = {};
  for (let pos = 12; pos + 8 <= raw.length;) { const n = raw.readUInt32LE(pos + 4); bl[raw.toString('latin1', pos, pos + 4)] = raw.subarray(pos + 8, pos + 8 + n); pos += 8 + n + (n & 1); }
  const meta = JSON.parse(bl.sLFG.toString('utf8')), x = Float32Array.from(new Int16Array(bl.data.buffer, bl.data.byteOffset, bl.data.length / 2), (v) => v / 32768);
  let cr = 0, e = 0; for (const v of x) { cr = Math.max(cr, Math.abs(v)); e += v * v; }
  const ex = apprendre([x], meta.phrases.map(([ms, nom]) => [ms, NOMS.indexOf(nom)]), meta.periode || 2500);
  console.log(`${f.split('/').pop()} · ${meta.micro && meta.micro.nom} · ${meta.rate} Hz · app ${meta.app} · installée ${meta.installee} · crête ${cr.toFixed(2)} · ${ex.length} noms sur ${meta.phrases.length}`);
  return ex.map((q) => ({ cls: q.cls, t: emballer(q.c) }));
});
const F = series.map((s) => s.map((q) => ({ cls: q.cls, f: traits(deballer(q.t)) })));
const tous = F.flat(), v = new Voix(tous).verifier();
console.log(`chaque exemple contre tous les autres : ${v.ok} / ${v.n} · plus grand score d'un nom retrouvé ${v.loin.toFixed(2)}`);
if (F.length > 1) F.forEach((s, i) => {
  const vx = new Voix(F.filter((_, j) => j !== i).flat()); let ok = 0; const err = [], d = [];
  for (const e of s) { const r = vx.classer(e.f); d.push(r.dist); if (r.cls === e.cls) ok++; else err.push(`${NOMS[e.cls]} → ${NOMS[r.cls]}`); }
  d.sort((a, b) => a - b);
  console.log(`série ${i + 1} reconnue avec les autres séries seulement : ${ok} / ${s.length} · distance médiane ${d[d.length >> 1].toFixed(2)}, max ${d[d.length - 1].toFixed(2)} · ${err.join(' ; ')}`);
});
if (sortie !== '-') {
  fs.writeFileSync(sortie, JSON.stringify({ v: 1, fait: new Date().toISOString().slice(0, 10), noms: NOMS, loin: Math.round(v.loin * 100) / 100, g: series.flat().map((q) => [q.cls, q.t]) }));
  console.log(`${sortie} : ${series.flat().length} exemples, ${fs.statSync(sortie).size} octets`);
}
