import { defineConfig } from 'astro/config';
import editorIntegration from './integraciones/editor';

export default defineConfig({
  integrations: [editorIntegration()],
});