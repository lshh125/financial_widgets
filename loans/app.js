(function () {
  "use strict";
  const K = window.CarCalc, U = window.LoanUI;
  const TOUCH = window.matchMedia("(hover: none), (pointer: coarse)").matches;
  const COL = { pay: "#d95f02", payLight: "#f4b183", mm: "#1f78b4", mmLight: "#a6cee3" };
  const TBILL_URL =
    "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query" +
    "?filter=security_type:eq:Bill,security_term:eq:13-Week&sort=-auction_date&page%5Bsize%5D=6" +
    "&fields=auction_date,high_investment_rate";
  const BRACKETS = [0, 10, 12, 22, 24, 32, 35, 37];

  const now = new Date();
  const START = { year: now.getFullYear(), month: now.getMonth() };

  const defaults = () => ({
    balance: 25000, apr: 7, months: 60, prepay: 10000, carDeduction: false,
    mmRate: tbill ? tbill.rate : 4, status: "single", magi: 120000,
  });
  let tbill = null; // { rate, date } from the latest auction
  let mmEdited = false;
  let state = defaults();
  let last = null;

  const params = () => ({
    balance: state.balance, apr: state.apr / 100, months: Math.max(1, Math.round(state.months)),
    mmRate: state.mmRate / 100, status: state.status, magi: state.magi, carDeduction: state.carDeduction,
    startYear: START.year, startMonth: START.month,
  });
  const pct = (v) => (v * 100).toFixed(2) + "%";
  const monthLabel = (m) => U.monthLabel(START.month + m - 1, START.year);

  // ---------- Controls ----------

  let ctls = [];
  const onChange = (except) => { for (const c of ctls) c.sync(except); scheduleRender(); };
  function add(id, ctl) { document.getElementById(id).appendChild(ctl.el); ctls.push(ctl); }
  const num = (label, unit, min, max, step, key, hint, set) => ({
    label, unit, min, max, step, hint, get: () => state[key], set: set || ((v) => (state[key] = v)),
  });

  function build() {
    ctls = [];
    for (const id of ["loanFields", "mmFields", "taxFields"]) document.getElementById(id).innerHTML = "";
    add("loanFields", U.field(num("Current balance", "$", 1000, 100000, 500, "balance", null, (v) => {
      state.balance = v;
      state.prepay = Math.min(state.prepay, v);
    }), onChange));
    add("loanFields", U.field(num("APR", "%", 0, 20, 0.05, "apr"), onChange));
    add("loanFields", U.field(num("Months left", " mo", 1, 96, 1, "months", () =>
      `Payment ${U.money(K.amortPayment(state.balance, state.apr / 100, Math.max(1, Math.round(state.months))))}/mo; ends ${monthLabel(Math.round(state.months))}.`,
      (v) => (state.months = Math.max(1, Math.round(v)))), onChange));
    const pre = U.field({
      ...num("Extra payment now", "$", 0, 100000, 100, "prepay", () => `Up to the full balance (${U.money(state.balance)}).`,
        (v) => (state.prepay = Math.min(v, state.balance))),
    }, onChange);
    add("loanFields", pre);
    // Keep the extra-payment slider's range equal to the balance.
    ctls.push({ sync: () => (pre.el.querySelector("input[type=range]").max = state.balance) });
    add("loanFields", U.check({ label: "Qualifies for the car loan interest deduction", get: () => state.carDeduction, set: (v) => (state.carDeduction = v) }, onChange));

    add("mmFields", U.field(num("Money market yield", "%", 0, 8, 0.01, "mmRate", null, (v) => { state.mmRate = v; mmEdited = true; }), onChange));

    add("taxFields", U.select({ label: "Filing status", options: [["single", "Single"], ["mfj", "Married filing jointly"]], get: () => state.status, set: (v) => (state.status = v) }, onChange));
    add("taxFields", U.field(num("Income (MAGI)", "$", 0, 800000, 1000, "magi"), onChange));
    for (const c of ctls) c.sync();
  }

  // ---------- Latest Treasury bill rate ----------

  async function loadTbill(apply) {
    const el = document.getElementById("mmStatus");
    el.textContent = "Loading the latest 13-week Treasury bill rate…";
    try {
      const res = await fetch(TBILL_URL);
      const json = await res.json();
      const row = json.data.find((d) => d.high_investment_rate && d.high_investment_rate !== "null");
      tbill = { rate: +parseFloat(row.high_investment_rate).toFixed(2), date: row.auction_date };
      el.textContent = `Latest 13-week Treasury bill: ${tbill.rate.toFixed(2)}% (auction ${tbill.date}, U.S. Treasury). ` +
        "Money market funds usually pay a little less after fees; enter your fund's 7-day yield if you know it.";
      if (apply) {
        state.mmRate = tbill.rate;
        mmEdited = false;
        onChange();
      }
    } catch (e) {
      el.textContent = "Could not load the latest Treasury bill rate. Enter your fund's 7-day yield.";
    }
  }

  // ---------- Rendering ----------

  let pending = false;
  function scheduleRender() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  }

  const narrow = () => window.innerWidth < 700;
  const baseLayout = (height, margin) => ({
    height, margin, dragmode: false, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    font: { size: narrow() ? 11 : 12 },
    hoverlabel: { align: "left", bgcolor: "#fff", font: { size: 12.5, color: "#1d2330" } },
  });
  const config = { displayModeBar: false, scrollZoom: false, responsive: true, staticPlot: TOUCH };

  function render() {
    const p = params();
    const r = K.simulate(p, state.prepay);
    const t = r.rates;
    const carAfter = K.carAfterTaxRate(p);
    const mmAfter = p.mmRate * (1 - t.mm);
    last = { p, r, carAfter, mmAfter };

    document.getElementById("taxSummary").textContent =
      `Your federal bracket: ${Math.round(t.ord * 100)}%` + (t.niit ? " + 3.8% NIIT" : ", no NIIT") +
      `. Money market interest is taxed at ${pct(t.mm)}.` +
      (state.carDeduction ? (carAfter < p.apr ? ` Car loan deduction worth ${Math.round((1 - carAfter / p.apr) * 100)}% of this year's interest.` : " The car loan deduction is fully phased out at this income.") : "");

    renderVerdict(p, carAfter, mmAfter);
    renderBars(p, carAfter, mmAfter);
    renderMap(p, t, carAfter, mmAfter);
    renderAmount(p);
    renderGain(p, r);
  }

  function renderVerdict(p, carAfter, mmAfter) {
    const diff = carAfter - mmAfter;
    const el = document.getElementById("verdict");
    if (Math.abs(diff) < 0.0005) {
      el.innerHTML = `About even: the loan costs ${pct(carAfter)} and the money market earns ${pct(mmAfter)} after tax.`;
    } else if (diff > 0) {
      el.innerHTML = `<b style="color:${COL.pay}">Paying extra wins.</b> The loan costs <b>${pct(carAfter)}</b>${carAfter < p.apr ? " after the deduction" : ""}; ` +
        `the money market earns <b>${pct(mmAfter)}</b> after tax.`;
    } else {
      el.innerHTML = `<b style="color:${COL.mm}">Keeping the cash wins.</b> The money market earns <b>${pct(mmAfter)}</b> after tax; ` +
        `the loan costs only <b>${pct(carAfter)}</b>${carAfter < p.apr ? " after the deduction" : ""}.`;
    }
  }

  // Chart 1a: the rates side by side.
  function renderBars(p, carAfter, mmAfter) {
    const rows = [
      { label: "Money market, before tax", v: p.mmRate, c: COL.mmLight },
      { label: "Money market, after tax", v: mmAfter, c: COL.mm },
    ];
    if (carAfter < p.apr - 1e-9) rows.push({ label: "Car loan APR, before deduction", v: p.apr, c: COL.payLight });
    rows.push({ label: carAfter < p.apr - 1e-9 ? "Car loan, after deduction" : "Car loan APR", v: carAfter, c: COL.pay });
    const trace = {
      type: "bar", orientation: "h",
      y: rows.map((r) => r.label), x: rows.map((r) => r.v * 100),
      marker: { color: rows.map((r) => r.c) },
      text: rows.map((r) => pct(r.v)), textposition: "outside", cliponaxis: false,
      hovertemplate: "%{y}: %{text}<extra></extra>",
    };
    const max = Math.max(...rows.map((r) => r.v)) * 100;
    Plotly.react("chartBars", [trace], {
      ...baseLayout(40 * rows.length + 60, narrow() ? { l: 8, r: 50, t: 6, b: 34 } : { l: 8, r: 60, t: 6, b: 36 }),
      xaxis: { ticksuffix: "%", range: [0, max * 1.15 || 1], fixedrange: true },
      yaxis: { automargin: true, fixedrange: true },
      showlegend: false,
    }, config);
  }

  // Share of interest the car deduction covers this year (0 if not eligible or phased out).
  function deductionShare(p, t) {
    if (!p.carDeduction || t.ord === 0) return 0;
    return (1 - K.carAfterTaxRate(p) / p.apr) / t.ord;
  }

  // Chart 1b: which choice wins, for each loan rate and tax bracket.
  function renderMap(p, t, carAfter, mmAfter) {
    const share = p.apr > 0 ? deductionShare(p, t) : 0;
    const xMax = Math.max(12, Math.ceil(p.apr * 100 * 1.4), Math.ceil(p.mmRate * 100 * 1.5));
    const xs = [], ys = [];
    for (let x = 0; x <= xMax + 1e-9; x += xMax / 120) xs.push(+x.toFixed(3));
    for (let y = 0; y <= 40; y += 0.5) ys.push(y);
    // Pay extra wins when the after-tax loan cost exceeds the after-tax money market yield.
    const z = ys.map((y) => xs.map((x) => {
      const car = (x / 100) * (1 - (y / 100) * share);
      const mm = p.mmRate * (1 - y / 100 - t.niit);
      return car > mm ? 1 : 0;
    }));
    const breakEven = (y) => (p.mmRate * (1 - y / 100 - t.niit)) / (1 - (y / 100) * share) * 100;
    const traces = [
      {
        type: "heatmap", x: xs, y: ys, z, zmin: 0, zmax: 1, showscale: false,
        colorscale: [[0, "#d6e8f5"], [0.5, "#d6e8f5"], [0.5, "#fbe0cc"], [1, "#fbe0cc"]],
        hoverinfo: "skip",
      },
      {
        type: "scatter", mode: "lines", x: ys.map(breakEven), y: ys, name: "Break-even",
        line: { color: "#1d2330", width: 2, dash: "dash" },
        hovertemplate: "Break-even at %{y}% bracket: %{x:.2f}%<extra></extra>",
      },
      {
        type: "scatter", mode: "markers+text", x: [p.apr * 100], y: [t.ord * 100], name: "You",
        marker: { size: 13, color: "#1d2330", line: { color: "#fff", width: 2 } },
        text: ["You"], textposition: "top center", textfont: { size: 12, color: "#1d2330" },
        hovertemplate: "Your loan %{x:.2f}%, bracket %{y}%<extra></extra>",
      },
    ];
    const annotations = [{ x: xMax * 0.98, y: 37.5, text: "<b>Pay extra</b>", showarrow: false, xanchor: "right", font: { color: COL.pay, size: 13 } }];
    if (breakEven(2.5) > xMax * 0.2) annotations.push({ x: xMax * 0.02, y: 2.5, text: "<b>Keep the cash</b>", showarrow: false, xanchor: "left", font: { color: COL.mm, size: 13 } });
    const layout = {
      ...baseLayout(narrow() ? 340 : 380, narrow() ? { l: 50, r: 10, t: 10, b: 44 } : { l: 64, r: 20, t: 10, b: 50 }),
      showlegend: false,
      xaxis: { title: { text: "Car loan rate (APR)" }, ticksuffix: "%", range: [0, xMax], fixedrange: true },
      yaxis: {
        title: { text: t.niit ? "Federal bracket (+3.8% NIIT)" : "Federal tax bracket" },
        ticksuffix: "%", range: [0, 40], tickvals: BRACKETS, fixedrange: true,
      },
      annotations,
    };
    Plotly.react("chartMap", traces, layout, config);
    const be = breakEven(t.ord * 100) / 100;
    const gap = (p.apr - be) * 100;
    document.getElementById("mapNote").textContent =
      `Orange: paying extra wins. Blue: keeping the cash wins. Dashed line: break-even loan rate for each bracket, ` +
      `at a ${pct(p.mmRate)} money market yield` + (share > 0 ? " and this year's car loan deduction" : "") + `. ` +
      `At your ${Math.round(t.ord * 100)}% bracket the break-even rate is ${pct(be)}; your ${pct(p.apr)} loan is ` +
      `${Math.abs(gap).toFixed(2)} points ${gap >= 0 ? "above" : "below"} it.`;
  }

  // Chart 2: gain at the original end date by amount paid extra.
  function renderAmount(p) {
    const n = 50;
    const xs = Array.from({ length: n + 1 }, (_, i) => (p.balance * i) / n);
    const ys = xs.map((x) => K.simulate(p, x).net);
    const cur = K.simulate(p, state.prepay).net;
    const traces = [
      {
        type: "scatter", mode: "lines", x: xs, y: ys, line: { color: COL.pay, width: 3 },
        hovertemplate: "Pay %{x:$,.0f} extra → %{y:$,.0f}<extra></extra>",
      },
      {
        type: "scatter", mode: "markers", x: [state.prepay], y: [cur],
        marker: { size: 12, color: "#1d2330", line: { color: "#fff", width: 2 } },
        hovertemplate: "Your amount: %{x:$,.0f} → %{y:$,.0f}<extra></extra>",
      },
    ];
    Plotly.react("chartAmount", traces, {
      ...baseLayout(narrow() ? 300 : 340, narrow() ? { l: 56, r: 12, t: 10, b: 44 } : { l: 70, r: 20, t: 10, b: 50 }),
      showlegend: false,
      xaxis: { title: { text: "Extra payment now" }, tickprefix: "$", tickformat: "~s", fixedrange: true },
      yaxis: { title: { text: `Gain by ${monthLabel(p.months)}` }, tickprefix: "$", tickformat: "~s", fixedrange: true, zeroline: true, zerolinecolor: "#9aa3b2" },
    }, config);
  }

  // Chart 3: waterfall, number cards, and gain over time.
  function renderGain(p, r) {
    const short = narrow();
    const parts = [
      [short ? "Interest<br>saved" : "Interest saved", r.parts.interestSaved],
      [short ? "Money market<br>given up" : "Money market earnings<br>given up (after tax)", r.parts.mmGivenUp],
      [short ? "Deduction<br>given up" : "Car loan deduction<br>given up", r.parts.deductionGivenUp],
    ];
    document.getElementById("kpis").innerHTML = `
      <div style="--c:${r.net >= 0 ? COL.pay : COL.mm}"><span>Net gain</span><b>${U.money(r.net)}</b><small>by ${monthLabel(p.months)}, after tax</small></div>
      <div style="--c:${COL.payLight}"><span>Interest saved</span><b>${U.money(r.parts.interestSaved)}</b><small>car loan interest not paid</small></div>
      <div style="--c:#9aa3b2"><span>Paid off early</span><b>${r.monthsEarlier} mo</b><small>${r.pay.payoff === 0 ? "paid off now" : r.monthsEarlier > 0 ? `done ${monthLabel(r.pay.payoff)}` : "no change"}</small></div>`;

    Plotly.react("chartWaterfall", [{
      type: "waterfall",
      x: [...parts.map((d) => d[0]), "<b>Net gain</b>"],
      y: [...parts.map((d) => d[1]), r.net],
      measure: ["relative", "relative", "relative", "total"],
      text: [...parts.map((d) => U.money(d[1])), U.money(r.net)],
      textposition: "outside", cliponaxis: false,
      increasing: { marker: { color: COL.pay } },
      decreasing: { marker: { color: COL.mm } },
      totals: { marker: { color: r.net >= 0 ? "#a14200" : "#0f4f80" } },
      connector: { line: { color: "#c3c9d4" } },
      hovertemplate: "%{x}: %{text}<extra></extra>",
    }], {
      ...baseLayout(narrow() ? 320 : 340, narrow() ? { l: 50, r: 10, t: 24, b: 60 } : { l: 64, r: 20, t: 24, b: 56 }),
      showlegend: false,
      xaxis: { fixedrange: true, tickangle: 0, tickfont: { size: narrow() ? 10 : 12 } },
      yaxis: { tickprefix: "$", tickformat: "~s", fixedrange: true, zeroline: true, zerolinecolor: "#9aa3b2" },
    }, config);

    const months = r.gain.map((_, i) => i);
    const shapes = r.pay.payoff !== null && r.pay.payoff > 0 && r.pay.payoff < p.months
      ? [{ type: "line", x0: r.pay.payoff, x1: r.pay.payoff, yref: "paper", y0: 0, y1: 1, line: { color: "#1d2330", width: 1.5, dash: "dot" } }]
      : [];
    const annotations = shapes.length
      ? [{ x: r.pay.payoff, y: 1, yref: "paper", text: `Paid off ${monthLabel(r.pay.payoff)}`, showarrow: false, xanchor: "left", yanchor: "top", xshift: 4, font: { size: 11 } }]
      : [];
    Plotly.react("chartTime", [{
      type: "scatter", mode: "lines", x: months, y: r.gain, line: { color: COL.pay, width: 3 },
      customdata: months.map((m) => (m === 0 ? "Now" : monthLabel(m))),
      hovertemplate: "%{customdata}: %{y:$,.0f}<extra></extra>",
    }], {
      ...baseLayout(narrow() ? 280 : 320, narrow() ? { l: 56, r: 12, t: 10, b: 44 } : { l: 70, r: 20, t: 10, b: 50 }),
      showlegend: false, shapes, annotations,
      xaxis: { title: { text: "Months from now" }, fixedrange: true },
      yaxis: { title: { text: "Cumulative net gain" }, tickprefix: "$", tickformat: "~s", fixedrange: true, zeroline: true, zerolinecolor: "#9aa3b2" },
    }, config);
  }

  // ---------- Touch: tap a chart for its numbers ----------

  function tapPoint(el, ev) {
    const fl = el._fullLayout;
    if (!fl) return null;
    const size = fl._size, rect = el.getBoundingClientRect();
    const px = ev.clientX - rect.left - size.l, py = ev.clientY - rect.top - size.t;
    if (px < 0 || py < 0 || px > size.w || py > size.h) return null;
    return { x: fl.xaxis.p2d(px), y: fl.yaxis.p2d(py) };
  }
  function card(html) {
    const c = document.getElementById("tapcard");
    c.hidden = !html;
    if (html) c.querySelector(".body").innerHTML = html;
  }
  function wireTaps() {
    const on = (id, fn) => document.getElementById(id).addEventListener("click", (ev) => {
      const pt = tapPoint(ev.currentTarget, ev);
      card(pt && last ? fn(pt) : null);
    });
    on("chartMap", (pt) => {
      const t = last.r.rates, share = deductionShare(last.p, t);
      const car = (pt.x / 100) * (1 - (pt.y / 100) * share), mm = last.p.mmRate * (1 - pt.y / 100 - t.niit);
      return `<b>Loan ${pt.x.toFixed(2)}%, bracket ${pt.y.toFixed(1)}%</b><br>Loan after tax ${pct(car)} · money market after tax ${pct(mm)}<br>` +
        (car > mm ? `<b style="color:${COL.pay}">Pay extra</b>` : `<b style="color:${COL.mm}">Keep the cash</b>`);
    });
    on("chartAmount", (pt) => {
      const x = Math.max(0, Math.min(last.p.balance, pt.x));
      return `Pay <b>${U.money(x)}</b> extra → gain <b>${U.money(K.simulate(last.p, x).net)}</b> by ${monthLabel(last.p.months)}`;
    });
    on("chartTime", (pt) => {
      const m = Math.max(0, Math.min(last.p.months, Math.round(pt.x)));
      return `<b>${m === 0 ? "Now" : monthLabel(m)}</b>: cumulative gain <b>${U.money(last.r.gain[m])}</b>`;
    });
    document.getElementById("tapcard-close").addEventListener("click", () => card(null));
  }

  // ---------- Wiring ----------

  function init() {
    build();
    document.getElementById("reset").addEventListener("click", () => {
      state = defaults();
      mmEdited = false;
      build();
      scheduleRender();
    });
    document.getElementById("mmRefresh").addEventListener("click", () => loadTbill(true));
    let lastW = window.innerWidth;
    window.addEventListener("resize", () => {
      if (window.innerWidth !== lastW) { lastW = window.innerWidth; scheduleRender(); }
    });
    if (TOUCH) wireTaps();
    render();
    // Fill in the latest rate unless the user has already typed one.
    loadTbill(false).then(() => {
      if (tbill && !mmEdited) { state.mmRate = tbill.rate; onChange(); }
    });
  }

  init();
})();
