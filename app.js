// AquaTrace Coastal Water Quality Dashboard Logic
// Platform: Arduino Uno, pH, TDS, Turbidity, DS18B20 Temp, 20x4 I2C LCD

// Initial Stored Telemetry Data incorporating Prototype Experimental Readings & Historical Baselines
const INITIAL_TELEMETRY_DATA = [
  {
    timestamp: "2026-10-04T00:00:00Z",
    mode: "sample_mode",
    pH: 7.4,
    turbidity: 8.2,
    TDS: 310,
    temperature: 28.1,
    anomaly_status: "normal",
    anomaly_reason: "All parameters within nominal baseline range.",
    contributing_sensors: [],
    severity: "low"
  },
  {
    timestamp: "2026-10-04T01:00:00Z",
    mode: "sample_mode",
    pH: 7.6,
    turbidity: 11.5,
    TDS: 340,
    temperature: 28.4,
    anomaly_status: "normal",
    anomaly_reason: "Nominal coastal equilibrium baseline.",
    contributing_sensors: [],
    severity: "low"
  },
  {
    timestamp: "2026-10-04T02:00:00Z",
    mode: "sample_mode",
    pH: 6.2,
    turbidity: 45.0,
    TDS: 480,
    temperature: 29.0,
    anomaly_status: "single_anomaly",
    anomaly_reason: "pH level dropped below lower threshold limit (6.5).",
    contributing_sensors: ["pH Sensor"],
    severity: "medium"
  },
  {
    timestamp: "2026-10-04T03:00:00Z",
    mode: "sample_mode",
    pH: 7.5,
    turbidity: 12.0,
    TDS: 330,
    temperature: 28.6,
    anomaly_status: "normal",
    anomaly_reason: "Parameters stabilized.",
    contributing_sensors: [],
    severity: "low"
  },
  {
    timestamp: "2026-10-04T04:00:00Z",
    mode: "sample_mode",
    pH: 8.9,
    turbidity: 88.0,
    TDS: 720,
    temperature: 30.5,
    anomaly_status: "multi_anomaly",
    anomaly_reason: "Correlated breach: pH (8.9), Turbidity (88 NTU), and TDS (720 PPM) exceed normal limits.",
    contributing_sensors: ["pH Sensor", "Turbidity Sensor", "TDS Meter"],
    severity: "high"
  },
  {
    timestamp: "2026-10-04T05:00:00Z",
    mode: "sample_mode",
    pH: 7.7,
    turbidity: 14.2,
    TDS: 350,
    temperature: 28.9,
    anomaly_status: "normal",
    anomaly_reason: "Nominal baseline readings.",
    contributing_sensors: [],
    severity: "low"
  },
  // Prototype Experimental Setup Readings
  {
    timestamp: "2026-10-04T06:00:00Z",
    mode: "sample_mode",
    pH: 15.13,
    turbidity: 2377.0,
    TDS: 0,
    temperature: 31.4,
    anomaly_status: "sensor_issue",
    anomaly_reason: "Prototype Experimental Sample: pH (15.13) exceeds physical limit (14.0) — Calibration Required. Turbidity (2377 NTU) requires verification.",
    contributing_sensors: ["pH Sensor", "Turbidity Sensor"],
    severity: "high"
  }
];

// Threshold Configuration Constants
const THRESHOLDS = {
  pH: { min: 6.5, max: 8.5, extremeMin: 3.0, extremeMax: 14.0 },
  turbidity: { warning: 50, critical: 200, extreme: 2000 },
  TDS: { warning: 500, critical: 1000 },
  temperature: { min: 15, max: 35, maxShift: 4.0 }
};

// Global Application State
let telemetryData = [...INITIAL_TELEMETRY_DATA];
let activeData = [...INITIAL_TELEMETRY_DATA];
let selectedDeviceFilter = "all";
let selectedSourceFilter = "all";
let selectedTimeFilter = "all";

let charts = {};
let isSimulating = false;
let simulationInterval = null;
let simulationSpeed = 2000;
let isLiveHardware = false;

let showPredictions = false;

// Hardware & WebSerial State
let serialPort = null;
let serialReader = null;
let serialPacketCount = 0;
let serialErrorCount = 0;
let serialStartTime = null;
let uptimeInterval = null;

// DOM Initialization
window.addEventListener("DOMContentLoaded", () => {
  initCharts();
  setupEventListeners();
  evaluateAllTelemetryAnomalies();
  renderDashboard();
});

// Event Listeners Setup
function setupEventListeners() {
  document.getElementById("device-filter").addEventListener("change", (e) => {
    selectedDeviceFilter = e.target.value;
    filterAndRender();
  });
  
  document.getElementById("source-filter").addEventListener("change", (e) => {
    selectedSourceFilter = e.target.value;
    filterAndRender();
  });

  document.getElementById("time-range-filter").addEventListener("change", (e) => {
    selectedTimeFilter = e.target.value;
    filterAndRender();
  });

  // Playback & Stream Controls
  const playBtn = document.getElementById("btn-play");
  const speedSlider = document.getElementById("sim-speed");
  const speedVal = document.getElementById("sim-speed-val");
  const modeToggleBtn = document.getElementById("btn-toggle-mode");

  playBtn.addEventListener("click", () => {
    if (isSimulating) {
      stopSimulation();
    } else {
      startSimulation();
    }
  });

  speedSlider.addEventListener("input", (e) => {
    simulationSpeed = parseInt(e.target.value);
    speedVal.textContent = (simulationSpeed / 1000).toFixed(1) + "s";
    if (isSimulating) {
      stopSimulation();
      startSimulation();
    }
  });

  modeToggleBtn.addEventListener("click", toggleLiveHardwareMode);

  document.getElementById("btn-connect-serial").addEventListener("click", connectWebSerial);
  document.getElementById("btn-export-csv").addEventListener("click", exportToCSV);
  document.getElementById("btn-export-pdf").addEventListener("click", () => window.print());
  document.getElementById("btn-reset-data").addEventListener("click", resetData);

  // Toggle ML Prediction Overlay
  document.getElementById("btn-toggle-prediction").addEventListener("click", () => {
    showPredictions = !showPredictions;
    const btn = document.getElementById("btn-toggle-prediction");
    btn.innerHTML = showPredictions ? "✨ Hide Prediction" : "🔮 Show ML Prediction";
    btn.style.background = showPredictions ? "rgba(139, 92, 246, 0.3)" : "none";
    updateCharts();
  });

  // Modal Close Events
  document.querySelectorAll(".modal-close-btn, .modal-overlay").forEach(btn => {
    btn.addEventListener("click", (e) => {
      if (e.target === btn || btn.classList.contains("modal-close-btn")) {
        document.getElementById("detail-modal").classList.remove("active");
      }
    });
  });
}

// Deterministic Anomaly Analysis & Data Fusion Engine
function analyzeReadingAnomaly(row) {
  const breaches = [];
  let isCalibrationReq = false;

  // 1. pH Check
  if (row.pH > THRESHOLDS.pH.extremeMax) {
    breaches.push(`pH level (${row.pH}) exceeds physical probe scale (14.0) — Calibration Required`);
    isCalibrationReq = true;
  } else if (row.pH < THRESHOLDS.pH.min || row.pH > THRESHOLDS.pH.max) {
    breaches.push(`pH level (${row.pH}) out of baseline limits [${THRESHOLDS.pH.min} - ${THRESHOLDS.pH.max}]`);
  }

  // 2. Turbidity Check
  if (row.turbidity > THRESHOLDS.turbidity.extreme) {
    breaches.push(`Turbidity (${row.turbidity} NTU) severely elevated — Probe verification required`);
    isCalibrationReq = true;
  } else if (row.turbidity > THRESHOLDS.turbidity.warning) {
    breaches.push(`Turbidity (${row.turbidity} NTU) exceeds standard (< 50 NTU)`);
  }

  // 3. TDS Check
  if (row.TDS > THRESHOLDS.TDS.warning) {
    breaches.push(`TDS concentration (${row.TDS} PPM) exceeds nominal limit (< 500 PPM)`);
  }

  // 4. Temperature Check
  if (row.temperature < THRESHOLDS.temperature.min || row.temperature > THRESHOLDS.temperature.max) {
    breaches.push(`Temperature (${row.temperature} °C) outside expected coastal range`);
  }

  // Multi-sensor Classification Assignment
  let status = "normal";
  let reason = "All parameters within calibrated thresholds.";
  let severity = "low";
  let contributing = [];

  if (isCalibrationReq) {
    status = "sensor_issue";
    severity = "high";
    reason = breaches.join(". ");
  } else if (breaches.length > 1) {
    status = "multi_anomaly";
    severity = "high";
    reason = `Multi-sensor correlated anomaly: ${breaches.join("; ")}.`;
  } else if (breaches.length === 1) {
    status = "single_anomaly";
    severity = "medium";
    reason = `Single parameter breach: ${breaches[0]}.`;
  }

  if (row.pH < THRESHOLDS.pH.min || row.pH > THRESHOLDS.pH.max) contributing.push("pH Sensor");
  if (row.turbidity > THRESHOLDS.turbidity.warning) contributing.push("Turbidity Sensor");
  if (row.TDS > THRESHOLDS.TDS.warning) contributing.push("TDS Meter");
  if (row.temperature < THRESHOLDS.temperature.min || row.temperature > THRESHOLDS.temperature.max) contributing.push("DS18B20 Temp Probe");

  row.anomaly_status = status;
  row.anomaly_reason = reason;
  row.severity = severity;
  row.contributing_sensors = contributing;

  return row;
}

function evaluateAllTelemetryAnomalies() {
  telemetryData.forEach(row => analyzeReadingAnomaly(row));
}

// Sparkline rendering logic using Canvas
function drawSparkline(canvasId, data, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  if (!data || data.length < 2) return;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min === 0 ? 1 : max - min;

  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((data[i] - min) / range) * (height - 6) - 3;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  // Gradient fill
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, color.replace(")", ", 0.25)").replace("rgb", "rgba"));
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fill();
}

// Chart.js Configuration
function initCharts() {
  const chartConfigs = [
    { id: "chart-ph", label: "pH Level", border: "#38bdf8", fill: "rgba(56, 189, 248, 0.05)" },
    { id: "chart-turbidity", label: "Turbidity (NTU)", border: "#fbbf24", fill: "rgba(251, 191, 36, 0.05)" },
    { id: "chart-tds", label: "TDS (PPM)", border: "#a78bfa", fill: "rgba(167, 139, 250, 0.05)" },
    { id: "chart-temperature", label: "Temperature (°C)", border: "#f87171", fill: "rgba(248, 113, 113, 0.05)" }
  ];

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false }
    },
    scales: {
      x: {
        grid: { color: "rgba(255, 255, 255, 0.05)" },
        ticks: { color: "#94a3b8", font: { size: 9 } }
      },
      y: {
        grid: { color: "rgba(255, 255, 255, 0.05)" },
        ticks: { color: "#94a3b8", font: { size: 9 } }
      }
    }
  };

  chartConfigs.forEach(conf => {
    const ctx = document.getElementById(conf.id).getContext("2d");
    const extraOptions = JSON.parse(JSON.stringify(commonOptions));
    
    if (conf.id === "chart-ph") {
      extraOptions.plugins.annotation = {
        annotations: {
          box1: {
            type: 'box',
            yMin: 6.5,
            yMax: 8.5,
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            borderColor: 'rgba(16, 185, 129, 0.25)',
            borderWidth: 1
          }
        }
      };
    }

    charts[conf.id] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: conf.label + " (Actual)",
            data: [],
            borderColor: conf.border,
            borderWidth: 2,
            tension: 0.3,
            fill: true,
            backgroundColor: conf.fill,
            pointRadius: 3,
            pointHoverRadius: 6
          },
          {
            label: conf.label + " (ML Trend)",
            data: [],
            borderColor: "#c084fc",
            borderDash: [5, 5],
            borderWidth: 2,
            tension: 0.3,
            fill: false,
            pointRadius: 2,
            hidden: true
          }
        ]
      },
      options: extraOptions
    });
  });

  // Doughnut Chart for Multi-Sensor Anomaly Breakdown
  const donutCtx = document.getElementById("chart-sources").getContext("2d");
  charts["donut-sources"] = new Chart(donutCtx, {
    type: "doughnut",
    data: {
      labels: ["Normal Baseline", "Single Breach", "Multi-Anomaly", "Sensor Verification"],
      datasets: [{
        data: [0, 0, 0, 0],
        backgroundColor: ["#10b981", "#f59e0b", "#ef4444", "#8b5cf6"],
        borderWidth: 1,
        borderColor: "rgba(0, 0, 0, 0.2)"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "right",
          labels: { color: "#94a3b8", font: { size: 10 } }
        }
      }
    }
  });
}

// Predictive Analysis Engine (Moving Average / Linear Extrapolation)
function generateShortTermPredictions(sortedData, key, futureSteps = 3) {
  if (sortedData.length < 3) return [];
  const vals = sortedData.map(d => d[key]);
  const len = vals.length;
  
  // Calculate simple trend slope from last 3 readings
  const last3 = vals.slice(len - 3);
  const slope = (last3[2] - last3[0]) / 2;
  
  const predicted = [...vals];
  let lastVal = vals[len - 1];

  for (let i = 1; i <= futureSteps; i++) {
    lastVal = lastVal + slope * 0.8; // smoothed decay
    predicted.push(parseFloat(lastVal.toFixed(2)));
  }

  return predicted;
}

function updateCharts() {
  const sorted = [...activeData].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const timeLabels = sorted.map(d => {
    return new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  // Extended time labels for predictions if enabled
  const extendedTimeLabels = [...timeLabels];
  if (showPredictions && sorted.length >= 3) {
    let lastTime = new Date(sorted[sorted.length - 1].timestamp);
    for (let i = 1; i <= 3; i++) {
      lastTime = new Date(lastTime.getTime() + 60 * 60 * 1000);
      extendedTimeLabels.push(lastTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + " (Pred)");
    }
  }

  const variables = {
    "chart-ph": "pH",
    "chart-turbidity": "turbidity",
    "chart-tds": "TDS",
    "chart-temperature": "temperature"
  };

  for (let key in variables) {
    if (charts[key]) {
      const field = variables[key];
      charts[key].data.labels = showPredictions ? extendedTimeLabels : timeLabels;
      charts[key].data.datasets[0].data = sorted.map(d => d[field]);

      if (showPredictions && sorted.length >= 3) {
        charts[key].data.datasets[1].hidden = false;
        charts[key].data.datasets[1].data = generateShortTermPredictions(sorted, field, 3);
      } else {
        charts[key].data.datasets[1].hidden = true;
      }

      charts[key].update();
    }
  }

  // Update Doughnut Anomaly Counts
  const counts = { normal: 0, single_anomaly: 0, multi_anomaly: 0, sensor_issue: 0 };
  activeData.forEach(d => {
    const st = d.anomaly_status || "normal";
    if (counts[st] !== undefined) counts[st]++;
    else counts.normal++;
  });

  if (charts["donut-sources"]) {
    charts["donut-sources"].data.datasets[0].data = [
      counts.normal, counts.single_anomaly, counts.multi_anomaly, counts.sensor_issue
    ];
    charts["donut-sources"].update();
  }

  document.getElementById("cnt-normal").textContent = counts.normal;
  document.getElementById("cnt-industrial").textContent = counts.single_anomaly;
  document.getElementById("cnt-sewage").textContent = counts.multi_anomaly;
  document.getElementById("cnt-oilspill").textContent = counts.sensor_issue;
}

// Render Dashboard Controls, KPIs & Sensor Health
function renderDashboard() {
  if (telemetryData.length === 0) return;

  const latestRow = [...telemetryData].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  document.getElementById("last-update-ts").textContent = new Date(latestRow.timestamp).toLocaleString();

  // Water Quality Status Primary KPI
  const kpiValEl = document.getElementById("kpi-pollution-value");
  const kpiCard = document.getElementById("kpi-pollution-card");
  const deltaEl = document.getElementById("kpi-pollution-delta");

  kpiCard.className = "glass-panel kpi-card";

  if (latestRow.anomaly_status === "sensor_issue") {
    kpiValEl.textContent = "Sensor Check";
    kpiValEl.style.color = "var(--color-purple)";
    kpiCard.classList.add("kpi-warning");
    deltaEl.className = "kpi-delta up";
    deltaEl.innerHTML = "⚠️ Verification Needed";
  } else if (latestRow.anomaly_status === "multi_anomaly") {
    kpiValEl.textContent = "Critical";
    kpiValEl.style.color = "var(--color-critical)";
    kpiCard.classList.add("kpi-critical");
    deltaEl.className = "kpi-delta up";
    deltaEl.innerHTML = "🚨 Multi-Sensor Anomaly";
  } else if (latestRow.anomaly_status === "single_anomaly") {
    kpiValEl.textContent = "Caution";
    kpiValEl.style.color = "var(--color-warning)";
    kpiCard.classList.add("kpi-warning");
    deltaEl.className = "kpi-delta up";
    deltaEl.innerHTML = "⚠️ Threshold Breach";
  } else {
    kpiValEl.textContent = "Optimal";
    kpiValEl.style.color = "var(--color-good)";
    kpiCard.classList.add("kpi-good");
    deltaEl.className = "kpi-delta down";
    deltaEl.innerHTML = "✓ Nominal Equilibrium";
  }

  // Sparkline of pH history
  const sparklineData = telemetryData.map(d => d.pH);
  drawSparkline("pollution-sparkline", sparklineData, latestRow.anomaly_status === "normal" ? "#10b981" : "#f59e0b");

  // Secondary KPIs
  document.getElementById("kpi-ph-val").textContent = latestRow.pH.toFixed(1);
  document.getElementById("kpi-turbidity-val").textContent = latestRow.turbidity.toFixed(1) + " NTU";
  document.getElementById("kpi-tds-val").textContent = Math.round(latestRow.TDS) + " PPM";

  // Render Sensor Health Section
  updateSensorHealthOverview(latestRow);

  // Update Charts, Table, and Explainable Insights
  updateCharts();
  renderEventsTable();
  updateExplainableInsight(latestRow);
}

// Sensor Health Overview Cards Update
function updateSensorHealthOverview(latest) {
  const syncTime = new Date(latest.timestamp).toLocaleTimeString();

  // pH Sensor
  const shStatusPh = document.getElementById("sh-status-ph");
  const shValPh = document.getElementById("sh-val-ph");
  document.getElementById("sh-time-ph").textContent = syncTime;

  if (latest.pH > THRESHOLDS.pH.extremeMax || latest.pH < THRESHOLDS.pH.extremeMin) {
    shStatusPh.textContent = "Calibration Required";
    shStatusPh.style.background = "rgba(139,92,246,0.2)";
    shStatusPh.style.color = "var(--color-purple)";
    shValPh.textContent = `${latest.pH} (Calibration Out of Range)`;
    shValPh.style.color = "var(--color-purple)";
  } else if (latest.pH < THRESHOLDS.pH.min || latest.pH > THRESHOLDS.pH.max) {
    shStatusPh.textContent = "Verification Required";
    shStatusPh.style.background = "rgba(245,158,11,0.2)";
    shStatusPh.style.color = "var(--color-warning)";
    shValPh.textContent = `${latest.pH} (Threshold Breach)`;
    shValPh.style.color = "var(--color-warning)";
  } else {
    shStatusPh.textContent = "Connected";
    shStatusPh.style.background = "rgba(16,185,129,0.15)";
    shStatusPh.style.color = "var(--color-good)";
    shValPh.textContent = `${latest.pH} (Normal Equilibrium)`;
    shValPh.style.color = "var(--text-primary)";
  }

  // TDS Meter
  const shStatusTds = document.getElementById("sh-status-tds");
  const shValTds = document.getElementById("sh-val-tds");
  document.getElementById("sh-time-tds").textContent = syncTime;

  if (latest.TDS > THRESHOLDS.TDS.warning) {
    shStatusTds.textContent = "Verification Required";
    shStatusTds.style.background = "rgba(245,158,11,0.2)";
    shStatusTds.style.color = "var(--color-warning)";
    shValTds.textContent = `${Math.round(latest.TDS)} PPM (High Dissolved Solids)`;
  } else {
    shStatusTds.textContent = "Connected";
    shStatusTds.style.background = "rgba(16,185,129,0.15)";
    shStatusTds.style.color = "var(--color-good)";
    shValTds.textContent = `${Math.round(latest.TDS)} PPM (Nominal)`;
  }

  // Turbidity Sensor
  const shStatusTurb = document.getElementById("sh-status-turbidity");
  const shValTurb = document.getElementById("sh-val-turbidity");
  document.getElementById("sh-time-turbidity").textContent = syncTime;

  if (latest.turbidity > THRESHOLDS.turbidity.extreme) {
    shStatusTurb.textContent = "Verification Required";
    shStatusTurb.style.background = "rgba(239,68,68,0.2)";
    shStatusTurb.style.color = "var(--color-critical)";
    shValTurb.textContent = `${latest.turbidity.toFixed(1)} NTU (Extreme Saturation)`;
  } else if (latest.turbidity > THRESHOLDS.turbidity.warning) {
    shStatusTurb.textContent = "Verification Required";
    shStatusTurb.style.background = "rgba(245,158,11,0.2)";
    shStatusTurb.style.color = "var(--color-warning)";
    shValTurb.textContent = `${latest.turbidity.toFixed(1)} NTU (Elevated Solids)`;
  } else {
    shStatusTurb.textContent = "Connected";
    shStatusTurb.style.background = "rgba(16,185,129,0.15)";
    shStatusTurb.style.color = "var(--color-good)";
    shValTurb.textContent = `${latest.turbidity.toFixed(1)} NTU (Clear Clarity)`;
  }

  // DS18B20 Temp Probe
  const shStatusTemp = document.getElementById("sh-status-temp");
  const shValTemp = document.getElementById("sh-val-temp");
  document.getElementById("sh-time-temp").textContent = syncTime;

  if (latest.temperature < THRESHOLDS.temperature.min || latest.temperature > THRESHOLDS.temperature.max) {
    shStatusTemp.textContent = "Verification Required";
    shStatusTemp.style.background = "rgba(245,158,11,0.2)";
    shStatusTemp.style.color = "var(--color-warning)";
    shValTemp.textContent = `${latest.temperature.toFixed(1)} °C (Out of Range)`;
  } else {
    shStatusTemp.textContent = "Connected";
    shStatusTemp.style.background = "rgba(16,185,129,0.15)";
    shStatusTemp.style.color = "var(--color-good)";
    shValTemp.textContent = `${latest.temperature.toFixed(1)} °C (Valid)`;
  }
}

// Explainable AI & Sensor Analysis
function updateExplainableInsight(latest) {
  const titleEl = document.getElementById("ai-insight-title");
  const descEl = document.getElementById("ai-insight-desc");
  const recEl = document.getElementById("ai-insight-rec");

  if (latest.anomaly_status === "sensor_issue") {
    titleEl.innerHTML = `Explainable Analysis: <span style="color:var(--color-purple)">PROTOTYPE SENSOR VERIFICATION REQUIRED</span>`;
    descEl.textContent = `Experimental reading detected: pH (${latest.pH}) exceeds standard 0-14 electrochemical bounds, and Turbidity (${latest.turbidity} NTU) indicates sensor saturation or uncalibrated analog signal.`;
    recEl.innerHTML = `👉 <strong>Recommended Action:</strong> Perform standard buffer solution calibration (pH 4.01, 7.00, 10.01) for the pH probe and verify TDS zero-point calibration before taking field samples.`;
  } else if (latest.anomaly_status === "multi_anomaly") {
    titleEl.innerHTML = `Explainable Analysis: <span class="text-critical">MULTI-SENSOR CORRELATED ANOMALY DETECTED</span>`;
    descEl.textContent = `Correlated parameter shifts: ${latest.contributing_sensors.join(", ")} show simultaneous breaches (${latest.anomaly_reason}).`;
    recEl.innerHTML = `👉 <strong>Recommended Action:</strong> Collect physical water samples at monitoring site for laboratory analysis and inspect regional outflow points.`;
  } else if (latest.anomaly_status === "single_anomaly") {
    titleEl.innerHTML = `Explainable Analysis: <span class="text-warning">SINGLE PARAMETER THRESHOLD BREACH</span>`;
    descEl.textContent = `Isolated anomaly detected by ${latest.contributing_sensors.join(", ")}: ${latest.anomaly_reason}`;
    recEl.innerHTML = `👉 <strong>Recommended Action:</strong> Inspect sensor probe surface for fouling or bio-growth and continue continuous automated logging.`;
  } else {
    titleEl.innerHTML = `Explainable Analysis: <span style="color:var(--color-good)">COASTAL WATER QUALITY NOMINAL</span>`;
    descEl.textContent = `All four monitored parameters (pH: ${latest.pH}, TDS: ${Math.round(latest.TDS)} PPM, Turbidity: ${latest.turbidity} NTU, Temp: ${latest.temperature} °C) remain within safe coastal equilibrium boundaries.`;
    recEl.innerHTML = `👉 <strong>Recommended Action:</strong> No intervention required. System maintaining automated telemetry polling.`;
  }
}

// Render Water Quality Measurement History Table
function renderEventsTable() {
  const tbody = document.getElementById("events-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const sorted = [...activeData].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted)">No stored telemetry records match active filters.</td></tr>`;
    return;
  }

  sorted.forEach(row => {
    const tr = document.createElement("tr");

    let statusBadgeHtml = `<span class="live-status" style="background:rgba(16,185,129,0.15); color:var(--color-good); border-color:rgba(16,185,129,0.3)">Nominal Baseline</span>`;
    
    if (row.anomaly_status === "sensor_issue") {
      statusBadgeHtml = `<span class="live-status" style="background:rgba(139,92,246,0.15); color:var(--color-purple); border-color:rgba(139,92,246,0.3)">Sensor Verification</span>`;
    } else if (row.anomaly_status === "multi_anomaly") {
      statusBadgeHtml = `<span class="live-status" style="background:rgba(239,68,68,0.15); color:var(--color-critical); border-color:rgba(239,68,68,0.3)">Multi-Sensor Anomaly</span>`;
    } else if (row.anomaly_status === "single_anomaly") {
      statusBadgeHtml = `<span class="live-status" style="background:rgba(245,158,11,0.15); color:var(--color-warning); border-color:rgba(245,158,11,0.3)">Single Breach</span>`;
    }

    const modeText = row.mode === "live_hardware" ? "⚡ Live Hardware" : "🧪 Sample Mode";

    tr.innerHTML = `
      <td><strong>${modeText}</strong></td>
      <td>${new Date(row.timestamp).toLocaleString()}</td>
      <td style="${row.pH < 6.5 || row.pH > 8.5 ? 'color:var(--color-warning);font-weight:bold' : ''}">${row.pH}</td>
      <td style="${row.turbidity > 50 ? 'color:var(--color-warning);font-weight:bold' : ''}">${row.turbidity} NTU</td>
      <td style="${row.TDS > 500 ? 'color:var(--color-warning);font-weight:bold' : ''}">${Math.round(row.TDS)} PPM</td>
      <td>${row.temperature} °C</td>
      <td>${statusBadgeHtml} <span style="font-size:0.7rem; color:var(--text-secondary); display:block; margin-top:0.15rem">${row.anomaly_reason}</span></td>
      <td>
        <button class="btn btn-outline" style="padding:0.25rem 0.5rem; font-size:0.75rem" onclick="openDeviceDetail('${row.timestamp}')">Diagnostic Log</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Diagnostics & Drilldown Modal View
let detailChart = null;
window.openDeviceDetail = function(timestampStr) {
  const modal = document.getElementById("detail-modal");
  modal.classList.add("active");

  const row = telemetryData.find(d => d.timestamp === timestampStr) || telemetryData[telemetryData.length - 1];

  document.getElementById("modal-device-id").textContent = `AquaTrace Node (${new Date(row.timestamp).toLocaleTimeString()})`;
  document.getElementById("det-status").textContent = row.anomaly_status === "normal" ? "Healthy / Connected" : "Action / Verification Needed";
  document.getElementById("det-status").className = row.anomaly_status === "normal" ? "text-good" : "text-warning";
  document.getElementById("det-battery").textContent = row.mode === "live_hardware" ? "Arduino USB (5V Power)" : "Sample Mode Simulated";
  document.getElementById("det-signal").textContent = telemetryData.length >= 5 ? "88% (High Confidence)" : "Warning: Insufficient Data (< 5 Points)";
  document.getElementById("det-pollution-index").textContent = (row.anomaly_status || "normal").toUpperCase();
  document.getElementById("det-source").textContent = row.anomaly_reason;

  // Serial Terminal Monitor Log Generation
  const serialMonitor = document.getElementById("serial-monitor-log");
  serialMonitor.innerHTML = "";
  
  const serialLines = [
    `[SYS] AquaTrace Microcontroller Firmware v3.2.0 Booting...`,
    `[SYS] I2C Bus Scan: 20x4 LCD Display at Address 0x27 - OK`,
    `[SEN] Reading DS18B20 Temp Probe... ${row.temperature} C - OK`,
    `[SEN] Reading pH Sensor Analog A0... ${row.pH} - ${row.pH > 14 ? 'OUT OF BOUNDS (CALIBRATION REQ)' : 'OK'}`,
    `[SEN] Reading TDS Meter Analog A1... ${Math.round(row.TDS)} PPM - OK`,
    `[SEN] Reading Turbidity Sensor Analog A2... ${row.turbidity} NTU - ${row.turbidity > 50 ? 'ELEVATED' : 'OK'}`,
    `[LCD] Update Line 1: pH:${row.pH} T:${row.temperature}C`,
    `[LCD] Update Line 2: TDS:${Math.round(row.TDS)} PPM Turb:${row.turbidity}NTU`,
    `[SYS] Telemetry Frame Processed: Anomaly Status = ${row.anomaly_status.toUpperCase()}`
  ];

  serialLines.forEach((line) => {
    const lineEl = document.createElement("div");
    lineEl.className = "serial-line";
    if (line.includes("OUT OF BOUNDS") || line.includes("ELEVATED") || line.includes("ANOMALY")) {
      lineEl.classList.add("serial-alert");
    }
    lineEl.innerHTML = `<span class="serial-timestamp">[${new Date(row.timestamp).toLocaleTimeString()}]</span> ${line}`;
    serialMonitor.appendChild(lineEl);
  });

  // Render Prediction vs Actual Detailed Line Chart
  const ctx = document.getElementById("chart-detail").getContext("2d");
  if (detailChart) detailChart.destroy();

  const sorted = [...telemetryData].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
  const phVals = sorted.map(d => d.pH);
  const tdsVals = sorted.map(d => d.TDS / 100); // scaled for dual display

  detailChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: sorted.map(d => new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      datasets: [
        {
          label: "pH Level",
          data: phVals,
          borderColor: "#38bdf8",
          backgroundColor: "rgba(56, 189, 248, 0.05)"
        },
        {
          label: "TDS Level (PPM / 100)",
          data: tdsVals,
          borderColor: "#a78bfa",
          backgroundColor: "rgba(167, 139, 250, 0.05)"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#94a3b8" }
        },
        x: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#94a3b8" }
        }
      }
    }
  });
};

// Filter & Data Selection Handler
function filterAndRender() {
  activeData = telemetryData.filter(d => {
    const devMatch = (selectedDeviceFilter === "all" || d.mode === selectedDeviceFilter);
    const srcMatch = (selectedSourceFilter === "all" || d.anomaly_status === selectedSourceFilter);
    
    // Time filter logic
    let timeMatch = true;
    if (selectedTimeFilter !== "all") {
      const rowDate = new Date(d.timestamp);
      const now = new Date();
      const diffHours = (now - rowDate) / (1000 * 60 * 60);

      if (selectedTimeFilter === "24h" && diffHours > 24) timeMatch = false;
      if (selectedTimeFilter === "7d" && diffHours > 24 * 7) timeMatch = false;
      if (selectedTimeFilter === "30d" && diffHours > 24 * 30) timeMatch = false;
    }

    return devMatch && srcMatch && timeMatch;
  });

  updateCharts();
  renderEventsTable();
}

// Toast Notification Engine
function showToast(title, text, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  let icon = "🔔";
  if (type === "danger") icon = "🚨";
  if (type === "warning") icon = "⚠️";

  toast.innerHTML = `
    <div style="font-size: 1.25rem">${icon}</div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-text">${text}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;

  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px)";
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// Trigger Intelligent Alerts System
function triggerIntelligentAlerts(row) {
  const alertListEl = document.getElementById("alerts-list");
  if (!alertListEl) return;

  if (row.anomaly_status !== "normal") {
    const placeholder = alertListEl.querySelector(".placeholder-alert");
    if (placeholder) placeholder.remove();

    const item = document.createElement("div");
    const isDanger = row.severity === "high";
    item.className = `alert-item alert-${isDanger ? "danger" : "warning"}`;
    
    const icon = isDanger ? "🚨" : "⚠️";

    item.innerHTML = `
      <div class="alert-item-icon">${icon}</div>
      <div class="alert-item-body">
        <strong>${row.anomaly_status.toUpperCase().replace("_", " ")} (${row.severity.toUpperCase()})</strong>
        <span>${row.anomaly_reason}</span>
        <span class="alert-item-time">${new Date(row.timestamp).toLocaleTimeString()}</span>
      </div>
    `;
    alertListEl.insertBefore(item, alertListEl.firstChild);
    showToast(`System Alert: ${row.anomaly_status.replace("_", " ")}`, row.anomaly_reason, isDanger ? "danger" : "warning");
  }
}

// Sample Mode Streaming Engine
function startSimulation() {
  isSimulating = true;
  document.getElementById("btn-play").innerHTML = "⏸ Pause Sample Stream";
  document.getElementById("live-indicator").innerHTML = `<span class="pulse-dot"></span> STREAMING SAMPLES`;
  document.getElementById("live-indicator").style.color = "var(--color-good)";
  document.getElementById("live-indicator").style.borderColor = "rgba(16, 185, 129, 0.25)";

  simulationInterval = setInterval(() => {
    const newRow = generateNextSampleReading();
    telemetryData.push(newRow);

    if (telemetryData.length > 50) telemetryData.shift();

    filterAndRender();
    renderDashboard();
    triggerIntelligentAlerts(newRow);
  }, simulationSpeed);
}

function stopSimulation() {
  isSimulating = false;
  clearInterval(simulationInterval);
  document.getElementById("btn-play").innerHTML = "▶ Play Sample Stream";
  document.getElementById("live-indicator").innerHTML = `⏹ OFFLINE`;
  document.getElementById("live-indicator").style.color = "var(--text-muted)";
  document.getElementById("live-indicator").style.borderColor = "var(--glass-border)";
}

function resetData() {
  stopSimulation();
  telemetryData = [...INITIAL_TELEMETRY_DATA];
  evaluateAllTelemetryAnomalies();
  filterAndRender();
  renderDashboard();
  document.getElementById("alerts-list").innerHTML = `<div class="placeholder-alert" style="text-align:center; padding:1.5rem; color:var(--text-muted)">No active threshold alerts.</div>`;
  showToast("Database Reset", "Restored initial experimental and sample dataset.", "info");
}

function generateNextSampleReading() {
  const lastTime = new Date(telemetryData[telemetryData.length - 1].timestamp);
  const nextTime = new Date(lastTime.getTime() + 60 * 60 * 1000);

  const isAnomalous = Math.random() > 0.75;
  let pH = 7.2 + (Math.random() * 0.8 - 0.4);
  let turbidity = 10.0 + Math.random() * 15.0;
  let TDS = 320 + Math.random() * 60;
  let temperature = 28.0 + Math.random() * 2.0;

  if (isAnomalous) {
    const rnd = Math.random();
    if (rnd < 0.5) {
      pH = 9.2 + Math.random() * 1.5;
      TDS = 650 + Math.random() * 200;
    } else {
      turbidity = 75.0 + Math.random() * 100.0;
    }
  }

  const row = {
    timestamp: nextTime.toISOString(),
    mode: "sample_mode",
    pH: parseFloat(pH.toFixed(1)),
    turbidity: parseFloat(turbidity.toFixed(1)),
    TDS: Math.round(TDS),
    temperature: parseFloat(temperature.toFixed(1))
  };

  return analyzeReadingAnomaly(row);
}

// Mode Switcher (Live Hardware vs Sample Mode)
function toggleLiveHardwareMode() {
  isLiveHardware = !isLiveHardware;
  const badge = document.getElementById("data-mode-badge");
  const modeToggleBtn = document.getElementById("btn-toggle-mode");
  const hwStatus = document.getElementById("hw-conn-status");

  if (isLiveHardware) {
    badge.textContent = "Live Hardware Mode";
    badge.style.background = "rgba(16, 185, 129, 0.15)";
    badge.style.borderColor = "var(--color-good)";
    badge.style.color = "var(--color-good)";
    modeToggleBtn.textContent = "🧪 Switch to Sample Mode";
    hwStatus.textContent = "Listening for Serial Packet...";
    showToast("Mode Changed", "Switched to Live Arduino Hardware Mode. Connect WebSerial port below.", "info");
  } else {
    badge.textContent = "Sample Mode";
    badge.style.background = "rgba(14, 165, 233, 0.15)";
    badge.style.borderColor = "var(--color-blue)";
    badge.style.color = "var(--color-blue)";
    modeToggleBtn.textContent = "⚡ Switch to Live Arduino";
    hwStatus.textContent = "Disconnected (Sample Mode)";
    showToast("Mode Changed", "Switched to Sample / Demo Data Mode.", "info");
  }
}

// WebSerial API Integration for Physical Arduino Uno Connection
async function connectWebSerial() {
  if (!("serial" in navigator)) {
    showToast("Browser Limitation", "WebSerial API is supported in Chrome, Edge, and Opera browsers. Please use a compatible browser to link physical Arduino.", "warning");
    return;
  }

  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 9600 });

    document.getElementById("hw-conn-status").textContent = "Connected (9600 Baud)";
    document.getElementById("hw-conn-status").style.color = "var(--color-good)";
    document.getElementById("hw-port-name").textContent = "Arduino COM Port (Active)";
    
    showToast("Arduino Linked", "Serial port connection established successfully!", "info");
    
    // Start serial reading loop
    serialStartTime = Date.now();
    startUptimeCounter();
    readSerialDataStream();

  } catch (err) {
    console.error("WebSerial Error:", err);
    serialErrorCount++;
    document.getElementById("hw-error-count").textContent = `${serialErrorCount} Errors`;
    showToast("Serial Error", "Failed to connect to Serial Port: " + err.message, "danger");
  }
}

async function readSerialDataStream() {
  const textDecoder = new TextDecoderStream();
  const readableStreamClosed = serialPort.readable.pipeTo(textDecoder.writable);
  const reader = textDecoder.readable.getReader();
  serialReader = reader;

  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep last incomplete line

        lines.forEach(line => {
          parseArduinoSerialLine(line.trim());
        });
      }
    }
  } catch (err) {
    console.error("Serial Stream Error:", err);
    serialErrorCount++;
    document.getElementById("hw-error-count").textContent = `${serialErrorCount} Errors`;
  } finally {
    reader.releaseLock();
  }
}

// Parse Incoming Arduino Serial Data Frame (Supports JSON or CSV "pH,turb,tds,temp")
function parseArduinoSerialLine(line) {
  if (!line) return;
  serialPacketCount++;
  document.getElementById("hw-packet-count").textContent = `${serialPacketCount} Packets`;

  try {
    let rawData = {};
    if (line.startsWith("{") && line.endsWith("}")) {
      rawData = JSON.parse(line);
    } else {
      // CSV format fallback e.g. "7.4, 12.0, 350, 28.5"
      const parts = line.split(",");
      if (parts.length >= 4) {
        rawData = {
          pH: parseFloat(parts[0]),
          turbidity: parseFloat(parts[1]),
          TDS: parseFloat(parts[2]),
          temperature: parseFloat(parts[3])
        };
      }
    }

    if (rawData.pH !== undefined) {
      const newReading = {
        timestamp: new Date().toISOString(),
        mode: "live_hardware",
        pH: rawData.pH,
        turbidity: rawData.turbidity || 0,
        TDS: rawData.TDS || 0,
        temperature: rawData.temperature || 25.0
      };

      analyzeReadingAnomaly(newReading);
      telemetryData.push(newReading);
      if (telemetryData.length > 50) telemetryData.shift();

      filterAndRender();
      renderDashboard();
      triggerIntelligentAlerts(newReading);
    }
  } catch (e) {
    serialErrorCount++;
    document.getElementById("hw-error-count").textContent = `${serialErrorCount} Errors`;
  }
}

function startUptimeCounter() {
  if (uptimeInterval) clearInterval(uptimeInterval);
  uptimeInterval = setInterval(() => {
    if (!serialStartTime) return;
    const elapsed = Math.floor((Date.now() - serialStartTime) / 1000);
    const hrs = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const mins = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    document.getElementById("hw-uptime-val").textContent = `${hrs}:${mins}:${secs}`;
  }, 1000);
}

// Export Telemetry History to CSV File
function exportToCSV() {
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "timestamp,mode,pH,turbidity_NTU,TDS_PPM,temperature_C,anomaly_status,anomaly_reason,severity\n";
  
  telemetryData.forEach(row => {
    const r = [
      row.timestamp,
      row.mode,
      row.pH,
      row.turbidity,
      row.TDS,
      row.temperature,
      row.anomaly_status,
      `"${(row.anomaly_reason || "").replace(/"/g, '""')}"`,
      row.severity
    ];
    csvContent += r.join(",") + "\n";
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `aquatrace_water_quality_export_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("CSV Export", "Downloaded AquaTrace telemetry CSV dataset.", "info");
}
