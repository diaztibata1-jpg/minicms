// Avisos por correo con Resend. Sin RESEND_API_KEY y AVISOS_CORREO no se envía nada.
// Sin dominio propio en Resend, AVISOS_CORREO debe ser el correo de la cuenta de Resend.
export function avisar({ request, env, waitUntil }, asunto, detalle) {
  if (!env.RESEND_API_KEY || !env.AVISOS_CORREO) return;
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

  const envio = fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.AVISOS_REMITENTE || 'Editor <onboarding@resend.dev>',
      to: [env.AVISOS_CORREO],
      subject: `${asunto} · ${sitio}`,
      text: texto,
    }),
  })
    .then(async (respuesta) => {
      if (!respuesta.ok) console.error('Resend', respuesta.status, await respuesta.text());
    })
    .catch((error) => console.error('Resend', error));
  // El correo sale en segundo plano para no demorar la respuesta.
  if (waitUntil) waitUntil(envio);
}
