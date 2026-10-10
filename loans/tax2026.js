// Tax-rule engine: 2026 U.S. federal law, held fixed for later years except for changes already
// written into law (car loan interest deduction ends after 2028; SALT cap drops to $10,000 in 2030).
// Sources: IRS Rev. Proc. 2025-32 (2026 brackets, standard deduction, capital gains thresholds,
// student loan phaseout); IRS Pub. 936 (home mortgage interest); OBBBA (P.L. 119-21) secs. 70108
// (mortgage limit, mortgage insurance), 70111 (2/37 itemized limit), 70120 (SALT), 70203 (car loan
// interest; T.D. 10054); IRC 163(d) (investment interest), 221 (student loan interest), 1411 (NIIT).
(function (root) {
  "use strict";
  const NS = (root.LoanSim = root.LoanSim || {});
  const T = root.TaxCalc.TAX_2026; // brackets and standard deduction, shared with the marriage tab

  const LAW = {
    taxYear: 2026,
    ltcg: { single: [49450, 545500], mfj: [98900, 613700] }, // top of the 0% and 15% ranges
    niit: { rate: 0.038, single: 200000, mfj: 250000 },
    mortgageLimit: 750000,
    grandfatheredLimit: 1000000,
    grandfatherBefore: "2017-12-16", // acquisition debt incurred before this date keeps the $1M limit
    pmiPhaseStart: 100000, // 10% less per $1,000 (or part) of AGI above this; not indexed
    studentMax: 2500,
    studentPhase: { single: [85000, 100000], mfj: [175000, 205000] },
    autoMax: 10000,
    autoPhaseStart: { single: 100000, mfj: 200000 }, // $200 less per $1,000 (or part) above this
    autoYears: [2025, 2028],
    autoOriginFrom: "2025-01",
    itemizedLimitRate: 2 / 37,
  };

  // SALT cap: $40,400 in 2026 (+1% a year through 2029), cut by 30% of MAGI above the threshold
  // but not below $10,000; $10,000 with no phase-down from 2030.
  function saltCap(year, magi) {
    if (year >= 2030) return 10000;
    const k = Math.max(0, year - 2026);
    const cap = 40400 * Math.pow(1.01, k);
    const threshold = 505000 * Math.pow(1.01, k);
    return Math.max(10000, cap - 0.3 * Math.max(0, magi - threshold));
  }

  // Loan types. status: "verified" = modeled from the 2026 rules above; "simplified" = verified
  // rule with parts left out; "assumption" = the user's own treatment, not a legal conclusion.
  const LOAN_TYPES = {
    primary: { label: "Primary residence mortgage", status: "verified", mortgage: true },
    second: { label: "Second-home mortgage", status: "verified", mortgage: true },
    rental: { label: "Rental-property mortgage", status: "simplified", mortgage: true },
    heloc: { label: "Home equity loan / HELOC", status: "verified", mortgage: true },
    auto: { label: "Auto loan", status: "verified" },
    personal: { label: "Personal loan", status: "verified" },
    student: { label: "Student loan", status: "verified" },
    business: { label: "Business loan", status: "assumption" },
    custom: { label: "Other / custom loan", status: "assumption" },
  };

  // How a loan's interest is treated. Returns { cat, share, text }.
  // cat: qri | qriGrandfathered | rental | business | student | auto | investment |
  //      customItemized | customAbove | none
  function classify(loan) {
    const tx = loan.tax || {};
    const orig = loan.origination || "2026-01";
    const grandfathered = orig < LAW.grandfatherBefore.slice(0, 7);
    switch (loan.type) {
      case "primary":
      case "second":
        return {
          cat: grandfathered ? "qriGrandfathered" : "qri", share: 1,
          text: `Itemized deduction for home acquisition debt, limited to ${grandfathered ? "$1,000,000 (taken out before Dec 16, 2017)" : "$750,000"} across all such loans. Mortgage insurance is deductible too, phasing out above $100k AGI.`,
        };
      case "heloc":
        return tx.helocUse === "improve"
          ? { cat: grandfathered ? "qriGrandfathered" : "qri", share: 1,
              text: "Used to buy, build, or substantially improve the home securing it: treated as acquisition debt (itemized, within the $750,000 limit)." }
          : { cat: "none", share: 0, text: "Not used to buy, build, or improve the home securing it: interest is not deductible." };
      case "rental":
        return tx.rentalUsable
          ? { cat: "rental", share: 1, text: "Simplified: interest fully offsets rental income (Schedule E). Passive-loss limits and depreciation are not modeled." }
          : { cat: "none", share: 0, text: "Simplified: rental losses are suspended under passive-loss rules, so no current tax benefit is counted." };
      case "auto": {
        const ok = tx.newVehicle && tx.usAssembly && tx.personalUse && loan.secured && orig >= LAW.autoOriginFrom;
        return ok
          ? { cat: "auto", share: 1, text: "Qualified passenger vehicle loan interest: up to $10,000 a year, itemizing or not, 2025–2028 only. Phases out above $100k / $200k MAGI." }
          : { cat: "none", share: 0, text: "Not deductible. The 2025–2028 deduction needs a new, U.S.-assembled, personal-use vehicle, a loan taken out after 2024, and a lien on the vehicle." };
      }
      case "personal":
        return tx.personalUse === "investment"
          ? { cat: "investment", share: 1, text: "Investment interest: itemized, limited to net investment income (interest and non-qualified dividends here). Carryforward is not modeled." }
          : { cat: "none", share: 0, text: "Personal use: interest is not deductible." };
      case "student":
        return { cat: "student", share: 1, text: "Up to $2,500 a year, itemizing or not. Phases out at $85k–$100k (single) / $175k–$205k (MFJ) MAGI. Income-driven repayment and forgiveness are not modeled." };
      case "business": {
        const pct = Math.max(0, Math.min(100, tx.businessPct ?? 100));
        return { cat: "business", share: pct / 100, text: `Your assumption: ${pct}% of interest reduces ordinary income. The §163(j) limit, self-employment tax, and entity rules are not modeled.` };
      }
      case "custom":
      default: {
        const t = tx.customTreatment || "none";
        if (t === "itemized") return { cat: "customItemized", share: 1, text: "Your assumption: interest is an itemized deduction." };
        if (t === "above") return { cat: "customAbove", share: 1, text: "Your assumption: interest is deductible whether or not you itemize." };
        return { cat: "none", share: 0, text: "Your assumption: interest is not deductible." };
      }
    }
  }

  // Turn one year of per-loan amounts into tax items.
  // perLoan[k] = { interest, avgBalance, pmi } for the year.
  function loanItems(loans, perLoan) {
    const it = emptyItems();
    let gBal = 0, gInt = 0, oBal = 0, oInt = 0;
    loans.forEach((loan, k) => {
      const a = perLoan[k];
      if (!a) return;
      const c = classify(loan);
      const x = a.interest * c.share;
      switch (c.cat) {
        case "qriGrandfathered": gBal += a.avgBalance; gInt += x; it.pmi += a.pmi; break;
        case "qri": oBal += a.avgBalance; oInt += x; it.pmi += a.pmi; break;
        case "rental": case "business": case "customAbove": it.aboveLine += x; break;
        case "student": it.studentInterest += x; break;
        case "auto": it.autoInterest += x; break;
        case "investment": it.invInterest += x; break;
        case "customItemized": it.customItemized += x; break;
      }
    });
    // Pub. 936: grandfathered debt up to $1M; it also uses up the $750k limit for newer debt.
    const gOk = Math.min(gBal, LAW.grandfatheredLimit);
    const oOk = Math.min(oBal, Math.max(0, LAW.mortgageLimit - gBal));
    it.qriInterest = (gBal > 0 ? gInt * (gOk / gBal) : 0) + (oBal > 0 ? oInt * (oOk / oBal) : 0);
    return it;
  }

  function emptyItems() {
    return {
      qriInterest: 0, pmi: 0, invInterest: 0, studentInterest: 0, autoInterest: 0,
      aboveLine: 0, customItemized: 0, ordInv: 0, qualDiv: 0, ltcg: 0,
    };
  }

  function addItems(a, b) {
    const r = {};
    for (const k in a) r[k] = a[k] + (b[k] || 0);
    return r;
  }

  function bracketTax(taxable, brackets) {
    let tax = 0, lower = 0;
    for (const [upper, rate] of brackets) {
      if (taxable <= lower) break;
      tax += (Math.min(taxable, upper) - lower) * rate;
      lower = upper;
    }
    return tax;
  }

  // Tax on preferential income stacked on top of ordinary taxable income.
  function prefTax(ordTI, pref, status) {
    const [t0, t15] = LAW.ltcg[status];
    const top = ordTI + pref;
    const in0 = Math.max(0, Math.min(top, t0) - ordTI);
    const in15 = Math.max(0, Math.min(top, t15) - Math.max(ordTI, t0));
    return 0.15 * in15 + 0.2 * (pref - in0 - in15);
  }

  const ceilK = (x) => Math.ceil(Math.max(0, x) / 1000);

  // Federal income tax + NIIT for one year.
  // profile = { status: "single"|"mfj", income (other ordinary income), saltPaid, otherItemized }
  function federalTax(profile, items, year) {
    const st = profile.status;
    const agiPre = profile.income + items.ordInv + items.qualDiv + items.ltcg - items.aboveLine;
    const [slo, shi] = LAW.studentPhase[st];
    const student = Math.min(items.studentInterest, LAW.studentMax) *
      Math.max(0, Math.min(1, (shi - agiPre) / (shi - slo)));
    const agi = agiPre - student;

    let auto = 0;
    if (year >= LAW.autoYears[0] && year <= LAW.autoYears[1]) {
      auto = Math.min(items.autoInterest, LAW.autoMax);
      auto = Math.max(0, auto - 200 * ceilK(agi - LAW.autoPhaseStart[st]));
    }

    const salt = Math.min(profile.saltPaid, saltCap(year, agi));
    const pmiFactor = Math.max(0, 1 - 0.1 * ceilK(agi - LAW.pmiPhaseStart));
    const invInt = Math.min(items.invInterest, items.ordInv);
    const itemized = salt + profile.otherItemized + items.qriInterest + items.pmi * pmiFactor +
      invInt + items.customItemized;
    // 2/37 limit: start of the 37% bracket is the top of the 35% bracket.
    const top37 = T.brackets[st][5][0];
    const allowed = itemized - LAW.itemizedLimitRate * Math.min(itemized, Math.max(0, agi - auto - top37));
    const std = T.standardDeduction[st];
    const itemizing = allowed > std;
    const deduction = itemizing ? allowed : std;

    const taxable = Math.max(0, agi - deduction - auto);
    const pref = Math.min(taxable, items.qualDiv + items.ltcg);
    const ordTI = taxable - pref;
    const incomeTax = bracketTax(ordTI, T.brackets[st]) + prefTax(ordTI, pref, st);
    const nii = Math.max(0, items.ordInv + items.qualDiv + items.ltcg - invInt);
    const niit = LAW.niit.rate * Math.min(nii, Math.max(0, agi - LAW.niit[st]));
    return { total: incomeTax + niit, incomeTax, niit, agi, taxable, itemizing, deduction, student, auto };
  }

  Object.assign(NS, { LAW, LOAN_TYPES, saltCap, classify, loanItems, emptyItems, addItems, federalTax, bracketTax });
})(this);
