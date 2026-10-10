// Small control helpers: a slider paired with a number box, selects, and checkboxes.
// Each control reads and writes through get/set and re-syncs when sync() is called.
(function (root) {
  "use strict";
  const UI = (root.LoanUI = {});

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  UI.esc = esc;

  // spec = { label, unit: "$" | "%" | "", min, max, step, get(), set(v), hint?() }
  // The number box accepts values outside the slider range.
  UI.field = function (spec, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "slider field";
    const pre = spec.unit === "$" ? "$" : "";
    const post = spec.unit === "%" ? "%" : spec.unit && spec.unit !== "$" ? spec.unit : "";
    wrap.innerHTML =
      `<div class="lbl"><label>${esc(spec.label)}</label><span class="num">${pre}<input type="number" inputmode="decimal" step="any">${esc(post)}</span></div>` +
      `<input type="range">` + `<div class="hint"></div>`;
    const num = wrap.querySelector("input[type=number]");
    const range = wrap.querySelector("input[type=range]");
    num.setAttribute("aria-label", spec.label);
    range.setAttribute("aria-label", spec.label);
    range.min = spec.min;
    range.max = spec.max;
    range.step = spec.step;
    const sync = (except) => {
      const v = spec.get();
      range.value = v;
      if (except !== num) num.value = +(+v).toFixed(4);
      const h = spec.hint ? spec.hint() : "";
      const hint = wrap.querySelector(".hint");
      hint.textContent = h;
      hint.hidden = !h;
    };
    num.addEventListener("input", () => {
      const v = parseFloat(num.value);
      if (!Number.isFinite(v) || (spec.min >= 0 && v < 0)) return;
      spec.set(v);
      onChange(num);
    });
    num.addEventListener("change", () => sync());
    range.addEventListener("input", () => {
      spec.set(Number(range.value));
      onChange();
    });
    return { el: wrap, sync };
  };

  // spec = { label, options: [[value, text], ...], get(), set(v) }
  UI.select = function (spec, onChange) {
    const wrap = document.createElement("label");
    wrap.className = "row";
    wrap.innerHTML = `<span>${esc(spec.label)}</span><select>${spec.options
      .map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("")}</select>`;
    const sel = wrap.querySelector("select");
    sel.addEventListener("change", () => {
      spec.set(sel.value);
      onChange();
    });
    return { el: wrap, sync: () => (sel.value = spec.get()) };
  };

  // spec = { label, get(), set(bool) }
  UI.check = function (spec, onChange) {
    const wrap = document.createElement("label");
    wrap.className = "row check";
    wrap.innerHTML = `<input type="checkbox"> <span>${esc(spec.label)}</span>`;
    const box = wrap.querySelector("input");
    box.addEventListener("change", () => {
      spec.set(box.checked);
      onChange();
    });
    return { el: wrap, sync: () => (box.checked = !!spec.get()) };
  };

  // spec = { label, get(), set(v) } for a month ("YYYY-MM").
  UI.month = function (spec, onChange) {
    const wrap = document.createElement("label");
    wrap.className = "row";
    wrap.innerHTML = `<span>${esc(spec.label)}</span><input type="month" min="1980-01" max="2026-12">`;
    const inp = wrap.querySelector("input");
    inp.addEventListener("change", () => {
      if (!inp.value) return;
      spec.set(inp.value);
      onChange();
    });
    return { el: wrap, sync: () => (inp.value = spec.get()) };
  };

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Month index from Jan 2026 (0 = Jan 2026) to "Mon YYYY".
  UI.monthLabel = (m, startYear) => `${MONTHS[((m % 12) + 12) % 12]} ${startYear + Math.floor(m / 12)}`;

  UI.money = (v) => (v < -0.5 ? "−$" : "$") + Math.round(Math.abs(v)).toLocaleString("en-US");
  UI.kMoney = (v) => {
    const a = Math.abs(v), s = v < -0.5 ? "−" : "";
    if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(1) + "k";
    return s + "$" + Math.round(a);
  };
  UI.kSigned = (v) => (v > 0.5 ? "+" : "") + UI.kMoney(v);
  // Short signed label for small chart cells: "+45k", "−4.3k", "+640".
  UI.kCompact = (v) => {
    const a = Math.abs(v), s = v > 0.5 ? "+" : v < -0.5 ? "−" : "";
    if (a >= 1e6) return s + (a / 1e6).toFixed(1) + "M";
    if (a >= 1e4) return s + Math.round(a / 1e3) + "k";
    if (a >= 1e3) return s + (a / 1e3).toFixed(1) + "k";
    return s + Math.round(a);
  };
  UI.pct = (v, d = 2) => (v * 100).toFixed(d) + "%";
})(this);
