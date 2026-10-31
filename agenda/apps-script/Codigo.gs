// Agenda de citas con los datos en esta hoja de cálculo (versión Google Sheets).
// Instalación paso a paso en agenda/apps-script/README.md.
//
// Propiedades del script (Configuración del proyecto > Propiedades del script):
// - AGENDA_PASSWORD: contraseña inicial del panel, 12 caracteres o más.
// - AVISOS_PARA (opcional): correo(s) para el resumen diario y los avisos de error. Por defecto, el dueño del script.
//
// Cada pestaña es una tabla. Se puede leer y filtrar, pero los cambios se hacen desde el panel:
// editar a mano puede dejar dos citas cruzadas.

const ZONA = 'America/Bogota';
const TABLAS = {
  configuracion: ['clave', 'valor'],
  profesionales: ['id', 'nombre', 'activo', 'orden'],
  servicios: ['id', 'nombre', 'duracion_min', 'precio', 'activo', 'orden'],
  horario: ['id', 'profesional_id', 'dia_semana', 'abre', 'cierra'],
  bloqueos: ['id', 'inicio', 'fin', 'motivo', 'profesional_id'],
  clientes: ['id', 'nombre', 'celular', 'notas'],
  citas: ['id', 'cliente_id', 'servicio_id', 'profesional_id', 'inicio', 'fin', 'estado', 'notas', 'creada_en', 'actualizada_en'],
};
const NUMERICOS = ['id', 'activo', 'orden', 'duracion_min', 'precio', 'dia_semana', 'profesional_id', 'cliente_id', 'servicio_id'];
const ESTADOS = ['confirmada', 'atendida', 'no_asistio', 'cancelada'];
const CONFIGURACION_INICIAL = [
  ['negocio', 'Barbería de prueba'],
  ['whatsapp', '3000000000'],
  ['intervalo_min', '30'],
  ['dias_visibles', '14'],
  ['max_profesionales', '3'],
];
const DURACION_SESION = 6 * 60 * 60; // segundos; el máximo que guarda CacheService
const MAX_FALLOS = 10;
const BLOQUEO_SEGUNDOS = 15 * 60;

class ErrorApi extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

// ---------- Utilidades de fechas y validación ----------

// Bogotá es UTC-5 todo el año.
const ahoraBogota = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
const fechaValida = /^\d{4}-\d{2}-\d{2}$/;
const horaValida = /^([01]\d|2[0-3]):[0-5]\d$/;
const momentoValido = /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/;

function validarFecha(texto) {
  if (typeof texto !== 'string' || !fechaValida.test(texto)) throw new ErrorApi(400, 'La fecha debe ser AAAA-MM-DD.');
  const fecha = new Date(texto + 'T00:00:00Z');
  if (isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== texto) throw new ErrorApi(400, 'La fecha no existe.');
  return texto;
}

function validarMomento(texto, campo) {
  if (typeof texto !== 'string' || !momentoValido.test(texto)) {
    throw new ErrorApi(400, 'El campo ' + (campo || 'inicio') + ' debe ser AAAA-MM-DD HH:MM.');
  }
  validarFecha(texto.slice(0, 10));
  return texto;
}

const minutosDeHora = (hora) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
const horaDeMinutos = (minutos) => String(Math.floor(minutos / 60)).padStart(2, '0') + ':' + String(minutos % 60).padStart(2, '0');
const diaSemana = (fecha) => new Date(fecha + 'T00:00:00Z').getUTCDay();

function sumarMinutos(momento, minutos) {
  const fecha = new Date(momento.replace(' ', 'T') + ':00Z');
  fecha.setUTCMinutes(fecha.getUTCMinutes() + minutos);
  return fecha.toISOString().slice(0, 16).replace('T', ' ');
}

function sumarDias(fecha, dias) {
  const valor = new Date(fecha + 'T00:00:00Z');
  valor.setUTCDate(valor.getUTCDate() + dias);
  return valor.toISOString().slice(0, 10);
}

function texto(valor, campo, opciones) {
  const max = (opciones && opciones.max) || 200;
  if (valor === undefined || valor === null) valor = '';
  if (typeof valor !== 'string') throw new ErrorApi(400, 'El campo ' + campo + ' debe ser texto.');
  valor = valor.trim();
  if (opciones && opciones.requerido && !valor) throw new ErrorApi(400, 'El campo ' + campo + ' es obligatorio.');
  if (valor.length > max) throw new ErrorApi(400, 'El campo ' + campo + ' admite máximo ' + max + ' caracteres.');
  return valor;
}

function entero(valor, campo, opciones) {
  const min = opciones && opciones.min !== undefined ? opciones.min : 0;
  const max = opciones && opciones.max !== undefined ? opciones.max : Number.MAX_SAFE_INTEGER;
  const numero = typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : valor;
  if (!Number.isInteger(numero) || numero < min || numero > max) {
    throw new ErrorApi(400, 'El campo ' + campo + ' debe ser un número entero entre ' + min + ' y ' + max + '.');
  }
  return numero;
}

function celular(valor) {
  const limpio = typeof valor === 'string' ? valor.replace(/\D/g, '').replace(/^57(?=3\d{9}$)/, '') : '';
  if (!/^3\d{9}$/.test(limpio)) throw new ErrorApi(400, 'El celular debe tener 10 dígitos y empezar por 3.');
  return limpio;
}

const vacio = (valor) => valor === undefined || valor === null || valor === '';
const porOrden = (a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es');

// ---------- Tablas sobre la hoja ----------

// Lecturas de esta petición. Se borran al escribir para no leer datos viejos.
let memoria = {};

function hojaDe(nombre) {
  const hoja = SpreadsheetApp.getActive().getSheetByName(nombre);
  if (!hoja) throw new Error('Falta la pestaña "' + nombre + '". Ejecuta la función instalar.');
  return hoja;
}

// Si alguien escribió a mano y la hoja convirtió el texto en fecha u hora, se vuelve a texto.
function leerValor(columna, valor) {
  if (valor instanceof Date) {
    const formato = columna === 'abre' || columna === 'cierra' ? 'HH:mm' : 'yyyy-MM-dd HH:mm';
    valor = Utilities.formatDate(valor, ZONA, formato);
  }
  if (NUMERICOS.indexOf(columna) >= 0) return vacio(valor) ? null : Number(valor);
  return vacio(valor) ? '' : String(valor);
}

function filas(nombre) {
  if (!memoria[nombre]) {
    const columnas = TABLAS[nombre];
    const valores = hojaDe(nombre).getDataRange().getValues();
    memoria[nombre] = [];
    for (let i = 1; i < valores.length; i++) {
      if (vacio(valores[i][0])) continue;
      const fila = { _fila: i + 1 };
      columnas.forEach((columna, j) => (fila[columna] = leerValor(columna, valores[i][j])));
      memoria[nombre].push(fila);
    }
  }
  return memoria[nombre];
}

const buscar = (nombre, id) => filas(nombre).find((fila) => fila.id === id) || null;
const limpia = (fila) => {
  const copia = Object.assign({}, fila);
  delete copia._fila;
  return copia;
};

// Todo se guarda como texto para que la hoja no convierta fechas, horas ni celulares.
function aValores(nombre, objeto) {
  return [TABLAS[nombre].map((columna) => (vacio(objeto[columna]) ? '' : String(objeto[columna])))];
}

function insertar(nombre, objeto) {
  const actuales = filas(nombre);
  const id = actuales.reduce((maximo, fila) => Math.max(maximo, fila.id || 0), 0) + 1;
  const nuevo = Object.assign({}, objeto, { id: id });
  const hoja = hojaDe(nombre);
  const fila = Math.max(hoja.getLastRow(), 1) + 1;
  hoja.getRange(fila, 1, 1, TABLAS[nombre].length).setNumberFormat('@').setValues(aValores(nombre, nuevo));
  delete memoria[nombre];
  return id;
}

function actualizar(nombre, fila, cambios) {
  const nuevo = Object.assign({}, fila, cambios);
  hojaDe(nombre).getRange(fila._fila, 1, 1, TABLAS[nombre].length).setNumberFormat('@').setValues(aValores(nombre, nuevo));
  delete memoria[nombre];
}

// Borra las filas que cumplan la condición, de abajo hacia arriba para no correr los números de fila.
function borrarDonde(nombre, condicion) {
  const hoja = hojaDe(nombre);
  const elegidas = filas(nombre).filter(condicion).map((fila) => fila._fila).sort((a, b) => b - a);
  elegidas.forEach((numero) => hoja.deleteRow(numero));
  delete memoria[nombre];
  return elegidas.length;
}

function configuracion() {
  const valores = {};
  filas('configuracion').forEach((fila) => (valores[fila.clave] = fila.valor));
  return valores;
}

const intervalo = () => Number(configuracion().intervalo_min) || 30;
const diasVisibles = () => Math.min(Number(configuracion().dias_visibles) || 14, 60);
const maxProfesionales = () => Number(configuracion().max_profesionales) || 3;

// ---------- Disponibilidad ----------

const ocupa = (cita) => cita.estado !== 'cancelada';

function horasLibresDe(fecha, duracion, profesionalId) {
  const desde = fecha + ' 00:00';
  const hasta = sumarDias(fecha, 1) + ' 00:00';
  const dia = diaSemana(fecha);
  const rangos = filas('horario')
    .filter((h) => h.profesional_id === profesionalId && h.dia_semana === dia)
    .sort((a, b) => a.abre.localeCompare(b.abre));
  const ocupados = filas('citas')
    .filter((c) => c.profesional_id === profesionalId && ocupa(c) && c.inicio < hasta && c.fin > desde)
    .concat(
      filas('bloqueos').filter(
        (b) => (b.profesional_id === null || b.profesional_id === profesionalId) && b.inicio < hasta && b.fin > desde,
      ),
    );

  const ahora = ahoraBogota();
  const paso = intervalo();
  const libres = [];
  rangos.forEach((rango) => {
    const fin = minutosDeHora(rango.cierra);
    for (let minuto = minutosDeHora(rango.abre); minuto + duracion <= fin; minuto += paso) {
      const inicio = fecha + ' ' + horaDeMinutos(minuto);
      const termina = minuto + duracion >= 24 * 60 ? hasta : fecha + ' ' + horaDeMinutos(minuto + duracion);
      if (inicio <= ahora) continue;
      if (ocupados.some((o) => o.inicio < termina && o.fin > inicio)) continue;
      libres.push(horaDeMinutos(minuto));
    }
  });
  return libres;
}

// Sin profesional ("cualquiera"): una hora está libre si algún profesional activo la tiene libre.
function horasLibres(fecha, duracion, profesionalId) {
  if (profesionalId) return horasLibresDe(fecha, duracion, profesionalId);
  const todas = {};
  filas('profesionales')
    .filter((p) => p.activo)
    .forEach((p) => horasLibresDe(fecha, duracion, p.id).forEach((hora) => (todas[hora] = true)));
  return Object.keys(todas).sort();
}

// ---------- Página pública ----------

function infoPublica() {
  const hoy = ahoraBogota().slice(0, 10);
  const activos = filas('profesionales').filter((p) => p.activo);
  const idsActivos = activos.map((p) => p.id);
  const abiertos = {};
  filas('horario')
    .filter((h) => idsActivos.indexOf(h.profesional_id) >= 0)
    .forEach((h) => (abiertos[h.dia_semana] = true));
  const fechas = [];
  for (let i = 0; i < diasVisibles(); i++) {
    const fecha = sumarDias(hoy, i);
    if (abiertos[diaSemana(fecha)]) fechas.push(fecha);
  }
  const config = configuracion();
  return {
    negocio: config.negocio || '',
    demo: false,
    whatsapp: config.whatsapp || '',
    servicios: filas('servicios')
      .filter((s) => s.activo)
      .sort(porOrden)
      .map((s) => ({ id: s.id, nombre: s.nombre, duracion_min: s.duracion_min, precio: s.precio })),
    profesionales: activos.sort(porOrden).map((p) => ({ id: p.id, nombre: p.nombre })),
    fechas: fechas,
  };
}

function disponibilidadPublica(consulta) {
  const fecha = validarFecha(consulta.fecha);
  const hoy = ahoraBogota().slice(0, 10);
  if (fecha < hoy || fecha >= sumarDias(hoy, diasVisibles())) throw new ErrorApi(400, 'La fecha está fuera del rango disponible.');
  const servicio = buscar('servicios', entero(consulta.servicio, 'servicio', { min: 1 }));
  if (!servicio || !servicio.activo) throw new ErrorApi(404, 'El servicio no existe.');
  let profesionalId = null;
  if (consulta.profesional) {
    profesionalId = entero(consulta.profesional, 'profesional', { min: 1 });
    const profesional = buscar('profesionales', profesionalId);
    if (!profesional || !profesional.activo) throw new ErrorApi(404, 'El profesional no existe.');
  }
  return { fecha: fecha, horas: horasLibres(fecha, servicio.duracion_min, profesionalId) };
}

// Reserva desde la página: solo para celulares que ya están en la pestaña clientes.
// El celular no es una clave: quien conozca el número de un cliente puede agendar a su nombre.
function reservarPublico(cuerpo) {
  if (Number(cache().get('reservas:hora') || 0) >= 30) {
    throw new ErrorApi(429, 'Hay demasiadas reservas en este momento. Escríbenos por WhatsApp.');
  }
  const cel = celular(cuerpo.celular);
  const cliente = filas('clientes').find((c) => c.celular === cel);
  if (!cliente) throw new ErrorApi(403, 'Tu número no está registrado. Escríbenos por WhatsApp para agendar.');
  const ahora = ahoraBogota();
  if (filas('citas').some((c) => c.cliente_id === cliente.id && c.estado === 'confirmada' && c.inicio > ahora)) {
    throw new ErrorApi(409, 'Ya tienes una cita pendiente. Para cambiarla, escríbenos por WhatsApp.');
  }
  const fecha = validarFecha(cuerpo.fecha);
  const hoy = ahora.slice(0, 10);
  if (fecha < hoy || fecha >= sumarDias(hoy, diasVisibles())) throw new ErrorApi(400, 'La fecha está fuera del rango disponible.');
  if (!horaValida.test(cuerpo.hora || '')) throw new ErrorApi(400, 'La hora no es válida.');
  const servicio = buscar('servicios', entero(cuerpo.servicio, 'servicio', { min: 1 }));
  if (!servicio || !servicio.activo) throw new ErrorApi(404, 'El servicio no existe.');

  // Con "cualquiera" se asigna el primer profesional, en su orden, que tenga esa hora libre.
  let candidatos = filas('profesionales').filter((p) => p.activo).sort(porOrden);
  if (cuerpo.profesional) {
    const profesionalId = entero(cuerpo.profesional, 'profesional', { min: 1 });
    candidatos = candidatos.filter((p) => p.id === profesionalId);
    if (!candidatos.length) throw new ErrorApi(404, 'El profesional no existe.');
  }
  const elegido = candidatos.find((p) => horasLibresDe(fecha, servicio.duracion_min, p.id).indexOf(cuerpo.hora) >= 0);
  if (!elegido) throw new ErrorApi(409, 'Esa hora ya no está disponible. Elige otra.');

  const inicio = fecha + ' ' + cuerpo.hora;
  const id = insertar('citas', {
    cliente_id: cliente.id,
    servicio_id: servicio.id,
    profesional_id: elegido.id,
    inicio: inicio,
    fin: sumarMinutos(inicio, servicio.duracion_min),
    estado: 'confirmada',
    notas: 'Agendada desde la página',
    creada_en: ahora,
    actualizada_en: ahora,
  });
  cache().put('reservas:hora', String(Number(cache().get('reservas:hora') || 0) + 1), 3600);
  return {
    estado: 201,
    datos: { cita: { id: id, inicio: inicio, servicio: servicio.nombre, profesional: elegido.nombre, cliente: cliente.nombre } },
  };
}

// ---------- Sesión ----------

const propiedades = () => PropertiesService.getScriptProperties();
const cache = () => CacheService.getScriptCache();
const aHex = (bytes) => bytes.map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');

// HMAC-SHA256 repetido: Apps Script no tiene PBKDF2.
function derivar(contrasena, sal) {
  let valor = contrasena;
  for (let i = 0; i < 2000; i++) valor = aHex(Utilities.computeHmacSha256Signature(valor, sal));
  return valor;
}

// La contraseña que el dueño define en el panel queda con hash en ADMIN_HASH.
// Si no ha definido ninguna, vale AGENDA_PASSWORD; borrar ADMIN_HASH la restablece a esa.
function contrasenaValida(contrasena) {
  if (typeof contrasena !== 'string' || !contrasena) return false;
  const hash = propiedades().getProperty('ADMIN_HASH');
  if (hash) {
    const partes = hash.split(':');
    return derivar(contrasena, partes[0]) === partes[1];
  }
  const inicial = propiedades().getProperty('AGENDA_PASSWORD') || '';
  if (inicial.length < 12) throw new ErrorApi(503, 'Falta configurar AGENDA_PASSWORD (12 caracteres o más) en las propiedades del script.');
  return contrasena === inicial;
}

// Cambiar la contraseña sube la versión y cierra todas las sesiones.
const versionClave = () => propiedades().getProperty('VERSION_CLAVE') || '0';

function nuevaSesion() {
  const token = Utilities.getUuid() + Utilities.getUuid();
  cache().put('sesion:' + token, versionClave(), DURACION_SESION);
  return token;
}

function exigirSesion(token) {
  const version = typeof token === 'string' && token ? cache().get('sesion:' + token) : null;
  if (!version || version !== versionClave()) throw new ErrorApi(401, 'Inicia sesión.');
  cache().put('sesion:' + token, version, DURACION_SESION);
}

// Google no entrega la IP de quien llama: el bloqueo tras varios intentos fallidos es para todos.
function iniciarSesion(contrasena) {
  if (cache().get('login:bloqueado')) throw new ErrorApi(429, 'Demasiados intentos. Espera 15 minutos.');
  if (!contrasenaValida(contrasena)) {
    const fallos = Number(cache().get('login:fallos') || 0) + 1;
    if (fallos >= MAX_FALLOS) {
      cache().put('login:bloqueado', '1', BLOQUEO_SEGUNDOS);
      cache().remove('login:fallos');
    } else {
      cache().put('login:fallos', String(fallos), BLOQUEO_SEGUNDOS);
    }
    Utilities.sleep(1000);
    throw new ErrorApi(401, 'Contraseña incorrecta.');
  }
  cache().remove('login:fallos');
  return { ok: true, token: nuevaSesion() };
}

function cambiarContrasena(cuerpo) {
  if (!contrasenaValida(cuerpo.actual)) throw new ErrorApi(400, 'La contraseña actual no es correcta.');
  const nueva = cuerpo.nueva;
  if (typeof nueva !== 'string' || nueva.length < 12) throw new ErrorApi(400, 'La contraseña nueva debe tener 12 caracteres o más.');
  if (nueva.length > 200) throw new ErrorApi(400, 'La contraseña nueva es demasiado larga.');
  const sal = Utilities.getUuid();
  propiedades().setProperty('ADMIN_HASH', sal + ':' + derivar(nueva, sal));
  propiedades().setProperty('VERSION_CLAVE', String(Number(versionClave()) + 1));
  return { ok: true, token: nuevaSesion() };
}

// ---------- Citas ----------

function citaCompleta(cita) {
  const servicio = buscar('servicios', cita.servicio_id);
  const profesional = buscar('profesionales', cita.profesional_id);
  const cliente = buscar('clientes', cita.cliente_id) || {};
  return {
    id: cita.id,
    inicio: cita.inicio,
    fin: cita.fin,
    estado: cita.estado,
    notas: cita.notas,
    servicio_id: cita.servicio_id,
    servicio: servicio ? servicio.nombre : null,
    precio: servicio ? servicio.precio : null,
    profesional_id: cita.profesional_id,
    profesional: profesional ? profesional.nombre : null,
    cliente_id: cita.cliente_id,
    cliente: cliente.nombre,
    celular: cliente.celular,
  };
}

function hayCruce(profesionalId, inicio, fin, excluirId) {
  return filas('citas').some(
    (o) => ocupa(o) && o.profesional_id === profesionalId && o.id !== excluirId && o.inicio < fin && o.fin > inicio,
  );
}

const errorCruce = () => new ErrorApi(409, 'Ese horario se cruza con otra cita.');

function profesionalPorId(id, soloActivo) {
  const profesional = buscar('profesionales', id);
  if (!profesional || (soloActivo && !profesional.activo)) throw new ErrorApi(400, 'El profesional no existe o está inactivo.');
  return profesional;
}

function servicioPorId(id) {
  const servicio = buscar('servicios', id);
  if (!servicio) throw new ErrorApi(400, 'El servicio no existe.');
  return servicio;
}

// Avisos que no impiden guardar: el administrador decide.
function avisosDeCita(inicio, fin, profesionalId) {
  const avisos = [];
  const fecha = inicio.slice(0, 10);
  const dia = diaSemana(fecha);
  const dentro = filas('horario').some(
    (r) => r.profesional_id === profesionalId && r.dia_semana === dia && fecha + ' ' + r.abre <= inicio && fin <= fecha + ' ' + r.cierra,
  );
  if (!dentro) avisos.push('La cita queda fuera del horario de atención.');
  const bloqueo = filas('bloqueos').find(
    (b) => (b.profesional_id === null || b.profesional_id === profesionalId) && b.inicio < fin && b.fin > inicio,
  );
  if (bloqueo) avisos.push('La cita se cruza con un bloqueo' + (bloqueo.motivo ? ': ' + bloqueo.motivo : '') + '.');
  return avisos;
}

function datosCita(cuerpo) {
  const servicio = servicioPorId(entero(cuerpo.servicio_id, 'servicio_id', { min: 1 }));
  const profesional = profesionalPorId(entero(cuerpo.profesional_id, 'profesional_id', { min: 1 }));
  const inicio = validarMomento(cuerpo.inicio);
  const duracion = vacio(cuerpo.duracion_min)
    ? servicio.duracion_min
    : entero(cuerpo.duracion_min, 'duracion_min', { min: 5, max: 480 });
  return {
    servicio_id: servicio.id,
    profesional_id: profesional.id,
    inicio: inicio,
    fin: sumarMinutos(inicio, duracion),
    notas: texto(cuerpo.notas, 'notas', { max: 500 }),
  };
}

function listarCitas(consulta) {
  const desde = validarFecha(consulta.desde || ahoraBogota().slice(0, 10));
  const hasta = validarFecha(consulta.hasta || desde);
  const limite = sumarDias(hasta, 1) + ' 00:00';
  const profesional = consulta.profesional ? entero(consulta.profesional, 'profesional', { min: 1 }) : null;
  const orden = {};
  filas('profesionales').forEach((p) => (orden[p.id] = p.orden));
  const citas = filas('citas')
    .filter((c) => c.inicio >= desde + ' 00:00' && c.inicio < limite && (!profesional || c.profesional_id === profesional))
    .sort((a, b) => a.inicio.localeCompare(b.inicio) || (orden[a.profesional_id] || 0) - (orden[b.profesional_id] || 0));
  return { citas: citas.map(citaCompleta) };
}

// Crea o actualiza el cliente por su celular y devuelve su id.
function clientePorCelular(cel, nombre) {
  const existente = filas('clientes').find((c) => c.celular === cel);
  if (!existente) return insertar('clientes', { nombre: nombre, celular: cel, notas: '' });
  if (existente.nombre !== nombre) actualizar('clientes', existente, { nombre: nombre });
  return existente.id;
}

function crearCita(cuerpo) {
  const cel = celular(cuerpo.celular);
  const nombre = texto(cuerpo.nombre, 'nombre', { max: 80, requerido: true });
  const cita = datosCita(cuerpo);
  if (hayCruce(cita.profesional_id, cita.inicio, cita.fin, 0)) throw errorCruce();
  const ahora = ahoraBogota();
  const id = insertar(
    'citas',
    Object.assign(cita, { cliente_id: clientePorCelular(cel, nombre), estado: 'confirmada', creada_en: ahora, actualizada_en: ahora }),
  );
  return { estado: 201, datos: { cita: citaCompleta(buscar('citas', id)), avisos: avisosDeCita(cita.inicio, cita.fin, cita.profesional_id) } };
}

function actualizarCita(cuerpo, id) {
  const actual = buscar('citas', id);
  if (!actual) throw new ErrorApi(404, 'La cita no existe.');
  const cita = datosCita(cuerpo);
  const estado = vacio(cuerpo.estado) ? 'confirmada' : cuerpo.estado;
  if (ESTADOS.indexOf(estado) < 0) throw new ErrorApi(400, 'El estado no es válido.');
  if (estado !== 'cancelada' && hayCruce(cita.profesional_id, cita.inicio, cita.fin, id)) throw errorCruce();
  actualizar('citas', actual, Object.assign(cita, { estado: estado, actualizada_en: ahoraBogota() }));
  const avisos = estado === 'cancelada' ? [] : avisosDeCita(cita.inicio, cita.fin, cita.profesional_id);
  return { cita: citaCompleta(buscar('citas', id)), avisos: avisos };
}

// Volver a "confirmada" una cita cancelada exige que el horario siga libre.
function cambiarEstado(cuerpo, id) {
  if (ESTADOS.indexOf(cuerpo.estado) < 0) throw new ErrorApi(400, 'El estado no es válido.');
  const cita = buscar('citas', id);
  if (!cita) throw new ErrorApi(404, 'La cita no existe.');
  if (cuerpo.estado !== 'cancelada' && hayCruce(cita.profesional_id, cita.inicio, cita.fin, id)) throw errorCruce();
  actualizar('citas', cita, { estado: cuerpo.estado, actualizada_en: ahoraBogota() });
  return { cita: citaCompleta(buscar('citas', id)) };
}

function borrarCita(id) {
  if (!borrarDonde('citas', (c) => c.id === id)) throw new ErrorApi(404, 'La cita no existe.');
  return { ok: true };
}

// ---------- Clientes ----------

function buscarClientes(consulta) {
  const q = texto(consulta.q, 'q', { max: 80 }).toLowerCase();
  const cuenta = {};
  filas('citas').forEach((c) => (cuenta[c.cliente_id] = (cuenta[c.cliente_id] || 0) + 1));
  const clientes = filas('clientes')
    .filter((c) => c.nombre.toLowerCase().indexOf(q) >= 0 || c.celular.indexOf(q) >= 0)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .slice(0, 20)
    .map((c) => Object.assign(limpia(c), { citas: cuenta[c.id] || 0 }));
  return { clientes: clientes };
}

function historialCliente(id) {
  const cliente = buscar('clientes', id);
  if (!cliente) throw new ErrorApi(404, 'El cliente no existe.');
  const citas = filas('citas')
    .filter((c) => c.cliente_id === id)
    .sort((a, b) => b.inicio.localeCompare(a.inicio))
    .slice(0, 100)
    .map(citaCompleta);
  return { cliente: limpia(cliente), citas: citas };
}

function actualizarCliente(cuerpo, id) {
  const cliente = buscar('clientes', id);
  if (!cliente) throw new ErrorApi(404, 'El cliente no existe.');
  const cel = celular(cuerpo.celular);
  if (filas('clientes').some((c) => c.celular === cel && c.id !== id)) throw new ErrorApi(409, 'Ya existe otro cliente con ese celular.');
  actualizar('clientes', cliente, {
    nombre: texto(cuerpo.nombre, 'nombre', { max: 80, requerido: true }),
    celular: cel,
    notas: texto(cuerpo.notas, 'notas', { max: 500 }),
  });
  return { ok: true };
}

// Borra al cliente y su historial (derecho de supresión, Ley 1581).
function borrarCliente(id) {
  if (!buscar('clientes', id)) throw new ErrorApi(404, 'El cliente no existe.');
  borrarDonde('citas', (c) => c.cliente_id === id);
  borrarDonde('clientes', (c) => c.id === id);
  return { ok: true };
}

// ---------- Servicios ----------

function datosServicio(cuerpo) {
  return {
    nombre: texto(cuerpo.nombre, 'nombre', { max: 60, requerido: true }),
    duracion_min: entero(cuerpo.duracion_min, 'duracion_min', { min: 5, max: 480 }),
    precio: entero(vacio(cuerpo.precio) ? 0 : cuerpo.precio, 'precio', { min: 0, max: 100000000 }),
    activo: cuerpo.activo === false || cuerpo.activo === 0 ? 0 : 1,
    orden: entero(vacio(cuerpo.orden) ? 0 : cuerpo.orden, 'orden', { min: 0, max: 1000 }),
  };
}

const listarServicios = () => ({ servicios: filas('servicios').slice().sort(porOrden).map(limpia) });

function crearServicio(cuerpo) {
  return { estado: 201, datos: { id: insertar('servicios', datosServicio(cuerpo)) } };
}

function actualizarServicio(cuerpo, id) {
  const servicio = buscar('servicios', id);
  if (!servicio) throw new ErrorApi(404, 'El servicio no existe.');
  actualizar('servicios', servicio, datosServicio(cuerpo));
  return { ok: true };
}

function borrarServicio(id) {
  if (filas('citas').some((c) => c.servicio_id === id)) {
    throw new ErrorApi(409, 'El servicio tiene citas. Desactívalo en lugar de borrarlo.');
  }
  if (!borrarDonde('servicios', (s) => s.id === id)) throw new ErrorApi(404, 'El servicio no existe.');
  return { ok: true };
}

// ---------- Horario ----------

function leerHorario() {
  const horario = filas('horario')
    .slice()
    .sort((a, b) => a.profesional_id - b.profesional_id || a.dia_semana - b.dia_semana || a.abre.localeCompare(b.abre))
    .map((h) => ({ profesional_id: h.profesional_id, dia_semana: h.dia_semana, abre: h.abre, cierra: h.cierra }));
  return { horario: horario };
}

// Reemplaza el horario de la semana de un profesional.
function guardarHorario(cuerpo) {
  const profesional = profesionalPorId(entero(cuerpo.profesional_id, 'profesional_id', { min: 1 }));
  if (!Array.isArray(cuerpo.horario) || cuerpo.horario.length > 50) throw new ErrorApi(400, 'El horario no es válido.');
  const rangos = cuerpo.horario.map((r) => {
    const dia = entero(r.dia_semana, 'dia_semana', { min: 0, max: 6 });
    if (!horaValida.test(r.abre || '') || !horaValida.test(r.cierra || '') || r.abre >= r.cierra) {
      throw new ErrorApi(400, 'Cada rango necesita hora de apertura menor que la de cierre (HH:MM).');
    }
    return { dia_semana: dia, abre: r.abre, cierra: r.cierra };
  });
  rangos.sort((a, b) => a.dia_semana - b.dia_semana || a.abre.localeCompare(b.abre));
  for (let i = 1; i < rangos.length; i++) {
    if (rangos[i].dia_semana === rangos[i - 1].dia_semana && rangos[i].abre < rangos[i - 1].cierra) {
      throw new ErrorApi(400, 'Hay rangos que se cruzan en el mismo día.');
    }
  }
  borrarDonde('horario', (h) => h.profesional_id === profesional.id);
  rangos.forEach((r) => insertar('horario', Object.assign({ profesional_id: profesional.id }, r)));
  return { ok: true };
}

// ---------- Bloqueos ----------

function listarBloqueos() {
  const ahora = ahoraBogota();
  const bloqueos = filas('bloqueos')
    .filter((b) => b.fin > ahora)
    .sort((a, b) => a.inicio.localeCompare(b.inicio))
    .slice(0, 200)
    .map((b) => {
      const profesional = b.profesional_id ? buscar('profesionales', b.profesional_id) : null;
      return Object.assign(limpia(b), { profesional: profesional ? profesional.nombre : null });
    });
  return { bloqueos: bloqueos };
}

function crearBloqueo(cuerpo) {
  const inicio = validarMomento(cuerpo.inicio, 'inicio');
  const fin = validarMomento(cuerpo.fin, 'fin');
  if (inicio >= fin) throw new ErrorApi(400, 'El fin debe ser posterior al inicio.');
  // Sin profesional = bloqueo general para todo el negocio.
  const profesionalId = cuerpo.profesional_id ? profesionalPorId(entero(cuerpo.profesional_id, 'profesional_id', { min: 1 })).id : null;
  const id = insertar('bloqueos', { inicio: inicio, fin: fin, motivo: texto(cuerpo.motivo, 'motivo', { max: 120 }), profesional_id: profesionalId });
  const cruces = filas('citas').filter(
    (c) => ocupa(c) && c.inicio < fin && c.fin > inicio && (profesionalId === null || c.profesional_id === profesionalId),
  ).length;
  return { estado: 201, datos: { id: id, avisos: cruces ? ['Hay ' + cruces + ' cita(s) dentro del bloqueo. Revísalas.'] : [] } };
}

function borrarBloqueo(id) {
  if (!borrarDonde('bloqueos', (b) => b.id === id)) throw new ErrorApi(404, 'El bloqueo no existe.');
  return { ok: true };
}

// ---------- Profesionales ----------

function datosProfesional(cuerpo) {
  return {
    nombre: texto(cuerpo.nombre, 'nombre', { max: 40, requerido: true }),
    activo: cuerpo.activo === false || cuerpo.activo === 0 ? 0 : 1,
    orden: entero(vacio(cuerpo.orden) ? 0 : cuerpo.orden, 'orden', { min: 0, max: 1000 }),
  };
}

function revisarLimite(excluirId) {
  const activos = filas('profesionales').filter((p) => p.activo && p.id !== excluirId).length;
  if (activos >= maxProfesionales()) throw new ErrorApi(409, 'El plan permite hasta ' + maxProfesionales() + ' profesionales activos.');
}

const listarProfesionales = () => ({ profesionales: filas('profesionales').slice().sort(porOrden).map(limpia), maximo: maxProfesionales() });

function crearProfesional(cuerpo) {
  const datos = datosProfesional(cuerpo);
  if (datos.activo) revisarLimite(0);
  return { estado: 201, datos: { id: insertar('profesionales', datos) } };
}

function actualizarProfesional(cuerpo, id) {
  const profesional = buscar('profesionales', id);
  if (!profesional) throw new ErrorApi(404, 'El profesional no existe.');
  const datos = datosProfesional(cuerpo);
  if (datos.activo) revisarLimite(id);
  actualizar('profesionales', profesional, datos);
  return { ok: true };
}

function borrarProfesional(id) {
  if (filas('citas').some((c) => c.profesional_id === id)) {
    throw new ErrorApi(409, 'Este profesional tiene citas. Desactívalo en lugar de borrarlo.');
  }
  if (!buscar('profesionales', id)) throw new ErrorApi(404, 'El profesional no existe.');
  borrarDonde('horario', (h) => h.profesional_id === id);
  borrarDonde('bloqueos', (b) => b.profesional_id === id);
  borrarDonde('profesionales', (p) => p.id === id);
  return { ok: true };
}

function disponibilidadAdmin(consulta) {
  const fecha = validarFecha(consulta.fecha);
  const duracion = entero(consulta.duracion || '30', 'duracion', { min: 5, max: 480 });
  const profesionalId = consulta.profesional ? entero(consulta.profesional, 'profesional', { min: 1 }) : null;
  return { fecha: fecha, horas: horasLibres(fecha, duracion, profesionalId) };
}

// ---------- Rutas ----------

// [método, ruta, función(cuerpo, id, consulta), escribe]. Las que escriben corren con candado
// para que dos peticiones al tiempo no creen citas cruzadas.
const RUTAS = [
  ['GET', /^citas$/, (c, id, q) => listarCitas(q)],
  ['POST', /^citas$/, (c) => crearCita(c), true],
  ['PUT', /^citas\/(\d+)$/, (c, id) => actualizarCita(c, id), true],
  ['PATCH', /^citas\/(\d+)\/estado$/, (c, id) => cambiarEstado(c, id), true],
  ['DELETE', /^citas\/(\d+)$/, (c, id) => borrarCita(id), true],
  ['GET', /^clientes$/, (c, id, q) => buscarClientes(q)],
  ['GET', /^clientes\/(\d+)$/, (c, id) => historialCliente(id)],
  ['PUT', /^clientes\/(\d+)$/, (c, id) => actualizarCliente(c, id), true],
  ['DELETE', /^clientes\/(\d+)$/, (c, id) => borrarCliente(id), true],
  ['GET', /^servicios$/, () => listarServicios()],
  ['POST', /^servicios$/, (c) => crearServicio(c), true],
  ['PUT', /^servicios\/(\d+)$/, (c, id) => actualizarServicio(c, id), true],
  ['DELETE', /^servicios\/(\d+)$/, (c, id) => borrarServicio(id), true],
  ['GET', /^profesionales$/, () => listarProfesionales()],
  ['POST', /^profesionales$/, (c) => crearProfesional(c), true],
  ['PUT', /^profesionales\/(\d+)$/, (c, id) => actualizarProfesional(c, id), true],
  ['DELETE', /^profesionales\/(\d+)$/, (c, id) => borrarProfesional(id), true],
  ['GET', /^horario$/, () => leerHorario()],
  ['PUT', /^horario$/, (c) => guardarHorario(c), true],
  ['GET', /^bloqueos$/, () => listarBloqueos()],
  ['POST', /^bloqueos$/, (c) => crearBloqueo(c), true],
  ['DELETE', /^bloqueos\/(\d+)$/, (c, id) => borrarBloqueo(id), true],
  ['GET', /^disponibilidad$/, (c, id, q) => disponibilidadAdmin(q)],
];

function conCandado(accion) {
  const candado = LockService.getScriptLock();
  if (!candado.tryLock(20000)) throw new ErrorApi(503, 'La agenda está ocupada. Intenta de nuevo en unos segundos.');
  try {
    memoria = {};
    return accion();
  } finally {
    candado.releaseLock();
  }
}

function separarConsulta(ruta) {
  const partes = String(ruta || '').split('?');
  const consulta = {};
  (partes[1] || '').split('&').forEach((par) => {
    if (!par) return;
    const igual = par.indexOf('=');
    const clave = decodeURIComponent((igual < 0 ? par : par.slice(0, igual)).replace(/\+/g, ' '));
    consulta[clave] = igual < 0 ? '' : decodeURIComponent(par.slice(igual + 1).replace(/\+/g, ' '));
  });
  return { ruta: partes[0], consulta: consulta };
}

function rutaAdmin(metodo, ruta, cuerpo, consulta, token) {
  if (ruta === 'publico/reservar' && metodo === 'POST') return conCandado(() => reservarPublico(cuerpo));
  if (ruta === 'entrar' && metodo === 'POST') return iniciarSesion(cuerpo.contrasena);
  if (ruta === 'salir' && metodo === 'POST') {
    if (typeof token === 'string' && token) cache().remove('sesion:' + token);
    return { ok: true };
  }
  exigirSesion(token);
  if (ruta === 'contrasena' && metodo === 'POST') return cambiarContrasena(cuerpo);
  for (let i = 0; i < RUTAS.length; i++) {
    const regla = RUTAS[i];
    const coincidencia = ruta.match(regla[1]);
    if (coincidencia && metodo === regla[0]) {
      const id = coincidencia[1] ? Number(coincidencia[1]) : undefined;
      return regla[3] ? conCandado(() => regla[2](cuerpo, id, consulta)) : regla[2](cuerpo, id, consulta);
    }
  }
  throw new ErrorApi(404, 'Ruta no encontrada.');
}

// Respuesta { estado, datos }: Apps Script siempre contesta 200, el estado real va adentro.
function responder(estado, datos) {
  return ContentService.createTextOutput(JSON.stringify({ estado: estado, datos: datos })).setMimeType(ContentService.MimeType.JSON);
}

function atender(accion, descripcion) {
  memoria = {};
  try {
    const resultado = accion();
    if (resultado && resultado.estado && resultado.datos) return responder(resultado.estado, resultado.datos);
    return responder(200, resultado);
  } catch (error) {
    if (error instanceof ErrorApi) return responder(error.estado, { error: error.message });
    console.error(error);
    avisar('Error en la agenda', descripcion + '\n\n' + (error.stack || error.message));
    return responder(500, { error: 'Error interno. Ya nos llegó el aviso.' });
  }
}

// Página pública: GET ?ruta=publico/info o ?ruta=publico/disponibilidad&fecha=...&servicio=...
function doGet(e) {
  const consulta = (e && e.parameter) || {};
  return atender(() => {
    if (consulta.ruta === 'publico/info') return infoPublica();
    if (consulta.ruta === 'publico/disponibilidad') return disponibilidadPublica(consulta);
    throw new ErrorApi(404, 'Ruta no encontrada.');
  }, 'GET ' + consulta.ruta);
}

// Panel: POST con cuerpo de texto JSON { metodo, ruta, cuerpo, token }. Se manda como texto
// (no application/json) para que el navegador no haga una consulta previa que Apps Script no responde.
function doPost(e) {
  let peticion = {};
  try {
    peticion = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (error) {
    return responder(400, { error: 'El JSON no es válido.' });
  }
  const partes = separarConsulta(peticion.ruta);
  return atender(
    () => rutaAdmin(String(peticion.metodo || 'GET').toUpperCase(), partes.ruta, peticion.cuerpo || {}, partes.consulta, peticion.token),
    String(peticion.metodo) + ' ' + partes.ruta,
  );
}

// ---------- Correos ----------

function destinatarios() {
  return propiedades().getProperty('AVISOS_PARA') || Session.getEffectiveUser().getEmail();
}

// Máximo un correo por hora por asunto, para no llenar el buzón si algo falla en cadena.
function avisar(asunto, detalle) {
  try {
    const clave = 'aviso:' + asunto;
    if (cache().get(clave)) return;
    cache().put(clave, '1', 3600);
    MailApp.sendEmail(destinatarios(), asunto, detalle);
  } catch (error) {
    console.error(error);
  }
}

// Cada noche (ver instalar): correo al dueño con las citas de mañana, por profesional.
function resumenDiario() {
  memoria = {};
  const manana = sumarDias(ahoraBogota().slice(0, 10), 1);
  const citas = listarCitas({ desde: manana }).citas.filter((c) => c.estado !== 'cancelada');
  const negocio = configuracion().negocio || 'la agenda';
  if (!citas.length) return;
  const porProfesional = {};
  citas.forEach((c) => (porProfesional[c.profesional] = (porProfesional[c.profesional] || []).concat([c])));
  const lineas = [];
  Object.keys(porProfesional).forEach((nombre) => {
    lineas.push(nombre + ' (' + porProfesional[nombre].length + ')');
    porProfesional[nombre].forEach((c) => {
      lineas.push('  ' + c.inicio.slice(11) + '  ' + c.cliente + ' · ' + (c.servicio || 'sin servicio') + ' · wa.me/57' + c.celular);
    });
    lineas.push('');
  });
  MailApp.sendEmail(
    destinatarios(),
    'Citas de mañana en ' + negocio + ': ' + citas.length,
    'Citas del ' + manana + ':\n\n' + lineas.join('\n') + '\nLas ves y cambias en el panel de la agenda.',
  );
}

// ---------- Instalación ----------

// Crea las pestañas que falten con sus encabezados y la configuración inicial. No borra nada.
function instalar() {
  const libro = SpreadsheetApp.getActive();
  libro.setSpreadsheetTimeZone(ZONA);
  Object.keys(TABLAS).forEach((nombre) => {
    let hoja = libro.getSheetByName(nombre);
    if (!hoja) hoja = libro.insertSheet(nombre);
    const columnas = TABLAS[nombre];
    hoja.getRange(1, 1, 1, columnas.length).setValues([columnas]).setFontWeight('bold');
    hoja.setFrozenRows(1);
    hoja.getRange(1, 1, hoja.getMaxRows(), columnas.length).setNumberFormat('@');
  });
  memoria = {};
  const existentes = filas('configuracion').map((fila) => fila.clave);
  const hoja = hojaDe('configuracion');
  CONFIGURACION_INICIAL.filter((par) => existentes.indexOf(par[0]) < 0).forEach((par) => hoja.appendRow(par));

  // Resumen de las citas de mañana, cada día cerca de las 7 p. m. (Google da un margen de unos 15 minutos).
  ScriptApp.getProjectTriggers()
    .filter((disparador) => disparador.getHandlerFunction() === 'resumenDiario')
    .forEach((disparador) => ScriptApp.deleteTrigger(disparador));
  ScriptApp.newTrigger('resumenDiario').timeBased().everyDays(1).atHour(19).nearMinute(0).inTimezone(ZONA).create();
}

// Datos de ejemplo: dos barberos, tres servicios y su horario. Solo si la agenda está vacía.
function cargarEjemplo() {
  instalar();
  memoria = {};
  if (filas('profesionales').length || filas('servicios').length) throw new Error('La agenda ya tiene datos; no se cargó el ejemplo.');
  insertar('profesionales', { nombre: 'Andrés', activo: 1, orden: 1 });
  insertar('profesionales', { nombre: 'Camilo', activo: 1, orden: 2 });
  insertar('servicios', { nombre: 'Corte', duracion_min: 30, precio: 25000, activo: 1, orden: 1 });
  insertar('servicios', { nombre: 'Corte y barba', duracion_min: 60, precio: 40000, activo: 1, orden: 2 });
  insertar('servicios', { nombre: 'Barba', duracion_min: 30, precio: 18000, activo: 1, orden: 3 });
  [1, 2, 3, 4, 5].forEach((dia) => {
    insertar('horario', { profesional_id: 1, dia_semana: dia, abre: '09:00', cierra: '12:30' });
    insertar('horario', { profesional_id: 1, dia_semana: dia, abre: '14:00', cierra: '19:00' });
  });
  insertar('horario', { profesional_id: 1, dia_semana: 6, abre: '08:00', cierra: '16:00' });
  [2, 3, 4, 5, 6].forEach((dia) => insertar('horario', { profesional_id: 2, dia_semana: dia, abre: '11:00', cierra: '20:00' }));
}
