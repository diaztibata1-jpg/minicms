// Informe mensual para el cliente: lee GA4, Search Console, Clarity, PageSpeed y la hoja de contactos,
// y manda el día 1 de cada mes un correo con el informe del mes anterior (y el mismo informe en PDF adjunto).
// Va en una hoja de cálculo nueva de la cuenta dueña de GA4 y Search Console: Extensiones > Apps Script.
// 1. Pegar este archivo en Código.gs y appsscript.json en el manifiesto
//    (Configuración del proyecto > "Mostrar el archivo de manifiesto appsscript.json en el editor").
// 2. Llenar SITIO, CONTACTOS y EVENTOS (abajo) con los datos de este cliente.
// 3. Configuración del proyecto > Propiedades del script:
//    - INFORME_PARA: correo(s) que reciben el informe, separados por coma.
//    - CLARITY_TOKEN: token de Clarity (Configuración > Exportación de datos > Generar token).
//    - PAGESPEED_CLAVE (opcional): clave de la API de PageSpeed Insights; sin ella Google puede negar la consulta.
// 4. Ejecutar probarConexiones: dice en el registro qué fuente responde y cuál no.
// 5. Ejecutar configurar: crea la pestaña Clarity, el guardado diario de Clarity y el envío mensual.
// 6. Ejecutar probarInforme: manda a tu propio correo el informe del mes en curso.

const SITIO = {
  nombre: 'Mini CMS (prueba)',
  url: 'https://minicms-6ej.pages.dev/', // igual a la propiedad de Search Console (prefijo de URL, con / al final)
  ga4Propiedad: '560690470', // número de la propiedad: GA4 > Administrar > Detalles de la propiedad
  clarityProyecto: 'z343mdlzp1',
  contactosHoja: '', // URL de la hoja de contactos del formulario (opcional; esta cuenta debe poder verla)
};

// Eventos que cuentan como contacto, con el texto que ve el cliente.
const CONTACTOS = [
  ['generate_lead', 'Por el formulario'],
  ['contacto_whatsapp', 'Por WhatsApp'],
  ['copiar_whatsapp', 'Copiaron tu número'],
];

// Los 7 eventos propios del sitio, en el orden en que salen en el informe.
const EVENTOS = [
  ['generate_lead', 'Enviaron el formulario'],
];

const MARCA = '[nuestra marca]';
const ZONA = 'America/Bogota';
const HOJA_CLARITY = 'Clarity';
const ENCABEZADOS_CLARITY = ['Fecha', 'Sesiones', 'Scroll promedio (%)', 'Clics muertos', 'Clics de rabia', 'Errores de script', 'Clics con error', 'Respuesta completa'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function configurar() {
  const libro = SpreadsheetApp.getActive();
  libro.setSpreadsheetTimeZone(ZONA);
  const hoja = libro.getSheetByName(HOJA_CLARITY) || libro.insertSheet(HOJA_CLARITY);
  hoja.getRange(1, 1, 1, ENCABEZADOS_CLARITY.length).setValues([ENCABEZADOS_CLARITY]).setFontWeight('bold');
  hoja.setFrozenRows(1);
  hoja.getRange('A2:A').setNumberFormat('yyyy-mm-dd');

  ScriptApp.getProjectTriggers()
    .filter((disparador) => ['guardarClarity', 'enviarInforme'].includes(disparador.getHandlerFunction()))
    .forEach((disparador) => ScriptApp.deleteTrigger(disparador));
  // Clarity solo entrega los últimos días: se guarda uno cada madrugada para tener el mes completo.
  ScriptApp.newTrigger('guardarClarity').timeBased().everyDays(1).atHour(5).create();
  // Después del guardado de Clarity, para que el informe incluya el último día del mes.
  ScriptApp.newTrigger('enviarInforme').timeBased().onMonthDay(1).atHour(8).create();
}

// ---------- Fechas ----------

const fecha = (dia) => Utilities.formatDate(dia, ZONA, 'yyyy-MM-dd');
const diaSiguiente = (dia) => new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() + 1);

function periodo(inicio, fin) {
  return { inicio, fin, desde: fecha(inicio), hasta: fecha(fin), mes: MESES[inicio.getMonth()] };
}

// ---------- Fuentes ----------

function ga4(rango, dimensiones, metricas, filtro) {
  const peticion = {
    dateRanges: [{ startDate: rango.desde, endDate: rango.hasta }],
    dimensions: dimensiones.map((name) => ({ name })),
    metrics: metricas.map((name) => ({ name })),
    limit: 1000,
  };
  if (filtro) peticion.dimensionFilter = filtro;
  const respuesta = AnalyticsData.Properties.runReport(peticion, `properties/${SITIO.ga4Propiedad}`);
  return (respuesta.rows || []).map((fila) => ({
    d: (fila.dimensionValues || []).map((valor) => valor.value),
    m: (fila.metricValues || []).map((valor) => Number(valor.value) || 0),
  }));
}

const filtroEventos = (nombres) => ({ filter: { fieldName: 'eventName', inListFilter: { values: nombres } } });

// Agrupa las fuentes de GA4 (l.instagram.com, ig, m.facebook.com, wa.me...) en nombres que el cliente entiende.
function origen(fuente, medio) {
  const texto = `${fuente} ${medio}`.toLowerCase();
  if (/instagram|^ig\b/.test(texto)) return 'Instagram';
  if (/facebook|^fb\b/.test(texto)) return 'Facebook';
  if (/whatsapp|wa\.me|wl\.co/.test(texto)) return 'WhatsApp';
  if (/tiktok/.test(texto)) return 'TikTok';
  if (/google/.test(texto)) return 'Google';
  if (/\(direct\)|\(not set\)|\(none\)/.test(texto)) return 'Directo o sin identificar';
  return 'Otros sitios';
}

function datosGa4(actual, anterior) {
  const contactos = CONTACTOS.map(([evento]) => evento);
  const todos = Array.from(new Set(contactos.concat(EVENTOS.map(([evento]) => evento))));
  const conteo = (rango) => {
    const total = {};
    ga4(rango, ['eventName'], ['eventCount'], filtroEventos(todos)).forEach((fila) => { total[fila.d[0]] = fila.m[0]; });
    return total;
  };
  const resumen = (rango) => {
    const fila = ga4(rango, [], ['sessions', 'averageSessionDuration'])[0];
    return { visitas: fila ? fila.m[0] : 0, duracion: fila ? fila.m[1] : 0 };
  };

  const origenes = {};
  const sumar = (nombre, campo, valor) => {
    origenes[nombre] = origenes[nombre] || { nombre, visitas: 0, contactos: 0 };
    origenes[nombre][campo] += valor;
  };
  ga4(actual, ['sessionSource', 'sessionMedium'], ['sessions'])
    .forEach((fila) => sumar(origen(fila.d[0], fila.d[1]), 'visitas', fila.m[0]));
  ga4(actual, ['sessionSource', 'sessionMedium'], ['eventCount'], filtroEventos(contactos))
    .forEach((fila) => sumar(origen(fila.d[0], fila.d[1]), 'contactos', fila.m[0]));

  const campanas = {};
  ga4(actual, ['sessionCampaignName', 'sessionManualAdContent'], ['eventCount'], filtroEventos(contactos))
    .filter((fila) => !/^\(.*\)$/.test(fila.d[0]))
    .forEach((fila) => {
      const nombre = /^\(.*\)$/.test(fila.d[1]) ? fila.d[0] : `${fila.d[0]} · ${fila.d[1]}`;
      campanas[nombre] = (campanas[nombre] || 0) + fila.m[0];
    });

  const dispositivos = ga4(actual, ['deviceCategory'], ['sessions']);
  const totalDispositivos = dispositivos.reduce((suma, fila) => suma + fila.m[0], 0);
  const celular = dispositivos.filter((fila) => fila.d[0] === 'mobile').reduce((suma, fila) => suma + fila.m[0], 0);

  return {
    eventos: conteo(actual),
    eventosAntes: conteo(anterior),
    resumen: resumen(actual),
    resumenAntes: resumen(anterior),
    origenes: Object.values(origenes),
    campanas: Object.keys(campanas).map((nombre) => ({ nombre, contactos: campanas[nombre] })).sort((a, b) => b.contactos - a.contactos),
    celularDeDiez: totalDispositivos ? Math.round((celular / totalDispositivos) * 10) : null,
  };
}

function searchConsole(rango, dimensiones, filas) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITIO.url)}/searchAnalytics/query`;
  const respuesta = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
    payload: JSON.stringify({ startDate: rango.desde, endDate: rango.hasta, dimensions: dimensiones, rowLimit: filas }),
    muteHttpExceptions: true,
  });
  if (respuesta.getResponseCode() !== 200) throw new Error(`Search Console ${respuesta.getResponseCode()}: ${respuesta.getContentText().slice(0, 300)}`);
  return JSON.parse(respuesta.getContentText()).rows || [];
}

function datosGoogle(actual, anterior) {
  const totales = (rango) => searchConsole(rango, [], 1)[0] || { clicks: 0, impressions: 0, position: 0 };
  return {
    actual: totales(actual),
    antes: totales(anterior),
    busquedas: searchConsole(actual, ['query'], 5).map((fila) => ({ texto: fila.keys[0], apariciones: fila.impressions, clics: fila.clicks })),
  };
}

function datosPageSpeed() {
  const clave = PropertiesService.getScriptProperties().getProperty('PAGESPEED_CLAVE');
  const categorias = ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO'].map((categoria) => `&category=${categoria}`).join('');
  const url = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(SITIO.url)}&strategy=mobile${categorias}${clave ? `&key=${clave}` : ''}`;
  const respuesta = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (respuesta.getResponseCode() !== 200) throw new Error(`PageSpeed ${respuesta.getResponseCode()}: ${respuesta.getContentText().slice(0, 300)}`);
  const resultado = JSON.parse(respuesta.getContentText()).lighthouseResult.categories;
  const nota = (categoria) => Math.round((resultado[categoria] ? resultado[categoria].score : 0) * 100);
  return [
    [nota('performance'), 'Velocidad'],
    [nota('accessibility'), 'Accesibilidad'],
    [nota('best-practices'), 'Buenas prácticas'],
    [nota('seo'), 'SEO técnico'],
  ];
}

function consultarClarity() {
  const token = PropertiesService.getScriptProperties().getProperty('CLARITY_TOKEN');
  if (!token) throw new Error('Falta CLARITY_TOKEN en las propiedades del script');
  const respuesta = UrlFetchApp.fetch('https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=1', {
    headers: { Authorization: `Bearer ${token}` },
    muteHttpExceptions: true,
  });
  if (respuesta.getResponseCode() !== 200) throw new Error(`Clarity ${respuesta.getResponseCode()}: ${respuesta.getContentText().slice(0, 300)}`);
  return JSON.parse(respuesta.getContentText());
}

// Cada madrugada guarda las últimas 24 horas de Clarity (su API no da más de 3 días hacia atrás ni más de 10 consultas al día).
function guardarClarity() {
  const crudo = consultarClarity();
  const metricas = {};
  crudo.forEach((metrica) => { metricas[String(metrica.metricName).replace(/\s/g, '')] = (metrica.information || [])[0] || {}; });
  const valor = (metrica, campo) => Number((metricas[metrica] || {})[campo]) || 0;

  const ayer = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
  const fila = [
    new Date(ayer.getFullYear(), ayer.getMonth(), ayer.getDate()),
    valor('Traffic', 'totalSessionCount'),
    valor('ScrollDepth', 'averageScrollDepth'),
    valor('DeadClickCount', 'subTotal'),
    valor('RageClickCount', 'subTotal'),
    valor('ScriptErrorCount', 'subTotal'),
    valor('ErrorClickCount', 'subTotal'),
    JSON.stringify(crudo).slice(0, 49000),
  ];
  const hoja = SpreadsheetApp.getActive().getSheetByName(HOJA_CLARITY);
  const ultima = hoja.getLastRow();
  // Si se corre dos veces el mismo día, reemplaza la fila en vez de duplicarla.
  const repetida = ultima > 1 && fecha(hoja.getRange(ultima, 1).getValue()) === fecha(fila[0]);
  hoja.getRange(repetida ? ultima : ultima + 1, 1, 1, fila.length).setValues([fila]);
}

function datosClarity(rango) {
  const hoja = SpreadsheetApp.getActive().getSheetByName(HOJA_CLARITY);
  if (!hoja || hoja.getLastRow() < 2) return null;
  const tope = diaSiguiente(rango.fin);
  const filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, 7).getValues()
    .filter((fila) => fila[0] instanceof Date && fila[0] >= rango.inicio && fila[0] < tope);
  if (!filas.length) return null;
  const sesiones = filas.reduce((suma, fila) => suma + fila[1], 0);
  const scroll = sesiones ? filas.reduce((suma, fila) => suma + fila[1] * fila[2], 0) / sesiones : 0;
  return {
    scroll: Math.round(scroll),
    sinRespuesta: filas.reduce((suma, fila) => suma + fila[3] + fila[4] + fila[6], 0),
    errores: filas.reduce((suma, fila) => suma + fila[5], 0),
  };
}

function datosEstados(rango) {
  if (!SITIO.contactosHoja) return null;
  const hoja = SpreadsheetApp.openByUrl(SITIO.contactosHoja).getSheetByName('Contactos');
  if (!hoja || hoja.getLastRow() < 2) return { total: 0, Cliente: 0, Cotizado: 0, Nuevo: 0 };
  const tope = diaSiguiente(rango.fin);
  const estados = { total: 0, Cliente: 0, Cotizado: 0, Nuevo: 0 };
  hoja.getRange(2, 1, hoja.getLastRow() - 1, 5).getValues()
    .filter((fila) => fila[0] instanceof Date && fila[0] >= rango.inicio && fila[0] < tope)
    .forEach((fila) => {
      estados.total += 1;
      if (fila[4] in estados) estados[fila[4]] += 1;
    });
  return estados;
}

// Cada fuente por separado: si una falla, el informe sale sin esa sección y la falla llega aparte a quien corre el script.
function reunir(actual, anterior) {
  const fallas = [];
  const intentar = (nombre, funcion) => {
    try {
      return funcion();
    } catch (error) {
      fallas.push(`${nombre}: ${error.message}`);
      return null;
    }
  };
  return {
    datos: {
      ga4: SITIO.ga4Propiedad ? intentar('GA4', () => datosGa4(actual, anterior)) : null,
      google: intentar('Search Console', () => datosGoogle(actual, anterior)),
      lighthouse: intentar('PageSpeed', datosPageSpeed),
      clarity: intentar('Clarity', () => datosClarity(actual)),
      estados: intentar('Hoja de contactos', () => datosEstados(actual)),
    },
    fallas: SITIO.ga4Propiedad ? fallas : ['GA4: falta ga4Propiedad en SITIO'].concat(fallas),
  };
}

// ---------- Envío ----------

// Disparador mensual: informe del mes anterior, comparado con el mes previo.
function enviarInforme() {
  const hoy = new Date();
  const actual = periodo(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1), new Date(hoy.getFullYear(), hoy.getMonth(), 0));
  const anterior = periodo(new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1), new Date(hoy.getFullYear(), hoy.getMonth() - 1, 0));
  const para = PropertiesService.getScriptProperties().getProperty('INFORME_PARA');
  if (!para) throw new Error('Falta INFORME_PARA en las propiedades del script');
  mandar(para, actual, anterior);
}

// Para probar: informe del mes en curso hasta hoy, solo a tu correo.
function probarInforme() {
  const hoy = new Date();
  const actual = periodo(new Date(hoy.getFullYear(), hoy.getMonth(), 1), hoy);
  const anterior = periodo(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1), new Date(hoy.getFullYear(), hoy.getMonth(), 0));
  mandar(Session.getEffectiveUser().getEmail(), actual, anterior);
}

function mandar(para, actual, anterior) {
  const { datos, fallas } = reunir(actual, anterior);
  const html = armarInforme(datos, actual, anterior);
  const asunto = `Informe de ${actual.mes} · ${SITIO.nombre}`;
  const pdf = Utilities.newBlob(html, 'text/html', 'informe.html').getAs('application/pdf').setName(`${asunto}.pdf`);
  MailApp.sendEmail({ to: para, subject: asunto, body: `${asunto}. Abre este correo en un programa que muestre HTML o mira el PDF adjunto.`, htmlBody: html, attachments: [pdf] });
  if (fallas.length) {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), `Fallas en el informe de ${SITIO.nombre}`, `El informe salió sin estas secciones:\n\n${fallas.join('\n')}`);
  }
}

// Revisa cada fuente sin mandar correos; el resultado queda en el registro de ejecución.
function probarConexiones() {
  const hoy = new Date();
  const rango = periodo(new Date(hoy.getFullYear(), hoy.getMonth(), 1), hoy);
  const probar = (nombre, funcion) => {
    try {
      Logger.log(`${nombre}: bien → ${JSON.stringify(funcion()).slice(0, 500)}`);
    } catch (error) {
      Logger.log(`${nombre}: FALLA → ${error.message}`);
    }
  };
  probar('GA4', () => ga4(rango, ['eventName'], ['eventCount']).slice(0, 10));
  probar('Search Console', () => searchConsole(rango, [], 1));
  probar('PageSpeed', datosPageSpeed);
  probar('Clarity (gasta 1 de las 10 consultas del día)', consultarClarity);
  if (SITIO.contactosHoja) probar('Hoja de contactos', () => datosEstados(rango));
}

// ---------- Plantilla ----------
// Tablas y estilos en línea porque Gmail y Outlook ignoran las hojas de estilo. El mismo HTML se convierte en el PDF.

const C = { fondo: '#f5f0e6', tarjeta: '#ffffff', tinta: '#203b32', gris: '#59685e', acento: '#cf6546', caja: '#f8f4ec', borde: '#e6e0d4', verde: '#2f7a4f' };
const SANS = 'font-family:Arial,Helvetica,sans-serif;';
const SERIF = "font-family:Georgia,'Times New Roman',serif;";
const TABLA = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"';

const escapar = (texto) => String(texto).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const numero = (valor) => Math.round(valor).toLocaleString('es-CO');
const plural = (cantidad, uno, varios) => (cantidad === 1 ? uno : varios);

function duracion(segundos) {
  const total = Math.round(segundos);
  if (total < 60) return `${total} s`;
  return `${Math.floor(total / 60)} min ${total % 60} s`;
}

// Diferencia contra el mes anterior: verde si subió, gris si bajó o quedó igual.
function diferencia(ahora, antes, formato) {
  const cambio = Math.round(ahora - antes);
  if (!cambio) return { texto: '=', color: C.gris };
  return { texto: (cambio > 0 ? '+' : '-') + (formato ? formato(Math.abs(cambio)) : numero(Math.abs(cambio))), color: cambio > 0 ? C.verde : C.gris };
}

function porcentaje(ahora, antes) {
  if (!antes) return null;
  const cambio = Math.round(((ahora - antes) / antes) * 100);
  if (!cambio) return { texto: '=', color: C.gris };
  return { texto: `${cambio > 0 ? '+' : ''}${cambio}%`, color: cambio > 0 ? C.verde : C.gris };
}

const titulo = (texto) => `<tr><td style="padding:36px 40px 12px;${SANS}font-size:12px;font-weight:bold;letter-spacing:2.5px;text-transform:uppercase;color:${C.acento};">${texto}</td></tr>`;
const parrafo = (texto) => `<tr><td style="padding:0 40px 8px;${SANS}font-size:14px;line-height:22px;color:${C.gris};">${texto}</td></tr>`;

function cajas(lista) {
  const ancho = Math.floor(100 / lista.length);
  const celdas = lista.map((caja) => `<td width="${ancho}%" valign="top" style="padding:16px 12px;background:${C.caja};border:1px solid ${C.borde};">
<div style="${SERIF}font-size:28px;line-height:32px;color:${C.tinta};">${caja.valor}</div>
<div style="${SANS}font-size:13px;line-height:18px;color:${C.gris};padding-top:4px;">${caja.etiqueta}</div>
${caja.cambio ? `<div style="${SANS}font-size:12px;font-weight:bold;color:${caja.cambio.color};padding-top:6px;">${caja.cambio.texto}</div>` : ''}
</td>`).join('');
  return `<tr><td style="padding:0 40px 8px;"><table ${TABLA} style="border-collapse:collapse;"><tr>${celdas}</tr></table></td></tr>`;
}

const celda = (texto, extra) => `<td style="padding:9px 0;border-bottom:1px solid ${C.borde};${SANS}font-size:14px;color:${C.tinta};${extra || ''}">${texto}</td>`;
const encabezado = (texto, extra) => `<td style="padding:0 0 6px;${SANS}font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${C.gris};${extra || ''}">${texto}</td>`;
const tabla = (filas) => `<tr><td style="padding:4px 40px 8px;"><table ${TABLA} style="border-collapse:collapse;">${filas.map((fila) => `<tr>${fila}</tr>`).join('')}</table></td></tr>`;

function barra(ancho, valor) {
  const color = ancho ? `<td width="${ancho}%" style="background:${C.acento};height:10px;font-size:0;line-height:0;">&nbsp;</td>` : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>${color}<td style="padding-left:${ancho ? 8 : 0}px;${SANS}font-size:14px;font-weight:bold;color:${C.tinta};white-space:nowrap;width:1%;">${valor}</td><td style="font-size:0;">&nbsp;</td></tr></table>`;
}

function enlace(nombre, texto, url) {
  return `<tr><td style="padding:0 40px 14px;"><table ${TABLA}><tr>
<td valign="top" style="${SANS}font-size:14px;line-height:22px;color:${C.gris};"><b style="color:${C.tinta};">${nombre}:</b> ${texto}</td>
<td valign="middle" align="right" style="padding-left:12px;white-space:nowrap;"><a href="${url}" style="display:inline-block;margin:4px;padding:10px 18px;border:1px solid ${C.tinta};border-radius:999px;${SANS}font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:${C.tinta};text-decoration:none;">Abrir</a></td></tr></table></td></tr>`;
}

function aviso(bien, texto) {
  const fondo = bien ? '#edf6f0' : '#fdf3e7';
  const borde = bien ? '#cfe5d7' : '#f1d9b8';
  return `<tr><td style="padding:8px 40px 8px;"><table ${TABLA}><tr><td style="padding:14px 16px;background:${fondo};border:1px solid ${borde};${SANS}font-size:14px;line-height:22px;color:${C.tinta};">${texto}</td></tr></table></td></tr>`;
}

function armarInforme(datos, actual, anterior) {
  const g = datos.ga4;
  const partes = [];

  // Encabezado: total de contactos del mes.
  let titular = 'Este mes todavía no tenemos datos de tu página';
  let bajada = '';
  if (g) {
    const total = CONTACTOS.reduce((suma, [evento]) => suma + (g.eventos[evento] || 0), 0);
    const antes = CONTACTOS.reduce((suma, [evento]) => suma + (g.eventosAntes[evento] || 0), 0);
    titular = total ? `${numero(total)} ${plural(total, 'persona te contactó', 'personas te contactaron')}` : 'Nadie te contactó este mes';
    const cambio = total - antes;
    bajada = cambio ? `${numero(Math.abs(cambio))} ${cambio > 0 ? 'más' : 'menos'} que en ${anterior.mes}.` : `Igual que en ${anterior.mes}.`;
    const mayor = g.origenes.filter((fila) => fila.contactos > 0).sort((a, b) => b.contactos - a.contactos)[0];
    if (mayor && mayor.nombre !== 'Directo o sin identificar') bajada += ` La mayoría llegó desde ${mayor.nombre}.`;
  }
  partes.push(`<tr><td align="center" style="padding:28px 40px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:10px 22px;border:1px dashed ${C.borde};${SANS}font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.gris};">Logo de nuestra marca</td></tr></table></td></tr>`);
  partes.push(`<tr><td align="center" style="padding:28px 40px 10px;${SANS}font-size:13px;font-weight:bold;letter-spacing:3px;text-transform:uppercase;color:${C.tinta};">Informe de ${actual.mes} · ${escapar(SITIO.nombre)}</td></tr>`);
  partes.push(`<tr><td align="center" style="padding:0 40px 14px;${SERIF}font-style:italic;font-size:32px;line-height:40px;color:${C.tinta};">${titular}</td></tr>`);
  if (bajada) partes.push(`<tr><td align="center" style="padding:0 48px 8px;${SANS}font-size:16px;line-height:26px;color:${C.gris};">${bajada}</td></tr>`);

  if (g) {
    partes.push(titulo('Cómo te contactaron'));
    partes.push(cajas(CONTACTOS.map(([evento, etiqueta]) => ({
      valor: numero(g.eventos[evento] || 0),
      etiqueta,
      cambio: diferencia(g.eventos[evento] || 0, g.eventosAntes[evento] || 0),
    }))));

    const origenes = g.origenes.filter((fila) => fila.visitas || fila.contactos)
      .sort((a, b) => (a.nombre === 'Directo o sin identificar') - (b.nombre === 'Directo o sin identificar') || b.contactos - a.contactos || b.visitas - a.visitas);
    if (origenes.length) {
      const maximo = Math.max(...origenes.map((fila) => fila.contactos));
      partes.push(titulo('De dónde llegaron'));
      partes.push(parrafo('Visitas y personas que te contactaron, por red.'));
      partes.push(tabla([encabezado('Origen') + encabezado('Visitas', 'padding:0 8px 6px;text-align:right;') + encabezado('Contactos', 'padding:0 0 6px 8px;')]
        .concat(origenes.map((fila) => celda(fila.nombre, 'padding:10px 0;width:34%;')
          + celda(numero(fila.visitas), `padding:10px 8px;color:${C.gris};text-align:right;width:16%;`)
          + `<td style="padding:10px 0 10px 8px;border-bottom:1px solid ${C.borde};width:50%;">${barra(maximo ? Math.round((fila.contactos / maximo) * 100) : 0, numero(fila.contactos))}</td>`))));
    }

    if (g.campanas.length) {
      partes.push(titulo('Tus campañas'));
      partes.push(parrafo('Personas que te contactaron desde cada anuncio.'));
      partes.push(tabla(g.campanas.slice(0, 10).map((fila) => celda(escapar(fila.nombre))
        + celda(`${numero(fila.contactos)} ${plural(fila.contactos, 'contacto', 'contactos')}`, 'font-weight:bold;text-align:right;'))));
    }
  }

  const e = datos.estados;
  if (e && e.total) {
    partes.push(titulo('Qué pasó con los que llenaron el formulario'));
    partes.push(cajas([
      { valor: numero(e.Cliente), etiqueta: 'Se volvieron clientes' },
      { valor: numero(e.Cotizado), etiqueta: 'Cotizados' },
      { valor: numero(e.Nuevo), etiqueta: 'Sin responder' },
    ]));
    partes.push(parrafo(`De ${plural(e.total, 'la persona', `las ${numero(e.total)} personas`)} del formulario, según el estado que marcaste en tu hoja de contactos.${e.Nuevo ? ' Escríbeles pronto a los que no has respondido.' : ''}`));
  }

  if (g) {
    partes.push(titulo('Qué hicieron en tu página'));
    const lista = [
      { valor: numero(g.resumen.visitas), etiqueta: 'Visitas', cambio: porcentaje(g.resumen.visitas, g.resumenAntes.visitas) },
      { valor: duracion(g.resumen.duracion), etiqueta: 'Tiempo promedio en tu página', cambio: g.resumenAntes.visitas ? diferencia(g.resumen.duracion, g.resumenAntes.duracion, (s) => duracion(s)) : null },
    ];
    if (datos.clarity) lista.push({ valor: `${datos.clarity.scroll}%`, etiqueta: 'Hasta dónde bajan en promedio' });
    partes.push(cajas(lista));
    if (g.celularDeDiez !== null) partes.push(tabla([celda('Te visitan desde el celular') + celda(`${g.celularDeDiez} de cada 10`, 'font-weight:bold;text-align:right;')]));
    partes.push(parrafo('Las acciones que medimos en tu página este mes:'));
    partes.push(tabla([encabezado('Acción') + encabezado('Veces', 'text-align:right;') + encabezado(`Vs. ${anterior.mes.slice(0, 3)}.`, 'padding:0 0 6px 12px;text-align:right;')]
      .concat(EVENTOS.map(([evento, etiqueta]) => {
        const cambio = diferencia(g.eventos[evento] || 0, g.eventosAntes[evento] || 0);
        return celda(etiqueta) + celda(numero(g.eventos[evento] || 0), 'font-weight:bold;text-align:right;')
          + celda(cambio.texto, `padding:9px 0 9px 12px;font-size:12px;font-weight:bold;color:${cambio.color};text-align:right;width:60px;`);
      }))));
  }

  const go = datos.google;
  if (go) {
    partes.push(titulo('Cómo te ven en Google'));
    partes.push(cajas([
      { valor: numero(go.actual.impressions), etiqueta: 'Veces que apareciste en Google', cambio: diferencia(go.actual.impressions, go.antes.impressions) },
      { valor: numero(go.actual.clicks), etiqueta: 'Clics hacia tu página', cambio: diferencia(go.actual.clicks, go.antes.clicks) },
      { valor: go.actual.impressions ? numero(Math.max(1, go.actual.position)) : '–', etiqueta: 'Posición promedio en los resultados' },
    ]));
    if (go.busquedas.length) {
      partes.push(parrafo('Búsquedas con las que más apareciste:'));
      partes.push(tabla([encabezado('Búsqueda') + encabezado('Apariciones', 'text-align:right;') + encabezado('Clics', 'text-align:right;')]
        .concat(go.busquedas.map((fila) => celda(escapar(fila.texto)) + celda(numero(fila.apariciones), `color:${C.gris};text-align:right;`) + celda(numero(fila.clics), 'font-weight:bold;text-align:right;')))));
    } else if (!go.actual.impressions) {
      partes.push(parrafo('Google todavía no muestra tu página en sus resultados. Es normal en una página nueva: suele tardar unas semanas.'));
    }
  }

  if (datos.lighthouse || datos.clarity) {
    partes.push(titulo('Salud de tu página'));
    if (datos.lighthouse) {
      partes.push(parrafo('Calificación de Google (Lighthouse) en celular, de 0 a 100:'));
      partes.push(cajas(datos.lighthouse.map(([nota, etiqueta]) => ({ valor: nota, etiqueta }))));
    }
    const cl = datos.clarity;
    if (cl) {
      partes.push(cl.sinRespuesta || cl.errores
        ? aviso(false, `<b style="color:#9a5b13;">Para revisar.</b> Este mes hubo ${numero(cl.sinRespuesta)} ${plural(cl.sinRespuesta, 'toque', 'toques')} en partes que no respondieron y ${numero(cl.errores)} ${plural(cl.errores, 'error', 'errores')} en la página. Lo revisaremos con las grabaciones de Clarity.`)
        : aviso(true, `<b style="color:${C.verde};">Todo en orden.</b> Nadie tocó botones que no respondan y no hubo errores este mes.`));
    }
  }

  partes.push(titulo('Para ver más detalle'));
  if (SITIO.ga4Propiedad) partes.push(enlace('Google Analytics', 'todas las visitas, de dónde vienen, qué hacen y desde qué dispositivo, día por día.', `https://analytics.google.com/analytics/web/#/p${SITIO.ga4Propiedad}/reports/intelligenthome`));
  partes.push(enlace('Search Console', 'todas las búsquedas con las que apareces en Google, cuántas veces y en qué posición.', `https://search.google.com/search-console?resource_id=${encodeURIComponent(SITIO.url)}`));
  partes.push(enlace('Clarity', 'mapas de calor (dónde tocan y hasta dónde bajan) y grabaciones de visitas reales a tu página, sin datos personales.', `https://clarity.microsoft.com/projects/view/${SITIO.clarityProyecto}/dashboard`));
  partes.push('<tr><td style="padding:0 0 36px;"></td></tr>');

  const rango = `${actual.inicio.getDate()} al ${actual.fin.getDate()} de ${actual.mes} de ${actual.fin.getFullYear()}`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Informe de ${actual.mes} · ${escapar(SITIO.nombre)}</title></head>
<body style="margin:0;padding:0;background:${C.fondo};">
<table ${TABLA} style="background:${C.fondo};">
<tr><td align="center" style="padding:40px 16px;">
<table ${TABLA} style="max-width:600px;background:${C.tarjeta};border-top:4px solid ${C.acento};">
${partes.join('\n')}
</table>
<p style="margin:20px 0 0;${SANS}font-size:12px;color:${C.gris};">Informe preparado por ${MARCA} · ${rango}</p>
</td></tr></table></body></html>`;
}
