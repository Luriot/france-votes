/* Page Comparer : matrice, carte, détail de paire, robustesse */

(async () => {
  const state = await VV.loadAll();
  const groupes = state.meta.groupes;
  const sigles = groupes.map((g) => g.sigle);
  VV.renderRibbon();

  VV.setText("hero-scrutins", VV.fmtNum(state.meta.compteurs.scrutins));
  VV.setText("hero-retenus", VV.fmtNum(state.meta.compteurs.scrutins_retenus));
  VV.setText("hero-themes", VV.fmtNum(state.meta.compteurs.scrutins_themes));
  VV.setText("hero-pct", VV.fmtPct(state.meta.compteurs.scrutins_themes / state.meta.compteurs.scrutins));
  VV.setText("rb-doublons-meter", VV.fmtNum(state.meta.compteurs.doublons));
  VV.setText("data-date", VV.fmtDate(state.meta.data_built_at));

  const themes = Object.entries(state.meta.compteurs.themes)
    .sort((a, b) => b[1] - a[1]);

  const selTheme = document.getElementById("f-theme");
  for (const [theme, count] of themes) {
    selTheme.append(new Option(`${theme} (${count})`, theme));
  }
  const selPeriod = document.getElementById("f-periode");
  const periodes = [...new Set(state.scrutins.map((s) => VV.period(s)))].sort();
  for (const p of periodes) {
    selPeriod.append(new Option(p.replace("-", " "), p));
  }

  const selected = { a: "RN", b: "LFI-NFP" };
  let refGroup = "RN";

  function filtered() {
    const theme = selTheme.value;
    const periode = selPeriod.value;
    return state.scrutins.filter((s) =>
      (theme === "" || s.th === theme) && (periode === "" || VV.period(s) === periode));
  }

  function kappa(scrutins, a, b) {
    const ia = sigles.indexOf(a), ib = sigles.indexOf(b);
    let total = 0, observed = 0;
    const ca = {}, cb = {};
    for (const s of scrutins) {
      const pa = s.p[ia], pb = s.p[ib];
      if (pa === null || pb === null) continue;
      total += 1;
      if (pa === pb) observed += 1;
      ca[pa] = (ca[pa] || 0) + 1;
      cb[pb] = (cb[pb] || 0) + 1;
    }
    if (!total) return null;
    const po = observed / total;
    const pe = Object.keys(ca).reduce((acc, key) => acc + (ca[key] / total) * ((cb[key] || 0) / total), 0);
    return pe >= 1 ? (po === 1 ? 1 : 0) : (po - pe) / (1 - pe);
  }

  function isFiltered() {
    return selTheme.value !== "" || selPeriod.value !== "";
  }

  /* --- groupes en un coup d'œil --- */
  function renderGroups() {
    const grid = document.getElementById("group-grid");
    if (!grid) return;
    const pairs = VV.allPairs(state.scrutins);
    grid.innerHTML = groupes.map((g, gi) => {
      const determined = state.scrutins.filter((s) => s.p[gi] !== null);
      const participation = determined.length
        ? determined.reduce((acc, s) => acc + s.q[gi], 0) / determined.length
        : 0;
      const others = sigles
        .filter((sigle) => sigle !== g.sigle)
        .map((sigle) => ({ sigle, ...pairs[VV.pairKey(g.sigle, sigle)] }))
        .filter((x) => x.accord !== null)
        .sort((a, b) => b.accord - a.accord);
      const top = others[0], low = others[others.length - 1];
      return `<button type="button" class="group-card" data-sigle="${VV.esc(g.sigle)}">
        <span class="sigle">${VV.esc(g.sigle)}</span>
        <span class="nom">${VV.esc(g.nom)}</span>
        <span class="swatch" style="background:${VV.safeColor(g.couleur)}"></span>
        <dl>
          <dt>scrutins comptés</dt><dd>${VV.fmtNum(determined.length)}</dd>
          <dt>participation</dt><dd>${VV.fmtPct(participation)}</dd>
          <dt>plus proche</dt><dd>${VV.esc(top?.sigle ?? "–")} · ${VV.fmtPct(top?.accord)}</dd>
          <dt>plus distant</dt><dd>${VV.esc(low?.sigle ?? "–")} · ${VV.fmtPct(low?.accord)}</dd>
        </dl>
      </button>`;
    }).join("");
    grid.querySelectorAll(".group-card").forEach((btn) => btn.addEventListener("click", () => {
      refGroup = btn.dataset.sigle;
      selected.a = refGroup;
      if (selected.b === refGroup) selected.b = sigles.find((s) => s !== refGroup);
      renderAll();
      const title = document.getElementById("ranking-title");
      title.setAttribute("tabindex", "-1");
      title.focus({ preventScroll: true });
      document.getElementById("comparer").scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  }

  /* --- classement de proximité --- */
  function renderRefChips() {
    const box = document.getElementById("ref-chips");
    if (!box) return;
    box.innerHTML = groupes.map((g) =>
      `<button type="button" data-sigle="${VV.esc(g.sigle)}" aria-pressed="${g.sigle === refGroup}">${VV.esc(g.sigle)}</button>`
    ).join("");
    box.querySelectorAll("button").forEach((btn) => btn.addEventListener("click", () => {
      refGroup = btn.dataset.sigle;
      selected.a = refGroup;
      if (selected.b === refGroup) selected.b = sigles.find((s) => s !== refGroup);
      renderAll();
    }));
  }

  function renderRanking() {
    const list = document.getElementById("ranking");
    if (!list) return;
    const scrutins = filtered();
    const pairs = VV.allPairs(scrutins);
    const rows = sigles
      .filter((sigle) => sigle !== refGroup)
      .map((sigle) => ({ sigle, ...pairs[VV.pairKey(refGroup, sigle)] }))
      .filter((x) => x.accord !== null)
      .sort((a, b) => b.accord - a.accord);
    list.innerHTML = rows.map((x, i) => {
      const meta = groupes.find((g) => g.sigle === x.sigle);
      return `<li><button type="button" class="rank-row" data-sigle="${VV.esc(x.sigle)}" aria-pressed="${selected.a === refGroup && selected.b === x.sigle}">
        <span class="who"><i style="background:${VV.safeColor(meta.couleur)}"></i>${i + 1}. ${VV.esc(x.sigle)}
          <span class="why">${VV.fmtNum(x.n)} votes partagés</span></span>
        <span class="track"><i style="width:${(x.accord * 100).toFixed(1)}%"></i></span>
        <span class="pct">${VV.fmtPct(x.accord)}</span>
      </button></li>`;
    }).join("");
    list.querySelectorAll(".rank-row").forEach((btn) => btn.addEventListener("click", () => {
      selected.a = refGroup;
      selected.b = btn.dataset.sigle;
      renderAll();
      document.getElementById("pair-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    const title = document.getElementById("ranking-title");
    if (title) title.textContent = `Quels groupes votent comme ${refGroup} ?`;
  }

  /* --- matrice --- */
  function renderMatrix() {
    const scrutins = filtered();
    const pairs = VV.allPairs(scrutins);
    const table = document.getElementById("matrix");
    table.innerHTML = "";
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    hr.append(document.createElement("th"));
    for (const g of groupes) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = g.sigle;
      th.title = g.nom;
      hr.append(th);
    }
    thead.append(hr);
    table.append(thead);
    const tbody = document.createElement("tbody");
    for (const row of groupes) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      th.className = "rowh";
      th.textContent = row.sigle;
      tr.append(th);
      for (const col of groupes) {
        const td = document.createElement("td");
        if (row.sigle === col.sigle) {
          td.className = "diag";
        } else {
          const key = VV.pairKey(row.sigle, col.sigle);
          const stat = pairs[key];
          const value = stat ? stat.accord : null;
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "cell";
          btn.style.background = VV.heatColor(value);
          btn.style.color = VV.textOn(value);
          btn.textContent = value === null ? "–" : Math.round(value * 100);
          btn.title = `${row.sigle} ↔ ${col.sigle} : ${VV.fmtPct(value)} d'accord sur ${stat ? stat.n : 0} votes`;
          btn.setAttribute("aria-pressed", row.sigle === selected.a && col.sigle === selected.b);
          if (row.sigle === selected.a && col.sigle === selected.b) btn.style.outline = "3px solid var(--accent)";
          btn.addEventListener("click", () => {
            selected.a = row.sigle;
            selected.b = col.sigle;
            refGroup = row.sigle;
            renderAll();
          });
          td.append(btn);
        }
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
  }

  /* --- carte MDS --- */
  function renderMap() {
    const svg = document.getElementById("map");
    const pts = state.agreement.mds;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const pad = 40;
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = 640, h = 460;
    const sx = (x) => pad + ((x - minX) / Math.max(1e-9, maxX - minX)) * (w - 2 * pad);
    const sy = (y) => h - pad - ((y - minY) / Math.max(1e-9, maxY - minY)) * (h - 2 * pad);
    const parts = [
      `<line class="gridline" x1="${pad}" y1="${h / 2}" x2="${w - pad}" y2="${h / 2}"></line>`,
      `<line class="gridline" x1="${w / 2}" y1="${pad}" x2="${w / 2}" y2="${h - pad}"></line>`,
    ];
    for (const p of pts) {
      const meta = groupes.find((g) => g.sigle === p.sigle);
      const sigle = VV.esc(p.sigle);
      parts.push(
        `<g class="pt" data-sigle="${sigle}" role="button" tabindex="0" aria-label="Groupe ${sigle}">` +
        `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="11" fill="${VV.safeColor(meta?.couleur)}"></circle>` +
        `<text x="${(sx(p.x) + 14).toFixed(1)}" y="${(sy(p.y) + 4).toFixed(1)}">${sigle}</text></g>`
      );
    }
    svg.innerHTML = parts.join("");
    svg.querySelectorAll(".pt").forEach((g) => {
      const pick = () => {
        refGroup = g.dataset.sigle;
        selected.a = refGroup;
        if (selected.b === refGroup) selected.b = sigles.find((s) => s !== refGroup);
        renderAll();
      };
      g.addEventListener("click", pick);
      g.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") pick();
      });
    });
  }

  function showNeighbours(sigle) {
    const scrutins = filtered();
    const pairs = VV.allPairs(scrutins);
    const list = sigles
      .filter((s) => s !== sigle)
      .map((s) => ({ sigle: s, ...pairs[VV.pairKey(sigle, s)] }))
      .filter((x) => x.accord !== null)
      .sort((x, y) => y.accord - x.accord);
    const box = document.getElementById("map-panel");
    box.innerHTML = `<h3>${VV.esc(sigle)} — groupes les plus proches</h3>` +
      list.slice(0, 6).map((x) => `<div class="result-row"><span class="stance">${VV.esc(x.sigle)}</span>` +
        `<span class="bar"><i style="width:${(x.accord * 100).toFixed(1)}%"></i></span>` +
        `<b>${VV.fmtPct(x.accord)}</b></div>`).join("") +
      `<p style="font-size:.78rem;color:var(--ink-faint);margin:.5rem 0 0">accord pondéré sur les scrutins partagés avec le groupe le plus proche (${VV.fmtNum(list[0]?.n ?? 0)} votes)</p>`;
  }

  /* --- détail de paire --- */
  function renderPair() {
    const scrutins = filtered();
    const key = VV.pairKey(selected.a, selected.b);
    const stat = VV.pairStats(scrutins, selected.a, selected.b);
    const kap = kappa(scrutins, selected.a, selected.b);
    const rob = state.agreement.robustesse[key];
    const box = document.getElementById("pair-panel");
    if (!stat || stat.accord === null) {
      box.innerHTML = `<h2>${VV.esc(selected.a)} ↔ ${VV.esc(selected.b)}</h2><p class="loading">Pas assez de votes partagés avec ces filtres.</p>`;
      return;
    }
    const ia = sigles.indexOf(selected.a), ib = sigles.indexOf(selected.b);
    const shared = scrutins.filter((s) => s.p[ia] !== null && s.p[ib] !== null);

    const byTheme = Object.create(null);
    for (const s of shared) {
      byTheme[s.th] = byTheme[s.th] || [];
      byTheme[s.th].push(s);
    }
    const themeRows = Object.entries(byTheme)
      .map(([theme, list]) => ({ theme, ...VV.pairStats(list, selected.a, selected.b) }))
      .filter((x) => x.n >= 10 && x.accord !== null)
      .sort((x, y) => y.accord - x.accord);

    const solid = themeRows.filter((x) => x.n >= 20);
    const robust = solid.length ? solid : themeRows;
    const best = robust[0], worst = robust[robust.length - 1];
    const bilan = `${selected.a} et ${selected.b} ont voté de la même manière sur ${VV.fmtPct(stat.accord)} ` +
      `de leurs ${VV.fmtNum(stat.n)} votes partagés` +
      (best ? ` — point de convergence maximal sur « ${VV.esc(best.theme)} » (${VV.fmtPct(best.accord)})` : "") +
      (worst && worst !== best ? `, désaccord maximal sur « ${VV.esc(worst.theme)} » (${VV.fmtPct(worst.accord)}).` : ".");

    const withWeights = shared.map((s) => {
      const w = s.b * s.f * Math.min(s.q[ia], s.q[ib]);
      return { s, w, agree: s.p[ia] === s.p[ib] };
    }).sort((x, y) => y.w - x.w);
    const divergences = withWeights.filter((x) => !x.agree).slice(0, 12);
    const convergences = withWeights.filter((x) => x.agree).slice(0, 12);

    const voteItem = ({ s, w, agree }) => `
      <li>
        <div class="meta">
          <span class="date">${VV.fmtDate(s.d)}</span>
          <span class="badge theme">${VV.esc(s.th)}</span>
          ${s.dup ? `<span class="badge neutre" title="Vecteur de positions identique à un autre scrutin, neutralisé">doublon</span>` : ""}
          ${s.ind ? `<span class="badge neutre">données groupes indisponibles</span>` : ""}
        </div>
        <a href="${VV.sourceUrl(s)}" target="_blank" rel="noopener">${VV.esc(s.ti)}</a>
        <div class="verdict">${VV.stance(s.p[ia])} ${VV.stance(s.p[ib])} · <strong>${agree ? "rapproche" : "oppose"}</strong> · poids ${w.toFixed(2)}</div>
      </li>`;

    const themeTable = (rows) => rows.length
      ? `<div class="table-scroll"><table class="data">
          <thead><tr><th>Thème</th><th class="num">Votes</th><th class="num">Accord</th></tr></thead>
          <tbody>${rows.map((x) => `<tr><td>${VV.esc(x.theme)}</td><td class="num">${x.n}</td><td class="num">${VV.fmtPct(x.accord)}</td></tr>`).join("")}</tbody>
        </table></div>`
      : `<p class="loading">Pas assez de votes partagés par thème.</p>`;

    const robBlock = isFiltered()
      ? `<p class="loading" style="margin:.4rem 0 0">Analyse de robustesse complète disponible sans filtre (elle est précalculée sur l'ensemble des votes).</p>`
      : `
        <div class="rangebar">
          <div class="r"><b>${VV.fmtPct(rob?.amplitude_min)} – ${VV.fmtPct(rob?.amplitude_max)}</b><span>intervalle selon les méthodes (pondérations, seuils, retrait d'un thème)</span></div>
          <div class="r"><b>${VV.fmtPct(rob?.bootstrap?.p5)} – ${VV.fmtPct(rob?.bootstrap?.p95)}</b><span>intervalle de confiance à 90 % (${rob?.bootstrap?.n_iter || 0} rééchantillonnages)</span></div>
          <div class="r"><b>rangs ${rob?.bootstrap?.rang_p5} – ${rob?.bootstrap?.rang_p95}</b><span>rang de proximité sur 66 paires (1 = le plus proche)</span></div>
          <div class="r"><b>${stat.n} votes partagés</b><span>poids effectif : ${VV.fmtNum(Math.round(stat.poids))}</span></div>
        </div>`;

    box.innerHTML = `
      <div class="pair-head">
        <div><p class="eyebrow" style="margin:0">Accord pondéré</p><div class="pair-score">${VV.fmtPct(stat.accord)}</div></div>
        <div class="pair-meta">
          <div><strong>${VV.esc(selected.a)}</strong> (${VV.esc(groupes.find((g) => g.sigle === selected.a)?.nom ?? "")})</div>
          <div><strong>${VV.esc(selected.b)}</strong> (${VV.esc(groupes.find((g) => g.sigle === selected.b)?.nom ?? "")})</div>
          <div>Kappa de Cohen (accord corrigé du hasard) : <strong>${kap === null ? "–" : kap.toFixed(3).replace(".", ",")}</strong></div>
        </div>
        <div style="flex:1"></div>
        <a href="#votes">Voir les votes ci-dessous ↓</a>
      </div>
      <p class="note" style="margin:.6rem 0 0">${bilan}</p>
      ${robBlock}
      <h3 style="margin-top:1.3rem">Accord par thème</h3>
      <div class="theme-cols">
        <div>
          <p class="fineprint" style="margin-top:0">Où ils convergent le plus</p>
          ${themeTable(themeRows.slice(0, 5))}
        </div>
        <div>
          <p class="fineprint" style="margin-top:0">Où ils divergent le plus</p>
          ${themeTable(themeRows.slice(-5).reverse())}
        </div>
      </div>
      ${themeRows.length > 10 ? `<details class="aide"><summary>Voir les ${themeRows.length} thèmes détaillés</summary>${themeTable(themeRows)}</details>` : ""}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:var(--gap);margin-top:1.3rem">
        <div><h3>Votes qui les rapprochent</h3><ul class="impact">${convergences.map(voteItem).join("") || "<li>Aucun</li>"}</ul></div>
        <div><h3>Votes qui les opposent</h3><ul class="impact">${divergences.map(voteItem).join("") || "<li>Aucun</li>"}</ul></div>
      </div>`;

    renderVariants(key);
  }

  function renderVariants(key) {
    if (isFiltered()) { document.getElementById("variants").innerHTML = ""; return; }
    const labels = {
      uniforme: "Poids uniforme (sans plafond ni participation)",
      thematique: "Plafond par thème seulement",
      participation_seule: "Participation seulement (sans plafond)",
      sans_deduplication: "Sans déduplication des votes",
      position_officielle: "Position majoritaire déclarée par l'AN",
      seuil_participation_25: "Exclure les groupes présents à moins de 25 %",
      seuil_participation_50: "Exclure les groupes présents à moins de 50 %",
    };
    const base = state.agreement.principal[key]?.accord;
    const columns = [`<div class="result-row"><span class="stance">principal</span>
      <span class="bar"><i style="width:${((base || 0) * 100).toFixed(1)}%"></i></span>
      <b>${VV.fmtPct(base)}</b></div>`];
    for (const [name, label] of Object.entries(labels)) {
      const value = state.agreement.variantes[name]?.[key]?.accord;
      columns.push(`<div class="result-row"><span class="stance" title="${label}">${name.split("_")[0]}</span>
        <span class="bar"><i style="width:${((value || 0) * 100).toFixed(1)}%"></i></span>
        <b>${VV.fmtPct(value)}</b></div>`);
    }
    document.getElementById("variants").innerHTML =
      `<h3>Le résultat dépend-il de la méthode ?</h3>
       <p style="font-size:.85rem;color:var(--ink-soft)">Même paire, mêmes données, règles différentes. Si les barres restent proches, le résultat est robuste.</p>
       ${columns.join("")}
       <details class="aide"><summary>Détail des variantes</summary>
       <ul style="font-size:.85rem">${Object.entries(labels).map(([name, label]) => `<li><code>${name}</code> : ${label}</li>`).join("")}</ul></details>`;
  }

  function renderAll() {
    renderMatrix();
    renderRefChips();
    renderRanking();
    renderPair();
    showNeighbours(selected.a);
  }

  selTheme.addEventListener("change", renderAll);
  selPeriod.addEventListener("change", renderAll);
  document.getElementById("f-reset").addEventListener("click", () => {
    selTheme.value = "";
    selPeriod.value = "";
    renderAll();
  });

  renderAll();
  renderGroups();
  renderMap();
})().catch((err) => {
  document.getElementById("pair-panel").innerHTML = `<p class="erreur">Erreur de chargement : ${VV.esc(err.message)}</p>`;
});
