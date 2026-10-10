// Strategy simulation and net worth.
//
// Cash-flow rule shared by both strategies: every month the household has the same budget, equal
// to the scheduled loan payments and mortgage insurance with no prepayment (kept in the budget
// after they end), plus any extra monthly savings. Each strategy pays what its loans require; the
// rest goes to the brokerage
// account (or, with the snowball rule, freed-up payments go to the next loan first). Each year's
// tax change versus a baseline with none of the modeled items is settled from the account.
//
// With that rule, for each strategy:
//   net worth = starting cash + total budget - starting loan balances - interest - mortgage
//               insurance - penalties + investment return - fees - investment income tax
//               + deduction tax savings - liquidation tax (+ property, the same in both)
// so the difference between strategies splits exactly into those parts (see attribution()).
(function (root) {
  "use strict";
  const NS = (root.LoanSim = root.LoanSim || {});
  const START_YEAR = 2026;

  function prepareLoans(inp, opts) {
    return inp.loans.map((l, k) => {
      const loan = { ...l, tax: { ...(l.tax || {}) } };
      if (opts.loanRate && opts.loanRate.k === k) {
        loan.rate = opts.loanRate.rate;
        loan.paymentOverride = 0; // payment follows the rate on the heatmap
      }
      return loan;
    });
  }

  // Monthly budget from the no-prepayment schedule. Once a loan's payment or mortgage insurance
  // ends on that schedule, the same amount stays in the budget, so payments released by a natural
  // payoff are reinvested (or snowballed) just like those released by prepaying.
  function baselineSchedule(loans, n) {
    const states = loans.map(NS.initLoan);
    const budget = new Float64Array(n);
    const lastPayment = loans.map(() => 0);
    const pmiCommit = loans.map((l, k) => (states[k].pmiActive ? l.pmi : 0));
    const yr1 = loans.map(() => ({ interest: 0, balSum: 0, pmi: 0 }));
    for (let m = 0; m < n; m++) {
      loans.forEach((loan, k) => {
        const active = states[k].bal > 0;
        const r = NS.stepLoan(loan, states[k], m);
        if (active) lastPayment[k] = Math.max(r.payment, states[k].payment);
        budget[m] += (active ? r.payment : lastPayment[k]) + pmiCommit[k];
        if (m < 12) {
          yr1[k].interest += r.interest;
          yr1[k].balSum += r.startBal;
          yr1[k].pmi += r.pmi;
        }
      });
    }
    return { budget, yr1, payoffMonth: states.map((s) => s.payoffMonth) };
  }

  const toPerLoan = (acc) => acc.map((p) => ({ interest: p.interest, avgBalance: p.balSum / 12, pmi: p.pmi }));

  // Estimated after-tax rate of each loan in year 1 without prepayment: the actual tax change
  // from removing that loan's interest, not interest × marginal rate.
  function afterTaxRates(loans, profile, yr1) {
    const per = toPerLoan(yr1);
    const withAll = NS.federalTax(profile, NS.loanItems(loans, per), START_YEAR).total;
    return loans.map((loan, k) => {
      const interest = per[k].interest;
      if (interest <= 0) return { rate: loan.rate, benefit: 0, interest: 0 };
      const without = per.map((p, j) => (j === k ? { ...p, interest: 0 } : p));
      const benefit = NS.federalTax(profile, NS.loanItems(loans, without), START_YEAR).total - withAll;
      return { rate: loan.rate * (1 - benefit / interest), benefit, interest };
    });
  }

  function payoffOrder(inp, loans, atr) {
    const idx = loans.map((_, k) => k);
    if (inp.allocation === "aftertax") return idx.sort((a, b) => atr[b].rate - atr[a].rate);
    if (inp.allocation === "manual") return idx;
    return idx.sort((a, b) => loans[b].rate - loans[a].rate);
  }

  function propertyValue(loans, years) {
    return loans.reduce((s, l) => s + (l.assetValue || 0) * Math.pow(1 + (l.assetGrowth || 0), years), 0);
  }

  // Run one strategy ("payoff" or "invest").
  function runStrategy(kind, inp, loans, ctx) {
    const { profile } = inp;
    const n = ctx.n;
    const rates = NS.monthlyRates(inp.inv);
    const S = loans.map(NS.initLoan);
    const acct = NS.newAccount();
    const L = { interest: 0, pmi: 0, penalty: 0, dedBenefit: 0, invTax: 0, budget: inp.cash };
    const perLoan = loans.map(() => ({ interest: 0, penalty: 0, prepaid: 0 }));
    let yr = loans.map(() => ({ interest: 0, balSum: 0, pmi: 0 }));

    let cash = inp.cash;
    if (kind === "payoff") {
      for (const k of ctx.order) {
        const want = inp.allocation === "manual" ? Math.min(loans[k].manualAmount || 0, cash) : cash;
        const r = NS.prepay(loans[k], S[k], want, 0, inp.recast);
        cash -= r.principal + r.penalty;
        L.penalty += r.penalty;
        perLoan[k].penalty += r.penalty;
        perLoan[k].prepaid += r.principal;
      }
    }
    acct.value = cash;
    acct.basis = cash;

    const snaps = [];
    const snapshot = (t, liqTax, taxTotal) => {
      const loanBals = S.map((s) => s.bal);
      const loanBal = loanBals.reduce((a, b) => a + b, 0);
      const property = propertyValue(loans, t);
      const nwPre = acct.value + property - loanBal;
      snaps.push({
        t, year: START_YEAR + t, invValue: acct.value, basis: acct.basis, loanBals, loanBal, property,
        liqTax, nwPre, nwAfter: nwPre - liqTax, taxTotal,
        cumInterest: L.interest, cumPmi: L.pmi, cumPenalty: L.penalty, cumDedBenefit: L.dedBenefit,
        cumInvTax: L.invTax, grossReturn: acct.grossReturn, fees: acct.fees, budget: L.budget,
      });
    };
    snapshot(0, 0, 0);

    for (let m = 0; m < n; m++) {
      const year = START_YEAR + Math.floor(m / 12);
      const budget = ctx.base.budget[m] + inp.extraMonthly;
      L.budget += budget;
      let paid = 0;
      loans.forEach((loan, k) => {
        const r = NS.stepLoan(loan, S[k], m);
        paid += r.payment + r.pmi;
        yr[k].interest += r.interest;
        yr[k].balSum += r.startBal;
        yr[k].pmi += r.pmi;
        L.interest += r.interest;
        L.pmi += r.pmi;
        perLoan[k].interest += r.interest;
      });
      // Payments no longer needed this month (from paid-off or prepaid loans).
      let freed = Math.max(0, budget - inp.extraMonthly - paid);
      if (inp.freed === "snowball") {
        for (const k of ctx.order) {
          if (freed <= 0) break;
          const r = NS.prepay(loans[k], S[k], Math.min(freed, NS.payoffCost(loans[k], S[k])), m + 1, inp.recast);
          freed -= r.principal + r.penalty;
          L.penalty += r.penalty;
          perLoan[k].penalty += r.penalty;
          perLoan[k].prepaid += r.principal;
        }
      }
      NS.stepAccount(acct, rates, freed + inp.extraMonthly, ctx.priceReturns ? ctx.priceReturns[m] : undefined);

      if (m % 12 === 11) {
        const items = NS.loanItems(loans, toPerLoan(yr));
        const inv = { ordInv: acct.yrOrd, qualDiv: acct.yrQual };
        const all = NS.addItems(items, inv);
        const base = ctx.baseTax(year);
        const dedOnly = NS.federalTax(profile, items, year).total;
        const withInv = NS.federalTax(profile, all, year).total;
        L.dedBenefit += base - dedOnly;
        L.invTax += withInv - dedOnly;
        // Settle the year's tax change from the account (savings are invested).
        const due = withInv - base;
        acct.value -= due;
        acct.basis = Math.max(0, acct.basis - due);
        acct.yrOrd = acct.yrQual = 0;
        yr = loans.map(() => ({ interest: 0, balSum: 0, pmi: 0 }));
        // Tax if everything were sold at year end, on top of this year's income.
        const gain = NS.unrealizedGain(acct);
        const liq = gain > 0 ? NS.federalTax(profile, { ...all, ltcg: gain }, year).total - withInv : 0;
        snapshot((m + 1) / 12, liq, withInv - base);
      }
    }
    return {
      snaps, ledger: L,
      perLoan: perLoan.map((p, k) => ({ ...p, payoffMonth: S[k].payoffMonth, endBalance: S[k].bal })),
    };
  }

  // opts: { priceReturns (per month), loanRate: { k, rate }, totalReturn, order (payoff order) }
  function simulate(inp, opts = {}) {
    const loans = prepareLoans(inp, opts);
    const run = opts.totalReturn === undefined ? inp : { ...inp, inv: { ...inp.inv, totalReturn: opts.totalReturn } };
    const n = Math.round(inp.horizonYears * 12);
    const base = baselineSchedule(loans, n);
    const atr = afterTaxRates(loans, inp.profile, base.yr1);
    const taxCache = {};
    const ctx = {
      n, base, order: opts.order || payoffOrder(inp, loans, atr), priceReturns: opts.priceReturns,
      baseTax: (y) => (taxCache[y] ??= NS.federalTax(inp.profile, NS.emptyItems(), y).total),
    };
    return {
      loans, base, afterTax: atr, order: ctx.order,
      payoff: runStrategy("payoff", run, loans, ctx),
      invest: runStrategy("invest", run, loans, ctx),
    };
  }

  // Parts of (Invest − Pay Off) after-tax net worth at the horizon. They add up exactly.
  // The two tax parts are assigned in order (deductions first, then investment income), so their
  // split depends on that order; their sum does not.
  function attribution(res) {
    const a = res.payoff.snaps.at(-1), b = res.invest.snaps.at(-1);
    const parts = [
      { key: "return", label: "Investment gains and income", value: b.grossReturn - a.grossReturn },
      { key: "fees", label: "Investment fees", value: -(b.fees - a.fees) },
      { key: "interest", label: "Loan interest saved by paying off", value: -(b.cumInterest - a.cumInterest) },
      { key: "pmi", label: "Mortgage insurance saved by paying off", value: -(b.cumPmi - a.cumPmi) },
      { key: "penalty", label: "Prepayment penalties avoided", value: a.cumPenalty - b.cumPenalty },
      { key: "deduction", label: "Interest-deduction tax savings", value: b.cumDedBenefit - a.cumDedBenefit },
      { key: "invTax", label: "Tax on investment income", value: -(b.cumInvTax - a.cumInvTax) },
      { key: "liqTax", label: "Capital gains tax on selling", value: -(b.liqTax - a.liqTax) },
    ];
    return { parts, total: b.nwAfter - a.nwAfter };
  }

  // Invest − Pay Off at the horizon over a grid of one loan's rate and the total return. The payoff
  // order stays as at the current inputs, so cells differ only in rate and return, not in which
  // loan receives the cash.
  function heatmap(inp, k, rates, returns, field = "nwAfter") {
    const order = simulate(inp).order;
    return returns.map((ret) =>
      rates.map((rate) => {
        const r = simulate(inp, { loanRate: { k, rate }, totalReturn: ret, order });
        return r.invest.snaps.at(-1)[field] - r.payoff.snaps.at(-1)[field];
      })
    );
  }

  // Seeded PRNG so the risk chart is stable between renders.
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Monte Carlo: lognormal monthly price returns with the chosen volatility, mean matching the
  // expected price growth. Both strategies see the same path in each run.
  function monteCarlo(inp, paths = 500, seed = 12345) {
    const rand = mulberry32(seed);
    const gauss = () => {
      let u = 0;
      while (u === 0) u = rand();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
    };
    const n = Math.round(inp.horizonYears * 12);
    const g = inp.inv.totalReturn - inp.inv.dividendYield - inp.inv.interestYield;
    const sm = inp.inv.volatility / Math.sqrt(12);
    const mu = Math.log(1 + g) / 12 - (sm * sm) / 2;
    const years = Math.round(inp.horizonYears);
    const diff = Array.from({ length: years + 1 }, () => []);
    const nwA = [], nwB = [];
    for (let p = 0; p < paths; p++) {
      const pr = new Float64Array(n);
      for (let m = 0; m < n; m++) pr[m] = Math.exp(mu + sm * gauss()) - 1;
      const r = simulate(inp, { priceReturns: pr });
      for (let t = 0; t <= years; t++) diff[t].push(r.invest.snaps[t].nwAfter - r.payoff.snaps[t].nwAfter);
      nwA.push(r.payoff.snaps.at(-1).nwAfter);
      nwB.push(r.invest.snaps.at(-1).nwAfter);
    }
    const q = (arr, p) => {
      const s = [...arr].sort((x, y) => x - y);
      const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
      return s[lo] + (s[hi] - s[lo]) * (i - lo);
    };
    const P = [0.05, 0.25, 0.5, 0.75, 0.95];
    return {
      percentiles: P,
      diff: diff.map((d) => P.map((p) => q(d, p))),
      payoff: P.map((p) => q(nwA, p)),
      invest: P.map((p) => q(nwB, p)),
      probInvestAhead: diff[years].filter((d) => d > 0).length / paths,
      paths,
    };
  }

  Object.assign(NS, { START_YEAR, simulate, attribution, heatmap, monteCarlo, baselineSchedule });
})(this);
