const mensajes = document.getElementById('mensajes');
const formulario = document.getElementById('formulario');
const campoTexto = document.getElementById('texto');
const botonEnviar = document.getElementById('enviar');

const CLAVE_SESION = 'fitoquim_chat_sesion';

function crearSesionId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replaceAll('-', '_');
  }

  return `sesion_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
}

function obtenerSesionId() {
  let id = localStorage.getItem(CLAVE_SESION);
  if (!id) {
    id = crearSesionId();
    localStorage.setItem(CLAVE_SESION, id);
  }
  return id;
}

const sesionId = obtenerSesionId();
let ocupado = false;

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
  mensajes.appendChild(estado);
  desplazarAbajo();
  return estado;
}

function iniciales(nombre = '') {
  return String(nombre)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() || '')
    .join('') || 'F';
}

function descargarVcard(contacto) {
  const contenido = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${contacto.nombre}`,
    `ORG:${contacto.empresa || 'FITOQUIM SRL'}`,
    contacto.cargo ? `TITLE:${contacto.cargo}` : '',
    `TEL;TYPE=CELL:${contacto.telefono}`,
    'END:VCARD',
  ]
    .filter(Boolean)
    .join('\r\n');

  const archivo = new Blob([contenido], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(archivo);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `${contacto.nombre.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_-]+/g, '-')}.vcf`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}

function agregarContacto(contacto) {
  const tarjeta = document.createElement('article');
  tarjeta.className = 'contacto';

  const principal = document.createElement('div');
  principal.className = 'contacto__principal';

  const avatar = document.createElement('div');
  avatar.className = 'contacto__iniciales';
  avatar.textContent = iniciales(contacto.nombre);

  const info = document.createElement('div');

  const nombre = document.createElement('h2');
  nombre.textContent = contacto.nombre;

  const cargo = document.createElement('p');
  cargo.textContent = contacto.cargo || contacto.empresa || 'FITOQUIM SRL';

  info.append(nombre, cargo);
  principal.append(avatar, info);

  const numero = document.createElement('div');
  numero.className = 'contacto__numero';
  numero.textContent = contacto.telefono;

  const acciones = document.createElement('div');
  acciones.className = 'contacto__acciones';

  const whatsapp = document.createElement('a');
  whatsapp.className = 'contacto__whatsapp';
  whatsapp.href = `https://wa.me/${contacto.telefonoDigitos}`;
  whatsapp.target = '_blank';
  whatsapp.rel = 'noopener noreferrer';
  whatsapp.textContent = 'WhatsApp';

  const guardar = document.createElement('button');
  guardar.type = 'button';
  guardar.className = 'contacto__guardar';
  guardar.textContent = 'Guardar contacto';
  guardar.addEventListener('click', () => descargarVcard(contacto));

  acciones.append(whatsapp, guardar);
  tarjeta.append(principal, numero, acciones);
  mensajes.appendChild(tarjeta);
  desplazarAbajo();
}

function bloquearOpcionesAnteriores() {
  mensajes.querySelectorAll('.opcion:not(:disabled)').forEach((boton) => {
    boton.disabled = true;
  });
}

function agregarOpciones(opciones = []) {
  const contenedor = document.createElement('div');
  contenedor.className = 'opciones';

  opciones.forEach((opcion) => {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'opcion';

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
    agregarContacto(respuesta.contacto);
    return;
  }

  if (respuesta.tipo === 'opciones') {
    agregarMensaje(respuesta.texto, 'bot');
    agregarOpciones(respuesta.opciones || []);
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
}

async function enviarAlBot(texto) {
  establecerOcupado(true);
  const estado = agregarEstado('Procesando...');

  try {
    const datos = await peticion('/api/chat/mensaje', {
      sesionId,
      texto,
    });

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

async function iniciar() {
  establecerOcupado(true);
  const estado = agregarEstado('Iniciando...');

  try {
    const datos = await peticion('/api/chat/iniciar', { sesionId });
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
