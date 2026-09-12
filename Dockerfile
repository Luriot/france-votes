# Étape 1 — pipeline : télécharge les sources officielles, construit la base et les exports du site.
# Aucune dépendance Python : stdlib uniquement.
FROM python:3.12-slim AS build
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app
COPY pipeline/*.py ./pipeline/
COPY site ./site
RUN python pipeline/run_all.py \
    && rm -rf /app/data

# Étape 2 — service statique : nginx sert site/ (données figées dans l'image).
FROM nginx:stable-alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/site /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
