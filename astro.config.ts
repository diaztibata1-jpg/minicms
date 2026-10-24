import { defineConfig } from 'astro/config';
import editorIntegration from './integraciones/editor';

export default defineConfig({
  // Dirección pública del sitio: la usan el canonical y la imagen para compartir. Cambiarla al conectar el dominio del cliente.
  site: 'https://minicms-6ej.pages.dev',
  integrations: [editorIntegration()],
});