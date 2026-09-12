# AGENTS.md — france-votes

## Commandes

- `python pipeline/run_all.py` — pipeline complet : télécharge (skip si présent, `--force` pour
  retélécharger), construit `data/france-votes.db`, calcule scores/robustesse et régénère
  `site/data/*.json` (~2 min).
- `python -m unittest discover -s pipeline/tests` — 50 tests ; nécessitent la base et les exports.
- `node pipeline/check_site.mjs` — vérifie le JS contre les exports (66/66 accords, kappa,
  `?v=N` identique sur les 4 pages, clés lues par le questionnaire) ; à lancer après toute
  modification de `score.py` ou de `site/assets/*.js`.
- `python -m http.server 8000 --directory site` — servir le site ; ne pas ouvrir en `file://`
  (les `fetch` des JSON échouent).
- VS Code : `Ctrl+Shift+B` (ou `Ctrl+Alt+B`, binding local) lance la tâche « site: servir en local »
  définie dans `.vscode/tasks.json`.
- `python -X utf8 <script>.py` — obligatoire sous Windows (console cp1252) ; jamais de
  `python -c` multi-ligne sous PowerShell 5.1 : écrire un fichier dans `pipeline/`.
- `npx --yes html-validate@9 site/*.html` — validation HTML optionnelle (non installée).
- Vérif rendu/JS sans navigateur projet : Edge/Chrome headless (`--headless=new
  --screenshot=out.png --window-size=1440,2600 <url>`, ou CDP port 9222) ; scripts de capture
  dans `%TEMP%`, jamais commités.
- `docker build -t france-votes .` — image de prod : le pipeline tourne dans le build (données
  figées), nginx sert `site/` ; déploiement Unraid/GHCR détaillé dans `DEPLOYMENT.md`.

## Données & architecture

- `site/data/` est généré et gitignoré : un clone frais exige `python pipeline/run_all.py`
  avant de servir le site.
- Après toute modification de `build_db.py` ou `score.py` : relancer `run_all.py`, puis tests +
  `check_site.mjs` (les exports JSON sont la source des tests d'intégration).
- Ordre canonique des groupes défini une seule fois (`pipeline/build_db.py`, `CANON_GROUPS`) et
  importé par `score.py` ; les tableaux exportés (`scrutins.json` : `p` positions, `q`
  participations, `m` marge, `pv` groupes décisifs) sont indexés comme `meta.groupes`.
- Clés de paire `A|B` toujours dans l'ordre canonique (jamais alphabétique) : utiliser
  `VV.pairKey()`, jamais `.sort()`.
- Thèmes = base Dosleg du Sénat uniquement (premier thème de la liste retenu, 24 libellés courts ;
  l'open data AN n'expose pas d'`indexation` en législature 17) ; UDR = fusion
  `PO847173`/`PO872880`/`PO845520` ; 12 scrutins aux réfs de groupes toutes corrompues (`PO0`)
  exclus (2 autres, à une seule réf corrompue, sont récupérés par élimination).

## Front & sécurité

- Kappa : deux implémentations à garder identiques — `score.py:cohen_kappa` et `VV.kappa()`
  (`app.js`, utilisé par la fiche de paire) ; `check_site.mjs` compare les deux.
- Mobile : règles tactiles sous `(max-width:760px),(pointer:coarse)` — cibles ≥ 44 px, champs
  16 px (sinon zoom iOS), `<select>` contraints en largeur, tableaux empilés ou défilants ;
  ne pas rallonger les libellés de nav (4 mots courts, `nowrap`, vérifiés à 320 px).
- Ruban de couverture : `renderRibbon()` duplique le contenu (clone `aria-hidden` sans ids) pour
  le défilement infini — ne pas dupliquer les ids dans le HTML.
- Toute donnée injectée dans le DOM passe par `VV.esc()` ; couleurs par `VV.safeColor()` (hex
  uniquement) ; jamais de `innerHTML` avec une valeur brute.
- Après toute modification de `site/assets/*.js|css`, incrémenter `?v=N` dans les 4 pages HTML
  (sinon le navigateur sert l'ancien fichier depuis son cache).
- PWA : `manifest.webmanifest` + `service-worker.js` (icônes dans `site/assets/`). Si la liste
  `SHELL` du SW change, incrémenter `VERSION` dedans ; les assets versionnés `?v=N` s'invalident
  seuls.
- CSP meta `script-src 'self'` : aucun script inline ni attribut `on*` — ajouter un
  `site/assets/<page>.js` à la place.
- Liens externes : `target="_blank" rel="noopener"` systématique.
- Site volontairement sans framework ni build (1 CSS, JS natif) ; ne pas ajouter de dépendance.

## Environnement

- Python 3.12 stdlib uniquement (ni numpy ni pandas) ; Node 26 sert seulement à
  `check_site.mjs` et `npx`.
- Commiter uniquement sur demande explicite de l'utilisateur.
