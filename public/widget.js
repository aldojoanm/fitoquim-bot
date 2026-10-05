(() => {
  if (
    window.__FITOQUIM_WIDGET__
  ) {
    return;
  }

  window.__FITOQUIM_WIDGET__ =
    true;

  const script =
    document.currentScript ||
    Array.from(
      document.scripts,
    ).find((elemento) =>
      elemento.src.includes(
        '/widget.js',
      ),
    );

  if (!script?.src) {
    return;
  }

  const origen =
    new URL(
      script.src,
    ).origin;

  const estilo =
    document.createElement(
      'style',
    );

  estilo.textContent = `
    #fitoquim-widget {
      position: fixed;
      right: 22px;
      bottom: 22px;
      z-index: 2147483000;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    #fitoquim-widget-panel {
      position: absolute;
      right: 0;
      bottom: 76px;
      width: min(390px, calc(100vw - 32px));
      height: min(650px, calc(100vh - 120px));
      overflow: hidden;
      border: 1px solid rgba(11, 93, 166, 0.12);
      border-radius: 24px;
      background: #ffffff;
      box-shadow:
        0 28px 80px rgba(18, 43, 61, 0.22),
        0 8px 24px rgba(18, 43, 61, 0.1);
      opacity: 0;
      visibility: hidden;
      transform: translateY(14px) scale(0.97);
      transform-origin: bottom right;
      transition:
        opacity 180ms ease,
        transform 180ms ease,
        visibility 180ms ease;
    }

    #fitoquim-widget-panel.fitoquim-abierto {
      opacity: 1;
      visibility: visible;
      transform: translateY(0) scale(1);
    }

    #fitoquim-widget-iframe {
      width: 100%;
      height: 100%;
      display: block;
      border: 0;
      background: #ffffff;
    }

    #fitoquim-widget-boton {
      position: relative;
      width: 62px;
      height: 62px;
      padding: 0;
      display: grid;
      place-items: center;
      cursor: pointer;
      color: #ffffff;
      border: 0;
      border-radius: 50%;
      background:
        linear-gradient(
          135deg,
          #0b5da6,
          #0597c0
        );
      box-shadow:
        0 14px 34px rgba(11, 93, 166, 0.3),
        0 4px 12px rgba(11, 93, 166, 0.16);
      transition:
        transform 160ms ease,
        box-shadow 160ms ease;
    }

    #fitoquim-widget-boton:hover {
      transform: translateY(-2px) scale(1.025);
      box-shadow:
        0 18px 40px rgba(11, 93, 166, 0.34),
        0 5px 14px rgba(11, 93, 166, 0.18);
    }

    #fitoquim-widget-boton:focus-visible {
      outline: 4px solid rgba(79, 179, 207, 0.28);
      outline-offset: 4px;
    }

    #fitoquim-widget-boton svg {
      width: 27px;
      height: 27px;
      fill: currentColor;
    }

    #fitoquim-widget-indicador {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 13px;
      height: 13px;
      border: 3px solid #ffffff;
      border-radius: 50%;
      background: #4fb3cf;
    }

    @media (max-width: 600px) {
      #fitoquim-widget {
        right: 16px;
        bottom: 16px;
      }

      #fitoquim-widget-panel {
        position: fixed;
        left: 10px;
        top: 10px;
        right: 10px;
        bottom: 88px;
        width: auto;
        height: auto;
        border-radius: 22px;
      }

      #fitoquim-widget-boton {
        width: 60px;
        height: 60px;
      }
    }
  `;

  document.head.appendChild(
    estilo,
  );

  const widget =
    document.createElement(
      'div',
    );

  widget.id =
    'fitoquim-widget';

  const panel =
    document.createElement(
      'div',
    );

  panel.id =
    'fitoquim-widget-panel';

  panel.setAttribute(
    'aria-hidden',
    'true',
  );

  const iframe =
    document.createElement(
      'iframe',
    );

  iframe.id =
    'fitoquim-widget-iframe';

  iframe.title =
    'Asistente virtual de FITOQUIM';

  iframe.src =
    `${origen}/chat/?embebido=1`;

  iframe.setAttribute(
    'allow',
    'clipboard-write',
  );

  panel.appendChild(
    iframe,
  );

  const boton =
    document.createElement(
      'button',
    );

  boton.id =
    'fitoquim-widget-boton';

  boton.type = 'button';

  boton.setAttribute(
    'aria-label',
    'Abrir asistente de FITOQUIM',
  );

  boton.setAttribute(
    'aria-expanded',
    'false',
  );

  const iconoChat = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4l4 4 4-4h4a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm-12 9a1.25 1.25 0 1 1 0-2.5A1.25 1.25 0 0 1 8 11Zm4 0a1.25 1.25 0 1 1 0-2.5A1.25 1.25 0 0 1 12 11Zm4 0a1.25 1.25 0 1 1 0-2.5A1.25 1.25 0 0 1 16 11Z"/>
    </svg>
    <span id="fitoquim-widget-indicador"></span>
  `;

  const iconoCerrar = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 1 0-1.4 1.4l4.9 4.9-4.9 4.9a1 1 0 1 0 1.4 1.4l4.9-4.9 4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4Z"/>
    </svg>
  `;

  let abierto = false;

  function actualizar() {
    panel.classList.toggle(
      'fitoquim-abierto',
      abierto,
    );

    panel.setAttribute(
      'aria-hidden',
      String(!abierto),
    );

    boton.setAttribute(
      'aria-expanded',
      String(abierto),
    );

    boton.setAttribute(
      'aria-label',
      abierto
        ? 'Cerrar asistente de FITOQUIM'
        : 'Abrir asistente de FITOQUIM',
    );

    boton.innerHTML =
      abierto
        ? iconoCerrar
        : iconoChat;
  }

  boton.addEventListener(
    'click',
    () => {
      abierto = !abierto;
      actualizar();
    },
  );

  window.addEventListener(
    'keydown',
    (evento) => {
      if (
        evento.key ===
          'Escape' &&
        abierto
      ) {
        abierto = false;
        actualizar();
        boton.focus();
      }
    },
  );

  widget.appendChild(panel);
  widget.appendChild(boton);

  document.body.appendChild(
    widget,
  );

  actualizar();
})();