/* Fiche groupe : voisins, participation, cohésion et position sur les textes essentiels.
   Données légères : meta.json + agreement.json + questionnaire.json (aucun scrutins.json). */

(async () => {
  const meta = await VV.loadRibbon();
  const agreement = await VV.loadJSON("agreement.json");
  const questions = await VV.loadQuestionnaire();
  const groups = meta.groupes;
  const params = new URLSearchParams(location.search);
  const requested = params.get("g");
  const sigle = groups.some((g) => g.sigle === requested) ? requested : groups[0].sigle;
  const profile = VV.groupProfile(agreement, sigle);
  if (!profile) {
    document.getElementById("g-carte").innerHTML = `<p class="erreur">Groupe inconnu.</p>`;
    return;
  }
  document.title = `${sigle} — Votes 2027`;
  VV.setText("g-titre", sigle);

  document.getElementById("g-chips").innerHTML = groups.map((g) =>
    `<a href="groupe.html?g=${encodeURIComponent(g.sigle)}"${g.sigle === sigle ? ' aria-current="true"' : ""}>${VV.esc(g.sigle)}</a>`
  ).join("");

  const group = profile.profile;
  const elCarte = document.getElementById("g-carte");
  elCarte.innerHTML = `
    <div class="pair-head">
      <div><p class="eyebrow" style="margin:0">${VV.esc(group.nom)}</p>
        <div class="pair-score" style="color:${VV.safeColor(group.couleur)}">${VV.esc(sigle)}</div></div>
      <div class="pair-meta">
        <div>${VV.fmtNum(group.membres ?? 0)} membres</div>
        <div>participations déterminées : ${VV.fmtPct(group.participation)}</div>
        <div>unité (Rice) : ${group.cohesion === null || group.cohesion === undefined ? "–" : `${group.cohesion.toFixed(1).replace(".", ",")} %`}</div>
      </div>
      <div style="flex:1"></div>
      <button type="button" class="ghost" id="partager-groupe">Partager</button>
      <a href="index.html?a=${encodeURIComponent(sigle)}">Comparer ce groupe →</a>
    </div>`;

  const elRang = document.getElementById("g-rang");
  elRang.innerHTML = `<h2>Quels groupes votent comme ${VV.esc(sigle)} ?</h2>
    <ul class="rank-list">${profile.others.map((x, i) => `<li><a class="rank-row" href="index.html?a=${encodeURIComponent(sigle)}&b=${encodeURIComponent(x.sigle)}">
      <span class="who"><i style="background:${VV.safeColor(x.couleur)}"></i>${i + 1}. ${VV.esc(x.sigle)}
        <span class="full">${VV.esc(x.nom)}</span>
        <span class="why" title="Nombre de scrutins où les deux groupes ont voté la même chose, sur le total des scrutins où les deux ont une position déterminée">${VV.fmtNum(x.accordes)} d'accord sur ${VV.fmtNum(x.n)} scrutins</span></span>
      <span class="track"><i style="width:${(x.accord * 100).toFixed(1)}%"></i></span>
      <span class="pct">${VV.fmtPct(x.accord)}</span></a></li>`).join("")}</ul>
    <p class="fineprint">Accord pondéré sur tous les scrutins (calcul principal, abstentions comptées) ;
    kappa de Cohen disponible dans la fiche de paire.</p>`;

  const familyVotes = new Map();
  for (const fam of questions.families) for (const vote of fam.votes) familyVotes.set(vote.u, vote);
  const gi = groups.findIndex((g) => g.sigle === sigle);
  const stances = questions.families.map((fam) => ({ fam, st: VV.familyStances(fam, familyVotes) }));
  const counts = { 1: 0, 0: 0, "-1": 0, null: 0 };
  for (const { st } of stances) counts[st.passage[gi] === null ? "null" : String(st.passage[gi])] += 1;

  const elTextes = document.getElementById("g-textes");
  elTextes.innerHTML = `<h2>Position sur les ${VV.fmtNum(stances.length)} textes essentiels</h2>
    <p class="filters-result">${counts["1"]} pour · ${counts["-1"]} contre · ${counts["0"]} abstentions · ${counts.null} indéterminées</p>
    <p class="fineprint">Position du groupe sur le vote de passage de chaque texte (lecture directe).
    Une pastille cerclée signale une position majoritaire du texte différente du vote de passage —
    un désaccord de méthode ou de rédaction possible, pas nécessairement de fond (méthodologie §11).</p>
    <div class="table-scroll"><table class="data stances" aria-label="Position de ${VV.esc(sigle)} sur les textes essentiels">
      <thead><tr><th scope="col">Texte</th><th scope="col">Position</th><th scope="col">Date</th></tr></thead>
      <tbody>${stances.map(({ fam, st }) => {
        const value = st.passage[gi];
        const diverge = st.divergences[gi];
        const majorite = st.partagee[gi] ? "partagée (égalité)" : VV.positionLabel(st.majorite[gi]);
        const title = `${sigle} : ${VV.positionLabel(value)} (vote de passage)`
          + (diverge ? ` — position pondérée par la participation sur les ${fam.votes.length} votes du texte : ${majorite}` : "");
        return `<tr>
          <th scope="row" class="stance-label"><a href="questionnaire.html?affiner=${encodeURIComponent(fam.id)}">${VV.esc(fam.label)}</a>
            <span class="date">${VV.esc(fam.theme)} · ${VV.fmtDate(fam.votes.find((vote) => vote.u === fam.anchor)?.d ?? fam.dates[0])}</span></th>
          <td class="stance-cell">${VV.positionChip(value, title, diverge)}</td>
          <td class="num">${VV.fmtDate(fam.dates[0])}</td>
        </tr>`;
      }).join("")}</tbody></table></div>`;

  elCarte.querySelector("#partager-groupe").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const top = profile.others[0], low = profile.others[profile.others.length - 1];
    if (!top || !low) return;
    const texte = `Votes 2027 — ${sigle} : plus proche de ${top.sigle} (${VV.fmtPct(top.accord)}), `
      + `plus loin de ${low.sigle} (${VV.fmtPct(low.accord)}). Sur ${stances.length} textes essentiels : `
      + `${counts["1"]} pour, ${counts["-1"]} contre.`;
    const etat = await VV.share({ title: `Votes 2027 — ${sigle}`, text: texte, url: location.href });
    if (etat === "copied") {
      button.textContent = "Lien copié ✓";
      setTimeout(() => { button.textContent = "Partager"; }, 2000);
    }
  });
})().catch((err) => {
  document.getElementById("g-carte").innerHTML = `<p class="erreur">Erreur de chargement : ${VV.esc(err.message)}</p>`;
});
