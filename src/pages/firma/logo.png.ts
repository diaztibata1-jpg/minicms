// Logo de la firma de correo. Gmail no muestra SVG, así que se pasa a PNG (al doble de tamaño para pantallas nítidas).
import { iconoRedondo, respuestaPng } from '../_iconos';

export const GET = async () => respuestaPng(await iconoRedondo(128));
