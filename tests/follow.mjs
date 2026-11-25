// Rejoue chaque série de l'enregistrement dans le moteur complet (48 kHz -> candidats -> suivi) et compte les notes validées.
import fs from 'node:fs';
import { loadModel, Follower, SYLLABES } from '../engine.js';
const cands = JSON.parse(fs.readFileSync('/tmp/js48.json'));
const seq = JSON.parse(fs.readFileSync('../phase0/sequences.json'));
const journal = fs.readFileSync('../phase0/journal.txt', 'utf8').trim().split('\n').slice(1).map((l) => Object.fromEntries(l.split(';').map((kv, i) => (i ? kv.split('=') : ['id', kv]))));
const OFF = -0.18;
let tot = {};
for (const r of journal) {
  if (r.etat !== 'ok' || !r.ligne) continue;
  const t0 = parseFloat(r.premiere_note) + OFF, t1 = parseFloat(r.fin) + OFF;
  const exp = seq.lignes[+r.ligne - 1].slice(0, 50);
  const F = new Follower(exp);
  for (const c of cands) if (c.time > t0 - 1.5 && c.time < t1 + 1.5) F.push(c);
  const v = F.verdicts();
  const ok = v.filter((q) => q && q.v === 'ok').length, faux = v.filter((q) => q && q.v === 'faux').length;
  const key = r.tempo || 'libre';
  tot[key] = tot[key] || [0, 0, 0]; tot[key][0] += ok; tot[key][1] += faux; tot[key][2] += 50 - ok - faux;
}
for (const [k, t] of Object.entries(tot)) console.log(`${k} : ${t[0]} validées, ${t[1]} fausses, ${t[2]} non entendues`);
