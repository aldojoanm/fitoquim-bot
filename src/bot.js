import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUTA_CONFIGURACION = path.resolve(__dirname, '..', 'datos', 'fitoquim.json');

let configuracion = cargarConfiguracion();
let ultimaModificacionConfiguracion = obtenerMtime(RUTA_CONFIGURACION);

const sesiones = new Map();
const usoPorUsuario = new Map();

const DURACION_SESION_MS = 24 * 60 * 60 * 1000;
const CINCO_MINUTOS_MS = 5 * 60 * 1000;
const VEINTICUATRO_HORAS_MS = 24 * 60 * 60 * 1000;

function obtenerMtime(ruta) {
  try {
    return fs.statSync(ruta).mtimeMs;
  } catch {
    return 0;
  }
}

function cargarConfiguracion() {
  const contenido = fs.readFileSync(RUTA_CONFIGURACION, 'utf8');
  const datos = JSON.parse(contenido);

  if (!datos?.empresa?.nombre) {
    throw new Error('Falta empresa.nombre en datos/fitoquim.json');
  }

  if (!datos?.flujo?.inicio) {
    throw new Error('Falta flujo.inicio en datos/fitoquim.json');
  }

  if (!datos?.contactos || typeof datos.contactos !== 'object') {
    throw new Error('Falta el bloque contactos en datos/fitoquim.json');
  }

  return datos;
}

function recargarConfiguracionSiCambio() {
  const mtime = obtenerMtime(RUTA_CONFIGURACION);
  if (!mtime || mtime === ultimaModificacionConfiguracion) return;

  try {
    const siguiente = cargarConfiguracion();
    configuracion = siguiente;
    ultimaModificacionConfiguracion = mtime;
    console.log('[FITOQUIM] Configuración recargada.');
  } catch (error) {
    console.error('[FITOQUIM] No se pudo recargar la configuración:', error?.message || error);
  }
}

setInterval(recargarConfiguracionSiCambio, 60_000).unref?.();

function normalizar(texto = '') {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function distanciaLevenshtein(a = '', b = '') {
  const x = String(a);
  const y = String(b);

  if (x === y) return 0;
  if (!x.length) return y.length;
  if (!y.length) return x.length;

  const anterior = Array.from({ length: y.length + 1 }, (_, i) => i);
  const actual = new Array(y.length + 1);

  for (let i = 1; i <= x.length; i += 1) {
    actual[0] = i;

    for (let j = 1; j <= y.length; j += 1) {
      const costo = x[i - 1] === y[j - 1] ? 0 : 1;
      actual[j] = Math.min(
        actual[j - 1] + 1,
        anterior[j] + 1,
        anterior[j - 1] + costo,
      );
    }

    for (let j = 0; j <= y.length; j += 1) anterior[j] = actual[j];
  }

  return anterior[y.length];
}

function puntuarCoincidencia(textoNormalizado, patronOriginal) {
  const patron = normalizar(patronOriginal);
  if (!textoNormalizado || !patron) return 0;

  if (textoNormalizado === patron) return 100;

  if (textoNormalizado.includes(patron)) {
    return Math.min(96, 84 + Math.min(12, patron.length / 4));
  }

  if (patron.includes(textoNormalizado) && textoNormalizado.length >= 4) {
    return 75;
  }

  if (textoNormalizado.length >= 5 && patron.length >= 5) {
    const diferenciaLongitud = Math.abs(textoNormalizado.length - patron.length);
    if (diferenciaLongitud <= 2) {
      const distancia = distanciaLevenshtein(textoNormalizado, patron);
      if (distancia === 1) return 72;
      if (distancia === 2 && Math.max(textoNormalizado.length, patron.length) >= 9) return 64;
    }
  }

  return 0;
}

function obtenerMejorCoincidencia(texto, elementos = []) {
  const textoNormalizado = normalizar(texto);
  let mejor = null;

  for (const elemento of elementos) {
    const prioridad = Number(elemento?.prioridad ?? 0);
    const patrones = Array.isArray(elemento?.patrones)
      ? elemento.patrones
      : Array.isArray(elemento?.alias)
        ? elemento.alias
        : [];

    let mejorPuntajePatron = 0;

    for (const patron of patrones) {
      mejorPuntajePatron = Math.max(
        mejorPuntajePatron,
        puntuarCoincidencia(textoNormalizado, patron),
      );
    }

    if (mejorPuntajePatron <= 0) continue;

    const puntajeTotal = prioridad * 1000 + mejorPuntajePatron;
    if (!mejor || puntajeTotal > mejor.puntajeTotal) {
      mejor = { elemento, puntajeTotal, puntajePatron: mejorPuntajePatron };
    }
  }

  return mejor;
}

function obtenerSesion(identificador) {
  const ahora = Date.now();
  let sesion = sesiones.get(identificador);

  if (!sesion || sesion.expiraEn <= ahora) {
    sesion = {
      nodoActual: 'inicio',
      creadaEn: ahora,
      ultimaActividad: ahora,
      expiraEn: ahora + DURACION_SESION_MS,
    };
    sesiones.set(identificador, sesion);
  }

  sesion.ultimaActividad = ahora;
  sesion.expiraEn = ahora + DURACION_SESION_MS;
  return sesion;
}

function limpiarSesiones() {
  const ahora = Date.now();
  for (const [id, sesion] of sesiones.entries()) {
    if ((sesion?.expiraEn || 0) <= ahora) sesiones.delete(id);
  }
}

setInterval(limpiarSesiones, 15 * 60 * 1000).unref?.();

function obtenerLimites(canal) {
  const base = configuracion?.limites?.[canal] || configuracion?.limites?.whatsapp || {};
  return {
    maximo24h: Number(base.respuestas_24_horas || 15),
    maximo5m: Number(base.respuestas_5_minutos || 6),
  };
}

function obtenerRegistroUso(clave) {
  let registro = usoPorUsuario.get(clave);

  if (!registro) {
    registro = {
      respuestas: [],
      avisoLimiteHasta: 0,
    };
    usoPorUsuario.set(clave, registro);
  }

  return registro;
}

function limpiarUso(registro, ahora) {
  registro.respuestas = registro.respuestas.filter(
    (momento) => ahora - momento < VEINTICUATRO_HORAS_MS,
  );

  if (registro.avisoLimiteHasta && registro.avisoLimiteHasta <= ahora) {
    registro.avisoLimiteHasta = 0;
  }
}

function aplicarLimite(canal, identificador, respuesta) {
  if (!respuesta) return null;

  const ahora = Date.now();
  const clave = `${canal}:${identificador}`;
  const registro = obtenerRegistroUso(clave);
  limpiarUso(registro, ahora);

  const { maximo24h, maximo5m } = obtenerLimites(canal);
  const ultimos5m = registro.respuestas.filter(
    (momento) => ahora - momento < CINCO_MINUTOS_MS,
  ).length;

  const bloqueo24h = registro.respuestas.length >= maximo24h;
  const bloqueo5m = ultimos5m >= maximo5m;

  if (bloqueo24h || bloqueo5m) {
    const ventanaBloqueo = bloqueo24h ? VEINTICUATRO_HORAS_MS : CINCO_MINUTOS_MS;

    if (registro.avisoLimiteHasta > ahora) {
      return null;
    }

    registro.avisoLimiteHasta = ahora + ventanaBloqueo;
    registro.respuestas.push(ahora);

    return {
      tipo: 'texto',
      texto:
        'Alcanzaste temporalmente el límite de consultas automáticas. Podés volver a intentarlo más tarde.',
      avisoLimite: true,
    };
  }

  registro.respuestas.push(ahora);
  return respuesta;
}

function esMensajeSilencioso(texto) {
  const normalizado = normalizar(texto);
  if (!normalizado) return false;

  return (configuracion?.sin_respuesta || []).some(
    (item) => normalizar(item) === normalizado,
  );
}

function obtenerNodo(id) {
  return configuracion?.flujo?.[id] || null;
}

function obtenerContacto(id) {
  return configuracion?.contactos?.[id] || null;
}

function telefonoSoloDigitos(telefono = '') {
  return String(telefono || '').replace(/\D/g, '');
}

function construirRespuestaNodo(nodoId, sesion, textoAlternativo = null) {
  const nodo = obtenerNodo(nodoId);

  if (!nodo) {
    sesion.nodoActual = 'inicio';
    return construirRespuestaNodo(
      'inicio',
      sesion,
      'No pude continuar con esa opción. Elegí una alternativa del menú principal.',
    );
  }

  if (nodo.tipo === 'opciones') {
    sesion.nodoActual = nodoId;

    return {
      tipo: 'opciones',
      nodoId,
      texto: textoAlternativo || nodo.texto || 'Seleccione una opción:',
      presentacionWhatsApp: nodo.presentacion_whatsapp || 'botones',
      textoBotonLista: nodo.texto_boton_lista || 'Ver opciones',
      opciones: (nodo.opciones || []).map((opcion) => ({
        id: opcion.id,
        etiqueta: opcion.etiqueta,
        descripcion: opcion.descripcion || '',
        destino: opcion.destino,
        payload: `IR:${opcion.destino}`,
      })),
    };
  }

  if (nodo.tipo === 'contacto') {
    const contacto = obtenerContacto(nodo.contacto_id);
    sesion.nodoActual = 'inicio';

    if (!contacto || !contacto.configurado || !telefonoSoloDigitos(contacto.telefono)) {
      return {
        tipo: 'texto',
        texto:
          'El contacto para esta opción todavía no está configurado. Escribí “menú” para volver al inicio.',
        errorConfiguracion: true,
        metrica: {
          tipo: 'contacto_no_configurado',
          contacto: contacto?.nombre || nodo.contacto_id || '',
          ...(nodo.metrica || {}),
        },
      };
    }

    return {
      tipo: 'contacto',
      contacto: {
        id: contacto.id,
        nombre: contacto.nombre,
        cargo: contacto.cargo || '',
        empresa: contacto.empresa || configuracion.empresa.nombre_legal || configuracion.empresa.nombre,
        telefono: contacto.telefono,
        telefonoDigitos: telefonoSoloDigitos(contacto.telefono),
      },
      metrica: {
        tipo: 'derivacion',
        contacto: contacto.nombre,
        ...(nodo.metrica || {}),
      },
    };
  }

  sesion.nodoActual = 'inicio';
  return construirRespuestaNodo('inicio', sesion);
}

function resolverOpcionEstadoActual(texto, sesion) {
  const nodo = obtenerNodo(sesion.nodoActual);
  if (!nodo || nodo.tipo !== 'opciones') return null;

  const candidatos = (nodo.opciones || []).map((opcion) => ({
    ...opcion,
    prioridad: 100,
    patrones: [opcion.etiqueta, ...(opcion.alias || [])],
  }));

  const coincidencia = obtenerMejorCoincidencia(texto, candidatos);
  if (!coincidencia || coincidencia.puntajePatron < 64) return null;

  return coincidencia.elemento?.destino || null;
}

function resolverFaq(texto) {
  const habilitadas = (configuracion?.preguntas_frecuentes || []).filter(
    (faq) => faq?.habilitada,
  );

  const coincidencia = obtenerMejorCoincidencia(texto, habilitadas);
  if (!coincidencia || coincidencia.puntajePatron < 64) return null;

  return coincidencia.elemento;
}

function construirRespuestaFaq(faq) {
  if (!faq) return null;

  if (faq.tipo === 'horario') {
    const texto = configuracion?.empresa?.horario?.texto?.trim();
    if (!texto) return null;

    return {
      tipo: 'texto',
      texto: `Horario de atención: ${texto}\n\nEscribí “menú” para volver al inicio.`,
      metrica: {
        tipo: 'faq',
        area: 'Información',
        zona: '',
        subzona: '',
        contacto: '',
        faq: 'Horario',
      },
    };
  }

  if (faq.tipo === 'ubicacion') {
    const direccion = configuracion?.empresa?.ubicacion?.direccion?.trim();
    const maps = configuracion?.empresa?.ubicacion?.google_maps?.trim();

    if (!direccion && !maps) return null;

    const partes = ['Ubicación de FITOQUIM:'];
    if (direccion) partes.push(direccion);
    if (maps) partes.push(maps);
    partes.push('', 'Escribí “menú” para volver al inicio.');

    return {
      tipo: 'texto',
      texto: partes.join('\n'),
      metrica: {
        tipo: 'faq',
        area: 'Información',
        zona: '',
        subzona: '',
        contacto: '',
        faq: 'Ubicación',
      },
    };
  }

  return null;
}

function resolverInterpretacionGlobal(texto) {
  const coincidencia = obtenerMejorCoincidencia(
    texto,
    configuracion?.interpretaciones || [],
  );

  if (!coincidencia || coincidencia.puntajePatron < 64) return null;
  return coincidencia.elemento?.destino || null;
}

function resolverAccionDirecta(texto) {
  const valor = String(texto || '').trim();
  if (!valor.startsWith('IR:')) return null;

  const destino = valor.slice(3).trim();
  return obtenerNodo(destino) ? destino : null;
}

function prepararRespuesta({ canal, identificador, texto, esInicio = false }) {
  recargarConfiguracionSiCambio();

  const sesion = obtenerSesion(identificador);

  if (esInicio) {
    sesion.nodoActual = 'inicio';
    return construirRespuestaNodo('inicio', sesion);
  }

  const entrada = String(texto || '').trim();

  if (!entrada) {
    return construirRespuestaNodo(
      sesion.nodoActual || 'inicio',
      sesion,
      'Elegí una de las opciones disponibles para continuar.',
    );
  }

  if (esMensajeSilencioso(entrada)) return null;

  const accionDirecta = resolverAccionDirecta(entrada);
  if (accionDirecta) {
    return construirRespuestaNodo(accionDirecta, sesion);
  }

  const faq = resolverFaq(entrada);
  const respuestaFaq = construirRespuestaFaq(faq);
  if (respuestaFaq) return respuestaFaq;

  const destinoEstadoActual = resolverOpcionEstadoActual(entrada, sesion);
  if (destinoEstadoActual) {
    return construirRespuestaNodo(destinoEstadoActual, sesion);
  }

  const destinoGlobal = resolverInterpretacionGlobal(entrada);
  if (destinoGlobal) {
    return construirRespuestaNodo(destinoGlobal, sesion);
  }

  const nodoActual = obtenerNodo(sesion.nodoActual);
  if (nodoActual?.tipo === 'opciones') {
    return construirRespuestaNodo(
      sesion.nodoActual,
      sesion,
      'No pude identificar esa opción. Elegí una alternativa para continuar.',
    );
  }

  return construirRespuestaNodo(
    'inicio',
    sesion,
    'No pude identificar la consulta. Elegí una opción del menú.',
  );
}

export function iniciarConversacion({ canal = 'web', identificador }) {
  if (!identificador) throw new Error('Falta identificador para iniciar la conversación.');

  const respuesta = prepararRespuesta({
    canal,
    identificador,
    texto: '',
    esInicio: true,
  });

  return aplicarLimite(canal, identificador, respuesta);
}

export function procesarEntrada({ canal = 'web', identificador, texto }) {
  if (!identificador) throw new Error('Falta identificador para procesar la entrada.');

  const respuesta = prepararRespuesta({
    canal,
    identificador,
    texto,
    esInicio: false,
  });

  return aplicarLimite(canal, identificador, respuesta);
}

export function obtenerResumenBot() {
  recargarConfiguracionSiCambio();

  return {
    empresa: configuracion?.empresa?.nombre || 'FITOQUIM',
    contactos: Object.keys(configuracion?.contactos || {}).length,
    nodos: Object.keys(configuracion?.flujo || {}).length,
    sesionesActivas: sesiones.size,
    usuariosControlados: usoPorUsuario.size,
  };
}
