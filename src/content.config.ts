import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { crearEsquemaPagina } from './esquema/contenido';

const paginas = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/paginas' }),
  schema: ({ image }) => crearEsquemaPagina(image()),
});

export const collections = { paginas };