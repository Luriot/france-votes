"""Exécution complète du pipeline : sources → base → scores → exports site.

Les sources ne sont retéléchargées que si l'AN/Sénat a publié depuis la dernière
exécution (revalidation ETag/Last-Modified, cf. download.py) ; si rien n'a changé,
la base SQLite et les exports du site sont conservés tels quels.

Usage : python pipeline/run_all.py [--force]
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))

import build_db  # noqa: E402
import download  # noqa: E402
import score  # noqa: E402

PIPELINE = ROOT / "pipeline"
DB_PATH = ROOT / "data" / "france-votes.db"
SITE_DATA = ROOT / "site" / "data"
EXPORTS = ("meta.json", "scrutins.json", "agreement.json", "questionnaire.json")
MARKER = ROOT / "data" / "derniere_execution.json"


def code_fingerprint() -> str:
    """Empreinte du code du pipeline : toute modification force la reconstruction."""
    digest = hashlib.sha256()
    for path in sorted(PIPELINE.glob("*.py")):
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()[:16]


def db_summary() -> dict | None:
    """Résumé de la base existante (lecture seule), None si absente/illisible."""
    if not DB_PATH.exists():
        return None
    try:
        conn = sqlite3.connect(f"file:{DB_PATH.as_posix()}?mode=ro", uri=True)
        try:
            row = conn.execute("SELECT COUNT(*), MAX(numero), MAX(date) FROM scrutins").fetchone()
        finally:
            conn.close()
    except sqlite3.Error:
        return None
    return {"scrutins": row[0], "dernier_numero": row[1], "derniere_date": row[2]}


def exports_ok() -> bool:
    """Les 4 exports existent et sont au moins aussi récents que la base (pas de génération mixte)."""
    db_mtime = DB_PATH.stat().st_mtime if DB_PATH.exists() else 0.0
    for name in EXPORTS:
        path = SITE_DATA / name
        if not path.exists() or path.stat().st_mtime < db_mtime:
            return False
    return True


def source_hashes() -> dict:
    """Empreintes des sources actuellement présentes (manifeste écrit par download.sync)."""
    return {name: entry.get("sha256") for name, entry in download.load_manifest().items()}


def rebuild_needed(changed: bool, force: bool, db: dict | None, exports: bool,
                   code_changed: bool = False, sources_changed: bool = False) -> bool:
    return force or changed or code_changed or sources_changed or db is None or not exports


def previous_marker() -> dict:
    try:
        data = json.loads(MARKER.read_text(encoding="utf-8"))
    except (OSError, ValueError):  # fichier absent, tronqué, JSON invalide ou octets non UTF-8
        return {}
    return data if isinstance(data, dict) else {}


def write_marker(report: dict, skipped: bool, db: dict | None, delta: int | None) -> None:
    payload = {
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "code": code_fingerprint(),
        "changed": report["changed"],
        "skipped_rebuild": skipped,
        "sources": report["sources"],
        "sources_sha256": source_hashes(),
        "scrutins": db["scrutins"] if db else None,
        "dernier_numero": db["dernier_numero"] if db else None,
        "derniere_date": db["derniere_date"] if db else None,
        "nouveaux_scrutins": delta,
    }
    MARKER.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    force = "--force" in sys.argv
    started = time.time()
    print("\n=== 1/3 vérification des sources officielles")
    report = download.sync(force=force)
    print(f"=== 1/3 vérification des sources officielles : {time.time() - started:.1f}s")

    before = db_summary()
    marker = previous_marker()
    code_changed = marker.get("code") != code_fingerprint()
    sources_changed = marker.get("sources_sha256") != source_hashes()
    if code_changed:
        print("[code] pipeline modifié depuis la dernière exécution → reconstruction nécessaire")
    if sources_changed:
        print("[sources] sources plus récentes que la dernière reconstruction → reconstruction nécessaire")
    if not rebuild_needed(report["changed"], force, before, exports_ok(), code_changed, sources_changed):
        print("\n=== sources et code inchangés — base SQLite et exports déjà à jour, étapes 2/3 et 3/3 ignorées")
        write_marker(report, True, before, 0)
        return 0

    steps = [
        ("2/3 construction de la base SQLite", build_db.main),
        ("3/3 scores, robustesse et exports du site", score.main),
    ]
    for label, action in steps:
        print(f"\n=== {label}")
        step_started = time.time()
        code = action()
        if code not in (0, None):
            print(f"échec à l'étape {label} (code {code})")
            return code
        print(f"=== {label} : {time.time() - step_started:.1f}s")

    after = db_summary()
    delta = (after["scrutins"] - before["scrutins"]) if (before and after) else None
    if delta is not None:
        print(f"\n[delta] {delta:+d} scrutins (dernier n° {after['dernier_numero']} du {after['derniere_date']})")
    write_marker(report, False, after, delta)
    print("\nTerminé. Pour lancer le site : python -m http.server 8000 --directory site")
    return 0


if __name__ == "__main__":
    sys.exit(main())
