import { z } from 'zod';

export function crearEsquemaPagina<T extends z.ZodType>(imagen: T) {
  const servicio = z.object({
    titulo: z.string().min(1, { error: 'El título del servicio no puede estar vacío.' }).max(60, { error: 'El título del servicio no puede superar los 60 caracteres.' }),
    descripcion: z.string().min(1, { error: 'La descripción no puede estar vacía.' }).max(160, { error: 'La descripción no puede superar los 160 caracteres.' }),
    imagen,
  }).strict();

  return z.object({
    negocio_nombre: z.string().min(1, { error: 'El nombre del negocio no puede estar vacío.' }).max(60, { error: 'El nombre no puede superar los 60 caracteres.' }),
    hero_titulo: z.string().min(1, { error: 'El título principal no puede estar vacío.' }).max(60, { error: 'El título principal no puede superar los 60 caracteres.' }),
    hero_texto: z.string().min(1, { error: 'El texto principal no puede estar vacío.' }).max(160, { error: 'El texto principal no puede superar los 160 caracteres.' }),
    hero_boton: z.string().min(1, { error: 'El texto del botón no puede estar vacío.' }).max(40, { error: 'El texto del botón no puede superar los 40 caracteres.' }),
    hero_imagen: imagen,
    servicios_titulo: z.string().min(1, { error: 'El título de servicios no puede estar vacío.' }).max(60, { error: 'El título de servicios no puede superar los 60 caracteres.' }),
    servicios: z.array(servicio).length(3, { error: 'Deben existir exactamente tres servicios.' }),
    contacto_titulo: z.string().min(1, { error: 'El título de contacto no puede estar vacío.' }).max(60, { error: 'El título de contacto no puede superar los 60 caracteres.' }),
    contacto_texto: z.string().min(1, { error: 'El texto de contacto no puede estar vacío.' }).max(160, { error: 'El texto de contacto no puede superar los 160 caracteres.' }),
    whatsapp: z.string().regex(/^573\d{9}$/, { error: 'WhatsApp debe ser un celular colombiano: 57 seguido de 10 dígitos que empiezan por 3.' }),
    direccion: z.string().min(1, { error: 'La dirección no puede estar vacía.' }).max(160, { error: 'La dirección no puede superar los 160 caracteres.' }),
    horario: z.string().min(1, { error: 'El horario no puede estar vacío.' }).max(120, { error: 'El horario no puede superar los 120 caracteres.' }),
    // Frase para Google y para la vista previa al compartir. No se edita desde el editor visual.
    seo_descripcion: z.string().min(50).max(155, { error: 'La descripción para buscadores no puede superar los 155 caracteres.' }),
    // Datos de la política de tratamiento de datos. No se editan desde el editor visual.
    legal: z.object({
      responsable: z.string().min(1).max(120),
      documento: z.string().min(1).max(40),
      correo: z.email().max(120),
      ciudad: z.string().min(1).max(60),
      // El editor reescribe el YAML sin comillas y Astro lo lee como fecha; se aceptan ambas formas.
      vigencia: z.union([z.date(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'La vigencia debe tener formato AAAA-MM-DD.' })]),
    }).strict(),
  }).strict();
}

export const limitesCampos = {
  negocio_nombre: 60,
  hero_titulo: 60,
  hero_texto: 160,
  hero_boton: 40,
  servicios_titulo: 60,
  'servicios.0.titulo': 60,
  'servicios.0.descripcion': 160,
  'servicios.1.titulo': 60,
  'servicios.1.descripcion': 160,
  'servicios.2.titulo': 60,
  'servicios.2.descripcion': 160,
  contacto_titulo: 60,
  contacto_texto: 160,
  whatsapp: 12,
  direccion: 160,
  horario: 120,
} as const;

export const camposImagen = [
  'hero_imagen',
  'servicios.0.imagen',
  'servicios.1.imagen',
  'servicios.2.imagen',
] as const;