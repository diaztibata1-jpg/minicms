// Pide la contraseña del editor antes de mostrar /editar.
import { avisar } from '../../src/servidor/avisos.js';
import {
  bloqueado, contrasenaCorrecta, cookieVencida, crearCookie, editorConfigurado, humanoVerificado, registrarFallo, sesionValida, turnstileActivo,
} from '../../src/servidor/sesion.js';

const escapar = (texto) => texto.replace(/[&<>"]/g, (caracter) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[caracter]);

// Nadie puede mostrar el editor dentro de otra página (evita clics engañosos).
const cabecerasSeguras = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
};

function paginaLogin(env, mensaje = '', estado = 200) {
  const turnstile = turnstileActivo(env)
    ? `<div class="cf-turnstile" data-sitekey="${escapar(env.TURNSTILE_SITE_KEY)}" data-language="es"></div>`
    : '';
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Entrar al editor</title>
${turnstile ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;font-family:system-ui,sans-serif;background:#f4f4f5;color:#18181b}
  form{width:100%;max-width:360px;background:#fff;border-radius:12px;padding:28px;box-shadow:0 4px 24px rgb(0 0 0 / 8%)}
  h1{margin:0 0 20px;font-size:1.25rem}
  label{display:block;margin-bottom:6px;font-size:.9rem}
  input{width:100%;padding:12px;border:1px solid #d4d4d8;border-radius:8px;font-size:1rem}
  .cf-turnstile{margin-top:16px}
  button{width:100%;margin-top:16px;padding:12px;border:0;border-radius:8px;background:#18181b;color:#fff;font-size:1rem;cursor:pointer}
  p{margin:12px 0 0;color:#b91c1c;font-size:.9rem}
</style>
</head>
<body>
<form method="post">
  <h1>Editor del sitio</h1>
  <label for="contrasena">Contraseña</label>
  <input id="contrasena" name="contrasena" type="password" autocomplete="current-password" required autofocus>
  ${turnstile}
  <button type="submit">Entrar</button>
  ${mensaje ? `<p role="alert">${escapar(mensaje)}</p>` : ''}
</form>
</body>
</html>`;
  return new Response(html, {
    status: estado,
    headers: { ...cabecerasSeguras, 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function onRequest(contexto) {
  const { request, env, next } = contexto;
  if (!editorConfigurado(env)) return paginaLogin(env, 'El editor todavía no está configurado.', 503);
  const url = new URL(request.url);

  if (request.method === 'POST') {
    if (request.headers.get('Origin') !== url.origin) return paginaLogin(env, 'La solicitud no proviene de este sitio.', 403);
    const datos = await request.formData().catch(() => null);
    if (datos?.get('accion') === 'salir') {
      return new Response(null, { status: 303, headers: { ...cabecerasSeguras, Location: '/editar/', 'Set-Cookie': cookieVencida } });
    }
    if (await bloqueado(request, env)) return paginaLogin(env, 'Demasiados intentos. Espera 15 minutos e intenta de nuevo.', 429);
    if (!(await humanoVerificado(request, env, datos?.get('cf-turnstile-response')))) {
      return paginaLogin(env, 'No pudimos confirmar que no eres un robot. Intenta de nuevo.', 400);
    }
    if (!(await contrasenaCorrecta(env, datos?.get('contrasena')))) {
      if (await registrarFallo(request, env)) {
        avisar(contexto, 'IP bloqueada en el editor', 'Alguien falló la contraseña 5 veces y su IP quedó bloqueada 15 minutos.');
      }
      return paginaLogin(env, 'Contraseña incorrecta.', 401);
    }
    avisar(contexto, 'Ingreso al editor', 'Alguien entró al editor con la contraseña correcta.');
    // Vuelve a la página que pidió la contraseña (el editor o la firma); siempre es una ruta de /editar.
    return new Response(null, { status: 303, headers: { ...cabecerasSeguras, Location: url.pathname, 'Set-Cookie': await crearCookie(env) } });
  }

  if (!(await sesionValida(request, env))) return paginaLogin(env);
  const respuesta = await next();
  const conSesion = new Response(respuesta.body, respuesta);
  for (const [nombre, valor] of Object.entries(cabecerasSeguras)) conSesion.headers.set(nombre, valor);
  return conSesion;
}
