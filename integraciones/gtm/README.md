# Contenedor de GTM para importar

`contenedor-ga4.json` trae:

- **GA4 - Etiqueta de Google**: carga GA4 con la variable `ID GA4`.
- **GA4 - Eventos del sitio**: reenvía a GA4 cualquier evento que el sitio mande con `medir()` (todos llevan `origen: 'sitio'`), con los parámetros `formulario`, `plan`, `servicio`, `ubicacion` y `seccion`. Un evento nuevo no exige tocar GTM; un parámetro nuevo sí (agregarlo a la tabla de la etiqueta).

`contenedor-clarity.json` trae la etiqueta **Clarity** (variable `ID Clarity`). Solo se activa con el consentimiento de medición (`analytics_storage`), es decir, cuando el visitante acepta las cookies.

Por cliente: importar (Administrador → Importar contenedor → Combinar → Reemplazar), importar los dos archivos, cambiar las variables `ID GA4` e `ID Clarity` y publicar. En el sitio, poner el ID del contenedor en `src/medicion/config.ts`.

El consentimiento lo maneja el sitio (modo de consentimiento de Google, denegado hasta que el visitante acepta).
