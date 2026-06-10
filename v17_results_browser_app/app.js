const DATA = window.V17_RESULTS;

const COLORS = {
  model: "#2563eb",
  persistence: "#64748b",
  previous: "#f97316",
  lift: "#059669",
  green: "#059669",
  orange: "#f97316",
  hit: "#059669",
  miss: "#dc2626",
  falseAlarm: "#f97316",
  correct: "#94a3b8",
  grid: "#d8e0ea",
  text: "#111827",
  muted: "#64748b",
  red: "#dc2626",
  cyan: "#0891b2",
  purple: "#7c3aed",
};

const CATEGORY_COLORS = {
  state2_history: "#2563eb",
  day_ahead_prices: "#f97316",
  generation_load_capacity: "#059669",
  renewable_weather_proxy: "#14b8a6",
  calendar: "#7c3aed",
  net_balance_trend: "#64748b",
  up_activation_history: "#dc2626",
  down_activation_history: "#9333ea",
  activation_interactions: "#0f766e",
  direct_weather: "#0891b2",
  ned_1h_forecasts: "#be123c",
  other: "#475569",
};

const state = {
  horizon: 1,
  month: DATA.folds[0]?.month || "2025-01",
  snapshotStart: null,
  snapshotEnd: null,
  rangePickStart: null,
  calendarMonth: DATA.folds[0]?.month || "2025-01",
  featureCount: 20,
  featureCategory: "all",
  forecastOnly: false,
};

const STEP_MINUTES = 15;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const tooltip = document.createElement("div");
tooltip.className = "tooltip";
document.body.appendChild(tooltip);

function pct(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function num(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return Number(value).toFixed(digits);
}

function compact(value) {
  return Number(value).toLocaleString("en-US");
}

function cleanLabel(value) {
  return String(value).replaceAll("_", " ");
}

function featureLabel(value) {
  return String(value)
    .replaceAll("state2_label", "State 2")
    .replaceAll("long_roll_mean", "long roll mean")
    .replaceAll("long_roll_std", "long roll std")
    .replaceAll("roll_mean", "roll mean")
    .replaceAll("roll_std", "roll std")
    .replaceAll("capacity_", "")
    .replaceAll("NetherlandsCurrent", "")
    .replaceAll("_isp", "")
    .replaceAll("ewm", "EWM")
    .replaceAll("_", " ");
}

function svgEl(name, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

function clear(node) {
  node.innerHTML = "";
}

function dimensions(node, fallbackHeight = 320) {
  return {
    width: Math.max(360, node.clientWidth || 720),
    height: Math.max(fallbackHeight, node.clientHeight || fallbackHeight),
  };
}

function scaleLinear(domain, range) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

function linePath(points, x, y) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.x).toFixed(2)},${y(point.y).toFixed(2)}`)
    .join(" ");
}

function showTip(event, html) {
  tooltip.innerHTML = html;
  tooltip.style.left = `${event.clientX}px`;
  tooltip.style.top = `${event.clientY}px`;
  tooltip.style.opacity = "1";
}

function hideTip() {
  tooltip.style.opacity = "0";
}

function addGrid(svg, x0, y0, width, height, yTicks, yScale) {
  yTicks.forEach((tick) => {
    const y = yScale(tick);
    svg.appendChild(svgEl("line", { x1: x0, x2: x0 + width, y1: y, y2: y, class: "grid-line" }));
    const label = svgEl("text", { x: x0 - 8, y: y + 4, "text-anchor": "end", class: "svg-label" });
    label.textContent = pct(tick, 0);
    svg.appendChild(label);
  });
}

function metricCard(label, value, note, cls = "") {
  return `<div class="metric-card ${cls}">
    <div class="metric-label">${label}</div>
    <div class="metric-value">${value}</div>
    <div class="metric-note">${note}</div>
  </div>`;
}

function stripItem(label, value, note) {
  return `<div class="strip-item">
    <div class="strip-label">${label}</div>
    <div class="strip-value">${value}</div>
    <div class="strip-note">${note}</div>
  </div>`;
}

function seriesForHorizon(horizon = state.horizon) {
  return DATA.predictionSeries[String(horizon)] || [];
}

function toInputValue(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addMinutes(value, minutes) {
  return toInputValue(new Date(new Date(value).getTime() + minutes * 60 * 1000));
}

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function monthOnly(value) {
  return String(value || "").slice(0, 7);
}

function endOfDate(dateStr) {
  return `${dateStr}T23:45`;
}

function startOfDate(dateStr) {
  return `${dateStr}T00:00`;
}

function shiftCalendarMonth(delta) {
  const [year, month] = state.calendarMonth.split("-").map(Number);
  state.calendarMonth = toInputValue(new Date(year, month - 1 + delta, 1, 0, 0)).slice(0, 7);
  renderDateRangePicker();
}

function clampSnapshotRange() {
  const series = seriesForHorizon();
  if (!series.length) return;
  const minT = series[0].t;
  const maxT = series[series.length - 1].t;
  if (!state.snapshotStart || state.snapshotStart < minT || state.snapshotStart > maxT) state.snapshotStart = minT;
  if (!state.snapshotEnd || state.snapshotEnd < minT || state.snapshotEnd > maxT) {
    state.snapshotEnd = addMinutes(state.snapshotStart, 48 * 60 - STEP_MINUTES);
  }
  if (state.snapshotEnd > maxT) state.snapshotEnd = maxT;
  if (state.snapshotStart > state.snapshotEnd) state.snapshotStart = state.snapshotEnd;
}

function syncSnapshotInputs() {
  document.getElementById("snapshotStart").value = state.snapshotStart || "";
  document.getElementById("snapshotEnd").value = state.snapshotEnd || "";
}

function setSnapshotRange(start, end) {
  state.snapshotStart = start;
  state.snapshotEnd = end;
  clampSnapshotRange();
  state.calendarMonth = monthOnly(state.snapshotStart);
  syncSnapshotInputs();
  renderSummary();
  renderDateRangePicker();
  renderSnapshot();
}

function setMonthRange(month = state.month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = toInputValue(new Date(year, monthNumber - 1, 1, 0, 0));
  const end = toInputValue(new Date(year, monthNumber, 0, 23, 45));
  setSnapshotRange(start, end);
}

function setEventfulRange(month = state.month, horizon = state.horizon) {
  const snapshot = DATA.snapshots.find((item) => item.h === horizon && item.month === month);
  if (snapshot) {
    setSnapshotRange(snapshot.start.replace(" ", "T"), snapshot.end.replace(" ", "T"));
  } else {
    setMonthRange(month);
  }
}

function selectCalendarDate(dateStr) {
  if (!state.rangePickStart) {
    state.rangePickStart = dateStr;
    setSnapshotRange(startOfDate(dateStr), endOfDate(dateStr));
    return;
  }
  const start = state.rangePickStart <= dateStr ? state.rangePickStart : dateStr;
  const end = state.rangePickStart <= dateStr ? dateStr : state.rangePickStart;
  state.rangePickStart = null;
  setSnapshotRange(startOfDate(start), endOfDate(end));
}

function selectedSnapshotPoints() {
  clampSnapshotRange();
  return seriesForHorizon().filter((point) => point.t >= state.snapshotStart && point.t <= state.snapshotEnd);
}

function binaryStats(points) {
  if (!points.length) {
    return {
      n: 0,
      event_rate: 0,
      model_f1: 0,
      persistence_f1: 0,
      previous_day_f1: 0,
      avg_probability: 0,
      threshold: 0,
      tp: 0,
      fp: 0,
      fn: 0,
      tn: 0,
    };
  }
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  points.forEach((point) => {
    if (point.y === 1 && point.pred === 1) tp += 1;
    if (point.y === 0 && point.pred === 1) fp += 1;
    if (point.y === 1 && point.pred === 0) fn += 1;
    if (point.y === 0 && point.pred === 0) tn += 1;
  });
  const statsFor = (key) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    points.forEach((point) => {
      const pred = Number(point[key]);
      if (point.y === 1 && pred === 1) tp += 1;
      if (point.y === 0 && pred === 1) fp += 1;
      if (point.y === 1 && pred === 0) fn += 1;
    });
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  };
  return {
    n: points.length,
    event_rate: points.reduce((s, point) => s + point.y, 0) / points.length,
    model_f1: statsFor("pred"),
    persistence_f1: statsFor("persist"),
    previous_day_f1: statsFor("prevday"),
    avg_probability: points.reduce((s, point) => s + point.p, 0) / points.length,
    threshold: points.reduce((s, point) => s + point.threshold, 0) / points.length,
    tp,
    fp,
    fn,
    tn,
  };
}

function outcomeFor(point) {
  if (point.y === 1 && point.pred === 1) return "hit";
  if (point.y === 1 && point.pred === 0) return "miss";
  if (point.y === 0 && point.pred === 1) return "falseAlarm";
  return "correct";
}

function outcomeLabel(outcome) {
  return {
    hit: "Correct State 2 prediction",
    miss: "Missed State 2",
    falseAlarm: "False alarm",
    correct: "Correct non-State 2",
  }[outcome] || outcome;
}

function initControls() {
  const horizonSelect = document.getElementById("horizonSelect");
  const monthSelect = document.getElementById("monthSelect");
  const startInput = document.getElementById("snapshotStart");
  const endInput = document.getElementById("snapshotEnd");
  const featureCountSelect = document.getElementById("featureCountSelect");
  const featureCategorySelect = document.getElementById("featureCategorySelect");
  const forecastOnlyToggle = document.getElementById("forecastOnlyToggle");
  const horizons = DATA.overall.map((row) => row.h);
  const months = [...new Set(DATA.folds.map((row) => row.month))];
  const featureRows = DATA.featureImportance || DATA.topFeatures;
  const categories = [...new Set(featureRows.map((row) => row.category))].sort();

  horizonSelect.innerHTML = horizons
    .map((h) => `<option value="${h}">${h * 15} min ahead</option>`)
    .join("");
  monthSelect.innerHTML = months
    .map((month) => `<option value="${month}">${month}</option>`)
    .join("");
  featureCategorySelect.innerHTML = [
    `<option value="all">All categories</option>`,
    ...categories.map((category) => `<option value="${category}">${cleanLabel(category)}</option>`),
  ].join("");

  horizonSelect.value = state.horizon;
  monthSelect.value = state.month;
  featureCountSelect.value = String(state.featureCount);
  featureCategorySelect.value = state.featureCategory;
  forecastOnlyToggle.checked = state.forecastOnly;
  horizonSelect.addEventListener("change", () => {
    state.horizon = Number(horizonSelect.value);
    clampSnapshotRange();
    syncSnapshotInputs();
    renderSelected();
  });
  monthSelect.addEventListener("change", () => {
    state.month = monthSelect.value;
    setMonthRange(state.month);
  });
  startInput.addEventListener("change", () => setSnapshotRange(startInput.value, state.snapshotEnd));
  endInput.addEventListener("change", () => setSnapshotRange(state.snapshotStart, endInput.value));
  document.getElementById("calendarPrev").addEventListener("click", () => shiftCalendarMonth(-1));
  document.getElementById("calendarNext").addEventListener("click", () => shiftCalendarMonth(1));
  document.querySelectorAll("[data-range-hours]").forEach((button) => {
    button.addEventListener("click", () => {
      const hours = Number(button.dataset.rangeHours);
      setSnapshotRange(state.snapshotStart, addMinutes(state.snapshotStart, hours * 60 - STEP_MINUTES));
    });
  });
  document.querySelectorAll("[data-range-days]").forEach((button) => {
    button.addEventListener("click", () => {
      const days = Number(button.dataset.rangeDays);
      setSnapshotRange(state.snapshotStart, addMinutes(state.snapshotStart, days * 24 * 60 - STEP_MINUTES));
    });
  });
  document.getElementById("monthRangeButton").addEventListener("click", () => setMonthRange(state.month));
  document.getElementById("eventfulRangeButton").addEventListener("click", () => setEventfulRange(state.month, state.horizon));
  featureCountSelect.addEventListener("change", () => {
    state.featureCount = Number(featureCountSelect.value);
    renderFeatureBars();
  });
  featureCategorySelect.addEventListener("change", () => {
    state.featureCategory = featureCategorySelect.value;
    renderFeatureBars();
  });
  forecastOnlyToggle.addEventListener("change", () => {
    state.forecastOnly = forecastOnlyToggle.checked;
    renderFeatureBars();
  });
  setEventfulRange(state.month, state.horizon);
}

function renderDateRangePicker() {
  const grid = document.getElementById("dateGrid");
  const label = document.getElementById("calendarMonthLabel");
  const hint = document.getElementById("rangePickHint");
  if (!grid || !label || !hint) return;

  const series = seriesForHorizon();
  const minDate = dateOnly(series[0]?.t);
  const maxDate = dateOnly(series[series.length - 1]?.t);
  const [year, month] = state.calendarMonth.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const startDow = (firstDay.getDay() + 6) % 7;
  const selectedStart = dateOnly(state.snapshotStart);
  const selectedEnd = dateOnly(state.snapshotEnd);
  const monthName = firstDay.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  label.textContent = monthName;
  hint.textContent = state.rangePickStart
    ? `Start selected: ${state.rangePickStart}. Click an end date.`
    : "Click a start date, then an end date.";

  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  grid.innerHTML = "";
  dayNames.forEach((day) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "date-cell header";
    cell.textContent = day;
    cell.disabled = true;
    grid.appendChild(cell);
  });
  for (let i = 0; i < startDow; i += 1) {
    const blank = document.createElement("button");
    blank.type = "button";
    blank.className = "date-cell blank";
    blank.disabled = true;
    grid.appendChild(blank);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = `${state.calendarMonth}-${String(day).padStart(2, "0")}`;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "date-cell";
    cell.textContent = String(day);
    cell.disabled = dateStr < minDate || dateStr > maxDate;
    const inRange = dateStr >= selectedStart && dateStr <= selectedEnd;
    if (inRange) cell.classList.add("in-range");
    if (dateStr === selectedStart || dateStr === selectedEnd) cell.classList.add("range-edge");
    if (dateStr === state.rangePickStart) cell.classList.add("pending");
    cell.addEventListener("click", () => selectCalendarDate(dateStr));
    grid.appendChild(cell);
  }
}

function renderSummary() {
  const selected = DATA.overall.find((row) => row.h === state.horizon);
  const fold = DATA.folds.find((row) => row.h === state.horizon && row.month === state.month);
  const points = selectedSnapshotPoints();
  const stats = binaryStats(points);
  document.getElementById("summaryStrip").innerHTML = [
    stripItem("Selected F1", pct(selected.model_f1), `${selected.minutes} minutes ahead`),
    stripItem("Best baseline", pct(selected.best_baseline_f1), "full 2025 audit"),
    stripItem("F1 lift", `+${pct(selected.f1_lift_vs_best_baseline)}`, "over stronger baseline"),
    stripItem("Window F1", pct(stats.model_f1), `${compact(stats.n)} selected ISPs`),
  ].join("");
}

function renderHeadline() {
  const avgModel = DATA.overall.reduce((s, row) => s + row.model_f1, 0) / DATA.overall.length;
  const avgBaseline = DATA.overall.reduce((s, row) => s + row.best_baseline_f1, 0) / DATA.overall.length;
  const avgLift = DATA.overall.reduce((s, row) => s + row.f1_lift_vs_best_baseline, 0) / DATA.overall.length;
  const avgApLift = DATA.overall.reduce((s, row) => s + row.ap_lift_vs_best_baseline, 0) / DATA.overall.length;
  const wins = DATA.overall.filter((row) => row.f1_lift_vs_best_baseline > 0).length;
  const best = DATA.overall.reduce((a, b) => (b.f1_lift_vs_best_baseline > a.f1_lift_vs_best_baseline ? b : a));
  document.getElementById("headlineMetrics").innerHTML = [
    metricCard("Average F1", pct(avgModel), `vs ${pct(avgBaseline)} best baseline`, "primary"),
    metricCard("Average F1 lift", `+${pct(avgLift)}`, `${wins} of 8 horizons won`, "success"),
    metricCard("Average AP lift", `+${pct(avgApLift)}`, "ranking quality above baselines", "success"),
    metricCard("Strongest horizon", `${best.minutes} min`, `+${pct(best.f1_lift_vs_best_baseline)} F1 lift`, "warn"),
  ].join("");
}

function renderF1Chart() {
  const node = document.getElementById("f1Chart");
  clear(node);
  const { width, height } = dimensions(node, 380);
  const margin = { top: 24, right: 24, bottom: 46, left: 54 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", height: "100%" });
  const x = scaleLinear([15, 120], [margin.left, margin.left + innerW]);
  const maxY = Math.max(...DATA.overall.flatMap((d) => [d.model_f1, d.persistence_f1, d.previous_day_f1])) + 0.04;
  const y = scaleLinear([0.18, Math.max(0.54, maxY)], [margin.top + innerH, margin.top]);

  addGrid(svg, margin.left, margin.top, innerW, innerH, [0.2, 0.3, 0.4, 0.5], y);

  const series = [
    ["model_f1", "v17 model", COLORS.model, 3.4, ""],
    ["persistence_f1", "Persistence", COLORS.persistence, 2.2, "6 5"],
    ["previous_day_f1", "Previous day", COLORS.previous, 2.2, "2 6"],
  ];
  series.forEach(([key, label, color, strokeWidth, dash], seriesIndex) => {
    const points = DATA.overall.map((row) => ({ x: row.minutes, y: row[key], row }));
    svg.appendChild(svgEl("path", {
      d: linePath(points, x, y),
      fill: "none",
      stroke: color,
      "stroke-width": strokeWidth,
      "stroke-dasharray": dash,
      "stroke-linecap": "round",
    }));
    points.forEach((point) => {
      const circle = svgEl("circle", { cx: x(point.x), cy: y(point.y), r: key === "model_f1" ? 5 : 4, fill: color });
      circle.addEventListener("mousemove", (event) => showTip(event, `<b>${label}</b><br>${point.x} min: ${pct(point.y)} F1`));
      circle.addEventListener("mouseleave", hideTip);
      svg.appendChild(circle);
    });
    const legend = svgEl("text", { x: margin.left + seriesIndex * 130, y: 18, class: "legend" });
    legend.textContent = label;
    svg.appendChild(svgEl("line", {
      x1: margin.left + seriesIndex * 130 - 28,
      x2: margin.left + seriesIndex * 130 - 8,
      y1: 14,
      y2: 14,
      stroke: color,
      "stroke-width": 3,
      "stroke-dasharray": dash,
    }));
    svg.appendChild(legend);
  });

  DATA.overall.forEach((row) => {
    const liftHeight = Math.abs(y(row.model_f1) - y(row.best_baseline_f1));
    const rect = svgEl("rect", {
      x: x(row.minutes) - 10,
      y: Math.min(y(row.model_f1), y(row.best_baseline_f1)),
      width: 20,
      height: Math.max(1, liftHeight),
      fill: COLORS.model,
      opacity: "0.12",
    });
    svg.insertBefore(rect, svg.firstChild);
  });

  for (let minutes = 15; minutes <= 120; minutes += 15) {
    const label = svgEl("text", { x: x(minutes), y: height - 16, "text-anchor": "middle", class: "svg-label" });
    label.textContent = minutes;
    svg.appendChild(label);
  }
  const yLabel = svgEl("text", { x: 16, y: margin.top + innerH / 2, transform: `rotate(-90 16 ${margin.top + innerH / 2})`, "text-anchor": "middle", class: "svg-label" });
  yLabel.textContent = "F1 score";
  svg.appendChild(yLabel);
  node.appendChild(svg);
}

function renderHeatmap() {
  const node = document.getElementById("heatmap");
  clear(node);
  const months = [...new Set(DATA.folds.map((row) => row.month))];
  const horizons = DATA.overall.map((row) => row.h);
  const { width, height } = dimensions(node, 360);
  const margin = { top: 28, right: 22, bottom: 42, left: 70 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const cellW = innerW / horizons.length;
  const cellH = innerH / months.length;
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", height: "100%" });
  const maxLift = Math.max(...DATA.folds.map((row) => row.f1_lift_vs_best_baseline));
  const minLift = Math.min(...DATA.folds.map((row) => row.f1_lift_vs_best_baseline));
  const color = (value) => {
    const t = (value - minLift) / ((maxLift - minLift) || 1);
    const start = [239, 246, 255];
    const end = [37, 99, 235];
    const rgb = start.map((s, i) => Math.round(s + (end[i] - s) * t));
    return `rgb(${rgb.join(",")})`;
  };

  months.forEach((month, rowIndex) => {
    const label = svgEl("text", { x: margin.left - 10, y: margin.top + rowIndex * cellH + cellH / 2 + 4, "text-anchor": "end", class: "svg-label" });
    label.textContent = month.slice(5);
    svg.appendChild(label);
  });
  horizons.forEach((h, colIndex) => {
    const label = svgEl("text", { x: margin.left + colIndex * cellW + cellW / 2, y: height - 16, "text-anchor": "middle", class: "svg-label" });
    label.textContent = `${h * 15}`;
    svg.appendChild(label);
  });

  DATA.folds.forEach((row) => {
    const r = months.indexOf(row.month);
    const c = horizons.indexOf(row.h);
    const rect = svgEl("rect", {
      x: margin.left + c * cellW + 2,
      y: margin.top + r * cellH + 2,
      width: Math.max(1, cellW - 4),
      height: Math.max(1, cellH - 4),
      rx: 4,
      fill: color(row.f1_lift_vs_best_baseline),
      cursor: "pointer",
    });
    rect.addEventListener("mousemove", (event) => showTip(event, `<b>${row.month}, ${row.minutes} min</b><br>F1 lift: +${pct(row.f1_lift_vs_best_baseline)}<br>Model F1: ${pct(row.model_f1)}`));
    rect.addEventListener("mouseleave", hideTip);
    rect.addEventListener("click", () => {
      state.horizon = row.h;
      state.month = row.month;
      document.getElementById("horizonSelect").value = state.horizon;
      document.getElementById("monthSelect").value = state.month;
      setMonthRange(state.month);
    });
    svg.appendChild(rect);
  });

  const title = svgEl("text", { x: margin.left, y: 16, class: "svg-label" });
  title.textContent = "Columns are minutes ahead; rows are months";
  svg.appendChild(title);
  node.appendChild(svg);
}

function renderConfusion() {
  const row = DATA.confusion.find((item) => item.h === state.horizon && item.model === "model");
  document.getElementById("confusionPanel").innerHTML = `
    <div class="confusion-grid">
      <div class="conf-cell good"><strong>${compact(row.tp)}</strong><span>true positives</span></div>
      <div class="conf-cell bad"><strong>${compact(row.fp)}</strong><span>false positives</span></div>
      <div class="conf-cell bad"><strong>${compact(row.fn)}</strong><span>false negatives</span></div>
      <div class="conf-cell good"><strong>${compact(row.tn)}</strong><span>true negatives</span></div>
    </div>
    ${metricCard("Precision", pct(row.precision), "selected horizon", "primary")}
    ${metricCard("Recall", pct(row.recall), "selected horizon", "success")}
  `;
}

function renderSnapshot() {
  const node = document.getElementById("snapshotChart");
  clear(node);
  const points = selectedSnapshotPoints();
  const stats = binaryStats(points);
  const startLabel = state.snapshotStart ? state.snapshotStart.replace("T", " ") : "";
  const endLabel = state.snapshotEnd ? state.snapshotEnd.replace("T", " ") : "";
  document.getElementById("snapshotTitle").textContent = `${startLabel} to ${endLabel}`;
  document.getElementById("snapshotStats").innerHTML = [
    ["F1", pct(stats.model_f1)],
    ["Events", pct(stats.event_rate)],
    ["Hits", compact(stats.tp)],
    ["Misses", compact(stats.fn)],
    ["False +", compact(stats.fp)],
    ["N", compact(stats.n)],
  ].map(([label, value]) => `<div class="mini-stat"><b>${value}</b><span>${label}</span></div>`).join("");

  const { width, height } = dimensions(node, 380);
  const margin = { top: 20, right: 22, bottom: 42, left: 52 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", height: "100%" });
  const x = scaleLinear([0, points.length - 1], [margin.left, margin.left + innerW]);
  const y = scaleLinear([0, 1], [margin.top + innerH, margin.top]);

  if (!points.length) {
    const empty = svgEl("text", { x: width / 2, y: height / 2, "text-anchor": "middle", class: "svg-label" });
    empty.textContent = "No predictions in the selected period";
    svg.appendChild(empty);
    node.appendChild(svg);
    return;
  }

  addGrid(svg, margin.left, margin.top, innerW, innerH, [0, 0.25, 0.5, 0.75, 1], y);
  const thresholdY = y(stats.threshold);
  svg.appendChild(svgEl("line", {
    x1: margin.left,
    x2: margin.left + innerW,
    y1: thresholdY,
    y2: thresholdY,
    stroke: COLORS.red,
    "stroke-width": 1.4,
    "stroke-dasharray": "5 5",
  }));

  const barStep = Math.max(1, Math.ceil(points.length / 4000));
  points.forEach((point, index) => {
    if (index % barStep !== 0 && points.length > 4000) return;
    const xPos = x(index);
    const barWidth = Math.max(1, innerW / points.length);
    const outcome = outcomeFor(point);
    if (point.y || point.pred) {
      svg.appendChild(svgEl("rect", {
        x: xPos - barWidth / 2,
        y: margin.top,
        width: barWidth,
        height: innerH,
        fill: COLORS[outcome],
        opacity: outcome === "hit" ? "0.14" : "0.18",
      }));
    }
    if (outcome !== "correct" || index % Math.max(barStep, 8) === 0) {
      svg.appendChild(svgEl("rect", {
        x: xPos - barWidth / 2,
        y: y(outcome === "correct" ? 0.045 : 0.16),
        width: barWidth,
        height: outcome === "correct" ? 3 : y(0) - y(0.16),
        fill: COLORS[outcome],
        opacity: outcome === "correct" ? "0.35" : "0.95",
      }));
    }
  });

  const lineStep = Math.max(1, Math.ceil(points.length / 1200));
  const linePoints = points
    .map((point, index) => ({ x: index, y: point.p }))
    .filter((_, index) => index % lineStep === 0);
  if (linePoints[linePoints.length - 1]?.x !== points.length - 1) {
    linePoints.push({ x: points.length - 1, y: points[points.length - 1].p });
  }
  svg.appendChild(svgEl("path", {
    d: linePath(linePoints, x, y),
    fill: "none",
    stroke: COLORS.model,
    "stroke-width": 2.4,
    "stroke-linecap": "round",
  }));

  const hoverStep = Math.max(1, Math.ceil(points.length / 220));
  points.forEach((point, index) => {
    if (index % hoverStep !== 0 && index !== points.length - 1) return;
    const outcome = outcomeFor(point);
    const circle = svgEl("circle", { cx: x(index), cy: y(point.p), r: 3, fill: COLORS[outcome], opacity: "0.9" });
    circle.addEventListener("mousemove", (event) => showTip(event, `<b>${point.t.replace("T", " ")}</b><br>${outcomeLabel(outcome)}<br>P(State 2): ${pct(point.p)}<br>Actual: ${point.y}<br>Prediction: ${point.pred}<br>Persistence: ${point.persist}<br>Previous day: ${point.prevday}`));
    circle.addEventListener("mouseleave", hideTip);
    svg.appendChild(circle);
  });

  const first = svgEl("text", { x: margin.left, y: height - 16, class: "svg-label" });
  first.textContent = points[0]?.label || "";
  svg.appendChild(first);
  const last = svgEl("text", { x: margin.left + innerW, y: height - 16, "text-anchor": "end", class: "svg-label" });
  last.textContent = points[points.length - 1]?.label || "";
  svg.appendChild(last);

  const legendItems = [
    ["Probability", COLORS.model],
    ["Hit", COLORS.hit],
    ["Miss", COLORS.miss],
    ["False alarm", COLORS.falseAlarm],
    ["Threshold", COLORS.red],
  ];
  legendItems.forEach(([label, color], index) => {
    svg.appendChild(svgEl("line", { x1: margin.left + index * 96, x2: margin.left + index * 96 + 18, y1: 14, y2: 14, stroke: color, "stroke-width": 4 }));
    const text = svgEl("text", { x: margin.left + index * 96 + 24, y: 18, class: "legend" });
    text.textContent = label;
    svg.appendChild(text);
  });

  let dragStart = null;
  let brushRect = null;
  const overlay = svgEl("rect", {
    x: margin.left,
    y: margin.top,
    width: innerW,
    height: innerH,
    fill: "transparent",
    cursor: "crosshair",
  });
  const toIndex = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const localX = ((clientX - rect.left) / rect.width) * width;
    const clamped = Math.max(margin.left, Math.min(margin.left + innerW, localX));
    return Math.round(((clamped - margin.left) / innerW) * (points.length - 1));
  };
  overlay.addEventListener("mousedown", (event) => {
    dragStart = toIndex(event.clientX);
    brushRect = svgEl("rect", {
      x: x(dragStart),
      y: margin.top,
      width: 1,
      height: innerH,
      fill: COLORS.model,
      opacity: "0.13",
      "pointer-events": "none",
    });
    svg.insertBefore(brushRect, overlay);
  });
  overlay.addEventListener("mousemove", (event) => {
    const current = toIndex(event.clientX);
    if (dragStart === null || !brushRect) {
      const point = points[current];
      if (point) {
        const outcome = outcomeFor(point);
        showTip(event, `<b>${point.t.replace("T", " ")}</b><br>${outcomeLabel(outcome)}<br>P(State 2): ${pct(point.p)}<br>Actual: ${point.y}<br>Prediction: ${point.pred}<br>Persistence: ${point.persist}<br>Previous day: ${point.prevday}<br><span style="color:#cbd5e1">Drag to zoom this chart</span>`);
      }
      return;
    }
    const x0 = x(Math.min(dragStart, current));
    const x1 = x(Math.max(dragStart, current));
    brushRect.setAttribute("x", x0);
    brushRect.setAttribute("width", Math.max(1, x1 - x0));
  });
  overlay.addEventListener("mouseup", (event) => {
    if (dragStart === null) return;
    const dragEnd = toIndex(event.clientX);
    const lo = Math.min(dragStart, dragEnd);
    const hi = Math.max(dragStart, dragEnd);
    dragStart = null;
    if (brushRect) brushRect.remove();
    brushRect = null;
    if (hi - lo >= 3) {
      setSnapshotRange(points[lo].t, points[hi].t);
    }
  });
  overlay.addEventListener("mouseleave", () => {
    dragStart = null;
    if (brushRect) brushRect.remove();
    brushRect = null;
    hideTip();
  });
  overlay.addEventListener("dblclick", () => setMonthRange(state.month));
  svg.appendChild(overlay);

  node.appendChild(svg);
}

function renderThreshold() {
  const node = document.getElementById("thresholdChart");
  clear(node);
  const rows = DATA.prCurves.filter((row) => row.h === state.horizon);
  const { width, height } = dimensions(node, 300);
  const margin = { top: 20, right: 22, bottom: 42, left: 48 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", height: "100%" });
  const x = scaleLinear([0.05, 0.95], [margin.left, margin.left + innerW]);
  const y = scaleLinear([0, 1], [margin.top + innerH, margin.top]);
  addGrid(svg, margin.left, margin.top, innerW, innerH, [0, 0.25, 0.5, 0.75, 1], y);

  [
    ["precision", "Precision", COLORS.orange],
    ["recall", "Recall", COLORS.green],
    ["f1", "F1", COLORS.model],
  ].forEach(([key, label, color], index) => {
    const points = rows.map((row) => ({ x: row.threshold, y: row[key] }));
    svg.appendChild(svgEl("path", { d: linePath(points, x, y), fill: "none", stroke: color, "stroke-width": key === "f1" ? 2.8 : 2, "stroke-linecap": "round" }));
    svg.appendChild(svgEl("line", { x1: margin.left + index * 90, x2: margin.left + index * 90 + 18, y1: 14, y2: 14, stroke: color, "stroke-width": 3 }));
    const text = svgEl("text", { x: margin.left + index * 90 + 24, y: 18, class: "legend" });
    text.textContent = label;
    svg.appendChild(text);
  });

  const deployed = rows[0]?.deployed_threshold || 0.5;
  svg.appendChild(svgEl("line", { x1: x(deployed), x2: x(deployed), y1: margin.top, y2: margin.top + innerH, stroke: COLORS.red, "stroke-width": 1.4, "stroke-dasharray": "5 5" }));
  [0.1, 0.3, 0.5, 0.7, 0.9].forEach((tick) => {
    const label = svgEl("text", { x: x(tick), y: height - 16, "text-anchor": "middle", class: "svg-label" });
    label.textContent = pct(tick, 0);
    svg.appendChild(label);
  });
  node.appendChild(svg);
}

function renderCalibration() {
  const node = document.getElementById("calibrationChart");
  clear(node);
  const rows = DATA.calibration.filter((row) => row.h === state.horizon && row.n > 0);
  const { width, height } = dimensions(node, 300);
  const margin = { top: 22, right: 24, bottom: 42, left: 48 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", height: "100%" });
  const x = scaleLinear([0, 1], [margin.left, margin.left + innerW]);
  const y = scaleLinear([0, 1], [margin.top + innerH, margin.top]);
  addGrid(svg, margin.left, margin.top, innerW, innerH, [0, 0.25, 0.5, 0.75, 1], y);
  svg.appendChild(svgEl("line", { x1: x(0), x2: x(1), y1: y(0), y2: y(1), stroke: COLORS.muted, "stroke-width": 1.5, "stroke-dasharray": "4 4" }));
  const maxN = Math.max(...rows.map((row) => row.n));
  rows.forEach((row) => {
    const r = 4 + 12 * Math.sqrt(row.n / maxN);
    const circle = svgEl("circle", { cx: x(row.avg_probability || 0), cy: y(row.event_rate || 0), r, fill: COLORS.cyan, opacity: "0.72" });
    circle.addEventListener("mousemove", (event) => showTip(event, `<b>Bin ${row.bin}</b><br>N: ${compact(row.n)}<br>Avg probability: ${pct(row.avg_probability)}<br>Event rate: ${pct(row.event_rate)}`));
    circle.addEventListener("mouseleave", hideTip);
    svg.appendChild(circle);
  });
  const xLabel = svgEl("text", { x: margin.left + innerW / 2, y: height - 12, "text-anchor": "middle", class: "svg-label" });
  xLabel.textContent = "Predicted probability";
  svg.appendChild(xLabel);
  node.appendChild(svg);
}

function renderFeatureBars() {
  const node = document.getElementById("featureBars");
  clear(node);
  const sourceRows = DATA.featureImportance || DATA.topFeatures;
  const rows = sourceRows
    .filter((row) => state.featureCategory === "all" || row.category === state.featureCategory)
    .filter((row) => !state.forecastOnly || row.is_forecasted)
    .slice(0, state.featureCount);
  const base = dimensions(node, 740);
  const width = base.width;
  if (width < 760) {
    renderCompactFeatureBars(node, rows);
    return;
  }
  const height = Math.max(base.height, rows.length * 36 + 92);
  const margin = { top: 52, right: 36, bottom: 40, left: 390 };
  const heatmapW = 420;
  const gap = 40;
  const barW = Math.max(260, width - margin.left - margin.right - heatmapW - gap);
  const maxVal = Math.max(...rows.map((row) => row.avg_gain_share_all_horizons), 0.001);
  const maxHorizonVal = Math.max(...rows.flatMap((row) => Array.from({ length: 8 }, (_, idx) => row[`h${idx + 1}`] || 0)), 0.001);
  const x = scaleLinear([0, maxVal * 1.08], [0, barW]);
  const heatX = margin.left + barW + gap;
  const heatCellW = heatmapW / 8;
  const heatColor = (value) => {
    const t = Math.min(1, Math.max(0, value / maxHorizonVal));
    const start = [248, 250, 252];
    const end = [37, 99, 235];
    const rgb = start.map((s, i) => Math.round(s + (end[i] - s) * t));
    return `rgb(${rgb.join(",")})`;
  };
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", height: "100%" });

  if (!rows.length) {
    const empty = svgEl("text", { x: width / 2, y: height / 2, "text-anchor": "middle", class: "svg-label" });
    empty.textContent = "No features match the selected filters";
    svg.appendChild(empty);
    node.appendChild(svg);
    return;
  }

  const rowH = (height - margin.top - margin.bottom) / rows.length;

  const barHeader = svgEl("text", { x: margin.left, y: 22, class: "legend" });
  barHeader.textContent = `Top ${rows.length} by average gain share`;
  svg.appendChild(barHeader);
  const heatHeader = svgEl("text", { x: heatX, y: 22, class: "legend" });
  heatHeader.textContent = "Horizon gain";
  svg.appendChild(heatHeader);
  for (let h = 1; h <= 8; h += 1) {
    const label = svgEl("text", {
      x: heatX + (h - 1) * heatCellW + heatCellW / 2,
      y: 42,
      "text-anchor": "middle",
      class: "svg-label",
    });
    label.textContent = `${h * 15}`;
    svg.appendChild(label);
  }

  rows.forEach((row, index) => {
    const y = margin.top + index * rowH;
    const label = svgEl("text", { x: margin.left - 12, y: y + rowH * 0.62, "text-anchor": "end", class: "svg-label" });
    label.textContent = `${row.rank || index + 1}. ${featureLabel(row.feature).slice(0, 56)}`;
    svg.appendChild(label);
    const color = CATEGORY_COLORS[row.category] || CATEGORY_COLORS.other;
    const rect = svgEl("rect", {
      x: margin.left,
      y: y + rowH * 0.20,
      width: x(row.avg_gain_share_all_horizons),
      height: Math.max(8, rowH * 0.56),
      rx: 4,
      fill: color,
      opacity: row.is_forecasted ? "0.72" : "0.9",
    });
    rect.addEventListener("mousemove", (event) => showTip(event, `<b>${featureLabel(row.feature)}</b><br>${cleanLabel(row.category)} / ${cleanLabel(row.transformation)}<br>Avg gain: ${pct(row.avg_gain_share_all_horizons, 2)}<br>Used in ${row.horizons_used} horizon(s)<br>${row.availability}`));
    rect.addEventListener("mouseleave", hideTip);
    svg.appendChild(rect);
    const value = svgEl("text", { x: margin.left + x(row.avg_gain_share_all_horizons) + 8, y: y + rowH * 0.62, class: "svg-label" });
    value.textContent = pct(row.avg_gain_share_all_horizons, 2);
    svg.appendChild(value);

    for (let h = 1; h <= 8; h += 1) {
      const valueH = row[`h${h}`] || 0;
      const cell = svgEl("rect", {
        x: heatX + (h - 1) * heatCellW + 2,
        y: y + rowH * 0.18,
        width: Math.max(1, heatCellW - 4),
        height: Math.max(8, rowH * 0.60),
        rx: 3,
        fill: heatColor(valueH),
        stroke: valueH > 0 ? "#dbeafe" : "#e2e8f0",
      });
      cell.addEventListener("mousemove", (event) => showTip(event, `<b>${featureLabel(row.feature)}</b><br>t+${h} (${h * 15} min)<br>Gain share: ${pct(valueH, 2)}`));
      cell.addEventListener("mouseleave", hideTip);
      svg.appendChild(cell);
    }
  });
  node.appendChild(svg);
}

function renderCompactFeatureBars(node, rows) {
  if (!rows.length) {
    node.innerHTML = `<div class="empty-state">No features match the selected filters</div>`;
    return;
  }
  const maxVal = Math.max(...rows.map((row) => row.avg_gain_share_all_horizons), 0.001);
  const maxHorizonVal = Math.max(...rows.flatMap((row) => Array.from({ length: 8 }, (_, idx) => row[`h${idx + 1}`] || 0)), 0.001);
  const heatColor = (value) => {
    const t = Math.min(1, Math.max(0, value / maxHorizonVal));
    const start = [248, 250, 252];
    const end = [37, 99, 235];
    const rgb = start.map((s, i) => Math.round(s + (end[i] - s) * t));
    return `rgb(${rgb.join(",")})`;
  };
  const items = rows.map((row, index) => {
    const color = CATEGORY_COLORS[row.category] || CATEGORY_COLORS.other;
    const barWidth = `${Math.max(2, (row.avg_gain_share_all_horizons / maxVal) * 100)}%`;
    const heatCells = Array.from({ length: 8 }, (_, i) => {
      const h = i + 1;
      const value = row[`h${h}`] || 0;
      return `<span class="feature-heat-cell" style="background:${heatColor(value)}" title="t+${h} (${h * 15} min): ${pct(value, 2)}"></span>`;
    }).join("");
    return `<div class="feature-item">
      <div class="feature-item-head">
        <strong>${row.rank || index + 1}. ${featureLabel(row.feature)}</strong>
        <span>${pct(row.avg_gain_share_all_horizons, 2)}</span>
      </div>
      <div class="feature-item-meta">${cleanLabel(row.category)} / ${cleanLabel(row.transformation)} · ${row.availability}</div>
      <div class="feature-bar-track"><div class="feature-bar-fill" style="width:${barWidth}; background:${color}"></div></div>
      <div class="feature-heat-row">${heatCells}</div>
    </div>`;
  }).join("");
  node.innerHTML = `<div class="compact-feature-list">
    <div class="compact-feature-title">Top ${rows.length} by average gain share</div>
    ${items}
  </div>`;
}

function renderCategoryBars() {
  const node = document.getElementById("categoryBars");
  clear(node);
  const gain = new Map(DATA.gainCategory.map((row) => [row.category, row.gain_share]));
  const rows = DATA.permutationCategory.map((row) => ({ ...row, gain_share: gain.get(row.category) || 0 }))
    .sort((a, b) => b.f1_drop - a.f1_drop);
  const { width, height } = dimensions(node, 740);
  const margin = { top: 26, right: 96, bottom: 34, left: 205 };
  const innerW = width - margin.left - margin.right;
  const rowH = (height - margin.top - margin.bottom) / rows.length;
  const maxDrop = Math.max(...rows.map((row) => Math.abs(row.f1_drop)), 0.001);
  const maxGain = Math.max(...rows.map((row) => row.gain_share));
  const xDrop = scaleLinear([0, maxDrop * 1.15], [0, innerW * 0.54]);
  const xGain = scaleLinear([0, maxGain * 1.1], [0, innerW * 0.34]);
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", height: "100%" });

  rows.forEach((row, index) => {
    const y = margin.top + index * rowH;
    const label = svgEl("text", { x: margin.left - 10, y: y + rowH * 0.62, "text-anchor": "end", class: "svg-label" });
    label.textContent = cleanLabel(row.category).slice(0, 28);
    svg.appendChild(label);

    const dropColor = row.f1_drop >= 0 ? COLORS.green : COLORS.red;
    svg.appendChild(svgEl("rect", {
      x: margin.left,
      y: y + rowH * 0.18,
      width: xDrop(Math.abs(row.f1_drop)),
      height: Math.max(4, rowH * 0.27),
      rx: 3,
      fill: dropColor,
      opacity: "0.86",
    }));
    svg.appendChild(svgEl("rect", {
      x: margin.left,
      y: y + rowH * 0.52,
      width: xGain(row.gain_share),
      height: Math.max(4, rowH * 0.27),
      rx: 3,
      fill: COLORS.model,
      opacity: "0.56",
    }));
    const value = svgEl("text", { x: margin.left + xDrop(Math.abs(row.f1_drop)) + 6, y: y + rowH * 0.40, class: "svg-label" });
    value.textContent = `${row.f1_drop >= 0 ? "+" : ""}${pct(row.f1_drop, 2)} F1`;
    svg.appendChild(value);
  });

  const legend1 = svgEl("text", { x: margin.left, y: height - 8, class: "legend" });
  legend1.textContent = "green/red: grouped F1 permutation impact";
  svg.appendChild(legend1);
  const legend2 = svgEl("text", { x: margin.left + 245, y: height - 8, class: "legend" });
  legend2.textContent = "blue: gain share";
  svg.appendChild(legend2);
  node.appendChild(svg);
}

function renderAblationTable() {
  const table = document.getElementById("ablationTable");
  const cols = [
    ["feature_spec", "Feature set"],
    ["avg_f1", "Avg F1"],
    ["avg_ap", "Avg AP"],
    ["avg_ap_lift", "AP lift"],
    ["day_ahead_features", "DA"],
    ["weather_features", "Weather"],
    ["ned_forecast_features", "NED"],
  ];
  table.innerHTML = `
    <thead><tr>${cols.map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead>
    <tbody>
      ${DATA.ablation.map((row) => `<tr>
        ${cols.map(([key]) => {
          const value = row[key];
          const text = typeof value === "number" && key.includes("avg") ? pct(value) : value;
          return `<td>${text}</td>`;
        }).join("")}
      </tr>`).join("")}
    </tbody>
  `;
}

function renderSelected() {
  renderSummary();
  renderDateRangePicker();
  renderConfusion();
  renderSnapshot();
  renderThreshold();
  renderCalibration();
}

function renderAll() {
  document.getElementById("artifactStamp").textContent = `Generated ${DATA.metadata.generated_at}`;
  initControls();
  renderHeadline();
  renderF1Chart();
  renderHeatmap();
  renderFeatureBars();
  renderCategoryBars();
  renderAblationTable();
  renderSelected();
}

window.addEventListener("resize", () => {
  renderF1Chart();
  renderHeatmap();
  renderFeatureBars();
  renderCategoryBars();
  renderSelected();
});

renderAll();
