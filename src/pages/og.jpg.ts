// Imagen para compartir (Open Graph) del sitio de la clase, 1200×630. Se arma en cada build: solo texto y el ícono.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
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
  const marca = await readFile('public/favicon.svg');
  const dominio = new URL(import.meta.env.SITE).host;

  const lienzo = h('div', { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: ANCHO, height: ALTO, padding: '72px 80px', background: COLORES.papel }, [
    h('div', { display: 'flex', alignItems: 'center', gap: 18 }, [
      h('img', { width: 60, height: 60 }, undefined, { src: `data:image/svg+xml;base64,${marca.toString('base64')}`, width: 60, height: 60 }),
      h('div', { color: COLORES.coral, fontFamily: 'Inter', fontSize: 24, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase' }, 'Clase de SEO'),
    ]),
    h('div', { display: 'flex', flexDirection: 'column', gap: 22 }, [
      h('div', { color: COLORES.tinta, fontFamily: 'Lora', fontSize: 84, fontWeight: 500, lineHeight: 1.04 }, 'Cómo un sitio le habla a Google'),
      h('div', { color: COLORES.gris, fontFamily: 'Inter', fontSize: 30 }, 'Parte 1: técnico · Parte 2: contenido'),
    ]),
    h('div', { display: 'flex', alignItems: 'center', gap: 18, color: COLORES.gris, fontFamily: 'Inter', fontSize: 22 }, [
      h('div', { width: 48, height: 3, background: COLORES.coral }),
      dominio,
    ]),
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
