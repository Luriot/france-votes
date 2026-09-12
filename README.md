# <img src="site/assets/icon-192.png" width="44" alt=""> Votes 2027

Outil citoyen, neutre et reproductible pour comprendre comment les groupes politiques de
l'Assemblée nationale votent réellement, à partir des **données ouvertes officielles de
l'Assemblée nationale** et des **thèmes officiels du Sénat**.

Contrairement aux sélections éditoriales (par exemple « Leurs Votes », qui analyse ~1 800 votes
choisis par une rédaction), ce projet prend **tous** les scrutins publics de la législature, puis
applique des règles écrites, déterministes et testées. Aucun vote n'est choisi à la main.

![Votes 2027 — comment les groupes votent-ils vraiment ?](site/assets/og.png)

## Démarrage rapide

```powershell
python pipeline/run_all.py          # source modifiée ? revalide (ETag), reconstruit, sinon saute
python -m unittest discover -s pipeline/tests
node pipeline/check_site.mjs        # vérifie les données du site côté navigateur
python -m http.server 8000 --directory site
# puis ouvrir http://localhost:8000
```

Aucune dépendance externe : Python 3.10+ (stdlib uniquement) et un navigateur. Node est
nécessaire seulement pour le script de vérification facultatif.

## Contenu du dépôt

```
pipeline/
  download.py    téléchargement conditionnel des sources (ETag/If-None-Match) + empreintes
  build_db.py    parsing des flux, appariements dossier/thème, base SQLite
  score.py       pondérations, accords, kappa, robustesse, exports du site
  run_all.py     les trois étapes d'affilée (saute 2-3 si les sources n'ont pas changé)
  check_site.mjs vérification du JS de site contre les exports
  tests/         62 tests unitaires et d'intégration
data/            données brutes (ignorées par git) + france-votes.db
site/            site statique (aucun framework, aucun build) + données JSON générées
  assets/        style, JS natif, icônes (icon-192, icon-512 « any maskable », apple-touch), og.png
  manifest.webmanifest, service-worker.js   PWA (installable, hors-ligne)
deploy/nginx.conf configuration nginx de production (CSP, gzip, cache, PWA)
Dockerfile       image de prod : pipeline exécuté au build, nginx sert site/
docker-compose.yml   test local / plugin Compose Unraid
.github/workflows/main.yml   CI (pipeline + 62 tests + check_site + HTML), build GHCR,
                             scan Trivy, contrôle quotidien des sources (build si publication)
DEPLOYMENT.md    guide GitHub → GHCR → Unraid (DNS, HTTPS, mises à jour)
```

Toutes les règles de la méthodologie et l'audit des sources sont documentés sur le site lui-même
(page « Méthodologie ») et résumés dans les sections ci-dessous.

## Ce que publie le site

- **Comparer** : matrice des taux d'accord entre les 12 groupes, fiche détaillée par paire
  (accord, kappa, intervalle de robustesse, timeline par période, accord par thème, votes qui
  rapprochent / opposent), carte MDS calculée uniquement à partir des votes, état partageable
  dans l'URL (`?a=RN&b=ECOS&theme=Budget&abst=1`), option d'exclusion des abstentions.
- **Explorer les votes** : les 8 434 scrutins filtrables (thème, période, type, position d'un
  groupe, recherche plein texte), tri par serrage, badges « serré » et « décisif » (marge et
  groupes dont le basculement change le résultat), export CSV, chacun relié à sa page officielle.
- **Questionnaire** : une question par texte de loi, générée depuis le titre officiel et agrégée
  sur tous ses votes ; **affinage vote par vote** possible pour chaque texte ; résultat
  **partageable** (bouton Partager natif / lien `?r=…`, vue allégée pour capture d'écran) et
  l'utilisateur voit les votes qui pèsent sur son résultat.
- **Sur téléphone** : design responsive (testé jusqu'à 320 px), cibles tactiles ≥ 44 px, et
  **PWA installable** (« Ajouter à l'écran d'accueil ») avec consultation **hors-ligne** des
  dernières données ; image de partage dédiée (`og.png`) pour les réseaux.
- **Méthodologie** : toutes les règles et les limites, en clair.

## Instantané des données (build du 11/09/2026)

| Élément | Valeur vérifiée |
|---|---|
| Scrutins publics XVIIe législature | 8 434 (08/10/2024 → 21/07/2026) |
| Votes individuels | 1 270 476 |
| Cellules groupe × scrutin | 101 208 (12 groupes à chaque scrutin) |
| Scrutins rattachés à un dossier | 8 078 (95,8 %) |
| Scrutins thématisés (Sénat) | 7 822 (92,7 %) |
| Votes distincts après déduplication | 3 150 |
| Paire la plus proche | RN–UDR : 83,9 % d'accord |
| Paire la plus éloignée | ECOS–UDR : 21,6 % |
| Kappa médian des 66 paires | 0,12 |

## Principes de neutralité

1. Population complète : aucune sélection éditoriale, aucune exclusion par « importance ».
2. Positions recalculées depuis les votes nominatifs, avec des règles explicites (majorité
   stricte, égalité = non déterminée).
3. Pas de classification politique des votes par l'algorithme ; les axes de la carte sont
   dérivés des votes après coup.
4. Pondérations publiées : facteur par thème `min(1 ; 0,15 × N / n)`, puis pondération par la
   participation (la part effective d'un thème peut donc dépasser 15 % sur une paire donnée).
5. Robustesse affichée : 7 variantes de méthode, leave-one-theme-out, intervalles bootstrap
   (300 rééchantillonnages, graine fixe).
6. Traçabilité : chaque scrutin conserve son identifiant, sa date, son URL source et la méthode
   d'appariement de son thème.

## Déploiement

Image Docker unique (`Dockerfile`) : le pipeline génère les données au build, nginx sert `site/`.
CI/CD GitHub Actions → GHCR → Unraid, avec scan Trivy et contrôle quotidien des sources
(revalidation ETag ; l'image n'est reconstruite que si l'AN ou le Sénat a publié). Guide complet :
[`DEPLOYMENT.md`](DEPLOYMENT.md).

```bash
docker build -t france-votes .          # ~3 min (télécharge les sources officielles)
docker run --rm -p 8088:80 france-votes
```

L'installation PWA et le hors-ligne exigent HTTPS (reverse proxy) ; la procédure Unraid détaillée
est dans le guide.

## Licence et sources

Données : Assemblée nationale (licence ouverte), Sénat / base Dosleg (licence ouverte).
Le code du projet peut être réutilisé librement avec mention de la source.
