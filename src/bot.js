import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUTA_CONFIGURACION = fileURLToPath(
  new URL('../datos/fitoquim.json', import.meta.url),
);

const RUTA_PUBLICA = fileURLToPath(
  new URL('../public/', import.meta.url),
);

const DIA_MS = 24 * 60 * 60 * 1000;
const CINCO_MINUTOS_MS = 5 * 60 * 1000;

const TEXTO_BIENVENIDA =
  'Hola. Bienvenido a Fitoquim. ¿En qué podemos ayudarle?';

const TEXTO_MENU =
  '¿En qué podemos ayudarle?';

const TEXTO_MENU_POST_CONTACTO =
  '¿En qué más podemos ayudarle?';

const TEXTO_PRODUCTOS =
  'Perfecto, lo derivaremos con la persona de Ventas Corporativas, quien podrá brindarle información sobre nuestros productos.';

const TEXTO_TECNICO =
  'Perfecto, lo derivaremos con la persona del área de Desarrollo, quien podrá orientarlo técnicamente.';

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
  try {
    const modificacion =
      fs.statSync(RUTA_CONFIGURACION).mtimeMs;

    if (modificacion === ultimaModificacion) {
      return;
    }

    configuracion = cargarConfiguracion();
    ultimaModificacion = modificacion;

    console.log(
      '[FITOQUIM] Configuración recargada.',
    );
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

        return (` ${entrada} `).includes(
          ` ${patron} `,
        );
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

  if (
    !sesion ||
    sesion.expiraEn <= ahora
  ) {
    sesion = crearSesion();
    sesiones.set(clave, sesion);
  }

  sesion.expiraEn = ahora + DIA_MS;

  return sesion;
}

function resolverFoto(contacto) {
  const foto = String(
    contacto?.foto || '',
  ).trim();

  if (!foto) {
    return {
      foto: '',
      fotoWhatsApp: '',
    };
  }

  const rutaNormalizada = foto.startsWith('/')
    ? foto
    : `/${foto}`;

  const extension = path
    .extname(rutaNormalizada)
    .toLowerCase();

  const rutaFisica = path.resolve(
    RUTA_PUBLICA,
    rutaNormalizada.slice(1),
  );

  const estaDentroDePublic =
    rutaFisica === RUTA_PUBLICA ||
    rutaFisica.startsWith(
      `${RUTA_PUBLICA}${path.sep}`,
    );

  const existe =
    estaDentroDePublic &&
    fs.existsSync(rutaFisica);

  if (!existe) {
    return {
      foto: rutaNormalizada,
      fotoWhatsApp: '',
    };
  }

  const compatibleWhatsApp = [
    '.jpg',
    '.jpeg',
    '.png',
  ].includes(extension);

  return {
    foto: rutaNormalizada,
    fotoWhatsApp: compatibleWhatsApp
      ? rutaNormalizada
      : '',
  };
}

function construirOpciones(
  id,
  sesion,
  texto,
) {
  const nodo = configuracion.flujo[id];

  if (
    !nodo ||
    nodo.tipo !== 'opciones'
  ) {
    return null;
  }

  sesion.nodoActual = id;
  sesion.iniciada = true;

  return {
    tipo: 'opciones',
    nodoId: id,
    texto:
      texto ||
      nodo.texto ||
      TEXTO_MENU,
    textoBotonLista:
      nodo.texto_boton_lista ||
      'Ver opciones',
    opciones: nodo.opciones.map(
      (opcion) => ({
        id: opcion.id,
        etiqueta: opcion.etiqueta,
        etiquetaWhatsApp:
          opcion.etiqueta_whatsapp ||
          opcion.etiqueta,
        descripcion:
          opcion.descripcion || '',
        payload:
          `IR:${opcion.destino}`,
      }),
    ),
  };
}

function construirMenu(
  sesion,
  tipo = 'normal',
) {
  let texto = TEXTO_MENU;

  if (tipo === 'bienvenida') {
    texto = TEXTO_BIENVENIDA;
  }

  if (tipo === 'post_contacto') {
    texto = TEXTO_MENU_POST_CONTACTO;
  }

  return construirOpciones(
    'inicio',
    sesion,
    texto,
  );
}

function textoContacto(
  id,
  nodo,
  contacto,
  area,
  zona,
) {
  if (area === 'productos') {
    return TEXTO_PRODUCTOS;
  }

  if (area === 'tecnico') {
    return TEXTO_TECNICO;
  }

  if (nodo.texto) {
    return nodo.texto;
  }

  if (zona) {
    return `Perfecto, lo derivaremos con la persona correspondiente para la atención comercial de ${zona}.`;
  }

  return 'Perfecto, lo derivaremos con la persona correspondiente para su atención comercial.';
}

function construirContacto(
  id,
  nodo,
  sesion,
) {
  const contacto =
    configuracion.contactos[
      nodo.contacto_id
    ];

  const telefonoDigitos = String(
    contacto?.telefono || '',
  ).replace(/\D/g, '');

  const menu = construirMenu(
    sesion,
    'post_contacto',
  );

  if (
    !contacto?.configurado ||
    !telefonoDigitos
  ) {
    return {
      tipo: 'texto',
      texto:
        `El contacto de ${
          contacto?.nombre ||
          'esta opción'
        } aún no está disponible.`,
      menu,
    };
  }

  const area =
    nodo.area ||
    (
      id === 'productos'
        ? 'productos'
        : id === 'tecnico'
          ? 'tecnico'
          : 'comercial'
    );

  const zona =
    nodo.zona ||
    nodo.subzona ||
    nodo.metrica?.subzona ||
    nodo.metrica?.zona ||
    '';

  let mensajeContexto = '';

  if (area === 'productos') {
    mensajeContexto =
      'Quisiera recibir información sobre sus productos.';
  } else if (area === 'tecnico') {
    mensajeContexto =
      'Necesito asesoramiento técnico.';
  } else {
    mensajeContexto =
      `Necesito atención comercial${
        zona
          ? ` para ${zona}`
          : ''
      }.`;
  }

  const fotos =
    resolverFoto(contacto);

  return {
    tipo: 'contacto',
    texto: textoContacto(
      id,
      nodo,
      contacto,
      area,
      zona,
    ),
    contacto: {
      id: contacto.id,
      nombre: contacto.nombre,
      cargo:
        contacto.cargo || '',
      empresa:
        contacto.empresa ||
        configuracion.empresa.nombre_legal ||
        configuracion.empresa.nombre,
      telefono:
        contacto.telefono,
      telefonoDigitos,
      foto: fotos.foto,
      fotoWhatsApp:
        fotos.fotoWhatsApp,
      mensajeWhatsApp:
        `Hola, vengo del asistente de FITOQUIM. ${mensajeContexto}`,
      area,
      zona,
    },
    menu,
  };
}

function construirNodo(
  id,
  sesion,
  textoAlternativo,
) {
  const nodo =
    configuracion.flujo[id];

  if (!nodo) {
    return construirMenu(
      sesion,
      'normal',
    );
  }

  if (nodo.tipo === 'opciones') {
    if (id === 'inicio') {
      return construirMenu(
        sesion,
        textoAlternativo ===
          TEXTO_BIENVENIDA
          ? 'bienvenida'
          : textoAlternativo ===
              TEXTO_MENU_POST_CONTACTO
            ? 'post_contacto'
            : 'normal',
      );
    }

    return construirOpciones(
      id,
      sesion,
      textoAlternativo,
    );
  }

  if (nodo.tipo === 'contacto') {
    return construirContacto(
      id,
      nodo,
      sesion,
    );
  }

  return construirMenu(
    sesion,
    'normal',
  );
}

function responderFaq(
  faq,
  sesion,
) {
  const empresa =
    configuracion.empresa;

  let texto = '';

  if (faq.habilitada) {
    if (
      faq.tipo === 'horario' &&
      empresa.horario?.habilitado
    ) {
      texto =
        empresa.horario.texto?.trim();
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

    if (
      faq.tipo === 'telefono'
    ) {
      texto =
        empresa.telefono_general?.trim();
    }
  }

  return {
    tipo: 'texto',
    texto:
      texto ||
      'Esta información todavía no está configurada.',
    menu: construirMenu(
      sesion,
      'normal',
    ),
  };
}

function esSaludo(texto) {
  return coincidencias(
    texto,
    configuracion.interpretaciones ||
      [],
  ).some(
    (regla) =>
      regla.id === 'saludo',
  );
}

function esRegresoMenu(texto) {
  return coincidencias(
    texto,
    configuracion.interpretaciones ||
      [],
  ).some(
    (regla) =>
      regla.id === 'menu',
  );
}

function prepararRespuesta(
  texto,
  sesion,
  esInicio,
) {
  if (esInicio) {
    sesion.iniciada = true;

    return construirMenu(
      sesion,
      'bienvenida',
    );
  }

  const entrada = String(
    texto || '',
  ).trim();

  if (
    !sesion.iniciada &&
    esSaludo(entrada)
  ) {
    sesion.iniciada = true;

    return construirMenu(
      sesion,
      'bienvenida',
    );
  }

  sesion.iniciada = true;

  if (entrada.startsWith('IR:')) {
    return construirNodo(
      entrada.slice(3),
      sesion,
    );
  }

  if (esRegresoMenu(entrada)) {
    return construirMenu(
      sesion,
      'normal',
    );
  }

  if (esSaludo(entrada)) {
    return construirMenu(
      sesion,
      'normal',
    );
  }

  const faq = coincidencias(
    entrada,
    configuracion
      .preguntas_frecuentes || [],
  )[0];

  if (faq) {
    return responderFaq(
      faq,
      sesion,
    );
  }

  const globales = coincidencias(
    entrada,
    configuracion
      .interpretaciones || [],
  );

  const nodoActual =
    configuracion.flujo[
      sesion.nodoActual
    ];

  const opciones = (
    nodoActual?.opciones || []
  ).map((opcion) => ({
    destino: opcion.destino,
    patrones: [
      opcion.etiqueta,
      opcion.etiqueta_whatsapp,
      ...(opcion.alias || []),
    ].filter(Boolean),
  }));

  if (
    /^[1-9]$/.test(entrada) &&
    opciones[
      Number(entrada) - 1
    ]
  ) {
    return construirNodo(
      opciones[
        Number(entrada) - 1
      ].destino,
      sesion,
    );
  }

  const locales = coincidencias(
    entrada,
    opciones,
  );

  const especificas =
    globales.filter(
      (regla) =>
        ![
          'saludo',
          'menu',
          'asesor_ambiguo',
        ].includes(regla.id),
    );

  const zonas =
    especificas.filter(
      (regla) =>
        regla.id.startsWith(
          'zona_',
        ),
    );

  let candidatos =
    zonas.length
      ? zonas
      : [
          ...especificas,
          ...locales,
        ];

  if (!candidatos.length) {
    candidatos =
      globales.filter(
        (regla) =>
          ![
            'saludo',
            'menu',
          ].includes(regla.id),
      );
  }

  const destinos = [
    ...new Set(
      candidatos
        .map(
          (regla) =>
            regla.destino,
        )
        .filter(Boolean),
    ),
  ];

  if (destinos.length === 1) {
    return construirNodo(
      destinos[0],
      sesion,
    );
  }

  if (destinos.length > 1) {
    if (
      destinos.includes(
        'tecnico',
      ) &&
      destinos.includes(
        'comercial_zonas',
      )
    ) {
      return construirNodo(
        'tipo_asesor',
        sesion,
      );
    }

    return construirNodo(
      'comercial_zonas',
      sesion,
      'La consulta menciona varias opciones. Elegí la zona para continuar.',
    );
  }

  if (
    sesion.nodoActual ===
    'inicio'
  ) {
    return construirMenu(
      sesion,
      'normal',
    );
  }

  return construirNodo(
    sesion.nodoActual,
    sesion,
    'Elegí una de las opciones disponibles para continuar.',
  );
}

function limpiarUso(
  registro,
  ahora,
) {
  registro.respuestas =
    registro.respuestas.filter(
      (item) =>
        ahora - item.momento <
        DIA_MS,
    );
}

function limitesWhatsAppActivos() {
  const valor = normalizar(
    process.env
      .LIMITES_WHATSAPP_ACTIVOS ??
      'true',
  );

  if (
    [
      'false',
      '0',
      'no',
      'off',
    ].includes(valor)
  ) {
    return false;
  }

  return true;
}

function contarMensajesWhatsApp(
  respuesta,
) {
  if (!respuesta) {
    return 0;
  }

  let cantidad = 1;

  if (respuesta.menu) {
    cantidad += 1;
  }

  return cantidad;
}

function responder({
  canal = 'web',
  identificador,
  texto = '',
  esInicio = false,
}) {
  if (!identificador) {
    throw new Error(
      'Falta identificador de conversación.',
    );
  }

  recargarConfiguracion();

  if (
    !esInicio &&
    configuracion.sin_respuesta?.some(
      (item) =>
        normalizar(item) ===
        normalizar(texto),
    )
  ) {
    return null;
  }

  const clave =
    `${canal}:${identificador}`;

  const sesion =
    obtenerSesion(clave);

  if (
    canal === 'whatsapp' &&
    !limitesWhatsAppActivos()
  ) {
    return prepararRespuesta(
      texto,
      sesion,
      esInicio,
    );
  }

  const ahora = Date.now();

  let registro =
    usoPorUsuario.get(clave);

  if (!registro) {
    registro = {
      respuestas: [],
      bloqueoHasta: 0,
    };

    usoPorUsuario.set(
      clave,
      registro,
    );
  }

  if (
    registro.bloqueoHasta >
    ahora
  ) {
    return null;
  }

  limpiarUso(
    registro,
    ahora,
  );

  const limites =
    configuracion.limites?.[
      canal
    ] || {
      respuestas_24_horas: 1000,
      respuestas_5_minutos: 1000,
    };

  const recientes =
    registro.respuestas.filter(
      (item) =>
        ahora - item.momento <
        CINCO_MINUTOS_MS,
    );

  const nodoAnterior =
    sesion.nodoActual;

  const propuesta =
    prepararRespuesta(
      texto,
      sesion,
      esInicio,
    );

  const cantidad =
    canal === 'whatsapp'
      ? contarMensajesWhatsApp(
          propuesta,
        )
      : 1;

  let bloqueoHasta = 0;

  const excesoDiario =
    registro.respuestas.length +
    cantidad -
    Number(
      limites.respuestas_24_horas ||
        1000,
    );

  const excesoRapido =
    recientes.length +
    cantidad -
    Number(
      limites.respuestas_5_minutos ||
        1000,
    );

  if (excesoDiario > 0) {
    const indice = Math.min(
      registro.respuestas.length -
        1,
      excesoDiario - 1,
    );

    bloqueoHasta =
      (
        registro.respuestas[
          indice
        ]?.momento ?? ahora
      ) + DIA_MS;
  }

  if (excesoRapido > 0) {
    const indice = Math.min(
      recientes.length - 1,
      excesoRapido - 1,
    );

    bloqueoHasta = Math.max(
      bloqueoHasta,
      (
        recientes[indice]
          ?.momento ?? ahora
      ) +
        CINCO_MINUTOS_MS,
    );
  }

  if (bloqueoHasta) {
    sesion.nodoActual =
      nodoAnterior;
  }

  const respuesta =
    bloqueoHasta
      ? {
          tipo: 'texto',
          avisoLimite: true,
          texto:
            'Alcanzaste temporalmente el límite de consultas automáticas. Podés volver a intentarlo más tarde.',
        }
      : propuesta;

  const cantidadReservada =
    bloqueoHasta
      ? 1
      : cantidad;

  const reservadas =
    Array.from(
      {
        length:
          cantidadReservada,
      },
      () => ({
        momento: ahora,
      }),
    );

  registro.respuestas.push(
    ...reservadas,
  );

  registro.bloqueoHasta =
    bloqueoHasta;

  reservas.set(respuesta, {
    clave,
    reservadas,
    confirmadas: 0,
  });

  return respuesta;
}

export function cancelarRespuesta({
  canal,
  identificador,
  respuesta,
}) {
  const reserva =
    reservas.get(respuesta);

  if (
    !reserva ||
    reserva.clave !==
      `${canal}:${identificador}`
  ) {
    return;
  }

  const registro =
    usoPorUsuario.get(
      reserva.clave,
    );

  if (registro) {
    const pendientes =
      reserva.reservadas.slice(
        reserva.confirmadas,
      );

    registro.respuestas =
      registro.respuestas.filter(
        (item) =>
          !pendientes.includes(
            item,
          ),
      );

    if (
      respuesta.avisoLimite &&
      !reserva.confirmadas
    ) {
      registro.bloqueoHasta = 0;
    }
  }

  reservas.delete(respuesta);
}

export function confirmarEnvio(
  respuesta,
) {
  const reserva =
    reservas.get(respuesta);

  if (reserva) {
    reserva.confirmadas += 1;

    if (
      reserva.confirmadas >=
      reserva.reservadas.length
    ) {
      reservas.delete(
        respuesta,
      );
    }
  }
}

export function iniciarConversacion(
  parametros,
) {
  return responder({
    ...parametros,
    esInicio: true,
  });
}

export function procesarEntrada(
  parametros,
) {
  return responder(parametros);
}

setInterval(() => {
  const ahora = Date.now();

  for (const [
    clave,
    sesion,
  ] of sesiones) {
    if (
      sesion.expiraEn <= ahora
    ) {
      sesiones.delete(clave);
    }
  }

  for (const [
    clave,
    registro,
  ] of usoPorUsuario) {
    limpiarUso(
      registro,
      ahora,
    );

    if (
      !registro.respuestas
        .length &&
      registro.bloqueoHasta <=
        ahora
    ) {
      usoPorUsuario.delete(
        clave,
      );
    }
  }
}, 15 * 60 * 1000).unref();