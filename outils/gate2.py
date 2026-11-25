"""Filtre « syllabe dite ou autre son », version robuste : la voix passe par plusieurs canaux simulés (réverbération,
bande passante réduite, bruit de fond) pour que le filtre apprenne la syllabe et pas le micro."""
import sys; sys.path.insert(0, '/home/claude/work/phase0')
import numpy as np, os, pickle, glob
from scipy import signal
import gate as G, fastmodel as F, final_model as FM, robust as R
W = F.W
SHIFTS = (-6, -4, -2, 0, 2, 4)
rng0 = np.random.default_rng(11)
def _rev(rt, wet, seed):
    def f(x):
        r = np.random.default_rng(seed); n = int(16000 * rt * 1.2); t = np.arange(n) / 16000
        h = r.standard_normal(n) * np.exp(-6.9 * t / rt); h[:32] = 0; h /= np.sqrt((h ** 2).sum())
        return (x + wet * signal.fftconvolve(x, h)[:len(x)]).astype(np.float32)
    return f
def _filt(kind, f1, f2=None):
    def f(x):
        wn = [f1 / 8000, f2 / 8000] if kind == 'band' else f1 / 8000
        return signal.sosfilt(signal.butter(2 if kind != 'band' else 4, wn, kind, output='sos'), x).astype(np.float32)
    return f
def _noise(snr, color, seed):
    def f(x):
        r = np.random.default_rng(seed); n = r.standard_normal(len(x))
        if color == 'rose':
            Nf = np.fft.rfft(n); fr = np.fft.rfftfreq(len(n), 1 / 16000); Nf[1:] /= np.sqrt(fr[1:]); Nf[0] = 0; n = np.fft.irfft(Nf, len(x))
        if color == 'grave': n = signal.lfilter(*signal.butter(1, 300 / 8000, 'low'), n)
        act = np.sqrt(np.mean(x[np.abs(x) > 0.01] ** 2)); n = n / np.sqrt(np.mean(n ** 2)) * act * 10 ** (-snr / 20)
        return (x + n).astype(np.float32)
    return f
VARIANTS = {
    'propre': lambda x: x,
    'rev03': _rev(0.3, 0.4, 1), 'rev055': _rev(0.55, 0.6, 2),
    'coupe-bas 200': _filt('high', 200), 'coupe-haut 4k': _filt('low', 4000), 'coupe-haut 2k5': _filt('low', 2500),
    'bande 200-4500': _filt('band', 200, 4500), 'bande 400-3000': _filt('band', 400, 3000),
    'rose 25': _noise(25, 'rose', 3), 'blanc 20': _noise(20, 'blanc', 4), 'rose 15': _noise(15, 'rose', 5), 'grave 12': _noise(12, 'grave', 6),
    'mixte': lambda x: _noise(25, 'rose', 7)(_filt('low', 3500)(_rev(0.4, 0.5, 8)(x))),
}
def variant_patches():
    """Pour chaque canal simulé : les images des syllabes, par série."""
    path = 'gate2_pos.pkl'
    if os.path.exists(path): return pickle.load(open(path, 'rb'))
    out = {}
    for name, fn in VARIANTS.items():
        Mr, Lv = FM.prepare(fn(FM.x)); patch = F.make_patch(12, 18, Mr, Lv)
        out[name] = {sid: np.array([[patch(a + sh) for sh in SHIFTS] for a, c in ex], dtype=np.float32) for sid, ex in W.EX.items()}
    pickle.dump(out, open(path, 'wb'))
    return out
def positives(VP, ids, rng, per=5):
    """Chaque syllabe : le son propre et `per - 1` canaux tirés au hasard, quatre décalages chacun."""
    names = [n for n in VP if n != 'propre']; X = []
    for sid in ids:
        n = len(VP['propre'][sid])
        for i in range(n):
            for v in ['propre'] + list(rng.choice(names, per - 1, replace=False)):
                X.append(VP[v][sid][i][rng.choice(len(SHIFTS), 4, replace=False)])
    return np.concatenate(X).astype(np.float64)
def fit(VP, ids, Xneg, seed=0, **kw):
    rng = np.random.default_rng(seed)
    return G.fit_gate(positives(VP, ids, rng), Xneg, seed=seed, **kw)

if __name__ == '__main__':
    import pickle, time
    clf = pickle.load(open('final_web.pkl', 'rb'))
    t = time.time(); VP = variant_patches(); print('images de la voix par canal : %.0f s' % (time.time() - t))
    synth = sorted(glob.glob('/home/claude/work/synth16k/*.wav'))
    Xs, _ = G.noise_set(clf, synth, 'synth'); print('négatifs de synthèse :', Xs.shape)
    X10 = np.load('gate_neg_esc10_123.npz')['X']
    which = sys.argv[1] if len(sys.argv) > 1 else 'B'
    Xneg = Xs if which == 'B' else np.concatenate([Xs, X10])
    # 1. la voix passe-t-elle, série par série, dans des conditions non vues à l'entraînement ?
    feats = {}
    for name, fn in R.CONDS.items():
        if name == 'bruit rose 10 dB': continue
        Mr, Lv = FM.prepare(fn(FM.x)); feats[name] = F.make_patch(12, 18, Mr, Lv)
    taus = (0.2, 0.3, 0.5); keep = {n: {t_: 0 for t_ in taus} for n in feats}; tot = 0
    for s in F.SERIES:
        g = fit(VP, [k for k in W.EX if k != s['id']], Xneg)
        anchors = [a for a, c in W.EX[s['id']]]; tot += len(anchors)
        for name, patch in feats.items():
            pv = G.gate_prob(g, np.array([patch(a + sh) for a in anchors for sh in (-4, -2, 0, 2, 4)])).reshape(len(anchors), 5)
            for t_ in taus: keep[name][t_] += int(((pv[:, :-1] >= t_) & (pv[:, 1:] >= t_)).any(1).sum())
    print('%s : la voix, série par série' % which)
    for name in feats: print('   %-22s ' % name + ' | '.join('seuil %.1f : %d/%d (%.1f %%)' % (t_, keep[name][t_], tot, 100 * keep[name][t_] / tot) for t_ in taus))
    # 2. les bruits réels jamais vus
    g = fit(VP, list(W.EX.keys()), Xneg); pickle.dump(g, open('gate2_%s.pkl' % which, 'wb'))
    res, sec = G.noise_eval(clf, g, G.files_of(folds={4, 5}), taus=(None, 0.2, 0.3, 0.5), cache_tag='esc45_27')
    totm = sum(sec.values()) / 60; KEY = [32, 31, 30, 38, 25, 22, 24, 26, 0, 37, 20]
    for t_, r in res.items(): print('   bruits réels, seuil %-4s : %5.1f syllabes nettes par minute | %s' % (t_, sum(v[1] for v in r.values()) / totm, ' '.join('%s %.0f' % (G.NAMES.get(k, k), 60 * r[k][1] / sec[k]) for k in KEY)))
