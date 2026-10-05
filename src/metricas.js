import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const RUTA_METRICAS = path.resolve(process.cwd(), 'metricas', 'eventos.jsonl');
const URL_APPS_SCRIPT = process.env.URL_APPS_SCRIPT_METRICAS || '';
const SECRETO_METRICAS = process.env.SECRETO_METRICAS || '';
const SAL_METRICAS = process.env.SAL_METRICAS || 'fitoquim-metricas';
const GUARDAR_IDENTIFICADOR_COMPLETO = ['1', 'true', 'si', 'sí', 'yes'].includes(
  String(process.env.GUARDAR_IDENTIFICADOR_COMPLETO || '').toLowerCase(),
);

function anonimizarIdentificador(identificador = '') {
  return crypto
    .createHash('sha256')
    .update(`${SAL_METRICAS}:${String(identificador)}`)
    .digest('hex')
    .slice(0, 24);
}

async function guardarLocal(evento) {
  await fs.mkdir(path.dirname(RUTA_METRICAS), { recursive: true });
  await fs.appendFile(RUTA_METRICAS, `${JSON.stringify(evento)}\n`, 'utf8');
}

async function enviarASheets(evento) {
  if (!URL_APPS_SCRIPT) return;

  const respuesta = await fetch(URL_APPS_SCRIPT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      secreto: SECRETO_METRICAS,
      ...evento,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!respuesta.ok) {
    const texto = await respuesta.text();
    throw new Error(`Apps Script ${respuesta.status}: ${texto}`);
  }
}

export async function registrarMetrica(datos = {}) {
  const identificador = String(datos.identificador || '');

  const evento = {
    fecha: new Date().toISOString(),
    canal: datos.canal || '',
    tipo: datos.tipo || '',
    area: datos.area || '',
    zona: datos.zona || '',
    subzona: datos.subzona || '',
    contacto: datos.contacto || '',
    faq: datos.faq || '',
    identificador_hash: identificador ? anonimizarIdentificador(identificador) : '',
    ...(GUARDAR_IDENTIFICADOR_COMPLETO && identificador
      ? { identificador }
      : {}),
  };

  const resultados = await Promise.allSettled([
    guardarLocal(evento),
    enviarASheets(evento),
  ]);

  const errores = resultados
    .filter((resultado) => resultado.status === 'rejected')
    .map((resultado) => resultado.reason?.message || String(resultado.reason));

  if (errores.length) {
    throw new Error(errores.join(' | '));
  }

  return evento;
}
