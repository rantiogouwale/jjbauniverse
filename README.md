# JOJO pédia — encyclopédie interactive *JoJo's Bizarre Adventure*

Fan-site **statique et sans dépendance** (aucun build, aucun framework, aucun `npm install`) :
HTML + CSS + JavaScript natif. Tout le contenu vit dans un unique objet de données, l'interface
est rendue côté client et la navigation se fait par ancres (`#/accueil`, `#/stands`…).

## Contenu du site

| Section | Détail |
| --- | --- |
| **Accueil** | Hero, chiffres clés, duel **ORA / MUDA**, raccourcis « par où commencer » |
| **Parties** | Chronologie des **9 parties** + fiche détaillée en modale |
| **Personnages** | **42 fiches** filtrables par partie et recherche live (nom, Stand, rôle) |
| **Stands** | **36 cartes** avec le barème d'Araki (**A → E** sur 6 paramètres) et fiche en modale |
| **Duel de Stands** | Simulateur **déterministe** `#/duel/<stand-a>/<stand-b>` : 5 phases, journal du combat, verdict |
| **Quiz** | **10 questions**, score final, meilleur score mémorisé, rejeu |
| **Générateur** | Générateur de Stand **déterministe** (prénom + date de naissance → toujours le même Stand) |

Fonctions transverses :

- thème **Stand** (sombre) / **Hamon** (clair) mémorisé dans `localStorage`,
  **collection** des fiches consultées (étoile ★ sur les cartes + compteur « 12 / 36 »),
  roulette **🎲 Stand / Personnage au hasard**, **cris de combat synthétisés** (Web Audio, muets par
  défaut) et easter egg **ZA WARUDO** sur la touche <kbd>T</kbd> ;
- menu burger + panneau déroulant en mobile, modale accessible (Échap, clic sur le fond, focus),
  décor manga entièrement en CSS (halftone, ゴゴゴ, « soleil »), `prefers-reduced-motion` respecté.

## Structure

```text
index.html            Squelette des 7 vues + topbar + modale + décor
css/style.css          Tout le style (thèmes via variables CSS, responsive 880px / 620px / 560px)
js/data.js            Données : PARTIES, PERSONNAGES, STANDS, QUIZ → window.JJBA_DATA
js/duel.js            Moteur de duel pur (hachage, phases, dégâts) → window.JJBA_DUEL, sans DOM
js/app.js             Rendu, routeur par hash, filtres, quiz, générateur, duel, finitions, thème
tools/check-data.js   Vérification de cohérence des données et du moteur (Node)
tools/smoke.js        Test de fumée de l'interface (navigateur, développement)
```

`js/data.js` publie `window.JJBA_DATA` et `js/duel.js` publie `window.JJBA_DUEL` : les fichiers
peuvent donc être chargés en `<script>` classique (pas de module ES) tout en restant lisibles sous
Node (`globalThis`) pour les outils de vérification.

## Lancer le site

```bash
cd /chemin/vers/jjba
python3 -m http.server 8765
# puis ouvrir http://127.0.0.1:8765/
```

Un serveur local est nécessaire (les scripts ne sont pas en `type="module"`, mais l'ouverture
directe par `file://` reste fonctionnelle ; le serveur évite les restrictions de cache/PDF du
navigateur). Aucune donnée n'est envoyée en ligne : le générateur et le quiz fonctionnent
entièrement côté client.

## Routes (navigation par ancre)

| Route | Vue affichée |
| --- | --- |
| `#/accueil` (ou aucune ancre) | Hero, chiffres clés, duel ORA / MUDA |
| `#/parties` | Chronologie des 9 parties |
| `#/personnages` | 42 fiches filtrables |
| `#/stands` | 36 fiches de Stands |
| `#/duel` | Simulateur de duel, combat par défaut |
| `#/duel/star-platinum/the-world` | Duel précis, partageable et reproductible |
| `#/quiz` | Quiz en 10 questions |
| `#/generateur` | Générateur de Stand déterministe |

Sur `#/duel/<a>/<b>`, l'ordre des deux identifiants n'a pas d'importance : `a/b` et `b/a` décrivent
le même combat, avec les camps inversés.

## Vérifier les données

```bash
node tools/check-data.js
```

Attendu : `9 parties`, `42 personnages`, `36 stands`, `10 questions`, `duel : 630 paires simulées`,
puis `✅ data.js est cohérent.` Le script vérifie aussi les profils de duel (chaque type totalise la
même cible), leur déterminisme et leur symétrie sur les 630 paires.

## Lancer le test de fumée (interface)

`tools/smoke.js` n'est **pas** chargé en production ; on l'injecte le temps d'un test :

```bash
# 1. générer une page de test qui charge app.js + smoke.js
sed 's#<script src="js/app.js"></script>#<script src="js/app.js"></script>\n  <script src="tools/smoke.js"></script>#' \
  index.html > smoke.html

# 2. la lancer dans Chrome headless sur le serveur local
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox --virtual-time-budget=45000 \
  --window-size=1280,900 --dump-dom http://127.0.0.1:8765/smoke.html > /tmp/smoke.html

# 3. lire le verdict : document.title commence par « SMOKE: » (tout est vert)
grep -o '<title>[^<]*</title>' /tmp/smoke.html
grep -c '^OK  ' /tmp/smoke.html      # 61 vérifications
grep '^FAIL' /tmp/smoke.html         # doit ne rien renvoyer
```

Le rapport complet est aussi écrit dans le `<pre id="smoke">` en bas de page
(`OK` / `FAIL` par vérification). Il couvre les 7 vues, les filtres, le quiz, le générateur, le duel
(deep link, déterminisme, symétrie, 630 paires), le son, ZA WARUDO, la roulette et la collection.
Penser à supprimer `smoke.html` après le test.

## Notes de conception

- **Barème des Stands** : `Puissance`, `Vitesse`, `Portée`, `Persistance`, `Précision`,
  `Potentiel` notés de `A` à `E`, comme dans les planches officielles ; la valeur `null`
  signifie « hors barème » (Stand non évalué) et s'affiche `?`.
- **Générateur déterministe** : hachage FNV-1a de `prénom|date`, puis sélection dans des
  tables de noms/kanji/types/cris/pouvoirs. Même saisie → même Stand, aucune part d'aléatoire
  à l'exécution, donc rien à stocker côté serveur.
- **Duel déterministe** : `js/duel.js` est un moteur pur (aucun accès au DOM). La graine est le
  hachage FNV-1a des deux identifiants **triés**, puis un générateur mulberry32 produit la mêlée :
  même combat rejoué à l'identique, et inverser les camps inverse simplement les valeurs. Le combat
  se joue en **5 phases** dont les poids glissent de la distance vers le corps à corps ; les points
  de vie valent `60 + 10 × persistance` ; les Stands « hors échelle » (sans grades) partent d'une
  base `C` avec un avantage narratif ×1.9. Sur les 630 paires, ~la moitié se termine par un K.O.
- **Cris synthétisés** : aucun fichier audio (donc aucune question de droits) — chaque cri est une
  rafale d'impulsions bruit filtré + oscillateur, générée par Web Audio à la première interaction.
  L'état est muet par défaut et mémorisé dans `localStorage` (`jojopedia:son`).
- **ZA WARUDO** : la touche <kbd>T</kbd> fige le décor (animations en pause) et désature la page
  pendant 5 secondes, avec décompte ; une seconde pression rend le temps immédiatement. Le
  raccourci est ignoré dans les champs de saisie et lorsqu'une modale est ouverte.
- **Collection & roulette** : la clé `jojopedia:collection` liste les fiches ouvertes
  (`stand:<id>`, `perso:<id>`) et alimente l'étoile ★ des cartes ainsi que le compteur des vues ;
  les boutons 🎲 tirent une fiche au hasard parmi les résultats **filtrés**.
- **Accessibilité** : liens d'évitement, `aria-current` sur l'onglet actif, `aria-expanded` sur
  le burger, modale `role="dialog"` + `aria-modal` + `aria-labelledby`, `aria-live` sur le
  résultat du générateur et du quiz.
- **Visuels** : uniquement des motifs CSS (halftone, dégradés, kanji) pour ne diffuser aucune
  image sous droits ; les citations sont des traductions approximatives à usage de fan.

## Dépôt & publication

Le projet est versionné sur GitHub : <https://github.com/rantiogouwale/jjbauniverse> (branche `main`).

```bash
git remote -v                     # origin → rantiogouwale/jjbauniverse
git add -A && git commit -m "…"   # puis
git push
```

Le site étant 100 % statique (aucun build, chemins relatifs), il peut être publié tel quel sur
**GitHub Pages** : *Settings → Pages → Source « Deploy from a branch » → branche `main`, dossier
`/ (root)`*. L'adresse devient <https://rantiogouwale.github.io/jjbauniverse/>. Aucun workflow
n'est nécessaire : `index.html` est à la racine et toutes les ressources sont référencées en
relatif (`css/`, `js/`).
