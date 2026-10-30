import { ErrorApi, ahoraBogota } from './util.js';

// Tablas y columnas que entran en el respaldo, en el orden en que se restauran.
// La contraseña y los intentos de inicio de sesión no se respaldan.
const tablas = {
  profesionales: ['id', 'nombre', 'activo', 'orden'],
  servicios: ['id', 'nombre', 'duracion_min', 'precio', 'activo', 'orden'],
  horario: ['id', 'profesional_id', 'dia_semana', 'abre', 'cierra'],
  bloqueos: ['id', 'profesional_id', 'inicio', 'fin', 'motivo'],
  clientes: ['id', 'nombre', 'celular', 'notas'],
  citas: [
    'id',
    'cliente_id',
    'servicio_id',
    'profesional_id',
    'inicio',
    'fin',
    'estado',
    'notas',
    'creada_en',
    'actualizada_en',
  ],
};
const version = 2;
const maxFilas = 50000;

export async function crearRespaldo(env) {
  const nombres = Object.keys(tablas);
  const resultados = await env.DB.batch(
    nombres.map((tabla) => env.DB.prepare(`SELECT ${tablas[tabla].join(', ')} FROM ${tabla} ORDER BY id`)),
  );
  return {
    formato: 'agenda-respaldo',
    version,
    negocio: env.NEGOCIO || '',
    creado: ahoraBogota(),
    tablas: Object.fromEntries(nombres.map((tabla, i) => [tabla, resultados[i].results])),
  };
}

export const nombreRespaldo = (respaldo) => `agenda-${respaldo.creado.replace(' ', '_').replace(':', '-')}.json`;

// Reemplaza todo el contenido por el del respaldo, en una sola transacción.
export async function restaurarRespaldo(env, respaldo) {
  if (respaldo?.formato !== 'agenda-respaldo' || respaldo.version !== version || typeof respaldo.tablas !== 'object') {
    throw new ErrorApi(400, 'El archivo no es un respaldo de la agenda.');
  }
  let total = 0;
  for (const tabla of Object.keys(tablas)) {
    const filas = respaldo.tablas[tabla];
    if (!Array.isArray(filas)) throw new ErrorApi(400, `Falta la tabla ${tabla} en el respaldo.`);
    total += filas.length;
  }
  if (total > maxFilas) throw new ErrorApi(400, 'El respaldo es demasiado grande para restaurarlo desde el panel.');

  const borrar = Object.keys(tablas)
    .reverse()
    .map((tabla) => env.DB.prepare(`DELETE FROM ${tabla}`));
  const insertar = Object.entries(tablas).flatMap(([tabla, columnas]) =>
    respaldo.tablas[tabla].map((fila) =>
      env.DB.prepare(
        `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES (${columnas.map(() => '?').join(', ')})`,
      ).bind(...columnas.map((columna) => fila[columna] ?? null)),
    ),
  );
  try {
    await env.DB.batch([...borrar, ...insertar]);
  } catch (error) {
    throw new ErrorApi(400, `El respaldo tiene datos no válidos. No se cambió nada. (${error.message})`);
  }
  return Object.fromEntries(Object.keys(tablas).map((tabla) => [tabla, respaldo.tablas[tabla].length]));
}
