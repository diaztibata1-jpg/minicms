// Avisos por correo con un Apps Script de Google (integraciones/avisos-apps-script.gs), que envía
// desde el Gmail de quien lo publicó. Sin AVISOS_URL y AVISOS_CLAVE no se envía nada.
export function avisar({ request, env, waitUntil }, asunto, detalle) {
  if (!env.AVISOS_URL || !env.AVISOS_CLAVE) return;
  const sitio = new URL(request.url).hostname;
  const fecha = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' });
  const ip = request.headers.get('CF-Connecting-IP') ?? 'desconocida';
  const lugar = [request.cf?.city, request.cf?.country].filter(Boolean).join(', ');
  const texto = [
    detalle,
    '',
    `Sitio: ${sitio}`,
    `Fecha: ${fecha}`,
    `IP: ${ip}${lugar ? ` (${lugar})` : ''}`,
    `Navegador: ${request.headers.get('User-Agent') ?? 'desconocido'}`,
  ].join('\n');

  // Apps Script responde con una redirección después de ejecutar doPost; no hace falta seguirla.
  const envio = fetch(env.AVISOS_URL, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clave: env.AVISOS_CLAVE, asunto: `${asunto} · ${sitio}`, texto }),
  })
    .then(async (respuesta) => {
      if (respuesta.status >= 400) console.error('Avisos', respuesta.status, await respuesta.text());
    })
    .catch((error) => console.error('Avisos', error));
  // El correo sale en segundo plano para no demorar la respuesta.
  if (waitUntil) waitUntil(envio);
}
