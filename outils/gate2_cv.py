import sys; sys.path.insert(0, '/home/claude/work/phase0')
import numpy as np, pickle, os, glob
import gate as G, gate2 as G2, fastmodel as F, latency as Lt
from sweep import summary
from gate_cv import gated
VP = G2.variant_patches(); Xs = np.load('gate_neg_synth.npz')['X']
path = 'gate2_cvpv.pkl'
if os.path.exists(path): PV = pickle.load(open(path, 'rb'))
else:
    patch = F.make_patch(12, 18); Zm = F.cv_posteriors(12, 18); PV = {}
    for s in F.SERIES:
        g = G2.fit(VP, [k for k in G.W.EX if k != s['id']], Xs)
        PV[s['id']] = G.gate_prob(g, np.array([patch(int(f)) for f in Zm[s['id']][0]]))
    pickle.dump(PV, open(path, 'wb'))
Zm = F.cv_posteriors(12, 18)
print('sans filtre :', summary(Zm, 18, red_conf=0.9, hi=0.95, refr=10))
for tau in (0.2, 0.3, 0.5):
    print('filtre %.1f  :' % tau, summary(gated(Zm, PV, tau), 18, red_conf=0.9, hi=0.95, refr=10))
