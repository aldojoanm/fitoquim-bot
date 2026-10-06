import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUTA_CONFIGURACION = fileURLToPath(
  new URL('../datos/fitoquim.json', import.meta.url),
);

const RUTA_PUBLICA = fileURLToPath(
  new URL('../public', import.meta.url),
);

const DIA_MS = 24 * 60 * 60 * 1000;
const CINCO_MINUTOS_MS = 5 * 60 * 1000;
const MAX_SESIONES = 5000;
let proximaRevisionConfiguracion = 0;

let configuracion = cargarConfiguracion();
let ultimaModificacion = fs.statSync(RUTA_CONFIGURACION).mtimeMs;

const sesiones = new Map();
const usoPorUsuario = new Map();
const reservas = new WeakMap();

function cargarConfiguracion() {
  const datos = JSON.parse(
    fs.readFileSync(RUTA_CONFIGURACION, 'utf8'),
  );

  if (
    !datos.empresa?.nombre ||
    !datos.flujo?.inicio ||
    !datos.contactos
  ) {
    throw new Error(
      'Configuración incompleta en datos/fitoquim.json',
    );
  }

  for (const contacto of Object.values(datos.contactos)) {
    contacto.telefono = String(
      contacto.telefono || '',
    ).replace(/\s/g, '');
  }

  return datos;
}

function recargarConfiguracion() {
  const ahora = Date.now();
  if (ahora < proximaRevisionConfiguracion) return;
  proximaRevisionConfiguracion = ahora + 1000;

  try {
    const modificacion = fs.statSync(RUTA_CONFIGURACION).mtimeMs;

    if (modificacion === ultimaModificacion) {
      return;
    }

    configuracion = cargarConfiguracion();
    ultimaModificacion = modificacion;

    console.log('[FITOQUIM] Configuración recargada.');
  } catch (error) {
    console.error(
      '[FITOQUIM] No se pudo recargar datos/fitoquim.json:',
      error?.message || error,
    );
  }
}

function normalizar(texto = '') {
  return String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function coincidencias(texto, elementos = []) {
  const entrada = normalizar(texto);

  return elementos
    .filter((elemento) =>
      (elemento.patrones || []).some((valor) => {
        const patron = normalizar(valor);

        if (!patron) {
          return false;
        }

        if (elemento.solo_exacto) {
          return entrada === patron;
        }

        return (` ${entrada} `).includes(` ${patron} `);
      }),
    )
    .sort(
      (a, b) =>
        Number(b.prioridad || 0) -
        Number(a.prioridad || 0),
    );
}

function crearSesion() {
  const ahora = Date.now();

  return {
    nodoActual: 'inicio',
    iniciada: false,
    expiraEn: ahora + DIA_MS,
  };
}

function obtenerSesion(clave) {
  const ahora = Date.now();
  let sesion = sesiones.get(clave);

  if (!sesion || sesion.expiraEn <= ahora) {
    if (!sesion && sesiones.size >= MAX_SESIONES) {
      const antigua = sesiones.keys().next().value;
      sesiones.delete(antigua);
      usoPorUsuario.delete(antigua);
    }
    sesion = crearSesion();
  }

  sesiones.delete(clave);
  sesiones.set(clave, sesion);
  sesion.expiraEn = ahora + DIA_MS;

  return sesion;
}

function resolverRutaPublica(ruta, extensionesPermitidas) {
  const valor = String(ruta || '').trim();

  if (!valor) {
    return '';
  }

  const rutaNormalizada = valor.startsWith('/')
    ? valor
    : `/${valor}`;

  const extension = path.extname(rutaNormalizada).toLowerCase();

  if (!extensionesPermitidas.includes(extension)) {
    return '';
  }

  const rutaFisica = path.resolve(
    RUTA_PUBLICA,
    rutaNormalizada.slice(1),
  );

  const dentroDePublic =
    rutaFisica.startsWith(`${RUTA_PUBLICA}${path.sep}`);

  if (!dentroDePublic || !fs.existsSync(rutaFisica)) {
    return '';
  }

  return rutaNormalizada;
}

function resolverFoto(contacto) {
  const fotoWeb = resolverRutaPublica(
    contacto?.foto,
    ['.webp', '.jpg', '.jpeg', '.png'],
  );

  const fotoWhatsApp = resolverRutaPublica(
    contacto?.foto_whatsapp,
    ['.jpg', '.jpeg', '.png'],
  );

  return {
    foto: fotoWeb,
    fotoWhatsApp,
  };
}

function construirOpciones(id, sesion, textoAlternativo = '') {
  const nodo = configuracion.flujo[id];

  if (!nodo || nodo.tipo !== 'opciones') {
    return null;
  }

  sesion.nodoActual = id;
  sesion.iniciada = true;

  return {
    tipo: 'opciones',
    nodoId: id,
    texto: textoAlternativo || nodo.texto || '',
    textoBotonLista: nodo.texto_boton_lista || 'Ver opciones',
    opciones: nodo.opciones.map((opcion) => ({
      id: opcion.id,
      etiqueta: opcion.etiqueta,
      etiquetaWhatsApp:
        opcion.etiqueta_whatsapp || opcion.etiqueta,
      descripcion: opcion.descripcion || '',
      payload: `IR:${opcion.destino}`,
    })),
  };
}

function construirMenu(sesion, tipo = 'normal') {
  const inicio = configuracion.flujo.inicio;

  let texto =
    inicio.texto_menu ||
    'Menú principal\nSeleccione una opción para continuar.';

  if (tipo === 'bienvenida') {
    texto =
      inicio.texto ||
      'Hola. Bienvenido a Fitoquim. ¿En qué podemos ayudarle?';
  }

  if (tipo === 'post_contacto') {
    texto =
      inicio.texto_despues_contacto ||
      '¿Necesita realizar otra consulta?\nSeleccione una opción para continuar.';
  }

  return construirOpciones('inicio', sesion, texto);
}

function obtenerArea(id, nodo) {
  if (nodo.area) {
    return nodo.area;
  }

  if (id === 'productos') {
    return 'productos';
  }

  if (id === 'tecnico') {
    return 'tecnico';
  }

  return 'comercial';
}

function obtenerZona(nodo) {
  return String(
    nodo.zona ||
      nodo.subzona ||
      nodo.metrica?.subzona ||
      nodo.metrica?.zona ||
      '',
  ).trim();
}

function construirMensajeWhatsApp(area, zona) {
  if (area === 'productos') {
    return 'Hola, vengo del asistente de FITOQUIM. Quisiera recibir información sobre sus productos.';
  }

  if (area === 'tecnico') {
    return 'Hola, vengo del asistente de FITOQUIM. Necesito asesoramiento técnico.';
  }

  return `Hola, vengo del asistente de FITOQUIM. Necesito atención comercial${
    zona ? ` para ${zona}` : ''
  }.`;
}

function construirContacto(id, nodo, sesion) {
  const contacto = configuracion.contactos[nodo.contacto_id];
  const telefonoDigitos = String(
    contacto?.telefono || '',
  ).replace(/\D/g, '');

  const menu = construirMenu(sesion, 'post_contacto');

  if (!contacto?.configurado || !telefonoDigitos) {
    return {
      tipo: 'texto',
      texto: `El contacto de ${
        contacto?.nombre || 'esta opción'
      } aún no está disponible.`,
      menu,
    };
  }

  const area = obtenerArea(id, nodo);
  const zona = obtenerZona(nodo);
  const fotos = resolverFoto(contacto);

  return {
    tipo: 'contacto',
    texto: nodo.texto || '',
    contacto: {
      id: contacto.id,
      nombre: contacto.nombre,
      cargo: contacto.cargo || '',
      empresa:
        contacto.empresa ||
        configuracion.empresa.nombre_legal ||
        configuracion.empresa.nombre,
      telefono: contacto.telefono,
      telefonoDigitos,
      foto: fotos.foto,
      fotoWhatsApp: fotos.fotoWhatsApp,
      mensajeWhatsApp: construirMensajeWhatsApp(area, zona),
      area,
      zona,
    },
    menu,
  };
}

function construirNodo(id, sesion, textoAlternativo = '') {
  const nodo = configuracion.flujo[id];

  if (!nodo) {
    return construirMenu(sesion, 'normal');
  }

  if (nodo.tipo === 'opciones') {
    if (id === 'inicio') {
      return construirOpciones(
        'inicio',
        sesion,
        textoAlternativo || configuracion.flujo.inicio.texto_menu,
      );
    }

    return construirOpciones(id, sesion, textoAlternativo);
  }

  if (nodo.tipo === 'contacto') {
    return construirContacto(id, nodo, sesion);
  }

  return construirMenu(sesion, 'normal');
}

function responderFaq(faq, sesion) {
  const empresa = configuracion.empresa;
  let texto = '';

  if (faq.habilitada) {
    if (
      faq.tipo === 'horario' &&
      empresa.horario?.habilitado
    ) {
      texto = empresa.horario.texto?.trim() || '';
    }

    if (
      faq.tipo === 'ubicacion' &&
      empresa.ubicacion?.habilitado
    ) {
      texto = [
        empresa.ubicacion.direccion,
        empresa.ubicacion.google_maps,
      ]
        .filter(Boolean)
        .join('\n');
    }

    if (faq.tipo === 'telefono') {
      texto = empresa.telefono_general?.trim() || '';
    }
  }

  return {
    tipo: 'texto',
    texto:
      texto || 'Esta información todavía no está configurada.',
    menu: construirMenu(sesion, 'normal'),
  };
}

function tieneInterpretacion(texto, id) {
  return coincidencias(
    texto,
    configuracion.interpretaciones || [],
  ).some((regla) => regla.id === id);
}

function prepararRespuesta(texto, sesion, esInicio) {
  if (esInicio) {
    return construirMenu(sesion, sesion.iniciada ? 'normal' : 'bienvenida');
  }

  const entrada = String(texto || '').trim();
  const primeraVez = !sesion.iniciada;

  if (!sesion.iniciada && tieneInterpretacion(entrada, 'saludo')) {
    sesion.iniciada = true;
    return construirMenu(sesion, 'bienvenida');
  }

  sesion.iniciada = true;

  if (entrada.startsWith('IR:') && configuracion.flujo[entrada.slice(3)]) {
    return construirNodo(entrada.slice(3), sesion);
  }

  if (tieneInterpretacion(entrada, 'menu')) {
    return construirMenu(sesion, 'normal');
  }

  if (tieneInterpretacion(entrada, 'saludo')) {
    return construirNodo(sesion.nodoActual, sesion);
  }

  const faq = coincidencias(
    entrada,
    configuracion.preguntas_frecuentes || [],
  )[0];

  if (faq) {
    return responderFaq(faq, sesion);
  }

  const globales = coincidencias(
    entrada,
    configuracion.interpretaciones || [],
  );

  const nodoActual = configuracion.flujo[sesion.nodoActual];

  const opciones = (nodoActual?.opciones || []).map((opcion) => ({
    destino: opcion.destino,
    patrones: [
      opcion.etiqueta,
      opcion.etiqueta_whatsapp,
      ...(opcion.alias || []),
    ].filter(Boolean),
  }));

  if (
    /^[1-9]$/.test(entrada) &&
    opciones[Number(entrada) - 1]
  ) {
    return construirNodo(
      opciones[Number(entrada) - 1].destino,
      sesion,
    );
  }

  const locales = coincidencias(entrada, opciones);

  const especificas = globales.filter(
    (regla) =>
      !['saludo', 'menu', 'asesor_ambiguo'].includes(regla.id),
  );

  const zonas = especificas.filter((regla) =>
    regla.id.startsWith('zona_'),
  );

  let candidatos = zonas.length
    ? zonas
    : [...especificas, ...locales];

  if (!candidatos.length) {
    candidatos = globales.filter(
      (regla) => !['saludo', 'menu'].includes(regla.id),
    );
  }

  const destinos = [
    ...new Set(
      candidatos
        .map((regla) => regla.destino)
        .filter(Boolean),
    ),
  ];

  if (destinos.length === 1) {
    return construirNodo(destinos[0], sesion);
  }

  if (destinos.length > 1) {
    if (
      destinos.includes('tecnico') &&
      destinos.includes('comercial_zonas')
    ) {
      return construirNodo('tipo_asesor', sesion);
    }

    return construirNodo(
      'comercial_zonas',
      sesion,
      'La consulta menciona varias opciones. Seleccione la zona para continuar.',
    );
  }

  if (primeraVez) return construirMenu(sesion, 'bienvenida');

  return construirNodo(
    sesion.nodoActual,
    sesion,
    `No comprendí su mensaje. Seleccione una opción para continuar.\n\n${
      sesion.nodoActual === 'inicio'
        ? configuracion.flujo.inicio.texto_menu || 'Menú principal'
        : nodoActual?.texto || ''
    }`,
  );
}

function limpiarUso(registro, ahora) {
  registro.respuestas = registro.respuestas.filter(
    (item) => ahora - item.momento < DIA_MS,
  );
}

function limitesWhatsAppActivos() {
  const valor = normalizar(
    process.env.LIMITES_WHATSAPP_ACTIVOS ?? 'true',
  );

  return !['false', '0', 'no', 'off'].includes(valor);
}

function contarMensajesWhatsApp(respuesta) {
  if (!respuesta) {
    return 0;
  }

  return respuesta.menu ? 2 : 1;
}

function responder({
  canal = 'web',
  identificador,
  texto = '',
  textos,
  esInicio = false,
}) {
  if (!identificador) {
    throw new Error('Falta identificador de conversación.');
  }

  recargarConfiguracion();

  if (Array.isArray(textos)) {
    let partes = textos.slice(-20).map((parte) => String(parte).trim().slice(0, 1000))
      .filter((parte) => parte && !configuracion.sin_respuesta?.some(
        (item) => normalizar(item) === normalizar(parte),
      ));
    if (!partes.length) return null;
    if (partes.length > 1) {
      const sinCortesias = partes.filter((parte) => !['por favor', 'porfa'].includes(normalizar(parte)));
      if (sinCortesias.length) partes = sinCortesias;
    }
    const ultima = partes.at(-1);
    if (/^[1-9]$/.test(ultima) || tieneInterpretacion(ultima, 'menu')) {
      texto = ultima;
    } else {
      if (partes.some((parte) => !tieneInterpretacion(parte, 'saludo'))) {
        partes = partes.filter((parte) => !tieneInterpretacion(parte, 'saludo'));
      } else {
        partes = partes.slice(0, 1);
      }
      texto = partes.join(' ').slice(0, 4000);
    }
  }

  if (
    !esInicio &&
    configuracion.sin_respuesta?.some(
      (item) => normalizar(item) === normalizar(texto),
    )
  ) {
    return null;
  }

  const clave = `${canal}:${identificador}`;
  const sesion = obtenerSesion(clave);
  const estadoAnterior = { nodoActual: sesion.nodoActual, iniciada: sesion.iniciada };

  if (canal === 'whatsapp' && !limitesWhatsAppActivos()) {
    const respuesta = prepararRespuesta(texto, sesion, esInicio);
    reservas.set(respuesta, {
      clave, estadoAnterior, reservadas: [], confirmadas: 0,
      cantidad: contarMensajesWhatsApp(respuesta),
    });
    return respuesta;
  }

  const ahora = Date.now();
  let registro = usoPorUsuario.get(clave);

  if (!registro) {
    registro = {
      respuestas: [],
      bloqueoHasta: 0,
    };

    usoPorUsuario.set(clave, registro);
  }

  if (registro.bloqueoHasta > ahora) {
    return null;
  }

  limpiarUso(registro, ahora);

  const limites = configuracion.limites?.[canal] || {
    respuestas_24_horas: 1000,
    respuestas_5_minutos: 1000,
  };

  const recientes = registro.respuestas.filter(
    (item) => ahora - item.momento < CINCO_MINUTOS_MS,
  );

  const propuesta = prepararRespuesta(texto, sesion, esInicio);

  const cantidad =
    canal === 'whatsapp'
      ? contarMensajesWhatsApp(propuesta)
      : 1;

  let bloqueoHasta = 0;

  const excesoDiario =
    registro.respuestas.length +
    cantidad -
    Number(limites.respuestas_24_horas || 1000);

  const excesoRapido =
    recientes.length +
    cantidad -
    Number(limites.respuestas_5_minutos || 1000);

  if (excesoDiario > 0) {
    const indice = Math.min(
      registro.respuestas.length - 1,
      excesoDiario - 1,
    );

    bloqueoHasta =
      (registro.respuestas[indice]?.momento ?? ahora) + DIA_MS;
  }

  if (excesoRapido > 0) {
    const indice = Math.min(
      recientes.length - 1,
      excesoRapido - 1,
    );

    bloqueoHasta = Math.max(
      bloqueoHasta,
      (recientes[indice]?.momento ?? ahora) + CINCO_MINUTOS_MS,
    );
  }

  if (bloqueoHasta) {
    Object.assign(sesion, estadoAnterior);
  }

  const respuesta = bloqueoHasta
    ? {
        tipo: 'texto',
        avisoLimite: true,
        texto:
          'Alcanzaste temporalmente el límite de consultas automáticas. Podés volver a intentarlo más tarde.',
      }
    : propuesta;

  const cantidadReservada = bloqueoHasta ? 1 : cantidad;

  const reservadas = Array.from(
    { length: cantidadReservada },
    () => ({ momento: ahora }),
  );

  registro.respuestas.push(...reservadas);
  registro.bloqueoHasta = bloqueoHasta;

  reservas.set(respuesta, {
    clave,
    estadoAnterior,
    reservadas,
    confirmadas: 0,
    cantidad: cantidadReservada,
  });

  return respuesta;
}

export function cancelarRespuesta({
  canal,
  identificador,
  respuesta,
}) {
  const reserva = reservas.get(respuesta);

  if (
    !reserva ||
    reserva.clave !== `${canal}:${identificador}`
  ) {
    return;
  }

  const registro = usoPorUsuario.get(reserva.clave);
  const sesion = sesiones.get(reserva.clave);
  if (sesion && !reserva.confirmadas) Object.assign(sesion, reserva.estadoAnterior);

  if (registro) {
    const pendientes = reserva.reservadas.slice(
      reserva.confirmadas,
    );

    registro.respuestas = registro.respuestas.filter(
      (item) => !pendientes.includes(item),
    );

    if (respuesta.avisoLimite && !reserva.confirmadas) {
      registro.bloqueoHasta = 0;
    }
  }

  reservas.delete(respuesta);
}

export function confirmarEnvio(respuesta) {
  const reserva = reservas.get(respuesta);

  if (!reserva) {
    return;
  }

  reserva.confirmadas += 1;

  if (reserva.confirmadas >= reserva.cantidad) {
    reservas.delete(respuesta);
  }
}

export function iniciarConversacion(parametros) {
  return responder({
    ...parametros,
    esInicio: true,
  });
}

export function procesarEntrada(parametros) {
  return responder(parametros);
}

setInterval(() => {
  const ahora = Date.now();

  for (const [clave, sesion] of sesiones) {
    if (sesion.expiraEn <= ahora) {
      sesiones.delete(clave);
    }
  }

  for (const [clave, registro] of usoPorUsuario) {
    limpiarUso(registro, ahora);

    if (
      !registro.respuestas.length &&
      registro.bloqueoHasta <= ahora
    ) {
      usoPorUsuario.delete(clave);
    }
  }
}, 15 * 60 * 1000).unref();
