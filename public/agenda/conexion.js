// Habla con el servidor de la agenda. Por defecto, la API de Cloudflare en /agenda/api/.
// Si la página trae <meta name="agenda-apps-script" content="https://script.google.com/macros/s/…/exec">,
// usa el Apps Script de la versión Google Sheets (agenda/apps-script/Codigo.gs).
const appsScript = document.querySelector('meta[name="agenda-apps-script"]')?.content || '';
export const usaSheets = Boolean(appsScript);

// En la versión Sheets la sesión es un token: Apps Script no maneja cookies.
const claveToken = 'agenda-token';
const token = {
  leer: () => {
    try {
      return localStorage.getItem(claveToken) || '';
    } catch {
      return '';
    }
  },
  guardar: (valor) => {
    try {
      if (valor) localStorage.setItem(claveToken, valor);
      else localStorage.removeItem(claveToken);
    } catch {}
  },
};

async function llamarSheets(metodo, ruta, cuerpo) {
  let respuesta;
  if (metodo === 'GET' && ruta.startsWith('publico/')) {
    const [camino, consulta] = ruta.split('?');
    respuesta = await fetch(`${appsScript}?ruta=${encodeURIComponent(camino)}${consulta ? `&${consulta}` : ''}`);
  } else {
    // Texto plano para que el navegador no haga la consulta previa (CORS) que Apps Script no responde.
    respuesta = await fetch(appsScript, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ metodo, ruta: ruta.replace(/^admin\//, ''), cuerpo, token: token.leer() }),
    });
  }
  const { estado, datos } = await respuesta.json();
  if (datos?.token) token.guardar(datos.token);
  if (ruta === 'admin/salir' || (estado === 401 && ruta !== 'admin/entrar')) token.guardar('');
  return { estado, datos: datos || {} };
}

// Devuelve { estado, datos } como una respuesta HTTP. `ruta` va sin /agenda/api/, por ejemplo 'admin/citas?desde=…'.
// Si no hay conexión, lanza el error de fetch.
export async function llamar(metodo, ruta, cuerpo) {
  if (usaSheets) return llamarSheets(metodo, ruta, cuerpo);
  const respuesta = await fetch(`/agenda/api/${ruta}`, {
    method: metodo,
    headers: cuerpo ? { 'content-type': 'application/json' } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { estado: respuesta.status, datos: await respuesta.json().catch(() => ({})) };
}
