const editorRoot = document.querySelector('#editor-visual');

if (editorRoot) {
  const limites = JSON.parse(editorRoot.dataset.limites || '{}');
  const cambios = new Map();
  const imagenes = new Map();
  const estilo = document.createElement('style');
  estilo.textContent = `
    [data-campo][contenteditable="plaintext-only"]:hover,
    [data-campo][contenteditable="plaintext-only"]:focus {
      outline: 2px dotted #c45336;
      outline-offset: 4px;
      cursor: text;
    }
    .editor-barra {
      position: fixed; z-index: 10000; right: 0; bottom: 0; left: 0;
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 12px 20px; color: #fff; background: #203b32;
      box-shadow: 0 -4px 20px #17231c30; font: 14px/1.4 sans-serif;
    }
    .editor-barra__acciones { display: flex; gap: 9px; }
    .editor-barra button, .editor-panel button {
      min-height: 40px; padding: 0 14px; border: 1px solid #d6dfd8;
      border-radius: 3px; color: #203b32; background: #fff; cursor: pointer;
      font: inherit; font-weight: 650;
    }
    .editor-barra button:last-child { color: #fff; border-color: #c45336; background: #c45336; }
    .editor-barra button:disabled { opacity: .55; cursor: wait; }
    .editor-mensaje { min-width: 0; }
    .editor-contador {
      position: fixed; z-index: 10001; padding: 4px 8px; border-radius: 2px;
      color: #fff; background: #203b32; pointer-events: none;
      font: 12px/1.3 sans-serif;
    }
    .editor-contador[data-excedido="true"] { background: #a52e22; }
    .imagen-editable { position: relative; }
    .editor-imagen-boton {
      position: absolute; z-index: 2; top: 12px; right: 12px;
      padding: 9px 12px; border: 0; border-radius: 2px;
      color: #fff; background: #203b32e8; cursor: pointer;
      font: 13px sans-serif;
    }
    .editor-panel {
      width: min(680px, calc(100vw - 28px)); max-height: 82vh; padding: 0;
      border: 0; border-radius: 4px; color: #203b32; background: #fbf9f4;
      box-shadow: 0 14px 60px #10201855;
    }
    .editor-panel::backdrop { background: #15251ddd; }
    .editor-panel__contenido { padding: 24px; }
    .editor-panel__cabecera { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .editor-panel h2 { margin: 0; font: 26px Georgia, serif; }
    .editor-panel__subtitulo { margin: 22px 0 10px; color: #56645b; font: 13px sans-serif; }
    .editor-galeria { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
    .editor-galeria button { min-height: 0; padding: 4px; text-align: left; }
    .editor-galeria img { display: block; width: 100%; aspect-ratio: 1.25; object-fit: cover; }
    .editor-galeria span { display: block; overflow-wrap: anywhere; padding: 5px 2px 2px; font-size: 11px; }
    .editor-subir { display: inline-flex; align-items: center; gap: 8px; }
    .editor-error { color: #a52e22; }
    .editor-whatsapp { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .editor-whatsapp span { font: 650 16px sans-serif; }
    .editor-whatsapp input {
      flex: 1 1 180px; min-height: 40px; padding: 0 12px; border: 1px solid #b9c5bc;
      border-radius: 3px; font: 18px sans-serif; letter-spacing: .03em;
    }
    @media (max-width: 560px) {
      .editor-barra { align-items: stretch; flex-direction: column; gap: 8px; padding: 10px 12px; }
      .editor-barra__acciones { display: grid; grid-template-columns: 1fr 1fr 1fr; }
      .editor-panel__contenido { padding: 18px; }
    }
  `;
  document.head.append(estilo);

  const contador = document.createElement('span');
  contador.className = 'editor-contador';
  contador.hidden = true;
  document.body.append(contador);

  const barra = document.createElement('aside');
  barra.className = 'editor-barra';
  barra.setAttribute('aria-label', 'Herramientas de edición');
  barra.innerHTML = '<span class="editor-mensaje" aria-live="polite">No hay cambios pendientes.</span><div class="editor-barra__acciones"><button type="button" data-whatsapp>WhatsApp</button><button type="button" data-guardar>Guardar</button><button type="button" data-enviar>Enviar cambios</button></div>';
  document.body.append(barra);

  const mensaje = barra.querySelector('.editor-mensaje');
  const botonGuardar = barra.querySelector('[data-guardar]');
  const botonEnviar = barra.querySelector('[data-enviar]');
  const botonWhatsapp = barra.querySelector('[data-whatsapp]');
  const marcarEnvioPendiente = () => sessionStorage.getItem('editor-cambios-guardados') === '1';

  const actualizarBarra = () => {
    const sinGuardar = cambios.size > 0;
    mensaje.textContent = sinGuardar
      ? 'Hay cambios sin guardar.'
      : marcarEnvioPendiente() ? 'Cambios guardados, listos para enviar.' : 'No hay cambios pendientes.';
    botonEnviar.disabled = sinGuardar ? false : !marcarEnvioPendiente();
  };

  const posicionarContador = (elemento, valor, maximo) => {
    const rect = elemento.getBoundingClientRect();
    contador.textContent = `${valor.length} / ${maximo}`;
    contador.dataset.excedido = String(valor.length > maximo);
    contador.style.left = `${Math.max(8, Math.min(rect.right - 82, window.innerWidth - 94))}px`;
    contador.style.top = `${Math.max(8, Math.min(rect.bottom + 7, window.innerHeight - 32))}px`;
    contador.hidden = false;
  };

  document.querySelectorAll('[data-campo]').forEach((elemento) => {
    const campo = elemento.dataset.campo;
    const maximo = limites[campo];
    if (!maximo) return;

    elemento.setAttribute('contenteditable', 'plaintext-only');
    elemento.setAttribute('spellcheck', 'false');
    elemento.setAttribute('aria-label', `Editar ${campo.replaceAll('_', ' ')}`);

    elemento.addEventListener('focus', () => posicionarContador(elemento, elemento.innerText, maximo));
    elemento.addEventListener('input', () => {
      const valor = elemento.innerText.replace(/\r/g, '').replace(/\n$/, '');
      cambios.set(campo, valor);
      document.querySelectorAll(`[data-campo="${campo}"]`).forEach((otro) => {
        if (otro !== elemento) otro.textContent = valor;
      });
      posicionarContador(elemento, valor, maximo);
      actualizarBarra();
    });
    elemento.addEventListener('blur', () => { contador.hidden = true; });
  });

  const panel = document.createElement('dialog');
  panel.className = 'editor-panel';
  document.body.append(panel);

  const mostrarError = (error) => {
    mensaje.textContent = error;
    mensaje.classList.add('editor-error');
  };

  const cambiarImagen = (elemento, seleccion) => {
    elemento.src = seleccion.url;
    elemento.removeAttribute('srcset');
    elemento.removeAttribute('sizes');
    cambios.set(elemento.dataset.campoImagen, seleccion.path);
    imagenes.set(elemento.dataset.campoImagen, elemento);
    actualizarBarra();
    panel.close();
  };

  const abrirPanelImagen = async (elemento) => {
    panel.innerHTML = '';
    const contenido = document.createElement('div');
    contenido.className = 'editor-panel__contenido';
    const cabecera = document.createElement('div');
    cabecera.className = 'editor-panel__cabecera';
    const titulo = document.createElement('h2');
    titulo.textContent = 'Cambiar imagen';
    const cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.textContent = 'Cerrar';
    cerrar.addEventListener('click', () => panel.close());
    cabecera.append(titulo, cerrar);

    const subirTexto = document.createElement('p');
    subirTexto.className = 'editor-panel__subtitulo';
    subirTexto.textContent = 'Subir una imagen desde el computador';
    const entrada = document.createElement('input');
    entrada.className = 'editor-subir';
    entrada.type = 'file';
    entrada.accept = 'image/jpeg,image/png,image/webp';
    entrada.setAttribute('aria-label', 'Seleccionar imagen JPG, PNG o WebP');
    entrada.addEventListener('change', async () => {
      const archivo = entrada.files?.[0];
      if (!archivo) return;
      const datos = new FormData();
      datos.append('file', archivo);
      try {
        const respuesta = await fetch('/__editor/imagen', { method: 'POST', body: datos });
        const resultado = await respuesta.json();
        if (!respuesta.ok) throw new Error(resultado.error || 'No se pudo subir la imagen.');
        cambiarImagen(elemento, resultado);
      } catch (error) {
        const aviso = document.createElement('p');
        aviso.className = 'editor-error';
        aviso.textContent = error.message;
        contenido.append(aviso);
      }
    });

    const galeriaTitulo = document.createElement('p');
    galeriaTitulo.className = 'editor-panel__subtitulo';
    galeriaTitulo.textContent = 'Elegir una imagen ya subida';
    const galeria = document.createElement('div');
    galeria.className = 'editor-galeria';
    contenido.append(cabecera, subirTexto, entrada, galeriaTitulo, galeria);
    panel.append(contenido);

    try {
      const respuesta = await fetch('/__editor/imagenes');
      const resultado = await respuesta.json();
      if (!respuesta.ok) throw new Error(resultado.error || 'No se pudo cargar la biblioteca.');
      resultado.imagenes.forEach((seleccion) => {
        const boton = document.createElement('button');
        boton.type = 'button';
        const miniatura = document.createElement('img');
        miniatura.src = seleccion.url;
        miniatura.alt = '';
        const nombre = document.createElement('span');
        nombre.textContent = seleccion.nombre;
        boton.append(miniatura, nombre);
        boton.addEventListener('click', () => cambiarImagen(elemento, seleccion));
        galeria.append(boton);
      });
      if (!resultado.imagenes.length) galeria.textContent = 'Todavía no hay imágenes subidas.';
    } catch (error) {
      const aviso = document.createElement('p');
      aviso.className = 'editor-error';
      aviso.textContent = error.message;
      galeria.append(aviso);
    }
    panel.showModal();
  };

  document.querySelectorAll('[data-campo-imagen]').forEach((elemento) => {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'editor-imagen-boton';
    boton.textContent = 'Cambiar imagen';
    boton.addEventListener('click', () => abrirPanelImagen(elemento));
    elemento.parentElement?.append(boton);
  });

  // En modo edición ningún enlace del sitio navega: así se puede hacer clic en un texto dentro de un botón o enlace.
  document.addEventListener('click', (evento) => {
    const enlace = evento.target.closest('a[href]');
    if (enlace && !enlace.closest('.editor-barra, .editor-panel')) evento.preventDefault();
  }, true);

  const numeroActual = () => {
    const enlace = document.querySelector('a[href*="wa.me/"]');
    return enlace ? enlace.getAttribute('href').replace(/\D/g, '') : '';
  };

  const aplicarWhatsapp = (numero) => {
    document.querySelectorAll('a[href*="wa.me/"]').forEach((enlace) => {
      enlace.href = `https://wa.me/${numero}`;
    });
    document.querySelectorAll('[data-whatsapp-visible]').forEach((elemento) => {
      elemento.textContent = `+57 ${numero.slice(2, 5)} ${numero.slice(5, 8)} ${numero.slice(8)}`;
    });
  };

  const abrirPanelWhatsapp = () => {
    panel.innerHTML = '';
    const formulario = document.createElement('form');
    formulario.className = 'editor-panel__contenido';
    formulario.method = 'dialog';
    const cabecera = document.createElement('div');
    cabecera.className = 'editor-panel__cabecera';
    const titulo = document.createElement('h2');
    titulo.textContent = 'Número de WhatsApp';
    const cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.textContent = 'Cerrar';
    cerrar.addEventListener('click', () => panel.close());
    cabecera.append(titulo, cerrar);

    const etiqueta = document.createElement('label');
    etiqueta.className = 'editor-panel__subtitulo';
    etiqueta.htmlFor = 'editor-whatsapp';
    etiqueta.textContent = 'Celular de 10 dígitos. Se usa en todos los botones de WhatsApp del sitio.';
    const fila = document.createElement('div');
    fila.className = 'editor-whatsapp';
    const prefijo = document.createElement('span');
    prefijo.textContent = '+57';
    const entrada = document.createElement('input');
    entrada.id = 'editor-whatsapp';
    entrada.type = 'tel';
    entrada.inputMode = 'numeric';
    entrada.autocomplete = 'off';
    entrada.placeholder = '300 123 4567';
    const actual = cambios.get('whatsapp') || numeroActual();
    entrada.value = actual.startsWith('57') ? actual.slice(2) : actual;
    const aceptar = document.createElement('button');
    aceptar.type = 'submit';
    aceptar.textContent = 'Usar este número';
    fila.append(prefijo, entrada, aceptar);
    const aviso = document.createElement('p');
    aviso.className = 'editor-error';
    aviso.setAttribute('aria-live', 'polite');

    formulario.addEventListener('submit', (evento) => {
      evento.preventDefault();
      let digitos = entrada.value.replace(/\D/g, '');
      if (digitos.length === 12 && digitos.startsWith('57')) digitos = digitos.slice(2);
      if (!/^3\d{9}$/.test(digitos)) {
        aviso.textContent = 'Escribe un celular colombiano de 10 dígitos que empiece por 3, por ejemplo 300 123 4567.';
        entrada.focus();
        return;
      }
      const numero = `57${digitos}`;
      if (numero !== numeroActual() || cambios.has('whatsapp')) cambios.set('whatsapp', numero);
      aplicarWhatsapp(numero);
      actualizarBarra();
      panel.close();
    });

    formulario.append(cabecera, etiqueta, fila, aviso);
    panel.append(formulario);
    panel.showModal();
    entrada.focus();
  };

  botonWhatsapp.addEventListener('click', abrirPanelWhatsapp);

  const leerPagina = async () => (await fetch(location.pathname, { cache: 'no-store' })).text();

  // Astro tarda un momento en releer el contenido después de guardar; se recarga cuando la página ya cambió.
  const recargarCuandoCambie = async (antes) => {
    for (let intento = 0; intento < 20; intento += 1) {
      await new Promise((listo) => setTimeout(listo, 300));
      if ((await leerPagina()) !== antes) break;
    }
    location.reload();
  };

  const guardar = async (recargar) => {
    if (!cambios.size) return;
    const paginaAntes = recargar ? await leerPagina() : '';
    botonGuardar.disabled = true;
    botonEnviar.disabled = true;
    mensaje.textContent = 'Guardando cambios…';
    mensaje.classList.remove('editor-error');
    try {
      const respuesta = await fetch('/__editor/guardar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(cambios)),
      });
      const resultado = await respuesta.json();
      if (!respuesta.ok) throw new Error(resultado.error || 'No se pudieron guardar los cambios.');
      cambios.clear();
      sessionStorage.setItem('editor-cambios-guardados', '1');
      if (recargar) {
        mensaje.textContent = 'Cambios guardados. Actualizando la página…';
        await recargarCuandoCambie(paginaAntes);
        return;
      }
      actualizarBarra();
    } catch (error) {
      mostrarError(error.message);
    } finally {
      botonGuardar.disabled = false;
      botonEnviar.disabled = false;
    }
  };

  botonGuardar.addEventListener('click', () => guardar(true));
  botonEnviar.addEventListener('click', async () => {
    if (cambios.size) await guardar(false);
    if (cambios.size || !marcarEnvioPendiente()) return;
    botonEnviar.disabled = true;
    mensaje.textContent = 'Preparando el pull request…';
    mensaje.classList.remove('editor-error');
    try {
      const respuesta = await fetch('/__editor/enviar', { method: 'POST' });
      const resultado = await respuesta.json();
      if (!respuesta.ok) throw new Error(resultado.error || 'No se pudieron enviar los cambios.');
      sessionStorage.removeItem('editor-cambios-guardados');
      mensaje.textContent = '';
      const enlace = document.createElement('a');
      enlace.href = resultado.url;
      enlace.target = '_blank';
      enlace.rel = 'noopener noreferrer';
      enlace.textContent = 'Pull request creado: abrir en GitHub';
      enlace.style.color = '#fff';
      mensaje.append(enlace);
      actualizarBarra();
      mensaje.replaceChildren(enlace);
    } catch (error) {
      mostrarError(error.message);
      botonEnviar.disabled = false;
    }
  });

  actualizarBarra();
}