/**
 * leads.js - Leads: CRM de feedback del cliente.
 *
 * El cliente registra lead por lead lo que de verdad recibio de cada campana (fecha, campana, canal, estado y,
 * si cerro, el monto). Con eso el tablero calcula lo que las plataformas no ven: leads validos, calificados,
 * ventas, costo por lead real, costo por venta y ROAS. La inversion y los leads que reporta cada plataforma
 * (conversiones de Google Ads; leads o conversaciones de WhatsApp en Meta Ads) se cargan solos del modulo Gasto
 * Publicitario (AquariusDashboard.snapshot()).
 *
 * Solo entran las campanas cuyo objetivo es captar leads o conversaciones de WhatsApp (detectObjective). Si la
 * marca no tiene ninguna, el modulo no aparece en el panel lateral.
 *
 * Los leads se guardan en una hoja de Google privada de la agencia, a traves del Web App de
 * scripts/apps-script/crm-leads.gs (URL y token llegan del build: AQ_CRM_URL y AQ_CRM_TOKEN, dentro del HTML
 * cifrado). Nunca pasan por el repositorio publico. Sin ese Web App configurado, el modulo guarda en este
 * navegador y lo avisa.
 */
(function () {
  'use strict';

  const LOCAL_KEY = 'aquarius_crm_leads_local';
  const PREFS_KEY = 'aquarius_crm_prefs';
  const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  // Mismas listas que valida crm-leads.gs.
  const ESTADOS = [
    { key: 'Nuevo', tone: 'muted' },
    { key: 'Contactado', tone: 'new' },
    { key: 'Calificado', tone: 'amber' },
    { key: 'Cotizado', tone: 'amber' },
    { key: 'Venta', tone: 'green' },
    { key: 'Perdido', tone: 'red' },
    { key: 'No valido', label: 'No válido', tone: 'muted' }
  ];
  // Un lead calificado es el que avanzo: calificado, cotizado o vendido. "No valido" (spam, duplicado) no cuenta como lead.
  const QUALIFIED = ['Calificado', 'Cotizado', 'Venta'];
  const CANALES = ['Formulario web', 'WhatsApp', 'Llamada', 'Correo', 'Otro'];
  const OBJECTIVES = {
    leads: { label: 'Leads', tone: 'new' },
    whatsapp: { label: 'WhatsApp', tone: 'green' }
  };
  const SAVE_DELAY = 700;
  const YEAR_SCOPE = 'year';

  const state = {
    ready: false,
    loading: null,
    snapshot: null,
    leads: [],
    status: 'loading',
    error: null,
    scope: null,
    campaign: 'all',
    estado: 'all',
    rowStatus: new Map(),
    timers: new Map()
  };

  const isNum = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const fmtMoney = value => (isNum(value) ? `S/ ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-');
  const fmtCount = value => (isNum(value) ? Number(value).toLocaleString('es-PE', { maximumFractionDigits: 0 }) : '-');
  const fmtDecimal = value => (isNum(value) ? Number(value).toLocaleString('es-PE', { maximumFractionDigits: 2 }) : '-');
  const fmtPercent = value => (isNum(value) ? `${(Number(value) * 100).toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '-');
  const fmtRoas = value => (isNum(value) ? `${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x` : '-');
  const ratio = (a, b) => (isNum(a) && isNum(b) && Number(b) !== 0 ? Number(a) / Number(b) : null);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const normalize = text => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  const limaToday = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
  const monthLabel = id => (/^\d{4}-\d{2}$/.test(id) ? `${MONTH_NAMES[Number(id.slice(5, 7)) - 1]} ${id.slice(0, 4)}` : id);
  const leadCount = (suffix = '') => `${state.leads.length} ${state.leads.length === 1 ? 'lead' : 'leads'}${suffix ? ` ${state.leads.length === 1 ? suffix.replace(/s$/, '') : suffix}` : ''}`;
  const estadoInfo = key => ESTADOS.find(item => item.key === key) || ESTADOS[0];

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
      period: month.period || null,
      campaigns: (month.campaigns || []).map(record => {
        const campaign = {
          platform: 'Google Ads',
          name: record.campaign,
          label: record.label || record.campaign,
          type: record.type || '',
          status: record.status || '',
          cost: Number(record.cost) || 0,
          clicks: Number(record.clicks) || 0,
          leads: Number(record.conversions) || 0
        };
        campaign.objective = detectObjective(campaign);
        campaign.key = normalize(campaign.name);
        return campaign;
      }).filter(campaign => campaign.objective)
    }));
  }

  // Campanas de leads de todo el ano (para el selector de la tabla), de la mas reciente a la mas vieja.
  function leadCampaigns() {
    const byKey = new Map();
    platformMonths(state.snapshot).slice().reverse().forEach(month => month.campaigns.forEach(campaign => {
      if (!byKey.has(campaign.key)) byKey.set(campaign.key, campaign);
    }));
    return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }

  // --- Guardado: Web App de la hoja privada o, sin el, este navegador ---

  const crmConfig = () => window.AQUARIUS_CRM || {};
  const isRemote = () => Boolean(crmConfig().url && crmConfig().token);

  const CRM_TIMEOUT = 20000;

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
      const leads = JSON.parse(window.localStorage.getItem(LOCAL_KEY) || '[]');
      return Array.isArray(leads) ? leads : [];
    } catch (error) {
      return [];
    }
  }

  function writeLocal(leads) {
    try {
      window.localStorage.setItem(LOCAL_KEY, JSON.stringify(leads));
    } catch (error) {
      throw new Error('el navegador no tiene espacio para guardar');
    }
  }

  const newId = () => (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : `lead-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  const store = {
    async list() {
      if (isRemote()) return (await callCrm('list')).leads || [];
      return readLocal();
    },
    async save(lead) {
      if (isRemote()) return (await callCrm('save', { lead })).lead;
      const leads = readLocal();
      const now = new Date().toISOString();
      const saved = Object.assign({}, lead, { id: lead.id || newId(), actualizado: now, creado: lead.creado || now });
      const index = leads.findIndex(item => item.id === saved.id);
      if (index >= 0) leads[index] = saved; else leads.push(saved);
      writeLocal(leads);
      return saved;
    },
    async remove(id) {
      if (isRemote()) { await callCrm('delete', { id }); return; }
      writeLocal(readLocal().filter(item => item.id !== id));
    }
  };

  // --- Validacion (la misma de crm-leads.gs) ---

  // Correos y celulares peruanos (9 digitos que empiezan con 9, con o sin +51). Fechas y RUC pasan.
  const hasContact = text => /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(text) || /(?:^|\D)(?:\+?51[\s.-]?)?9\d{2}[\s.-]?\d{3}[\s.-]?\d{3}(?!\d)/.test(text);

  function validate(lead) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(lead.fecha || ''))) return 'Falta la fecha';
    if (lead.fecha > limaToday()) return 'La fecha no puede ser futura';
    if (hasContact(`${lead.referencia || ''} ${lead.nota || ''}`)) return 'Sin teléfonos ni correos: usa una referencia interna';
    if (lead.estado === 'Venta' && isNum(lead.monto) && Number(lead.monto) < 0) return 'El monto no puede ser negativo';
    return null;
  }

  // --- Indicadores ---

  const monthOf = lead => String(lead.fecha || '').slice(0, 7);
  const inScope = (monthId, scope) => (scope === YEAR_SCOPE ? monthId.slice(0, 4) === yearOfScope() : monthId === scope);
  const yearOfScope = () => {
    const months = availableMonths();
    return (months[0] || limaToday()).slice(0, 4);
  };

  function crmTotals(leads) {
    const valid = leads.filter(lead => lead.estado !== 'No valido');
    const qualified = valid.filter(lead => QUALIFIED.includes(lead.estado));
    const sales = valid.filter(lead => lead.estado === 'Venta');
    return {
      real: valid.length,
      invalid: leads.length - valid.length,
      qualified: qualified.length,
      sales: sales.length,
      revenue: sales.reduce((total, lead) => total + (Number(lead.monto) || 0), 0)
    };
  }

  function indicators(row) {
    return Object.assign(row, {
      match: ratio(row.real, row.platformLeads),
      cplPlatform: ratio(row.cost, row.platformLeads),
      cplReal: ratio(row.cost, row.real),
      qualifyRate: ratio(row.qualified, row.real),
      costPerQualified: ratio(row.cost, row.qualified),
      closeRate: ratio(row.sales, row.real),
      costPerSale: ratio(row.cost, row.sales),
      ticket: ratio(row.revenue, row.sales),
      roas: ratio(row.revenue, row.cost)
    });
  }

  // Filas por campana del alcance (mes o ano): lo que reporta la plataforma junto a lo que registro el cliente.
  function summaryRows(scope) {
    const rows = new Map();
    const rowFor = (key, base) => {
      if (!rows.has(key)) rows.set(key, Object.assign({ key, cost: 0, platformLeads: 0, leads: [], reported: false }, base));
      return rows.get(key);
    };
    platformMonths(state.snapshot).filter(month => inScope(month.id, scope)).forEach(month => month.campaigns.forEach(campaign => {
      const row = rowFor(campaign.key, { name: campaign.name, label: campaign.label, platform: campaign.platform, objective: campaign.objective });
      row.cost += campaign.cost;
      row.platformLeads += campaign.leads;
      row.reported = true;
    }));
    const catalog = new Map(leadCampaigns().map(campaign => [campaign.key, campaign]));
    state.leads.filter(lead => inScope(monthOf(lead), scope)).forEach(lead => {
      const key = normalize(lead.campana);
      const known = catalog.get(key);
      const row = key
        ? rowFor(key, { name: lead.campana, label: known ? known.label : lead.campana, platform: lead.plataforma || (known && known.platform) || 'Otro', objective: known ? known.objective : null })
        : rowFor('', { name: '', label: 'Sin campaña identificada', platform: lead.plataforma || 'Otro', objective: null });
      row.leads.push(lead);
    });
    return [...rows.values()]
      .map(row => indicators(Object.assign(row, crmTotals(row.leads), { cost: row.reported ? row.cost : null, platformLeads: row.reported ? row.platformLeads : null })))
      .sort((a, b) => (b.cost || 0) - (a.cost || 0) || b.real - a.real || a.label.localeCompare(b.label, 'es'));
  }

  function totalsOf(rows) {
    const sum = field => rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
    const reported = rows.some(row => row.cost !== null);
    return indicators({
      cost: reported ? sum('cost') : null,
      platformLeads: reported ? sum('platformLeads') : null,
      real: sum('real'), invalid: sum('invalid'), qualified: sum('qualified'), sales: sum('sales'), revenue: sum('revenue')
    });
  }

  // --- Meses ---

  function availableMonths() {
    const ids = new Set(platformMonths(state.snapshot).filter(month => month.campaigns.length).map(month => month.id));
    state.leads.forEach(lead => { if (/^\d{4}-\d{2}$/.test(monthOf(lead))) ids.add(monthOf(lead)); });
    return [...ids].sort().reverse();
  }

  function defaultScope() {
    const cutoff = state.snapshot && state.snapshot.cutoff ? state.snapshot.cutoff.slice(0, 7) : null;
    const months = availableMonths();
    return months.includes(cutoff) ? cutoff : (months[0] || limaToday().slice(0, 7));
  }

  // --- Render ---

  function renderMode() {
    const host = document.getElementById('crm-mode');
    if (!host) return;
    let html = '';
    if (state.status === 'error') {
      const reason = String(state.error || '');
      html = `<strong>No se pudo leer el CRM.</strong>${escapeHtml(reason.charAt(0).toUpperCase() + reason.slice(1))}. Los cambios no se guardan hasta que vuelva la conexión: pulsa Actualizar para reintentar.`;
    } else if (!isRemote()) {
      html = '<strong>Modo de prueba: los leads se guardan solo en este navegador.</strong>Para que el cliente y la agencia vean lo mismo desde cualquier equipo hay que conectar la hoja privada del CRM (README > Leads).';
    }
    host.innerHTML = html;
    host.hidden = !html;
    host.classList.toggle('error', state.status === 'error');
  }

  function renderFilters() {
    const host = document.getElementById('crm-filters');
    if (!host) return;
    const months = availableMonths();
    const year = yearOfScope();
    const monthOptions = months.map(id => `<option value="${id}"${id === state.scope ? ' selected' : ''}>${escapeHtml(monthLabel(id))}</option>`).join('')
      + `<option value="${YEAR_SCOPE}"${state.scope === YEAR_SCOPE ? ' selected' : ''}>Todo ${escapeHtml(year)}</option>`;
    const campaigns = leadCampaigns();
    const campaignOptions = ['<option value="all">Todas las campañas</option>']
      .concat(campaigns.map(campaign => `<option value="${escapeHtml(campaign.key)}"${campaign.key === state.campaign ? ' selected' : ''}>${escapeHtml(campaign.label)}</option>`))
      .concat(`<option value=""${state.campaign === '' ? ' selected' : ''}>Sin campaña identificada</option>`).join('');
    const estadoOptions = ['<option value="all">Todos los estados</option>']
      .concat(ESTADOS.map(item => `<option value="${item.key}"${item.key === state.estado ? ' selected' : ''}>${item.label || item.key}</option>`)).join('');
    const where = isRemote() ? 'Hoja privada del CRM' : 'Solo este navegador';
    host.innerHTML = `
      <label class="retail-filter" for="crm-filter-month"><span>Periodo</span><select id="crm-filter-month">${monthOptions}</select><small>Mes de la fecha de cada lead</small></label>
      <label class="retail-filter" for="crm-filter-campaign"><span>Campaña</span><select id="crm-filter-campaign">${campaignOptions}</select><small>${campaigns.length} ${campaigns.length === 1 ? 'campaña' : 'campañas'} de leads o WhatsApp</small></label>
      <label class="retail-filter" for="crm-filter-estado"><span>Estado</span><select id="crm-filter-estado">${estadoOptions}</select><small>Filtra la tabla de leads</small></label>
      <div class="retail-filter"><span>Guardado</span><p class="crm-where">${escapeHtml(where)}</p><small id="crm-sync">${state.status === 'loading' ? 'Cargando...' : leadCount('registrados')}</small></div>`;
  }

  function renderKpis(totals) {
    const host = document.getElementById('crm-kpis');
    if (!host) return;
    const cards = [
      ['Leads de la plataforma', fmtDecimal(totals.platformLeads), 'Conversiones y conversaciones reportadas'],
      ['Leads reales', fmtCount(totals.real), totals.platformLeads ? `${fmtPercent(totals.match)} de lo reportado` : 'Registrados por el cliente'],
      ['Calificados', fmtCount(totals.qualified), `Tasa ${fmtPercent(totals.qualifyRate)}`],
      ['Ventas', fmtCount(totals.sales), `Cierre ${fmtPercent(totals.closeRate)}`],
      ['Monto vendido', fmtMoney(totals.revenue), `Ticket ${fmtMoney(totals.ticket)}`],
      ['Costo por lead real', fmtMoney(totals.cplReal), `Plataforma ${fmtMoney(totals.cplPlatform)}`],
      ['Costo por venta', fmtMoney(totals.costPerSale), `Por calificado ${fmtMoney(totals.costPerQualified)}`],
      ['ROAS', fmtRoas(totals.roas), 'Monto vendido / inversión']
    ];
    host.innerHTML = cards.map(([label, value, meta]) => `<div class="kpi-pill"><span>${label}</span><strong>${value}</strong><small>${meta}</small></div>`).join('');
  }

  function objectivePill(objective) {
    const info = OBJECTIVES[objective];
    return info ? `<span class="status-pill ${info.tone}">${info.label}</span>` : '<span class="no-data">-</span>';
  }

  // Valor con su tasa debajo (calificados y ventas).
  const withRate = (count, rate) => `${fmtCount(count)}${isNum(rate) ? `<small>${fmtPercent(rate)}</small>` : ''}`;

  function renderSummary(rows, totals) {
    const body = document.getElementById('crm-summary-body');
    if (!body) return;
    const scopeLabel = state.scope === YEAR_SCOPE ? `Todo ${yearOfScope()}` : monthLabel(state.scope);
    document.getElementById('crm-summary-title').textContent = `Indicadores por campaña | ${scopeLabel}`;
    document.getElementById('crm-summary-sub').textContent = `Inversión y leads de la plataforma se cargan solos; leads reales, calificados y ventas salen de lo que registra el cliente.`;
    const cell = row => `
        <td class="num">${row.cost === null ? '<span class="no-data">Sin informe</span>' : fmtMoney(row.cost)}</td>
        <td class="num">${row.platformLeads === null ? '<span class="no-data">-</span>' : fmtDecimal(row.platformLeads)}</td>
        <td class="num crm-strong">${fmtCount(row.real)}${row.invalid ? `<small>${row.invalid} no válidos</small>` : ''}</td>
        <td class="num">${fmtPercent(row.match)}</td>
        <td class="num">${withRate(row.qualified, row.qualifyRate)}</td>
        <td class="num">${withRate(row.sales, row.closeRate)}</td>
        <td class="num">${fmtMoney(row.revenue)}</td>
        <td class="num">${fmtMoney(row.cplPlatform)}</td>
        <td class="num crm-strong">${fmtMoney(row.cplReal)}</td>
        <td class="num">${fmtMoney(row.costPerQualified)}</td>
        <td class="num crm-strong">${fmtMoney(row.costPerSale)}</td>
        <td class="num">${fmtRoas(row.roas)}</td>`;
    body.innerHTML = rows.map(row => `
      <tr>
        <td class="campaign-name"><span>${escapeHtml(row.label)}</span>${row.name && row.name !== row.label ? `<small>${escapeHtml(row.name)}</small>` : ''}</td>
        <td>${escapeHtml(row.platform)}</td>
        <td>${objectivePill(row.objective)}</td>${cell(row)}
      </tr>`).join('') + (rows.length ? `
      <tr class="gasto-total-row"><td>Total</td><td></td><td></td>${cell(totals)}</tr>` : '<tr><td class="table-empty" colspan="15">Sin campañas de leads ni leads registrados en el periodo.</td></tr>');
    const foot = document.getElementById('crm-summary-foot');
    if (foot) {
      foot.textContent = 'Leads reales = leads registrados menos los "No válido" (spam, duplicados). Calificados = Calificado, Cotizado o Venta. '
        + 'Coincidencia = leads reales / leads de la plataforma. Costo por lead real, por calificado y por venta = inversión del periodo dividida entre cada conteo; ROAS = monto vendido / inversión. '
        + 'Google Ads reporta como leads sus conversiones (contactos); en Meta Ads serían los formularios o las conversaciones de WhatsApp.';
    }
  }

  function campaignOptions(lead) {
    const campaigns = leadCampaigns();
    const key = normalize(lead.campana);
    const options = campaigns.map(campaign => `<option value="${escapeHtml(campaign.name)}"${campaign.key === key ? ' selected' : ''}>${escapeHtml(campaign.label)}</option>`);
    // Una campana que ya no esta en el informe se conserva tal cual en el lead.
    if (key && !campaigns.some(campaign => campaign.key === key)) options.push(`<option value="${escapeHtml(lead.campana)}" selected>${escapeHtml(lead.campana)}</option>`);
    options.push(`<option value=""${key ? '' : ' selected'}>Sin campaña identificada</option>`);
    return options.join('');
  }

  const selectOptions = (items, value) => items.map(item => {
    const key = typeof item === 'string' ? item : item.key;
    const label = typeof item === 'string' ? item : item.label || item.key;
    return `<option value="${escapeHtml(key)}"${key === value ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');

  function rowStatusHtml(id) {
    const status = state.rowStatus.get(id);
    if (!status) return '';
    if (status.kind === 'saving') return '<span class="crm-row-status">Guardando...</span>';
    if (status.kind === 'saved') return '<span class="crm-row-status ok">Guardado</span>';
    return `<span class="crm-row-status error" title="${escapeHtml(status.message)}">${escapeHtml(status.message)}</span>`;
  }

  function visibleLeads() {
    return state.leads
      .filter(lead => inScope(monthOf(lead), state.scope))
      .filter(lead => state.campaign === 'all' || normalize(lead.campana) === state.campaign)
      .filter(lead => state.estado === 'all' || lead.estado === state.estado)
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(b.creado || '').localeCompare(String(a.creado || '')));
  }

  function renderLeads() {
    const body = document.getElementById('crm-leads-body');
    if (!body) return;
    const leads = visibleLeads();
    const sub = document.getElementById('crm-leads-sub');
    if (sub) sub.textContent = `${leads.length} ${leads.length === 1 ? 'lead' : 'leads'} en la vista. Cada cambio se guarda solo. Sin teléfonos ni correos: usa una referencia interna (por ejemplo, el número de ticket o la empresa).`;
    const add = document.getElementById('crm-add');
    if (add) add.disabled = state.status !== 'ok';
    if (state.status === 'loading') { body.innerHTML = '<tr><td class="table-empty" colspan="8">Cargando leads...</td></tr>'; return; }
    if (state.status === 'error') { body.innerHTML = '<tr><td class="table-empty" colspan="8">No se pudieron leer los leads de la hoja. Pulsa Actualizar para reintentar.</td></tr>'; return; }
    if (!leads.length) { body.innerHTML = '<tr><td class="table-empty" colspan="8">Sin leads en esta vista. Pulsa "Agregar lead" para registrar el primero.</td></tr>'; return; }
    body.innerHTML = leads.map(lead => {
      const tone = estadoInfo(lead.estado).tone;
      const sale = lead.estado === 'Venta';
      return `
      <tr data-lead="${escapeHtml(lead.id)}">
        <td><input class="crm-input crm-date" type="date" data-field="fecha" value="${escapeHtml(lead.fecha)}" max="${limaToday()}" aria-label="Fecha del lead"></td>
        <td><select class="crm-input crm-campaign" data-field="campana" aria-label="Campaña">${campaignOptions(lead)}</select></td>
        <td><select class="crm-input" data-field="canal" aria-label="Canal">${selectOptions(CANALES, lead.canal)}</select></td>
        <td><select class="crm-input crm-estado tone-${tone}" data-field="estado" aria-label="Estado">${selectOptions(ESTADOS, lead.estado)}</select></td>
        <td><input class="crm-input crm-money" type="number" min="0" step="0.01" inputmode="decimal" data-field="monto" value="${sale && isNum(lead.monto) ? escapeHtml(lead.monto) : ''}" placeholder="${sale ? 'S/ 0.00' : '-'}"${sale ? '' : ' disabled'} aria-label="Monto de la venta"></td>
        <td><input class="crm-input" type="text" maxlength="160" data-field="referencia" value="${escapeHtml(lead.referencia || '')}" placeholder="Ticket, empresa..." aria-label="Referencia"></td>
        <td><input class="crm-input crm-note" type="text" maxlength="160" data-field="nota" value="${escapeHtml(lead.nota || '')}" placeholder="Nota" aria-label="Nota"></td>
        <td class="crm-actions">${rowStatusHtml(lead.id)}<button class="crm-delete" type="button" data-delete="${escapeHtml(lead.id)}" title="Eliminar lead" aria-label="Eliminar lead">×</button></td>
      </tr>`;
    }).join('');
  }

  function renderNumbers() {
    const rows = summaryRows(state.scope);
    const totals = totalsOf(rows);
    renderKpis(totals);
    renderSummary(rows, totals);
    const counter = document.getElementById('crm-sync');
    if (counter && state.status === 'ok') counter.textContent = leadCount('registrados');
  }

  function updateTopbar() {
    const view = document.getElementById('view-leads');
    if (!view || !view.classList.contains('visible')) return;
    const status = document.getElementById('topbar-status');
    if (status) status.textContent = `${isRemote() ? 'CRM en la hoja privada' : 'CRM en este navegador'} | ${leadCount()}`;
  }

  // El modulo aparece en el panel lateral solo si la marca tiene campanas de leads o WhatsApp.
  function updateNavItem() {
    const item = document.querySelector('.s-item[data-view-target="view-leads"]');
    if (item && state.snapshot) item.hidden = !leadCampaigns().length;
  }

  function render() {
    if (!state.scope || (state.scope !== YEAR_SCOPE && !availableMonths().includes(state.scope) && availableMonths().length)) state.scope = defaultScope();
    renderMode();
    renderFilters();
    renderNumbers();
    renderLeads();
    updateTopbar();
  }

  // --- Edicion ---

  const leadById = id => state.leads.find(lead => lead.id === id) || null;

  function setRowStatus(id, kind, message) {
    state.rowStatus.set(id, { kind, message });
    const row = document.querySelector(`#crm-leads-body tr[data-lead="${CSS.escape(id)}"] .crm-actions`);
    if (row) {
      const current = row.querySelector('.crm-row-status');
      if (current) current.remove();
      row.insertAdjacentHTML('afterbegin', rowStatusHtml(id));
    }
  }

  async function persist(lead) {
    // Solo una venta lleva monto (igual que en crm-leads.gs).
    if (lead.estado !== 'Venta') lead.monto = null;
    const problem = validate(lead);
    if (problem) { setRowStatus(lead.id, 'error', problem); return; }
    setRowStatus(lead.id, 'saving');
    try {
      const saved = await store.save(lead);
      const current = leadById(lead.id);
      if (current && saved) Object.assign(current, { creado: saved.creado, actualizado: saved.actualizado });
      setRowStatus(lead.id, 'saved');
    } catch (error) {
      setRowStatus(lead.id, 'error', `No se guardó: ${error.message}`);
    }
  }

  function scheduleSave(lead) {
    clearTimeout(state.timers.get(lead.id));
    state.timers.set(lead.id, setTimeout(() => persist(lead), SAVE_DELAY));
  }

  function onFieldChange(input) {
    const row = input.closest('tr[data-lead]');
    const lead = row && leadById(row.dataset.lead);
    if (!lead) return;
    const field = input.dataset.field;
    lead[field] = input.value;
    if (field === 'campana') {
      const campaign = leadCampaigns().find(item => item.name === input.value);
      lead.plataforma = campaign ? campaign.platform : 'Otro';
    }
    if (field === 'monto') lead.monto = input.value === '' ? null : Number(input.value);
    if (field === 'estado') {
      if (lead.estado !== 'Venta') lead.monto = null;
      // El monto solo se habilita en ventas y el color sigue al estado: se repinta la fila.
      renderLeads();
      const select = document.querySelector(`#crm-leads-body tr[data-lead="${CSS.escape(lead.id)}"] [data-field="estado"]`);
      if (select) select.focus({ preventScroll: true });
    }
    renderNumbers();
    scheduleSave(lead);
  }

  // Fecha por defecto: hoy si cae en el periodo elegido; si no, el ultimo dia de ese mes (o el primero, si es futuro).
  function defaultDate() {
    const today = limaToday();
    if (state.scope === YEAR_SCOPE || today.slice(0, 7) === state.scope) return today;
    if (state.scope > today.slice(0, 7)) return `${state.scope}-01`;
    const [year, month] = state.scope.split('-').map(Number);
    return `${state.scope}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
  }

  async function addLead() {
    const campaigns = leadCampaigns();
    const chosen = (state.campaign !== 'all' && campaigns.find(campaign => campaign.key === state.campaign))
      || platformMonths(state.snapshot).filter(month => inScope(month.id, state.scope)).flatMap(month => month.campaigns).sort((a, b) => b.cost - a.cost)[0]
      || campaigns[0] || null;
    const lead = {
      id: newId(),
      fecha: defaultDate(),
      plataforma: chosen ? chosen.platform : 'Otro',
      campana: chosen ? chosen.name : '',
      canal: chosen && chosen.objective === 'whatsapp' ? 'WhatsApp' : 'Formulario web',
      estado: 'Nuevo',
      monto: null,
      referencia: '',
      nota: '',
      // Con fecha de creacion desde el inicio queda primero en la tabla y no salta de fila al guardarse.
      creado: new Date().toISOString()
    };
    state.leads.push(lead);
    state.estado = 'all';
    render();
    const input = document.querySelector(`#crm-leads-body tr[data-lead="${CSS.escape(lead.id)}"] [data-field="referencia"]`);
    if (input) input.focus();
    await persist(lead);
  }

  async function deleteLead(id) {
    const lead = leadById(id);
    if (!lead || !window.confirm('¿Eliminar este lead del CRM?')) return;
    clearTimeout(state.timers.get(id));
    try {
      await store.remove(id);
      state.leads = state.leads.filter(item => item.id !== id);
      state.rowStatus.delete(id);
      render();
    } catch (error) {
      setRowStatus(id, 'error', `No se eliminó: ${error.message}`);
    }
  }

  async function reload() {
    state.status = 'loading';
    render();
    try {
      state.leads = (await store.list()).filter(lead => lead && lead.id);
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
      if (prefs.campaign !== undefined) state.campaign = prefs.campaign;
    } catch (error) {
      /* sin preferencias: valores por defecto */
    }
  }

  function savePrefs() {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ scope: state.scope, campaign: state.campaign }));
    } catch (error) {
      /* sin almacenamiento: la seleccion dura lo que la pestana */
    }
  }

  function wireEvents() {
    const view = document.getElementById('view-leads');
    if (!view) return;
    view.addEventListener('change', event => {
      const target = event.target;
      if (target.id === 'crm-filter-month') state.scope = target.value;
      else if (target.id === 'crm-filter-campaign') state.campaign = target.value;
      else if (target.id === 'crm-filter-estado') state.estado = target.value;
      else if (target.dataset && target.dataset.field) { onFieldChange(target); return; }
      else return;
      savePrefs();
      render();
    });
    // Los textos se guardan mientras se escriben (con una pausa), no solo al salir del campo.
    view.addEventListener('input', event => {
      const target = event.target;
      if (target.dataset && (target.dataset.field === 'referencia' || target.dataset.field === 'nota' || target.dataset.field === 'monto')) onFieldChange(target);
    });
    view.addEventListener('click', event => {
      const remove = event.target.closest('[data-delete]');
      if (remove) { deleteLead(remove.dataset.delete); return; }
      if (event.target.closest('#crm-add')) { addLead(); return; }
      if (event.target.closest('#crm-refresh')) reload();
    });
  }

  function takeSnapshot() {
    state.snapshot = window.AquariusDashboard && window.AquariusDashboard.snapshot ? window.AquariusDashboard.snapshot() : null;
    updateNavItem();
  }

  // Se inicia al abrir la vista (navigation.js): la primera vez lee los leads.
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
