// 2026 U.S. federal tax engine (simplified).
// Sources: IRS Rev. Proc. 2025-32 (brackets, standard deduction), IRS 2026 retirement-plan
// and HSA limit announcements, SSA 2026 COLA fact sheet (Social Security wage base).
(function (root) {
  "use strict";

  const TAX_2026 = {
    // [upper bound of bracket, rate]
    brackets: {
      single: [
        [12400, 0.10],
        [50400, 0.12],
        [105700, 0.22],
        [201775, 0.24],
        [256225, 0.32],
        [640600, 0.35],
        [Infinity, 0.37],
      ],
      mfj: [
        [24800, 0.10],
        [100800, 0.12],
        [211400, 0.22],
        [403550, 0.24],
        [512450, 0.32],
        [768700, 0.35],
        [Infinity, 0.37],
      ],
    },
    standardDeduction: { single: 16100, mfj: 32200 },
    ssRate: 0.062,
    ssWageBase: 184500,
    medicareRate: 0.0145,
    addlMedicareRate: 0.009,
    addlMedicareThreshold: { single: 200000, mfj: 250000 }, // not inflation-indexed
    niitRate: 0.038,
    niitThreshold: { single: 200000, mfj: 250000 }, // not inflation-indexed
    limits: {
      k401: 24500,
      k401CatchUp50: 8000,
      k401CatchUp60to63: 11250,
      hsaSelf: 4400,
      hsaFamily: 8750,
      hsaCatchUp55: 1000,
    },
  };

  function bracketTax(taxable, brackets) {
    let tax = 0;
    let lower = 0;
    for (const [upper, rate] of brackets) {
      if (taxable <= lower) break;
      tax += (Math.min(taxable, upper) - lower) * rate;
      lower = upper;
    }
    return tax;
  }

  // Split one person's gross income into its parts.
  // p = { income, k401, hsa, pctCapGain, pctDividend, pctInterest } (percentages 0-100)
  function personParts(p) {
    const invPct = (p.pctCapGain + p.pctDividend + p.pctInterest) / 100;
    const investment = p.income * invPct;
    const wages = p.income - investment;
    // Contributions come out of payroll, so they can't exceed wages.
    const k401 = Math.min(p.k401, wages);
    const hsa = Math.min(p.hsa, wages - k401);
    // 401(k) deferrals are still subject to FICA; payroll (cafeteria-plan) HSA contributions are not.
    const ficaWages = wages - hsa;
    const agi = wages - k401 - hsa + investment;
    return { income: p.income, wages, investment, k401, hsa, ficaWages, agi };
  }

  // Social Security and base Medicare do not depend on filing status.
  function basePayroll(parts) {
    return (
      TAX_2026.ssRate * Math.min(parts.ficaWages, TAX_2026.ssWageBase) +
      TAX_2026.medicareRate * parts.ficaWages
    );
  }

  function sumTax(t) {
    t.total = t.incomeTax + t.payroll + t.addlMedicare + t.niit;
    return t;
  }

  function singleTax(parts) {
    const taxable = Math.max(0, parts.agi - TAX_2026.standardDeduction.single);
    return sumTax({
      taxable,
      incomeTax: bracketTax(taxable, TAX_2026.brackets.single),
      payroll: basePayroll(parts),
      addlMedicare:
        TAX_2026.addlMedicareRate *
        Math.max(0, parts.ficaWages - TAX_2026.addlMedicareThreshold.single),
      niit:
        TAX_2026.niitRate *
        Math.min(parts.investment, Math.max(0, parts.agi - TAX_2026.niitThreshold.single)),
    });
  }

  function marriedTax(a, b) {
    const agi = a.agi + b.agi;
    const taxable = Math.max(0, agi - TAX_2026.standardDeduction.mfj);
    return sumTax({
      taxable,
      incomeTax: bracketTax(taxable, TAX_2026.brackets.mfj),
      payroll: basePayroll(a) + basePayroll(b),
      addlMedicare:
        TAX_2026.addlMedicareRate *
        Math.max(0, a.ficaWages + b.ficaWages - TAX_2026.addlMedicareThreshold.mfj),
      niit:
        TAX_2026.niitRate *
        Math.min(a.investment + b.investment, Math.max(0, agi - TAX_2026.niitThreshold.mfj)),
    });
  }

  // diff > 0: marriage bonus (filing jointly saves money). diff < 0: marriage penalty.
  function compare(pa, pb) {
    const a = personParts(pa);
    const b = personParts(pb);
    const sa = singleTax(a);
    const sb = singleTax(b);
    const m = marriedTax(a, b);
    const singleTotal = sa.total + sb.total;
    const diff = singleTotal - m.total;
    return {
      a, b, sa, sb, m,
      singleTotal,
      diff,
      pct: singleTotal > 0 ? (diff / singleTotal) * 100 : 0,
    };
  }

  const api = { TAX_2026, bracketTax, personParts, singleTax, marriedTax, compare };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TaxCalc = api;
})(this);
