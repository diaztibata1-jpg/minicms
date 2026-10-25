# Contenedor de GTM para importar

`contenedor-ga4.json` trae:

- **GA4 - Etiqueta de Google**: carga GA4 con la variable `ID GA4`.
- **GA4 - Eventos del sitio**: reenvía a GA4 cualquier evento que el sitio mande con `medir()` (todos llevan `origen: 'sitio'`), con los parámetros `formulario`, `plan`, `servicio`, `ubicacion` y `seccion`. Un evento nuevo no exige tocar GTM; un parámetro nuevo sí (agregarlo a la tabla de la etiqueta).

Por cliente: importar (Administrador → Importar contenedor → Combinar → Reemplazar), cambiar la variable `ID GA4` y publicar. En el sitio, poner el ID del contenedor en `src/medicion/config.ts`.

El consentimiento lo maneja el sitio (modo de consentimiento de Google, denegado hasta que el visitante acepta).
