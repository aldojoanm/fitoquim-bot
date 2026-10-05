import express from 'express';

import {
  iniciarConversacion,
  procesarEntrada,
} from './bot.js';

const router = express.Router();

function sesionValida(
  valor = '',
) {
  return /^[a-zA-Z0-9_-]{10,120}$/.test(
    String(valor || ''),
  );
}

function prepararIdentificador(
  req,
  sesionId,
) {
  const ip = String(
    req.ip ||
    req.socket?.remoteAddress ||
    'sin-ip',
  );

  return `${sesionId}:${ip}`;
}

function responder(
  res,
  respuesta,
) {
  return res.json({
    ok: true,
    respuesta:
      respuesta || null,
  });
}

router.post(
  '/api/chat/iniciar',
  (req, res, next) => {
    try {
      const sesionId =
        String(
          req.body?.sesionId ||
          '',
        ).trim();

      if (
        !sesionValida(sesionId)
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              'sesion_invalida',
          });
      }

      const identificador =
        prepararIdentificador(
          req,
          sesionId,
        );

      const respuesta =
        iniciarConversacion({
          canal: 'web',
          identificador,
        });

      return responder(
        res,
        respuesta,
      );
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  '/api/chat/mensaje',
  (req, res, next) => {
    try {
      const sesionId =
        String(
          req.body?.sesionId ||
          '',
        ).trim();

      const texto =
        String(
          req.body?.texto || '',
        ).slice(0, 1000);

      if (
        !sesionValida(sesionId)
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              'sesion_invalida',
          });
      }

      const identificador =
        prepararIdentificador(
          req,
          sesionId,
        );

      const respuesta =
        procesarEntrada({
          canal: 'web',
          identificador,
          texto,
        });

      return responder(
        res,
        respuesta,
      );
    } catch (error) {
      return next(error);
    }
  },
);

export default router;