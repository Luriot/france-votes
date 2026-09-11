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

for (const key of ["RN|UDR", "ECOS|UDR", "EPR|DEM", "LFI-NFP|SOC"]) {
  const [a, b] = key.split("|");
  const recomputed = VV.pairStats(VV.state.scrutins, a, b).accord;
  const exported = VV.state.agreement.principal[key].accord;
  // tolérance 1e-4 : les participations exportées sont arrondies à 4 décimales.
  check(`accord ${key} recalculé côté navigateur`, Math.abs(recomputed - exported) < 1e-4,
    `JS=${recomputed.toFixed(6)} pipeline=${exported.toFixed(6)}`);
}

const scrutinsByUid = new Map(VV.state.scrutins.map((s) => [s.u, s]));
const sample = VV.state.scrutins.filter((s) => s.b === 1 && s.p.every((p) => p !== null));
check("au moins 100 votes entièrement déterminés", sample.length >= 100, `${sample.length}`);

// Les clés de paires doivent être identiques côté pipeline et côté navigateur.
const allPairs = VV.allPairs(VV.state.scrutins);
for (const [a, b] of [["RN", "EPR"], ["RN", "LFI-NFP"], ["NI", "UDR"]]) {
  const key = VV.pairKey(a, b);
  check(`clé de paire ${key} présente`, key in allPairs);
  check(`clé de paire ${key} = export pipeline`, Boolean(VV.state.agreement.principal[key]));
}

const themes = new Set(VV.state.scrutins.map((s) => s.th));
check("thèmes exportés non vides", themes.size >= 20, `${themes.size} thèmes`);

const q = JSON.parse(files["questionnaire.json"]);
check("questionnaire : positions sur 12 groupes", q.questions.every((x) => x.positions.length === 12));
check("questionnaire : poids > 0", q.questions.every((x) => x.poids >= 0));
check("questionnaire : scrutins présents dans scrutins.json", q.questions.every((x) => scrutinsByUid.has(x.uid)));

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

process.exit(failures ? 1 : 0);
