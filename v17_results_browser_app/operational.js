const DATA = window.V17_RESULTS;

const STEP_MINUTES = 15;
const BAND_COLORS = {
  normal: "#059669",
  watch: "#d97706",
  alert: "#ea580c",
  critical: "#dc2626",
};

const state = {
  time: null,
  posture: "balanced",
  alertThreshold: 0.4,
  exposureMwh: 10,
};

const seriesMaps = new Map();

function pct(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function num(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return Number(value).toFixed(digits);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function toInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addMinutes(value, minutes) {
  return toInputValue(new Date(new Date(value).getTime() + minutes * 60 * 1000));
}

function formatTime(value) {
  const date = new Date(value);
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
    width: Math.max(300, node.clientWidth || 720),
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
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.minutes).toFixed(2)},${y(point.p).toFixed(2)}`)
    .join(" ");
}

function areaPath(points, x, y, baseY) {
  if (!points.length) return "";
  const top = linePath(points, x, y);
  const last = points[points.length - 1];
  const first = points[0];
  return `${top} L${x(last.minutes).toFixed(2)},${baseY.toFixed(2)} L${x(first.minutes).toFixed(2)},${baseY.toFixed(2)} Z`;
}

function buildSeriesMaps() {
  Object.entries(DATA.predictionSeries).forEach(([horizon, rows]) => {
    const byTime = new Map();
    rows.forEach((row) => byTime.set(row.t, row));
    seriesMaps.set(Number(horizon), byTime);
  });
}

function minDecisionTime() {
  const first = DATA.predictionSeries["8"][0].t;
  return addMinutes(first, -8 * STEP_MINUTES);
}

function maxDecisionTime() {
  const rows = DATA.predictionSeries["8"];
  return addMinutes(rows[rows.length - 1].t, -8 * STEP_MINUTES);
}

function clampTime(value) {
  const min = minDecisionTime();
  const max = maxDecisionTime();
  if (!value || value < min) return min;
  if (value > max) return max;
  return value;
}

function horizonRows(baseTime = state.time) {
  return DATA.overall.map((metric) => {
    const target = addMinutes(baseTime, metric.minutes);
    const point = seriesMaps.get(metric.h)?.get(target);
    return {
      ...metric,
      target,
      p: point?.p ?? null,
      threshold: point?.threshold ?? null,
      pred: point?.pred ?? null,
      actual: point?.y ?? null,
    };
  }).filter((row) => row.p !== null);
}

function bandFor(row) {
  const alert = state.alertThreshold;
  if (row.p >= Math.max(0.58, alert + 0.12)) return "critical";
  if (row.p >= alert) return "alert";
  if (row.p >= Math.max(0.25, alert - 0.1)) return "watch";
  return "normal";
}

function bandLabel(band) {
  return {
    normal: "Normal",
    watch: "Watch",
    alert: "Alert",
    critical: "Critical",
  }[band];
}

function actionFor(peak) {
  const band = bandFor(peak);
  const copy = {
    balanced: {
      normal: ["Maintain schedule", "Keep routine nominations and monitor the next ISP."],
      watch: ["Keep optionality", "Delay new one-sided exposure and keep flexible bids reachable."],
      alert: ["Rebalance exposure", "Reduce directional imbalance and pre-position flexible assets."],
      critical: ["Protect portfolio", "Actively cap imbalance exposure and lock in response capacity."],
    },
    long: {
      normal: ["Hold long plan", "Keep nominated position unless commercial signals change."],
      watch: ["Trim excess length", "Check controllable production and demand-side absorption."],
      alert: ["Reduce long imbalance", "Bring flexible load or down-regulation options closer to dispatch."],
      critical: ["Hedge surplus risk", "Close avoidable long exposure and reserve rapid curtailment options."],
    },
    short: {
      normal: ["Hold short plan", "Keep routine balancing checks on the next ISP."],
      watch: ["Secure upward cover", "Keep fast generation or contracted flexibility within reach."],
      alert: ["Cap short exposure", "Buy back avoidable shortfall or prepare upward activation."],
      critical: ["Cover shortage risk", "Prioritize balancing trades and firm upward response capacity."],
    },
    bsp: {
      normal: ["Stand by", "Keep availability aligned with submitted BSP capacity."],
      watch: ["Warm flexible assets", "Check telemetry, baselines, and activation constraints."],
      alert: ["Prepare activation", "Position assets for likely dispatch and verify bid ladder availability."],
      critical: ["Maximize readiness", "Move critical assets into immediate response posture."],
    },
  };
  return { band, text: copy[state.posture][band] };
}

function renderSummary(rows) {
  const next = rows[0];
  const peak = rows.reduce((best, row) => (row.p > best.p ? row : best), rows[0]);
  const triggered = rows.filter((row) => row.p >= state.alertThreshold);
  const expectedMwh = rows.reduce((sum, row) => sum + row.p * state.exposureMwh / rows.length, 0);

  document.getElementById("nextProbability").textContent = pct(next.p);
  document.getElementById("nextDetail").textContent = `${formatTime(next.target)} · ${bandLabel(bandFor(next))}`;
  document.getElementById("peakProbability").textContent = pct(peak.p);
  document.getElementById("peakDetail").textContent = `${peak.minutes} min · ${formatTime(peak.target)}`;
  document.getElementById("triggeredCount").textContent = `${triggered.length}/${rows.length}`;
  document.getElementById("triggeredDetail").textContent = `${pct(state.alertThreshold)} alert level`;
  document.getElementById("riskMwh").textContent = `${num(expectedMwh)} MWh`;
  document.getElementById("riskDetail").textContent = `${num(state.exposureMwh)} MWh open position`;
}

function renderSignal(rows) {
  const peak = rows.reduce((best, row) => (row.p > best.p ? row : best), rows[0]);
  const band = bandFor(peak);
  const signal = document.getElementById("overallSignal");
  signal.textContent = bandLabel(band);
  signal.style.background = BAND_COLORS[band];
}

function renderRiskChart(rows) {
  const node = document.getElementById("riskChart");
  clear(node);
  const { width, height } = dimensions(node, 378);
  const margin = { top: 18, right: 18, bottom: 42, left: 50 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const maxY = Math.max(0.7, ...rows.map((row) => row.p), state.alertThreshold) + 0.04;
  const x = scaleLinear([15, 120], [margin.left, margin.left + innerW]);
  const y = scaleLinear([0, Math.min(1, maxY)], [margin.top + innerH, margin.top]);
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });

  [0, 0.25, 0.5, 0.75, 1].filter((tick) => tick <= maxY).forEach((tick) => {
    const yy = y(tick);
    svg.appendChild(svgEl("line", { x1: margin.left, x2: margin.left + innerW, y1: yy, y2: yy, class: "grid-line" }));
    const label = svgEl("text", { x: margin.left - 8, y: yy + 4, "text-anchor": "end", class: "svg-label" });
    label.textContent = pct(tick);
    svg.appendChild(label);
  });

  rows.forEach((row) => {
    const label = svgEl("text", { x: x(row.minutes), y: margin.top + innerH + 25, "text-anchor": "middle", class: "svg-label" });
    label.textContent = `${row.minutes}m`;
    svg.appendChild(label);
  });

  const baseY = y(0);
  svg.appendChild(svgEl("path", { d: areaPath(rows, x, y, baseY), class: "risk-area" }));
  svg.appendChild(svgEl("path", { d: linePath(rows, x, y), class: "risk-line" }));

  const alertY = y(state.alertThreshold);
  svg.appendChild(svgEl("line", { x1: margin.left, x2: margin.left + innerW, y1: alertY, y2: alertY, class: "threshold-line" }));
  const thresholdText = svgEl("text", { x: margin.left + innerW - 4, y: alertY - 8, "text-anchor": "end", class: "svg-label" });
  thresholdText.textContent = `alert ${pct(state.alertThreshold)}`;
  svg.appendChild(thresholdText);

  rows.forEach((row) => {
    const band = bandFor(row);
    const circle = svgEl("circle", {
      cx: x(row.minutes),
      cy: y(row.p),
      r: 6,
      fill: BAND_COLORS[band],
      class: "point",
    });
    svg.appendChild(circle);
    const label = svgEl("text", { x: x(row.minutes), y: y(row.p) - 11, "text-anchor": "middle", class: "svg-label" });
    label.textContent = pct(row.p);
    svg.appendChild(label);
  });

  node.appendChild(svg);
}

function renderAction(rows) {
  const peak = rows.reduce((best, row) => (row.p > best.p ? row : best), rows[0]);
  const next = rows[0];
  const triggered = rows.filter((row) => row.p >= state.alertThreshold);
  const action = actionFor(peak);
  const block = document.getElementById("actionBlock");
  document.getElementById("postureCaption").textContent = `${document.getElementById("postureSelect").selectedOptions[0].textContent} operating posture.`;
  block.innerHTML = `
    <div class="action-primary" style="border-left-color:${BAND_COLORS[action.band]}">
      <strong>${action.text[0]}</strong>
      <span>${action.text[1]}</span>
    </div>
    <ul class="action-list">
      <li><b>Next delivery</b><span>${formatTime(next.target)} at ${pct(next.p)}</span></li>
      <li><b>Peak delivery</b><span>${formatTime(peak.target)} at ${pct(peak.p)}</span></li>
      <li><b>Alert window</b><span>${triggered.length ? `${triggered[0].minutes}-${triggered[triggered.length - 1].minutes} min` : "None"}</span></li>
    </ul>
  `;

  document.getElementById("reliabilityBlock").innerHTML = `
    <div class="reliability-row"><b>Model precision</b><span>${pct(peak.model_precision, 1)} at ${peak.minutes} min</span></div>
    <div class="reliability-row"><b>Model recall</b><span>${pct(peak.model_recall, 1)} at ${peak.minutes} min</span></div>
    <div class="reliability-row"><b>F1 lift</b><span>${pct(peak.f1_lift_vs_best_baseline, 1)} versus best baseline</span></div>
  `;
}

function renderTable(rows) {
  document.getElementById("intervalTable").innerHTML = `
    <thead>
      <tr>
        <th>Horizon</th>
        <th>Delivery</th>
        <th>Probability</th>
        <th>Threshold</th>
        <th>Band</th>
        <th>Replay</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((row) => {
        const band = bandFor(row);
        return `<tr>
          <td>${row.minutes} min</td>
          <td>${formatTime(row.target)}</td>
          <td class="prob-cell">
            <div>${pct(row.p)}</div>
            <div class="prob-track"><div class="prob-fill" style="width:${Math.round(row.p * 100)}%; background:${BAND_COLORS[band]}"></div></div>
          </td>
          <td>${pct(row.threshold)}</td>
          <td><span class="badge" style="background:${BAND_COLORS[band]}">${bandLabel(band)}</span></td>
          <td>${row.actual ? "State 2" : "No State 2"}</td>
        </tr>`;
      }).join("")}
    </tbody>
  `;
}

function renderRiskMix(rows) {
  const counts = { normal: 0, watch: 0, alert: 0, critical: 0 };
  rows.forEach((row) => counts[bandFor(row)] += 1);
  document.getElementById("riskMix").innerHTML = Object.entries(counts).map(([band, count]) => `
    <div class="mix-row">
      <b>${bandLabel(band)}</b>
      <div class="mix-track"><div class="mix-fill" style="width:${(count / rows.length) * 100}%; background:${BAND_COLORS[band]}"></div></div>
      <span>${count}</span>
    </div>
  `).join("");
}

function renderAll() {
  state.time = clampTime(state.time);
  const rows = horizonRows();
  document.getElementById("decisionTime").value = state.time;
  document.getElementById("horizonCaption").textContent = `${formatTime(addMinutes(state.time, STEP_MINUTES))} to ${formatTime(addMinutes(state.time, 8 * STEP_MINUTES))}.`;
  renderSummary(rows);
  renderSignal(rows);
  renderRiskChart(rows);
  renderAction(rows);
  renderTable(rows);
  renderRiskMix(rows);
}

function findHighRiskTime() {
  const source = DATA.predictionSeries["8"];
  let best = { time: maxDecisionTime(), score: -1 };
  for (let index = 0; index < source.length; index += 4) {
    const base = addMinutes(source[index].t, -8 * STEP_MINUTES);
    const rows = horizonRows(base);
    if (rows.length < 8) continue;
    const score = Math.max(...rows.map((row) => row.p));
    if (score > best.score) best = { time: base, score };
  }
  return best.time;
}

function initControls() {
  buildSeriesMaps();
  const input = document.getElementById("decisionTime");
  input.min = minDecisionTime();
  input.max = maxDecisionTime();
  state.time = maxDecisionTime();
  input.addEventListener("change", (event) => {
    state.time = clampTime(event.target.value);
    renderAll();
  });
  document.getElementById("postureSelect").addEventListener("change", (event) => {
    state.posture = event.target.value;
    renderAll();
  });
  document.getElementById("alertThreshold").addEventListener("input", (event) => {
    state.alertThreshold = Number(event.target.value) / 100;
    renderAll();
  });
  document.getElementById("exposureInput").addEventListener("input", (event) => {
    state.exposureMwh = Math.max(0, Number(event.target.value) || 0);
    renderAll();
  });
  document.getElementById("prevButton").addEventListener("click", () => {
    state.time = addMinutes(state.time, -STEP_MINUTES);
    renderAll();
  });
  document.getElementById("nextButton").addEventListener("click", () => {
    state.time = addMinutes(state.time, STEP_MINUTES);
    renderAll();
  });
  document.getElementById("nowButton").addEventListener("click", () => {
    state.time = maxDecisionTime();
    renderAll();
  });
  document.getElementById("eventButton").addEventListener("click", () => {
    state.time = findHighRiskTime();
    renderAll();
  });
  window.addEventListener("resize", renderAll);
}

initControls();
renderAll();
