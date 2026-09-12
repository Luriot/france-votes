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

    def test_participations_par_groupe(self):
        participe = make_scrutin({sigle: "pour" for sigle in score.SIGLES},
                                 parts={sigle: 0.5 for sigle in score.SIGLES})
        absent = make_scrutin({sigle: None for sigle in score.SIGLES})
        parts = score.group_participations([participe, absent])
        self.assertEqual(parts["RN"], 0.5, "moyenne sur les scrutins où la position est déterminée")
        self.assertIsNone(score.group_participations([absent])["RN"],
                          "aucune position déterminée → participation inconnue, pas 0")


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

    def test_position_officielle(self):
        s = make_scrutin({"RN": "pour"})
        s["positions_officielles"] = {"RN": "pour", "EPR": "abstention", "NI": "autre", "DEM": None}
        self.assertEqual(score.position_for(s, "RN", "officielle"), "pour")
        self.assertEqual(score.position_for(s, "EPR", "officielle"), "abstention")
        self.assertIsNone(score.position_for(s, "NI", "officielle"))
        self.assertIsNone(score.position_for(s, "DEM", "officielle"))

    def test_deduplicate_indisponible(self):
        s = make_scrutin({"RN": "pour"})
        s["groupes_valides"] = 0
        score.deduplicate([s])
        self.assertEqual(s["poids_base"], 0.0)
        self.assertTrue(s["indisponible"])
        self.assertIsNone(s["dup_of"])

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

    def test_pivot_motion_de_censure(self):
        # Seuil des membres : la marge est l'écart au seuil, pas pour − contre.
        marge, pivots = score.pivots_for(290, 0, {"RN": (20, 0)}, seuil=289)
        self.assertEqual(marge, 1)
        self.assertEqual(pivots, ["RN"])
        marge, pivots = score.pivots_for(320, 0, {"RN": (20, 0)}, seuil=289)
        self.assertEqual(marge, 31)
        self.assertEqual(pivots, [])


class TestAllPairs(unittest.TestCase):
    def test_cles_canoniques(self):
        scrutins = [make_scrutin({"RN": "pour", "EPR": "pour", "NI": "contre"})]
        pairs = score.all_pairs(scrutins)
        self.assertEqual(len(pairs), 66)
        self.assertIn("RN|EPR", pairs)
        self.assertNotIn("EPR|RN", pairs, "les clés suivent l'ordre canonique, jamais l'alphabétique")
        self.assertIn("UDR|NI", pairs)


class TestFamillesEssentielles(unittest.TestCase):
    def test_extraction_du_texte(self):
        self.assertEqual(
            score.title_family("l'ensemble du projet de loi de finances pour 2026 (première lecture)."),
            ("projet de loi", "projet de loi de finances pour 2026"))
        self.assertEqual(
            score.title_family("l’ensemble de la proposition de loi relative au droit à l’aide à mourir (deuxième lecture)."),
            ("proposition de loi", "proposition de loi relative au droit à l'aide à mourir"))
        self.assertEqual(
            score.title_family("l'ensemble de la proposition de résolution tendant à créer une commission d'enquête (texte de la CMP)."),
            ("proposition de résolution", "proposition de résolution tendant à créer une commission d'enquête"))
        self.assertIsNone(score.title_family("l'amendement n° 5 à l'article premier du projet de loi X (première lecture)."))

    def test_gabarit_de_question(self):
        self.assertEqual(score.statement("projet de loi", "projet de loi de finances pour 2026"),
                         "Faut-il adopter le projet de loi de finances pour 2026 ?")
        self.assertEqual(score.statement("proposition de loi", "proposition de loi relative à l'aide à mourir"),
                         "Faut-il adopter la proposition de loi relative à l'aide à mourir ?")

    def test_cas_particuliers_open_data(self):
        # Article redoublé dans le titre source (« de de la ») et vote par partie de texte.
        self.assertEqual(
            score.title_family("l'ensemble de de la proposition de loi instaurant des réponses (première lecture)."),
            ("proposition de loi", "proposition de loi instaurant des réponses"))
        self.assertEqual(
            score.title_family("l'ensemble de la deuxième partie du projet de loi de finances pour 2026 (première lecture)."),
            ("projet de loi", "deuxième partie du projet de loi de finances pour 2026"))
        self.assertEqual(score.statement("projet de loi", "deuxième partie du projet de loi de finances pour 2026"),
                         "Faut-il adopter la deuxième partie du projet de loi de finances pour 2026 ?")

    def _ensemble(self, uid, numero, date, titre, theme="Budget", positions=None, base=1.0, dossier=None):
        s = make_scrutin(positions or {sigle: ("pour" if i < 6 else "contre")
                                       for i, sigle in enumerate(score.SIGLES)}, theme=theme, base=base)
        s.update({"uid": uid, "numero": numero, "date": date, "titre": titre, "dossier": dossier})
        return s

    def test_orientation_par_correlation(self):
        anchor = make_scrutin({sigle: ("pour" if i < 6 else "contre") for i, sigle in enumerate(score.SIGLES)})
        proche = {sigle: ("contre" if i in (0, 1) else "pour" if i < 6 else "contre")
                  for i, sigle in enumerate(score.SIGLES)}
        inverse = {sigle: ("contre" if i < 6 else "pour") for i, sigle in enumerate(score.SIGLES)}
        flou = {sigle: ("contre" if i < 3 or 6 <= i < 9 else "pour") for i, sigle in enumerate(score.SIGLES)}
        self.assertEqual(score.orientation({"positions": proche}, anchor["positions"]), 1)
        self.assertEqual(score.orientation({"positions": inverse}, anchor["positions"]), -1)
        self.assertIsNone(score.orientation({"positions": flou}, anchor["positions"]),
                          "corrélation quasi nulle → orientation indéterminée")

    def test_famille_agrege_les_votes_du_dossier(self):
        base = {sigle: ("pour" if i < 6 else "contre") for i, sigle in enumerate(score.SIGLES)}
        proche = {sigle: ("contre" if i in (0, 1) else "pour" if i < 6 else "contre")
                  for i, sigle in enumerate(score.SIGLES)}
        inverse = {sigle: ("contre" if i < 6 else "pour") for i, sigle in enumerate(score.SIGLES)}
        scrutin = self._ensemble("A1", 1, "2025-01-01", "l'ensemble du projet de loi Test (première lecture).",
                                 positions=base, dossier="DLR1")
        amendement_pro = self._ensemble("A2", 2, "2025-01-02", "l'amendement n° 1 à l'article premier du projet de loi Test.",
                                        positions=proche, dossier="DLR1")
        amendement_anti = self._ensemble("A3", 3, "2025-01-03", "l'amendement n° 2 de suppression à l'article 2 du projet de loi Test.",
                                         positions=inverse, dossier="DLR1")
        sans_lien = self._ensemble("A4", 4, "2025-01-04", "le sous-amendement n° 3 à l'amendement n° 2.",
                                   positions=inverse, dossier="DLR2")
        familles = score.questionnaire_families([scrutin, amendement_pro, amendement_anti, sans_lien])
        famille = next(f for f in familles if f["id"] == "dlr:DLR1")
        votes = {vote["u"]: vote["dir"] for vote in famille["votes"]}
        self.assertEqual(votes, {"A1": 1, "A2": 1, "A3": -1})
        self.assertEqual(famille["anchor"], "A1", "l'ancre est le vote de passage du texte")
        self.assertEqual(len(familles), 1, "un dossier sans vote de passage ne donne pas de question essentielle")

    def test_familles_et_plafond(self):
        serre = {sigle: ("pour" if i < 6 else "contre") for i, sigle in enumerate(score.SIGLES)}
        tranche = {sigle: ("pour" if i < 9 else "contre") for i, sigle in enumerate(score.SIGLES)}
        scrutins = [
            self._ensemble("U1", 10, "2025-01-01", "l'ensemble du projet de loi A (première lecture).", positions=serre),
            self._ensemble("U2", 11, "2025-06-01", "l'ensemble du projet de loi A (nouvelle lecture).", positions=tranche),
            self._ensemble("U3", 12, "2025-07-01", "l'ensemble du projet de loi A (lecture définitive).", positions=serre),
            self._ensemble("U4", 13, "2025-02-01", "l'ensemble du projet de loi B (première lecture).", positions=tranche),
            self._ensemble("U5", 14, "2025-03-01", "l'ensemble du projet de loi C (première lecture).", positions=tranche),
            self._ensemble("U6", 15, "2025-04-01", "l'ensemble du projet de loi D (première lecture).", positions=tranche),
            self._ensemble("U7", 16, "2025-05-01", "l'ensemble du projet de loi E (première lecture).", theme="Non classé"),
        ]
        doublon_corpus = self._ensemble("U8", 17, "2025-05-02", "l'ensemble du projet de loi F (première lecture).",
                                        positions=tranche, base=0.0)
        indisponible = self._ensemble("U9", 18, "2025-05-03", "l'ensemble du projet de loi G (première lecture).")
        indisponible["indisponible"] = True
        scrutins += [doublon_corpus, indisponible]

        familles = score.questionnaire_families(scrutins)
        ids = {famille["id"] for famille in familles}
        famille_a = next(f for f in familles if f["label"] == "Faut-il adopter le projet de loi A ?")
        # U3 a le même vecteur que U1 : neutralisé à l'intérieur de la famille.
        self.assertEqual([vote["u"] for vote in famille_a["votes"]], ["U1", "U2"])
        self.assertEqual(famille_a["votes"][0]["dir"], 1)
        self.assertIn("titre:projet de loi f", ids, "un doublon de corpus reste un vote de passage valable")
        self.assertNotIn("titre:projet de loi e", ids, "« Non classé » exclu")
        self.assertNotIn("titre:projet de loi g", ids, "scrutin indisponible exclu")
        self.assertEqual(len(familles), 3, "plafond de 3 familles pour le thème Budget")

    def test_ancre_jamais_neutralisee(self):
        base = {sigle: ("pour" if i < 6 else "contre") for i, sigle in enumerate(score.SIGLES)}
        avant = self._ensemble("B1", 1, "2025-01-01", "l'amendement n° 1 au projet de loi Test.",
                               positions=base, dossier="DLR2")
        passage = self._ensemble("B2", 2, "2025-01-02", "l'ensemble du projet de loi Test (première lecture).",
                                 positions=base, dossier="DLR2")
        familles = score.questionnaire_families([avant, passage])
        famille = next(f for f in familles if f["id"] == "dlr:DLR2")
        self.assertEqual(famille["anchor"], "B2")
        self.assertIn("B2", [vote["u"] for vote in famille["votes"]],
                      "l'ancre reste dans la famille même si un vote antérieur a le même vecteur")

    def test_ancre_conservee_meme_si_correlation_faible(self):
        # Un vote de passage très abstentionniste : sa corrélation avec lui-même tombe sous 0,5.
        positions = {sigle: ("abstention" if i < 7 else "pour" if i < 10 else "contre")
                     for i, sigle in enumerate(score.SIGLES)}
        passage = self._ensemble("C1", 1, "2025-01-01",
                                 "l'ensemble du projet de loi Test (première lecture).",
                                 positions=positions, dossier="DLR3")
        familles = score.questionnaire_families([passage])
        famille = next(f for f in familles if f["id"] == "dlr:DLR3")
        votes = {vote["u"]: vote["dir"] for vote in famille["votes"]}
        self.assertEqual(votes.get("C1"), 1,
                         "l'ancre reste, orientée +1, même si le vote est très abstentionniste")
        self.assertEqual(famille["anchor"], "C1")

    def test_motion_de_censure_ordre_canonique(self):
        # L'ordre des positions issues de la base n'est pas garanti : le recodage suit SIGLES.
        positions = {sigle: ("pour" if i % 2 == 0 else "non_votant")
                     for i, sigle in enumerate(reversed(score.SIGLES))}
        moc = self._ensemble("M2", 30, "2025-10-20",
                             "la motion de censure déposée en application de l'article 49, alinéa 2, "
                             "de la Constitution par Mme X et 58 députés.",
                             theme="Non classé", positions=positions)
        famille = score.questionnaire_families([moc])[0]
        attendu = [1 if positions[sigle] == "pour" else -1 for sigle in score.SIGLES]
        self.assertEqual(famille["votes"][0]["p"], attendu,
                         "le recodage d'une motion doit être aligné sur l'ordre canonique des groupes")

    def test_motions_de_censure(self):
        # Seuls les votes favorables sont recensés par l'AN : les groupes absents sont encodés
        # « ne soutient pas » (p = -1) pour que la question soit comptable.
        positions = {sigle: ("pour" if i < 6 else None) for i, sigle in enumerate(score.SIGLES)}
        moc = self._ensemble("M1", 20, "2025-10-16",
                             "la motion de censure déposée en application de l'article 49, alinéa 2, "
                             "de la Constitution par Mme X et 58 députés.",
                             theme="Non classé", positions=positions)
        familles = score.questionnaire_families([moc])
        self.assertEqual(len(familles), 1)
        famille = familles[0]
        self.assertEqual(famille["id"], "moc:M1")
        self.assertEqual(famille["theme"], "Motions de censure")
        self.assertIn("censurer", famille["label"])
        self.assertEqual(famille["anchor"], "M1", "l'ancre d'une motion de censure est la motion elle-même")
        codes = famille["votes"][0]["p"]
        self.assertEqual(len(codes), len(score.SIGLES))
        self.assertEqual(sorted(set(codes)), [-1, 1])
        self.assertEqual(sum(1 for code in codes if code == 1), 6)


if __name__ == "__main__":
    unittest.main()
