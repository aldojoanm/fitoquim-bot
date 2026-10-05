import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const RUTA_CONFIGURACION = fileURLToPath(new URL('../datos/fitoquim.json', import.meta.url));
const DIA_MS = 24 * 60 * 60 * 1000;
const CINCO_MINUTOS_MS = 5 * 60 * 1000;
let configuracion = cargarConfiguracion();
let ultimaModificacion = fs.statSync(RUTA_CONFIGURACION).mtimeMs;
const sesiones = new Map();
const usoPorUsuario = new Map();
const reservas = new WeakMap();

function cargarConfiguracion() {
  const datos = JSON.parse(fs.readFileSync(RUTA_CONFIGURACION, 'utf8'));
  if (!datos.empresa?.nombre || !datos.flujo?.inicio || !datos.contactos) {
    throw new Error('Configuración incompleta en datos/fitoquim.json');
  }
  for (const contacto of Object.values(datos.contactos)) {
    contacto.telefono = String(contacto.telefono || '').replace(/\s/g, '');
  }
  return datos;
}

function recargarConfiguracion() {
  try {
    const modificacion = fs.statSync(RUTA_CONFIGURACION).mtimeMs;
    if (modificacion === ultimaModificacion) return;
    configuracion = cargarConfiguracion();
    ultimaModificacion = modificacion;
    console.log('[FITOQUIM] Configuración recargada.');
  } catch {
    console.error('[FITOQUIM] No se pudo recargar datos/fitoquim.json.');
  }
}

function normalizar(texto = '') {
  return String(texto).toLowerCase().normalize('NFD')
    .replace(/\p{Diacritic}/gu, '').replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}

function coincidencias(texto, elementos) {
  const entrada = normalizar(texto);
  return elementos.filter((elemento) => (elemento.patrones || []).some((valor) => {
    const patron = normalizar(valor);
    return patron && (elemento.solo_exacto ? entrada === patron
      : (' ' + entrada + ' ').includes(' ' + patron + ' '));
  }));
}

function obtenerSesion(clave) {
  const ahora = Date.now();
  let sesion = sesiones.get(clave);
  if (!sesion || sesion.expiraEn <= ahora) {
    sesion = { nodoActual: 'inicio', expiraEn: ahora + DIA_MS };
    sesiones.set(clave, sesion);
  }
  sesion.expiraEn = ahora + DIA_MS;
  return sesion;
}

function construirNodo(id, sesion, textoAlternativo) {
  const nodo = configuracion.flujo[id];
  if (!nodo) return construirNodo('inicio', sesion);
  if (nodo.tipo === 'opciones') {
    sesion.nodoActual = id;
    return {
      tipo: 'opciones', nodoId: id, texto: textoAlternativo || nodo.texto,
      textoBotonLista: nodo.texto_boton_lista || 'Ver opciones',
      opciones: nodo.opciones.map((opcion) => ({
        id: opcion.id, etiqueta: opcion.etiqueta,
        etiquetaWhatsApp: opcion.etiqueta_whatsapp || opcion.etiqueta,
        descripcion: opcion.descripcion || '', payload: 'IR:' + opcion.destino,
      })),
    };
  }
  sesion.nodoActual = 'inicio';
  const contacto = configuracion.contactos[nodo.contacto_id];
  const telefonoDigitos = String(contacto?.telefono || '').replace(/\D/g, '');
  if (!contacto?.configurado || !telefonoDigitos) {
    return { tipo: 'texto', texto: 'El contacto de ' + (contacto?.nombre || 'esta opción') + ' todavía no está configurado. Escribí “menú” para volver al inicio.' };
  }
  return {
    tipo: 'contacto', contacto: {
      id: contacto.id, nombre: contacto.nombre, cargo: contacto.cargo || '',
      foto: contacto.foto || '',
      empresa: contacto.empresa || configuracion.empresa.nombre_legal,
      telefono: contacto.telefono, telefonoDigitos,
    },
  };
}

function responderFaq(faq) {
  const empresa = configuracion.empresa;
  let texto = '';
  if (faq.habilitada) {
    if (faq.tipo === 'horario' && empresa.horario?.habilitado) texto = empresa.horario.texto?.trim();
    if (faq.tipo === 'ubicacion' && empresa.ubicacion?.habilitado) {
      texto = [empresa.ubicacion.direccion, empresa.ubicacion.google_maps].filter(Boolean).join('\n');
    }
    if (faq.tipo === 'telefono') texto = empresa.telefono_general?.trim();
  }
  return { tipo: 'texto', texto: (texto || 'Esta información todavía no está configurada.') + '\n\nPodés continuar tu consulta o escribir “menú” para volver al inicio.' };
}

function prepararRespuesta(texto, sesion, esInicio) {
  if (esInicio) return construirNodo('inicio', sesion);
  const entrada = String(texto || '').trim();
  if (entrada.startsWith('IR:')) return construirNodo(entrada.slice(3), sesion);
  const faq = coincidencias(entrada, configuracion.preguntas_frecuentes || [])[0];
  if (faq) return responderFaq(faq);
  const globales = coincidencias(entrada, configuracion.interpretaciones || []);
  const opciones = (configuracion.flujo[sesion.nodoActual]?.opciones || []).map((opcion) => ({
    destino: opcion.destino, patrones: [opcion.etiqueta, ...(opcion.alias || [])],
  }));
  if (/^[1-9]$/.test(entrada) && opciones[Number(entrada) - 1]) {
    return construirNodo(opciones[Number(entrada) - 1].destino, sesion);
  }
  const locales = coincidencias(entrada, opciones);
  const especificas = globales.filter((regla) => !['saludo', 'menu', 'asesor_ambiguo'].includes(regla.id));
  const zonas = especificas.filter((regla) => regla.id.startsWith('zona_'));
  // Una zona concreta permite llegar directamente a su responsable.
  let candidatos = zonas.length ? zonas : [...especificas, ...locales];
  if (!candidatos.length) candidatos = globales;
  const destinos = [...new Set(candidatos.map((regla) => regla.destino))];
  if (destinos.length === 1) return construirNodo(destinos[0], sesion);
  if (destinos.length > 1) {
    if (destinos.includes('tecnico') && destinos.includes('comercial_zonas')) {
      return construirNodo('tipo_asesor', sesion);
    }
    return construirNodo('comercial_zonas', sesion, 'La consulta menciona varias opciones. Elegí la zona para continuar.');
  }
  return construirNodo(sesion.nodoActual, sesion, 'Elegí una de las opciones disponibles para continuar.');
}

function limpiarUso(registro, ahora) {
  registro.respuestas = registro.respuestas.filter((item) => ahora - item.momento < DIA_MS);
}

function responder({ canal = 'web', identificador, texto = '', esInicio = false }) {
  if (!identificador) throw new Error('Falta identificador de conversación.');
  recargarConfiguracion();
  if (!esInicio && configuracion.sin_respuesta.some((item) => normalizar(item) === normalizar(texto))) return null;
  const clave = canal + ':' + identificador;
  const ahora = Date.now();
  let registro = usoPorUsuario.get(clave);
  if (!registro) {
    registro = { respuestas: [], bloqueoHasta: 0 };
    usoPorUsuario.set(clave, registro);
  }
  if (registro.bloqueoHasta > ahora) return null;
  limpiarUso(registro, ahora);
  const limites = configuracion.limites[canal];
  const recientes = registro.respuestas.filter((item) => ahora - item.momento < CINCO_MINUTOS_MS);
  let bloqueoHasta = 0;
  if (registro.respuestas.length >= limites.respuestas_24_horas) {
    bloqueoHasta = registro.respuestas[registro.respuestas.length - limites.respuestas_24_horas].momento + DIA_MS;
  }
  if (recientes.length >= limites.respuestas_5_minutos) {
    bloqueoHasta = Math.max(bloqueoHasta, recientes[recientes.length - limites.respuestas_5_minutos].momento + CINCO_MINUTOS_MS);
  }
  const respuesta = bloqueoHasta ? {
    tipo: 'texto', avisoLimite: true,
    texto: 'Alcanzaste temporalmente el límite de consultas automáticas. Podés volver a intentarlo más tarde.',
  } : prepararRespuesta(texto, obtenerSesion(clave), esInicio);
  // Reservar una respuesta evita superar el límite con solicitudes simultáneas.
  const reserva = { momento: ahora };
  registro.respuestas.push(reserva);
  registro.bloqueoHasta = bloqueoHasta;
  reservas.set(respuesta, { clave, reserva });
  return respuesta;
}

// Los envíos rechazados por WhatsApp no cuentan como respuestas del bot.
export function cancelarRespuesta({ canal, identificador, respuesta }) {
  const reserva = reservas.get(respuesta);
  if (!reserva || reserva.clave !== canal + ':' + identificador) return;
  const registro = usoPorUsuario.get(reserva.clave);
  if (registro) {
    registro.respuestas = registro.respuestas.filter((item) => item !== reserva.reserva);
    if (respuesta.avisoLimite) registro.bloqueoHasta = 0;
  }
  reservas.delete(respuesta);
}

export function iniciarConversacion(parametros) {
  return responder({ ...parametros, esInicio: true });
}

export function procesarEntrada(parametros) {
  return responder(parametros);
}

setInterval(() => {
  const ahora = Date.now();
  for (const [clave, sesion] of sesiones) if (sesion.expiraEn <= ahora) sesiones.delete(clave);
  for (const [clave, registro] of usoPorUsuario) {
    limpiarUso(registro, ahora);
    if (!registro.respuestas.length && registro.bloqueoHasta <= ahora) usoPorUsuario.delete(clave);
  }
}, 15 * 60 * 1000).unref();
