(function () {
  "use strict";

  const { LIMITS_2026, isHsaPlan, hsaOwnMax, planCost, expenseGrid } = window.HealthCalc;
  const { TAX_2026 } = window.TaxCalc;

  const COLORS = ["#d95f02", "#1f78b4", "#33a02c"];
  // On touch devices Plotly's touch handlers block page scrolling, so the chart is static there
  // and taps are mapped to an expense by hand (see onTap).
  const TOUCH = window.matchMedia("(hover: none), (pointer: coarse)").matches;

  const money = (v) => (v < 0 ? "−$" : "$") + Math.round(Math.abs(v)).toLocaleString("en-US");
  const kShort = (v) => "$" + (v >= 1000 ? +(v / 1000).toFixed(1) + "k" : v);

  // Plan fields: premium is stored as an annual amount; coinsurance in percent.
  function defaultState() {
    return {
      premiumMode: "monthly",
      coverage: "self",
      maxExpense: 15000,
      taxRate: 29.65,
      fsaPct: 80,
      hsaContribution: null, // null = follow the annual maximum
      employerHsa: 250,
      plans: [
        { name: "Plan 1", premium: 123 * 12, deductible: 375, coinsurance: 20, maxOop: 2100 },
        { name: "Plan 2", premium: 51 * 12, deductible: 750, coinsurance: 30, maxOop: 4500 },
        { name: "Plan 3", premium: 27 * 12, deductible: 2000, coinsurance: 20, maxOop: 4000 },
      ],
    };
  }

  let state = defaultState();
  let selected = null; // expense clicked on the chart

  const globals = () => ({
    coverage: state.coverage,
    taxRate: state.taxRate / 100,
    fsaPct: state.fsaPct / 100,
    hsaContribution: hsaContribution(),
    employerHsa: state.employerHsa,
  });
  const hsaDefault = () => Math.max(0, LIMITS_2026.hsaMax[state.coverage] - state.employerHsa);
  const hsaContribution = () => (state.hsaContribution === null ? hsaDefault() : state.hsaContribution);
  const calcPlans = () =>
    state.plans.map((p) => ({ ...p, coinsurance: p.coinsurance / 100 }));
  const planLabel = (i) =>
    state.plans[i].name + (isHsaPlan(state.plans[i], state.coverage) ? " (HSA)" : "");

  // ---------- Controls ----------

  // A slider paired with a number box. The box accepts values outside the slider range.
  // spec = { label, unit: "$" | "%", min, max, step, get(), set(v) }
  const fields = [];
  function field(spec) {
    const wrap = document.createElement("div");
    wrap.className = "slider field";
    const pre = spec.unit === "$" ? "$" : "";
    const post = spec.unit === "%" ? "%" : "";
    wrap.innerHTML =
      `<div class="lbl"><label></label><span class="num">${pre}<input type="number" inputmode="decimal" step="any">${post}</span></div>` +
      `<input type="range">` +
      (spec.hint ? `<div class="hint"></div>` : "");
    wrap.querySelector("label").textContent = spec.label;
    const num = wrap.querySelector("input[type=number]");
    const range = wrap.querySelector("input[type=range]");
    num.setAttribute("aria-label", spec.label);
    range.setAttribute("aria-label", spec.label);
    const f = {
      spec,
      sync(except) {
        const s = typeof spec.limits === "function" ? { ...spec, ...spec.limits() } : spec;
        range.min = s.min;
        range.max = s.max;
        range.step = s.step;
        const v = spec.get();
        range.value = v;
        if (except !== num) num.value = +v.toFixed(2);
        if (spec.hint) wrap.querySelector(".hint").textContent = spec.hint();
      },
    };
    num.addEventListener("input", () => {
      const v = parseFloat(num.value);
      if (!Number.isFinite(v) || v < 0) return;
      spec.set(v);
      changed(num);
    });
    num.addEventListener("change", () => f.sync()); // tidy the box once editing ends
    range.addEventListener("input", () => {
      spec.set(Number(range.value));
      changed();
    });
    fields.push(f);
    return wrap;
  }

  function premiumSpec(i) {
    return {
      label: "Premium (your share)",
      unit: "$",
      limits: () =>
        state.premiumMode === "monthly"
          ? { min: 0, max: 1500, step: 1 }
          : { min: 0, max: 18000, step: 10 },
      get: () => state.plans[i].premium / (state.premiumMode === "monthly" ? 12 : 1),
      set: (v) => (state.plans[i].premium = v * (state.premiumMode === "monthly" ? 12 : 1)),
      hint: () =>
        state.premiumMode === "monthly"
          ? `${money(state.plans[i].premium)} per year`
          : `${money(state.plans[i].premium / 12)} per month`,
    };
  }

  function planSpec(i, key, label, unit, max, step) {
    return {
      label, unit, min: 0, max, step,
      get: () => state.plans[i][key],
      set: (v) => (state.plans[i][key] = v),
    };
  }

  function buildControls() {
    fields.length = 0;

    const range = document.getElementById("rangeFields");
    range.innerHTML = "";
    range.appendChild(field({
      label: "Max medical expense shown", unit: "$", min: 1000, max: 100000, step: 1000,
      get: () => state.maxExpense,
      set: (v) => (state.maxExpense = Math.max(100, v)),
    }));

    const host = document.getElementById("plans");
    host.innerHTML = "";
    state.plans.forEach((p, i) => {
      const sec = document.createElement("details");
      sec.className = "panel plan";
      sec.open = true;
      sec.style.setProperty("--plan", COLORS[i]);
      sec.innerHTML =
        `<summary><span class="swatch"></span><h2></h2><span class="badge"></span></summary>` +
        `<label class="row">Name <input type="text" class="name" maxlength="24"></label>`;
      sec.querySelector("h2").textContent = p.name;
      const name = sec.querySelector(".name");
      name.value = p.name;
      name.addEventListener("input", () => {
        state.plans[i].name = name.value || `Plan ${i + 1}`;
        sec.querySelector("h2").textContent = state.plans[i].name;
        scheduleRender();
      });
      sec.appendChild(field(premiumSpec(i)));
      sec.appendChild(field(planSpec(i, "deductible", "Deductible", "$", 10000, 50)));
      sec.appendChild(field(planSpec(i, "coinsurance", "Coinsurance (you pay)", "%", 100, 1)));
      sec.appendChild(field(planSpec(i, "maxOop", "Out-of-pocket max", "$", 20000, 50)));
      host.appendChild(sec);
    });

    const tax = document.getElementById("taxFields");
    tax.innerHTML = "";
    tax.appendChild(field({
      label: "Marginal tax rate", unit: "%", min: 0, max: 60, step: 0.05,
      get: () => state.taxRate,
      set: (v) => (state.taxRate = v),
    }));

    const fsa = document.getElementById("fsaFields");
    fsa.innerHTML = "";
    fsa.appendChild(field({
      label: "FSA election (% of expected out-of-pocket)", unit: "%", min: 0, max: 200, step: 1,
      get: () => state.fsaPct,
      set: (v) => (state.fsaPct = v),
      hint: () => `Capped at the ${money(LIMITS_2026.fsaMax)} annual limit.`,
    }));

    const hsa = document.getElementById("hsaFields");
    hsa.innerHTML = "";
    hsa.appendChild(field({
      label: "Your HSA contribution", unit: "$",
      limits: () => ({ min: 0, max: hsaOwnMax(globals()), step: 50 }),
      get: hsaContribution,
      set: (v) => (state.hsaContribution = v),
      hint: () => {
        const lim = LIMITS_2026.hsaMax[state.coverage];
        return `Limit ${money(lim)} including employer money (+${money(LIMITS_2026.hsaCatchUp55)} at 55+). ` +
          (state.hsaContribution === null ? "Following the limit." : "");
      },
    }));
    hsa.appendChild(field({
      label: "Employer HSA contribution", unit: "$", min: 0, max: 3000, step: 50,
      get: () => state.employerHsa,
      set: (v) => (state.employerHsa = v),
    }));

    buildBrackets();
    syncControls();
  }

  // One row per federal bracket: [rate, income tax only, with FICA].
  function bracketRows() {
    const s = TAX_2026.brackets.single, m = TAX_2026.brackets.mfj;
    return s.map(([, rate], i) => {
      const fica = rate <= 0.24 ? 7.65 : 2.35;
      const pctRate = Math.round(rate * 100);
      return {
        rate: pctRate,
        withFica: +(pctRate + fica).toFixed(2),
        single: i === 0 ? 0 : s[i - 1][0],
        mfj: i === 0 ? 0 : m[i - 1][0],
      };
    });
  }

  function buildBrackets() {
    const body = document.getElementById("bracketRows");
    body.innerHTML = bracketRows()
      .map(
        (r) =>
          `<tr><td><b>${r.rate}%</b> <span class="muted">(${kShort(r.single)} / ${kShort(r.mfj)})</span></td>` +
          `<td><button type="button" data-rate="${r.rate}">${r.rate}%</button></td>` +
          `<td><button type="button" data-rate="${r.withFica}">${r.withFica}%</button></td></tr>`
      )
      .join("");
    body.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        state.taxRate = Number(b.dataset.rate);
        changed();
      })
    );
  }

  function syncControls(except) {
    for (const f of fields) f.sync(except);
    document.getElementById("premiumMode").value = state.premiumMode;
    document.getElementById("coverage").value = state.coverage;
    document.getElementById("coverageWarn").hidden = state.coverage !== "family";
    document.getElementById("fsaWarn").hidden = state.fsaPct <= 100;
    document.querySelectorAll("#bracketRows button").forEach((b) =>
      b.classList.toggle("active", Math.abs(Number(b.dataset.rate) - state.taxRate) < 1e-9)
    );
    document.querySelectorAll("#plans .plan").forEach((sec, i) => {
      const hsa = isHsaPlan(state.plans[i], state.coverage);
      const badge = sec.querySelector(".badge");
      badge.textContent = hsa ? "HDHP · HSA" : "FSA";
      badge.classList.toggle("hsa", hsa);
    });
  }

  function changed(except) {
    syncControls(except);
    scheduleRender();
  }

  // ---------- Rendering ----------

  let pending = false;
  function scheduleRender() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      render();
    });
  }

  function render() {
    const plans = calcPlans();
    const g = globals();
    const xs = expenseGrid(plans, g, state.maxExpense);
    const costs = plans.map((p) => xs.map((x) => planCost(x, p, g)));

    const traces = [];
    plans.forEach((p, i) => {
      const name = planLabel(i);
      traces.push({
        type: "scatter", mode: "lines", name, legendgroup: "p" + i,
        x: xs, y: costs[i].map((c) => c.net), customdata: costs[i].map((c) => c.gross),
        line: { color: COLORS[i], width: 3 },
        hovertemplate:
          `${escapeHtml(name)}: <b>$%{y:,.0f}</b> after tax · $%{customdata:,.0f} before<extra></extra>`,
      });
      traces.push({
        type: "scatter", mode: "lines", name: name + " (before tax savings)", legendgroup: "p" + i,
        showlegend: false, hoverinfo: "skip",
        x: xs, y: costs[i].map((c) => c.gross),
        line: { color: COLORS[i], width: 2, dash: "dot" },
      });
    });
    // Legend key for the two line styles.
    for (const [name, dash] of [["After tax savings", "solid"], ["Before tax savings", "dot"]]) {
      traces.push({
        type: "scatter", mode: "lines", name, x: [null], y: [null], hoverinfo: "skip",
        line: { color: "#8a93a3", width: 2, dash },
      });
    }

    const narrow = window.innerWidth < 700;
    const height = narrow ? Math.round(Math.min(520, Math.max(340, window.innerHeight * 0.62))) : 540;
    const shapes = selected === null ? [] : [{
      type: "line", xref: "x", yref: "paper", x0: selected, x1: selected, y0: 0, y1: 1,
      line: { color: "#1d2330", width: 1.5, dash: "dash" },
    }];
    const layout = {
      height,
      margin: narrow ? { l: 52, r: 10, t: 64, b: 48 } : { l: 70, r: 24, t: 48, b: 56 },
      dragmode: false,
      hovermode: "x unified",
      shapes,
      legend: { orientation: "h", x: 0, xanchor: "left", y: 1.02, yanchor: "bottom", font: { size: narrow ? 11 : 12 } },
      xaxis: {
        title: { text: "Medical expense (allowed charges)" },
        tickprefix: "$", tickformat: "~s", hoverformat: "$,.0f", fixedrange: true, range: [0, state.maxExpense],
      },
      yaxis: {
        title: { text: narrow ? "Yearly cost" : "Yearly cost (premium + out-of-pocket)" },
        tickprefix: "$", tickformat: "~s", fixedrange: true, zeroline: true, zerolinecolor: "#9aa3b2",
      },
      hoverlabel: { align: "left", bgcolor: "#fff", font: { size: 13, color: "#1d2330" } },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
    };

    const chartEl = document.getElementById("chart");
    Plotly.react(chartEl, traces, layout, {
      displayModeBar: false, scrollZoom: false, responsive: true, staticPlot: TOUCH,
    });
    renderWinners(xs, costs);
    renderDetail();
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }

  // Which plan is cheapest after tax savings, by expense range.
  function renderWinners(xs, costs) {
    const segs = [];
    xs.forEach((x, k) => {
      let best = 0;
      for (let i = 1; i < costs.length; i++) if (costs[i][k].net < costs[best][k].net - 0.005) best = i;
      const last = segs[segs.length - 1];
      if (last && last.plan === best) last.to = x;
      else segs.push({ plan: best, from: x, to: x });
    });
    document.getElementById("winners").innerHTML =
      "<b>Cheapest after tax savings:</b> " +
      segs
        .map(
          (s) =>
            `<span class="seg" style="--plan:${COLORS[s.plan]}">${escapeHtml(planLabel(s.plan))}` +
            ` <span class="muted">${money(s.from)}–${money(s.to)}</span></span>`
        )
        .join(" ");
  }

  function costsAt(x) {
    const g = globals();
    return calcPlans().map((p) => planCost(x, p, g));
  }

  function tapHtml(x) {
    const cs = costsAt(x);
    return (
      `<b>Medical expense: ${money(x)}</b><br>` +
      cs
        .map(
          (c, i) =>
            `<span class="dot" style="background:${COLORS[i]}"></span>${escapeHtml(planLabel(i))}: ` +
            `<b>${money(c.net)}</b> after tax · ${money(c.gross)} before`
        )
        .join("<br>")
    );
  }

  function renderDetail() {
    const el = document.getElementById("detail");
    if (selected === null) {
      el.innerHTML = `<p class="hint">${TOUCH ? "Tap" : "Click"} the chart to see the breakdown at that expense.</p>`;
      return;
    }
    const cs = costsAt(selected);
    const best = cs.reduce((b, c, i) => (c.net < cs[b].net ? i : b), 0);
    const row = (label, fn, cls = "") =>
      `<tr class="${cls}"><td>${label}</td>${cs.map((c, i) => `<td>${fn(c, i)}</td>`).join("")}</tr>`;
    el.innerHTML = `
      <p class="headline">At ${money(selected)} of medical expense, the cheapest is
        <b style="color:${COLORS[best]}">${escapeHtml(planLabel(best))}</b> at ${money(cs[best].net)} after tax savings.</p>
      <table>
        <thead><tr><th></th>${cs.map((c, i) => `<th style="color:${COLORS[i]}">${escapeHtml(state.plans[i].name)}</th>`).join("")}</tr></thead>
        <tbody>
          ${row("Account", (c) => (c.hsa ? "HSA" : "FSA"))}
          ${row("Premium", (c) => money(c.premium))}
          ${row("Deductible + coinsurance", (c) => money(c.medical))}
          ${row("Total before tax savings", (c) => money(c.gross), "total")}
          ${row("FSA / HSA contribution", (c) => money(c.contribution))}
          ${row("Unused FSA forfeited", (c) => (c.hsa ? "—" : money(c.forfeited)))}
          ${row("Tax savings", (c) => money(-c.taxSavings))}
          ${row("Net after tax savings", (c, i) => (i === best ? `<span class="pos">${money(c.net)}</span>` : money(c.net)), "total")}
        </tbody>
      </table>`;
  }

  function select(x) {
    selected = Math.max(0, Math.min(state.maxExpense, Math.round(x / 10) * 10));
    scheduleRender();
  }

  // Touch mode: map a tap to an expense and show its costs in a bottom card.
  function onTap(ev) {
    const card = document.getElementById("tapcard");
    const chartEl = document.getElementById("chart");
    const fl = chartEl._fullLayout;
    if (!fl) return;
    const size = fl._size;
    const rect = chartEl.getBoundingClientRect();
    const px = ev.clientX - rect.left - size.l;
    const py = ev.clientY - rect.top - size.t;
    if (px < 0 || py < 0 || px > size.w || py > size.h) {
      card.hidden = true;
      return;
    }
    select(fl.xaxis.p2d(px));
    card.querySelector(".body").innerHTML = tapHtml(selected);
    card.hidden = false;
  }

  // ---------- Wiring ----------

  function init() {
    buildControls();
    document.getElementById("premiumMode").addEventListener("change", (e) => {
      state.premiumMode = e.target.value;
      changed();
    });
    document.getElementById("coverage").addEventListener("change", (e) => {
      state.coverage = e.target.value;
      changed();
    });
    document.getElementById("reset").addEventListener("click", () => {
      state = defaultState();
      selected = null;
      buildControls();
      scheduleRender();
    });
    // Phones: start with the long panels collapsed so the chart is reachable.
    if (window.innerWidth < 700) {
      document.querySelectorAll("#plans details, #taxPanel, details.notes").forEach((d) => (d.open = false));
    }
    let lastW = window.innerWidth;
    window.addEventListener("resize", () => {
      if (window.innerWidth !== lastW) {
        lastW = window.innerWidth;
        scheduleRender();
      }
    });
    render();
    const chartEl = document.getElementById("chart");
    if (TOUCH) {
      chartEl.addEventListener("click", onTap);
      document.getElementById("tapcard-close").addEventListener("click", () => {
        document.getElementById("tapcard").hidden = true;
      });
    } else {
      chartEl.on("plotly_click", (ev) => select(ev.points[0].x));
    }
  }

  init();
})();
