// favicon.ico para navegadores viejos y para el resultado de Google, que lo pide en la raíz.
// El formato ICO admite PNG por dentro: un encabezado, una entrada por tamaño y luego cada PNG.
import { iconoRedondo } from './_iconos';

const TAMANOS = [16, 32, 48];

export async function GET() {
  const imagenes = await Promise.all(TAMANOS.map(iconoRedondo));
  const encabezado = Buffer.alloc(6 + 16 * imagenes.length);
  encabezado.writeUInt16LE(1, 2);
  encabezado.writeUInt16LE(imagenes.length, 4);
  let desplazamiento = encabezado.length;
  imagenes.forEach((png, i) => {
    const entrada = 6 + 16 * i;
    encabezado.writeUInt8(TAMANOS[i], entrada);
    encabezado.writeUInt8(TAMANOS[i], entrada + 1);
    encabezado.writeUInt16LE(1, entrada + 4);
    encabezado.writeUInt16LE(32, entrada + 6);
    encabezado.writeUInt32LE(png.length, entrada + 8);
    encabezado.writeUInt32LE(desplazamiento, entrada + 12);
    desplazamiento += png.length;
  });
  const ico = Buffer.concat([encabezado, ...imagenes]);
  return new Response(new Uint8Array(ico), { headers: { 'Content-Type': 'image/x-icon' } });
}
