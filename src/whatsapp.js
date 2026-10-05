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

const URL_PUBLICA_BOT =
  String(process.env.URL_PUBLICA_BOT || '')
    .trim()
    .replace(/\/+$/, '');

const mensajesProcesados = [];
const mensajesProcesadosSet = new Set();
const MAX_MENSAJES_PROCESADOS = 1500;

function normalizarTelefono(telefono = '') {
  return String(telefono).replace(/\D/g, '');
}

function yaFueProcesado(idMensaje) {
  if (!idMensaje) {
    return false;
  }

  if (mensajesProcesadosSet.has(idMensaje)) {
    return true;
  }

  mensajesProcesadosSet.add(idMensaje);
  mensajesProcesados.push(idMensaje);

  if (
    mensajesProcesados.length >
    MAX_MENSAJES_PROCESADOS
  ) {
    const antiguo =
      mensajesProcesados.shift();

    mensajesProcesadosSet.delete(antiguo);
  }

  return false;
}

function verificarFirma(req) {
  if (!SECRETO_APP) {
    return true;
  }

  const recibida = String(
    req.get('x-hub-signature-256') || '',
  ).trim();

  if (
    !recibida.startsWith('sha256=') ||
    !req.cuerpoCrudo
  ) {
    return false;
  }

  const esperada =
    `sha256=${
      crypto
        .createHmac('sha256', SECRETO_APP)
        .update(req.cuerpoCrudo)
        .digest('hex')
    }`;

  try {
    const a = Buffer.from(recibida);
    const b = Buffer.from(esperada);

    if (a.length !== b.length) {
      return false;
    }

    return crypto.timingSafeEqual(a, b);
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

async function interpretarMeta(respuesta) {
  const texto = await respuesta.text();

  let datos = {};

  try {
    datos = texto
      ? JSON.parse(texto)
      : {};
  } catch {
    datos = { texto };
  }

  if (!respuesta.ok) {
    const error = new Error(
      `WhatsApp API ${respuesta.status}: ${texto}`,
    );

    error.estado = respuesta.status;
    error.datos = datos;

    throw error;
  }

  return datos;
}

async function enviarMeta(cuerpo) {
  const respuesta = await fetch(
    endpointMensajes(),
    {
      method: 'POST',
      headers: {
        Authorization:
          `Bearer ${TOKEN_ACCESO}`,
        'Content-Type':
          'application/json',
      },
      body: JSON.stringify(cuerpo),
      signal:
        AbortSignal.timeout(15000),
    },
  );

  return interpretarMeta(respuesta);
}

async function enviarTexto(
  numero,
  texto,
) {
  return enviarMeta({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizarTelefono(numero),
    type: 'text',
    text: {
      preview_url: false,
      body: String(texto || '').slice(
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

  return enviarMeta({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizarTelefono(numero),
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: String(texto || '').slice(
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

  return enviarMeta({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizarTelefono(numero),
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text: String(texto || '').slice(
          0,
          1024,
        ),
      },
      action: {
        button: String(
          textoBoton || 'Ver opciones',
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

  const ruta =
    contacto.fotoWhatsApp.startsWith('/')
      ? contacto.fotoWhatsApp
      : `/${contacto.fotoWhatsApp}`;

  return `${URL_PUBLICA_BOT}${ruta}`;
}

function textoContacto(respuesta) {
  const partes = [];

  if (respuesta.texto) {
    partes.push(respuesta.texto);
  }

  if (respuesta.contacto?.nombre) {
    partes.push(
      `*${respuesta.contacto.nombre}*`,
    );
  }

  if (respuesta.contacto?.cargo) {
    partes.push(
      respuesta.contacto.cargo,
    );
  }

  return partes.join('\n\n');
}

function cuerpoContacto(
  numero,
  respuesta,
  incluirImagen,
) {
  const contacto =
    respuesta.contacto;

  const foto =
    urlFoto(contacto);

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizarTelefono(numero),
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      ...(incluirImagen && foto
        ? {
            header: {
              type: 'image',
              image: {
                link: foto,
              },
            },
          }
        : {}),
      body: {
        text: textoContacto(
          respuesta,
        ).slice(0, 1024),
      },
      action: {
        name: 'cta_url',
        parameters: {
          display_text: 'Contactar',
          url: urlWhatsApp(contacto),
        },
      },
    },
  };
}

async function enviarContacto(
  numero,
  respuesta,
) {
  const foto =
    urlFoto(respuesta.contacto);

  if (foto) {
    console.log(
      '[FITOQUIM] Foto WhatsApp:',
      foto,
    );

    try {
      return await enviarMeta(
        cuerpoContacto(
          numero,
          respuesta,
          true,
        ),
      );
    } catch (error) {
      console.error(
        '[FITOQUIM] Meta rechazó la tarjeta con foto:',
        error?.message || error,
      );
    }
  } else {
    console.warn(
      '[FITOQUIM] El contacto no tiene una foto JPG/PNG válida para WhatsApp.',
    );
  }

  return enviarMeta(
    cuerpoContacto(
      numero,
      respuesta,
      false,
    ),
  );
}

async function enviarRespuesta(
  numero,
  respuesta,
) {
  if (!respuesta) {
    return;
  }

  if (
    respuesta.tipo === 'opciones'
  ) {
    await enviarOpciones(
      numero,
      respuesta,
    );

    confirmarEnvio(respuesta);

    return;
  }

  if (
    respuesta.tipo === 'contacto'
  ) {
    await enviarContacto(
      numero,
      respuesta,
    );

    confirmarEnvio(respuesta);

    if (respuesta.menu) {
      await enviarOpciones(
        numero,
        respuesta.menu,
      );

      confirmarEnvio(respuesta);
    }

    return;
  }

  if (
    respuesta.tipo === 'texto'
  ) {
    await enviarTexto(
      numero,
      respuesta.texto,
    );

    confirmarEnvio(respuesta);

    if (respuesta.menu) {
      await enviarOpciones(
        numero,
        respuesta.menu,
      );

      confirmarEnvio(respuesta);
    }

    return;
  }
}

function obtenerEntrada(mensaje) {
  if (!mensaje) {
    return null;
  }

  if (mensaje.type === 'text') {
    return (
      mensaje.text?.body || ''
    );
  }

  if (
    mensaje.type === 'interactive'
  ) {
    if (
      mensaje.interactive
        ?.button_reply?.id
    ) {
      return mensaje.interactive
        .button_reply.id;
    }

    if (
      mensaje.interactive
        ?.list_reply?.id
    ) {
      return mensaje.interactive
        .list_reply.id;
    }
  }

  if (mensaje.type === 'button') {
    return (
      mensaje.button?.payload ||
      mensaje.button?.text ||
      ''
    );
  }

  return 'menu';
}

async function procesarMensaje(
  mensaje,
) {
  const usuario =
    normalizarTelefono(
      mensaje?.from,
    );

  if (
    !usuario ||
    yaFueProcesado(mensaje?.id)
  ) {
    return;
  }

  const respuesta =
    procesarEntrada({
      canal: 'whatsapp',
      identificador: usuario,
      texto: obtenerEntrada(mensaje),
    });

  if (!respuesta) {
    return;
  }

  try {
    await enviarRespuesta(
      usuario,
      respuesta,
    );
  } catch (error) {
    cancelarRespuesta({
      canal: 'whatsapp',
      identificador: usuario,
      respuesta,
    });

    throw error;
  }
}

async function procesarWebhook(
  cuerpo,
) {
  const entradas =
    Array.isArray(cuerpo?.entry)
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

      const recibidos =
        Array.isArray(
          cambio?.value?.messages,
        )
          ? cambio.value.messages
          : [];

      for (const mensaje of recibidos) {
        try {
          await procesarMensaje(
            mensaje,
          );
        } catch (error) {
          console.error(
            '[FITOQUIM] Error procesando mensaje:',
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
      token === TOKEN_VERIFICACION
    ) {
      return res
        .status(200)
        .send(
          String(desafio || ''),
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
          error: 'firma_invalida',
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