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
```

- `META_VERIFY_TOKEN`: clave creada por nosotros para verificar el webhook. Es distinta del Access Token.
- `META_ACCESS_TOKEN`: token generado por Meta para enviar mensajes.
- `META_PHONE_NUMBER_ID`: ID interno del número de WhatsApp, no el número +591.
- `META_WABA_ID`: ID de la cuenta de WhatsApp Business; está disponible en la configuración, pero no es obligatorio para enviar mensajes.
- `META_APP_SECRET`: secreto de la app de Meta para validar `x-hub-signature-256`. Sin este secreto, el POST del webhook devuelve 503.
- `META_API_VERSION`: versión de Cloud API, inicialmente `v24.0`.
- `ORIGENES_WEB_PERMITIDOS`: orígenes HTTP/HTTPS separados por comas, sin rutas ni barras finales. Restringen las llamadas externas a `/api/chat` y las páginas que pueden embeber `/chat/`. Incluir los dominios autorizados del sitio externo. El chat puede abrirse directamente desde el servidor del bot.

## Webhook

`https://DOMINIO/webhook/whatsapp`

Configurar en Meta el mismo `META_VERIFY_TOKEN` y suscribirse al evento de mensajes de WhatsApp. El webhook verifica firmas, ignora eventos irrelevantes y evita duplicados recientes en memoria.

## Salud

`https://DOMINIO/salud`

Devuelve `{"ok":true,"servicio":"FITOQUIM Bot"}` sin configuración sensible.

## Chat

`https://DOMINIO/chat/`

Utiliza `POST /api/chat/iniciar` y `POST /api/chat/mensaje`. Mantiene el identificador de sesión en localStorage cuando está disponible y permite descargar contactos en formato `.vcf`.

## Widget

El sitio externo solo necesita insertar este script:

```html
<script
  src="https://DOMINIO/widget.js"
  defer
></script>
```

El script detecta el origen del bot y abre `/chat/?embebido=1` en un iframe. Agregar el origen del sitio anfitrión a `ORIGENES_WEB_PERMITIDOS`. Los cambios futuros del chatbot no requieren modificar la web externa.

En `datos/fitoquim.json` faltan el horario, la dirección, Google Maps y el teléfono general. Conocer productos dirige a Lindsey Vieira, Zona Norte / Distribuidor a Marcos Gutierrez y Zona Este / Transcontinental Sur a Roberth Ferrufino. Las fotos optimizadas están en `public/asesores/` y cada contacto las vincula con su campo `foto`; el chat muestra iniciales cuando no hay foto disponible. Las rutas sin número responden sin inventar contactos. Para activar una pregunta frecuente, completar su dato y habilitarla en ese archivo.

El bot centraliza el texto de derivación y el mensaje prearmado de WhatsApp según el área y la zona del nodo. En WhatsApp envía texto breve, foto disponible y tarjeta nativa, en ese orden: tres mensajes con foto y dos sin ella. Las copias JPEG comprimidas se suben directamente a Meta; la web utiliza WebP. Si falla la foto, se continúa con el contacto. No es necesario configurar un dominio público para cargar las imágenes.

Para volver al inicio, escribir `menu`, `menú`, `volver`, `volver al menú`, `inicio`, `principal` o `reiniciar`. En la web, el botón permanente “↩ Volver al menú” conserva la misma sesión. El indicador de escritura dura brevemente y las animaciones respetan la preferencia de reducir movimiento.

WhatsApp permite 15 mensajes del bot en 24 horas y 6 en 5 minutos, con un único aviso durante cada bloqueo. Cada texto, imagen y tarjeta cuenta como un mensaje; se reserva capacidad para la derivación completa y se descuentan los envíos fallidos. Los cierres simples no generan respuesta. Los límites web existentes son 80 y 20 respectivamente. Sesiones, deduplicación y contadores se mantienen en memoria, se limpian periódicamente y se reinician con el proceso.
