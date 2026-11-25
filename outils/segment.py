"""Ancrage des 50 syllabes de chaque série sur l'attaque de leur voyelle, sans utiliser les étiquettes."""
import sys; sys.path.insert(0, '/home/claude/work/phase0')
import numpy as np, json
from p0lib import *

OFF = -0.18
x = load_audio(); runs = load_journal()
ev = band_env(x, 300, 3000, win_ms=30)
evs = np.convolve(ev, np.ones(3) / 3, mode='same')
onset = np.zeros_like(evs)
onset[2:-2] = np.clip(evs[4:] - evs[:-4], 0, None)        # montée en dB sur 40 ms
fl = np.percentile(ev, 5)

def presence(r, lag, b):
    per = 60.0 / r['tempo']
    c = r['t0'] + OFF + lag + b * per
    a, z = int((c + 0.05 * per) * 100), int((c + 0.6 * per) * 100)
    return ev[a:z].max() - fl

def series_lag(r):
    """Retard moyen de la voix sur le surlignage. Le peigne seul est ambigu à une période près :
    on départage avec le début et la fin de la série (silence avant la 1re syllabe et après la 50e)."""
    per = 60.0 / r['tempo']
    best, bl = -1e9, 0
    for lag in np.arange(0.0, 0.46, 0.01):
        idx = np.round((r['t0'] + OFF + lag + per * np.arange(50)) * 100).astype(int)
        c = sum(onset[i - 2:i + 3].max() for i in idx) / 50
        bnd = presence(r, lag, 0) + presence(r, lag, 49) - presence(r, lag, -1) - presence(r, lag, 50)
        s = c + 0.15 * bnd
        if s > best: best, bl = s, lag
    return bl

def anchors(r, lag):
    """Programmation dynamique : 50 attaques, espacées d'environ une période."""
    per = 60.0 / r['tempo']; pf = per * 100
    R = int(min(0.45 * per, 0.35) * 100)
    cands, cost = [], []
    for k in range(50):
        c = int(round((r['t0'] + OFF + lag + k * per) * 100))
        fr = np.arange(c - R, c + R + 1)
        cands.append(fr)
    alpha = 40.0
    score = [onset[cands[0]].copy()]; back = []
    for k in range(1, 50):
        prev, cur = cands[k - 1], cands[k]
        dev = (cur[:, None] - prev[None, :] - pf) / pf
        trans = score[-1][None, :] - alpha * dev ** 2
        trans[cur[:, None] - prev[None, :] < 0.4 * pf] = -1e9      # jamais deux attaques collées
        b = trans.argmax(1)
        back.append(b)
        score.append(onset[cur] + trans[np.arange(len(cur)), b])
    j = int(score[-1].argmax()); path = [j]
    for k in range(48, -1, -1):
        j = int(back[k][j]); path.append(j)
    path = path[::-1]
    return np.array([cands[k][path[k]] for k in range(50)])

out = []
for r in runs:
    if r['type'] != 'grid': continue
    lag = series_lag(r)
    a = anchors(r, lag)
    per = 60.0 / r['tempo']
    n = 50 if r['ok'] else int(r['etat'].split('@')[1])
    beat = (r['t0'] + OFF + per * np.arange(50))
    d = a / 100.0 - beat
    gaps = np.diff(a) / 100.0
    weak = int((onset[a] < 3).sum())
    print('%s %-16s t%3d  retard série %.2f s ; retard par syllabe : médiane %.2f, écart-type %.3f ; intervalles %.3f ± %.3f ; attaques faibles %d' % (
        r['id'], r['etat'], r['tempo'], lag, np.median(d), d.std(), gaps.mean(), gaps.std(), weak))
    out.append({'id': r['id'], 'etat': r['etat'], 'ok': r['ok'], 'tempo': r['tempo'], 'ligne': r['ligne'], 'n': n,
                'anchors': a.tolist(), 'onset': onset[a].round(1).tolist(), 'lag': float(lag)})
json.dump(out, open('anchors.json', 'w'))
np.save('onset.npy', onset); np.save('ev.npy', ev)
