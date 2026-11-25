"""Outils communs de l'analyse phase 0 : lecture du journal, signal, enveloppes."""
import json, re, numpy as np
from scipy.io import wavfile
from scipy import signal

SR = 16000
HOP = 160            # 10 ms
SYL = ['do', 'ré', 'mi', 'fa', 'sol', 'la', 'si']
SEQ = json.load(open('/home/claude/work/phase0/sequences.json', encoding='utf-8'))

def load_audio(path='/home/claude/work/phase0/rec16k.wav'):
    sr, x = wavfile.read(path)
    assert sr == SR
    return x.astype(np.float32) / 32768.0

def load_journal(path='/home/claude/work/phase0/journal.txt'):
    runs = []
    for line in open(path, encoding='utf-8').read().strip().split('\n')[1:]:
        f = line.split(';')
        d = {'id': f[0]}
        for kv in f[1:]:
            k, v = kv.split('=')
            d[k] = v
        d['t0'] = float(d['premiere_note'].rstrip('s'))
        d['t1'] = float(d['fin'].rstrip('s'))
        if 'tempo' in d: d['tempo'] = int(d['tempo'])
        if 'ligne' in d: d['ligne'] = int(d['ligne'])
        d['ok'] = d['etat'] == 'ok'
        runs.append(d)
    return runs

def band_env(x, lo, hi, win_ms=20):
    """Enveloppe d'énergie (dB) d'une bande, pas de 10 ms."""
    sos = signal.butter(4, [lo, hi], btype='band', fs=SR, output='sos')
    y = signal.sosfiltfilt(sos, x)
    n = int(SR * win_ms / 1000)
    p = np.convolve(y * y, np.ones(n) / n, mode='same')
    return 10 * np.log10(p[::HOP] + 1e-12)

def logmel(x, n_fft=400, n_mels=40, fmin=80, fmax=7600):
    """Log-mel, fenêtre de 25 ms, pas de 10 ms. Renvoie (trames, n_mels)."""
    f, t, S = signal.stft(x, fs=SR, window='hann', nperseg=n_fft, noverlap=n_fft - HOP, boundary=None, padded=False)
    P = (np.abs(S) ** 2).T                        # (trames, n_fft/2+1)
    def hz2mel(h): return 2595 * np.log10(1 + h / 700.0)
    def mel2hz(m): return 700 * (10 ** (m / 2595.0) - 1)
    pts = mel2hz(np.linspace(hz2mel(fmin), hz2mel(fmax), n_mels + 2))
    fb = np.zeros((n_mels, len(f)))
    for i in range(n_mels):
        l, c, r = pts[i], pts[i + 1], pts[i + 2]
        fb[i] = np.clip(np.minimum((f - l) / (c - l), (r - f) / (r - c)), 0, None)
    M = P @ fb.T
    return np.log(M + 1e-10), t                   # t = centre de chaque trame (s)
