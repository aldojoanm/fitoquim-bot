const mensajes =
  document.getElementById(
    'mensajes',
  );

const formulario =
  document.getElementById(
    'formulario',
  );

const entrada =
  document.getElementById(
    'entrada',
  );

const botonEnviar =
  document.getElementById(
    'enviar',
  );

const botonMenu =
  document.getElementById(
    'volver-menu',
  );

const CLAVE_SESION =
  'fitoquim_chat_sesion';

let procesando = false;

function generarSesion() {
  if (
    globalThis.crypto
      ?.randomUUID
  ) {
    return crypto
      .randomUUID()
      .replace(/-/g, '_');
  }

  return (
    'web_' +
    Date.now().toString(36) +
    '_' +
    Math.random()
      .toString(36)
      .slice(2, 14)
  );
}

function obtenerSesion() {
  let sesion =
    localStorage.getItem(
      CLAVE_SESION,
    );

  if (
    !sesion ||
    !/^[a-zA-Z0-9_-]{10,120}$/.test(
      sesion,
    )
  ) {
    sesion =
      generarSesion();

    localStorage.setItem(
      CLAVE_SESION,
      sesion,
    );
  }

  return sesion;
}

const sesionId =
  obtenerSesion();

function desplazarseAbajo() {
  requestAnimationFrame(() => {
    mensajes.scrollTo({
      top:
        mensajes.scrollHeight,
      behavior: 'smooth',
    });
  });
}

function crearMensaje(
  texto,
  tipo = 'asistente',
) {
  const fila =
    document.createElement(
      'div',
    );

  fila.className =
    `fila-mensaje ${tipo}`;

  const burbuja =
    document.createElement(
      'div',
    );

  burbuja.className =
    'burbuja';

  burbuja.textContent =
    texto;

  fila.appendChild(
    burbuja,
  );

  mensajes.appendChild(
    fila,
  );

  desplazarseAbajo();

  return fila;
}

function mostrarEscribiendo() {
  const fila =
    document.createElement(
      'div',
    );

  fila.className =
    'fila-mensaje asistente escribiendo-fila';

  fila.innerHTML = `
    <div class="burbuja escribiendo">
      <span></span>
      <span></span>
      <span></span>
    </div>
  `;

  mensajes.appendChild(
    fila,
  );

  desplazarseAbajo();

  return fila;
}

function esperar(ms) {
  return new Promise(
    (resolver) =>
      setTimeout(
        resolver,
        ms,
      ),
  );
}

function desactivarOpciones() {
  document
    .querySelectorAll(
      '.opciones-chat.activo',
    )
    .forEach(
      (grupo) => {
        grupo.classList.remove(
          'activo',
        );

        grupo
          .querySelectorAll(
            'button',
          )
          .forEach(
            (boton) => {
              boton.disabled = true;
            },
          );
      },
    );
}

async function solicitar(
  ruta,
  cuerpo,
) {
  const respuesta =
    await fetch(
      ruta,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
        },
        body: JSON.stringify(
          cuerpo,
        ),
      },
    );

  const datos =
    await respuesta.json();

  if (
    !respuesta.ok ||
    !datos.ok
  ) {
    throw new Error(
      datos.error ||
      'No se pudo procesar la consulta.',
    );
  }

  return datos.respuesta;
}

async function enviarEntrada(
  texto,
  mostrarUsuario = true,
) {
  if (
    procesando ||
    !texto
  ) {
    return;
  }

  procesando = true;

  entrada.disabled = true;
  botonEnviar.disabled = true;
  botonMenu.disabled = true;

  if (mostrarUsuario) {
    crearMensaje(
      texto,
      'usuario',
    );
  }

  desactivarOpciones();

  const indicador =
    mostrarEscribiendo();

  try {
    const respuesta =
      await solicitar(
        '/api/chat/mensaje',
        {
          sesionId,
          texto,
        },
      );

    await esperar(430);

    indicador.remove();

    await renderizarRespuesta(
      respuesta,
      false,
    );
  } catch (error) {
    indicador.remove();

    crearMensaje(
      'No pudimos procesar la consulta. Intente nuevamente.',
    );

    console.error(error);
  } finally {
    procesando = false;

    entrada.disabled = false;
    botonEnviar.disabled = false;
    botonMenu.disabled = false;

    entrada.focus();
  }
}

function crearOpciones(
  opciones,
) {
  const grupo =
    document.createElement(
      'div',
    );

  grupo.className =
    'opciones-chat activo';

  for (
    const opcion of
    opciones || []
  ) {
    const boton =
      document.createElement(
        'button',
      );

    boton.type = 'button';

    boton.className =
      'opcion-chat';

    boton.textContent =
      opcion.etiqueta;

    boton.addEventListener(
      'click',
      () => {
        if (
          boton.disabled ||
          procesando
        ) {
          return;
        }

        enviarEntrada(
          opcion.payload,
          false,
        );

        crearMensaje(
          opcion.etiqueta,
          'usuario',
        );
      },
    );

    grupo.appendChild(
      boton,
    );
  }

  mensajes.appendChild(
    grupo,
  );

  desplazarseAbajo();
}

function crearUrlWhatsApp(
  contacto,
) {
  const telefono =
    String(
      contacto.telefonoDigitos ||
      contacto.telefono ||
      '',
    ).replace(/\D/g, '');

  const mensaje =
    encodeURIComponent(
      contacto.mensajeWhatsApp ||
      'Hola, vengo del asistente de FITOQUIM.',
    );

  return `https://wa.me/${telefono}?text=${mensaje}`;
}

function crearTarjetaContacto(
  respuesta,
) {
  const contacto =
    respuesta.contacto;

  const tarjeta =
    document.createElement(
      'article',
    );

  tarjeta.className =
    'tarjeta-contacto';

  if (contacto.foto) {
    const contenedorImagen =
      document.createElement(
        'div',
      );

    contenedorImagen.className =
      'contacto-imagen';

    const imagen =
      document.createElement(
        'img',
      );

    imagen.src =
      contacto.foto;

    imagen.alt =
      contacto.nombre;

    imagen.loading =
      'eager';

    imagen.addEventListener(
      'error',
      () => {
        contenedorImagen.remove();
      },
    );

    contenedorImagen.appendChild(
      imagen,
    );

    tarjeta.appendChild(
      contenedorImagen,
    );
  }

  const contenido =
    document.createElement(
      'div',
    );

  contenido.className =
    'contacto-contenido';

  if (respuesta.texto) {
    const texto =
      document.createElement(
        'p',
      );

    texto.className =
      'contacto-texto';

    texto.textContent =
      respuesta.texto;

    contenido.appendChild(
      texto,
    );
  }

  const divisor =
    document.createElement(
      'div',
    );

  divisor.className =
    'contacto-divisor';

  contenido.appendChild(
    divisor,
  );

  const nombre =
    document.createElement(
      'h2',
    );

  nombre.textContent =
    contacto.nombre;

  contenido.appendChild(
    nombre,
  );

  if (contacto.cargo) {
    const cargo =
      document.createElement(
        'p',
      );

    cargo.className =
      'contacto-cargo';

    cargo.textContent =
      contacto.cargo;

    contenido.appendChild(
      cargo,
    );
  }

  if (contacto.telefono) {
    const telefono =
      document.createElement(
        'p',
      );

    telefono.className =
      'contacto-telefono';

    telefono.textContent =
      contacto.telefono;

    contenido.appendChild(
      telefono,
    );
  }

  const enlace =
    document.createElement(
      'a',
    );

  enlace.className =
    'contacto-whatsapp';

  enlace.href =
    crearUrlWhatsApp(
      contacto,
    );

  enlace.target =
    '_blank';

  enlace.rel =
    'noopener noreferrer';

  enlace.innerHTML = `
    <span>Contactar por WhatsApp</span>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.8 12.9c-.2-.1-1.3-.7-1.5-.7-.2-.1-.4-.1-.6.1-.2.2-.6.7-.7.9-.1.2-.3.2-.5.1-1.4-.7-2.4-1.3-3.3-2.9-.2-.3.2-.3.6-1 .1-.2.1-.4 0-.5 0-.1-.6-1.5-.8-2-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.2-.9.9-.9 2.1 0 1.3.9 2.5 1.1 2.6.1.2 1.8 2.8 4.4 3.9.6.3 1.1.4 1.5.5.6.2 1.2.2 1.6.1.5-.1 1.3-.5 1.5-1 .2-.5.2-1 .2-1.1-.1-.1-.2-.2-.4-.3Z"/>
      <path d="M20.5 3.5A11.9 11.9 0 0 0 12 0C5.4 0 0 5.4 0 12c0 2.1.6 4.2 1.6 6L0 24l6.2-1.6A12 12 0 0 0 12 24c6.6 0 12-5.4 12-12 0-3.2-1.2-6.2-3.5-8.5ZM12 22a9.9 9.9 0 0 1-5.1-1.4l-.4-.2-3.7 1 1-3.6-.2-.4A10 10 0 1 1 12 22Z"/>
    </svg>
  `;

  contenido.appendChild(
    enlace,
  );

  tarjeta.appendChild(
    contenido,
  );

  mensajes.appendChild(
    tarjeta,
  );

  desplazarseAbajo();
}

async function renderizarRespuesta(
  respuesta,
  usarEscribiendo = true,
) {
  if (!respuesta) {
    return;
  }

  let indicador = null;

  if (usarEscribiendo) {
    indicador =
      mostrarEscribiendo();

    await esperar(430);

    indicador.remove();
  }

  if (
    respuesta.tipo ===
    'opciones'
  ) {
    if (respuesta.texto) {
      crearMensaje(
        respuesta.texto,
      );
    }

    crearOpciones(
      respuesta.opciones,
    );

    return;
  }

  if (
    respuesta.tipo ===
    'contacto'
  ) {
    crearTarjetaContacto(
      respuesta,
    );

    if (respuesta.menu) {
      await esperar(220);

      if (
        respuesta.menu.texto
      ) {
        crearMensaje(
          respuesta.menu.texto,
        );
      }

      crearOpciones(
        respuesta.menu.opciones,
      );
    }

    return;
  }

  if (
    respuesta.tipo ===
    'texto'
  ) {
    if (respuesta.texto) {
      crearMensaje(
        respuesta.texto,
      );
    }

    if (respuesta.menu) {
      await esperar(220);

      if (
        respuesta.menu.texto
      ) {
        crearMensaje(
          respuesta.menu.texto,
        );
      }

      crearOpciones(
        respuesta.menu.opciones,
      );
    }

    return;
  }

  crearMensaje(
    'No pudimos mostrar esta respuesta.',
  );
}

async function iniciar() {
  entrada.disabled = true;
  botonEnviar.disabled = true;
  botonMenu.disabled = true;

  const indicador =
    mostrarEscribiendo();

  try {
    const respuesta =
      await solicitar(
        '/api/chat/iniciar',
        {
          sesionId,
        },
      );

    await esperar(480);

    indicador.remove();

    await renderizarRespuesta(
      respuesta,
      false,
    );
  } catch (error) {
    indicador.remove();

    crearMensaje(
      'No pudimos iniciar el asistente. Intente nuevamente.',
    );

    console.error(error);
  } finally {
    entrada.disabled = false;
    botonEnviar.disabled = false;
    botonMenu.disabled = false;

    entrada.focus();
  }
}

formulario.addEventListener(
  'submit',
  (evento) => {
    evento.preventDefault();

    const texto =
      entrada.value.trim();

    if (
      !texto ||
      procesando
    ) {
      return;
    }

    entrada.value = '';

    enviarEntrada(
      texto,
      true,
    );
  },
);

botonMenu.addEventListener(
  'click',
  () => {
    if (procesando) {
      return;
    }

    enviarEntrada(
      'menu',
      false,
    );
  },
);

iniciar();