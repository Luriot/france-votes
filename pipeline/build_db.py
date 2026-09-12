"""Construction de la base SQLite à partir des flux bruts (données transformées).

Entrées  : data/raw/*.zip, data/raw/senat_dossiers.csv, data/manifest.json
Sortie   : data/france-votes.db  (+ journalisation dans la table meta)
"""

from __future__ import annotations

import csv
import io
import json
import re
import sqlite3
import sys
import unicodedata
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
DB_PATH = ROOT / "data" / "france-votes.db"

CANON_GROUPS = [
    ("PO845401", "RN", "Rassemblement National"),
    ("PO845407", "EPR", "Ensemble pour la République"),
    ("PO845413", "LFI-NFP", "La France insoumise - Nouveau Front Populaire"),
    ("PO845419", "SOC", "Socialistes et apparentés"),
    ("PO845425", "DR", "Droite Républicaine"),
    ("PO845439", "ECOS", "Écologiste et Social"),
    ("PO845454", "DEM", "Les Démocrates"),
    ("PO845470", "HOR", "Horizons & Indépendants"),
    ("PO845485", "LIOT", "Libertés, Indépendants, Outre-mer et Territoires"),
    ("PO845514", "GDR", "Gauche Démocrate et Républicaine"),
    ("PO847173", "UDR", "Union des droites pour la République (ex-À Droite, ex-UDR)"),
    ("PO840056", "NI", "Non inscrit"),
]
CANON_REFS = {ref for ref, _, _ in CANON_GROUPS}
SIGLE_BY_REF = {ref: sigle for ref, sigle, _ in CANON_GROUPS}
GROUP_ALIASES = {"PO872880": "PO847173", "PO845520": "PO847173"}


def as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def to_int(value, default=0):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def norm(value: str) -> str:
    text = unicodedata.normalize("NFKD", value or "").lower()
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def position_from_counts(pour: int, contre: int, abstentions: int) -> str | None:
    votes = {"pour": pour, "contre": contre, "abstention": abstentions}
    top = max(votes.values())
    if top == 0:
        return None
    winners = [pos for pos, n in votes.items() if n == top]
    return winners[0] if len(winners) == 1 else None


def load_senat_themes() -> tuple[dict[str, str], dict[str, str]]:
    path = RAW / "senat_dossiers.csv"
    text = path.read_bytes().decode("cp1252")
    by_url: dict[str, str] = {}
    by_title: dict[str, str] = {}
    for row in csv.DictReader(io.StringIO(text), delimiter=";"):
        raw = (row.get("Thèmes") or "").strip()
        theme = raw.split(",")[0].strip()  # premier thème officiel du Sénat, comme documenté
        url = (row.get("URL du dossier") or "").strip().lower()
        title = norm(row.get("Titre") or "")
        if not theme:
            continue
        if url:
            by_url[url] = theme
        if title and title not in by_title:
            by_title[title] = theme
    return by_url, by_title


def load_dossiers() -> tuple[dict[str, dict], dict[str, str], dict[str, list[str]]]:
    z = zipfile.ZipFile(RAW / "DossiersLegislatifs17.json.zip")
    dossiers: dict[str, dict] = {}
    title_index: dict[str, str] = {}
    doc_titles: dict[str, list[str]] = {}
    for name in z.namelist():
        if not name.endswith(".json"):
            continue
        if "/dossierParlementaire/" in name:
            d = json.loads(z.read(name))["dossierParlementaire"]
            titre = (d.get("titreDossier") or {}).get("titre") or ""
            dossiers[d["uid"]] = {
                "legislature": str(d.get("legislature") or ""),
                "titre": titre,
                "senat_chemin": ((d.get("titreDossier") or {}).get("senatChemin") or "").strip().lower() or None,
            }
            key = norm(titre)
            if key:
                current = title_index.get(key)
                if current is None or _prefer(dossiers, d["uid"], current):
                    title_index[key] = d["uid"]
        elif "/document/" in name:
            doc = json.loads(z.read(name))["document"]
            ref = doc.get("dossierRef")
            titres = doc.get("titres") or {}
            for t in (titres.get("titrePrincipal"), titres.get("titrePrincipalCourt")):
                key = norm(t or "")
                if key and ref:
                    doc_titles.setdefault(key, []).append(ref)
    return dossiers, title_index, doc_titles


def _prefer(dossiers: dict, candidate: str, current: str) -> bool:
    cand_leg = int(dossiers.get(candidate, {}).get("legislature") or 0)
    curr_leg = int(dossiers.get(current, {}).get("legislature") or 0)
    if cand_leg != curr_leg:
        return cand_leg > curr_leg
    return candidate > current


TEXT_PATTERN = re.compile(
    r"(projet|proposition) de (?:loi|r(?:é|e)solution)[^.(]*",
    re.I,
)
STOP_WORDS = re.compile(r"\b(premiere|deuxieme|troisieme|nouvelle|lecture|texte|adopte|rejete|examen prioritaire)\b")


def extract_text_key(titre: str) -> str:
    match = TEXT_PATTERN.search(titre or "")
    if not match:
        return ""
    key = norm(match.group(0))
    key = STOP_WORDS.sub(" ", key)
    return re.sub(r"\s+", " ", key).strip()


def resolve_theme(ref: str | None, dossiers: dict, by_url: dict, by_title: dict) -> tuple[str, str]:
    if not ref or ref not in dossiers:
        return "", ""
    dossier = dossiers[ref]
    senat = dossier.get("senat_chemin")
    if senat and by_url.get(senat):
        return by_url[senat], "senat_url"
    key = norm(dossier["titre"])
    if key and by_title.get(key):
        return by_title[key], "senat_titre"
    return "", ""


def match_dossier(titre, dossiers, title_index, doc_titles) -> tuple[str | None, str]:
    key = extract_text_key(titre)
    if not key:
        return None, ""
    ref = title_index.get(key)
    if ref:
        return ref, "titre"
    for doc_key, refs in doc_titles.items():
        if len(doc_key) > 15 and (doc_key in key or key in doc_key):
            ranked = sorted(refs, key=lambda r: int(dossiers.get(r, {}).get("legislature") or 0), reverse=True)
            return ranked[0], "document"
    best_ref, best_len = None, 0
    for candidate, ref in title_index.items():
        if len(candidate) >= 20 and candidate in key and len(candidate) > best_len:
            best_ref, best_len = ref, len(candidate)
    if best_ref:
        return best_ref, "inclusion"
    return None, ""


SCHEMA = """
PRAGMA journal_mode=MEMORY;
PRAGMA synchronous=OFF;
CREATE TABLE scrutins (
    uid TEXT PRIMARY KEY, numero INTEGER, legislature TEXT, date TEXT,
    session_ref TEXT, seance_ref TEXT, type_code TEXT, type_libelle TEXT,
    sort_code TEXT, sort_libelle TEXT, type_majorite TEXT, titre TEXT, demandeur TEXT,
    objet_libelle TEXT, dossier_ref TEXT, dossier_libelle TEXT,
    dossier_ref_apparie TEXT, appariement TEXT, theme TEXT, theme_source TEXT,
    mode_publication TEXT, nombre_votants INTEGER, suffrages_exprimes INTEGER,
    nbr_requis INTEGER, annonce TEXT, pour INTEGER, contre INTEGER,
    abstentions INTEGER, non_votants INTEGER, non_votants_volontaires INTEGER,
    groupes_valides INTEGER, source_url TEXT
);
CREATE TABLE scrutin_groupes (
    scrutin_uid TEXT, groupe_ref TEXT, groupe_canonique TEXT,
    nombre_membres INTEGER, position_officielle TEXT,
    pour INTEGER, contre INTEGER, abstentions INTEGER,
    non_votants INTEGER, non_votants_volontaires INTEGER,
    position_calculee TEXT, participation REAL
);
CREATE INDEX idx_groupes_scrutin ON scrutin_groupes(scrutin_uid);
CREATE TABLE scrutin_votes (
    scrutin_uid TEXT, acteur_ref TEXT, mandat_ref TEXT, groupe_ref TEXT,
    position TEXT, par_delegation INTEGER
);
CREATE INDEX idx_votes_scrutin ON scrutin_votes(scrutin_uid);
CREATE INDEX idx_votes_acteur ON scrutin_votes(acteur_ref);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
"""


def build(conn: sqlite3.Connection) -> dict:
    stats: dict[str, int] = {}
    by_url, by_title = load_senat_themes()
    dossiers, title_index, doc_titles = load_dossiers()

    conn.executescript(SCHEMA)

    votes_rows: list[tuple] = []
    zs = zipfile.ZipFile(RAW / "Scrutins17.json.zip")
    theme_sources: dict[str, int] = {}
    appariements: dict[str, int] = {}
    n = 0
    for name in zs.namelist():
        if not name.endswith(".json"):
            continue
        s = json.loads(zs.read(name))["scrutin"]
        n += 1
        officiel_ref = ((s.get("objet") or {}).get("dossierLegislatif") or {}).get("dossierRef")
        dossier_ref, appariement = (officiel_ref, "officiel") if officiel_ref else (None, "")
        if not dossier_ref:
            dossier_ref, appariement = match_dossier(s.get("titre"), dossiers, title_index, doc_titles)
        theme, theme_source = resolve_theme(dossier_ref, dossiers, by_url, by_title)
        appariements[appariement] = appariements.get(appariement, 0) + 1
        theme_sources[theme_source] = theme_sources.get(theme_source, 0) + 1

        synthese = s.get("syntheseVote") or {}
        decompte = synthese.get("decompte") or {}
        groupes = as_list(((s.get("ventilationVotes") or {}).get("organe") or {}).get("groupes", {}).get("groupe"))
        # Open data : parfois la réf d'un groupe est remplacée par « PO0 ». Si une seule est
        # corrompue et qu'il manque exactement un groupe canonique, c'est lui (récupération par
        # élimination) ; les scrutins où tous les groupes sont en PO0 restent indisponibles.
        present = set()
        po0_rows = []
        for g in groupes:
            ref = GROUP_ALIASES.get(g.get("organeRef") or "", g.get("organeRef") or "")
            if (g.get("organeRef") or "") == "PO0":
                po0_rows.append(g)
            elif ref in CANON_REFS:
                present.add(ref)
        recovery: dict[int, str] = {}
        if len(po0_rows) == 1:
            missing = CANON_REFS - present
            if len(missing) == 1:
                recovery[id(po0_rows[0])] = missing.pop()
        valides = len(present | set(recovery.values()))
        conn.execute(
            "INSERT INTO scrutins VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                s["uid"], to_int(s.get("numero")), str(s.get("legislature") or ""), s.get("dateScrutin"),
                s.get("sessionRef"), s.get("seanceRef"),
                ((s.get("typeVote") or {}).get("codeTypeVote")), ((s.get("typeVote") or {}).get("libelleTypeVote")),
                ((s.get("sort") or {}).get("code")), ((s.get("sort") or {}).get("libelle")),
                ((s.get("typeVote") or {}).get("typeMajorite")),
                s.get("titre"), ((s.get("demandeur") or {}).get("texte")),
                ((s.get("objet") or {}).get("libelle")), officiel_ref,
                (((s.get("objet") or {}).get("dossierLegislatif")) or {}).get("libelle"),
                dossier_ref, appariement, theme, theme_source,
                s.get("modePublicationDesVotes"),
                to_int(synthese.get("nombreVotants")), to_int(synthese.get("suffragesExprimes")),
                to_int(synthese.get("nbrSuffragesRequis")), synthese.get("annonce"),
                to_int(decompte.get("pour")), to_int(decompte.get("contre")),
                to_int(decompte.get("abstentions")), to_int(decompte.get("nonVotants")),
                to_int(decompte.get("nonVotantsVolontaires")), valides,
                f"https://www.assemblee-nationale.fr/dyn/17/scrutins/{to_int(s.get('numero'))}",
            ),
        )
        for g in groupes:
            raw_ref = recovery.get(id(g)) or (g.get("organeRef") or "")
            canon = GROUP_ALIASES.get(raw_ref, raw_ref)
            canon = SIGLE_BY_REF.get(canon) if canon in CANON_REFS else None
            vote = g.get("vote") or {}
            dc = vote.get("decompteVoix") or {}
            p, c, a = to_int(dc.get("pour")), to_int(dc.get("contre")), to_int(dc.get("abstentions"))
            members = to_int(g.get("nombreMembresGroupe"))
            position = position_from_counts(p, c, a)
            participation = min(1.0, (p + c + a) / members) if members > 0 else 0.0
            conn.execute(
                "INSERT INTO scrutin_groupes VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    s["uid"], raw_ref, canon, members, vote.get("positionMajoritaire"),
                    p, c, a, to_int(dc.get("nonVotants")), to_int(dc.get("nonVotantsVolontaires")),
                    position, participation,
                ),
            )
            nominatif = vote.get("decompteNominatif") or {}
            for position_name, key in (("pour", "pours"), ("contre", "contres"),
                                       ("abstention", "abstentions"), ("non_votant", "nonVotants")):
                for votant in as_list((nominatif.get(key) or {}).get("votant")):
                    votes_rows.append(
                        (s["uid"], votant.get("acteurRef"), votant.get("mandatRef"), raw_ref,
                         position_name, 1 if votant.get("parDelegation") == "true" else 0)
                    )
        if len(votes_rows) > 200000:
            conn.executemany("INSERT INTO scrutin_votes VALUES (?,?,?,?,?,?)", votes_rows)
            votes_rows.clear()
    conn.executemany("INSERT INTO scrutin_votes VALUES (?,?,?,?,?,?)", votes_rows)

    stats.update(
        scrutins=n,
        appariement_officiel=appariements.get("officiel", 0),
        appariement_titre=appariements.get("titre", 0),
        appariement_inclusion=appariements.get("inclusion", 0),
        appariement_document=appariements.get("document", 0),
        appariement_aucun=appariements.get("", 0),
        theme_senat_url=theme_sources.get("senat_url", 0),
        theme_senat_titre=theme_sources.get("senat_titre", 0),
        theme_aucun=theme_sources.get("", 0),
    )
    return stats


def main() -> int:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Construction dans un fichier temporaire : une source corrompue ne détruit pas la base existante.
    tmp_path = DB_PATH.with_suffix(".building")
    if tmp_path.exists():
        tmp_path.unlink()
    conn = sqlite3.connect(tmp_path)
    try:
        stats = build(conn)
        votes = conn.execute("SELECT COUNT(*) FROM scrutin_votes").fetchone()[0]
        cells = conn.execute("SELECT COUNT(*) FROM scrutin_groupes").fetchone()[0]
        stats["votes_individuels"] = votes
        stats["cellules_groupes"] = cells
        conn.executemany(
            "INSERT INTO meta VALUES (?,?)",
            [(k, str(v)) for k, v in stats.items()]
            + [("built_at", datetime.now(timezone.utc).isoformat(timespec="seconds")),
               ("db_version", "1")],
        )
        conn.commit()
    except BaseException:
        conn.close()
        tmp_path.unlink(missing_ok=True)
        raise
    conn.close()
    tmp_path.replace(DB_PATH)
    print(json.dumps(stats, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
