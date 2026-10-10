(function () {
  "use strict";
  const K = window.CarCalc, U = window.LoanUI;
  const COL = { loan: "#d95f02", mm: "#1f78b4", mmLight: "#a6cee3" };
  const TBILL_URL =
    "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query" +
    "?filter=security_type:eq:Bill,security_term:eq:13-Week&sort=-auction_date&page%5Bsize%5D=6" +
    "&fields=auction_date,high_investment_rate";
  const EQUAL_BAND = 0.0005; // rates within 0.05 percentage points count as about equal

  // First payment is next month.
  const now = new Date();
  const monthLabel = (m) => U.monthLabel(now.getMonth() + m, now.getFullYear());

  let tbill = null; // { rate, date } from the latest auction
  let mmEdited = false;
  const defaults = () => ({
    balance: 25000, apr: 6, months: 60, payment: 0,
    mmRate: tbill ? tbill.rate : 4, tax: 24,
    mode: "monthly", monthly: 200, lump: 5000,
  });
  let state = defaults();

  const loan = () => ({ balance: state.balance, apr: state.apr / 100, months: Math.max(1, Math.round(state.months)), payment: state.payment });
  const amount = () => (state.mode === "lump" ? state.lump : state.monthly);
  const pct = (v) => (v === null || !isFinite(v) ? "—" : (v * 100).toFixed(2) + "%");

  // ---------- Controls ----------

  let ctls = [];
  const onChange = (except) => { for (const c of ctls) c.sync(except); scheduleRender(); };
  function add(id, ctl) { document.getElementById(id).appendChild(ctl.el); ctls.push(ctl); return ctl; }
  const num = (label, unit, min, max, step, key, hint, set) => ({
    label, unit, min, max, step, hint, get: () => state[key], set: set || ((v) => (state[key] = v)),
  });

  function build() {
    ctls = [];
    for (const id of ["loanFields", "mmFields", "taxFields", "amountField"]) document.getElementById(id).innerHTML = "";
    add("loanFields", U.field(num("Current balance", "$", 1000, 100000, 500, "balance"), onChange));
    add("loanFields", U.field(num("APR", "%", 0, 25, 0.05, "apr"), onChange));
    add("loanFields", U.field(num("Months left", " mo", 1, 96, 1, "months", null, (v) => (state.months = Math.max(1, Math.round(v)))), onChange));
    add("loanFields", U.field(num("Monthly payment", "$", 0, 5000, 5, "payment", () => {
      const calc = K.amortPayment(state.balance, state.apr / 100, Math.max(1, Math.round(state.months)));
      return state.payment > 0
        ? `Using your payment. Calculated from balance, APR, and months: ${U.money(calc)}.`
        : `0 = calculated from balance, APR, and months: ${U.money(calc)}.`;
    }), onChange));

    add("mmFields", U.field(num("Yield before tax", "%", 0, 8, 0.01, "mmRate", null, (v) => { state.mmRate = v; mmEdited = true; }), onChange));
    add("taxFields", U.field(num("Marginal tax rate", "%", 0, 99, 0.5, "tax",
      () => "Your federal bracket, plus state tax and the 3.8% NIIT if they apply to your money market interest.",
      (v) => (state.tax = Math.min(100, v))), onChange));

    // Extra payment amount for the selected method.
    if (state.mode === "lump") {
      const f = add("amountField", U.field(num("Lump sum paid now", "$", 0, 100000, 100, "lump", () => `Up to the balance, ${U.money(state.balance)}.`), onChange));
      ctls.push({ sync: () => (f.el.querySelector("input[type=range]").max = state.balance) });
    } else {
      const f = add("amountField", U.field(num("Extra each month", "$", 0, 5000, 25, "monthly", () => {
        const max = K.maxAmount(loan(), "monthly");
        return `On top of the regular payment. ${U.money(max)} or more pays the loan off next month.`;
      }), onChange));
      // Slider covers up to 4× the payment; the number box takes any amount.
      ctls.push({ sync: () => (f.el.querySelector("input[type=range]").max = Math.max(25, Math.ceil(Math.min(K.maxAmount(loan(), "monthly"), 4 * K.basePayment(loan()))))) });
    }
    document.querySelectorAll('input[name="mode"]').forEach((r) => (r.checked = r.value === state.mode));
    for (const c of ctls) c.sync();
  }

  // ---------- Latest Treasury bill rate ----------

  async function loadTbill(apply) {
    const el = document.getElementById("mmStatus");
    el.textContent = "Loading the latest 13-week Treasury bill rate…";
    try {
      const json = await (await fetch(TBILL_URL)).json();
      const row = json.data.find((d) => d.high_investment_rate && d.high_investment_rate !== "null");
      tbill = { rate: +parseFloat(row.high_investment_rate).toFixed(2), date: row.auction_date };
      el.textContent = `Latest 13-week Treasury bill: ${tbill.rate.toFixed(2)}% (auction ${tbill.date}). ` +
        "Money market funds usually pay a little less after fees; enter your fund's 7-day yield if you know it.";
      if (apply || !mmEdited) {
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

  function render() {
    const p = loan();
    const t = state.tax / 100;
    const mmPre = state.mmRate / 100;
    const mmAfter = K.afterTaxYield(mmPre, t);
    const need = K.requiredPreTax(p.apr, t);
    const a = K.analyze(p, state.mode, amount());

    if (a.error) {
      document.getElementById("verdict").innerHTML = `<span class="neg">${U.esc(a.error)}</span>`;
      for (const id of ["rateTable", "breakEven", "kpis", "compare", "schedTable"]) document.getElementById(id).innerHTML = "";
      Plotly.purge("chartBars");
      return;
    }
    renderVerdict(p, mmPre, mmAfter, need, t);
    renderBars(p, mmPre, mmAfter);
    const be = K.breakEven(p, state.mode, mmAfter);
    renderBreakEven(p, a, be, mmAfter);
    renderResults(p, a, be, mmAfter);
  }

  // Section 1: recommendation and rate comparison.
  function renderVerdict(p, mmPre, mmAfter, need, t) {
    const diff = p.apr - mmAfter;
    let v;
    if (Math.abs(diff) < EQUAL_BAND) {
      v = `<b>About even.</b> The loan's ${pct(p.apr)} APR is close to the money market's ${pct(mmAfter)} after tax, ` +
        "so the money difference is small. Keeping cash on hand, or being debt-free sooner, can decide it.";
    } else if (diff > 0) {
      v = `<b style="color:${COL.loan}">Paying extra generally comes out ahead.</b> The loan costs ${pct(p.apr)}; the money ` +
        `market earns ${pct(mmAfter)} after tax. This assumes no prepayment penalty and that you keep enough emergency savings.`;
    } else {
      v = `<b style="color:${COL.mm}">Keeping the money in the money market may be better.</b> It earns ${pct(mmAfter)} after ` +
        `tax, more than the loan's ${pct(p.apr)} APR.`;
    }
    document.getElementById("verdict").innerHTML = v;
    const needText = need === null
      ? "Not possible at a 100% tax rate."
      : `The money market would need about <b>${pct(need)}</b> before tax to match the ${pct(p.apr)} loan at a ${state.tax}% tax rate.`;
    document.getElementById("rateTable").innerHTML = `
      <tbody>
        <tr><td>Car loan APR</td><td>${pct(p.apr)}</td></tr>
        <tr><td>Money market, before tax</td><td>${pct(mmPre)}</td></tr>
        <tr><td>Money market, after ${state.tax}% tax</td><td><b>${pct(mmAfter)}</b></td></tr>
        <tr><td>Before-tax yield needed to match the APR</td><td>${need === null ? "—" : pct(need)}</td></tr>
      </tbody>
      <caption>${needText}</caption>`;
  }

  function renderBars(p, mmPre, mmAfter) {
    const rows = [
      { label: "Money market, before tax", v: mmPre, c: COL.mmLight },
      { label: "Money market, after tax", v: mmAfter, c: COL.mm },
      { label: "Car loan APR", v: p.apr, c: COL.loan },
    ];
    const max = Math.max(...rows.map((r) => r.v)) * 100;
    draw("chartBars", [{
      type: "bar", orientation: "h", y: rows.map((r) => r.label), x: rows.map((r) => r.v * 100),
      marker: { color: rows.map((r) => r.c) }, text: rows.map((r) => pct(r.v)), textposition: "outside",
      cliponaxis: false, hoverinfo: "skip",
    }], {
      height: 150, margin: { l: 8, r: 50, t: 4, b: 26 }, dragmode: false, showlegend: false,
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: { size: narrow() ? 11 : 12 },
      xaxis: { ticksuffix: "%", range: [0, max * 1.18 || 1], fixedrange: true },
      yaxis: { automargin: true, fixedrange: true },
    });
  }

  function draw(id, traces, layout) {
    const el = document.getElementById(id);
    Plotly.react(el, traces, { ...layout, width: Math.max(260, Math.floor(el.clientWidth)) },
      { displayModeBar: false, scrollZoom: false, staticPlot: true });
  }

  // Section 2: return on the proposed payment and the break-even search result.
  function renderBreakEven(p, a, be, mmAfter) {
    const what = state.mode === "lump" ? "lump sum" : "monthly extra payment";
    const irrLine = a.irrAnnual === null
      ? `Enter an amount above $0 to see the return on a ${what}.`
      : `Return on this ${what}: <b>${pct(a.irrAnnual)}</b> a year (IRR), versus <b>${pct(mmAfter)}</b> after tax in the money market.`;
    let beLine;
    switch (be.status) {
      case "found":
        beLine = `Break-even ${what}: <b>${U.money(be.amount)}</b>.`;
        break;
      case "every":
        beLine = `<b>Every amount is at break-even:</b> each extra dollar earns ${pct(be.rate)}, the same as the money market after tax.`;
        break;
      case "flat":
        beLine = `<b>No break-even amount exists.</b> Every extra dollar earns ${pct(be.rate)}, which is the loan's APR, ` +
          `whether you pay $1 or the whole balance: each dollar paid early stops ${pct(p.apr)} interest on that dollar. ` +
          (be.rate > mmAfter
            ? `Since ${pct(be.rate)} beats ${pct(mmAfter)}, any extra amount comes out ahead, and paying more gains more.`
            : `Since ${pct(be.rate)} is below ${pct(mmAfter)}, any extra amount comes out behind.`) +
          " What decides it is the rate comparison in section 1, not the amount.";
        break;
      default:
        beLine = be.reason === "range"
          ? `No ${what} is possible: the next regular payment already pays the loan off.`
          : `No break-even amount could be found: the return could not be calculated for these inputs.`;
    }
    document.getElementById("breakEven").innerHTML = `<p>${irrLine}</p><p>${beLine}</p>`;
  }

  // Section 3: what the selected payment does, against the regular schedule.
  function renderResults(p, a, be, mmAfter) {
    const amt = a.amount;
    const what = state.mode === "lump" ? "one-time" : "per month";
    const newEnd = a.scen.months === 0 ? "Paid off now" : monthLabel(a.scen.months);
    document.getElementById("kpis").innerHTML = `
      <div style="--c:${COL.loan}"><span>Interest saved</span><b>${U.money(a.interestSaved)}</b><small>vs. the regular schedule</small></div>
      <div style="--c:#9aa3b2"><span>Time saved</span><b>${a.monthsSaved} mo</b><small>earlier payoff</small></div>
      <div style="--c:#9aa3b2"><span>New payoff date</span><b>${newEnd}</b><small>was ${monthLabel(a.base.months)}</small></div>
      <div style="--c:${COL.mm}"><span>Extra payment</span><b>${U.money(amt)}</b><small>${what}</small></div>`;

    let cmp;
    if (amt <= 0) {
      cmp = "Enter an extra amount to compare it with the money market.";
    } else {
      const beText = be.status === "found"
        ? `This is ${Math.abs(amt - be.amount) < 0.5 ? "at" : amt > be.amount ? "above" : "below"} the break-even amount of ${U.money(be.amount)}.`
        : be.status === "every"
          ? "Every amount is at break-even."
          : "There is no break-even amount to compare with (see section 2).";
      const adv = K.advantageAtBaseEnd(a, mmAfter);
      const favorable = a.irrAnnual !== null && a.irrAnnual > mmAfter + EQUAL_BAND / 10;
      const even = a.irrAnnual !== null && Math.abs(a.irrAnnual - mmAfter) <= EQUAL_BAND / 10;
      cmp = `<b>Break-even comparison:</b> ${beText} ` +
        `<b>Financial comparison:</b> paying ${U.money(amt)} ${state.mode === "lump" ? "now" : "extra each month"} earns ${pct(a.irrAnnual)} ` +
        `versus ${pct(mmAfter)} after tax in the money market, so it is ${even ? "about even" : favorable ? "<b>favorable</b>" : "<b>unfavorable</b>"}. ` +
        `By ${monthLabel(a.base.months)}, when the loan was due to end, that's about ${U.money(Math.abs(adv))} ` +
        `${adv >= 0 ? "more" : "less"} than keeping the money in the money market (after tax).`;
    }
    document.getElementById("compare").innerHTML = cmp;

    const row = (label, b, s) => `<tr><td>${label}</td><td>${b}</td><td>${s}</td></tr>`;
    document.getElementById("schedTable").innerHTML = `
      <thead><tr><th></th><th>Regular schedule</th><th>With extra payment</th></tr></thead>
      <tbody>
        ${row("Monthly payment", U.money(a.payment), state.mode === "monthly" && amt > 0 ? `${U.money(a.payment)} + ${U.money(amt)} extra` : U.money(a.payment))}
        ${row("Paid now", "—", state.mode === "lump" && amt > 0 ? U.money(amt) : "—")}
        ${row("Payments left", a.base.months, a.scen.months)}
        ${row("Last payment", `${U.money(a.base.finalPayment)} in ${monthLabel(a.base.months)}`, a.scen.months ? `${U.money(a.scen.finalPayment)} in ${monthLabel(a.scen.months)}` : "—")}
        ${row("Total interest", U.money(a.base.totalInterest), U.money(a.scen.totalInterest))}
        ${row("Total paid", U.money(a.base.totalPaid), U.money(a.scen.totalPaid))}
      </tbody>`;
  }

  // ---------- Wiring ----------

  function init() {
    build();
    document.querySelectorAll('input[name="mode"]').forEach((r) =>
      r.addEventListener("change", () => { state.mode = r.value; build(); scheduleRender(); }));
    document.getElementById("reset").addEventListener("click", () => {
      state = defaults();
      mmEdited = false;
      build();
      scheduleRender();
    });
    document.getElementById("mmRefresh").addEventListener("click", () => loadTbill(true));
    // Redraw when the result column changes width (window resize or layout change).
    const viz = document.getElementById("viz");
    let lastW = viz.clientWidth;
    new ResizeObserver(() => {
      if (viz.clientWidth !== lastW) { lastW = viz.clientWidth; scheduleRender(); }
    }).observe(viz);
    render();
    loadTbill(false);
  }

  init();
})();
