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
  const segments = document.querySelectorAll(".meter .segments i");
  const onCount = Math.round((state.meta.compteurs.scrutins_themes / state.meta.compteurs.scrutins) * segments.length);
  segments.forEach((el, i) => el.classList.toggle("on", i < onCount));

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

  // Questions essentielles (questionnaire) : périmètre orienté vers l'adoption des textes.
  // Chaque vote de famille est ramené sur l'axe « pour/contre le texte » (dir ±1) ; la
  // déduplication du corpus ne s'applique pas (b := 1), comme dans le questionnaire.
  const questions = await VV.loadQuestionnaire();
  const familyOfUid = new Map();
  const anchorUids = new Set();
  for (const fam of questions.families) {
    for (const vote of fam.votes) familyOfUid.set(vote.u, { fam, vote });
    if (fam.anchor && fam.votes.some((vote) => vote.u === fam.anchor)) anchorUids.add(fam.anchor);
  }
  const essentialScrutins = [];
  for (const s of state.scrutins) {
    const hit = familyOfUid.get(s.u);
    if (!hit) continue;
    const base = hit.vote.p ?? s.p;
    essentialScrutins.push({
      ...s,
      b: 1,
      p: hit.vote.dir === 1 ? base : base.map((x) => (x === null || x === undefined ? null : -x)),
    });
  }
  const passageScrutins = essentialScrutins.filter((s) => anchorUids.has(s.u));
  const PERIMETRES = {
    essentiel: {
      list: essentialScrutins,
      note: `Périmètre : les ${VV.fmtNum(essentialScrutins.length)} votes des ${questions.families.length} textes `
        + "essentiels, orientés vers l'adoption du texte (corrélation ≥ 0,5 avec le vote de passage ; les votes "
        + "faiblement corrélés sont écartés). Cela mesure un sens de vote, pas une intention : voir Méthode §11-§12.",
    },
    passage: {
      list: passageScrutins,
      note: `Périmètre : un vote par texte — le vote de passage (« l'ensemble… », ${VV.fmtNum(passageScrutins.length)} textes), `
        + "seule position directement interprétable, sans inférence d'orientation.",
    },
  };
  const selPerimetre = document.getElementById("f-perimetre");
  const notePerimetre = document.getElementById("perimetre-note");

  const selected = { a: "RN", b: "LFI-NFP" };
  let refGroup = "RN";
  const elAbst = document.getElementById("f-abst");
  let excludeAbst = elAbst?.checked === true;

  // État partageable : ?a=RN&b=ECOS&theme=Budget&periode=2025-H2&abst=1
  const params = new URLSearchParams(location.search);
  if (sigles.includes(params.get("a"))) {
    refGroup = params.get("a");
    selected.a = refGroup;
  }
  if (sigles.includes(params.get("b")) && params.get("b") !== selected.a) selected.b = params.get("b");
  if (selected.b === selected.a) selected.b = sigles.find((sigle) => sigle !== selected.a) ?? selected.b;
  if ([...selTheme.options].some((o) => o.value === params.get("theme"))) selTheme.value = params.get("theme");
  if (periodes.includes(params.get("periode"))) selPeriod.value = params.get("periode");
  if (params.get("perimetre") in PERIMETRES) selPerimetre.value = params.get("perimetre");
  if (params.get("abst") === "1" && elAbst) {
    elAbst.checked = true;
    excludeAbst = true;
  }

  function syncUrl() {
    const p = new URLSearchParams();
    p.set("a", selected.a);
    p.set("b", selected.b);
    if (selTheme.value) p.set("theme", selTheme.value);
    if (selPeriod.value) p.set("periode", selPeriod.value);
    if (selPerimetre.value) p.set("perimetre", selPerimetre.value);
    if (excludeAbst) p.set("abst", "1");
    history.replaceState(null, "", `${location.pathname}?${p}${location.hash}`);
  }

  function weightOpts() {
    return { excludeAbstention: excludeAbst };
  }

  function scope() {
    const conf = PERIMETRES[selPerimetre.value];
    return conf ? conf.list : state.scrutins;
  }

  function filtered() {
    const theme = selTheme.value;
    const periode = selPeriod.value;
    return scope().filter((s) =>
      (theme === "" || s.th === theme) && (periode === "" || VV.period(s) === periode));
  }

  function isFiltered() {
    return selTheme.value !== "" || selPeriod.value !== "" || selPerimetre.value !== "";
  }

  function renderPerimetreNote() {
    if (!notePerimetre) return;
    const conf = PERIMETRES[selPerimetre.value];
    notePerimetre.hidden = !conf;
    notePerimetre.textContent = conf ? conf.note : "";
  }

  /* --- groupes en un coup d'œil --- */
  function renderGroups() {
    const grid = document.getElementById("group-grid");
    if (!grid) return;
    const pairs = VV.allPairs(state.scrutins, weightOpts());
    grid.innerHTML = groupes.map((g, gi) => {
      const determined = state.scrutins.filter((s) => s.p[gi] !== null);
      const others = sigles
        .filter((sigle) => sigle !== g.sigle)
        .map((sigle) => ({ sigle, ...pairs[VV.pairKey(g.sigle, sigle)] }))
        .filter((x) => x.accord !== null)
        .sort((a, b) => b.accord - a.accord);
      const top = others[0], low = others[others.length - 1];
      return `<a class="group-card" href="groupe.html?g=${encodeURIComponent(g.sigle)}"
        title="Voir la fiche de ${VV.esc(g.sigle)}">
        <span class="sigle">${VV.esc(g.sigle)}</span>
        <span class="nom">${VV.esc(g.nom)}</span>
        <span class="swatch" style="background:${VV.safeColor(g.couleur)}"></span>
        <dl>
          <dt>scrutins comptés</dt><dd>${VV.fmtNum(determined.length)}</dd>
          <dt>participation</dt><dd>${VV.fmtPct(g.participation)}</dd>
          <dt>membres</dt><dd>${g.membres ?? "–"}</dd>
          <dt>unité (Rice)</dt><dd>${g.cohesion === null || g.cohesion === undefined ? "–" : `${g.cohesion.toFixed(1).replace(".", ",")} %`}</dd>
          <dt>plus proche</dt><dd>${VV.esc(top?.sigle ?? "–")} · ${VV.fmtPct(top?.accord)}</dd>
          <dt>plus distant</dt><dd>${VV.esc(low?.sigle ?? "–")} · ${VV.fmtPct(low?.accord)}</dd>
        </dl>
      </a>`;
    }).join("");
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
    const pairs = VV.allPairs(scrutins, weightOpts());
    const rows = sigles
      .filter((sigle) => sigle !== refGroup)
      .map((sigle) => ({ sigle, ...pairs[VV.pairKey(refGroup, sigle)] }))
      .filter((x) => x.accord !== null)
      .sort((a, b) => b.accord - a.accord);
    list.innerHTML = rows.map((x, i) => {
      const meta = groupes.find((g) => g.sigle === x.sigle);
      return `<li><button type="button" class="rank-row" data-sigle="${VV.esc(x.sigle)}" aria-pressed="${selected.a === refGroup && selected.b === x.sigle}">
        <span class="who"><i style="background:${VV.safeColor(meta.couleur)}"></i>${i + 1}. ${VV.esc(x.sigle)}
          <span class="full">${VV.esc(meta?.nom ?? "")}</span>
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
    const pairs = VV.allPairs(scrutins, weightOpts());
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

  /* --- derniers votes (accueil) --- */
  function renderRecent() {
    const box = document.getElementById("derniers-accueil");
    if (!box) return;
    const rows = [...state.scrutins].sort((a, b) => b.n - a.n).slice(0, 3);
    box.innerHTML = `<ul class="impact">${rows.map((s) => `<li>
      <div class="meta">
        <span class="date">${VV.fmtDate(s.d)}</span>
        <span class="badge theme">${VV.esc(s.th)}</span>
        <span class="badge ${s.r === "adopté" ? "adopte" : "rejete"}">${VV.esc(s.r || "–")}</span>
      </div>
      <a href="${VV.sourceUrl(s)}" target="_blank" rel="noopener">${VV.esc(s.ti)}</a>
    </li>`).join("")}</ul>
    <p class="fineprint"><a href="votes.html">Tous les scrutins, filtrables →</a></p>`;
  }

  /* --- carte MDS --- */
  function renderMap() {
    const svg = document.getElementById("map");
    const pts = state.agreement.mds;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const compact = window.innerWidth < 700;
    const pad = compact ? 36 : 40;
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = 640, h = compact ? 540 : 460;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const pointR = compact ? 15 : 11;
    const labelOffset = compact ? 20 : 14;
    const fontSize = compact ? 17 : 10;
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
        `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${compact ? 30 : 16}" fill="none" pointer-events="all"></circle>` +
        `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${pointR}" fill="${VV.safeColor(meta?.couleur)}"></circle>` +
        `<text x="${(sx(p.x) + labelOffset).toFixed(1)}" y="${(sy(p.y) + fontSize / 3).toFixed(1)}" style="font-size:${fontSize}px">${sigle}</text></g>`
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

  let mapWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (Math.abs(window.innerWidth - mapWidth) < 80) return;
    mapWidth = window.innerWidth;
    renderMap();
  });

  function showNeighbours(sigle) {
    const scrutins = filtered();
    const pairs = VV.allPairs(scrutins, weightOpts());
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
    const stat = VV.pairStats(scrutins, selected.a, selected.b, weightOpts());
    const kap = VV.kappa(scrutins, selected.a, selected.b, weightOpts());
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
      .map(([theme, list]) => ({ theme, ...VV.pairStats(list, selected.a, selected.b, weightOpts()) }))
      .filter((x) => x.theme !== "Non classé" && x.n >= 10 && x.accord !== null)
      .sort((x, y) => y.accord - x.accord);

    const solid = themeRows.filter((x) => x.n >= 20);
    const robust = solid.length ? solid : themeRows;
    const best = robust[0], worst = robust[robust.length - 1];
    const perimetreTag = selPerimetre.value === "essentiel"
      ? "Sur les votes orientés des textes essentiels"
      : selPerimetre.value === "passage" ? "Sur le vote de passage de chaque texte essentiel" : "";
    const bilan = `${selected.a} et ${selected.b} ont voté de la même manière sur ${VV.fmtPct(stat.accord)} ` +
      `de leurs ${VV.fmtNum(stat.n)} votes partagés` +
      (best ? ` — point de convergence maximal sur « ${VV.esc(best.theme)} » (${VV.fmtPct(best.accord)})` : "") +
      (worst && worst !== best ? `, désaccord maximal sur « ${VV.esc(worst.theme)} » (${VV.fmtPct(worst.accord)}).` : ".");

    const periodsForPair = [...new Set(shared.map((s) => VV.period(s)))].sort();
    const series = periodsForPair.map((p) => ({
      p,
      ...VV.pairStats(shared.filter((s) => VV.period(s) === p), selected.a, selected.b, weightOpts()),
    })).filter((x) => x.accord !== null && x.n >= 5);
    let spark = "";
    if (series.length >= 2) {
      const w = 280, h = 48, p = 5;
      const values = series.map((x) => x.accord);
      const min = Math.min(...values), max = Math.max(...values);
      const sx = (i) => p + (i * (w - 2 * p)) / (series.length - 1);
      const sy = (v) => h - p - ((v - min) / Math.max(1e-9, max - min)) * (h - 2 * p);
      const points = series.map((x, i) => `${sx(i).toFixed(1)},${sy(x.accord).toFixed(1)}`).join(" ");
      spark = `<div class="timeline">
        <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Accord par période : ${series.map((x) => `${x.p} ${VV.fmtPct(x.accord)}`).join(", ")}">
          <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2"></polyline>
          ${series.map((x, i) => `<circle cx="${sx(i).toFixed(1)}" cy="${sy(x.accord).toFixed(1)}" r="2.6" fill="var(--accent)"></circle>`).join("")}
        </svg>
        <p class="fineprint">Accord par période — ${series.map((x) => `${VV.esc(x.p)} : ${VV.fmtPct(x.accord)}`).join(" · ")}</p>
      </div>`;
    }

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
          ${VV.essentielBadge(familyOfUid.get(s.u)?.fam)}
          ${s.dup && selPerimetre.value === "" ? `<span class="badge neutre" title="Vecteur de positions identique à un autre scrutin, neutralisé">doublon</span>` : ""}
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

    const robBlock = isFiltered() || excludeAbst
      ? `<p class="loading" style="margin:.4rem 0 0">Analyse de robustesse complète disponible sans filtre ni exclusion des abstentions (elle est précalculée sur l'ensemble des votes, abstention comptée comme position).</p>`
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
        <button type="button" class="ghost" id="partager-paire">Partager</button>
        <a href="#votes">Voir les votes ci-dessous ↓</a>
      </div>
      <p class="note" style="margin:.6rem 0 0">${perimetreTag ? `<strong>${perimetreTag}.</strong> ` : ""}${bilan}</p>
      ${spark}
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
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(300px, 100%),1fr));gap:var(--gap);margin-top:1.3rem">
        <div><h3>Votes qui les rapprochent</h3><ul class="impact">${convergences.map(voteItem).join("") || "<li>Aucun</li>"}</ul></div>
        <div><h3>Votes qui les opposent</h3><ul class="impact">${divergences.map(voteItem).join("") || "<li>Aucun</li>"}</ul></div>
      </div>`;

    renderVariants(key);

    box.querySelector("#partager-paire")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const morceaux = [
        `${selected.a} ↔ ${selected.b} : ${VV.fmtPct(stat.accord)} d'accord sur ${VV.fmtNum(stat.n)} votes partagés`,
        `kappa ${kap === null ? "–" : kap.toFixed(2)}`,
      ];
      if (best) morceaux.push(`convergence max « ${best.theme} » (${VV.fmtPct(best.accord)})`);
      if (worst && worst !== best) morceaux.push(`désaccord max « ${worst.theme} » (${VV.fmtPct(worst.accord)})`);
      if (selPerimetre.value === "essentiel") morceaux.push("périmètre : questions essentielles (votes orientés)");
      if (selPerimetre.value === "passage") morceaux.push("périmètre : un vote par texte (vote de passage)");
      const status = await VV.share({
        title: "Votes 2027 — comparaison de groupes",
        text: `Votes 2027 — ${morceaux.join(" · ")}.`,
        url: location.href,
      });
      if (status === "copied") {
        button.textContent = "Lien copié ✓";
        setTimeout(() => { button.textContent = "Partager"; }, 2000);
      }
    });
  }

  function renderVariants(key) {
    if (isFiltered() || excludeAbst) { document.getElementById("variants").innerHTML = ""; return; }
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
    renderPerimetreNote();
    syncUrl();
  }

  selTheme.addEventListener("change", renderAll);
  selPeriod.addEventListener("change", renderAll);
  selPerimetre.addEventListener("change", renderAll);
  elAbst?.addEventListener("change", () => {
    excludeAbst = elAbst.checked;
    renderAll();
  });
  document.getElementById("f-reset").addEventListener("click", () => {
    selTheme.value = "";
    selPeriod.value = "";
    selPerimetre.value = "";
    if (elAbst) elAbst.checked = false;
    excludeAbst = false;
    renderAll();
  });

  renderAll();
  renderGroups();
  renderRecent();
  renderMap();
})().catch((err) => {
  document.getElementById("pair-panel").innerHTML = `<p class="erreur">Erreur de chargement : ${VV.esc(err.message)}</p>`;
});
