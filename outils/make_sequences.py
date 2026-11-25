"""Lignes de Bruijn B(7,2) : 50 syllabes, les 49 enchaînements possibles (répétitions comprises) une fois chacun."""
import random, json
SYL = ['do', 'ré', 'mi', 'fa', 'sol', 'la', 'si']

def debruijn_line(rng):
    adj = {a: list(range(7)) for a in range(7)}
    for a in adj:
        rng.shuffle(adj[a])
    start = rng.randrange(7)
    stack, circuit = [start], []
    while stack:                      # Hierholzer
        v = stack[-1]
        if adj[v]:
            stack.append(adj[v].pop())
        else:
            circuit.append(stack.pop())
    circuit.reverse()
    assert len(circuit) == 50 and circuit[0] == circuit[-1]
    pairs = {(circuit[i], circuit[i + 1]) for i in range(49)}
    assert len(pairs) == 49
    return circuit

rng = random.Random(20261124)
lines = []
while len(lines) < 13:
    c = debruijn_line(rng)
    if c not in lines:
        lines.append(c)
# ligne du test de dictée : 28 syllabes, 4 de chaque, tirage équilibré
d = [i for i in range(7) for _ in range(4)]
rng.shuffle(d)
json.dump({'version': 1, 'syllabes': SYL, 'lignes': lines, 'dictee': d}, open('sequences.json', 'w'), ensure_ascii=False)
for k, l in enumerate(lines):
    print(k + 1, ' '.join(SYL[i] for i in l[:14]), '…')
print('dictée :', ' '.join(SYL[i] for i in d))
