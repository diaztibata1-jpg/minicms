# Informe mensual para el cliente

`plantilla-ejemplo.html` es el diseño del correo mensual con datos de ejemplo (Panadería La Espiga). Va con tablas y estilos en línea para que se vea bien en Gmail y Outlook; el mismo HTML se convierte en PDF y se adjunta.

Todavía no está conectado a datos. Cuando se construya, un Apps Script lo armará el día 1 de cada mes con:

| Sección | De dónde sale |
|---|---|
| Cómo te contactaron, de dónde llegaron, tus campañas, qué hicieron en tu página (visitas, tiempo, celular, los 7 eventos del sitio) | GA4 (servicio avanzado Analytics Data) |
| Qué pasó con los que llenaron el formulario | Columna Estado de la hoja de contactos |
| Llegan al final de la página, clics fallidos y errores | API de Clarity (solo da 3 días: se guarda un dato diario en la hoja) |
| Cómo te ven en Google | API de Search Console |
| Notas de Lighthouse | API de PageSpeed Insights (llave gratuita) |

Pendiente: logo y colores de nuestra marca (hoy hay un espacio reservado arriba y "[nuestra marca]" al pie).
