// Logo de la firma de correo. Gmail no muestra SVG, así que se pasa a PNG (al doble de tamaño para pantallas nítidas).
// Por cliente, apuntar al archivo de su logo.
import sharp from 'sharp';

export async function GET() {
  const png = await sharp('public/favicon.svg', { density: 300 }).resize(128, 128).png().toBuffer();
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
}
