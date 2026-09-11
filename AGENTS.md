# AGENTS.md — france-votes

## Commandes

- `python pipeline/run_all.py` — pipeline complet : télécharge (skip si présent), construit
  `data/france-votes.db`, calcule scores/robustesse et régénère `site/data/*.json` (~2 min).
- `python -m unittest discover -s pipeline/tests` — 39 tests ; nécessitent la base et les exports.
- `node pipeline/check_site.mjs` — vérifie que le JS du site recalcule les mêmes accords que le
  pipeline ; à lancer après toute modification de `score.py` ou de `site/assets/*.js`.
- `python -m http.server 8000 --directory site` — servir le site ; ne pas ouvrir en `file://`
  (les `fetch` des JSON échouent).
- VS Code : `Ctrl+Shift+B` (ou `Ctrl+Alt+B`, binding local) lance la tâche « site: servir en local »
  définie dans `.vscode/tasks.json`.
- `python -X utf8 <script>.py` — obligatoire sous Windows (console cp1252) ; jamais de
  `python -c` multi-ligne sous PowerShell 5.1 : écrire un fichier dans `pipeline/`.
- `npx --yes html-validate@9 site/*.html` — validation HTML optionnelle (non installée).

## Données & architecture

- `site/data/` est généré et gitignoré : un clone frais exige `python pipeline/run_all.py`
  avant de servir le site.
- Après toute modification de `build_db.py` ou `score.py` : relancer `run_all.py`, puis tests +
  `check_site.mjs` (les exports JSON sont la source des tests d'intégration).
- Ordre canonique des groupes défini une seule fois (`pipeline/build_db.py`, `CANON_GROUPS`) et
  importé par `score.py` ; tous les tableaux exportés (`p`, `q`, `positions`, `parts`, `c`) sont
  indexés comme `meta.groupes`.
- Thèmes = base Dosleg du Sénat uniquement (l'open data AN n'expose pas d'`indexation` en
  législature 17) ; UDR = fusion `PO847173`/`PO872880`/`PO845520` ; 14 scrutins `PO0` exclus.

## Front & sécurité

- Toute donnée injectée dans le DOM passe par `VV.esc()` ; couleurs par `VV.safeColor()` (hex
  uniquement) ; jamais de `innerHTML` avec une valeur brute.
- CSP meta `script-src 'self'` : aucun script inline ni attribut `on*` — ajouter un
  `site/assets/<page>.js` à la place.
- Liens externes : `target="_blank" rel="noopener"` systématique.
- Site volontairement sans framework ni build (1 CSS, JS natif) ; ne pas ajouter de dépendance.

## Environnement

- Python 3.12 stdlib uniquement (ni numpy ni pandas) ; Node 26 sert seulement à
  `check_site.mjs` et `npx`.
- Commiter uniquement sur demande explicite de l'utilisateur.
