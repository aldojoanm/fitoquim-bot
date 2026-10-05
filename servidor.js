import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import whatsappRouter from './src/whatsapp.js';
import webRouter from './src/web.js';

const app = express();
app.disable('x-powered-by');
const RUTA_PUBLICA = fileURLToPath(new URL('./public/', import.meta.url));
const origenesPermitidos = String(process.env.ORIGENES_WEB_PERMITIDOS || '')
  .split(',').map((valor) => valor.trim()).filter(Boolean).map((valor) => {
    const url = new URL(valor);
    if (!['http:', 'https:'].includes(url.protocol) || valor !== url.origin) {
      throw new Error('ORIGENES_WEB_PERMITIDOS debe contener orígenes HTTP/HTTPS sin rutas.');
    }
    return url.origin;
  });

app.use('/api/chat', (req, res, next) => {
  const origen = req.get('origin');
  res.vary('Origin');
  if (origen) {
    const origenPropio = req.protocol + '://' + req.get('host');
    if (origen !== origenPropio && !origenesPermitidos.includes(origen)) {
      return res.status(403).json({ ok: false, error: 'origen_no_permitido' });
    }
    res.setHeader('Access-Control-Allow-Origin', origen);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

app.use('/chat', (_req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' " + origenesPermitidos.join(' ') + ';');
  next();
});

app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buffer) => { req.cuerpoCrudo = buffer; },
}));
app.use(express.static(RUTA_PUBLICA));
app.get('/', (_req, res) => res.redirect('/chat/'));
app.get('/privacidad', (_req, res) => res.sendFile(path.join(RUTA_PUBLICA, 'privacidad.html')));
app.get('/salud', (_req, res) => res.json({ ok: true, servicio: 'FITOQUIM Bot' }));
app.use(whatsappRouter);
app.use(webRouter);
app.use((_req, res) => res.status(404).json({ ok: false, error: 'no_encontrado' }));
app.use((error, _req, res, _next) => {
  const estado = error.status >= 400 && error.status < 500 ? error.status : 500;
  console.error('[FITOQUIM] Error del servidor:', estado);
  res.status(estado).json({ ok: false, error: estado === 500 ? 'error_interno' : 'solicitud_invalida' });
});

const PUERTO = Number(process.env.PUERTO || 3000);
app.listen(PUERTO, () => {
  console.log('[FITOQUIM] Bot ejecutándose en puerto ' + PUERTO);
  if (!process.env.META_APP_SECRET) {
    console.warn('[FITOQUIM] Configurá META_APP_SECRET para habilitar el webhook de WhatsApp.');
  }
});
