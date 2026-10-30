-- Datos de ejemplo para probar en local. No se usan en producción.
UPDATE profesionales SET nombre = 'Andrés' WHERE id = 1;
INSERT INTO profesionales (id, nombre, orden) VALUES (2, 'Camilo', 2);

INSERT INTO servicios (nombre, duracion_min, precio, orden) VALUES
  ('Corte', 30, 25000, 1),
  ('Corte y barba', 60, 40000, 2),
  ('Barba', 30, 18000, 3);

-- Andrés: lunes a viernes 9:00-12:30 y 14:00-19:00, sábado 8:00-16:00.
INSERT INTO horario (profesional_id, dia_semana, abre, cierra) VALUES
  (1, 1, '09:00', '12:30'), (1, 1, '14:00', '19:00'),
  (1, 2, '09:00', '12:30'), (1, 2, '14:00', '19:00'),
  (1, 3, '09:00', '12:30'), (1, 3, '14:00', '19:00'),
  (1, 4, '09:00', '12:30'), (1, 4, '14:00', '19:00'),
  (1, 5, '09:00', '12:30'), (1, 5, '14:00', '19:00'),
  (1, 6, '08:00', '16:00');

-- Camilo: martes a sábado 11:00-20:00.
INSERT INTO horario (profesional_id, dia_semana, abre, cierra) VALUES
  (2, 2, '11:00', '20:00'), (2, 3, '11:00', '20:00'), (2, 4, '11:00', '20:00'),
  (2, 5, '11:00', '20:00'), (2, 6, '11:00', '20:00');
