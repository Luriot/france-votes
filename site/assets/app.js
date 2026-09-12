/* Votes 2027 — utilitaires partagés (aucune dépendance) */

document.documentElement.classList.add("js");

const VV = (() => {
  const cache = {};
  let state = null;

  const SPARK_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 0c1.05 7.02 4.93 10.95 12 12-7.07 1.05-10.95 4.98-12 12-1.05-7.02-4.93-10.95-12-12C7.07 10.95 10.95 7.02 12 0Z"/>' +
    "</svg>";

  function initSignature() {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (!reduce) {
      // Étincelles au clic : 4 étoiles projetées à 3,5rem, jitter ±0,4 rad, 650 ms.
      document.addEventListener("click", (event) => {
        for (let i = 0; i < 4; i += 1) {
          const spark = document.createElement("span");
          spark.className = "spark";
          spark.setAttribute("aria-hidden", "true");
          spark.innerHTML = SPARK_SVG;
          spark.style.left = `${event.clientX}px`;
          spark.style.top = `${event.clientY}px`;
          const angle = (i * Math.PI) / 2 - Math.PI / 2 + (Math.random() - 0.5) * 0.8;
          const distance = 42;
          const dx = Math.cos(angle) * distance;
          const dy = Math.sin(angle) * distance;
          const rotation = (Math.random() - 0.5) * 300;
          spark.animate(
            [
              { transform: "translate(-50%,-50%) translate(0,0) scale(0.2) rotate(0deg)", opacity: 0 },
              {
                transform: `translate(-50%,-50%) translate(${(dx * 0.4).toFixed(1)}px,${(dy * 0.4).toFixed(1)}px) scale(1) rotate(${(rotation * 0.4).toFixed(1)}deg)`,
                opacity: 0.92,
                offset: 0.4,
              },
              {
                transform: `translate(-50%,-50%) translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) scale(0.45) rotate(${rotation.toFixed(1)}deg)`,
                opacity: 0,
              },
            ],
            { duration: 650, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)", fill: "forwards" },
          );
          document.body.append(spark);
          window.setTimeout(() => spark.remove(), 720);
        }
      });
      let lastY = window.scrollY || 0;
      window.addEventListener?.("scroll", () => {
        const header = document.querySelector("header.site");
        const y = window.scrollY || 0;
        if (y > lastY + 8 && y > 120) header?.classList.add("is-hidden");
        else if (y < lastY - 8 || y <= 120) header?.classList.remove("is-hidden");
        lastY = y;
      }, { passive: true });
    }
    const targets = document.querySelectorAll("main .block, .hero > *");
    if (!("IntersectionObserver" in window)) {
      targets.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      let delay = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.style.transitionDelay = `${delay}s`;
        delay = Math.min(delay + 0.09, 0.36);
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    targets.forEach((el) => observer.observe(el));
  }

  async function loadJSON(name) {
    if (cache[name]) return cache[name];
    const res = await fetch(`data/${name}`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    cache[name] = await res.json();
    return cache[name];
  }

  async function loadAll() {
    const [meta, scrutins, agreement] = await Promise.all([
      loadJSON("meta.json"), loadJSON("scrutins.json"), loadJSON("agreement.json"),
    ]);
    state = { meta, scrutins, agreement, byUid: new Map(scrutins.map((s) => [s.u, s])) };
    return state;
  }

  const QUESTIONNAIRE_VERSION = 4;

  // Questionnaire enrichi (votes `ti/p/q/f`) : si une version antérieure vient du cache HTTP
  // (max-age 1 h), on force une relecture réseau pour ne pas planter sur des champs absents.
  async function loadQuestionnaire() {
    let data = await loadJSON("questionnaire.json");
    if (data.version !== QUESTIONNAIRE_VERSION) {
      const res = await fetch(`data/questionnaire.json?v=${QUESTIONNAIRE_VERSION + 1}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`questionnaire.json: HTTP ${res.status}`);
      data = await res.json();
      if (data.version !== QUESTIONNAIRE_VERSION) {
        throw new Error("questionnaire.json obsolète — rechargez la page.");
      }
      cache["questionnaire.json"] = data;
    }
    return data;
  }

  async function loadRibbon() {
    const meta = await loadJSON("meta.json");
    state = { ...state, meta };
    renderRibbon();
    return meta;
  }

  function fmtPct(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return "–";
    return `${(value * 100).toFixed(1).replace(".", ",")} %`;
  }

  function fmtDate(iso) {
    if (!iso) return "–";
    const [y, m, d] = String(iso).slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }

  function fmtNum(value) {
    return new Intl.NumberFormat("fr-FR").format(value);
  }

  function sourceUrl(scrutin) {
    const numero = String(scrutin?.n ?? "").replace(/\D/g, "");
    return `https://www.assemblee-nationale.fr/dyn/17/scrutins/${numero}`;
  }

  /* --- Calcul des accords (même formule que le pipeline) --------------- */

  function pairStats(scrutins, a, b, opts = {}) {
    const ia = state.meta.groupes.findIndex((g) => g.sigle === a);
    const ib = state.meta.groupes.findIndex((g) => g.sigle === b);
    const skipAbstention = opts.excludeAbstention === true;
    let num = 0, den = 0, n = 0;
    for (const s of scrutins) {
      const pa = s.p[ia], pb = s.p[ib];
      if (pa === null || pb === null) continue;
      if (skipAbstention && (pa === 0 || pb === 0)) continue;
      n += 1;
      const w = s.b * s.f * Math.min(s.q[ia], s.q[ib]);
      if (w > 0) {
        num += w * (pa === pb ? 1 : 0);
        den += w;
      }
    }
    return { accord: den > 0 ? num / den : null, n, poids: den };
  }

  function kappa(scrutins, a, b, opts = {}) {
    const ia = state.meta.groupes.findIndex((g) => g.sigle === a);
    const ib = state.meta.groupes.findIndex((g) => g.sigle === b);
    const skipAbstention = opts.excludeAbstention === true;
    let total = 0, observed = 0;
    const ca = {}, cb = {};
    for (const s of scrutins) {
      const pa = s.p[ia], pb = s.p[ib];
      if (pa === null || pb === null) continue;
      if (skipAbstention && (pa === 0 || pb === 0)) continue;
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

  function allPairs(scrutins, opts = {}) {
    const out = {};
    const groups = state.meta.groupes.map((g) => g.sigle);
    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        out[`${groups[i]}|${groups[j]}`] = pairStats(scrutins, groups[i], groups[j], opts);
      }
    }
    return out;
  }

  function pairKey(a, b) {
    const order = state.meta.groupes.map((g) => g.sigle);
    return order.indexOf(a) < order.indexOf(b) ? `${a}|${b}` : `${b}|${a}`;
  }

  // Réponses du questionnaire dans l'URL : « 0p,2c,12a » (index base36 de la famille + position).
  function encodeAnswers(answers, families) {
    const index = new Map(families.map((fam, i) => [fam.id, i]));
    const parts = [];
    for (const [key, value] of answers) {
      if (!key.startsWith("f:")) continue;
      const position = index.get(key.slice(2));
      if (position === undefined) continue;
      parts.push(`${position.toString(36)}${value === 1 ? "p" : value === 0 ? "a" : "c"}`);
    }
    return parts.sort().join(",");
  }

  function decodeAnswers(code, families) {
    const out = new Map();
    for (const part of String(code || "").split(",")) {
      const match = /^([0-9a-z]+)([pac])$/.exec(part);
      if (!match) continue;
      const family = families[parseInt(match[1], 36)];
      if (!family) continue;
      out.set(`f:${family.id}`, match[2] === "p" ? 1 : match[2] === "a" ? 0 : -1);
    }
    return out;
  }

  // Partage natif (smartphone) avec repli copie de lien puis saisie manuelle.
  async function share({ title, text, url }) {
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return "shared";
      } catch (err) {
        if (err && err.name === "AbortError") return "cancelled";
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      return "copied";
    } catch {
      window.prompt("Copiez le lien :", url);
      return "prompt";
    }
  }

  function heatColor(value) {
    if (value === null || value === undefined) return "#eee4cd";
    const t = Math.max(0, Math.min(1, (value - 0.2) / 0.7));
    const from = [236, 223, 194], to = [163, 74, 30];
    const mix = from.map((c, i) => Math.round(c + (to[i] - c) * t));
    return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
  }

  function textOn(value) {
    if (value === null || value === undefined) return "var(--ink-faint)";
    return value > 0.62 ? "#fffdf4" : "var(--ink)";
  }

  function safeColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(String(value)) ? String(value) : "#888888";
  }

  function stance(value) {
    const map = {
      1: ["pour", "a voté pour"], 0: ["abstention", "s'est abstenu"], "-1": ["contre", "a voté contre"],
    };
    if (value === null) return `<span class="stance" data-p="n" title="position non déterminée">n.d.</span>`;
    const [label, title] = map[value] || ["n.d.", "position non déterminée"];
    return `<span class="stance" data-p="${encodeURIComponent(String(value))}" title="${title}">${label}</span>`;
  }

  function esc(text) {
    return String(text ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function period(s) {
    return `${s.d.slice(0, 4)}-${Number(s.d.slice(5, 7)) <= 6 ? "H1" : "H2"}`;
  }

  // Recherche d'un scrutin : titre plein texte, ou numéro (« 8432 », « 43 » ou « #8432 »).
  function matchesQuery(scrutin, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return true;
    const digits = q.replace(/^#/, "");
    if (/^\d+$/.test(digits) && Number.isInteger(scrutin.n) && scrutin.n > 0
        && String(scrutin.n).includes(digits)) {
      return true;
    }
    return String(scrutin.ti || "").toLowerCase().includes(q);
  }

  // Filtres de l'explorateur en paramètres d'URL, ordre stable (état partageable).
  function voteQuery(filters = {}) {
    const order = ["q", "theme", "periode", "type", "groupe", "position", "doublons", "essentiel", "tri"];
    const params = new URLSearchParams();
    for (const key of order) {
      const value = filters[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") params.set(key, value);
    }
    return params.toString();
  }

  // Filtres de l'explorateur (valeurs vides = pas de filtre). `essentialUids` : Set ou null.
  function filterScrutins(scrutins, filters = {}, essentialUids = null) {
    const groups = state.meta.groupes.map((g) => g.sigle);
    return scrutins.filter((s) => {
      if (filters.theme && s.th !== filters.theme) return false;
      if (filters.periode && period(s) !== filters.periode) return false;
      if (filters.type && s.t !== filters.type) return false;
      if (filters.doublons === "uniques" && s.b === 0) return false;
      if (filters.doublons === "doublons" && s.b !== 0) return false;
      if (filters.essentiel && essentialUids && !essentialUids.has(s.u)) return false;
      if (filters.groupe) {
        const index = groups.indexOf(filters.groupe);
        if (filters.position) {
          if (s.p[index] !== Number(filters.position)) return false;
        } else if (s.p[index] === null) {
          return false;
        }
      }
      return matchesQuery(s, filters.q);
    });
  }

  function positionLabel(position) {
    return position === 1 ? "pour" : position === -1 ? "contre"
      : position === 0 ? "abstention" : "position non déterminée";
  }

  // Une pastille de position — unique implémentation (explorateur, matrice).
  function positionChip(position, title, diverge = false) {
    const cls = position === 1 ? "pos-pour" : position === -1 ? "pos-contre"
      : position === 0 ? "pos-abstention" : "pos-absent";
    return `<span class="pos-chip ${cls}${diverge ? " diverge" : ""}" role="img" aria-label="${esc(title)}" title="${esc(title)}"></span>`;
  }

  // Pastilles des 12 groupes (position de chaque groupe), en une ligne.
  function positionChips(s) {
    return state.meta.groupes.map((g, i) => positionChip(
      s.p[i],
      `${g.sigle} : ${positionLabel(s.p[i])}`,
    )).join("");
  }

  function essentielBadge(family) {
    if (!family) return "";
    return `<a class="badge neutre" href="questionnaire.html?affiner=${encodeURIComponent(family.id)}" title="Vote rattaché à un texte du questionnaire : voir la question essentielle">question essentielle</a>`;
  }

  // Profil léger d'un groupe à partir des exports précalculés (aucun recalcul sur les scrutins).
  function groupProfile(agreement, sigle) {
    const profile = state.meta.groupes.find((g) => g.sigle === sigle);
    if (!profile) return null;
    const others = state.meta.groupes
      .filter((g) => g.sigle !== sigle)
      .map((g) => ({ sigle: g.sigle, nom: g.nom, couleur: g.couleur, ...agreement.principal[pairKey(sigle, g.sigle)] }))
      .filter((row) => row.accord !== null && row.accord !== undefined)
      .sort((a, b) => b.accord - a.accord);
    return { profile, others };
  }

  // Sigles valides et uniques parmi des paramètres d'URL (`?a=`, `?b=`) pour surligner des colonnes.
  function highlightSigs(...candidates) {
    const sigles = state.meta.groupes.map((g) => g.sigle);
    return [...new Set(candidates.filter((value) => sigles.includes(value)))];
  }

  // Positions des 12 groupes sur une famille de questions essentielles :
  // - passage : position sur le vote de passage (ancre), lecture directe ;
  // - majorite : position majoritaire sur les votes orientés, pondérée par la participation
  //   (égalité → 0, aucune contribution → null) ;
  // - divergences : groupe où cette majorité contredit le vote de passage (méthode vs fond).
  function familyStances(family, scrutinByUid) {
    const count = state.meta.groupes.length;
    const anchorVote = family.votes.find((vote) => vote.u === family.anchor);
    const anchorScrutin = scrutinByUid.get(family.anchor);
    const anchorPositions = anchorVote?.p ?? anchorScrutin?.p ?? [];
    const passage = Array.from({ length: count }, (_, i) => {
      const value = anchorPositions[i];
      return value === undefined ? null : value;
    });
    const totals = Array.from({ length: count }, () => [0, 0, 0]); // contre, abstention, pour
    for (const vote of family.votes) {
      const scrutin = scrutinByUid.get(vote.u);
      if (!scrutin) continue;
      const base = vote.p ?? scrutin.p;
      for (let i = 0; i < count; i += 1) {
        const raw = base[i];
        if (raw === null || raw === undefined) continue;
        const weight = scrutin.q?.[i] ?? 0;
        if (weight > 0) totals[i][(vote.dir === 1 ? raw : -raw) + 1] += weight;
      }
    }
    const majorite = totals.map(([contre, abstention, pour]) => {
      const max = Math.max(contre, abstention, pour);
      if (max <= 0) return null;
      const winners = [[pour, 1], [abstention, 0], [contre, -1]].filter(([weight]) => weight === max);
      return winners.length === 1 ? winners[0][1] : 0;
    });
    const partagee = totals.map(([contre, abstention, pour]) => {
      const max = Math.max(contre, abstention, pour);
      return max > 0 && [[pour], [abstention], [contre]].filter(([weight]) => weight === max).length !== 1;
    });
    const divergences = passage.map((value, i) => value !== null && majorite[i] !== null && value !== majorite[i]);
    return { passage, majorite, partagee, divergences };
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function renderRibbon() {
    const { compteurs } = state.meta;
    setText("rb-scrutins", `${fmtNum(compteurs.scrutins)} scrutins`);
    setText("rb-retenus", `${fmtNum(compteurs.scrutins_retenus)} retenus`);
    setText("rb-themes", `${fmtNum(compteurs.scrutins_themes)} thématisés`);
    setText("rb-doublons", `${fmtNum(compteurs.doublons)} doublons neutralisés`);
    setText("rb-date", `données AN au ${fmtDate(state.meta.data_built_at)}`);
    // Défilement continu : duplique le contenu (copie aria-hidden, sans ids) dans une piste animée.
    const ribbon = document.querySelector(".ribbon");
    if (ribbon && !ribbon.querySelector(".ribbon-track")) {
      const group = document.createElement("div");
      group.className = "ribbon-group";
      while (ribbon.firstChild) group.append(ribbon.firstChild);
      const duplicate = group.cloneNode(true);
      duplicate.setAttribute("aria-hidden", "true");
      duplicate.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
      const track = document.createElement("div");
      track.className = "ribbon-track";
      track.append(group, duplicate);
      ribbon.append(track);
    }
  }

  return {
    loadJSON, loadAll, loadRibbon, loadQuestionnaire, get state() { return state; },
    fmtPct, fmtDate, fmtNum, sourceUrl, pairStats, allPairs, pairKey, kappa, heatColor, textOn,
    stance, esc, safeColor, period, setText, renderRibbon, initSignature, positionChips, positionChip,
    positionLabel, essentielBadge, familyStances, matchesQuery, voteQuery, filterScrutins, groupProfile,
    highlightSigs,
    encodeAnswers, decodeAnswers, share,
  };
})();

VV.initSignature();

// PWA : installable sur téléphone (nécessite HTTPS ou localhost).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}
