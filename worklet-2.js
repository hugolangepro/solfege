// Relaie le son du micro vers la page par blocs d'environ 5 ms, avec l'heure audio de la fin du bloc.
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(256); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage({ x: this.buf.slice(0), t: (currentFrame + i + 1) / sampleRate });
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('tap', Tap);
