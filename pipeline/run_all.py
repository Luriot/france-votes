"""Exécution complète du pipeline : sources → base → scores → exports site.

Les sources ne sont retéléchargées que si l'AN/Sénat a publié depuis la dernière
exécution (revalidation ETag/Last-Modified, cf. download.py) ; si rien n'a changé,
la base SQLite et les exports du site sont conservés tels quels.

Usage : python pipeline/run_all.py [--force]
"""

from __future__ import annotations

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

DB_PATH = ROOT / "data" / "france-votes.db"
SITE_DATA = ROOT / "site" / "data"
EXPORTS = ("meta.json", "scrutins.json", "agreement.json", "questionnaire.json")
MARKER = ROOT / "data" / "derniere_execution.json"


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
    return all((SITE_DATA / name).exists() for name in EXPORTS)


def rebuild_needed(changed: bool, force: bool, db: dict | None, exports: bool) -> bool:
    return force or changed or db is None or not exports


def write_marker(report: dict, skipped: bool, db: dict | None, delta: int | None) -> None:
    payload = {
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "changed": report["changed"],
        "skipped_rebuild": skipped,
        "sources": report["sources"],
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
    if not rebuild_needed(report["changed"], force, before, exports_ok()):
        print("\n=== sources inchangées — base SQLite et exports déjà à jour, étapes 2/3 et 3/3 ignorées")
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
