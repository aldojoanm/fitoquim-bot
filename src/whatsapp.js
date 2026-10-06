import crypto from 'node:crypto';
import express from 'express';

import {
  cancelarRespuesta,
  confirmarEnvio,
  procesarEntrada,
} from './bot.js';

const router = express.Router();

const TOKEN_VERIFICACION =
  process.env.META_VERIFY_TOKEN || '';

const TOKEN_ACCESO =
  process.env.META_ACCESS_TOKEN || '';

const ID_NUMERO_TELEFONO =
  process.env.META_PHONE_NUMBER_ID || '';

const VERSION_API =
  process.env.META_API_VERSION || 'v26.0';

const SECRETO_APP =
  process.env.META_APP_SECRET || '';

const URL_PUBLICA_BOT = String(
  process.env.URL_PUBLICA_BOT ||
    (
      process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : ''
    ),
)
  .trim()
  .replace(/\/+$/, '');

const mensajesProcesados = new Map();
const MAX_MENSAJES_PROCESADOS = 5000;
const conversacionesPendientes = new Map();
const conversacionesListas = [];
const cacheFotosPublicas = new Map();
const ESPERA_TEXTO_MS = 900;
const ESPERA_MAXIMA_MS = 2500;
const MAX_CONVERSACIONES_PENDIENTES = 500;
const MAX_LOTES_POR_USUARIO = 10;
const MAX_ENVIOS_SIMULTANEOS = 4;
let enviosActivos = 0;
let aceptandoMensajes = true;
let resolverCierre;
let promesaCierre;

function diagnosticoSeguro(valor) {
  let texto =
    typeof valor === 'string'
      ? valor
      : JSON.stringify(valor);

  for (const secreto of [
    TOKEN_ACCESO,
    SECRETO_APP,
    TOKEN_VERIFICACION,
  ]) {
    if (secreto) {
      texto = texto.replaceAll(
        secreto,
        '[oculto]',
      );
    }
  }

  return texto;
}

function registrarErrorMeta(etapa, error) {
  console.error(
    `[FITOQUIM] ${etapa}: HTTP ${
      error.estado || 'no disponible'
    }`,
    diagnosticoSeguro(
      error.datos || {
        mensaje:
          error.message ||
          String(error),
      },
    ),
  );
}

function normalizarTelefono(
  telefono = '',
) {
  return String(telefono)
    .replace(/\D/g, '');
}

function yaFueProcesado(idMensaje) {
  const momento = mensajesProcesados.get(idMensaje);
  return momento !== undefined && Date.now() - momento < 24 * 60 * 60 * 1000;
}

function registrarMensaje(idMensaje) {
  mensajesProcesados.delete(idMensaje);
  mensajesProcesados.set(idMensaje, Date.now());
  if (mensajesProcesados.size > MAX_MENSAJES_PROCESADOS) {
    mensajesProcesados.delete(mensajesProcesados.keys().next().value);
  }
}

function verificarFirma(req) {
  if (!SECRETO_APP) {
    return false;
  }

  const recibida = String(
    req.get(
      'x-hub-signature-256',
    ) || '',
  ).trim();

  if (
    !recibida.startsWith(
      'sha256=',
    ) ||
    !req.cuerpoCrudo
  ) {
    return false;
  }

  const esperada =
    `sha256=${
      crypto
        .createHmac(
          'sha256',
          SECRETO_APP,
        )
        .update(
          req.cuerpoCrudo,
        )
        .digest('hex')
    }`;

  try {
    const a = Buffer.from(
      recibida,
    );

    const b = Buffer.from(
      esperada,
    );

    if (a.length !== b.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      a,
      b,
    );
  } catch {
    return false;
  }
}

function endpointMensajes() {
  if (
    !TOKEN_ACCESO ||
    !ID_NUMERO_TELEFONO
  ) {
    throw new Error(
      'Faltan META_ACCESS_TOKEN o META_PHONE_NUMBER_ID.',
    );
  }

  return `https://graph.facebook.com/${VERSION_API}/${ID_NUMERO_TELEFONO}/messages`;
}

async function interpretarMeta(
  respuesta,
) {
  const texto =
    await respuesta.text();

  let datos = {};

  try {
    datos = texto
      ? JSON.parse(texto)
      : {};
  } catch {
    datos = {
      texto,
    };
  }

  if (!respuesta.ok) {
    const error = new Error(
      `WhatsApp API ${respuesta.status}: ${diagnosticoSeguro(texto)}`,
    );

    error.estado =
      respuesta.status;

    error.datos = datos;
    error.reintentoMs = Number(respuesta.headers.get('retry-after')) * 1000 || 1000;

    throw error;
  }

  return datos;
}

async function enviarMetaUnaVez(
  cuerpo,
) {
  const respuesta =
    await fetch(
      endpointMensajes(),
      {
        method: 'POST',
        headers: {
          Authorization:
            `Bearer ${TOKEN_ACCESO}`,
          'Content-Type':
            'application/json',
        },
        body: JSON.stringify(
          cuerpo,
        ),
        signal:
          AbortSignal.timeout(
            15000,
          ),
      },
    );

  const datos =
    await interpretarMeta(
      respuesta,
    );

  if (!datos.messages?.[0]?.id) {
    const error = new Error('Meta no confirmó el envío con un ID de mensaje.');
    error.estado = respuesta.status;
    error.datos = datos;
    throw error;
  }

  if (
    cuerpo.interactive?.type ===
    'cta_url'
  ) {
    console.log(
      `[FITOQUIM] Respuesta CTA (header image link: ${
        Boolean(
          cuerpo.interactive
            ?.header
            ?.image
            ?.link,
        )
      }): HTTP ${respuesta.status}`,
      diagnosticoSeguro(datos),
    );
  }

  return datos;
}

async function enviarMeta(cuerpo) {
  try {
    return await enviarMetaUnaVez(cuerpo);
  } catch (error) {
    // Solo repetir rechazos explícitos y temporales. Un timeout puede haber sido entregado.
    const temporal = error.estado === 429 || error.datos?.error?.is_transient === true;
    if (!temporal || error.reintentoMs > 5000) throw error;
    await new Promise((resolve) => setTimeout(resolve, Math.max(500, error.reintentoMs)));
    return enviarMetaUnaVez(cuerpo);
  }
}

async function enviarTexto(
  numero,
  texto,
) {
  return enviarMeta({
    messaging_product:
      'whatsapp',
    recipient_type:
      'individual',
    to: normalizarTelefono(
      numero,
    ),
    type: 'text',
    text: {
      preview_url: false,
      body: String(
        texto || '',
      ).slice(
        0,
        4096,
      ),
    },
  });
}

async function enviarBotones(
  numero,
  texto,
  opciones,
) {
  const botones = opciones
    .slice(0, 3)
    .map(
      (opcion) => ({
        type: 'reply',
        reply: {
          id: String(
            opcion.payload || '',
          ).slice(
            0,
            256,
          ),
          title: String(
            opcion.etiquetaWhatsApp ||
              opcion.etiqueta ||
              '',
          ).slice(
            0,
            20,
          ),
        },
      }),
    );

  return enviarMeta({
    messaging_product:
      'whatsapp',
    recipient_type:
      'individual',
    to: normalizarTelefono(
      numero,
    ),
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: String(
          texto || '',
        ).slice(
          0,
          1024,
        ),
      },
      action: {
        buttons: botones,
      },
    },
  });
}

async function enviarLista(
  numero,
  texto,
  textoBoton,
  opciones,
) {
  const filas = opciones
    .slice(0, 10)
    .map(
      (opcion) => ({
        id: String(
          opcion.payload || '',
        ).slice(
          0,
          200,
        ),
        title: String(
          opcion.etiquetaWhatsApp ||
            opcion.etiqueta ||
            '',
        ).slice(
          0,
          24,
        ),
        ...(opcion.descripcion
          ? {
              description:
                String(
                  opcion.descripcion,
                ).slice(
                  0,
                  72,
                ),
            }
          : {}),
      }),
    );

  return enviarMeta({
    messaging_product:
      'whatsapp',
    recipient_type:
      'individual',
    to: normalizarTelefono(
      numero,
    ),
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text: String(
          texto || '',
        ).slice(
          0,
          1024,
        ),
      },
      action: {
        button: String(
          textoBoton ||
            'Ver opciones',
        ).slice(
          0,
          20,
        ),
        sections: [
          {
            title: 'Opciones',
            rows: filas,
          },
        ],
      },
    },
  });
}

async function enviarOpciones(
  numero,
  respuesta,
) {
  const opciones =
    respuesta.opciones || [];

  if (
    opciones.length > 0 &&
    opciones.length <= 3
  ) {
    return enviarBotones(
      numero,
      respuesta.texto,
      opciones,
    );
  }

  return enviarLista(
    numero,
    respuesta.texto,
    respuesta.textoBotonLista,
    opciones,
  );
}

function urlWhatsApp(contacto) {
  const telefono =
    normalizarTelefono(
      contacto.telefonoDigitos ||
        contacto.telefono,
    );

  const mensaje =
    encodeURIComponent(
      contacto.mensajeWhatsApp ||
        'Hola, vengo del asistente de FITOQUIM.',
    );

  return `https://wa.me/${telefono}?text=${mensaje}`;
}

function urlFoto(contacto) {
  if (
    !URL_PUBLICA_BOT ||
    !contacto?.fotoWhatsApp
  ) {
    return '';
  }

  const ruta = String(
    contacto.fotoWhatsApp,
  ).trim();

  if (!ruta) {
    return '';
  }

  const rutaNormalizada =
    ruta.startsWith('/')
      ? ruta
      : `/${ruta}`;

  return `${URL_PUBLICA_BOT}${rutaNormalizada}`;
}

function textoContacto(
  respuesta,
) {
  const partes = [];

  if (respuesta.texto) {
    partes.push(
      respuesta.texto,
    );
  }

  if (
    respuesta.contacto?.nombre
  ) {
    partes.push(
      `*${respuesta.contacto.nombre}*`,
    );
  }

  if (
    respuesta.contacto?.cargo
  ) {
    partes.push(
      respuesta.contacto.cargo,
    );
  }

  return partes.join(
    '\n\n',
  );
}

function cuerpoContacto(
  numero,
  respuesta,
  foto = '',
) {
  const contacto =
    respuesta.contacto;

  const interactive = {
    type: 'cta_url',
    body: {
      text: textoContacto(
        respuesta,
      ).slice(
        0,
        1024,
      ),
    },
    action: {
      name: 'cta_url',
      parameters: {
        display_text:
          'Contactar',
        url:
          urlWhatsApp(
            contacto,
          ),
      },
    },
  };

  if (foto) {
    interactive.header = {
      type: 'image',
      image: {
        link: foto,
      },
    };
  }

  return {
    messaging_product:
      'whatsapp',
    recipient_type:
      'individual',
    to: normalizarTelefono(
      numero,
    ),
    type: 'interactive',
    interactive,
  };
}

async function comprobarFotoPublicaSinCache(
  url,
) {
  if (!url) {
    return false;
  }

  try {
    const respuesta =
      await fetch(
        url,
        {
          method: 'HEAD',
          redirect: 'follow',
          signal:
            AbortSignal.timeout(
              10000,
            ),
        },
      );

    const tipo =
      respuesta.headers.get(
        'content-type',
      ) || '';

    console.log(
      '[FITOQUIM] Foto pública:',
      url,
    );

    console.log(
      '[FITOQUIM] Foto pública HTTP:',
      respuesta.status,
    );

    console.log(
      '[FITOQUIM] Foto pública MIME:',
      tipo,
    );

    return (
      respuesta.ok &&
      (
        tipo.startsWith(
          'image/jpeg',
        ) ||
        tipo.startsWith(
          'image/png',
        )
      )
    );
  } catch (error) {
    console.error(
      '[FITOQUIM] No se pudo validar foto pública:',
      error?.message ||
        error,
    );

    return false;
  }
}

async function comprobarFotoPublica(url) {
  if (!url) return false;
  const anterior = cacheFotosPublicas.get(url);
  if (anterior && anterior.expira > Date.now()) return anterior.promesa;
  const entrada = { expira: Infinity };
  entrada.promesa = comprobarFotoPublicaSinCache(url).then((disponible) => {
    entrada.expira = Date.now() + (disponible ? 10 * 60 * 1000 : 30000);
    return disponible;
  });
  if (!cacheFotosPublicas.has(url) && cacheFotosPublicas.size >= 100) {
    cacheFotosPublicas.delete(cacheFotosPublicas.keys().next().value);
  }
  cacheFotosPublicas.set(url, entrada);
  return entrada.promesa;
}

export async function enviarContacto(
  numero,
  respuesta,
) {
  const contacto =
    respuesta.contacto;

  const foto =
    urlFoto(contacto);

  if (foto) {
    const disponible =
      await comprobarFotoPublica(
        foto,
      );

    if (disponible) {
      console.log(
        '[FITOQUIM] Enviando CTA con header image.link:',
        foto,
      );

      try {
        return await enviarMeta(
          cuerpoContacto(
            numero,
            respuesta,
            foto,
          ),
        );
      } catch (error) {
        registrarErrorMeta(
          'Falló tarjeta con foto',
          error,
        );
        // Un fallo de red puede ocultar un envío aceptado: no duplicar la tarjeta.
        if (!error.estado || error.estado < 400 ||
            [401, 403, 429].includes(error.estado) || error.estado >= 500) {
          throw error;
        }
      }
    } else {
      console.warn(
        '[FITOQUIM] La foto configurada no es accesible públicamente como JPEG/PNG:',
        foto,
      );
    }
  } else {
    console.warn(
      '[FITOQUIM] El contacto no tiene foto pública válida para WhatsApp.',
    );

    if (!URL_PUBLICA_BOT) {
      console.warn(
        '[FITOQUIM] Falta URL_PUBLICA_BOT.',
      );
    }
  }

  console.warn(
    '[FITOQUIM] Se enviará CTA sin imagen.',
  );

  return enviarMeta(
    cuerpoContacto(
      numero,
      respuesta,
      '',
    ),
  );
}

async function enviarRespuesta(
  numero,
  respuesta,
  alConfirmar,
) {
  if (!respuesta) {
    return;
  }

  function confirmarEntrega() {
    confirmarEnvio(respuesta);
    alConfirmar();
  }

  if (
    respuesta.tipo ===
    'opciones'
  ) {
    await enviarOpciones(
      numero,
      respuesta,
    );

    confirmarEntrega();

    return;
  }

  if (
    respuesta.tipo ===
    'contacto'
  ) {
    await enviarContacto(
      numero,
      respuesta,
    );

    confirmarEntrega();

    if (respuesta.menu) {
      await enviarOpciones(
        numero,
        respuesta.menu,
      );

      confirmarEntrega();
    }

    return;
  }

  if (
    respuesta.tipo ===
    'texto'
  ) {
    await enviarTexto(
      numero,
      respuesta.texto,
    );

    confirmarEntrega();

    if (respuesta.menu) {
      await enviarOpciones(
        numero,
        respuesta.menu,
      );

      confirmarEntrega();
    }
  }
}

function obtenerEntrada(
  mensaje,
) {
  if (!mensaje) {
    return null;
  }

  if (
    mensaje.type === 'text'
  ) {
    return (
      mensaje.text?.body ||
      ''
    );
  }

  if (
    mensaje.type ===
    'interactive'
  ) {
    if (
      mensaje.interactive
        ?.button_reply?.id
    ) {
      return mensaje
        .interactive
        .button_reply
        .id;
    }

    if (
      mensaje.interactive
        ?.list_reply?.id
    ) {
      return mensaje
        .interactive
        .list_reply
        .id;
    }
  }

  if (
    mensaje.type === 'button'
  ) {
    return (
      mensaje.button?.payload ||
      mensaje.button?.text ||
      ''
    );
  }

  return '';
}

async function procesarLote(usuario, lote) {
  let respuesta;
  try {
    respuesta = procesarEntrada({
      canal: 'whatsapp',
      identificador: usuario,
      texto: lote.texto || '',
      textos: lote.textos,
    });
    if (respuesta) await enviarRespuesta(usuario, respuesta, () => {
      lote.confirmados = (lote.confirmados || 0) + 1;
    });
  } catch (error) {
    cancelarRespuesta({
      canal: 'whatsapp',
      identificador:
        usuario,
      respuesta,
    });

    throw error;
  }
}

function limpiarConversacion(estado) {
  if (!estado.ejecutando && !estado.enCola && !estado.pendiente && !estado.cola.length) {
    conversacionesPendientes.delete(estado.usuario);
  }
  if (!conversacionesPendientes.size && resolverCierre) {
    resolverCierre();
    resolverCierre = undefined;
  }
}

function ejecutarPendientes() {
  while (enviosActivos < MAX_ENVIOS_SIMULTANEOS && conversacionesListas.length) {
    const estado = conversacionesListas.shift();
    estado.enCola = false;
    const lote = estado.cola.shift();
    estado.ejecutando = true;
    enviosActivos += 1;
    procesarLote(estado.usuario, lote).catch((error) => {
      // Reintentar una redelivery solo si ninguna parte fue entregada.
      if (!lote.confirmados) {
        for (const id of lote.ids) mensajesProcesados.delete(id);
      }
      registrarErrorMeta('Error procesando mensajes; conversación disponible para reintentar', error);
    }).finally(() => {
      estado.ejecutando = false;
      enviosActivos -= 1;
      activarConversacion(estado);
      limpiarConversacion(estado);
      ejecutarPendientes();
    });
  }
}

function activarConversacion(estado) {
  if (estado.cola.length && !estado.ejecutando && !estado.enCola) {
    estado.enCola = true;
    conversacionesListas.push(estado);
    ejecutarPendientes();
  }
}

function enviarTextoPendiente(estado) {
  clearTimeout(estado.temporizador);
  if (!estado.pendiente) return;
  if (estado.cola.length >= MAX_LOTES_POR_USUARIO) {
    estado.temporizador = setTimeout(() => enviarTextoPendiente(estado), 1000);
    return;
  }
  estado.cola.push(estado.pendiente);
  estado.pendiente = null;
  activarConversacion(estado);
}

function encolarMensaje(mensaje) {
  const usuario = normalizarTelefono(mensaje?.from).slice(0, 20);
  const id = String(mensaje?.id || '').slice(0, 200);
  if (!usuario || !id || mensaje.type === 'reaction' || yaFueProcesado(id)) return;
  if (!aceptandoMensajes) throw new Error('El servidor está terminando; reintentar webhook.');

  let estado = conversacionesPendientes.get(usuario);
  if (!estado) {
    if (conversacionesPendientes.size >= MAX_CONVERSACIONES_PENDIENTES) {
      throw new Error('Cola de conversaciones llena; reintentar webhook.');
    }
    estado = { usuario, cola: [], pendiente: null, ejecutando: false, enCola: false };
    conversacionesPendientes.set(usuario, estado);
  }
  const texto = String(obtenerEntrada(mensaje) || '[mensaje no textual]').trim().slice(0, 1000);
  const seleccion = mensaje.type === 'interactive' || mensaje.type === 'button';
  if (seleccion) {
    if (estado.cola.length >= MAX_LOTES_POR_USUARIO) {
      throw new Error('Cola del usuario llena; reintentar webhook.');
    }
    // La elección explícita reemplaza el texto que todavía no fue procesado.
    clearTimeout(estado.temporizador);
    estado.pendiente = null;
    estado.cola.push({ texto, ids: [id] });
    registrarMensaje(id);
    activarConversacion(estado);
    return;
  }

  if (estado.pendiente && (estado.pendiente.textos.length >= 20 ||
      estado.pendiente.caracteres + texto.length > 4000)) {
    if (estado.cola.length >= MAX_LOTES_POR_USUARIO) {
      throw new Error('Cola del usuario llena; reintentar webhook.');
    }
    enviarTextoPendiente(estado);
  }
  if (!estado.pendiente) {
    estado.pendiente = { textos: [], ids: [], inicio: Date.now(), caracteres: 0 };
  }
  estado.pendiente.textos.push(texto);
  estado.pendiente.ids.push(id);
  estado.pendiente.caracteres += texto.length;
  registrarMensaje(id);
  clearTimeout(estado.temporizador);
  const espera = Math.min(ESPERA_TEXTO_MS,
    Math.max(0, estado.pendiente.inicio + ESPERA_MAXIMA_MS - Date.now()));
  estado.temporizador = setTimeout(() => enviarTextoPendiente(estado), espera);
}

export function cerrarWhatsApp() {
  if (promesaCierre) return promesaCierre;
  aceptandoMensajes = false;
  for (const estado of conversacionesPendientes.values()) enviarTextoPendiente(estado);
  promesaCierre = new Promise((resolve) => {
    if (!conversacionesPendientes.size) resolve();
    else resolverCierre = resolve;
  });
  return promesaCierre;
}

function procesarWebhook(
  cuerpo,
) {
  const entradas =
    Array.isArray(
      cuerpo?.entry,
    )
      ? cuerpo.entry
      : [];

  for (
    const entrada of entradas
  ) {
    const cambios =
      Array.isArray(
        entrada?.changes,
      )
        ? entrada.changes
        : [];

    for (
      const cambio of cambios
    ) {
      if (
        cambio?.field !==
        'messages'
      ) {
        continue;
      }

      const numeroReceptor = cambio.value?.metadata?.phone_number_id;
      if (numeroReceptor && numeroReceptor !== ID_NUMERO_TELEFONO) continue;

      const recibidos =
        Array.isArray(
          cambio?.value
            ?.messages,
        )
          ? cambio.value.messages
          : [];

      for (
        const mensaje of recibidos
      ) {
        encolarMensaje(mensaje);
      }
    }
  }
}

router.get(
  '/webhook/whatsapp',
  (req, res) => {
    const modo =
      req.query['hub.mode'];

    const token =
      req.query[
        'hub.verify_token'
      ];

    const desafio =
      req.query[
        'hub.challenge'
      ];

    if (
      TOKEN_VERIFICACION && modo === 'subscribe' &&
      token ===
        TOKEN_VERIFICACION
    ) {
      return res
        .status(200)
        .send(
          String(
            desafio || '',
          ),
        );
    }

    return res.sendStatus(
      403,
    );
  },
);

router.post(
  '/webhook/whatsapp',
  (req, res) => {
    if (!verificarFirma(req)) {
      return res
        .status(401)
        .json({
          error:
            'firma_invalida',
        });
    }

    const cuerpo =
      req.body;

    try {
      procesarWebhook(cuerpo);
      res.sendStatus(200);
    } catch (error) {
      registrarErrorMeta('Webhook no admitido', error);
      res.setHeader('Retry-After', '2');
      res.sendStatus(503);
    }
  },
);

export default router;
