# Audit des données — Projet « Votes 2027 »

Date de l'audit : 11 septembre 2026.
Toutes les données chiffrées ci-dessous proviennent de fichiers réellement téléchargés et analysés
localement (voir `data/raw/` et `data/manifest.json`). Aucun chiffre n'est estimé.

---

## 1. Le site de référence : leurs-votes.fr

**Éditeur** : le média Bon Pote (mention « initiative du média indépendant Bon Pote », auteur déclaré
dans les métadonnées HTML). Site Next.js, rendu côté client, données non exposées publiquement.

**Fonctionnement observé** (page d'accueil, sitemap.xml, 11/09/2026) :

- 10 « sujets » éditoriaux : énergie, pouvoir d'achat, taxation, fraude, santé, femmes, LGBT,
  vie privée, climat, élevage.
- 11 groupes présentés : GDR, LFI, ECOLO, SOC, LIOT, DEM, EPR, HOR, LR, UDR, RN.
- La page d'accueil annonce « près de 1 700 votes » analysés ; la somme des compteurs par sujet
  affichés sur la page donne **1 842 votes** (183 + 343 + 254 + 112 + 251 + 189 + 25 + 173 + 263 + 49).
- La sélection des votes est **éditoriale** : « plusieurs mois de travail de nos journalistes afin
  d'analyser chaque amendement, proposition ou projet de loi ».
- Les routes `/methodologie`, `/a-propos`, `/methode`, `/sources` répondent **404** (11/09/2026) :
  la méthodologie détaillée de sélection n'est pas accessible sous une URL stable et vérifiable.
- Les sujets sont orientés (climat, droits, fiscalité) ; chaque sujet est traduit en « position
  attendue » par la rédaction.

**Conclusion** : outil utile et sourcé côté votes, mais dont la sélection des scrutins est un choix
éditorial non auditable par un tiers. C'est précisément ce biais que ce projet cherche à réduire.

---

## 2. Sources officielles identifiées

| Source | Contenu | URL | Format |
|---|---|---|---|
| Open data Assemblée nationale | Positions de vote de chaque député, tous scrutins publics de la législature courante | `https://data.assemblee-nationale.fr/static/openData/repository/17/loi/scrutins/Scrutins.json.zip` | ZIP de 8 434 fichiers JSON |
| Open data Assemblée nationale | Acteurs (députés) + tous leurs mandats + tous les organes (dont groupes politiques) | `https://data.assemblee-nationale.fr/static/openData/repository/17/amo/deputes_senateurs_ministres_legislature/AMO20_dep_sen_min_tous_mandats_et_organes.json.zip` | ZIP de 1 920 fichiers JSON |
| Open data Assemblée nationale | Dossiers législatifs (3 069 dossiers) + documents/notices de textes (7 084) | `https://data.assemblee-nationale.fr/static/openData/repository/17/loi/dossiers_legislatifs/Dossiers_Legislatifs.json.zip` | ZIP de 10 155 fichiers JSON |
| Open data Sénat (Dosleg) | Liste des dossiers législatifs avec **thèmes officiels** (base Dosleg) | `https://data.senat.fr/data/dosleg/dossiers-legislatifs.csv` | CSV 12 432 lignes |
| Open data Sénat (Dosleg) | Dump PostgreSQL complet (scrutins publics du Sénat depuis 2006, dossiers, thèmes) | `https://data.senat.fr/data/dosleg/dosleg.zip` | Dump PostgreSQL 8.4 |
| Légifrance / DILA | API open data des textes consolidés et du JORF (accès via portail PISTE, gratuit sur clé) | `https://developer.aife.economie.gouv.fr` / portail PISTE | JSON/XML |
| data.gouv.fr | Réutilisations tierces (Datan, CIVIX, programmescandidats.fr) utiles pour recoupement | — | CSV/API |

Fichiers téléchargés et empreintes : voir `data/manifest.json` (URL, date, taille, MD5/SHA-256).

---

## 3. Volume réellement disponible (Assemblée nationale, XVIIe législature)

Téléchargement du 11/09/2026 : `Scrutins.json.zip` = 26 317 479 octets, MD5
`d2d62edf46f3544502a815afc623423b` (MD5 publié par l'AN conforme).

- **8 434 scrutins**, numéros 1 à 8 434 (aucun trou, aucun doublon).
- Période : **8 octobre 2024 → 21 juillet 2026**.
- Types :
  - 8 339 scrutins publics ordinaires ;
  - 72 scrutins publics solennels ;
  - 23 motions de censure.
- Sessions : ordinaires 2024-2025 (2 873), 2025-2026 (4 849) ; sessions extraordinaires (712).
- **8 434 / 8 434 scrutins** publient un décompte nominatif complet (`DecompteNominatif`) :
  pour/contre/abstention/non-votants **par groupe** et **par député** (référence acteur).
- **2 608 scrutins** portent un lien `objet.dossierLegislatif` ; **5 826** n'en portent pas
  (limite du jeu de données, pas du site).
- Chaque scrutin contient les 12 emplacements de groupes (voir §4).
- Volume total de cellules groupe × scrutin : **101 208**, dont :
  - 9 092 (9,0 %) sans aucun vote exprimé (groupe absent du vote) ;
  - 1 918 (1,9 %) avec égalité pour/contre (pas de position majoritaire claire) ;
  - 23 213 (22,9 %) avec 3 votants exprimés ou moins (participation très faible).

Comparaison de référence : la XVIe législature complète (juin 2022 – juin 2024) est également
disponible (8 506 scrutins, non utilisés pour l'instant : les groupes et députés ne sont pas les
mêmes, une extension est possible via le même pipeline).

### Acteurs et organes

- 1 067 acteurs (députés) et 853 organes dans le flux `amo`.
- Les groupes politiques (codeType `GP`) de la XVIIe législature :

| Sigle | Libellé officiel | Réf. organe | Période |
|---|---|---|---|
| RN | Rassemblement National | PO845401 | 18/07/2024 → |
| EPR | Ensemble pour la République | PO845407 | 18/07/2024 → |
| LFI-NFP | La France insoumise – Nouveau Front Populaire | PO845413 | 18/07/2024 → |
| SOC | Socialistes et apparentés | PO845419 | 18/07/2024 → |
| DR | Droite Républicaine | PO845425 | 18/07/2024 → |
| ECOS | Écologiste et Social | PO845439 | 18/07/2024 → |
| DEM | Les Démocrates | PO845454 | 18/07/2024 → |
| HOR | Horizons & Indépendants | PO845470 | 18/07/2024 → |
| LIOT | Libertés, Indépendants, Outre-mer et Territoires | PO845485 | 18/07/2024 → |
| GDR | Gauche Démocrate et Républicaine | PO845514 | 18/07/2024 → |
| UDR | À Droite (PO845520) → UDR (PO847173) → Union des droites pour la République (PO872880) | 3 réfs | 18/07/2024 → |
| NI | Non inscrit | PO840056 | 01/07/2024 → |

L'identifiant de groupe UDR a changé deux fois (renommage, pas de scission) : les trois réfs sont
fusionnées en une seule entité « UDR » dans le projet, avec traçabilité du changement.

### Dossiers et thèmes

- 2 873 dossiers de la XVIIe législature + 196 dossiers antérieurs référencés (certains textes
  déposés sous la XVIe législature ont continué leur navette en XVIIe).
- **Le jeu de données AN ne contient pas de champ thème exploitable** : le champ `indexation`
  (qui porte les thèmes) n'est présent que sur 5 dossiers anciens sur 10 155 fichiers vérifiés.
- **Source de thèmes retenue** : la base **Dosleg du Sénat** (source officielle), colonne
  « Thèmes » du CSV `dossiers-legislatifs.csv` (8 411 dossiers sur 12 432 ont un thème).
  Appariement dossier AN → dossier Sénat par l'URL `titreDossier.senatChemin` (officielle) ;
  pour les autres, appariement par titre normalisé (règle déterministe, journalisée).
  Les scrutins sans dossier identifiable restent « non classés » (affichés comme tels).
- Les thèmes Sénat sont multi-valués (ex. « Police et sécurité, Société ») ; le projet retient le
  **premier thème** comme thème principal (règle explicite, sans pondération cachée).

---

## 4. Problèmes de qualité identifiés (et traitement)

| Problème | Volume constaté | Traitement retenu |
|---|---|---|
| Scrutins dont les réfs de groupes sont toutes remplacées par `PO0` | 14 scrutins (0,17 %) | Exclus des comparaisons de groupes (impossible d'attribuer une position à un groupe de façon fiable), listés avec mention « données groupes indisponibles » |
| Groupe absent d'un vote | 9 092 cellules (9,0 %) | Position « non déterminée » ; exclue du calcul des paires, comptée dans la couverture affichée |
| Égalité pour/contre dans un groupe | 1 918 cellules (1,9 %) | Position « non déterminée » (pas de majorité) |
| Participation très faible (≤ 3 votants) | 23 213 cellules (22,9 %) | Pas de seuil arbitraire : **pondération par la participation** (min des participations des deux groupes de la paire), voir METHODOLOGIE.md |
| Scrutins redondants (même vecteur de positions des 12 groupes) | 8 434 → 2 743 vecteurs uniques (5 691 doublons) | Déduplication déterministe : seule la première occurrence porte du poids ; les doublons restent consultables avec mention |
| Renommage/changement de groupe | UDR (2 renommages), sinon stable sur la législature | Table de correspondance explicite, fusion UDR |
| Changement de position d'un groupe dans le temps | géré nativement | Chaque scrutin porte la position du groupe à sa date |
| Unanimité / votes peu informatifs | non filtré a priori | Aucun filtre éditorial : la pondération et la déduplication neutralisent mécaniquement les scrutins sans information discriminante |

---

## 5. Ce qui est directement exploitable / ce qui nécessite un traitement

**Directement exploitable** : identifiant du scrutin, date, type de vote, sort, titre, objet,
demandeur, synthèse des voix, ventilation par groupe (décompte + liste nominative des votants avec
réfs acteur/mandat), appartenance des acteurs aux organes (mandats datés), dossiers législatifs.

**Nécessite un traitement reproductible** :
1. rattacher chaque scrutin à un dossier (`objet.dossierLegislatif` manquant pour 69 % des
   scrutins → appariement déterministe par titre, journalisé, taux mesuré à la construction) ;
2. rattacher chaque dossier à un thème officiel (CSV Sénat, appariement par URL/titre) ;
3. calculer la position des groupes à partir des listes nominatives (règles explicites) ;
4. dédupliquer ;
5. pondérer (participation, équilibre par thème) ;
6. calculer accords/kappa/robustesse.

## 6. Sénat

Les scrutins publics du Sénat existent (base Dosleg, depuis octobre 2006, dump PostgreSQL),
mais le Sénat n'est pas concerné par les élections de 2027 et ses votes ne peuvent pas être
comparés directement à ceux de l'Assemblée. L'extension Sénat est donc hors périmètre de la
première version ; le pipeline est paramétré par législature et par chambre pour permettre de
l'ajouter plus tard. Le CSV Sénat est utilisé comme **source de thèmes officielle**.

## 7. Limites de l'audit

- La méthodologie détaillée de leurs-votes.fr n'est pas accessible (routes 404, contenu rendu
  côté client) ; l'analyse repose sur la page d'accueil et le sitemap.
- Les thèmes couvrent la fraction des scrutins rattachables à un dossier lui-même présent dans
  Dosleg ; le taux de couverture final est mesuré à la construction (voir `meta.json`).
- Les votes à main levée ne sont pas dans les données (par nature) : seuls les scrutins publics
  sont analysables.
- Le présent audit décrit l'état des données au 11/09/2026 ; les flux AN sont mis à jour
  quotidiennement, les chiffres évolueront.
