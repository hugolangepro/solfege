"""Bruits de synthèse pour apprendre au filtre ce qui n'est pas une syllabe, sans dépendre d'enregistrements sous licence :
chocs et clics (touches, souris, tic-tac), coups sourds, souffles, bips, notes à harmoniques qui s'éteignent (piano, cloche)."""
import numpy as np
from scipy import signal
from scipy.io import wavfile
SR = 16000

def resonant_noise(rng, n, fc, q):
    """Bruit blanc filtré autour de fc ; q grand = bande étroite."""
    bw = 1.0 / max(q, 0.35)                                   # largeur en octaves, à peu près
    lo, hi = max(30.0, fc * 2 ** (-bw / 2)), min(7800.0, fc * 2 ** (bw / 2))
    if hi <= lo * 1.02: lo = hi / 1.05
    sos = signal.butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band', output='sos')
    return signal.sosfilt(sos, rng.standard_normal(n))

def click(rng):
    tau = 10 ** rng.uniform(-3, -1.5)                      # 1 à 30 ms
    n = int(SR * min(0.25, 8 * tau)) + 64; t = np.arange(n) / SR
    x = np.zeros(n)
    for _ in range(rng.integers(1, 4)):
        x += rng.uniform(0.3, 1) * resonant_noise(rng, n, 10 ** rng.uniform(2.3, 3.88), rng.uniform(0.7, 12))
    if rng.random() < 0.3: x += rng.uniform(0.3, 1.5) * rng.standard_normal(n)
    x *= np.exp(-t / tau)
    if rng.random() < 0.5:                                # coup sourd : le doigt ou la touche en butée
        f = rng.uniform(50, 350); x += rng.uniform(0.5, 3) * np.abs(x).max() * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / rng.uniform(0.008, 0.06))
    att = int(SR * rng.uniform(0, 0.002)) + 1; x[:att] *= np.linspace(0, 1, att)
    return x / (np.abs(x).max() + 1e-9)

def thump(rng):
    n = int(SR * rng.uniform(0.08, 0.4)); t = np.arange(n) / SR; x = np.zeros(n)
    for _ in range(rng.integers(1, 5)):
        f = 10 ** rng.uniform(1.8, 3.0); x += rng.uniform(0.2, 1) * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / rng.uniform(0.01, 0.12))
    x += rng.uniform(0, 0.5) * resonant_noise(rng, n, 10 ** rng.uniform(2.3, 3.5), rng.uniform(0.7, 4)) * np.exp(-t / rng.uniform(0.005, 0.04))
    return x / (np.abs(x).max() + 1e-9)

def hiss(rng):
    n = int(SR * rng.uniform(0.08, 0.9)); t = np.arange(n) / SR
    x = resonant_noise(rng, n, 10 ** rng.uniform(2.3, 3.85), rng.uniform(0.5, 3)) + rng.uniform(0, 0.5) * rng.standard_normal(n)
    a, d = rng.uniform(0.005, 0.2), rng.uniform(0.02, 0.4)
    env = np.minimum(1, t / a) * np.minimum(1, (t[-1] - t) / d + 1e-3)
    if rng.random() < 0.3: env *= 0.6 + 0.4 * np.sin(2 * np.pi * rng.uniform(3, 25) * t)
    x *= env
    return x / (np.abs(x).max() + 1e-9)

def tone(rng):
    n = int(SR * rng.uniform(0.06, 1.5)); t = np.arange(n) / SR
    f = 10 ** rng.uniform(1.9, 3.5); kind = rng.integers(0, 4)
    if kind == 0:                                         # bip
        x = np.sin(2 * np.pi * f * t) + rng.uniform(0, 0.5) * np.sin(4 * np.pi * f * t)
        env = np.minimum(1, t / 0.005) * np.minimum(1, (t[-1] - t) / 0.01 + 1e-3)
    elif kind == 1:                                       # corde frappée ou pincée : harmoniques qui s'éteignent
        x = sum(rng.uniform(0.2, 1) / k * np.sin(2 * np.pi * f * k * (1 + 0.0004 * k * k) * t + rng.uniform(0, 6.28)) * np.exp(-t * k * rng.uniform(1, 6)) for k in range(1, rng.integers(3, 12)) if f * k < 7500)
        env = np.minimum(1, t / rng.uniform(0.001, 0.01))
    elif kind == 2:                                       # cloche, verre : partiels inharmoniques
        x = sum(rng.uniform(0.2, 1) * np.sin(2 * np.pi * min(f * r, 7500) * t + rng.uniform(0, 6.28)) * np.exp(-t / rng.uniform(0.03, 0.8)) for r in rng.uniform(1, 6, rng.integers(2, 7)))
        env = np.minimum(1, t / 0.002)
    else:                                                 # sirène, glissando
        ph = 2 * np.pi * np.cumsum(f * 2 ** (rng.uniform(-1, 1) * t / t[-1] + rng.uniform(0, 0.3) * np.sin(2 * np.pi * rng.uniform(1, 8) * t))) / SR
        x = np.sin(ph) + rng.uniform(0, 0.6) * np.sin(2 * ph) + rng.uniform(0, 0.4) * np.sin(3 * ph)
        env = np.minimum(1, t / 0.02) * np.minimum(1, (t[-1] - t) / 0.05 + 1e-3)
    x = x * env
    return x / (np.abs(x).max() + 1e-9)

def clip(rng, dur=5.0):
    n = int(SR * dur); x = np.zeros(n)
    kinds = [click, thump, hiss, tone]; p = rng.dirichlet([2.0, 0.8, 0.8, 0.8])
    main = rng.choice(4, p=[0.45, 0.15, 0.15, 0.25])
    t = rng.uniform(0, 0.5)
    while t < dur - 0.05:
        k = main if rng.random() < 0.7 else rng.choice(4, p=p)
        ev = kinds[k](rng) * 10 ** (rng.uniform(-26, 0) / 20)
        i = int(t * SR); m = min(len(ev), n - i); x[i:i + m] += ev[:m]
        if k == 0 and rng.random() < 0.5:                 # touche relâchée : second clic plus faible
            j = i + int(SR * rng.uniform(0.05, 0.16)); ev2 = click(rng) * np.abs(ev).max() * rng.uniform(0.2, 0.8); m2 = min(len(ev2), n - j)
            if m2 > 0: x[j:j + m2] += ev2[:m2]
        t += 10 ** rng.uniform(-1.3, 0.1) if k == 0 else rng.uniform(0.15, 1.5)
    # fond : bruit stationnaire
    bg = rng.standard_normal(n)
    if rng.random() < 0.6: bg = signal.lfilter(*signal.butter(1, 60 / (SR / 2), 'high'), np.cumsum(bg))      # bruit grave, façon ventilation
    bg = bg / (np.abs(bg).std() + 1e-9) * 10 ** (rng.uniform(-70, -32) / 20)
    x = x / (np.abs(x).max() + 1e-9) * 10 ** (rng.uniform(-30, -3) / 20) + bg
    # le micro et la pièce : le filtre ne doit pas apprendre à reconnaître un canal
    if rng.random() < 0.4: x = signal.sosfilt(signal.butter(2, rng.uniform(80, 450) / (SR / 2), 'high', output='sos'), x)
    if rng.random() < 0.4: x = signal.sosfilt(signal.butter(2, rng.uniform(2200, 7000) / (SR / 2), 'low', output='sos'), x)
    if rng.random() < 0.3:
        rt = rng.uniform(0.15, 0.7); m = int(SR * rt * 1.2); tt = np.arange(m) / SR
        h = rng.standard_normal(m) * np.exp(-6.9 * tt / rt); h[:32] = 0; h /= np.sqrt((h ** 2).sum())
        x = x + rng.uniform(0.2, 0.7) * signal.fftconvolve(x, h)[:n]
    return x.astype(np.float32)

if __name__ == '__main__':
    import os, sys
    out = '/home/claude/work/synth16k'; os.makedirs(out, exist_ok=True)
    rng = np.random.default_rng(1)
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 700
    for i in range(n):
        x = clip(rng)
        assert np.isfinite(x).all(), i
        wavfile.write(f'{out}/{1 + i % 5}-{i}-A-99.wav', SR, np.clip(x * 32767, -32768, 32767).astype(np.int16))
    print(n, 'extraits de synthèse')
