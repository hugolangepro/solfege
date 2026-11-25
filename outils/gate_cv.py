"""Le filtre garde-t-il les vraies syllabes ? Validation croisée par série : filtre et modèle entraînés sans la série jugée."""
import sys; sys.path.insert(0, '/home/claude/work/phase0')
import numpy as np, pickle, os, io, contextlib
import gate as G, fastmodel as F, latency as Lt
from sweep import summary

def cv_gate_probs(Xneg, tag, **kw):
    path = f'gate_cvpv_{tag}.pkl'
    if os.path.exists(path): return pickle.load(open(path, 'rb'))
    patch = F.make_patch(12, 18); Zm = F.cv_posteriors(12, 18); out = {}
    for s in F.SERIES:
        g = G.fit_gate(G.speech_pos([k for k in G.W.EX if k != s['id']]), Xneg, **kw)
        fr = Zm[s['id']][0]
        out[s['id']] = G.gate_prob(g, np.array([patch(int(f)) for f in fr]))
    pickle.dump(out, open(path, 'wb'))
    return out

def gated(Zm, PV, tau):
    out = {}
    for sid, (fr, P) in Zm.items():
        Pg = P.copy(); Pg[PV[sid] < tau, :7] = 0; out[sid] = (fr, Pg)
    return out

if __name__ == '__main__':
    tag = sys.argv[1] if len(sys.argv) > 1 else 'esc123'
    Xneg = np.load(f'gate_neg_{tag}.npz')['X']
    PV = cv_gate_probs(Xneg, tag)
    Zm = F.cv_posteriors(12, 18)
    print('sans filtre :', summary(Zm, 18, red_conf=0.9, hi=0.95, refr=10))
    for tau in (0.3, 0.5, 0.7, 0.9):
        print('filtre %.1f  :' % tau, summary(gated(Zm, PV, tau), 18, red_conf=0.9, hi=0.95, refr=10))
    # part des vraies syllabes dont le pas d'ancre passe le filtre
    for tau in (0.3, 0.5, 0.7, 0.9):
        keep = tot = 0
        for s in F.SERIES:
            fr = Zm[s['id']][0]; idx = {int(f): i for i, f in enumerate(fr)}
            for a, c in G.W.EX[s['id']]:
                i = idx.get(a + (a % 2)); 
                if i is None: continue
                tot += 1; keep += PV[s['id']][max(0, i - 2):i + 3].max() >= tau
        print('  seuil %.1f : %d vraies syllabes sur %d passent le filtre autour de leur ancre' % (tau, keep, tot))
