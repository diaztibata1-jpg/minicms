// Envíos al Apps Script del negocio (integraciones/apps-script.gs): avisos por correo y respaldos en Drive.

const configurado = (env) => Boolean(env.GOOGLE_SCRIPT_URL && env.GOOGLE_SCRIPT_CLAVE);

async function enviar(env, datos) {
  // Apps Script ejecuta doPost y luego redirige; con la redirección basta para saber que corrió.
  const respuesta = await fetch(env.GOOGLE_SCRIPT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clave: env.GOOGLE_SCRIPT_CLAVE, negocio: env.NEGOCIO || '', ...datos }),
    redirect: 'manual',
  });
  if (respuesta.status >= 400) throw new Error(`Apps Script respondió ${respuesta.status}`);
}

const unaHora = 60 * 60;

// Manda un correo al dueño de la cuenta del script. Cada asunto sale como máximo una vez por hora.
export async function avisar(env, asunto, detalle) {
  if (!configurado(env)) return;
  try {
    const clave = `aviso:${asunto}`;
    const ahora = Math.floor(Date.now() / 1000);
    const ultimo = await env.DB.prepare('SELECT valor FROM configuracion WHERE clave = ?').bind(clave).first();
    if (ultimo && ahora - Number(ultimo.valor) < unaHora) return;
    await env.DB.prepare(
      'INSERT INTO configuracion (clave, valor) VALUES (?1, ?2) ON CONFLICT (clave) DO UPDATE SET valor = ?2',
    )
      .bind(clave, String(ahora))
      .run();
    await enviar(env, { tipo: 'aviso', asunto, detalle: String(detalle).slice(0, 4000) });
  } catch (error) {
    console.error('No se pudo enviar el aviso', error);
  }
}

export async function guardarRespaldoEnDrive(env, nombre, contenido) {
  if (!configurado(env)) return false;
  await enviar(env, { tipo: 'respaldo', nombre, contenido });
  return true;
}
