"""Décodage libre v2 : candidats du détecteur + a priori souple de tempo, puis alignement texte/temps."""
import sys; sys.path.insert(0, '/home/claude/work/phase0')
from detect import *

def candidates(clf, s, a=None, b=None, floor=0.15):
    a = int((s['t0'] - 0.5) * 100) if a is None else a
    b = int((s['t1'] + 1.3) * 100) if b is None else b
    frames = np.arange(a, b, 2)
    P = clf.predict_proba(np.array([patch(f) for f in frames]))
    cls = list(clf.classes_)
    syl = P[:, [cls.index(c) for c in range(7)]]
    S = syl.max(1)
    pk, _ = find_peaks(S, height=floor, distance=3)
    return [(int(frames[i]), int(syl[i].argmax()), float(S[i]), syl[i].round(4).tolist()) for i in pk]

def select(cands, per_frames, alpha=6.0):
    """Sous-suite de candidats maximisant la somme des log-cotes moins les pénalités d'espacement."""
    n = len(cands)
    if n == 0: return []
    lo = np.array([np.clip(np.log(c[2] / (1 - c[2] + 1e-9)), -4, 4) for c in cands])
    fr = np.array([c[0] for c in cands], float)
    best = lo.copy(); prev = -np.ones(n, int)
    for i in range(n):
        for j in range(i - 1, -1, -1):
            d = (fr[i] - fr[j]) / per_frames
            if d < 0.5: continue
            pen = alpha * (d - 1) ** 2 if d < 1.5 else alpha * 0.25
            v = best[j] - pen + lo[i]
            if v > best[i]: best[i], prev[i] = v, j
            if d > 4: break
    i = int(best.argmax()); out = []
    while i >= 0:
        out.append(cands[i]); i = prev[i]
    return out[::-1]

def align_t(det, s):
    """Alignement sur le texte en tenant compte du temps (position en battements)."""
    per = 60.0 / s['tempo']; ref = s['labels']
    lagb = s['lag'] / per
    pos = [(d[0] / 100.0 - s['t0']) / per for d in det]
    n, m = len(det), len(ref)
    D = np.zeros((n + 1, m + 1)); D[:, 0] = np.arange(n + 1); D[0, :] = np.arange(m + 1)
    def c(i, j):
        return (det[i][1] != ref[j]) * 1.0 + 0.8 * min(1.0, abs(pos[i] - j - lagb))
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            D[i, j] = min(D[i - 1, j - 1] + c(i - 1, j - 1), D[i - 1, j] + 1, D[i, j - 1] + 1)
    i, j, path = n, m, []
    while i > 0 or j > 0:
        if i > 0 and j > 0 and abs(D[i, j] - (D[i - 1, j - 1] + c(i - 1, j - 1))) < 1e-9:
            path.append((i - 1, j - 1)); i -= 1; j -= 1
        elif i > 0 and abs(D[i, j] - (D[i - 1, j] + 1)) < 1e-9:
            path.append((i - 1, None)); i -= 1
        else:
            path.append((None, j - 1)); j -= 1
    return path[::-1]

def decode(clf, s):
    per = 60.0 / s['tempo']
    det = select(candidates(clf, s), per * 100)
    path = align_t(det, s)
    hyp = [d[1] for d in det]
    return det, path, tally(path, hyp, s['labels'])

def examples_from(det, path, s):
    return sorted((det[i][0], s['labels'][j]) for i, j in path if i is not None and j is not None and det[i][1] == s['labels'][j])
