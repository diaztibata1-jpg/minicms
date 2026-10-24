// Avisos del editor en línea. Pegar en un proyecto nuevo de script.google.com.
// 1. Project Settings > Script properties: agrega CLAVE con un texto largo al azar
//    (el mismo que va en AVISOS_CLAVE en Cloudflare).
// 2. Deploy > New deployment > Web app: Execute as "Me", Who has access "Anyone".
// 3. Copia la URL del web app en AVISOS_URL en Cloudflare.
// Los correos llegan al Gmail de la cuenta que publicó el script (límite de Gmail gratis: 100 al día).
function doPost(e) {
  var datos = JSON.parse(e.postData.contents || '{}');
  var clave = PropertiesService.getScriptProperties().getProperty('CLAVE');
  if (!clave || datos.clave !== clave) {
    return ContentService.createTextOutput('no autorizado');
  }
  MailApp.sendEmail(
    Session.getEffectiveUser().getEmail(),
    String(datos.asunto || 'Aviso del editor').slice(0, 200),
    String(datos.texto || '').slice(0, 5000)
  );
  return ContentService.createTextOutput('ok');
}
