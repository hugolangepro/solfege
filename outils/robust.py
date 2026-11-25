"""Tenue des modèles quand le son ne ressemble plus à celui de l'entraînement (autre micro, pièce, bruit).
Chaque série est décodée par un modèle entraîné sans elle, sur le son propre ; seul le son décodé est dégradé."""
import sys; sys.path.insert(0, '/home/claude/work/phase0')
import numpy as np, io, contextlib, pickle, os
from scipy import signal
import fastmodel as F, latency as Lt, final_model as FM
W = F.W
x = FM.x
rng = np.random.default_rng(7)

def reverb(x, rt60=0.4, wet=0.5):
    n = int(16000 * rt60 * 1.2); t = np.arange(n) / 16000
    h = rng.standard_normal(n) * np.exp(-6.9 * t / rt60); h[:32] = 0; h /= np.sqrt((h ** 2).sum())
    y = signal.fftconvolve(x, h)[:len(x)]
    return (x + wet * y).astype(np.float32)
def noise(x, snr_db, pink=False):
    n = rng.standard_normal(len(x))
    if pink:
        Nf = np.fft.rfft(n); f = np.fft.rfftfreq(len(n), 1 / 16000); Nf[1:] /= np.sqrt(f[1:]); Nf[0] = 0; n = np.fft.irfft(Nf, len(x))
    act = np.sqrt(np.mean(x[np.abs(x) > 0.01] ** 2))            # niveau de la voix
    n = n / np.sqrt(np.mean(n ** 2)) * act * 10 ** (-snr_db / 20)
    return (x + n).astype(np.float32)
def eq(x, kind):
    if kind == 'grave-':  sos = signal.butter(2, 300, 'high', fs=16000, output='sos')          # micro qui coupe le grave
    if kind == 'aigu-':   sos = signal.butter(2, 3000, 'low', fs=16000, output='sos')          # micro sourd
    if kind == 'tel':     sos = signal.butter(6, [300, 3400], 'band', fs=16000, output='sos')  # bande téléphone (oreillettes Bluetooth)
    return signal.sosfilt(sos, x).astype(np.float32)

CONDS = {
    'propre': lambda x: x,
    'réverbération 0,4 s': lambda x: reverb(x, 0.4, 0.5),
    'réverbération 0,7 s': lambda x: reverb(x, 0.7, 0.7),
    'bruit rose 20 dB': lambda x: noise(x, 20, True),
    'bruit rose 10 dB': lambda x: noise(x, 10, True),
    'sans grave (<300 Hz)': lambda x: eq(x, 'grave-'),
    'sans aigu (>3 kHz)': lambda x: eq(x, 'aigu-'),
    'bande téléphone': lambda x: eq(x, 'tel'),
}

def run(post, seed=0, hi=0.95):
    cache = f'rob_{post}_{seed}.pkl'
    if os.path.exists(cache): Zs = pickle.load(open(cache, 'rb'))
    else:
        feats = {}
        for name, fn in CONDS.items():
            Mr, Lv = FM.prepare(fn(x)); feats[name] = F.make_patch(12, post, Mr, Lv)
        Zs = {name: {} for name in CONDS}
        for s in F.SERIES:
            clf = F.fit([k for k in W.EX if k != s['id']], 12, post, seed=seed)
            for name in CONDS: Zs[name][s['id']] = F.probs(clf, *F.span(s), feats[name])
        pickle.dump(Zs, open(cache, 'wb'))
    out = []
    for name in CONDS:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf): res = Lt.evaluate(Zs[name], post, '', red_conf=0.9, hi=hi)
        ok = sum(res[t]['ok'] for t in (60, 120, 0)); n = sum(res[t]['n'] for t in (60, 120, 0))
        faux = sum(res[t]['faux'] for t in (60, 120, 0)); manq = sum(res[t]['manq'] for t in (60, 120, 0))
        imp = sum(res[t]['imp'] for t in (60, 120, 0)); caught = sum(res[t]['caught'] for t in (60, 120, 0))
        flash = sum(res[t]['flash'] for t in (60, 120, 0))
        lat = np.concatenate([np.array(res[t]['lat']) for t in (60, 120, 0)]) * 1000
        out.append('POST=%2d graine %d %-22s jusqu\'à 120/min : %3d/%d justes (%d faux, %d manq) ; fausses repérées %.1f %% ; rouges passagers %d ; délai %3.0f ms | 180 : %d/300' % (
            post, seed, name, ok, n, faux, manq, 100 * caught / max(imp, 1), flash, np.median(lat), res[180]['ok']))
    return out

if __name__ == '__main__':
    post = int(sys.argv[1]); seed = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    print('\n'.join(run(post, seed)), flush=True)
