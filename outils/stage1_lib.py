"""Étape 1 : détecteur entraîné sur les séries propres, reconnaissance libre de toutes les séries."""
import sys; sys.path.insert(0, '/home/claude/work/phase0')
from detect import *
import model as MD      # pour le réalignement des ancres d'entraînement

CLEAN = ['S01', 'S02', 'S03', 'S04', 'S06', 'S07', 'S08', 'S09']
def refined_examples(series):
    """Ancres de la segmentation aveugle, recalées par classe (±120 ms) avec un classifieur à 7 classes."""
    train = [s for s in MD.SER if s['id'] in [x['id'] for x in series]]
    anc = {s['id']: np.array(s['anchors']) for s in train}; base = {k: v.copy() for k, v in anc.items()}
    for it in range(2):
        X, y = MD.build(train, anc, MD.TRAIN_SHIFTS)
        clf = MD.make_clf('svm').fit(X, y)
        for s in train:
            for k, lab in enumerate(s['labels']):
                cand = anc[s['id']][k] + MD.SEARCH
                cand = cand[np.abs(cand - base[s['id']][k]) <= 12]
                P = clf.predict_proba(np.array([MD.patch(c) for c in cand]))
                anc[s['id']][k] = cand[P[:, list(clf.classes_).index(lab)].argmax()]
    return {s['id']: sorted(zip(anc[s['id']].tolist(), s['labels'])) for s in train}

