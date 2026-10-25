/* ============================================================
   notificaciones.js — la campanita de la barra superior.

   Dos pantallas en el mismo desplegable:
   - Avisos del mes: los que calcula js/alertas-core.js con la data de Google Ads.
     Un clic abre el modulo donde se ve ese numero.
   - Ruedita: los correos a los que llega la alerta semanal. La lista vive en el
     Web App de apps-script/alertas-destinatarios.gs; el build deja su URL y su
     clave dentro del HTML cifrado (window.AQUARIUS_ALERTAS). Sin conexion
     (copia local o sin los secrets) se ve la lista del repositorio, sin poder
     guardarla.
   ============================================================ */

(function () {
  const Core = () => window.AquariusAlertas;
  const state = { open: false, config: false, alertas: null, wired: false };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;
  const ICONO_RUEDITA = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  const config = () => window.AQUARIUS_ALERTAS || null;
  const conectadas = () => Boolean(config() && config().url && config().token);
  const copiaLista = lista => (lista || []).map(item => ({ nombre: item.nombre || '', email: item.email || '' }));
  const fechaCambio = iso => new Date(iso).toLocaleString('es-PE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' });

  // GET lee la lista; con lista, POST la guarda (texto plano: el Web App no acepta la consulta previa de CORS).
  async function llamar(lista) {
    const { url, token } = config();
    const res = lista
      ? await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token, destinatarios: lista }) })
      : await fetch(`${url}?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || `respuesta ${res.status}`);
    return data;
  }

  async function abrirConfig() {
    state.config = true;
    const porDefecto = copiaLista(config() && config().porDefecto);
    if (!conectadas()) {
      state.alertas = { lista: porDefecto, estado: 'sin-conexion' };
      render();
      return;
    }
    state.alertas = { lista: [], estado: 'cargando' };
    render();
    try {
      const data = await llamar();
      // Mientras nadie guardo una lista, la alerta usa la del repositorio: se muestra esa.
      state.alertas = { lista: Array.isArray(data.destinatarios) ? copiaLista(data.destinatarios) : porDefecto, estado: 'listo', actualizado: data.actualizado || '' };
    } catch (error) {
      state.alertas = { lista: [], estado: 'error', mensaje: `No se pudo leer la lista (${error.message}).`, tono: 'red' };
    }
    if (state.open && state.config) render();
  }

  async function guardar() {
    const a = state.alertas;
    const lista = a.lista
      .map(item => ({ nombre: item.nombre.trim(), email: item.email.trim().toLowerCase() }))
      .filter(item => item.nombre || item.email);
    const mala = lista.find(item => !EMAIL_RE.test(item.email));
    if (mala) {
      Object.assign(a, { mensaje: `Revisa el correo «${mala.email || 'vacío'}».`, tono: 'red' });
      render();
      return;
    }
    Object.assign(a, { estado: 'guardando', mensaje: '' });
    render();
    try {
      const data = await llamar(lista);
      const guardada = copiaLista(data.destinatarios);
      state.alertas = {
        lista: guardada, estado: 'listo', actualizado: data.actualizado || '',
        mensaje: guardada.length ? 'Guardado: la próxima alerta llega a estos correos.' : 'Guardado sin correos: las alertas no se enviarán.',
        tono: guardada.length ? 'green' : 'amber',
      };
    } catch (error) {
      Object.assign(a, { estado: 'listo', mensaje: `No se pudo guardar (${error.message}).`, tono: 'red' });
    }
    if (state.open && state.config) render();
  }

  function configHTML() {
    const a = state.alertas || { lista: [], estado: 'cargando' };
    const editable = a.estado === 'listo';
    const off = editable ? '' : ' disabled';
    const filas = a.lista.map((item, index) => `
      <div class="notif-dest">
        <input class="notif-inp" type="text" value="${esc(item.nombre)}" placeholder="Nombre" maxlength="60" data-dest="${index}" data-campo="nombre" aria-label="Nombre"${off}>
        <input class="notif-inp" type="email" value="${esc(item.email)}" placeholder="correo@empresa.com" data-dest="${index}" data-campo="email" aria-label="Correo"${off}>
        <button class="notif-dest-del" type="button" data-dest-del="${index}" title="Quitar este correo" aria-label="Quitar este correo"${off}>×</button>
      </div>`).join('');
    const estado = {
      cargando: 'Cargando la lista…',
      guardando: 'Guardando…',
      'sin-conexion': 'La lista todavía no se puede editar: falta conectar el Web App de los correos (AQ_ALERTAS_URL y AQ_ALERTAS_TOKEN). Hoy la alerta llega a estos correos.',
    }[a.estado] || a.mensaje || '';
    return `
      <div class="notif-head">
        <div>
          <strong>Correos de las alertas</strong>
          <p>La alerta de Google Ads llega los lunes a las 6:00 p. m. y cada vez que entran datos nuevos.</p>
        </div>
        <div class="notif-head-actions"><button class="notif-close" type="button" data-notif-back>Volver</button></div>
      </div>
      <div class="notif-config">
        ${filas || `<div class="notif-empty">${editable ? 'Sin correos: las alertas no se enviarán.' : 'Todavía no hay correos cargados.'}</div>`}
        ${editable ? '<button class="notif-dest-add" type="button" data-dest-add>+ Agregar correo</button>' : ''}
      </div>
      <div class="notif-config-foot">
        <span class="notif-config-msg ${['sin-conexion', 'cargando', 'guardando'].includes(a.estado) ? '' : esc(a.tono || '')}">${esc(estado)}</span>
        ${editable || a.estado === 'guardando' ? `<button class="notif-save" type="button" data-dest-save${off}>Guardar</button>` : ''}
      </div>
      <p class="notif-foot">Quien entra al tablero puede cambiar esta lista.${a.actualizado ? ` Último cambio: ${esc(fechaCambio(a.actualizado))}` : ''}</p>`;
  }

  function render() {
    const zone = document.getElementById('notif-zone');
    if (!zone || !Core()) return;
    const e = Core().estado(window.AQUARIUS_RETAIL_DATA);
    if (!e) { zone.hidden = true; return; }
    const items = Core().avisos(e);
    const open = state.open;
    const countTone = items.some(item => item.tone === 'red') ? 'red' : items.length ? 'blue' : 'none';
    const itemHTML = item => `
      <button class="notif-item ${item.tone}" type="button" data-notif-view="${item.vista}" title="Abrir el módulo donde se ve este número">
        <span>
          <strong>${esc(item.titulo)}</strong>
          ${item.lineas.filter(Boolean).map(linea => `<span class="notif-meta">${esc(linea)}</span>`).join('')}
        </span>
        ${item.badge ? `<span class="notif-badge"><strong>${esc(item.badge.valor)}</strong><span>${esc(item.badge.etiqueta)}</span></span>` : ''}
      </button>`;

    zone.hidden = false;
    zone.innerHTML = `
      <button class="notif-toggle${open ? ' open' : ''}" id="notif-toggle" type="button" aria-expanded="${open}" aria-controls="notif-panel" title="Notificaciones del mes">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
        <span class="notif-toggle-text">Notificaciones</span>
        <span class="notif-count ${countTone}">${items.length}</span>
      </button>
      <div class="notif-panel" id="notif-panel" role="dialog" aria-label="Notificaciones del mes"${open ? '' : ' hidden'}>${state.config ? configHTML() : `
        <div class="notif-head">
          <div>
            <strong>Avisos de ${esc(e.mes.label.toLowerCase())}</strong>
            <p>${e.mes.cerrado ? 'mes cerrado' : `datos al ${esc(e.corteLabel)}`} · ${items.length ? `${items.length} ${items.length === 1 ? 'aviso' : 'avisos'}` : 'sin avisos'}</p>
          </div>
          <div class="notif-head-actions">
            <button class="notif-gear" type="button" data-notif-config title="Correos de las alertas" aria-label="Configurar los correos de las alertas">${ICONO_RUEDITA}</button>
            <button class="notif-close" type="button" data-notif-close>Cerrar</button>
          </div>
        </div>
        <div class="notif-list">
          ${items.length ? items.map(itemHTML).join('') : '<div class="notif-empty">No hay avisos para este mes.</div>'}
        </div>
        <p class="notif-foot">El cierre proyectado es el ritmo diario del mes por los días del mes, igual que en Proyecciones. Haz clic en un aviso para abrir su módulo.</p>`}
      </div>`;

    // Al cerrar, el panel vuelve a los avisos.
    const toggle = value => {
      state.open = typeof value === 'boolean' ? value : !state.open;
      if (!state.open) state.config = false;
      render();
    };
    // Los botones que repintan el panel no dejan subir el clic: el elemento ya no estaria dentro de la
    // zona y el clic de afuera lo cerraria.
    const solo = fn => event => { event.stopPropagation(); fn(event); };
    zone.querySelector('#notif-toggle').addEventListener('click', event => { event.stopPropagation(); toggle(); });
    if (state.config) {
      const a = state.alertas;
      zone.querySelector('[data-notif-back]').addEventListener('click', solo(() => { state.config = false; render(); }));
      zone.querySelectorAll('[data-dest]').forEach(input => input.addEventListener('input', () => { a.lista[Number(input.dataset.dest)][input.dataset.campo] = input.value; }));
      zone.querySelectorAll('[data-dest-del]').forEach(button => button.addEventListener('click', solo(() => {
        a.lista.splice(Number(button.dataset.destDel), 1);
        a.mensaje = '';
        render();
      })));
      zone.querySelector('[data-dest-add]')?.addEventListener('click', solo(() => {
        a.lista.push({ nombre: '', email: '' });
        a.mensaje = '';
        render();
        zone.querySelector(`[data-dest="${a.lista.length - 1}"][data-campo="nombre"]`)?.focus();
      }));
      zone.querySelector('[data-dest-save]')?.addEventListener('click', solo(guardar));
    } else {
      zone.querySelector('[data-notif-close]').addEventListener('click', () => toggle(false));
      zone.querySelector('[data-notif-config]').addEventListener('click', solo(abrirConfig));
      zone.querySelectorAll('[data-notif-view]').forEach(button => button.addEventListener('click', () => {
        toggle(false);
        document.querySelector(`.s-item[data-view-target="${button.dataset.notifView}"]`)?.click();
      }));
    }
    // Se cierra al hacer clic fuera o con Escape (una sola vez por pagina).
    if (!state.wired) {
      state.wired = true;
      document.addEventListener('click', event => { if (state.open && !document.getElementById('notif-zone')?.contains(event.target)) toggle(false); });
      document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.open) toggle(false); });
    }
  }

  // Llega al cargar y cada vez que se sincroniza Drive: los avisos se recalculan con la data nueva.
  window.addEventListener('aquarius:data-ready', () => render());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();

  window.AquariusNotificaciones = { render };
})();
