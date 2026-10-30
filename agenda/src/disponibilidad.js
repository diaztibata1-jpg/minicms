import { ahoraBogota, diaSemana, horaDeMinutos, minutosDeHora, sumarDias } from './util.js';

// Una cita ocupa su horario salvo que esté cancelada.
export const estadoQueOcupa = "estado <> 'cancelada'";

// Horas de inicio libres de un profesional para un servicio de `duracion` minutos.
async function horasLibresDe(env, fecha, duracion, profesionalId) {
  const intervalo = Number(env.INTERVALO_MIN) || 30;
  const desde = `${fecha} 00:00`;
  const hasta = `${sumarDias(fecha, 1)} 00:00`;
  const [horario, ocupados] = await env.DB.batch([
    env.DB.prepare('SELECT abre, cierra FROM horario WHERE profesional_id = ? AND dia_semana = ? ORDER BY abre').bind(
      profesionalId,
      diaSemana(fecha),
    ),
    env.DB.prepare(
      `SELECT inicio, fin FROM citas WHERE profesional_id = ?3 AND ${estadoQueOcupa} AND inicio < ?2 AND fin > ?1
       UNION ALL
       SELECT inicio, fin FROM bloqueos
       WHERE (profesional_id IS NULL OR profesional_id = ?3) AND inicio < ?2 AND fin > ?1`,
    ).bind(desde, hasta, profesionalId),
  ]);

  const ahora = ahoraBogota();
  const libres = [];
  for (const { abre, cierra } of horario.results) {
    const fin = minutosDeHora(cierra);
    for (let minuto = minutosDeHora(abre); minuto + duracion <= fin; minuto += intervalo) {
      const inicio = `${fecha} ${horaDeMinutos(minuto)}`;
      const termina = minuto + duracion >= 24 * 60 ? hasta : `${fecha} ${horaDeMinutos(minuto + duracion)}`;
      if (inicio <= ahora) continue;
      if (ocupados.results.some((o) => o.inicio < termina && o.fin > inicio)) continue;
      libres.push(horaDeMinutos(minuto));
    }
  }
  return libres;
}

// Sin profesional ("cualquiera"): una hora está libre si algún profesional activo la tiene libre.
export async function horasLibres(env, fecha, duracion, profesionalId = null) {
  if (profesionalId) return horasLibresDe(env, fecha, duracion, profesionalId);
  const { results } = await env.DB.prepare('SELECT id FROM profesionales WHERE activo = 1').all();
  const listas = await Promise.all(results.map((p) => horasLibresDe(env, fecha, duracion, p.id)));
  return [...new Set(listas.flat())].sort();
}
