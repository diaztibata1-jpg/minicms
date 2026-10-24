// Recibe el formulario de contacto y lo guarda en la hoja de Google del cliente
// (Apps Script de integraciones/formulario-apps-script.gs).
//
// Variables del proyecto en Cloudflare Pages:
// - FORMULARIO_URL: URL del web app de Apps Script (termina en /exec). Secreto.
// - FORMULARIO_CLAVE: el mismo texto de la propiedad CLAVE del script. Secreto.
// - EDITOR_KV (opcional): si existe, limita a 5 envíos por hora por IP.
const envioMaximoPorHora = 5;
const correoValido = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

const json = (datos, estado = 200) => new Response(JSON.stringify(datos), {
  status: estado,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

const texto = (valor, maximo) => (typeof valor === 'string' ? valor.trim().replace(/\s+/g, ' ').slice(0, maximo) : '');

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  // Sin JavaScript el navegador envía el formulario normal; se responde con una redirección.
  const quiereJson = (request.headers.get('Accept') ?? '').includes('application/json');
  const responder = (datos, estado = 200) => (quiereJson
    ? json(datos, estado)
    : new Response(null, { status: 303, headers: { Location: `/?contacto=${datos.ok ? 'enviado' : 'error'}#contacto` } }));

  if (request.headers.get('Origin') !== url.origin) return responder({ error: 'La solicitud no proviene de este sitio.' }, 403);
  if (!env.FORMULARIO_URL || !env.FORMULARIO_CLAVE) return responder({ error: 'El formulario todavía no está configurado.' }, 503);

  const datos = await request.formData().catch(() => null);
  if (!datos) return responder({ error: 'No se pudo leer el formulario.' }, 400);
  // Campo trampa lleno: es un bot. Se responde como si todo hubiera salido bien.
  if (texto(datos.get('empresa'), 200)) return responder({ ok: true });

  const nombre = texto(datos.get('nombre'), 80);
  const telefono = texto(datos.get('telefono'), 20);
  const correo = texto(datos.get('correo'), 120).toLowerCase();
  const digitos = telefono.replace(/\D/g, '');
  if (nombre.length < 2) return responder({ error: 'Escribe tu nombre.' }, 400);
  if (!/^[0-9+() -]+$/.test(telefono) || digitos.length < 7 || digitos.length > 15) return responder({ error: 'Revisa el teléfono.' }, 400);
  if (!correoValido.test(correo)) return responder({ error: 'Revisa el correo.' }, 400);
  if (datos.get('autorizacion') !== 'si') return responder({ error: 'Debes autorizar el tratamiento de tus datos.' }, 400);

  if (env.EDITOR_KV) {
    const clave = `contacto:${request.headers.get('CF-Connecting-IP') ?? 'desconocida'}`;
    const envios = Number(await env.EDITOR_KV.get(clave));
    if (envios >= envioMaximoPorHora) return responder({ error: 'Ya recibimos tus datos. Si necesitas algo más, escríbenos por WhatsApp.' }, 429);
    await env.EDITOR_KV.put(clave, String(envios + 1), { expirationTtl: 3600 });
  }

  try {
    // Apps Script ejecuta doPost y redirige a la respuesta; fetch sigue la redirección.
    const respuesta = await fetch(env.FORMULARIO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clave: env.FORMULARIO_CLAVE, nombre, telefono, correo }),
    });
    const resultado = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || resultado.ok !== true) {
      console.error('Formulario', respuesta.status, JSON.stringify(resultado));
      return responder({ error: 'No se pudo enviar. Intenta de nuevo o escríbenos por WhatsApp.' }, 502);
    }
  } catch (error) {
    console.error('Formulario', error);
    return responder({ error: 'No se pudo enviar. Intenta de nuevo o escríbenos por WhatsApp.' }, 502);
  }
  return responder({ ok: true });
}
