"""Téléchargement reproductible des sources officielles.

Toutes les sources sont publiques et sans clé. Les empreintes sont enregistrées
dans data/manifest.json pour permettre la vérification a posteriori.
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
MANIFEST = ROOT / "data" / "manifest.json"

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


def fetch(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "france-votes/1.0 (open-data pipeline)"})
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(req, timeout=600) as resp, tmp.open("wb") as out:
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
    tmp.replace(dest)


def main(force: bool = False) -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    entries = []

    for src in SOURCES:
        dest = RAW / src["file"]
        if dest.exists() and not force:
            print(f"[skip] {src['file']} déjà présent")
        else:
            print(f"[download] {src['url']}")
            fetch(src["url"], dest)
            time.sleep(1)
        md5, sha = checksums(dest)
        entries.append({
            **src,
            "bytes": dest.stat().st_size,
            "md5": md5,
            "sha256": sha,
            "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        })
        print(f"         {dest.stat().st_size} octets md5={md5}")

    MANIFEST.write_text(
        json.dumps({"version": 1, "sources": entries}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"[ok] manifest -> {MANIFEST.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(force="--force" in sys.argv))
