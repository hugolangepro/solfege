// Suivi des notes : cas d'école pour la note fausse affichée tout de suite, la correction, le silence qui engage la réponse.
import { Follower } from '../engine.js';
let t = 0;
const d = (cls, conf = 1) => ({ cls, conf, time: (t += 0.5) });
const show = (F) => F.verdicts().map((q) => (q ? q.v : '-')).join(' ');
const pend = (F) => { const p = F.pending(0.9); return p ? `note ${p.note} (syllabe ${p.det.cls})` : 'rien'; };
let ok = true;
function check(name, got, want) { const good = got === want; ok = ok && good; console.log(`${good ? 'ok ' : 'ÉCHEC'} ${name} : ${got}${good ? '' : `  (attendu : ${want})`}`); }

let F = new Follower([0, 1, 2, 3]);
F.push(d(0)); F.push(d(5));
check('fausse note : en attente dès sa syllabe', `${show(F)} | ${pend(F)}`, 'ok - - - | note 1 (syllabe 5)');
F.push(d(2));
check('la note suivante la confirme fausse', `${show(F)} | ${pend(F)}`, 'ok faux ok - | rien');

F = new Follower([0, 1, 2, 3]);
F.push(d(0)); F.push(d(5)); F.push(d(1));
check('correction immédiate : la note est validée', `${show(F)} | ${pend(F)}`, 'ok ok - - | rien');

F = new Follower([0, 1, 2, 3]);
F.push(d(0)); F.push(d(5)); F.push(d(5)); F.push(d(5));
check('même fausse syllabe répétée : toujours en attente sur la même note', `${show(F)} | ${pend(F)}`, 'ok - - - | note 1 (syllabe 5)');
check('silence : la réponse est engagée', `${F.commitPending(0.9)} ${show(F)} | curseur ${F.best()}`, 'true ok faux - - | curseur 2');

F = new Follower([0, 1]);
F.push(d(0)); F.push(d(5));
check('dernière note fausse, après le silence', `${F.commitPending(0.9)} ${show(F)} | fini ${F.best() >= F.N}`, 'true ok faux | fini true');

F = new Follower([0, 1, 2, 3]);
F.push(d(0)); F.push(d(5, 0.5));
check('syllabe peu nette : rien n\'est affiché', `${show(F)} | ${pend(F)} | engagée ${F.commitPending(0.9)}`, 'ok - - - | rien | engagée false');

F = new Follower([0, 1, 2, 3]);
F.push(d(0)); F.push(d(2));
check('note sautée : d\'abord en attente', `${show(F)} | ${pend(F)}`, 'ok - - - | note 1 (syllabe 2)');
F.push(d(3));
check('puis reconnue comme sautée', `${show(F)} | ${pend(F)}`, 'ok manque ok ok | rien');

F = new Follower([0, 1, 2, 3]);
F.push(d(0)); F.push(d(1)); F.push(d(6, 0.95)); F.push(d(2));
check('bruit pris pour une syllabe entre deux notes justes : écarté', `${show(F)} | ${pend(F)}`, 'ok ok ok - | rien');
process.exit(ok ? 0 : 1);
