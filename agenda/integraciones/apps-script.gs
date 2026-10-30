// Avisos por correo y respaldos diarios de la agenda. Pegar en un proyecto nuevo de
// script.google.com con la cuenta de Google del negocio.
// 1. Configuración del proyecto > Propiedades del script:
//    - CLAVE: un texto largo al azar (el mismo que va en GOOGLE_SCRIPT_CLAVE en Cloudflare).
//    - AVISOS_PARA (opcional): correos que reciben los avisos, separados por coma.
//      Si no está, llegan al Gmail de la cuenta que publica el script.
// 2. Implementar > Nueva implementación > Aplicación web: ejecutar como "Yo", acceso "Cualquier usuario".
// 3. Copia la URL en GOOGLE_SCRIPT_URL en Cloudflare.
// Los respaldos quedan en la carpeta "Respaldos agenda" de Drive; se conservan los últimos 30.

var CARPETA = 'Respaldos agenda';
var CONSERVAR = 30;

function doPost(e) {
  var datos = JSON.parse((e.postData && e.postData.contents) || '{}');
  var propiedades = PropertiesService.getScriptProperties();
  var clave = propiedades.getProperty('CLAVE');
  if (!clave || datos.clave !== clave) return ContentService.createTextOutput('no autorizado');

  if (datos.tipo === 'aviso') {
    var para = propiedades.getProperty('AVISOS_PARA') || Session.getEffectiveUser().getEmail();
    var negocio = datos.negocio ? ' (' + datos.negocio + ')' : '';
    MailApp.sendEmail(para, String(datos.asunto || 'Aviso de la agenda').slice(0, 150) + negocio,
      String(datos.detalle || '').slice(0, 5000));
    return ContentService.createTextOutput('ok');
  }

  if (datos.tipo === 'respaldo') {
    var nombre = String(datos.nombre || 'agenda.json').replace(/[^\w.\-]/g, '_');
    carpeta().createFile(nombre, String(datos.contenido || ''), MimeType.PLAIN_TEXT);
    limpiar();
    return ContentService.createTextOutput('ok');
  }

  return ContentService.createTextOutput('tipo desconocido');
}

function carpeta() {
  var encontradas = DriveApp.getFoldersByName(CARPETA);
  return encontradas.hasNext() ? encontradas.next() : DriveApp.createFolder(CARPETA);
}

// Borra los respaldos más viejos y deja los últimos CONSERVAR.
function limpiar() {
  var archivos = [];
  var iterador = carpeta().getFiles();
  while (iterador.hasNext()) archivos.push(iterador.next());
  archivos.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  archivos.slice(CONSERVAR).forEach(function (archivo) { archivo.setTrashed(true); });
}
