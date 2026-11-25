"""Suivi en direct : candidats = maxima locaux, puis alignement dynamique sur les notes attendues."""
import sys; sys.path.insert(0, '/home/claude/work/phase0')
import numpy as np, json
from detect import SER, SYL, SEQ
Z = np.load('cv_post.npz')

def candidates(fr, P, thr=0.5, w=6):
    S = P[:, :7].max(1); C = P[:, :7].argmax(1); h = w // 2
    out = []
    for i in range(len(S)):
        if S[i] < thr: continue
        a = max(0, i - h); b = min(len(S), i + h + 1)
        if S[i] < S[a:i].max(initial=-1) or S[i] <= S[i + 1:b].max(initial=-1): continue
        out.append((int(fr[i]), int(C[i]), float(S[i])))
    return out

class Follower:
    """Alignement en ligne. cost[k] = meilleur coût après avoir consommé k notes attendues."""
    def __init__(self, exp, SUB=1.0, DEL=1.0, INS=1.2, INS_SI=0.8):
        self.exp = exp; self.N = len(exp)
        self.SUB, self.DEL, self.INS, self.INS_SI = SUB, DEL, INS, INS_SI
        self.cost = np.full(self.N + 1, np.inf); self.cost[0] = 0
        self.back = []          # par détection : pour chaque k, (k_prec, opération)
        self.dets = []
    def push(self, d):
        N = self.N; c = d[1]
        ins = self.INS_SI if c == 6 else self.INS
        if d[2] < 0.7: ins = min(ins, 0.6)
        new = np.full(N + 1, np.inf); bp = [None] * (N + 1)
        for k in range(N + 1):
            if not np.isfinite(self.cost[k]): continue
            v = self.cost[k] + ins                                   # détection en trop
            if v < new[k]: new[k], bp[k] = v, (k, 'ins')
            for skip in (0, 1, 2):                                   # 0, 1 ou 2 notes sautées puis une note jugée
                j = k + skip
                if j >= N: break
                v = self.cost[k] + skip * self.DEL + (0 if c == self.exp[j] else self.SUB)
                if v < new[j + 1] - 1e-12: new[j + 1], bp[j + 1] = v, (k, 'ok' if c == self.exp[j] else 'sub', skip)
        self.cost = new; self.back.append(bp); self.dets.append(d)
    def best(self):
        k = int(np.argmin(self.cost + 1e-6 * (self.N - np.arange(self.N + 1))))     # à égalité : le plus avancé
        return k
    def verdicts(self):
        """État de chaque note attendue sur le meilleur chemin : ok, faux(classe), manque, ou None (pas encore lue)."""
        k = self.best(); v = [None] * self.N; i = len(self.back) - 1
        while i >= 0:
            kp, op, *rest = self.back[i][k]
            if op != 'ins':
                skip = rest[0]; j = kp + skip
                v[j] = ('ok',) if op == 'ok' else ('faux', self.dets[i][1])
                for m in range(kp, j): v[m] = ('manque',)
            k = kp; i -= 1
        return v

def simulate(thr=0.5, w=6, **kw):
    tot = {}
    for s in SER + [{'id': 'S13', 'tempo': 0, 'labels': SEQ['lignes'][12][:50]}]:
        fr, P = Z[s['id'] + '_f'], Z[s['id'] + '_p']
        F = Follower(s['labels'], **kw); flips = 0; prev = None
        for d in candidates(fr, P, thr, w):
            F.push(d); v = F.verdicts()
            if prev is not None:
                flips += sum(1 for a, b in zip(prev, v) if a is not None and a[0] == 'faux' and b is not None and b[0] == 'ok')
            prev = v
        v = F.verdicts()
        t = (sum(x is not None and x[0] == 'ok' for x in v), sum(x is not None and x[0] == 'faux' for x in v),
             sum(x is None or x[0] == 'manque' for x in v), flips, len(F.dets))
        tot.setdefault(s['tempo'], []).append(t)
    return tot

def show(name, tot):
    line = []
    for tempo in (60, 120, 0, 180):
        T = np.array(tot[tempo]).sum(0)
        line.append('%s: %d ok, %d faux, %d manq, %d revir. (%d dét.)' % ('libre' if tempo == 0 else tempo, *T))
    print('%-26s %s' % (name, ' | '.join(line)))

if __name__ == '__main__':
    show('thr .5 ±30 ms', simulate(0.5, 6))
    show('thr .5 ±50 ms', simulate(0.5, 10))
    show('thr .5 ±80 ms', simulate(0.5, 16))
    show('thr .4 ±50 ms', simulate(0.4, 10))
    show('thr .6 ±50 ms', simulate(0.6, 10))
    show('thr .5 ±50, INS 1.0', simulate(0.5, 10, INS=1.0))
    show('thr .5 ±50, INS .8', simulate(0.5, 10, INS=0.8, INS_SI=0.8))
    show('thr .5 ±50, INS_SI 1.2', simulate(0.5, 10, INS_SI=1.2))
