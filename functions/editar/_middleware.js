// Pide la contraseña del editor antes de mostrar /editar.
import { bloqueado, contrasenaCorrecta, crearCookie, editorConfigurado, registrarFallo, sesionValida } from '../../src/servidor/sesion.js';

const escapar = (texto) => texto.replace(/[&<>"]/g, (caracter) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[caracter]);

function paginaLogin(mensaje = '', estado = 200) {
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Entrar al editor</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;font-family:system-ui,sans-serif;background:#f4f4f5;color:#18181b}
  form{width:100%;max-width:360px;background:#fff;border-radius:12px;padding:28px;box-shadow:0 4px 24px rgb(0 0 0 / 8%)}
  h1{margin:0 0 20px;font-size:1.25rem}
  label{display:block;margin-bottom:6px;font-size:.9rem}
  input{width:100%;padding:12px;border:1px solid #d4d4d8;border-radius:8px;font-size:1rem}
  button{width:100%;margin-top:16px;padding:12px;border:0;border-radius:8px;background:#18181b;color:#fff;font-size:1rem;cursor:pointer}
  p{margin:12px 0 0;color:#b91c1c;font-size:.9rem}
</style>
</head>
<body>
<form method="post">
  <h1>Editor del sitio</h1>
  <label for="contrasena">Contraseña</label>
  <input id="contrasena" name="contrasena" type="password" autocomplete="current-password" required autofocus>
  <button type="submit">Entrar</button>
  ${mensaje ? `<p role="alert">${escapar(mensaje)}</p>` : ''}
</form>
</body>
</html>`;
  return new Response(html, {
    status: estado,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}

export async function onRequest({ request, env, next }) {
  if (!editorConfigurado(env)) return paginaLogin('El editor todavía no está configurado.', 503);
  const url = new URL(request.url);

  if (request.method === 'POST') {
    if (request.headers.get('Origin') !== url.origin) return paginaLogin('La solicitud no proviene de este sitio.', 403);
    if (await bloqueado(request, env)) return paginaLogin('Demasiados intentos. Espera 15 minutos e intenta de nuevo.', 429);
    const datos = await request.formData().catch(() => null);
    if (!(await contrasenaCorrecta(env, datos?.get('contrasena')))) {
      await registrarFallo(request, env);
      return paginaLogin('Contraseña incorrecta.', 401);
    }
    return new Response(null, { status: 303, headers: { Location: '/editar/', 'Set-Cookie': await crearCookie(env) } });
  }

  if (!(await sesionValida(request, env))) return paginaLogin();
  const respuesta = await next();
  const conSesion = new Response(respuesta.body, respuesta);
  conSesion.headers.set('Cache-Control', 'no-store');
  return conSesion;
}
