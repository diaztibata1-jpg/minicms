# Agenda de citas

Prototipo de agenda para negocios de 1 a 3 profesionales (barbería, uñas, consultorio). El administrador atiende el WhatsApp a mano y registra las citas en el panel. La página pública solo muestra las horas libres y un botón para pedir la cita por WhatsApp. No envía recordatorios.

Corre en Cloudflare Workers con una base D1 (SQLite). En local todo funciona con Wrangler, sin cuenta de Cloudflare.

## Dónde vive en minicms

- Página pública: `public/agenda/` → `/agenda/`
- Panel: `public/agenda/admin/` → `/agenda/admin/`
- API: `functions/agenda/api/[[ruta]].js` (Pages Function) → `/agenda/api/*`, que usa el código de `agenda/src/`.
- Base: D1 `agenda`, enlazada en Cloudflare Pages > minicms > Settings > Bindings con el nombre `DB`.

- Contraseña del panel: secreto `AGENDA_PASSWORD` (12 caracteres o más) en Cloudflare Pages > minicms > Settings > Variables and secrets. Si falta, el panel responde "Falta configurar ADMIN_PASSWORD".
- `SIN_CONTRASENA = "1"` (solo en el código, para demos) deja el panel abierto; hoy no se usa.

## Correr en local

Necesitas Node 20 o superior. Desde esta carpeta:

```sh
npm install
cp .dev.vars.example .dev.vars      # y cambia ADMIN_PASSWORD (12 caracteres o más)
npm run migrar:local                # crea las tablas
npm run semilla:local               # servicios y horario de ejemplo (opcional)
npm run dev
```

- Página pública: http://localhost:8787/agenda/
- Panel: http://localhost:8787/agenda/admin/ (en local sí pide contraseña)

La base local queda en `.wrangler/state/`. Prueba rápida de la API (con `npm run dev` corriendo): `npm run prueba`.

## Qué hace

**Panel (/admin/)**, protegido con contraseña. La sesión dura 8 horas y una IP queda bloqueada 15 minutos tras 5 intentos fallidos.

- **Citas:** vista por día, en columnas por profesional (o filtrada por uno); crear, editar, borrar y cambiar estado (confirmada, atendida, no asistió, cancelada). Al escribir el celular, si el cliente ya existe completa el nombre. Sugiere las horas libres, pero deja poner otra hora: avisa si queda fuera del horario o encima de un bloqueo. Nunca deja cruzar dos citas del mismo profesional; dos profesionales sí pueden atender a la misma hora.
- **Clientes:** búsqueda por nombre o celular, historial, notas, y borrar al cliente con todo su historial (derecho de supresión, Ley 1581).
- **Servicios:** nombre, duración, precio, orden y si se ve en la página pública.
- **Equipo:** hasta 3 profesionales activos (`MAX_PROFESIONALES`). Solo el dueño entra al panel; los profesionales no tienen usuario. Un profesional con citas no se borra, se desactiva.
- **Horario:** por profesional; dos rangos en un día dejan la pausa del almuerzo.
- **Bloqueos:** para todo el negocio (festivos) o para un profesional (vacaciones, permisos).
- **Ajustes:** instalar el panel en el celular, cambiar la contraseña y descargar o restaurar un respaldo.

**App en el celular (PWA):** el panel se instala desde el navegador (Android: Chrome > Instalar app; iPhone: Safari > Compartir > Agregar a inicio). Sin internet abre igual y muestra los últimos datos vistos, pero no guarda cambios. Al pulsar Salir se borran esos datos del dispositivo.

**Contraseña:** la primera vez se entra con `ADMIN_PASSWORD`. Cuando el dueño la cambia en Ajustes, queda guardada con hash en la base y `ADMIN_PASSWORD` deja de servir. Si la olvida, se restablece a `ADMIN_PASSWORD` borrando la fila:
`npx wrangler d1 execute agenda --remote --command "DELETE FROM configuracion WHERE clave = 'admin_hash'"`

**Respaldos:** además del botón del panel, cada noche (3 a. m.) se guarda una copia en la carpeta "Respaldos agenda" del Drive del negocio, con los últimos 30 días. Cloudflare guarda aparte 7 días de historial de la base (Time Travel).

**Avisos de error:** si algo falla en el servidor o el respaldo nocturno no se guarda, llega un correo (máximo uno por hora por tipo de error). Los registros quedan también en Cloudflare > Workers > agenda > Logs.

**Página pública (/)**: servicio, con quién (o "cualquiera", que muestra una hora si algún profesional la tiene libre), día y hora libre; arma el mensaje de WhatsApp. Nunca muestra nombres ni celulares de clientes.

## Configuración (`wrangler.toml`)

| Variable | Para qué |
| --- | --- |
| `NEGOCIO` | Nombre que aparece en la página pública |
| `WHATSAPP` | Celular de 10 dígitos del botón de WhatsApp |
| `INTERVALO_MIN` | Cada cuántos minutos empieza un horario (30 por defecto) |
| `DIAS_VISIBLES` | Días hacia adelante que muestra la página pública (14 por defecto) |
| `MAX_PROFESIONALES` | Máximo de profesionales activos (3 por defecto) |
| `ADMIN_PASSWORD` | Secreto. Contraseña inicial del panel. En local va en `.dev.vars`; en producción con `wrangler secret put ADMIN_PASSWORD` |
| `GOOGLE_SCRIPT_URL`, `GOOGLE_SCRIPT_CLAVE` | Secretos, opcionales. Activan los avisos de error y el respaldo diario en Drive (ver abajo) |

## Base de datos

Las tablas están en `migraciones/`: `profesionales`, `servicios`, `horario`, `bloqueos`, `clientes`, `citas`, `intentos_login` y `configuracion` (contraseña con hash y control de avisos). Las horas se guardan en hora de Bogotá como texto `AAAA-MM-DD HH:MM` (Colombia no cambia de horario). Un cambio de estructura va en una migración nueva (`0002_….sql`), nunca editando la anterior.

## Avisos y respaldo en Google (opcional, recomendado)

1. Con la cuenta de Google del negocio, crea un proyecto en script.google.com y pega `integraciones/apps-script.gs`.
2. En Propiedades del script agrega `CLAVE` (texto largo al azar) y, si quieres, `AVISOS_PARA`.
3. Implementa como aplicación web (ejecutar como "Yo", acceso "Cualquier usuario") y copia la URL.
4. `npx wrangler secret put GOOGLE_SCRIPT_URL` y `npx wrangler secret put GOOGLE_SCRIPT_CLAVE` (el mismo texto de `CLAVE`).

En local se prueba el respaldo con `npx wrangler dev --test-scheduled` y abriendo http://localhost:8787/__scheduled

## Cambios en la base

Una migración nueva en `migraciones/` se aplica con `npm run migrar:remoto` (requiere `npx wrangler login`).
Sin cron en Pages: el respaldo nocturno a Drive no corre en esta versión; usa el botón de Ajustes (desactivado en la demo).

## Pendiente antes de un cliente real

- Probarlo en un celular real con el administrador.
- Política de datos del negocio (la página guarda nombre y celular de sus clientes).
