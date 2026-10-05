import 'dotenv/config';

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import whatsappRouter from './src/whatsapp.js';
import webRouter from './src/web.js';
import { obtenerResumenBot } from './src/bot.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUTA_PUBLICA = path.join(__dirname, 'public');

function configurarCorsWeb(req, res, next) {
  const origen = req.get('origin');
  const configurados = String(process.env.ORIGENES_WEB_PERMITIDOS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!origen) return next();

  if (configurados.includes('*') || configurados.includes(origen)) {
    res.setHeader('Access-Control-Allow-Origin', origen);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
}

app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buffer) => {
      req.cuerpoCrudo = Buffer.from(buffer);
    },
  }),
);

app.use('/api/chat', configurarCorsWeb);
app.use(express.static(RUTA_PUBLICA));

app.get('/', (_req, res) => {
  res.redirect('/chat/');
});

app.get('/chat', (_req, res) => {
  res.redirect('/chat/');
});

app.get('/privacidad', (_req, res) => {
  res.sendFile(path.join(RUTA_PUBLICA, 'privacidad.html'));
});

app.get('/salud', (_req, res) => {
  res.json({
    ok: true,
    servicio: 'FITOQUIM Bot',
    fecha: new Date().toISOString(),
    bot: obtenerResumenBot(),
  });
});

app.use(whatsappRouter);
app.use(webRouter);

app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    error: 'no_encontrado',
  });
});

app.use((error, _req, res, _next) => {
  console.error('[FITOQUIM] Error del servidor:', error?.stack || error?.message || error);
  res.status(500).json({
    ok: false,
    error: 'error_interno',
  });
});

const PUERTO = Number(process.env.PUERTO || process.env.PORT || 3000);

app.listen(PUERTO, () => {
  console.log(`🚀 FITOQUIM Bot ejecutándose en puerto ${PUERTO}`);
  console.log('   • WhatsApp: GET/POST /webhook/whatsapp');
  console.log('   • Web:      GET      /chat/');
  console.log('   • API web:  POST     /api/chat/iniciar y /api/chat/mensaje');
  console.log('   • Salud:    GET      /salud');
  console.log('   • Privacidad: GET    /privacidad');

  if (!process.env.META_APP_SECRET) {
    console.warn('⚠️ META_APP_SECRET no está configurado. El webhook funcionará, pero sin validación HMAC.');
  }
});
