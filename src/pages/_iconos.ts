// Íconos del sitio generados en cada build desde public/favicon.svg, así que por cliente basta con cambiar ese archivo
// (y el color de fondo de abajo, que es el del círculo del favicon).
import sharp from 'sharp';

export const FONDO_ICONO = '#cf6546';

// Ícono redondo con fondo transparente, para pestañas y favicon.ico.
export const iconoRedondo = (lado: number) =>
  sharp('public/favicon.svg', { density: 300 }).resize(lado, lado).png().toBuffer();

// Ícono cuadrado relleno: iPhone pinta de negro lo transparente y Android recorta el ícono a su forma.
export const iconoCuadrado = (lado: number) =>
  sharp('public/favicon.svg', { density: 300 }).resize(lado, lado).flatten({ background: FONDO_ICONO }).png().toBuffer();

export const respuestaPng = (png: Buffer) => new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
