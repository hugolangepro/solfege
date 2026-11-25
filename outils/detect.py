"""Détecteur de syllabes : reconnaissance libre (sans grille fixe), puis alignement sur le texte affiché."""
import sys; sys.path.insert(0, '/home/claude/work/phase0')
import numpy as np, json, warnings
from p0lib import *
from scipy.signal import find_peaks
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.pipeline import make_pipeline
warnings.filterwarnings('ignore')

OFF = -0.18
M = np.load('logmel.npy')
RUNS = load_journal()
A = json.load(open('anchors.json'))
SER = [s for s in A if s['ok']]
for s in SER:
    s['labels'] = SEQ['lignes'][s['ligne'] - 1][:50]
    r = [q for q in RUNS if q['id'] == s['id'] and q['ok']][0]
    s['t0'], s['t1'] = r['t0'] + OFF, r['t1'] + OFF
PRE, POST = 12, 18
NONE = 7

def patch(a):
    p = M[a - PRE:a + POST]
    return (p - p.mean()).ravel()

def silence_frames(rng, n_per_series=25):
    out = []
    for s in SER:
        per = 60.0 / s['tempo']
        a, b = int((s['t0'] - 4 * per + 0.1) * 100), int((s['t0'] - 0.25) * 100)
        if b > a: out += list(rng.integers(a, b, n_per_series))
    sil = [q for q in RUNS if q['type'] == 'silence'][0]
    out += list(rng.integers(int((sil['t0'] + OFF + 0.5) * 100), int((sil['t1'] + OFF - 0.5) * 100), 150))
    return out

def make_training(examples, rng):
    """examples : {serie: [(trame, étiquette), ...]} triés par temps."""
    X, y = [], []
    for sid, ex in examples.items():
        fr = [e[0] for e in ex]
        for i, (a, lab) in enumerate(ex):
            for sh in (-4, -2, 0, 2, 4):
                X.append(patch(a + sh)); y.append(lab)
            left = a - fr[i - 1] if i > 0 else 99
            right = fr[i + 1] - a if i + 1 < len(fr) else 99
            for o in (9, 13):                      # contre-exemples : fenêtres mal calées
                if o <= right - 7: X.append(patch(a + o)); y.append(NONE)
                if o <= left - 7: X.append(patch(a - o)); y.append(NONE)
    for f in silence_frames(rng):
        X.append(patch(int(f))); y.append(NONE)
    return np.array(X), np.array(y)

def fit(examples, seed=0):
    rng = np.random.default_rng(seed)
    X, y = make_training(examples, rng)
    return make_pipeline(StandardScaler(), PCA(60, random_state=0), SVC(C=10, gamma='scale', probability=True, random_state=0)).fit(X, y)

def detect(clf, s, thr=0.5):
    per = 60.0 / s['tempo'] if s.get('tempo') else 0.33
    a, b = int((s['t0'] - 0.4) * 100), int((s['t1'] + 1.2) * 100)
    frames = np.arange(a, b, 2)
    P = clf.predict_proba(np.array([patch(f) for f in frames]))
    cls = list(clf.classes_)
    syl = P[:, [cls.index(c) for c in range(7)]]
    S = syl.max(1)
    pk, _ = find_peaks(S, height=thr, distance=max(int(0.45 * per * 50), 4))
    return [(int(frames[i]), int(syl[i].argmax()), float(S[i]), syl[i].round(4).tolist()) for i in pk]

def align(hyp, ref):
    """Alignement par distance d'édition. Renvoie la liste (i_hyp ou None, j_ref ou None)."""
    n, m = len(hyp), len(ref)
    D = np.zeros((n + 1, m + 1), int); D[:, 0] = np.arange(n + 1); D[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            D[i, j] = min(D[i - 1, j - 1] + (hyp[i - 1] != ref[j - 1]), D[i - 1, j] + 1, D[i, j - 1] + 1)
    i, j, path = n, m, []
    while i > 0 or j > 0:
        if i > 0 and j > 0 and D[i, j] == D[i - 1, j - 1] + (hyp[i - 1] != ref[j - 1]):
            path.append((i - 1, j - 1)); i -= 1; j -= 1
        elif i > 0 and D[i, j] == D[i - 1, j] + 1:
            path.append((i - 1, None)); i -= 1
        else:
            path.append((None, j - 1)); j -= 1
    return path[::-1]

def tally(path, hyp, ref):
    ok = sum(1 for i, j in path if i is not None and j is not None and hyp[i] == ref[j])
    sub = sum(1 for i, j in path if i is not None and j is not None and hyp[i] != ref[j])
    ins = sum(1 for i, j in path if j is None); dele = sum(1 for i, j in path if i is None)
    return ok, sub, dele, ins
