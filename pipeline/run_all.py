"""Exécution complète du pipeline : téléchargement → base → scores → exports site.

Usage : python pipeline/run_all.py [--force]
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))

import build_db  # noqa: E402
import download  # noqa: E402
import score  # noqa: E402


def main() -> int:
    force = "--force" in sys.argv
    steps = [
        ("1/3 téléchargement des sources officielles", lambda: download.main(force=force)),
        ("2/3 construction de la base SQLite", build_db.main),
        ("3/3 scores, robustesse et exports du site", score.main),
    ]
    for label, action in steps:
        print(f"\n=== {label}")
        started = time.time()
        code = action()
        if code not in (0, None):
            print(f"échec à l'étape {label} (code {code})")
            return code
        print(f"=== {label} : {time.time() - started:.1f}s")
    print("\nTerminé. Pour lancer le site : python -m http.server 8000 --directory site")
    return 0


if __name__ == "__main__":
    sys.exit(main())
