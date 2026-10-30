import { estadoQueOcupa, horasLibres } from './disponibilidad.js';
import {
  ErrorApi,
  ahoraBogota,
  celular,
  diaSemana,
  entero,
  horaValida,
  json,
  leerJson,
  sumarDias,
  sumarMinutos,
  texto,
  validarFecha,
  validarMomento,
} from './util.js';

const estados = ['confirmada', 'atendida', 'no_asistio', 'cancelada'];

const seleccionCitas = `
  SELECT c.id, c.inicio, c.fin, c.estado, c.notas, c.servicio_id,
         s.nombre AS servicio, s.precio,
         c.profesional_id, p.nombre AS profesional,
         c.cliente_id, cl.nombre AS cliente, cl.celular
  FROM citas c
  JOIN clientes cl ON cl.id = c.cliente_id
  LEFT JOIN servicios s ON s.id = c.servicio_id
  LEFT JOIN profesionales p ON p.id = c.profesional_id`;

const sinCruce = `NOT EXISTS (
  SELECT 1 FROM citas otra
  WHERE otra.${estadoQueOcupa} AND otra.profesional_id = ?prof AND otra.id <> ?id
    AND otra.inicio < ?fin AND otra.fin > ?inicio)`;

// D1 solo admite parámetros ?N; esto reemplaza los nombres por posiciones fijas.
const conPosiciones = (sql, posiciones) =>
  sql.replace(/\?(id|fin|inicio|prof)\b/g, (_, nombre) => `?${posiciones[nombre]}`);

async function profesionalPorId(env, id, { soloActivo = false } = {}) {
  const profesional = await env.DB.prepare('SELECT id, activo FROM profesionales WHERE id = ?').bind(id).first();
  if (!profesional || (soloActivo && !profesional.activo)) throw new ErrorApi(400, 'El profesional no existe o está inactivo.');
  return profesional;
}

async function servicioPorId(env, id) {
  const servicio = await env.DB.prepare('SELECT id, duracion_min FROM servicios WHERE id = ?').bind(id).first();
  if (!servicio) throw new ErrorApi(400, 'El servicio no existe.');
  return servicio;
}

// Avisos que no impiden guardar: el administrador decide.
async function avisosDeCita(env, inicio, fin, profesionalId) {
  const avisos = [];
  const fecha = inicio.slice(0, 10);
  const { results: rangos } = await env.DB.prepare(
    'SELECT abre, cierra FROM horario WHERE profesional_id = ? AND dia_semana = ?',
  )
    .bind(profesionalId, diaSemana(fecha))
    .all();
  const dentro = rangos.some((r) => `${fecha} ${r.abre}` <= inicio && fin <= `${fecha} ${r.cierra}`);
  if (!dentro) avisos.push('La cita queda fuera del horario de atención.');
  const bloqueo = await env.DB.prepare(
    `SELECT motivo FROM bloqueos
     WHERE (profesional_id IS NULL OR profesional_id = ?3) AND inicio < ?2 AND fin > ?1 LIMIT 1`,
  )
    .bind(inicio, fin, profesionalId)
    .first();
  if (bloqueo) avisos.push(`La cita se cruza con un bloqueo${bloqueo.motivo ? `: ${bloqueo.motivo}` : ''}.`);
  return avisos;
}

async function datosCita(env, cuerpo) {
  const servicio = await servicioPorId(env, entero(cuerpo.servicio_id, 'servicio_id', { min: 1 }));
  const profesional = await profesionalPorId(env, entero(cuerpo.profesional_id, 'profesional_id', { min: 1 }));
  const inicio = validarMomento(cuerpo.inicio);
  const duracion =
    cuerpo.duracion_min === undefined || cuerpo.duracion_min === null || cuerpo.duracion_min === ''
      ? servicio.duracion_min
      : entero(cuerpo.duracion_min, 'duracion_min', { min: 5, max: 480 });
  return {
    servicioId: servicio.id,
    profesionalId: profesional.id,
    inicio,
    fin: sumarMinutos(inicio, duracion),
    notas: texto(cuerpo.notas, 'notas', { max: 500 }),
  };
}

const errorCruce = () => new ErrorApi(409, 'Ese horario se cruza con otra cita.');

// ---------- Citas ----------

async function listarCitas(env, url) {
  const desde = validarFecha(url.searchParams.get('desde') || ahoraBogota().slice(0, 10));
  const hasta = validarFecha(url.searchParams.get('hasta') || desde);
  const profesional = url.searchParams.get('profesional');
  const filtro = profesional ? 'AND c.profesional_id = ?3' : '';
  const consulta = env.DB.prepare(
    `${seleccionCitas} WHERE c.inicio >= ?1 AND c.inicio < ?2 ${filtro} ORDER BY c.inicio, p.orden`,
  );
  const parametros = [`${desde} 00:00`, `${sumarDias(hasta, 1)} 00:00`];
  if (profesional) parametros.push(entero(profesional, 'profesional', { min: 1 }));
  const { results } = await consulta.bind(...parametros).all();
  return json({ citas: results });
}

async function crearCita(env, request) {
  const cuerpo = await leerJson(request);
  const cel = celular(cuerpo.celular);
  const nombre = texto(cuerpo.nombre, 'nombre', { max: 80, requerido: true });
  const cita = await datosCita(env, cuerpo);

  const [, insercion] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO clientes (nombre, celular) VALUES (?1, ?2)
       ON CONFLICT (celular) DO UPDATE SET nombre = excluded.nombre`,
    ).bind(nombre, cel),
    env.DB.prepare(
      conPosiciones(
        `INSERT INTO citas (cliente_id, servicio_id, inicio, fin, notas, profesional_id)
         SELECT (SELECT id FROM clientes WHERE celular = ?1), ?2, ?3, ?4, ?5, ?7
         WHERE ${sinCruce}`,
        { inicio: 3, fin: 4, id: 6, prof: 7 },
      ),
    ).bind(cel, cita.servicioId, cita.inicio, cita.fin, cita.notas, 0, cita.profesionalId),
  ]);
  if (!insercion.meta.changes) throw errorCruce();

  const creada = await env.DB.prepare(`${seleccionCitas} WHERE c.id = ?`).bind(insercion.meta.last_row_id).first();
  return json({ cita: creada, avisos: await avisosDeCita(env, cita.inicio, cita.fin, cita.profesionalId) }, 201);
}

async function actualizarCita(env, request, id) {
  const actual = await env.DB.prepare('SELECT id FROM citas WHERE id = ?').bind(id).first();
  if (!actual) throw new ErrorApi(404, 'La cita no existe.');
  const cuerpo = await leerJson(request);
  const cita = await datosCita(env, cuerpo);
  const estado = cuerpo.estado ?? 'confirmada';
  if (!estados.includes(estado)) throw new ErrorApi(400, 'El estado no es válido.');

  const condicion = estado === 'cancelada' ? '1' : sinCruce;
  const resultado = await env.DB.prepare(
    conPosiciones(
      `UPDATE citas SET servicio_id = ?1, inicio = ?2, fin = ?3, notas = ?4, estado = ?5, profesional_id = ?7,
              actualizada_en = datetime('now')
       WHERE id = ?6 AND ${condicion}`,
      { inicio: 2, fin: 3, id: 6, prof: 7 },
    ),
  )
    .bind(cita.servicioId, cita.inicio, cita.fin, cita.notas, estado, id, cita.profesionalId)
    .run();
  if (!resultado.meta.changes) throw errorCruce();

  const guardada = await env.DB.prepare(`${seleccionCitas} WHERE c.id = ?`).bind(id).first();
  const avisos = estado === 'cancelada' ? [] : await avisosDeCita(env, cita.inicio, cita.fin, cita.profesionalId);
  return json({ cita: guardada, avisos });
}

async function cambiarEstado(env, request, id) {
  const { estado } = await leerJson(request);
  if (!estados.includes(estado)) throw new ErrorApi(400, 'El estado no es válido.');
  // Volver a "confirmada" una cita cancelada exige que el horario siga libre.
  const condicion =
    estado === 'cancelada'
      ? '1'
      : sinCruce
          .replace('?id', 'citas.id')
          .replace('?fin', 'citas.fin')
          .replace('?inicio', 'citas.inicio')
          .replace('?prof', 'citas.profesional_id');
  const resultado = await env.DB.prepare(
    `UPDATE citas SET estado = ?1, actualizada_en = datetime('now') WHERE id = ?2 AND ${condicion}`,
  )
    .bind(estado, id)
    .run();
  if (!resultado.meta.changes) {
    const existe = await env.DB.prepare('SELECT 1 FROM citas WHERE id = ?').bind(id).first();
    throw existe ? errorCruce() : new ErrorApi(404, 'La cita no existe.');
  }
  return json({ cita: await env.DB.prepare(`${seleccionCitas} WHERE c.id = ?`).bind(id).first() });
}

async function borrarCita(env, id) {
  const resultado = await env.DB.prepare('DELETE FROM citas WHERE id = ?').bind(id).run();
  if (!resultado.meta.changes) throw new ErrorApi(404, 'La cita no existe.');
  return json({ ok: true });
}

// ---------- Clientes ----------

async function buscarClientes(env, url) {
  const q = texto(url.searchParams.get('q'), 'q', { max: 80 });
  const patron = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { results } = await env.DB.prepare(
    `SELECT cl.id, cl.nombre, cl.celular, cl.notas, COUNT(c.id) AS citas
     FROM clientes cl LEFT JOIN citas c ON c.cliente_id = cl.id
     WHERE cl.nombre LIKE ?1 ESCAPE '\\' OR cl.celular LIKE ?1 ESCAPE '\\'
     GROUP BY cl.id ORDER BY cl.nombre LIMIT 20`,
  )
    .bind(patron)
    .all();
  return json({ clientes: results });
}

async function historialCliente(env, id) {
  const cliente = await env.DB.prepare('SELECT id, nombre, celular, notas FROM clientes WHERE id = ?').bind(id).first();
  if (!cliente) throw new ErrorApi(404, 'El cliente no existe.');
  const { results } = await env.DB.prepare(`${seleccionCitas} WHERE c.cliente_id = ? ORDER BY c.inicio DESC LIMIT 100`)
    .bind(id)
    .all();
  return json({ cliente, citas: results });
}

async function actualizarCliente(env, request, id) {
  const cuerpo = await leerJson(request);
  const datos = [
    texto(cuerpo.nombre, 'nombre', { max: 80, requerido: true }),
    celular(cuerpo.celular),
    texto(cuerpo.notas, 'notas', { max: 500 }),
    id,
  ];
  try {
    const resultado = await env.DB.prepare('UPDATE clientes SET nombre = ?, celular = ?, notas = ? WHERE id = ?')
      .bind(...datos)
      .run();
    if (!resultado.meta.changes) throw new ErrorApi(404, 'El cliente no existe.');
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw new ErrorApi(409, 'Ya existe otro cliente con ese celular.');
    throw error;
  }
  return json({ ok: true });
}

// Borra al cliente y su historial (derecho de supresión, Ley 1581).
async function borrarCliente(env, id) {
  const [, resultado] = await env.DB.batch([
    env.DB.prepare('DELETE FROM citas WHERE cliente_id = ?').bind(id),
    env.DB.prepare('DELETE FROM clientes WHERE id = ?').bind(id),
  ]);
  if (!resultado.meta.changes) throw new ErrorApi(404, 'El cliente no existe.');
  return json({ ok: true });
}

// ---------- Servicios ----------

function datosServicio(cuerpo) {
  return [
    texto(cuerpo.nombre, 'nombre', { max: 60, requerido: true }),
    entero(cuerpo.duracion_min, 'duracion_min', { min: 5, max: 480 }),
    entero(cuerpo.precio ?? 0, 'precio', { min: 0, max: 100000000 }),
    cuerpo.activo === false || cuerpo.activo === 0 ? 0 : 1,
    entero(cuerpo.orden ?? 0, 'orden', { min: 0, max: 1000 }),
  ];
}

async function listarServicios(env) {
  const { results } = await env.DB.prepare('SELECT * FROM servicios ORDER BY orden, nombre').all();
  return json({ servicios: results });
}

async function crearServicio(env, request) {
  const resultado = await env.DB.prepare(
    'INSERT INTO servicios (nombre, duracion_min, precio, activo, orden) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(...datosServicio(await leerJson(request)))
    .run();
  return json({ id: resultado.meta.last_row_id }, 201);
}

async function actualizarServicio(env, request, id) {
  const resultado = await env.DB.prepare(
    'UPDATE servicios SET nombre = ?, duracion_min = ?, precio = ?, activo = ?, orden = ? WHERE id = ?',
  )
    .bind(...datosServicio(await leerJson(request)), id)
    .run();
  if (!resultado.meta.changes) throw new ErrorApi(404, 'El servicio no existe.');
  return json({ ok: true });
}

async function borrarServicio(env, id) {
  const usado = await env.DB.prepare('SELECT 1 FROM citas WHERE servicio_id = ? LIMIT 1').bind(id).first();
  if (usado) throw new ErrorApi(409, 'El servicio tiene citas. Desactívalo en lugar de borrarlo.');
  const resultado = await env.DB.prepare('DELETE FROM servicios WHERE id = ?').bind(id).run();
  if (!resultado.meta.changes) throw new ErrorApi(404, 'El servicio no existe.');
  return json({ ok: true });
}

// ---------- Horario ----------

async function leerHorario(env) {
  const { results } = await env.DB.prepare(
    'SELECT profesional_id, dia_semana, abre, cierra FROM horario ORDER BY profesional_id, dia_semana, abre',
  ).all();
  return json({ horario: results });
}

// Reemplaza el horario de la semana de un profesional.
async function guardarHorario(env, request) {
  const { profesional_id, horario } = await leerJson(request);
  const profesional = await profesionalPorId(env, entero(profesional_id, 'profesional_id', { min: 1 }));
  if (!Array.isArray(horario) || horario.length > 50) throw new ErrorApi(400, 'El horario no es válido.');
  const rangos = horario.map((r) => {
    const dia = entero(r.dia_semana, 'dia_semana', { min: 0, max: 6 });
    if (!horaValida.test(r.abre ?? '') || !horaValida.test(r.cierra ?? '') || r.abre >= r.cierra) {
      throw new ErrorApi(400, 'Cada rango necesita hora de apertura menor que la de cierre (HH:MM).');
    }
    return { dia, abre: r.abre, cierra: r.cierra };
  });
  rangos.sort((a, b) => a.dia - b.dia || a.abre.localeCompare(b.abre));
  for (let i = 1; i < rangos.length; i++) {
    if (rangos[i].dia === rangos[i - 1].dia && rangos[i].abre < rangos[i - 1].cierra) {
      throw new ErrorApi(400, 'Hay rangos que se cruzan en el mismo día.');
    }
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM horario WHERE profesional_id = ?').bind(profesional.id),
    ...rangos.map((r) =>
      env.DB.prepare('INSERT INTO horario (profesional_id, dia_semana, abre, cierra) VALUES (?, ?, ?, ?)').bind(
        profesional.id,
        r.dia,
        r.abre,
        r.cierra,
      ),
    ),
  ]);
  return json({ ok: true });
}

// ---------- Bloqueos ----------

async function listarBloqueos(env) {
  const { results } = await env.DB.prepare(
    `SELECT b.*, p.nombre AS profesional FROM bloqueos b
     LEFT JOIN profesionales p ON p.id = b.profesional_id
     WHERE b.fin > ? ORDER BY b.inicio LIMIT 200`,
  )
    .bind(ahoraBogota())
    .all();
  return json({ bloqueos: results });
}

async function crearBloqueo(env, request) {
  const cuerpo = await leerJson(request);
  const inicio = validarMomento(cuerpo.inicio, 'inicio');
  const fin = validarMomento(cuerpo.fin, 'fin');
  if (inicio >= fin) throw new ErrorApi(400, 'El fin debe ser posterior al inicio.');
  // Sin profesional = bloqueo general para todo el negocio.
  const profesionalId = cuerpo.profesional_id
    ? (await profesionalPorId(env, entero(cuerpo.profesional_id, 'profesional_id', { min: 1 }))).id
    : null;
  const resultado = await env.DB.prepare('INSERT INTO bloqueos (inicio, fin, motivo, profesional_id) VALUES (?, ?, ?, ?)')
    .bind(inicio, fin, texto(cuerpo.motivo, 'motivo', { max: 120 }), profesionalId)
    .run();
  const { results: cruces } = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM citas
     WHERE ${estadoQueOcupa} AND inicio < ?1 AND fin > ?2 AND (?3 IS NULL OR profesional_id = ?3)`,
  )
    .bind(fin, inicio, profesionalId)
    .all();
  const avisos = cruces[0].n ? [`Hay ${cruces[0].n} cita(s) dentro del bloqueo. Revísalas.`] : [];
  return json({ id: resultado.meta.last_row_id, avisos }, 201);
}

async function borrarBloqueo(env, id) {
  const resultado = await env.DB.prepare('DELETE FROM bloqueos WHERE id = ?').bind(id).run();
  if (!resultado.meta.changes) throw new ErrorApi(404, 'El bloqueo no existe.');
  return json({ ok: true });
}

// ---------- Profesionales ----------

const maxProfesionales = (env) => Number(env.MAX_PROFESIONALES) || 3;

function datosProfesional(cuerpo) {
  return {
    nombre: texto(cuerpo.nombre, 'nombre', { max: 40, requerido: true }),
    activo: cuerpo.activo === false || cuerpo.activo === 0 ? 0 : 1,
    orden: entero(cuerpo.orden ?? 0, 'orden', { min: 0, max: 1000 }),
  };
}

async function revisarLimite(env, excluirId = 0) {
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM profesionales WHERE activo = 1 AND id <> ?')
    .bind(excluirId)
    .first();
  if (n >= maxProfesionales(env)) {
    throw new ErrorApi(409, `El plan permite hasta ${maxProfesionales(env)} profesionales activos.`);
  }
}

async function listarProfesionales(env) {
  const { results } = await env.DB.prepare('SELECT * FROM profesionales ORDER BY orden, nombre').all();
  return json({ profesionales: results, maximo: maxProfesionales(env) });
}

async function crearProfesional(env, request) {
  const datos = datosProfesional(await leerJson(request));
  if (datos.activo) await revisarLimite(env);
  const resultado = await env.DB.prepare('INSERT INTO profesionales (nombre, activo, orden) VALUES (?, ?, ?)')
    .bind(datos.nombre, datos.activo, datos.orden)
    .run();
  return json({ id: resultado.meta.last_row_id }, 201);
}

async function actualizarProfesional(env, request, id) {
  const datos = datosProfesional(await leerJson(request));
  if (datos.activo) await revisarLimite(env, id);
  const resultado = await env.DB.prepare('UPDATE profesionales SET nombre = ?, activo = ?, orden = ? WHERE id = ?')
    .bind(datos.nombre, datos.activo, datos.orden, id)
    .run();
  if (!resultado.meta.changes) throw new ErrorApi(404, 'El profesional no existe.');
  return json({ ok: true });
}

async function borrarProfesional(env, id) {
  const usado = await env.DB.prepare('SELECT 1 FROM citas WHERE profesional_id = ? LIMIT 1').bind(id).first();
  if (usado) throw new ErrorApi(409, 'Este profesional tiene citas. Desactívalo en lugar de borrarlo.');
  const [, , resultado] = await env.DB.batch([
    env.DB.prepare('DELETE FROM horario WHERE profesional_id = ?').bind(id),
    env.DB.prepare('DELETE FROM bloqueos WHERE profesional_id = ?').bind(id),
    env.DB.prepare('DELETE FROM profesionales WHERE id = ?').bind(id),
  ]);
  if (!resultado.meta.changes) throw new ErrorApi(404, 'El profesional no existe.');
  return json({ ok: true });
}

// ---------- Disponibilidad para el formulario del admin ----------

async function disponibilidadAdmin(env, url) {
  const fecha = validarFecha(url.searchParams.get('fecha'));
  const duracion = entero(url.searchParams.get('duracion') || '30', 'duracion', { min: 5, max: 480 });
  const profesional = url.searchParams.get('profesional');
  const profesionalId = profesional ? entero(profesional, 'profesional', { min: 1 }) : null;
  return json({ fecha, horas: await horasLibres(env, fecha, duracion, profesionalId) });
}

// ---------- Rutas ----------

const rutas = [
  ['GET', /^citas$/, (env, req, url) => listarCitas(env, url)],
  ['POST', /^citas$/, (env, req) => crearCita(env, req)],
  ['PUT', /^citas\/(\d+)$/, (env, req, url, id) => actualizarCita(env, req, id)],
  ['PATCH', /^citas\/(\d+)\/estado$/, (env, req, url, id) => cambiarEstado(env, req, id)],
  ['DELETE', /^citas\/(\d+)$/, (env, req, url, id) => borrarCita(env, id)],
  ['GET', /^clientes$/, (env, req, url) => buscarClientes(env, url)],
  ['GET', /^clientes\/(\d+)$/, (env, req, url, id) => historialCliente(env, id)],
  ['PUT', /^clientes\/(\d+)$/, (env, req, url, id) => actualizarCliente(env, req, id)],
  ['DELETE', /^clientes\/(\d+)$/, (env, req, url, id) => borrarCliente(env, id)],
  ['GET', /^servicios$/, (env) => listarServicios(env)],
  ['POST', /^servicios$/, (env, req) => crearServicio(env, req)],
  ['PUT', /^servicios\/(\d+)$/, (env, req, url, id) => actualizarServicio(env, req, id)],
  ['DELETE', /^servicios\/(\d+)$/, (env, req, url, id) => borrarServicio(env, id)],
  ['GET', /^profesionales$/, (env) => listarProfesionales(env)],
  ['POST', /^profesionales$/, (env, req) => crearProfesional(env, req)],
  ['PUT', /^profesionales\/(\d+)$/, (env, req, url, id) => actualizarProfesional(env, req, id)],
  ['DELETE', /^profesionales\/(\d+)$/, (env, req, url, id) => borrarProfesional(env, id)],
  ['GET', /^horario$/, (env) => leerHorario(env)],
  ['PUT', /^horario$/, (env, req) => guardarHorario(env, req)],
  ['GET', /^bloqueos$/, (env) => listarBloqueos(env)],
  ['POST', /^bloqueos$/, (env, req) => crearBloqueo(env, req)],
  ['DELETE', /^bloqueos\/(\d+)$/, (env, req, url, id) => borrarBloqueo(env, id)],
  ['GET', /^disponibilidad$/, (env, req, url) => disponibilidadAdmin(env, url)],
];

export async function rutaAdmin(env, request, url, ruta) {
  for (const [metodo, patron, manejar] of rutas) {
    const coincidencia = ruta.match(patron);
    if (coincidencia && request.method === metodo) {
      return manejar(env, request, url, coincidencia[1] ? Number(coincidencia[1]) : undefined);
    }
  }
  throw new ErrorApi(404, 'Ruta no encontrada.');
}
