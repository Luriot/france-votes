/* Questionnaire : des votes réels, pas des affirmations inventées */

(async () => {
  const state = await VV.loadAll();
  VV.renderRibbon();
  const data = await VV.loadJSON("questionnaire.json");
  const groupes = state.meta.groupes;
  const questions = data.questions;
  const answers = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem("vv-reponses") || "{}");
    for (const [uid, value] of Object.entries(saved)) answers.set(uid, value);
  } catch { /* stockage local indisponible : on continue sans */ }

  const themes = [...new Set(questions.map((q) => q.theme))];
  const container = document.getElementById("questions");
  const progress = document.getElementById("progress");

  function save() {
    try {
      localStorage.setItem("vv-reponses", JSON.stringify(Object.fromEntries(answers)));
    } catch { /* ignore */ }
  }

  function renderQuestions() {
    container.innerHTML = themes.map((theme) => `
      <section class="q-theme" data-theme="${VV.esc(theme)}">
        <h2 style="margin-top:1.4rem">${VV.esc(theme)}</h2>
        ${questions.filter((q) => q.theme === theme).map((q) => {
          const value = answers.get(q.uid);
          const pressed = (v) => (value === v ? ' aria-pressed="true"' : ' aria-pressed="false"');
          return `<article class="q-item" id="q-${VV.esc(q.uid)}">
            <p style="margin:0 0 .3rem"><span class="badge theme">${VV.esc(theme)}</span>
              <span class="badge neutre">${VV.fmtDate(q.date)}</span></p>
            <h3 style="margin-bottom:.2rem">${VV.esc(q.titre)}</h3>
            <p style="font-size:.82rem;color:var(--ink-faint);margin:0 0 .5rem">
              Scrutin n° ${Number(q.numero) || 0} — « pour » signifie voter pour ce texte / cet amendement.
              <a href="https://www.assemblee-nationale.fr/dyn/17/scrutins/${Number(q.numero) || 0}" target="_blank" rel="noopener">source officielle</a>.
              Sélection automatique : vote parmi les plus discriminants du thème (entropie ${VV.esc(String(q.entropie).replace(".", ","))}).
            </p>
            <div class="q-actions" role="group" aria-label="Votre position sur le scrutin ${Number(q.numero) || 0}">
              <button type="button" class="ghost" data-uid="${VV.esc(q.uid)}" data-value="1"${pressed(1)}>Pour</button>
              <button type="button" class="ghost" data-uid="${VV.esc(q.uid)}" data-value="-1"${pressed(-1)}>Contre</button>
              <button type="button" class="ghost" data-uid="${VV.esc(q.uid)}" data-value="0"${pressed(0)}>Abstention</button>
              <button type="button" class="ghost" data-uid="${VV.esc(q.uid)}" data-value="skip"${pressed("skip")}>Passer</button>
            </div>
          </article>`;
        }).join("")}
      </section>`).join("");

    container.querySelectorAll("button[data-uid]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const uid = btn.dataset.uid;
        if (btn.dataset.value === "skip") answers.delete(uid);
        else answers.set(uid, Number(btn.dataset.value));
        save();
        const article = btn.closest(".q-item");
        article.querySelectorAll("button[data-uid]").forEach((b) => {
          b.setAttribute("aria-pressed", String(b === btn && btn.dataset.value !== "skip"));
        });
        updateResults();
      });
    });
  }

  function updateResults() {
    const answered = questions.filter((q) => answers.has(q.uid));
    progress.textContent = `${answered.length} / ${questions.length} scrutins renseignés`;
    const box = document.getElementById("resultats");
    if (answered.length < 5) {
      box.innerHTML = `<p class="loading">Répondez à au moins 5 scrutins pour afficher une comparaison (${answered.length} pour l'instant). Chaque réponse supplémentaire affine le résultat.</p>`;
      return;
    }
    const perGroup = groupes.map((g, gi) => {
      let num = 0, den = 0;
      for (const q of answered) {
        const gp = q.positions[gi];
        if (gp === null) continue;
        const w = q.poids * q.parts[gi];
        num += w * (gp === answers.get(q.uid) ? 1 : 0);
        den += w;
      }
      return { ...g, accord: den > 0 ? num / den : null, n: answered.filter((q) => q.positions[gi] !== null).length };
    }).filter((g) => g.accord !== null).sort((a, b) => b.accord - a.accord);

    const best = perGroup[0];
    if (!best) {
      box.innerHTML = `<p class="loading">Aucune position de groupe déterminée sur les scrutins répondus pour l'instant.</p>`;
      return;
    }
    const drivers = (g, positive) => answered
      .map((q) => ({ q, gp: q.positions[groupes.findIndex((x) => x.sigle === g.sigle)], w: q.poids * q.parts[groupes.findIndex((x) => x.sigle === g.sigle)] }))
      .filter((x) => x.gp !== null && ((x.gp === answers.get(x.q.uid)) === positive))
      .sort((a, b) => b.w - a.w)
      .slice(0, 5);

    box.innerHTML = `
      <h2>Groupes dont les votes ressemblent le plus à vos réponses</h2>
      <p style="font-size:.85rem;color:var(--ink-soft)">Ceci n'est pas une consigne de vote. Le calcul compare vos réponses sur ${answered.length} scrutins réels aux positions des groupes à ces mêmes scrutins.</p>
      ${perGroup.map((g) => `<div class="result-row">
        <span class="stance" style="border-color:${VV.safeColor(g.couleur)};color:var(--ink)">${VV.esc(g.sigle)}</span>
        <span class="bar"><i style="width:${(g.accord * 100).toFixed(1)}%;background:${VV.safeColor(g.couleur)}"></i></span>
        <b>${VV.fmtPct(g.accord)}</b></div>`).join("")}
      <details class="aide"><summary>Pourquoi ${VV.esc(best.sigle)} arrive en tête ? (votes qui ont le plus pesé)</summary>
        <h3>Votes où vous êtes d'accord avec ${VV.esc(best.sigle)}</h3>
        <ul>${drivers(best, true).map((x) => `<li><a href="https://www.assemblee-nationale.fr/dyn/17/scrutins/${Number(x.q.numero) || 0}" target="_blank" rel="noopener">${VV.esc(x.q.titre)}</a> (poids ${x.w.toFixed(2)})</li>`).join("") || "<li>Aucun</li>"}</ul>
        <h3>Votes où vous êtes en désaccord</h3>
        <ul>${drivers(best, false).map((x) => `<li><a href="https://www.assemblee-nationale.fr/dyn/17/scrutins/${Number(x.q.numero) || 0}" target="_blank" rel="noopener">${VV.esc(x.q.titre)}</a> (poids ${x.w.toFixed(2)})</li>`).join("") || "<li>Aucun</li>"}</ul>
      </details>
      <p style="font-size:.8rem;color:var(--ink-faint)">Chaque vote pèse selon son thème (plafond 15 % par thème) et la participation du groupe à ce vote. Vous pouvez modifier vos réponses : le résultat se met à jour immédiatement, sans rien cacher.</p>`;
  }

  renderQuestions();
  updateResults();
})().catch((err) => {
  document.getElementById("progress").innerHTML = `<span class="erreur">Erreur de chargement : ${VV.esc(err.message)}</span>`;
});
