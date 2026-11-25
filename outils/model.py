"""Modèle à 7 classes sur la voix d'Hugo : validation croisée série par série."""
import sys; sys.path.insert(0, '/home/claude/work/phase0')
import numpy as np, json, warnings
from p0lib import *
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
warnings.filterwarnings('ignore')

M = np.load('logmel.npy')
A = json.load(open('anchors.json'))
SER = [s for s in A if s['ok']]
for s in SER:
    s['labels'] = SEQ['lignes'][s['ligne'] - 1][:50]

PRE, POST = 12, 18          # trames avant / après l'ancre (10 ms chacune)

def patch(a, pre=PRE, post=POST):
    p = M[a - pre:a + post]
    return (p - p.mean()).ravel()

def build(series, anchors, shifts):
    X, y = [], []
    for s in series:
        for k, lab in enumerate(s['labels']):
            for sh in shifts:
                X.append(patch(anchors[s['id']][k] + sh)); y.append(lab)
    return np.array(X), np.array(y)

def make_clf(kind):
    if kind == 'svm':
        return make_pipeline(StandardScaler(), PCA(60, random_state=0), SVC(C=10, gamma='scale', probability=True, random_state=0))
    return make_pipeline(StandardScaler(), PCA(60, random_state=0), LogisticRegression(C=0.5, max_iter=2000))

TRAIN_SHIFTS = (-4, -2, 0, 2, 4)
SEARCH = np.arange(-8, 9, 2)

def fit_refined(train, kind='svm', iters=2):
    anc = {s['id']: np.array(s['anchors']) for s in train}
    base = {k: v.copy() for k, v in anc.items()}
    clf = None
    for it in range(iters + 1):
        X, y = build(train, anc, TRAIN_SHIFTS)
        clf = make_clf(kind).fit(X, y)
        if it == iters: break
        for s in train:                       # réalignement de chaque syllabe d'entraînement sur sa propre classe
            for k, lab in enumerate(s['labels']):
                cand = anc[s['id']][k] + SEARCH
                cand = cand[np.abs(cand - base[s['id']][k]) <= 12]
                P = clf.predict_proba(np.array([patch(c) for c in cand]))
                anc[s['id']][k] = cand[P[:, list(clf.classes_).index(lab)].argmax()]
    return clf

def score_slot(clf, a):
    """Score de chaque classe = meilleure probabilité sur les décalages essayés (sans utiliser l'étiquette)."""
    P = clf.predict_proba(np.array([patch(a + sh) for sh in SEARCH]))
    return P.max(0), P

if __name__ == '__main__':
    kind = sys.argv[1] if len(sys.argv) > 1 else 'svm'
    res = []
    for held in SER:
        train = [s for s in SER if s is not held]
        clf = fit_refined(train, kind)
        for k, lab in enumerate(held['labels']):
            sc, _ = score_slot(clf, held['anchors'][k])
            res.append({'serie': held['id'], 'tempo': held['tempo'], 'k': k, 'lab': int(lab), 'score': sc.round(4).tolist(),
                        'pred': int(clf.classes_[sc.argmax()])})
        r = [q for q in res if q['serie'] == held['id']]
        print('%s t%3d : %2d / 50 conformes au texte' % (held['id'], held['tempo'], sum(q['pred'] == q['lab'] for q in r)), flush=True)
    json.dump(res, open('cv_%s.json' % kind, 'w'))
    for t in (60, 120, 180):
        r = [q for q in res if q['tempo'] == t]
        print('tempo %3d : %.1f %% (%d / %d)' % (t, 100 * np.mean([q['pred'] == q['lab'] for q in r]), sum(q['pred'] == q['lab'] for q in r), len(r)))
