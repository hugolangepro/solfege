// Relit un fichier de diagnostic partagé depuis l'app : repasse le son dans le moteur et compare à ce que l'app a entendu.
// Usage : node tests/diag.mjs fichier.wav
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModel, Recognizer, Follower, SYLLABES } from '../engine.js';

const ici = path.dirname(fileURLToPath(import.meta.url));
const raw = fs.readFileSync(process.argv[2]);
const blocs = {};
for (let pos = 12; pos + 8 <= raw.length;) {
  const n = raw.readUInt32LE(pos + 4);
  blocs[raw.toString('latin1', pos, pos + 4)] = raw.subarray(pos + 8, pos + 8 + n);
  pos += 8 + n + (n & 1);
}
const meta = JSON.parse(blocs.sLFG.toString('utf8'));
const pcm = new Int16Array(blocs.data.buffer, blocs.data.byteOffset, blocs.data.length / 2);
const x = Float32Array.from(pcm, (v) => v / 32768);

const model = loadModel(JSON.parse(fs.readFileSync(path.join(ici, '..', 'model.json'), 'utf8')));
const rec = new Recognizer(model);
const heard = [];
rec.onCandidate = (c) => { if (c.time >= meta.tStart) heard.push(c); };
for (let i = 0; i < x.length; i += 160) rec.push(x.subarray(i, Math.min(x.length, i + 160)));

const fol = new Follower(meta.attendu.map((s) => SYLLABES.indexOf(s)));
for (const c of heard) fol.push(c);
const v = fol.verdicts().map((q) => (q ? q.v : null));
const memes = heard.length === meta.entendu.length
  && heard.every((c, i) => SYLLABES[c.cls] === meta.entendu[i][1] && Math.abs(c.time * 1000 - meta.entendu[i][0]) <= 25);
console.log(`app ${meta.app} · ${meta.ua}`);
console.log(`micro : ${JSON.stringify(meta.micro)} · contexte ${meta.rate} Hz · installée ${meta.installee}`);
console.log(`attendu  : ${meta.attendu.join(' ')}`);
console.log(`entendu  : ${meta.entendu.map((e) => `${e[1]}(${e[2]})`).join(' ')}`);
console.log(`verdicts : ${meta.verdicts.map((q) => (q === 'ok' ? '·' : q === 'faux' ? 'F' : q === 'manque' ? '?' : '_')).join('')}`);
const ms = (q, k) => (q ? `médiane ${(q.med * k).toFixed(1)}, 95 % sous ${(q.p95 * k).toFixed(1)}, max ${(q.max * k).toFixed(1)} ms` : 'non mesuré');
const dl = meta.entendu.map((e) => e[3]).filter((v) => v !== undefined).sort((a, b) => a - b);
if (dl.length) console.log(`reconnaissance : ${meta.entendu.filter((e) => e[4]).length} syllabes sur ${meta.entendu.length} sans attendre le sommet ; son écoulé avant reconnaissance : médiane ${dl[dl.length >> 1]} ms, max ${dl[dl.length - 1]} ms`);
console.log(`du micro à l'app : ${ms(meta.livraison, 1000)} ; dessin de la page : ${ms(meta.dessin, 1)}`);
console.log(`rejeu : ${heard.length} syllabes, ${v.filter((q) => q === 'ok').length} notes justes ; app : ${meta.entendu.length} syllabes, ${meta.verdicts.filter((q) => q === 'ok').length} notes justes ; mêmes syllabes aux mêmes instants : ${memes}`);
