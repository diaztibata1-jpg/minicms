// API del editor en línea (/editar). Corre como Pages Function en Cloudflare.
// Cloudflare Access pide el login antes de llegar aquí; igual se verifica el JWT de Access
// para que la API quede cerrada si Access se desconfigura.
//
// Variables del proyecto en Cloudflare Pages (Settings > Variables and secrets):
// - EDITOR_GITHUB_TOKEN: token fine-grained solo para este repo (Contents y Pull requests: escritura).
// - ACCESS_TEAM_DOMAIN: por ejemplo https://equipo.cloudflareaccess.com
// - ACCESS_AUD: el "Application Audience (AUD) Tag" de la aplicación de Access.
// - GITHUB_REPO (opcional): dueño/repositorio; por defecto diaztibata1-jpg/minicms.
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { camposImagen, crearEsquemaPagina, limitesCampos } from '../../../src/esquema/contenido';

const archivoContenido = 'src/content/paginas/inicio.md';
const carpetaImagenes = 'src/assets/editor';
const limiteImagen = 400 * 1024;
const nombreImagenValido = /^[a-z0-9-]+\.(?:webp|jpg)$/;
const rutaImagenValida = /^\.\.\/\.\.\/assets\/(?:editor\/)?[a-z0-9-]+\.(?:jpg|jpeg|png|webp)$/;
const camposTexto = new Set(Object.keys(limitesCampos));
const camposImagenSet = new Set(camposImagen);

class ErrorEditor extends Error {
  constructor(mensaje, estado = 400) {
    super(mensaje);
    this.estado = estado;
  }
}

const json = (datos, estado = 200) => new Response(JSON.stringify(datos), {
  status: estado,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

const base64UrlABytes = (texto) => {
  const base64 = texto.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(texto.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (caracter) => caracter.charCodeAt(0));
};
const base64ABytes = (texto) => Uint8Array.from(atob(texto), (caracter) => caracter.charCodeAt(0));
const textoABase64 = (texto) => {
  const bytes = new TextEncoder().encode(texto);
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
};

async function verificarAcceso(request, env) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    throw new ErrorEditor('El editor no tiene configurado el inicio de sesión.', 503);
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new ErrorEditor('Inicia sesión para usar el editor.', 401);
  const partes = token.split('.');
  if (partes.length !== 3) throw new ErrorEditor('Sesión no válida.', 401);
  const [cabeceraTexto, cargaTexto, firma] = partes;
  const decodificar = (parte) => JSON.parse(new TextDecoder().decode(base64UrlABytes(parte)));
  const cabecera = decodificar(cabeceraTexto);
  const carga = decodificar(cargaTexto);
  const dominio = env.ACCESS_TEAM_DOMAIN.replace(/\/+$/, '');

  const certificados = await fetch(`${dominio}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600 } });
  if (!certificados.ok) throw new ErrorEditor('No se pudo verificar la sesión.', 503);
  const { keys = [] } = await certificados.json();
  const jwk = keys.find((clave) => clave.kid === cabecera.kid);
  if (!jwk || cabecera.alg !== 'RS256') throw new ErrorEditor('Sesión no válida.', 401);
  const clave = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valida = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    clave,
    base64UrlABytes(firma),
    new TextEncoder().encode(`${cabeceraTexto}.${cargaTexto}`),
  );
  const audiencias = Array.isArray(carga.aud) ? carga.aud : [carga.aud];
  const ahora = Math.floor(Date.now() / 1000);
  if (!valida || !audiencias.includes(env.ACCESS_AUD) || carga.iss !== dominio || !(carga.exp > ahora)) {
    throw new ErrorEditor('Sesión no válida o vencida. Vuelve a iniciar sesión.', 401);
  }
  return carga.email || 'desconocido';
}

function crearGithub(env) {
  if (!env.EDITOR_GITHUB_TOKEN) throw new ErrorEditor('El editor no tiene configurado el acceso a GitHub.', 503);
  const repo = env.GITHUB_REPO || 'diaztibata1-jpg/minicms';
  return async (ruta, opciones = {}) => {
    const respuesta = await fetch(`https://api.github.com/repos/${repo}/${ruta}`, {
      ...opciones,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.EDITOR_GITHUB_TOKEN}`,
        'User-Agent': 'minicms-editor',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
        ...opciones.headers,
      },
    });
    if (opciones.crudo) return respuesta;
    if (!respuesta.ok) {
      console.error('GitHub', ruta, respuesta.status, await respuesta.text());
      throw new ErrorEditor('No se pudo comunicar con el repositorio. Intenta de nuevo en unos minutos.', 502);
    }
    return respuesta.json();
  };
}

function separarFrontmatter(texto) {
  const coincidencia = texto.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!coincidencia) throw new ErrorEditor('El archivo de contenido no tiene el formato esperado.', 500);
  return { datos: parse(coincidencia[1]), cuerpo: coincidencia[2] };
}

function asignarCampo(datos, campo, valor) {
  if (campo.startsWith('servicios.')) {
    const [, indice, propiedad] = campo.split('.');
    datos.servicios[Number(indice)][propiedad] = valor;
  } else {
    datos[campo] = valor;
  }
}

function leerCampo(datos, campo) {
  if (campo.startsWith('servicios.')) {
    const [, indice, propiedad] = campo.split('.');
    return datos.servicios?.[Number(indice)]?.[propiedad];
  }
  return datos[campo];
}

function validarImagenNueva(imagen) {
  if (!imagen || typeof imagen.nombre !== 'string' || typeof imagen.contenido !== 'string') {
    throw new ErrorEditor('Una de las imágenes no es válida.');
  }
  if (!nombreImagenValido.test(imagen.nombre)) throw new ErrorEditor('El nombre de una imagen no es válido.');
  let bytes;
  try {
    bytes = base64ABytes(imagen.contenido);
  } catch {
    throw new ErrorEditor('Una de las imágenes no es válida.');
  }
  if (bytes.length > limiteImagen) throw new ErrorEditor('Cada imagen debe pesar como máximo 400 KB.');
  const ascii = (desde, hasta) => String.fromCharCode(...bytes.subarray(desde, hasta));
  const esWebp = ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  const esJpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (imagen.nombre.endsWith('.webp') ? !esWebp : !esJpg) {
    throw new ErrorEditor('El contenido de una imagen no coincide con su formato.');
  }
}

async function publicar(request, github, email) {
  if (Number(request.headers.get('Content-Length') || 0) > 3 * 1024 * 1024) {
    throw new ErrorEditor('El envío es demasiado grande.');
  }
  const cuerpo = await request.json().catch(() => null);
  const cambios = cuerpo?.cambios;
  const imagenes = Array.isArray(cuerpo?.imagenes) ? cuerpo.imagenes : [];
  if (!cambios || typeof cambios !== 'object' || Array.isArray(cambios) || !Object.keys(cambios).length) {
    throw new ErrorEditor('No hay cambios para publicar.');
  }
  if (imagenes.length > camposImagen.length) throw new ErrorEditor('Hay demasiadas imágenes en el envío.');
  imagenes.forEach(validarImagenNueva);
  const nombresNuevos = new Set(imagenes.map((imagen) => imagen.nombre));

  // Se parte siempre de main actual: solo se aplican los campos cambiados.
  const referencia = await github('git/ref/heads/main');
  const baseSha = referencia.object.sha;
  const commitBase = await github(`git/commits/${baseSha}`);
  const archivo = await github(`contents/${archivoContenido}?ref=${baseSha}`);
  const original = new TextDecoder().decode(base64ABytes(archivo.content.replace(/\n/g, '')));
  const { datos, cuerpo: cuerpoMarkdown } = separarFrontmatter(original);

  for (const [campo, valor] of Object.entries(cambios)) {
    if (typeof valor !== 'string') throw new ErrorEditor(`El campo «${campo}» debe ser texto.`);
    if (camposTexto.has(campo)) {
      asignarCampo(datos, campo, valor.replace(/<[^>]*>/g, ''));
    } else if (camposImagenSet.has(campo)) {
      if (!rutaImagenValida.test(valor)) throw new ErrorEditor('La ruta de la imagen no es válida.');
      asignarCampo(datos, campo, valor);
    } else {
      throw new ErrorEditor(`El campo «${campo}» no está permitido.`);
    }
  }

  // Cada imagen referenciada debe existir en el repositorio o venir en este envío.
  const existentes = new Set();
  for (const carpeta of ['src/assets', carpetaImagenes]) {
    const lista = await github(`contents/${carpeta}?ref=${baseSha}`);
    const prefijo = carpeta === carpetaImagenes ? 'editor/' : '';
    lista.filter((item) => item.type === 'file').forEach((item) => existentes.add(`../../assets/${prefijo}${item.name}`));
  }
  for (const campo of camposImagen) {
    const valor = leerCampo(datos, campo);
    const esNueva = typeof valor === 'string' && nombresNuevos.has(valor.replace('../../assets/editor/', ''));
    if (typeof valor !== 'string' || !rutaImagenValida.test(valor) || (!existentes.has(valor) && !esNueva)) {
      throw new ErrorEditor(`La imagen de «${campo}» no existe.`);
    }
  }

  const validacion = crearEsquemaPagina(z.string().min(1).max(240)).safeParse(datos);
  if (!validacion.success) {
    throw new ErrorEditor(validacion.error.issues.map((incidencia) => incidencia.message).join(' '));
  }

  const contenidoNuevo = `---\n${stringify(datos, { lineWidth: 0 })}---\n${cuerpoMarkdown}`;
  const blobs = await Promise.all(imagenes.map(async (imagen) => {
    const blob = await github('git/blobs', { method: 'POST', body: JSON.stringify({ content: imagen.contenido, encoding: 'base64' }) });
    return { path: `${carpetaImagenes}/${imagen.nombre}`, mode: '100644', type: 'blob', sha: blob.sha };
  }));
  const arbol = await github('git/trees', {
    method: 'POST',
    body: JSON.stringify({
      base_tree: commitBase.tree.sha,
      tree: [{ path: archivoContenido, mode: '100644', type: 'blob', content: contenidoNuevo }, ...blobs],
    }),
  });
  const commit = await github('git/commits', {
    method: 'POST',
    body: JSON.stringify({ message: 'Cambios de contenido desde el editor', tree: arbol.sha, parents: [baseSha] }),
  });
  const ahora = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const rama = `cambios/${ahora}-${crypto.randomUUID().slice(0, 6)}`;
  await github('git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${rama}`, sha: commit.sha }) });
  const pr = await github('pulls', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Cambios de contenido',
      head: rama,
      base: 'main',
      body: `Cambios de contenido enviados desde /editar por ${email}.`,
    }),
  });
  return json({ numero: pr.number });
}

async function estado(url, github) {
  const numero = url.searchParams.get('pr') ?? '';
  if (!/^\d{1,9}$/.test(numero)) throw new ErrorEditor('Número de envío no válido.');
  const pr = await github(`pulls/${numero}`);
  if (!pr.head?.ref?.startsWith('cambios/')) throw new ErrorEditor('Número de envío no válido.');
  if (pr.merged) return json({ estado: 'publicado' });
  if (pr.state === 'closed') return json({ estado: 'rechazado' });
  const { check_runs: checks = [] } = await github(`commits/${pr.head.sha}/check-runs`);
  const fallo = checks.some((check) => ['failure', 'cancelled', 'timed_out', 'action_required'].includes(check.conclusion));
  return json({ estado: fallo ? 'rechazado' : 'revisando' });
}

async function listarImagenes(github) {
  const respuesta = await github(`contents/${carpetaImagenes}?ref=main`, { crudo: true });
  if (respuesta.status === 404) return json({ imagenes: [] });
  if (!respuesta.ok) throw new ErrorEditor('No se pudo cargar la biblioteca.', 502);
  const lista = await respuesta.json();
  const imagenes = lista
    .filter((item) => item.type === 'file' && nombreImagenValido.test(item.name))
    .map((item) => ({
      nombre: item.name.replace(/\.(?:webp|jpg)$/, '').replace(/-/g, ' '),
      path: `../../assets/editor/${item.name}`,
      url: `/api/editor/archivo/${item.name}`,
    }));
  return json({ imagenes });
}

async function servirImagen(nombre, github) {
  if (!nombreImagenValido.test(nombre)) throw new ErrorEditor('Imagen no válida.', 404);
  const respuesta = await github(`contents/${carpetaImagenes}/${nombre}?ref=main`, {
    crudo: true,
    headers: { Accept: 'application/vnd.github.raw' },
  });
  if (!respuesta.ok) throw new ErrorEditor('Imagen no encontrada.', 404);
  return new Response(respuesta.body, {
    headers: {
      'Content-Type': nombre.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
      'Cache-Control': 'private, max-age=300',
    },
  });
}

export async function onRequest({ request, env, params }) {
  try {
    const email = await verificarAcceso(request, env);
    const ruta = (params.ruta || []).join('/');
    const url = new URL(request.url);
    const github = crearGithub(env);

    if (request.method === 'POST' && ruta === 'publicar') {
      // Evita envíos desde otros sitios con la sesión del usuario.
      if (request.headers.get('Origin') !== url.origin) throw new ErrorEditor('La solicitud no proviene de este sitio.', 403);
      return await publicar(request, github, email);
    }
    if (request.method === 'GET' && ruta === 'estado') return await estado(url, github);
    if (request.method === 'GET' && ruta === 'imagenes') return await listarImagenes(github);
    if (request.method === 'GET' && ruta.startsWith('archivo/')) return await servirImagen(ruta.slice('archivo/'.length), github);
    return json({ error: 'Ruta no encontrada.' }, 404);
  } catch (error) {
    if (error instanceof ErrorEditor) return json({ error: error.message }, error.estado);
    console.error(error);
    return json({ error: 'Ocurrió un error inesperado. Intenta de nuevo.' }, 500);
  }
}
