# Editor visual de contenido

Prueba de concepto de un sitio estático para Panadería La Espiga. El diseño está en componentes Astro y el contenido editable está en `src/content/paginas/inicio.md`.

## Abrir en Codespaces

1. En GitHub, abre el repositorio y elige **Code > Codespaces > Create codespace on main**.
2. Espera a que termine la preparación del contenedor. Instalará las dependencias con `npm install`.
3. En la terminal del Codespace, ejecuta:

   ```sh
   npm run editar
   ```

4. Abre el puerto 4321 cuando Codespaces muestre el aviso del servidor.

## Usar el editor

1. Haz clic sobre un texto de la página y escribe el nuevo contenido. El contador muestra el máximo permitido.
2. Para cambiar el número de WhatsApp, pulsa **WhatsApp** en la barra inferior y escribe el celular de 10 dígitos. Se actualizan todos los botones de WhatsApp del sitio.
3. Para cambiar una foto, pulsa **Cambiar imagen** sobre ella. Puedes seleccionar un archivo del computador o una miniatura de la biblioteca.
4. Pulsa **Guardar**. La página se recargará para mostrar el contenido guardado.
5. Cuando hayas terminado, pulsa **Enviar cambios**. El editor creará una rama y un pull request en GitHub.
6. Revisa el pull request en GitHub. Si pasa las comprobaciones y se cumplen las protecciones de `main`, se fusionará automáticamente.

El editor solo funciona con `npm run editar`. El sitio generado por `npm run build` no incluye sus controles ni sus rutas de edición.

## Configurar GitHub

- En **Settings > General > Pull Requests**, activa **Allow auto-merge**.
- En **Settings > Rules > Rulesets**, crea un ruleset para `main` con:
  - **Require a pull request before merging**, con 0 aprobaciones y **Require review from Code Owners** activado.
  - **Require status checks to pass**, con el check `validar-contenido`.
  - **Block force pushes**.
- Revisa que el usuario de `.github/CODEOWNERS` sea el del equipo. Los pull requests que solo cambian contenido se fusionan solos; los que tocan código, estilos o workflows necesitan la aprobación del equipo.
- Comprueba que GitHub CLI tenga acceso al repositorio desde el Codespace. El editor lo utiliza para crear el pull request.

## Importante sobre los workflows

Si la fusión automática usa el `GITHUB_TOKEN` predeterminado, el push que hace GitHub al fusionar no dispara otros workflows, por ejemplo uno de despliegue. Para que ese push pueda activar otros workflows, se necesita un token de GitHub App o un token personal con los permisos adecuados.

Esta prueba no incluye despliegue.
## Editor en línea (/editar)

El sitio publicado incluye el editor en `/editar` (no indexado). Funciona sin Codespaces: las imágenes se reducen en el navegador y la API de `functions/api/editor/` crea la rama y el pull request con la API de GitHub. El flujo de validación, fusión y despliegue es el mismo.

Configuración (una vez por sitio):

1. **Token de GitHub:** fine-grained, solo para este repositorio, con **Contents** y **Pull requests** en *Read and write*. No necesita más permisos.
2. **Contraseña del editor:** una por sitio, de 12 caracteres o más (mejor generada por un gestor de contraseñas). Al entrar a `/editar` se pide la contraseña y la sesión dura 8 horas. Cambiar la contraseña o el token cierra todas las sesiones.
3. **Variables del proyecto en Cloudflare Pages** (Settings > Variables and secrets, entorno Production): `EDITOR_GITHUB_TOKEN` y `EDITOR_PASSWORD`, las dos como secreto. Opcional: `GITHUB_REPO` (por defecto `diaztibata1-jpg/minicms`).
4. **Bloqueo de intentos (opcional, recomendado):** crea un namespace KV (Storage & databases > KV) y enlázalo al proyecto en Settings > Bindings con el nombre `EDITOR_KV`. Con él, una IP queda bloqueada 15 minutos tras 5 contraseñas incorrectas. Sin él, cada intento fallido solo espera un segundo.

5. **"No soy un robot" (opcional, recomendado):** en Cloudflare > Turnstile crea un widget para el dominio del sitio (modo *Managed*) y agrega `TURNSTILE_SITE_KEY` (texto) y `TURNSTILE_SECRET` (secreto). Sin ellas, el login funciona sin Turnstile.
6. **Avisos por correo (opcional):** pega `integraciones/avisos-apps-script.gs` en un proyecto de script.google.com y sigue las instrucciones del archivo. Luego agrega `AVISOS_URL` (la URL del web app) y `AVISOS_CLAVE` (el mismo texto de la propiedad `CLAVE`), las dos como secreto. Llega un correo a ese Gmail cuando alguien entra al editor, cuando envía cambios y cuando una IP queda bloqueada.

Las variables nuevas aplican desde el siguiente despliegue.

Si falta alguna variable o la contraseña es corta, `/editar` muestra que el editor no está configurado y la API no publica nada.

## Formulario de contacto (Google Sheets)

El formulario de la sección de contacto envía a `functions/api/contacto.js`, que valida los datos y los reenvía a un Apps Script de la hoja del cliente. La hoja guarda Fecha, Nombre, Teléfono, Correo y Estado (desplegable: Nuevo, Contactado, Cotizado, Cliente, No interesado). Cada hora, entre 7 a. m. y 9 p. m., el script manda un solo correo con los contactos nuevos, si los hay.

Protecciones: campo trampa contra bots, autorización de datos obligatoria, validación en el servidor, máximo 5 envíos por hora por IP (si el KV `EDITOR_KV` está enlazado) y los textos que empiezan como fórmula se guardan como texto.

Configuración (una vez por sitio):

1. En la hoja del cliente: **Extensiones > Apps Script**, pega `integraciones/formulario-apps-script.gs`.
2. **Configuración del proyecto > Propiedades del script:** `CLAVE` (texto largo al azar) y `AVISOS_PARA` (correo o correos, separados por coma).
3. Elige la función `configurar` y dale **Ejecutar**. Autoriza los permisos (en "Google no ha verificado esta app": Configuración avanzada > Ir a … > Permitir).
4. **Implementar > Nueva implementación > Aplicación web:** ejecutar como "Yo", acceso "Cualquier usuario". Copia la URL.
5. En Cloudflare Pages agrega como secretos `FORMULARIO_URL` (la URL) y `FORMULARIO_CLAVE` (el mismo texto de `CLAVE`) y vuelve a desplegar.
