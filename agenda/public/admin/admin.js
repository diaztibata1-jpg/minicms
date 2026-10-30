const $ = (id) => document.getElementById(id);
const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const formatoDia = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const formatoCorto = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const nombresDias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const nombresEstado = { confirmada: 'Confirmada', atendida: 'Atendida', no_asistio: 'No asistió', cancelada: 'Cancelada' };

// Crea un elemento: h('p', { class: 'x' }, 'texto', otroElemento). El texto nunca se interpreta como HTML.
function h(etiqueta, atributos = {}, ...hijos) {
  const elemento = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) {
    if (clave.startsWith('on')) elemento.addEventListener(clave.slice(2), valor);
    else if (valor === true) elemento.setAttribute(clave, '');
    else if (valor !== false && valor !== null && valor !== undefined) elemento.setAttribute(clave, valor);
  }
  elemento.append(...hijos.filter((hijo) => hijo !== null && hijo !== undefined));
  return elemento;
}

const hoyBogota = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
const sumarDias = (fecha, dias) => {
  const valor = new Date(`${fecha}T00:00:00Z`);
  valor.setUTCDate(valor.getUTCDate() + dias);
  return valor.toISOString().slice(0, 10);
};

class NoAutorizado extends Error {}

async function api(metodo, ruta, cuerpo) {
  let respuesta;
  try {
    respuesta = await fetch(`/api/admin/${ruta}`, {
      method: metodo,
      headers: cuerpo ? { 'content-type': 'application/json' } : {},
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new Error('No hay conexión. Revisa el internet e intenta de nuevo.');
  }
  const datos = await respuesta.json().catch(() => ({}));
  if (respuesta.status === 401 && ruta !== 'entrar') {
    mostrarEntrar();
    throw new NoAutorizado();
  }
  if (!respuesta.ok) throw new Error(datos.error || 'Algo salió mal.');
  return datos;
}

let temporizadorAviso;
function avisar(texto, esError = false) {
  const aviso = $('aviso');
  aviso.textContent = texto;
  aviso.classList.toggle('error', esError);
  aviso.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => (aviso.hidden = true), 6000);
}

// Ejecuta una acción y muestra el error, si lo hay.
const intentar = (accion) => async (...argumentos) => {
  try {
    await accion(...argumentos);
  } catch (error) {
    if (!(error instanceof NoAutorizado)) avisar(error.message, true);
  }
};

const enlaceWhatsapp = (celular) =>
  h('a', { href: `https://wa.me/57${celular}`, target: '_blank', rel: 'noopener' }, celular);

// ---------- Sesión ----------

function mostrarEntrar() {
  $('panel').hidden = true;
  $('entrar').hidden = false;
  $('form-entrar').contrasena.focus();
}

$('form-entrar').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const formulario = evento.currentTarget;
  $('error-entrar').hidden = true;
  try {
    await api('POST', 'entrar', { contrasena: formulario.contrasena.value });
    formulario.reset();
    iniciar();
  } catch (error) {
    $('error-entrar').textContent = error.message;
    $('error-entrar').hidden = false;
  }
});

$('salir').addEventListener('click', async () => {
  await api('POST', 'salir').catch(() => {});
  // No dejar datos de clientes guardados en el dispositivo después de salir.
  await caches?.delete('agenda-datos').catch(() => {});
  mostrarEntrar();
});

// ---------- Pestañas ----------

const cargadores = {};

function abrirVista(nombre) {
  for (const boton of document.querySelectorAll('nav.pestanas button')) {
    boton.setAttribute('aria-selected', String(boton.dataset.vista === nombre));
  }
  for (const seccion of document.querySelectorAll('#panel > section[data-vista]')) {
    seccion.hidden = seccion.dataset.vista !== nombre;
  }
  cargadores[nombre]?.();
}

for (const boton of document.querySelectorAll('nav.pestanas button')) {
  boton.addEventListener('click', () => abrirVista(boton.dataset.vista));
}

// ---------- Servicios (se usan en varias vistas) ----------

let servicios = [];
async function cargarServicios() {
  ({ servicios } = await api('GET', 'servicios'));
  return servicios;
}

// ---------- Profesionales (se usan en varias vistas) ----------

let profesionales = [];
let maximoProfesionales = 3;
const activos = () => profesionales.filter((p) => p.activo);
const nombreProfesional = (id) => profesionales.find((p) => p.id === id)?.nombre || 'Sin asignar';

// Llena un <select> con los profesionales, conservando la opción elegida si sigue existiendo.
function llenarProfesionales(select, { todos = null, incluir = null } = {}) {
  const anterior = select.value;
  const lista = profesionales.filter((p) => p.activo || p.id === incluir);
  select.replaceChildren(
    ...(todos ? [h('option', { value: '' }, todos)] : []),
    ...lista.map((p) => h('option', { value: p.id }, p.nombre)),
  );
  if ([...select.options].some((o) => o.value === anterior)) select.value = anterior;
}

async function cargarProfesionales() {
  ({ profesionales, maximo: maximoProfesionales } = await api('GET', 'profesionales'));
  llenarProfesionales($('filtro-profesional'), { todos: 'Todo el equipo' });
  $('filtro-profesional').hidden = activos().length < 2;
  return profesionales;
}

// ---------- Citas ----------

let diaActual = hoyBogota();

function filaCita(cita, { conFecha = false, conProfesional = false } = {}) {
  const hora = cita.inicio.slice(11);
  const estado = h(
    'select',
    {
      'aria-label': 'Estado',
      onchange: intentar(async (evento) => {
        await api('PATCH', `citas/${cita.id}/estado`, { estado: evento.target.value });
        cargadores.agenda();
      }),
    },
    ...Object.entries(nombresEstado).map(([valor, nombre]) =>
      h('option', { value: valor, selected: valor === cita.estado }, nombre),
    ),
  );
  const fecha = formatoCorto.format(new Date(`${cita.inicio.slice(0, 10)}T00:00:00Z`));
  return h(
    'li',
    { class: `tarjeta cita ${cita.estado}${conFecha ? ' con-fecha' : ''}` },
    h('span', { class: 'hora' }, conFecha ? fecha : null, conFecha ? h('br') : null, hora),
    h(
      'div',
      { class: 'detalle' },
      h('strong', {}, cita.cliente),
      ' · ',
      enlaceWhatsapp(cita.celular),
      h('br'),
      h('span', { class: 'suave' }, `${cita.servicio || 'Servicio borrado'} · hasta ${cita.fin.slice(11)}`),
      conProfesional ? h('div', {}, h('span', { class: 'etiqueta' }, cita.profesional || 'Sin asignar')) : null,
      cita.notas ? h('div', { class: 'suave' }, cita.notas) : null,
    ),
    h(
      'div',
      { class: 'acciones' },
      estado,
      h('button', { class: 'boton chico', onclick: () => abrirCita(cita) }, 'Editar'),
      h(
        'button',
        {
          class: 'boton chico peligro',
          onclick: intentar(async () => {
            if (!confirm(`¿Borrar la cita de ${cita.cliente} a las ${hora}? Esto no se puede deshacer.`)) return;
            await api('DELETE', `citas/${cita.id}`);
            cargadores.agenda();
          }),
        },
        'Borrar',
      ),
    ),
  );
}

// Con "Todo el equipo" muestra una columna por profesional; con uno elegido, solo su lista.
cargadores.agenda = intentar(async () => {
  $('dia').value = diaActual;
  $('titulo-dia').textContent = formatoDia.format(new Date(`${diaActual}T00:00:00Z`));
  const filtro = $('filtro-profesional').value;
  const { citas } = await api('GET', `citas?desde=${diaActual}${filtro ? `&profesional=${filtro}` : ''}`);
  const activas = citas.filter((c) => c.estado !== 'cancelada').length;
  $('titulo-dia').textContent += ` · ${activas} cita${activas === 1 ? '' : 's'}`;

  const lista = (items) =>
    h('ul', { class: 'lista' }, ...(items.length ? items.map((c) => filaCita(c)) : [h('li', { class: 'suave' }, 'Sin citas.')]));
  const columnas = filtro
    ? [{ id: Number(filtro), nombre: null }]
    : [
        ...activos(),
        // Citas de profesionales que ya no están activos.
        ...[...new Set(citas.map((c) => c.profesional_id))]
          .filter((id) => !activos().some((p) => p.id === id))
          .map((id) => ({ id, nombre: nombreProfesional(id) })),
      ];
  $('citas').classList.toggle('una', columnas.length === 1);
  $('citas').replaceChildren(
    ...columnas.map((p) =>
      h(
        'section',
        {},
        p.nombre && columnas.length > 1 ? h('h3', {}, p.nombre) : null,
        lista(citas.filter((c) => c.profesional_id === p.id)),
      ),
    ),
  );
});
$('filtro-profesional').addEventListener('change', () => cargadores.agenda());

const irADia = (fecha) => {
  diaActual = fecha;
  cargadores.agenda();
};
$('dia').addEventListener('change', (e) => e.target.value && irADia(e.target.value));
$('dia-anterior').addEventListener('click', () => irADia(sumarDias(diaActual, -1)));
$('dia-siguiente').addEventListener('click', () => irADia(sumarDias(diaActual, 1)));
$('hoy').addEventListener('click', () => irADia(hoyBogota()));

// ---------- Formulario de cita ----------

const dialogo = $('dialogo-cita');
const formCita = $('form-cita');
let citaEditada = null;

function duracionElegida() {
  const propia = Number(formCita.duracion_min.value);
  if (propia) return propia;
  return servicios.find((s) => s.id === Number(formCita.servicio_id.value))?.duracion_min || 30;
}

const sugerirHoras = intentar(async () => {
  const fecha = formCita.fecha.value;
  if (!fecha) return;
  const profesional = formCita.profesional_id.value;
  const { horas } = await api('GET', `disponibilidad?fecha=${fecha}&duracion=${duracionElegida()}&profesional=${profesional}`);
  $('horas-libres').replaceChildren(...horas.map((hora) => h('option', { value: hora })));
  $('sugerencias').replaceChildren(
    horas.length ? 'Libres: ' : 'No hay horas libres en el horario de atención. Puedes escribir otra hora.',
    ...horas.slice(0, 24).flatMap((hora, i) => [
      i ? ' ' : '',
      h('button', { type: 'button', class: 'boton chico', onclick: () => (formCita.hora.value = hora) }, hora),
    ]),
  );
});

async function abrirCita(cita = null) {
  citaEditada = cita;
  await cargarServicios();
  formCita.reset();
  $('error-cita').hidden = true;
  $('cliente-encontrado').hidden = true;
  $('titulo-cita').textContent = cita ? 'Editar cita' : 'Nueva cita';
  formCita.servicio_id.replaceChildren(
    ...servicios
      .filter((s) => s.activo || s.id === cita?.servicio_id)
      .map((s) => h('option', { value: s.id }, `${s.nombre} · ${s.duracion_min} min`)),
  );
  llenarProfesionales(formCita.profesional_id, { incluir: cita?.profesional_id });
  // En una cita existente el cliente no cambia; se edita desde Clientes.
  formCita.celular.disabled = formCita.nombre.disabled = Boolean(cita);
  formCita.estado.closest('label').hidden = !cita;
  if (cita) {
    formCita.celular.value = cita.celular;
    formCita.nombre.value = cita.cliente;
    if (cita.servicio_id) formCita.servicio_id.value = cita.servicio_id;
    formCita.profesional_id.value = cita.profesional_id;
    formCita.fecha.value = cita.inicio.slice(0, 10);
    formCita.hora.value = cita.inicio.slice(11);
    formCita.estado.value = cita.estado;
    formCita.notas.value = cita.notas;
    const minutos = (new Date(cita.fin.replace(' ', 'T')) - new Date(cita.inicio.replace(' ', 'T'))) / 60000;
    const servicio = servicios.find((s) => s.id === cita.servicio_id);
    if (!servicio || servicio.duracion_min !== minutos) formCita.duracion_min.value = minutos;
  } else {
    formCita.fecha.value = diaActual;
    if ($('filtro-profesional').value) formCita.profesional_id.value = $('filtro-profesional').value;
  }
  dialogo.showModal();
  sugerirHoras();
}

$('nueva-cita').addEventListener('click', () => abrirCita());
$('cancelar-cita').addEventListener('click', () => dialogo.close());
for (const campo of ['fecha', 'servicio_id', 'profesional_id', 'duracion_min']) {
  formCita[campo].addEventListener('change', sugerirHoras);
}

// Si el celular ya existe, completa el nombre.
formCita.celular.addEventListener('input', async () => {
  const digitos = formCita.celular.value.replace(/\D/g, '');
  $('cliente-encontrado').hidden = true;
  if (digitos.length !== 10) return;
  try {
    const { clientes } = await api('GET', `clientes?q=${digitos}`);
    const cliente = clientes.find((c) => c.celular === digitos);
    if (!cliente) return;
    formCita.nombre.value = cliente.nombre;
    $('cliente-encontrado').textContent = `Cliente conocido: ${cliente.citas} cita(s) antes.${cliente.notas ? ` ${cliente.notas}` : ''}`;
    $('cliente-encontrado').hidden = false;
  } catch {}
});

formCita.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  $('error-cita').hidden = true;
  const datos = {
    servicio_id: Number(formCita.servicio_id.value),
    profesional_id: Number(formCita.profesional_id.value),
    inicio: `${formCita.fecha.value} ${formCita.hora.value.slice(0, 5)}`,
    duracion_min: formCita.duracion_min.value ? Number(formCita.duracion_min.value) : null,
    notas: formCita.notas.value,
  };
  try {
    const respuesta = citaEditada
      ? await api('PUT', `citas/${citaEditada.id}`, { ...datos, estado: formCita.estado.value })
      : await api('POST', 'citas', { ...datos, celular: formCita.celular.value, nombre: formCita.nombre.value });
    dialogo.close();
    avisar(['Cita guardada.', ...respuesta.avisos].join(' '));
    irADia(formCita.fecha.value);
  } catch (error) {
    if (error instanceof NoAutorizado) return dialogo.close();
    $('error-cita').textContent = error.message;
    $('error-cita').hidden = false;
  }
});

// ---------- Clientes ----------

let clienteAbierto = null;

const buscarClientes = intentar(async () => {
  const { clientes } = await api('GET', `clientes?q=${encodeURIComponent($('buscar-cliente').value)}`);
  $('clientes').replaceChildren(
    ...(clientes.length
      ? clientes.map((c) =>
          h(
            'li',
            {},
            h(
              'button',
              { class: 'opcion', onclick: () => abrirCliente(c.id) },
              `${c.nombre} · ${c.celular}`,
              h('small', {}, `${c.citas} cita(s)`),
            ),
          ),
        )
      : [h('li', { class: 'suave' }, 'Sin resultados.')]),
  );
});

let temporizadorBusqueda;
$('buscar-cliente').addEventListener('input', () => {
  clearTimeout(temporizadorBusqueda);
  temporizadorBusqueda = setTimeout(buscarClientes, 250);
});

const abrirCliente = intentar(async (id) => {
  const { cliente, citas } = await api('GET', `clientes/${id}`);
  clienteAbierto = cliente;
  const formulario = $('form-cliente');
  formulario.nombre.value = cliente.nombre;
  formulario.celular.value = cliente.celular;
  formulario.notas.value = cliente.notas;
  $('historial').replaceChildren(
    ...(citas.length ? citas.map((c) => filaCita(c, { conFecha: true, conProfesional: profesionales.length > 1 })) : [h('li', { class: 'suave' }, 'Sin citas.')]),
  );
  $('detalle-cliente').hidden = false;
});

$('form-cliente').addEventListener(
  'submit',
  intentar(async (evento) => {
    evento.preventDefault();
    const f = evento.currentTarget;
    await api('PUT', `clientes/${clienteAbierto.id}`, { nombre: f.nombre.value, celular: f.celular.value, notas: f.notas.value });
    avisar('Cliente guardado.');
    buscarClientes();
  }),
);

$('borrar-cliente').addEventListener(
  'click',
  intentar(async () => {
    if (!confirm(`¿Borrar a ${clienteAbierto.nombre} y todas sus citas? Esto no se puede deshacer.`)) return;
    await api('DELETE', `clientes/${clienteAbierto.id}`);
    $('detalle-cliente').hidden = true;
    avisar('Cliente borrado.');
    buscarClientes();
  }),
);

cargadores.clientes = buscarClientes;

// ---------- Servicios ----------

function filaServicio(s = { nombre: '', duracion_min: 30, precio: 0, orden: servicios.length + 1, activo: 1 }) {
  const campo = (etiqueta, nombre, tipo, valor, extra = {}) =>
    h('label', {}, etiqueta, h('input', { name: nombre, type: tipo, value: valor, ...extra }));
  const fila = h(
    'li',
    { class: 'tarjeta servicio' },
    campo('Nombre', 'nombre', 'text', s.nombre, { maxlength: 60, required: true }),
    campo('Minutos', 'duracion_min', 'number', s.duracion_min, { min: 5, max: 480 }),
    campo('Precio', 'precio', 'number', s.precio, { min: 0, step: 1000 }),
    campo('Orden', 'orden', 'number', s.orden, { min: 0 }),
    h('label', { class: 'casilla' }, h('input', { name: 'activo', type: 'checkbox', checked: Boolean(s.activo) }), 'Visible en la página'),
    h(
      'div',
      { class: 'fila' },
      h(
        'button',
        {
          class: 'boton chico principal',
          onclick: intentar(async () => {
            const valor = (n) => fila.querySelector(`[name=${n}]`);
            const datos = {
              nombre: valor('nombre').value,
              duracion_min: Number(valor('duracion_min').value),
              precio: Number(valor('precio').value),
              orden: Number(valor('orden').value),
              activo: valor('activo').checked,
            };
            await (s.id ? api('PUT', `servicios/${s.id}`, datos) : api('POST', 'servicios', datos));
            avisar('Servicio guardado.');
            cargadores.servicios();
          }),
        },
        'Guardar',
      ),
      s.id
        ? h(
            'button',
            {
              class: 'boton chico peligro',
              onclick: intentar(async () => {
                if (!confirm(`¿Borrar el servicio ${s.nombre}?`)) return;
                await api('DELETE', `servicios/${s.id}`);
                cargadores.servicios();
              }),
            },
            'Borrar',
          )
        : null,
    ),
  );
  return fila;
}

cargadores.servicios = intentar(async () => {
  await cargarServicios();
  $('servicios').replaceChildren(...servicios.map((s) => filaServicio(s)));
});
$('nuevo-servicio').addEventListener('click', () => $('servicios').append(filaServicio()));

// ---------- Horario ----------

function filaRango(rango = { abre: '09:00', cierra: '18:00' }) {
  const fila = h(
    'div',
    { class: 'rango' },
    h('input', { type: 'time', value: rango.abre, 'aria-label': 'Abre', 'data-campo': 'abre' }),
    '–',
    h('input', { type: 'time', value: rango.cierra, 'aria-label': 'Cierra', 'data-campo': 'cierra' }),
    h('button', { type: 'button', class: 'boton chico', 'aria-label': 'Quitar rango', onclick: () => fila.remove() }, '×'),
  );
  return fila;
}

cargadores.horario = intentar(async () => {
  await cargarProfesionales();
  llenarProfesionales($('horario-profesional'));
  const elegido = Number($('horario-profesional').value);
  const horario = (await api('GET', 'horario')).horario.filter((r) => r.profesional_id === elegido);
  // Lunes primero, domingo al final.
  $('horario').replaceChildren(
    ...[1, 2, 3, 4, 5, 6, 0].map((dia) => {
      const rangos = h('div', { 'data-dia': dia }, ...horario.filter((r) => r.dia_semana === dia).map(filaRango));
      return h(
        'div',
        { class: 'dia-horario' },
        h('strong', {}, nombresDias[dia]),
        h('div', {}, rangos, h('button', { type: 'button', class: 'boton chico', onclick: () => rangos.append(filaRango()) }, 'Agregar rango')),
      );
    }),
  );
});

$('guardar-horario').addEventListener(
  'click',
  intentar(async () => {
    const horario = [...document.querySelectorAll('#horario [data-dia]')].flatMap((contenedor) =>
      [...contenedor.querySelectorAll('.rango')].map((fila) => ({
        dia_semana: Number(contenedor.dataset.dia),
        abre: fila.querySelector('[data-campo=abre]').value,
        cierra: fila.querySelector('[data-campo=cierra]').value,
      })),
    );
    const profesional_id = Number($('horario-profesional').value);
    await api('PUT', 'horario', { profesional_id, horario });
    avisar(`Horario de ${nombreProfesional(profesional_id)} guardado.`);
    cargadores.horario();
  }),
);

$('horario-profesional').addEventListener('change', () => cargadores.horario());

// ---------- Bloqueos ----------

cargadores.bloqueos = intentar(async () => {
  await cargarProfesionales();
  llenarProfesionales($('form-bloqueo').profesional_id, { todos: 'Todo el negocio' });
  const { bloqueos } = await api('GET', 'bloqueos');
  $('bloqueos').replaceChildren(
    ...(bloqueos.length
      ? bloqueos.map((b) =>
          h(
            'li',
            { class: 'tarjeta fila' },
            h(
              'span',
              {},
              `${b.inicio} → ${b.fin} · ${b.profesional || 'Todo el negocio'}${b.motivo ? ` · ${b.motivo}` : ''}`,
            ),
            h(
              'button',
              {
                class: 'boton chico peligro',
                onclick: intentar(async () => {
                  await api('DELETE', `bloqueos/${b.id}`);
                  cargadores.bloqueos();
                }),
              },
              'Quitar',
            ),
          ),
        )
      : [h('li', { class: 'suave' }, 'No hay bloqueos próximos.')]),
  );
});

$('form-bloqueo').addEventListener(
  'submit',
  intentar(async (evento) => {
    evento.preventDefault();
    const f = evento.currentTarget;
    const { avisos } = await api('POST', 'bloqueos', {
      inicio: f.inicio.value.replace('T', ' '),
      fin: f.fin.value.replace('T', ' '),
      motivo: f.motivo.value,
      profesional_id: f.profesional_id.value ? Number(f.profesional_id.value) : null,
    });
    f.reset();
    avisar(['Bloqueo agregado.', ...avisos].join(' '));
    cargadores.bloqueos();
  }),
);

// ---------- Equipo ----------

function filaProfesional(p = { nombre: '', activo: 1, orden: profesionales.length + 1 }) {
  const fila = h(
    'li',
    { class: 'tarjeta profesional' },
    h('label', {}, 'Nombre', h('input', { name: 'nombre', value: p.nombre, maxlength: 40, required: true })),
    h('label', {}, 'Orden', h('input', { name: 'orden', type: 'number', min: 0, value: p.orden })),
    h(
      'label',
      { class: 'casilla' },
      h('input', { name: 'activo', type: 'checkbox', checked: Boolean(p.activo) }),
      'Activo (recibe citas y aparece en la página)',
    ),
    h(
      'div',
      { class: 'fila' },
      h(
        'button',
        {
          class: 'boton chico principal',
          onclick: intentar(async () => {
            const valor = (n) => fila.querySelector(`[name=${n}]`);
            const datos = {
              nombre: valor('nombre').value,
              orden: Number(valor('orden').value),
              activo: valor('activo').checked,
            };
            await (p.id ? api('PUT', `profesionales/${p.id}`, datos) : api('POST', 'profesionales', datos));
            avisar(p.id ? 'Profesional guardado.' : 'Profesional agregado. Ahora define su horario en la pestaña Horario.');
            cargadores.equipo();
          }),
        },
        'Guardar',
      ),
      p.id
        ? h(
            'button',
            {
              class: 'boton chico peligro',
              onclick: intentar(async () => {
                if (!confirm(`¿Borrar a ${p.nombre}? Se borran también su horario y sus bloqueos.`)) return;
                await api('DELETE', `profesionales/${p.id}`);
                cargadores.equipo();
              }),
            },
            'Borrar',
          )
        : null,
    ),
  );
  return fila;
}

cargadores.equipo = intentar(async () => {
  await cargarProfesionales();
  $('limite-equipo').textContent = `Hasta ${maximoProfesionales} profesionales activos. Solo tú entras al panel; ellos no necesitan usuario.`;
  $('profesionales').replaceChildren(...profesionales.map((p) => filaProfesional(p)));
  $('nuevo-profesional').disabled = activos().length >= maximoProfesionales;
});
$('nuevo-profesional').addEventListener('click', () => {
  $('profesionales').append(filaProfesional());
  $('nuevo-profesional').disabled = true;
});

// ---------- Ajustes ----------

$('form-contrasena').addEventListener(
  'submit',
  intentar(async (evento) => {
    evento.preventDefault();
    const f = evento.currentTarget;
    if (f.nueva.value !== f.repetida.value) throw new Error('Las dos contraseñas nuevas no coinciden.');
    await api('POST', 'contrasena', { actual: f.actual.value, nueva: f.nueva.value });
    f.reset();
    avisar('Contraseña cambiada.');
  }),
);

$('archivo-respaldo').addEventListener(
  'change',
  intentar(async (evento) => {
    const archivo = evento.target.files[0];
    evento.target.value = '';
    if (!archivo) return;
    let respaldo;
    try {
      respaldo = JSON.parse(await archivo.text());
    } catch {
      throw new Error('El archivo no es un respaldo válido.');
    }
    const resumen = respaldo?.tablas
      ? `${respaldo.tablas.citas?.length ?? 0} citas y ${respaldo.tablas.clientes?.length ?? 0} clientes del ${respaldo.creado}`
      : 'este archivo';
    if (!confirm(`¿Reemplazar TODO lo que hay ahora por ${resumen}? Descarga antes un respaldo actual por si acaso.`)) return;
    const { restaurado } = await api('POST', 'respaldo', respaldo);
    avisar(`Respaldo restaurado: ${restaurado.citas} citas, ${restaurado.clientes} clientes.`);
  }),
);

// Instalación como app (PWA)
let avisoInstalar = null;
const yaInstalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function pintarInstalacion() {
  $('instalada').hidden = !yaInstalada();
  $('instalar-android').hidden = yaInstalada() || !avisoInstalar;
  $('instalar-iphone').hidden = yaInstalada() || Boolean(avisoInstalar);
}
addEventListener('beforeinstallprompt', (evento) => {
  evento.preventDefault();
  avisoInstalar = evento;
  pintarInstalacion();
});
addEventListener('appinstalled', () => {
  avisoInstalar = null;
  pintarInstalacion();
});
$('instalar').addEventListener('click', async () => {
  if (!avisoInstalar) return;
  avisoInstalar.prompt();
  await avisoInstalar.userChoice;
  avisoInstalar = null;
  pintarInstalacion();
});
cargadores.ajustes = pintarInstalacion;

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' }).catch(() => {});

const pintarConexion = () => ($('sin-conexion').hidden = navigator.onLine);
addEventListener('online', pintarConexion);
addEventListener('offline', pintarConexion);
pintarConexion();

// ---------- Inicio ----------

async function iniciar() {
  try {
    await Promise.all([cargarServicios(), cargarProfesionales()]);
  } catch (error) {
    if (!(error instanceof NoAutorizado)) {
      mostrarEntrar();
      $('error-entrar').textContent = error.message;
      $('error-entrar').hidden = false;
    }
    return;
  }
  $('entrar').hidden = true;
  $('panel').hidden = false;
  abrirVista('agenda');
}

iniciar();
