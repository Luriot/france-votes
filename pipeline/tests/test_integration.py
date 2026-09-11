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

    def test_questionnaire(self):
        data = json.loads((SITE_DATA / "questionnaire.json").read_text(encoding="utf-8"))
        self.assertGreater(len(data["questions"]), 20)
        for q in data["questions"]:
            self.assertEqual(len(q["positions"]), 12)
            self.assertTrue(1 <= q["numero"])


if __name__ == "__main__":
    unittest.main()
