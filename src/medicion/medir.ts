// Eventos del sitio para GTM. Cada sitio define sus 7 eventos propios:
// - con la marca data-evento="nombre" (y data-evento-* para datos extra) en cualquier enlace o botón;
// - o llamando a medir() desde código, como hace el formulario.
// GTM reenvía cualquier evento de esta lista a GA4 y al Píxel; no hay que crear una etiqueta por evento.

declare global {
  interface Window { dataLayer: Record<string, unknown>[] }
}

// Envía el evento y espera a que GTM lo procese (o máximo 1 s), para poder cambiar de página después sin perderlo.
export function medir(evento: string, datos: Record<string, string> = {}): Promise<void> {
  return new Promise((listo) => {
    window.dataLayer = window.dataLayer || [];
    const cargado = window.dataLayer.some((entrada) => entrada.event === 'gtm.js');
    if (!cargado) return listo();
    const tope = setTimeout(listo, 1000);
    window.dataLayer.push({
      event: evento,
      ...datos,
      eventCallback: () => { clearTimeout(tope); listo(); },
      eventTimeout: 1000,
    });
  });
}

export function medirMarcas() {
  document.addEventListener('click', (evento) => {
    const elemento = (evento.target as HTMLElement | null)?.closest<HTMLElement>('[data-evento]');
    if (!elemento?.dataset.evento) return;
    const datos: Record<string, string> = {};
    for (const [clave, valor] of Object.entries(elemento.dataset)) {
      if (clave.startsWith('evento') && clave !== 'evento' && valor) {
        datos[clave.slice(6).toLowerCase()] = valor;
      }
    }
    void medir(elemento.dataset.evento, datos);
  });
}
