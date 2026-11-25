// Fausses détections sur des sons du quotidien : nombre de syllabes « entendues » par minute de son.
// Usage : node tests/bruits.mjs chemin/vers/ESC-50/audio ['{"tau":0}']
import fs from 'node:fs';
import path from 'node:path';
const enginePath = new URL('../engine.js', import.meta.url).pathname;
const { loadModel, Recognizer, Resampler, SYLLABES } = await import(enginePath);
const opts = process.argv[3] ? JSON.parse(process.argv[3]) : {};   // ex. '{"tau":0}' pour retirer le filtre
const DIR = process.argv[2];                                        // dossier audio/ du jeu ESC-50 (non fourni : licence CC BY-NC)
const NAMES = { 32: 'clavier d\'ordinateur', 31: 'clic de souris', 30: 'coups à la porte', 22: 'applaudissements', 24: 'toux', 23: 'respiration', 26: 'rire', 21: 'éternuement', 25: 'pas', 38: 'tic-tac', 34: 'canette', 29: 'boire', 33: 'porte qui grince', 39: 'verre brisé', 17: 'eau versée', 37: 'réveil', 20: 'bébé qui pleure', 0: 'chien', 5: 'chat', 46: 'cloches', 27: 'brossage de dents' };
function readWav(p) {
  const b = fs.readFileSync(p); let q = 12, sr = 0, ch = 1, data = null;
  while (q < b.length - 8) { const id = b.toString('ascii', q, q + 4), size = b.readUInt32LE(q + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(q + 10); sr = b.readUInt32LE(q + 12); }
    if (id === 'data') { data = b.subarray(q + 8, q + 8 + size); break; }
    q += 8 + size + (size % 2); }
  const n = data.length / 2 / ch, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = data.readInt16LE(2 * i * ch) / 32768;
  return { x, sr };
}
const model = loadModel(JSON.parse(fs.readFileSync(path.join(path.dirname(enginePath), 'model.json'), 'utf8')));
const per = {};
for (const f of fs.readdirSync(DIR).sort()) {
  const t = +f.replace('.wav', '').split('-')[3];
  const { x, sr } = readWav(path.join(DIR, f));
  const rec = new Recognizer(model, opts), rs = new Resampler(sr); const c = [];
  rec.onCandidate = (q) => c.push(q);
  for (let i = 0; i < x.length; i += 512) rec.push(rs.process(x.subarray(i, Math.min(x.length, i + 512))));
  const r = per[t] = per[t] || { n: 0, sec: 0, all: 0, strong: 0, clips: 0 };
  r.n++; r.sec += x.length / sr; r.all += c.length; r.strong += c.filter((q) => q.conf >= 0.9).length; r.clips += c.some((q) => q.conf >= 0.9) ? 1 : 0;
}
let T = { sec: 0, all: 0, strong: 0 };
for (const [t, r] of Object.entries(per).sort((a, b) => b[1].strong / b[1].sec - a[1].strong / a[1].sec)) {
  console.log(`${(NAMES[t] || t).padEnd(22)} ${String(r.n).padStart(3)} extraits : ${(60 * r.strong / r.sec).toFixed(1).padStart(6)} syllabes nettes par minute (${(60 * r.all / r.sec).toFixed(1)} avec les moins nettes) ; extraits touchés ${r.clips}`);
  T.sec += r.sec; T.all += r.all; T.strong += r.strong;
}
console.log(`ensemble : ${(T.sec / 60).toFixed(0)} min de sons, ${(60 * T.strong / T.sec).toFixed(1)} syllabes nettes par minute, ${(60 * T.all / T.sec).toFixed(1)} en tout`);
