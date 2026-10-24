// Páginas que Google debe conocer. Solo va lo indexable: gracias, 404, la política de datos (noindex) y el editor quedan fuera.
// Si un sitio suma páginas propias (servicios, blog), se agregan a PAGINAS.
const PAGINAS = ['/'];

export function GET() {
  const urls = PAGINAS.map((ruta) => `  <url><loc>${new URL(ruta, import.meta.env.SITE).href}</loc></url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
