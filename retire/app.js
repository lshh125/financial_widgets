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
    show: Object.fromEntries(C.CLAIM_AGES.map((a) => [a, true])),
    mode: "value", scale: "linear",
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

    const colaBtn = document.getElementById("colaAvg");
    ctls.push({ sync: () => colaBtn.classList.toggle("active", Math.abs(state.cola - COLA_AVG) < 1e-9) });
    for (const c of ctls) c.sync();
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
