// Service worker del panel: la interfaz carga sin internet y muestra los últimos datos vistos.
// Los cambios siempre requieren conexión.
const version = 'agenda-v3';
const cacheInterfaz = `${version}-interfaz`;
const cacheDatos = 'agenda-datos';
const interfaz = [
  '/agenda/admin/',
  '/agenda/admin/admin.js',
  '/agenda/estilos.css',
  '/agenda/admin/manifest.webmanifest',
  '/agenda/admin/icono.svg',
  '/agenda/admin/icono-192.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(cacheInterfaz).then((cache) => cache.addAll(interfaz)));
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nombres) =>
        Promise.all(nombres.filter((n) => n !== cacheInterfaz && n !== cacheDatos).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const { request } = evento;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;

  // Datos del panel: primero la red; sin conexión, la última respuesta guardada.
  if (url.pathname.startsWith('/agenda/api/admin/')) {
    if (url.pathname === '/agenda/api/admin/respaldo') return;
    evento.respondWith(
      fetch(request)
        .then((respuesta) => {
          if (respuesta.ok) {
            const copia = respuesta.clone();
            caches.open(cacheDatos).then((cache) => cache.put(request, copia));
          }
          return respuesta;
        })
        .catch(() => caches.match(request).then((guardada) => guardada || Response.error())),
    );
    return;
  }

  // Interfaz: primero la red, para que una versión nueva se vea de inmediato; sin conexión, la copia guardada.
  if (interfaz.includes(url.pathname) || url.pathname === '/agenda/admin/index.html') {
    const clave = url.pathname === '/agenda/admin/index.html' ? '/agenda/admin/' : url.pathname;
    evento.respondWith(
      fetch(request)
        .then((respuesta) => {
          if (respuesta.ok) {
            const copia = respuesta.clone();
            caches.open(cacheInterfaz).then((cache) => cache.put(clave, copia));
          }
          return respuesta;
        })
        .catch(() => caches.match(clave).then((guardada) => guardada || Response.error())),
    );
  }
});
