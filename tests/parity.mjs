// Vérifie que le moteur JavaScript retrouve les candidats calculés en Python sur l'enregistrement de mesure.
// Usage : node tests/parity.mjs son.wav reference.json [sortie.json]
import fs from 'node:fs';
import { loadModel, Recognizer, Resampler } from '../engine.js';

function readWav(path) {
  const b = fs.readFileSync(path);
  let p = 12, fmt = null, data = null;
  while (p < b.length - 8) {
    const id = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') { data = b.subarray(p + 8, p + 8 + size); break; }
    p += 8 + size + (size % 2);
  }
  const n = data.length / 2, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = data.readInt16LE(2 * i) / 32768;
  return { x, sr: fmt.sr };
}
const [wav, refPath, outPath] = process.argv.slice(2);
const model = loadModel(JSON.parse(fs.readFileSync(new URL('../model.json', import.meta.url))));
const { x, sr } = readWav(wav);
const rec = new Recognizer(model), rs = new Resampler(sr), cands = [];
rec.onCandidate = (c) => cands.push({ ...c, delay: rec.time - c.time });
const t0 = Date.now();
for (let i = 0; i < x.length; i += 1024) rec.push(rs.process(x.subarray(i, Math.min(x.length, i + 1024))));
const dt = (Date.now() - t0) / 1000;
const ref = JSON.parse(fs.readFileSync(refPath)).cands.filter((c) => c[0] > 80);
const mine = cands.filter((c) => c.frame > 80);
let exact = 0, near = 0, sameCls = 0, sameRule = 0, maxd = 0;
for (const r of ref) {
  const hit = mine.find((c) => Math.abs(c.frame - r[0]) <= 2 && c.cls === r[1]);
  if (!hit) continue;
  near++; if (hit.frame === r[0]) exact++;
  sameCls++; maxd = Math.max(maxd, Math.abs(hit.conf - r[2]));
  if (r.length < 4 || hit.early === r[3]) sameRule++;
}
const ordered = cands.every((c, i) => i === 0 || c.frame >= cands[i - 1].frame);
const d = cands.map((c) => c.delay).sort((a, b) => a - b), dE = cands.filter((c) => c.early).map((c) => c.delay).sort((a, b) => a - b);
console.log(`${wav} (${sr} Hz) : ${(x.length / sr).toFixed(0)} s traités en ${dt.toFixed(1)} s`);
console.log(`référence Python : ${ref.length} candidats ; JavaScript : ${mine.length} ; retrouvés (même syllabe, à 20 ms près) : ${near}, dont au même instant : ${exact} ; même règle d'émission : ${sameRule} ; écart max de confiance : ${maxd.toFixed(4)}`);
console.log(`ordre chronologique respecté : ${ordered} ; précoces : ${dE.length} sur ${cands.length} ; délai entre l'ancre et l'émission : médiane ${(d[d.length >> 1] * 1000).toFixed(0)} ms (précoces ${(dE[dE.length >> 1] * 1000).toFixed(0)} ms)`);
if (outPath) fs.writeFileSync(outPath, JSON.stringify(cands));
