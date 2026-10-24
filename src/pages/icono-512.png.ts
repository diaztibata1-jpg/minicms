// Ícono de Android al agregar la página a la pantalla de inicio (lo usa manifest.webmanifest).
import { iconoCuadrado, respuestaPng } from './_iconos';

export const GET = async () => respuestaPng(await iconoCuadrado(512));
