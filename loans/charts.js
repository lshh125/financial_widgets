// Plotly chart builders. Each takes computed results and draws into an element.
(function (root) {
  "use strict";
  const U = root.LoanUI;
  const C = (root.LoanCharts = {});
  const COLORS = { payoff: "#d95f02", invest: "#1f78b4" };
  const NAMES = { payoff: "Pay Off Debt", invest: "Invest" };
  C.COLORS = COLORS;
  C.NAMES = NAMES;

  function baseLayout(o) {
    return {
      height: o.height,
      margin: o.margin,
      dragmode: false,
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      hoverlabel: { align: "left", bgcolor: "#fff", font: { size: 12.5, color: "#1d2330" } },
      font: { size: o.narrow ? 11 : 12 },
    };
  }
  const config = (touch) => ({ displayModeBar: false, scrollZoom: false, responsive: true, staticPlot: touch });

  // Hover/tap text for one strategy at one snapshot.
  C.snapDetail = function (s, kind, view) {
    const v = view === "pre" ? s.nwPre : s.nwAfter;
    return (
      `<b style="color:${COLORS[kind]}">${NAMES[kind]}: ${U.money(v)}</b><br>` +
      `Loans ${U.kMoney(s.loanBal)} · Investments ${U.kMoney(s.invValue)}` +
      (s.property ? ` · Property ${U.kMoney(s.property)}` : "") + "<br>" +
      `Tax if sold ${U.kMoney(s.liqTax)} · Interest paid ${U.kMoney(s.cumInterest)}<br>` +
      `Interest-deduction tax savings ${U.kMoney(s.cumDedBenefit)}`
    );
  };

  C.netWorth = function (el, res, view, o) {
    const field = view === "pre" ? "nwPre" : "nwAfter";
    const traces = ["payoff", "invest"].map((kind) => {
      const snaps = res[kind].snaps;
      return {
        type: "scatter", mode: "lines+markers", name: NAMES[kind],
        x: snaps.map((s) => s.t), y: snaps.map((s) => s[field]),
        customdata: snaps.map((s) => C.snapDetail(s, kind, view)),
        line: { color: COLORS[kind], width: 3 }, marker: { size: o.narrow ? 4 : 6 },
        hovertemplate: "%{customdata}<extra></extra>",
      };
    });
    const layout = {
      ...baseLayout({ ...o, height: o.narrow ? 360 : 440, margin: o.narrow ? { l: 54, r: 10, t: 36, b: 44 } : { l: 72, r: 20, t: 36, b: 50 } }),
      hovermode: "x unified",
      legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom" },
      xaxis: { title: { text: "Years from January 2026" }, fixedrange: true, dtick: o.years > 20 ? 5 : o.years > 10 ? 2 : 1, hoverformat: ".0f" },
      yaxis: {
        title: { text: view === "pre" ? "Net worth (before selling)" : "Net worth (after tax if sold)" },
        tickprefix: "$", tickformat: "~s", fixedrange: true,
      },
    };
    Plotly.react(el, traces, layout, config(o.touch));
  };

  C.waterfall = function (el, att, o) {
    const parts = att.parts.filter((p) => Math.abs(p.value) >= 0.5);
    // Narrow screens: values go in the axis labels, since text beside short bars collides with them.
    const labels = parts.map((p) => (o.narrow ? `${p.label}<br><b>${U.kSigned(p.value)}</b>` : p.label));
    const trace = {
      type: "waterfall", orientation: "h",
      measure: [...parts.map(() => "relative"), "total"],
      y: [...labels, o.narrow ? `<b>Invest − Pay Off<br>${U.kSigned(att.total)}</b>` : "<b>Invest − Pay Off</b>"],
      x: [...parts.map((p) => p.value), att.total],
      text: [...parts.map((p) => U.kSigned(p.value)), U.kSigned(att.total)],
      textposition: o.narrow ? "none" : "outside", cliponaxis: false,
      increasing: { marker: { color: "#67a9cf" } },
      decreasing: { marker: { color: "#ef8a62" } },
      totals: { marker: { color: att.total >= 0 ? COLORS.invest : COLORS.payoff } },
      connector: { line: { color: "#c3c9d4" } },
      hovertemplate: "%{y}: %{text}<extra></extra>",
    };
    const h = Math.max(260, 46 * (parts.length + 1) + 60);
    const layout = {
      ...baseLayout({ ...o, height: h, margin: o.narrow ? { l: 8, r: 40, t: 10, b: 36 } : { l: 8, r: 70, t: 10, b: 40 } }),
      yaxis: { autorange: "reversed", automargin: true, fixedrange: true },
      xaxis: { tickprefix: "$", tickformat: "~s", fixedrange: true, zeroline: true, title: { text: "Positive favors Invest; negative favors Pay Off" } },
      showlegend: false,
    };
    Plotly.react(el, [trace], layout, config(o.touch));
  };

  // White at zero, red below, blue above; each side saturates at its own extreme.
  function divergingScale(zmin, zmax) {
    const neg = ["#b2182b", "#ef8a62"], pos = ["#67a9cf", "#2166ac"];
    if (zmin >= 0) return [[0, "#ffffff"], [0.5, pos[0]], [1, pos[1]]];
    if (zmax <= 0) return [[0, neg[0]], [0.5, neg[1]], [1, "#ffffff"]];
    const p = -zmin / (zmax - zmin);
    return [[0, neg[0]], [p / 2, neg[1]], [p, "#ffffff"], [p + (1 - p) / 2, pos[0]], [1, pos[1]]];
  }

  // d = { rates, returns (fractions), z, current: { rate, ret }, loanName }
  C.heatmap = function (el, d, o) {
    let zmin = 0, zmax = 0;
    d.z.forEach((row) => row.forEach((v) => { zmin = Math.min(zmin, v); zmax = Math.max(zmax, v); }));
    if (zmin === 0 && zmax === 0) { zmin = -1; zmax = 1; }
    const nx = d.rates.length, ny = d.returns.length;
    const width = el.parentElement.clientWidth || 600;
    const cellW = (width - (o.narrow ? 70 : 150)) / nx;
    const showText = cellW >= 30 && ny <= 30;
    const xs = d.rates.map((r) => +(r * 100).toFixed(3));
    const ys = d.returns.map((r) => +(r * 100).toFixed(3));
    const traces = [{
      type: "heatmap", x: xs, y: ys, z: d.z,
      text: d.z.map((row) => row.map((v) => U.kCompact(v))),
      customdata: d.z.map((row) => row.map((v) => U.kSigned(v))),
      texttemplate: showText ? "%{text}" : "", textfont: { size: o.narrow ? 9 : 10 },
      colorscale: divergingScale(zmin, zmax), zmin, zmax, xgap: 1, ygap: 1,
      hovertemplate: `${U.esc(d.loanName)} rate %{x}%<br>Return %{y}%<br>Invest − Pay Off: <b>%{customdata}</b><extra></extra>`,
      colorbar: o.narrow
        ? { orientation: "h", thickness: 10, x: 0.5, xanchor: "center", y: -0.3, yanchor: "top", tickprefix: "$", tickformat: "~s" }
        : { title: { text: "Invest − Pay Off", side: "right" }, tickprefix: "$", tickformat: "~s" },
    }];
    if (d.current) {
      traces.push({
        type: "scatter", mode: "markers", x: [d.current.rate * 100], y: [d.current.ret * 100],
        marker: { symbol: "circle-open", size: 14, color: "#1d2330", line: { width: 2.5 } },
        hoverinfo: "skip", showlegend: false,
      });
    }
    const layout = {
      ...baseLayout({ ...o, height: o.narrow ? 420 : 480, margin: o.narrow ? { l: 52, r: 10, t: 10, b: 110 } : { l: 70, r: 20, t: 10, b: 56 } }),
      xaxis: { title: { text: `${d.loanName}: interest rate (%)` }, ticksuffix: "%", fixedrange: true },
      yaxis: { title: { text: "Expected total return (%)" }, ticksuffix: "%", fixedrange: true },
      showlegend: false,
    };
    Plotly.react(el, traces, layout, config(o.touch));
  };

  // mc from LoanSim.monteCarlo: diff[t] = [p5, p25, p50, p75, p95].
  C.fan = function (el, mc, o) {
    const t = mc.diff.map((_, i) => i);
    const col = (j) => mc.diff.map((row) => row[j]);
    const band = "rgba(31,120,180,", line = { width: 0 };
    const traces = [
      { x: t, y: col(4), mode: "lines", line, hoverinfo: "skip", showlegend: false },
      { x: t, y: col(0), mode: "lines", line, fill: "tonexty", fillcolor: band + "0.15)", name: "5th–95th percentile", hoverinfo: "skip" },
      { x: t, y: col(3), mode: "lines", line, hoverinfo: "skip", showlegend: false },
      { x: t, y: col(1), mode: "lines", line, fill: "tonexty", fillcolor: band + "0.32)", name: "25th–75th percentile", hoverinfo: "skip" },
      {
        x: t, y: col(2), mode: "lines", name: "Median", line: { color: COLORS.invest, width: 3 },
        customdata: mc.diff.map((r) => r.map(U.kSigned)),
        hovertemplate: "Year %{x}<br>95th: %{customdata[4]}<br>75th: %{customdata[3]}<br><b>Median: %{customdata[2]}</b><br>25th: %{customdata[1]}<br>5th: %{customdata[0]}<extra></extra>",
      },
    ].map((tr) => ({ type: "scatter", ...tr }));
    const layout = {
      ...baseLayout({ ...o, height: o.narrow ? 340 : 400, margin: o.narrow ? { l: 54, r: 10, t: 36, b: 44 } : { l: 72, r: 20, t: 36, b: 50 } }),
      hovermode: "x",
      legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom" },
      shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: "#1d2330", width: 1, dash: "dot" } }],
      xaxis: { title: { text: "Years from January 2026" }, fixedrange: true },
      yaxis: { title: { text: "Invest − Pay Off (after tax if sold)" }, tickprefix: "$", tickformat: "~s", fixedrange: true },
    };
    Plotly.react(el, traces, layout, config(o.touch));
  };
})(this);
