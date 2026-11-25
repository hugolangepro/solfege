# Solfège

App web personnelle de lecture de notes. La page affiche quatre portées ; on répond à la voix (do, ré, mi, fa, sol, la, si) ou au clavier MIDI.

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
- Une page : identifiant, date, clé, façon de répondre, notes justes, fausses, non entendues, durée de lecture, cadence, précision. Une note : `[clé (0 sol, 1 fa), position sur la portée (0 = ligne du bas), verdict (1 juste, 0 faux, -1 non entendue, null non lue), réponse (syllabe 0 à 6 à la voix, numéro MIDI au clavier), instant en ms]`.
- La cadence se mesure entre la première et la dernière réponse : le temps de réaction avant la première note n'y entre pas.
- Fichier de diagnostic : un WAV (16 kHz, mono) du son tel que l'app l'a reçu, suivi d'un bloc `sLFG` qui porte en JSON les notes attendues, les syllabes entendues, les verdicts, le navigateur et les réglages du micro. `node tests/diag.mjs fichier.wav` le relit et repasse le son dans le moteur.

## Fichiers

- `index.html`, `app.js` : interface et déroulement d'une page.
- `engine.js` : écoute. Rééchantillonnage à 16 kHz, log-mel, modèle vocal, détection des syllabes, alignement sur les notes attendues.
- `worklet.js` : relais du micro.
- `model.json` : modèle vocal entraîné sur la voix d'Hugo (séance de mesure du 25 novembre 2026). Sept syllabes et une classe de rejet.
- `sw.js`, `manifest.webmanifest`, `icons/` : installation et usage hors ligne.
- `outils/` : scripts Python qui ont produit le modèle. Ils demandent l'enregistrement de la séance de mesure, qui n'est pas dans ce dépôt.
- `tests/` : contrôles du moteur sous Node et de l'app dans Chrome (`python3 tests/e2e.py`, `python3 tests/e2e_midi.py`), servie sous `/solfege/` comme en ligne. Eux aussi demandent l'enregistrement.

## Chiffres de référence

Validation croisée sur la séance de mesure, chaque série étant reconnue par un modèle entraîné sur les autres :
100 notes validées sur 100 à 60 par minute, 198 sur 200 à 120, 50 sur 50 en lecture libre, 275 sur 300 à 180.

Ces chiffres valent pour le micro de l'iPhone capté par le Dictaphone. Le micro vu par le navigateur n'a pas encore été mesuré.
