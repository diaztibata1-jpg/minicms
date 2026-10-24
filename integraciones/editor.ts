import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import Busboy from 'busboy';
import matter from 'gray-matter';
import sanitizeHtml from 'sanitize-html';
import sharp from 'sharp';
import { z } from 'zod';
import type { AstroIntegration } from 'astro';
import { camposImagen, crearEsquemaPagina, limitesCampos } from '../src/esquema/contenido';

const execFile = promisify(execFileCallback);
const limiteSubida = 10 * 1024 * 1024;
const limiteWebp = 400 * 1024;
const camposTexto = new Set(Object.keys(limitesCampos));
const camposImagenSet = new Set<string>(camposImagen);

function responder(respuesta: import('node:http').ServerResponse, estado: number, datos: unknown) {
  respuesta.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  respuesta.end(JSON.stringify(datos));
}

function estaDentro(directorio: string, destino: string) {
  const rutaRelativa = relative(directorio, destino);
  if (rutaRelativa === '..' || rutaRelativa.startsWith(`..${sep}`) || isAbsolute(rutaRelativa)) {
    throw new Error('La ruta solicitada no está permitida.');
  }
}

function validarOrigen(solicitud: import('node:http').IncomingMessage) {
  const origen = solicitud.headers.origin;
  const host = solicitud.headers.host;
  if (!origen || !host || new URL(origen).host !== host) {
    throw new Error('La solicitud no proviene de este sitio.');
  }
}

async function leerJson(solicitud: import('node:http').IncomingMessage) {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of solicitud) {
    total += parte.length;
    if (total > 128 * 1024) throw new Error('La solicitud supera el tamaño permitido.');
    partes.push(Buffer.from(parte));
  }
  const datos: unknown = JSON.parse(Buffer.concat(partes).toString('utf8'));
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    throw new Error('El formato de los cambios no es válido.');
  }
  return datos as Record<string, unknown>;
}

function leerArchivo(solicitud: import('node:http').IncomingMessage) {
  return new Promise<{ buffer: Buffer; tipo: string; nombre: string }>((resolveArchivo, rechazar) => {
    let archivo: { buffer: Buffer; tipo: string; nombre: string } | undefined;
    let fallo: string | undefined;
    const parser = Busboy({ headers: solicitud.headers, limits: { files: 1, fileSize: limiteSubida, fields: 0, parts: 1 } });
    parser.on('file', (campo, flujo, info) => {
      if (campo !== 'file') fallo = 'Selecciona un único archivo de imagen.';
      const partes: Buffer[] = [];
      flujo.on('data', (parte: Buffer) => partes.push(Buffer.from(parte)));
      flujo.on('limit', () => { fallo = 'La imagen no puede superar los 10 MB.'; });
      flujo.on('end', () => {
        if (!fallo && campo === 'file') {
          archivo = { buffer: Buffer.concat(partes), tipo: info.mimeType, nombre: info.filename ?? 'imagen' };
        }
      });
    });
    parser.on('filesLimit', () => { fallo = 'Solo se permite una imagen por subida.'; });
    parser.on('error', () => rechazar(new Error('No se pudo leer el archivo enviado.')));
    parser.on('close', () => {
      if (fallo) rechazar(new Error(fallo));
      else if (!archivo) rechazar(new Error('Selecciona una imagen para subir.'));
      else resolveArchivo(archivo);
    });
    solicitud.pipe(parser);
  });
}

function asignarCampo(datos: Record<string, unknown>, campo: string, valor: string) {
  if (campo.startsWith('servicios.')) {
    const [, indice, propiedad] = campo.split('.');
    const servicio = (datos.servicios as Record<string, unknown>[])[Number(indice)];
    servicio[propiedad] = valor;
  } else {
    datos[campo] = valor;
  }
}

function nombreSeguro(nombre: string) {
  const base = nombre.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
  const slug = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug || 'imagen';
}

export default function editorIntegration(): AstroIntegration {
  return {
    name: 'editor-visual',
    hooks: {
      'astro:server:setup': ({ server }) => {
        if (process.env.EDITOR !== '1') return;

        const proyecto = process.cwd();
        const preparar = async () => {
          const carpetaContenido = await realpath(resolve(proyecto, 'src/content/paginas'));
          const archivoContenido = resolve(carpetaContenido, 'inicio.md');
          estaDentro(carpetaContenido, archivoContenido);
          const archivoSeguro = await realpath(archivoContenido);
          estaDentro(carpetaContenido, archivoSeguro);
          const carpetaAssets = await realpath(resolve(proyecto, 'src/assets'));
          const carpetaImagenes = await realpath(resolve(proyecto, 'src/assets/editor'));
          return { carpetaContenido, archivoSeguro, carpetaAssets, carpetaImagenes };
        };

        server.middlewares.use((solicitud, respuesta, siguiente) => {
          const ruta = new URL(solicitud.url ?? '/', 'http://localhost').pathname;
          const esClienteEditor = solicitud.method === 'GET' && ruta === '/__editor/client.js';
          const esArchivo = solicitud.method === 'GET' && /^\/__editor\/archivo\/[a-z0-9-]+\.webp$/.test(ruta);
          const esRutaEditor = ruta.startsWith('/__editor/') && (
            esClienteEditor
            || esArchivo
            || (solicitud.method === 'POST' && ['/__editor/guardar', '/__editor/imagen', '/__editor/enviar'].includes(ruta))
            || (solicitud.method === 'GET' && ['/__editor/imagenes', '/__editor/estado'].includes(ruta))
          );
          if (!esRutaEditor) return siguiente();

          void (async () => {
            try {
              const { archivoSeguro, carpetaContenido, carpetaAssets, carpetaImagenes } = await preparar();

              if (esClienteEditor) {
                const cliente = resolve(proyecto, 'src/scripts/editor.js');
                estaDentro(resolve(proyecto, 'src/scripts'), cliente);
                respuesta.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
                respuesta.end(await readFile(cliente, 'utf8'));
                return;
              }

              if (esArchivo) {
                const nombre = ruta.slice('/__editor/archivo/'.length);
                const destino = resolve(carpetaImagenes, nombre);
                estaDentro(carpetaImagenes, destino);
                const archivoReal = await realpath(destino);
                estaDentro(carpetaImagenes, archivoReal);
                const contenido = await readFile(archivoReal);
                respuesta.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'no-store' });
                respuesta.end(contenido);
                return;
              }

              if (solicitud.method === 'GET' && ruta === '/__editor/estado') {
                // Resume el pull request en publicado, rechazado o revisando para quien edita.
                const numero = new URL(solicitud.url ?? '/', 'http://localhost').searchParams.get('pr') ?? '';
                if (!/^\d{1,9}$/.test(numero)) throw new Error('Número de pull request no válido.');
                const { stdout } = await execFile('gh', ['pr', 'view', numero, '--json', 'state,statusCheckRollup'], { cwd: proyecto });
                const pr = JSON.parse(stdout) as { state: string; statusCheckRollup?: { conclusion?: string; state?: string }[] };
                const fallo = (pr.statusCheckRollup ?? []).some((check) => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(check.conclusion || check.state || ''));
                let estado = 'revisando';
                if (pr.state === 'MERGED') estado = 'publicado';
                else if (pr.state === 'CLOSED' || fallo) estado = 'rechazado';
                responder(respuesta, 200, { estado });
                return;
              }

              if (solicitud.method === 'GET' && ruta === '/__editor/imagenes') {
                const nombres = (await readdir(carpetaImagenes)).filter((nombre) => /^[a-z0-9-]+\.webp$/.test(nombre));
                const imagenes = await Promise.all(nombres.map(async (nombre) => {
                  const destino = resolve(carpetaImagenes, nombre);
                  estaDentro(carpetaImagenes, destino);
                  const archivoReal = await realpath(destino);
                  estaDentro(carpetaImagenes, archivoReal);
                  return {
                    nombre: nombre.replace(/\.webp$/, '').replace(/-/g, ' '),
                    path: `../../assets/editor/${nombre}`,
                    url: `/__editor/archivo/${nombre}`,
                  };
                }));
                responder(respuesta, 200, { imagenes });
                return;
              }

              validarOrigen(solicitud);

              if (solicitud.method === 'POST' && ruta === '/__editor/guardar') {
                const cambios = await leerJson(solicitud);
                if (!Object.keys(cambios).length) throw new Error('No hay cambios para guardar.');
                const documento = matter(await readFile(archivoSeguro, 'utf8'));
                const datos = structuredClone(documento.data) as Record<string, unknown>;

                for (const [campo, valor] of Object.entries(cambios)) {
                  if (camposTexto.has(campo)) {
                    if (typeof valor !== 'string') throw new Error(`El campo «${campo}» debe ser texto.`);
                    asignarCampo(datos, campo, sanitizeHtml(valor, { allowedTags: [], allowedAttributes: {}, disallowedTagsMode: 'discard' }));
                  } else if (camposImagenSet.has(campo)) {
                    if (typeof valor !== 'string') throw new Error('La ruta de la imagen no es válida.');
                    if (!/^\.\.\/\.\.\/assets\/(?:editor\/)?[a-z0-9-]+\.(?:jpg|jpeg|png|webp)$/.test(valor)) {
                      throw new Error('La ruta de la imagen no es válida.');
                    }
                    const destino = resolve(carpetaContenido, valor);
                    estaDentro(carpetaAssets, destino);
                    const imagenReal = await realpath(destino);
                    estaDentro(carpetaAssets, imagenReal);
                    asignarCampo(datos, campo, valor);
                  } else {
                    throw new Error(`El campo «${campo}» no está permitido.`);
                  }
                }

                for (const campo of camposImagen) {
                  const valor = campo.startsWith('servicios.')
                    ? (datos.servicios as Record<string, unknown>[])[Number(campo.split('.')[1])].imagen
                    : datos[campo];
                  if (typeof valor !== 'string' || !/^\.\.\/\.\.\/assets\/(?:editor\/)?[a-z0-9-]+\.(?:jpg|jpeg|png|webp)$/.test(valor)) {
                    throw new Error(`La imagen de «${campo}» no tiene una ruta permitida.`);
                  }
                  const destino = resolve(carpetaContenido, valor);
                  estaDentro(carpetaAssets, destino);
                  const imagenReal = await realpath(destino);
                  estaDentro(carpetaAssets, imagenReal);
                }

                const esquema = crearEsquemaPagina(z.string().min(1).max(240));
                const validacion = esquema.safeParse(datos);
                if (!validacion.success) {
                  const errores = validacion.error.issues.map((incidencia) => {
                    const campo = incidencia.path.join('.') || 'contenido';
                    return `${campo}: ${incidencia.message}`;
                  });
                  responder(respuesta, 400, { error: errores.join(' ') });
                  return;
                }

                const actualizado = matter.stringify(documento.content, datos);
                await writeFile(archivoSeguro, actualizado, 'utf8');
                responder(respuesta, 200, { mensaje: 'Contenido guardado.' });
                return;
              }

              if (solicitud.method === 'POST' && ruta === '/__editor/imagen') {
                const longitud = Number(solicitud.headers['content-length'] ?? 0);
                if (longitud > limiteSubida + 64 * 1024) {
                  responder(respuesta, 413, { error: 'La imagen no puede superar los 10 MB.' });
                  return;
                }
                const subida = await leerArchivo(solicitud);
                if (!['image/jpeg', 'image/png', 'image/webp'].includes(subida.tipo)) {
                  throw new Error('El archivo debe ser JPG, PNG o WebP.');
                }
                const imagen = sharp(subida.buffer, { limitInputPixels: 80_000_000 });
                const metadatos = await imagen.metadata();
                if (!['jpeg', 'png', 'webp'].includes(metadatos.format ?? '')) {
                  throw new Error('El contenido del archivo no es una imagen JPG, PNG o WebP válida.');
                }
                let ancho = Math.min(metadatos.width ?? 1600, 1600);
                let webp = await sharp(subida.buffer, { limitInputPixels: 80_000_000 })
                  .resize({ width: ancho, withoutEnlargement: true })
                  .webp({ quality: 80 })
                  .toBuffer();
                while (webp.length > limiteWebp && ancho > 480) {
                  ancho = Math.max(480, Math.floor(ancho * 0.8));
                  webp = await sharp(subida.buffer, { limitInputPixels: 80_000_000 })
                    .resize({ width: ancho, withoutEnlargement: true })
                    .webp({ quality: 80 })
                    .toBuffer();
                }
                if (webp.length > limiteWebp) {
                  throw new Error('La imagen no se pudo reducir a menos de 400 KB. Prueba con otra imagen.');
                }
                const ahora = new Date();
                const sello = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}-${String(ahora.getHours()).padStart(2, '0')}${String(ahora.getMinutes()).padStart(2, '0')}`;
                const nombre = `${nombreSeguro(subida.nombre)}-${sello}-${randomUUID().slice(0, 8)}.webp`;
                const destino = resolve(carpetaImagenes, nombre);
                estaDentro(carpetaImagenes, destino);
                await writeFile(destino, webp, { flag: 'wx' });
                responder(respuesta, 201, {
                  nombre,
                  path: `../../assets/editor/${nombre}`,
                  url: `/__editor/archivo/${nombre}`,
                });
                return;
              }

              if (solicitud.method === 'POST' && ruta === '/__editor/enviar') {
                const pendientes = await execFile('git', ['diff', '--cached', '--name-only'], { cwd: proyecto });
                if (pendientes.stdout.trim()) {
                  throw new Error('Hay cambios preparados fuera del editor. Confírmalos antes de enviar el contenido.');
                }
                const ahora = new Date();
                const parteFecha = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}-${String(ahora.getHours()).padStart(2, '0')}${String(ahora.getMinutes()).padStart(2, '0')}${String(ahora.getSeconds()).padStart(2, '0')}`;
                const rama = `cambios/${parteFecha}`;
                const ejecutar = async (programa: string, argumentos: string[]) => execFile(programa, argumentos, { cwd: proyecto, maxBuffer: 1024 * 1024 });
                // Cada envío parte de main actualizado para no arrastrar ramas anteriores.
                // El contenido guardado se conserva en memoria y se vuelve a escribir encima.
                const estado = (await ejecutar('git', ['status', '--porcelain', '-z', '--untracked-files=no'])).stdout.split('\0').filter(Boolean);
                if (estado.some((linea) => !linea.slice(3).startsWith('src/content/paginas/'))) {
                  throw new Error('Hay archivos modificados fuera del contenido. Guárdalos o descártalos antes de enviar.');
                }
                const contenidoGuardado = await readFile(archivoSeguro, 'utf8');
                await ejecutar('git', ['fetch', 'origin', 'main']);
                await ejecutar('git', ['switch', '--discard-changes', '-c', rama, 'origin/main']);
                await writeFile(archivoSeguro, contenidoGuardado, 'utf8');
                await ejecutar('git', ['add', '--', 'src/content/paginas/', 'src/assets/editor/']);
                const archivos = (await ejecutar('git', ['diff', '--cached', '--name-only', '-z'])).stdout.split('\0').filter(Boolean);
                if (archivos.some((archivo) => !/^src\/content\/paginas\/[^/]+\.md$/.test(archivo) && !/^src\/assets\/editor\/[a-z0-9-]+\.webp$/.test(archivo))) {
                  throw new Error('Se detectaron archivos ajenos al contenido; no se crearán el commit ni el pull request.');
                }
                if (!archivos.length) throw new Error('No hay cambios de contenido para enviar.');
                await ejecutar('git', ['commit', '-m', 'Cambios de contenido desde el editor']);
                await ejecutar('git', ['push', '--set-upstream', 'origin', rama]);
                const pullRequest = await ejecutar('gh', [
                  'pr', 'create', '--base', 'main', '--head', rama,
                  '--title', 'Cambios de contenido',
                  '--body', 'Cambios de contenido enviados desde el editor visual.',
                ]);
                const url = pullRequest.stdout.trim();
                responder(respuesta, 200, { url, numero: url.match(/\/pull\/(\d+)/)?.[1] ?? null });
              }
            } catch (error) {
              const mensaje = error instanceof Error ? error.message : 'No se pudo completar la solicitud.';
              responder(respuesta, 400, { error: mensaje });
            }
          })();
        });
      },
    },
  };
}