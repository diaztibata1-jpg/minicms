export class ErrorApi extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

export const json = (datos, estado = 200, cabeceras = {}) =>
  new Response(JSON.stringify(datos), {
    status: estado,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cabeceras },
  });

export async function leerJson(request) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) {
    throw new ErrorApi(415, 'El cuerpo debe ser JSON.');
  }
  try {
    return await request.json();
  } catch {
    throw new ErrorApi(400, 'El JSON no es válido.');
  }
}

// Bogotá es UTC-5 todo el año.
const desfaseBogota = -5 * 60 * 60 * 1000;

export function ahoraBogota() {
  const fecha = new Date(Date.now() + desfaseBogota);
  return fecha.toISOString().slice(0, 16).replace('T', ' ');
}

export const fechaValida = /^\d{4}-\d{2}-\d{2}$/;
export const horaValida = /^([01]\d|2[0-3]):[0-5]\d$/;
export const momentoValido = /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/;

export function validarFecha(texto) {
  if (typeof texto !== 'string' || !fechaValida.test(texto)) throw new ErrorApi(400, 'La fecha debe ser AAAA-MM-DD.');
  const fecha = new Date(`${texto}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== texto) {
    throw new ErrorApi(400, 'La fecha no existe.');
  }
  return texto;
}

export function validarMomento(texto, campo = 'inicio') {
  if (typeof texto !== 'string' || !momentoValido.test(texto)) {
    throw new ErrorApi(400, `El campo ${campo} debe ser AAAA-MM-DD HH:MM.`);
  }
  validarFecha(texto.slice(0, 10));
  return texto;
}

export const minutosDeHora = (hora) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
export const horaDeMinutos = (minutos) =>
  `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;

// Suma minutos a 'YYYY-MM-DD HH:MM' y devuelve el mismo formato.
export function sumarMinutos(momento, minutos) {
  const fecha = new Date(`${momento.replace(' ', 'T')}:00Z`);
  fecha.setUTCMinutes(fecha.getUTCMinutes() + minutos);
  return fecha.toISOString().slice(0, 16).replace('T', ' ');
}

export const diaSemana = (fecha) => new Date(`${fecha}T00:00:00Z`).getUTCDay();

export function sumarDias(fecha, dias) {
  const valor = new Date(`${fecha}T00:00:00Z`);
  valor.setUTCDate(valor.getUTCDate() + dias);
  return valor.toISOString().slice(0, 10);
}

export function texto(valor, campo, { max = 200, requerido = false } = {}) {
  if (valor === undefined || valor === null) valor = '';
  if (typeof valor !== 'string') throw new ErrorApi(400, `El campo ${campo} debe ser texto.`);
  valor = valor.trim();
  if (requerido && !valor) throw new ErrorApi(400, `El campo ${campo} es obligatorio.`);
  if (valor.length > max) throw new ErrorApi(400, `El campo ${campo} admite máximo ${max} caracteres.`);
  return valor;
}

export function entero(valor, campo, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const numero = typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : valor;
  if (!Number.isInteger(numero) || numero < min || numero > max) {
    throw new ErrorApi(400, `El campo ${campo} debe ser un número entero entre ${min} y ${max}.`);
  }
  return numero;
}

export function celular(valor) {
  const limpio = typeof valor === 'string' ? valor.replace(/\D/g, '').replace(/^57(?=3\d{9}$)/, '') : '';
  if (!/^3\d{9}$/.test(limpio)) throw new ErrorApi(400, 'El celular debe tener 10 dígitos y empezar por 3.');
  return limpio;
}
