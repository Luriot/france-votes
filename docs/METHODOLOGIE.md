# Méthodologie — Projet « Votes 2027 »

Version 1.0 — build du 11 septembre 2026. Ce document décrit **toutes** les règles appliquées par
le pipeline. Chaque règle est déterministe et reproductible : le même fichier source et le même code
produisent les mêmes résultats (aucun choix manuel, aucun aléa non seedé).

---

## 0. Principes

1. **Aucune sélection éditoriale.** On ne choisit pas « les votes intéressants » : on prend
   l'intégralité des scrutins publics de la législature, puis on applique des règles structurelles
   écrites ici.
2. **Pas de jugement politique automatique.** Le pipeline ne classe jamais un vote comme « de
   gauche » ou « de droite ». Les axes (carte MDS) sont *calculés après coup* à partir des votes.
3. **Traçabilité.** Chaque scrutin conserve son identifiant officiel (`uid`), son URL source, sa
   date de récupération. Chaque position de groupe est recalculable depuis les listes nominatives.
4. **Les limites sont affichées** (couverture, dépendance aux conventions, fragilité des résultats).

---

## 1. Périmètre des données

- **Population** : tous les scrutins publics de la XVIIe législature disponibles dans le flux
  open data de l'Assemblée nationale à la date du build : **8 434 scrutins** (numéros 1 à 8 434,
  du 08/10/2024 au 21/07/2026), soit **1 270 476 votes individuels** et **101 208 cellules
  groupe × scrutin** (12 groupes par scrutin).
- **Exclusions** (structurelles, pas éditoriales) :
  - 14 scrutins (0,17 %) dont les références de groupes sont corrompues dans le flux (`PO0`) :
    ils restent consultables mais ne participent pas aux comparaisons de groupes ;
  - aucune autre exclusion : pas de filtre par thème, par résultat, ni par « importance ».
- **Entités comparées** : les 12 groupes officiels de la législature (11 groupes + non-inscrits).
  L'UDR est fusionnée sur ses trois identifiants successifs (`PO845520` → `PO847173` →
  `PO872880`), un renommage et non une scission.

## 2. Position d'un groupe sur un scrutin

Source : listes nominatives officielles (`decompteNominatif`, un enregistrement par député).

Pour un groupe G et un scrutin s, on compte parmi les membres de G présents dans la ventilation :
`p` (pour), `c` (contre), `a` (abstention), `nv` (non-votants).

Règles :

1. si `p + c + a = 0` → position **non déterminée** (groupe absent) ;
2. si l'un de `p`, `c`, `a` est strictement supérieur aux deux autres → position = ce maximum ;
3. sinon (égalité au maximum) → position **non déterminée** (pas de majorité ; notamment tous les
   cas `p = c`, soit 1 918 cellules au total) ;
4. la participation est `part = (p + c + a) / nombreMembresGroupe` (bornée à 1).

**Pourquoi pas le champ officiel `positionMajoritaire` ?** Il existe, mais il masque les égalités
et ne dit rien de la participation (un groupe peut être « pour » avec 1 votant, cas fréquents :
22,9 % des cellules ont ≤ 3 votants exprimés). Notre règle recalcule tout depuis les votes
individuels et rend le cas « pas de position » explicite.

## 3. Appariement des scrutins aux dossiers et aux thèmes

- Lien direct quand `objet.dossierLegislatif.dossierRef` est présent : **2 608 scrutins**.
- Sinon, **appariement de titres déterministe** : le titre officiel du scrutin est normalisé
  (minuscules, accents dépliés, ponctuation et apostrophes typographiques neutralisées), le nom du
  texte est extrait par expression régulière, puis comparé aux titres normalisés des dossiers AN
  (toutes législatures confondues : un texte déposé en XVIe peut être voté en XVIIe) et de leurs
  documents associés :
  - appariement exact par titre de dossier : **3 493 scrutins** ;
  - appariement par titre de document du dossier (rapports, textes déposés) : **1 977 scrutins** ;
  - aucun appariement : **356 scrutins**.
  - Aucun score flou, aucun seuil probabiliste : une correspondance est retenue ou pas, et la
    méthode (`officiel`, `titre`, `document`) est stockée pour chaque scrutin.
- **Thème** : base Dosleg du Sénat (source officielle). Appariement dossier AN → dossier Sénat par
  `senatChemin` (URL officielle, 6 320 scrutins) puis, à défaut, par titre normalisé exact
  (1 502 scrutins). En cas de thèmes multiples (`"Police et sécurité, Société"`), le **premier**
  est retenu comme thème principal.
- Résultat : **7 822 scrutins (92,7 %) ont un thème officiel**. Les autres sont classés
  **« Non classé »** et exclus uniquement des vues par thème.

## 4. Déduplication

Deux scrutins sont **redondants** si le vecteur de positions des 12 groupes (y compris
« non déterminée ») est identique. Seul le premier (numéro le plus petit) est utilisé pour les
scores ; les suivants reçoivent le poids nul et sont marqués « doublon de X » dans l'explorateur.

Justification : la comparaison entre groupes ne dépend que des positions ; un même vecteur répété
1 474 fois (cas maximal observé) apporte exactement la même information qu'une fois, mais fausserait
tout poids additif.

**Effet mesuré : 8 434 scrutins → 3 150 vecteurs distincts**, soit 5 284 doublons neutralisés.

## 5. Pondération

Le score d'une paire (A, B) est une moyenne pondérée. Trois règles :

1. **Poids de base 1** par scrutin retenu (après déduplication).
2. **Équilibre entre thèmes** : le poids total d'un thème est plafonné à **15 %** du poids total.
   Un thème de `n` scrutins reçoit un facteur `min(1 ; 0,15 × N / n)`, où `N` est le nombre de
   votes retenus. Les scrutins « Non classé » forment une strate traitée comme les autres.
   Sans cette règle, le budget (≈ 2 000 scrutins) écraserait tous les autres sujets.
3. **Participation** : pour une paire (A, B), chaque scrutin est pondéré par
   `min(part_A, part_B)` (la plus faible des deux participations). Un groupe absent ne compte
   donc pas ; un groupe peu mobilisé pèse proportionnellement moins. Aucun seuil arbitraire
   d'exclusion.

Poids final d'un scrutin pour une paire : `w = 1 × facteur_thème × min(part_A ; part_B)`.

## 6. Scores

Pour chacune des **66 paires** de groupes :

- **Taux d'accord observé pondéré** (score principal) :
  `accord = Σ w_i · 1[position_A(i) = position_B(i)] / Σ w_i`, sur les scrutins où les deux
  positions sont déterminées. Le site affiche aussi le nombre de scrutins partagés et le poids
  effectif.
- **Kappa de Cohen** (score secondaire, non pondéré) : accord corrigé du hasard sur les mêmes
  scrutins, catégories {pour, contre, abstention}. Kappa médian observé : **0,12**, ce qui
  rappelle que beaucoup de scrutins sont peu partagés ou très prévisibles.
- **Détail par thème et par période** : mêmes formules, calculées sur les sous-ensembles filtrés.
- **Carte MDS** : distance `d = 1 − accord`, positionnement multidimensionnel classique en
  2 dimensions (Jacobi sur la matrice 12×12). Représentation seulement : aucun axe n'est interprété
  politiquement.

Valeurs de référence du build : paire la plus proche **RN–UDR : 82,8 %**, paire la plus éloignée
**ECOS–UDR : 21,7 %**.

## 7. Analyse de robustesse (affichée sur le site)

Pour chaque paire, toutes les variantes suivantes sont calculées :

1. **Variantes de méthode** (7) :
   - pondération uniforme (poids 1 partout, sans plafond ni participation) ;
   - plafond par thème seul (sans participation) ;
   - participation seule (sans plafond thématique) ;
   - sans déduplication ;
   - positions officielles déclarées par l'Assemblée (`positionMajoritaire`) ;
   - exclusion des groupes présents à moins de 25 %, puis à moins de 50 %.
2. **Sous-échantillons** : par période (semestre), par type de scrutin (ordinaire, solennel,
   motion de censure), et **leave-one-theme-out** (retirer un thème entier).
3. **Bootstrap** : 300 rééchantillonnages avec remise (graine fixe `20270901`), percentiles 5–95
   du taux d'accord et stabilité du rang de proximité (1 = paire la plus proche sur 66).
4. **Indicateur de fragilité** : amplitude minimale–maximale du taux d'accord entre toutes les
   variantes. Un couple dont le classement bouge fortement est signalé « sensible à la méthode ».

## 8. Choix écartés et pourquoi

| Option envisagée | Décision | Raison |
|---|---|---|
| Sélection « top N votes médiatiques » | écartée | biais éditorial, non reproductible |
| Sélection des votes les plus polarisés | écartée | favorise mécaniquement les clivages, ignore le consensus |
| Sondage aléatoire simple d'un petit échantillon | écartée | perte d'information et variance inutile ; on garde tout |
| Pondération par « importance » du texte (loi promulguée > amendement) | écartée | choix éditorial non traçable ; la déduplication et le plafond thématique suffisent |
| Thèmes déduits par mots-clés du titre | écartée | classification non officielle (biais possible) ; on utilise le thème Sénat officiel |
| Exclusion des votes à faible participation | écartée | seuil arbitraire ; remplacée par une pondération continue par la participation |
| Kappa comme score principal | écarté | moins intuitif pour le grand public ; conservé comme contrôle du hasard |
| Position officielle `positionMajoritaire` de l'AN | écartée du score principal | masque égalités et absences ; nos règles sont explicites et recalculables (mais testée en variante) |

## 9. Limites assumées

1. **Couverture thématique partielle** : les thèmes Sénat ne couvrent pas les textes jamais transmis
   au Sénat. 7,3 % des scrutins sont « Non classé » — ils comptent dans les analyses globales mais
   pas dans les vues par thème.
2. **Conventions méthodologiques** : la règle de majorité, la déduplication, le plafond à 15 % et
   la pondération par participation sont des conventions. Elles sont toutes testées en sensibilité.
3. **Vote de groupe ≠ vote de chaque député** : un député peut voter contre son groupe (les listes
   nominatives permettent de le montrer). Le score compare des groupes, pas des personnes.
4. **Fenêtre temporelle** : seule la XVIIe législature (depuis juillet 2024) est incluse ; les
   groupes et les équilibres ont changé depuis 2022. Le pipeline est paramétré par législature.
5. **Scrutins publics uniquement** : les votes à main levée ne laissent pas de trace nominative.
6. **Qualité de source** : 14 scrutins ont des références de groupes corrompues à la source ;
   1 918 cellules présentent des égalités pour/contre ; 9 092 cellules n'ont aucun votant. Ces cas
   sont traités explicitement (non déterminé) et comptabilisés.
7. **Neutralité ≠ vérité** : le pipeline minimise les choix éditoriaux, il ne produit pas une
   « vérité objective ». Le site affiche systématiquement la couverture et la sensibilité.

## 10. Questionnaire utilisateur (chaîne de transparence)

Le questionnaire n'invente pas d'affirmations : il utilise des **scrutins réels** sélectionnés
automatiquement (pour chaque thème, les scrutins à entropie maximale des positions de groupes).
La chaîne est intégralement visible :

```
Position de l'utilisateur
        ↓
Scrutin réel (titre officiel + lien source + thème)
        ↓
Position des groupes (règle §2)
        ↓
Accord pondéré sur les scrutins répondus uniquement
        ↓
Détail : quels scrutins ont le plus pesé (positivement / négativement)
```

Aucun score caché : l'utilisateur voit la liste exacte des scrutins utilisés et peut remonter au
scrutin officiel.

---

## Reproductibilité

```powershell
python pipeline/run_all.py          # télécharge, vérifie les empreintes, construit la base, calcule tout
python -m unittest discover -s pipeline/tests
node pipeline/check_site.mjs
python -m http.server 8000 --directory site
```

Le fichier `data/manifest.json` contient, pour chaque source : URL, date de récupération, taille,
empreinte SHA-256 (et MD5, recoupé avec la valeur publiée par l'Assemblée nationale). Le fichier
`site/data/meta.json` contient les paramètres de la méthode et les compteurs du build.
