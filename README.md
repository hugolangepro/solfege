# Solfège

App web personnelle de solfège. Lecture de notes : la page affiche quatre portées en clé de sol ou en clé de fa, ou trois systèmes de piano (les deux clés ensemble) ; on répond à la voix (do, ré, mi, fa, sol, la, si), au toucher (un clavier d'une octave, do à si, sous les portées) ou au clavier MIDI. Chant d'intervalles : une note sonne, on chante la seconde, la hauteur de la voix se lit en direct.

## Utiliser

Adresse : https://hugolangepro.github.io/solfege/

- iPhone : ouvrir l'adresse dans Safari, puis Partager › Sur l'écran d'accueil. Lancer ensuite l'app depuis l'écran d'accueil : ses données sont séparées de celles de Safari.
- Mac : ouvrir l'adresse dans Chrome (le MIDI n'existe pas dans Safari), puis Installer.
- L'accueil liste les exercices : Lecture (Notes, Intervalles), Chant (Intervalles, Portée, Accords, Gammes) et Reconnaissance (Intervalles, Accords, Gammes). Un exercice ne s'arrête pas :
  il tourne jusqu'à ce qu'on le quitte (×). « Réglages », en haut de l'exercice, le met en attente et ne montre que les
  réglages de cet exercice ; à la fermeture il reprend, ou repart avec les nouveaux réglages. On change d'exercice depuis l'accueil.
- Cinq touches rapides sur le titre activent le mode diagnostic : syllabes entendues à l'écran, et partage du son de la séance depuis les réglages.

## Mains libres

Pour s'exercer sans regarder l'écran (en voiture, écouteurs). Mêmes noms qu'à l'accueil : Chant (Intervalles, Accords, Gammes)
et Reconnaissance (Intervalles, Accords, Gammes) ; Lecture et Chant › Portée demandent l'écran et n'y sont pas. Entrées : l'icône d'écouteurs de l'accueil ; l'adresse `?mains-libres` ; la page `mains-libres/`, à
ajouter à l'écran d'accueil pour une deuxième icône (sur iPhone, chaque icône a ses propres données : réglages et séries
enregistrées ne sont pas partagés). Un toucher sur l'exercice est nécessaire au départ : iOS n'autorise le son et la voix
qu'après un geste.

- L'app dit l'exercice avec la voix du téléphone ; on répond à voix haute ; un son dit juste (deux notes qui montent) ou faux
  (deux notes graves). En reconnaissance, au deuxième faux l'app dit la réponse ; sans réponse au bout de 8 s, l'exercice est rejoué.
  En chant, un déclic à chaque note tenue, le son juste à la fin ; une reprise est annoncée par le son faux.
- Commandes : « encore », « suivant », « réponse », « stop ». « Stop » ramène au choix de l'exercice à la voix
  (« chant » ou « reconnaissance », puis « intervalles », « accords » ou « gammes ») ; « stop » au choix finit le mode.
  Le mot « écoute » des séries de commandes enregistrées avant le 28 novembre (.4) vaut encore « reconnaissance ».
- Le micro ignore ce que l'app joue ou dit (fenêtres de silence, plus 0,3 s d'écho).
- Son gardé vivant : sur iPhone, la voix de l'app peut interrompre le son de la page (le piano se tait, le micro ne rend plus
  rien). Après chaque énoncé, puis toutes les secondes, l'app vérifie que le contexte audio tourne, que la piste du micro vit,
  n'est pas muette et rend du son (un son exactement nul pendant 4 s compte comme une panne) ; sinon elle relance le contexte
  et reprend le micro. Trois remises sans effet : « Le micro ne répond pas. Touche l'écran. » ; le toucher fait la remise
  avec un geste. Chaque événement va dans un journal (`journal` du fichier de diagnostic, mode diagnostic). Test :
  `tests/e2e_remise.py` (voix factice qui suspend le contexte et termine la piste du micro).
- Vocabulaires à enregistrer sur l'écran Mains libres, rubrique « Enregistrer ma voix » : commandes (9 mots : encore, suivant, réponse, stop, chant, reconnaissance, intervalles, accords, gammes), noms d'accords (12, tels que
  dits : majeur, mineur, augmenté, triade diminuée, sus 4, mineur 7, maj 7, 7, mineur maj 7, 6, semi-diminué, diminué), noms de
  gammes (12). Les noms d'intervalles sont déjà livrés (`noms.json`). Les séries partagées par l'app pourront être livrées de la
  même façon (`livre` dans `VOCABS`).
- Non vérifié sur iPhone : la voix de l'app quand le micro est ouvert, le son par Bluetooth (le micro des écouteurs ou de la
  voiture peut faire passer le son en qualité téléphone), la reconnaissance dans le bruit d'une voiture.

## Règles d'affichage (pour toute modification future)

- Intervalles et accords toujours en notation standard abrégée, jamais en toutes lettres : 2m 2M 3m 3M 4 TT 5 6m 6M 7m 7M ;
  accords en chiffrage jazz (C, C–, C+, C°, Csus4, C–7, C∆7, C7, C–∆7, C6, Cø7, C°7). La voix de l'app, elle, dit les noms. Seule exception : l'écran d'enregistrement des noms,
  qui affiche le mot à prononcer. Gammes : maj, min, min harm, penta maj, penta min ; modes par leur nom.
- Pas de texte quand une icône suffit (réglages, micro, écoute, notes ensemble, notes l'une après l'autre, suite).
- Le moins d'éléments possible à l'écran ; une note fausse est rouge, sans autre marque.
- Réponse juste (exercices à questions) : elle passe au vert et la question suivante vient en 0,28 s ; après une erreur, 0,9 s
  (en reconnaissance, on reste sur la question). En lecture de notes, une note lue s'efface en gris.

## Lecture sans fin

- Les portées gardent leur place. Dès que deux notes sont lues sur une portée, la portée précédente est remplacée par la suite ;
  après la dernière portée, la lecture reprend en haut. Le repère bleu montre la note en cours.
- Étendue : pour chaque clé, la note la plus grave et la plus aiguë se règlent sur la portée des réglages, jusqu'à trois lignes
  supplémentaires de chaque côté. La place gardée autour des portées suit l'étendue.
- L'alignement des syllabes sur les notes travaille sur une fenêtre de 48 notes (`Suivi`, dans `engine.js`) : toutes les 16 notes
  lues, les verdicts des plus anciennes sont figés et la fenêtre repart 8 notes en arrière en rejouant les dernières syllabes.
  Sur 2000 notes simulées, les verdicts sont ceux d'un alignement unique sur toute la séquence.
- En bas : cadence et justesse sur les 32 dernières notes. La séance est gardée toutes les 32 notes et à la sortie.
- Réponse au toucher (Réglages › Réponse › Au toucher) : un clavier d'une octave, do à si, sous les portées, pour lire là où on
  ne peut pas parler. Seule la note compte, pas l'octave. Le micro reste fermé. Sur Mac, la rangée du milieu joue do à si : Q S D F G H J en AZERTY
  (A S D F G H J en QWERTY).

## Mise en ligne

Le site est servi par GitHub Pages depuis la branche `gh-pages`. Une mise à jour se pousse sur les deux branches :

    git push origin main main:gh-pages

L'app revalide ses fichiers à chaque ouverture : la nouvelle version arrive au lancement suivant, une à deux minutes après la poussée.

## Données

- Chaque page terminée est gardée sur l'appareil (`localStorage`, clé `solfege.sessions`, 2000 pages au plus). Rien ne quitte l'appareil.
- Une page : identifiant, date, mode (`sol`, `fa`, `piano`), façon de répondre, notes justes, fausses, non entendues, durée de lecture, cadence, précision. Une note : `[clé (0 sol, 1 fa), position sur la portée (0 = ligne du bas), verdict (1 juste, 0 faux, -1 non entendue, null non lue), réponse (syllabe 0 à 6 à la voix, numéro MIDI au clavier), instant en ms]`.
- La cadence se mesure entre la première et la dernière réponse : le temps de réaction avant la première note n'y entre pas.
- Fichier de diagnostic : un WAV (16 kHz, mono) du son tel que l'app l'a reçu, suivi d'un bloc `sLFG` qui porte en JSON les notes attendues, les syllabes entendues, les verdicts, le navigateur et les réglages du micro. `node tests/diag.mjs fichier.wav` le relit et repasse le son dans le moteur.
- Son des séances (Lecture › Notes › Réglages › Son des séances, à la voix seulement, actif par défaut) : le son des lectures à la
  voix est gardé sur l'appareil (IndexedDB `solfege-son`) par morceaux de cinq minutes, chacun au format du fichier de diagnostic ;
  12 morceaux au plus, les plus anciens partent. Les instants du JSON comptent depuis le début de la séance, `debut` donne celui du
  morceau (en s). Un reste de moins de 20 s n'est pas gardé. « Partager » envoie tous les morceaux (feuille de partage d'iOS),
  « Effacer » demande une confirmation. Rien ne quitte l'appareil sans ce partage. Ces fichiers servent à réentraîner le modèle des
  notes ; ils ne vont jamais dans le dépôt. Pour tester le découpage : `?morceau=10` (morceaux de 10 s).

## Fichiers

- `index.html`, `app.js` : interface, déroulement des exercices, réglages.
- `engine.js` : écoute. Rééchantillonnage à 16 kHz, log-mel, modèle vocal, détection des syllabes, alignement sur les notes attendues.
  Une syllabe est reconnue dès que le modèle la donne à 95 % deux pas de suite (40 ms), sans attendre le sommet ; les syllabes moins nettes passent par le sommet confirmé 160 ms plus tard.
- `pitch.js` : hauteur de la voix en flux (méthode de McLeod après un passe-bas à 1 kHz), une mesure toutes les 10 ms.
- `chant.js` : chant. Tirage des intervalles, des notes sur la portée et des accords ; chiffrages ; jugement de la tenue.
- `portee.js` : dessin des portées, des notes, des altérations.
- `mains-libres/` : page d'entrée pour une deuxième icône d'écran d'accueil.
- `noms.js`, `noms.json` : noms d'intervalles dits à voix haute ; la voix de départ, et l'apprentissage sur l'appareil.
- `piano.js`, `piano/` : quatorze notes de piano enregistrées (voir NOTICE), transposées d'un demi-ton et demi au plus.
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

## Chant

Trois temps, sans chronomètre. Écoute : la note de départ sonne au piano ; toucher l'exercice la rejoue.
Vise : on cherche la note ; la courbe bleue montre la voix, la ligne du milieu est la note à chanter, les traits fins sont les demi-tons.
Tiens : la note compte après la tenue réglée (0,7 s au départ, de 0,3 à 2 s) dans la bande de ±50 cents, à l'octave près ; la bande
fonce pendant la tenue. Les 150 premières millisecondes d'une émission ne sont pas jugées, la médiane absorbe le vibrato,
un glissando qui traverse la bande ne compte pas. L'exercice suivant arrive seul.

Pas à tâtons : une autre note tenue une demi-seconde (à 75 cents au moins de la cible), ou plus de deux secondes au-delà de la
tenue pour trouver la note suivante, et l'exercice reprend à sa première note après avoir fait réentendre la note de départ ;
la note où l'on a buté reste rouge pendant ce temps. Rester sur la note précédente n'est pas une fausse note.
« Plaqué » et « Arpégé », en bas, font entendre toutes les notes ensemble ou l'une après l'autre ; on reprend ensuite à la première.
La courbe de la voix se masque dans les réglages.

Le micro de la barre, touché, rend le micro (dans la lecture de notes aussi) : l'app n'entend plus rien, le témoin orange de
l'iPhone s'éteint, le piano reste disponible. Retouché, il reprend le micro et l'exercice de chant repart de sa première note.
Le micro est aussi rendu pendant que les réglages sont ouverts. Le son est fermé dès que la page est cachée ; quand il joue,
le lecteur de l'écran verrouillé affiche « Solfège » et l'icône de l'app.

- Intervalles : le nom de l'intervalle et son sens sont écrits, sans portée. Les onze intervalles, de la seconde mineure à la
  septième majeure, se cochent un par un, ainsi que montant et descendant. Par défaut on chante d'abord la note de départ.
- Portée : deux notes écrites en clé de sol, à chanter l'une après l'autre ; la première sonne. Mêmes choix d'intervalles.
  La première note est naturelle, la seconde porte le bémol ou le dièse que demande l'intervalle.
- Accords : le chiffrage est écrit, la fondamentale sonne, les notes se chantent de bas en haut. Majeur, mineur, augmenté,
  diminué, sus4, mineur 7, majeur 7, 7, mineur majeur 7, 6, dans l'écriture du jazz : C–7, C∆7, C–∆7.
- Parce que la note est jugée à l'octave près, le sens d'un intervalle n'est pas vérifié.
- Une séance gardée : `mode` (`intervalles`, `portee`, `accords`), bande et tenue, et par exercice chanté
  `[ce qui était demandé, temps (ms), écart médian de chaque note (cents), réécoutes, reprises, aides]`.
- Réglages d'essai par l'adresse : `?tol=25` (bande en cents), `?tenue=500` (ms).
- Précision du suivi de hauteur sur sons de synthèse : moins de 0,2 cent de 73 à 880 Hz.

## Lecture d'intervalles

Deux notes à la suite sur la portée (clé de sol, clé de fa ou les deux, intervalles au choix) : dire le nom de l'intervalle.
Le bon nom grise les notes et amène l'intervalle suivant ; un autre nom les met en rouge jusqu'à la bonne réponse. Seule la
première réponse compte dans la cadence et la justesse.

Réponse à la voix ou au toucher (réglages) : au toucher, sans micro, les intervalles cochés sont proposés sous la portée.
Par défaut, deux notes naturelles ; « Dièses et bémols » ajoute les intervalles altérés.

À la voix, chaque nom dit est comparé à des exemples par alignement temporel (`noms.js`). L'app est livrée avec une voix de
départ, `noms.json` : 122 exemples tirés de trois séries d'Hugo (Mac, AirPods, iPhone), chacun réduit à 12 coefficients cepstraux
centrés par centième de seconde, sur un octet. Ce ne sont pas des sons, mais ils viennent de sa voix : le fichier est public
comme le reste du dépôt. `outils/noms_modele.mjs` le refabrique à partir des séries (hors dépôt) et affiche ce que vaut la
reconnaissance. Des séries enregistrées ou importées sur l'appareil (réglages › « Enregistrer une série de plus ») s'ajoutent
à cette voix et restent sur l'appareil (`solfege.noms`, quatre au plus).

Le score d'un nom est la moyenne de ses deux exemples les plus proches. Un énoncé est ignoré si son score dépasse 1,08 fois le
plus grand score d'un nom retrouvé à la vérification, ou si le deuxième nom est à moins de 3 %. Pendant l'enregistrement, les
noms avancent avec le son reçu, pas avec l'horloge : une coupure du micro ne décale plus le journal.

Mesures (26 novembre) : chaque exemple contre les 121 autres, 117 noms retrouvés sur 122 ; chaque série reconnue avec les deux
autres seulement, 43/44 (Mac), 44/44 (AirPods), 33/34 (iPhone).

## Gammes et accords : une seule liste

`ACCORDS` et `GAMMES` (dans `chant.js`) servent à tous les exercices : un accord ou une gamme ajouté à la liste apparaît dans les
réglages de chaque exercice qui en utilise. Gammes : majeure, mineure, mineure harmonique, pentatoniques majeure et mineure, et
les sept modes. Deux noms pour les mêmes notes (majeure et ionien, mineure et éolien) valent la même réponse.

- Chant › Gammes : le nom de la gamme est écrit, la tonique sonne, on chante jusqu'à l'octave, en montant ou en descendant.
  Mêmes règles que les autres exercices de chant ; « Écouter » joue la gamme.

## Reconnaissance

Le piano joue, on touche ce qu'on a entendu, parmi les réponses cochées dans les réglages (accords écrits sur la fondamentale
jouée). Sans micro. Le haut-parleur rejoue. Une mauvaise réponse est barrée ; la retoucher la fait entendre sur la même fondamentale,
pour comparer. Seule la première réponse compte. Trouvée du premier coup, la question suivante vient seule ; trouvée après une
erreur, on reste sur la question (écoute note après note si c'était joué ensemble, flèche pour passer à la suite).

- Intervalles : les deux notes l'une après l'autre ou ensemble, en montant ou en descendant ; temps entre les deux notes réglable (0,2 à 2 s, 0,6 s au départ).
- Accords : les notes ensemble ou l'une après l'autre.
- Gammes : de la tonique à l'octave, en montant ou en descendant.

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
