// Piano : onze notes enregistrées (Salamander Grand Piano, voir NOTICE), une toutes les tierces mineures du la1 au ré♯4.
// Une note demandée est jouée par l'échantillon le plus proche, transposé d'un demi-ton et demi au plus.
const NOTES = [45, 48, 51, 54, 57, 60, 63, 66, 69, 72, 75];
const bancs = new WeakMap();                              // un jeu d'échantillons décodés par contexte audio

export function chargerPiano(ctx) {
  if (!bancs.has(ctx)) {
    bancs.set(ctx, Promise.all(NOTES.map(async (n) => {
      const r = await fetch(`piano/${n}.mp3`);
      if (!r.ok) throw new Error('piano introuvable');
      const data = await r.arrayBuffer();
      // la forme à fonctions de rappel marche partout, y compris sur les Safari anciens
      const buf = await new Promise((ok, ko) => ctx.decodeAudioData(data, ok, ko));
      return [n, buf];
    })).then((a) => new Map(a)));
  }
  return bancs.get(ctx);
}

// Joue la note MIDI pendant `dur` secondes ; rend l'instant de départ sur l'horloge du contexte.
export function jouer(ctx, banc, midi, dur = 1.2, gain = 0.9) {
  const base = NOTES.reduce((a, n) => (Math.abs(n - midi) < Math.abs(a - midi) ? n : a), NOTES[0]);
  const src = ctx.createBufferSource(), g = ctx.createGain(), t0 = ctx.currentTime + 0.03;
  src.buffer = banc.get(base); src.playbackRate.value = 2 ** ((midi - base) / 12);
  g.gain.setValueAtTime(gain, t0); g.gain.setValueAtTime(gain, t0 + dur - 0.25); g.gain.linearRampToValueAtTime(0, t0 + dur);
  src.connect(g); g.connect(ctx.destination); src.start(t0); src.stop(t0 + dur + 0.05);
  return t0;
}
