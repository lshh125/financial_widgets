(function () {
  "use strict";

  const { compare, TAX_2026 } = window.TaxCalc;
  const LIM = TAX_2026.limits;
  const MAX_CELLS_PER_AXIS = 150;

  const money = (v) => "$" + Math.round(v).toLocaleString("en-US");
  const pct = (v) => v + "%";

  const GROUPS = [
    {
      title: "Income range",
      sliders: [
        { key: "min", label: "Min income", min: 0, max: 1000000, step: 5000, def: 50000, fmt: money },
        { key: "max", label: "Max income", min: 10000, max: 2000000, step: 10000, def: 400000, fmt: money },
        { key: "step", label: "Increment", min: 1000, max: 100000, step: 1000, def: 25000, fmt: money },
      ],
    },
    {
      title: "Pre-tax contributions",
      sliders: [
        {
          key: "k401", label: "401(k)", min: 0, step: 250, def: 0, fmt: money,
          // Age-based catch-up: the slider maximum follows the age chosen next to the label.
          age: { key: "k401Age", options: [["none", "Under 50", LIM.k401], ["50", "Age 50+", LIM.k401 + LIM.k401CatchUp50], ["60", "Age 60–63", LIM.k401 + LIM.k401CatchUp60to63]] },
        },
        {
          key: "hsa", label: "HSA (payroll, self-only)", min: 0, step: 50, def: 0, fmt: money,
          age: { key: "hsaAge", options: [["none", "Under 55", LIM.hsaSelf], ["55", "Age 55+", LIM.hsaSelf + LIM.hsaCatchUp55]] },
        },
      ],
    },
    {
      title: "Investment income (% of total income)",
      sliders: [
        { key: "pctCapGain", label: "Short-term capital gains", min: 0, max: 100, step: 1, def: 0, fmt: pct },
        { key: "pctDividend", label: "Dividends (non-qualified)", min: 0, max: 100, step: 1, def: 0, fmt: pct },
        { key: "pctInterest", label: "Interest", min: 0, max: 100, step: 1, def: 0, fmt: pct },
      ],
    },
  ];
  const ALL_SLIDERS = GROUPS.flatMap((g) => g.sliders);
  const PCT_KEYS = ["pctCapGain", "pctDividend", "pctInterest"];
  const PEOPLE = [
    { id: "A", name: "Person A" },
    { id: "B", name: "Person B" },
  ];

  // On touch devices Plotly's own touch handlers block page scrolling, so the chart is
  // rendered static there and taps are mapped to cells by hand (see onTap).
  const TOUCH = window.matchMedia("(hover: none), (pointer: coarse)").matches;

  const state = {};
  let selected = null; // { incA, incB } of clicked cell
  let grid = null; // { xs, ys, custom } from the last render, for tap lookups

  function defaults() {
    for (const p of PEOPLE) {
      state[p.id] = {};
      for (const s of ALL_SLIDERS) {
        state[p.id][s.key] = s.def;
        if (s.age) state[p.id][s.age.key] = "none";
      }
    }
  }

  // Slider maximum: fixed, or the contribution limit for the age chosen.
  function sliderMax(s, st) {
    if (!s.age) return s.max;
    return s.age.options.find(([v]) => v === st[s.age.key])[2];
  }

  // ---------- Controls ----------

  function buildControls() {
    const host = document.getElementById("people");
    host.innerHTML = "";
    for (const p of PEOPLE) {
      const other = PEOPLE.find((q) => q.id !== p.id);
      const sec = document.createElement("details");
      sec.className = "panel";
      sec.open = true;
      sec.innerHTML =
        `<summary><h2>${p.name}</h2></summary>` +
        `<button type="button" class="copy">Copy from ${other.name}</button>`;
      sec.querySelector(".copy").addEventListener("click", () => {
        state[p.id] = { ...state[other.id] };
        syncControls();
        scheduleRender();
      });
      for (const g of GROUPS) {
        const h = document.createElement("h3");
        h.textContent = g.title;
        sec.appendChild(h);
        for (const s of g.sliders) {
          const wrap = document.createElement("div");
          wrap.className = "slider";
          const age = s.age
            ? ` <select class="age" id="${p.id}-${s.age.key}" title="Age-based catch-up limit" aria-label="${s.label} age">` +
              s.age.options.map(([v, t]) => `<option value="${v}">${t}</option>`).join("") + `</select>`
            : "";
          wrap.innerHTML =
            `<div class="lbl"><span>${s.label}${age}</span><output id="${p.id}-${s.key}-out"></output></div>` +
            `<input type="range" id="${p.id}-${s.key}" min="${s.min}" max="${sliderMax(s, state[p.id])}" step="${s.step}">`;
          const input = wrap.querySelector("input");
          input.addEventListener("input", () => onSlider(p.id, s.key, Number(input.value)));
          if (s.age) {
            const sel = wrap.querySelector("select.age");
            sel.addEventListener("change", () => {
              const st = state[p.id];
              st[s.age.key] = sel.value;
              st[s.key] = Math.min(st[s.key], sliderMax(s, st));
              syncControls();
              scheduleRender();
            });
          }
          sec.appendChild(wrap);
        }
      }
      const warn = document.createElement("div");
      warn.className = "warn";
      warn.id = `${p.id}-warn`;
      sec.appendChild(warn);
      host.appendChild(sec);
    }
    syncControls();
  }

  function syncControls() {
    for (const p of PEOPLE) {
      for (const s of ALL_SLIDERS) {
        const v = state[p.id][s.key];
        const input = document.getElementById(`${p.id}-${s.key}`);
        if (s.age) {
          document.getElementById(`${p.id}-${s.age.key}`).value = state[p.id][s.age.key];
          input.max = sliderMax(s, state[p.id]);
        }
        input.value = v;
        document.getElementById(`${p.id}-${s.key}-out`).textContent = s.fmt(v);
      }
      const st = state[p.id];
      const n = Math.floor((st.max - st.min) / st.step) + 1;
      document.getElementById(`${p.id}-warn`).textContent =
        n > MAX_CELLS_PER_AXIS
          ? `Range has ${n} steps; only the first ${MAX_CELLS_PER_AXIS} are shown. Increase the increment.`
          : "";
    }
  }

  function onSlider(pid, key, value) {
    const st = state[pid];
    st[key] = value;
    // Keep min <= max.
    if (key === "min" && st.min > st.max) st.max = st.min;
    if (key === "max" && st.max < st.min) st.min = st.max;
    // Investment percentages can't exceed 100% combined: shrink the slider being moved.
    if (PCT_KEYS.includes(key)) {
      const others = PCT_KEYS.filter((k) => k !== key).reduce((a, k) => a + st[k], 0);
      st[key] = Math.min(st[key], 100 - others);
    }
    syncControls();
    scheduleRender();
  }

  // ---------- Computation ----------

  function axisValues(st) {
    const n = Math.min(MAX_CELLS_PER_AXIS, Math.floor((st.max - st.min) / st.step) + 1);
    return Array.from({ length: n }, (_, i) => st.min + i * st.step);
  }

  function person(pid, income) {
    return { ...state[pid], income };
  }

  // Dollars rounded to the nearest $0.1k, percentages to one decimal.
  function signed(r, body) {
    if (r === 0) return body(0);
    return (r > 0 ? "+" : "−") + body(Math.abs(r));
  }
  const kUnsigned = (v) => "$" + (Math.round(v / 100) / 10).toFixed(1) + "k";
  const kSigned = (v, dollar = true) =>
    signed(Math.round(v / 100) / 10, (a) => (dollar ? "$" : "") + a.toFixed(1) + "k");
  const pctSigned = (v) => signed(Math.round(v * 10) / 10, (a) => a.toFixed(1) + "%");
  // Rates are fractions (0.24 → "24.0%").
  const pct1 = (v) => (Math.round(v * 1000) / 10).toFixed(1) + "%";
  const effective = (tax, gross) => (gross > 0 ? pct1(tax / gross) : "—");
  const marginalShort = (t) =>
    t.niit > 0 ? `${pct1(t.marginalRate)} (${pct1(t.bracketRate)} w/o NIIT)` : pct1(t.marginalRate);

  function fmtCell(v, mode) {
    return mode === "pct" ? pctSigned(v) : kSigned(v, false);
  }

  // Colorscale spanning [zmin, zmax] with white pinned at 0. Each side reaches full
  // saturation at its own extreme, so the scale follows the data on both sides.
  function divergingScale(zmin, zmax) {
    const neg = ["#b2182b", "#ef8a62"], pos = ["#67a9cf", "#2166ac"];
    if (zmin >= 0) return [[0, "#ffffff"], [0.5, pos[0]], [1, pos[1]]];
    if (zmax <= 0) return [[0, neg[0]], [0.5, neg[1]], [1, "#ffffff"]];
    const p = -zmin / (zmax - zmin);
    return [[0, neg[0]], [p / 2, neg[1]], [p, "#ffffff"], [p + (1 - p) / 2, pos[0]], [1, pos[1]]];
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
    const mode = document.getElementById("mode").value;
    const showText = document.getElementById("showText").checked;
    const xs = axisValues(state.A);
    const ys = axisValues(state.B);

    const z = [], text = [], custom = [];
    let zmin = 0, zmax = 0;
    for (const incB of ys) {
      const zr = [], tr = [], cr = [];
      for (const incA of xs) {
        const r = compare(person("A", incA), person("B", incB));
        const v = mode === "pct" ? r.pct : r.diff;
        zmin = Math.min(zmin, v);
        zmax = Math.max(zmax, v);
        zr.push(v);
        tr.push(fmtCell(v, mode));
        cr.push([
          kUnsigned(incA), kUnsigned(incB), kUnsigned(incA + incB),
          kUnsigned(r.sa.total), kUnsigned(r.sb.total), kUnsigned(r.singleTotal), kUnsigned(r.m.total),
          kSigned(r.diff), pctSigned(r.pct),
          marginalShort(r.sa), marginalShort(r.sb), marginalShort(r.m),
          effective(r.singleTotal, incA + incB), effective(r.m.total, incA + incB),
        ]);
      }
      z.push(zr); text.push(tr); custom.push(cr);
    }
    if (zmin === 0 && zmax === 0) { zmin = -1; zmax = 1; }

    // Height always fits the screen. Width aims for square cells (capped at the panel width),
    // but widens if needed to fit the numbers; the panel scrolls horizontally in that case.
    const chartEl = document.getElementById("chart");
    const wrapEl = document.getElementById("chartWrap");
    // Wide screens: colorbar in the right margin. Narrow screens: colorbar under the chart.
    const narrow = window.innerWidth < 700;
    const MARGIN = narrow ? { l: 66, r: 12, t: 12, b: 120 } : { l: 80, r: 130, t: 30, b: 70 };
    const height = Math.max(360, window.innerHeight - 40);
    const cellH = (height - MARGIN.t - MARGIN.b) / ys.length;
    const fitW = (wrapEl.clientWidth - MARGIN.l - MARGIN.r) / xs.length;
    // Labels like "+23.2k" need ~3.7 font-sizes of width. Shrink the font to fit the panel width
    // if possible, down to 8px; below that, keep 8px and let the panel scroll.
    const TEXT_W = 3.7, PAD = 8;
    const fontSize = Math.max(8, Math.min(11, cellH * 0.6, (fitW - PAD) / TEXT_W));
    const textOn = showText && cellH >= 10;
    const minTextW = textOn ? fontSize * TEXT_W + PAD : 1;
    const cellW = Math.max(minTextW, Math.min(cellH, fitW));
    const width = Math.floor(MARGIN.l + MARGIN.r + xs.length * cellW);
    const cell = Math.min(cellW, cellH);

    const trace = {
      type: "heatmap",
      x: xs,
      y: ys,
      z,
      text,
      customdata: custom,
      texttemplate: textOn ? "%{text}" : "",
      textfont: { size: fontSize },
      colorscale: divergingScale(zmin, zmax),
      zmin,
      zmax,
      xgap: cell > 12 ? 1 : 0,
      ygap: cell > 12 ? 1 : 0,
      colorbar: {
        title: {
          text: mode === "pct" ? "Savings (% of tax)" : "Savings ($)",
          side: narrow ? "top" : "right",
        },
        tickformat: mode === "pct" ? "+.1f" : "$,.0f",
        ticksuffix: mode === "pct" ? "%" : "",
        ...(narrow && {
          orientation: "h",
          thickness: 12,
          x: 0.5,
          xanchor: "center",
          y: -62 / (height - MARGIN.t - MARGIN.b),
          yanchor: "top",
        }),
      },
      hovertemplate: summaryHtml((i) => `%{customdata[${i}]}`) + "<extra></extra>",
    };
    grid = { xs, ys, custom };

    // Outline the selected cell.
    const shapes = [];
    if (selected) {
      const hx = state.A.step / 2, hy = state.B.step / 2;
      shapes.push({
        type: "rect", xref: "x", yref: "y", line: { color: "#1d2330", width: 2.5 },
        x0: selected.incA - hx, x1: selected.incA + hx, y0: selected.incB - hy, y1: selected.incB + hy,
      });
    }

    // Zoom/pan disabled: clicking or dragging never changes the view.
    const layout = {
      width,
      height,
      margin: MARGIN,
      dragmode: false,
      shapes,
      xaxis: {
        title: { text: "Person A income" }, tickprefix: "$", tickformat: "~s", constrain: "domain", fixedrange: true,
      },
      yaxis: { title: { text: "Person B income" }, tickprefix: "$", tickformat: "~s", fixedrange: true },
      hoverlabel: { align: "left", bgcolor: "#fff", font: { size: 13, color: "#1d2330" } },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
    };

    Plotly.react(chartEl, [trace], layout, { displayModeBar: false, scrollZoom: false, staticPlot: TOUCH });
    renderDetail();
  }

  // The hover/tap summary. field(i) returns the text for customdata column i.
  function summaryHtml(field) {
    return (
      `<b>Person A income:</b> ${field(0)}<br>` +
      `<b>Person B income:</b> ${field(1)}<br>` +
      `<b>Combined income:</b> ${field(2)}<br>` +
      "──────────────<br>" +
      `Tax if single, A: ${field(3)}<br>` +
      `Tax if single, B: ${field(4)}<br>` +
      `<b>Total if single:</b> ${field(5)}<br>` +
      `<b>Total if married (joint):</b> ${field(6)}<br>` +
      "──────────────<br>" +
      `<b>Difference:</b> ${field(7)}<br>` +
      `<b>Relative:</b> ${field(8)} of unmarried tax<br>` +
      "──────────────<br>" +
      `Marginal rate, A single: ${field(9)}<br>` +
      `Marginal rate, B single: ${field(10)}<br>` +
      `Marginal rate, married: ${field(11)}<br>` +
      `Effective rate, single: ${field(12)}<br>` +
      `Effective rate, married: ${field(13)}`
    );
  }

  function select(incA, incB) {
    selected = { incA, incB };
    scheduleRender();
  }

  // Touch mode: map a tap to a heatmap cell and show its summary in a bottom card.
  function onTap(ev) {
    const card = document.getElementById("tapcard");
    const chartEl = document.getElementById("chart");
    const size = chartEl._fullLayout && chartEl._fullLayout._size;
    if (!grid || !size) return;
    const rect = chartEl.getBoundingClientRect();
    const x = ev.clientX - rect.left - size.l;
    const y = ev.clientY - rect.top - size.t;
    if (x < 0 || y < 0 || x >= size.w || y >= size.h) {
      card.hidden = true;
      return;
    }
    const i = Math.floor((x / size.w) * grid.xs.length);
    const j = Math.floor(((size.h - y) / size.h) * grid.ys.length);
    card.querySelector(".body").innerHTML = summaryHtml((k) => grid.custom[j][i][k]);
    card.hidden = false;
    select(grid.xs[i], grid.ys[j]);
  }

  function renderDetail() {
    const el = document.getElementById("detail");
    if (!selected) {
      el.innerHTML = `<p class="hint">${TOUCH ? "Tap" : "Click"} a cell to see the full breakdown.</p>`;
      return;
    }
    const r = compare(person("A", selected.incA), person("B", selected.incB));
    const m = kUnsigned;
    const sum = (k) => r.a[k] + r.b[k];
    const infoRow = (label, k) =>
      `<tr><td>${label}</td><td>${m(r.a[k])}</td><td>${m(r.b[k])}</td><td>${m(sum(k))}</td><td>${m(sum(k))}</td><td></td></tr>`;
    const taxRow = (label, k, cls = "", showDiff = true) => {
      const s = r.sa[k] + r.sb[k];
      return `<tr class="${cls}"><td>${label}</td><td>${m(r.sa[k])}</td><td>${m(r.sb[k])}</td><td>${m(s)}</td><td>${m(r.m[k])}</td><td>${showDiff ? kSigned(s - r.m[k]) : ""}</td></tr>`;
    };
    const marginal = (t) =>
      t.niit > 0
        ? `${pct1(t.marginalRate)} <span class="muted">(${pct1(t.bracketRate)} without NIIT)</span>`
        : pct1(t.marginalRate);
    const verdict =
      Math.abs(r.diff) < 50
        ? "No difference"
        : r.diff > 0
        ? `<span class="pos">Marriage bonus: ${m(r.diff)}</span>`
        : `<span class="neg">Marriage penalty: ${m(-r.diff)}</span>`;

    el.innerHTML = `
      <p class="headline">A ${m(selected.incA)} + B ${m(selected.incB)} → ${verdict}
        (${pctSigned(r.pct)} of unmarried tax)</p>
      <table>
        <thead><tr><th></th><th>A single</th><th>B single</th><th>A + B single</th><th>Married joint</th><th>Savings</th></tr></thead>
        <tbody>
          ${infoRow("Gross income", "income")}
          ${infoRow("Wages", "wages")}
          ${infoRow("Investment income", "investment")}
          ${infoRow("401(k)", "k401")}
          ${infoRow("HSA", "hsa")}
          ${infoRow("AGI", "agi")}
          ${taxRow("Taxable income", "taxable", "", false)}
          ${taxRow("Income tax", "incomeTax")}
          ${taxRow("Social Security + Medicare", "payroll")}
          ${taxRow("Additional Medicare (0.9%)", "addlMedicare")}
          ${taxRow("NIIT (3.8%)", "niit")}
          ${taxRow("Total tax", "total", "total")}
          <tr><td>Marginal rate (income tax + NIIT)</td><td>${marginal(r.sa)}</td><td>${marginal(r.sb)}</td><td></td><td>${marginal(r.m)}</td><td></td></tr>
          <tr><td>Effective rate (total tax ÷ gross)</td><td>${effective(r.sa.total, r.a.income)}</td><td>${effective(r.sb.total, r.b.income)}</td><td>${effective(r.singleTotal, sum("income"))}</td><td>${effective(r.m.total, sum("income"))}</td><td></td></tr>
        </tbody>
      </table>`;
  }

  // ---------- Wiring ----------

  function init() {
    defaults();
    buildControls();
    document.getElementById("mode").addEventListener("change", scheduleRender);
    document.getElementById("showText").addEventListener("change", scheduleRender);
    document.getElementById("reset").addEventListener("click", () => {
      defaults();
      selected = null;
      syncControls();
      scheduleRender();
    });
    // Phones: start with the long control panels collapsed so the chart is reachable.
    if (window.innerWidth < 700) {
      document.querySelectorAll("#people details, details.notes").forEach((d) => (d.open = false));
    }
    // Re-render on width changes only; mobile browsers fire resize when the URL bar hides.
    let lastW = window.innerWidth;
    window.addEventListener("resize", () => {
      if (window.innerWidth !== lastW) {
        lastW = window.innerWidth;
        scheduleRender();
      }
    });
    render();
    if (TOUCH) {
      document.getElementById("chart").addEventListener("click", onTap);
      document.getElementById("tapcard-close").addEventListener("click", () => {
        document.getElementById("tapcard").hidden = true;
      });
    } else {
      document.getElementById("chart").on("plotly_click", (ev) => {
        const pt = ev.points[0];
        select(pt.x, pt.y);
      });
    }
  }

  init();
})();
