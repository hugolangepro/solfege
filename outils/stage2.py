import sys; sys.path.insert(0, '/home/claude/work/phase0')
from decode2 import *
import stage1_lib as S1

# Étape 1 bis : détecteur des séries propres -> exemples fiables pour toutes les séries
ex = {}
print('--- étape 1 : détecteur entraîné sur les séries propres')
for held in SER:
    train = [s for s in SER if s['id'] in S1.CLEAN and s is not held]
    clf = fit(S1.refined_examples(train))
    det, path, (ok, sub, dele, ins) = decode(clf, held)
    ex[held['id']] = examples_from(det, path, held)
    print('%s t%3d : %2d retenues ; %2d conformes, %d substituées, %d manquantes, %d en trop' % (held['id'], held['tempo'], len(det), ok, sub, dele, ins), flush=True)
json.dump(ex, open('examples1.json', 'w'))
# Étape 2 : validation croisée complète, chaque série décodée par un détecteur qui ne l'a jamais vue
print('--- étape 2 : validation croisée sur les 12 séries')
out = {}
for held in SER:
    clf = fit({sid: e for sid, e in ex.items() if sid != held['id']})
    det, path, (ok, sub, dele, ins) = decode(clf, held)
    out[held['id']] = {'det': det, 'path': path, 'tally': [ok, sub, dele, ins]}
    print('%s t%3d : %2d retenues ; %2d conformes, %d substituées, %d manquantes, %d en trop' % (held['id'], held['tempo'], len(det), ok, sub, dele, ins), flush=True)
json.dump(out, open('stage2.json', 'w'))
for t in (60, 120, 180):
    T = np.array([out[s['id']]['tally'] for s in SER if s['tempo'] == t]).sum(0)
    print('tempo %3d : conformes %d / %d (%.1f %%) ; substituées %d ; manquantes %d ; en trop %d' % (t, T[0], T[0] + T[1] + T[2], 100 * T[0] / (T[0] + T[1] + T[2]), T[1], T[2], T[3]))
