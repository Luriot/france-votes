"""Calcul des scores de proximité, de la robustesse et export du site.

Entrée  : data/france-votes.db
Sorties : site/data/*.json

Règles documentées sur la page « Méthodologie » du site (site/methodologie.html).
Tout est déterministe (graine fixe pour le bootstrap).
"""

from __future__ import annotations

import itertools
import json
import math
import random
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from build_db import CANON_GROUPS

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "france-votes.db"
SITE_DATA = ROOT / "site" / "data"

SIGLES = [s for _, s, _ in CANON_GROUPS]
GROUP_COLORS = [
    "#4C78A8", "#F58518", "#54A24B", "#E45756", "#72B7B2", "#B279A2",
    "#FF9DA6", "#9D755D", "#BAB0AC", "#8C6D31", "#729ECE", "#AEC7E8",
]
POS_CODE = {"pour": 1, "contre": -1, "abstention": 0, None: None}
CAP_THEME = 0.15
SEED = 20270901
BOOTSTRAP = 300
UNCLASSIFIED = "Non classé"


def load_scrutins(conn: sqlite3.Connection) -> list[dict]:
    scrutins: dict[str, dict] = {}
    rows = conn.execute(
        """
        SELECT s.uid, s.numero, s.date, s.type_code, s.sort_code, s.titre, s.theme,
               s.groupes_valides, s.pour, s.contre,
               g.groupe_canonique, g.position_calculee, g.position_officielle,
               g.participation, g.pour, g.contre
        FROM scrutins s
        LEFT JOIN scrutin_groupes g ON g.scrutin_uid = s.uid
        ORDER BY s.numero
        """
    )
    for (uid, numero, date, type_code, sort_code, titre, theme, valides, total_pour, total_contre,
         sigle, position, position_officielle, participation, g_pour, g_contre) in rows:
        s = scrutins.get(uid)
        if s is None:
            s = scrutins[uid] = {
                "uid": uid, "numero": numero, "date": date, "type_code": type_code,
                "sort_code": sort_code, "titre": titre, "theme": theme or UNCLASSIFIED,
                "groupes_valides": valides, "total_pour": total_pour or 0, "total_contre": total_contre or 0,
                "positions": {}, "positions_officielles": {}, "parts": {}, "counts": {},
            }
        if sigle:
            s["positions"][sigle] = position
            s["positions_officielles"][sigle] = position_officielle
            s["parts"][sigle] = participation or 0.0
            s["counts"][sigle] = (g_pour or 0, g_contre or 0)
    return list(scrutins.values())


def pivots_for(total_pour: int, total_contre: int, counts: dict[str, tuple[int, int]]) -> tuple[int, list[str]]:
    """Marge (pour − contre) et groupes dont le basculement change à lui seul le résultat."""
    adopted = total_pour > total_contre
    pivots = []
    for sigle, (pour, contre) in counts.items():
        new_pour = total_pour - pour + contre
        new_contre = total_contre - contre + pour
        if (new_pour > new_contre) != adopted:
            pivots.append(sigle)
    return total_pour - total_contre, sorted(pivots)


def group_traits(conn: sqlite3.Connection) -> dict[str, dict]:
    """Effectif moyen et cohésion (indice de Rice) par groupe canonique."""
    traits: dict[str, dict] = {}
    for sigle, membres in conn.execute(
        "SELECT groupe_canonique, AVG(nombre_membres) FROM scrutin_groupes "
        "WHERE groupe_canonique IS NOT NULL AND nombre_membres > 0 GROUP BY 1"
    ):
        traits.setdefault(sigle, {})["membres"] = round(membres)
    for sigle, rice in conn.execute(
        "SELECT groupe_canonique, AVG(ABS(pour - contre) * 1.0 / (pour + contre)) "
        "FROM scrutin_groupes WHERE groupe_canonique IS NOT NULL AND (pour + contre) > 0 GROUP BY 1"
    ):
        traits.setdefault(sigle, {})["cohesion"] = round(rice * 100, 1)
    return traits


def deduplicate(scrutins: list[dict]) -> None:
    seen: dict[tuple, str] = {}
    for s in scrutins:
        vector = tuple(s["positions"].get(sigle) for sigle in SIGLES)
        if s["groupes_valides"] == 0:
            s["poids_base"] = 0.0
            s["dup_of"] = None
            s["indisponible"] = True
            continue
        s["indisponible"] = False
        if vector in seen:
            s["poids_base"] = 0.0
            s["dup_of"] = seen[vector]
        else:
            seen[vector] = s["uid"]
            s["poids_base"] = 1.0
            s["dup_of"] = None


def apply_theme_cap(scrutins: list[dict]) -> dict:
    counts = Counter(s["theme"] for s in scrutins if s["poids_base"] > 0)
    total = sum(counts.values())
    for s in scrutins:
        n = counts.get(s["theme"], 0)
        s["facteur_theme"] = min(1.0, (CAP_THEME * total / n)) if n else 0.0
    return dict(counts)


def weight(s: dict, sigle_a: str, sigle_b: str, scheme: str) -> float:
    base = s["poids_base"] if scheme != "no_dedup" else 1.0
    if base == 0:
        return 0.0
    if scheme == "uniforme":
        theme_factor = 1.0
        participation = 1.0
    elif scheme == "thematique":
        theme_factor = s["facteur_theme"]
        participation = 1.0
    elif scheme == "participation":
        theme_factor = 1.0
        participation = min(s["parts"].get(sigle_a, 0.0), s["parts"].get(sigle_b, 0.0))
    else:
        theme_factor = s["facteur_theme"]
        participation = min(s["parts"].get(sigle_a, 0.0), s["parts"].get(sigle_b, 0.0))
    return base * theme_factor * participation


def position_for(s: dict, sigle: str, rule: str):
    if rule == "officielle":
        value = s["positions_officielles"].get(sigle)
        return {"pour": "pour", "contre": "contre", "abstention": "abstention"}.get(value)
    if rule in ("seuil25", "seuil50"):
        threshold = 0.25 if rule == "seuil25" else 0.5
        if s["parts"].get(sigle, 0.0) < threshold:
            return None
    return s["positions"].get(sigle)


def cohen_kappa(counts_a: Counter, counts_b: Counter, total: int, observed: int) -> float:
    if total == 0:
        return float("nan")
    po = observed / total
    pe = sum((counts_a.get(c, 0) / total) * (counts_b.get(c, 0) / total)
             for c in ("pour", "contre", "abstention"))
    if pe >= 1.0:
        return 1.0 if po == 1.0 else 0.0
    return (po - pe) / (1 - pe)


def pair_stats(scrutins: list[dict], sigle_a: str, sigle_b: str, scheme: str = "primary",
               rule: str = "calculee") -> dict:
    num = den = 0.0
    shared = 0
    ca: Counter = Counter()
    cb: Counter = Counter()
    observed = 0
    for s in scrutins:
        pa = position_for(s, sigle_a, rule)
        pb = position_for(s, sigle_b, rule)
        if pa is None or pb is None:
            continue
        w = weight(s, sigle_a, sigle_b, scheme)
        shared += 1
        ca[pa] += 1
        cb[pb] += 1
        if pa == pb:
            observed += 1
        if w > 0:
            num += w * (1.0 if pa == pb else 0.0)
            den += w
    agreement = num / den if den > 0 else float("nan")
    return {
        "accord": round(agreement, 6) if den > 0 else None,
        "kappa": round(cohen_kappa(ca, cb, shared, observed), 6) if shared else None,
        "n": shared,
        "poids": round(den, 3),
    }


def all_pairs(scrutins: list[dict], scheme: str = "primary", rule: str = "calculee") -> dict:
    return {
        f"{a}|{b}": pair_stats(scrutins, a, b, scheme, rule)
        for a, b in itertools.combinations(SIGLES, 2)
    }


def leave_one_theme_out(scrutins: list[dict]) -> dict:
    """Amplitude min/max de l'accord pour chaque paire quand on retire un thème entier."""
    result: dict[str, dict] = {}
    for theme in sorted({s["theme"] for s in scrutins}):
        subset = [s for s in scrutins if s["theme"] != theme]
        for key, value in all_pairs(subset).items():
            if value["accord"] is None:
                continue
            entry = result.setdefault(key, {"min": 1.0, "max": 0.0})
            entry["min"] = min(entry["min"], value["accord"])
            entry["max"] = max(entry["max"], value["accord"])
    return result


def bootstrap(scrutins: list[dict], iterations: int = BOOTSTRAP) -> dict:
    rng = random.Random(SEED)
    retained = [s for s in scrutins if s["poids_base"] > 0]
    n = len(retained)
    if n == 0:
        return {}
    pair_entries = {}
    for a, b in itertools.combinations(SIGLES, 2):
        entries = []
        for i, s in enumerate(retained):
            pa, pb = s["positions"].get(a), s["positions"].get(b)
            if pa is None or pb is None:
                continue
            w = weight(s, a, b, "primary")
            if w > 0:
                entries.append((i, w, 1.0 if pa == pb else 0.0))
        pair_entries[f"{a}|{b}"] = entries

    samples: dict[str, list[float]] = defaultdict(list)
    ranks: dict[str, list[int]] = defaultdict(list)
    for _ in range(iterations):
        multiplicity = Counter(rng.randrange(n) for _ in range(n))
        scores = {}
        for key, entries in pair_entries.items():
            num = den = 0.0
            for i, w, agree in entries:
                count = multiplicity.get(i)
                if not count:
                    continue
                num += count * w * agree
                den += count * w
            scores[key] = num / den if den else float("nan")
        finite = [k for k in scores if not math.isnan(scores[k])]
        order = sorted(finite, key=lambda k: -scores[k])
        for rank, key in enumerate(order, start=1):
            ranks[key].append(rank)
        for key, value in scores.items():
            if not math.isnan(value):
                samples[key].append(value)

    def percentile(values: list[float], q: float) -> float:
        if not values:
            return float("nan")
        values = sorted(values)
        idx = min(len(values) - 1, max(0, round(q * (len(values) - 1))))
        return values[idx]

    return {
        key: {
            "p5": round(percentile(values, 0.05), 4),
            "p50": round(percentile(values, 0.50), 4),
            "p95": round(percentile(values, 0.95), 4),
            "rang_p5": percentile(ranks[key], 0.05),
            "rang_p95": percentile(ranks[key], 0.95),
            "n_iter": len(values),
        }
        for key, values in samples.items()
    }


def jacobi_eigen(matrix: list[list[float]], max_iter: int = 200) -> tuple[list[float], list[list[float]]]:
    n = len(matrix)
    a = [row[:] for row in matrix]
    vectors = [[1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]
    for _ in range(max_iter):
        off = math.sqrt(sum(a[i][j] ** 2 for i in range(n) for j in range(i + 1, n)))
        if off < 1e-12:
            break
        for p in range(n - 1):
            for q in range(p + 1, n):
                if abs(a[p][q]) < 1e-15:
                    continue
                theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
                t = math.copysign(1.0, theta) / (abs(theta) + math.sqrt(theta * theta + 1))
                c = 1 / math.sqrt(t * t + 1)
                s = t * c
                for k in range(n):
                    akp, akq = a[k][p], a[k][q]
                    a[k][p] = c * akp - s * akq
                    a[k][q] = s * akp + c * akq
                for k in range(n):
                    apk, aqk = a[p][k], a[q][k]
                    a[p][k] = c * apk - s * aqk
                    a[q][k] = s * apk + c * aqk
                for k in range(n):
                    vkp, vkq = vectors[k][p], vectors[k][q]
                    vectors[k][p] = c * vkp - s * vkq
                    vectors[k][q] = s * vkp + c * vkq
    return [a[i][i] for i in range(n)], vectors


def mds_coordinates(pair_matrix: dict) -> list[dict]:
    n = len(SIGLES)
    index = {sigle: i for i, sigle in enumerate(SIGLES)}
    dist = [[0.0] * n for _ in range(n)]
    for a, b in itertools.combinations(SIGLES, 2):
        stat = pair_matrix[f"{a}|{b}"]
        d = 1.0 - stat["accord"] if stat["accord"] is not None else 1.0
        dist[index[a]][index[b]] = dist[index[b]][index[a]] = d
    row_means = [sum(row) / n for row in dist]
    grand = sum(row_means) / n
    b_matrix = [[-0.5 * (dist[i][j] ** 2 - row_means[i] - row_means[j] + grand ** 2)
                 for j in range(n)] for i in range(n)]
    eigenvalues, vectors = jacobi_eigen(b_matrix)
    order = sorted(range(n), key=lambda i: eigenvalues[i], reverse=True)[:2]
    coords = [[] for _ in range(n)]
    for axis in order:
        lam = max(eigenvalues[axis], 0.0)
        scale = math.sqrt(lam)
        values = [vectors[i][axis] * scale for i in range(n)]
        flip = -1.0 if values[max(range(n), key=lambda i: abs(values[i]))] < 0 else 1.0
        for i in range(n):
            coords[i].append(round(values[i] * flip, 4))
    return [{"sigle": SIGLES[i], "x": coords[i][0], "y": coords[i][1]} for i in range(n)]


def questionnaire_items(scrutins: list[dict]) -> list[dict]:
    by_theme: dict[str, list[tuple[float, dict]]] = defaultdict(list)
    for s in scrutins:
        if s["poids_base"] <= 0 or s["theme"] == UNCLASSIFIED:
            continue
        positions = [s["positions"].get(sigle) for sigle in SIGLES]
        determined = [p for p in positions if p is not None]
        if len(determined) < 8:
            continue
        counts = Counter(determined)
        total = len(determined)
        entropy = -sum((c / total) * math.log(c / total) for c in counts.values())
        by_theme[s["theme"]].append((entropy, s))
    items = []
    for theme, entries in sorted(by_theme.items()):
        entries.sort(key=lambda x: (-x[0], x[1]["numero"]))
        for entropy, s in entries[:3]:
            items.append({
                "uid": s["uid"], "numero": s["numero"], "date": s["date"], "theme": theme,
                "titre": s["titre"], "entropie": round(entropy, 4),
                "positions": [POS_CODE[s["positions"].get(sigle)] for sigle in SIGLES],
                "poids": round(s["poids_base"] * s["facteur_theme"], 6),
                "parts": [round(s["parts"].get(sigle, 0.0), 4) for sigle in SIGLES],
            })
    return items


def main() -> int:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        scrutins = load_scrutins(conn)
        traits = group_traits(conn)
        row = conn.execute("SELECT value FROM meta WHERE key='built_at'").fetchone()
        built_at = row[0] if row else None
    finally:
        conn.close()

    deduplicate(scrutins)
    theme_counts = apply_theme_cap(scrutins)
    retained = [s for s in scrutins if s["poids_base"] > 0]
    print(f"scrutins={len(scrutins)} retenus={len(retained)} doublons={len(scrutins)-len(retained)}")

    primary = all_pairs(scrutins)
    print("calcul des variantes...")
    variants = {
        "uniforme": all_pairs(scrutins, scheme="uniforme"),
        "thematique": all_pairs(scrutins, scheme="thematique"),
        "participation_seule": all_pairs(scrutins, scheme="participation"),
        "sans_deduplication": all_pairs(scrutins, scheme="no_dedup"),
        "position_officielle": all_pairs(scrutins, rule="officielle"),
        "seuil_participation_25": all_pairs(scrutins, rule="seuil25"),
        "seuil_participation_50": all_pairs(scrutins, rule="seuil50"),
    }
    print("leave-one-theme-out...")
    loto = leave_one_theme_out(scrutins)
    print(f"bootstrap ({BOOTSTRAP} rééchantillonnages)...")
    boot = bootstrap(scrutins)
    coords = mds_coordinates(primary)

    robustness = {}
    for key, stat in primary.items():
        values = [stat["accord"]]
        for variant in variants.values():
            if variant[key]["accord"] is not None:
                values.append(variant[key]["accord"])
        entry = loto.get(key, {"min": stat["accord"], "max": stat["accord"]})
        if entry["min"] is not None:
            values.append(entry["min"])
        if entry["max"] is not None:
            values.append(entry["max"])
        values = [v for v in values if v is not None]
        robustness[key] = {
            "accord": stat["accord"],
            "amplitude_min": round(min(values), 4) if values else None,
            "amplitude_max": round(max(values), 4) if values else None,
            "bootstrap": boot.get(key),
        }

    SITE_DATA.mkdir(parents=True, exist_ok=True)

    scrutin_export = []
    for s in sorted(scrutins, key=lambda x: x["numero"]):
        marge, pivots = pivots_for(s["total_pour"], s["total_contre"], s["counts"])
        scrutins_row = {
            "u": s["uid"], "n": s["numero"], "d": s["date"], "t": s["type_code"],
            "r": s["sort_code"], "ti": s["titre"], "th": s["theme"],
            "p": [POS_CODE[s["positions"].get(sigle)] for sigle in SIGLES],
            "q": [round(s["parts"].get(sigle, 0.0), 4) for sigle in SIGLES],
            "b": s["poids_base"], "f": round(s["facteur_theme"], 6),
            "dup": s["dup_of"], "ind": 1 if s.get("indisponible") else 0,
            "m": marge, "pv": [SIGLES.index(sigle) for sigle in pivots],
        }
        scrutin_export.append(scrutins_row)

    meta = {
        "version": "1.0",
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data_built_at": built_at,
        "compteurs": {
            "scrutins": len(scrutins),
            "scrutins_retenus": len(retained),
            "doublons": len(scrutins) - len(retained),
            "scrutins_indisponibles": sum(1 for s in scrutins if s.get("indisponible")),
            "scrutins_themes": sum(1 for s in scrutins if s["theme"] != UNCLASSIFIED),
            "themes": theme_counts,
            "paires_avec_accord": sum(1 for v in primary.values() if v["accord"] is not None),
        },
        "groupes": [{"sigle": s, "nom": nom, "couleur": GROUP_COLORS[i], "refs": [r],
                     "membres": traits.get(s, {}).get("membres"),
                     "cohesion": traits.get(s, {}).get("cohesion")}
                    for i, (r, s, nom) in enumerate(CANON_GROUPS)],
    }

    exports = {
        "meta.json": meta,
        "scrutins.json": scrutin_export,
        "agreement.json": {
            "sigles": SIGLES,
            "principal": primary,
            "variantes": {name: pairs for name, pairs in variants.items()},
            "robustesse": robustness,
            "mds": coords,
        },
        "questionnaire.json": {"questions": questionnaire_items(scrutins)},
    }
    for name, payload in exports.items():
        path = SITE_DATA / name
        path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"[ok] {path.relative_to(ROOT)} ({path.stat().st_size} octets)")

    accords = [(v["accord"], k) for k, v in primary.items() if v["accord"] is not None]
    kappas = sorted(v["kappa"] for v in primary.values() if v["kappa"] is not None)
    summary = {
        "paires": len(primary),
        "accord_min": min(accords) if accords else None,
        "accord_max": max(accords) if accords else None,
        "kappa_median": kappas[len(kappas) // 2] if kappas else None,
        "themes": len(theme_counts),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
