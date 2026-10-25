// Páginas de la clase de SEO: evento leer_completo la primera vez que se ve la lista final de la página.
import { medir } from '../medicion/medir';

export function medirFinal() {
  const final = document.querySelector<HTMLElement>('[data-final]');
  if (!final || !('IntersectionObserver' in window)) return;
  const observador = new IntersectionObserver((entradas) => {
    if (!entradas.some((entrada) => entrada.isIntersecting)) return;
    observador.disconnect();
    void medir('leer_completo', { seccion: final.dataset.final ?? '' });
  });
  observador.observe(final);
}
