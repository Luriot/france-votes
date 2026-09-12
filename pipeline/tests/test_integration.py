"""Tests d'intégration : base réelle, cohérence des exports du site.

Ces tests sont ignorés si la base n'a pas encore été construite.
"""

import json
import sqlite3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

import score  # noqa: E402

DB = ROOT / "data" / "france-votes.db"
SITE_DATA = ROOT / "site" / "data"
SIGLES = [s for _, s, _ in score.CANON_GROUPS]


@unittest.skipUnless(DB.exists(), "base absente : lancer pipeline/build_db.py")
class TestBaseReelle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.conn = sqlite3.connect(DB)

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def test_volume(self):
        count = self.conn.execute("SELECT COUNT(*) FROM scrutins").fetchone()[0]
        self.assertGreaterEqual(count, 8000)
        cells = self.conn.execute("SELECT COUNT(*) FROM scrutin_groupes").fetchone()[0]
        self.assertEqual(cells % count, 0)
        self.assertEqual(cells // count, 12)

    def test_types_connus(self):
        rows = {r[0] for r in self.conn.execute("SELECT DISTINCT type_code FROM scrutins")}
        self.assertTrue(rows <= {"SPO", "SPS", "MOC"})

    def test_positions_valides(self):
        rows = {r[0] for r in self.conn.execute("SELECT DISTINCT position_calculee FROM scrutin_groupes")}
        self.assertTrue(rows <= {"pour", "contre", "abstention", None})

    def test_groupes_canoniques(self):
        rows = {r[0] for r in self.conn.execute(
            "SELECT DISTINCT groupe_canonique FROM scrutin_groupes WHERE groupe_canonique IS NOT NULL")}
        self.assertEqual(rows, set(SIGLES))

    def test_alias_udr_appliques(self):
        # Règle AGENTS.md : UDR = fusion PO845520/PO847173/PO872880 (renommages, pas scission).
        count = self.conn.execute(
            "SELECT COUNT(*) FROM scrutin_groupes WHERE groupe_ref IN ('PO872880','PO845520') "
            "AND groupe_canonique='UDR'").fetchone()[0]
        self.assertGreater(count, 3000)

    def test_scrutin_218_conforme_page_officielle(self):
        row = self.conn.execute(
            "SELECT pour, contre, abstentions, non_votants FROM scrutins WHERE numero=218").fetchone()
        self.assertEqual(tuple(row), (186, 144, 6, 2))
        rn = self.conn.execute(
            "SELECT contre FROM scrutin_groupes WHERE scrutin_uid='VTANR5L17V218' AND groupe_canonique='RN'").fetchone()
        self.assertEqual(rn[0], 121)
        epr = self.conn.execute(
            "SELECT pour FROM scrutin_groupes WHERE scrutin_uid='VTANR5L17V218' AND groupe_canonique='EPR'").fetchone()
        self.assertEqual(epr[0], 44)

    def test_votes_individuels_coherents(self):
        row = self.conn.execute(
            "SELECT COUNT(*) FROM scrutin_votes WHERE scrutin_uid='VTANR5L17V218' "
            "AND groupe_ref='PO845401' AND position='contre'").fetchone()
        self.assertEqual(row[0], 121)

    def test_couverture_theme(self):
        total = self.conn.execute("SELECT COUNT(*) FROM scrutins").fetchone()[0]
        themed = self.conn.execute(
            "SELECT COUNT(*) FROM scrutins WHERE theme IS NOT NULL AND theme <> ''").fetchone()[0]
        self.assertGreater(themed / total, 0.85)

    def test_appariement_raisonnable(self):
        aucun = self.conn.execute("SELECT COUNT(*) FROM scrutins WHERE appariement=''").fetchone()[0]
        self.assertLess(aucun, 1000)


@unittest.skipUnless((SITE_DATA / "agreement.json").exists(), "exports absents : lancer pipeline/score.py")
class TestExports(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.agreement = json.loads((SITE_DATA / "agreement.json").read_text(encoding="utf-8"))
        cls.scrutins = json.loads((SITE_DATA / "scrutins.json").read_text(encoding="utf-8"))
        cls.meta = json.loads((SITE_DATA / "meta.json").read_text(encoding="utf-8"))

    def test_meta_coherent(self):
        self.assertEqual(len(self.meta["groupes"]), 12)
        self.assertEqual(self.meta["compteurs"]["scrutins"], len(self.scrutins))
        self.assertEqual(
            self.meta["compteurs"]["scrutins_retenus"] + self.meta["compteurs"]["doublons"],
            self.meta["compteurs"]["scrutins"])

    def test_scrutins_exportes(self):
        for s in self.scrutins[:50] + self.scrutins[-50:]:
            self.assertEqual(len(s["p"]), 12)
            self.assertEqual(len(s["q"]), 12)
            self.assertIn(s["b"], (0, 1))
            self.assertIn(s["r"], (None, "adopté", "rejeté"))
            self.assertIsInstance(s["m"], int)
            self.assertTrue(all(0 <= index < 12 for index in s["pv"]))
            self.assertIsInstance(s["th"], str)
            self.assertIsInstance(s["ti"], str)
            self.assertIsInstance(s["d"], str)
            self.assertIsInstance(s["f"], (int, float))
            self.assertIn(s["ind"], (0, 1))
            self.assertTrue(s["dup"] is None or isinstance(s["dup"], str))

    def test_traits_groupes(self):
        for groupe in self.meta["groupes"]:
            self.assertGreater(groupe["membres"], 0)
            self.assertGreater(groupe["cohesion"], 0)
            self.assertLessEqual(groupe["cohesion"], 100)

    def test_pivots_et_marge_coherents(self):
        # Vérification indépendante de l'export m/pv : on recalcule les basculements depuis la base.
        conn = sqlite3.connect(DB)
        try:
            total = conn.execute("SELECT pour, contre FROM scrutins WHERE numero=218").fetchone()
            groups = conn.execute(
                "SELECT groupe_canonique, pour, contre FROM scrutin_groupes "
                "WHERE scrutin_uid='VTANR5L17V218' AND groupe_canonique IS NOT NULL"
            ).fetchall()
        finally:
            conn.close()
        adopted = total[0] > total[1]
        expected = sorted(
            sigle for sigle, pour, contre in groups
            if ((total[0] - pour + contre) > (total[1] - contre + pour)) != adopted
        )
        row = next(s for s in self.scrutins if s["n"] == 218)
        self.assertEqual(row["m"], total[0] - total[1])
        self.assertEqual(sorted(SIGLES[index] for index in row["pv"]), expected)

    def test_recalcul_identique_au_pipeline(self):
        conn = sqlite3.connect(DB)
        try:
            scrutins = score.load_scrutins(conn)
        finally:
            conn.close()
        score.deduplicate(scrutins)
        score.apply_theme_cap(scrutins)
        for key in ("RN|LFI-NFP", "EPR|DEM", "ECOS|UDR"):
            a, b = key.split("|")
            recomputed = score.pair_stats(scrutins, a, b)["accord"]
            exported = self.agreement["principal"][key]["accord"]
            self.assertAlmostEqual(recomputed, exported, places=5)

    def test_mds(self):
        self.assertEqual(len(self.agreement["mds"]), 12)

    def test_questionnaire_essentiel(self):
        data = json.loads((SITE_DATA / "questionnaire.json").read_text(encoding="utf-8"))
        self.assertEqual(data["version"], 4)
        self.assertGreater(len(data["families"]), 20)
        for famille in data["families"]:
            self.assertTrue(famille["label"].startswith("Faut-il"))
            self.assertTrue(famille["votes"])
            for vote in famille["votes"]:
                self.assertIn(vote["dir"], (1, -1))
                self.assertTrue(1 <= vote["n"])


if __name__ == "__main__":
    unittest.main()
