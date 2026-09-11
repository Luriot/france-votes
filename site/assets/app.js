/* Votes 2027 — utilitaires partagés (aucune dépendance) */

const VV = (() => {
  const cache = {};
  let state = null;

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

  async function loadRibbon() {
    const meta = await loadJSON("meta.json");
    state = { ...state, meta };
    renderRibbon();
    return meta;
  }

  const positionCode = { pour: 1, contre: -1, abstention: 0, null: null };
  const POSITION_NAME = { 1: "pour", 0: "abstention", "-1": "contre" };

  function fmtPct(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return "–";
    return `${(value * 100).toFixed(1).replace(".", ",")} %`;
  }

  function fmtDate(iso) {
    if (!iso) return "–";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }

  function fmtNum(value) {
    return new Intl.NumberFormat("fr-FR").format(value);
  }

  function sourceUrl(scrutin) {
    return `https://www.assemblee-nationale.fr/dyn/17/scrutins/${scrutin.n}`;
  }

  /* --- Calcul des accords (même formule que le pipeline) --------------- */

  function weightsFor(scheme) {
    if (scheme === "uniforme") return () => 1;
    if (scheme === "thematique") return (s) => s.b * s.f;
    if (scheme === "participation_seule") return (s, a, b) => s.b * Math.min(s.q[a], s.q[b]);
    if (scheme === "sans_deduplication") return (s, a, b) => s.f * Math.min(s.q[a], s.q[b]);
    return (s, a, b) => s.b * s.f * Math.min(s.q[a], s.q[b]);
  }

  function pairStats(scrutins, a, b, scheme = "principal") {
    const ia = state.meta.groupes.findIndex((g) => g.sigle === a);
    const ib = state.meta.groupes.findIndex((g) => g.sigle === b);
    const weight = weightsFor(scheme);
    let num = 0, den = 0, n = 0;
    for (const s of scrutins) {
      const pa = s.p[ia], pb = s.p[ib];
      if (pa === null || pb === null) continue;
      n += 1;
      const w = weight(s, ia, ib);
      if (w > 0) {
        num += w * (pa === pb ? 1 : 0);
        den += w;
      }
    }
    return { accord: den > 0 ? num / den : null, n, poids: den };
  }

  function allPairs(scrutins, scheme = "principal") {
    const out = {};
    const groups = state.meta.groupes.map((g) => g.sigle);
    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        out[`${groups[i]}|${groups[j]}`] = pairStats(scrutins, groups[i], groups[j], scheme);
      }
    }
    return out;
  }

  function heatColor(value) {
    if (value === null || value === undefined) return "#f0ece2";
    const t = Math.max(0, Math.min(1, (value - 0.2) / 0.7));
    const from = [240, 236, 226], to = [15, 91, 86];
    const mix = from.map((c, i) => Math.round(c + (to[i] - c) * t));
    return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
  }

  function textOn(value) {
    if (value === null || value === undefined) return "var(--ink-faint)";
    return value > 0.62 ? "#fff" : "var(--ink)";
  }

  function posBar(counts) {
    const [pour, contre, abst, absent] = counts;
    const total = Math.max(1, pour + contre + abst + absent);
    const pct = (v) => `${((v / total) * 100).toFixed(1)}%`;
    return `<span class="posbar" role="img" aria-label="pour ${pour}, contre ${contre}, abstention ${abst}, absents ${absent}">` +
      `<i class="pos-pour" style="width:${pct(pour)}"></i>` +
      `<i class="pos-contre" style="width:${pct(contre)}"></i>` +
      `<i class="pos-abstention" style="width:${pct(abst)}"></i>` +
      `<i class="pos-absent" style="width:${pct(absent)}"></i></span>`;
  }

  function stance(value) {
    const map = {
      1: ["pour", "a voté pour"], 0: ["abstention", "s'est abstenu"], "-1": ["contre", "a voté contre"],
    };
    if (value === null) return `<span class="stance" data-p="n" title="position non déterminée">n.d.</span>`;
    const [label, title] = map[value];
    return `<span class="stance" data-p="${value}" title="${title}">${label}</span>`;
  }

  function esc(text) {
    return String(text ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function period(s) {
    return `${s.d.slice(0, 4)}-${Number(s.d.slice(5, 7)) <= 6 ? "H1" : "H2"}`;
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
  }

  return {
    loadJSON, loadAll, loadRibbon, get state() { return state; }, positionCode, POSITION_NAME,
    fmtPct, fmtDate, fmtNum, sourceUrl, pairStats, allPairs, heatColor, textOn,
    posBar, stance, esc, period, setText, renderRibbon,
  };
})();
