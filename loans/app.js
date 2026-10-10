(function () {
  "use strict";
  const S = window.LoanSim, U = window.LoanUI, C = window.LoanCharts;
  const TOUCH = window.matchMedia("(hover: none), (pointer: coarse)").matches;
  const MAX_LOANS = 6;
  const MAX_CELLS = 25;
  const MC_PATHS = 500;

  // ---------- State (rates in percent, as shown in the UI) ----------

  const TYPE_PRESETS = {
    primary: { balance: 300000, rate: 6.5, termMonths: 360, secured: true, assetValue: 400000, assetGrowth: 3 },
    second: { balance: 250000, rate: 7, termMonths: 360, secured: true, assetValue: 320000, assetGrowth: 3 },
    rental: { balance: 250000, rate: 7, termMonths: 360, secured: true, assetValue: 320000, assetGrowth: 3, tax: { rentalUsable: true } },
    heloc: { balance: 50000, rate: 8.5, termMonths: 240, secured: true, assetValue: 0, tax: { helocUse: "improve" } },
    auto: { balance: 25000, rate: 7, termMonths: 60, secured: true, assetValue: 0, origination: "2025-09", tax: { newVehicle: true, usAssembly: true, personalUse: true } },
    personal: { balance: 15000, rate: 12, termMonths: 48, secured: false, tax: { personalUse: "personal" } },
    student: { balance: 30000, rate: 6, termMonths: 120, secured: false },
    business: { balance: 50000, rate: 9, termMonths: 84, secured: false, tax: { businessPct: 100 } },
    custom: { balance: 10000, rate: 8, termMonths: 60, secured: false, tax: { customTreatment: "none" } },
  };

  function newLoan(type, name) {
    const p = TYPE_PRESETS[type];
    return {
      name, type, balance: p.balance, rate: p.rate, apr: 0, termMonths: p.termMonths, paymentOverride: 0,
      rateType: "fixed", newRate: p.rate + 1, changeMonth: 24, schedule: "amortizing", ioMonths: 60,
      penaltyPct: 0, penaltyFee: 0, origination: p.origination || "2024-01", secured: p.secured,
      assetValue: p.assetValue || 0, assetGrowth: p.assetGrowth || 0, pmi: 0, pmiEndBalance: 0,
      manualAmount: 0, tax: { ...(p.tax || {}) },
    };
  }

  function defaultState() {
    const mortgage = { ...newLoan("primary", "Home mortgage"), balance: 400000, termMonths: 324, origination: "2023-10", assetValue: 500000 };
    const car = { ...newLoan("auto", "Car loan"), balance: 25000, rate: 7, termMonths: 60 };
    return {
      status: "mfj", income: 180000, saltPaid: 12000, otherItemized: 3000, horizon: 10, view: "after",
      cash: 50000, extraMonthly: 0,
      totalReturn: 7, dividendYield: 1.5, qualifiedPct: 90, interestYield: 0, expenseRatio: 0.05, volatility: 15,
      allocation: "rate", recast: "keep", freed: "invest",
      loans: [mortgage, car],
      heat: { loan: 0, rateMin: 2, rateMax: 10, rateStep: 0.5, retMin: 2, retMax: 12, retStep: 0.5 },
    };
  }

  let state = defaultState();
  let tableSort = { key: null, dir: -1 };
  let last = null; // last computed results, for tap cards

  const isMortgage = (l) => S.LOAN_TYPES[l.type].mortgage;

  function toInputs(st) {
    return {
      profile: { status: st.status, income: st.income, saltPaid: st.saltPaid, otherItemized: st.otherItemized },
      cash: st.cash, extraMonthly: st.extraMonthly, horizonYears: st.horizon,
      inv: {
        totalReturn: st.totalReturn / 100, dividendYield: st.dividendYield / 100, qualifiedPct: st.qualifiedPct / 100,
        interestYield: st.interestYield / 100, expenseRatio: st.expenseRatio / 100, volatility: st.volatility / 100,
      },
      allocation: st.allocation, recast: st.recast === "recast", freed: st.freed,
      loans: st.loans.map((l) => ({
        ...l,
        rate: l.rate / 100,
        newRate: l.newRate / 100,
        variable: l.rateType === "variable",
        termMonths: Math.max(1, Math.round(l.termMonths)),
        ioMonths: l.schedule === "io" ? Math.min(Math.round(l.ioMonths), Math.round(l.termMonths) - 1) : 0,
        changeMonth: Math.round(l.changeMonth),
        assetValue: l.secured ? l.assetValue : 0,
        assetGrowth: l.assetGrowth / 100,
        pmi: isMortgage(l) ? l.pmi : 0,
      })),
    };
  }

  // ---------- Controls ----------

  let ctlGeneral = [], ctlLoans = [];
  const onChange = (except) => { syncControls(except); scheduleRender(); };
  const add = (host, list, ctl) => { host.appendChild(ctl.el); list.push(ctl); return ctl; };
  const num = (label, unit, min, max, step, obj, key, hint, setter) => ({
    label, unit, min, max, step, hint,
    get: () => obj()[key],
    set: setter || ((v) => (obj()[key] = v)),
  });

  function buildGeneral() {
    ctlGeneral = [];
    const st = () => state;
    const g = document.getElementById("generalFields");
    g.innerHTML = "";
    add(g, ctlGeneral, U.select({ label: "Filing status", options: [["single", "Single"], ["mfj", "Married filing jointly"]], get: () => state.status, set: (v) => (state.status = v) }, onChange));
    add(g, ctlGeneral, U.field(num("Other income (wages etc.)", "$", 0, 1000000, 1000, st, "income", () => "Ordinary income before any loan or investment items. Held the same every year."), onChange));
    add(g, ctlGeneral, U.field(num("State and local taxes paid", "$", 0, 100000, 500, st, "saltPaid", () => "For the SALT deduction ($40,400 cap in 2026)."), onChange));
    add(g, ctlGeneral, U.field(num("Other itemized deductions", "$", 0, 100000, 500, st, "otherItemized", () => "Charity and similar. Not counting loan interest."), onChange));
    add(g, ctlGeneral, U.field(num("Horizon", " yr", 1, 40, 1, st, "horizon", () => `Compare at the end of ${S.START_YEAR + state.horizon - 1}.`, (v) => (state.horizon = Math.max(1, Math.min(50, Math.round(v))))), onChange));

    const c = document.getElementById("cashFields");
    c.innerHTML = "";
    add(c, ctlGeneral, U.field(num("Cash available now", "$", 0, 500000, 1000, st, "cash"), onChange));
    add(c, ctlGeneral, U.field(num("Extra savings each month", "$", 0, 10000, 50, st, "extraMonthly", () => "Invested in both strategies."), onChange));
    add(c, ctlGeneral, U.field(num("Expected total return", "%", -5, 15, 0.1, st, "totalReturn", () => {
      const g = state.totalReturn - state.dividendYield - state.interestYield;
      return `Price growth ${g.toFixed(2)}% + dividends ${state.dividendYield}% + interest ${state.interestYield}%, before fees.`;
    }), onChange));
    add(c, ctlGeneral, U.field(num("Dividend yield", "%", 0, 6, 0.05, st, "dividendYield"), onChange));
    add(c, ctlGeneral, U.field(num("Qualified share of dividends", "%", 0, 100, 1, st, "qualifiedPct"), onChange));
    add(c, ctlGeneral, U.field(num("Interest-income yield", "%", 0, 6, 0.05, st, "interestYield"), onChange));
    add(c, ctlGeneral, U.field(num("Expense ratio", "%", 0, 2, 0.01, st, "expenseRatio"), onChange));
    add(c, ctlGeneral, U.field(num("Volatility (risk chart)", "%", 0, 40, 1, st, "volatility", () => "Yearly standard deviation; about 15–18% for a stock index fund."), onChange));

    const s = document.getElementById("strategyFields");
    s.innerHTML = "";
    add(s, ctlGeneral, U.select({
      label: "Which loans get the cash",
      options: [["rate", "Highest note rate first"], ["aftertax", "Highest after-tax rate first"], ["manual", "Manual amount per loan"]],
      get: () => state.allocation, set: (v) => { state.allocation = v; buildLoans(); },
    }, onChange));
    add(s, ctlGeneral, U.select({
      label: "After a prepayment",
      options: [["keep", "Keep payment, finish sooner"], ["recast", "Recast: lower payment, same end"]],
      get: () => state.recast, set: (v) => (state.recast = v),
    }, onChange));
    add(s, ctlGeneral, U.select({
      label: "Payments freed up",
      options: [["invest", "Invest them"], ["snowball", "Snowball to next loan, then invest"]],
      get: () => state.freed, set: (v) => (state.freed = v),
    }, onChange));

    const h = document.getElementById("heatFields");
    h.innerHTML = "";
    const hs = () => state.heat;
    add(h, ctlGeneral, {
      ...U.select({ label: "Loan on the x-axis", options: [], get: () => String(state.heat.loan), set: (v) => (state.heat.loan = +v) }, onChange),
    });
    add(h, ctlGeneral, U.field(num("Rate from", "%", 0, 30, 0.25, hs, "rateMin"), onChange));
    add(h, ctlGeneral, U.field(num("Rate to", "%", 0, 30, 0.25, hs, "rateMax"), onChange));
    add(h, ctlGeneral, U.field(num("Rate step", "%", 0.05, 5, 0.05, hs, "rateStep", null, (v) => (state.heat.rateStep = Math.max(0.01, v))), onChange));
    add(h, ctlGeneral, U.field(num("Return from", "%", -5, 20, 0.25, hs, "retMin"), onChange));
    add(h, ctlGeneral, U.field(num("Return to", "%", -5, 20, 0.25, hs, "retMax"), onChange));
    add(h, ctlGeneral, U.field(num("Return step", "%", 0.05, 5, 0.05, hs, "retStep", null, (v) => (state.heat.retStep = Math.max(0.01, v))), onChange));
  }

  function refreshHeatLoanOptions() {
    const sel = document.querySelector("#heatFields select");
    if (state.heat.loan >= state.loans.length) state.heat.loan = 0;
    sel.innerHTML = state.loans.map((l, k) => `<option value="${k}">${U.esc(l.name)}</option>`).join("");
    sel.value = String(state.heat.loan);
  }

  const openPanels = [];

  function buildLoans() {
    ctlLoans = [];
    const host = document.getElementById("loans");
    host.innerHTML = "";
    state.loans.forEach((loan, k) => {
      if (openPanels[k] === undefined) openPanels[k] = window.innerWidth >= 700;
      const L = () => state.loans[k];
      const T = () => state.loans[k].tax;
      const sec = document.createElement("details");
      sec.className = "panel loan";
      sec.open = openPanels[k];
      sec.addEventListener("toggle", () => (openPanels[k] = sec.open));
      sec.innerHTML = `<summary><h2></h2><span class="status"></span></summary>`;
      sec.querySelector("h2").textContent = loan.name;
      host.appendChild(sec);
      const body = document.createElement("div");
      sec.appendChild(body);
      const a = (ctl) => add(body, ctlLoans, ctl);
      const h3 = (t) => { const e = document.createElement("h3"); e.textContent = t; body.appendChild(e); };
      const structural = (fn) => (v) => { fn(v); buildLoans(); };

      a(U.select({
        label: "Loan type",
        options: Object.entries(S.LOAN_TYPES).map(([v, t]) => [v, t.label]),
        get: () => L().type,
        set: structural((v) => {
          const p = TYPE_PRESETS[v];
          Object.assign(L(), { type: v, secured: p.secured, tax: { ...(p.tax || {}) } });
          if (v === "auto") L().origination = p.origination;
        }),
      }, onChange));
      const nameRow = document.createElement("label");
      nameRow.className = "row";
      nameRow.innerHTML = `<span>Name</span><input type="text" class="name" maxlength="30">`;
      const nameInput = nameRow.querySelector("input");
      nameInput.value = loan.name;
      nameInput.addEventListener("input", () => {
        L().name = nameInput.value || `Loan ${k + 1}`;
        sec.querySelector("h2").textContent = L().name;
        refreshHeatLoanOptions();
        scheduleRender();
      });
      body.appendChild(nameRow);

      a(U.field(num("Current balance", "$", 0, 2000000, 1000, L, "balance"), onChange));
      a(U.field(num("Note (contract) interest rate", "%", 0, 30, 0.05, L, "rate"), onChange));
      a(U.field(num("APR (optional, reference only)", "%", 0, 30, 0.05, L, "apr", () => "APR can include fees. Fees on an existing loan are already paid, so the note rate drives the payments."), onChange));
      a(U.field(num("Remaining term", " mo", 1, 480, 1, L, "termMonths", () => {
        const m = Math.round(L().termMonths);
        return `${Math.floor(m / 12)} yr ${m % 12} mo; ends ${U.monthLabel(m - 1, S.START_YEAR)}`;
      }), onChange));
      a(U.field(num("Scheduled monthly payment", "$", 0, 20000, 10, L, "paymentOverride", () => paymentHint(k)), onChange));

      h3("Rate and schedule");
      a(U.select({ label: "Rate", options: [["fixed", "Fixed"], ["variable", "Variable (one change)"]], get: () => L().rateType, set: structural((v) => (L().rateType = v)) }, onChange));
      if (loan.rateType === "variable") {
        a(U.field(num("New rate", "%", 0, 30, 0.05, L, "newRate"), onChange));
        a(U.field(num("Rate changes after", " mo", 1, 360, 1, L, "changeMonth", () => "The payment is recalculated then. Simplified: real adjustable rates change repeatedly."), onChange));
      }
      a(U.select({ label: "Repayment", options: [["amortizing", "Amortizing"], ["io", "Interest-only first"]], get: () => L().schedule, set: structural((v) => (L().schedule = v)) }, onChange));
      if (loan.schedule === "io") {
        a(U.field(num("Interest-only months left", " mo", 1, 240, 1, L, "ioMonths", () => "Then the balance amortizes over the rest of the term. HELOC re-draws are not modeled."), onChange));
      }
      h3("Prepayment");
      a(U.field(num("Prepayment penalty", "%", 0, 5, 0.1, L, "penaltyPct", () => "Percent of the amount prepaid."), onChange));
      a(U.field(num("Fixed prepayment fee", "$", 0, 5000, 25, L, "penaltyFee", () => "Charged on the first prepayment."), onChange));
      if (state.allocation === "manual") {
        a(U.field(num("Cash to put toward this loan", "$", 0, 500000, 500, L, "manualAmount", () => "Pay Off strategy only. Loans are paid in the order listed; any cash left over is invested."), onChange));
      }

      h3("Collateral and taxes");
      a(U.month({ label: "Originated", get: () => L().origination, set: (v) => (L().origination = v) }, onChange));
      a(U.check({ label: "Secured by property or another asset", get: () => L().secured, set: structural((v) => (L().secured = v)) }, onChange));
      if (loan.secured) {
        a(U.field(num("Asset value (optional)", "$", 0, 3000000, 5000, L, "assetValue", () => "Counted the same in both strategies. Enter a shared home once."), onChange));
        a(U.field(num("Asset value change per year", "%", -25, 10, 0.5, L, "assetGrowth"), onChange));
      }
      if (isMortgage(loan)) {
        a(U.field(num("Mortgage insurance (PMI)", "$", 0, 1000, 5, L, "pmi", () => "Per month. Ends once the balance reaches the amount below."), onChange));
        a(U.field(num("PMI ends at balance", "$", 0, 2000000, 1000, L, "pmiEndBalance", () => "Often 78–80% of the original home value."), onChange));
      }
      switch (loan.type) {
        case "heloc":
          a(U.select({ label: "Money was used to", options: [["improve", "Buy, build, or improve this home"], ["other", "Anything else"]], get: () => T().helocUse || "improve", set: (v) => (T().helocUse = v) }, onChange));
          break;
        case "auto":
          a(U.check({ label: "New vehicle (original use starts with you)", get: () => T().newVehicle, set: (v) => (T().newVehicle = v) }, onChange));
          a(U.check({ label: "Final assembly in the U.S.", get: () => T().usAssembly, set: (v) => (T().usAssembly = v) }, onChange));
          a(U.check({ label: "Personal use", get: () => T().personalUse, set: (v) => (T().personalUse = v) }, onChange));
          break;
        case "personal":
          a(U.select({ label: "Used for", options: [["personal", "Personal spending"], ["investment", "Buying investments"]], get: () => T().personalUse || "personal", set: (v) => (T().personalUse = v) }, onChange));
          break;
        case "rental":
          a(U.check({ label: "Rental losses are usable this year", get: () => T().rentalUsable, set: (v) => (T().rentalUsable = v) }, onChange));
          break;
        case "business":
          a(U.field(num("Share of interest deductible", "%", 0, 100, 5, T, "businessPct"), onChange));
          break;
        case "custom":
          a(U.select({ label: "Interest is", options: [["none", "Not deductible"], ["itemized", "An itemized deduction"], ["above", "Deductible, itemizing or not"]], get: () => T().customTreatment || "none", set: (v) => (T().customTreatment = v) }, onChange));
          break;
      }
      const note = document.createElement("p");
      note.className = "taxnote";
      body.appendChild(note);
      ctlLoans.push({ el: note, sync: () => {
        const c = S.classify(toInputs(state).loans[k]);
        const status = S.LOAN_TYPES[L().type].status;
        const st = sec.querySelector("summary .status");
        st.className = "status " + status;
        st.textContent = statusLabel(status);
        note.innerHTML = `<span class="status ${status}">${statusLabel(status)}</span> ${U.esc(c.text)}`;
      } });

      if (state.loans.length > 1) {
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "remove";
        rm.textContent = "Remove this loan";
        rm.addEventListener("click", () => {
          state.loans.splice(k, 1);
          openPanels.splice(k, 1);
          buildLoans();
          onChange();
        });
        body.appendChild(rm);
      }
    });
    document.getElementById("addLoan").disabled = state.loans.length >= MAX_LOANS;
    refreshHeatLoanOptions();
    syncControls();
  }

  const statusLabel = (s) => ({ verified: "Verified rule", simplified: "Simplified", assumption: "Your assumption" })[s];

  function paymentHint(k) {
    const l = toInputs(state).loans[k];
    const calc = S.amortPayment(l.balance, l.rate, l.termMonths - l.ioMonths);
    let h = `0 = calculated: ${U.money(calc)}/mo` + (l.ioMonths ? ` after ${l.ioMonths} interest-only months` : "") + ".";
    if (l.paymentOverride > 0 && l.paymentOverride < (l.balance * l.rate) / 12) h += " Warning: less than the monthly interest, so the balance grows.";
    return h;
  }

  function syncControls(except) {
    for (const c of ctlGeneral) c.sync(except);
    for (const c of ctlLoans) c.sync(except);
  }

  // ---------- Rendering ----------

  let pending = false, heavyTimer = null;
  function scheduleRender() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      render();
    });
  }

  const narrow = () => window.innerWidth < 700;
  const chartOpts = () => ({ narrow: narrow(), touch: TOUCH, years: state.horizon });

  function render() {
    const inp = toInputs(state);
    const res = S.simulate(inp);
    const att = S.attribution(res);
    last = { inp, res, att, mc: null, heat: null };
    renderSummary(inp, res, att);
    C.netWorth(document.getElementById("chartA"), res, state.view, chartOpts());
    C.waterfall(document.getElementById("chartC"), att, chartOpts());
    renderLoanTable(inp, res);
    document.getElementById("riskNote").textContent = "Computing…";
    clearTimeout(heavyTimer);
    heavyTimer = setTimeout(() => renderHeavy(inp), 120);
  }

  function rangeValues(lo, hi, step) {
    const out = [];
    if (!(step > 0) || hi < lo) return [lo];
    for (let v = lo; v <= hi + step * 1e-6 && out.length < MAX_CELLS; v += step) out.push(+v.toFixed(6));
    return out;
  }

  function renderHeavy(inp) {
    const h = state.heat;
    const k = Math.min(h.loan, inp.loans.length - 1);
    const rates = rangeValues(h.rateMin, h.rateMax, h.rateStep).map((r) => r / 100);
    const returns = rangeValues(h.retMin, h.retMax, h.retStep).map((r) => r / 100);
    const z = S.heatmap(inp, k, rates, returns);
    const loan = inp.loans[k];
    const truncated = (h.rateMax - h.rateMin) / h.rateStep + 1 > MAX_CELLS + 1e-9 || (h.retMax - h.retMin) / h.retStep + 1 > MAX_CELLS + 1e-9;
    document.getElementById("heatNote").textContent =
      `Each cell: Invest minus Pay Off net worth after ${state.horizon} years, after tax if sold. ` +
      `X-axis: ${loan.name}'s note rate, with its payment recalculated from balance and term. ` +
      `Y-axis: expected total return, with dividend and interest yields unchanged. Other loans keep their inputs, and the cash goes to the loans in the same order as at your current inputs. ` +
      `The circle marks your current inputs.` + (truncated ? ` Only the first ${MAX_CELLS} steps per axis are shown; raise the step.` : "");
    last.heat = { rates, returns, z, loanName: loan.name };
    C.heatmap(document.getElementById("chartB"), { rates, returns, z, loanName: loan.name, current: { rate: loan.rate, ret: inp.inv.totalReturn } }, chartOpts());

    const mc = S.monteCarlo(inp, MC_PATHS);
    last.mc = mc;
    C.fan(document.getElementById("chartE"), mc, chartOpts());
    document.getElementById("riskNote").textContent =
      `${MC_PATHS} simulated market paths with ${state.volatility}% yearly volatility around your expected return. ` +
      `Both strategies face the same path in each run (Pay Off also invests what it frees up). ` +
      `The band shows the spread of Invest minus Pay Off. Expected returns are not guaranteed, and real markets can be worse than this model.`;
    const P = mc.percentiles.map((p) => `${Math.round(p * 100)}th`);
    const row = (label, vals) => `<tr><td>${label}</td>${vals.map((v) => `<td>${U.kMoney(v)}</td>`).join("")}</tr>`;
    document.getElementById("riskTable").innerHTML =
      `<thead><tr><th>At ${S.START_YEAR + state.horizon - 1} year end</th>${P.map((p) => `<th>${p}</th>`).join("")}</tr></thead><tbody>` +
      row("Pay Off Debt net worth", mc.payoff) + row("Invest net worth", mc.invest) +
      row("Invest − Pay Off", mc.diff.at(-1)) + `</tbody>`;
    const prob = document.getElementById("probLine");
    if (prob) {
      prob.innerHTML = `<b>Risk:</b> with ${state.volatility}% volatility, Invest finishes ahead in ` +
        `<b>${Math.round(mc.probInvestAhead * 100)}%</b> of ${MC_PATHS} simulated paths. ` +
        `Middle 90% of outcomes for Invest − Pay Off: ${U.kSigned(mc.diff.at(-1)[0])} to ${U.kSigned(mc.diff.at(-1)[4])}.`;
    }
  }

  function renderSummary(inp, res, att) {
    const a = res.payoff.snaps.at(-1), b = res.invest.snaps.at(-1);
    const winner = att.total >= 0 ? "invest" : "payoff";
    const endLabel = `the end of ${S.START_YEAR + state.horizon - 1}`;
    const close = Math.abs(att.total) < 100;
    const head = close
      ? `By ${endLabel}, the two strategies end within ${U.money(100)} of each other.`
      : `By ${endLabel}, <b style="color:${C.COLORS[winner]}">${C.NAMES[winner]}</b> is ahead by <b>${U.money(Math.abs(att.total))}</b> after tax if investments were sold` +
        ` (${U.kSigned(b.nwPre - a.nwPre)} for Invest before selling).`;
    const top = att.parts.filter((p) => Math.abs(p.value) >= 1).sort((x, y) => Math.abs(y.value) - Math.abs(x.value)).slice(0, 3);
    const reasons = top.map((p) => `<li>${U.esc(p.label)}: ${U.money(Math.abs(p.value))} in favor of ${p.value > 0 ? "Invest" : "Pay Off Debt"}.</li>`).join("");

    // Context: what paying off "earns" vs what investing is expected to earn.
    const prepaid = res.payoff.perLoan.map((p, k) => ({ p, k })).filter((x) => x.p.prepaid > 0);
    const atr = prepaid.map(({ k }) => `${U.esc(inp.loans[k].name)} ${U.pct(res.afterTax[k].rate)} after tax (${U.pct(inp.loans[k].rate)} note rate)`).join("; ");
    const context = prepaid.length
      ? `<p>Paying off earns a certain return equal to each loan's after-tax rate: ${atr}. Investing is expected to earn ` +
        `${U.pct(inp.inv.totalReturn)} a year before taxes and fees, but that is not guaranteed. ` +
        `The comparison also depends on taxes, fees, and how long the cash stays invested, so neither the rate nor the return alone decides it.</p>`
      : `<p>With these inputs no cash goes to the loans in the Pay Off strategy, so the two strategies are the same.</p>`;

    const warnings = [];
    if (inp.inv.totalReturn - inp.inv.dividendYield - inp.inv.interestYield < 0) warnings.push("Dividend and interest yields exceed the total return, so price growth is negative.");
    inp.loans.forEach((l, k) => {
      if (l.paymentOverride > 0 && l.paymentOverride < (l.balance * l.rate) / 12) warnings.push(`${U.esc(l.name)}: the payment is less than the interest, so the balance grows.`);
      if (l.type === "student") warnings.push(`${U.esc(l.name)}: if this loan could be forgiven (e.g. PSLF or income-driven repayment), prepaying may waste money. Forgiveness is not modeled.`);
      if (S.LOAN_TYPES[l.type].status !== "verified") warnings.push(`${U.esc(l.name)}: tax treatment is ${statusLabel(S.LOAN_TYPES[l.type].status).toLowerCase()}; see the loan's tax note.`);
    });
    if (inp.loans.filter((l) => l.assetValue > 0).length > 1) warnings.push("Several loans include an asset value. If they share one property, enter its value once to avoid counting it twice (it does not change the difference).");
    warnings.push("Cash kept in investments stays available for emergencies; money used to prepay a loan usually cannot be taken back out. This model does not put a value on that.");

    document.getElementById("summary").innerHTML = `
      <p class="headline">${head}</p>
      <div class="kpis">
        <div style="--c:${C.COLORS.payoff}"><span>Pay Off Debt</span><b>${U.money(a.nwAfter)}</b><small>Loans left ${U.kMoney(a.loanBal)} · Investments ${U.kMoney(a.invValue)}</small></div>
        <div style="--c:${C.COLORS.invest}"><span>Invest</span><b>${U.money(b.nwAfter)}</b><small>Loans left ${U.kMoney(b.loanBal)} · Investments ${U.kMoney(b.invValue)}</small></div>
      </div>
      <h3>Why, under these assumptions</h3>
      <ul>${reasons}</ul>
      ${context}
      <p id="probLine" class="prob">Risk: computing…</p>
      <details class="cautions"><summary>Cautions (${warnings.length})</summary><ul>${warnings.map((w) => `<li>${w}</li>`).join("")}</ul></details>`;
  }

  function renderLoanTable(inp, res) {
    const rows = inp.loans.map((l, k) => {
      const pay = res.payoff.perLoan[k], inv = res.invest.perLoan[k];
      return {
        name: l.name, type: S.LOAN_TYPES[l.type].label, status: S.LOAN_TYPES[l.type].status,
        balance: l.balance, rate: l.rate, apr: l.apr > 0 ? l.apr / 100 : null, atr: res.afterTax[k].rate,
        term: l.termMonths, payoffInvest: inv.payoffMonth, payoffPay: pay.payoffMonth,
        saved: inv.interest - pay.interest, penalty: pay.penalty,
      };
    });
    const cols = [
      ["name", "Loan", (r) => `${U.esc(r.name)}<br><span class="muted">${U.esc(r.type)}</span>`],
      ["balance", "Balance", (r) => U.money(r.balance)],
      ["rate", "Note rate", (r) => U.pct(r.rate)],
      ["apr", "APR", (r) => (r.apr === null ? "—" : U.pct(r.apr))],
      ["atr", "Est. after-tax rate", (r) => `${U.pct(r.atr)}<br><span class="status ${r.status}">${statusLabel(r.status)}</span>`],
      ["term", "Remaining term", (r) => `${Math.floor(r.term / 12)} yr ${r.term % 12} mo`],
      ["payoffInvest", "Paid off (Invest)", (r) => payoffText(r.payoffInvest)],
      ["payoffPay", "Paid off (Pay Off)", (r) => payoffText(r.payoffPay)],
      ["saved", "Interest saved by Pay Off", (r) => U.money(r.saved)],
      ["penalty", "Prepayment penalty", (r) => U.money(r.penalty)],
    ];
    if (tableSort.key) {
      const key = tableSort.key;
      const v = (r) => (r[key] === null ? Infinity : r[key]);
      rows.sort((x, y) => (typeof x[key] === "string" ? x[key].localeCompare(y[key]) : v(x) - v(y)) * tableSort.dir);
    }
    const t = document.getElementById("loanTable");
    t.innerHTML =
      `<thead><tr>${cols.map(([k, label]) => `<th data-key="${k}" class="${tableSort.key === k ? (tableSort.dir > 0 ? "asc" : "desc") : ""}">${label}</th>`).join("")}</tr></thead>` +
      `<tbody>${rows.map((r) => `<tr>${cols.map(([, , f]) => `<td>${f(r)}</td>`).join("")}</tr>`).join("")}</tbody>`;
    t.querySelectorAll("th").forEach((th) =>
      th.addEventListener("click", () => {
        const key = th.dataset.key;
        tableSort = { key, dir: tableSort.key === key ? -tableSort.dir : 1 };
        renderLoanTable(inp, res);
      })
    );
  }

  const payoffText = (m) =>
    m === null ? `after ${S.START_YEAR + state.horizon - 1}` : m === 0 ? "now" : U.monthLabel(m - 1, S.START_YEAR);

  // ---------- Touch: tap a chart to see its details ----------

  function tapPoint(el, ev) {
    const fl = el._fullLayout;
    if (!fl) return null;
    const size = fl._size, rect = el.getBoundingClientRect();
    const px = ev.clientX - rect.left - size.l, py = ev.clientY - rect.top - size.t;
    if (px < 0 || py < 0 || px > size.w || py > size.h) return null;
    return { x: fl.xaxis.p2d(px), y: fl.yaxis.p2d(py) };
  }

  function showCard(html) {
    const card = document.getElementById("tapcard");
    if (!html) { card.hidden = true; return; }
    card.querySelector(".body").innerHTML = html;
    card.hidden = false;
  }

  function wireTaps() {
    const yearIdx = (x) => Math.max(0, Math.min(state.horizon, Math.round(x)));
    document.getElementById("chartA").addEventListener("click", (ev) => {
      const p = tapPoint(ev.currentTarget, ev);
      if (!p || !last) return showCard(null);
      const t = yearIdx(p.x);
      showCard(`<b>Year ${t}${t ? ` (end of ${S.START_YEAR + t - 1})` : " (now)"}</b><br>` +
        C.snapDetail(last.res.payoff.snaps[t], "payoff", state.view) + "<br>" +
        C.snapDetail(last.res.invest.snaps[t], "invest", state.view));
    });
    document.getElementById("chartE").addEventListener("click", (ev) => {
      const p = tapPoint(ev.currentTarget, ev);
      if (!p || !last || !last.mc) return showCard(null);
      const t = yearIdx(p.x), d = last.mc.diff[t];
      showCard(`<b>Year ${t}: Invest − Pay Off</b><br>95th ${U.kSigned(d[4])}<br>75th ${U.kSigned(d[3])}<br><b>Median ${U.kSigned(d[2])}</b><br>25th ${U.kSigned(d[1])}<br>5th ${U.kSigned(d[0])}`);
    });
    document.getElementById("chartB").addEventListener("click", (ev) => {
      const p = tapPoint(ev.currentTarget, ev);
      if (!p || !last || !last.heat) return showCard(null);
      const h = last.heat;
      const near = (arr, v) => arr.reduce((b, x, i) => (Math.abs(x * 100 - v) < Math.abs(arr[b] * 100 - v) ? i : b), 0);
      const i = near(h.rates, p.x), j = near(h.returns, p.y);
      showCard(`<b>${U.esc(h.loanName)} at ${U.pct(h.rates[i])}, return ${U.pct(h.returns[j])}</b><br>Invest − Pay Off: <b>${U.kSigned(h.z[j][i])}</b>`);
    });
    document.getElementById("tapcard-close").addEventListener("click", () => showCard(null));
  }

  // ---------- Wiring ----------

  function init() {
    buildGeneral();
    buildLoans();
    document.getElementById("view").addEventListener("change", (e) => { state.view = e.target.value; scheduleRender(); });
    document.getElementById("addLoan").addEventListener("click", () => {
      if (state.loans.length >= MAX_LOANS) return;
      state.loans.push(newLoan("personal", `Loan ${state.loans.length + 1}`));
      openPanels[state.loans.length - 1] = true;
      buildLoans();
      onChange();
    });
    document.getElementById("reset").addEventListener("click", () => {
      state = defaultState();
      tableSort = { key: null, dir: -1 };
      openPanels.length = 0;
      document.getElementById("view").value = "after";
      buildLoans();
      onChange();
    });
    if (narrow()) document.querySelectorAll("#cashPanel, #strategyPanel").forEach((d) => (d.open = false));
    let lastW = window.innerWidth;
    window.addEventListener("resize", () => {
      if (window.innerWidth !== lastW) { lastW = window.innerWidth; scheduleRender(); }
    });
    if (TOUCH) wireTaps();
    render();
  }

  init();
})();
