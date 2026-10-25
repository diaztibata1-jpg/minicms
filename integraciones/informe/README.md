# Informe mensual para el cliente

`plantilla-ejemplo.html` es el diseño del correo mensual con datos de ejemplo (Panadería La Espiga). Va con tablas y estilos en línea para que se vea bien en Gmail y Outlook; el mismo HTML se convierte en PDF y se adjunta.

`informe-apps-script.gs` (con su manifiesto `appsscript.json`) lo arma con datos reales y lo manda el día 1 de cada mes con el mes anterior. Los pasos de instalación están al inicio del archivo. Toma los datos de:

| Sección | De dónde sale |
|---|---|
| Cómo te contactaron, de dónde llegaron, tus campañas, qué hicieron en tu página (visitas, tiempo, celular, los 7 eventos del sitio) | GA4 (servicio avanzado Analytics Data) |
| Qué pasó con los que llenaron el formulario | Columna Estado de la hoja de contactos |
| Hasta dónde bajan en promedio, clics fallidos y errores | API de Clarity (solo da 3 días: se guarda un dato diario en la hoja) |
| Cómo te ven en Google | API de Search Console |
| Notas de Lighthouse | API de PageSpeed Insights (llave gratuita) |

Pendiente: logo y colores de nuestra marca (hoy hay un espacio reservado arriba y "[nuestra marca]" al pie).

Notas:
- Va en una hoja de cálculo de la cuenta dueña de GA4 y Search Console; la pestaña Clarity guarda un dato por día.
- Si una fuente falla, el informe sale sin esa sección y la falla llega aparte al correo de quien instaló el script.
- Clarity no da "cuántos llegan al final", solo el porcentaje promedio de scroll; por eso el informe dice "Hasta dónde bajan en promedio".
- Los botones "Abrir" solo le sirven al cliente si le damos acceso de lectura a GA4, Search Console y Clarity al entregar.
