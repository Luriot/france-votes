/* Questionnaire : questions « Essentiel » (un texte = une question, agrégée sur ses votes),
   avec affinage vote par vote possible pour chaque texte. */

(async () => {
  const state = await VV.loadAll();
  VV.renderRibbon();
  const data = await VV.loadJSON("questionnaire.json");
  const groupes = state.meta.groupes;
  const families = data.families ?? [];
  const byUid = new Map(state.scrutins.map((s) => [s.u, s]));
  const familyOfUid = new Map();
  for (const fam of families) for (const vote of fam.votes) familyOfUid.set(vote.u, fam);

  const answers = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem("vv-reponses") || "{}");
    for (const [key, value] of Object.entries(saved)) {
      if (key.includes(":")) answers.set(key, value);
      else answers.set(`u:${key}`, value); // migration des réponses v1 (uid nu)
    }
  } catch { /* stockage local indisponible : on continue sans */ }

  const params = new URLSearchParams(location.search);
  const requested = params.get("affiner");
  let focusFamily = requested && families.some((fam) => fam.id === requested) ? requested : null;

  const container = document.getElementById("questions");
  const box = document.getElementById("resultats");
  const progress = document.getElementById("progress");

  const POSITION_LABEL = { 1: "Pour", 0: "Abstention", "-1": "Contre" };
  const familyAnswer = (fam) => answers.get(`f:${fam.id}`);
  const directAnswer = (uid) => answers.get(`u:${uid}`);
  const effective = (uid) => {
    const direct = directAnswer(uid);
    if (direct !== undefined) return { value: direct, source: "direct" };
    const fam = familyOfUid.get(uid);
    const inherited = fam ? familyAnswer(fam) : undefined;
    return inherited === undefined ? null : { value: inherited, source: "herite" };
  };

  function save() {
    try { localStorage.setItem("vv-reponses", JSON.stringify(Object.fromEntries(answers))); } catch { /* ignore */ }
  }

  function setFocus(familyId) {
    focusFamily = familyId;
    history.replaceState(null, "", familyId ? `${location.pathname}?affiner=${encodeURIComponent(familyId)}` : location.pathname);
    render();
  }

  /* --- rendu --- */

  function answerButtons({ uid, familyId, allowAbstention }) {
    const value = familyId ? familyAnswer({ id: familyId }) : directAnswer(uid);
    const pressed = (v) => (value === v ? ' aria-pressed="true"' : ' aria-pressed="false"');
    const attr = familyId ? `data-family="${VV.esc(familyId)}"` : `data-uid="${VV.esc(uid)}"`;
    return `<div class="q-actions" role="group" aria-label="Votre position">
      <button type="button" class="ghost" ${attr} data-value="1"${pressed(1)}>Pour</button>
      <button type="button" class="ghost" ${attr} data-value="-1"${pressed(-1)}>Contre</button>
      ${allowAbstention ? `<button type="button" class="ghost" ${attr} data-value="0"${pressed(0)}>Abstention</button>` : ""}
      <button type="button" class="ghost" ${attr} data-value="skip"${pressed("skip")}>Passer</button>
    </div>`;
  }

  function familyCard(fam) {
    const overrides = fam.votes.filter((vote) => directAnswer(vote.u) !== undefined).length;
    const years = [...new Set(fam.dates.map((d) => d.slice(0, 4)))].join("–");
    const shown = fam.votes.slice(0, 12);
    const votelist = shown.map((vote) => {
      const s = byUid.get(vote.u);
      const titre = s ? s.ti : `scrutin n° ${vote.n}`;
      return `<li><a href="https://www.assemblee-nationale.fr/dyn/17/scrutins/${Number(vote.n) || 0}" target="_blank" rel="noopener">${VV.esc(titre)}</a> <span class="date">${VV.fmtDate(vote.d)}</span></li>`;
    }).join("") + (fam.votes.length > shown.length
      ? `<li class="fineprint">… et ${fam.votes.length - shown.length} autre${fam.votes.length - shown.length > 1 ? "s" : ""} vote${fam.votes.length - shown.length > 1 ? "s" : ""} du même texte (tous pris en compte)</li>` : "");
    return `<article class="q-item" id="q-${VV.esc(fam.id)}">
      <p class="q-meta"><span class="badge theme">${VV.esc(fam.theme)}</span>
        <span class="badge neutre">${VV.esc(years)}</span>
        <span class="badge neutre">${fam.votes.length} vote${fam.votes.length > 1 ? "s" : ""} rattaché${fam.votes.length > 1 ? "s" : ""}</span>
        ${overrides ? `<span class="badge neutre">affiné : ${overrides}/${fam.votes.length}</span>` : ""}</p>
      <h3>${VV.esc(fam.label)}</h3>
      ${fam.kind === "motion de censure" ? `<p class="fineprint">L'Assemblée ne recense que les votes favorables à une motion de censure : « Contre » signifie que le groupe ne l'a pas soutenue.</p>` : ""}
      <details class="aide"><summary>Voir les ${fam.votes.length} vote${fam.votes.length > 1 ? "s" : ""} rattaché${fam.votes.length > 1 ? "s" : ""} à ce texte</summary><ul class="vote-list">${votelist}</ul></details>
      ${answerButtons({ familyId: fam.id, allowAbstention: fam.kind !== "motion de censure" })}
      ${fam.votes.length > 1 ? `<button type="button" class="ghost affiner" data-family="${VV.esc(fam.id)}">Affiner vote par vote (${fam.votes.length}) →</button>` : ""}
    </article>`;
  }

  function renderEssentiel() {
    const themes = [...new Set(families.map((fam) => fam.theme))];
    container.innerHTML = themes.map((theme) => `
      <section class="q-theme">
        <h2 style="margin-top:1.4rem">${VV.esc(theme)}</h2>
        ${families.filter((fam) => fam.theme === theme).map(familyCard).join("")}
      </section>`).join("");
  }

  function detailedCard(uid) {
    const s = byUid.get(uid);
    if (!s) return "";
    const eff = effective(uid);
    const fam = familyOfUid.get(uid);
    const inherited = eff && eff.source === "herite"
      ? `<span class="badge neutre">hérite de votre réponse : ${POSITION_LABEL[eff.value] ?? "–"}</span>` : "";
    const reset = fam && directAnswer(uid) !== undefined
      ? `<button type="button" class="ghost reset-uid" data-uid="${VV.esc(uid)}">Revenir à la réponse du texte</button>` : "";
    return `<article class="q-item" id="q-${VV.esc(uid)}">
      <p class="q-meta"><span class="badge theme">${VV.esc(s.th)}</span>
        <span class="badge neutre">${VV.fmtDate(s.d)}</span> ${inherited}</p>
      <h3>${VV.esc(s.ti)}</h3>
      <p class="fineprint">Scrutin n° ${Number(s.n) || 0} ·
        <a href="${VV.sourceUrl(s)}" target="_blank" rel="noopener">source officielle</a></p>
      ${answerButtons({ uid, allowAbstention: true })}
      ${reset}
    </article>`;
  }

  const FOCUS_LIMIT = 25;
  const voteWeight = (vote) => {
    const s = byUid.get(vote.u);
    if (!s) return 0;
    const parts = s.q.length ? s.q.reduce((acc, value) => acc + value, 0) / s.q.length : 0;
    return s.f * parts;
  };

  function renderFocus() {
    const focus = families.find((fam) => fam.id === focusFamily);
    if (!focus) { setFocus(null); return; }
    const sorted = [...focus.votes].sort((a, b) => voteWeight(b) - voteWeight(a));
    const shown = sorted.slice(0, FOCUS_LIMIT);
    const hidden = sorted.length - shown.length;
    container.innerHTML = `<section class="q-theme">
      <p class="eyebrow" style="margin-top:1.4rem">Affiner un texte</p>
      <h2>${VV.esc(focus.label)}</h2>
      <p class="fineprint">Vos réponses vote par vote remplacent la réponse donnée sur le texte.
      ${hidden > 0 ? `Les ${FOCUS_LIMIT} votes les plus significatifs sont affichés ci-dessous ; les ${hidden} autres comptent via votre réponse de texte.` : ""}</p>
      ${shown.map((vote) => detailedCard(vote.u)).join("")}
      <button type="button" class="ghost" id="exit-focus">← Revenir à toutes les questions</button>
    </section>`;
  }

  /* --- résultats --- */

  function answeredScrutins() {
    const out = [];
    for (const fam of families) {
      const inherited = familyAnswer(fam);
      for (const vote of fam.votes) {
        const direct = directAnswer(vote.u);
        const value = direct !== undefined ? direct : inherited;
        if (value === undefined) continue;
        out.push({ uid: vote.u, value, dir: vote.dir, fam, vote });
      }
    }
    return out;
  }

  function questionStats() {
    const answeredFamilies = families.filter((fam) => familyAnswer(fam) !== undefined).length;
    const orphanVotes = [...answers.keys()]
      .filter((key) => key.startsWith("u:"))
      .map((key) => key.slice(2))
      .filter((uid) => {
        const fam = familyOfUid.get(uid);
        return !fam || familyAnswer(fam) === undefined;
      }).length;
    return { answeredFamilies, questionCount: answeredFamilies + orphanVotes };
  }

  function updateResults() {
    const answered = answeredScrutins();
    const { answeredFamilies, questionCount } = questionStats();
    const refinedCount = [...answers.keys()].filter((key) => key.startsWith("u:")).length;
    progress.textContent = `${questionCount} question${questionCount > 1 ? "s" : ""} répondue${questionCount > 1 ? "s" : ""}` +
      ` — ${answered.length} vote${answered.length > 1 ? "s" : ""} pris en compte` +
      (refinedCount ? ` · ${refinedCount} affiné${refinedCount > 1 ? "s" : ""}` : "");
    if (questionCount < 5) {
      box.innerHTML = `<p class="loading">Répondez à au moins 5 questions pour afficher une comparaison (${questionCount} pour l'instant). Chaque réponse supplémentaire affine le résultat.</p>`;
      return;
    }
    // Chaque question pèse 1 : une réponse est répartie entre les votes du texte selon le poids de
    // chaque vote (thème × participation) ; une réponse affinée remplace l'héritage pour ce vote.
    const perGroup = groupes.map((g, gi) => {
      let ratioSum = 0, n = 0;
      const drivers = [];
      for (const fam of families) {
        const inherited = familyAnswer(fam);
        const items = [];
        for (const vote of fam.votes) {
          const direct = directAnswer(vote.u);
          const value = direct !== undefined ? direct : inherited;
          if (value === undefined) continue;
          const s = byUid.get(vote.u);
          if (!s) continue;
          const raw = vote.p ? vote.p[gi] : s.p[gi];
          if (raw === null || raw === undefined) continue;
          const gp = vote.dir === 1 ? raw : -raw;
          items.push({ s, label: fam.label, w: s.f * s.q[gi], agree: gp === value });
        }
        const total = items.reduce((acc, item) => acc + item.w, 0);
        if (!items.length || total <= 0) continue;
        n += 1;
        ratioSum += items.reduce((acc, item) => acc + item.w * (item.agree ? 1 : 0), 0) / total;
        for (const item of items) drivers.push({ ...item, w: item.w / total });
      }
      return { ...g, accord: n > 0 ? ratioSum / n : null, n, drivers };
    }).filter((g) => g.accord !== null).sort((a, b) => b.accord - a.accord);

    if (!perGroup.length) {
      box.innerHTML = `<p class="loading">Aucune position de groupe déterminée sur ces votes pour l'instant.</p>`;
      return;
    }
    const best = perGroup[0];
    const topDrivers = (positive) => best.drivers
      .filter((d) => d.agree === positive)
      .sort((a, b) => b.w - a.w)
      .slice(0, 5);

    box.innerHTML = `
      <h2>Groupes dont les votes ressemblent le plus à vos réponses</h2>
      <p style="font-size:.85rem;color:var(--ink-soft)">Ceci n'est pas une consigne de vote. Le calcul compare vos réponses (${answeredFamilies} texte${answeredFamilies > 1 ? "s" : ""}) aux positions des groupes, sur ${answered.length} vote${answered.length > 1 ? "s" : ""} pris en compte.</p>
      ${perGroup.map((g) => `<div class="result-row">
        <span class="stance" style="border-color:${VV.safeColor(g.couleur)};color:var(--ink)">${VV.esc(g.sigle)}</span>
        <span class="bar"><i style="width:${(g.accord * 100).toFixed(1)}%;background:${VV.safeColor(g.couleur)}"></i></span>
        <b>${VV.fmtPct(g.accord)}</b></div>`).join("")}
      <details class="aide"><summary>Pourquoi ${VV.esc(best.sigle)} arrive en tête ? (votes qui ont le plus pesé)</summary>
        <h3>Votes où vous êtes d'accord avec ${VV.esc(best.sigle)}</h3>
        <ul>${topDrivers(true).map((d) => `<li>${VV.esc(d.label)} <span class="date">(poids ${d.w.toFixed(2)})</span></li>`).join("") || "<li>Aucun</li>"}</ul>
        <h3>Votes où vous êtes en désaccord</h3>
        <ul>${topDrivers(false).map((d) => `<li>${VV.esc(d.label)} <span class="date">(poids ${d.w.toFixed(2)})</span></li>`).join("") || "<li>Aucun</li>"}</ul>
      </details>
      <p style="font-size:.8rem;color:var(--ink-faint)">Chaque question pèse autant qu'une autre : une réponse est répartie entre les votes de son texte selon le thème (plafond de 15 % sur le poids de base) et la participation du groupe. La déduplication du corpus ne s'applique pas ici.</p>`;
  }

  /* --- interactions --- */

  container.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const familyId = button.dataset.family;
    const uid = button.dataset.uid;
    if (button.classList.contains("reset-uid")) {
      answers.delete(`u:${button.dataset.uid}`);
    } else if (button.dataset.value !== undefined) {
      const key = familyId ? `f:${familyId}` : `u:${uid}`;
      if (button.dataset.value === "skip") answers.delete(key);
      else answers.set(key, Number(button.dataset.value));
    } else if (button.classList.contains("affiner")) {
      save();
      setFocus(familyId);
      document.querySelector("main")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    } else if (button.id === "exit-focus") {
      setFocus(null);
      return;
    } else {
      return;
    }
    save();
    render();
  });

  function render() {
    if (focusFamily) renderFocus();
    else renderEssentiel();
    updateResults();
  }

  render();
})().catch((err) => {
  document.getElementById("progress").innerHTML = `<span class="erreur">Erreur de chargement : ${VV.esc(err.message)}</span>`;
});
