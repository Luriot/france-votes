/* Explorer des scrutins : filtres, recherche, positions par groupe */

(async () => {
  const state = await VV.loadAll();
  VV.renderRibbon();
  const sigles = state.meta.groupes.map((g) => g.sigle);

  const elSearch = document.getElementById("f-recherche");
  const elTheme = document.getElementById("f-theme");
  const elPeriode = document.getElementById("f-periode");
  const elType = document.getElementById("f-type");
  const elGroupe = document.getElementById("f-groupe");
  const elPosition = document.getElementById("f-position");
  const elDoublons = document.getElementById("f-doublons");
  const elCount = document.getElementById("resultat-count");
  const elBody = document.getElementById("votes-body");
  const elMore = document.getElementById("more");

  for (const [theme, count] of Object.entries(state.meta.compteurs.themes).sort((a, b) => b[1] - a[1])) {
    elTheme.append(new Option(`${theme} (${count})`, theme));
  }
  for (const p of [...new Set(state.scrutins.map((s) => VV.period(s)))].sort()) {
    elPeriode.append(new Option(p.replace("-", " "), p));
  }
  const TYPES = {
    SPO: "Scrutin public ordinaire", SPS: "Scrutin public solennel", MOC: "Motion de censure",
  };
  for (const code of new Set(state.scrutins.map((s) => s.t))) {
    elType.append(new Option(TYPES[code] || code, code));
  }
  for (const g of state.meta.groupes) elGroupe.append(new Option(`${g.sigle} — ${g.nom}`, g.sigle));

  const elTri = document.getElementById("f-tri");
  const elCsv = document.getElementById("f-csv");
  const params = new URLSearchParams(location.search);
  if (params.get("q")) elSearch.value = params.get("q");
  const wantedTheme = params.get("theme");
  if (wantedTheme && [...elTheme.options].some((o) => o.value === wantedTheme)) elTheme.value = wantedTheme;

  let limit = 50;

  function filtered() {
    const q = elSearch.value.trim().toLowerCase();
    const theme = elTheme.value, periode = elPeriode.value, type = elType.value;
    const groupe = elGroupe.value, position = elPosition.value, doublons = elDoublons.value;
    const rows = state.scrutins.filter((s) => {
      if (theme && s.th !== theme) return false;
      if (periode && VV.period(s) !== periode) return false;
      if (type && s.t !== type) return false;
      if (q && !s.ti.toLowerCase().includes(q)) return false;
      if (doublons === "uniques" && s.b === 0) return false;
      if (doublons === "doublons" && s.b !== 0) return false;
      if (groupe && position) {
        const idx = sigles.indexOf(groupe);
        if (s.p[idx] !== Number(position)) return false;
      }
      return true;
    });
    return (elTri?.value === "serres")
      ? rows.sort((a, b) => Math.abs(a.m) - Math.abs(b.m) || b.n - a.n)
      : rows.sort((a, b) => b.n - a.n);
  }

  function chips(s) {
    return sigles.map((sigle, i) => {
      const p = s.p[i];
      const cls = p === 1 ? "pos-pour" : p === -1 ? "pos-contre" : p === 0 ? "pos-abstention" : "pos-absent";
      const label = p === 1 ? "pour" : p === -1 ? "contre" : p === 0 ? "abstention" : "non déterminée";
      return `<span title="${VV.esc(sigle)} : ${label}" style="display:inline-block;width:.62rem;height:.62rem;margin-right:2px;border-radius:2px" class="${cls}"></span>`;
    }).join("");
  }

  function render() {
    const rows = filtered();
    elCount.textContent = `${VV.fmtNum(rows.length)} scrutins correspondent aux filtres` +
      (rows.length > limit ? ` — affichage des ${limit} premiers` : "");
    elBody.innerHTML = rows.slice(0, limit).map((s) => `
      <tr>
        <td class="num">${VV.fmtDate(s.d)}</td>
        <td class="vote-title">
          <a href="${VV.sourceUrl(s)}" target="_blank" rel="noopener">${VV.esc(s.ti)}</a>
          <div style="margin-top:.2rem">
            <span class="badge theme">${VV.esc(s.th)}</span>
            <span class="badge neutre">${VV.esc(TYPES[s.t] || s.t)}</span>
            ${s.b === 0 ? `<span class="badge neutre" title="Vecteur de positions identique à un autre scrutin, neutralisé dans les scores">doublon</span>` : ""}
            ${s.ind ? `<span class="badge neutre">données groupes indisponibles</span>` : ""}
            ${Math.abs(s.m) <= 10 ? `<span class="badge neutre" title="Marge pour − contre">serré · ${s.m > 0 ? "+" : ""}${s.m}</span>` : ""}
            ${s.pv?.length ? `<span class="badge neutre" title="Groupe(s) dont le basculement changerait à lui seul le résultat">décisif : ${s.pv.slice(0, 3).map((i) => VV.esc(sigles[i])).join(", ")}${s.pv.length > 3 ? "…" : ""}</span>` : ""}
          </div>
        </td>
        <td>${chips(s)}</td>
        <td class="num"><strong>${VV.esc(s.r || "–")}</strong></td>
      </tr>`).join("");
    elMore.hidden = rows.length <= limit;
  }

  for (const el of [elSearch, elTheme, elPeriode, elType, elGroupe, elPosition, elDoublons, elTri]) {
    el?.addEventListener("input", () => { limit = 50; render(); });
    el?.addEventListener("change", () => { limit = 50; render(); });
  }
  elMore.addEventListener("click", () => { limit += 100; render(); });
  document.getElementById("f-reset").addEventListener("click", () => {
    elSearch.value = ""; elTheme.value = ""; elPeriode.value = ""; elType.value = "";
    elGroupe.value = ""; elPosition.value = ""; elDoublons.value = "";
    if (elTri) elTri.value = "recent";
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
    URL.revokeObjectURL(url);
  }
  elCsv?.addEventListener("click", exportCsv);

  render();
})().catch((err) => {
  document.getElementById("resultat-count").innerHTML = `<span class="erreur">Erreur de chargement : ${VV.esc(err.message)}</span>`;
});
