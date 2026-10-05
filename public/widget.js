(() => {
  const script = document.currentScript;
  if (!script?.src || document.getElementById('fitoquim-widget')) return;
  const origen = new URL(script.src).origin;
  const contenedor = document.createElement('div');
  contenedor.id = 'fitoquim-widget';
  const raiz = contenedor.attachShadow({ mode: 'open' });
  const estilo = document.createElement('style');
  estilo.textContent = `
    :host { position:fixed; right:16px; bottom:16px; z-index:2147483647; font-family:Arial,sans-serif; }
    * { box-sizing:border-box; }
    button { width:56px; height:56px; display:grid; place-items:center; margin-left:auto;
      border:1px solid #ffffff35; border-radius:20px; background:linear-gradient(135deg,#0b5da6,#0597c0); color:white; cursor:pointer;
      box-shadow:0 6px 24px #0b5da630; font:28px Arial,sans-serif; transition:transform 150ms,box-shadow 150ms; }
    button:hover { transform:translateY(-2px); box-shadow:0 8px 28px #0b5da640; }
    button:focus-visible { outline:3px solid #4fb3cf; outline-offset:3px; }
    section { position:absolute; right:0; bottom:68px; width:min(390px,calc(100vw - 32px)); height:min(650px,calc(100dvh - 104px));
      background:white; border:1px solid #d8e7f2; border-radius:20px; overflow:hidden;
      box-shadow:0 16px 48px #123d6024; opacity:1; visibility:visible; transform:translateY(0) scale(1);
      transform-origin:bottom right; transition:opacity 180ms,transform 180ms,visibility 180ms; }
    section[hidden] { display:block; opacity:0; visibility:hidden; pointer-events:none; transform:translateY(10px) scale(.98); }
    iframe { display:block; width:100%; height:100%; border:0; }
    @media(max-width:520px) {
      :host { right:8px; bottom:8px; }
      section { width:calc(100vw - 16px); height:calc(100dvh - 88px); }
    }
    @media(prefers-reduced-motion:reduce) { button,section { transition:none; } }
  `;
  const panel = document.createElement('section');
  panel.id = 'panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Chat FITOQUIM');
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.setAttribute('aria-controls', 'panel');
  boton.setAttribute('aria-expanded', 'false');
  const icono = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icono.setAttribute('width', '26');
  icono.setAttribute('height', '26');
  icono.setAttribute('viewBox', '0 0 24 24');
  icono.setAttribute('aria-hidden', 'true');
  const trazo = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  trazo.setAttribute('fill', 'none');
  trazo.setAttribute('stroke', 'currentColor');
  trazo.setAttribute('stroke-width', '2');
  icono.append(trazo);
  boton.append(icono);
  let iframe;
  function mostrar(abierto) {
    if (abierto && !iframe) {
      iframe = document.createElement('iframe');
      iframe.src = origen + '/chat/?embebido=1';
      iframe.title = 'Asistente FITOQUIM';
      panel.append(iframe);
    }
    panel.hidden = !abierto;
    boton.setAttribute('aria-expanded', String(abierto));
    boton.setAttribute('aria-label', abierto ? 'Cerrar chat FITOQUIM' : 'Abrir chat FITOQUIM');
    trazo.setAttribute('d', abierto ? 'M6 6l12 12M18 6L6 18' : 'M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4Z');
    if (!abierto) boton.focus();
  }
  boton.addEventListener('click', () => mostrar(panel.hidden));
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && !panel.hidden) mostrar(false);
  });
  window.addEventListener('message', (evento) => {
    if (evento.origin === origen && evento.source === iframe?.contentWindow && evento.data === 'fitoquim:cerrar') mostrar(false);
  });
  raiz.append(estilo, panel, boton);
  trazo.setAttribute('d', 'M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4Z');
  boton.setAttribute('aria-label', 'Abrir chat FITOQUIM');
  document.body.append(contenedor);
})();
