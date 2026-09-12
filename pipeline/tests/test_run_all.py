"""Tests de la décision de reconstruction de run_all (sans exécuter le pipeline)."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

import run_all  # noqa: E402


class TestRebuildDecision(unittest.TestCase):
    DB = {"scrutins": 8434, "dernier_numero": 4954, "derniere_date": "2026-09-12"}

    def test_skip_si_tout_est_a_jour(self):
        self.assertFalse(run_all.rebuild_needed(changed=False, force=False, db=self.DB, exports=True))

    def test_rebuild_si_changement_distant_ou_force(self):
        self.assertTrue(run_all.rebuild_needed(changed=True, force=False, db=self.DB, exports=True))
        self.assertTrue(run_all.rebuild_needed(changed=False, force=True, db=self.DB, exports=True))

    def test_rebuild_si_base_ou_exports_manquants(self):
        self.assertTrue(run_all.rebuild_needed(changed=False, force=False, db=None, exports=True))
        self.assertTrue(run_all.rebuild_needed(changed=False, force=False, db=self.DB, exports=False))

    def test_rebuild_si_code_modifie(self):
        self.assertFalse(run_all.rebuild_needed(changed=False, force=False, db=self.DB,
                                                exports=True, code_changed=False))
        self.assertTrue(run_all.rebuild_needed(changed=False, force=False, db=self.DB,
                                               exports=True, code_changed=True))

    def test_rebuild_si_sources_plus_recentes_que_la_reconstruction(self):
        self.assertFalse(run_all.rebuild_needed(changed=False, force=False, db=self.DB,
                                                exports=True, sources_changed=False))
        self.assertTrue(run_all.rebuild_needed(changed=False, force=False, db=self.DB,
                                               exports=True, sources_changed=True))

    def test_empreinte_stable_et_sensible(self):
        first = run_all.code_fingerprint()
        self.assertEqual(first, run_all.code_fingerprint())
        self.assertEqual(len(first), 16)
        with tempfile.TemporaryDirectory() as tmp:
            pipeline = Path(tmp)
            (pipeline / "a.py").write_text("A = 1\n", encoding="utf-8")
            with mock.patch.object(run_all, "PIPELINE", pipeline):
                before = run_all.code_fingerprint()
                (pipeline / "a.py").write_text("A = 2\n", encoding="utf-8")
                self.assertNotEqual(before, run_all.code_fingerprint(),
                                    "modifier un fichier du pipeline change l'empreinte")

    def test_marqueur_absent_ou_corrompu(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp) / "marqueur.json"
            with mock.patch.object(run_all, "MARKER", marker):
                self.assertEqual(run_all.previous_marker(), {}, "marqueur absent")
                for content in ("{", "null", "[]", '"x"'):
                    marker.write_text(content, encoding="utf-8")
                    self.assertEqual(run_all.previous_marker(), {}, f"contenu {content!r}")
                marker.write_bytes(b"\xff\xfe{")  # octets non UTF-8
                self.assertEqual(run_all.previous_marker(), {}, "marqueur non UTF-8")
                marker.write_text('{"code": "abc"}', encoding="utf-8")
                self.assertEqual(run_all.previous_marker(), {"code": "abc"})

    def test_marqueur_enregistre_les_empreintes_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "manifest.json"
            manifest.write_text(json.dumps({"version": 1, "sources": [
                {"file": "a.zip", "sha256": "aaa"},
                {"file": "b.csv", "sha256": "bbb"},
            ]}), encoding="utf-8")
            with mock.patch.object(run_all.download, "MANIFEST", manifest):
                self.assertEqual(run_all.source_hashes(), {"a.zip": "aaa", "b.csv": "bbb"})
                marker = Path(tmp) / "marqueur.json"
                with mock.patch.object(run_all, "MARKER", marker):
                    run_all.write_marker({"changed": False, "sources": {}}, True, None, 0)
                    self.assertEqual(run_all.previous_marker()["sources_sha256"],
                                     {"a.zip": "aaa", "b.csv": "bbb"})

    def test_exports_doivent_etre_au_moins_aussi_recents_que_la_base(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "base.db"
            db.write_text("x", encoding="utf-8")
            data = Path(tmp) / "data"
            data.mkdir()
            with mock.patch.object(run_all, "DB_PATH", db), mock.patch.object(run_all, "SITE_DATA", data):
                for name in run_all.EXPORTS:
                    (data / name).write_text("{}", encoding="utf-8")
                self.assertTrue(run_all.exports_ok())
                # Un export plus ancien que la base = génération mixte → reconstruction.
                old = (data / run_all.EXPORTS[3])
                old.touch()
                os.utime(old, (db.stat().st_mtime - 10, db.stat().st_mtime - 10))
                self.assertFalse(run_all.exports_ok())
                old.unlink()
                self.assertFalse(run_all.exports_ok())


if __name__ == "__main__":
    unittest.main()
