"""Tests de la décision de reconstruction de run_all (sans exécuter le pipeline)."""

import sys
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
