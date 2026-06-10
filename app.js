const API_URL = "https://reception-holland-tcp-defensive.trycloudflare.com";

let token = localStorage.getItem("token");
let device = localStorage.getItem("device");
let loadInterval = null;
let trendChart = null;
let trendHistory = { timestamps: [], temperatura: [], humedad_aire: [], humedad_tierra: [] };
const HISTORY_STORAGE_KEY = 'dashboard-history';
const AUTO_REFRESH_INTERVAL_MS = 30000; // 30 segundos para reflejar cambios del sensor rápidamente

// Validación de inputs
function validateInput(value, type = 'text') {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (type === 'password') return trimmed.length >= 6;
  return trimmed.length >= 3;
}

// Mostrar/Ocultar pestañas
function showTab(event, tabName) {
  // Ocultar todos los formularios
  document.querySelectorAll('.form-content').forEach(form => {
    form.classList.remove('active');
  });
  
  // Desactivar todos los botones
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Mostrar formulario seleccionado
  document.getElementById(tabName).classList.add('active');
  
  // Activar botón seleccionado utilizando el evento capturado
  event.target.classList.add('active');
  
  // Limpiar cualquier residuo de errores al cambiar de pestaña
  clearErrors();
  document.getElementById("admin-success").classList.remove('show');
}

// Mostrar/ocultar spinner
function setButtonLoading(buttonId, isLoading) {
  const btn = document.getElementById(buttonId);
  btn.disabled = isLoading;
  
  if (isLoading) {
    btn.innerHTML = '<span class="spinner"></span> Cargando...';
  } else {
    if (buttonId === 'login-btn') btn.innerHTML = 'Entrar';
    else if (buttonId === 'reg-btn') btn.innerHTML = 'Crear Cuenta';
    else if (buttonId === 'admin-btn') btn.innerHTML = 'Alta de Dispositivo';
  }
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
  const airePatterns = /humedad.*(aire|ambient|ambiente)|(?:aire|ambient|ambiente).*(humedad)|air.*humidity|humidity.*air/;

  if (tierraPatterns.test(name) && !/tierra[_\s-]*bruta|bruta|bruto|raw/.test(name)) return 'humedad_tierra';
  if (airePatterns.test(name)) return 'humedad_aire';

  if (/humedad/.test(name)) {
    if (/(tierra|suelo|soil|ground|sustrato)/.test(name)) return 'humedad_tierra';
    return 'humedad_aire';
  }

  return null;
}

function parseSensorTimestamp(data) {
  if (!data || typeof data !== 'object') return null;

  const timestampFields = ['timestamp', 'updated_at', 'created_at', 'fecha', 'date', 'hora', 'time'];
  for (const field of timestampFields) {
    if (data[field]) {
      const parsed = new Date(data[field]);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }

  if (Array.isArray(data.lecturas)) {
    for (const lectura of data.lecturas) {
      if (lectura && typeof lectura === 'object') {
        for (const field of timestampFields) {
          if (lectura[field]) {
            const parsed = new Date(lectura[field]);
            if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
          }
        }
      }
    }
  }

  return null;
}

function loadChartHistory() {
  const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
  if (!stored) return { timestamps: [], temperatura: [], humedad_aire: [], humedad_tierra: [] };

  try {
    const parsed = JSON.parse(stored);
    return {
      timestamps: Array.isArray(parsed.timestamps) ? parsed.timestamps : [],
      temperatura: Array.isArray(parsed.temperatura) ? parsed.temperatura : [],
      humedad_aire: Array.isArray(parsed.humedad_aire) ? parsed.humedad_aire : [],
      humedad_tierra: Array.isArray(parsed.humedad_tierra) ? parsed.humedad_tierra : []
    };
  } catch {
    return { timestamps: [], temperatura: [], humedad_aire: [], humedad_tierra: [] };
  }
}

function saveChartHistory() {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(trendHistory));
}

function parseTelemetryHistory(payload) {
  let items = [];
  const points = {};

  if (Array.isArray(payload)) {
    items = payload;
  } else if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.lecturas)) {
      items = payload.lecturas;
    } else {
      const candidates = ['telemetria', 'historial', 'data', 'registros', 'records', 'items'];
      for (const candidate of candidates) {
        if (Array.isArray(payload[candidate])) {
          items = payload[candidate];
          break;
        }
      }
    }

    if (!items.length) {
      const nested = Object.values(payload).find(value => Array.isArray(value));
      if (Array.isArray(nested)) items = nested;

      const timestamps = payload.timestamps || payload.fechas || payload.dates;
      const seriesTemperatura = payload.temperatura || payload.temp || payload.temperature;
      const seriesAire = payload.humedad_aire || payload.humedad_ambiente || payload.humidity_air || payload.humidity;
      const seriesTierra = payload.humedad_tierra || payload.humedad_suelo || payload.soil_humidity || payload.soil_moisture;

      if (Array.isArray(timestamps) && (Array.isArray(seriesTemperatura) || Array.isArray(seriesAire) || Array.isArray(seriesTierra))) {
        const maxLength = Math.max(
          timestamps.length,
          Array.isArray(seriesTemperatura) ? seriesTemperatura.length : 0,
          Array.isArray(seriesAire) ? seriesAire.length : 0,
          Array.isArray(seriesTierra) ? seriesTierra.length : 0
        );

        for (let index = 0; index < maxLength; index += 1) {
          const ts = new Date(timestamps[index]);
          if (Number.isNaN(ts.getTime())) continue;
          const timestamp = ts.toISOString();
          points[timestamp] = {
            temperatura: Array.isArray(seriesTemperatura) ? normalizeValue(seriesTemperatura[index]) : null,
            humedad_aire: Array.isArray(seriesAire) ? normalizeValue(seriesAire[index]) : null,
            humedad_tierra: Array.isArray(seriesTierra) ? normalizeValue(seriesTierra[index]) : null
          };
        }
      }
    }
  }

  items.forEach(lectura => {
    if (!lectura || typeof lectura !== 'object') return;

    const timestamp = parseSensorTimestamp(lectura);
    if (!timestamp) return;

    const key = normalizeVariableName(lectura.variable || lectura.name || lectura.tipo || lectura.sensor || lectura.nombre || lectura.key || '');
    if (!key) return;

    const rawValue = lectura.valor ?? lectura.value ?? lectura.reading ?? lectura.medida ?? lectura.data ?? lectura.val;
    const value = normalizeValue(rawValue);
    if (Number.isNaN(value)) return;

    if (!points[timestamp]) {
      points[timestamp] = { temperatura: null, humedad_aire: null, humedad_tierra: null };
    }
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

function initializeChartFromStorage() {
  trendHistory = loadChartHistory();
  if (!trendHistory.timestamps.length) return false;

  if (!trendChart) {
    createTrendChart();
  }
  updateTrendChartData();
  return true;
}

async function loadHistoricalData() {
  if (!token || !device) return false;

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
    `/api/dispositivo/${device}`
  ];

  let payload = null;
  for (const path of paths) {
    try {
      const response = await fetch(API_URL + path, {
        headers: { Authorization: 'Bearer ' + token }
      });

      if (response.status === 401) {
        logout();
        return false;
      }

      if (!response.ok) {
        console.warn('No se encontró historial en', path, '(', response.status, response.statusText, ')');
        continue;
      }

      payload = await response.json();
      console.info('Historial recibido desde', path, payload);
      if (payload) break;
    } catch (error) {
      console.warn('No se pudo obtener historial desde', path, error);
      continue;
    }
  }

  if (!payload) {
    console.warn('No se encontró historial remoto; usando datos locales existentes si los hay.');
    return false;
  }

  const parsedHistory = parseTelemetryHistory(payload);
  if (!parsedHistory.timestamps.length) {
    console.warn('El endpoint remoto no devolvió datos históricos reconocibles.', payload);
    return false;
  }

  trendHistory = parsedHistory;
  saveChartHistory();

  if (!trendChart) createTrendChart();
  updateTrendChartData();

  return true;
}

async function debugTelemetryHistory() {
  if (!token || !device) {
    console.warn('No hay token o device disponibles para la depuración. Inicia sesión primero.');
    return;
  }

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
    `/api/dispositivo/${device}`
  ];

  for (const path of paths) {
    try {
      console.info('Solicitando historial desde', API_URL + path);
      const response = await fetch(API_URL + path, {
        headers: { Authorization: 'Bearer ' + token }
      });

      console.info('Respuesta', response.status, response.statusText);
      const payload = await response.json();
      console.log('Payload histórico desde', path, payload);
      if (response.ok && payload) return payload;
    } catch (error) {
      console.error('Error al solicitar historial desde', path, error);
    }
  }

  console.warn('No se pudo obtener historial desde ninguno de los endpoints previstos.');
}

window.debugTelemetryHistory = debugTelemetryHistory;

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Santiago'
  });
}

function updateTrendChartData() {
  if (!trendChart) return;

  trendChart.data.labels = trendHistory.timestamps.map(formatTimestamp);
  trendChart.data.datasets[0].data = trendHistory.temperatura;
  trendChart.data.datasets[1].data = trendHistory.humedad_aire;
  trendChart.data.datasets[2].data = trendHistory.humedad_tierra;
  trendChart.update();
}

function createTrendChart() {
  const ctx = document.getElementById('trend-chart').getContext('2d');
  if (trendChart) trendChart.destroy();

  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: trendHistory.timestamps.map(formatTimestamp),
      datasets: [
        {
          label: 'Temperatura',
          data: trendHistory.temperatura,
          borderColor: '#fb7185',
          backgroundColor: 'rgba(251, 113, 133, 0.18)',
          tension: 0.2,
          fill: false,
          pointRadius: 3
        },
        {
          label: 'Humedad de aire',
          data: trendHistory.humedad_aire,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.18)',
          tension: 0.2,
          fill: false,
          pointRadius: 3
        },
        {
          label: 'Humedad de tierra',
          data: trendHistory.humedad_tierra,
          borderColor: '#34d399',
          backgroundColor: 'rgba(52, 211, 153, 0.18)',
          tension: 0.2,
          fill: false,
          pointRadius: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2.8,
      plugins: {
        legend: { display: true, labels: { color: '#e2e8f0', usePointStyle: true, pointStyle: 'circle' } },
      },
      scales: {
        x: { ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(148,163,184,0.15)' } },
        y: { ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(148,163,184,0.15)' } }
      }
    }
  });
}

// Mostrar errores en formulario
function showError(inputId, message) {
  const input = document.getElementById(inputId);
  const errorDiv = input.nextElementSibling;
  
  if (message) {
    input.classList.add('error');
    errorDiv.textContent = message;
    errorDiv.classList.add('show');
  } else {
    input.classList.remove('error');
    errorDiv.classList.remove('show');
  }
}

// Limpiar errores
function clearErrors() {
  document.querySelectorAll('.error-msg').forEach(msg => {
    msg.classList.remove('show');
  });
  document.querySelectorAll('input').forEach(input => {
    input.classList.remove('error');
  });
}

// Login
async function doLogin(event) {
  event.preventDefault();
  clearErrors();
  
  const user = document.getElementById("login-user").value.trim();
  const pass = document.getElementById("login-pass").value.trim();
  
  if (!user) { showError('login-user', 'El usuario es requerido'); return; }
  if (!pass) { showError('login-pass', 'La contraseña es requerida'); return; }
  
  setButtonLoading('login-btn', true);
  
  try {
    const response = await fetch(API_URL + "/api/auth/login", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({ username: user, password: pass })
    });

    const data = await response.json();
    
    if (!response.ok) {
      const errorMsg = data.message || data.error || `Error ${response.status}`;
      showError('login-user', errorMsg);
      setButtonLoading('login-btn', false);
      return;
    }
    
    if (!data.token) {
      showError('login-user', 'Usuario o contraseña incorrectos');
      setButtonLoading('login-btn', false);
      return;
    }

    token = data.token;
    device = data.dispositivo_id;

    localStorage.setItem("token", token);
    localStorage.setItem("device", device);

    showDashboard();
    startAutoRefresh();
  } catch (error) {
    console.error('Error de login:', error);
    showError('login-user', 'No se pudo conectar con el servidor.');
    setButtonLoading('login-btn', false);
  }
}

// Registro de Usuario Final
async function doRegister(event) {
  event.preventDefault();
  clearErrors();
  
  const user = document.getElementById("reg-user").value.trim();
  const pass = document.getElementById("reg-pass").value.trim();
  const deviceId = document.getElementById("reg-device").value.trim();
  const token_auth = document.getElementById("reg-token").value.trim();
  
  if (!user) { showError('reg-user', 'El usuario es requerido'); return; }
  if (!validateInput(pass, 'password')) { showError('reg-pass', 'La contraseña debe tener al menos 6 caracteres'); return; }
  if (!deviceId) { showError('reg-device', 'El ID del dispositivo es requerido'); return; }
  if (!token_auth) { showError('reg-token', 'El token es requerido'); return; }
  
  setButtonLoading('reg-btn', true);
  
  try {
    const response = await fetch(API_URL + "/api/auth/register", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        username: user,
        password: pass,
        dispositivo_id: deviceId,
        auth_token: token_auth
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      const errorMsg = data.message || data.error || `Error ${response.status}`;
      showError('reg-user', errorMsg);
      setButtonLoading('reg-btn', false);
      return;
    }

    token = data.token;
    device = data.dispositivo_id;

    localStorage.setItem("token", token);
    localStorage.setItem("device", device);

    showDashboard();
    startAutoRefresh();
  } catch (error) {
    console.error('Error de registro:', error);
    showError('reg-user', 'No se pudo conectar con el servidor.');
    setButtonLoading('reg-btn', false);
  }
}

// EXCLUSIVO ADMIN: Alta de Dispositivos en Fábrica
async function doAdminRegisterDevice(event) {
  event.preventDefault();
  clearErrors();
  
  const adminKey = document.getElementById("admin-master-key").value.trim();
  const newDevice = document.getElementById("admin-device-id").value.trim();
  const newToken = document.getElementById("admin-device-token").value.trim();
  const successBox = document.getElementById("admin-success");
  
  successBox.classList.remove('show');

  if (!adminKey) { showError('admin-master-key', 'La clave de administrador es mandatoria'); return; }
  if (!newDevice) { showError('admin-device-id', 'Ingresa el ID que llevará el ESP32'); return; }
  if (!newToken) { showError('admin-device-token', 'Asigna un token seguro para la etiqueta'); return; }

  setButtonLoading('admin-btn', true);

  try {
    // Apuntamos al endpoint administrativo de tu API Node.js
    const response = await fetch(API_URL + "/api/admin/dispositivos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        admin_key: adminKey,
        dispositivo_id: newDevice,
        auth_token: newToken
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data.message || data.error || 'Clave inválida o error en servidor';
      showError('admin-master-key', errorMsg);
      setButtonLoading('admin-btn', false);
      return;
    }

    // Éxito: Informamos en pantalla y limpiamos campos de equipo
    successBox.innerHTML = `<strong>¡Equipo Pre-Registrado!</strong><br>ID: ${newDevice}<br>Token: ${newToken}<br>Listo para empaquetar y etiquetar.`;
    successBox.classList.add('show');

    document.getElementById("admin-device-id").value = "";
    document.getElementById("admin-device-token").value = "";
    setButtonLoading('admin-btn', false);

  } catch (error) {
    console.error('Error de administración:', error);
    showError('admin-master-key', 'Error de red al conectar con la ruta de administración.');
    setButtonLoading('admin-btn', false);
  }
}

// Mostrar dashboard
function showDashboard() {
  document.getElementById("auth").style.display = "none";
  document.getElementById("dash").style.display = "block";
}

// Ocultar dashboard
function hideDashboard() {
  document.getElementById("auth").style.display = "block";
  document.getElementById("dash").style.display = "none";
}

// Cargar datos del dispositivo
async function load() {
  try {
    if (!trendHistory.timestamps.length) {
      trendHistory = loadChartHistory();
    }

    const response = await fetch(API_URL + "/api/dispositivo/" + device + "/actual", {
      headers: {
        "Authorization": "Bearer " + token
      }
    });

    if (!response.ok) {
      if (response.status === 401) { logout(); return; }
      throw new Error('Error al cargar datos');
    }

    const data = await response.json();
    const deviceName = data.dispositivo_id || "Dispositivo";
    document.getElementById("device").innerText = deviceName;

    const sensorStatus = document.getElementById("sensor-status");
    if (data.online) {
      document.getElementById("status").textContent = "ONLINE";
      document.getElementById("status").className = "status-badge status-online";
      document.getElementById("status-meta").innerText = "Sensor activo y recolectando datos";
      sensorStatus.innerText = "Activo";
    } else {
      document.getElementById("status").textContent = "OFFLINE";
      document.getElementById("status").className = "status-badge status-offline";
      document.getElementById("status-meta").innerText = "Sin conexión. Esperando actualización";
      sensorStatus.innerText = "Offline";
    }

    const sensorTimestamp = parseSensorTimestamp(data) || new Date().toISOString();
    const lastUpdate = new Date(sensorTimestamp).toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Santiago'
    });
    document.getElementById("last-update").innerText = lastUpdate;

    const readings = Array.isArray(data.lecturas) ? data.lecturas : [];
    const filteredReadings = readings.filter(lectura => !/tierra[_\s]*bruta|tierra[_\s]*burta/i.test(String(lectura.variable || '')));
    const grid = document.getElementById("grid");
    grid.innerHTML = "";

    if (filteredReadings.length > 0) {
      filteredReadings.forEach(lectura => {
        const card = document.createElement("div");
        card.className = "reading-card";
        card.innerHTML = `
          <div class="reading-label">${lectura.variable}</div>
          <div class="reading-value">${lectura.valor}</div>
        `;
        grid.appendChild(card);
      });
    } else {
      grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 28px;">No hay lecturas disponibles en este momento.</div>';
    }

    trendHistory = loadChartHistory();
    const timestamp = parseSensorTimestamp(data) || new Date().toISOString();
    const currentValues = {
      temperatura: NaN,
      humedad_aire: NaN,
      humedad_tierra: NaN
    };

    filteredReadings.forEach(lectura => {
      const key = normalizeVariableName(lectura.variable);
      if (key) {
        currentValues[key] = normalizeValue(lectura.valor);
      }
    });

    if (!trendHistory.timestamps.length || trendHistory.timestamps[trendHistory.timestamps.length - 1] !== timestamp) {
      trendHistory.timestamps.push(timestamp);
      trendHistory.temperatura.push(Number.isNaN(currentValues.temperatura) ? null : currentValues.temperatura);
      trendHistory.humedad_aire.push(Number.isNaN(currentValues.humedad_aire) ? null : currentValues.humedad_aire);
      trendHistory.humedad_tierra.push(Number.isNaN(currentValues.humedad_tierra) ? null : currentValues.humedad_tierra);
    } else {
      const lastIndex = trendHistory.timestamps.length - 1;
      trendHistory.temperatura[lastIndex] = Number.isNaN(currentValues.temperatura) ? trendHistory.temperatura[lastIndex] : currentValues.temperatura;
      trendHistory.humedad_aire[lastIndex] = Number.isNaN(currentValues.humedad_aire) ? trendHistory.humedad_aire[lastIndex] : currentValues.humedad_aire;
      trendHistory.humedad_tierra[lastIndex] = Number.isNaN(currentValues.humedad_tierra) ? trendHistory.humedad_tierra[lastIndex] : currentValues.humedad_tierra;
    }

    while (trendHistory.timestamps.length > 96) {
      trendHistory.timestamps.shift();
      trendHistory.temperatura.shift();
      trendHistory.humedad_aire.shift();
      trendHistory.humedad_tierra.shift();
    }

    saveChartHistory();

    if (!trendChart) {
      createTrendChart();
    }
    updateTrendChartData();
  } catch (error) {
    console.error('Error al cargar datos:', error);
    document.getElementById("status").textContent = "ERROR";
    document.getElementById("status").className = "status-badge status-offline";
    document.getElementById("status-meta").innerText = "No se pudieron obtener datos del sensor";
    document.getElementById("sensor-status").innerText = "Error";
  }
}

async function startAutoRefresh() {
  initializeChartFromStorage();
  await loadHistoricalData();
  await load();

  if (loadInterval) clearInterval(loadInterval);
  loadInterval = setInterval(() => {
    if (token && device) { load(); }
  }, AUTO_REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (loadInterval) clearInterval(loadInterval);
}

// Logout
function logout() {
  stopAutoRefresh();
  localStorage.removeItem("token");
  localStorage.removeItem("device");
  hideDashboard();
  clearErrors();
  
  document.getElementById("login-user").value = "";
  document.getElementById("login-pass").value = "";
  document.getElementById("reg-user").value = "";
  document.getElementById("reg-pass").value = "";
  document.getElementById("reg-device").value = "";
  document.getElementById("reg-token").value = "";
  document.getElementById("admin-master-key").value = "";
  
  document.getElementById("login").classList.add('active');
  document.getElementById("register").classList.remove('active');
  document.getElementById("admin-panel").classList.remove('active');
  
  document.querySelectorAll('.tab-btn').forEach((btn, idx) => {
    if (idx === 0) btn.classList.add('active');
    else btn.classList.remove('active');
  });
  
  token = null;
  device = null;
}

document.addEventListener('DOMContentLoaded', () => {
  initializeChartFromStorage();
  if (token && device) {
    showDashboard();
    startAutoRefresh();
  }
});