"""Variantes du modèle final à contexte futur plus court (POST variable), pour mesurer justesse et délai.
Même recette que final_model.py : mêmes exemples, mêmes contre-exemples, même augmentation, même réseau."""
import sys; sys.path.insert(0, '/home/claude/work/phase0')
import numpy as np, json, warnings, os, time
from p0lib import *
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
import final_model as FM
import webmodel as W
warnings.filterwarnings('ignore')

NONE = 7
Mraw, L = FM.Mraw, FM.L
MELPOS = FM.MELPOS

def make_patch(pre, post, Mr=None, Lv=None):
    Mr = Mraw if Mr is None else Mr; Lv = L if Lv is None else Lv
    def patch(f):
        g = min(max(FM.TARGET / max(Lv[f + post - 1], 1e-9), FM.GMIN), FM.GMAX)
        p = np.log(g * g * Mr[f - pre:f + post] + 1e-10)
        return (p - p.mean()).ravel()
    return patch

def training_set(ids, rng, patch, shifts=(-4, -2, 0, 2, 4)):
    X, y = [], []
    for sid in ids:
        ex = W.EX[sid]; fr = [e[0] for e in ex]
        for i, (a, lab) in enumerate(ex):
            for sh in shifts:
                X.append(patch(a + sh)); y.append(lab)
            left = a - fr[i - 1] if i > 0 else 99
            right = fr[i + 1] - a if i + 1 < len(fr) else 99
            for o in (9, 13):
                if o <= right - 7: X.append(patch(a + o)); y.append(NONE)
            for o in (9, 13, 18, 24):
                if o <= left - 7: X.append(patch(a - o)); y.append(NONE)
        for g in W.GHOST.get(sid, []):
            for sh in (-2, 0, 2):
                X.append(patch(g + sh)); y.append(NONE)
    for f in W.silence_frames(rng):
        X.append(patch(int(f))); y.append(NONE)
    return np.array(X), np.array(y)

def augment(X, y, rng, T, copies=2):
    out_X, out_y = [X], [y]
    for _ in range(copies):
        n = len(X)
        tilt = rng.uniform(-1.4, 1.4, n)[:, None] * MELPOS[None, :]
        eq = (rng.uniform(-0.7, 0.7, n)[:, None] * np.cos(np.pi * (MELPOS[None, :] + 0.5) * 2 + rng.uniform(0, 2 * np.pi, n)[:, None])
              + rng.uniform(-0.5, 0.5, n)[:, None] * np.cos(np.pi * (MELPOS[None, :] + 0.5) * 4 + rng.uniform(0, 2 * np.pi, n)[:, None]))
        curve = tilt + eq
        curve = curve - curve.mean(1, keepdims=True)
        out_X.append((X.reshape(n, T, 40) + curve[:, None, :]).reshape(n, T * 40)); out_y.append(y)
    return np.concatenate(out_X), np.concatenate(out_y)

def fit(ids, pre=12, post=18, seed=0, shifts=(-4, -2, 0, 2, 4)):
    rng = np.random.default_rng(seed)
    patch = make_patch(pre, post)
    X, y = training_set(ids, rng, patch, shifts)
    X, y = augment(X, y, rng, pre + post)
    return make_pipeline(StandardScaler(), PCA(60, random_state=0),
                         MLPClassifier(hidden_layer_sizes=(128,), alpha=1e-3, max_iter=500, random_state=seed)).fit(X, y)

def probs(clf, a, b, patch):
    frames = np.arange(a + (a % 2), b, 2)
    P = np.zeros((len(frames), 8)); P[:, clf.classes_] = clf.predict_proba(np.array([patch(f) for f in frames]))
    return frames, P

SERIES = W.SER + [{'id': 'S13', 'tempo': 0, 'labels': SEQ['lignes'][12][:50]}]
R13 = [q for q in W.RUNS if q['type'] == 'libre'][0]
def span(s):
    if s['id'] != 'S13': return int((s['t0'] - 1.5) * 100), int((s['t1'] + 1.5) * 100)
    return int((R13['t0'] + W.OFF - 1) * 100), int((R13['t1'] + W.OFF + 1) * 100)

def cv_posteriors(pre, post, tag=None, shifts=(-4, -2, 0, 2, 4)):
    """Chaque série est décodée par un modèle entraîné sans elle. Résultat mis en cache."""
    path = f'cvp_{tag or f"{pre}_{post}"}.npz'
    if os.path.exists(path):
        Z = np.load(path); return {s['id']: (Z[s['id'] + '_f'], Z[s['id'] + '_p']) for s in SERIES}
    out = {}; patch = make_patch(pre, post)
    for s in SERIES:
        clf = fit([k for k in W.EX if k != s['id']], pre, post, shifts=shifts)
        out[s['id']] = probs(clf, *span(s), patch)
    np.savez(path, **{k + '_f': v[0] for k, v in out.items()}, **{k + '_p': v[1] for k, v in out.items()})
    return out

if __name__ == '__main__':
    t = time.time(); clf = fit([k for k in W.EX if k != 'S01']); print('un entraînement : %.1f s' % (time.time() - t))
    print('exemples :', {k: len(v) for k, v in W.EX.items()})
    print('séries :', [(s['id'], s['tempo'], len(s['labels'])) for s in SERIES])
