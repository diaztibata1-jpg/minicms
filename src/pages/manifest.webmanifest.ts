// Datos que usa Android al agregar la página a la pantalla de inicio: nombre, colores e íconos.
export async function GET() {
  const nombre = 'Clase de SEO';
  const manifiesto = {
    name: nombre,
    short_name: nombre,
    lang: 'es-CO',
    start_url: '/',
    display: 'browser',
    background_color: '#f5f0e6',
    theme_color: '#355d4a',
    // El dibujo cabe en la zona segura, así que el de 512 sirve también para el recorte de Android.
    icons: [
      { src: '/icono-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icono-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return new Response(JSON.stringify(manifiesto), { headers: { 'Content-Type': 'application/manifest+json' } });
}
