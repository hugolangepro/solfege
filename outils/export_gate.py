"""Ajoute le filtre au modèle servi par l'app (model.json), sans toucher aux poids du modèle des syllabes,
puis calcule les détections de référence avec filtre pour vérifier le moteur JavaScript."""
import sys; sys.path.insert(0, '/home/claude/work/phase0')
import json, pickle, base64, numpy as np
import final_model as FM, latency as Lt, gate as G
TAU = 0.3
g = pickle.load(open('gate2_B.pkl', 'rb'))
sc, pca, mlp = g.named_steps['standardscaler'], g.named_steps['pca'], g.named_steps['mlpclassifier']
assert mlp.out_activation_ == 'logistic' and list(mlp.classes_) == [0.0, 1.0] and mlp.activation == 'relu'
A = (pca.components_ / sc.scale_).T.astype(np.float32)
b = (-(sc.mean_ / sc.scale_ + pca.mean_) @ pca.components_.T).astype(np.float32)
W1, b1, W2, b2 = [a.astype(np.float32) for a in (mlp.coefs_[0], mlp.intercepts_[0], mlp.coefs_[1], mlp.intercepts_[1])]
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a, dtype=np.float32).tobytes()).decode()
model = json.load(open('model.json'))
old = {k: model[k] for k in ('A', 'b', 'W1', 'b1', 'W2', 'b2')}
model['version'] = 3
model['gate'] = {'tau': TAU, 'trained': '2026-11-25', 'A': b64(A), 'b': b64(b), 'W1': b64(W1), 'b1': b64(b1), 'W2': b64(W2), 'b2': b64(b2)}
assert all(model[k] == old[k] for k in old)
json.dump(model, open('model_v3.json', 'w'))
print('filtre : %d → %d → %d → 1 ; model_v3.json : %d octets' % (A.shape[0], A.shape[1], W1.shape[1], len(json.dumps(model))))
# référence : tout l'enregistrement, modèle en ligne + filtre
clf = pickle.load(open('final_web.pkl', 'rb'))
fr = np.arange(30, len(FM.Mraw) - 20, 2)
X = np.array([FM.patch(int(f)) for f in fr])
P = np.zeros((len(fr), 8)); P[:, clf.classes_] = clf.predict_proba(X)
pv = G.gate_prob(g, X)
# contrôle : le calcul plié (A, b, W1…) redonne la probabilité du filtre
z = X @ A.astype(np.float64) + b; h = np.maximum(0, z @ W1 + b1); y = (h @ W2 + b2).ravel()
print('écart max entre le filtre plié et scikit-learn : %.2e' % np.abs(1 / (1 + np.exp(-y)) - pv).max())
raw = Lt.emit(fr, P, 18, hi=0.95, refr=10)
Pg = P.copy(); Pg[pv < TAU, :7] = 0
ref = Lt.emit(fr, Pg, 18, hi=0.95, refr=10)
json.dump({'cands': [(c[0], c[1], c[2], bool(c[4])) for c in ref], 'raw': [(c[0], c[1], c[2], bool(c[4])) for c in raw]}, open('ref_cands3.json', 'w'))
print('référence : %d détections avec filtre, %d sans' % (len(ref), len(raw)))
