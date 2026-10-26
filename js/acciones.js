/**
 * acciones.js - Acciones sugeridas del mes, con check.
 *
 * Las reglas del Ciclo Mensual (data/reglas.json) dicen en que semana del mes vamos; las cifras
 * reales dicen que hacer. De las dos cosas sale la lista: cada accion lleva el numero exacto y la
 * ruta donde se toca en Google Ads. El calculo vive en js/alertas-core.js (funcion acciones), que
 * tambien se puede correr desde Node, asi que esta lista se puede comprobar sin navegador.
 *
 * Lo marcado se guarda en la hoja privada del CRM por el mismo Web App que usa Leads
 * (apps-script/crm-leads.gs; URL y token en window.AQUARIUS_CRM, que el build incrusta desde
 * los secrets AQ_CRM_URL y AQ_CRM_TOKEN). Asi lo que marca una persona lo ven las demas. Sin esos
 * secrets el check se guarda solo en este navegador y la tarjeta lo dice.
 *
 * El id de cada accion es estable (tipo + campana, nunca el monto), de modo que lo marcado sigue
 * marcado aunque las cifras cambien al dia siguiente. El estado es por mes: en octubre no se ve lo
 * que se marco en setiembre.
 */
(function () {
  const CRM_TIMEOUT = 20000;
  const LOCAL_KEY = 'aquarius_acciones';

  const Core = () => window.AquariusAlertas;
  const crmConfig = () => window.AQUARIUS_CRM || {};
  const isRemote = () => Boolean(crmConfig().url && crmConfig().token);

  const state = {
    hechas: {},      // { "<mes>|<id>": true }
    cargado: false,
    estado: 'inicial', // inicial | cargando | listo | local | error
    detalle: '',
  };

  const esc = valor => String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ── Guardado ───────────────────────────────────────────────────────────────
  async function callCrm(action, extra) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CRM_TIMEOUT);
    try {
      const response = await fetch(crmConfig().url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ token: crmConfig().token, action }, extra)),
        signal: controller.signal,
      });
      const body = await response.json();
      if (!body || body.ok === false) throw new Error((body && body.error) || `HTTP ${response.status}`);
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  function leerLocal() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') || {};
    } catch (error) {
      return {};
    }
  }

  function guardarLocal() {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(state.hechas));
    } catch (error) {
      // Sin almacenamiento (ventana privada, cuota llena) la lista sigue sirviendo: solo no recuerda.
      console.warn('[acciones] no se pudo guardar el check en este navegador:', error.message);
    }
  }

  async function cargar() {
    if (state.cargado) return;
    state.cargado = true;
    if (!isRemote()) {
      state.hechas = leerLocal();
      state.estado = 'local';
      return;
    }
    state.estado = 'cargando';
    pintar();
    try {
      const body = await callCrm('acciones-list', {});
      state.hechas = {};
      (body.rows || []).forEach(row => {
        if (row && row.mes && row.accion && row.hecha) state.hechas[`${row.mes}|${row.accion}`] = true;
      });
      state.estado = 'listo';
    } catch (error) {
      // Se cae a lo que haya en este navegador para no dejar la lista sin memoria, y se avisa.
      state.hechas = leerLocal();
      state.estado = 'error';
      state.detalle = error.name === 'AbortError' ? 'la hoja no respondió a tiempo' : error.message;
    }
  }

  async function marcar(mes, id, hecha) {
    const clave = `${mes}|${id}`;
    const antes = Boolean(state.hechas[clave]);
    if (hecha) state.hechas[clave] = true;
    else delete state.hechas[clave];
    guardarLocal();
    pintar();

    if (!isRemote()) return;
    try {
      await callCrm('acciones-save', { row: { mes, accion: id, hecha: Boolean(hecha) } });
      if (state.estado === 'error') { state.estado = 'listo'; state.detalle = ''; pintar(); }
    } catch (error) {
      // Si la hoja no acepta el cambio, la casilla vuelve a como estaba: mejor eso que mostrar
      // como hecho algo que el resto del equipo no va a ver.
      if (antes) state.hechas[clave] = true;
      else delete state.hechas[clave];
      guardarLocal();
      state.estado = 'error';
      state.detalle = error.name === 'AbortError' ? 'la hoja no respondió a tiempo' : error.message;
      pintar();
    }
  }

  // ── Pintado ────────────────────────────────────────────────────────────────
  function pie() {
    if (state.estado === 'cargando') return 'Leyendo lo que ya está hecho…';
    if (state.estado === 'error') {
      return `No se pudo leer la hoja del CRM (${esc(state.detalle)}): lo que marques queda solo en este navegador hasta que vuelva.`;
    }
    if (state.estado === 'local') {
      return 'Lo que marques queda solo en este navegador. Para que el equipo vea lo mismo desde cualquier equipo hay que conectar la hoja privada del CRM (README › Leads).';
    }
    return 'Lo marcado se guarda en la hoja privada del CRM, así que el equipo ve lo mismo desde cualquier equipo.';
  }

  function pintar() {
    const lista = document.getElementById('acciones-lista');
    const nota = document.getElementById('acciones-nota');
    const sub = document.getElementById('acciones-sub');
    if (!lista || !Core()) return;

    const e = Core().estado(window.AQUARIUS_RETAIL_DATA, window.AQUARIUS_REGLAS);
    if (!e) {
      lista.innerHTML = '<div class="acciones-vacio">Todavía no hay datos del mes para sugerir nada.</div>';
      if (nota) nota.textContent = '';
      return;
    }

    const acciones = Core().acciones(e);
    const mes = e.mes.id;
    if (sub) {
      sub.textContent = e.hito
        ? `Semana ${e.hito.semana} del mes · lo que toca hacer en Google Ads, con las cifras al ${e.corteLabel}.`
        : `Lo que toca hacer en Google Ads, con las cifras al ${e.corteLabel}.`;
    }

    if (!acciones.length) {
      lista.innerHTML = '<div class="acciones-vacio">Nada que ajustar con las cifras de este mes.</div>';
      if (nota) nota.textContent = pie();
      return;
    }

    const hechas = acciones.filter(a => state.hechas[`${mes}|${a.id}`]).length;
    lista.innerHTML = acciones.map(accion => {
      const clave = `${mes}|${accion.id}`;
      const marcada = Boolean(state.hechas[clave]);
      return `
        <label class="accion ${esc(accion.tono)}${marcada ? ' hecha' : ''}">
          <input type="checkbox" data-accion="${esc(accion.id)}" data-mes="${esc(mes)}" ${marcada ? 'checked' : ''} />
          <span class="accion-cuerpo">
            <span class="accion-titulo">${esc(accion.titulo)}</span>
            <span class="accion-porque">${esc(accion.porque)}</span>
            <span class="accion-donde">${esc(accion.donde)}</span>
          </span>
        </label>`;
    }).join('');

    const estadoCaja = document.getElementById('acciones-estado');
    if (estadoCaja) {
      estadoCaja.innerHTML = `<span class="acciones-contador">${hechas} de ${acciones.length}</span><small>hechas</small>`;
    }
    if (nota) nota.textContent = pie();

    lista.querySelectorAll('input[type="checkbox"]').forEach(caja => {
      caja.addEventListener('change', () => marcar(caja.dataset.mes, caja.dataset.accion, caja.checked));
    });
  }

  // Las reglas las puede haber dejado el build o el panel de Notificaciones; si no, se leen una vez.
  async function cargarReglas() {
    if (window.AQUARIUS_REGLAS) return;
    try {
      const response = await fetch('data/reglas.json', { cache: 'no-store' });
      if (response.ok) window.AQUARIUS_REGLAS = await response.json();
    } catch (error) {
      console.warn('[acciones] sin reglas del ciclo mensual:', error.message);
    }
  }

  async function init() {
    await cargarReglas();
    await cargar();
    pintar();
  }

  window.addEventListener('aquarius:data-ready', () => { pintar(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.AquariusAcciones = { render: pintar };
})();
