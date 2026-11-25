// Piano : quatorze notes enregistrées (Salamander Grand Piano, voir NOTICE), une toutes les tierces mineures du la1 au do5.
// Une note demandée est jouée par l'échantillon le plus proche, transposé d'un demi-ton et demi au plus.
const NOTES = [45, 48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84];
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

// Ce qui sonne ou va sonner : pour pouvoir tout couper avant de rejouer, sans superposition.
const vivants = new Set();
export function couper(ctx) {
  const t = ctx.currentTime;
  for (const [src, g] of vivants) {
    try { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + 0.03); src.stop(t + 0.04); } catch (e) { /* déjà finie */ }
  }
  vivants.clear();
}

// Joue la note MIDI pendant `dur` secondes, `quand` secondes après maintenant ; rend l'instant de départ sur l'horloge du contexte.
export function jouer(ctx, banc, midi, dur = 1.2, gain = 0.9, quand = 0) {
  const base = NOTES.reduce((a, n) => (Math.abs(n - midi) < Math.abs(a - midi) ? n : a), NOTES[0]);
  const src = ctx.createBufferSource(), g = ctx.createGain(), t0 = ctx.currentTime + 0.03 + quand;
  src.buffer = banc.get(base); src.playbackRate.value = 2 ** ((midi - base) / 12);
  g.gain.setValueAtTime(gain, t0); g.gain.setValueAtTime(gain, t0 + dur - 0.25); g.gain.linearRampToValueAtTime(0, t0 + dur);
  src.connect(g); g.connect(ctx.destination); src.start(t0); src.stop(t0 + dur + 0.05);
  const paire = [src, g];
  vivants.add(paire); src.onended = () => vivants.delete(paire);
  return t0;
}
