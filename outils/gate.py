"""Filtre « est-ce bien une syllabe dite ? » : un petit modèle à part, qui laisse intact le modèle des syllabes.
Positifs : les syllabes de l'enregistrement. Négatifs : sons du quotidien là où le modèle des syllabes se déclenche."""
import sys; sys.path.insert(0, '/home/claude/work/phase0')
import numpy as np, os, glob, pickle, json, warnings
from scipy.io import wavfile
from scipy.ndimage import maximum_filter1d
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
import final_model as FM, fastmodel as F, latency as Lt
from p0lib import logmel, HOP
warnings.filterwarnings('ignore')
W = F.W
PRE, POST = 12, 18
NOISE_DIR = '/home/claude/work/noise16k'

def prepare_clip(x):
    """Mêmes caractéristiques que FM.prepare, sans ses contrôles (prévus pour l'enregistrement long)."""
    M, _ = logmel(x)
    Mraw = np.clip(np.exp(M.astype(np.float64)) - 1e-10, 0, None)
    n = len(M)
    idx = np.arange(n)[:, None] * HOP + np.arange(400)[None, :]
    rms = np.sqrt((x[idx].astype(np.float64) ** 2).mean(1))
    med = rms.copy()
    if n > 2: med[2:] = np.median(np.stack([rms[:-2], rms[1:-1], rms[2:]]), 0)
    if n > 1: med[1] = np.median([rms[0], rms[0], rms[1]])
    L = maximum_filter1d(med, size=FM.LWIN, origin=FM.LWIN // 2 - 1, mode='nearest')
    L = np.maximum.accumulate(med) if n <= FM.LWIN else L
    return Mraw, L

def clip_steps(x, clf):
    """Pour un extrait : trames des pas, probabilités du modèle des syllabes, et la fonction qui donne l'image d'un pas."""
    Mraw, L = prepare_clip(x)
    patch = F.make_patch(PRE, POST, Mraw, L)
    fr = np.arange(PRE + (PRE % 2), len(Mraw) - POST, 2)
    if len(fr) == 0: return fr, np.zeros((0, 8)), patch
    X = np.array([patch(f) for f in fr])
    P = np.zeros((len(fr), 8)); P[:, clf.classes_] = clf.predict_proba(X)
    return fr, P, X

def load_wav(p):
    sr, x = wavfile.read(p); assert sr == 16000
    return x.astype(np.float32) / 32768.0

def noise_set(clf, files, tag, per_clip=40, rng=None):
    """Négatifs : pas où le modèle des syllabes dépasse 0,3 (les pièges), plus quelques pas pris au hasard."""
    cache = f'gate_neg_{tag}.npz'
    if os.path.exists(cache):
        Z = np.load(cache, allow_pickle=True); return Z['X'], Z['clip']
    rng = rng or np.random.default_rng(0)
    Xs, cl = [], []
    for k, p in enumerate(files):
        fr, P, X = clip_steps(load_wav(p), clf)
        if len(fr) == 0: continue
        S = P[:, :7].max(1)
        hard = np.where(S >= 0.3)[0]
        if len(hard) > per_clip: hard = rng.choice(hard, per_clip, replace=False)
        easy = rng.choice(len(fr), min(6, len(fr)), replace=False)
        sel = np.unique(np.concatenate([hard, easy]))
        Xs.append(X[sel]); cl += [k] * len(sel)
    X = np.concatenate(Xs); cl = np.array(cl)
    np.savez(cache, X=X, clip=cl)
    return X, cl

def speech_pos(ids, shifts=(-6, -4, -2, 0, 2, 4)):
    patch = F.make_patch(PRE, POST)
    return np.array([patch(a + sh) for sid in ids for a, c in W.EX[sid] for sh in shifts])

def fit_gate(Xpos, Xneg, seed=0, pca=40, hidden=32):
    rng = np.random.default_rng(seed)
    X = np.concatenate([Xpos, Xneg]); y = np.concatenate([np.ones(len(Xpos)), np.zeros(len(Xneg))])
    X, y = F.augment(X, y, rng, PRE + POST)
    return make_pipeline(StandardScaler(), PCA(pca, random_state=0),
                         MLPClassifier(hidden_layer_sizes=(hidden,), alpha=1e-3, max_iter=400, random_state=seed)).fit(X, y)

def gate_prob(g, X): return g.predict_proba(X)[:, list(g.classes_).index(1.0)] if len(X) else np.zeros(0)

def files_of(folds=None, targets=None):
    out = []
    for p in sorted(glob.glob(NOISE_DIR + '/*.wav')):
        fold, _, _, t = os.path.basename(p)[:-4].split('-')
        if (folds is None or int(fold) in folds) and (targets is None or int(t) in targets): out.append(p)
    return out

NAMES = {32: 'clavier', 31: 'souris', 30: 'porte', 22: 'applaud.', 24: 'toux', 23: 'respir.', 26: 'rire', 21: 'éternu.', 25: 'pas', 38: 'tic-tac', 34: 'canette', 29: 'boire', 33: 'grince', 39: 'verre', 17: 'eau', 37: 'réveil', 20: 'bébé', 0: 'chien', 5: 'chat', 46: 'cloches', 27: 'dents'}

def noise_eval(clf, gate, files, taus=(None, 0.3, 0.5, 0.7), cache_tag=None):
    """Détections par minute sur des extraits de bruit, sans filtre puis avec, par seuil."""
    cache = f'gate_steps_{cache_tag}.pkl' if cache_tag else None
    if cache and os.path.exists(cache): steps = pickle.load(open(cache, 'rb'))
    else:
        steps = []
        for p in files:
            fr, P, X = clip_steps(load_wav(p), clf); steps.append((p, fr, P, X.astype(np.float32)))
        if cache: pickle.dump(steps, open(cache, 'wb'))
    res = {t: {} for t in taus}; sec = {}
    for p, fr, P, X in steps:
        tgt = int(os.path.basename(p)[:-4].split('-')[3]); sec[tgt] = sec.get(tgt, 0) + 5.0
        pv = gate_prob(gate, X) if gate is not None else None
        for t in taus:
            Pg = P.copy()
            if t is not None and pv is not None: Pg[pv < t, :7] = 0
            c = Lt.emit(fr, Pg, POST, hi=0.95, refr=10) if len(fr) else []
            r = res[t].setdefault(tgt, [0, 0]); r[0] += len(c); r[1] += sum(q[2] >= 0.9 for q in c)
    return res, sec

def show_noise(res, sec, label=''):
    tot = sum(sec.values()) / 60
    for t, r in res.items():
        strong = sum(v[1] for v in r.values()); allc = sum(v[0] for v in r.values())
        top = sorted(r.items(), key=lambda kv: -kv[1][1])[:7]
        print('%s seuil %s : %.1f syllabes nettes par minute (%.1f en tout) | %s' % (label, 'aucun' if t is None else t, strong / tot, allc / tot,
              ' '.join('%s %.0f' % (NAMES.get(k, k), 60 * v[1] / sec[k]) for k, v in top)))
