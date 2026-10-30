const $ = (id) => document.getElementById(id);
const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const formatoDia = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const formatoLargo = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const aFecha = (texto) => new Date(`${texto}T00:00:00Z`);

// profesional null = "cualquiera".
const estado = { info: null, servicio: null, profesional: null, fecha: null, hora: null };

async function pedir(url) {
  const respuesta = await fetch(url);
  const datos = await respuesta.json();
  if (!respuesta.ok) throw new Error(datos.error || 'No se pudo cargar la información.');
  return datos;
}

function opcion(titulo, detalle, seleccionada, alElegir) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'opcion';
  boton.setAttribute('aria-pressed', String(seleccionada));
  boton.textContent = titulo;
  if (detalle) {
    const pequeno = document.createElement('small');
    pequeno.textContent = detalle;
    boton.append(pequeno);
  }
  boton.addEventListener('click', alElegir);
  return boton;
}

function pintarServicios() {
  $('servicios').replaceChildren(
    ...estado.info.servicios.map((s) =>
      opcion(s.nombre, `${s.duracion_min} min${s.precio ? ` · ${pesos.format(s.precio)}` : ''}`, s.id === estado.servicio?.id, () => {
        estado.servicio = s;
        estado.hora = null;
        pintarServicios();
        cargarHoras();
      }),
    ),
  );
}

function pintarProfesionales() {
  const lista = estado.info.profesionales;
  $('bloque-profesionales').hidden = lista.length < 2;
  if (lista.length < 2) return;
  const elegir = (p) => () => {
    estado.profesional = p;
    estado.hora = null;
    pintarProfesionales();
    cargarHoras();
  };
  $('profesionales').replaceChildren(
    opcion('Cualquiera', 'La primera hora libre', estado.profesional === null, elegir(null)),
    ...lista.map((p) => opcion(p.nombre, '', estado.profesional?.id === p.id, elegir(p))),
  );
}

function pintarDias() {
  $('dias').replaceChildren(
    ...estado.info.fechas.map((f) =>
      opcion(formatoDia.format(aFecha(f)), '', f === estado.fecha, () => {
        saltarDiasVacios = false;
        estado.fecha = f;
        estado.hora = null;
        pintarDias();
        cargarHoras();
      }),
    ),
  );
}

function pintarPedido() {
  const { servicio, fecha, hora, info } = estado;
  $('pedir').hidden = !(servicio && fecha && hora && info.whatsapp);
  if ($('pedir').hidden) return;
  const cuando = `${formatoLargo.format(aFecha(fecha))} a las ${hora}`;
  const con = estado.profesional ? ` con ${estado.profesional.nombre}` : '';
  $('resumen').textContent = `${servicio.nombre}${con}, ${cuando}.`;
  const texto = `Hola, quiero agendar ${servicio.nombre}${con} el ${cuando}. Mi nombre es `;
  $('whatsapp').href = `https://wa.me/57${info.whatsapp}?text=${encodeURIComponent(texto)}`;
}

// Al abrir la página salta los días que ya no tienen horas (por ejemplo, hoy en la noche).
let saltarDiasVacios = true;

async function cargarHoras() {
  pintarPedido();
  $('horas').replaceChildren();
  if (!estado.servicio || !estado.fecha) return;
  $('estado-horas').textContent = 'Buscando horas libres…';
  try {
    const con = estado.profesional ? `&profesional=${estado.profesional.id}` : '';
    const { horas } = await pedir(`/agenda/api/publico/disponibilidad?fecha=${estado.fecha}&servicio=${estado.servicio.id}${con}`);
    const siguiente = estado.info.fechas[estado.info.fechas.indexOf(estado.fecha) + 1];
    if (!horas.length && saltarDiasVacios && siguiente) {
      estado.fecha = siguiente;
      pintarDias();
      return cargarHoras();
    }
    saltarDiasVacios = false;
    $('estado-horas').textContent = horas.length ? '' : 'No quedan horas libres este día. Prueba otro.';
    const pintar = () =>
      $('horas').replaceChildren(
        ...horas.map((h) =>
          opcion(h, '', h === estado.hora, () => {
            estado.hora = h;
            pintar();
            pintarPedido();
          }),
        ),
      );
    pintar();
  } catch (error) {
    $('estado-horas').textContent = error.message;
  }
}

try {
  estado.info = await pedir('/agenda/api/publico/info');
  if (estado.info.negocio) {
    $('negocio').textContent = estado.info.negocio;
    document.title = `Horarios disponibles · ${estado.info.negocio}`;
  }
  estado.servicio = estado.info.servicios[0] || null;
  estado.fecha = estado.info.fechas[0] || null;
  pintarServicios();
  pintarProfesionales();
  pintarDias();
  cargarHoras();
} catch (error) {
  $('error').textContent = error.message;
  $('error').hidden = false;
}
