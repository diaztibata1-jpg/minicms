# Agenda, versión Google Sheets

Es la misma agenda, pero los datos viven en una hoja de cálculo de Google del negocio y el servidor es un Apps Script, no Cloudflare. Las páginas están en `public/agenda-sheets/` (pública) y `public/agenda-sheets/admin/` (panel), y usan el mismo código que la versión Cloudflare (`public/agenda/`).

Qué cambia frente a la versión Cloudflare:

- **Datos:** una pestaña por tabla en la hoja del negocio. Se pueden ver y descargar en Excel. Para cambiarlos usa el panel: si se editan a mano, pueden quedar citas cruzadas.
- **Velocidad:** cada acción tarda de 1 a 3 segundos.
- **Reserva desde la página:** un cliente que ya está en la pestaña `clientes` agenda solo, con su celular. Si la hora sigue libre, la cita queda confirmada de una vez. Un número desconocido recibe "escríbenos por WhatsApp". Cada cliente puede tener una sola cita pendiente hecha desde la página. El celular no es una clave: quien conozca el número de un cliente puede agendar a su nombre.
- **Resumen diario:** cada día, cerca de las 7 p. m., le llega al dueño un correo con las citas de mañana. Si no hay citas, no llega nada.
- **Ingreso:** Google no entrega la IP de quien entra. Por eso, tras 10 intentos fallidos en 15 minutos, el ingreso se bloquea 15 minutos para todos. La sesión dura 6 horas desde el último uso.
- **Respaldo:** la hoja misma. Google guarda su historial de versiones.
- **Sin internet:** no hay copia sin conexión, ni app instalable propia.

## Instalar

Con la cuenta de Google del negocio (para probar, la de pruebas):

1. Crea una hoja de cálculo nueva, por ejemplo "Agenda".
2. Abre **Extensiones > Apps Script**. Borra lo que trae `Código.gs` y pega todo `Codigo.gs`.
3. En **Configuración del proyecto** (el engranaje), marca "Mostrar el archivo de manifiesto appsscript.json en el editor". Vuelve al editor y reemplaza el contenido de `appsscript.json` por el de este repositorio.
4. En **Configuración del proyecto > Propiedades del script**, agrega:
   - `AGENDA_PASSWORD`: la contraseña del panel, de 12 caracteres o más.
   - `AVISOS_PARA` (opcional): el correo que recibe el resumen diario y los avisos de error. Si no lo pones, se usa el de la cuenta.
5. En el editor, elige la función `cargarEjemplo` (prueba con datos de ejemplo) o `instalar` (cliente real, hoja vacía) y pulsa **Ejecutar**. Google pide permisos: Revisar permisos > tu cuenta > Configuración avanzada > Ir a (no seguro) > Permitir. Así se crean las pestañas y el aviso diario.
6. **Implementar > Nueva implementación**. En el tipo, elige **Aplicación web**. Ejecutar como **Yo**, quién tiene acceso: **Cualquier usuario**. Copia la URL, que termina en `/exec`.
7. Pon esa URL en el `<meta name="agenda-apps-script">` de `public/agenda-sheets/index.html` y de `public/agenda-sheets/admin/index.html`, y despliega.

En la pestaña `configuracion` se cambian el nombre del negocio, el WhatsApp, cada cuántos minutos empieza un horario, cuántos días se muestran y el máximo de profesionales.

**Al cambiar el código del script:** ve a **Implementar > Administrar implementaciones > Editar (lápiz) > Versión: nueva versión > Implementar**. Así la URL sigue siendo la misma. Una "Nueva implementación" crea otra URL.

**Si el dueño olvida la contraseña:** en Propiedades del script borra `ADMIN_HASH`. Vuelve a servir `AGENDA_PASSWORD`.

## Probar en local

Desde `agenda/`:

- `npm run prueba:sheets` corre las mismas pruebas de la versión Cloudflare, más las de la reserva, el resumen diario y el bloqueo, contra una hoja simulada en memoria.
- `node pruebas/servidor-sheets.mjs` abre http://localhost:8791/agenda-sheets/ con la hoja simulada y datos de ejemplo. La contraseña es `clave-de-prueba-larga`.

La simulación no reproduce los límites de Google, los tiempos de respuesta ni la redirección de `/exec` a `googleusercontent.com`. Eso se prueba con el script real.
