// Prueba rápida contra `npm run dev`. Uso: ADMIN_PASSWORD=... node pruebas/humo.mjs
// Crea y borra datos de prueba en la base local. No la uses contra producción.
import assert from 'node:assert/strict';

const base = process.env.URL || 'http://localhost:8787';
const clave = process.env.ADMIN_PASSWORD || 'clave-de-prueba-larga';
let cookie = '';

async function llamar(metodo, ruta, cuerpo) {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    headers: { ...(cuerpo ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const galleta = respuesta.headers.get('set-cookie');
  if (galleta) cookie = galleta.split(';')[0];
  return { estado: respuesta.status, datos: await respuesta.json() };
}

const paso = (texto) => console.log(`✓ ${texto}`);

// Busca el próximo día hábil desde mañana.
const { datos: info } = await llamar('GET', '/agenda/api/publico/info');
const dia = info.fechas.find((f) => f > info.fechas[0]);
const corte = info.servicios.find((s) => s.duracion_min === 30);
assert.ok(dia && corte, 'Se necesitan los datos de semillas/ejemplo.sql');

assert.equal((await llamar('GET', '/agenda/api/admin/citas')).estado, 401);
paso('el admin exige sesión');

assert.equal((await llamar('POST', '/agenda/api/admin/entrar', { contrasena: 'mala' })).estado, 401);
assert.equal((await llamar('POST', '/agenda/api/admin/entrar', { contrasena: clave })).estado, 200);
paso('inicio de sesión');

const { datos: equipo } = await llamar('GET', '/agenda/api/admin/profesionales');
const [andres, camilo] = equipo.profesionales;
assert.ok(andres && camilo, 'Se necesitan dos profesionales de semillas/ejemplo.sql');
const urlLibres = (prof) => `/agenda/api/publico/disponibilidad?fecha=${dia}&servicio=${corte.id}${prof ? `&profesional=${prof}` : ''}`;
const libresAntes = (await llamar('GET', urlLibres(andres.id))).datos.horas;
const hora = libresAntes[0];
const inicio = `${dia} ${hora}`;

const creada = await llamar('POST', '/agenda/api/admin/citas', {
  celular: '310 555 0101', nombre: 'Cliente Prueba', servicio_id: corte.id, profesional_id: andres.id, inicio, notas: 'prueba',
});
assert.equal(creada.estado, 201, JSON.stringify(creada.datos));
assert.equal(creada.datos.cita.celular, '3105550101');
assert.deepEqual(creada.datos.avisos, []);
const id = creada.datos.cita.id;
paso('crear cita');

const cruce = await llamar('POST', '/agenda/api/admin/citas', {
  celular: '3105550102', nombre: 'Otro', servicio_id: corte.id, profesional_id: andres.id, inicio,
});
assert.equal(cruce.estado, 409);
paso('no deja cruzar dos citas del mismo profesional');

const publico = await llamar('GET', urlLibres(andres.id));
assert.ok(!publico.datos.horas.includes(hora));
assert.ok(!JSON.stringify(publico.datos).includes('Prueba'));
paso('la página pública ya no ofrece esa hora y no muestra datos del cliente');

const movida = await llamar('PUT', `/agenda/api/admin/citas/${id}`, { servicio_id: corte.id, profesional_id: andres.id, inicio: `${dia} 23:00`, notas: '' });
assert.equal(movida.estado, 200);
assert.ok(movida.datos.avisos.length === 1, 'avisa que está fuera de horario');
paso('editar cita y aviso fuera de horario');
await llamar('PUT', `/agenda/api/admin/citas/${id}`, { servicio_id: corte.id, profesional_id: andres.id, inicio, notas: '' });

const otra = await llamar('POST', '/agenda/api/admin/citas', {
  celular: '3105550102', nombre: 'Otro', servicio_id: corte.id, profesional_id: andres.id, inicio: `${dia} ${libresAntes[1]}`,
});
assert.equal(otra.estado, 201);
assert.equal((await llamar('PATCH', `/agenda/api/admin/citas/${id}/estado`, { estado: 'cancelada' })).estado, 200);
assert.equal((await llamar('PUT', `/agenda/api/admin/citas/${otra.datos.cita.id}`, { servicio_id: corte.id, profesional_id: andres.id, inicio, notas: '' })).estado, 200);
paso('una cita cancelada libera la hora');
assert.equal((await llamar('PATCH', `/agenda/api/admin/citas/${id}/estado`, { estado: 'confirmada' })).estado, 409);
paso('no deja reactivar una cita si la hora ya se ocupó');

// Otro profesional sí puede atender a la misma hora, si está en su horario.
const libresCamilo = (await llamar('GET', urlLibres(camilo.id))).datos.horas;
const horaComun = libresCamilo.find((h) => libresAntes.includes(h) && h !== hora);
const conCamilo = await llamar('POST', '/agenda/api/admin/citas', {
  celular: '3105550103', nombre: 'Tercero', servicio_id: corte.id, profesional_id: camilo.id, inicio: `${dia} ${horaComun}`,
});
assert.equal(conCamilo.estado, 201, JSON.stringify(conCamilo.datos));
const conAndres = await llamar('POST', '/agenda/api/admin/citas', {
  celular: '3105550104', nombre: 'Cuarto', servicio_id: corte.id, profesional_id: andres.id, inicio: `${dia} ${horaComun}`,
});
assert.equal(conAndres.estado, 201, JSON.stringify(conAndres.datos));
assert.ok(!(await llamar('GET', urlLibres(null))).datos.horas.includes(horaComun), 'con los dos ocupados no se ofrece');
await llamar('PATCH', `/agenda/api/admin/citas/${conAndres.datos.cita.id}/estado`, { estado: 'cancelada' });
assert.ok((await llamar('GET', urlLibres(null))).datos.horas.includes(horaComun), '"cualquiera" la ofrece si uno queda libre');
paso('dos profesionales a la misma hora y "cualquiera"');

const bloqueoCamilo = await llamar('POST', '/agenda/api/admin/bloqueos', {
  inicio: `${dia} 00:00`, fin: `${dia} 23:59`, motivo: 'permiso', profesional_id: camilo.id,
});
assert.equal(bloqueoCamilo.estado, 201);
assert.equal((await llamar('GET', urlLibres(camilo.id))).datos.horas.length, 0);
assert.ok((await llamar('GET', urlLibres(andres.id))).datos.horas.length > 0);
await llamar('DELETE', `/agenda/api/admin/bloqueos/${bloqueoCamilo.datos.id}`);
paso('un bloqueo de un profesional no afecta a los demás');

const tercero = await llamar('POST', '/agenda/api/admin/profesionales', { nombre: 'Tercero', orden: 3 });
assert.equal(tercero.estado, 201);
assert.equal((await llamar('POST', '/agenda/api/admin/profesionales', { nombre: 'Cuarto', orden: 4 })).estado, 409);
assert.equal((await llamar('POST', '/agenda/api/admin/profesionales', { nombre: 'Cuarto', activo: false })).estado, 201);
assert.equal((await llamar('PUT', `/agenda/api/admin/profesionales/${tercero.datos.id}`, { nombre: 'Tercero', activo: true })).estado, 200);
assert.equal((await llamar('DELETE', `/agenda/api/admin/profesionales/${andres.id}`)).estado, 409);
for (const p of (await llamar('GET', '/agenda/api/admin/profesionales')).datos.profesionales.filter((p) => p.id > camilo.id)) {
  assert.equal((await llamar('DELETE', `/agenda/api/admin/profesionales/${p.id}`)).estado, 200);
}
paso('máximo 3 profesionales activos');

const buscados = await llamar('GET', '/agenda/api/admin/clientes?q=555010');
assert.equal(buscados.datos.clientes.length, 4);
paso('buscar clientes');

const bloqueo = await llamar('POST', '/agenda/api/admin/bloqueos', { inicio: `${dia} 00:00`, fin: `${dia} 23:59`, motivo: 'prueba' });
assert.equal(bloqueo.estado, 201);
assert.equal((await llamar('GET', `/agenda/api/publico/disponibilidad?fecha=${dia}&servicio=${corte.id}`)).datos.horas.length, 0);
await llamar('DELETE', `/agenda/api/admin/bloqueos/${bloqueo.datos.id}`);
paso('un bloqueo quita las horas del día');

for (const cliente of buscados.datos.clientes) {
  assert.equal((await llamar('DELETE', `/agenda/api/admin/clientes/${cliente.id}`)).estado, 200);
}
assert.equal((await llamar('GET', `/agenda/api/admin/citas?desde=${dia}`)).datos.citas.length, 0);
paso('borrar cliente borra su historial');

const respaldo = await llamar('GET', '/agenda/api/admin/respaldo');
assert.equal(respaldo.estado, 200);
assert.equal(respaldo.datos.formato, 'agenda-respaldo');
const serviciosAntes = respaldo.datos.tablas.servicios.length;
await llamar('POST', '/agenda/api/admin/servicios', { nombre: 'Temporal', duracion_min: 15, precio: 0 });
const restaurado = await llamar('POST', '/agenda/api/admin/respaldo', respaldo.datos);
assert.equal(restaurado.estado, 200, JSON.stringify(restaurado.datos));
assert.equal((await llamar('GET', '/agenda/api/admin/servicios')).datos.servicios.length, serviciosAntes);
assert.equal((await llamar('POST', '/agenda/api/admin/respaldo', { formato: 'otro' })).estado, 400);
paso('descargar y restaurar respaldo');

const nueva = 'otra-clave-de-prueba-123';
assert.equal((await llamar('POST', '/agenda/api/admin/contrasena', { actual: 'mala', nueva })).estado, 400);
assert.equal((await llamar('POST', '/agenda/api/admin/contrasena', { actual: clave, nueva: 'corta' })).estado, 400);
const cookieVieja = cookie;
assert.equal((await llamar('POST', '/agenda/api/admin/contrasena', { actual: clave, nueva })).estado, 200);
assert.notEqual(cookie, cookieVieja);
assert.equal((await llamar('GET', '/agenda/api/admin/servicios')).estado, 200);
cookie = cookieVieja;
assert.equal((await llamar('GET', '/agenda/api/admin/servicios')).estado, 401);
cookie = '';
assert.equal((await llamar('POST', '/agenda/api/admin/entrar', { contrasena: clave })).estado, 401);
assert.equal((await llamar('POST', '/agenda/api/admin/entrar', { contrasena: nueva })).estado, 200);
assert.equal((await llamar('POST', '/agenda/api/admin/contrasena', { actual: nueva, nueva: clave })).estado, 200);
paso('cambiar contraseña cierra las otras sesiones');

assert.equal((await llamar('POST', '/agenda/api/admin/salir')).estado, 200);
cookie = '';
assert.equal((await llamar('GET', '/agenda/api/admin/citas')).estado, 401);
paso('salir cierra la sesión');
console.log('Todo bien.');
