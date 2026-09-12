"""Téléchargement reproductible des sources officielles.

Toutes les sources sont publiques et sans clé. Les empreintes (md5/sha256) et les
en-têtes ETag/Last-Modified sont enregistrés dans data/manifest.json : à la prochaine
exécution, une source non modifiée répond 304 et aucun octet n'est retéléchargé.
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
MANIFEST = ROOT / "data" / "manifest.json"
USER_AGENT = "france-votes/1.0 (open-data pipeline)"

SOURCES = [
    {
        "name": "Scrutins XVIIe législature (AN)",
        "file": "Scrutins17.json.zip",
        "url": "https://data.assemblee-nationale.fr/static/openData/repository/17/loi/scrutins/Scrutins.json.zip",
        "page": "https://data.assemblee-nationale.fr/travaux-parlementaires/votes",
    },
    {
        "name": "Dossiers législatifs (AN)",
        "file": "DossiersLegislatifs17.json.zip",
        "url": "https://data.assemblee-nationale.fr/static/openData/repository/17/loi/dossiers_legislatifs/Dossiers_Legislatifs.json.zip",
        "page": "https://data.assemblee-nationale.fr/travaux-parlementaires/dossiers-legislatifs",
    },
    {
        "name": "Dossiers législatifs et thèmes (Sénat, base Dosleg)",
        "file": "senat_dossiers.csv",
        "url": "https://data.senat.fr/data/dosleg/dossiers-legislatifs.csv",
        "page": "https://data.senat.fr/dosleg/",
    },
]


def checksums(path: Path) -> tuple[str, str]:
    md5 = hashlib.md5()
    sha = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            md5.update(chunk)
            sha.update(chunk)
    return md5.hexdigest(), sha.hexdigest()


def conditional_headers(entry: dict | None) -> dict[str, str]:
    """En-têtes de revalidation HTTP d'après l'entrée manifest précédente."""
    headers: dict[str, str] = {}
    if not entry:
        return headers
    if entry.get("etag"):
        headers["If-None-Match"] = entry["etag"]
    if entry.get("last_modified"):
        headers["If-Modified-Since"] = entry["last_modified"]
    return headers


def fetch(url: str, dest: Path, headers: dict | None = None) -> dict | None:
    """Télécharge dest de façon atomique.

    Retourne les en-têtes utiles (etag, last_modified) ou None si le serveur
    répond 304 Not Modified (aucun octet transféré).
    """
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        with urllib.request.urlopen(req, timeout=600) as resp, tmp.open("wb") as out:
            while True:
                chunk = resp.read(1 << 20)
                if not chunk:
                    break
                out.write(chunk)
            info = {
                "etag": resp.headers.get("ETag"),
                "last_modified": resp.headers.get("Last-Modified"),
            }
    except urllib.error.HTTPError as err:
        if err.code == 304:
            return None
        raise
    tmp.replace(dest)
    time.sleep(1)
    return info


def sync_source(src: dict, dest: Path, previous: dict | None, force: bool = False) -> tuple[str, dict]:
    """Synchronise un fichier. Retourne (« unchanged » | « updated », entrée manifest).

    - fichier absent, manifest absent ou --force : téléchargement inconditionnel ;
    - 304 Not Modified : conservé tel quel, date de récupération d'origine ;
    - 200 à contenu identique : fichier conservé, etag/last_modified rafraîchis ;
    - 200 à contenu différent : remplacé, nouvelle empreinte et date.
    """
    headers = conditional_headers(previous) if previous and dest.exists() and not force else {}
    conditional = headers or None
    print(f"[{'check' if conditional else 'download'}] {src['url']}")
    info = fetch(src["url"], dest, conditional)
    if info is None:
        print("         inchangé (304 Not Modified)")
        return "unchanged", previous
    md5, sha = checksums(dest)
    same = bool(previous) and previous.get("sha256") == sha
    if same and not force:
        print("         réédité à contenu identique (fichier conservé)")
        return "unchanged", {**previous, "etag": info["etag"], "last_modified": info["last_modified"]}
    if previous and not same:
        print(f"         contenu modifié ({dest.stat().st_size - previous.get('bytes', 0):+d} octets)")
    entry = {
        **src,
        "bytes": dest.stat().st_size,
        "md5": md5,
        "sha256": sha,
        "etag": info["etag"],
        "last_modified": info["last_modified"],
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    print(f"         {entry['bytes']} octets md5={md5}")
    return "updated", entry


def load_manifest() -> dict[str, dict]:
    if not MANIFEST.exists():
        return {}
    try:
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
        return {entry["file"]: entry for entry in data.get("sources", [])}
    except (json.JSONDecodeError, KeyError, TypeError):
        print("[warn] manifest illisible, reconstruction complète")
        return {}


def sync(force: bool = False) -> dict:
    """Vérifie chaque source et ne retélécharge que si nécessaire.

    Retourne {"changed": bool, "sources": {fichier: "unchanged"|"updated"}}.
    """
    RAW.mkdir(parents=True, exist_ok=True)
    previous = load_manifest()
    entries: list[dict] = []
    statuses: dict[str, str] = {}
    for src in SOURCES:
        status, entry = sync_source(src, RAW / src["file"], previous.get(src["file"]), force)
        statuses[src["file"]] = status
        entries.append(entry)
    MANIFEST.write_text(
        json.dumps({"version": 1, "sources": entries}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    changed = any(status == "updated" for status in statuses.values())
    try:
        shown = MANIFEST.relative_to(ROOT)
    except ValueError:  # manifest redirigé (tests)
        shown = MANIFEST
    print(f"[bilan] sources={'mises à jour' if changed else 'inchangées'} -> {shown}")
    return {"changed": changed, "sources": statuses}


def main(force: bool = False) -> int:
    sync(force=force)
    return 0


if __name__ == "__main__":
    sys.exit(main(force="--force" in sys.argv))
