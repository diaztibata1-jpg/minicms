// Permite revisar todo el sitio menos el editor y avisa dónde está el sitemap. Toma el dominio de `site` en astro.config.ts.
export function GET() {
  const texto = `User-agent: *\nDisallow: /editar\n\nSitemap: ${new URL('/sitemap.xml', import.meta.env.SITE).href}\n`;
  return new Response(texto, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
