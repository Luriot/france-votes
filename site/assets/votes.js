/* Explorer des scrutins : résumé de séance, nouveautés, filtres, recherche, positions. */

(async () => {
  const meta = await VV.loadRibbon();
  const scrutins = await VV.loadJSON("scrutins.json");
  const state = { meta, scrutins };
  const sigles = meta.groupes.map((g) => g.sigle);
  const questions = await VV.loadJSON("questionnaire.json");
  const familyOfUid = new Map();
  for (const fam of questions.families) for (const vote of fam.votes) familyOfUid.set(vote.u, fam);
  const essentialUids = new Set(familyOfUid.keys());

  const elSearch = document.getElementById("f-recherche");
  const elTheme = document.getElementById("f-theme");
  const elPeriode = document.getElementById("f-periode");
  const elType = document.getElementById("f-type");
  const elGroupe = document.getElementById("f-groupe");
  const elPosition = document.getElementById("f-position");
  const elDoublons = document.getElementById("f-doublons");
  const elEssentiel = document.getElementById("f-essentiel");
  const elTri = document.getElementById("f-tri");
  const elCount = document.getElementById("resultat-count");
  const elBody = document.getElementById("votes-body");
  const elMore = document.getElementById("more");
  const elResume = document.getElementById("resume");
  const elNouveautes = document.getElementById("nouveautes");

  for (const [theme, count] of Object.entries(meta.compteurs.themes).sort((a, b) => b[1] - a[1])) {
    elTheme.append(new Option(`${theme} (${count})`, theme));
  }
  for (const p of [...new Set(scrutins.map((s) => VV.period(s)))].sort()) {
    elPeriode.append(new Option(p.replace("-", " "), p));
  }
  const TYPES = {
    SPO: "Scrutin public ordinaire", SPS: "Scrutin public solennel", MOC: "Motion de censure",
  };
  for (const code of new Set(scrutins.map((s) => s.t))) {
    elType.append(new Option(TYPES[code] || code, code));
  }
  for (const g of meta.groupes) elGroupe.append(new Option(`${g.sigle} — ${g.nom}`, g.sigle));

  // État partageable : ?q=…&theme=…&periode=…&type=…&groupe=…&position=…&doublons=…&essentiel=…&tri=…
  const params = new URLSearchParams(location.search);
  const FILTERS = [["theme", elTheme], ["periode", elPeriode], ["type", elType], ["groupe", elGroupe],
    ["position", elPosition], ["doublons", elDoublons], ["essentiel", elEssentiel], ["tri", elTri]];
  if (params.get("q")) elSearch.value = params.get("q");
  for (const [key, el] of FILTERS) {
    const value = params.get(key);
    if (el && value && [...el.options].some((option) => option.value === value)) el.value = value;
  }
  // « Était : pour/contre » n'a de sens qu'avec un groupe sélectionné.
  syncPositionState();
  function syncPositionState() {
    elPosition.disabled = !elGroupe.value;
    if (!elGroupe.value) elPosition.value = "";
  }

  // « Nouveaux depuis votre dernière visite » : mémoire locale, jamais transmise.
  const VUS_KEY = "vv-votes-vus";
  const dernier = scrutins.reduce((best, s) => (s.n > best.n ? s : best), scrutins[0]);
  let vus = null;
  try { vus = Number(localStorage.getItem(VUS_KEY)) || null; } catch { vus = null; }
  const nouveauxUids = new Set(vus === null ? [] : scrutins.filter((s) => s.n > vus).map((s) => s.u));
  try { localStorage.setItem(VUS_KEY, String(dernier.n)); } catch { /* stockage indisponible */ }
  if (nouveauxUids.size) {
    elNouveautes.hidden = false;
    elNouveautes.innerHTML = `<strong>${VV.fmtNum(nouveauxUids.size)} nouveau${nouveauxUids.size > 1 ? "x" : ""} scrutin${nouveauxUids.size > 1 ? "s" : ""}</strong> depuis votre dernière visite.`;
  }

  // Résumé des 30 derniers jours de séance, calé sur le dernier scrutin publié (pas la date du
  // jour) : pendant les vacances parlementaires, le résumé reste parlant.
  const fin = new Date(`${dernier.d}T12:00:00Z`);
  const debutIso = new Date(fin.getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const fenetre = scrutins.filter((s) => s.d >= debutIso);
  const adoptes = fenetre.filter((s) => s.r === "adopté").length;
  const serres = fenetre.filter((s) => Math.abs(s.m) <= 10).length;
  const censures = fenetre.filter((s) => s.t === "MOC").length;
  const themes = {};
  for (const s of fenetre) themes[s.th] = (themes[s.th] || 0) + 1;
  const dominant = Object.entries(themes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr"))[0];
  elResume.innerHTML = `
    <h2>Les 30 derniers jours de séance</h2>
    <p class="filters-result">du ${VV.fmtDate(debutIso)} au ${VV.fmtDate(dernier.d)}</p>
    <p><strong>${VV.fmtNum(fenetre.length)} scrutins</strong> — ${VV.fmtNum(adoptes)} adoptés,
    ${VV.fmtNum(fenetre.length - adoptes)} rejetés${serres ? `, ${VV.fmtNum(serres)} serrés` : ""}${censures ? `, ${VV.fmtNum(censures)} motion${censures > 1 ? "s" : ""} de censure` : ""}.${dominant ? ` Thème dominant : <strong>${VV.esc(dominant[0])}</strong>.` : ""}</p>
    <p class="q-actions"><button type="button" class="primary" id="partager-resume">Partager ce résumé</button></p>`;
  elResume.querySelector("#partager-resume").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const texte = `À l'Assemblée nationale, du ${VV.fmtDate(debutIso)} au ${VV.fmtDate(dernier.d)} : `
      + `${fenetre.length} scrutins, ${adoptes} adoptés, ${fenetre.length - adoptes} rejetés`
      + (serres ? `, ${serres} serrés` : "")
      + (censures ? `, ${censures} motion${censures > 1 ? "s" : ""} de censure` : "")
      + `. Dernier vote : « ${dernier.ti} » (${VV.fmtDate(dernier.d)}).`;
    const etat = await VV.share({ title: "Votes 2027 — derniers votes", text: texte, url: `${location.origin}${location.pathname}` });
    if (etat === "copied") {
      button.textContent = "Lien copié ✓";
      setTimeout(() => { button.textContent = "Partager ce résumé"; }, 2000);
    }
  });

  let limit = 50;

  function currentFilters() {
    return {
      q: elSearch.value.trim(), theme: elTheme.value, periode: elPeriode.value, type: elType.value,
      groupe: elGroupe.value, position: elPosition.value, doublons: elDoublons.value,
      essentiel: elEssentiel.value, tri: elTri?.value ?? "recent",
    };
  }

  function filtered() {
    const filters = currentFilters();
    const rows = VV.filterScrutins(scrutins, filters, essentialUids);
    return (filters.tri === "serres")
      ? rows.sort((a, b) => Math.abs(a.m) - Math.abs(b.m) || b.n - a.n)
      : rows.sort((a, b) => b.n - a.n);
  }

  let syncTimer = 0;
  function syncUrl() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      const filters = currentFilters();
      if (filters.tri === "recent") filters.tri = "";
      const query = VV.voteQuery(filters);
      history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}`);
    }, 200);
  }

  function render() {
    const rows = filtered();
    elCount.textContent = `${VV.fmtNum(rows.length)} scrutin${rows.length > 1 ? "s" : ""} ` +
      `${rows.length > 1 ? "correspondent" : "correspond"} aux filtres` +
      (rows.length > limit ? ` — affichage des ${limit} premiers` : "");
    elBody.innerHTML = rows.slice(0, limit).map((s) => `
      <tr>
        <td class="num">${VV.fmtDate(s.d)}</td>
        <td class="vote-title">
          <a href="${VV.sourceUrl(s)}" target="_blank" rel="noopener">${VV.esc(s.ti)}</a>
          <div style="margin-top:.2rem">
            <span class="badge theme">${VV.esc(s.th)}</span>
            <span class="badge neutre">${VV.esc(TYPES[s.t] || s.t)}</span>
            ${VV.essentielBadge(familyOfUid.get(s.u))}
            ${nouveauxUids.has(s.u) ? `<span class="badge neuf">nouveau</span>` : ""}
            ${s.b === 0 ? `<span class="badge neutre" title="Vecteur de positions identique à un autre scrutin, neutralisé dans les scores">doublon</span>` : ""}
            ${s.ind ? `<span class="badge neutre">données groupes indisponibles</span>` : ""}
            ${Math.abs(s.m) <= 10 ? `<span class="badge neutre" title="Écart à la majorité (pour − contre ; pour − seuil requis pour une motion de censure)">serré · ${s.m > 0 ? "+" : ""}${s.m}</span>` : ""}
            ${s.pv?.length ? `<span class="badge neutre" title="Groupe(s) dont le basculement changerait à lui seul le résultat">décisif : ${s.pv.slice(0, 3).map((i) => VV.esc(sigles[i])).join(", ")}${s.pv.length > 3 ? "…" : ""}</span>` : ""}
          </div>
        </td>
        <td>${VV.positionChips(s)}</td>
        <td class="num"><strong>${VV.esc(s.r || "–")}</strong></td>
      </tr>`).join("");
    elMore.hidden = rows.length <= limit;
    syncUrl();
  }

  elGroupe.addEventListener("change", syncPositionState);
  for (const el of [elSearch, elTheme, elPeriode, elType, elGroupe, elPosition, elDoublons, elEssentiel, elTri]) {
    el?.addEventListener("input", () => { limit = 50; render(); });
    el?.addEventListener("change", () => { limit = 50; render(); });
  }
  elMore.addEventListener("click", () => { limit += 100; render(); });
  document.getElementById("f-reset").addEventListener("click", () => {
    elSearch.value = ""; elTheme.value = ""; elPeriode.value = ""; elType.value = "";
    elGroupe.value = ""; elPosition.value = ""; elDoublons.value = ""; elEssentiel.value = "";
    if (elTri) elTri.value = "recent";
    syncPositionState();
    limit = 50; render();
  });

  function exportCsv() {
    const pos = (v) => (v === 1 ? "pour" : v === -1 ? "contre" : v === 0 ? "abstention" : "");
    const header = ["numero", "date", "titre", "theme", "type", "resultat", "marge", "decisifs", ...sigles];
    const lines = [header, ...filtered().map((s) => [
      s.n, s.d, s.ti, s.th, s.t, s.r || "", s.m,
      (s.pv || []).map((i) => sigles[i]).join("|"),
      ...s.p.map(pos),
    ])];
    const csv = "\ufeff" + lines
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";"))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `votes-2027-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    // Révocation différée : certains navigateurs annulent le téléchargement si l'URL disparaît trop tôt.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  document.getElementById("f-csv")?.addEventListener("click", exportCsv);

  render();
})().catch((err) => {
  document.getElementById("resultat-count").innerHTML = `<span class="erreur">Erreur de chargement : ${VV.esc(err.message)}</span>`;
});
