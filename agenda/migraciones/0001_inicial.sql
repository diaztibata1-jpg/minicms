-- Las fechas y horas se guardan en hora de Bogotá como texto 'YYYY-MM-DD HH:MM'.
-- Colombia no tiene horario de verano, así que se comparan como texto.

CREATE TABLE servicios (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  duracion_min INTEGER NOT NULL CHECK (duracion_min BETWEEN 5 AND 480),
  precio INTEGER NOT NULL DEFAULT 0 CHECK (precio >= 0),
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  orden INTEGER NOT NULL DEFAULT 0
);

-- Varias filas por día permiten una pausa (por ejemplo, almuerzo).
CREATE TABLE horario (
  id INTEGER PRIMARY KEY,
  dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6), -- 0 = domingo
  abre TEXT NOT NULL,
  cierra TEXT NOT NULL,
  CHECK (abre < cierra)
);

CREATE TABLE bloqueos (
  id INTEGER PRIMARY KEY,
  inicio TEXT NOT NULL,
  fin TEXT NOT NULL,
  motivo TEXT NOT NULL DEFAULT '',
  CHECK (inicio < fin)
);

CREATE TABLE clientes (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  celular TEXT NOT NULL UNIQUE,
  notas TEXT NOT NULL DEFAULT ''
);

CREATE TABLE citas (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  servicio_id INTEGER REFERENCES servicios(id) ON DELETE SET NULL,
  inicio TEXT NOT NULL,
  fin TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'confirmada'
    CHECK (estado IN ('confirmada', 'atendida', 'no_asistio', 'cancelada')),
  notas TEXT NOT NULL DEFAULT '',
  creada_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizada_en TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (inicio < fin)
);

CREATE INDEX citas_por_inicio ON citas (inicio);
CREATE INDEX citas_por_cliente ON citas (cliente_id);
CREATE INDEX bloqueos_por_inicio ON bloqueos (inicio);

-- Bloqueo del login por IP tras varios intentos fallidos.
CREATE TABLE intentos_login (
  ip TEXT PRIMARY KEY,
  fallos INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta INTEGER NOT NULL DEFAULT 0
);
