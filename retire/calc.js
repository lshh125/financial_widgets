// Social Security claiming-age calculator: monthly benefits and their accumulated "value".
//
// Sources: SSA 2026 COLA fact sheet (maximum benefit at full retirement age, $4,152/month);
// SSA claiming rules (benefit reduced 5/9 of 1% per month for the first 36 months before full
// retirement age and 5/12 of 1% per month beyond that; increased 2/3 of 1% per month after it,
// up to age 70).
(function (root) {
  "use strict";

  const START_AGE = 62;
  const FRA = 67; // full retirement age for anyone born in 1960 or later
  const LAST_CLAIM_AGE = 70; // no further increase after 70
  const CLAIM_AGES = [62, 63, 64, 65, 66, 67, 68, 69, 70];

  // Benefit as a share of the full-retirement-age amount, for claiming at `age` (years, may be
  // fractional to the month).
  function claimFactor(age) {
    const months = Math.round((Math.min(age, LAST_CLAIM_AGE) - FRA) * 12);
    if (months >= 0) return 1 + months * (2 / 3) / 100;
    const early = -months;
    return 1 - (Math.min(early, 36) * 5) / 900 - (Math.max(0, early - 36) * 5) / 1200;
  }

  // Accumulated value at each month from age 62, for one claiming age.
  // p = { pia: monthly benefit at full retirement age (in today's dollars, at age 62),
  //       cola: yearly cost-of-living increase, rate: yearly value rate, endAge }
  // COLAs are applied every 12 months from age 62, whether or not benefits have started (as SSA
  // does after the year you turn 62). Each month's check arrives at the end of that month, and
  // what has accumulated grows at the value rate, compounded monthly: (1 + rate)^(1/12) − 1.
  // Returns { value[m], check[m] } for m = 0 .. (endAge − 62) × 12.
  function series(claimAge, p) {
    const n = Math.round((p.endAge - START_AGE) * 12);
    const i = Math.pow(1 + p.rate, 1 / 12) - 1;
    const start = Math.round((claimAge - START_AGE) * 12);
    const factor = claimFactor(claimAge);
    const value = new Float64Array(n + 1), check = new Float64Array(n + 1);
    for (let m = 0; m < n; m++) {
      const pay = m >= start ? p.pia * factor * Math.pow(1 + p.cola, Math.floor(m / 12)) : 0;
      check[m + 1] = pay;
      value[m + 1] = value[m] * (1 + i) + pay;
    }
    return { value, check, firstCheck: p.pia * factor * Math.pow(1 + p.cola, Math.floor(start / 12)), factor };
  }

  function allSeries(p) {
    const out = {};
    for (const a of CLAIM_AGES) out[a] = series(a, p);
    return out;
  }

  // Claiming age with the most value at month m (ties go to the earlier age).
  function bestAt(all, m) {
    let best = CLAIM_AGES[0];
    for (const a of CLAIM_AGES) if (all[a].value[m] > all[best].value[m] + 1e-9) best = a;
    return best;
  }

  // Ranges of "collect until" age over which each claiming age gives the most value.
  // Returns [{ claimAge, fromMonth, toMonth }] (months since 62, inclusive).
  function bestRanges(all, n) {
    const out = [];
    for (let m = 1; m <= n; m++) {
      const b = bestAt(all, m);
      const last = out[out.length - 1];
      if (last && last.claimAge === b) last.toMonth = m;
      else out.push({ claimAge: b, fromMonth: m, toMonth: m });
    }
    return out;
  }

  // First month at which claiming at `later` has accumulated more than claiming at `earlier`.
  function crossover(all, earlier, later, n) {
    for (let m = Math.round((later - START_AGE) * 12) + 1; m <= n; m++) {
      if (all[later].value[m] > all[earlier].value[m]) return m;
    }
    return null;
  }

  // ---------- Uncertain lifespan ----------

  const LIFE_AGES = [60, 70, 80, 90, 100, 110];
  const MAX_AGE = 110;

  // Chance of still collecting at `age`, from knots [[age, p], ...], linear in between.
  function survivalAt(knots, age) {
    if (age <= knots[0][0]) return knots[0][1];
    for (let k = 1; k < knots.length; k++) {
      const [a1, p1] = knots[k - 1], [a2, p2] = knots[k];
      if (age <= a2) return p1 + ((p2 - p1) * (age - a1)) / (a2 - a1);
    }
    return knots[knots.length - 1][1];
  }

  // probs[m] = chance of collecting exactly m monthly checks (m = 0 .. (110 − 62) × 12), given
  // being alive at 62: the chance of reaching month m but not month m + 1.
  // Returns null if nobody reaches 62.
  function lifeDistribution(knots) {
    const n = (MAX_AGE - START_AGE) * 12;
    const s0 = survivalAt(knots, START_AGE);
    if (!(s0 > 0)) return null;
    const probs = new Float64Array(n + 1);
    for (let m = 0; m <= n; m++) {
      const here = survivalAt(knots, START_AGE + m / 12);
      const next = m === n ? 0 : survivalAt(knots, START_AGE + (m + 1) / 12);
      probs[m] = Math.max(0, here - next) / s0;
    }
    return probs;
  }

  // Distribution of the total value collected for one starting age: [{ value, prob }] sorted by
  // value, plus the expected value and median. s = series(claimAge, p) computed up to age 110.
  function valueDistribution(s, probs) {
    const pts = [];
    let mean = 0;
    for (let m = 0; m < probs.length; m++) {
      if (probs[m] <= 0) continue;
      pts.push({ value: s.value[m], prob: probs[m] });
      mean += s.value[m] * probs[m];
    }
    pts.sort((a, b) => a.value - b.value);
    let acc = 0, median = 0;
    for (const pt of pts) { acc += pt.prob; if (acc >= 0.5) { median = pt.value; break; } }
    return { pts, mean, median };
  }

  root.SSCalc = {
    START_AGE, FRA, LAST_CLAIM_AGE, CLAIM_AGES, LIFE_AGES, MAX_AGE, claimFactor, series, allSeries,
    bestAt, bestRanges, crossover, survivalAt, lifeDistribution, valueDistribution,
  };
})(this);
