# Guide de déploiement — GitHub → Unraid

Même chaîne que BrunoFresh : GitHub Actions teste, construit une image, la pousse sur GHCR,
Unraid la tire. Spécificité de france-votes : **le site est statique et les données officielles
sont figées dans l'image au moment du build**. Rafraîchir les données = reconstruire l'image
(c'est fait automatiquement chaque lundi, ou à la demande).

---

## 1. Ce que fait la CI/CD (`.github/workflows/main.yml`)

À chaque **push sur `main`** (et sur demande) :

1. **test** : lance le pipeline complet (`python pipeline/run_all.py` — télécharge les sources
   AN/Sénat, construit la base, régénère les exports), puis les 39 tests, `check_site.mjs`
   (cohérence JS/exports) et `html-validate`.
2. **build-and-push** (jamais sur les pull requests) : construit l'image Docker (le pipeline
   tourne dans le build), scanne l'image avec **Trivy** (échec si CVE CRITICAL/HIGH corrigeable),
   puis pousse sur `ghcr.io`.

Déclencheurs :
- push sur `main` ;
- **planification : chaque lundi 05:17 UTC** (rafraîchissement des données) ;
- `workflow_dispatch` manuel depuis l'onglet Actions (pour des données du jour).

---

## 2. Rendre l'image publique sur GHCR (important)

Par défaut le paquet est privé. Pour éviter un token Docker dans Unraid :

1. GitHub → ton profil → onglet **Packages** → paquet `france-votes`.
2. **Package settings** → *Danger Zone* → **Change visibility** → **Public**.

L'image est alors `ghcr.io/luriot/france-votes:latest` (minuscules obligatoires).

---

## 3. Déploiement dans Unraid

1. Onglet **Docker** → **Add Container**.
2. Renseigne :
   - **Name** : `FranceVotes`
   - **Repository** : `ghcr.io/luriot/france-votes:latest`
   - **Network Type** : `Bridge`
3. Ajoute un mapping de port :
   - **Name** : `WebUI` — **Container Port** : `80` — **Host Port** : `8088` (ou un autre port libre).
4. C'est tout : **aucun volume ni variable d'environnement requis** (site statique, données
   en lecture seule dans l'image).
5. **Apply**, puis ouvre `http://IP_DE_TON_UNRAID:8088`.

Variante plugin **Compose** : `docker compose up -d` avec le `docker-compose.yml` du dépôt.

---

## 4. Mises à jour et fraîcheur des données

- **Mise à jour manuelle** : Unraid → icône du conteneur → **Force Update** (tire le `latest`).
- **Mise à jour automatique** : décommenter le label Watchtower dans `docker-compose.yml`, ou
  activer Watchtower pour ce conteneur.
- **Données du jour** : onglet **Actions** → workflow `CI/CD` → **Run workflow** sur `main`,
  puis Force Update dans Unraid.
- **Rythme garanti** : au moins un rebuild par semaine (cron du lundi). Les données des scrutins
  évoluent au fil des séances ; il n'y a aucune écriture côté serveur.

---

## 5. HTTPS (optionnel, via reverse proxy)

Nginx Proxy Manager / Traefik → `http://IP_UNRAID:8088`. L'image envoie déjà
`Content-Security-Policy`, `X-Content-Type-Options: nosniff` et `Referrer-Policy` ; laisse le
proxy transmettre les en-têtes (ne pas les surcharger).

---

## 6. Tester en local (avec Docker installé)

```bash
docker build -t france-votes .
docker run --rm -p 8088:80 france-votes
# puis http://localhost:8088
```

Le build exécute le pipeline (~3 min, télécharge ~40 Mo depuis data.assemblee-nationale.fr et
data.senat.fr). Sans réseau, le build échoue — c'est volontaire, aucune donnée n'est mockée.

---

## 7. Dépannage

- **Trivy échoue sur une CVE de l'image nginx** : le Dockerfile applique déjà `apk upgrade`
  dans l'étage runtime. Si une CVE persistante apparaît (paquet non corrigé en amont), deux
  options : attendre la mise à jour Alpine, ou ajouter l'identifiant dans `.trivyignore.yaml`
  en documentant la raison (comme dans BrunoFresh). `ignore-unfixed: true` est déjà actif :
  seules les CVE **corrigeables** font échouer le build.
- **Ancienne version servie par le navigateur** : les assets du site sont versionnés `?v=N` ;
  un rafraîchissement suffit. Côté données, `Cache-Control` est limité à 1 h.
- **Le workflow planifié ne se déclenche pas** : les crons GitHub peuvent être retardés de
  quelques minutes ; vérifier l'onglet Actions.
