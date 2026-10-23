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
2. Para cambiar una foto, pulsa **Cambiar imagen** sobre ella. Puedes seleccionar un archivo del computador o una miniatura de la biblioteca.
3. Pulsa **Guardar**. La página se recargará para mostrar el contenido guardado.
4. Cuando hayas terminado, pulsa **Enviar cambios**. El editor creará una rama y un pull request en GitHub.
5. Revisa el pull request en GitHub. Si pasa las comprobaciones y se cumplen las protecciones de `main`, se fusionará automáticamente.

El editor solo funciona con `npm run editar`. El sitio generado por `npm run build` no incluye sus controles ni sus rutas de edición.

## Configurar GitHub

- En **Settings > General > Pull Requests**, activa **Allow auto-merge**.
- Protege la rama `main` y exige el check `validar-contenido` antes de fusionar.
- Comprueba que GitHub CLI tenga acceso al repositorio desde el Codespace. El editor lo utiliza para crear el pull request.

## Importante sobre los workflows

Si la fusión automática usa el `GITHUB_TOKEN` predeterminado, el push que hace GitHub al fusionar no dispara otros workflows, por ejemplo uno de despliegue. Para que ese push pueda activar otros workflows, se necesita un token de GitHub App o un token personal con los permisos adecuados.

Esta prueba no incluye despliegue.