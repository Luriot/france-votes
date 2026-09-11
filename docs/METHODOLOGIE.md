# Méthodologie — note technique

Version canonique complète et lisible : **`site/methodologie.html`**. Ce fichier ne garde que ce
qui est utile au code et aux relecteurs.

## Paramètres appliqués par le pipeline

| Paramètre | Valeur | Où |
|---|---|---|
| Population | tous les scrutins publics de la législature (8 434 le 11/09/2026) | `build_db.py` |
| Exclusions | 14 scrutins aux réfs de groupes corrompues (`PO0`) | `build_db.py` |
| Position d'un groupe | majorité **stricte** parmi les votes exprimés ; égalité ou absence = non déterminée | `build_db.py:position_from_counts` |
| Participation | `(pour+contre+abstention) / membres` | `build_db.py`, `score.py` |
| Déduplication | vecteur de positions des 12 groupes identique → seul le premier compte | `score.py:deduplicate` |
| Plafond par thème | 15 % du poids total, réparti uniformément dans le thème | `score.py:CAP_THEME` |
| Poids d'un vote pour une paire | `1 × facteur_thème × min(part_A, part_B)` | `score.py:weight` |
| Score principal | Σ poids × accord / Σ poids (votes aux deux positions déterminées) | `score.py:pair_stats` |
| Contrôle | kappa de Cohen (3 catégories, non pondéré) | `score.py:cohen_kappa` |
| Carte | MDS classique sur `1 − accord` (Jacobi 12×12), axes non interprétés | `score.py:mds_coordinates` |
| Robustesse | 7 variantes de méthode + leave-one-theme-out + bootstrap 300 tirages, graine `20270901` | `score.py:main` |
| Questionnaire | 3 scrutins par thème, entropie maximale des positions des 12 groupes | `score.py:questionnaire_items` |

## Choix écartés (résumé)

Sélection médiatique des votes, sélection des votes polarisés, échantillon aléatoire, pondération
par « importance » du texte, thèmes par mots-clés, seuil sec de participation, kappa comme score
principal, usage du champ officiel `positionMajoritaire`. Motifs détaillés sur la page site.

## Limites

Thèmes absents pour 612 scrutins (textes jamais transmis au Sénat) → « Non classé » ; un vote de
groupe n'est pas un vote individuel ; conventions (plafond, dédup, majorité) testées en sensibilité
mais restant des conventions ; XVIIe législature seule ; scrutins publics uniquement (pas les votes
à main levée).

## Reproductibilité

```powershell
python pipeline/run_all.py          # download → SQLite → scores → site/data/*.json
python -m unittest discover -s pipeline/tests
node pipeline/check_site.mjs
python -m http.server 8000 --directory site
```

`data/manifest.json` : URL, date, taille, SHA-256 par source. `site/data/meta.json` : compteurs du
build. Détail complet : `docs/AUDIT.md` (sources et volumes réels) et `docs/RAPPORT.md`.
