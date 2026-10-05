import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';

import {
  cancelarRespuesta,
  confirmarEnvio,
  procesarEntrada,
} from './bot.js';

const router = express.Router();

const TOKEN_VERIFICACION =
  process.env.META_VERIFY_TOKEN ||
  '';

const TOKEN_ACCESO =
  process.env.META_ACCESS_TOKEN ||
  '';

const ID_NUMERO_TELEFONO =
  process.env.META_PHONE_NUMBER_ID ||
  '';

const VERSION_API =
  process.env.META_API_VERSION ||
  'v26.0';

const SECRETO_APP =
  process.env.META_APP_SECRET ||
  '';

const RUTA_PUBLICA =
  fileURLToPath(
    new URL(
      '../public/',
      import.meta.url,
    ),
  );

const mensajesProcesados = [];
const mensajesProcesadosSet =
  new Set();

const MAX_MENSAJES_PROCESADOS =
  1500;

const mediosSubidos = new Map();

function normalizarTelefono(
  telefono = '',
) {
  return String(telefono)
    .replace(/\D/g, '');
}

function yaFueProcesado(
  idMensaje,
) {
  if (!idMensaje) {
    return false;
  }

  if (
    mensajesProcesadosSet.has(
      idMensaje,
    )
  ) {
    return true;
  }

  mensajesProcesadosSet.add(
    idMensaje,
  );

  mensajesProcesados.push(
    idMensaje,
  );

  if (
    mensajesProcesados.length >
    MAX_MENSAJES_PROCESADOS
  ) {
    const antiguo =
      mensajesProcesados.shift();

    mensajesProcesadosSet.delete(
      antiguo,
    );
  }

  return false;
}

function verificarFirma(req) {
  if (!SECRETO_APP) {
    return true;
  }

  const firmaRecibida = String(
    req.get(
      'x-hub-signature-256',
    ) || '',
  ).trim();

  if (
    !firmaRecibida.startsWith(
      'sha256=',
    )
  ) {
    return false;
  }

  if (!req.cuerpoCrudo) {
    return false;
  }

  const firmaEsperada =
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
      firmaRecibida,
    );

    const b = Buffer.from(
      firmaEsperada,
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

function obtenerEndpointMensajes() {
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

async function interpretarRespuestaMeta(
  respuesta,
) {
  const texto =
    await respuesta.text();

  let datos = null;

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
      `WhatsApp API ${respuesta.status}: ${texto}`,
    );

    error.estado =
      respuesta.status;

    error.datos = datos;

    throw error;
  }

  return datos;
}

async function llamarApiWhatsApp(
  cuerpo,
) {
  const respuesta =
    await fetch(
      obtenerEndpointMensajes(),
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

  return interpretarRespuestaMeta(
    respuesta,
  );
}

async function subirImagenWhatsApp(
  rutaRelativa,
) {
  if (
    !rutaRelativa ||
    !ID_NUMERO_TELEFONO ||
    !TOKEN_ACCESO
  ) {
    return null;
  }

  const rutaLimpia =
    String(rutaRelativa)
      .replace(/^\/+/, '');

  const rutaFisica =
    path.resolve(
      RUTA_PUBLICA,
      rutaLimpia,
    );

  if (
    !rutaFisica.startsWith(
      RUTA_PUBLICA,
    ) ||
    !fs.existsSync(rutaFisica)
  ) {
    return null;
  }

  const extension =
    path
      .extname(rutaFisica)
      .toLowerCase();

  const tipos = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
  };

  const tipo =
    tipos[extension];

  if (!tipo) {
    return null;
  }

  const estadisticas =
    fs.statSync(rutaFisica);

  const claveCache =
    `${rutaFisica}:${estadisticas.mtimeMs}`;

  const existente =
    mediosSubidos.get(
      claveCache,
    );

  if (existente) {
    return existente;
  }

  const bytes =
    fs.readFileSync(
      rutaFisica,
    );

  const formulario =
    new FormData();

  formulario.append(
    'messaging_product',
    'whatsapp',
  );

  formulario.append(
    'file',
    new Blob(
      [bytes],
      {
        type: tipo,
      },
    ),
    path.basename(
      rutaFisica,
    ),
  );

  const respuesta =
    await fetch(
      `https://graph.facebook.com/${VERSION_API}/${ID_NUMERO_TELEFONO}/media`,
      {
        method: 'POST',
        headers: {
          Authorization:
            `Bearer ${TOKEN_ACCESO}`,
        },
        body: formulario,
        signal:
          AbortSignal.timeout(
            20000,
          ),
      },
    );

  const datos =
    await interpretarRespuestaMeta(
      respuesta,
    );

  const id =
    datos?.id;

  if (!id) {
    return null;
  }

  for (const clave of mediosSubidos.keys()) {
    if (
      clave.startsWith(
        `${rutaFisica}:`,
      )
    ) {
      mediosSubidos.delete(
        clave,
      );
    }
  }

  mediosSubidos.set(
    claveCache,
    id,
  );

  return id;
}

async function enviarTexto(
  numeroDestino,
  texto,
) {
  return llamarApiWhatsApp({
    messaging_product:
      'whatsapp',
    recipient_type:
      'individual',
    to: normalizarTelefono(
      numeroDestino,
    ),
    type: 'text',
    text: {
      preview_url: false,
      body: String(
        texto || '',
      ).slice(0, 4096),
    },
  });
}

async function enviarBotones(
  numeroDestino,
  texto,
  opciones,
) {
  const botones = (
    opciones || []
  )
    .slice(0, 3)
    .map((opcion) => ({
      type: 'reply',
      reply: {
        id: String(
          opcion.payload || '',
        ).slice(0, 256),
        title: String(
          opcion.etiquetaWhatsApp ||
          opcion.etiqueta ||
          '',
        ).slice(0, 20),
      },
    }));

  return llamarApiWhatsApp({
    messaging_product:
      'whatsapp',
    recipient_type:
      'individual',
    to: normalizarTelefono(
      numeroDestino,
    ),
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: String(
          texto || '',
        ).slice(0, 1024),
      },
      action: {
        buttons: botones,
      },
    },
  });
}

async function enviarLista(
  numeroDestino,
  texto,
  textoBoton,
  opciones,
) {
  const filas = (
    opciones || []
  )
    .slice(0, 10)
    .map((opcion) => ({
      id: String(
        opcion.payload || '',
      ).slice(0, 200),
      title: String(
        opcion.etiquetaWhatsApp ||
        opcion.etiqueta ||
        '',
      ).slice(0, 24),
      ...(opcion.descripcion
        ? {
            description:
              String(
                opcion.descripcion,
              ).slice(0, 72),
          }
        : {}),
    }));

  return llamarApiWhatsApp({
    messaging_product:
      'whatsapp',
    recipient_type:
      'individual',
    to: normalizarTelefono(
      numeroDestino,
    ),
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text: String(
          texto || '',
        ).slice(0, 1024),
      },
      action: {
        button: String(
          textoBoton ||
          'Ver opciones',
        ).slice(0, 20),
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
  numeroDestino,
  respuesta,
) {
  const opciones =
    respuesta.opciones || [];

  if (
    opciones.length > 0 &&
    opciones.length <= 3
  ) {
    return enviarBotones(
      numeroDestino,
      respuesta.texto,
      opciones,
    );
  }

  return enviarLista(
    numeroDestino,
    respuesta.texto,
    respuesta.textoBotonLista,
    opciones,
  );
}

function construirUrlWhatsApp(
  contacto,
) {
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

function construirTextoContacto(
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

async function enviarTarjetaContacto(
  numeroDestino,
  respuesta,
) {
  const contacto =
    respuesta.contacto;

  const url =
    construirUrlWhatsApp(
      contacto,
    );

  let mediaId = null;

  if (
    contacto.fotoWhatsApp
  ) {
    try {
      mediaId =
        await subirImagenWhatsApp(
          contacto.fotoWhatsApp,
        );
    } catch (error) {
      console.error(
        '[FITOQUIM] No se pudo subir la foto del contacto:',
        error?.message || error,
      );
    }
  }

  const crearCuerpo = (
    incluirImagen,
  ) => ({
    messaging_product:
      'whatsapp',
    recipient_type:
      'individual',
    to: normalizarTelefono(
      numeroDestino,
    ),
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      ...(incluirImagen &&
      mediaId
        ? {
            header: {
              type: 'image',
              image: {
                id: mediaId,
              },
            },
          }
        : {}),
      body: {
        text: construirTextoContacto(
          respuesta,
        ).slice(0, 1024),
      },
      action: {
        name: 'cta_url',
        parameters: {
          display_text:
            'Contactar',
          url,
        },
      },
    },
  });

  if (mediaId) {
    try {
      return await llamarApiWhatsApp(
        crearCuerpo(true),
      );
    } catch (error) {
      if (
        error?.estado !== 400
      ) {
        throw error;
      }

      console.error(
        '[FITOQUIM] Meta rechazó la imagen integrada. Se enviará la tarjeta sin imagen:',
        error?.message || error,
      );
    }
  }

  return llamarApiWhatsApp(
    crearCuerpo(false),
  );
}

async function enviarRespuesta(
  numeroDestino,
  respuesta,
) {
  if (!respuesta) {
    return;
  }

  if (
    respuesta.tipo === 'texto'
  ) {
    await enviarTexto(
      numeroDestino,
      respuesta.texto,
    );

    confirmarEnvio(
      respuesta,
    );

    if (respuesta.menu) {
      await enviarOpciones(
        numeroDestino,
        respuesta.menu,
      );

      confirmarEnvio(
        respuesta,
      );
    }

    return;
  }

  if (
    respuesta.tipo ===
    'opciones'
  ) {
    await enviarOpciones(
      numeroDestino,
      respuesta,
    );

    confirmarEnvio(
      respuesta,
    );

    return;
  }

  if (
    respuesta.tipo ===
    'contacto'
  ) {
    await enviarTarjetaContacto(
      numeroDestino,
      respuesta,
    );

    confirmarEnvio(
      respuesta,
    );

    if (respuesta.menu) {
      await enviarOpciones(
        numeroDestino,
        respuesta.menu,
      );

      confirmarEnvio(
        respuesta,
      );
    }

    return;
  }

  await enviarTexto(
    numeroDestino,
    TEXTO_FALLBACK,
  );

  confirmarEnvio(
    respuesta,
  );
}

const TEXTO_FALLBACK =
  'No pude mostrar esta respuesta. Escribí “menú” para volver al inicio.';

function obtenerEntradaMensaje(
  mensaje,
) {
  if (!mensaje) {
    return null;
  }

  if (
    mensaje.type === 'text'
  ) {
    return (
      mensaje.text?.body || ''
    );
  }

  if (
    mensaje.type ===
    'interactive'
  ) {
    const boton =
      mensaje.interactive
        ?.button_reply?.id;

    if (boton) {
      return boton;
    }

    const lista =
      mensaje.interactive
        ?.list_reply?.id;

    if (lista) {
      return lista;
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

  return '__ENTRADA_NO_COMPATIBLE__';
}

async function procesarMensaje(
  mensaje,
) {
  const numeroUsuario =
    normalizarTelefono(
      mensaje?.from,
    );

  const idMensaje =
    mensaje?.id;

  if (
    !numeroUsuario ||
    yaFueProcesado(idMensaje)
  ) {
    return;
  }

  const entrada =
    obtenerEntradaMensaje(
      mensaje,
    );

  const respuesta =
    procesarEntrada({
      canal: 'whatsapp',
      identificador:
        numeroUsuario,
      texto:
        entrada ===
        '__ENTRADA_NO_COMPATIBLE__'
          ? 'menu'
          : entrada,
    });

  if (!respuesta) {
    return;
  }

  try {
    await enviarRespuesta(
      numeroUsuario,
      respuesta,
    );
  } catch (error) {
    cancelarRespuesta({
      canal: 'whatsapp',
      identificador:
        numeroUsuario,
      respuesta,
    });

    throw error;
  }
}

async function procesarWebhook(
  cuerpo,
) {
  const entradas =
    Array.isArray(
      cuerpo?.entry,
    )
      ? cuerpo.entry
      : [];

  for (const entrada of entradas) {
    const cambios =
      Array.isArray(
        entrada?.changes,
      )
        ? entrada.changes
        : [];

    for (const cambio of cambios) {
      if (
        cambio?.field !==
        'messages'
      ) {
        continue;
      }

      const mensajes =
        Array.isArray(
          cambio?.value?.messages,
        )
          ? cambio.value.messages
          : [];

      for (const mensaje of mensajes) {
        try {
          await procesarMensaje(
            mensaje,
          );
        } catch (error) {
          console.error(
            '[FITOQUIM] Error procesando mensaje de WhatsApp:',
            error?.stack ||
            error?.message ||
            error,
          );
        }
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
      modo === 'subscribe' &&
      token &&
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

    return res.sendStatus(403);
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

    const cuerpo = req.body;

    res.sendStatus(200);

    procesarWebhook(
      cuerpo,
    ).catch((error) => {
      console.error(
        '[FITOQUIM] Error de webhook:',
        error?.stack ||
        error?.message ||
        error,
      );
    });
  },
);

export default router;