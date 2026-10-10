// Car loan payoff calculator: amortization, extra-payment returns (IRR), and break-even solver.
//
// Rate conventions: the loan APR is a nominal annual rate compounded monthly (APR / 12 per month).
// Returns from extra payments are reported the same way (monthly IRR × 12), and the money market
// yield is treated the same way, so all three rates are comparable.
(function (root) {
  "use strict";

  const EPS = 1e-9;
  const MAX_MONTHS = 1200;

  function amortPayment(balance, apr, n) {
    if (balance <= 0) return 0;
    if (n <= 0) return balance;
    const r = apr / 12;
    return r === 0 ? balance / n : (balance * r) / (1 - Math.pow(1 + r, -n));
  }

  // Month-by-month schedule. lump: extra principal paid today (before the first payment).
  // extra: extra principal paid with every monthly payment. Each row:
  //   { month, begin, interest, scheduled, extra, payment, end }
  // The scheduled payment never exceeds what is owed, so the last payment can be smaller.
  // Returns { error } if the payment does not cover the interest.
  function schedule({ balance, apr, payment, lump = 0, extra = 0 }) {
    const r = apr / 12;
    const rows = [];
    let bal = Math.max(0, balance - Math.max(0, lump));
    let totalInterest = 0, totalPaid = 0;
    for (let m = 1; bal > EPS && m <= MAX_MONTHS; m++) {
      const interest = bal * r;
      if (payment + extra <= interest + EPS) return { error: "The payment does not cover the monthly interest, so the loan never gets paid off." };
      const scheduled = Math.min(Math.max(0, payment - interest), bal);
      const extraPrin = Math.min(Math.max(0, extra), bal - scheduled);
      const pay = interest + scheduled + extraPrin;
      const end = Math.max(0, bal - scheduled - extraPrin);
      rows.push({ month: m, begin: bal, interest, scheduled, extra: extraPrin, payment: pay, end: end < EPS ? 0 : end });
      totalInterest += interest;
      totalPaid += pay;
      bal = end < EPS ? 0 : end;
    }
    if (bal > EPS) return { error: "The loan is not paid off within 100 years at this payment." };
    return {
      rows, months: rows.length, totalInterest, totalPaid: totalPaid + Math.min(lump, balance),
      finalPayment: rows.length ? rows[rows.length - 1].payment : 0,
    };
  }

  // Incremental cash flows of a strategy versus the baseline, from the household's point of view:
  // c[0] = −lump; c[k] = baseline payment in month k − strategy payment in month k.
  // Paying extra makes early flows negative; once the strategy's loan is gone, the baseline
  // payments it no longer has to make are positive flows. This is the money that could otherwise
  // sit in the money market, so its IRR is the return earned by paying extra.
  function incrementalFlows(base, scen, lump) {
    const n = Math.max(base.months, scen.months);
    const c = new Array(n + 1).fill(0);
    c[0] = -Math.min(lump, base.rows.length ? base.rows[0].begin : 0);
    for (let k = 1; k <= n; k++) {
      const b = base.rows[k - 1] ? base.rows[k - 1].payment : 0;
      const s = scen.rows[k - 1] ? scen.rows[k - 1].payment : 0;
      c[k] = b - s;
    }
    return c;
  }

  const npv = (c, i) => c.reduce((s, x, k) => s + x / Math.pow(1 + i, k), 0);

  // Monthly IRR by bisection. Returns null unless the flows have exactly one sign change
  // (negative first, then positive), which guarantees a single IRR, and the root is bracketed.
  function irr(c) {
    const nz = c.filter((x) => Math.abs(x) > 1e-7);
    if (nz.length < 2) return null;
    let changes = 0;
    for (let k = 1; k < nz.length; k++) if (Math.sign(nz[k]) !== Math.sign(nz[k - 1])) changes++;
    if (changes !== 1 || nz[0] > 0) return null;
    let lo = -0.99, hi = 1; // monthly rates
    let flo = npv(c, lo), fhi = npv(c, hi);
    if (!(flo > 0 && fhi < 0)) return null;
    for (let it = 0; it < 200 && hi - lo > 1e-13; it++) {
      const mid = (lo + hi) / 2;
      const f = npv(c, mid);
      if (f > 0) { lo = mid; flo = f; } else { hi = mid; fhi = f; }
    }
    return (lo + hi) / 2;
  }

  // Loan inputs: { balance, apr, months, payment (0 = calculated) }.
  function basePayment(p) {
    return p.payment > 0 ? p.payment : amortPayment(p.balance, p.apr, p.months);
  }

  // Largest extra amount that still makes sense: the whole balance (lump), or enough to pay the
  // loan off with the next payment (monthly).
  function maxAmount(p, mode) {
    if (mode === "lump") return p.balance;
    return Math.max(0, p.balance * (1 + p.apr / 12) - basePayment(p));
  }

  // Everything about one strategy: schedules, savings, and the annualized IRR of paying extra.
  function analyze(p, mode, amount) {
    const payment = basePayment(p);
    const base = schedule({ balance: p.balance, apr: p.apr, payment });
    if (base.error) return { error: base.error };
    amount = Math.max(0, Math.min(amount, maxAmount(p, mode)));
    const scen = schedule({
      balance: p.balance, apr: p.apr, payment,
      lump: mode === "lump" ? amount : 0, extra: mode === "monthly" ? amount : 0,
    });
    if (scen.error) return { error: scen.error };
    const flows = incrementalFlows(base, scen, mode === "lump" ? amount : 0);
    const m = amount > 0 ? irr(flows) : null;
    return {
      payment, base, scen, amount, flows,
      interestSaved: base.totalInterest - scen.totalInterest,
      monthsSaved: base.months - scen.months,
      irrAnnual: m === null ? null : m * 12,
    };
  }

  // Future value, at the loan's original payoff, of the extra-payment strategy compared with
  // keeping the money in the money market: incremental flows compounded at the after-tax yield.
  function advantageAtBaseEnd(a, mmAfter) {
    const i = mmAfter / 12, n = a.base.months;
    return a.flows.reduce((s, x, k) => s + x * Math.pow(1 + i, n - k), 0);
  }

  // Generic break-even search: the amount in (0, hi] where returnAt(amount) equals target.
  // Scans for a sign change of returnAt − target, then bisects. Reports when the return does not
  // depend on the amount (no unique answer), or when no crossing exists in the range.
  function solveBreakEven(returnAt, target, hi, steps = 60) {
    if (!(hi > 0)) return { status: "none", reason: "range" };
    const xs = [], fs = [];
    for (let k = 1; k <= steps; k++) {
      const x = (hi * k) / steps, r = returnAt(x);
      if (r === null || !isFinite(r)) continue;
      xs.push(x);
      fs.push(r - target);
    }
    if (fs.length < 2) return { status: "none", reason: "undefined" };
    const min = Math.min(...fs), max = Math.max(...fs);
    if (max - min < 1e-7) {
      return Math.abs(fs[0]) < 1e-5
        ? { status: "every", rate: fs[0] + target }
        : { status: "flat", rate: fs[0] + target };
    }
    for (let k = 1; k < fs.length; k++) {
      if (Math.sign(fs[k]) !== Math.sign(fs[k - 1]) || fs[k] === 0) {
        let lo = xs[k - 1], hiX = xs[k], flo = fs[k - 1];
        for (let it = 0; it < 100 && hiX - lo > 0.005; it++) {
          const mid = (lo + hiX) / 2, f = returnAt(mid) - target;
          if (Math.sign(f) === Math.sign(flo)) { lo = mid; flo = f; } else hiX = mid;
        }
        return { status: "found", amount: (lo + hiX) / 2 };
      }
    }
    return { status: "none", reason: "no-crossing" };
  }

  function breakEven(p, mode, mmAfter) {
    return solveBreakEven((x) => analyze(p, mode, x).irrAnnual, mmAfter, maxAmount(p, mode));
  }

  const afterTaxYield = (y, t) => y * (1 - t);
  // Before-tax yield needed to match the loan APR after tax; null when the tax rate is 100%+.
  const requiredPreTax = (apr, t) => (t < 1 ? apr / (1 - t) : null);

  root.CarCalc = {
    amortPayment, schedule, incrementalFlows, npv, irr, basePayment, maxAmount, analyze,
    advantageAtBaseEnd, solveBreakEven, breakEven, afterTaxYield, requiredPreTax,
  };
})(this);
