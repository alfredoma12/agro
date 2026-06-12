const API_URL = "https://reception-holland-tcp-defensive.trycloudflare.com";

// ── BUG FIX: leer token/device de localStorage de forma segura
let token  = null;
let device = null;

try {
  token  = localStorage.getItem("token");
  device = localStorage.getItem("device");
} catch (_) { /* entorno sin localStorage */ }

let loadInterval    = null;
let trendChart      = null;
let trendHistory    = { timestamps: [], temperatura: [], humedad_aire: [], humedad_tierra: [] };
let trendHistoryRaw = [];
let trendHistoryFullRange = null; // Guardará los datos completos para filtros de rango

const HISTORY_STORAGE_KEY      = 'dashboard-history';
let AUTO_REFRESH_INTERVAL_MS = 30000;
let currentConfigSubview = 'general';
let currentView = 'resumen';

// ── PLANT PROFILES ───────────────────────────────────────────────────────────

const PLANT_PROFILES_STORAGE_KEY = 'cfg-plant-profile';
const WATER_ALERT_STATE_KEY      = 'water-alert-last-state';

// Rangos definidos por el usuario.
// Orden de cada rango: [min, max]
const PLANT_PRESETS = {
  cactus: {
    label: '🌵 Cactus',
    tempLabel: 'Cálida (15°C – 30°C)',
    temp:   [15, 30],
    aire:   [10, 30],
    tierra: [5, 15]
  },
  ruda_templada: {
    label: '🌿 Ruda (clima templado)',
    tempLabel: 'Templada (10°C – 25°C)',
    temp:   [10, 25],
    aire:   [30, 50],
    tierra: [20, 40]
  },
  filodendro: {
    label: '🌿 Filodendro (clima cálido)',
    tempLabel: 'Cálida (18°C – 25°C)',
    temp:   [18, 25],
    aire:   [30, 50],
    tierra: [50, 80]
  },
  custom: {
    label: '⚙️ Personalizado',
    tempLabel: 'Personalizado',
    temp:   [null, null],
    aire:   [null, null],
    tierra: [null, null]
  }
};

function loadPlantProfile() {
  try {
    const stored = localStorage.getItem(PLANT_PROFILES_STORAGE_KEY);
    if (!stored) return { preset: 'cactus', custom: { temp: [null, null], aire: [null, null], tierra: [null, null] }, plantName: '' };
    const parsed = JSON.parse(stored);
    return {
      preset: parsed.preset || 'cactus',
      custom: parsed.custom || { temp: [null, null], aire: [null, null], tierra: [null, null] },
      plantName: parsed.plantName || ''
    };
  } catch {
    return { preset: 'cactus', custom: { temp: [null, null], aire: [null, null], tierra: [null, null] }, plantName: '' };
  }
}

function savePlantProfile(profile) {
  try { localStorage.setItem(PLANT_PROFILES_STORAGE_KEY, JSON.stringify(profile)); } catch (_) {}
}

// Devuelve los rangos activos (preset o personalizado)
function getActiveThresholds() {
  const profile = loadPlantProfile();
  if (profile.preset === 'custom') {
    return {
      temp:   profile.custom.temp   || [null, null],
      aire:   profile.custom.aire   || [null, null],
      tierra: profile.custom.tierra || [null, null]
    };
  }
  const preset = PLANT_PRESETS[profile.preset] || PLANT_PRESETS.cactus;
  return { temp: preset.temp, aire: preset.aire, tierra: preset.tierra };
}

// ── PLANT PROFILE UI ────────────────────────────────────────────────────────

function setupPlantProfileUI() {
  const presetSel  = document.getElementById('plant-preset');
  const nameInput  = document.getElementById('plant-name');
  const customWrap = document.getElementById('plant-custom-fields');
  if (!presetSel) return;

  const profile = loadPlantProfile();
  presetSel.value = profile.preset;
  if (nameInput) nameInput.value = profile.plantName || '';

  populatePlantInfoBox(profile.preset);
  toggleCustomFields(profile.preset === 'custom');

  if (profile.preset === 'custom') {
    fillCustomInputs(profile.custom);
  }

  presetSel.addEventListener('change', () => {
    const val = presetSel.value;
    populatePlantInfoBox(val);
    toggleCustomFields(val === 'custom');
    if (val === 'custom') {
      const p = loadPlantProfile();
      fillCustomInputs(p.custom);
    }
  });

  function toggleCustomFields(show) {
    if (customWrap) customWrap.style.display = show ? 'block' : 'none';
  }

  function fillCustomInputs(custom) {
    setVal('plant-custom-temp-min',   custom.temp?.[0]);
    setVal('plant-custom-temp-max',   custom.temp?.[1]);
    setVal('plant-custom-aire-min',   custom.aire?.[0]);
    setVal('plant-custom-aire-max',   custom.aire?.[1]);
    setVal('plant-custom-tierra-min', custom.tierra?.[0]);
    setVal('plant-custom-tierra-max', custom.tierra?.[1]);
  }

  function setVal(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = (value === null || value === undefined) ? '' : value;
  }
}

function populatePlantInfoBox(presetKey) {
  const box = document.getElementById('plant-info-box');
  if (!box) return;
  if (presetKey === 'custom') {
    box.innerHTML = '<div class="plant-info-row">Define tus propios rangos en los campos a continuación.</div>';
    return;
  }
  const preset = PLANT_PRESETS[presetKey];
  if (!preset) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="plant-info-row"><strong>🌡️ Temperatura ideal:</strong> ${preset.tempLabel}</div>
    <div class="plant-info-row"><strong>☁️ Humedad ambiente ideal:</strong> ${preset.aire[0]}% – ${preset.aire[1]}%</div>
    <div class="plant-info-row"><strong>🌱 Humedad de sustrato ideal:</strong> ${preset.tierra[0]}% – ${preset.tierra[1]}%</div>
  `;
}

function savePlantProfileFromUI() {
  const presetSel = document.getElementById('plant-preset');
  const nameInput = document.getElementById('plant-name');
  const statusEl  = document.getElementById('cfg-plant-status');
  if (!presetSel) return;

  const preset = presetSel.value;
  const profile = {
    preset,
    plantName: nameInput ? nameInput.value.trim() : '',
    custom: {
      temp:   [getNum('plant-custom-temp-min'),   getNum('plant-custom-temp-max')],
      aire:   [getNum('plant-custom-aire-min'),   getNum('plant-custom-aire-max')],
      tierra: [getNum('plant-custom-tierra-min'), getNum('plant-custom-tierra-max')]
    }
  };

  if (preset === 'custom') {
    const allFilled = [...profile.custom.temp, ...profile.custom.aire, ...profile.custom.tierra]
      .every(v => v !== null);
    if (!allFilled) {
      if (statusEl) {
        statusEl.textContent = '❌ Completa todos los rangos personalizados.';
        statusEl.style.color = 'var(--error)';
        statusEl.style.display = 'block';
      }
      return;
    }
  }

  savePlantProfile(profile);

  if (statusEl) {
    statusEl.textContent = '✅ Perfil de planta guardado correctamente.';
    statusEl.style.color = 'var(--success)';
    statusEl.style.display = 'block';
    setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
  }

  // Refrescar alertas con los nuevos umbrales
  updateAlerts();

  function getNum(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    const v = el.value.trim();
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
}

// ── ALERTS ────────────────────────────────────────────────────────────────────

// Evalúa un valor contra un rango [min, max] y devuelve 'low' | 'high' | 'ok' | null
function evaluateRange(value, range) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (!range || range[0] === null || range[1] === null) return null;
  if (value < range[0]) return 'low';
  if (value > range[1]) return 'high';
  return 'ok';
}

function buildAlertMessages(current) {
  const thresholds = getActiveThresholds();
  const alerts = [];

  // Temperatura
  const tempState = evaluateRange(current.temperatura, thresholds.temp);
  if (tempState === 'low')  alerts.push({ level: 'warn', icon: '🥶', text: `Temperatura muy baja (${current.temperatura}°C). Rango ideal: ${thresholds.temp[0]}°C – ${thresholds.temp[1]}°C.` });
  if (tempState === 'high') alerts.push({ level: 'warn', icon: '🥵', text: `Temperatura muy alta (${current.temperatura}°C). Rango ideal: ${thresholds.temp[0]}°C – ${thresholds.temp[1]}°C.` });

  // Humedad aire
  const aireState = evaluateRange(current.humedad_aire, thresholds.aire);
  if (aireState === 'low')  alerts.push({ level: 'warn', icon: '🍂', text: `Humedad ambiental muy baja (${current.humedad_aire}%). Rango ideal: ${thresholds.aire[0]}% – ${thresholds.aire[1]}%. Riesgo de puntas quemadas y plagas (ácaros).` });
  if (aireState === 'high') alerts.push({ level: 'warn', icon: '💧', text: `Humedad ambiental muy alta (${current.humedad_aire}%). Rango ideal: ${thresholds.aire[0]}% – ${thresholds.aire[1]}%. Riesgo de hongos foliares.` });

  // Humedad tierra
  const tierraState = evaluateRange(current.humedad_tierra, thresholds.tierra);
  if (tierraState === 'low')  alerts.push({ level: 'critical', icon: '🚱', text: `Humedad de sustrato muy baja (${current.humedad_tierra}%). Rango ideal: ${thresholds.tierra[0]}% – ${thresholds.tierra[1]}%. ¡Riega la planta!` });
  if (tierraState === 'high') alerts.push({ level: 'critical', icon: '🌊', text: `Humedad de sustrato muy alta (${current.humedad_tierra}%). Rango ideal: ${thresholds.tierra[0]}% – ${thresholds.tierra[1]}%. Riesgo de pudrición radicular. No riegues.` });

  return { alerts, tierraState };
}

function renderAlerts(alerts) {
  const container = document.getElementById('alerts-container');
  if (!container) return;

  if (!alerts.length) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  container.innerHTML = alerts.map(a => `
    <div class="alert-banner ${a.level === 'critical' ? 'alert-critical' : 'alert-warn'}">
      <span class="alert-icon">${a.icon}</span>
      <span class="alert-text">${a.text}</span>
    </div>
  `).join('');
}

// Notificación del navegador cuando la humedad de tierra está muy baja
function maybeNotifyWatering(tierraState) {
  let lastState = null;
  try { lastState = localStorage.getItem(WATER_ALERT_STATE_KEY); } catch (_) {}

  if (tierraState === 'low') {
    if (lastState !== 'low') {
      sendWaterNotification();
    }
    try { localStorage.setItem(WATER_ALERT_STATE_KEY, 'low'); } catch (_) {}
  } else {
    try { localStorage.setItem(WATER_ALERT_STATE_KEY, tierraState || 'ok'); } catch (_) {}
  }
}

function sendWaterNotification() {
  const title = '🚱 ¡Tu planta necesita agua!';
  const body  = 'La humedad del sustrato está por debajo del rango ideal. Riega tu planta pronto.';

  if (!('Notification' in window)) return;

  if (Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: '🌱' }); } catch (_) {}
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        try { new Notification(title, { body, icon: '🌱' }); } catch (_) {}
      }
    });
  }
}

// Recalcula las alertas usando la última lectura disponible
function updateAlerts() {
  const current = getLatestReadingValues();
  if (!current) {
    renderAlerts([]);
    return;
  }
  const { alerts, tierraState } = buildAlertMessages(current);
  renderAlerts(alerts);
  maybeNotifyWatering(tierraState);
}

function getLatestReadingValues() {
  if (!trendHistory.timestamps.length) return null;
  const i = trendHistory.timestamps.length - 1;
  return {
    temperatura:    trendHistory.temperatura[i],
    humedad_aire:   trendHistory.humedad_aire[i],
    humedad_tierra: trendHistory.humedad_tierra[i]
  };
}

// ── UTILS ─────────────────────────────────────────────────────────────────────

function validateInput(value, type = 'text') {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (type === 'password') return trimmed.length >= 6;
  return trimmed.length >= 3;
}

function normalizeValue(value) {
  if (value === null || value === undefined) return NaN;
  const normalized = String(value).replace(/,/g, '.').replace(/[^0-9.\-]/g, '').trim();
  return normalized.length ? parseFloat(normalized) : NaN;
}

function normalizeVariableName(variable) {
  const name = String(variable || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (/temp(eratura)?(\b|$)|°c|celsius|temperature|temp\b/.test(name)) return 'temperatura';

  const tierraPatterns = /humedad.*(tierra|suelo|sustrato)|(?:tierra|suelo|sustrato).*(humedad)|(^|[_\s-])(tierra|suelo|sustrato)([_\s-]|$)|soil.*(moisture|humidity)|(?:moisture|humidity).*(soil|ground)/;
  const airePatterns   = /humedad.*(aire|ambient|ambiente)|(?:aire|ambient|ambiente).*(humedad)|air.*humidity|humidity.*air/;

  if (tierraPatterns.test(name) && !/tierra[_\s-]*bruta|bruta|bruto|raw/.test(name)) return 'humedad_tierra';
  if (airePatterns.test(name)) return 'humedad_aire';

  if (/humedad/.test(name)) {
    if (/(tierra|suelo|soil|ground|sustrato)/.test(name)) return 'humedad_tierra';
    return 'humedad_aire';
  }

  return null;
}

// Asigna clase CSS a la reading-card según el tipo de variable
function variableCardClass(variable) {
  const key = normalizeVariableName(variable) || '';
  if (key === 'temperatura')   return 'temp';
  if (key === 'humedad_aire')  return 'aire';
  if (key === 'humedad_tierra') return 'tierra';
  return 'other';
}

function variableEmoji(variable) {
  const key = normalizeVariableName(variable) || String(variable || '').toLowerCase();
  if (/temp|temperatura|°c|celsius/.test(key))           return '☀️';
  if (/humedad_aire|aire|ambiente|ambient/.test(key))     return '☁️';
  if (/humedad_tierra|tierra|suelo|sustrato|soil/.test(key)) return '🌱';
  return '';
}

// ── TIMESTAMP HELPERS ─────────────────────────────────────────────────────────

function parseSensorTimestamp(data) {
  if (!data || typeof data !== 'object') return null;
  const fields = ['timestamp', 'updated_at', 'created_at', 'fecha', 'date', 'hora', 'time'];
  for (const field of fields) {
    if (data[field]) {
      const parsed = parseTimestampValue(data[field]);
      if (parsed) return parsed.toISOString();
    }
  }
  if (Array.isArray(data.lecturas)) {
    for (const lectura of data.lecturas) {
      if (!lectura || typeof lectura !== 'object') continue;
      for (const field of fields) {
        if (lectura[field]) {
          const parsed = parseTimestampValue(lectura[field]);
          if (parsed) return parsed.toISOString();
        }
      }
    }
  }
  return null;
}

function parseTimestampValue(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  const value = String(raw).trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const normalized = value.replace(/\//g, '-');
  let match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})[ T]([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?/.exec(normalized);
  if (match) return parseSantiagoLocalTime(match[1], match[2], match[3], match[4], match[5], match[6] || '00');
  match = /^([0-9]{2})-([0-9]{2})-([0-9]{4})[ T]([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?/.exec(normalized);
  if (match) return parseSantiagoLocalTime(match[3], match[2], match[1], match[4], match[5], match[6] || '00');
  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function parseSantiagoLocalTime(year, month, day, hour, minute, second = '00') {
  const utcCandidate = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
  const offsetMs = getTimeZoneOffsetMs('America/Santiago', utcCandidate);
  return new Date(utcCandidate.getTime() - offsetMs);
}

function getTimeZoneOffsetMs(timeZone, date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - date.getTime();
}

// ── HISTORY PERSISTENCE ───────────────────────────────────────────────────────

function loadChartHistory() {
  try {
    const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!stored) return { timestamps: [], temperatura: [], humedad_aire: [], humedad_tierra: [] };
    const parsed = JSON.parse(stored);
    return {
      timestamps:    Array.isArray(parsed.timestamps)    ? parsed.timestamps    : [],
      temperatura:   Array.isArray(parsed.temperatura)   ? parsed.temperatura   : [],
      humedad_aire:  Array.isArray(parsed.humedad_aire)  ? parsed.humedad_aire  : [],
      humedad_tierra: Array.isArray(parsed.humedad_tierra) ? parsed.humedad_tierra : [],
      rawLecturas:   Array.isArray(parsed.rawLecturas)   ? parsed.rawLecturas   : []
    };
  } catch {
    return { timestamps: [], temperatura: [], humedad_aire: [], humedad_tierra: [] };
  }
}

function saveChartHistory() {
  try {
    const toStore = { ...trendHistory, rawLecturas: Array.isArray(trendHistoryRaw) ? trendHistoryRaw : [] };
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(toStore));
  } catch { /* cuota excedida u otro error */ }
}

// ── TELEMETRY PARSING ─────────────────────────────────────────────────────────

function parseTelemetryHistory(payload) {
  let items  = [];
  const points = {};

  if (Array.isArray(payload)) {
    items = payload;
  } else if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.lecturas)) {
      items = payload.lecturas;
    } else {
      for (const key of ['telemetria', 'historial', 'data', 'registros', 'records', 'items']) {
        if (Array.isArray(payload[key])) { items = payload[key]; break; }
      }
    }

    if (!items.length) {
      const nested = Object.values(payload).find(v => Array.isArray(v));
      if (Array.isArray(nested)) items = nested;

      const ts    = payload.timestamps || payload.fechas || payload.dates;
      const sTemp = payload.temperatura || payload.temp || payload.temperature;
      const sAire = payload.humedad_aire || payload.humedad_ambiente || payload.humidity_air || payload.humidity;
      const sTierra = payload.humedad_tierra || payload.humedad_suelo || payload.soil_humidity || payload.soil_moisture;

      if (Array.isArray(ts) && (Array.isArray(sTemp) || Array.isArray(sAire) || Array.isArray(sTierra))) {
        const maxLen = Math.max(ts.length,
          Array.isArray(sTemp)   ? sTemp.length   : 0,
          Array.isArray(sAire)   ? sAire.length   : 0,
          Array.isArray(sTierra) ? sTierra.length : 0);
        for (let i = 0; i < maxLen; i++) {
          const t = new Date(ts[i]);
          if (Number.isNaN(t.getTime())) continue;
          const timestamp = t.toISOString();
          points[timestamp] = {
            temperatura:    Array.isArray(sTemp)   ? normalizeValue(sTemp[i])   : null,
            humedad_aire:   Array.isArray(sAire)   ? normalizeValue(sAire[i])   : null,
            humedad_tierra: Array.isArray(sTierra) ? normalizeValue(sTierra[i]) : null
          };
        }
      }
    }
  }

  items.forEach(lectura => {
    if (!lectura || typeof lectura !== 'object') return;
    const timestamp = parseSensorTimestamp(lectura);
    if (!timestamp) return;
    const key = normalizeVariableName(
      lectura.variable || lectura.name || lectura.tipo || lectura.sensor || lectura.nombre || lectura.key || ''
    );
    if (!key) return;
    const rawValue = lectura.valor ?? lectura.value ?? lectura.reading ?? lectura.medida ?? lectura.data ?? lectura.val;
    const value = normalizeValue(rawValue);
    if (Number.isNaN(value)) return;
    if (!points[timestamp]) points[timestamp] = { temperatura: null, humedad_aire: null, humedad_tierra: null };
    points[timestamp][key] = value;
  });

  const timestamps = Object.keys(points).sort();
  const result = { timestamps: [], temperatura: [], humedad_aire: [], humedad_tierra: [] };
  timestamps.slice(-96).forEach(ts => {
    result.timestamps.push(ts);
    result.temperatura.push(points[ts].temperatura);
    result.humedad_aire.push(points[ts].humedad_aire);
    result.humedad_tierra.push(points[ts].humedad_tierra);
  });
  return result;
}

// ── CHART ─────────────────────────────────────────────────────────────────────

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleTimeString('es-CL', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Santiago'
  });
}

function updateTrendChartData() {
  if (!trendChart) return;
  trendChart.data.labels                   = trendHistory.timestamps.map(formatTimestamp);
  trendChart.data.datasets[0].data         = trendHistory.temperatura;
  trendChart.data.datasets[1].data         = trendHistory.humedad_aire;
  trendChart.data.datasets[2].data         = trendHistory.humedad_tierra;
  trendChart.update();
}

function filterChartByRange(hours) {
  // Si trendHistoryFullRange no está inicializado, hacerlo ahora
  if (!trendHistoryFullRange) {
    trendHistoryFullRange = JSON.parse(JSON.stringify(trendHistory));
  }

  // Si hours === 0, mostrar todo
  if (hours === 0) {
    trendHistory = JSON.parse(JSON.stringify(trendHistoryFullRange));
  } else {
    // Calcular la fecha límite (hace N horas)
    const now = Date.now();
    const limitMs = now - (hours * 60 * 60 * 1000);

    // Filtrar los índices que cumplen con el rango
    const indices = trendHistoryFullRange.timestamps
      .map((ts, idx) => new Date(ts).getTime() >= limitMs ? idx : -1)
      .filter(idx => idx !== -1);

    // Construir los datos filtrados
    trendHistory = {
      timestamps: indices.map(idx => trendHistoryFullRange.timestamps[idx]),
      temperatura: indices.map(idx => trendHistoryFullRange.temperatura[idx]),
      humedad_aire: indices.map(idx => trendHistoryFullRange.humedad_aire[idx]),
      humedad_tierra: indices.map(idx => trendHistoryFullRange.humedad_tierra[idx])
    };
  }

  // Actualizar el gráfico
  updateTrendChartData();

  // Actualizar botones activos
  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.classList.remove('active');
    if (String(btn.dataset.range) === String(hours)) {
      btn.classList.add('active');
    }
  });
}

function setupChartRangeButtons() {
  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const hours = parseInt(btn.dataset.range);
      filterChartByRange(hours);
    });
  });
}

function createTrendChart() {
  const canvasEl = document.getElementById('trend-chart');
  if (!canvasEl) return;
  const ctx = canvasEl.getContext('2d');
  if (trendChart) { trendChart.destroy(); trendChart = null; }

  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: trendHistory.timestamps.map(formatTimestamp),
      datasets: [
        {
          label: 'Temperatura',
          data: trendHistory.temperatura,
          borderColor: '#f4a261',
          backgroundColor: 'rgba(244,162,97,0.12)',
          tension: 0.35, fill: false, pointRadius: 2, borderWidth: 2
        },
        {
          label: 'Humedad aire',
          data: trendHistory.humedad_aire,
          borderColor: '#90e0ef',
          backgroundColor: 'rgba(144,224,239,0.12)',
          tension: 0.35, fill: false, pointRadius: 2, borderWidth: 2
        },
        {
          label: 'Humedad tierra',
          data: trendHistory.humedad_tierra,
          borderColor: '#40916c',
          backgroundColor: 'rgba(64,145,108,0.12)',
          tension: 0.35, fill: false, pointRadius: 2, borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      // ── BUG FIX: maintainAspectRatio=false para que el canvas use
      //    la altura del contenedor .chart-wrap en lugar de calcularla
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false } // leyenda propia en HTML
      },
      scales: {
        x: {
          ticks: { color: '#8a7e72', font: { size: 11 }, maxTicksLimit: 10 },
          grid:  { color: 'rgba(221,213,200,0.5)' }
        },
        y: {
          ticks: { color: '#8a7e72', font: { size: 11 } },
          grid:  { color: 'rgba(221,213,200,0.5)' }
        }
      }
    }
  });
}

// ── HISTORY TABLE ─────────────────────────────────────────────────────────────

function formatDateCL(ts) {
  return new Date(ts).toLocaleDateString('es-CL',
    { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Santiago' });
}

function formatTimeCL(ts) {
  return new Date(ts).toLocaleTimeString('es-CL',
    { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Santiago' });
}

function renderHistoryTable(filter = { type: 'all' }) {
  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;

  const rows = [];

  if (Array.isArray(trendHistoryRaw) && trendHistoryRaw.length) {
    const points = {};
    for (const lectura of trendHistoryRaw) {
      const rawTs = lectura.fecha || lectura.date || lectura.timestamp || lectura.created_at || lectura.updated_at;
      const tsObj = new Date(rawTs);
      if (Number.isNaN(tsObj.getTime())) continue;
      tsObj.setSeconds(0, 0);
      const ts = tsObj.toISOString();
      if (!points[ts]) points[ts] = { temperatura: null, humedad_aire: null, humedad_tierra: null };
      const varKey = normalizeVariableName(
        lectura.variable || lectura.name || lectura.tipo || lectura.sensor || lectura.nombre || lectura.key || ''
      );
      const val = normalizeValue(lectura.valor ?? lectura.value ?? lectura.reading ?? lectura.medida ?? lectura.data ?? lectura.val);
      if (!Number.isNaN(val) && varKey) points[ts][varKey] = val;
    }
    for (const ts of Object.keys(points).sort()) {
      rows.push({ timestamp: ts, date: formatDateCL(ts), time: formatTimeCL(ts), ...points[ts] });
    }
  } else {
    for (let i = 0; i < trendHistory.timestamps.length; i++) {
      const ts = trendHistory.timestamps[i];
      rows.push({
        timestamp: ts, date: formatDateCL(ts), time: formatTimeCL(ts),
        humedad_tierra: trendHistory.humedad_tierra[i],
        temperatura:    trendHistory.temperatura[i],
        humedad_aire:   trendHistory.humedad_aire[i]
      });
    }
  }

  // Aplicar filtro
  const now = new Date();
  let filtered = rows;
  if (filter.type === 'last3') {
    const cutoff = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    filtered = rows.filter(r => new Date(r.timestamp) >= cutoff);
  } else if (filter.type === 'today') {
    const todayStr = now.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
    filtered = rows.filter(r => r.date === todayStr);
  } else if (filter.type === 'custom' && filter.date) {
    const targetStr = new Date(filter.date + 'T00:00:00').toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
    if (filter.from && filter.to) {
      const fromTs = new Date(filter.date + 'T' + filter.from + ':00');
      const toTs   = new Date(filter.date + 'T' + filter.to   + ':00');
      filtered = rows.filter(r => { const t = new Date(r.timestamp); return t >= fromTs && t <= toTs; });
    } else {
      filtered = rows.filter(r => r.date === targetStr);
    }
  }

  tbody.innerHTML = '';
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:18px;color:var(--muted);text-align:center;">Sin datos para el filtro seleccionado.</td></tr>';
    return;
  }

  filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  for (const r of filtered) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Fecha">${r.date}</td>
      <td data-label="Hora">${r.time}</td>
      <td data-label="🌱 Tierra">${r.humedad_tierra ?? '—'}</td>
      <td data-label="☀️ Temperatura">${r.temperatura ?? '—'}</td>
      <td data-label="☁️ Humedad aire">${r.humedad_aire ?? '—'}</td>
    `;
    tbody.appendChild(tr);
  }
}

function applyHistoryFilterFromUI() {
  const sel  = document.getElementById('history-filter');
  const type = sel ? sel.value : 'all';
  const date = document.getElementById('filter-date')?.value;
  const from = document.getElementById('filter-from')?.value;
  const to   = document.getElementById('filter-to')?.value;
  const filter = { type };
  if (date) filter.date = date;
  if (from) filter.from = from;
  if (to)   filter.to   = to;
  renderHistoryTable(filter);
}

function setupHistoryFilterUI() {
  const sel    = document.getElementById('history-filter');
  const dateEl = document.getElementById('filter-date');
  const fromEl = document.getElementById('filter-from');
  const toEl   = document.getElementById('filter-to');
  const applyBtn = document.getElementById('filter-apply');
  const resetBtn = document.getElementById('filter-reset');
  if (!sel) return;

  const toggleCustom = v => {
    const show = v === 'custom';
    dateEl.style.display = show ? 'inline-block' : 'none';
    fromEl.style.display = show ? 'inline-block' : 'none';
    toEl.style.display   = show ? 'inline-block' : 'none';
  };

  sel.addEventListener('change', () => toggleCustom(sel.value));
  applyBtn?.addEventListener('click', applyHistoryFilterFromUI);
  resetBtn?.addEventListener('click', () => {
    sel.value    = 'all';
    dateEl.value = '';
    fromEl.value = '';
    toEl.value   = '';
    toggleCustom('all');
    renderHistoryTable({ type: 'all' });
  });
}

// ── UI HELPERS ────────────────────────────────────────────────────────────────

// ── BUG FIX: showTab usa currentTarget para obtener el botón,
//    no event.target que podría ser un nodo hijo
function showTab(event, tabName) {
  document.querySelectorAll('.form-content').forEach(f => f.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(tabName).classList.add('active');
  // currentTarget es siempre el elemento al que está unido el listener (el botón)
  const btn = event.currentTarget || event.target;
  btn.classList.add('active');
  clearErrors();
  document.getElementById('admin-success')?.classList.remove('show');
}

function switchView(viewName) {
  const views = ['resumen', 'tendencia', 'configuracion'];
  if (!views.includes(viewName)) return;
  currentView = viewName;

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });

  document.querySelectorAll('.view').forEach(view => {
    view.classList.toggle('active', view.id === `view-${viewName}`);
  });

  const configSubnav = document.getElementById('config-subnav');
  if (configSubnav) {
    configSubnav.classList.toggle('collapsed', viewName !== 'configuracion');
  }

  // Reinicializar filtro de rango cuando se va a tendencia
  if (viewName === 'tendencia') {
    filterChartByRange(24); // Mostrar las últimas 24h por defecto
  }

  if (viewName === 'configuracion') {
    switchConfigSubview(currentConfigSubview || 'general');
  } else {
    currentConfigSubview = 'general';
    document.querySelectorAll('.nav-sub-item').forEach(btn => btn.classList.remove('active'));
  }
}

function switchConfigSubview(subviewName) {
  const panels = ['general', 'planta', 'logs'];
  if (!panels.includes(subviewName)) return;
  currentConfigSubview = subviewName;

  document.querySelectorAll('.nav-sub-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.subview === subviewName);
  });

  document.querySelectorAll('.settings-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `config-${subviewName}`);
  });
}

function saveMeasurementInterval() {
  const valueEl = document.getElementById('cfg-interval-value');
  const unitEl = document.getElementById('cfg-interval-unit');
  const statusEl = document.getElementById('cfg-interval-status');
  if (!valueEl || !unitEl || !statusEl) return;

  const value = Number(valueEl.value);
  const unit = unitEl.value;
  if (!Number.isFinite(value) || value <= 0) {
    statusEl.textContent = '❌ Ingresa un intervalo válido.';
    statusEl.style.color = 'var(--error)';
    statusEl.style.display = 'block';
    return;
  }

  // Convertir a segundos para enviar al servidor
  let intervalSeconds = value;
  if (unit === 'minutes') intervalSeconds = value * 60;
  else if (unit === 'hours') intervalSeconds = value * 3600;

  // Validar mínimo de 5 segundos
  if (intervalSeconds < 5) {
    statusEl.textContent = '❌ El intervalo mínimo es 5 segundos.';
    statusEl.style.color = 'var(--error)';
    statusEl.style.display = 'block';
    return;
  }

  // Intentar enviar al servidor
  if (token && device) {
    fetch(`${API_URL}/api/dispositivo/${device}/config`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ intervalo_s: intervalSeconds })
    })
      .then(resp => {
        if (!resp.ok) throw new Error(`Error ${resp.status}`);
        return resp.json();
      })
      .then(data => {
        statusEl.textContent = '✅ Frecuencia de medición actualizada correctamente.';
        statusEl.style.color = 'var(--success)';
        statusEl.style.display = 'block';
        
        // Guardar en localStorage como respaldo
        try {
          localStorage.setItem('cfg-interval', JSON.stringify({ value, unit, seconds: intervalSeconds }));
        } catch (_) {}
        
        setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
      })
      .catch(err => {
        console.error('Error al guardar intervalo:', err);
        statusEl.textContent = '❌ No se pudo actualizar. Se guardó localmente.';
        statusEl.style.color = 'var(--error)';
        statusEl.style.display = 'block';
        
        // Guardar en localStorage como respaldo
        try {
          localStorage.setItem('cfg-interval', JSON.stringify({ value, unit, seconds: intervalSeconds }));
        } catch (_) {}
      });
  } else {
    // Si no hay sesión, solo guardar en localStorage
    try {
      localStorage.setItem('cfg-interval', JSON.stringify({ value, unit, seconds: intervalSeconds }));
      statusEl.textContent = '✅ Intervalo guardado localmente.';
      statusEl.style.color = 'var(--success)';
      statusEl.style.display = 'block';
      setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
    } catch (_) {
      statusEl.textContent = '❌ No se pudo guardar el intervalo.';
      statusEl.style.color = 'var(--error)';
      statusEl.style.display = 'block';
    }
  }
}

function onDashboardRefreshChange() {
  const select = document.getElementById('cfg-dashboard-refresh');
  if (!select) return;

  AUTO_REFRESH_INTERVAL_MS = Number(select.value) || 30000;
  stopAutoRefresh();
  if (token && device) startAutoRefresh();
}

function loadDeviceLogs() {
  const consoleEl = document.getElementById('log-console');
  const statusEl = document.getElementById('log-status');
  if (!consoleEl || !statusEl) return;

  if (!token || !device) {
    consoleEl.innerHTML = '<div class="log-empty">Inicia sesión para ver los logs.</div>';
    statusEl.textContent = '';
    return;
  }

  statusEl.textContent = 'Cargando logs...';
  consoleEl.innerHTML = '<div class="log-empty">Cargando...</div>';

  fetch(`${API_URL}/api/dispositivo/${device}/logs`, { headers: { Authorization: 'Bearer ' + token } })
    .then(resp => {
      if (!resp.ok) throw new Error('No se pudo cargar');
      return resp.json();
    })
    .then(data => {
      let lines = [];
      
      if (Array.isArray(data)) {
        lines = data.map(item => {
          if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return String(item);
          return JSON.stringify(item, null, 2);
        });
      } else if (Array.isArray(data.logs)) {
        lines = data.logs.map(item => {
          if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return String(item);
          return JSON.stringify(item, null, 2);
        });
      } else if (typeof data === 'string') {
        lines = data.split('\n');
      } else if (data && typeof data === 'object') {
        lines = [JSON.stringify(data, null, 2)];
      }
      
      if (!lines.length) lines = ['No hay logs disponibles.'];
      consoleEl.innerHTML = lines.map(line => `<div class="log-line">${line}</div>`).join('');
      statusEl.textContent = 'Logs actualizados';
      if (document.getElementById('log-autoscroll')?.checked) consoleEl.scrollTop = consoleEl.scrollHeight;
      setTimeout(() => { statusEl.textContent = ''; }, 3000);
    })
    .catch(() => {
      consoleEl.innerHTML = '<div class="log-empty">No fue posible cargar los logs.</div>';
      statusEl.textContent = '';
    });
}

function setButtonLoading(buttonId, isLoading) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  btn.disabled = isLoading;
  if (isLoading) {
    btn.innerHTML = '<span class="spinner"></span> Cargando...';
  } else {
    const labels = { 'login-btn': 'Entrar', 'reg-btn': 'Crear cuenta', 'admin-btn': 'Registrar dispositivo' };
    btn.innerHTML = labels[buttonId] || 'Aceptar';
  }
}

function showError(inputId, message) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const errorDiv = input.nextElementSibling;
  if (message) {
    input.classList.add('error');
    if (errorDiv) { errorDiv.textContent = message; errorDiv.classList.add('show'); }
  } else {
    input.classList.remove('error');
    if (errorDiv) errorDiv.classList.remove('show');
  }
}

function clearErrors() {
  document.querySelectorAll('.error-msg').forEach(m => m.classList.remove('show'));
  document.querySelectorAll('input').forEach(i => i.classList.remove('error'));
}

// ── AUTH FLOWS ────────────────────────────────────────────────────────────────

async function doLogin(event) {
  event.preventDefault();
  clearErrors();
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value.trim();
  if (!user) { showError('login-user', 'El usuario es requerido'); return; }
  if (!pass) { showError('login-pass', 'La contraseña es requerida'); return; }
  setButtonLoading('login-btn', true);
  try {
    const response = await fetch(API_URL + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });
    const data = await response.json();
    if (!response.ok) { showError('login-user', data.message || data.error || `Error ${response.status}`); setButtonLoading('login-btn', false); return; }
    if (!data.token)  { showError('login-user', 'Usuario o contraseña incorrectos'); setButtonLoading('login-btn', false); return; }
    token  = data.token;
    device = data.dispositivo_id;
    try { localStorage.setItem('token', token); localStorage.setItem('device', device); } catch (_) {}
    showDashboard();
    startAutoRefresh();
  } catch (e) {
    console.error('Error de login:', e);
    showError('login-user', 'No se pudo conectar con el servidor.');
    setButtonLoading('login-btn', false);
  }
}

async function doRegister(event) {
  event.preventDefault();
  clearErrors();
  const user      = document.getElementById('reg-user').value.trim();
  const pass      = document.getElementById('reg-pass').value.trim();
  const deviceId  = document.getElementById('reg-device').value.trim();
  const tokenAuth = document.getElementById('reg-token').value.trim();
  if (!user)                               { showError('reg-user',   'El usuario es requerido'); return; }
  if (!validateInput(pass, 'password'))    { showError('reg-pass',   'La contraseña debe tener al menos 6 caracteres'); return; }
  if (!deviceId)                           { showError('reg-device', 'El ID del dispositivo es requerido'); return; }
  if (!tokenAuth)                          { showError('reg-token',  'El token es requerido'); return; }
  setButtonLoading('reg-btn', true);
  try {
    const response = await fetch(API_URL + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ username: user, password: pass, dispositivo_id: deviceId, auth_token: tokenAuth })
    });
    const data = await response.json();
    if (!response.ok) { showError('reg-user', data.message || data.error || `Error ${response.status}`); setButtonLoading('reg-btn', false); return; }
    token  = data.token;
    device = data.dispositivo_id;
    try { localStorage.setItem('token', token); localStorage.setItem('device', device); } catch (_) {}
    showDashboard();
    startAutoRefresh();
  } catch (e) {
    console.error('Error de registro:', e);
    showError('reg-user', 'No se pudo conectar con el servidor.');
    setButtonLoading('reg-btn', false);
  }
}

async function doAdminRegisterDevice(event) {
  event.preventDefault();
  clearErrors();
  const adminKey  = document.getElementById('admin-master-key').value.trim();
  const newDevice = document.getElementById('admin-device-id').value.trim();
  const newToken  = document.getElementById('admin-device-token').value.trim();
  const successBox = document.getElementById('admin-success');
  successBox.classList.remove('show');
  if (!adminKey)  { showError('admin-master-key',  'La clave de administrador es obligatoria'); return; }
  if (!newDevice) { showError('admin-device-id',   'Ingresa el ID del dispositivo'); return; }
  if (!newToken)  { showError('admin-device-token', 'Asigna un token al dispositivo'); return; }
  setButtonLoading('admin-btn', true);
  try {
    const response = await fetch(API_URL + '/api/admin/dispositivos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ admin_key: adminKey, dispositivo_id: newDevice, auth_token: newToken })
    });
    const data = await response.json();
    if (!response.ok) { showError('admin-master-key', data.message || data.error || 'Clave inválida o error en servidor'); setButtonLoading('admin-btn', false); return; }
    successBox.innerHTML = `<strong>¡Equipo registrado!</strong><br>ID: ${newDevice}<br>Token: ${newToken}`;
    successBox.classList.add('show');
    document.getElementById('admin-device-id').value    = '';
    document.getElementById('admin-device-token').value = '';
    setButtonLoading('admin-btn', false);
  } catch (e) {
    console.error('Error admin:', e);
    showError('admin-master-key', 'Error de red al conectar con el servidor.');
    setButtonLoading('admin-btn', false);
  }
}

// ── DASHBOARD VISIBILITY ──────────────────────────────────────────────────────

function showDashboard() {
  document.getElementById('auth').style.display = 'none';
  document.getElementById('dash').style.display = 'block';
}

function hideDashboard() {
  document.getElementById('auth').style.display = '';
  document.getElementById('dash').style.display = 'none';
}

// ── DATA LOADING ──────────────────────────────────────────────────────────────

async function load() {
  try {
    if (!trendHistory.timestamps.length) trendHistory = loadChartHistory();

    const response = await fetch(`${API_URL}/api/dispositivo/${device}/actual`, {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!response.ok) {
      if (response.status === 401) { logout(); return; }
      throw new Error('Error al cargar datos');
    }

    const data = await response.json();

    // Device name
    const deviceName = data.dispositivo_id || device || 'Dispositivo';
    document.getElementById('device').innerText       = deviceName;
    document.getElementById('main-title').innerText   = deviceName;

    // Sidebar & status badge
    const isOnline = !!data.online;
    const dot = document.getElementById('sidebar-dot');
    const statusBadge = document.getElementById('status');

    if (isOnline) {
      statusBadge.textContent    = 'ONLINE';
      statusBadge.className      = 'status-badge status-online';
      document.getElementById('status-meta').innerText   = 'Sensor activo — recolectando datos';
      document.getElementById('sensor-status').innerText = 'Activo';
      document.getElementById('sidebar-status-text').innerText = 'Online';
      if (dot) { dot.className = 'status-dot online'; }
    } else {
      statusBadge.textContent    = 'OFFLINE';
      statusBadge.className      = 'status-badge status-offline';
      document.getElementById('status-meta').innerText   = 'Sin conexión — esperando actualización';
      document.getElementById('sensor-status').innerText = 'Offline';
      document.getElementById('sidebar-status-text').innerText = 'Offline';
      if (dot) { dot.className = 'status-dot offline'; }
    }

    // Last update
    const sensorTs = parseSensorTimestamp(data) || new Date().toISOString();
    document.getElementById('last-update').innerText = new Date(sensorTs).toLocaleString('es-CL', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Santiago'
    });

    // Measurement interval / Frecuencia de medición
    const intervalEl = document.getElementById('kpi-interval');
    if (intervalEl) {
      let intervalText = '--';
      const interval = data.measurement_interval || data.intervalo || data.interval || data.frecuencia || data.frequency;
      if (interval) {
        const intervalVal = Number(interval);
        if (Number.isFinite(intervalVal) && intervalVal > 0) {
          if (intervalVal >= 3600) {
            const hours = Math.round(intervalVal / 3600);
            intervalText = `${hours}h`;
          } else if (intervalVal >= 60) {
            const mins = Math.round(intervalVal / 60);
            intervalText = `${mins}m`;
          } else {
            intervalText = `${intervalVal}s`;
          }
        }
      }
      intervalEl.innerText = intervalText;
    }

    // Readings grid
    const readings = Array.isArray(data.lecturas) ? data.lecturas : [];
    const filteredReadings = readings.filter(l => !/tierra[_\s]*bruta|tierra[_\s]*burta/i.test(String(l.variable || '')));
    const grid = document.getElementById('grid');
    grid.innerHTML = '';

    if (filteredReadings.length) {
      filteredReadings.forEach(lectura => {
        const card = document.createElement('div');
        const cssClass = variableCardClass(lectura.variable);
        card.className = `reading-card ${cssClass}`;
        const emoji = variableEmoji(lectura.variable);
        card.innerHTML = `
          <div class="reading-label">${emoji} ${lectura.variable}</div>
          <div class="reading-value">${lectura.valor}</div>
        `;
        grid.appendChild(card);
      });
    } else {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:28px;">Sin lecturas disponibles.</div>';
    }

    // Append to trend history
    trendHistory = loadChartHistory();
    const timestamp = parseSensorTimestamp(data) || new Date().toISOString();
    const current = { temperatura: NaN, humedad_aire: NaN, humedad_tierra: NaN };
    filteredReadings.forEach(l => {
      const key = normalizeVariableName(l.variable);
      if (key) current[key] = normalizeValue(l.valor);
    });

    const lastTs = trendHistory.timestamps[trendHistory.timestamps.length - 1];
    if (!lastTs || lastTs !== timestamp) {
      trendHistory.timestamps.push(timestamp);
      trendHistory.temperatura.push(   Number.isNaN(current.temperatura)    ? null : current.temperatura);
      trendHistory.humedad_aire.push(  Number.isNaN(current.humedad_aire)   ? null : current.humedad_aire);
      trendHistory.humedad_tierra.push(Number.isNaN(current.humedad_tierra) ? null : current.humedad_tierra);
    } else {
      const i = trendHistory.timestamps.length - 1;
      if (!Number.isNaN(current.temperatura))    trendHistory.temperatura[i]    = current.temperatura;
      if (!Number.isNaN(current.humedad_aire))   trendHistory.humedad_aire[i]   = current.humedad_aire;
      if (!Number.isNaN(current.humedad_tierra)) trendHistory.humedad_tierra[i] = current.humedad_tierra;
    }

    while (trendHistory.timestamps.length > 96) {
      trendHistory.timestamps.shift();
      trendHistory.temperatura.shift();
      trendHistory.humedad_aire.shift();
      trendHistory.humedad_tierra.shift();
    }

    saveChartHistory();
    if (!trendChart) createTrendChart();
    
    // Guardar datos completos para filtros de rango
    trendHistoryFullRange = JSON.parse(JSON.stringify(trendHistory));
    updateTrendChartData();

    // Evaluar alertas según el perfil de planta activo
    updateAlerts();

  } catch (error) {
    console.error('Error al cargar datos:', error);
    
    // Fallback: intentar cargar datos cacheados
    const cachedHistory = loadChartHistory();
    if (cachedHistory && cachedHistory.timestamps && cachedHistory.timestamps.length > 0) {
      trendHistory = cachedHistory;
      trendHistoryFullRange = JSON.parse(JSON.stringify(trendHistory));
      if (!trendChart) createTrendChart();
      updateTrendChartData();
      updateAlerts();
      
      document.getElementById('status').textContent = 'OFFLINE (CACHÉ)';
      document.getElementById('status').className   = 'status-badge status-offline';
      document.getElementById('status-meta').innerText   = 'Usando datos cacheados — sin conexión con servidor';
      document.getElementById('sensor-status').innerText = 'Offline';
      const dot = document.getElementById('sidebar-dot');
      if (dot) dot.className = 'status-dot offline';
      return;
    }
    
    // Si no hay caché, mostrar error
    document.getElementById('status').textContent = 'ERROR';
    document.getElementById('status').className   = 'status-badge status-offline';
    document.getElementById('status-meta').innerText   = 'No se pudieron obtener datos del servidor';
    document.getElementById('sensor-status').innerText = 'Error';
    const dot = document.getElementById('sidebar-dot');
    if (dot) dot.className = 'status-dot offline';
  }
}

async function loadHistoricalData() {
  if (!token || !device) return false;

  async function fetchAllLecturas() {
    const all = [];
    const pageSize = 1000;
    let offset = 0;
    try {
      while (true) {
        const url = `${API_URL}/api/lecturas?dispositivo=${encodeURIComponent(device)}&limit=${pageSize}&offset=${offset}`;
        const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
        if (!resp.ok) {
          const resp2 = await fetch(`${API_URL}/api/lecturas`, { headers: { Authorization: 'Bearer ' + token } });
          if (!resp2.ok) return null;
          const body2 = await resp2.json();
          if (Array.isArray(body2)) return body2;
          if (Array.isArray(body2.lecturas)) return body2.lecturas;
          return null;
        }
        const body = await resp.json();
        let pageRows = [];
        if (Array.isArray(body)) pageRows = body;
        else if (Array.isArray(body.lecturas)) pageRows = body.lecturas;
        else if (Array.isArray(body.rows))     pageRows = body.rows;
        else break;
        if (!pageRows.length) break;
        all.push(...pageRows.filter(r => !r.dispositivo_id || r.dispositivo_id === device));
        if (pageRows.length < pageSize) break;
        offset += pageSize;
      }
      return all.length ? all : null;
    } catch (e) {
      console.warn('Error en /api/lecturas paginado', e);
      return null;
    }
  }

  let payload = null, foundPath = null;

  try {
    const lecturasAll = await fetchAllLecturas();
    if (Array.isArray(lecturasAll) && lecturasAll.length) {
      payload   = { lecturas: lecturasAll };
      foundPath = '/api/lecturas';
    }
  } catch (e) { console.warn('Error intentando /api/lecturas:', e); }

  if (!payload) {
    const paths = [
      `/api/dispositivo/${device}/actual`,
      `/api/dispositivo/${device}/telemetria`,
      `/api/dispositivo/${device}/historial`,
      `/api/dispositivo/${device}/lecturas`,
      `/api/dispositivo/${device}/historico`,
      `/api/dispositivo/${device}/datos`,
      `/api/dispositivo/${device}/history`,
      `/api/dispositivo/${device}/telemetry`,
      `/api/dispositivo/${device}/mediciones`,
      `/api/dispositivo/${device}/measurements`,
      `/api/dispositivo/${device}/registro`,
      `/api/dispositivo/${device}/records`,
      `/api/lecturas?dispositivo=${device}`,
      `/api/telemetria?dispositivo=${device}`,
      `/api/historial?dispositivo=${device}`,
      `/api/records?dispositivo=${device}`,
      `/api/dispositivo?dispositivo=${device}`,
      `/api/dispositivo/${device}`
    ];
    for (const path of paths) {
      try {
        const response = await fetch(API_URL + path, { headers: { Authorization: 'Bearer ' + token } });
        if (response.status === 401) { logout(); return false; }
        if (!response.ok) continue;
        payload = await response.json();
        foundPath = path;
        if (payload) break;
      } catch { continue; }
    }
  }

  // Si no se pudo obtener datos del servidor, usar cache
  if (!payload) {
    console.warn('No se pudo cargar datos históricos del servidor, usando cache...');
    const stored = loadChartHistory();
    if (stored && stored.timestamps && stored.timestamps.length > 0) {
      trendHistory = stored;
      trendHistoryRaw = Array.isArray(stored.rawLecturas) ? stored.rawLecturas : [];
      const src = document.getElementById('history-source');
      if (src) src.innerText = 'Base de datos (caché local)';
      renderHistoryTable();
      return true;
    }
    return false;
  }

  let normalized = { lecturas: [] };
  if (Array.isArray(payload)) {
    if (payload.length && payload[0] && (payload[0].variable || payload[0].valor || payload[0].fecha || payload[0].date)) {
      normalized.lecturas = payload.filter(i => !i.dispositivo_id || i.dispositivo_id === device);
    } else if (payload.length && payload[0] && payload[0].dispositivo_id) {
      normalized.lecturas = payload.filter(p => p.dispositivo_id === device).flatMap(p => Array.isArray(p.lecturas) ? p.lecturas : []);
    } else {
      normalized.lecturas = payload;
    }
  } else if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.lecturas))  normalized.lecturas = payload.lecturas.filter(i => !i.dispositivo_id || i.dispositivo_id === device);
    else if (Array.isArray(payload.data)) normalized.lecturas = payload.data.filter(i => !i.dispositivo_id || i.dispositivo_id === device);
    else if (Array.isArray(payload.items)) normalized.lecturas = payload.items.filter(i => !i.dispositivo_id || i.dispositivo_id === device);
    else {
      const nested = Object.values(payload).find(v => Array.isArray(v) && v.length && (v[0].variable || v[0].valor || v[0].fecha || v[0].date));
      if (Array.isArray(nested)) normalized.lecturas = nested.filter(i => !i.dispositivo_id || i.dispositivo_id === device);
    }
  }

  if (Array.isArray(normalized.lecturas)) {
    normalized.lecturas = normalized.lecturas.filter(i => !/(bruta|bruto|raw)/i.test(String(i.variable || i.name || '')));
  }

  const parsedHistory = parseTelemetryHistory(normalized);
  if (!parsedHistory.timestamps.length) return false;

  trendHistory    = parsedHistory;
  trendHistoryRaw = Array.isArray(normalized.lecturas) && normalized.lecturas.length
    ? normalized.lecturas.map(l => ({ ...l }))
    : [];
  saveChartHistory();

  const src = document.getElementById('history-source');
  if (src) src.innerText = foundPath ? `Fuente: ${foundPath}` : 'Base de datos';

  renderHistoryTable();
  return true;
}

function initializeChartFromStorage() {
  const stored = loadChartHistory();
  trendHistory    = stored;
  trendHistoryRaw = Array.isArray(stored.rawLecturas) ? stored.rawLecturas : [];
  if (!trendHistory.timestamps.length && !trendHistoryRaw.length) return false;
  renderHistoryTable();
  return true;
}

// ── AUTO REFRESH ──────────────────────────────────────────────────────────────

async function startAutoRefresh() {
  initializeChartFromStorage();
  await loadHistoricalData();
  await load();
  // ── BUG FIX: limpiar el intervalo anterior Y resetearlo a null antes de crear uno nuevo
  stopAutoRefresh();
  loadInterval = setInterval(() => {
    if (token && device) load();
  }, AUTO_REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (loadInterval) {
    clearInterval(loadInterval);
    loadInterval = null; // ← BUG FIX: resetear para evitar dobles clear
  }
}

// ── LOGOUT ────────────────────────────────────────────────────────────────────

function logout() {
  stopAutoRefresh();
  try { localStorage.removeItem('token'); localStorage.removeItem('device'); } catch (_) {}
  hideDashboard();
  clearErrors();

  ['login-user', 'login-pass', 'reg-user', 'reg-pass', 'reg-device', 'reg-token', 'admin-master-key'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  // Restablecer tabs
  document.querySelectorAll('.tab-btn').forEach((b, i) => { b.classList.toggle('active', i === 0); });
  document.querySelectorAll('.form-content').forEach((f, i) => { f.classList.toggle('active', i === 0); });

  // Destruir gráfico
  if (trendChart) { trendChart.destroy(); trendChart = null; }
  trendHistory    = { timestamps: [], temperatura: [], humedad_aire: [], humedad_tierra: [] };
  trendHistoryRaw = [];

  token  = null;
  device = null;
}

// ── DEBUG HELPER ──────────────────────────────────────────────────────────────

async function debugTelemetryHistory() {
  if (!token || !device) { console.warn('No hay sesión activa.'); return; }
  const paths = [
    `/api/dispositivo/${device}/actual`, `/api/dispositivo/${device}/telemetria`,
    `/api/dispositivo/${device}/historial`, `/api/dispositivo/${device}/lecturas`,
    `/api/dispositivo/${device}`
  ];
  for (const path of paths) {
    try {
      const r = await fetch(API_URL + path, { headers: { Authorization: 'Bearer ' + token } });
      const payload = await r.json();
      console.log('Payload desde', path, payload);
      if (r.ok && payload) return payload;
    } catch (e) { console.error('Error en', path, e); }
  }
}
window.debugTelemetryHistory = debugTelemetryHistory;

// ── PWA: "AGREGAR A PANTALLA DE INICIO" ─────────────────────────────────────

const PWA_PROMPT_DISMISSED_KEY = 'pwa-install-dismissed';
let deferredInstallPrompt = null;

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true; // iOS Safari
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function showInstallPrompt() {
  if (isStandaloneMode()) return;
  if (!isMobileDevice()) return;

  try {
    if (localStorage.getItem(PWA_PROMPT_DISMISSED_KEY) === 'true') return;
  } catch (_) {}

  const modal = document.getElementById('pwa-install-modal');
  if (!modal) return;

  const iosInstructions     = document.getElementById('pwa-ios-instructions');
  const androidInstructions = document.getElementById('pwa-android-instructions');
  const installBtn          = document.getElementById('pwa-install-btn');

  if (isIOS()) {
    if (iosInstructions)     iosInstructions.style.display = 'block';
    if (androidInstructions) androidInstructions.style.display = 'none';
    if (installBtn)          installBtn.style.display = 'none';
  } else {
    if (iosInstructions)     iosInstructions.style.display = 'none';
    if (androidInstructions) androidInstructions.style.display = 'block';
    if (installBtn)          installBtn.style.display = deferredInstallPrompt ? 'inline-flex' : 'none';
  }

  modal.classList.add('show');
}

function hidePwaModal(remember) {
  const modal = document.getElementById('pwa-install-modal');
  if (modal) modal.classList.remove('show');
  if (remember) {
    try { localStorage.setItem(PWA_PROMPT_DISMISSED_KEY, 'true'); } catch (_) {}
  }
}

function setupPwaInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) installBtn.style.display = 'inline-flex';
  });

  const installBtn = document.getElementById('pwa-install-btn');
  installBtn?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) { hidePwaModal(true); return; }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    hidePwaModal(true);
  });

  document.getElementById('pwa-dismiss-btn')?.addEventListener('click', () => hidePwaModal(true));
  document.getElementById('pwa-later-btn')?.addEventListener('click', () => hidePwaModal(false));

  // Mostrar el modal con un pequeño delay para no interrumpir la carga inicial
  setTimeout(showInstallPrompt, 1500);
}

// ── INIT ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  setupHistoryFilterUI();
  setupChartRangeButtons();
  setupPlantProfileUI();
  setupPwaInstallPrompt();
  if (token && device) {
    showDashboard();
    startAutoRefresh();
  }
});