-- Hasta 3 profesionales por negocio (el límite lo pone la API con MAX_PROFESIONALES).
-- Solo el dueño entra al panel; los profesionales no tienen usuario.
CREATE TABLE profesionales (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  orden INTEGER NOT NULL DEFAULT 0
);

-- Lo que ya existía queda asignado al primer profesional.
INSERT INTO profesionales (id, nombre, orden) VALUES (1, 'Profesional 1', 1);

-- SQLite no permite agregar una columna con REFERENCES y valor por defecto distinto de NULL;
-- la API valida que el profesional exista.
ALTER TABLE citas ADD COLUMN profesional_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE horario ADD COLUMN profesional_id INTEGER NOT NULL DEFAULT 1;
-- NULL = bloqueo general (festivo, cierre del negocio).
ALTER TABLE bloqueos ADD COLUMN profesional_id INTEGER;

CREATE INDEX citas_por_profesional ON citas (profesional_id, inicio);
CREATE INDEX horario_por_profesional ON horario (profesional_id, dia_semana);
