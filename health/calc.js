// Health plan cost model (2026 limits).
// Sources: IRS Rev. Proc. 2025-19 (HSA and HDHP limits), Rev. Proc. 2025-32 (health FSA limit).
(function (root) {
  "use strict";

  const LIMITS_2026 = {
    fsaMax: 3400,
    hsaMax: { self: 4400, family: 8750 },
    hsaCatchUp55: 1000,
    hdhpMinDeductible: { self: 1700, family: 3400 },
  };

  function isHsaPlan(plan, coverage) {
    return plan.deductible >= LIMITS_2026.hdhpMinDeductible[coverage];
  }

  // What the member pays for care (deductible, then coinsurance, up to the out-of-pocket max).
  // coinsurance is a fraction (0.2 = member pays 20%).
  function medicalCost(expense, plan) {
    const raw =
      expense < plan.deductible
        ? expense
        : plan.deductible + (expense - plan.deductible) * plan.coinsurance;
    return Math.min(raw, plan.maxOop);
  }

  // Expense at which medicalCost reaches m, for placing exact kinks on the chart.
  function expenseForMedicalCost(m, plan) {
    if (m <= plan.deductible) return m;
    if (plan.coinsurance <= 0) return Infinity;
    return plan.deductible + (m - plan.deductible) / plan.coinsurance;
  }

  // Own HSA contribution actually allowed, given the employer's contribution.
  function hsaOwnMax(g) {
    return Math.max(0, LIMITS_2026.hsaMax[g.coverage] + LIMITS_2026.hsaCatchUp55 - g.employerHsa);
  }

  // Full cost breakdown of one plan at one level of medical expense.
  // plan = { premium (annual, paid pre-tax), deductible, coinsurance, maxOop }
  // g = { coverage: "self"|"family", taxRate, fsaPct, hsaContribution, employerHsa }
  //     (taxRate and fsaPct are fractions; fsaPct may exceed 1)
  function planCost(expense, plan, g) {
    const hsa = isHsaPlan(plan, g.coverage);
    const medical = medicalCost(expense, plan);
    const premium = hsa ? plan.premium - g.employerHsa : plan.premium;
    const gross = premium + medical;
    let contribution, forfeited;
    if (hsa) {
      // HSA money is kept even if unspent.
      contribution = Math.min(g.hsaContribution, hsaOwnMax(g));
      forfeited = 0;
    } else {
      // FSA elections are capped at the annual limit; unspent money is lost.
      contribution = Math.min(g.fsaPct * medical, LIMITS_2026.fsaMax);
      forfeited = Math.max(0, contribution - medical);
    }
    const taxSavings = g.taxRate * (plan.premium + contribution);
    return {
      hsa, medical, premium, gross, contribution, forfeited, taxSavings,
      net: gross - taxSavings + forfeited,
    };
  }

  // Expense values for the chart: an even grid plus every kink in [0, maxExpense].
  function expenseGrid(plans, g, maxExpense, n = 600) {
    const xs = new Set();
    for (let i = 0; i <= n; i++) xs.add(Math.round((maxExpense * i) / n));
    for (const p of plans) {
      const levels = [p.deductible, p.maxOop];
      if (!isHsaPlan(p, g.coverage) && g.fsaPct > 0) levels.push(LIMITS_2026.fsaMax / g.fsaPct, LIMITS_2026.fsaMax);
      for (const m of levels) {
        const x = expenseForMedicalCost(Math.min(m, p.maxOop), p);
        if (x >= 0 && x <= maxExpense) xs.add(x);
      }
    }
    return [...xs].sort((a, b) => a - b);
  }

  const api = { LIMITS_2026, isHsaPlan, medicalCost, expenseForMedicalCost, hsaOwnMax, planCost, expenseGrid };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HealthCalc = api;
})(this);
