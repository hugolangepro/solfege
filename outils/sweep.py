import sys; sys.path.insert(0, '/home/claude/work/phase0')
import numpy as np, io, contextlib
import fastmodel as F, latency as Lt
def summary(Z, post, **kw):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf): res = Lt.evaluate(Z, post, '', **kw)
    out = []
    for t in (60, 120, 0, 180):
        r = res[t]; lat = np.array(r['lat']) * 1000; lr = np.array(r['lat_red']) * 1000
        out.append('%s %d/%d just. %3.0f/%3.0f ms, faux rep. %.1f%% %3.0f ms, flash %d, repr. %d' % ('lib' if t == 0 else t, r['ok'], r['n'], np.median(lat), np.percentile(lat, 90), 100 * r['caught'] / r['imp'], np.median(lr), r['flash'], r['unflip']))
    return ' | '.join(out)
if __name__ == '__main__':
    for post in (18, 14, 12, 10, 8, 6):
        Z = F.cv_posteriors(12, post)
        print('POST=%2d règle actuelle     :' % post, summary(Z, post))
        print('POST=%2d précoce .95 ×2     :' % post, summary(Z, post, red_conf=0.9, hi=0.95))
