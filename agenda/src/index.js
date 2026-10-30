import { rutaAdmin } from './admin.js';
import { horasLibres } from './disponibilidad.js';
import { avisar, guardarRespaldoEnDrive } from './google.js';
import { crearRespaldo, nombreRespaldo, restaurarRespaldo } from './respaldo.js';
import { cambiarContrasena, cerrarSesion, exigirSesion, iniciarSesion, sinContrasena } from './sesion.js';
import { ErrorApi, ahoraBogota, diaSemana, entero, json, leerJson, sumarDias, validarFecha } from './util.js';

const diasVisibles = (env) => Math.min(Number(env.DIAS_VISIBLES) || 14, 60);

// Datos para la página pública: nunca incluye nombres ni celulares de clientes.
async function infoPublica(env) {
  const hoy = ahoraBogota().slice(0, 10);
  const [servicios, profesionales, dias] = await env.DB.batch([
    env.DB.prepare('SELECT id, nombre, duracion_min, precio FROM servicios WHERE activo = 1 ORDER BY orden, nombre'),
    env.DB.prepare('SELECT id, nombre FROM profesionales WHERE activo = 1 ORDER BY orden, nombre'),
    env.DB.prepare(
      `SELECT DISTINCT h.dia_semana FROM horario h
       JOIN profesionales p ON p.id = h.profesional_id WHERE p.activo = 1`,
    ),
  ]);
  const abiertos = new Set(dias.results.map((d) => d.dia_semana));
  const fechas = [];
  for (let i = 0; i < diasVisibles(env); i++) {
    const fecha = sumarDias(hoy, i);
    if (abiertos.has(diaSemana(fecha))) fechas.push(fecha);
  }
  return json({
    negocio: env.NEGOCIO || '',
    whatsapp: env.WHATSAPP || '',
    servicios: servicios.results,
    profesionales: profesionales.results,
    fechas,
  });
}

async function disponibilidadPublica(env, url) {
  const fecha = validarFecha(url.searchParams.get('fecha'));
  const hoy = ahoraBogota().slice(0, 10);
  if (fecha < hoy || fecha >= sumarDias(hoy, diasVisibles(env))) {
    throw new ErrorApi(400, 'La fecha está fuera del rango disponible.');
  }
  const servicio = await env.DB.prepare('SELECT duracion_min FROM servicios WHERE id = ? AND activo = 1')
    .bind(entero(url.searchParams.get('servicio'), 'servicio', { min: 1 }))
    .first();
  if (!servicio) throw new ErrorApi(404, 'El servicio no existe.');
  let profesionalId = null;
  if (url.searchParams.get('profesional')) {
    profesionalId = entero(url.searchParams.get('profesional'), 'profesional', { min: 1 });
    const activo = await env.DB.prepare('SELECT 1 FROM profesionales WHERE id = ? AND activo = 1').bind(profesionalId).first();
    if (!activo) throw new ErrorApi(404, 'El profesional no existe.');
  }
  return json({ fecha, horas: await horasLibres(env, fecha, servicio.duracion_min, profesionalId) }, 200, {
    'cache-control': 'public, max-age=30',
  });
}

async function manejarApi(request, env, url) {
  const ruta = url.pathname.replace(/^\/api\//, '');

  if (ruta === 'publico/info' && request.method === 'GET') return infoPublica(env);
  if (ruta === 'publico/disponibilidad' && request.method === 'GET') return disponibilidadPublica(env, url);

  if (ruta === 'admin/entrar' && request.method === 'POST') {
    const { contrasena } = await leerJson(request);
    return json({ ok: true }, 200, { 'set-cookie': await iniciarSesion(request, env, contrasena) });
  }
  if (ruta === 'admin/salir' && request.method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': cerrarSesion(request) });
  }
  if (ruta.startsWith('admin/')) {
    await exigirSesion(request, env);
    if (sinContrasena(env) && (ruta === 'admin/contrasena' || (ruta === 'admin/respaldo' && request.method === 'POST'))) {
      throw new ErrorApi(403, 'En la demo no se puede cambiar la contraseña ni restaurar respaldos.');
    }
    if (ruta === 'admin/contrasena' && request.method === 'POST') {
      const { actual, nueva } = await leerJson(request);
      return json({ ok: true }, 200, { 'set-cookie': await cambiarContrasena(request, env, actual, nueva) });
    }
    if (ruta === 'admin/respaldo' && request.method === 'GET') {
      const respaldo = await crearRespaldo(env);
      return json(respaldo, 200, { 'content-disposition': `attachment; filename="${nombreRespaldo(respaldo)}"` });
    }
    if (ruta === 'admin/respaldo' && request.method === 'POST') {
      return json({ restaurado: await restaurarRespaldo(env, await leerJson(request)) });
    }
    return rutaAdmin(env, request, url, ruta.slice('admin/'.length));
  }
  throw new ErrorApi(404, 'Ruta no encontrada.');
}

// Copia diaria a Google Drive (ver `[triggers]` en wrangler.toml).
async function respaldoProgramado(env) {
  try {
    const respaldo = await crearRespaldo(env);
    await guardarRespaldoEnDrive(env, nombreRespaldo(respaldo), JSON.stringify(respaldo));
  } catch (error) {
    console.error(error);
    await avisar(env, 'Falló el respaldo diario de la agenda', error.stack || error.message);
  }
}

export default {
  async scheduled(evento, env, ctx) {
    ctx.waitUntil(respaldoProgramado(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('', { status: 404 });
    try {
      // Los cambios solo se aceptan desde el mismo sitio.
      const origen = request.headers.get('origin');
      if (request.method !== 'GET' && origen && origen !== url.origin) throw new ErrorApi(403, 'Origen no permitido.');
      return await manejarApi(request, env, url);
    } catch (error) {
      if (error instanceof ErrorApi) return json({ error: error.message }, error.estado);
      console.error(error);
      ctx.waitUntil(
        avisar(env, 'Error en la agenda', `${request.method} ${url.pathname}\n\n${error.stack || error.message}`),
      );
      return json({ error: 'Error interno. Ya nos llegó el aviso.' }, 500);
    }
  },
};
