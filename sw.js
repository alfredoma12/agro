// ── AgroSensor Service Worker ──────────────────────────────────────────────
// Versión del caché: incrementar cuando cambien los archivos estáticos
// para forzar la actualización en los dispositivos de los usuarios.
const CACHE_VERSION = 'agrosensor-v1';
const CACHE_NAME    = `agrosensor-cache-${CACHE_VERSION}`;

// Archivos estáticos que se cachean para que la app cargue offline.
// NOTA: app.js hace llamadas a la API en tiempo real; el shell de la app
// (HTML/CSS/JS/iconos) se sirve desde caché, pero los datos del sensor
// requieren conexión (con fallback a localStorage manejado por app.js).
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=DM+Mono:wght@400;500&display=swap'
];

// ── INSTALL ───────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch((err) => console.warn('SW: error al cachear assets iniciales', err))
  );
  self.skipWaiting();
});

// ── ACTIVATE ──────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('agrosensor-cache-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH ─────────────────────────────────────────────────────────────────
// Estrategia: network-first para llamadas a la API (datos en vivo),
// cache-first para el resto (shell de la app, fuentes, librerías).
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isApiCall = /trycloudflare\.com/.test(url.hostname) || url.pathname.includes('/api/');

  if (isApiCall) {
    // Network-first: intenta la red, sin cachear datos dinámicos.
    event.respondWith(
      fetch(request).catch(() => new Response(JSON.stringify({ offline: true }), {
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  // Cache-first para assets estáticos
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Cachear copia para la próxima vez (solo respuestas válidas)
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});

// ── NOTIFICACIONES LOCALES ──────────────────────────────────────────────────
// La página principal (app.js) envía un mensaje postMessage al Service Worker
// pidiendo mostrar una notificación. Esto permite que la notificación se
// muestre de forma más fiable en Android (incluso si la pestaña está en
// segundo plano) y que tenga ícono, vibración y acciones.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'SHOW_NOTIFICATION') return;

  const { title, body, tag, requireInteraction } = data.payload || {};

  self.registration.showNotification(title || 'AgroSensor', {
    body: body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: tag || 'agrosensor-alert',
    renotify: true,
    requireInteraction: !!requireInteraction,
    vibrate: [200, 100, 200],
    data: { url: './index.html' }
  });
});

// ── CLICK EN NOTIFICACIÓN ────────────────────────────────────────────────────
// Al tocar la notificación, abre (o enfoca) la app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './index.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if (client.url.includes('index.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});