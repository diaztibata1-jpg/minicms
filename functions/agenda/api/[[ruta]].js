// API de la agenda de citas (/agenda/api/*). El código está en agenda/src; aquí solo se conecta a Pages.
//
// En Cloudflare Pages (Settings > Bindings) hay que enlazar una base D1 con el nombre DB.
// Variables opcionales: AGENDA_NEGOCIO, AGENDA_WHATSAPP (10 dígitos).
//
// Contraseña del panel: AGENDA_PASSWORD (secreto, 12 caracteres o más) en las variables del proyecto.
// Si el dueño la cambia en Ajustes, queda guardada con hash en la base y AGENDA_PASSWORD deja de servir.
import agenda from '../../../agenda/src/index.js';

export function onRequest({ request, env, waitUntil }) {
  if (!env.DB) {
    return Response.json({ error: 'Falta enlazar la base D1 de la agenda (binding DB).' }, { status: 503 });
  }
  const entorno = {
    DB: env.DB,
    NEGOCIO: env.AGENDA_NEGOCIO || 'Barbería de prueba',
    WHATSAPP: env.AGENDA_WHATSAPP || '3000000000',
    INTERVALO_MIN: '30',
    DIAS_VISIBLES: '14',
    MAX_PROFESIONALES: '3',
    ADMIN_PASSWORD: env.AGENDA_PASSWORD,
  };
  return agenda.fetch(request, entorno, { waitUntil });
}
