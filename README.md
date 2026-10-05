# FITOQUIM Bot

Bot determinista para WhatsApp Cloud API y chat web. Ambos canales utilizan el mismo flujo de `src/bot.js`, con botones, listas y reglas básicas de texto, sin IA. La configuración empresarial y los contactos están en `datos/fitoquim.json`.

## Instalación

```bash
npm install
```

## Desarrollo

```bash
npm run dev
```

## Producción

```bash
npm start
```

## Variables de entorno

Crear o completar `.env` (ignorado por Git). No publicar claves reales.

```env
PUERTO=3000
META_VERIFY_TOKEN=
META_ACCESS_TOKEN=
META_PHONE_NUMBER_ID=
META_WABA_ID=
META_APP_SECRET=
META_API_VERSION=v24.0
ORIGENES_WEB_PERMITIDOS=http://localhost:3000,http://localhost:5173
URL_PUBLICA_BOT=https://fitoquim-bot-production.up.railway.app
LIMITES_WHATSAPP_ACTIVOS=true
```

- `META_VERIFY_TOKEN`: clave creada por nosotros para verificar el webhook. Es distinta del Access Token.
- `META_ACCESS_TOKEN`: token generado por Meta para enviar mensajes.
- `META_PHONE_NUMBER_ID`: ID interno del número de WhatsApp, no el número +591.
- `META_WABA_ID`: ID de la cuenta de WhatsApp Business; está disponible en la configuración, pero no es obligatorio para enviar mensajes.
- `META_APP_SECRET`: secreto de la app de Meta para validar `x-hub-signature-256`. Sin este secreto, el POST del webhook devuelve 503.
- `META_API_VERSION`: versión de Cloud API, inicialmente `v24.0`.
- `URL_PUBLICA_BOT`: origen público HTTPS del servidor, usado para las fotos de las tarjetas CTA. Debe estar configurado también en Railway.
- `LIMITES_WHATSAPP_ACTIVOS`: activa los límites de WhatsApp; por defecto `true`. Acepta `true`, `1`, `yes`, `si`, `sí`, `on`; para desactivar acepta `false`, `0`, `no`, `off`. Otros valores conservan los límites activos. Con `false` no se aplican ventanas ni avisos; los límites web se mantienen.
- `ORIGENES_WEB_PERMITIDOS`: orígenes HTTP/HTTPS separados por comas, sin rutas ni barras finales. Restringen las llamadas externas a `/api/chat` y las páginas que pueden embeber `/chat/`. Incluir los dominios autorizados del sitio externo. El chat puede abrirse directamente desde el servidor del bot.

## Webhook

`https://DOMINIO/webhook/whatsapp`

Configurar en Meta el mismo `META_VERIFY_TOKEN` y suscribirse al evento de mensajes de WhatsApp. El webhook verifica firmas, ignora eventos irrelevantes y evita duplicados recientes en memoria.

## Salud

`https://DOMINIO/salud`

Devuelve `{"ok":true,"servicio":"FITOQUIM Bot"}` sin configuración sensible.

## Chat

`https://DOMINIO/chat/`

Utiliza `POST /api/chat/iniciar` y `POST /api/chat/mensaje`. Mantiene el identificador de sesión en localStorage cuando está disponible y abre WhatsApp con el mensaje prearmado correspondiente.

## Widget

El sitio externo solo necesita insertar este script:

```html
<script
  src="https://DOMINIO/widget.js"
  defer
></script>
```

El script detecta el origen del bot y abre `/chat/?embebido=1` en un iframe. Agregar el origen del sitio anfitrión a `ORIGENES_WEB_PERMITIDOS`. Los cambios futuros del chatbot no requieren modificar la web externa.

En `datos/fitoquim.json` faltan el horario, la dirección, Google Maps y el teléfono general. Conocer nuestros productos dirige a Lindsey Vieira, Zona Norte / Distribuidor a Marcos Gutierrez y Zona Este / Transcontinental Sur a Roberth Ferrufino. Las fotos optimizadas están en `public/asesores/` y cada contacto las vincula con su campo `foto`; la web muestra una tarjeta con foto grande e información integrada, o solo información cuando no hay foto. Las rutas sin número responden sin inventar contactos. Para activar una pregunta frecuente, completar su dato y habilitarla en ese archivo.

Los textos aprobados están definidos una sola vez en `datos/fitoquim.json`; el bot comparte el texto, el contexto y el mensaje prearmado entre web y WhatsApp. WhatsApp envía una tarjeta interactiva `cta_url` con imagen pública JPEG, texto, nombre, cargo y botón “Contactar”, seguida inmediatamente de un único menú principal. Si Meta rechaza el encabezado con foto, reintenta la CTA sin imagen y registra el error; no envía imágenes o tarjetas nativas separadas.

La web integra foto, texto y datos del contacto en una tarjeta con una sola acción: “Contactar por WhatsApp”. Muestra el menú debajo automáticamente sin duplicarlo y no genera descargas de contactos.

Para volver al inicio, escribir `menu`, `menú`, `volver`, `volver al menú`, `inicio`, `principal` o `reiniciar`. En la web, el botón permanente “↩ Volver al menú” conserva la misma sesión. El indicador de escritura muestra tres puntos durante unos 420 ms y las animaciones respetan la preferencia de reducir movimiento.

WhatsApp permite 15 mensajes del bot en 24 horas y 6 en 5 minutos, con un único aviso durante cada bloqueo. Cada derivación reserva dos mensajes: tarjeta CTA y menú. Los envíos fallidos se descuentan. Los cierres simples no generan respuesta. Los límites web existentes son 80 y 20 respectivamente. Sesiones, deduplicación y contadores se mantienen en memoria, se limpian periódicamente y se reinician con el proceso.
