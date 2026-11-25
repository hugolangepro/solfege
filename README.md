# Solfège

App web personnelle de solfège. Lecture de notes : la page affiche quatre portées en clé de sol ou en clé de fa, ou trois systèmes de piano (les deux clés ensemble) ; on répond à la voix (do, ré, mi, fa, sol, la, si) ou au clavier MIDI. Chant d'intervalles : une note sonne, on chante la seconde, la hauteur de la voix se lit en direct.

## Utiliser

Adresse : https://hugolangepro.github.io/solfege/

- iPhone : ouvrir l'adresse dans Safari, puis Partager › Sur l'écran d'accueil. Lancer ensuite l'app depuis l'écran d'accueil : ses données sont séparées de celles de Safari.
- Mac : ouvrir l'adresse dans Chrome (le MIDI n'existe pas dans Safari), puis Installer.
- Cinq touches rapides sur le titre activent le mode diagnostic : syllabes entendues à l'écran, et bouton de partage du son de la page.

## Mise en ligne

Le site est servi par GitHub Pages depuis la branche `gh-pages`. Une mise à jour se pousse sur les deux branches :

    git push origin main main:gh-pages

L'app revalide ses fichiers à chaque ouverture : la nouvelle version arrive au lancement suivant, une à deux minutes après la poussée.

## Données

- Chaque page terminée est gardée sur l'appareil (`localStorage`, clé `solfege.sessions`, 2000 pages au plus). Rien ne quitte l'appareil.
- Une page : identifiant, date, mode (`sol`, `fa`, `piano`), façon de répondre, notes justes, fausses, non entendues, durée de lecture, cadence, précision. Une note : `[clé (0 sol, 1 fa), position sur la portée (0 = ligne du bas), verdict (1 juste, 0 faux, -1 non entendue, null non lue), réponse (syllabe 0 à 6 à la voix, numéro MIDI au clavier), instant en ms]`.
- La cadence se mesure entre la première et la dernière réponse : le temps de réaction avant la première note n'y entre pas.
- Fichier de diagnostic : un WAV (16 kHz, mono) du son tel que l'app l'a reçu, suivi d'un bloc `sLFG` qui porte en JSON les notes attendues, les syllabes entendues, les verdicts, le navigateur et les réglages du micro. `node tests/diag.mjs fichier.wav` le relit et repasse le son dans le moteur.

## Fichiers

- `index.html`, `app.js` : interface et déroulement d'une page.
- `engine.js` : écoute. Rééchantillonnage à 16 kHz, log-mel, modèle vocal, détection des syllabes, alignement sur les notes attendues.
  Une syllabe est reconnue dès que le modèle la donne à 95 % deux pas de suite (40 ms), sans attendre le sommet ; les syllabes moins nettes passent par le sommet confirmé 160 ms plus tard.
- `pitch.js` : hauteur de la voix en flux (méthode de McLeod après un passe-bas à 1 kHz), une mesure toutes les 10 ms.
- `chant.js` : chant d'intervalles. Choix des intervalles par niveau, jugement de la tenue.
- `worklet-2.js` : relais du micro (`worklet.js` reste servi pour une page ouverte avant la mise à jour).
- `model.json` : modèle vocal entraîné sur la voix d'Hugo (séance de mesure du 25 novembre 2026). Sept syllabes et une classe de rejet.
  Depuis la version 3, il porte aussi un filtre « syllabe dite ou autre son » : un second petit réseau sur la même image de 300 ms, qui laisse intact le modèle des syllabes.
- `sw.js`, `manifest.webmanifest`, `icons/` : installation et usage hors ligne.
- `outils/` : scripts Python qui ont produit le modèle. Ils demandent l'enregistrement de la séance de mesure, qui n'est pas dans ce dépôt.
- `tests/` : contrôles du moteur sous Node (`node tests/pending.mjs`, `node tests/chant.mjs`) et de l'app dans Chrome (`python3 tests/e2e.py`, `python3 tests/e2e_midi.py`, `python3 tests/e2e_chant.py`), servie sous `/solfege/` comme en ligne. Ceux de la lecture à la voix demandent l'enregistrement ; celui du chant fabrique sa voix de synthèse.

## Affichage des réponses

- Note validée : elle passe en gris. Note fausse : elle passe en rouge. Aucun texte sous les notes.
- À la voix, une syllabe nette qui n'est pas la note attendue colore la note en rouge tout de suite. La syllabe suivante tranche : la bonne note la valide (correction), la note d'après la confirme fausse. Un silence de 2,5 s (1,2 s sur la dernière note) la confirme aussi.
- Une note que le micro n'a pas entendue reste noire ; elle ne compte ni juste ni fausse.

## Chant d'intervalles

Trois temps, sans chronomètre. Écoute : la première note sonne (elle est bleue pendant ce temps) ; toucher la portée la rejoue.
Vise : on cherche la seconde note ; sous la portée, la courbe bleue montre la voix, la ligne du milieu est la note à chanter,
les traits fins sont les demi-tons. Tiens : la note compte après 300 ms dans la bande de ±50 cents, à l'octave près.
Les 150 premières millisecondes d'une émission ne sont pas jugées, la médiane absorbe le vibrato, un glissando qui traverse
la bande ne compte pas. Rien n'est compté faux.

- Niveau 1 : secondes et tierces majeures, quintes, octaves, en montant. Niveau 2 : les mêmes et la quarte, dans les deux sens.
  Niveau 3 : tous les intervalles entre notes naturelles. Dix intervalles par séance.
- Une séance gardée : `mode: 'chant'`, niveau, bande et tenue, et par intervalle trouvé
  `[position de la référence, position de la cible, temps pour trouver (ms), écart médian (cents), réécoutes]`.
- Réglages d'essai par l'adresse : `?tol=25` (bande en cents), `?tenue=500` (ms).
- Précision du suivi de hauteur sur sons de synthèse : moins de 0,2 cent de 73 à 880 Hz.

## Bruits

Sans filtre, le modèle des syllabes se déclenche sur presque tout son bref : il n'a appris que la voix. Le filtre a appris à
séparer les syllabes de l'enregistrement, passées par des pièces et des micros simulés, de bruits de synthèse (clics, coups,
souffles, bips, notes qui s'éteignent : `outils/synth_noise.py`). Aucun enregistrement tiers n'entre dans son entraînement.

Mesure sur 90 minutes de sons réels qu'il n'a jamais vus (jeu ESC-50, 27 classes, non fourni : licence CC BY-NC, utilisé pour
l'évaluation seulement, `node tests/bruits.mjs`) : 1,2 syllabe nette entendue à tort par minute, contre 21 sans filtre ;
frappe au clavier d'ordinateur : 0,3 par minute contre 57. La voix passe à plus de 98 % dans les conditions simulées
(réverbération, bruit de fond, bande passante réduite) et la lecture de l'enregistrement de mesure est inchangée.

Garde-fou dans l'app : si cinq détections de suite du modèle seul valident cinq notes de suite alors que le filtre en a écarté
au moins deux, c'est la voix qu'il écarte. Il est alors coupé sur cet appareil (clé `solfege.gate`) jusqu'au prochain modèle.

## Chiffres de référence

Validation croisée sur la séance de mesure, chaque série étant reconnue par un modèle entraîné sur les autres :
100 notes validées sur 100 à 60 par minute, 198 sur 200 à 120, 50 sur 50 en lecture libre, 276 sur 300 à 180.
Une fausse note simulée est repérée dans 97 à 99 % des cas.

Délai entre la syllabe (ancre du modèle, 10 à 20 ms avant le début de la voyelle) et le verdict, hors micro et affichage :
médiane 155 ms pour une note juste comme pour une note fausse (version du 25 novembre au matin : 350 ms, et une fausse note attendait la note suivante).

Ces chiffres valent pour le micro de l'iPhone capté par le Dictaphone. `outils/latency.py` les recalcule ; `outils/robust.py` mesure la tenue quand le son change (réverbération, bruit, bande passante).
