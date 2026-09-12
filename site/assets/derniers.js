/* Derniers votes : fil des scrutins les plus récents et résumé des 30 derniers jours de séance. */

(async () => {
  const state = await VV.loadAll();
  VV.renderRibbon();
  const TYPES = { SPO: "Scrutin public ordinaire", SPS: "Scrutin public solennel", MOC: "Motion de censure" };
  const VUS_KEY = "vv-derniers-vus";
  const FEED = 60;

  const sorted = [...state.scrutins].sort((a, b) => b.n - a.n);
  const dernier = sorted[0];
  const elResume = document.getElementById("resume");
  const elNouveautes = document.getElementById("nouveautes");
  const elFlux = document.getElementById("flux");
  const elNote = document.getElementById("flux-note");

  // « Nouveaux depuis votre dernière visite » : mémorisé sur l'appareil, aucun serveur.
  let vus = null;
  try { vus = Number(localStorage.getItem(VUS_KEY)) || null; } catch { vus = null; }
  const nouveaux = vus === null ? [] : sorted.filter((s) => s.n > vus);
  const nouveauxUids = new Set(nouveaux.map((s) => s.u));
  try { localStorage.setItem(VUS_KEY, String(dernier.n)); } catch { /* stockage indisponible */ }

  // Fenêtre des 30 derniers jours de séance, calée sur le dernier scrutin publié et non sur la
  // date du jour : pendant les vacances parlementaires, le résumé reste parlant.
  const fin = new Date(`${dernier.d}T12:00:00Z`);
  const debutIso = new Date(fin.getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const fenetre = state.scrutins.filter((s) => s.d >= debutIso);
  const adoptes = fenetre.filter((s) => s.r === "adopté").length;
  const serres = fenetre.filter((s) => Math.abs(s.m) <= 10).length;
  const censures = fenetre.filter((s) => s.t === "MOC").length;
  const themes = {};
  for (const s of fenetre) themes[s.th] = (themes[s.th] || 0) + 1;
  const dominant = Object.entries(themes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr"))[0];

  function jourLong(iso) {
    return new Intl.DateTimeFormat("fr-FR", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    }).format(new Date(`${iso}T12:00:00Z`));
  }

  elResume.innerHTML = `
    <h2>Les 30 derniers jours de séance</h2>
    <p class="filters-result">du ${VV.fmtDate(debutIso)} au ${VV.fmtDate(dernier.d)}</p>
    <p><strong>${VV.fmtNum(fenetre.length)} scrutins</strong> — ${VV.fmtNum(adoptes)} adoptés,
    ${VV.fmtNum(fenetre.length - adoptes)} rejetés${serres ? `, ${VV.fmtNum(serres)} serrés` : ""}${censures ? `, ${VV.fmtNum(censures)} motion${censures > 1 ? "s" : ""} de censure` : ""}.${dominant ? ` Thème dominant : <strong>${VV.esc(dominant[0])}</strong>.` : ""}</p>
    <p>Dernier scrutin publié : <a href="${VV.sourceUrl(dernier)}" target="_blank" rel="noopener">${VV.esc(dernier.ti)}</a>
    <span class="date">(${VV.fmtDate(dernier.d)})</span></p>
    <p class="q-actions"><button type="button" class="primary" id="partager-resume">Partager ce résumé</button>
    <a href="votes.html">Explorer tous les scrutins →</a></p>`;

  elResume.querySelector("#partager-resume")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const texte = `À l'Assemblée nationale, du ${VV.fmtDate(debutIso)} au ${VV.fmtDate(dernier.d)} : `
      + `${fenetre.length} scrutins, ${adoptes} adoptés, ${fenetre.length - adoptes} rejetés`
      + (serres ? `, ${serres} serrés` : "")
      + (censures ? `, ${censures} motion${censures > 1 ? "s" : ""} de censure` : "")
      + `. Dernier vote : « ${dernier.ti} » (${VV.fmtDate(dernier.d)}).`;
    const etat = await VV.share({ title: "Votes 2027 — derniers votes", text: texte, url: location.href });
    if (etat === "copied") {
      button.textContent = "Lien copié ✓";
      setTimeout(() => { button.textContent = "Partager ce résumé"; }, 2000);
    }
  });

  if (nouveaux.length) {
    elNouveautes.hidden = false;
    elNouveautes.innerHTML = `<strong>${VV.fmtNum(nouveaux.length)} nouveau${nouveaux.length > 1 ? "x" : ""} scrutin${nouveaux.length > 1 ? "s" : ""}</strong> depuis votre dernière visite, du ${VV.fmtDate(nouveaux[nouveaux.length - 1].d)} au ${VV.fmtDate(nouveaux[0].d)}.`;
  }

  function item(s) {
    return `<article class="flux-item">
      <h3><a href="${VV.sourceUrl(s)}" target="_blank" rel="noopener">${VV.esc(s.ti)}</a></h3>
      <p class="flux-meta">
        <span class="badge theme">${VV.esc(s.th)}</span>
        <span class="badge ${s.r === "adopté" ? "adopte" : "rejete"}">${VV.esc(s.r || "–")}</span>
        <span class="badge neutre">${VV.esc(TYPES[s.t] || s.t)}</span>
        ${Math.abs(s.m) <= 10 ? `<span class="badge neutre" title="Écart à la majorité (pour − contre ; pour − seuil requis pour une motion de censure)">serré · ${s.m > 0 ? "+" : ""}${s.m}</span>` : ""}
        ${s.pv?.length ? `<span class="badge neutre" title="Groupe(s) dont le basculement changerait à lui seul le résultat">décisif : ${s.pv.slice(0, 3).map((i) => VV.esc(state.meta.groupes[i].sigle)).join(", ")}${s.pv.length > 3 ? "…" : ""}</span>` : ""}
        ${s.b === 0 ? `<span class="badge neutre" title="Vecteur de positions identique à un autre scrutin, neutralisé dans les scores">doublon</span>` : ""}
        ${s.ind ? `<span class="badge neutre">données groupes indisponibles</span>` : ""}
        ${nouveauxUids.has(s.u) ? `<span class="badge neuf">nouveau</span>` : ""}
      </p>
      <p class="flux-positions">${VV.positionChips(s)}</p>
    </article>`;
  }

  const shown = sorted.slice(0, FEED);
  let html = "";
  let jour = null;
  for (const s of shown) {
    if (s.d !== jour) {
      jour = s.d;
      html += `<h3 class="flux-jour">${VV.esc(jourLong(jour))}</h3>`;
    }
    html += item(s);
  }
  elFlux.innerHTML = html;
  elNote.textContent = sorted.length > FEED
    ? `Affichage des ${FEED} scrutins les plus récents — utilisez l'explorateur pour les ${VV.fmtNum(sorted.length - FEED)} autres.`
    : `${VV.fmtNum(sorted.length)} scrutins affichés.`;
})().catch((err) => {
  document.getElementById("resume").innerHTML = `<span class="erreur">Erreur de chargement : ${VV.esc(err.message)}</span>`;
});
