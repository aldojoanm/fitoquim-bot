import crypto from 'crypto';
import express from 'express';

import { procesarEntrada, cancelarRespuesta, confirmarEnvio } from './bot.js';

const router = express.Router();

const TOKEN_VERIFICACION = process.env.META_VERIFY_TOKEN || '';
const TOKEN_ACCESO = process.env.META_ACCESS_TOKEN || '';
const ID_NUMERO_TELEFONO = process.env.META_PHONE_NUMBER_ID || '';
export const ID_CUENTA_WHATSAPP = process.env.META_WABA_ID || '';
const VERSION_API = process.env.META_API_VERSION || 'v24.0';
const SECRETO_APP = process.env.META_APP_SECRET || '';
const URL_PUBLICA_BOT = String(process.env.URL_PUBLICA_BOT || '').trim();
const enviosPorNumero = new Map();

const mensajesProcesados = [];
const mensajesProcesadosSet = new Set();
const MAX_MENSAJES_PROCESADOS = 1500;

function yaFueProcesado(idMensaje) {
  if (!idMensaje) return false;
  if (mensajesProcesadosSet.has(idMensaje)) return true;

  mensajesProcesadosSet.add(idMensaje);
  mensajesProcesados.push(idMensaje);

  if (mensajesProcesados.length > MAX_MENSAJES_PROCESADOS) {
    const antiguo = mensajesProcesados.shift();
    mensajesProcesadosSet.delete(antiguo);
  }

  return false;
}

function verificarFirma(req) {
  if (!SECRETO_APP) return false;

  const firmaRecibida = String(req.get('x-hub-signature-256') || '').trim();
  if (!firmaRecibida.startsWith('sha256=')) return false;

  const cuerpoCrudo = req.cuerpoCrudo;
  if (!cuerpoCrudo) return false;

  const firmaEsperada = `sha256=${crypto
    .createHmac('sha256', SECRETO_APP)
    .update(cuerpoCrudo)
    .digest('hex')}`;

  try {
    const a = Buffer.from(firmaRecibida);
    const b = Buffer.from(firmaEsperada);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function normalizarTelefono(telefono = '') {
  return String(telefono || '').replace(/\D/g, '');
}

async function llamarApiWhatsApp(cuerpo) {
  if (!TOKEN_ACCESO || !ID_NUMERO_TELEFONO) {
    throw new Error('Faltan META_ACCESS_TOKEN o META_PHONE_NUMBER_ID.');
  }

  const url = `https://graph.facebook.com/${VERSION_API}/${ID_NUMERO_TELEFONO}/messages`;

  const respuesta = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN_ACCESO}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(12_000),
  });

  const texto = await respuesta.text();

  if (!respuesta.ok) {
    throw new Error(`WhatsApp API: error HTTP ${respuesta.status}`);
  }

  try {
    return JSON.parse(texto);
  } catch {
    return { ok: true };
  }
}

async function enviarTexto(numeroDestino, texto) {
  return llamarApiWhatsApp({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizarTelefono(numeroDestino),
    type: 'text',
    text: {
      preview_url: false,
      body: String(texto || '').slice(0, 4096),
    },
  });
}

async function enviarBotones(numeroDestino, texto, opciones) {
  // Meta limita los títulos a 20 caracteres; mostrar los nombres completos en el cuerpo.
  const etiquetasLargas = (opciones || []).some((opcion) => opcion.etiqueta.length > 20);
  const cuerpoTexto = etiquetasLargas ? texto + '\n\n' + opciones.map((opcion) => opcion.etiqueta).join('\n') : texto;
  const botones = (opciones || []).slice(0, 3).map((opcion) => ({
    type: 'reply',
    reply: {
      id: String(opcion.payload || '').slice(0, 256),
      title: String(opcion.etiquetaWhatsApp || opcion.etiqueta || '').slice(0, 20),
    },
  }));

  return llamarApiWhatsApp({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizarTelefono(numeroDestino),
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: String(cuerpoTexto || '').slice(0, 1024),
      },
      action: {
        buttons: botones,
      },
    },
  });
}

async function enviarLista(numeroDestino, texto, textoBoton, opciones) {
  const filas = (opciones || []).slice(0, 10).map((opcion) => ({
    id: String(opcion.payload || '').slice(0, 200),
    title: String(opcion.etiqueta || '').slice(0, 24),
    ...(opcion.descripcion
      ? { description: String(opcion.descripcion).slice(0, 72) }
      : {}),
  }));

  return llamarApiWhatsApp({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizarTelefono(numeroDestino),
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text: String(texto || '').slice(0, 1024),
      },
      action: {
        button: String(textoBoton || 'Ver opciones').slice(0, 20),
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

async function enviarContactoInteractivo(numeroDestino, respuesta) {
  const contacto = respuesta.contacto;
  const interactive = {
    type: 'cta_url',
    body: { text: [respuesta.texto, '', contacto.nombre, contacto.cargo].filter((parte) => parte !== undefined).join('\n') },
    action: {
      name: 'cta_url',
      parameters: {
        display_text: 'Contactar',
        url: 'https://wa.me/' + contacto.telefonoDigitos + '?text=' + encodeURIComponent(contacto.mensajeWhatsApp),
      },
    },
  };
  if (contacto.fotoWhatsApp && URL_PUBLICA_BOT) {
    try {
      const base = new URL(URL_PUBLICA_BOT);
      if (base.protocol !== 'https:') throw new Error('URL_PUBLICA_BOT debe usar HTTPS.');
      interactive.header = { type: 'image', image: { link: new URL(contacto.fotoWhatsApp, base).href } };
    } catch (error) {
      console.warn('[FITOQUIM] Foto pública no disponible:', error.message);
    }
  }
  const cuerpo = {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: normalizarTelefono(numeroDestino),
    type: 'interactive', interactive,
  };
  try {
    await llamarApiWhatsApp(cuerpo);
  } catch (error) {
    console.error('[FITOQUIM] Error enviando CTA de contacto:', error.message);
    if (!interactive.header) throw error;
    delete interactive.header;
    await llamarApiWhatsApp(cuerpo);
  }
}

async function enviarRespuesta(numeroDestino, respuesta) {
  if (!respuesta) return;

  if (respuesta.tipo === 'texto') {
    await enviarTexto(numeroDestino, respuesta.texto);
    confirmarEnvio(respuesta);
    return;
  }

  if (respuesta.tipo === 'contacto') {
    await enviarContactoInteractivo(numeroDestino, respuesta);
    confirmarEnvio(respuesta);
    await enviarRespuesta(numeroDestino, respuesta.menu);
    confirmarEnvio(respuesta);
    return;
  }

  if (respuesta.tipo === 'opciones') {
    const opciones = respuesta.opciones || [];

    if (
      opciones.length > 0 &&
      opciones.length <= 3
    ) {
      await enviarBotones(numeroDestino, respuesta.texto, opciones);
      confirmarEnvio(respuesta);
      return;
    }

    await enviarLista(
      numeroDestino,
      respuesta.texto,
      respuesta.textoBotonLista,
      opciones,
    );
    confirmarEnvio(respuesta);
    return;
  }

  await enviarTexto(
    numeroDestino,
    'No pude mostrar esta respuesta. Escribí “menú” para volver al inicio.',
  );
}

function obtenerEntradaMensaje(mensaje) {
  if (!mensaje) return null;

  if (mensaje.type === 'text') {
    return mensaje.text?.body || '';
  }

  if (mensaje.type === 'interactive') {
    if (mensaje.interactive?.button_reply?.id) {
      return mensaje.interactive.button_reply.id;
    }

    if (mensaje.interactive?.list_reply?.id) {
      return mensaje.interactive.list_reply.id;
    }
  }

  if (mensaje.type === 'button') {
    return mensaje.button?.payload || mensaje.button?.text || '';
  }

  return null;
}

async function responderMensaje(mensaje) {
  const numeroUsuario = normalizarTelefono(mensaje?.from);
  const idMensaje = mensaje?.id;

  if (!numeroUsuario || yaFueProcesado(idMensaje)) return;

  const entrada = obtenerEntradaMensaje(mensaje);

  if (!entrada || !idMensaje) return;
  const respuesta = procesarEntrada({
    canal: 'whatsapp', identificador: numeroUsuario, texto: entrada,
  });
  if (!respuesta) return;
  try {
    await enviarRespuesta(numeroUsuario, respuesta);
  } finally {
    cancelarRespuesta({ canal: 'whatsapp', identificador: numeroUsuario, respuesta });
  }
}

function procesarMensaje(mensaje) {
  const numero = normalizarTelefono(mensaje?.from);
  if (!numero) return Promise.resolve();
  // Mantener juntos la tarjeta CTA y el menú aunque lleguen mensajes simultáneos.
  const anterior = enviosPorNumero.get(numero) || Promise.resolve();
  const envio = anterior.catch(() => {}).then(() => responderMensaje(mensaje));
  enviosPorNumero.set(numero, envio);
  return envio.finally(() => {
    if (enviosPorNumero.get(numero) === envio) enviosPorNumero.delete(numero);
  });
}

async function procesarWebhook(cuerpo) {
  if (cuerpo?.object !== 'whatsapp_business_account') return;
  const entradas = Array.isArray(cuerpo?.entry) ? cuerpo.entry : [];

  for (const entrada of entradas) {
    const cambios = Array.isArray(entrada?.changes) ? entrada.changes : [];

    for (const cambio of cambios) {
      if (cambio?.field !== 'messages') continue;
      const valor = cambio?.value;
      if (valor?.metadata?.phone_number_id !== ID_NUMERO_TELEFONO) continue;
      const mensajes = Array.isArray(valor?.messages) ? valor.messages : [];

      for (const mensaje of mensajes) {
        try {
          await procesarMensaje(mensaje);
        } catch (error) {
          console.error(
            '[FITOQUIM] Error procesando mensaje de WhatsApp:',
            error?.stack || error?.message || error,
          );
        }
      }
    }
  }
}

router.get('/webhook/whatsapp', (req, res) => {
  const modo = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const desafio = req.query['hub.challenge'];

  if (modo === 'subscribe' && token && token === TOKEN_VERIFICACION) {
    return res.status(200).send(String(desafio || ''));
  }

  return res.sendStatus(403);
});

router.post('/webhook/whatsapp', (req, res) => {
  if (!SECRETO_APP) return res.status(503).json({ error: 'webhook_no_configurado' });
  if (!verificarFirma(req)) {
    return res.status(401).json({ error: 'firma_invalida' });
  }

  const cuerpo = req.body;
  res.sendStatus(200);

  procesarWebhook(cuerpo).catch((error) => {
    console.error('[FITOQUIM] Error de webhook:', error?.stack || error?.message || error);
  });
});

export default router;
