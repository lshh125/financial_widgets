// Loan engine: monthly amortization with optional interest-only period, one variable-rate reset,
// mortgage insurance, prepayment with penalty, and recast.
(function (root) {
  "use strict";
  const NS = (root.LoanSim = root.LoanSim || {});

  // Level payment that pays off `balance` over `n` months at annual rate `rate`.
  function amortPayment(balance, rate, n) {
    if (balance <= 0) return 0;
    if (n <= 0) return balance;
    const r = rate / 12;
    if (r === 0) return balance / n;
    return (balance * r) / (1 - Math.pow(1 + r, -n));
  }

  // Scheduled payment for a loan as entered: the override if given, otherwise the level payment
  // (after any interest-only period).
  function scheduledPayment(loan) {
    if (loan.paymentOverride > 0) return loan.paymentOverride;
    return amortPayment(loan.balance, loan.rate, loan.termMonths - (loan.ioMonths || 0));
  }

  // Mutable state for one loan within one strategy.
  function initLoan(loan) {
    return {
      bal: loan.balance,
      payment: scheduledPayment(loan),
      pmiActive: (loan.pmi || 0) > 0 && loan.balance > (loan.pmiEndBalance || 0),
      payoffMonth: loan.balance > 0 ? null : 0,
    };
  }

  function rateAt(loan, m) {
    return loan.variable && m >= loan.changeMonth ? loan.newRate : loan.rate;
  }

  // One month: returns { interest, principal, payment, pmi, startBal }. Mutates state s.
  function stepLoan(loan, s, m) {
    const startBal = s.bal;
    if (s.bal <= 1e-9) return { interest: 0, principal: 0, payment: 0, pmi: 0, startBal: 0 };
    const rate = rateAt(loan, m);
    const io = loan.ioMonths || 0;
    // The payment resets when the interest-only period ends or the rate changes.
    if ((io > 0 && m === io) || (loan.variable && m === loan.changeMonth && m >= io)) {
      s.payment = amortPayment(s.bal, rate, loan.termMonths - m);
    }
    const interest = (s.bal * rate) / 12;
    let payment = m < io ? interest : Math.min(s.payment, s.bal + interest);
    if (m >= loan.termMonths - 1) payment = s.bal + interest; // final payment clears any remainder
    const principal = payment - interest;
    s.bal -= principal;
    const pmi = s.pmiActive ? loan.pmi : 0;
    if (s.pmiActive && s.bal <= (loan.pmiEndBalance || 0)) s.pmiActive = false;
    if (s.bal <= 1e-9) {
      s.bal = 0;
      s.pmiActive = false;
      if (s.payoffMonth === null) s.payoffMonth = m + 1;
    }
    return { interest, principal, payment, pmi, startBal };
  }

  // Extra principal of up to `cash` (including penalty). Returns { principal, penalty }.
  // The fixed fee is charged on the first prepayment only.
  function prepay(loan, s, cash, m, recast) {
    if (s.bal <= 0 || cash <= 0) return { principal: 0, penalty: 0 };
    const pct = (loan.penaltyPct || 0) / 100;
    const fee = s.feePaid ? 0 : loan.penaltyFee || 0;
    if (cash <= fee) return { principal: 0, penalty: 0 };
    const principal = Math.min(s.bal, (cash - fee) / (1 + pct));
    const penalty = principal * pct + fee;
    s.feePaid = true;
    s.bal -= principal;
    if (s.pmiActive && s.bal <= (loan.pmiEndBalance || 0)) s.pmiActive = false;
    if (s.bal <= 1e-9) {
      s.bal = 0;
      s.pmiActive = false;
      if (s.payoffMonth === null) s.payoffMonth = m;
    } else if (recast && m >= (loan.ioMonths || 0)) {
      s.payment = amortPayment(s.bal, rateAt(loan, m), loan.termMonths - m);
    }
    return { principal, penalty };
  }

  // Cash needed to clear the loan right now, including penalty.
  function payoffCost(loan, s) {
    if (s.bal <= 0) return 0;
    return s.bal * (1 + (loan.penaltyPct || 0) / 100) + (s.feePaid ? 0 : loan.penaltyFee || 0);
  }

  Object.assign(NS, { amortPayment, scheduledPayment, initLoan, stepLoan, prepay, payoffCost, rateAt });
})(this);
