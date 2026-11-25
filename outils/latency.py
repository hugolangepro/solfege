"""Délai entre la syllabe dite et le verdict affiché, et justesse, selon la règle d'émission des candidats.
Simulation fidèle du flux : chaque pas (20 ms) n'est connu qu'une fois sa fenêtre future reçue."""
import sys; sys.path.insert(0, '/home/claude/work/phase0')
import numpy as np
import fastmodel as F
W = F.W

def t_avail(frame, post):          # instant (s) où le pas d'ancre `frame` est calculable
    return ((frame + post - 1) * 160 + 400) / 16000.0
def t_nom(frame):                  # instant nominal de l'ancre (centre de trame)
    return (frame * 160 + 200) / 16000.0

def emit(fr, P, post, thr=0.3, half=8, hi=None, run=2, lo=0.5, refr=10, strong=0.9):
    """Candidats dans l'ordre d'émission : (trame, classe, confiance, instant d'émission, précoce).
    hi=None : règle d'origine (maximum local confirmé après `half` pas).
    hi=0.95 : en plus, émission dès `run` pas consécutifs ≥ hi de la même classe, sans attendre le sommet.
    Une détection nette (≥ strong) d'une classe bloque les suivantes de cette classe pendant `refr` pas
    et tant que la probabilité n'est pas retombée (classe différente ou < lo) : une syllabe ne compte qu'une fois."""
    S = P[:, :7].max(1); C = P[:, :7].argmax(1); n_steps = len(S)
    out = []
    last = {}            # classe -> (pas d'ancre, confiance) de la dernière détection émise
    first_rel = {}       # classe -> premier pas de relâchement après cette détection
    early_starts = []    # pas d'ancre des détections précoces récentes
    def blocked(c, idx):
        if c not in last or last[c][1] < strong: return False
        if idx - last[c][0] < refr: return True
        return first_rel.get(c) is None or first_rel[c] > idx
    for n in range(n_steps):
        for c in last:
            if first_rel.get(c) is None and n > last[c][0] and (C[n] != c or S[n] < lo): first_rel[c] = n
        if hi is not None and n >= run - 1 and all(S[n - q] >= hi and C[n - q] == C[n] for q in range(run)):
            c = int(C[n]); a = n - run + 1
            if not blocked(c, a):
                conf = float(S[a:n + 1].max())
                out.append((int(fr[a]), c, conf, t_avail(fr[n], post), True))
                last[c] = (a, conf); first_rel[c] = None; early_starts.append(a)
                if len(early_starts) > 4: early_starts.pop(0)
        i = n - half
        if i >= 0 and S[i] >= thr:
            a0 = max(0, i - half)
            if S[i] < S[a0:i].max(initial=-1) or S[i] <= S[i + 1:n + 1].max(initial=-1): continue
            c = int(C[i])
            if any(i < e <= n for e in early_starts): continue        # une détection précoce a démarré pendant l'attente : elle l'emporte
            if blocked(c, i): continue
            out.append((int(fr[i]), c, float(S[i]), t_avail(fr[n], post), False))
            last[c] = (i, float(S[i])); first_rel[c] = None
            # le relâchement peut déjà avoir eu lieu entre le sommet et maintenant
            for m in range(i + 1, n + 1):
                if C[m] != c or S[m] < lo: first_rel[c] = m; break
    return out

class Follower:
    def __init__(self, exp, SUB=1.0, DEL=1.0):
        self.exp = list(exp); self.N = len(exp); self.SUB, self.DEL = SUB, DEL
        self.cost = np.full(self.N + 1, np.inf); self.cost[0] = 0; self.back = []; self.dets = []
    def push(self, d):
        N = self.N; c = d[1]; ins = 0.3 + 0.6 * d[2]
        new = np.full(N + 1, np.inf); bp = [None] * (N + 1)
        for k in range(N + 1):
            if not np.isfinite(self.cost[k]): continue
            v = self.cost[k] + ins
            if v < new[k]: new[k], bp[k] = v, (k, 'ins', 0)
            for skip in (0, 1, 2):
                j = k + skip
                if j >= N: break
                okc = c == self.exp[j]
                v = self.cost[k] + skip * self.DEL + (0 if okc else self.SUB)
                if v < new[j + 1] - 1e-12: new[j + 1], bp[j + 1] = v, (k, 'ok' if okc else 'sub', skip)
        self.cost = new; self.back.append(bp); self.dets.append(d)
    def best(self):
        return int(np.argmin(self.cost + 1e-6 * (self.N - np.arange(self.N + 1))))
    def verdicts(self):
        k = self.best(); v = [None] * self.N
        for i in range(len(self.back) - 1, -1, -1):
            kp, op, skip = self.back[i][k]
            if op != 'ins':
                j = kp + skip; v[j] = ('ok' if op == 'ok' else 'faux', i)
                for m in range(kp, j): v[m] = ('manque', None)
            k = kp
        return v
    def pending(self, min_conf):
        """Détections en fin de chemin restées sans note : la plus récente dont la confiance atteint min_conf, sinon None."""
        k = self.best()
        for i in range(len(self.back) - 1, -1, -1):
            kp, op, skip = self.back[i][k]
            if op != 'ins': return None
            if self.dets[i][2] >= min_conf: return i
            k = kp
        return None

def display_states(exp, cands, red_conf=None, hold=0.0):
    """Rejoue l'affichage. Renvoie pour chaque note la liste (instant, état) des changements d'état affiché.
    red_conf : une détection nette restée sans note colore tout de suite la note courante en rouge (provisoire) ;
    hold : délai (s) avant ce rouge provisoire, annulé si une autre détection arrive entre-temps."""
    Fw = Follower(exp); N = len(exp)
    shown = [None] * N; hist = [[] for _ in range(N)]
    def apply(t, v, prov):
        for j in range(N):
            st = v[j][0] if v[j] is not None else None
            if prov is not None and j == prov and st is None: st = 'faux?'
            if st != shown[j]: shown[j] = st; hist[j].append((t, st))
    for idx, d in enumerate(cands):
        Fw.push(d); t = d[3]; v = Fw.verdicts(); prov = None
        if red_conf is not None:
            p = Fw.pending(red_conf)
            if p is not None and Fw.best() < N:
                t_red = Fw.dets[p][3] + hold
                nxt = cands[idx + 1][3] if idx + 1 < len(cands) else np.inf
                if t_red < nxt:                      # le délai s'écoule avant la détection suivante
                    apply(t, v, None); apply(max(t, t_red), v, Fw.best()); continue
        apply(t, v, prov)
    return hist, Fw

def onset_refs(sid):
    """Pour chaque exemple conforme de la série : (indice de note, trame d'ancre, classe)."""
    s = [q for q in F.SERIES if q['id'] == sid][0]; lab = list(s['labels'])
    ex = W.EX[sid]
    # les exemples sont dans l'ordre de lecture ; on retrouve leur indice de note par alignement glouton
    refs = []; j = 0
    for a, c in ex:
        while j < len(lab) and lab[j] != c: j += 1
        if j >= len(lab): break
        refs.append((j, a, c)); j += 1
    return refs

def evaluate(Z, post, name, impostor=True, red_conf=None, hold=0.0, **rule):
    res = {}
    for s in F.SERIES:
        fr, P = Z[s['id']]; lab = list(s['labels'])
        cands = emit(fr, P, post, **rule)
        hist, Fw = display_states(lab, cands, red_conf, hold)
        v = Fw.verdicts()
        r = res.setdefault(s['tempo'], dict(n=0, ok=0, faux=0, manq=0, lat=[], flash=0, unflip=0, ndet=0, nearly=0, imp=0, caught=0, lat_red=[], coll=0))
        r['n'] += len(lab); r['ok'] += sum(x is not None and x[0] == 'ok' for x in v)
        r['faux'] += sum(x is not None and x[0] == 'faux' for x in v); r['manq'] += sum(x is None or x[0] == 'manque' for x in v)
        r['ndet'] += len(cands); r['nearly'] += sum(c[4] for c in cands)
        refs = onset_refs(s['id']); anchor = {j: a for j, a, c in refs}
        for j in range(len(lab)):
            h = hist[j]
            if v[j] is not None and v[j][0] == 'ok':
                t_ok = [t for t, st in h if st == 'ok'][-1]              # dernier passage à « juste »
                if j in anchor: r['lat'].append(t_ok - t_nom(anchor[j]))
                r['flash'] += any(st in ('faux', 'faux?') for t, st in h)      # passée par le rouge avant d'être juste
            r['unflip'] += sum(1 for q in range(1, len(h)) if h[q - 1][1] == 'ok' and h[q][1] != 'ok')
        if impostor:
            okj = [j for j in range(len(lab)) if v[j] is not None and v[j][0] == 'ok' and j in anchor]
            for j in okj:
                for a in range(7):
                    if a == lab[j]: continue
                    e2 = lab[:]; e2[j] = a
                    h2, F2 = display_states(e2, cands, red_conf, hold); v2 = F2.verdicts()
                    r['imp'] += 1
                    caught = not (v2[j] is not None and v2[j][0] == 'ok')
                    r['caught'] += caught
                    if caught:
                        tr = [t for t, st in h2[j] if st in ('faux', 'faux?')]
                        if tr: r['lat_red'].append(tr[0] - t_nom(anchor[j]))
                    r['coll'] += sum(1 for m in range(len(lab)) if m != j and v[m] is not None and v[m][0] == 'ok' and not (v2[m] is not None and v2[m][0] == 'ok'))
    print(name)
    for t in (60, 120, 0, 180):
        r = res[t]; lat = np.array(r['lat']) * 1000
        line = '  %-5s %3d/%d ok (%d faux, %d manq) | délai juste : médiane %3.0f ms, p90 %3.0f, max %3.0f | passées par le rouge %d | reprises %d | %d dét. dont %d précoces' % (
            'libre' if t == 0 else t, r['ok'], r['n'], r['faux'], r['manq'], np.median(lat), np.percentile(lat, 90), lat.max(), r['flash'], r['unflip'], r['ndet'], r['nearly'])
        if impostor:
            lr = np.array(r['lat_red']) * 1000
            line += ' | fausses repérées %.1f %% ; délai rouge médiane %3.0f ms, p90 %3.0f ; dégâts %.3f' % (100 * r['caught'] / max(r['imp'], 1), np.median(lr), np.percentile(lr, 90), r['coll'] / max(r['imp'], 1))
        print(line)
    return res

if __name__ == '__main__':
    Z = F.cv_posteriors(12, 18)
    evaluate(Z, 18, 'A. règle actuelle (sommet confirmé 160 ms), rouge à la note suivante')
    evaluate(Z, 18, 'B. règle actuelle + rouge provisoire immédiat (conf ≥ 0,9)', red_conf=0.9)
    for hi in (0.8, 0.9, 0.95, 0.98):
        evaluate(Z, 18, 'C. précoce hi=%.2f, 2 pas + rouge provisoire' % hi, red_conf=0.9, hi=hi)
    evaluate(Z, 18, 'D. précoce hi=0.9, 1 pas + rouge provisoire', red_conf=0.9, hi=0.9, run=1)
    evaluate(Z, 18, 'E. précoce hi=0.9, 3 pas + rouge provisoire', red_conf=0.9, hi=0.9, run=3)
