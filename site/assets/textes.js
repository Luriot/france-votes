/* Textes essentiels : position des 12 groupes sur le vote de passage de chaque texte.
   Données légères : meta.json + questionnaire.json (aucun scrutins.json). */

(async () => {
  const meta = await VV.loadRibbon();
  const questions = await VV.loadQuestionnaire();
  const groups = meta.groupes;
  const params = new URLSearchParams(location.search);
  const highlight = new Set(VV.highlightSigs(params.get("a"), params.get("b")));

  const familyVotes = new Map();
  for (const fam of questions.families) for (const vote of fam.votes) familyVotes.set(vote.u, vote);
  const stances = questions.families.map((fam) => ({ fam, st: VV.familyStances(fam, familyVotes) }));

  const elSearch = document.getElementById("f-recherche");
  const elTheme = document.getElementById("f-theme");
  const elCount = document.getElementById("resultat-count");
  for (const theme of [...new Set(stances.map((s) => s.fam.theme))].sort((a, b) => a.localeCompare(b, "fr"))) {
    elTheme.append(new Option(theme, theme));
  }
  if (params.get("theme") && [...elTheme.options].some((option) => option.value === params.get("theme"))) {
    elTheme.value = params.get("theme");
  }
  if (params.get("q")) elSearch.value = params.get("q");

  document.getElementById("textes-head").innerHTML = `<tr><th scope="col">Texte</th>${groups
    .map((g) => `<th scope="col" class="${highlight.has(g.sigle) ? "col-hi" : ""}"><a href="groupe.html?g=${encodeURIComponent(g.sigle)}" title="Fiche de ${VV.esc(g.nom)}">${VV.esc(g.sigle)}</a></th>`).join("")}</tr>`;

  function filtered() {
    const theme = elTheme.value;
    const query = elSearch.value.trim();
    return stances.filter(({ fam }) =>
      (theme === "" || fam.theme === theme) && VV.matchesQuery({ n: null, ti: fam.label }, query));
  }

  function voteList(fam) {
    return `<details class="aide"><summary>${fam.votes.length} vote${fam.votes.length > 1 ? "s" : ""} rattaché${fam.votes.length > 1 ? "s" : ""}</summary>
      <ul class="vote-list">${fam.votes.map((vote) => `<li>
        <a href="https://www.assemblee-nationale.fr/dyn/17/scrutins/${Number(vote.n) || 0}" target="_blank" rel="noopener">${VV.esc(vote.ti || `scrutin n° ${vote.n}`)}</a>
        <span class="date">${VV.fmtDate(vote.d)} · ${vote.dir === 1 ? "voté comme le texte" : "voté contre le texte"}</span>
      </li>`).join("")}</ul></details>`;
  }

  function render() {
    const rows = filtered();
    elCount.textContent = `${VV.fmtNum(rows.length)} texte${rows.length > 1 ? "s" : ""} essentiel${rows.length > 1 ? "s" : ""}` +
      (highlight.size ? ` · colonnes surlignées : ${[...highlight].map((s) => VV.esc(s)).join(", ")}` : "");
    const body = [];
    let currentTheme = null;
    for (const { fam, st } of rows) {
      if (elTheme.value === "" && fam.theme !== currentTheme) {
        currentTheme = fam.theme;
        body.push(`<tr class="theme-row"><th colspan="${groups.length + 1}">${VV.esc(fam.theme)}</th></tr>`);
      }
      const cells = groups.map((g, i) => {
        const diverge = st.divergences[i];
        const majorite = st.partagee[i] ? "partagée (égalité)" : VV.positionLabel(st.majorite[i]);
        const title = `${g.sigle} : ${VV.positionLabel(st.passage[i])} (vote de passage)`
          + (diverge ? ` — position pondérée par la participation sur les ${fam.votes.length} votes du texte : ${majorite}` : "");
        return `<td class="stance-cell${highlight.has(g.sigle) ? " col-hi" : ""}">${VV.positionChip(st.passage[i], title, diverge)}</td>`;
      }).join("");
      body.push(`<tr>
        <th scope="row" class="stance-label">
          <a href="questionnaire.html?affiner=${encodeURIComponent(fam.id)}">${VV.esc(fam.label)}</a>
          <span class="date">${VV.fmtDate(fam.votes.find((vote) => vote.u === fam.anchor)?.d ?? fam.dates[0])}</span>
          ${voteList(fam)}
        </th>${cells}</tr>`);
    }
    const empty = `<tr><td colspan="${groups.length + 1}">Aucun texte essentiel pour ces critères.</td></tr>`;
    document.getElementById("textes-body").innerHTML = body.length ? body.join("") : empty;
  }

  for (const el of [elSearch, elTheme]) el.addEventListener("input", render);
  elTheme.addEventListener("change", render);
  document.getElementById("partager-textes").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const etat = await VV.share({
      title: "Votes 2027 — textes essentiels",
      text: `Position des ${groups.length} groupes de l'Assemblée sur le vote de passage des ${stances.length} textes essentiels.`,
      url: `${location.origin}${location.pathname}`,
    });
    if (etat === "copied") {
      button.textContent = "Lien copié ✓";
      setTimeout(() => { button.textContent = "Partager cette page"; }, 2000);
    }
  });
  render();
})().catch((err) => {
  document.getElementById("resultat-count").innerHTML = `<span class="erreur">Erreur de chargement : ${VV.esc(err.message)}</span>`;
});
