# Traphouse

Classement CS2 de notre groupe : photo de profil, ELO FACEIT, Premier, meilleur rang MM, rang Wingman, rating Leetify, K/D et rating HLTV 1.0, triables par colonne. Un clic sur un joueur ouvre sa page et ses derniers matchs, un clic sur un match ouvre son tableau des scores.

Le site est 100 % statique (GitHub Pages). Toutes les heures, un workflow GitHub Actions interroge les API avec les clés rangées dans les Secrets, puis écrit des JSON dans `data/`. Le navigateur ne voit jamais une clé.

```
players.json ──► Actions (toutes les heures) ──► data/latest.json
                  FACEIT · Leetify · Steam       data/history/AAAA-MM-JJ.json
                                                 data/series.json ──► site
```

Le look vient de [vgui.css](https://github.com/AlpyneDreams/vgui.css) (MIT) : Greensteam en mode clair, Blacksteam en mode sombre, choisi automatiquement selon le réglage du téléphone. Le framework est copié tel quel dans `vendor/vgui/`, et le build le range dans une couche CSS sous Tailwind pour que les utilitaires restent prioritaires.

Pour voir le rendu avec de fausses données : ajouter `?demo` à l'URL.

## Mise en route (tout depuis github.com)

### 1. Créer le dépôt

1. **New repository** → un nom, par ex. `traphouse`. Il doit être **public** pour utiliser Pages avec un compte gratuit (les pseudos et Steam ID seront donc visibles).
2. **Add file → Upload files**, puis glisser **tout le contenu** du zip, y compris le dossier `.github`. Sur Mac, `Cmd + Maj + .` dans le Finder affiche les dossiers cachés.
3. **Commit changes**.

### 2. Récupérer les clés API

| Secret | Obligatoire | Où |
|---|---|---|
| `FACEIT_API_KEY` | oui | [developers.faceit.com](https://developers.faceit.com) → App Studio → créer une app → **API Keys** → clé **Server side** |
| `LEETIFY_API_KEY` | conseillé | [leetify.com/app/developer](https://leetify.com/app/developer) (se connecter avec Steam) |
| `STEAM_API_KEY` | non | [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) : avatars Steam pour ceux qui n'ont pas FACEIT |

### 3. Ajouter les clés dans les Secrets

**Settings → Secrets and variables → Actions → New repository secret**, une fois par clé, avec exactement les noms du tableau.

### 4. Activer GitHub Pages

**Settings → Pages → Build and deployment → Source : GitHub Actions.**

### 5. Premier lancement

**Actions → Mise à jour → Run workflow.** Au bout de 2–3 minutes, l'URL du site s'affiche dans le résumé du job `deploy` (`https://<pseudo>.github.io/traphouse/`). Ensuite, ça tourne tout seul toutes les heures.

## Si GitHub Actions ne marche pas

- **Pas de dossier `.github` dans le dépôt :** c'est un dossier caché, souvent oublié au glisser-déposer. Fais **Add file → Create new file**, tape `.github/workflows/update.yml` comme nom (les `/` créent les dossiers) et colle le contenu du fichier du zip.
- **Aucun workflow dans l'onglet Actions :** va dans **Settings → Actions → General → Allow all actions and reusable workflows**.
- **Croix rouge sur l'étape `deploy` :** **Settings → Pages → Source** doit être **GitHub Actions**, pas « Deploy from a branch ».
- **Croix rouge sur « Enregistrer les données » :** **Settings → Actions → General → Workflow permissions → Read and write permissions**.
- **Rien ne se passe :** le premier passage planifié peut tarder. Lance-le à la main avec **Actions → Mise à jour → Run workflow**.

## Ajouter ou retirer un joueur

Ouvre `players.json` sur GitHub, clique sur le crayon, ajoute son Steam ID dans la liste, puis **Commit changes** :

```json
"players": [
  "76561198000000001",
  "76561198000000002",
  { "steam64": "76561198000000003", "name": "Tom" },
  { "steam64": "76561198000000004", "faceit": false }
]
```

- **Le Steam ID suffit** (17 chiffres, sur [steamid.io](https://steamid.io) à partir du lien du profil). Le compte FACEIT lié est retrouvé automatiquement.
- **Le nom affiché** est son pseudo FACEIT, sinon son nom Leetify, sinon son pseudo Steam. Pour en imposer un, utilise la forme `{ "steam64": "…", "name": "Tom" }`.
- **`"faceit"`** : facultatif. Mets son pseudo FACEIT si le compte n'est pas lié à son Steam, ou `false` s'il n'a pas FACEIT.
- **Virgules** : une entre chaque joueur, pas après le dernier.

Le commit relance le workflow : le joueur apparaît en 2 à 3 minutes. Pour retirer quelqu'un, supprime sa ligne. Le Steam ID sert d'identifiant, donc renommer quelqu'un ne fait pas perdre son historique.

## Emblèmes de rang

- **FACEIT** : niveaux 1 à 10 dans `src/img/faceit/`.
- **Matchmaking et Wingman** : les emblèmes du jeu, rangs 1 (Silver I) à 18 (Global Elite), dans `src/img/ranks/` (`mm-N.png`, `wingman-N.png`).
- **Premier** : le fond du bandeau du jeu (`src/img/ranks/premier.svg`), teinté en CSS à la couleur du palier, avec le rating exact écrit par-dessus.

## Ce que les API ne donnent pas

- **Pas de classement Matchmaking global**, et même pas de rang MM unique : en CS2 le compétitif est classé par carte. L'onglet Matchmaking prend le **meilleur rang toutes cartes** de chaque joueur (via Leetify) et la page joueur montre le détail par carte.
- **Pas d'historique d'ELO FACEIT** ni de « +25 » par match dans l'API publique. Les évolutions sont calculées à partir de nos propres snapshots. Il faut donc attendre un jour pour voir les premières flèches, et une semaine pour le « 7 jours ».
- **Premier et MM viennent uniquement de Leetify.** Un joueur doit avoir un compte Leetify (connexion Steam) et un profil public pour avoir ses matchs.
- La carte et le score d'un match FACEIT viennent aussi de Leetify (l'historique FACEIT ne donne que la date et le vainqueur).

## Calculs

- **K/D et rating HLTV 1.0** : sur les matchs des 30 derniers jours qui ont un tableau des scores Leetify. Le 1.0 suit la formule publique d'HLTV (kills, survie et multi-kills par round). Le 2.0 n'est pas possible : HLTV n'a pas publié sa formule, et elle utilise le KAST et un score d'impact que Leetify ne donne pas.

- **Distinctions** : `ELO gagné + gain Premier ÷ 10 + 15 × victoires − 10 × défaites`, sur aujourd'hui / 7 jours / 30 jours, avec au moins un match joué. Égalité départagée au nombre de victoires.
- **Variation** : valeur actuelle moins la dernière valeur connue la veille au soir (ou il y a 7 jours).
- **Meilleure série** : plus longue série de victoires sur 30 jours. **Tryhard** : plus de matchs en 7 jours. **Pire chute** : plus grosse perte d'ELO en 7 jours. **Meilleur rating** : moyenne Leetify sur 7 jours, à partir de 5 matchs.

## Limites et pannes

- Les appels sont espacés (≈ 4 req/s pour FACEIT, moins d'1 req/s pour Leetify), avec 3 essais et un back-off en cas de 429 ou d'erreur serveur. Si Leetify renvoie un 429 qui persiste, on arrête de l'appeler jusqu'au passage suivant.
- Une source qui échoue n'efface rien : le joueur garde ses dernières valeurs, et le site affiche un bandeau avec l'heure de la dernière mise à jour.
- Les matchs sont conservés 45 jours dans `latest.json`, et un snapshot par jour est gardé dans `data/history/`. `series.json` en compacte les 90 derniers jours.
- Le cron de GitHub peut avoir un peu de retard aux heures chargées, c'est normal.
- Un commit par heure, ça fait ~700 commits par mois dans l'historique du dépôt. C'est sans conséquence.

## En local (facultatif)

```sh
npm install
npm run demo     # régénère demo/
npm run build    # Tailwind v4 + copie dans _site/
npx serve _site  # puis ouvrir /?demo
FACEIT_API_KEY=… LEETIFY_API_KEY=… npm run fetch
```

## Structure

```
players.json            la liste des joueurs
scripts/fetch.mjs       collecte (Node 22, aucune dépendance)
scripts/lib/store.mjs   snapshots, fusion des matchs, series.json
scripts/demo.mjs        données de démo
src/                    index.html, styles.css (Tailwind + composants), js/, img/
vendor/vgui/            vgui.css (Greensteam, Blacksteam) et sa licence
data/                   écrit par le workflow
.github/workflows/      mise à jour + déploiement Pages
```
