// Imagen para compartir (Open Graph), 1200×630. Se arma en cada build con el contenido del sitio,
// así que si el cliente cambia el nombre, el título o la foto del hero desde el editor, la imagen se actualiza sola.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { getCollection } from 'astro:content';
import satori from 'satori';
import sharp from 'sharp';

// Colores del sitio (los mismos de global.css).
const COLORES = { tinta: '#203b32', coral: '#cf6546', papel: '#f5f0e6', gris: '#59685e' };
const ANCHO = 1200;
const ALTO = 630;

const require = createRequire(import.meta.url);
const fuente = (archivo: string) => readFile(require.resolve(`@fontsource/${archivo}`));

type Nodo = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Nodo => ({
  type,
  props: { style, children, ...extra },
});

export async function GET() {
  const [pagina] = await getCollection('paginas');
  const contenido = pagina.data;
  const foto = await sharp((contenido.hero_imagen as ImageMetadata & { fsPath: string }).fsPath)
    .resize(560, ALTO, { fit: 'cover' })
    .jpeg({ quality: 82 })
    .toBuffer();
  const marca = await readFile('public/favicon.svg');
  const dominio = new URL(import.meta.env.SITE).host;

  const lienzo = h('div', { display: 'flex', width: ANCHO, height: ALTO, background: COLORES.papel }, [
    h('div', { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: 640, padding: '64px 56px 56px 72px' }, [
      h('div', { display: 'flex', alignItems: 'center', gap: 16 }, [
        h('img', { width: 52, height: 52 }, undefined, { src: `data:image/svg+xml;base64,${marca.toString('base64')}`, width: 52, height: 52 }),
        h('div', { color: COLORES.coral, fontFamily: 'Inter', fontSize: 22, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase' }, contenido.negocio_nombre),
      ]),
      h('div', { color: COLORES.tinta, fontFamily: 'Lora', fontSize: contenido.hero_titulo.length > 40 ? 58 : 68, fontWeight: 500, lineHeight: 1.08 }, contenido.hero_titulo),
      h('div', { display: 'flex', alignItems: 'center', gap: 18, color: COLORES.gris, fontFamily: 'Inter', fontSize: 22 }, [
        h('div', { width: 48, height: 3, background: COLORES.coral }),
        dominio,
      ]),
    ]),
    h('img', { width: 560, height: ALTO, objectFit: 'cover' }, undefined, { src: `data:image/jpeg;base64,${foto.toString('base64')}`, width: 560, height: ALTO }),
  ]);

  const svg = await satori(lienzo as never, {
    width: ANCHO,
    height: ALTO,
    fonts: [
      { name: 'Lora', data: await fuente('lora/files/lora-latin-500-normal.woff'), weight: 500, style: 'normal' },
      { name: 'Inter', data: await fuente('inter/files/inter-latin-400-normal.woff'), weight: 400, style: 'normal' },
      { name: 'Inter', data: await fuente('inter/files/inter-latin-700-normal.woff'), weight: 700, style: 'normal' },
    ],
  });
  // JPG y no PNG: WhatsApp no muestra la vista previa si la imagen pesa más de unos 300 KB.
  const jpg = await sharp(Buffer.from(svg)).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  return new Response(new Uint8Array(jpg), { headers: { 'Content-Type': 'image/jpeg' } });
}
