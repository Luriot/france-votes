// Vérification du JavaScript du site contre les exports du pipeline.
// Usage : node pipeline/check_site.mjs
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const names = ["meta.json", "scrutins.json", "agreement.json", "questionnaire.json"];
const files = {};
for (const name of names) {
  files[name] = await readFile(new URL(`../site/data/${name}`, import.meta.url), "utf8");
}

globalThis.fetch = async (url) => {
  const name = url.replace(/^data\//, "");
  return {
    ok: name in files,
    json: async () => JSON.parse(files[name]),
  };
};
// Stubs DOM minimaux : app.js ajoute une classe à <html> et branche la signature visuelle.
globalThis.window = globalThis;
globalThis.matchMedia = () => ({ matches: true });
globalThis.document = {
  documentElement: { classList: { add() {} } },
  getElementById: () => null,
  addEventListener() {},
  querySelectorAll: () => [],
  createElement: () => ({
    classList: { add() {} }, style: {}, setAttribute() {}, append() {}, addEventListener() {},
  }),
  body: { append() {} },
};

const app = await readFile(new URL("../site/assets/app.js", import.meta.url), "utf8");
new vm.Script(`${app}\nglobalThis.VV = VV;`).runInThisContext();
await VV.loadAll();

let failures = 0;
function check(label, condition, detail = "") {
  console.log(`${condition ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures += 1;
}

check("meta.json : 12 groupes", VV.state.meta.groupes.length === 12);
check("scrutins.json : 12 positions par scrutin", VV.state.scrutins.every((s) => s.p.length === 12 && s.q.length === 12));

// Tous les accords des 66 paires, plus le kappa, doivent être recalculables côté navigateur.
const allPairs = VV.allPairs(VV.state.scrutins);
let accordOk = 0;
for (const [key, exported] of Object.entries(VV.state.agreement.principal)) {
  const [a, b] = key.split("|");
  const recomputed = VV.pairStats(VV.state.scrutins, a, b).accord;
  // tolérance 1e-4 : les participations exportées sont arrondies à 4 décimales.
  if (exported.accord === null || Math.abs(recomputed - exported.accord) < 1e-4) accordOk += 1;
}
check("accord recalculé sur les 66 paires", accordOk === 66, `${accordOk}/66`);
for (const key of ["RN|UDR", "ECOS|UDR", "RN|LFI-NFP"]) {
  const [a, b] = key.split("|");
  const recomputed = VV.kappa(VV.state.scrutins, a, b);
  const exported = VV.state.agreement.principal[key].kappa;
  check(`kappa ${key} recalculé côté navigateur`, Math.abs(recomputed - exported) < 1e-6,
    `JS=${recomputed.toFixed(6)} pipeline=${exported.toFixed(6)}`);
}

const scrutinsByUid = new Map(VV.state.scrutins.map((s) => [s.u, s]));
const sample = VV.state.scrutins.filter((s) => s.b === 1 && s.p.every((p) => p !== null));
check("au moins 100 votes entièrement déterminés", sample.length >= 100, `${sample.length}`);

// Les clés de paires doivent être identiques côté pipeline et côté navigateur.
for (const [a, b] of [["RN", "EPR"], ["RN", "LFI-NFP"], ["NI", "UDR"]]) {
  const key = VV.pairKey(a, b);
  check(`clé de paire ${key} présente`, key in allPairs);
  check(`clé de paire ${key} = export pipeline`, Boolean(VV.state.agreement.principal[key]));
}

const themes = new Set(VV.state.scrutins.map((s) => s.th));
check("thèmes exportés non vides", themes.size >= 20, `${themes.size} thèmes`);

const q = JSON.parse(files["questionnaire.json"]);
check("questionnaire v4 : familles essentielles", q.version === 4 && q.families.length >= 20, `${q.families?.length} familles`);
check("familles : votes existants dans scrutins.json",
  q.families.every((f) => f.votes.every((v) => scrutinsByUid.has(v.u))));
check("familles : directions ±1", q.families.every((f) => f.votes.every((v) => v.dir === 1 || v.dir === -1)));
const famPerTheme = {};
for (const f of q.families) famPerTheme[f.theme] = (famPerTheme[f.theme] || 0) + 1;
check("familles : plafond de 3 par thème", Object.values(famPerTheme).every((n) => n <= 3));
check("familles : libellés générés depuis les titres officiels",
  q.families.every((f) => f.label.startsWith("Faut-il")));
const mocs = q.families.filter((f) => f.kind === "motion de censure");
check("motions de censure encodées (±1, jamais nulles)",
  mocs.length >= 3 && mocs.every((f) => f.votes[0].p.every((p) => p === 1 || p === -1)));
const famVotes = q.families.reduce((acc, f) => acc + f.votes.length, 0);
check("familles : agrégation des votes des textes (> 500 votes)", famVotes > 500, `${famVotes} votes`);
check("marge exportée pour chaque scrutin", VV.state.scrutins.every((s) => Number.isInteger(s.m)));
check("pivots valides", VV.state.scrutins.every((s) => Array.isArray(s.pv) && s.pv.every((i) => i >= 0 && i < 12)));
check("effectifs et cohésion exportés",
  VV.state.meta.groupes.every((g) => g.membres > 0 && g.cohesion > 0 && g.cohesion <= 100));
const withAbst = VV.pairStats(VV.state.scrutins, "RN", "LFI-NFP");
const noAbst = VV.pairStats(VV.state.scrutins, "RN", "LFI-NFP", { excludeAbstention: true });
check("exclusion des abstentions recalcule", noAbst.n <= withAbst.n && typeof noAbst.accord === "number");

// Partage : encodage compact des réponses dans l'URL (index de famille + position).
const fakeFamilies = [{ id: "dlr:A" }, { id: "dlr:B" }, { id: "dlr:C" }];
const shareCode = VV.encodeAnswers(new Map([["f:dlr:A", 1], ["f:dlr:C", -1], ["u:x", 1]]), fakeFamilies);
check("encodage des réponses (familles seulement, index base36)", shareCode === "0p,2c", shareCode);
const shareDecoded = VV.decodeAnswers(shareCode, fakeFamilies);
check("décodage des réponses", shareDecoded.size === 2 && shareDecoded.get("f:dlr:A") === 1 && shareDecoded.get("f:dlr:C") === -1);
check("décodage robuste aux paramètres invalides", VV.decodeAnswers("9z,%,", fakeFamilies).size === 0);
const realFamilies = q.families;
const realSample = new Map([[`f:${realFamilies[0].id}`, 1], [`f:${realFamilies[realFamilies.length - 1].id}`, 0]]);
const realRound = VV.decodeAnswers(VV.encodeAnswers(realSample, realFamilies), realFamilies);
check("aller-retour sur les familles exportées",
  realRound.size === 2 && realRound.get(`f:${realFamilies[0].id}`) === 1
  && realRound.get(`f:${realFamilies[realFamilies.length - 1].id}`) === 0);

// Sécurité du rendu : les données dynamiques doivent être neutralisées avant injection dans le DOM.
const escaped = VV.esc('<img src=x onerror=alert(1)> "quotes" &');
check("esc neutralise les balises", !escaped.includes("<img") && escaped.includes("&lt;img"));
check("esc neutralise les guillemets", !escaped.includes('"') && escaped.includes("&quot;"));
check("safeColor accepte un hex valide", VV.safeColor("#4C78A8") === "#4C78A8");
check("safeColor rejette une valeur injectée",
  VV.safeColor('red; background:url("javascript:1")') === "#888888");
check("sourceUrl ne garde que les chiffres",
  VV.sourceUrl({ n: '12"><script>alert(1)</script>' }) === "https://www.assemblee-nationale.fr/dyn/17/scrutins/121");
check("stance résiste à une valeur inconnue", VV.stance("evil").includes("n.d."));
const chipHtml = VV.positionChips({ p: [1, -1, 0, null, 1, 1, 1, 1, 1, 1, 1, 1] });
check("pastilles de position : 12 groupes, classes colorées",
  (chipHtml.match(/pos-chip/g) || []).length === 12
  && chipHtml.includes("pos-contre") && chipHtml.includes("pos-absent"));
const chipDiverge = VV.positionChip(1, 'RN "x"', true);
check("positionChip : classe divergente et titre échappé",
  chipDiverge.includes("pos-pour") && chipDiverge.includes("diverge") && chipDiverge.includes("&quot;"));
const chipNull = VV.positionChip(null, "vide");
check("positionChip : position indéterminée sans divergence",
  chipNull.includes("pos-absent") && !chipNull.includes("diverge"));
const emptyBadge = VV.essentielBadge(null);
const escapedBadge = VV.essentielBadge({ id: 'a"b' });
check("essentielBadge : lien échappé et vide sans famille",
  emptyBadge === "" && VV.essentielBadge(undefined) === ""
  && escapedBadge.includes("questionnaire.html?affiner=a%22b"));

// Positions sur les questions essentielles (localité 12×54 du comparateur).
const stanceCodes = new Set([1, 0, -1, null]);
const famStances = q.families.map((f) => VV.familyStances(f, scrutinsByUid));
check("familles : ancre présente dans les votes", q.families.every((f) => f.votes.some((v) => v.u === f.anchor)));
check("familles : position de passage sur 12 groupes, codes valides",
  famStances.every((s) => s.passage.length === 12 && s.passage.every((p) => stanceCodes.has(p))));
check("motions de censure : position de passage ±1",
  q.families.filter((f) => f.kind === "motion de censure")
    .every((f) => VV.familyStances(f, scrutinsByUid).passage.every((p) => p === 1 || p === -1)));
check("motions : recodage aligné sur les positions canoniques",
  q.families.filter((f) => f.kind === "motion de censure").every((f) => {
    const s = scrutinsByUid.get(f.anchor);
    return f.votes[0].p.every((v, i) => (s.p[i] === 1 ? v === 1 : v === -1));
  }));
const voteCodes = new Set([1, 0, -1, null]);
check("familles : votes enrichis (ti, p, q, f)",
  q.families.every((f) => f.votes.every((v) =>
    typeof v.ti === "string" && v.ti.length > 0
    && Array.isArray(v.p) && v.p.length === 12 && v.p.every((x) => voteCodes.has(x))
    && Array.isArray(v.q) && v.q.length === 12 && v.q.every((x) => typeof x === "number" && x >= 0 && x <= 1)
    && typeof v.f === "number" && v.f >= 0 && v.f <= 1)));
check("familles : positions alignées sur scrutins.json (hors motions)",
  q.families.filter((f) => f.kind !== "motion de censure").every((f) => f.votes.every((v) => {
    const s = scrutinsByUid.get(v.u);
    return Boolean(s) && v.p.every((x, i) => x === s.p[i]);
  })));
const stanceDivergences = famStances.reduce((n, s) => n + s.divergences.filter(Boolean).length, 0);
console.log(`INFO positions essentielles : ${stanceDivergences} divergence(s) passage/majorité sur ${q.families.length} familles`);

// familyStances : égalité, contribution nulle, ancre hors votes (cas dégradés).
const fakeScrutins = new Map([
  ["V1", { u: "V1", p: [1, 1, null, ...new Array(9).fill(null)], q: new Array(12).fill(1) }],
  ["V2", { u: "V2", p: [-1, 1, null, ...new Array(9).fill(null)], q: new Array(12).fill(1) }],
]);
const fakeFamily = { id: "test", anchor: "V1", votes: [{ u: "V1", dir: 1 }, { u: "V2", dir: 1 }] };
const fakeStances = VV.familyStances(fakeFamily, fakeScrutins);
check("familyStances : égalité pour/contre → 0 (partagée)",
  fakeStances.majorite[0] === 0 && fakeStances.partagee[0] === true);
check("familyStances : majorité simple et aucune contribution",
  fakeStances.majorite[1] === 1 && fakeStances.partagee[1] === false && fakeStances.majorite[2] === null);
const ghostStances = VV.familyStances({ id: "ghost", anchor: "V1", votes: [{ u: "V2", dir: 1 }] }, fakeScrutins);
check("familyStances : ancre hors votes → position lue dans scrutins.json", ghostStances.passage[0] === 1);
const emptyStances = VV.familyStances({ id: "vide", anchor: "ZZ", votes: [] }, new Map());
check("familyStances : famille vide → aucun exception, tout indéterminé",
  emptyStances.passage.every((p) => p === null) && emptyStances.majorite.every((p) => p === null));

// Recherche et filtres de l'explorateur (helpers purs, état partageable).
check("matchesQuery : numéro (#), partiel, titre, sentinelle inerte",
  VV.matchesQuery({ n: 8432, ti: "la motion de rejet préalable" }, "8432")
  && VV.matchesQuery({ n: 8432, ti: "la motion de rejet préalable" }, "#8432")
  && VV.matchesQuery({ n: 8432, ti: "la motion de rejet préalable" }, "43")
  && !VV.matchesQuery({ n: 8432, ti: "projet de loi logement" }, "#99")
  && VV.matchesQuery({ n: 8432, ti: "projet de loi logement" }, "LOGEMENT")
  && !VV.matchesQuery({ n: 8432, ti: "projet de loi logement" }, "budget")
  && !VV.matchesQuery({ n: null, ti: "l'ensemble du texte" }, "1"));
const pad12 = (values) => [...values, ...new Array(Math.max(0, 12 - values.length)).fill(null)];
const fakeRows = [
  { u: "a", n: 8432, d: "2025-06-01", ti: "projet de loi logement", th: "Logement et urbanisme", t: "SPO", b: 1, m: 40, p: pad12([1]) },
  { u: "b", n: 8433, d: "2025-12-01", ti: "projet de loi budget", th: "Budget", t: "SPS", b: 0, m: 5, p: pad12([null, -1]) },
];
check("filterScrutins : thème, type, doublons",
  VV.filterScrutins(fakeRows, { theme: "Budget" }).length === 1
  && VV.filterScrutins(fakeRows, { type: "SPO" })[0].u === "a"
  && VV.filterScrutins(fakeRows, { doublons: "uniques" })[0].u === "a"
  && VV.filterScrutins(fakeRows, { doublons: "doublons" })[0].u === "b");
check("filterScrutins : essentiel, recherche par n°, position d'un groupe",
  VV.filterScrutins(fakeRows, { essentiel: "essentiel" }, new Set(["b"]))[0].u === "b"
  && VV.filterScrutins(fakeRows, { q: "8432" })[0].u === "a"
  && VV.filterScrutins(fakeRows, { groupe: "RN", position: "1" }).length === 1
  && VV.filterScrutins(fakeRows, { groupe: "RN", position: "1" })[0].u === "a");
check("filterScrutins : groupe sans position = positions déterminées",
  VV.filterScrutins(fakeRows, { groupe: "RN" }).length === 1
  && VV.filterScrutins(fakeRows, { groupe: "RN" })[0].u === "a"
  && VV.filterScrutins(fakeRows, { groupe: "EPR" })[0].u === "b"
  && VV.filterScrutins(fakeRows, { groupe: "RN", position: "x" }).length === 0);
check("voteQuery : ordre stable, valeurs vides ignorées, zéro conservé",
  VV.voteQuery({ theme: "Budget", q: "8432", tri: "" }) === "q=8432&theme=Budget"
  && VV.voteQuery({ position: 0 }) === "position=0"
  && VV.voteQuery({}) === "");
check("highlightSigs : sigles valides et uniques",
  VV.highlightSigs("RN", "RN").join(",") === "RN"
  && VV.highlightSigs("foo", null, "ECOS").join(",") === "ECOS"
  && VV.highlightSigs(undefined).length === 0);

// Profil de groupe (fiche légère : agreement.json + meta.json).
const groupRN = VV.groupProfile(VV.state.agreement, "RN");
check("groupProfile : 11 voisins classés, kappa présent",
  Boolean(groupRN) && groupRN.profile.sigle === "RN" && groupRN.others.length === 11
  && groupRN.others.every((x, i, list) => i === 0 || list[i - 1].accord >= x.accord)
  && groupRN.others.every((x) => typeof x.kappa === "number" && Number.isFinite(x.kappa)));
check("groupProfile : groupe inconnu → null", VV.groupProfile(VV.state.agreement, "XX") === null);
const partialProfile = VV.groupProfile({ principal: { [VV.pairKey("RN", "EPR")]: { accord: null } } }, "RN");
check("groupProfile : paires absentes ou nulles ignorées", partialProfile.others.length === 0);
const noPairsProfile = VV.groupProfile({ principal: {} }, "RN");
check("groupProfile : aucune paire → liste vide, pas d'exception", noPairsProfile.others.length === 0);
check("meta : participation par groupe disponible (nombre ou null)",
  VV.state.meta.groupes.every((g) => g.participation === null
    || (typeof g.participation === "number" && g.participation >= 0 && g.participation <= 1)));

// Garde-fous de contrat : les pages consomment les clés réellement exportées…
const questionnaireSrc = await readFile(new URL("../site/assets/questionnaire.js", import.meta.url), "utf8");
check("questionnaire.js n'utilise pas la clé inexistante 'q.n'", !/\bq\.n\b/.test(questionnaireSrc));

// …et le versionnage des assets reste identique sur les pages (sinon cache servi périmé).
const pages = ["index.html", "votes.html", "textes.html", "groupe.html", "questionnaire.html", "methodologie.html"];
const versions = new Map();
for (const page of pages) {
  const html = await readFile(new URL(`../site/${page}`, import.meta.url), "utf8");
  const refs = [...html.matchAll(/assets\/[\w.-]+\.(?:js|css)\?v=(\d+)/g)].map((m) => m[1]);
  check(`${page} référence des assets versionnés`, refs.length >= 2, `${refs.length} réfs`);
  for (const v of refs) versions.set(v, (versions.get(v) || 0) + 1);
}
check("un seul ?v=N pour toutes les pages", versions.size === 1, `versions: ${[...versions.keys()].join(", ")}`);

process.exit(failures ? 1 : 0);
