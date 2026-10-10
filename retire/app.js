(function () {
  "use strict";
  const C = window.SSCalc, U = window.LoanUI;
  const TOUCH = window.matchMedia("(hover: none), (pointer: coarse)").matches;
  const COLORS = { 62: "#d73027", 63: "#f46d43", 64: "#fdae61", 65: "#c9b33a", 66: "#8fbf4d", 67: "#1a9850", 68: "#2b8cbe", 69: "#3f5fb0", 70: "#5e3c99" };
  // Compound yearly averages, 2006–2025.
  const PRESETS = [
    { label: "Cash (3-mo T-bill)", rate: 1.67 },
    { label: "Inflation (CPI-U)", rate: 2.53 },
    { label: "10-yr Treasury", rate: 2.81 },
    { label: "S&P 500 / VOO", rate: 10.9 },
  ];
  const COLA_AVG = 2.53; // compound average of the 20 COLAs paid 2007–2026

  const defaults = () => ({
    pia: 4152, cola: COLA_AVG, rate: 2.53, endAge: 100,
    show: Object.fromEntries(C.CLAIM_AGES.map((a) => [a, [62, 65, 67, 70].includes(a)])),
    mode: "value", scale: "linear",
    // Chance (%) of still collecting at each age; 110 is fixed at 0.
    surv: { 60: 100, 70: 100, 80: 100, 90: 100, 100: 100, 110: 0 },
  });
  let state = defaults();
  let selected = null; // months since 62 of the clicked point
  let last = null;

  const params = () => ({ pia: state.pia, cola: state.cola / 100, rate: state.rate / 100, endAge: state.endAge });
  const ageText = (m) => {
    const y = C.START_AGE + Math.floor(m / 12), mo = m % 12;
    return mo ? `${y} y ${mo} m` : `${y}`;
  };

  // ---------- Controls ----------

  let ctls = [];
  const onChange = (except) => { for (const c of ctls) c.sync(except); scheduleRender(); };
  function add(id, ctl) { document.getElementById(id).appendChild(ctl.el); ctls.push(ctl); }
  const num = (label, unit, min, max, step, key, hint, set) => ({
    label, unit, min, max, step, hint, get: () => state[key], set: set || ((v) => (state[key] = v)),
  });

  function build() {
    ctls = [];
    for (const id of ["benefitFields", "rateFields", "displayFields"]) document.getElementById(id).innerHTML = "";
    add("benefitFields", U.field(num("Monthly benefit at 67", "$", 0, 6000, 10, "pia",
      () => "2026 maximum at full retirement age for maxed-out earnings (SSA). In today's dollars."), onChange));
    add("benefitFields", U.field(num("Yearly COLA", "%", 0, 8, 0.05, "cola",
      () => "Cost-of-living increase applied every year from 62."), onChange));
    add("rateFields", U.field(num("Value rate", "%", 0, 15, 0.05, "rate",
      () => "How fast a dollar received earlier grows in value, whether saved or spent."), onChange));
    add("displayFields", U.select({ label: "Y-axis", options: [["value", "Accumulated value"], ["avg", "Average per month since 62"]], get: () => state.mode, set: (v) => (state.mode = v) }, onChange));
    add("displayFields", U.select({ label: "Scale", options: [["linear", "Linear"], ["log", "Log"]], get: () => state.scale, set: (v) => (state.scale = v) }, onChange));
    add("displayFields", U.field(num("Show up to age", "", 72, 110, 1, "endAge", null, (v) => {
      state.endAge = Math.max(71, Math.min(115, Math.round(v)));
      if (selected !== null && selected > (state.endAge - C.START_AGE) * 12) selected = null;
    }), onChange));

    const presets = document.getElementById("ratePresets");
    presets.innerHTML = PRESETS.map((p) => `<button type="button" data-rate="${p.rate}">${p.label}<br><b>${p.rate.toFixed(2)}%</b></button>`).join("");
    presets.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { state.rate = +b.dataset.rate; onChange(); }));
    ctls.push({ sync: () => presets.querySelectorAll("button").forEach((b) => b.classList.toggle("active", Math.abs(+b.dataset.rate - state.rate) < 1e-9)) });

    const chips = document.getElementById("ageChips");
    chips.innerHTML = C.CLAIM_AGES.map((a) =>
      `<label style="--c:${COLORS[a]}"><input type="checkbox" value="${a}"><span>${a}</span></label>`).join("");
    chips.querySelectorAll("input").forEach((box) => box.addEventListener("change", () => { state.show[box.value] = box.checked; scheduleRender(); }));
    ctls.push({ sync: () => chips.querySelectorAll("input").forEach((box) => (box.checked = !!state.show[box.value])) });

    buildSurvival();

    const colaBtn = document.getElementById("colaAvg");
    ctls.push({ sync: () => colaBtn.classList.toggle("active", Math.abs(state.cola - COLA_AVG) < 1e-9) });
    for (const c of ctls) c.sync();
  }

  // Vertical sliders for the chance of collecting until each age, joined by a line so they read
  // like a survival curve. Moving one pushes its neighbors so the chance never rises with age.
  function buildSurvival() {
    const host = document.getElementById("survSliders");
    host.querySelectorAll(".scol").forEach((e) => e.remove());
    for (const age of C.LIFE_AGES) {
      const fixed = age === C.MAX_AGE;
      const col = document.createElement("div");
      col.className = "scol";
      col.innerHTML =
        `<input type="number" min="0" max="100" step="1" inputmode="numeric" aria-label="Chance of collecting until ${age} (%)"${fixed ? " disabled" : ""}>` +
        `<input type="range" class="v" min="0" max="100" step="1" aria-label="Chance of collecting until ${age}"${fixed ? " disabled" : ""}>` +
        `<span>${age}</span>`;
      const [numBox, range] = col.querySelectorAll("input");
      const set = (v, except) => {
        if (!Number.isFinite(v)) return;
        v = Math.max(0, Math.min(100, v));
        state.surv[age] = v;
        for (const a of C.LIFE_AGES) {
          if (a > age && a !== C.MAX_AGE) state.surv[a] = Math.min(state.surv[a], v);
          if (a < age) state.surv[a] = Math.max(state.surv[a], v);
        }
        onChange(except);
      };
      range.addEventListener("input", () => set(+range.value));
      numBox.addEventListener("input", () => set(parseFloat(numBox.value), numBox));
      numBox.addEventListener("change", () => onChange());
      host.appendChild(col);
    }
    ctls.push({
      sync: (except) => {
        host.querySelectorAll(".scol").forEach((col, k) => {
          const v = state.surv[C.LIFE_AGES[k]];
          const [numBox, range] = col.querySelectorAll("input");
          range.value = v;
          if (except !== numBox) numBox.value = v;
        });
        drawSurvivalLine();
      },
    });
  }

  function drawSurvivalLine() {
    const host = document.getElementById("survSliders"), svg = document.getElementById("survLine");
    const box = host.getBoundingClientRect();
    if (!box.width) return;
    const pts = [...host.querySelectorAll("input.v")].map((r, k) => {
      const b = r.getBoundingClientRect(), thumb = 16;
      const p = state.surv[C.LIFE_AGES[k]] / 100;
      return `${b.left + b.width / 2 - box.left},${b.top + thumb / 2 + (1 - p) * (b.height - thumb) - box.top}`;
    });
    svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
    svg.innerHTML = `<polyline points="${pts.join(" ")}" />`;
  }

  // ---------- Rendering ----------

  let pending = false;
  function scheduleRender() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  }

  function render() {
    const p = params();
    const n = Math.round((p.endAge - C.START_AGE) * 12);
    const all = C.allSeries(p);
    last = { p, n, all };
    renderChart(all, n);
    renderDecision(all, n);
    renderRanges(all, n);
    renderLife(p);
  }

  // Distribution of total value collected, weighting each possible lifespan by its chance.
  function renderLife(p) {
    drawSurvivalLine();
    const knots = C.LIFE_AGES.map((a) => [a, state.surv[a] / 100]);
    const probs = C.lifeDistribution(knots);
    const el = document.getElementById("pdfChart");
    if (!probs) {
      document.getElementById("lifeHeadline").textContent = "Set a chance above 0% of collecting at 60 or 70 to see the distribution.";
      document.getElementById("lifeTable").innerHTML = "";
      Plotly.purge(el);
      return;
    }
    const full = { ...p, endAge: C.MAX_AGE };
    const dists = {}, sers = {};
    for (const a of C.CLAIM_AGES) {
      sers[a] = C.series(a, full);
      dists[a] = C.valueDistribution(sers[a], probs);
    }
    const shown = C.CLAIM_AGES.filter((a) => state.show[a]);

    // For the chart, each month's chance is spread evenly over the value range covered during that
    // month (value[m] to value[m + 1]). Putting it all at one point makes the bars saw-toothed,
    // since bins catch a varying number of months. Expected values and medians are unaffected.
    const span = (s, m) => [s.value[m], m + 1 < s.value.length ? s.value[m + 1] : s.value[m]];
    let lo = Infinity, hi = -Infinity;
    for (const a of shown) {
      for (let m = 0; m < probs.length; m++) {
        if (probs[m] <= 1e-9) continue;
        const [v0, v1] = span(sers[a], m);
        lo = Math.min(lo, v0);
        hi = Math.max(hi, v1);
      }
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1) { lo -= 1; hi += 1; }
    const nb = 40, w = (hi - lo) / nb;
    const edges = Array.from({ length: nb + 1 }, (_, k) => lo + k * w);
    const binOf = (v) => Math.max(0, Math.min(nb - 1, Math.floor((v - lo) / w)));
    const traces = [], shapes = [];
    for (const a of shown) {
      const bins = new Array(nb).fill(0);
      for (let m = 0; m < probs.length; m++) {
        const pm = probs[m];
        if (pm <= 0) continue;
        const [v0, v1] = span(sers[a], m);
        if (v1 - v0 < 1e-9) { bins[binOf(v0)] += pm; continue; }
        for (let b = binOf(v0); b <= binOf(v1); b++) {
          const overlap = Math.min(v1, edges[b + 1]) - Math.max(v0, edges[b]);
          if (overlap > 0) bins[b] += (pm * overlap) / (v1 - v0);
        }
      }
      traces.push({
        type: "scatter", mode: "lines", name: `Start at ${a}`, x: edges, y: [...bins, bins[nb - 1]].map((v) => v * 100),
        line: { color: COLORS[a], width: 2, shape: "hv" },
        customdata: edges.map((e) => `${U.kMoney(e)}–${U.kMoney(e + w)}`),
        hovertemplate: `Start at ${a}: %{y:.1f}% chance of %{customdata}<extra></extra>`,
      });
      shapes.push({ type: "line", xref: "x", yref: "paper", x0: dists[a].mean, x1: dists[a].mean, y0: 0, y1: 1, line: { color: COLORS[a], width: 1.5, dash: "dash" } });
    }
    const narrow = window.innerWidth < 700;
    Plotly.react(el, traces, {
      width: Math.max(260, Math.floor(el.clientWidth)), height: narrow ? 300 : 320,
      margin: narrow ? { l: 46, r: 10, t: 50, b: 44 } : { l: 56, r: 16, t: 36, b: 48 },
      dragmode: false, hovermode: "x unified", shapes,
      legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom", font: { size: narrow ? 10 : 12 } },
      xaxis: { title: { text: "Total value collected" }, tickprefix: "$", tickformat: "~s", fixedrange: true },
      yaxis: { title: { text: "Chance (%)" }, ticksuffix: "%", rangemode: "tozero", fixedrange: true },
      hoverlabel: { align: "left", bgcolor: "#fff", font: { size: 12.5, color: "#1d2330" } },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    }, { displayModeBar: false, scrollZoom: false, staticPlot: TOUCH });

    const best = C.CLAIM_AGES.reduce((b, a) => (dists[a].mean > dists[b].mean ? a : b), C.CLAIM_AGES[0]);
    document.getElementById("lifeHeadline").innerHTML =
      `Weighing every lifespan by its chance, starting at <b style="color:${COLORS[best]}">${best}</b> has the highest expected total value: ` +
      `<b>${U.money(dists[best].mean)}</b>, valuing each dollar at ${state.rate.toFixed(2)}% a year.`;
    document.getElementById("lifeTable").innerHTML =
      `<thead><tr><th>Start at</th><th>Expected value</th><th>Median</th><th>vs. best expected</th></tr></thead><tbody>` +
      C.CLAIM_AGES.map((a) => `<tr class="${a === best ? "best" : ""}"><td><span class="dot" style="--c:${COLORS[a]}"></span>${a}</td>` +
        `<td>${U.money(dists[a].mean)}</td><td>${U.money(dists[a].median)}</td>` +
        `<td>${a === best ? "best" : ((dists[a].mean / dists[best].mean - 1) * 100).toFixed(1) + "%"}</td></tr>`).join("") + `</tbody>`;
  }

  const yOf = (s, m) => (state.mode === "avg" ? (m > 0 ? s.value[m] / m : null) : s.value[m]);

  function renderChart(all, n) {
    const el = document.getElementById("chart");
    const narrow = window.innerWidth < 700;
    const ms = Array.from({ length: n + 1 }, (_, m) => m);
    const xs = ms.map((m) => C.START_AGE + m / 12);
    // Invisible trace on its own axis, only to put "Age 78 y 4 m" at the top of the hover box.
    const traces = [{
      type: "scatter", mode: "lines", x: xs, y: ms.map(() => 0), yaxis: "y2", showlegend: false,
      line: { width: 0, color: "rgba(0,0,0,0)" }, customdata: ms.map(ageText),
      hovertemplate: "<b>Age %{customdata}</b><extra></extra>",
    }];
    for (const a of C.CLAIM_AGES) {
      if (!state.show[a]) continue;
      const s = all[a];
      traces.push({
        type: "scatter", mode: "lines", name: `Start at ${a}`, x: xs,
        y: ms.map((m) => { const v = yOf(s, m); return state.scale === "log" && !(v > 0) ? null : v; }),
        line: { color: COLORS[a], width: 2 },
        hovertemplate: `Start at ${a}: %{y:$,.0f}<extra></extra>`,
      });
    }
    const shapes = selected === null ? [] : [{
      type: "line", xref: "x", yref: "paper", x0: C.START_AGE + selected / 12, x1: C.START_AGE + selected / 12, y0: 0, y1: 1,
      line: { color: "#1d2330", width: 1.5, dash: "dash" },
    }];
    const yTitle = state.mode === "avg" ? "Average value per month since 62" : "Accumulated value";
    Plotly.react(el, traces, {
      width: Math.max(280, Math.floor(el.clientWidth)),
      height: narrow ? 420 : 540,
      margin: narrow ? { l: 56, r: 10, t: 60, b: 44 } : { l: 76, r: 20, t: 40, b: 50 },
      dragmode: false, hovermode: "x unified", shapes,
      legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom", font: { size: narrow ? 10 : 12 } },
      xaxis: { title: { text: "Age (collect until)" }, tick0: C.START_AGE, dtick: narrow ? 4 : 2, range: [C.START_AGE, state.endAge], fixedrange: true, showspikes: false },
      // Log scale: label only 1, 2, and 5 of each power of ten.
      yaxis: { title: { text: yTitle }, type: state.scale, tickprefix: "$", tickformat: "~s", ...(state.scale === "log" && { dtick: "D2" }), fixedrange: true },
      yaxis2: { overlaying: "y", visible: false, fixedrange: true, range: [0, 1] },
      hoverlabel: { align: "left", bgcolor: "#fff", font: { size: 12.5, color: "#1d2330" } },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    }, { displayModeBar: false, scrollZoom: false, staticPlot: TOUCH });
  }

  // Decision for "collect until" the selected age (or the last age shown, before any click).
  function renderDecision(all, n) {
    const m = selected ?? n;
    const best = C.bestAt(all, m);
    const bv = all[best].value[m];
    const rows = C.CLAIM_AGES.map((a) => {
      const v = all[a].value[m];
      const diff = bv > 0 ? (v / bv - 1) * 100 : 0;
      return `<tr class="${a === best ? "best" : ""}"><td><span class="dot" style="--c:${COLORS[a]}"></span>${a}</td>` +
        `<td>${U.money(all[a].firstCheck)}</td><td>${U.money(v)}</td><td>${a === best ? "best" : diff.toFixed(1) + "%"}</td></tr>`;
    }).join("");
    const r62 = all[62].value[m];
    const head = selected === null
      ? `<h2>If you collect Social Security until age ${ageText(m)}</h2><p class="sub small">Showing the last age on the chart. Click the chart to pick another age.</p>`
      : `<h2>If you collect Social Security until age ${ageText(m)}</h2>`;
    document.getElementById("decision").innerHTML = head +
      `<p class="headline">Starting at <b style="color:${COLORS[best]}">${best}</b> gives the most value: <b>${U.money(bv)}</b> by then, ` +
      `valuing each dollar at ${state.rate.toFixed(2)}% a year.` +
      (best !== 62 && r62 > 0 ? ` Starting at 62 would give ${U.money(r62)} (${((r62 / bv - 1) * 100).toFixed(1)}%).` : "") + `</p>` +
      `<div class="tablewrap"><table class="data"><thead><tr><th>Start at</th><th>First monthly check</th><th>Value by ${ageText(m)}</th><th>vs. best</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    return { best, m };
  }

  function renderRanges(all, n) {
    const ranges = C.bestRanges(all, n);
    document.getElementById("ranges").innerHTML =
      `<p class="sub small">For each age you might collect until, the starting age (62–70) with the most accumulated value at ${state.rate.toFixed(2)}% a year.</p>` +
      `<div class="tablewrap"><table class="data"><thead><tr><th>If you collect until</th><th>Best start</th></tr></thead><tbody>` +
      ranges.map((r, k) => {
        const span = k === ranges.length - 1
          ? `${ageText(r.fromMonth)} or later (through ${state.endAge})`
          : `${ageText(r.fromMonth)} – ${ageText(r.toMonth)}`;
        return `<tr><td>${span}</td><td><span class="dot" style="--c:${COLORS[r.claimAge]}"></span>${r.claimAge}</td></tr>`;
      }).join("") + `</tbody></table></div>`;
  }

  // ---------- Clicks and taps ----------

  function selectAge(age) {
    if (!last) return;
    selected = Math.max(1, Math.min(last.n, Math.round((age - C.START_AGE) * 12)));
    scheduleRender();
  }

  function onTap(ev) {
    const el = document.getElementById("chart");
    const fl = el._fullLayout;
    const card = document.getElementById("tapcard");
    if (!fl) return;
    const size = fl._size, rect = el.getBoundingClientRect();
    const px = ev.clientX - rect.left - size.l, py = ev.clientY - rect.top - size.t;
    if (px < 0 || py < 0 || px > size.w || py > size.h) { card.hidden = true; return; }
    selectAge(fl.xaxis.p2d(px));
    const m = selected, all = last.all, best = C.bestAt(all, m);
    card.querySelector(".body").innerHTML =
      `<b>Collect until ${ageText(m)}</b><br>Best start: <b style="color:${COLORS[best]}">${best}</b> (${U.money(all[best].value[m])})` +
      (best !== 62 ? `<br>Start at 62: ${U.money(all[62].value[m])}` : "") +
      (best !== 70 ? `<br>Start at 70: ${U.money(all[70].value[m])}` : "");
    card.hidden = false;
  }

  // ---------- Wiring ----------

  function init() {
    build();
    document.getElementById("colaAvg").addEventListener("click", () => { state.cola = COLA_AVG; onChange(); });
    document.getElementById("reset").addEventListener("click", () => { state = defaults(); selected = null; build(); scheduleRender(); });
    render();
    const el = document.getElementById("chart");
    if (TOUCH) {
      el.addEventListener("click", onTap);
      document.getElementById("tapcard-close").addEventListener("click", () => (document.getElementById("tapcard").hidden = true));
    } else {
      el.on("plotly_click", (ev) => selectAge(ev.points[0].x));
    }
    // Redraw when the chart's space changes width; height-only changes are ignored.
    let lastW = el.clientWidth;
    new ResizeObserver(() => { if (el.clientWidth !== lastW) { lastW = el.clientWidth; scheduleRender(); } }).observe(el);
  }

  init();
})();
