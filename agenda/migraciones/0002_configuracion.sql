-- Valores internos: contraseña del panel (con hash), último aviso enviado, etc.
CREATE TABLE configuracion (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
