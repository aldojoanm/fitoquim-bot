import 'dotenv/config';

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import whatsappRouter from './src/whatsapp.js';
import webRouter from './src/web.js';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

const RUTA_PUBLICA = fileURLToPath(
  new URL('./public/', import.meta.url),
);

const origenesPermitidos = String(
  process.env.ORIGENES_WEB_PERMITIDOS || '',
)
  .split(',')
  .map((valor) => valor.trim())
  .filter(Boolean)
  .map((valor) => {
    const url = new URL(valor);

    if (
      !['http:', 'https:'].includes(url.protocol) ||
      valor !== url.origin
    ) {
      throw new Error(
        'ORIGENES_WEB_PERMITIDOS debe contener orígenes HTTP/HTTPS sin rutas.',
      );
    }

    return url.origin;
  });

app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buffer) => {
      req.cuerpoCrudo = Buffer.from(buffer);
    },
  }),
);

app.use('/api/chat', (req, res, next) => {
  const origen = req.get('origin');

  res.vary('Origin');

  if (origen) {
    const origenPropio =
      `${req.protocol}://${req.get('host')}`;

    const permitido =
      origen === origenPropio ||
      origenesPermitidos.includes(origen);

    if (!permitido) {
      return res.status(403).json({
        ok: false,
        error: 'origen_no_permitido',
      });
    }

    res.setHeader(
      'Access-Control-Allow-Origin',
      origen,
    );

    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type',
    );

    res.setHeader(
      'Access-Control-Allow-Methods',
      'POST, OPTIONS',
    );
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

app.use('/chat', (_req, res, next) => {
  const fuentes = [
    "'self'",
    ...origenesPermitidos,
  ].join(' ');

  res.setHeader(
    'Content-Security-Policy',
    `frame-ancestors ${fuentes};`,
  );

  next();
});

app.get('/', (_req, res) => {
  res
    .status(200)
    .type('html')
    .send(`
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1"
          >
          <meta
            name="theme-color"
            content="#0b5da6"
          >
          <title>FITOQUIM Bot</title>

          <style>
            * {
              box-sizing: border-box;
            }

            html,
            body {
              width: 100%;
              min-height: 100%;
              margin: 0;
            }

            body {
              min-height: 100vh;
              background:
                radial-gradient(
                  circle at 10% 10%,
                  rgba(79, 179, 207, 0.14),
                  transparent 32%
                ),
                radial-gradient(
                  circle at 90% 90%,
                  rgba(11, 93, 166, 0.08),
                  transparent 34%
                ),
                #f6f9fb;
              font-family:
                Inter,
                system-ui,
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                sans-serif;
            }
          </style>
        </head>

        <body>
          <script
            src="/widget.js"
            defer
          ></script>
        </body>
      </html>
    `);
});

app.use(
  express.static(RUTA_PUBLICA),
);

app.get('/privacidad', (_req, res) => {
  res.sendFile(
    path.join(
      RUTA_PUBLICA,
      'privacidad.html',
    ),
  );
});

app.get('/salud', (_req, res) => {
  res.status(200).json({
    ok: true,
    servicio: 'FITOQUIM Bot',
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

app.use(
  (error, _req, res, _next) => {
    const estado =
      Number(error?.status) >= 400 &&
      Number(error?.status) < 500
        ? Number(error.status)
        : 500;

    console.error(
      '[FITOQUIM] Error del servidor:',
      error?.stack ||
        error?.message ||
        error,
    );

    res.status(estado).json({
      ok: false,
      error:
        estado === 500
          ? 'error_interno'
          : 'solicitud_invalida',
    });
  },
);

const PUERTO = Number(
  process.env.PORT ||
    process.env.PUERTO ||
    3000,
);

const servidor = app.listen(
  PUERTO,
  '0.0.0.0',
  () => {
    console.log(
      `[FITOQUIM] Bot ejecutándose en puerto ${PUERTO}`,
    );

    console.log(
      `[FITOQUIM] Entorno: ${
        process.env.NODE_ENV ||
        'desarrollo'
      }`,
    );

    if (!process.env.META_VERIFY_TOKEN) {
      console.warn(
        '[FITOQUIM] Falta META_VERIFY_TOKEN.',
      );
    }

    if (!process.env.META_ACCESS_TOKEN) {
      console.warn(
        '[FITOQUIM] Falta META_ACCESS_TOKEN.',
      );
    }

    if (
      !process.env.META_PHONE_NUMBER_ID
    ) {
      console.warn(
        '[FITOQUIM] Falta META_PHONE_NUMBER_ID.',
      );
    }

    if (!process.env.META_WABA_ID) {
      console.warn(
        '[FITOQUIM] Falta META_WABA_ID.',
      );
    }

    if (!process.env.META_APP_SECRET) {
      console.warn(
        '[FITOQUIM] Falta META_APP_SECRET.',
      );
    }

    if (!process.env.URL_PUBLICA_BOT) {
      console.warn(
        '[FITOQUIM] Falta URL_PUBLICA_BOT.',
      );
    }
  },
);

servidor.on('error', (error) => {
  console.error(
    '[FITOQUIM] No se pudo iniciar el servidor:',
    error?.stack ||
      error?.message ||
      error,
  );
});