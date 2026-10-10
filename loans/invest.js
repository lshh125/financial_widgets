// Investment engine: a taxable brokerage account with price growth, dividends, interest, and an
// expense ratio. Total return = price growth + dividend yield + interest yield, so the income
// parts are not counted twice.
(function (root) {
  "use strict";
  const NS = (root.LoanSim = root.LoanSim || {});

  // Monthly rates from annual assumptions (fractions).
  // inv = { totalReturn, dividendYield, qualifiedPct, interestYield, expenseRatio }
  function monthlyRates(inv) {
    const growth = inv.totalReturn - inv.dividendYield - inv.interestYield;
    return {
      price: Math.pow(1 + growth, 1 / 12) - 1,
      dividend: inv.dividendYield / 12,
      interest: inv.interestYield / 12,
      fee: inv.expenseRatio / 12,
      qualified: inv.qualifiedPct,
    };
  }

  function newAccount() {
    return {
      value: 0, basis: 0,
      // running totals
      grossReturn: 0, fees: 0,
      // this tax year
      yrOrd: 0, yrQual: 0,
    };
  }

  // One month. priceReturn overrides the deterministic price growth (risk simulation).
  // Distributions are reinvested and added to basis; the contribution (or withdrawal, if
  // negative) is applied at month end.
  function stepAccount(a, rates, contribution, priceReturn) {
    const v = a.value;
    const price = v * (priceReturn ?? rates.price);
    const div = v * rates.dividend;
    const int = v * rates.interest;
    const fee = v * rates.fee;
    a.value = v + price + div + int - fee + contribution;
    a.basis = Math.max(0, a.basis + div + int + contribution);
    a.grossReturn += price + div + int;
    a.fees += fee;
    a.yrQual += div * rates.qualified;
    a.yrOrd += int + div * (1 - rates.qualified);
  }

  // Unrealized gain if everything were sold now (losses count as zero gain).
  const unrealizedGain = (a) => Math.max(0, a.value - a.basis);

  Object.assign(NS, { monthlyRates, newAccount, stepAccount, unrealizedGain });
})(this);
