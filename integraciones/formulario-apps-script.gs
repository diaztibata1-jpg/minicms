// Hoja de contactos del formulario del sitio. Pegar en la hoja de cálculo del cliente:
// Extensiones > Apps Script. Luego:
// 1. Configuración del proyecto > Propiedades del script:
//    - CLAVE: un texto largo al azar (el mismo que va en FORMULARIO_CLAVE en Cloudflare).
//    - AVISOS_PARA: correo(s) que reciben el resumen cada hora, separados por coma.
// 2. Ejecutar una vez la función configurar (crea encabezados, estado desplegable con colores y el aviso cada hora).
// 3. Implementar > Nueva implementación > Aplicación web: ejecutar como "Yo", acceso "Cualquier usuario".
//    La URL (termina en /exec) va en FORMULARIO_URL en Cloudflare.
const HOJA = 'Contactos';
const ENCABEZADOS = ['Fecha', 'Nombre', 'Teléfono', 'Correo', 'Estado', 'Autorización datos'];
const ESTADOS = ['Nuevo', 'Contactado', 'Cotizado', 'Cliente', 'No interesado'];
// Color de fondo y de texto de cada estado.
const COLORES = {
  Nuevo: ['#dbeafe', '#1e40af'],
  Contactado: ['#fef3c7', '#92400e'],
  Cotizado: ['#ede9fe', '#5b21b6'],
  Cliente: ['#dcfce7', '#166534'],
  'No interesado': ['#f3f4f6', '#4b5563'],
};
const ZONA = 'America/Bogota';
const HORA_INICIO = 7;
const HORA_FIN = 21;

function obtenerHoja() {
  const libro = SpreadsheetApp.getActive();
  return libro.getSheetByName(HOJA) || libro.insertSheet(HOJA);
}

const reglaEstados = () => SpreadsheetApp.newDataValidation().requireValueInList(ESTADOS, true).setAllowInvalid(false).build();

function configurar() {
  const libro = SpreadsheetApp.getActive();
  libro.setSpreadsheetTimeZone(ZONA);
  const hoja = obtenerHoja();
  hoja.getRange(1, 1, 1, ENCABEZADOS.length).setValues([ENCABEZADOS]).setFontWeight('bold');
  hoja.setFrozenRows(1);
  hoja.getRange('A2:A').setNumberFormat('yyyy-mm-dd hh:mm');
  hoja.getRange('E2:E').setDataValidation(reglaEstados()).setHorizontalAlignment('center');
  colorearEstados(hoja);

  const propiedades = PropertiesService.getScriptProperties();
  if (!propiedades.getProperty('ULTIMO_AVISO')) propiedades.setProperty('ULTIMO_AVISO', String(Date.now()));

  ScriptApp.getProjectTriggers()
    .filter((disparador) => disparador.getHandlerFunction() === 'avisarNuevos')
    .forEach((disparador) => ScriptApp.deleteTrigger(disparador));
  ScriptApp.newTrigger('avisarNuevos').timeBased().everyHours(1).create();
}

// Reemplaza los colores de la columna Estado; se puede correr varias veces sin duplicar reglas.
function colorearEstados(hoja) {
  const columna = hoja.getRange('E2:E');
  const otras = hoja.getConditionalFormatRules()
    .filter((regla) => !regla.getRanges().some((rango) => rango.getColumn() === 5 && rango.getNumColumns() === 1));
  const estados = ESTADOS.map((estado) => SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(estado)
    .setBackground(COLORES[estado][0])
    .setFontColor(COLORES[estado][1])
    .setBold(true)
    .setRanges([columna])
    .build());
  hoja.setConditionalFormatRules(otras.concat(estados));
}

// Evita que un texto como "=IMPORTXML(...)" se ejecute como fórmula en la hoja.
function limpiar(valor, maximo) {
  const texto = String(valor || '').trim().slice(0, maximo);
  return /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
}

function responder(datos) {
  return ContentService.createTextOutput(JSON.stringify(datos)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let datos;
  try {
    datos = JSON.parse((e.postData && e.postData.contents) || '{}');
  } catch (error) {
    return responder({ ok: false, error: 'json' });
  }
  const clave = PropertiesService.getScriptProperties().getProperty('CLAVE');
  if (!clave || datos.clave !== clave) return responder({ ok: false, error: 'no autorizado' });

  // El teléfono va siempre como texto para que Sheets no lo convierta en número.
  const telefono = limpiar(datos.telefono, 20);
  const fila = [new Date(), limpiar(datos.nombre, 80), telefono.startsWith("'") ? telefono : `'${telefono}`, limpiar(datos.correo, 120), 'Nuevo', limpiar(datos.autorizacion, 10)];
  const candado = LockService.getScriptLock();
  candado.waitLock(20000);
  try {
    const hoja = obtenerHoja();
    hoja.appendRow(fila);
    hoja.getRange(hoja.getLastRow(), 5).setDataValidation(reglaEstados());
  } finally {
    candado.releaseLock();
  }
  return responder({ ok: true });
}

// Cada hora, dentro del horario, manda un solo correo con los contactos que llegaron desde el último aviso.
function avisarNuevos() {
  const propiedades = PropertiesService.getScriptProperties();
  const para = propiedades.getProperty('AVISOS_PARA');
  if (!para) return;
  const hora = Number(Utilities.formatDate(new Date(), ZONA, 'H'));
  if (hora < HORA_INICIO || hora >= HORA_FIN) return;

  const ultimoAviso = Number(propiedades.getProperty('ULTIMO_AVISO') || 0);
  const hoja = obtenerHoja();
  if (hoja.getLastRow() < 2) return;
  // Se filtra por fecha y no por número de fila, así ordenar o borrar filas no rompe el aviso.
  const nuevos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 4).getValues()
    .filter((fila) => fila[0] instanceof Date && fila[0].getTime() > ultimoAviso)
    .sort((a, b) => a[0] - b[0]);
  if (!nuevos.length) return;

  const lista = nuevos
    .map((fila) => `• ${fila[1]} | ${fila[2]} | ${fila[3]} (${Utilities.formatDate(fila[0], ZONA, 'd MMM h:mm a')})`)
    .join('\n');
  const asunto = nuevos.length === 1 ? '1 contacto nuevo desde la página' : `${nuevos.length} contactos nuevos desde la página`;
  MailApp.sendEmail(para, asunto, `${lista}\n\nVer la hoja: ${SpreadsheetApp.getActive().getUrl()}`);
  propiedades.setProperty('ULTIMO_AVISO', String(nuevos[nuevos.length - 1][0].getTime()));
}
