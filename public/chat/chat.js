const mensajes = document.getElementById('mensajes');
const formulario = document.getElementById('formulario');
const campoTexto = document.getElementById('texto');
const botonEnviar = document.getElementById('enviar');
const botonMenu = document.getElementById('volver-menu');
const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CLAVE_SESION = 'fitoquim_chat_sesion';

function crearSesionId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replaceAll('-', '_');
  }

  return `sesion_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
}

function obtenerSesionId() {
  try {
    let id = localStorage.getItem(CLAVE_SESION);
    if (!id || !/^[a-zA-Z0-9_-]{10,120}$/.test(id)) {
      id = crearSesionId();
      localStorage.setItem(CLAVE_SESION, id);
    }
    return id;
  } catch {
    return crearSesionId();
  }
}

const sesionId = obtenerSesionId();
let ocupado = false;
const embebido = new URLSearchParams(location.search).get('embebido') === '1';
if (embebido) {
  document.documentElement.classList.add('embebido');
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') window.parent.postMessage('fitoquim:cerrar', '*');
  });
}

function desplazarAbajo() {
  requestAnimationFrame(() => {
    mensajes.scrollTop = mensajes.scrollHeight;
  });
}

function agregarMensaje(texto, autor = 'bot') {
  const contenedor = document.createElement('div');
  contenedor.className = `mensaje mensaje--${autor}`;

  const burbuja = document.createElement('div');
  burbuja.className = 'mensaje__burbuja';
  burbuja.textContent = texto;

  contenedor.appendChild(burbuja);
  mensajes.appendChild(contenedor);
  desplazarAbajo();
}

function agregarEstado(texto) {
  const estado = document.createElement('div');
  estado.className = 'estado';
  estado.textContent = texto;
  if (texto === 'Escribiendo...') {
    estado.classList.add('estado--escribiendo');
    const puntos = document.createElement('span');
    puntos.className = 'estado__puntos';
    puntos.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i += 1) puntos.appendChild(document.createElement('i'));
    estado.appendChild(puntos);
  }
  mensajes.appendChild(estado);
  desplazarAbajo();
  return estado;
}

function agregarContacto(respuesta) {
  const contacto = respuesta.contacto;
  const tarjeta = document.createElement('article');
  tarjeta.className = 'contacto';
  if (contacto.foto) {
    const foto = document.createElement('img');
    foto.className = 'contacto__foto';
    foto.src = contacto.foto;
    foto.alt = contacto.nombre;
    foto.loading = 'lazy';
    foto.addEventListener('error', () => foto.remove());
    tarjeta.appendChild(foto);
  }
  const contenido = document.createElement('div');
  contenido.className = 'contacto__contenido';
  const texto = document.createElement('p');
  texto.className = 'contacto__texto';
  texto.textContent = respuesta.texto;
  const nombre = document.createElement('h2');
  nombre.textContent = contacto.nombre;
  const cargo = document.createElement('p');
  cargo.textContent = contacto.cargo;
  const numero = document.createElement('div');
  numero.className = 'contacto__numero';
  numero.textContent = contacto.telefono;
  const whatsapp = document.createElement('a');
  whatsapp.className = 'contacto__whatsapp';
  whatsapp.href = 'https://wa.me/' + contacto.telefonoDigitos + '?text=' + encodeURIComponent(contacto.mensajeWhatsApp);
  whatsapp.target = '_blank';
  whatsapp.rel = 'noopener noreferrer';
  whatsapp.textContent = 'Contactar por WhatsApp';
  contenido.append(texto, nombre, cargo, numero, whatsapp);
  tarjeta.appendChild(contenido);
  mensajes.appendChild(tarjeta);
  desplazarAbajo();
}

function bloquearOpcionesAnteriores() {
  mensajes.querySelectorAll('.opcion:not(:disabled)').forEach((boton) => {
    boton.disabled = true;
  });
}

function agregarOpciones(opciones = [], nodoId = "") {
  const contenedor = document.createElement('div');
  contenedor.className = 'opciones';
  contenedor.dataset.nodoId = nodoId;

  opciones.forEach((opcion, indice) => {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'opcion';
    boton.style.animationDelay = (indice * 35) + 'ms';

    const titulo = document.createElement('strong');
    titulo.textContent = opcion.etiqueta;
    boton.appendChild(titulo);

    if (opcion.descripcion) {
      const descripcion = document.createElement('span');
      descripcion.textContent = opcion.descripcion;
      boton.appendChild(descripcion);
    }

    boton.addEventListener('click', async () => {
      if (ocupado) return;

      bloquearOpcionesAnteriores();
      agregarMensaje(opcion.etiqueta, 'usuario');
      await enviarAlBot(opcion.payload);
    });

    contenedor.appendChild(boton);
  });

  mensajes.appendChild(contenedor);
  desplazarAbajo();
}

function renderizarRespuesta(respuesta) {
  if (!respuesta) return;

  if (respuesta.tipo === 'texto') {
    agregarMensaje(respuesta.texto, 'bot');
    return;
  }

  if (respuesta.tipo === 'contacto') {
    agregarContacto(respuesta);
    if (respuesta.menu && !mensajes.querySelector('.opciones[data-nodo-id="inicio"] .opcion:not(:disabled)')) {
      renderizarRespuesta({ ...respuesta.menu, texto: respuesta.menu.textoDespuesContacto || respuesta.menu.texto });
    }
    return;
  }

  if (respuesta.tipo === 'opciones') {
    agregarMensaje(respuesta.texto, 'bot');
    agregarOpciones(respuesta.opciones || [], respuesta.nodoId);
    return;
  }

  agregarMensaje('No pude mostrar la respuesta. Escriba “menú” para volver al inicio.', 'bot');
}

async function peticion(ruta, cuerpo) {
  const respuesta = await fetch(ruta, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
  });

  const datos = await respuesta.json().catch(() => null);

  if (!respuesta.ok || !datos?.ok) {
    throw new Error(datos?.error || `Error ${respuesta.status}`);
  }

  return datos;
}

function establecerOcupado(valor) {
  ocupado = valor;
  campoTexto.disabled = valor;
  botonEnviar.disabled = valor;
  botonMenu.disabled = valor;
  mensajes.setAttribute('aria-busy', String(valor));
}

async function enviarAlBot(texto, volverMenu = false) {
  establecerOcupado(true);
  const estado = agregarEstado('Escribiendo...');

  try {
    const [datos] = await Promise.all([peticion('/api/chat/mensaje', {
      sesionId,
      texto,
    }), new Promise((resolve) => setTimeout(resolve, reducirMovimiento || volverMenu ? 0 : 420))]);

    estado.remove();
    renderizarRespuesta(datos.respuesta);
  } catch (error) {
    estado.textContent = 'No se pudo conectar con el asistente. Intente nuevamente.';
    console.error(error);
  } finally {
    establecerOcupado(false);
    campoTexto.focus();
  }
}

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (ocupado) return;

  const texto = campoTexto.value.trim();
  if (!texto) return;

  campoTexto.value = '';
  bloquearOpcionesAnteriores();
  agregarMensaje(texto, 'usuario');
  await enviarAlBot(texto);
});

botonMenu.addEventListener('click', async () => {
  if (ocupado) return;
  bloquearOpcionesAnteriores();
  campoTexto.value = '';
  await enviarAlBot('IR:inicio', true);
});

async function iniciar() {
  establecerOcupado(true);
  const estado = agregarEstado('Escribiendo...');

  try {
    const [datos] = await Promise.all([peticion('/api/chat/iniciar', { sesionId }),
      new Promise((resolve) => setTimeout(resolve, reducirMovimiento ? 0 : 350))]);
    estado.remove();
    renderizarRespuesta(datos.respuesta);
  } catch (error) {
    estado.textContent = 'No se pudo iniciar el asistente.';
    console.error(error);
  } finally {
    establecerOcupado(false);
  }
}

iniciar();
