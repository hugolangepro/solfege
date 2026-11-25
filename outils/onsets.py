"""Où tombe l'ancre du modèle par rapport au début acoustique de la syllabe et au début de la voyelle (séries lentes)."""
import sys; sys.path.insert(0, '/home/claude/work/phase0')
import numpy as np
import fastmodel as F
from p0lib import SYL
W = F.W; M = F.Mraw
f = np.fft.rfftfreq(400, 1 / 16000)
hz2mel = lambda h: 2595 * np.log10(1 + h / 700.0); mel2hz = lambda m: 700 * (10 ** (m / 2595.0) - 1)
cent = mel2hz(np.linspace(hz2mel(80), hz2mel(7600), 42))[1:-1]
low = (cent >= 200) & (cent <= 1000)
E = 10 * np.log10(M.sum(1) + 1e-12); Ev = 10 * np.log10(M[:, low].sum(1) + 1e-12)
for tempo, ids in ((60, ['S01', 'S02']), (120, ['S03', 'S04', 'S05', 'S06'])):
    rows = {c: [] for c in range(7)}
    for sid in ids:
        for a, c in W.EX[sid]:
            floor = np.percentile(E[a - 45:a + 30], 5)
            peak_v = Ev[a - 3:a + 20].max()
            # début de la voyelle : premier franchissement de (sommet - 8 dB) dans la bande 200-1000 Hz, en partant de 15 trames avant l'ancre
            vo = next((k for k in range(a - 15, a + 20) if Ev[k] >= peak_v - 8 and Ev[k + 1] >= peak_v - 8), None)
            # début de la syllabe : en reculant depuis la voyelle, dernière trame encore au-dessus du plancher + 10 dB
            so = vo
            while so is not None and so > a - 40 and E[so - 1] > floor + 10: so -= 1
            if vo is not None: rows[c].append((so - a, vo - a))
    print('tempo', tempo)
    allr = np.array([r for c in rows for r in rows[c]])
    for c in range(7):
        r = np.array(rows[c])
        print('   %-3s  n=%2d  début syllabe : médiane %+4.0f ms (p10 %+4.0f, p90 %+4.0f)   début voyelle : médiane %+4.0f ms (p10 %+4.0f, p90 %+4.0f)' % (
            SYL[c], len(r), *(10 * np.percentile(r[:, 0], q) for q in (50, 10, 90)), *(10 * np.percentile(r[:, 1], q) for q in (50, 10, 90))))
    print('   tous n=%d  début syllabe médiane %+.0f ms ; début voyelle médiane %+.0f ms' % (len(allr), 10 * np.median(allr[:, 0]), 10 * np.median(allr[:, 1])))
