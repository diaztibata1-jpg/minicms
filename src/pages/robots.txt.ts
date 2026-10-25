// Sitio de la clase: se permite revisar todo ("Disallow:" vacío) y se avisa dónde está el sitemap.
export function GET() {
  const texto = `User-agent: *\nDisallow:\n\nSitemap: ${new URL('/sitemap.xml', import.meta.env.SITE).href}\n`;
  return new Response(texto, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
