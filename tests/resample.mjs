// Écrit le son rééchantillonné par le moteur (48 kHz -> 16 kHz) pour entraîner le modèle sur le même signal que l'app.
import fs from 'node:fs';
import { Resampler } from '../engine.js';
const [src, dst] = process.argv.slice(2);
const b = fs.readFileSync(src);
let p = 12, sr = 0, data = null;
while (p < b.length - 8) {
  const id = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
  if (id === 'fmt ') sr = b.readUInt32LE(p + 12);
  if (id === 'data') { data = b.subarray(p + 8, p + 8 + size); break; }
  p += 8 + size + (size % 2);
}
const n = data.length / 2, x = new Float32Array(n);
for (let i = 0; i < n; i++) x[i] = data.readInt16LE(2 * i) / 32768;
const rs = new Resampler(sr), parts = [];
for (let i = 0; i < n; i += 4096) parts.push(rs.process(x.subarray(i, Math.min(n, i + 4096))));
const m = parts.reduce((a, q) => a + q.length, 0), out = Buffer.alloc(44 + 2 * m);
out.write('RIFF', 0); out.writeUInt32LE(36 + 2 * m, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20);
out.writeUInt16LE(1, 22); out.writeUInt32LE(16000, 24); out.writeUInt32LE(32000, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
out.write('data', 36); out.writeUInt32LE(2 * m, 40);
let o = 44;
for (const q of parts) for (let i = 0; i < q.length; i++) { out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(q[i] * 32768))), o); o += 2; }
fs.writeFileSync(dst, out);
console.log(sr, '->', 16000, ':', m, 'échantillons');
