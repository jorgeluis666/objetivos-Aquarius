/**
 * recalculo-panel.js - Panel «Recálculo de inversión» del módulo Proyecciones.
 *
 * El cálculo vive en js/recalculo-inversion.js (función pura, con pruebas en tests/); aquí solo se arma la
 * entrada con los datos del tablero, se pinta la tabla y se guarda. Solo recomienda: no toca Google Ads.
 *
 * El presupuesto planificado de cada campaña por mes y el historial de recálculos se guardan en la hoja
 * privada del CRM (pestañas «Presupuesto por campana» y «Recalculos de inversion»), por el mismo Web App
 * de Leads (scripts/apps-script/crm-leads.gs; URL y token en window.AQUARIUS_CRM). Sin esa conexión, o si
 * el Apps Script todavía no tiene estas acciones, se guardan solo en este navegador y el panel lo dice.
 */
(function () {
  const CLIENTE = 'Aquarius';
  const CRM_TIMEOUT = 20000;
  const KEYS = {
    presupuestos: 'aquarius_presupuestos',
    nombres: 'aquarius_presupuestos_nombres',
    historial: 'aquarius_recalculos',
    saldo: 'aquarius_recalculo_saldo',
    responsable: 'aquarius_responsable',
    // Lo guardado en este navegador que la hoja del CRM todavía no tiene: se sube cuando vuelve.
    pendientes: 'aquarius_recalculo_pendientes',
  };
  const MAX_LOCAL = 60;
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const R = () => window.AquariusRecalculo;
  const crmConfig = () => window.AQUARIUS_CRM || {};
  const isRemote = () => Boolean(crmConfig().url && crmConfig().token);

  const state = {
    abierto: false,
    vista: 'tabla',          // tabla | presupuestos | historial | detalle
    conSaldo: leer(KEYS.saldo) === '1',
    responsable: leer(KEYS.responsable) || '',
    presupuestos: {},        // { 'AAAA-MM': { clave: monto } }
    nombres: {},             // { clave: nombre de la campaña }
    historial: [],           // [{ id, guardado, cliente, mes, corte, diasRestantes, modo, responsable, filas }]
    cargado: false,
    origen: 'local',         // remoto | local | error
    detalle: '',
    guardado: null,          // { estado: 'guardando' | 'ok' | 'local' | 'repetido' | 'error', texto }
    resultado: null,
    verId: null,
  };

  // ── Utilidades ─────────────────────────────────────────────────────────────
  function leer(key) {
    try { return localStorage.getItem(key); } catch (error) { return null; }
  }
  function escribir(key, value) {
    try { localStorage.setItem(key, value); } catch (error) { console.warn('[recalculo] sin almacenamiento local:', error.message); }
  }
  function leerJson(key, fallback) {
    try { return JSON.parse(leer(key) || '') || fallback; } catch (error) { return fallback; }
  }

  const esc = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const hoyLima = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
  const nombreMes = monthId => `${MESES[Number(monthId.slice(5, 7)) - 1]} ${monthId.slice(0, 4)}`;
  const fecha = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
  const etiqueta = nombre => (window.AquariusGasto && window.AquariusGasto.campaignLabel ? window.AquariusGasto.campaignLabel(nombre) : nombre);

  // S/ con 2 decimales; los negativos en rojo y entre paréntesis.
  function monto(value) {
    if (value == null || !Number.isFinite(Number(value))) return '<span class="recalculo-vacio">—</span>';
    const number = Number(value);
    const text = `S/ ${Math.abs(number).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return number < 0 ? `<span class="recalculo-neg">(${text})</span>` : text;
  }

  // Acepta 528.27, 528,27 o «S/ 1,234.56». Vacío = sin presupuesto.
  function aNumero(text) {
    let value = String(text == null ? '' : text).replace(/S\/\.?/gi, '').replace(/\s/g, '');
    if (!value) return null;
    if (value.includes(',') && !value.includes('.')) value = value.replace(',', '.');
    value = value.replace(/,/g, '');
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : NaN;
  }

  // ── Hoja del CRM ───────────────────────────────────────────────────────────
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

  function motivo(error) {
    if (error.name === 'AbortError') return 'la hoja no respondió a tiempo';
    // El Apps Script publicado aún no tiene las acciones del recálculo.
    if (/accion no valida/i.test(error.message)) return 'el Apps Script del CRM todavía no tiene el recálculo: hay que publicar una versión nueva (README › Recálculo de inversión)';
    return error.message;
  }

  // Filas de la hoja (una por campaña) → recálculos agrupados por id, el más reciente primero.
  function agrupar(rows) {
    const porId = new Map();
    (rows || []).forEach(row => {
      if (!row || !row.id) return;
      if (!porId.has(row.id)) {
        porId.set(row.id, {
          id: row.id, guardado: row.guardado, cliente: row.cliente, mes: row.mes, corte: row.corte,
          diasRestantes: row.dias_restantes, modo: row.modo, responsable: row.responsable, filas: [],
        });
      }
      porId.get(row.id).filas.push({
        campana: row.campana, estado: row.estado,
        presupuestoMes: row.ppto_mes, presupuestoMesAnterior: row.ppto_mes_anterior, gastoMesAnterior: row.gasto_mes_anterior,
        saldoMesAnterior: row.saldo_mes_anterior, presupuestoEfectivo: row.ppto_efectivo, gastoAcumulado: row.gasto_acumulado,
        porGastar: row.por_gastar, diarioActual: row.diario_actual, diarioRecomendado: row.diario_recomendado,
        diferencia: row.diferencia, alertas: row.alertas,
      });
    });
    return [...porId.values()].sort((a, b) => String(b.guardado).localeCompare(String(a.guardado)));
  }

  function presupuestosLocales() {
    return { presupuestos: leerJson(KEYS.presupuestos, {}), nombres: leerJson(KEYS.nombres, {}) };
  }

  // Pendientes de subir: presupuestos por 'mes|clave' (el último cambio, con su hora) y recálculos completos.
  function leerPendientes() {
    const pendientes = leerJson(KEYS.pendientes, {});
    return {
      presupuestos: pendientes.presupuestos && typeof pendientes.presupuestos === 'object' ? pendientes.presupuestos : {},
      recalculos: Array.isArray(pendientes.recalculos) ? pendientes.recalculos : [],
    };
  }
  function escribirPendientes(pendientes) {
    escribir(KEYS.pendientes, JSON.stringify(pendientes));
  }
  function anotarPresupuestos(cambios, at) {
    const pendientes = leerPendientes();
    cambios.forEach(({ mes, key, nombre, presupuesto }) => {
      pendientes.presupuestos[`${mes}|${key}`] = { mes, key, nombre, presupuesto, at };
    });
    escribirPendientes(pendientes);
  }
  function anotarRecalculo(entrada) {
    const pendientes = leerPendientes();
    if (!pendientes.recalculos.some(item => item.id === entrada.id)) pendientes.recalculos.unshift(entrada);
    pendientes.recalculos = pendientes.recalculos.slice(0, MAX_LOCAL);
    escribirPendientes(pendientes);
  }

  // Sube a la hoja lo que quedó en este navegador. Cada cosa sale de pendientes solo cuando la hoja la acepta;
  // un recálculo repetido no se duplica porque la hoja descarta un id que ya tiene.
  async function subirPendientes() {
    const pendientes = leerPendientes();
    const presupuestos = Object.values(pendientes.presupuestos);
    if (presupuestos.length) {
      await callCrm('presupuestos-save', { rows: presupuestos.map(({ mes, nombre, presupuesto }) => ({ mes, campana: nombre, presupuesto })) });
      const ahora = leerPendientes();
      presupuestos.forEach(item => {
        const id = `${item.mes}|${item.key}`;
        if (ahora.presupuestos[id] && ahora.presupuestos[id].at === item.at) delete ahora.presupuestos[id];
      });
      escribirPendientes(ahora);
    }
    for (const entrada of pendientes.recalculos.slice().reverse()) {
      await callCrm('recalculos-save', { recalculo: entrada });
      const ahora = leerPendientes();
      ahora.recalculos = ahora.recalculos.filter(item => item.id !== entrada.id);
      escribirPendientes(ahora);
    }
  }

  async function cargar() {
    if (state.cargado) return;
    state.cargado = true;
    const local = presupuestosLocales();
    if (!isRemote()) {
      Object.assign(state, local, { historial: leerJson(KEYS.historial, []), origen: 'local' });
      return;
    }
    try {
      const [presupuestos, recalculos] = await Promise.all([callCrm('presupuestos-list', {}), callCrm('recalculos-list', {})]);
      state.presupuestos = {};
      state.nombres = {};
      const actualizado = {};
      (presupuestos.rows || []).forEach(row => {
        const key = R().clave(row.campana);
        state.presupuestos[row.mes] = state.presupuestos[row.mes] || {};
        state.presupuestos[row.mes][key] = row.presupuesto;
        state.nombres[key] = row.campana;
        actualizado[`${row.mes}|${key}`] = row.actualizado || '';
      });
      state.historial = agrupar(recalculos.rows);

      // Lo que se guardó en este navegador mientras la hoja no respondía se suma a lo de la hoja, en vez de
      // perderse. Un presupuesto pendiente gana, salvo que la hoja tenga un cambio posterior (de otra persona).
      const pendientes = leerPendientes();
      Object.entries(pendientes.presupuestos).forEach(([id, item]) => {
        if (actualizado[id] && actualizado[id] > item.at) { delete pendientes.presupuestos[id]; return; }
        state.presupuestos[item.mes] = state.presupuestos[item.mes] || {};
        if (item.presupuesto == null) delete state.presupuestos[item.mes][item.key];
        else state.presupuestos[item.mes][item.key] = item.presupuesto;
        state.nombres[item.key] = item.nombre;
      });
      const ids = new Set(state.historial.map(item => item.id));
      pendientes.recalculos.forEach(entrada => { if (!ids.has(entrada.id)) state.historial.push(entrada); });
      state.historial.sort((a, b) => String(b.guardado).localeCompare(String(a.guardado)));
      escribirPendientes(pendientes);
      // La copia de este navegador queda al día por si la hoja vuelve a fallar.
      escribir(KEYS.presupuestos, JSON.stringify(state.presupuestos));
      escribir(KEYS.nombres, JSON.stringify(state.nombres));
      escribir(KEYS.historial, JSON.stringify(state.historial.slice(0, MAX_LOCAL)));
      state.origen = 'remoto';
      state.detalle = '';
      await subirPendientes();
    } catch (error) {
      // Se trabaja con lo de este navegador para no dejar el panel vacío, y se avisa. Lo pendiente sigue anotado.
      if (state.origen !== 'remoto') Object.assign(state, local, { historial: leerJson(KEYS.historial, []) });
      state.origen = 'error';
      state.detalle = motivo(error);
    }
  }

  async function guardarPresupuestos(cambios) {
    // Siempre queda copia en este navegador: si la hoja falla, no se pierde lo escrito.
    cambios.forEach(({ mes, key, nombre, presupuesto }) => {
      state.presupuestos[mes] = state.presupuestos[mes] || {};
      if (presupuesto == null) delete state.presupuestos[mes][key];
      else state.presupuestos[mes][key] = presupuesto;
      state.nombres[key] = nombre;
    });
    const locales = presupuestosLocales();
    cambios.forEach(({ mes, key, nombre, presupuesto }) => {
      locales.presupuestos[mes] = locales.presupuestos[mes] || {};
      if (presupuesto == null) delete locales.presupuestos[mes][key];
      else locales.presupuestos[mes][key] = presupuesto;
      locales.nombres[key] = nombre;
    });
    escribir(KEYS.presupuestos, JSON.stringify(locales.presupuestos));
    escribir(KEYS.nombres, JSON.stringify(locales.nombres));
    if (!cambios.length) return null;
    const at = new Date().toISOString();
    // Sin hoja (o mientras falla) el cambio queda anotado para subirlo cuando la hoja responda.
    if (!isRemote() || state.origen === 'error') {
      anotarPresupuestos(cambios, at);
      if (!isRemote()) return null;
    }
    try {
      if (state.origen === 'error') await subirPendientes();
      else await callCrm('presupuestos-save', { rows: cambios.map(({ mes, nombre, presupuesto }) => ({ mes, campana: nombre, presupuesto })) });
      if (state.origen === 'error') { state.origen = 'remoto'; state.detalle = ''; }
      return null;
    } catch (error) {
      anotarPresupuestos(cambios, at);
      state.origen = 'error';
      state.detalle = motivo(error);
      return state.detalle;
    }
  }

  // ── Recálculo ──────────────────────────────────────────────────────────────
  function calcular() {
    const data = window.AquariusDashboard && window.AquariusDashboard.getData && window.AquariusDashboard.getData();
    if (!data || !R()) return null;
    const entrada = R().entradaDesdeDatos(data, {
      hoy: hoyLima(), conSaldo: state.conSaldo, presupuestos: state.presupuestos, nombres: state.nombres, etiqueta,
    });
    return R().recalcular(entrada);
  }

  const alertasTexto = fila => (Array.isArray(fila.alertas) ? fila.alertas.map(alerta => alerta.texto).join(' | ') : String(fila.alertas || ''));

  // Lo que hace distinto a un recálculo: si ya hay uno igual en el historial, no se guarda otra vez.
  function firma(item) {
    const n = value => (value == null || value === '' ? '' : Number(value).toFixed(2));
    return [item.mes, item.corte || '', item.modo].concat((item.filas || []).map(fila => [
      R().clave(fila.campana), n(fila.presupuestoMes), n(fila.presupuestoMesAnterior), n(fila.gastoMesAnterior),
      n(fila.gastoAcumulado), n(fila.diarioActual), n(fila.diarioRecomendado),
    ].join('~'))).join('|');
  }

  async function guardarEnHistorial(resultado) {
    const filas = resultado.filas.filter(fila => fila.presupuestoMes != null);
    if (!filas.length) { state.guardado = null; return; }
    // Sin responsable no se guarda: se guarda al escribirlo (ver el change de #recalculo-responsable).
    if (!state.responsable.trim()) {
      state.guardado = { estado: 'falta-responsable', texto: 'Escribe tu nombre en Responsable para guardar este recálculo en el historial.' };
      return;
    }
    const entrada = {
      id: `rc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      guardado: new Date().toISOString(),
      cliente: CLIENTE, mes: resultado.mes, corte: resultado.corte, diasRestantes: resultado.diasRestantes,
      modo: resultado.modo, responsable: state.responsable.trim(),
      filas: filas.map(fila => ({
        campana: fila.campana, estado: fila.estado,
        presupuestoMes: fila.presupuestoMes, presupuestoMesAnterior: fila.presupuestoMesAnterior, gastoMesAnterior: fila.gastoMesAnterior,
        saldoMesAnterior: fila.saldoMesAnterior, presupuestoEfectivo: fila.presupuestoEfectivo, gastoAcumulado: fila.gastoAcumulado,
        porGastar: fila.porGastar, diarioActual: fila.diarioActual, diarioRecomendado: fila.diarioRecomendado,
        diferencia: fila.diferencia, alertas: alertasTexto(fila),
      })),
    };
    const nueva = firma(entrada);
    if (state.historial.some(item => firma(item) === nueva)) {
      state.guardado = { estado: 'repetido', texto: 'Igual a uno ya guardado en el historial.' };
      return;
    }
    state.historial.unshift(entrada);
    const guardarLocal = () => {
      const locales = leerJson(KEYS.historial, []);
      locales.unshift(entrada);
      escribir(KEYS.historial, JSON.stringify(locales.slice(0, MAX_LOCAL)));
    };
    if (!isRemote()) {
      guardarLocal();
      anotarRecalculo(entrada);
      state.guardado = { estado: 'local', texto: 'Guardado en el historial de este navegador.' };
      return;
    }
    state.guardado = { estado: 'guardando', texto: 'Guardando en el historial…' };
    pintar();
    try {
      await callCrm('recalculos-save', { recalculo: entrada });
      state.guardado = { estado: 'ok', texto: 'Guardado en el historial (hoja del CRM).' };
    } catch (error) {
      guardarLocal();
      anotarRecalculo(entrada);
      // El motivo lo dice el pie (pieOrigen), una sola vez.
      state.origen = 'error';
      state.detalle = motivo(error);
      state.guardado = { estado: 'error', texto: 'Guardado solo en el historial de este navegador.' };
    }
  }

  async function recalcular() {
    state.resultado = calcular();
    state.vista = 'tabla';
    pintar();
    if (state.resultado) {
      await guardarEnHistorial(state.resultado);
      pintar();
    }
  }

  // Un recálculo guardado, con la forma de recalcular() para usar la misma tabla y la misma exportación.
  function resultadoGuardado(item) {
    const conSaldo = /^con saldo/i.test(item.modo || '');
    const filas = item.filas.map(fila => {
      const textos = String(fila.alertas || '').split(' | ').filter(Boolean);
      const agotado = textos.includes('Presupuesto agotado');
      return Object.assign({}, fila, {
        etiqueta: etiqueta(fila.campana),
        activa: /^habilitad/i.test(fila.estado || ''),
        agotado,
        alertas: textos.map(texto => ({ texto, tipo: texto === 'Presupuesto agotado' ? 'agotado' : 'otra', tono: texto === 'Presupuesto agotado' ? 'red' : /^Sin presupuesto|^Falta/.test(texto) ? 'muted' : 'amber' })),
      });
    });
    const suma = field => {
      const values = filas.map(fila => fila[field]).filter(value => value != null);
      return values.length ? R().r2(values.reduce((total, value) => total + Number(value), 0)) : null;
    };
    const totales = {};
    ['presupuestoMes', 'presupuestoMesAnterior', 'gastoMesAnterior', 'saldoMesAnterior', 'presupuestoEfectivo', 'gastoAcumulado', 'porGastar', 'diarioActual', 'diarioRecomendado']
      .forEach(field => { totales[field] = suma(field); });
    totales.diferencia = totales.diarioRecomendado != null && totales.diarioActual != null ? R().r2(totales.diarioRecomendado - totales.diarioActual) : null;
    return {
      mes: item.mes, corte: item.corte, diasRestantes: item.diasRestantes, modo: item.modo, conSaldo,
      avisos: [], filas, totales, responsable: item.responsable, guardado: item.guardado,
    };
  }

  const visible = () => (state.vista === 'detalle'
    ? resultadoGuardado(state.historial.find(item => item.id === state.verId) || { filas: [], mes: '', modo: '' })
    : state.resultado);

  // ── Pintado ────────────────────────────────────────────────────────────────
  function cabecera(resultado, extra) {
    const items = [
      ['Cliente', esc(CLIENTE)],
      ['Mes', esc(resultado.mes ? nombreMes(resultado.mes) : '—')],
      ['Fecha de corte', esc(fecha(resultado.corte))],
      ['Días restantes', esc(resultado.diasRestantes)],
      ['Modo', esc(resultado.modo)],
    ];
    return `<dl class="recalculo-meta">${items.map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join('')}${extra || ''}</dl>`;
  }

  function estadoCelda(fila) {
    const pill = fila.estado ? `<span class="status-pill ${fila.activa ? 'green' : 'muted'}">${esc(fila.estado)}</span>` : '';
    return `${pill}${fila.agotado ? '<span class="status-pill red recalculo-agotado">Presupuesto agotado</span>' : ''}`;
  }

  function tabla(resultado) {
    const cols = R().columnas(resultado.conSaldo);
    const saldoKeys = new Set(['presupuestoMesAnterior', 'gastoMesAnterior', 'saldoMesAnterior']);
    const head = cols.map(([key, label]) => {
      const num = !['campana', 'estado', 'alertas'].includes(key);
      return `<th class="${num ? 'num' : ''}${saldoKeys.has(key) ? ' recalculo-saldo-col' : ''}">${esc(label)}</th>`;
    }).join('');
    const celda = (fila, key) => {
      if (key === 'campana') return `<td class="campaign-name"><span>${esc(fila.etiqueta || fila.campana)}</span></td>`;
      if (key === 'estado') return `<td class="recalculo-estado">${estadoCelda(fila)}</td>`;
      if (key === 'alertas') {
        const badges = (fila.alertas || []).filter(alerta => alerta.tipo !== 'agotado')
          .map(alerta => `<span class="recalculo-badge ${esc(alerta.tono || 'amber')}">${esc(alerta.texto)}</span>`).join('');
        return `<td class="recalculo-alertas">${badges || '<span class="recalculo-vacio">—</span>'}</td>`;
      }
      const clase = ['num'];
      if (saldoKeys.has(key)) clase.push('recalculo-saldo-col');
      if (key === 'diarioRecomendado') clase.push('recalculo-recomendado');
      return `<td class="${clase.join(' ')}">${monto(fila[key])}</td>`;
    };
    const body = resultado.filas.length
      ? resultado.filas.map(fila => `<tr>${cols.map(([key]) => celda(fila, key)).join('')}</tr>`).join('')
      : `<tr><td class="table-empty" colspan="${cols.length}">No hay campañas habilitadas ni con presupuesto este mes.</td></tr>`;
    const total = cols.map(([key], index) => {
      if (index === 0) return '<td>Total</td>';
      if (['estado', 'alertas'].includes(key)) return '<td></td>';
      const clase = ['num'];
      if (saldoKeys.has(key)) clase.push('recalculo-saldo-col');
      if (key === 'diarioRecomendado') clase.push('recalculo-recomendado');
      return `<td class="${clase.join(' ')}">${monto(resultado.totales[key])}</td>`;
    }).join('');
    return `
      <div class="table-scroll">
        <table class="data-table recalculo-table">
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
          <tfoot><tr>${total}</tr></tfoot>
        </table>
      </div>`;
  }

  function avisos(resultado) {
    const lista = (resultado.avisos || []).map(aviso => `<li>${esc(aviso.texto)}</li>`);
    return lista.length ? `<ul class="recalculo-avisos">${lista.join('')}</ul>` : '';
  }

  function pieOrigen() {
    if (state.origen === 'error') return `No se pudo usar la hoja del CRM (${esc(state.detalle)}): los presupuestos y el historial quedan solo en este navegador hasta que vuelva.`;
    if (state.origen === 'local') return 'Los presupuestos y el historial quedan solo en este navegador. Para que el equipo vea lo mismo hay que conectar la hoja privada del CRM (README › Leads).';
    return 'Los presupuestos y el historial se guardan en la hoja privada del CRM: el equipo ve lo mismo desde cualquier equipo.';
  }

  function vistaTabla() {
    const resultado = state.resultado;
    if (!resultado) {
      const hayDatos = Boolean(window.AquariusDashboard && window.AquariusDashboard.getData && window.AquariusDashboard.getData());
      return `<div class="empty-state"><strong>${hayDatos ? 'Leyendo presupuestos e historial…' : 'Esperando los datos del módulo Gasto publicitario…'}</strong></div>`;
    }
    const sinPpto = resultado.filas.filter(fila => fila.presupuestoMes == null).length;
    const responsable = `
      <div class="recalculo-responsable"><dt><label for="recalculo-responsable">Responsable</label></dt>
        <dd><input id="recalculo-responsable" type="text" maxlength="80" autocomplete="name" placeholder="Tu nombre" value="${esc(state.responsable)}"${state.guardado && state.guardado.estado === 'falta-responsable' ? ' class="falta" aria-describedby="recalculo-pie"' : ''}></dd></div>`;
    const faltan = sinPpto
      ? `<div class="data-notice recalculo-faltan"><strong>${sinPpto === resultado.filas.length ? 'Falta cargar el presupuesto del mes' : `${sinPpto} ${sinPpto === 1 ? 'campaña no tiene' : 'campañas no tienen'} presupuesto del mes`}</strong>
          Sin presupuesto no hay diario recomendado. <button type="button" class="gasto-tool-link" data-recalculo="presupuestos">Cargar presupuestos »</button></div>`
      : '';
    return `
      ${cabecera(resultado, responsable)}
      ${avisos(resultado)}
      ${faltan}
      ${tabla(resultado)}
      <p class="projection-note">Diario recomendado = por gastar ÷ ${resultado.diasRestantes} ${resultado.diasRestantes === 1 ? 'día restante' : 'días restantes'} (de hoy al ${R().daysInMonth(resultado.mes)} de ${MESES[Number(resultado.mes.slice(5, 7)) - 1].toLowerCase()}, ambos incluidos). El total es la suma de los diarios redondeados, lo que queda cargado en Google Ads. ${resultado.conSaldo ? 'Saldo mes anterior = presupuesto del mes anterior − su gasto real; el efectivo nunca baja de 0.' : ''} Solo recomienda: no cambia nada en Google Ads.</p>
      <p class="projection-note recalculo-pie" id="recalculo-pie">${pieTabla()}</p>`;
  }

  function pieTabla() {
    const guardado = state.guardado ? `<span class="recalculo-guardado ${esc(state.guardado.estado)}">${esc(state.guardado.texto)}</span> ` : '';
    return `${guardado}${pieOrigen()}`;
  }

  // Campañas que se pueden presupuestar: las del recálculo y las que gastaron el mes anterior.
  function campanasEditables(resultado) {
    const data = window.AquariusDashboard.getData();
    const anterior = R().mesAnterior(resultado.mes);
    const previo = (data.months || []).find(month => month.id === anterior);
    const lista = resultado.filas.map(fila => ({ nombre: fila.campana, estado: fila.estado, diario: fila.diarioActual, activa: fila.activa }));
    const vistos = new Set(lista.map(item => R().clave(item.nombre)));
    (previo ? previo.records || [] : []).forEach(record => {
      const key = R().clave(record.campaign);
      if (vistos.has(key) || !(Number(record.cost) > 0)) return;
      vistos.add(key);
      lista.push({ nombre: record.campaign, estado: 'Solo mes anterior', diario: Number(record.dailyBudget) || null, activa: false });
    });
    const gastoAnterior = Object.fromEntries((previo ? previo.records || [] : []).map(record => [R().clave(record.campaign), Number(record.cost) || 0]));
    return lista.map(item => Object.assign(item, { key: R().clave(item.nombre), gastoAnterior: previo ? gastoAnterior[R().clave(item.nombre)] || 0 : null }));
  }

  function vistaPresupuestos() {
    const resultado = state.resultado || calcular();
    if (!resultado) return '';
    const mes = resultado.mes;
    const anterior = R().mesAnterior(mes);
    const dias = R().daysInMonth(mes);
    const actuales = state.presupuestos[mes] || {};
    const previos = state.presupuestos[anterior] || {};
    const valor = value => (value == null ? '' : Number(value).toFixed(2));
    const filas = campanasEditables(resultado).map(item => `
      <tr data-key="${esc(item.key)}" data-nombre="${esc(item.nombre)}" data-diario="${item.diario == null ? '' : item.diario}">
        <td class="campaign-name"><span>${esc(etiqueta(item.nombre))}</span></td>
        <td>${item.estado ? `<span class="status-pill ${item.activa ? 'green' : 'muted'}">${esc(item.estado)}</span>` : ''}</td>
        <td class="num">${monto(item.diario)}</td>
        <td class="num"><input class="recalculo-input" data-mes="${mes}" inputmode="decimal" aria-label="Presupuesto de ${esc(nombreMes(mes))} para ${esc(etiqueta(item.nombre))}" value="${valor(actuales[item.key])}"></td>
        <td class="num"><input class="recalculo-input" data-mes="${anterior}" inputmode="decimal" aria-label="Presupuesto de ${esc(nombreMes(anterior))} para ${esc(etiqueta(item.nombre))}" value="${valor(previos[item.key])}"></td>
        <td class="num">${monto(item.gastoAnterior)}</td>
      </tr>`).join('');
    return `
      <div class="recalculo-editor">
        <p class="panel-sub">Presupuesto planificado de cada campaña para el mes, en soles. El de ${esc(nombreMes(anterior).toLowerCase())} sirve para el saldo del mes anterior. Vacío = sin presupuesto.</p>
        <div class="recalculo-editor-tools">
          <button type="button" class="gasto-tool-btn" data-recalculo="rellenar">Vacíos de ${esc(MESES[Number(mes.slice(5, 7)) - 1].toLowerCase())} = diario actual × ${dias} días</button>
          <button type="button" class="gasto-tool-btn" data-recalculo="copiar-anterior">Vacíos de ${esc(MESES[Number(anterior.slice(5, 7)) - 1].toLowerCase())} = presupuesto de ${esc(MESES[Number(mes.slice(5, 7)) - 1].toLowerCase())}</button>
        </div>
        <div class="table-scroll">
          <table class="data-table recalculo-table recalculo-editor-table">
            <thead><tr><th>Campaña</th><th>Estado</th><th class="num">Diario actual</th><th class="num">Ppto. ${esc(nombreMes(mes).toLowerCase())}</th><th class="num">Ppto. ${esc(nombreMes(anterior).toLowerCase())}</th><th class="num">Gasto ${esc(nombreMes(anterior).toLowerCase())}</th></tr></thead>
            <tbody>${filas || '<tr><td class="table-empty" colspan="6">No hay campañas en el informe.</td></tr>'}</tbody>
          </table>
        </div>
        <p class="recalculo-error" id="recalculo-editor-error" role="alert"></p>
        <div class="recalculo-editor-actions">
          <button type="button" class="messages-btn primary" data-recalculo="guardar-presupuestos">Guardar y recalcular</button>
          <button type="button" class="messages-btn secondary" data-recalculo="tabla">Cancelar</button>
        </div>
        <p class="projection-note">${pieOrigen()}</p>
      </div>`;
  }

  function vistaHistorial() {
    if (!state.historial.length) {
      return `<div class="empty-state"><strong>Todavía no hay recálculos guardados</strong><span>Cada recálculo con presupuesto se guarda solo al generarlo.</span></div><p class="projection-note">${pieOrigen()}</p>`;
    }
    const filas = state.historial.map(item => {
      const total = item.filas.reduce((sum, fila) => sum + (Number(fila.diarioRecomendado) || 0), 0);
      const cuando = item.guardado ? new Date(item.guardado) : null;
      const cuandoTexto = cuando && !Number.isNaN(cuando.getTime())
        ? cuando.toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '—';
      return `
        <tr>
          <td>${esc(cuandoTexto)}</td>
          <td>${esc(item.mes ? nombreMes(item.mes) : '—')}</td>
          <td>${esc(fecha(item.corte))}</td>
          <td class="num">${esc(item.diasRestantes ?? '—')}</td>
          <td>${esc(item.modo)}</td>
          <td>${esc(item.responsable || '—')}</td>
          <td class="num">${item.filas.length}</td>
          <td class="num recalculo-recomendado">${monto(R().r2(total))}</td>
          <td><button type="button" class="gasto-tool-btn" data-recalculo="ver" data-id="${esc(item.id)}">Ver</button></td>
        </tr>`;
    }).join('');
    return `
      <div class="table-scroll">
        <table class="data-table recalculo-table">
          <thead><tr><th>Guardado</th><th>Mes</th><th>Fecha de corte</th><th class="num">Días restantes</th><th>Modo</th><th>Responsable</th><th class="num">Campañas</th><th class="num">Diario recomendado</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <p class="projection-note">${pieOrigen()}</p>`;
  }

  function vistaDetalle() {
    const item = state.historial.find(entry => entry.id === state.verId);
    if (!item) return '';
    const resultado = resultadoGuardado(item);
    const extra = `<div><dt>Responsable</dt><dd>${esc(item.responsable || '—')}</dd></div>`;
    return `
      <div class="recalculo-detalle-head"><button type="button" class="gasto-tool-link" data-recalculo="historial">« Volver al historial</button></div>
      ${cabecera(resultado, extra)}
      ${tabla(resultado)}
      <p class="projection-note">Recálculo guardado: muestra las cifras de ese momento, no las de hoy.</p>`;
  }

  function pintar() {
    const panel = document.getElementById('recalculo-panel');
    const boton = document.getElementById('recalculo-open');
    if (boton) boton.setAttribute('aria-expanded', String(state.abierto));
    if (!panel) return;
    panel.hidden = !state.abierto;
    if (!state.abierto) return;

    const vistas = { tabla: vistaTabla, presupuestos: vistaPresupuestos, historial: vistaHistorial, detalle: vistaDetalle };
    const exportable = state.vista === 'tabla' || state.vista === 'detalle';
    const pulsado = vista => (state.vista === vista || (vista === 'historial' && state.vista === 'detalle') ? 'true' : 'false');
    const sub = {
      tabla: 'Cuánto debe gastar por día cada campaña, desde hoy hasta fin de mes, para cerrar en su presupuesto.',
      presupuestos: 'Presupuesto planificado del mes por campaña.',
      historial: 'Recálculos guardados, del más reciente al más antiguo.',
      detalle: 'Recálculo guardado.',
    }[state.vista];

    // No se pisa lo que se está escribiendo en el campo Responsable: solo cambia el pie.
    const activo = document.activeElement && document.activeElement.id === 'recalculo-responsable';
    if (activo && state.vista === 'tabla') {
      const pie = panel.querySelector('.recalculo-pie');
      if (pie) pie.innerHTML = pieTabla();
      return;
    }

    panel.innerHTML = `
      <div class="panel-head recalculo-head">
        <div>
          <div class="panel-title">Recálculo de inversión</div>
          <div class="panel-sub">${esc(sub)}</div>
        </div>
        <div class="recalculo-tools">
          <label class="recalculo-switch" title="Suma al presupuesto del mes lo que sobró (o resta lo que se pasó) el mes anterior">
            <input type="checkbox" id="recalculo-saldo" ${state.conSaldo ? 'checked' : ''} ${state.vista === 'tabla' ? '' : 'disabled'}>
            <span class="recalculo-switch-track" aria-hidden="true"></span><span>Saldo mes anterior</span>
          </label>
          <button type="button" class="gasto-tool-btn" data-recalculo="presupuestos" aria-pressed="${pulsado('presupuestos')}">Presupuestos</button>
          <button type="button" class="gasto-tool-btn" data-recalculo="historial" aria-pressed="${pulsado('historial')}">Historial</button>
          <button type="button" class="gasto-tool-btn" data-recalculo="copiar" ${exportable ? '' : 'disabled'}>Copiar</button>
          <button type="button" class="gasto-tool-btn" data-recalculo="csv" ${exportable ? '' : 'disabled'}>Exportar CSV</button>
          <button type="button" class="gasto-tool-btn" data-recalculo="recalcular" title="Vuelve a calcular con los datos de ahora">Recalcular</button>
          <button type="button" class="gasto-tool-btn recalculo-cerrar" data-recalculo="cerrar" aria-label="Cerrar el recálculo">×</button>
        </div>
      </div>
      ${(vistas[state.vista] || vistaTabla)()}`;
  }

  // ── Acciones ───────────────────────────────────────────────────────────────
  async function copiar(boton) {
    const resultado = visible();
    if (!resultado) return;
    const texto = R().aTsv(resultado, CLIENTE);
    let ok = false;
    try {
      await navigator.clipboard.writeText(texto);
      ok = true;
    } catch (error) {
      const area = document.createElement('textarea');
      area.value = texto;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { ok = document.execCommand('copy'); } catch (fallo) { ok = false; }
      area.remove();
    }
    if (boton) {
      const antes = boton.textContent;
      boton.textContent = ok ? 'Copiado' : 'No se pudo copiar';
      setTimeout(() => { boton.textContent = antes; }, 1600);
    }
  }

  function exportarCsv() {
    const resultado = visible();
    if (!resultado) return;
    // BOM para que Excel abra bien las tildes.
    const blob = new Blob(['﻿', R().aCsv(resultado, CLIENTE)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `recalculo-inversion-${CLIENTE.toLowerCase()}-${resultado.corte || resultado.mes}-${resultado.conSaldo ? 'con-saldo' : 'sin-saldo'}.csv`;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function rellenar(panel, tipo) {
    const resultado = state.resultado;
    if (!resultado) return;
    const mes = resultado.mes;
    const anterior = R().mesAnterior(mes);
    const dias = R().daysInMonth(mes);
    panel.querySelectorAll('.recalculo-editor-table tbody tr').forEach(row => {
      const actual = row.querySelector(`input[data-mes="${mes}"]`);
      const previo = row.querySelector(`input[data-mes="${anterior}"]`);
      if (tipo === 'rellenar' && actual && !actual.value.trim() && row.dataset.diario) {
        actual.value = (Math.round(Number(row.dataset.diario) * dias * 100) / 100).toFixed(2);
      }
      if (tipo === 'copiar-anterior' && previo && actual && !previo.value.trim() && actual.value.trim()) {
        previo.value = actual.value.trim();
      }
    });
  }

  async function guardarEditor(panel, boton) {
    const error = panel.querySelector('#recalculo-editor-error');
    const cambios = [];
    let invalido = null;
    panel.querySelectorAll('.recalculo-editor-table tbody tr').forEach(row => {
      row.querySelectorAll('input.recalculo-input').forEach(input => {
        input.removeAttribute('aria-invalid');
        const valor = aNumero(input.value);
        if (Number.isNaN(valor)) {
          input.setAttribute('aria-invalid', 'true');
          invalido = invalido || input;
          return;
        }
        const mes = input.dataset.mes;
        const antes = (state.presupuestos[mes] || {})[row.dataset.key];
        const previo = antes == null ? null : Number(antes);
        if (previo !== valor) cambios.push({ mes, key: row.dataset.key, nombre: row.dataset.nombre, presupuesto: valor });
      });
    });
    if (invalido) {
      if (error) error.textContent = 'Revisa los montos marcados: tienen que ser números desde 0 (por ejemplo 528.27).';
      invalido.focus();
      return;
    }
    if (boton) { boton.disabled = true; boton.textContent = 'Guardando…'; }
    // Si la hoja falla, los presupuestos quedan en este navegador y el pie del recálculo dice por qué.
    await guardarPresupuestos(cambios);
    await recalcular();
  }

  async function abrir() {
    state.abierto = true;
    state.vista = 'tabla';
    pintar();
    await cargar();
    await recalcular();
    // Sin ningún presupuesto del mes, se abre directo la carga.
    if (state.resultado && state.resultado.filas.length && state.resultado.filas.every(fila => fila.presupuestoMes == null)) {
      state.vista = 'presupuestos';
      pintar();
    }
    const panel = document.getElementById('recalculo-panel');
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function wire() {
    document.getElementById('recalculo-open')?.addEventListener('click', () => {
      if (state.abierto) { state.abierto = false; pintar(); return; }
      abrir();
    });

    const panel = document.getElementById('recalculo-panel');
    if (!panel) return;
    panel.addEventListener('click', event => {
      const boton = event.target.closest('[data-recalculo]');
      if (!boton || boton.disabled) return;
      const accion = boton.dataset.recalculo;
      if (accion === 'cerrar') { state.abierto = false; pintar(); document.getElementById('recalculo-open')?.focus(); return; }
      if (accion === 'copiar') { copiar(boton); return; }
      if (accion === 'csv') { exportarCsv(); return; }
      if (accion === 'recalcular') {
        // Si la hoja había fallado, se vuelve a leer y se sube lo pendiente antes de recalcular.
        if (isRemote() && state.origen === 'error') { state.cargado = false; cargar().then(recalcular); return; }
        recalcular();
        return;
      }
      if (accion === 'rellenar' || accion === 'copiar-anterior') { rellenar(panel, accion); return; }
      if (accion === 'guardar-presupuestos') { guardarEditor(panel, boton); return; }
      if (accion === 'ver') { state.verId = boton.dataset.id; state.vista = 'detalle'; pintar(); return; }
      if (['tabla', 'presupuestos', 'historial'].includes(accion)) {
        state.vista = state.vista === accion && accion !== 'tabla' ? 'tabla' : accion;
        pintar();
      }
    });
    panel.addEventListener('change', event => {
      if (event.target.id === 'recalculo-saldo') {
        state.conSaldo = event.target.checked;
        escribir(KEYS.saldo, state.conSaldo ? '1' : '0');
        recalcular();
      }
      if (event.target.id === 'recalculo-responsable') {
        state.responsable = event.target.value.trim().slice(0, 80);
        escribir(KEYS.responsable, state.responsable);
        // El recálculo que esperaba un responsable se guarda ahora, con su nombre.
        if (state.responsable && state.vista === 'tabla' && state.resultado && state.guardado && state.guardado.estado === 'falta-responsable') {
          guardarEnHistorial(state.resultado).then(pintar);
        }
      }
    });
    panel.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target.classList && event.target.classList.contains('recalculo-input')) {
        event.preventDefault();
        guardarEditor(panel, panel.querySelector('[data-recalculo="guardar-presupuestos"]'));
      }
    });

    // Datos nuevos de Drive con el panel abierto: se recalcula la vista, sin guardar otro recálculo.
    window.addEventListener('aquarius:data-ready', () => {
      if (!state.abierto || state.vista !== 'tabla') return;
      state.resultado = calcular();
      pintar();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();

  window.AquariusRecalculoPanel = { abrir, render: pintar };
})();
