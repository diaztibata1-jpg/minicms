// Sesión del editor en línea: una contraseña por sitio y una cookie firmada.
// La firma usa una clave derivada de la contraseña y del token de GitHub, así que
// cambiar cualquiera de los dos cierra todas las sesiones abiertas.
const nombreCookie = 'editor_sesion';
const duracionSesion = 8 * 60 * 60;
const largoMinimo = 12;
const intentosMaximos = 5;
const bloqueoSegundos = 15 * 60;

const codificador = new TextEncoder();
const aHex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const deHex = (texto) => Uint8Array.from(texto.match(/../g) ?? [], (par) => parseInt(par, 16));

export const editorConfigurado = (env) => Boolean(env.EDITOR_GITHUB_TOKEN) && (env.EDITOR_PASSWORD?.length ?? 0) >= largoMinimo;

async function clave(env, uso) {
  const semilla = await crypto.subtle.digest('SHA-256', codificador.encode(`${uso}\n${env.EDITOR_PASSWORD}\n${env.EDITOR_GITHUB_TOKEN}`));
  return crypto.subtle.importKey('raw', semilla, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// crypto.subtle.verify compara en tiempo constante.
export async function contrasenaCorrecta(env, intento) {
  if (typeof intento !== 'string' || !intento) return false;
  const llave = await clave(env, 'contrasena');
  const esperada = await crypto.subtle.sign('HMAC', llave, codificador.encode(env.EDITOR_PASSWORD));
  return crypto.subtle.verify('HMAC', llave, esperada, codificador.encode(intento));
}

export async function crearCookie(env) {
  const vence = Math.floor(Date.now() / 1000) + duracionSesion;
  const firma = await crypto.subtle.sign('HMAC', await clave(env, 'sesion'), codificador.encode(String(vence)));
  return `${nombreCookie}=${vence}.${aHex(firma)}; Path=/; Max-Age=${duracionSesion}; HttpOnly; Secure; SameSite=Strict`;
}

export async function sesionValida(request, env) {
  if (!editorConfigurado(env)) return false;
  const cookie = (request.headers.get('Cookie') ?? '').split(/;\s*/).find((parte) => parte.startsWith(`${nombreCookie}=`));
  const [vence, firma] = (cookie?.slice(nombreCookie.length + 1) ?? '').split('.');
  if (!/^\d{1,12}$/.test(vence ?? '') || !/^[0-9a-f]{64}$/.test(firma ?? '')) return false;
  if (Number(vence) <= Math.floor(Date.now() / 1000)) return false;
  return crypto.subtle.verify('HMAC', await clave(env, 'sesion'), deHex(firma), codificador.encode(vence));
}

// Bloqueo por IP tras varios intentos fallidos. Necesita un KV enlazado como EDITOR_KV;
// sin él no hay bloqueo, y la contraseña larga más la espera tras cada fallo frenan los intentos.
const claveIntentos = (request) => `intentos:${request.headers.get('CF-Connecting-IP') ?? 'desconocida'}`;

export async function bloqueado(request, env) {
  if (!env.EDITOR_KV) return false;
  return Number(await env.EDITOR_KV.get(claveIntentos(request))) >= intentosMaximos;
}

export async function registrarFallo(request, env) {
  if (env.EDITOR_KV) {
    const intentos = Number(await env.EDITOR_KV.get(claveIntentos(request))) + 1;
    await env.EDITOR_KV.put(claveIntentos(request), String(intentos), { expirationTtl: bloqueoSegundos });
  }
  await new Promise((resolver) => setTimeout(resolver, 1000));
}
