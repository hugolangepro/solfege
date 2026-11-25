# Solfège

App web personnelle de lecture de notes. La page affiche quatre portées ; on répond à la voix (do, ré, mi, fa, sol, la, si) ou au clavier MIDI.

## Utiliser

- iPhone : ouvrir l'adresse dans Safari, puis Partager › Sur l'écran d'accueil.
- Mac : ouvrir l'adresse dans Chrome (le MIDI n'existe pas dans Safari), puis Installer.
- Cinq touches rapides sur le titre activent le mode diagnostic : syllabes entendues à l'écran, et partage du son de la séance.

## Fichiers

- `index.html`, `app.js` : interface et déroulement d'une page.
- `engine.js` : écoute. Rééchantillonnage à 16 kHz, log-mel, modèle vocal, détection des syllabes, alignement sur les notes attendues.
- `worklet.js` : relais du micro.
- `model.json` : modèle vocal entraîné sur la voix d'Hugo (séance de mesure du 25 novembre 2026). Sept syllabes et une classe de rejet.
- `sw.js`, `manifest.webmanifest`, `icons/` : installation et usage hors ligne.
- `outils/` : scripts Python qui ont produit le modèle. Ils demandent l'enregistrement de la séance de mesure, qui n'est pas dans ce dépôt.
- `tests/` : contrôles du moteur sous Node et de l'app dans Chrome. Eux aussi demandent l'enregistrement.

## Chiffres de référence

Validation croisée sur la séance de mesure, chaque série étant reconnue par un modèle entraîné sur les autres :
100 notes validées sur 100 à 60 par minute, 198 sur 200 à 120, 50 sur 50 en lecture libre, 275 sur 300 à 180.

Ces chiffres valent pour le micro de l'iPhone capté par le Dictaphone. Le micro vu par le navigateur n'a pas encore été mesuré.
