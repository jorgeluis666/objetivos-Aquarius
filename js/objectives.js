(function () {
  const DATA_URL = 'data/amador-ads-2026.json';
  const JUNE_DATA_URL = 'data/amador-june-sheet-2026.json';
  const SHEET_ID = '1Lj5rEepYZhHlf-VyGJwRYVMqnpWLu9lg3oL6wes3o-s';
  const SHEET_GID = '1847912276';
  const LIVE_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
  const SYNC_INTERVAL_MS = 60 * 60 * 1000;
  const GOALS_KEY = 'amador-reservation-goals-v1';
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const SHORT_MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const REQUIRED_HEADERS = ['Tipo','Campaña','Anuncio','Objetivo','Reservas','Objetivo Reservas','Mensajes','Costo por mensaje','Costo por reserva','Ratio de reservas','Estado','Fecha de inicio','Fecha de fin','Duración (días)','Días restantes','Importe diario','Presupuesto total x anuncio','Gasto x Anuncio','Presupuesto total x campaña','Gasto x Campaña','Saldo x anuncio','Saldo por campaña','Proyección real de gasto mesual'];
  const OPTIONAL_HEADERS = ['Nuevo ppto diario','Observaciones'];
  const SERIES = {
    investment: { label: 'Inversion', unit: 'money', color: '#2563eb', fill: 'rgba(37,99,235,.11)' },
    messages: { label: 'Mensajes', unit: 'count', color: '#16a34a', fill: 'rgba(22,163,74,.10)' },
    reservations: { label: 'Reservas', unit: 'count', color: '#ea580c', fill: 'rgba(234,88,12,.10)' },
  };
  const state = { data: null, type: 'investment', month: 'Junio', chart: null, syncTimer: null, goals: readGoals(), lastSync: null };

  const fmtMoney = value => Number.isFinite(Number(value)) ? `S/. ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-';
  const fmtCount = value => Number(value || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 });
  const fmtRatio = value => Number.isFinite(Number(value)) ? `${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : '-';
  const fmtShort = value => {
    if (value == null) return '';
    if (value >= 1000) return `S/. ${(value / 1000).toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}k`;
    return `S/. ${Math.round(value)}`;
  };

  function readGoals() {
    try { return JSON.parse(localStorage.getItem(GOALS_KEY) || '{}'); } catch { return {}; }
  }
  function saveGoals() {
    try { localStorage.setItem(GOALS_KEY, JSON.stringify(state.goals)); } catch {}
  }
  function normalizeHeader(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
  }
  function parseNumber(value) {
    const text = String(value ?? '').trim();
    if (!text || text === '-') return null;
    const normalized = text.replace(/S\/?\.?/gi, '').replace(/%/g, '').replace(/,/g, '').trim();
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }
  function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (quoted && char === '"' && next === '"') { cell += '"'; i += 1; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (!quoted && char === ',') { row.push(cell); cell = ''; continue; }
      if (!quoted && (char === '\n' || char === '\r')) {
        if (char === '\r' && next === '\n') i += 1;
        row.push(cell); rows.push(row); row = []; cell = ''; continue;
      }
      cell += char;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(items => items.some(item => String(item).trim() !== ''));
  }
  function headerMap(headers) {
    const map = {};
    headers.forEach((header, index) => { map[normalizeHeader(header)] = index; });
    return map;
  }
  function get(row, map, name) { return row[map[normalizeHeader(name)]] ?? ''; }
  function validateHeaders(headers) {
    const map = headerMap(headers);
    const missing = REQUIRED_HEADERS.filter(name => map[normalizeHeader(name)] == null);
    if (missing.length) throw new Error(`Cabeceras faltantes: ${missing.join(', ')}`);
    return map;
  }
  function dateLabel(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return text || null;
    const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return `${match[1].padStart(2, '0')}-${months[Number(match[2]) - 1] || 'Mes'}`;
  }
  function goalKey(campaign, ad) { return `${campaign}::${ad}`; }
  function effectiveGoal(campaign, ad) {
    const saved = state.goals[goalKey(campaign.name, ad.name)];
    return saved === '' || saved == null ? ad.reservationGoal : Number(saved);
  }
  function sourceMonth(name) { return state.data.months.find(month => month.name === name); }
  function cloneData(data) { return JSON.parse(JSON.stringify(data)); }
  function valueFor(name, type) {
    const month = sourceMonth(name);
    if (!month) return null;
    if (type === 'investment') return month.spend;
    if (Number.isFinite(Number(month[type]))) return Number(month[type]);
    const field = type === 'reservations' ? 'reservas' : 'messages';
    const ads = (month.campaigns || []).flatMap(campaign => campaign.ads || []);
    if (!ads.some(ad => ad[field] != null)) return null;
    return ads.reduce((total, ad) => total + Number(ad[field] || 0), 0);
  }
  function formatSeriesValue(value, series, short = false) {
    if (value == null) return '';
    if (series.unit === 'money') return short ? fmtShort(value) : fmtMoney(value);
    return fmtCount(value);
  }
  function sheetToJuneData(rows) {
    const headerIndex = rows.findIndex(row => row.some(cell => normalizeHeader(cell) === 'tipo') && row.some(cell => normalizeHeader(cell) === 'estado'));
    if (headerIndex < 0) throw new Error('No se encontro la fila de cabeceras del sheet.' );
    const headers = rows[headerIndex];
    const map = validateHeaders(headers);
    const campaigns = [];
    let current = null;
    let totals = null;
    rows.slice(headerIndex + 1).forEach(row => {
      const first = String(get(row, map, 'Tipo')).trim();
      const campaignName = String(get(row, map, 'Campaña')).trim();
      const adName = String(get(row, map, 'Anuncio')).trim();
      if (!first && !campaignName && !adName) return;
      if (first.toLowerCase().startsWith('total')) {
        totals = row;
        return;
      }
      if (campaignName) {
        current = {
          name: campaignName,
          type: first,
          status: String(get(row, map, 'Estado')).trim(),
          budget: parseNumber(get(row, map, 'Presupuesto total x campaña')),
          spent: parseNumber(get(row, map, 'Gasto x Campaña')),
          balance: parseNumber(get(row, map, 'Saldo por campaña')),
          realBalance: null,
          reservas: 0,
          messages: 0,
          ads: []
        };
        campaigns.push(current);
      }
      if (!current || !adName) return;
      const ad = {
        name: adName,
        objective: String(get(row, map, 'Objetivo')).trim(),
        status: String(get(row, map, 'Estado')).trim(),
        reservas: parseNumber(get(row, map, 'Reservas')) || 0,
        reservationGoal: parseNumber(get(row, map, 'Objetivo Reservas')),
        messages: parseNumber(get(row, map, 'Mensajes')) || 0,
        costPerMessage: parseNumber(get(row, map, 'Costo por mensaje')),
        costPerReservation: parseNumber(get(row, map, 'Costo por reserva')),
        reservationRatio: parseNumber(get(row, map, 'Ratio de reservas')),
        startDate: dateLabel(get(row, map, 'Fecha de inicio')),
        endDate: dateLabel(get(row, map, 'Fecha de fin')),
        duration: parseNumber(get(row, map, 'Duración (días)')),
        daysRemaining: parseNumber(get(row, map, 'Días restantes')),
        dailyAmount: parseNumber(get(row, map, 'Importe diario')),
        budget: parseNumber(get(row, map, 'Presupuesto total x anuncio')),
        spent: parseNumber(get(row, map, 'Gasto x Anuncio')),
        balance: parseNumber(get(row, map, 'Saldo x anuncio')),
        newDailyAmount: parseNumber(get(row, map, 'Nuevo ppto diario')),
        observation: String(get(row, map, 'Observaciones')).trim() || null,
        adUrl: null
      };
      if (ad.costPerMessage == null && ad.messages > 0 && ad.spent != null) ad.costPerMessage = ad.spent / ad.messages;
      if (ad.costPerReservation == null && ad.reservas > 0 && ad.spent != null) ad.costPerReservation = ad.spent / ad.reservas;
      if (ad.reservationRatio == null && ad.messages > 0) ad.reservationRatio = ad.reservas / ad.messages * 100;
      current.ads.push(ad);
      current.reservas += ad.reservas;
      current.messages += ad.messages;
      if (ad.observation && !current.observation) current.observation = ad.observation;
    });
    const allAds = campaigns.flatMap(campaign => campaign.ads);
    const adSpendTotal = parseNumber(totals && get(totals, map, 'Gasto x Anuncio')) ?? allAds.reduce((sum, ad) => sum + Number(ad.spent || 0), 0);
    const spend = parseNumber(totals && get(totals, map, 'Gasto x Campaña')) ?? campaigns.reduce((sum, campaign) => sum + Number(campaign.spent || 0), 0);
    const budgetTotal = parseNumber(totals && get(totals, map, 'Presupuesto total x campaña')) ?? campaigns.reduce((sum, campaign) => sum + Number(campaign.budget || 0), 0);
    const balanceTotal = parseNumber(totals && get(totals, map, 'Saldo por campaña')) ?? campaigns.reduce((sum, campaign) => sum + Number(campaign.balance || 0), 0);
    return {
      name: 'Junio',
      spend,
      messages: allAds.reduce((sum, ad) => sum + Number(ad.messages || 0), 0),
      reservations: allAds.reduce((sum, ad) => sum + Number(ad.reservas || 0), 0),
      adSpendTotal,
      budgetTotal,
      balanceTotal,
      newDailyTotal: parseNumber(totals && get(totals, map, 'Nuevo ppto diario')),
      totalObservation: String(totals && get(totals, map, 'Observaciones')).trim(),
      spendBreakdown: { sales: Math.max(0, spend - 326.61), branding: 326.61 },
      campaigns,
      headers: headers.map(header => String(header || '').trim()).filter(Boolean),
      source: 'Google Sheets / Distribucion-amador / Junio'
    };
  }
  function mergeJuneData(juneData, source = 'Google Sheets') {
    const data = cloneData(state.data);
    const index = data.months.findIndex(month => month.name === 'Junio');
    if (index >= 0) data.months[index] = juneData;
    else data.months.push(juneData);
    data.cutoff = new Date().toISOString().slice(0, 10);
    data.source = source;
    state.data = data;
  }
  async function fetchLiveSheet() {
    const response = await fetch(`${LIVE_CSV_URL}&cacheBust=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return sheetToJuneData(parseCsv(await response.text()));
  }
  async function syncLiveSheet({ silent = false } = {}) {
    try {
      const juneData = await fetchLiveSheet();
      mergeJuneData(juneData);
      state.lastSync = new Date();
      renderAll();
      updateSyncLabel('Datos sincronizados desde Google Sheets');
    } catch (error) {
      if (!silent) console.warn('[amador] No se pudo sincronizar Google Sheets:', error);
      updateSyncLabel('Datos locales, esperando sincronizacion');
    }
  }
  function updateSyncLabel(text) {
    const label = document.getElementById('topbar-status');
    if (label && state.month === 'Junio') label.textContent = text;
  }
  function renderKpis() {
    const month = sourceMonth(state.month);
    const host = document.getElementById('kpi-strip');
    if (!host || !month) return;
    const investment = Number(month.spend || 0);
    const messages = Number(month.messages ?? valueFor(state.month, 'messages') ?? 0);
    const reservations = Number(month.reservations ?? valueFor(state.month, 'reservations') ?? 0);
    const costMessage = messages > 0 ? investment / messages : null;
    const costReservation = reservations > 0 ? investment / reservations : null;
    const cards = [
      ['Inversión', fmtMoney(investment), 'Gasto total'],
      ['Mensajes', fmtCount(messages), 'Conversaciones iniciadas'],
      ['Costo por mensaje', fmtMoney(costMessage), 'Inversión / mensajes'],
      ['Reservas', fmtCount(reservations), 'Conversiones de reserva'],
      ['Costo por reserva', fmtMoney(costReservation), 'Inversión / reservas']
    ];
    host.innerHTML = cards.map(([label, value, meta]) => `<div class="kpi-pill"><span>${label}</span><strong>${value}</strong><small>${meta}</small></div>`).join('');
  }
  function renderTabs() {
    const host = document.getElementById('month-tabs');
    host.innerHTML = MONTHS.map(name => {
      const available = !!sourceMonth(name);
      const selected = name === state.month;
      return `<button type="button" class="month-tab ${selected ? 'active' : ''}" data-month="${name}" ${available ? '' : 'disabled'}>${name}${name === 'Junio' ? '<span class="current-dot"></span>' : ''}</button>`;
    }).join('');
    host.querySelectorAll('.month-tab:not(:disabled)').forEach(button => {
      button.addEventListener('click', () => { state.month = button.dataset.month; renderAll(false); });
    });
  }
  function statusClass(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'activa' || normalized === 'activo') return 'green';
    if (normalized === 'finalizada' || normalized === 'finalizado' || normalized === 'off') return 'red';
    return 'muted';
  }
  function renderReservationProgress(value, goal) {
    if (goal == null || Number(goal) <= 0) return `${value}`;
    const reached = Number(value) >= Number(goal);
    const label = reached ? 'Sobre el objetivo' : 'Debajo del objetivo';
    return `<span class="reservation-value">${value}</span><span class="reservation-trend ${reached ? 'up' : 'down'}" title="${label}: ${value}/${goal}" aria-label="${label}: ${value} de ${goal}">${reached ? '▲' : '▼'} Objetivo: ${goal}</span>`;
  }
  function renderDeadline(endDate, days) {
    if (!endDate) return '-';
    if (days == null) return endDate;
    const counterClass = days === 0 ? 'closed' : days <= 3 ? 'urgent' : '';
    const label = days === 0 ? 'Plazo finalizado' : `${days} ${days === 1 ? 'día restante' : 'días restantes'}`;
    return `${endDate}<span class="days-counter ${counterClass}">${label}</span>`;
  }
  function renderGoalInput(campaign, ad) {
    const value = effectiveGoal(campaign, ad);
    return `<input class="reservation-goal-input" type="number" min="0" step="1" value="${value ?? ''}" data-campaign="${campaign.name}" data-ad="${ad.name}" aria-label="Objetivo Reservas ${campaign.name} ${ad.name}">`;
  }
  function renderCampaigns() {
    const month = sourceMonth(state.month);
    const campaigns = month.campaigns || [];
    const active = campaigns.filter(c => ['activa', 'activo'].includes(String(c.status || '').toLowerCase())).length;
    document.getElementById('campaigns-title').textContent = `Campanas de ${month.name} 2026`;
    document.getElementById('campaigns-sub').textContent = campaigns.length ? `${active} activas de ${campaigns.length} campanas registradas.` : 'Sin detalle de campanas en el archivo fuente.';
    const body = document.getElementById('campaigns-body');
    if (!campaigns.length) { body.innerHTML = '<tr><td colspan="24" class="table-empty">Sin campanas registradas para este mes.</td></tr>'; return; }
    const rows = [];
    let totalReservas = 0;
    let totalMessages = 0;
    for (const c of campaigns) {
      const ads = c.ads?.length ? c.ads : [null];
      const span = ads.length;
      ads.forEach((ad, i) => {
        const currentAd = ad || {};
        const budget = currentAd.budget ?? c.budget;
        const spent = currentAd.spent ?? (span === 1 ? c.spent : null);
        const daily = currentAd.dailyAmount ?? c.dailyAmount;
        const obj = currentAd.objective ?? c.objective;
        const st = currentAd.status ?? c.status;
        const adName = currentAd.name ?? '—';
        const reservas = Number(currentAd.reservas ?? (span === 1 ? c.reservas : 0) ?? 0);
        const messages = Number(currentAd.messages ?? (span === 1 ? c.messages : 0) ?? 0);
        const goal = effectiveGoal(c, currentAd);
        const costPerMessage = currentAd.costPerMessage ?? (messages > 0 && spent != null ? spent / messages : null);
        const costPerReservation = currentAd.costPerReservation ?? (reservas > 0 && spent != null ? spent / reservas : null);
        const ratio = currentAd.reservationRatio ?? (messages > 0 ? reservas / messages * 100 : null);
        const adBalance = currentAd.balance ?? (budget != null && spent != null ? budget - spent : null);
        const observation = currentAd.observation ?? (i === 0 ? c.observation : null);
        totalReservas += reservas;
        totalMessages += messages;
        const rs = span > 1 ? ` rowspan="${span}"` : '';
        let tr = '<tr>';
        if (i === 0) tr += `<td class="type-col"${rs}>${c.type || '—'}</td>`;
        if (i === 0) tr += `<td class="campaign-name"${rs}>${c.name}</td>`;
        tr += `<td class="ad-name-col">${adName}</td>`;
        tr += `<td><span class="objective-pill">${obj || '—'}</span></td>`;
        tr += `<td class="resultados-col">${renderReservationProgress(reservas, goal)}</td>`;
        tr += `<td class="goal-col">${currentAd.name ? renderGoalInput(c, currentAd) : '-'}</td>`;
        tr += `<td class="num">${fmtCount(messages)}</td>`;
        tr += `<td class="num">${fmtMoney(costPerMessage)}</td>`;
        tr += `<td class="num">${fmtMoney(costPerReservation)}</td>`;
        tr += `<td class="num">${fmtRatio(ratio)}</td>`;
        tr += `<td><span class="status-pill ${statusClass(st)}">${st || '—'}</span></td>`;
        tr += `<td class="date-col">${currentAd.startDate || '—'}</td>`;
        tr += `<td class="date-col deadline-cell">${renderDeadline(currentAd.endDate, currentAd.daysRemaining)}</td>`;
        tr += `<td class="num">${currentAd.duration != null ? currentAd.duration + ' d' : '—'}</td>`;
        tr += `<td class="num">${fmtMoney(daily)}</td>`;
        tr += `<td class="num">${fmtMoney(budget)}</td>`;
        tr += `<td class="num">${fmtMoney(spent)}</td>`;
        if (i === 0) tr += `<td class="num campaign-total"${rs}>${fmtMoney(c.budget)}</td>`;
        if (i === 0) tr += `<td class="num campaign-total"${rs}>${fmtMoney(c.spent)}</td>`;
        tr += `<td class="num">${fmtMoney(adBalance)}</td>`;
        if (i === 0) tr += `<td class="num campaign-total"${rs}>${fmtMoney(c.balance)}</td>`;
        tr += `<td class="num">${fmtMoney(currentAd.newDailyAmount)}</td>`;
        tr += `<td class="observation-col">${observation || '—'}</td>`;
        tr += '</tr>';
        rows.push(tr);
      });
    }
    rows.push(`<tr class="reservations-total-row"><td colspan="4">Total actualizado ${month.name.toLowerCase()}</td><td class="resultados-col">${totalReservas}</td><td></td><td class="num">${totalMessages}</td><td colspan="6"></td><td></td><td></td><td></td><td class="num">${fmtMoney(month.adSpendTotal)}</td><td class="num">${fmtMoney(month.budgetTotal)}</td><td class="num">${fmtMoney(month.spend)}</td><td class="num">${fmtMoney(month.balanceTotal)}</td><td></td><td>${month.totalObservation || ''}</td></tr>`);
    body.innerHTML = rows.join('');
  }
  function chartOptions(series) {
    const isMoney = series.unit === 'money';
    return { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, layout: { padding: { top: 24, right: 12, left: 4 } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => ` ${series.label}: ${formatSeriesValue(context.raw, series)}` } } }, scales: { x: { grid: { display: false }, border: { color: '#cbd5e1' }, ticks: { color: '#7890b5', font: { size: 10 } } }, y: { beginAtZero: true, suggestedMax: isMoney ? 3500 : undefined, border: { display: false }, grid: { color: 'rgba(148,163,184,.20)' }, ticks: { precision: 0, color: '#7890b5', font: { size: 10 }, callback: value => isMoney ? (value === 0 ? 'S/. 0' : `S/. ${(value / 1000).toFixed(1)}k`) : Number(value).toLocaleString('es-PE') } } } };
  }
  function renderChart() {
    const series = SERIES[state.type];
    const values = MONTHS.map(name => valueFor(name, state.type));
    document.getElementById('chart-title').textContent = `Evolucion mensual | ${series.label} | 2026`;
    document.getElementById('legend-label').textContent = series.label;
    document.querySelector('.legend-line').className = `legend-line ${state.type}`;
    const canvas = document.getElementById('chart-monthly');
    if (typeof Chart === 'undefined') { canvas.parentElement.innerHTML = '<div class="empty-state"><strong>Grafico no disponible sin conexion.</strong><span>Los totales mensuales siguen visibles debajo.</span></div>'; return; }
    if (state.chart) state.chart.destroy();
    state.chart = new Chart(canvas, { type: 'line', data: { labels: SHORT_MONTHS, datasets: [{ label: series.label, data: values, borderColor: series.color, backgroundColor: series.fill, borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 7, pointBackgroundColor: series.color, pointBorderColor: series.color, tension: .25, fill: true, spanGaps: false }] }, options: chartOptions(series), plugins: [{ id: 'valueLabels', afterDatasetsDraw(chart) { const ctx = chart.ctx; const meta = chart.getDatasetMeta(0); ctx.save(); ctx.fillStyle = series.color; ctx.font = '600 10px Inter, sans-serif'; ctx.textAlign = 'center'; meta.data.forEach((point,index) => { const value = values[index]; if (value == null) return; ctx.fillText(formatSeriesValue(value, series, true), point.x, point.y - 13); }); ctx.restore(); } }] });
  }
  function renderAll(withTabs = true) {
    renderKpis();
    renderChart();
    if (withTabs) renderTabs();
    renderCampaigns();
  }
  function wireEvents() {
    document.getElementById('spend-type-select').addEventListener('change', event => { state.type = event.target.value; renderChart(); });
    document.getElementById('campaigns-body').addEventListener('change', event => {
      const input = event.target.closest('.reservation-goal-input');
      if (!input) return;
      state.goals[goalKey(input.dataset.campaign, input.dataset.ad)] = input.value;
      saveGoals();
      renderCampaigns();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) syncLiveSheet({ silent: true }); });
  }
  async function init() {
    try {
      if (window.AMADOR_ADS_DATA) state.data = window.AMADOR_ADS_DATA;
      else { const response = await fetch(DATA_URL, { cache: 'no-store' }); if (!response.ok) throw new Error(`HTTP ${response.status}`); state.data = await response.json(); }
      const juneData = window.AMADOR_JUNE_DATA || await fetch(JUNE_DATA_URL, { cache: 'no-store' }).then(response => response.json());
      mergeJuneData(juneData, state.data.source || 'Datos locales');
      wireEvents();
      renderAll();
      syncLiveSheet({ silent: true });
      state.syncTimer = setInterval(() => syncLiveSheet({ silent: true }), SYNC_INTERVAL_MS);
    } catch (error) { document.getElementById('view-obj').innerHTML = '<div class="data-notice error"><strong>No se pudo cargar la informacion de Amador.</strong></div>'; console.error(error); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
