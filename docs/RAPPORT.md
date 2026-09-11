# Rapport final — Votes 2027

Build vérifié le 11 septembre 2026. Tous les chiffres de ce rapport proviennent de fichiers
réellement téléchargés, parsés et testés localement.

---

## 1. Sources de données trouvées

| Source | Contenu utilisé | URL | Vérifié |
|---|---|---|---|
| Open data Assemblée nationale | Scrutins + votes nominatifs, XVIIe législature | `data.assemblee-nationale.fr/static/openData/repository/17/loi/scrutins/Scrutins.json.zip` | 26 317 479 octets, MD5 `d2d62edf…` conforme |
| Open data Assemblée nationale | Acteurs, mandats, organes (groupes) | `.../17/amo/deputes_senateurs_ministres_legislature/AMO20_…json.zip` | 2 544 833 octets |
| Open data Assemblée nationale | Dossiers législatifs + documents | `.../17/loi/dossiers_legislatifs/Dossiers_Legislatifs.json.zip` | 10 305 544 octets |
| Open data Sénat (Dosleg) | Thèmes officiels des dossiers | `data.senat.fr/data/dosleg/dossiers-legislatifs.csv` | 3 622 331 octets, 12 432 dossiers |
| Pages officielles AN | Vérification manuelle des scrutins 218 et 3824 | `assemblee-nationale.fr/dyn/17/scrutins/{n}` | chiffres identiques à la base |
| Site de référence | Analyse de leurs-votes.fr | page d'accueil + sitemap.xml | 10 sujets éditoriaux, ≈ 1 800 votes |

Sources secondaires identifiées mais non retenues : dump PostgreSQL complet du Sénat
(`data.senat.fr/data/dosleg/dosleg.zip`, scrutins du Sénat depuis 2006 — hors périmètre 2027),
API Légifrance/PISTE (clé gratuite, non nécessaire ici), jeux tiers Datan/CIVIX (non officiels,
utiles pour recoupement futur).

## 2. Volume réel de données disponible

- **8 434 scrutins** publics (numéros 1 à 8 434, sans trou ni doublon), du **08/10/2024 au
  21/07/2026** : 8 339 ordinaires, 72 solennels, 23 motions de censure.
- **1 270 476 votes individuels** nominatifs, 100 % des scrutins en décompte nominatif.
- **101 208 cellules groupe × scrutin** (12 groupes à chaque scrutin) : 9 092 sans votant,
  1 918 en égalité, 23 213 avec ≤ 3 votants exprimés.
- **2 873 dossiers** législatifs de la législature + 7 084 documents ; 1 067 acteurs,
  853 organes, 32 473 mandats.
- **12 entités de groupe** : RN, EPR, LFI-NFP, SOC, DR, ECOS, DEM, HOR, LIOT, GDR, UDR
  (3 identifiants successifs fusionnés), NI.
- Thèmes officiels Sénat disponibles pour 8 411 dossiers ; couverture finale après appariement :
  **7 822 scrutins (92,7 %)**.
- À titre de comparaison, le site de référence analyse ≈ 1 800 votes choisis sur 10 sujets :
  le projet travaille donc sur **4,7 fois plus de scrutins**, sans sélection.

## 3. Méthode de sélection retenue

**Tout prendre, puis appliquer des règles écrites.** Population = l'intégralité des scrutins
publics de la législature. Seules exclusions : 14 scrutins (0,17 %) dont les références de groupes
sont corrompues dans la source.

Aucune des pistes « biaisées » n'est utilisée : pas de sélection médiatique, pas de sélection des
votes les plus polarisés, pas de pondération par « importance », pas de classification
« gauche/droite » automatique. Le thème vient d'une source officielle (Sénat), jamais de mots-clés
inventés. Le détail complet est dans `docs/METHODOLOGIE.md` (choix écartés et justifications).

Règles structurelles appliquées :

1. **Position d'un groupe** recalculée des votes individuels : majorité stricte parmi les votes
   exprimés, égalité = non déterminée, groupe absent = non déterminée.
2. **Déduplication** des scrutins au vecteur de positions identique : 8 434 → **3 150 votes
   distincts** (5 284 doublons neutralisés, dont un vecteur répété 1 474 fois).
3. **Pondération** : poids 1 par vote distinct × plafond de 15 % du poids total par thème ×
   min(participation des deux groupes).
4. **Appariement des dossiers/thèmes** par lien officiel, puis titre normalisé, puis titres des
   documents — chaque méthode est stockée par scrutin (95,8 % des scrutins ont un dossier).

## 4. Méthode de calcul des proximités

- **Score principal** : taux d'accord pondéré = Σ poids × 1[positions identiques] / Σ poids, sur
  les scrutins où les deux groupes ont une position déterminée. Résultat fourni avec le nombre de
  scrutins partagés et le poids effectif.
- **Contrôle du hasard** : kappa de Cohen (3 catégories), kappa médian 0,12.
- **Lecture graphique** : MDS classique sur la distance 1 − accord (Jacobi 12×12), sans
  interprétation politique des axes.
- Résultats de référence : plus proches **RN–UDR 82,8 %**, **EPR–DEM 81,1 %**,
  **ECOS–GDR 77,9 %**, **LFI-NFP–ECOS 76,2 %** ; plus éloignés **ECOS–UDR 21,7 %**,
  **SOC–UDR 24,0 %**, **LFI-NFP–DR 24,5 %**. Ces regroupements émergent des votes seuls, sans
  aucune information politique injectée — c'est un contrôle de cohérence fort.

## 5. Tests de robustesse effectués

- **7 variantes de méthode** par paire : uniforme, plafond thème seul, participation seule, sans
  déduplication, positions officielles AN, seuils de participation 25 % et 50 %.
- **Leave-one-theme-out** : retrait d'un thème entier (90 thèmes), recalcul des 66 paires.
- **Sous-échantillons** : 5 périodes (semestres), 3 types de scrutin.
- **Bootstrap** : 300 rééchantillonnages avec remise, graine fixe `20270901`, percentiles 5–95 et
  stabilité du rang (1 = paire la plus proche sur 66).
- **Résultat affiché** pour chaque paire : intervalle min–max toutes variantes + intervalle
  bootstrap + rangs. Une paire dont le rang bouge fortement apparaît comme fragile.
- **Tests logiciels** : 36 tests unitaires et d'intégration (parsing, positions, déduplication,
  pondérations, kappa, MDS, bootstrap déterministe, base réelle, exports du site), tous verts.
  Vérification indépendante du JavaScript du site contre les exports (tolérance arrondi), et
  comparaison manuelle base ↔ pages officielles AN sur les scrutins 218 et 3824 : identique.

## 6. Principaux choix techniques

- **Python 3 stdlib uniquement** (urllib, zipfile, sqlite3, unittest) : aucune dépendance à
  installer, pipeline reproductible en une commande (`python pipeline/run_all.py`).
- **SQLite** pour la base transformée (154 Mo, 1,27 M votes) : adapté au volume, zéro serveur.
  Les bruts restent dans `data/raw/` avec empreintes SHA-256 dans `data/manifest.json`.
- **Site statique sans framework ni build** : 4 pages HTML, 1 CSS, 4 JS natifs, données JSON
  précalculées ; filtres et comparaisons recalculés côté navigateur avec la **même formule** que
  le pipeline. Déployable sur n'importe quel hébergeur statique.
- **Séparation stricte** brut → transformé → export, et **traçabilité intégrale** : chaque scrutin
  porte son identifiant, sa date, son URL source et la méthode d'appariement de son thème.
- Non retenus volontairement : numpy/pandas (inutiles à cette échelle), framework JS, serveur
  applicatif, base hébergée — sur-ingénierie pour un jeu de données statique.

## 7. Limites identifiées

1. **Thèmes non classés (7,3 %)** : textes jamais transmis au Sénat, donc sans thème officiel.
2. **Vote de groupe ≠ vote individuel** : un groupe est résumé par sa majorité (un député peut
   voter autrement ; l'explorateur garde les données nominatives en base).
3. **Conventions assumées** : plafond à 15 %, déduplication, règle de majorité. Toutes testées en
   sensibilité, mais elles restent des conventions.
4. **Fenêtre XVIIe législature seulement** : les équilibres d'avant 2024 ne sont pas comparables
   avec les groupes actuels (pipeline paramétrable pour étendre).
5. **Qualité de source** : 14 scrutins à références corrompues, 1 918 égalités, 9 092 absences.
6. **Scrutins publics uniquement** : pas de trace des votes à main levée.
7. **Pas de « vérité objective »** : le site minimise les biais de sélection et affiche ses
   conventions ; il ne prétend pas trancher politiquement.

## 8. Points qui restent à décider humainement

1. **Plafond par thème (15 %)** : paramètre le plus lourd du modèle. Facile à changer
   (`CAP_THEME` dans `pipeline/score.py`) ; un débat public sur la valeur serait légitime.
2. **Règle de déduplication** : dédupliquer au vecteur de positions est défendable mais agrège des
   scrutins distincts. Alternative : ne pas dédupliquer (variante déjà calculée et affichée).
3. **Inclusion des non-inscrits (NI)** : groupe hétérogène par nature ; le site l'affiche. Le
   masquer par défaut serait un choix à assumer explicitement.
4. **Couverture thématique** : faudrait-il enrichir les thèmes par une autre source officielle
   (travaux d'indexation, Légifrance) pour les 612 scrutins non classés ? Décision de périmètre.
5. **Extension multi-mandatures** : intégrer les XVIe et XVe législatures pour la profondeur
   historique, sachant que les groupes ne sont pas les mêmes.
6. **Questionnaire** : le nombre de questions par thème (3) et le seuil minimum de réponses (5)
   sont des réglages d'usage à valider avec des utilisateurs réels.
7. **Hébergement et nom de domaine** : le site est prêt à déployer ; le choix de l'hébergeur et de
   l'identité éditoriale reste humain.

---

## Livrables

- Site fonctionnel : `site/` (4 pages, données réelles, filtres, comparateur, robustesse,
  questionnaire, méthodologie).
- Base réelle : `data/france-votes.db` (SQLite, 154 Mo).
- Pipeline reproductible : `pipeline/` (`run_all.py`, `download.py`, `build_db.py`, `score.py`).
- Méthodologie : `docs/METHODOLOGIE.md` + page site ; audit : `docs/AUDIT.md`.
- Tests : `pipeline/tests/` (36 tests, verts) + `pipeline/check_site.mjs` +
  `pipeline/verify_officiel.py`.
- Sources : `data/manifest.json` (URL, date, taille, SHA-256, MD5).
