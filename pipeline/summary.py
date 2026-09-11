"""Petit outil de vérification et de synthèse (lecture seule).

Usage :
    python pipeline/summary.py              # chiffres clés + paires extremes
    python pipeline/summary.py 218 [218...] # détail de scrutins précis
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "france-votes.db"


def show_scrutin(conn: sqlite3.Connection, numero: int) -> None:
    row = conn.execute(
        "SELECT uid, date, type_libelle, sort_libelle, titre, theme, theme_source, "
        "dossier_ref, dossier_ref_apparie, appariement, pour, contre, abstentions, non_votants, "
        "nombre_votants, suffrages_exprimes FROM scrutins WHERE numero=?",
        (numero,),
    ).fetchone()
    if not row:
        print(f"scrutin {numero}: introuvable")
        return
    (uid, date, tlib, slib, titre, theme, tsource, dossier, app_dossier, app,
     pour, contre, abst, nv, votants, exprimes) = row
    print(f"\n#{numero} {uid} — {date} — {tlib}")
    print(f"  {titre}")
    print(f"  thème: {theme or '(non classé)'} ({tsource or '-'}) | dossier officiel: {dossier or '-'} "
          f"| dossier apparié: {app_dossier or '-'} ({app or '-'})")
    print(f"  synthèse: votants={votants} exprimés={exprimes} pour={pour} contre={contre} "
          f"abst={abst} non-votants={nv} — {slib}")
    print("  groupes:")
    rows = conn.execute(
        "SELECT groupe_canonique, pour, contre, abstentions, non_votants, nombre_membres, "
        "position_officielle, position_calculee, participation "
        "FROM scrutin_groupes WHERE scrutin_uid=? AND groupe_canonique IS NOT NULL "
        "ORDER BY groupe_canonique", (uid,),
    ).fetchall()
    for sigle, p, c, a, n, m, off, calc, part in rows:
        print(f"    {sigle:6s} pour={p:3d} contre={c:3d} abst={a:3d} nv={n:3d} "
              f"membres={m:3d} officielle={off or '-':10s} calculée={calc or '-':10s} part={part:.2f}")


def main() -> int:
    if not DB.exists():
        print("base absente : lancer pipelined/build_db.py")
        return 1
    conn = sqlite3.connect(DB)
    nums = [int(x) for x in sys.argv[1:] if x.isdigit()]
    if nums:
        for n in nums:
            show_scrutin(conn, n)
        return 0

    meta = dict(conn.execute("SELECT key, value FROM meta").fetchall())
    print("Chiffres clés :")
    for key in ("scrutins", "votes_individuels", "cellules_groupes", "appariement_officiel",
                "appariement_titre", "appariement_document", "appariement_aucun",
                "theme_senat_url", "theme_senat_titre", "theme_aucun", "acteurs", "organes", "mandats"):
        print(f"  {key}: {meta.get(key)}")
    print("\nTypes de scrutins :")
    for row in conn.execute("SELECT type_libelle, COUNT(*) FROM scrutins GROUP BY 1 ORDER BY 2 DESC"):
        print(f"  {row[1]:5d}  {row[0]}")
    agreement = json.loads((ROOT / "site" / "data" / "agreement.json").read_text(encoding="utf-8"))
    pairs = sorted(
        ((v["accord"], k) for k, v in agreement["principal"].items() if v["accord"] is not None),
        reverse=True,
    )
    print("\nPaires les plus proches :")
    for value, key in pairs[:5]:
        print(f"  {key:24s} {value:.3f}")
    print("Paires les plus éloignées :")
    for value, key in pairs[-5:]:
        print(f"  {key:24s} {value:.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
