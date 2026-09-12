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
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from build_db import CANON_GROUPS, norm as normalize_text, to_int

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
        SELECT s.uid, s.numero, s.date, s.type_code, s.sort_code, s.type_majorite, s.nbr_requis,
               s.titre, s.theme, s.groupes_valides, s.pour, s.contre, s.dossier_ref_apparie,
               g.groupe_canonique, g.position_calculee, g.position_officielle,
               g.participation, g.pour, g.contre
        FROM scrutins s
        LEFT JOIN scrutin_groupes g ON g.scrutin_uid = s.uid
        ORDER BY s.numero
        """
    )
    for (uid, numero, date, type_code, sort_code, type_majorite, nbr_requis,
         titre, theme, valides, total_pour, total_contre, dossier,
         sigle, position, position_officielle, participation, g_pour, g_contre) in rows:
        s = scrutins.get(uid)
        if s is None:
            s = scrutins[uid] = {
                "uid": uid, "numero": numero, "date": date, "type_code": type_code,
                "sort_code": sort_code, "type_majorite": type_majorite, "nbr_requis": nbr_requis,
                "titre": titre, "theme": theme or UNCLASSIFIED, "dossier": dossier,
                "groupes_valides": valides,
                "total_pour": total_pour or 0, "total_contre": total_contre or 0,
                "positions": {}, "positions_officielles": {}, "parts": {}, "counts": {},
            }
        if sigle:
            s["positions"][sigle] = position
            s["positions_officielles"][sigle] = position_officielle
            s["parts"][sigle] = participation or 0.0
            s["counts"][sigle] = (g_pour or 0, g_contre or 0)
    return list(scrutins.values())


def pivots_for(total_pour: int, total_contre: int, counts: dict[str, tuple[int, int]],
               seuil: int | None = None) -> tuple[int, list[str]]:
    """Écart à la majorité et groupes dont le basculement change à lui seul le résultat.

    Deux règles d'adoption : majorité des suffrages exprimés (`pour > contre`, seuil None) et
    majorité requise pour une motion de censure (`pour >= seuil`, seuil = voix nécessaires).
    """
    if seuil is None:
        adopted = total_pour > total_contre
        marge = total_pour - total_contre
    else:
        adopted = total_pour >= seuil
        marge = total_pour - seuil
    pivots = []
    for sigle, (pour, contre) in counts.items():
        new_pour = total_pour - pour + contre
        new_contre = total_contre - contre + pour
        changed = (new_pour > new_contre) != adopted if seuil is None else (new_pour >= seuil) != adopted
        if changed:
            pivots.append(sigle)
    return marge, sorted(pivots)


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


def group_participations(scrutins: list[dict]) -> dict[str, float | None]:
    """Participation moyenne par groupe sur les scrutins où sa position est déterminée."""
    participations: dict[str, float | None] = {}
    for sigle in SIGLES:
        values = [s["parts"].get(sigle, 0.0) for s in scrutins if s["positions"].get(sigle) is not None]
        participations[sigle] = round(sum(values) / len(values), 4) if values else None
    return participations


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


def _entropy(positions: list) -> float:
    counts = Counter(positions)
    total = len(positions)
    return -sum((count / total) * math.log(count / total) for count in counts.values())


ARTICLE_PREFIX = re.compile(r"^(?:du|de la|de l'|des|d'|de)\s+", re.I)


def title_family(titre: str) -> tuple[str, str] | None:
    """Extrait (type de texte, nom) d'un titre de passage « l'ensemble … », sinon None.

    Gère les particularités de l'open data : apostrophes typographiques, articles redoublés
    (« l'ensemble de de la proposition … ») et votes par partie de texte (« deuxième partie du
    projet de loi … »).
    """
    text = (titre or "").replace("\u2019", "'").replace("\u00a0", " ").strip()
    lowered = text.lower()
    prefixes = ("l'ensemble du ", "l'ensemble de la ", "l'ensemble de l'", "l'ensemble des ",
                "l'ensemble d'", "l'ensemble ")
    for prefix in prefixes:
        if lowered.startswith(prefix):
            rest = text[len(prefix):]
            break
    else:
        return None
    while True:
        match = ARTICLE_PREFIX.match(rest)
        if not match:
            break
        rest = rest[match.end():]
    name = re.sub(r"\s+", " ", rest.split(" (")[0].strip().rstrip("."))
    if not name:
        return None
    head = name.lower()[:40]
    if "projet de loi" in head:
        return "projet de loi", name
    if "proposition de loi" in head:
        return "proposition de loi", name
    if "proposition de résolution" in head:
        return "proposition de résolution", name
    return "texte", name


def statement(kind: str, name: str) -> str:
    """Gabarit mécanique : aucune rédaction, seul le titre officiel est repris."""
    article = "le" if name.split(" ")[0].lower() in ("projet", "texte", "rapport") else "la"
    return f"Faut-il adopter {article} {name} ?"


VOTE_VALUE = {"pour": 1, "contre": -1, "abstention": 0}
CORRELATION_MIN_OVERLAP = 6
CORRELATION_MIN_RATIO = 0.5


def _numeric(position) -> int:
    return VOTE_VALUE.get(position, 0) if position is not None else 0


def orientation(scrutin: dict, anchor: dict) -> int | None:
    """Orientation d'un vote par rapport au vote de passage de son texte (-1, +1 ou None).

    Règle purement calculée : corrélation des positions de groupe avec celles du vote de passage
    (« l'ensemble du texte »). Un amendement systématiquement voté avec le texte est orienté +1,
    un vote corrélé négativement −1 ; trop peu de groupes communs ou corrélation faible → None.
    """
    common = [sigle for sigle in SIGLES
              if anchor.get(sigle) is not None and scrutin["positions"].get(sigle) is not None]
    if len(common) < CORRELATION_MIN_OVERLAP:
        return None
    score = sum(_numeric(anchor[sigle]) * _numeric(scrutin["positions"][sigle]) for sigle in common)
    if abs(score) / len(common) < CORRELATION_MIN_RATIO:
        return None
    return 1 if score > 0 else -1


def questionnaire_families(scrutins: list[dict], per_theme: int = 3) -> list[dict]:
    """Questions « Essentiel » : un texte = une question, agrégée sur tous ses votes orientables.

    - Famille = tous les scrutins rattachés au même dossier, avec pour ancre le premier vote de
      passage (« l'ensemble … »). Chaque vote est orienté par `orientation()` : « pour » signifie
      toujours « pour ce texte ». Repli sans dossier : regroupement par titre.
    - Motions de censure : familles propres (art. 49 al. 2 : seuls les votes favorables sont
      recensés → un groupe absent est encodé « ne soutient pas »).
    - La déduplication du corpus ne s'applique pas (un vote reste un vote) ; les vecteurs
      identiques sont neutralisés à l'intérieur d'une famille.
    - Sélection : entropie moyenne des votes de passage, plafonnée à `per_theme` par thème.
    """
    families: dict[str, dict] = {}
    groups: dict[str, list[dict]] = defaultdict(list)
    texts: dict[str, tuple[str, str]] = {}
    for s in scrutins:
        if s.get("indisponible"):
            continue
        title = (s["titre"] or "").replace("\u2019", "'")
        if title.lower().startswith("la motion de censure"):
            # Recodage dans l'ordre canonique SIGLES (l'ordre SQL n'est pas garanti) :
            # seul « pour » reste pour, tout le reste devient « ne soutient pas » (-1).
            recoded = ["pour" if s["positions"].get(sigle) == "pour" else "contre" for sigle in SIGLES]
            if len(set(recoded)) == 1:
                continue
            family_id = f"moc:{s['uid']}"
            families[family_id] = {
                "id": family_id, "theme": "Motions de censure", "kind": "motion de censure",
                "label": f"Faut-il censurer le gouvernement ? (motion du {s['date']})",
                "dates": [s["date"]],
                "anchor": s["uid"],
                "votes": [{"u": s["uid"], "n": s["numero"], "d": s["date"], "dir": 1,
                           "ti": s["titre"],
                           "p": [POS_CODE[value] for value in recoded],
                           "q": [round(s["parts"].get(sigle, 0.0), 4) for sigle in SIGLES],
                           "f": round(s["facteur_theme"], 6)}],
                "entropies": [_entropy(recoded)],
            }
            continue
        parsed = title_family(s["titre"])
        if s.get("dossier"):
            key = f"dlr:{s['dossier']}"
        elif parsed:
            key = f"titre:{normalize_text(parsed[1])}"
        else:
            key = None
        if key is None:
            continue
        groups[key].append(s)
        if parsed and key not in texts:
            texts[key] = parsed

    for key, members in groups.items():
        if key not in texts:
            continue  # texte sans vote de passage : impossible de l'orienter
        kind, name = texts[key]
        passages = [s for s in members if title_family(s["titre"])]
        anchor = min(passages, key=lambda s: (s["date"], s["numero"]))
        determined = [p for p in anchor["positions"].values() if p is not None]
        if len(determined) < 8 or len(set(determined)) == 1 or anchor["theme"] == UNCLASSIFIED:
            continue
        votes, vectors = [], set()
        # L'ancre (vote de passage) est examinée en premier et toujours orientée +1 : elle est la
        # référence de la famille et ne doit jamais être neutralisée (doublon) ni écartée
        # (corrélation avec elle-même < 0,5 si le vote est très abstentionniste).
        ordered = [anchor] + [member for member in members if member["uid"] != anchor["uid"]]
        for s in ordered:
            direction = 1 if s["uid"] == anchor["uid"] else orientation(s, anchor["positions"])
            if direction is None:
                continue
            vector = tuple(s["positions"].get(sigle) for sigle in SIGLES)
            if vector in vectors:
                continue
            vectors.add(vector)
            votes.append({
                "u": s["uid"], "n": s["numero"], "d": s["date"], "dir": direction,
                "ti": s["titre"],
                "p": [POS_CODE[s["positions"].get(sigle)] for sigle in SIGLES],
                "q": [round(s["parts"].get(sigle, 0.0), 4) for sigle in SIGLES],
                "f": round(s["facteur_theme"], 6),
            })
        if not votes:
            continue
        entropies = [_entropy([p for p in passage["positions"].values() if p is not None])
                     for passage in passages]
        families[key] = {
            "id": key, "theme": anchor["theme"], "kind": kind, "label": statement(kind, name),
            "dates": sorted({vote["d"] for vote in votes}),
            "anchor": anchor["uid"],
            "votes": sorted(votes, key=lambda vote: (vote["d"], vote["n"])),
            "entropies": entropies,
        }

    kept: dict[str, list[dict]] = defaultdict(list)
    for family in families.values():
        entropies = family.pop("entropies")
        family["entropie"] = round(sum(entropies) / len(entropies), 4)
        kept[family["theme"]].append(family)

    out: list[dict] = []
    for entries in kept.values():
        entries.sort(key=lambda family: (family["entropie"], family["dates"][-1]), reverse=True)
        out.extend(entries[:per_theme])
    out.sort(key=lambda family: (family["theme"], -family["entropie"]))
    return out


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
        majorite = (s.get("type_majorite") or "").lower()
        # « suffrages exprimés » → pour > contre ; sinon majorité requise (motion de censure).
        seuil = None
        if "suffrages" not in majorite and to_int(s.get("nbr_requis")) > 0:
            seuil = to_int(s.get("nbr_requis"))
        marge, pivots = pivots_for(s["total_pour"], s["total_contre"], s["counts"], seuil)
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

    participations = group_participations(scrutins)

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
                     "cohesion": traits.get(s, {}).get("cohesion"),
                     "participation": participations.get(s)}
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
        "questionnaire.json": {
            "version": 4,
            "families": questionnaire_families(scrutins),
        },
    }
    for name, payload in exports.items():
        path = SITE_DATA / name
        tmp = path.with_suffix(path.suffix + ".part")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        tmp.replace(path)
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
