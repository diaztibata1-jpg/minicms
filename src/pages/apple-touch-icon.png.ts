// Ícono al guardar la página en la pantalla de inicio del iPhone (180×180, iOS redondea las esquinas).
import { iconoCuadrado, respuestaPng } from './_iconos';

export const GET = async () => respuestaPng(await iconoCuadrado(180));
