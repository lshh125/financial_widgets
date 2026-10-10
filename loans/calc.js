// Car loan prepayment vs. money market: calculation engine (2026 U.S. federal tax).
// Sources: IRS Rev. Proc. 2025-32 (brackets, standard deduction, via ../marriage/tax.js);
// IRC 1411 (NIIT); OBBBA sec. 70203 and T.D. 10054 (car loan interest deduction, 2025-2028).
(function (root) {
  "use strict";
  const { TAX_2026 } = root.TaxCalc;

  const CAR = { max: 10000, phaseStart: { single: 100000, mfj: 200000 }, lastYear: 2028 };

  // Ordinary bracket on the next dollar of income (standard deduction assumed).
  function bracketRate(magi, status) {
    const taxable = magi - TAX_2026.standardDeduction[status];
    if (taxable < 0) return 0;
    return TAX_2026.brackets[status].find(([upper]) => taxable < upper)[1];
  }

  // Tax rates on the next dollar of income.
  // ord: federal income tax bracket; niit: 3.8% if MAGI is over the threshold.
  function taxRates(status, magi) {
    const ord = bracketRate(magi, status);
    const niit = magi > TAX_2026.niitThreshold[status] ? TAX_2026.niitRate : 0;
    return { ord, niit, mm: ord + niit };
  }

  // The car loan deduction shrinks by $200 per $1,000 (or part) of MAGI over the threshold.
  function carPhaseReduction(status, magi) {
    return 200 * Math.ceil(Math.max(0, magi - CAR.phaseStart[status]) / 1000);
  }

  function amortPayment(balance, rate, n) {
    if (balance <= 0) return 0;
    const r = rate / 12;
    return r === 0 ? balance / n : (balance * r) / (1 - Math.pow(1 + r, -n));
  }

  // p = { balance, apr, months, mmRate, status, magi, carDeduction, startYear, startMonth (0-11) }
  // prepay: extra principal paid now, taken out of the money market.
  // monthlyExtra: extra principal paid every month on top of the scheduled payment.
  //
  // Both strategies spend the same each month: the scheduled payment plus the monthly extra. The
  // Pay strategy puts the extra toward the loan; the Keep strategy puts it in the money market.
  // Once a loan is gone, whatever it no longer needs goes into the money market. Money market
  // interest is taxed as it is earned (ordinary income + NIIT). The car loan deduction, if it
  // applies, is credited at each year end through 2028. The comparison runs to the loan's
  // original end date, when both strategies have no loan left, so the difference is all in the
  // money market balance.
  function simulate(p, prepay, monthlyExtra = 0) {
    const t = taxRates(p.status, p.magi);
    const mmAfter = (p.mmRate * (1 - t.mm)) / 12;
    const mmGross = p.mmRate / 12;
    const r = p.apr / 12;
    const payment = amortPayment(p.balance, p.apr, p.months);
    const reduction = carPhaseReduction(p.status, p.magi);
    prepay = Math.max(0, Math.min(prepay, p.balance));
    monthlyExtra = Math.max(0, monthlyExtra);
    const budget = payment + monthlyExtra;

    const mk = (bal, mm) => ({ bal, mm, interest: 0, earned: 0, deduction: 0, yrInterest: 0, payoff: bal > 0 ? null : 0 });
    const pay = mk(p.balance - prepay, 0);
    const keep = mk(p.balance, prepay);
    const gain = [0]; // net worth of Pay minus Keep, by month
    const N = p.months;

    for (let m = 0; m < N; m++) {
      const month = (p.startMonth + m) % 12;
      const year = p.startYear + Math.floor((p.startMonth + m) / 12);
      for (const s of [pay, keep]) {
        // Money market interest on the balance at the start of the month, after tax.
        const earned = s.mm * mmAfter;
        s.mm += earned;
        s.earned += earned;
        // Loan payment; whatever the loan no longer needs goes to the money market.
        if (s.bal > 0) {
          const interest = s.bal * r;
          const target = s === pay ? budget : payment;
          const due = m === N - 1 ? s.bal + interest : Math.min(target, s.bal + interest);
          s.bal -= due - interest;
          if (s.bal < 1e-9) { s.bal = 0; s.payoff = m + 1; }
          s.interest += interest;
          s.yrInterest += interest;
          s.mm += budget - due;
        } else {
          s.mm += budget;
        }
        // Car loan deduction for the year, credited at year end (or at the end of the comparison).
        if (month === 11 || m === N - 1) {
          if (p.carDeduction && year <= CAR.lastYear) {
            const ded = Math.max(0, Math.min(s.yrInterest, CAR.max) - reduction);
            s.mm += t.ord * ded;
            s.deduction += t.ord * ded;
          }
          s.yrInterest = 0;
        }
      }
      // Net worth counts the deduction earned so far this year, so the line has no year-end jumps.
      const deductible = p.carDeduction && year <= CAR.lastYear;
      const pending = (s) => (deductible ? t.ord * Math.max(0, Math.min(s.yrInterest, CAR.max) - reduction) : 0);
      gain.push(pay.mm - pay.bal + pending(pay) - (keep.mm - keep.bal + pending(keep)));
    }

    return {
      rates: t, payment, prepay, gain,
      pay, keep,
      parts: {
        interestSaved: keep.interest - pay.interest,
        mmGivenUp: pay.earned - keep.earned, // usually negative
        deductionGivenUp: pay.deduction - keep.deduction, // negative or zero
      },
      net: gain[N],
      monthsEarlier: N - (pay.payoff ?? N),
      mmGrossRate: mmGross * 12,
    };
  }

  // Year-1 after-tax cost of the car loan: APR reduced by the deduction actually usable in year 1.
  function carAfterTaxRate(p) {
    if (!p.carDeduction || p.startYear > CAR.lastYear) return p.apr;
    const t = taxRates(p.status, p.magi);
    let bal = p.balance, interest = 0;
    const payment = amortPayment(p.balance, p.apr, p.months);
    for (let m = 0; m < Math.min(12, p.months); m++) {
      const i = (bal * p.apr) / 12;
      interest += i;
      bal -= payment - i;
    }
    if (interest <= 0) return p.apr;
    const ded = Math.max(0, Math.min(interest, CAR.max) - carPhaseReduction(p.status, p.magi));
    return p.apr * (1 - (t.ord * ded) / interest);
  }

  root.CarCalc = { CAR, taxRates, carPhaseReduction, amortPayment, simulate, carAfterTaxRate };
})(this);
