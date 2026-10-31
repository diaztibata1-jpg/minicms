// Corre agenda/apps-script/Codigo.gs en Node con una hoja de cálculo en memoria, para probarlo sin Google.
// Imita solo lo que usa el script: SpreadsheetApp, PropertiesService, CacheService, LockService, Utilities,
// ContentService, MailApp, Session y ScriptApp.
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const codigo = readFileSync(new URL('../apps-script/Codigo.gs', import.meta.url), 'utf8');

class HojaSimulada {
  constructor(nombre) {
    this.nombre = nombre;
    this.datos = [];
  }
  getDataRange() {
    return { getValues: () => this.datos.map((fila) => fila.slice()) };
  }
  getLastRow() {
    return this.datos.length;
  }
  getMaxRows() {
    return Math.max(this.datos.length, 1000);
  }
  getRange(fila, columna, filas, columnas) {
    const hoja = this;
    return {
      setNumberFormat() {
        return this;
      },
      setFontWeight() {
        return this;
      },
      setValues(valores) {
        valores.forEach((valoresFila, i) => {
          const indice = fila - 1 + i;
          while (hoja.datos.length <= indice) hoja.datos.push([]);
          valoresFila.forEach((valor, j) => (hoja.datos[indice][columna - 1 + j] = valor));
        });
        return this;
      },
    };
  }
  appendRow(valores) {
    this.datos.push(valores.slice());
  }
  deleteRow(numero) {
    this.datos.splice(numero - 1, 1);
  }
  setFrozenRows() {}
}

export function crearAgenda({ propiedades = {} } = {}) {
  const hojas = {};
  const cache = new Map();
  const correos = [];
  const disparadores = [];
  const libro = {
    getSheetByName: (nombre) => hojas[nombre] || null,
    insertSheet: (nombre) => (hojas[nombre] = new HojaSimulada(nombre)),
    setSpreadsheetTimeZone() {},
  };
  const encadenar = () =>
    new Proxy({}, { get: (_, clave) => (clave === 'create' ? () => disparadores.push(1) : () => encadenar()) });

  const contexto = vm.createContext({
    console,
    SpreadsheetApp: { getActive: () => libro },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (clave) => (clave in propiedades ? propiedades[clave] : null),
        setProperty: (clave, valor) => (propiedades[clave] = String(valor)),
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (clave) => (cache.has(clave) ? cache.get(clave) : null),
        put: (clave, valor) => cache.set(clave, String(valor)),
        remove: (clave) => cache.delete(clave),
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      // Apps Script devuelve bytes con signo (-128 a 127).
      computeHmacSha256Signature: (valor, clave) => [...createHmac('sha256', clave).update(valor).digest()].map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => randomUUID(),
      sleep() {},
      formatDate: (fecha) => fecha.toISOString(),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (contenido) => ({ contenido, setMimeType() { return this; } }),
    },
    MailApp: { sendEmail: (para, asunto, cuerpo) => correos.push({ para, asunto, cuerpo }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'dueno@example.com' }) },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => encadenar() },
  });
  vm.runInContext(codigo, contexto, { filename: 'Codigo.gs' });

  const leer = (salida) => JSON.parse(salida.contenido);
  return {
    hojas,
    correos,
    disparadores,
    propiedades,
    ejecutar: (funcion) => contexto[funcion](),
    get: (parametros) => leer(contexto.doGet({ parameter: parametros })),
    post: (peticion) => leer(contexto.doPost({ postData: { contents: JSON.stringify(peticion) } })),
  };
}
