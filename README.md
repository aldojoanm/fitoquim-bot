# FITOQUIM Bot

Bot determinista para WhatsApp Cloud API y página web. No utiliza IA.

## Estructura

```text
fitoquim-bot/
├── datos/
│   └── fitoquim.json
├── public/
│   ├── asesores/
│   ├── chat/
│   │   ├── index.html
│   │   ├── chat.css
│   │   └── chat.js
│   └── privacidad.html
├── src/
│   ├── bot.js
│   ├── whatsapp.js
│   ├── web.js
│   └── metricas.js
├── metricas/
├── .env
├── .gitignore
├── package.json
├── README.md
└── servidor.js
```

## 1. Instalar

```bash
npm install
```

## 2. Configurar `.env`

Completar como mínimo:

```env
META_VERIFY_TOKEN=
META_ACCESS_TOKEN=
META_PHONE_NUMBER_ID=
META_APP_SECRET=
META_API_VERSION=v24.0
```

`META_API_VERSION` está separado para que pueda actualizarse sin tocar el código.

## 3. Configurar Meta

Webhook:

```text
https://TU-DOMINIO/webhook/whatsapp
```

Token de verificación: el mismo valor de `META_VERIFY_TOKEN`.

Suscribirse al evento de mensajes de WhatsApp.

## 4. Chat web

El bot web queda disponible en:

```text
https://TU-DOMINIO/chat/
```

La forma más sencilla de insertarlo en otra página es mediante un iframe:

```html
<iframe
  src="https://TU-DOMINIO/chat/"
  title="Asistente FITOQUIM"
  style="width:100%;max-width:430px;height:720px;border:0;border-radius:22px"
></iframe>
```

Si el frontend se aloja en otro dominio y llama directamente a la API, agregar el dominio en:

```env
ORIGENES_WEB_PERMITIDOS=https://www.ejemplo.com,https://ejemplo.com
```

## 5. Contactos pendientes

El flujo original recibido indica:

- Zona Norte / Distribuidor → Marco
- Zona Este / Transcontinental Sur → Roberth

No se proporcionaron números para esos dos contactos, por lo que aparecen con `configurado: false` en `datos/fitoquim.json`.

También se utilizó `Carlos Corp` como contacto de Ventas Corporativas para la opción Productos, reemplazando la referencia anterior del flujo a Lindsey Viera.

Cuando tengas los números, solo completar:

```json
"telefono": "+591...",
"configurado": true
```

## 6. Horario y ubicación

Están preparados como preguntas frecuentes ocultas, pero desactivados porque no se proporcionaron datos reales.

En `datos/fitoquim.json` completar y cambiar `habilitado` / `habilitada` a `true`.

## 7. Límite de respuestas

Por defecto:

- WhatsApp: 15 respuestas por usuario en 24 horas.
- WhatsApp: 6 respuestas en 5 minutos.
- Web: 80 respuestas en 24 horas.
- Web: 20 respuestas en 5 minutos.

Cuando un usuario llega al límite se envía un único aviso y después el bot deja de responder hasta que venza la ventana correspondiente.

El control actual se mantiene en memoria. Si Railway reinicia el proceso, los contadores se reinician. Para un límite persistente entre reinicios habría que usar una base externa, pero para este bot no se incluyó esa complejidad de inicio.

## 8. Métricas

Las derivaciones y preguntas frecuentes se guardan localmente en:

```text
metricas/eventos.jsonl
```

El identificador del usuario se guarda anonimizado por defecto.

### Google Sheets opcional

Si se configura `URL_APPS_SCRIPT_METRICAS`, el mismo evento se envía a un Apps Script.

Código sugerido para Apps Script:

```javascript
const HOJA = 'Metricas';

function doPost(e) {
  const datos = JSON.parse(e.postData.contents || '{}');
  const secretoEsperado = PropertiesService.getScriptProperties().getProperty('SECRETO_METRICAS');

  if (secretoEsperado && datos.secreto !== secretoEsperado) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: 'no_autorizado' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const libro = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = libro.getSheetByName(HOJA);

  if (!hoja) hoja = libro.insertSheet(HOJA);

  if (hoja.getLastRow() === 0) {
    hoja.appendRow([
      'Fecha',
      'Canal',
      'Tipo',
      'Área',
      'Zona',
      'Subzona',
      'Contacto',
      'FAQ',
      'Identificador hash'
    ]);
  }

  hoja.appendRow([
    datos.fecha || '',
    datos.canal || '',
    datos.tipo || '',
    datos.area || '',
    datos.zona || '',
    datos.subzona || '',
    datos.contacto || '',
    datos.faq || '',
    datos.identificador_hash || ''
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

En Apps Script crear una propiedad del script llamada `SECRETO_METRICAS` con el mismo valor de `.env`, publicar como aplicación web y copiar la URL en `URL_APPS_SCRIPT_METRICAS`.

## 9. Verificar sintaxis

```bash
npm run revisar
```
