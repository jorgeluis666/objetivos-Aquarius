/**
 * leads.js - Leads: CRM de feedback del cliente.
 *
 * Una tabla por campana y mes: la inversion y los leads que reporta cada plataforma (conversiones de Google Ads;
 * formularios o conversaciones de WhatsApp en Meta Ads) se cargan solos del modulo Gasto Publicitario
 * (AquariusDashboard.snapshot()), y el cliente completa en las columnas resaltadas lo que de verdad recibio:
 * leads reales, calificados, ventas y monto vendido. Con eso el tablero calcula lo que las plataformas no ven:
 * coincidencia, costo por lead real, costo por calificado, costo por venta y ROAS.
 *
 * Solo entran las campanas cuyo objetivo es captar leads o conversaciones de WhatsApp (detectObjective). Si la
 * marca no tiene ninguna, el modulo no aparece en el panel lateral.
 *
 * Lo que completa el cliente se guarda en una hoja de Google privada de la agencia, a traves del Web App de
 * scripts/apps-script/crm-leads.gs (URL y token llegan del build: AQ_CRM_URL y AQ_CRM_TOKEN, dentro del HTML
 * cifrado). Nunca pasa por el repositorio publico. Sin ese Web App configurado, se guarda en este navegador y
 * el modulo lo avisa.
 */
(function () {
  'use strict';

  const LOCAL_KEY = 'aquarius_crm_results_local';
  const PREFS_KEY = 'aquarius_crm_prefs';
  const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  // Lo que completa el cliente: conteos enteros y el monto en soles.
  const CLIENT_FIELDS = [
    { key: 'leads', label: 'Leads reales', kind: 'count' },
    { key: 'calificados', label: 'Calificados', kind: 'count' },
    { key: 'ventas', label: 'Ventas', kind: 'count' },
    { key: 'monto', label: 'Monto vendido', kind: 'money' }
  ];
  const OBJECTIVES = {
    leads: { label: 'Leads', tone: 'new' },
    whatsapp: { label: 'WhatsApp', tone: 'green' }
  };
  const SAVE_DELAY = 700;
  const CRM_TIMEOUT = 20000;
  const YEAR_SCOPE = 'year';

  const state = {
    ready: false,
    loading: null,
    snapshot: null,
    results: [],
    status: 'loading',
    error: null,
    scope: null,
    rowStatus: new Map(),
    timers: new Map()
  };

  const isNum = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const fmtMoney = value => (isNum(value) ? `S/. ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—');
  const fmtCount = value => (isNum(value) ? Number(value).toLocaleString('es-PE', { maximumFractionDigits: 0 }) : '—');
  const fmtDecimal = value => (isNum(value) ? Number(value).toLocaleString('es-PE', { maximumFractionDigits: 2 }) : '—');
  const fmtPercent = value => (isNum(value) ? `${(Number(value) * 100).toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '—');
  const fmtRoas = value => (isNum(value) ? `${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x` : '—');
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const normalize = text => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  const limaToday = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
  const monthLabel = id => (/^\d{4}-\d{2}$/.test(id) ? `${MONTH_NAMES[Number(id.slice(5, 7)) - 1]} ${id.slice(0, 4)}` : id);
  const resultKey = (month, campaign) => `${month}|${normalize(campaign)}`;

  // --- Objetivo de cada campana ---

  // Leads o WhatsApp segun la plataforma, el nombre, el tipo y el objetivo declarado; null si la campana no capta
  // leads (alcance, trafico, ventas del catalogo...). Google: Busqueda, Maximo rendimiento y Demand Gen miden
  // contactos; Shopping, Display y Video no. Meta: el objetivo Clientes potenciales o Mensajes (WhatsApp).
  function detectObjective(campaign) {
    const text = normalize([campaign.name, campaign.type, campaign.objective].filter(Boolean).join(' '));
    if (/whats|wsp|mensaj|messag|conversac/.test(text)) return 'whatsapp';
    if (campaign.platform === 'Meta Ads') return /lead|cliente potencial|clientes potenciales|formulario/.test(text) ? 'leads' : null;
    if (/shopping|display|video|youtube|alcance|reconocimiento/.test(text)) return null;
    return 'leads';
  }

  // Campanas del informe de Google Ads por mes, con lo que reporta la plataforma. Para sumar Meta Ads basta con
  // agregar sus campanas aqui con platform 'Meta Ads', su objective y leads (formularios o conversaciones).
  function platformMonths(snapshot) {
    return (snapshot && Array.isArray(snapshot.months) ? snapshot.months : []).map(month => ({
      id: month.id,
      campaigns: (month.campaigns || []).map(record => {
        const campaign = {
          platform: 'Google Ads',
          name: record.campaign,
          label: record.label || record.campaign,
          type: record.type || '',
          cost: Number(record.cost) || 0,
          leads: Number(record.conversions) || 0
        };
        campaign.objective = detectObjective(campaign);
        campaign.key = normalize(campaign.name);
        return campaign;
      }).filter(campaign => campaign.objective)
    }));
  }

  const hasLeadCampaigns = () => platformMonths(state.snapshot).some(month => month.campaigns.length);

  // --- Guardado: Web App de la hoja privada o, sin el, este navegador ---

  const crmConfig = () => window.AQUARIUS_CRM || {};
  const isRemote = () => Boolean(crmConfig().url && crmConfig().token);

  async function callCrm(action, extra) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CRM_TIMEOUT);
    let response;
    try {
      // text/plain: el navegador no hace preflight y Apps Script lee el cuerpo igual.
      response = await fetch(crmConfig().url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ token: crmConfig().token, action }, extra)),
        redirect: 'follow',
        signal: controller.signal
      });
    } catch (error) {
      throw new Error(error.name === 'AbortError' ? 'la hoja no respondió a tiempo' : 'sin conexión con la hoja');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`la hoja respondió ${response.status}`);
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || 'la hoja no aceptó el cambio');
    return payload;
  }

  function readLocal() {
    try {
      const rows = JSON.parse(window.localStorage.getItem(LOCAL_KEY) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      return [];
    }
  }

  function writeLocal(rows) {
    try {
      window.localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));
    } catch (error) {
      throw new Error('el navegador no tiene espacio para guardar');
    }
  }

  const isEmpty = row => CLIENT_FIELDS.every(field => !isNum(row[field.key]));

  const store = {
    async list() {
      if (isRemote()) return (await callCrm('list')).rows || [];
      return readLocal();
    },
    // Una fila por mes y campana; sin ningun dato se borra (igual que en crm-leads.gs).
    async save(row) {
      if (isRemote()) return (await callCrm('save', { row })).row;
      const key = resultKey(row.mes, row.campana);
      const rows = readLocal().filter(item => resultKey(item.mes, item.campana) !== key);
      const saved = Object.assign({}, row, { actualizado: new Date().toISOString() });
      if (!isEmpty(saved)) rows.push(saved);
      writeLocal(rows);
      return saved;
    }
  };

  // --- Indicadores ---

  function resultFor(month, campaign) {
    const key = resultKey(month, campaign);
    return state.results.find(row => resultKey(row.mes, row.campana) === key) || null;
  }

  // Una unidad por campana y mes: lo que reporta la plataforma junto a lo que completo el cliente.
  function unitsOf(scope) {
    const units = [];
    const seen = new Set();
    platformMonths(state.snapshot).filter(month => inScope(month.id, scope)).forEach(month => month.campaigns.forEach(campaign => {
      const result = resultFor(month.id, campaign.name) || {};
      seen.add(resultKey(month.id, campaign.name));
      units.push({
        month: month.id, key: campaign.key, name: campaign.name, label: campaign.label, platform: campaign.platform, objective: campaign.objective,
        cost: campaign.cost, platformLeads: campaign.leads,
        leads: result.leads ?? null, calificados: result.calificados ?? null, ventas: result.ventas ?? null, monto: result.monto ?? null
      });
    }));
    // Lo que el cliente completo para una campana que ya no esta en el informe del mes se sigue viendo.
    state.results.filter(row => inScope(String(row.mes), scope) && !seen.has(resultKey(row.mes, row.campana))).forEach(row => {
      units.push({
        month: row.mes, key: normalize(row.campana), name: row.campana, label: row.campana, platform: row.plataforma || 'Otro', objective: null,
        cost: null, platformLeads: null, leads: row.leads ?? null, calificados: row.calificados ?? null, ventas: row.ventas ?? null, monto: row.monto ?? null
      });
    });
    return units;
  }

  // Cada cociente usa solo las campanas y meses que tienen los dos datos: con la tabla a medio llenar, el costo
  // de las campanas sin completar no infla el costo por lead real.
  function aggregate(units) {
    const sumOf = (field, list = units) => (list.some(unit => isNum(unit[field]))
      ? list.reduce((total, unit) => total + (isNum(unit[field]) ? Number(unit[field]) : 0), 0)
      : null);
    const pair = (num, den) => {
      const list = units.filter(unit => isNum(unit[num]) && isNum(unit[den]));
      const denominator = sumOf(den, list);
      return list.length && denominator ? sumOf(num, list) / denominator : null;
    };
    return {
      cost: sumOf('cost'),
      platformLeads: sumOf('platformLeads'),
      leads: sumOf('leads'),
      calificados: sumOf('calificados'),
      ventas: sumOf('ventas'),
      monto: sumOf('monto'),
      match: pair('leads', 'platformLeads'),
      cplPlatform: pair('cost', 'platformLeads'),
      cplReal: pair('cost', 'leads'),
      qualifyRate: pair('calificados', 'leads'),
      costPerQualified: pair('cost', 'calificados'),
      closeRate: pair('ventas', 'leads'),
      costPerSale: pair('cost', 'ventas'),
      ticket: pair('monto', 'ventas'),
      roas: pair('monto', 'cost'),
      filled: units.filter(unit => isNum(unit.leads)).length,
      count: units.length
    };
  }

  // Filas de la tabla: en un mes, una por campana (editable); en el ano, la suma de sus meses (solo lectura).
  function tableRows(scope) {
    const groups = new Map();
    unitsOf(scope).forEach(unit => {
      if (!groups.has(unit.key)) groups.set(unit.key, { key: unit.key, name: unit.name, label: unit.label, platform: unit.platform, objective: unit.objective, units: [] });
      const group = groups.get(unit.key);
      if (unit.objective) Object.assign(group, { label: unit.label, objective: unit.objective, platform: unit.platform });
      group.units.push(unit);
    });
    return [...groups.values()]
      .map(group => Object.assign(group, aggregate(group.units)))
      .sort((a, b) => (b.cost || 0) - (a.cost || 0) || a.label.localeCompare(b.label, 'es'));
  }

  // --- Meses ---

  const inScope = (monthId, scope) => (scope === YEAR_SCOPE ? String(monthId).slice(0, 4) === yearOfScope() : monthId === scope);

  function availableMonths() {
    const ids = new Set(platformMonths(state.snapshot).filter(month => month.campaigns.length).map(month => month.id));
    state.results.forEach(row => { if (/^\d{4}-\d{2}$/.test(String(row.mes))) ids.add(String(row.mes)); });
    return [...ids].sort().reverse();
  }

  const yearOfScope = () => (availableMonths()[0] || limaToday()).slice(0, 4);

  function defaultScope() {
    const cutoff = state.snapshot && state.snapshot.cutoff ? state.snapshot.cutoff.slice(0, 7) : null;
    const months = availableMonths();
    return months.includes(cutoff) ? cutoff : (months[0] || limaToday().slice(0, 7));
  }

  const editable = () => state.scope !== YEAR_SCOPE && state.status === 'ok';

  // --- Render ---

  function renderMode() {
    const host = document.getElementById('crm-mode');
    if (!host) return;
    let html = '';
    if (state.status === 'error') {
      const reason = String(state.error || '');
      html = `<strong>No se pudo leer el CRM.</strong>${escapeHtml(reason.charAt(0).toUpperCase() + reason.slice(1))}. Los cambios no se guardan hasta que vuelva la conexión: pulsa Actualizar para reintentar.`;
    } else if (!isRemote()) {
      html = '<strong>Modo de prueba: lo que se completa queda solo en este navegador.</strong>Para que el cliente y la agencia vean lo mismo desde cualquier equipo hay que conectar la hoja privada del CRM (README > Leads).';
    }
    host.innerHTML = html;
    host.hidden = !html;
    host.classList.toggle('error', state.status === 'error');
  }

  function renderFilters() {
    const host = document.getElementById('crm-filters');
    if (!host) return;
    const months = availableMonths();
    const options = months.map(id => `<option value="${id}"${id === state.scope ? ' selected' : ''}>${escapeHtml(monthLabel(id))}</option>`).join('')
      + `<option value="${YEAR_SCOPE}"${state.scope === YEAR_SCOPE ? ' selected' : ''}>Todo ${escapeHtml(yearOfScope())}</option>`;
    const where = isRemote() ? 'Hoja privada del CRM' : 'Solo este navegador';
    const status = state.status === 'loading' ? 'Cargando...' : state.status === 'error' ? 'Sin conexión' : 'Cada cambio se guarda solo';
    host.innerHTML = `
      <label class="retail-filter" for="crm-filter-month"><span>Periodo</span><select id="crm-filter-month">${options}</select><small>Elige un mes para completar los datos</small></label>
      <div class="retail-filter"><span>Guardado</span><p class="crm-where">${escapeHtml(where)}</p><small id="crm-sync">${status}</small></div>
      <div class="retail-filter crm-actions-filter"><span>Datos</span><button type="button" class="gasto-tool-btn" id="crm-refresh">Actualizar</button><small>Vuelve a leer la hoja</small></div>`;
  }

  function renderKpis(totals) {
    const host = document.getElementById('crm-kpis');
    if (!host) return;
    const coverage = totals.count ? `${totals.filled} de ${totals.count} campañas completadas` : 'Sin campañas';
    const cards = [
      ['Leads de la plataforma', fmtDecimal(totals.platformLeads), 'Conversiones y conversaciones reportadas'],
      ['Leads reales', fmtCount(totals.leads), coverage],
      ['Coincidencia', fmtPercent(totals.match), 'Leads reales / de la plataforma'],
      ['Calificados', fmtCount(totals.calificados), `Tasa ${fmtPercent(totals.qualifyRate)}`],
      ['Ventas', fmtCount(totals.ventas), `Cierre ${fmtPercent(totals.closeRate)}`],
      ['Costo por lead real', fmtMoney(totals.cplReal), `Plataforma ${fmtMoney(totals.cplPlatform)}`],
      ['Costo por venta', fmtMoney(totals.costPerSale), `Por calificado ${fmtMoney(totals.costPerQualified)}`],
      ['ROAS', fmtRoas(totals.roas), `Monto vendido ${fmtMoney(totals.monto)}`]
    ];
    host.innerHTML = cards.map(([label, value, meta]) => `<div class="kpi-pill"><span>${label}</span><strong>${value}</strong><small>${meta}</small></div>`).join('');
  }

  function objectivePill(objective) {
    const info = OBJECTIVES[objective];
    return info ? `<span class="status-pill ${info.tone}">${info.label}</span>` : '<span class="no-data">Sin informe</span>';
  }

  // Celdas calculadas de una fila (se repintan sin tocar los campos que se estan escribiendo).
  const DERIVED = [
    ['match', row => fmtPercent(row.match)],
    ['cplPlatform', row => fmtMoney(row.cplPlatform)],
    ['cplReal', row => fmtMoney(row.cplReal)],
    ['costPerQualified', row => fmtMoney(row.costPerQualified)],
    ['costPerSale', row => fmtMoney(row.costPerSale)],
    ['roas', row => fmtRoas(row.roas)]
  ];
  // Tasa debajo de calificados y ventas.
  const RATES = { calificados: row => row.qualifyRate, ventas: row => row.closeRate };

  function clientCell(row, field) {
    const rate = RATES[field.key] ? `<small data-rate="${field.key}">${isNum(RATES[field.key](row)) ? fmtPercent(RATES[field.key](row)) : ''}</small>` : '';
    if (!editable() || !row.units || row.units.length !== 1) {
      const value = field.kind === 'money' ? fmtMoney(row[field.key]) : fmtCount(row[field.key]);
      return `<td class="num crm-client">${value}${rate}</td>`;
    }
    const value = isNum(row[field.key]) ? row[field.key] : '';
    const step = field.kind === 'money' ? '0.01' : '1';
    return `<td class="num crm-client"><input class="crm-cell" type="number" min="0" step="${step}" inputmode="${field.kind === 'money' ? 'decimal' : 'numeric'}" data-field="${field.key}" value="${escapeHtml(value)}" placeholder="—" aria-label="${escapeHtml(`${field.label} de ${row.label}`)}">${rate}</td>`;
  }

  function rowStatusHtml(key) {
    const status = state.rowStatus.get(key);
    if (!status) return '';
    if (status.kind === 'saving') return '<span class="crm-row-status">Guardando...</span>';
    if (status.kind === 'saved') return '<span class="crm-row-status ok">Guardado</span>';
    return `<span class="crm-row-status error" title="${escapeHtml(status.message)}">${escapeHtml(status.message)}</span>`;
  }

  function rowHtml(row, total = false) {
    const derived = DERIVED.map(([name, value]) => `<td class="num${name === 'cplReal' || name === 'costPerSale' ? ' crm-strong' : ''}" data-cell="${name}">${value(row)}</td>`).join('');
    if (total) {
      return `<tr class="gasto-total-row" data-total>
        <td>Total</td><td></td><td></td>
        <td class="num">${fmtMoney(row.cost)}</td><td class="num">${fmtDecimal(row.platformLeads)}</td>
        ${CLIENT_FIELDS.map(field => `<td class="num crm-client" data-sum="${field.key}">${field.kind === 'money' ? fmtMoney(row[field.key]) : fmtCount(row[field.key])}</td>`).join('')}
        ${derived}<td></td>
      </tr>`;
    }
    const key = row.units.length === 1 ? resultKey(row.units[0].month, row.name) : row.key;
    return `<tr data-row="${escapeHtml(key)}">
        <td class="campaign-name"><span>${escapeHtml(row.label)}</span>${row.name && row.name !== row.label ? `<small>${escapeHtml(row.name)}</small>` : ''}</td>
        <td>${escapeHtml(row.platform)}</td>
        <td>${objectivePill(row.objective)}</td>
        <td class="num">${row.cost === null ? '<span class="no-data">—</span>' : fmtMoney(row.cost)}</td>
        <td class="num">${row.platformLeads === null ? '<span class="no-data">—</span>' : fmtDecimal(row.platformLeads)}</td>
        ${CLIENT_FIELDS.map(field => clientCell(row, field)).join('')}
        ${derived}
        <td class="crm-actions" data-status>${rowStatusHtml(key)}</td>
      </tr>`;
  }

  function renderTable() {
    const body = document.getElementById('crm-summary-body');
    if (!body) return;
    const scopeLabel = state.scope === YEAR_SCOPE ? `Todo ${yearOfScope()}` : monthLabel(state.scope);
    document.getElementById('crm-summary-title').textContent = `Leads por campaña | ${scopeLabel}`;
    const sub = document.getElementById('crm-summary-sub');
    if (sub) {
      sub.textContent = state.scope === YEAR_SCOPE
        ? 'Suma de los meses del año. Para completar o corregir los datos, elige un mes.'
        : 'La inversión y los leads de la plataforma se cargan solos. Completa en las columnas resaltadas lo que de verdad llegó de cada campaña: cada cambio se guarda solo.';
    }
    if (state.status === 'loading') { body.innerHTML = '<tr><td class="table-empty" colspan="16">Cargando...</td></tr>'; return; }
    const rows = tableRows(state.scope);
    if (!rows.length) { body.innerHTML = '<tr><td class="table-empty" colspan="16">Sin campañas de leads en el periodo.</td></tr>'; return; }
    body.innerHTML = rows.map(row => rowHtml(row)).join('') + rowHtml(aggregate(rows.flatMap(row => row.units)), true);
    const foot = document.getElementById('crm-summary-foot');
    if (foot) {
      foot.textContent = 'Leads reales, calificados, ventas y monto vendido los completa el cliente; vacío = sin dato. Coincidencia = leads reales / leads de la plataforma. '
        + 'Costo por lead real, por calificado y por venta = inversión dividida entre cada conteo; ROAS = monto vendido / inversión. '
        + 'Cada indicador usa solo las campañas que tienen ese dato completo. Google Ads reporta como leads sus conversiones (contactos); en Meta Ads serían los formularios o las conversaciones de WhatsApp.';
    }
  }

  // Repinta las celdas calculadas, los totales y los KPIs tras un cambio, sin tocar los campos.
  function refreshNumbers() {
    const rows = tableRows(state.scope);
    const totals = aggregate(rows.flatMap(row => row.units));
    renderKpis(totals);
    const body = document.getElementById('crm-summary-body');
    if (!body) return;
    rows.forEach(row => {
      const key = row.units.length === 1 ? resultKey(row.units[0].month, row.name) : row.key;
      const tr = body.querySelector(`tr[data-row="${CSS.escape(key)}"]`);
      if (!tr) return;
      DERIVED.forEach(([name, value]) => { const cell = tr.querySelector(`[data-cell="${name}"]`); if (cell) cell.innerHTML = value(row); });
      Object.keys(RATES).forEach(field => { const small = tr.querySelector(`[data-rate="${field}"]`); if (small) small.textContent = isNum(RATES[field](row)) ? fmtPercent(RATES[field](row)) : ''; });
    });
    const total = body.querySelector('tr[data-total]');
    if (total) {
      DERIVED.forEach(([name, value]) => { const cell = total.querySelector(`[data-cell="${name}"]`); if (cell) cell.innerHTML = value(totals); });
      CLIENT_FIELDS.forEach(field => { const cell = total.querySelector(`[data-sum="${field.key}"]`); if (cell) cell.textContent = field.kind === 'money' ? fmtMoney(totals[field.key]) : fmtCount(totals[field.key]); });
    }
  }

  function updateTopbar() {
    const view = document.getElementById('view-leads');
    if (!view || !view.classList.contains('visible')) return;
    const status = document.getElementById('topbar-status');
    if (status) status.textContent = `${isRemote() ? 'CRM en la hoja privada' : 'CRM en este navegador'} | ${state.scope === YEAR_SCOPE ? `Todo ${yearOfScope()}` : monthLabel(state.scope)}`;
  }

  // El modulo aparece en el panel lateral solo si la marca tiene campanas de leads o WhatsApp.
  function updateNavItem() {
    const item = document.querySelector('.s-item[data-view-target="view-leads"]');
    if (item && state.snapshot) item.hidden = !hasLeadCampaigns();
  }

  function render() {
    const months = availableMonths();
    if (!state.scope || (state.scope !== YEAR_SCOPE && months.length && !months.includes(state.scope))) state.scope = defaultScope();
    renderMode();
    renderFilters();
    renderKpis(aggregate(unitsOf(state.scope)));
    renderTable();
    updateTopbar();
  }

  // --- Edicion ---

  function setRowStatus(key, kind, message) {
    state.rowStatus.set(key, { kind, message });
    const cell = document.querySelector(`#crm-summary-body tr[data-row="${CSS.escape(key)}"] [data-status]`);
    if (cell) cell.innerHTML = rowStatusHtml(key);
  }

  // Enteros desde 0, calificados hasta los leads y ventas hasta los calificados.
  function validate(row) {
    for (const field of CLIENT_FIELDS) {
      const value = row[field.key];
      if (!isNum(value)) continue;
      if (Number(value) < 0) return `${field.label}: desde 0`;
      if (field.kind === 'count' && !Number.isInteger(Number(value))) return `${field.label}: número entero`;
    }
    if (isNum(row.leads) && isNum(row.calificados) && Number(row.calificados) > Number(row.leads)) return 'Hay más calificados que leads';
    if (isNum(row.calificados) && isNum(row.ventas) && Number(row.ventas) > Number(row.calificados)) return 'Hay más ventas que calificados';
    if (isNum(row.leads) && isNum(row.ventas) && Number(row.ventas) > Number(row.leads)) return 'Hay más ventas que leads';
    return null;
  }

  async function persist(key, row) {
    const problem = validate(row);
    if (problem) { setRowStatus(key, 'error', problem); return; }
    setRowStatus(key, 'saving');
    try {
      const saved = await store.save(row);
      if (saved && saved.actualizado) row.actualizado = saved.actualizado;
      setRowStatus(key, 'saved');
    } catch (error) {
      setRowStatus(key, 'error', `No se guardó: ${error.message}`);
    }
  }

  function onCellInput(input) {
    const tr = input.closest('tr[data-row]');
    if (!tr || !editable()) return;
    const key = tr.dataset.row;
    const unit = unitsOf(state.scope).find(item => resultKey(item.month, item.name) === key);
    if (!unit) return;
    let row = resultFor(unit.month, unit.name);
    if (!row) {
      row = { mes: unit.month, plataforma: unit.platform, campana: unit.name, leads: null, calificados: null, ventas: null, monto: null };
      state.results.push(row);
    }
    const field = input.dataset.field;
    row[field] = input.value === '' ? null : Number(input.value);
    input.classList.toggle('is-filled', input.value !== '');
    refreshNumbers();
    clearTimeout(state.timers.get(key));
    state.timers.set(key, setTimeout(() => persist(key, row), SAVE_DELAY));
  }

  async function reload() {
    state.status = 'loading';
    render();
    try {
      state.results = (await store.list()).filter(row => row && row.mes && row.campana).map(row => Object.assign({}, row, { mes: String(row.mes) }));
      state.status = 'ok';
      state.error = null;
    } catch (error) {
      console.error('[leads]', error);
      state.status = 'error';
      state.error = error.message;
    }
    render();
  }

  // --- Preferencias, eventos e inicio ---

  function readPrefs() {
    try {
      const prefs = JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}');
      if (prefs.scope) state.scope = prefs.scope;
    } catch (error) {
      /* sin preferencias: valores por defecto */
    }
  }

  function savePrefs() {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ scope: state.scope }));
    } catch (error) {
      /* sin almacenamiento: la seleccion dura lo que la pestana */
    }
  }

  function wireEvents() {
    const view = document.getElementById('view-leads');
    if (!view) return;
    view.addEventListener('change', event => {
      if (event.target.id !== 'crm-filter-month') return;
      state.scope = event.target.value;
      savePrefs();
      render();
    });
    view.addEventListener('input', event => {
      if (event.target.classList && event.target.classList.contains('crm-cell')) onCellInput(event.target);
    });
    view.addEventListener('click', event => {
      if (event.target.closest('#crm-refresh')) reload();
    });
  }

  function takeSnapshot() {
    state.snapshot = window.AquariusDashboard && window.AquariusDashboard.snapshot ? window.AquariusDashboard.snapshot() : null;
    updateNavItem();
  }

  // Se inicia al abrir la vista (navigation.js): la primera vez lee la hoja.
  function init() {
    if (!state.ready) {
      state.ready = true;
      readPrefs();
      wireEvents();
      takeSnapshot();
      state.loading = reload();
    } else {
      takeSnapshot();
      render();
    }
    return state.loading;
  }

  // Los datos de las plataformas llegan (o cambian con Sincronizar) despues: se repinta y se revisa si hay campanas de leads.
  window.addEventListener('aquarius:data-ready', () => {
    takeSnapshot();
    if (state.ready) render();
  });

  window.AquariusLeads = { init, render, detectObjective };
})();
