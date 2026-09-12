"""Tests des règles d'ingestion (parsing, positions, appariements)."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

import build_db  # noqa: E402


class TestPositions(unittest.TestCase):
    def test_majorite_stricte(self):
        self.assertEqual(build_db.position_from_counts(10, 2, 1), "pour")
        self.assertEqual(build_db.position_from_counts(0, 7, 0), "contre")
        self.assertEqual(build_db.position_from_counts(2, 2, 5), "abstention")

    def test_egalites_et_absences(self):
        self.assertIsNone(build_db.position_from_counts(5, 5, 0))
        self.assertIsNone(build_db.position_from_counts(1, 1, 1))
        self.assertIsNone(build_db.position_from_counts(0, 0, 0))


class TestNormalisation(unittest.TestCase):
    def test_accents_et_ponctuation(self):
        self.assertEqual(build_db.norm("Économie et finances, fiscalité"), "economie et finances fiscalite")
        self.assertEqual(build_db.norm("l'aide à mourir"), "l aide a mourir")

    def test_extraction_du_texte(self):
        key = build_db.extract_text_key(
            "l'amendement n° 12 de M. X à l'article premier du projet de loi de simplification "
            "de la vie économique (première lecture)."
        )
        self.assertTrue(key.startswith("projet de loi de simplification de la vie economique"))
        key2 = build_db.extract_text_key(
            "l'article 19 bis de la proposition de loi relative au droit à l'aide à mourir "
            "(deuxième lecture)."
        )
        self.assertTrue(key2.startswith("proposition de loi relative au droit a l aide a mourir"))

    def test_as_list(self):
        self.assertEqual(build_db.as_list(None), [])
        self.assertEqual(build_db.as_list({"a": 1}), [{"a": 1}])
        self.assertEqual(build_db.as_list([1, 2]), [1, 2])


class TestAppariements(unittest.TestCase):
    def setUp(self):
        self.dossiers = {
            "DLR1": {"uid": "DLR1", "legislature": "17", "titre": "Projet de loi de simplification",
                     "senat_chemin": "http://www.senat.fr/dossier-legislatif/pjl25-001.html"},
            "DLR2": {"uid": "DLR2", "legislature": "17", "titre": "Proposition de loi santé",
                     "senat_chemin": None},
        }
        self.title_index = {
            build_db.norm("Projet de loi de simplification"): "DLR1",
            build_db.norm("Proposition de loi santé"): "DLR2",
        }
        self.doc_titles = {build_db.norm("Texte de la commission sur la proposition de loi santé"): ["DLR2"]}
        self.by_url = {"http://www.senat.fr/dossier-legislatif/pjl25-001.html": "Budget"}
        self.by_title = {}

    def test_appariement_titre_exact(self):
        ref, how = build_db.match_dossier(
            "l'amendement n° 3 à l'article 2 du projet de loi de simplification (première lecture).",
            self.dossiers, self.title_index, self.doc_titles)
        self.assertEqual((ref, how), ("DLR1", "titre"))

    def test_appariement_document(self):
        ref, how = build_db.match_dossier(
            "l'amendement n° 4 à l'article 1er de la proposition de loi santé (première lecture).",
            self.dossiers, {"dlr1-kept": "DLR1"}, self.doc_titles)
        self.assertEqual((ref, how), ("DLR2", "document"))

    def test_aucun_appariement(self):
        ref, how = build_db.match_dossier(
            "la motion de censure déposée en application de l'article 49.",
            self.dossiers, self.title_index, self.doc_titles)
        self.assertEqual((ref, how), (None, ""))

    def test_appariement_inclusion(self):
        # Le titre du dossier (plus court, ≥ 20 caractères) est contenu dans le titre extrait.
        ref, how = build_db.match_dossier(
            "l'article 4 du projet de loi de simplification de la vie économique et des démarches "
            "administratives (première lecture).",
            self.dossiers,
            {build_db.norm("projet de loi de simplification de la vie economique"): "DLR1"},
            {},
        )
        self.assertEqual((ref, how), ("DLR1", "inclusion"))

    def test_theme_par_url_senat(self):
        theme, source = build_db.resolve_theme("DLR1", self.dossiers, self.by_url, self.by_title)
        self.assertEqual((theme, source), ("Budget", "senat_url"))

    def test_theme_absent(self):
        theme, source = build_db.resolve_theme("DLR2", self.dossiers, self.by_url, self.by_title)
        self.assertEqual((theme, source), ("", ""))


class TestThemesSenat(unittest.TestCase):
    def test_premier_theme_et_ignorés(self):
        csv = (
            "Titre;URL du dossier;Thèmes\n"
            "Loi test;http://www.senat.fr/dossier-legislatif/x.html;Budget, Économie et finances, fiscalité\n"
            "Sans thème;http://www.senat.fr/dossier-legislatif/y.html;\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp)
            (raw / "senat_dossiers.csv").write_bytes(csv.encode("cp1252"))
            with mock.patch.object(build_db, "RAW", raw):
                by_url, by_title = build_db.load_senat_themes()
        # Un seul thème retenu : le premier de la liste officielle du Sénat.
        self.assertEqual(by_url["http://www.senat.fr/dossier-legislatif/x.html"], "Budget")
        self.assertNotIn("http://www.senat.fr/dossier-legislatif/y.html", by_url)
        self.assertEqual(by_title[build_db.norm("Loi test")], "Budget")


if __name__ == "__main__":
    unittest.main()
