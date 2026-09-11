"""Tests des calculs de scores, pondérations et robustesse."""

import itertools
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

import score  # noqa: E402

_counter = itertools.count(1)


def make_scrutin(positions, parts=None, theme="T", base=1.0, factor=1.0):
    return {
        "uid": f"TEST{next(_counter):04d}",
        "positions": positions,
        "parts": parts or {sigle: 1.0 for sigle in score.SIGLES},
        "theme": theme,
        "poids_base": base,
        "facteur_theme": factor,
        "groupes_valides": 12,
    }


class TestPonderation(unittest.TestCase):
    def test_schemes(self):
        s = make_scrutin({"RN": "pour", "EPR": "pour"}, parts={"RN": 0.5, "EPR": 1.0}, factor=0.2)
        self.assertAlmostEqual(score.weight(s, "RN", "EPR", "primary"), 0.5 * 0.2)
        self.assertAlmostEqual(score.weight(s, "RN", "EPR", "uniforme"), 1.0)
        self.assertAlmostEqual(score.weight(s, "RN", "EPR", "thematique"), 0.2)
        self.assertAlmostEqual(score.weight(s, "RN", "EPR", "participation"), 0.5)
        self.assertAlmostEqual(score.weight(s, "RN", "EPR", "no_dedup"), 0.5 * 0.2)

    def test_doublon_poids_nul(self):
        s = make_scrutin({"RN": "pour"}, base=0.0)
        self.assertEqual(score.weight(s, "RN", "EPR", "primary"), 0.0)


class TestScores(unittest.TestCase):
    def test_accord_et_absent(self):
        scrutins = [
            make_scrutin({"RN": "pour", "EPR": "pour"}),
            make_scrutin({"RN": "pour", "EPR": "contre"}),
            make_scrutin({"RN": "pour", "EPR": None}),
        ]
        stat = score.pair_stats(scrutins, "RN", "EPR")
        self.assertEqual(stat["n"], 2)
        self.assertAlmostEqual(stat["accord"], 0.5)
        self.assertAlmostEqual(stat["poids"], 2.0)

    def test_participation_pondere(self):
        scrutins = [
            make_scrutin({"RN": "pour", "EPR": "pour"}, parts={"RN": 1.0, "EPR": 1.0}),
            make_scrutin({"RN": "pour", "EPR": "contre"}, parts={"RN": 0.1, "EPR": 0.1}),
        ]
        stat = score.pair_stats(scrutins, "RN", "EPR")
        self.assertAlmostEqual(stat["accord"], 1.0 / 1.1, places=6)

    def test_leave_one_theme_out(self):
        scrutins = [
            make_scrutin({"RN": "pour", "EPR": "pour"}, theme="X"),
            make_scrutin({"RN": "pour", "EPR": "contre"}, theme="Y"),
        ]
        entry = score.leave_one_theme_out(scrutins)["RN|EPR"]
        self.assertAlmostEqual(entry["min"], 0.0)
        self.assertAlmostEqual(entry["max"], 1.0)

    def test_kappa(self):
        self.assertAlmostEqual(score.cohen_kappa({"pour": 10}, {"pour": 10}, 10, 10), 1.0)
        counts_a, counts_b = {"pour": 5, "contre": 5}, {"pour": 5, "contre": 5}
        self.assertAlmostEqual(score.cohen_kappa(counts_a, counts_b, 10, 5), 0.0)

    def test_kappa_partiel(self):
        ca = {"pour": 6, "contre": 4}
        cb = {"pour": 6, "contre": 4}
        value = score.cohen_kappa(ca, cb, 10, 8)
        po, pe = 0.8, 0.6 ** 2 + 0.4 ** 2
        self.assertAlmostEqual(value, (po - pe) / (1 - pe))


class TestDedupEtPlafond(unittest.TestCase):
    def test_deduplication(self):
        scrutins = [
            make_scrutin({"RN": "pour", "EPR": "pour"}),
            make_scrutin({"RN": "pour", "EPR": "pour"}),
            make_scrutin({"RN": "contre", "EPR": "pour"}),
        ]
        score.deduplicate(scrutins)
        self.assertEqual(scrutins[0]["poids_base"], 1.0)
        self.assertEqual(scrutins[1]["poids_base"], 0.0)
        self.assertEqual(scrutins[1]["dup_of"], scrutins[0]["uid"] if "uid" in scrutins[0] else None)
        self.assertEqual(scrutins[2]["poids_base"], 1.0)

    def test_plafond_par_theme(self):
        scrutins = [make_scrutin({"RN": "pour"}, theme="Gros") for _ in range(99)]
        scrutins.append(make_scrutin({"RN": "pour"}, theme="Petit"))
        score.apply_theme_cap(scrutins)
        self.assertLess(scrutins[0]["facteur_theme"], 1.0)
        self.assertEqual(scrutins[-1]["facteur_theme"], 1.0)

    def test_seuil_participation(self):
        s = make_scrutin({"RN": "pour", "EPR": "pour"}, parts={"RN": 0.2, "EPR": 1.0})
        self.assertEqual(score.position_for(s, "RN", "seuil25"), None)
        self.assertEqual(score.position_for(s, "EPR", "seuil25"), "pour")
        self.assertEqual(score.position_for(s, "RN", "calculee"), "pour")


class TestMathematiques(unittest.TestCase):
    def test_jacobi(self):
        eigenvalues, vectors = score.jacobi_eigen([[2.0, 1.0], [1.0, 2.0]])
        order = sorted(range(2), key=lambda i: eigenvalues[i], reverse=True)
        self.assertAlmostEqual(eigenvalues[order[0]], 3.0, places=8)
        self.assertAlmostEqual(eigenvalues[order[1]], 1.0, places=8)
        v = [vectors[i][order[0]] for i in range(2)]
        self.assertAlmostEqual(abs(v[0]), abs(v[1]), places=8)

    def test_mds_points_identiques(self):
        pairs = {}
        for a, b in itertools.combinations(score.SIGLES, 2):
            pairs[f"{a}|{b}"] = {"accord": 1.0, "kappa": 1.0, "n": 10, "poids": 10.0}
        coords = score.mds_coordinates(pairs)
        for point in coords:
            self.assertAlmostEqual(point["x"], 0.0, places=6)
            self.assertAlmostEqual(point["y"], 0.0, places=6)

    def test_bootstrap_deterministe(self):
        scrutins = [
            make_scrutin({"RN": "pour", "EPR": "pour" if i % 2 == 0 else "contre"},
                         theme=f"T{i % 3}")
            for i in range(30)
        ]
        first = score.bootstrap(scrutins, iterations=15)
        second = score.bootstrap(scrutins, iterations=15)
        self.assertEqual(first, second)


class TestPivots(unittest.TestCase):
    def test_aucun_pivot(self):
        counts = {"RN": (5, 0), "LFI": (3, 0), "UDPLR": (1, 0)}
        marge, pivots = score.pivots_for(30, 10, counts)
        self.assertEqual(marge, 20)
        self.assertEqual(pivots, [])

    def test_pivot_detecte(self):
        # majorité de 3 voix : si le groupe de 4 bascule, le texte tombe.
        counts = {"EPR": (4, 0), "RN": (8, 8)}
        marge, pivots = score.pivots_for(15, 12, counts)
        self.assertEqual(marge, 3)
        self.assertEqual(pivots, ["EPR"])

    def test_pivot_egalite_non_decisif(self):
        counts = {"EPR": (2, 2)}
        marge, pivots = score.pivots_for(10, 8, counts)
        self.assertEqual(marge, 2)
        self.assertEqual(pivots, [])


if __name__ == "__main__":
    unittest.main()
