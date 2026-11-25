"""Modèle portable pour le navigateur : mêmes caractéristiques, réseau à une couche cachée.
Validation croisée série par série ; sauvegarde des probabilités image par image pour simuler le direct."""
import sys; sys.path.insert(0, '/home/claude/work/phase0')
import numpy as np, json, warnings
from decode2 import *
from sklearn.neural_network import MLPClassifier
warnings.filterwarnings('ignore')

EX = {k: [tuple(e) for e in v] for k, v in json.load(open('examples1.json')).items()}
# série libre S13 : 50 exemples de plus (jamais utilisée jusque-là)
_s13 = json.load(open('s13.json')); _ref = SEQ['lignes'][12][:50]
_p = align([d[1] for d in _s13['det']], _ref)
EX['S13'] = sorted((_s13['det'][i][0], _ref[j]) for i, j in _p if i is not None and j is not None and _s13['det'][i][1] == _ref[j])
# détections en trop relevées en validation croisée : contre-exemples ciblés (syllabes fantômes)
ST2 = json.load(open('stage2.json'))
GHOST = {sid: [v['det'][i][0] for i, j in v['path'] if j is None] for sid, v in ST2.items()}
GHOST['S13'] = [_s13['det'][i][0] for i, j in _p if j is None]

def training_set(ids, rng):
    X, y = [], []
    for sid in ids:
        ex = EX[sid]; fr = [e[0] for e in ex]
        for i, (a, lab) in enumerate(ex):
            for sh in (-4, -2, 0, 2, 4):
                X.append(patch(a + sh)); y.append(lab)
            left = a - fr[i - 1] if i > 0 else 99
            right = fr[i + 1] - a if i + 1 < len(fr) else 99
            for o in (9, 13):
                if o <= right - 7: X.append(patch(a + o)); y.append(NONE)
            for o in (9, 13, 18, 24):
                if o <= left - 7: X.append(patch(a - o)); y.append(NONE)
        for g in GHOST.get(sid, []):
            for sh in (-2, 0, 2):
                X.append(patch(g + sh)); y.append(NONE)
    for f in silence_frames(rng):
        X.append(patch(int(f))); y.append(NONE)
    return np.array(X), np.array(y)

def fit_web(ids, seed=0):
    rng = np.random.default_rng(seed)
    X, y = training_set(ids, rng)
    clf = make_pipeline(StandardScaler(), PCA(60, random_state=0),
                        MLPClassifier(hidden_layer_sizes=(128,), alpha=1e-3, max_iter=500, random_state=seed))
    return clf.fit(X, y)

def posteriors(clf, a, b):
    frames = np.arange(a, b, 2)
    P = clf.predict_proba(np.array([patch(f) for f in frames]))
    full = np.zeros((len(frames), 8)); full[:, clf.classes_] = P
    return frames, full

if __name__ == '__main__':
    by = {s['id']: s for s in SER}
    out = {}; tall = {}
    for held in SER:
        clf = fit_web([k for k in EX if k != held['id']])
        det, path, t = decode(clf, held)
        tall.setdefault(held['tempo'], []).append(t)
        fr, P = posteriors(clf, int((held['t0'] - 1.5) * 100), int((held['t1'] + 1.5) * 100))
        out[held['id']] = (fr, P)
        print('%s t%3d : %2d conformes, %d substituées, %d manquantes, %d en trop' % (held['id'], held['tempo'], *t), flush=True)
    for tempo, v in sorted(tall.items()):
        T = np.array(v).sum(0)
        print('tempo %3d : conformes %d / %d (%.1f %%) ; substituées %d ; manquantes %d ; en trop %d' % (tempo, T[0], T[0] + T[1] + T[2], 100 * T[0] / (T[0] + T[1] + T[2]), T[1], T[2], T[3]))
    # S13 décodée par un modèle sans S13
    clf = fit_web([k for k in EX if k != 'S13'])
    r = [q for q in RUNS if q['type'] == 'libre'][0]
    fr, P = posteriors(clf, int((r['t0'] + OFF - 1.0) * 100), int((r['t1'] + OFF + 1.0) * 100))
    out['S13'] = (fr, P)
    np.savez('cv_post.npz', **{k + '_f': v[0] for k, v in out.items()}, **{k + '_p': v[1] for k, v in out.items()})
