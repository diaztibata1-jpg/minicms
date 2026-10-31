// Las mismas pruebas de humo.mjs, contra la versión Google Sheets (apps-script/Codigo.gs) en una hoja simulada.
// Uso: node pruebas/humo-sheets.mjs
import assert from 'node:assert/strict';
import { crearAgenda } from './apps-script-simulado.mjs';

const clave = 'clave-de-prueba-larga';
const agenda = crearAgenda({ propiedades: { AGENDA_PASSWORD: clave } });
agenda.ejecutar('cargarEjemplo');
let token = '';

// Traduce las rutas REST de la versión Cloudflare al protocolo del Apps Script.
async function llamar(metodo, ruta, cuerpo) {
  const [camino, consulta = ''] = ruta.split('?');
  let respuesta;
  if (camino.startsWith('/agenda/api/publico/') && metodo === 'GET') {
    respuesta = agenda.get({ ruta: camino.slice('/agenda/api/'.length), ...Object.fromEntries(new URLSearchParams(consulta)) });
  } else {
    const rutaScript = camino.replace(/^\/agenda\/api\/(admin\/)?/, '') + (consulta ? `?${consulta}` : '');
    respuesta = agenda.post({ metodo, ruta: rutaScript, cuerpo, token });
  }
  if (respuesta.datos && respuesta.datos.token) token = respuesta.datos.token;
  return respuesta;
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

const nueva = 'otra-clave-de-prueba-123';
assert.equal((await llamar('POST', '/agenda/api/admin/contrasena', { actual: 'mala', nueva })).estado, 400);
assert.equal((await llamar('POST', '/agenda/api/admin/contrasena', { actual: clave, nueva: 'corta' })).estado, 400);
const cookieVieja = token;
assert.equal((await llamar('POST', '/agenda/api/admin/contrasena', { actual: clave, nueva })).estado, 200);
assert.notEqual(token, cookieVieja);
assert.equal((await llamar('GET', '/agenda/api/admin/servicios')).estado, 200);
token = cookieVieja;
assert.equal((await llamar('GET', '/agenda/api/admin/servicios')).estado, 401);
token = '';
assert.equal((await llamar('POST', '/agenda/api/admin/entrar', { contrasena: clave })).estado, 401);
assert.equal((await llamar('POST', '/agenda/api/admin/entrar', { contrasena: nueva })).estado, 200);
assert.equal((await llamar('POST', '/agenda/api/admin/contrasena', { actual: nueva, nueva: clave })).estado, 200);
paso('cambiar contraseña cierra las otras sesiones');

assert.equal((await llamar('POST', '/agenda/api/admin/salir')).estado, 200);
token = '';
assert.equal((await llamar('GET', '/agenda/api/admin/citas')).estado, 401);
paso('salir cierra la sesión');

const entrar = async () => assert.equal((await llamar('POST', '/agenda/api/admin/entrar', { contrasena: clave })).estado, 200);
await entrar();
const { datos: info2 } = await llamar('GET', '/agenda/api/publico/info');
const diaReserva = info2.fechas.find((f) => f > info2.fechas[0]);
const horasReserva = (await llamar('GET', urlLibres(andres.id).replace(dia, diaReserva))).datos.horas;
const reservar = (datos) => agenda.post({ metodo: 'POST', ruta: 'publico/reservar', cuerpo: datos });
const pedido = { servicio: corte.id, profesional: andres.id, fecha: diaReserva, hora: horasReserva[0] };

assert.equal(reservar({ ...pedido, celular: '3109990000' }).estado, 403);
paso('la página no deja agendar a un número que no está en clientes');

const registrado = await llamar('POST', '/agenda/api/admin/citas', {
  celular: '3109990001', nombre: 'Cliente Registrado', servicio_id: corte.id, profesional_id: andres.id, inicio: `${diaReserva} ${horasReserva[1]}`,
});
assert.equal(registrado.estado, 201);
await llamar('PATCH', `/agenda/api/admin/citas/${registrado.datos.cita.id}/estado`, { estado: 'atendida' });
const reserva = reservar({ ...pedido, celular: '310 999 0001' });
assert.equal(reserva.estado, 201, JSON.stringify(reserva.datos));
assert.equal(reserva.datos.cita.profesional, 'Andrés');
assert.ok(!(await llamar('GET', urlLibres(andres.id).replace(dia, diaReserva))).datos.horas.includes(horasReserva[0]));
paso('un cliente registrado agenda solo y la hora deja de ofrecerse');

assert.equal(reservar({ ...pedido, hora: horasReserva[2], celular: '3109990001' }).estado, 409);
paso('un cliente no puede tener dos citas pendientes desde la página');

const otroRegistrado = await llamar('POST', '/agenda/api/admin/citas', {
  celular: '3109990002', nombre: 'Otro Registrado', servicio_id: corte.id, profesional_id: camilo.id, inicio: `${diaReserva} 19:00`,
});
await llamar('PATCH', `/agenda/api/admin/citas/${otroRegistrado.datos.cita.id}/estado`, { estado: 'atendida' });
const ocupada = reservar({ ...pedido, celular: '3109990002' });
assert.equal(ocupada.estado, 409);
assert.match(ocupada.datos.error, /ya no está disponible/);
// "Cualquiera" en una hora que Andrés ya tiene ocupada y Camilo tiene libre.
const libresCamiloReserva = (await llamar('GET', urlLibres(camilo.id).replace(dia, diaReserva))).datos.horas;
const horaDeCamilo = libresCamiloReserva.find((h) => h === horasReserva[0])
  || libresCamiloReserva.find((h) => !(horasReserva.includes(h)));
assert.ok(horaDeCamilo, 'Camilo necesita una hora libre ese día');
const andresLibre = (await llamar('GET', urlLibres(andres.id).replace(dia, diaReserva))).datos.horas.includes(horaDeCamilo);
const cualquiera = reservar({ ...pedido, hora: horaDeCamilo, profesional: '', celular: '3109990002' });
assert.equal(cualquiera.estado, 201, JSON.stringify(cualquiera.datos));
assert.equal(cualquiera.datos.cita.profesional, andresLibre ? 'Andrés' : 'Camilo');
paso('una hora tomada no se puede reservar y "cualquiera" busca otro profesional');

agenda.correos.length = 0;
agenda.ejecutar('resumenDiario');
const manana = new Date(Date.now() - 5 * 3600 * 1000 + 86400000).toISOString().slice(0, 10);
const citasManana = (await llamar('GET', `/agenda/api/admin/citas?desde=${manana}`)).datos.citas.filter((c) => c.estado !== 'cancelada');
assert.equal(agenda.correos.length, citasManana.length ? 1 : 0);
if (citasManana.length) assert.ok(agenda.correos[0].asunto.includes(String(citasManana.length)));
paso(`resumen diario (${citasManana.length} citas mañana, ${agenda.correos.length} correo)`);

token = '';
for (let i = 0; i < 9; i++) assert.equal((await llamar('POST', '/agenda/api/admin/entrar', { contrasena: 'mala' })).estado, 401);
assert.equal((await llamar('POST', '/agenda/api/admin/entrar', { contrasena: 'mala' })).estado, 401);
assert.equal((await llamar('POST', '/agenda/api/admin/entrar', { contrasena: clave })).estado, 429);
paso('10 intentos fallidos bloquean el ingreso');

const celdas = agenda.hojas.citas.datos.slice(1).flat();
assert.ok(celdas.every((valor) => typeof valor === 'string'), 'todo se guarda como texto en la hoja');
paso('la hoja guarda todo como texto');
console.log('Todo bien.');

