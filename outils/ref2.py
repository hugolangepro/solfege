"""Candidats de référence (règle précoce) sur tout l'enregistrement, avec le modèle en ligne, pour vérifier le moteur JavaScript."""
import sys; sys.path.insert(0, '/home/claude/work/phase0')
import json, pickle, numpy as np
import final_model as FM, latency as Lt
clf = pickle.load(open('final_web.pkl', 'rb'))
fr, P = FM.post(clf, 30, len(FM.Mraw) - 20)
ref = Lt.emit(fr, P, 18, hi=0.95, refr=10)
json.dump({'cands': [(c[0], c[1], c[2], bool(c[4])) for c in ref], 'n_frames': int(len(FM.Mraw))}, open('ref_cands2.json', 'w'))
old = json.load(open('ref_cands.json'))['cands']
print('référence, règle précoce : %d candidats dont %d précoces ; ancienne règle : %d' % (len(ref), sum(c[4] for c in ref), len(old)))
