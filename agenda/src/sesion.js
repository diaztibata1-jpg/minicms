import { ErrorApi } from './util.js';

const nombreCookie = 'agenda_sesion';
const duracionSesion = 8 * 60 * 60; // segundos
const maxFallos = 5;
const bloqueoSegundos = 15 * 60;
const iteraciones = 100000; // máximo que permite PBKDF2 en Workers
const codificador = new TextEncoder();

const aHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const deHex = (texto) => new Uint8Array(texto.match(/../g).map((par) => parseInt(par, 16)));

async function derivar(contrasena, sal) {
  const base = await crypto.subtle.importKey('raw', codificador.encode(contrasena), 'PBKDF2', false, ['deriveBits']);
  return aHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones }, base, 256));
}

async function iguales(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', codificador.encode(a)),
    crypto.subtle.digest('SHA-256', codificador.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

// La contraseña que el dueño define en el panel queda en la base con hash.
// Si no ha definido ninguna, vale ADMIN_PASSWORD; borrar la fila la restablece a esa.
async function credencial(env) {
  const fila = await env.DB.prepare("SELECT valor FROM configuracion WHERE clave = 'admin_hash'").first();
  if (fila) return { tipo: 'hash', valor: fila.valor };
  const clave = env.ADMIN_PASSWORD || '';
  if (clave.length < 12) throw new ErrorApi(503, 'Falta configurar ADMIN_PASSWORD (12 caracteres o más).');
  return { tipo: 'inicial', valor: clave };
}

async function contrasenaValida(env, contrasena) {
  if (typeof contrasena !== 'string' || !contrasena) return false;
  const { tipo, valor } = await credencial(env);
  if (tipo === 'inicial') return iguales(contrasena, valor);
  const [sal, hash] = valor.split(':');
  return iguales(await derivar(contrasena, deHex(sal)), hash);
}

// La firma depende de la credencial vigente: cambiar la contraseña cierra todas las sesiones.
async function firmar(env, texto) {
  const { valor } = await credencial(env);
  const clave = await crypto.subtle.importKey(
    'raw',
    codificador.encode(`agenda-sesion:${valor}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return aHex(await crypto.subtle.sign('HMAC', clave, codificador.encode(texto)));
}

function leerCookie(request) {
  const cabecera = request.headers.get('cookie') || '';
  for (const parte of cabecera.split(';')) {
    const [nombre, ...resto] = parte.trim().split('=');
    if (nombre === nombreCookie) return resto.join('=');
  }
  return '';
}

const cookie = (valor, maxAge, segura) =>
  `${nombreCookie}=${valor}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${segura ? '; Secure' : ''}`;

const esSegura = (request) => new URL(request.url).protocol === 'https:';

async function nuevaCookie(request, env) {
  const vence = String(Math.floor(Date.now() / 1000) + duracionSesion);
  return cookie(`${vence}.${await firmar(env, vence)}`, duracionSesion, esSegura(request));
}

// Solo para demos con datos de ejemplo: SIN_CONTRASENA = "1" deja el panel abierto a cualquiera.
export const sinContrasena = (env) => env.SIN_CONTRASENA === '1';

export async function exigirSesion(request, env) {
  if (sinContrasena(env)) return;
  const [vence, firma] = leerCookie(request).split('.');
  if (!vence || !firma || Number(vence) < Date.now() / 1000 || !(await iguales(firma, await firmar(env, vence)))) {
    throw new ErrorApi(401, 'Inicia sesión.');
  }
}

export async function iniciarSesion(request, env, contrasena) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const ahora = Math.floor(Date.now() / 1000);
  const intento = await env.DB.prepare('SELECT fallos, bloqueado_hasta FROM intentos_login WHERE ip = ?')
    .bind(ip)
    .first();
  if (intento && intento.bloqueado_hasta > ahora) {
    throw new ErrorApi(429, 'Demasiados intentos. Espera 15 minutos.');
  }

  if (!(await contrasenaValida(env, contrasena))) {
    const fallos = (intento?.bloqueado_hasta && intento.bloqueado_hasta <= ahora ? 0 : intento?.fallos || 0) + 1;
    const bloqueadoHasta = fallos >= maxFallos ? ahora + bloqueoSegundos : 0;
    await env.DB.prepare(
      `INSERT INTO intentos_login (ip, fallos, bloqueado_hasta) VALUES (?1, ?2, ?3)
       ON CONFLICT (ip) DO UPDATE SET fallos = ?2, bloqueado_hasta = ?3`,
    )
      .bind(ip, fallos >= maxFallos ? 0 : fallos, bloqueadoHasta)
      .run();
    await new Promise((resolver) => setTimeout(resolver, 1000));
    throw new ErrorApi(401, 'Contraseña incorrecta.');
  }

  await env.DB.prepare('DELETE FROM intentos_login WHERE ip = ?').bind(ip).run();
  return nuevaCookie(request, env);
}

// Cambia la contraseña y devuelve una cookie nueva para esta sesión; las demás se cierran.
export async function cambiarContrasena(request, env, actual, nueva) {
  if (!(await contrasenaValida(env, actual))) throw new ErrorApi(400, 'La contraseña actual no es correcta.');
  if (typeof nueva !== 'string' || nueva.length < 12) {
    throw new ErrorApi(400, 'La contraseña nueva debe tener 12 caracteres o más.');
  }
  if (nueva.length > 200) throw new ErrorApi(400, 'La contraseña nueva es demasiado larga.');
  const sal = crypto.getRandomValues(new Uint8Array(16));
  await env.DB.prepare(
    `INSERT INTO configuracion (clave, valor) VALUES ('admin_hash', ?1)
     ON CONFLICT (clave) DO UPDATE SET valor = ?1`,
  )
    .bind(`${aHex(sal)}:${await derivar(nueva, sal)}`)
    .run();
  return nuevaCookie(request, env);
}

export const cerrarSesion = (request) => cookie('', 0, esSegura(request));
