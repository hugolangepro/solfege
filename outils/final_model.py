"""Modèle final avec normalisation du niveau (identique en Python et en JavaScript).
1) validation croisée + simulation du suivi en direct ; 2) entraînement final et export ; 3) candidats de référence."""
import sys; sys.path.insert(0, '/home/claude/work/phase0')
import numpy as np, json, base64, warnings
from p0lib import *
from scipy import signal
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
import webmodel as W
from follow_sim import Follower, candidates
warnings.filterwarnings('ignore')

PRE, POST, NONE = 12, 18, 7
TARGET, GMIN, GMAX, LWIN = 0.060, 0.5, 40.0, 600

def prepare(x):
    M, _ = logmel(x)
    Mraw = np.clip(np.exp(M.astype(np.float64)) - 1e-10, 0, None)
    n = len(M)
    idx = np.arange(n)[:, None] * HOP + np.arange(400)[None, :]
    rms = np.sqrt((x[idx].astype(np.float64) ** 2).mean(1))
    med = rms.copy()
    med[2:] = np.median(np.stack([rms[:-2], rms[1:-1], rms[2:]]), 0)
    med[1] = np.median([rms[0], rms[0], rms[1]]); # début : valeurs disponibles
    # maximum glissant sur 6 s se terminant à chaque trame
    from scipy.ndimage import maximum_filter1d
    L = maximum_filter1d(med, size=LWIN, origin=LWIN // 2 - 1, mode='nearest')
    # contrôle exact sur quelques points
    for k in (700, 12345, 40000):
        assert abs(L[k] - med[max(0, k - LWIN + 1):k + 1].max()) < 1e-12, (k, L[k], med[max(0, k - LWIN + 1):k + 1].max())
    return Mraw, L

def make_patch(Mraw, L):
    def patch(f):
        g = min(max(TARGET / max(L[f + POST - 1], 1e-9), GMIN), GMAX)
        p = np.log(g * g * Mraw[f - PRE:f + POST] + 1e-10)
        return (p - p.mean()).ravel()
    return patch

import os
x = load_audio(os.environ.get('P0_AUDIO', '/home/claude/work/phase0/rs16k.wav'))
Mraw, L = prepare(x)
patch = make_patch(Mraw, L)

def training_set(ids, rng):
    X, y = [], []
    for sid in ids:
        ex = W.EX[sid]; fr = [e[0] for e in ex]
        for i, (a, lab) in enumerate(ex):
            for sh in (-4, -2, 0, 2, 4):
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

MELPOS = (np.arange(40) - 19.5) / 39.0
def augment(X, y, rng, copies=2):
    """Simule d'autres micros : inclinaison du spectre (±6 dB d'un bout à l'autre) et égalisation lente (±3 dB)."""
    out_X, out_y = [X], [y]
    for _ in range(copies):
        n = len(X)
        tilt = rng.uniform(-1.4, 1.4, n)[:, None] * MELPOS[None, :]
        eq = (rng.uniform(-0.7, 0.7, n)[:, None] * np.cos(np.pi * (MELPOS[None, :] + 0.5) * 2 + rng.uniform(0, 2 * np.pi, n)[:, None])
              + rng.uniform(-0.5, 0.5, n)[:, None] * np.cos(np.pi * (MELPOS[None, :] + 0.5) * 4 + rng.uniform(0, 2 * np.pi, n)[:, None]))
        curve = tilt + eq
        curve = curve - curve.mean(1, keepdims=True)
        Xa = (X.reshape(n, 30, 40) + curve[:, None, :]).reshape(n, 1200)
        out_X.append(Xa); out_y.append(y)
    return np.concatenate(out_X), np.concatenate(out_y)

def fit(ids, seed=0):
    rng = np.random.default_rng(seed)
    X, y = training_set(ids, rng)
    X, y = augment(X, y, rng)
    return make_pipeline(StandardScaler(), PCA(60, random_state=0),
                         MLPClassifier(hidden_layer_sizes=(128,), alpha=1e-3, max_iter=500, random_state=seed)).fit(X, y)

def post(clf, a, b, pf=None):
    pf = pf or patch
    frames = np.arange(a + (a % 2), b, 2)
    P = np.zeros((len(frames), 8)); P[:, clf.classes_] = clf.predict_proba(np.array([pf(f) for f in frames]))
    return frames, P

class F2(Follower):
    def push(self, d):
        N = self.N; c = d[1]; ins = 0.3 + 0.6 * d[2]
        new = np.full(N + 1, np.inf); bp = [None] * (N + 1)
        for k in range(N + 1):
            if not np.isfinite(self.cost[k]): continue
            v = self.cost[k] + ins
            if v < new[k]: new[k], bp[k] = v, (k, 'ins')
            for skip in (0, 1, 2):
                j = k + skip
                if j >= N: break
                v = self.cost[k] + skip * self.DEL + (0 if c == self.exp[j] else self.SUB)
                if v < new[j + 1] - 1e-12: new[j + 1], bp[j + 1] = v, (k, 'ok' if c == self.exp[j] else 'sub', skip)
        self.cost = new; self.back.append(bp); self.dets.append(d)
def follow(exp, cands):
    F = F2(exp)
    for d in cands: F.push(d)
    return F.verdicts()

if __name__ == '__main__':
    gs = [TARGET / L[a + POST - 1] for sid in W.EX for a, _ in W.EX[sid]]
    print('gain appliqué sur les exemples : médiane %.2f, p5 %.2f, p95 %.2f' % (np.median(gs), np.percentile(gs, 5), np.percentile(gs, 95)))
    if '--cv' in sys.argv:
        tot = {}
        series = W.SER + [{'id': 'S13', 'tempo': 0, 'labels': SEQ['lignes'][12][:50]}]
        r13 = [q for q in W.RUNS if q['type'] == 'libre'][0]
        for s in series:
            clf = fit([k for k in W.EX if k != s['id']])
            a, b = (int((s['t0'] - 1.5) * 100), int((s['t1'] + 1.5) * 100)) if s['id'] != 'S13' else (int((r13['t0'] + W.OFF - 1) * 100), int((r13['t1'] + W.OFF + 1) * 100))
            fr, P = post(clf, a, b)
            v = follow(list(s['labels']), candidates(fr, P, 0.3, 16))
            t = (sum(q is not None and q[0] == 'ok' for q in v), sum(q is not None and q[0] == 'faux' for q in v), sum(q is None or q[0] == 'manque' for q in v))
            tot.setdefault(s['tempo'], []).append(t)
            print('%s : %d ok, %d faux, %d non entendues' % (s['id'], *t), flush=True)
        for tempo in (60, 120, 0, 180):
            T = np.array(tot[tempo]).sum(0)
            print('%s : %d / %d validées ; %d fausses ; %d non entendues' % ('libre' if tempo == 0 else tempo, T[0], T.sum(), T[1], T[2]))
    clf = fit(list(W.EX.keys()))
    sc, pca, mlp = clf.named_steps['standardscaler'], clf.named_steps['pca'], clf.named_steps['mlpclassifier']
    A = (pca.components_ / sc.scale_).T.astype(np.float32)
    b = (-(sc.mean_ / sc.scale_ + pca.mean_) @ pca.components_.T).astype(np.float32)
    W1, b1, W2, b2 = [a.astype(np.float32) for a in (mlp.coefs_[0], mlp.intercepts_[0], mlp.coefs_[1], mlp.intercepts_[1])]
    f = np.fft.rfftfreq(400, 1 / SR)
    hz2mel = lambda h: 2595 * np.log10(1 + h / 700.0); mel2hz = lambda m: 700 * (10 ** (m / 2595.0) - 1)
    pts = mel2hz(np.linspace(hz2mel(80), hz2mel(7600), 42)); fb = np.zeros((40, len(f)))
    for i in range(40):
        l, c, r = pts[i], pts[i + 1], pts[i + 2]
        fb[i] = np.clip(np.minimum((f - l) / (c - l), (r - f) / (r - c)), 0, None)
    win = signal.get_window('hann', 400)
    b64 = lambda a: base64.b64encode(np.ascontiguousarray(a, dtype=np.float32).tobytes()).decode()
    model = {'version': 2, 'trained': '2026-11-25', 'sr': 16000, 'n_fft': 400, 'hop': 160, 'n_mels': 40, 'pre': PRE, 'post': POST,
             'level': {'target': TARGET, 'gmin': GMIN, 'gmax': GMAX, 'window': LWIN},
             'classes': ['do', 'ré', 'mi', 'fa', 'sol', 'la', 'si', '_'],
             'window': b64(win), 'fb': b64(fb), 'A': b64(A), 'b': b64(b), 'W1': b64(W1), 'b1': b64(b1), 'W2': b64(W2), 'b2': b64(b2)}
    json.dump(model, open('model.json', 'w'))
    import pickle; pickle.dump(clf, open('final_web.pkl', 'wb'))
    # candidats de référence sur tout l'enregistrement, pour vérifier le moteur JavaScript
    fr, P = post(clf, 30, len(Mraw) - 20)
    ref = candidates(fr, P, 0.3, 16)
    json.dump({'cands': ref, 'n_frames': int(len(Mraw))}, open('ref_cands.json', 'w'))
    print('référence :', len(ref), 'candidats sur tout l\'enregistrement')
    # sensibilité au gain après normalisation
    s = [q for q in W.SER if q['id'] == 'S04'][0]
    a0, b0 = int((s['t0'] - 1) * 100), int((s['t1'] + 1) * 100)
    base = candidates(*post(clf, a0, b0), 0.3, 16)
    for g in (0.1, 0.01, 0.002):
        Mg, Lg = prepare(x * g)
        c = candidates(*post(clf, a0, b0, make_patch(Mg, Lg)), 0.3, 16)
        same = sum(1 for q in c if any(abs(q[0] - r[0]) <= 2 and q[1] == r[1] for r in base))
        print('gain ×%-6s : %d candidats (référence %d), dont %d identiques' % (g, len(c), len(base), same))
