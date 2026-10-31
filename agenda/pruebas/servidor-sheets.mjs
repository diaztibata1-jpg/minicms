// Sirve la versión Google Sheets en local, con la hoja simulada y los datos de ejemplo:
// http://localhost:8791/agenda-sheets/ y /agenda-sheets/admin/ (contraseña: clave-de-prueba-larga).
// Uso: node pruebas/servidor-sheets.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { crearAgenda } from './apps-script-simulado.mjs';

const puerto = Number(process.env.PUERTO) || 8791;
const raiz = new URL('../../public/', import.meta.url).pathname;
const agenda = crearAgenda({ propiedades: { AGENDA_PASSWORD: 'clave-de-prueba-larga' } });
agenda.ejecutar('cargarEjemplo');
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

createServer(async (peticion, respuesta) => {
  const url = new URL(peticion.url, `http://localhost:${puerto}`);
  if (url.pathname === '/exec') {
    let cuerpo = '';
    for await (const parte of peticion) cuerpo += parte;
    const salida = peticion.method === 'POST'
      ? agenda.post(JSON.parse(cuerpo || '{}'))
      : agenda.get(Object.fromEntries(url.searchParams));
    respuesta.writeHead(200, { 'content-type': 'application/json' });
    return respuesta.end(JSON.stringify(salida));
  }
  let ruta = normalize(join(raiz, decodeURIComponent(url.pathname)));
  if (!ruta.startsWith(raiz)) return respuesta.writeHead(403).end();
  if (ruta.endsWith('/')) ruta += 'index.html';
  try {
    let contenido = await readFile(ruta);
    // Apunta las páginas al Apps Script simulado en vez del real.
    if (ruta.endsWith('.html')) {
      contenido = String(contenido).replace(/https:\/\/script\.google\.com\/macros\/s\/[^"]+\/exec/, `http://localhost:${puerto}/exec`);
    }
    respuesta.writeHead(200, { 'content-type': tipos[extname(ruta)] || 'application/octet-stream' });
    respuesta.end(contenido);
  } catch {
    respuesta.writeHead(404).end('No existe');
  }
}).listen(puerto, () => console.log(`Agenda (versión Sheets simulada) en http://localhost:${puerto}/agenda-sheets/`));
