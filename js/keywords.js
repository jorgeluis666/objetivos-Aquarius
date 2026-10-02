/**
 * keywords.js - Analisis de Palabras Clave.
 *
 * Lee el informe mensual de palabras clave de busqueda de Google Ads
 * (data/aquarius-palabras-clave-2026.json, que scripts/sync-keywords.py actualiza
 * todos los dias desde Drive) y muestra un cuadro por campana con el
 * comportamiento de sus palabras clave: el detalle del mes elegido con su
 * tendencia, o la evolucion mes a mes de un indicador.
 *
 * El boton Actualizar vuelve a leer las hojas de Drive desde el navegador: la
 * exportacion CSV de Google Sheets responde con CORS abierto y no pide API key.
 * Con API key (AQ_DRIVE_API_KEY) ademas lista la carpeta y encuentra meses nuevos;
 * sin ella usa la lista de hojas que dejo la ultima sincronizacion diaria.
 *
 * El parser sigue el mismo criterio que scripts/sync-keywords.py.
 */
(function () {
  'use strict';

  const DATA_URL = 'data/aquarius-palabras-clave-2026.json';
  const CACHE_KEY = 'aquarius_keywords_cache';
  const PREFS_KEY = 'aquarius_keywords_prefs';
  const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
  const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const MONTH_BY_NAME = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
    agosto: 8, setiembre: 9, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
  };
  const MONTH_PREFIX = {};
  Object.keys(MONTH_BY_NAME).forEach(name => { MONTH_PREFIX[name.slice(0, 3)] = MONTH_BY_NAME[name]; });
  // Indicador de la tendencia y de la evolucion mensual. lowerIsBetter invierte el color de la variacion;
  // neutral la deja sin color (gastar mas no es mejor ni peor por si solo).
  const METRICS = {
    clicks: { label: 'Clics', unit: 'count' },
    impressions: { label: 'Impresiones', unit: 'count' },
    cost: { label: 'Costo', unit: 'money', neutral: true },
    conversions: { label: 'Conversiones', unit: 'decimal' },
    ctr: { label: 'CTR', unit: 'percent' },
    costPerConversion: { label: 'Costo por conversión', unit: 'money', lowerIsBetter: true }
  };
  const BASE_FIELDS = ['impressions', 'clicks', 'cost', 'conversions'];
  const CAMPAIGN_NAMES = {
    DIGITALIZACIONDEDCOUMENTOS: 'Digitalización de documentos',
    GESTIONLOGISTICA: 'Gestión logística',
    VALUACIONESCOMERCIALES: 'Valuaciones comerciales',
    FOTOGRAMETRIACONDRONES: 'Fotogrametría con drones',
    ALMACENAMIENTO: 'Almacenamiento',
    ACTIVOSFIJOS: 'Activos fijos',
    PRODUCTOSTI: 'Productos TI',
    OUTSOURCINGDEALMACENES: 'Outsourcing de almacenes',
    DIAGNOSTICOSISTEMACONTROLINTERNOTICO: 'Diagnóstico de control interno'
  };
  // Encabezados del informe -> campo interno (mismo mapa que scripts/sync-keywords.py).
  const COLUMNS = {
    'palabra clave': ['keyword', 'text'],
    'tipo de concordancia': ['matchType', 'text'],
    'campana': ['campaign', 'text'],
    'grupo de anuncios': ['adGroup', 'text'],
    'estado de palabras clave': ['state', 'text'],
    'estado': ['status', 'text'],
    'motivos del estado': ['reasons', 'text'],
    'impr.': ['impressions', 'count'],
    'impr': ['impressions', 'count'],
    'impresiones': ['impressions', 'count'],
    'clics': ['clicks', 'count'],
    'costo': ['cost', 'number'],
    'coste': ['cost', 'number'],
    'conversiones': ['conversions', 'number'],
    'conv.': ['conversions', 'number'],
    '% impr. parte sup. busqueda': ['topShare', 'share'],
    '% impr. perdidas de la busqueda (ranking)': ['lostRank', 'share']
  };

  const state = {
    data: null, months: [], index: {}, campaigns: [], config: null,
    monthId: null, campaign: '', metric: 'clicks', view: 'month',
    running: false, syncMessage: null, syncTone: null
  };
  let loading = null;

  const isNum = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const fmtMoney = value => (isNum(value) ? `S/ ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-');
  const fmtCount = value => (isNum(value) ? Number(value).toLocaleString('es-PE', { maximumFractionDigits: 0 }) : '-');
  const fmtDecimal = value => (isNum(value) ? Number(value).toLocaleString('es-PE', { maximumFractionDigits: 2 }) : '-');
  const fmtPercent = value => (isNum(value) ? `${(Number(value) * 100).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : '-');
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const normalize = text => String(text == null ? '' : text).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase().replace(/\s+/g, ' ');

  function format(value, unit) {
    if (unit === 'money') return fmtMoney(value);
    if (unit === 'percent') return fmtPercent(value);
    if (unit === 'decimal') return fmtDecimal(value);
    return fmtCount(value);
  }

  function monthLabel(monthId) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(monthId || ''));
    return match ? `${MONTH_NAMES[Number(match[2]) - 1]} ${match[1]}` : String(monthId || '');
  }

  function shortMonth(monthId) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(monthId || ''));
    return match ? `${MONTH_NAMES[Number(match[2]) - 1].slice(0, 3)} ${match[1].slice(2)}` : String(monthId || '');
  }

  function campaignLabel(name) {
    const raw = String(name || '').replace(/^IDG_AQUARIUSCONSULTING_PE_SKAG-/i, '');
    const key = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    return CAMPAIGN_NAMES[key] || raw.replace(/\s+/g, ' ').trim() || 'Sin campaña';
  }

  // --- Parser del informe de palabras clave ---

  function parseNumber(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text || text === '--' || text === '-' || text.charAt(0) === '<') return null;
    const cleaned = text.replace(/[^\d,.\-]/g, '').replace(/,/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return null;
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  }

  // Sheets leyo "1,290" como 1.29 y lo exporta "1,29": el grupo de miles siempre tiene tres digitos.
  function parseCount(value) {
    let text = String(value == null ? '' : value).trim();
    const match = /^(\d{1,3}(?:,\d{3})*),(\d{1,2})$/.exec(text);
    if (match) text = `${match[1]},${match[2].padEnd(3, '0')}`;
    const number = parseNumber(text);
    return number === null ? null : Math.round(number);
  }

  // Las cuotas de impresiones vienen acotadas ("< 10%", "> 90%"): se guardan tal cual.
  function parseShare(value) {
    const text = String(value == null ? '' : value).trim();
    return text === '' || text === '--' || text === '-' ? null : text;
  }

  const PARSERS = { number: parseNumber, count: parseCount, share: parseShare };

  // Lector de CSV con comillas: los exports traen "1,244" y textos con comas.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === '"') {
          if (text[index + 1] === '"') { field += '"'; index += 1; } else { quoted = false; }
        } else {
          field += char;
        }
        continue;
      }
      if (char === '"') { quoted = true; continue; }
      if (char === ',') { row.push(field); field = ''; continue; }
      if (char === '\n' || char === '\r') {
        if (char === '\r' && text[index + 1] === '\n') index += 1;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        continue;
      }
      field += char;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function monthFromText(text) {
    const plain = normalize(text);
    const named = /([a-z]+)\s+(?:de\s+)?(\d{4})/.exec(plain);
    if (named && MONTH_BY_NAME[named[1]]) return `${named[2]}-${String(MONTH_BY_NAME[named[1]]).padStart(2, '0')}`;
    const numeric = /(\d{4})[-_.](\d{2})/.exec(plain);
    return numeric ? `${numeric[1]}-${numeric[2]}` : null;
  }

  function periodFromText(text) {
    const pattern = /\b(\d{1,2})\s+(?:de\s+)?([a-z]{3})[a-z]*\.?\s+(?:de\s+)?(\d{4})/g;
    const plain = normalize(text);
    const dates = [];
    let match;
    while ((match = pattern.exec(plain))) {
      if (MONTH_PREFIX[match[2]]) dates.push(`${match[3]}-${String(MONTH_PREFIX[match[2]]).padStart(2, '0')}-${match[1].padStart(2, '0')}`);
    }
    return dates.length >= 2 ? { start: dates[0], end: dates[dates.length - 1] } : null;
  }

  function parseKeywordReport(text, name) {
    const rows = parseCsv(text);
    let headerIndex = -1;
    for (let index = 0; index < Math.min(rows.length, 12); index += 1) {
      const plain = rows[index].map(normalize);
      if (plain.indexOf('palabra clave') >= 0 && plain.indexOf('campana') >= 0) { headerIndex = index; break; }
    }
    if (headerIndex < 0) return null;

    let monthId = null;
    let period = null;
    for (let index = 0; index < headerIndex; index += 1) {
      monthId = monthId || monthFromText(rows[index].join(' '));
      period = period || periodFromText(rows[index].join(' '));
    }
    monthId = monthId || monthFromText(name);
    if (!monthId) return null;

    const columns = {};
    rows[headerIndex].forEach((cell, position) => {
      const mapped = COLUMNS[normalize(cell)];
      if (mapped && !columns[mapped[0]]) columns[mapped[0]] = { position, kind: mapped[1] };
    });

    const keywords = [];
    rows.slice(headerIndex + 1).forEach(row => {
      if (!row.some(cell => String(cell).trim())) return;
      // Las filas "Total: ..." resumen la cuenta, no una palabra clave.
      if (normalize(row[0]).indexOf('total') === 0) return;
      const entry = {};
      Object.keys(columns).forEach(field => {
        const column = columns[field];
        const raw = column.position < row.length ? row[column.position] : null;
        const value = column.kind === 'text' ? String(raw == null ? '' : raw).trim() : PARSERS[column.kind](raw);
        if (value !== null && value !== '') entry[field] = value;
      });
      if (!entry.keyword || !entry.campaign) return;
      BASE_FIELDS.forEach(field => { if (entry[field] === undefined) entry[field] = 0; });
      keywords.push(entry);
    });
    return keywords.length ? { monthId, period, keywords } : null;
  }

  // --- Datos ---

  function normalizeMonths(data) {
    return (Array.isArray(data && data.months) ? data.months : [])
      .filter(month => /^\d{4}-\d{2}$/.test(String(month.id || '')))
      .map(month => ({
        id: String(month.id),
        label: month.label || monthLabel(month.id),
        sourceFile: month.sourceFile || null,
        period: month.period || null,
        keywords: Array.isArray(month.keywords) ? month.keywords : []
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  const keywordKey = row => `${normalize(row.keyword)}|${normalize(row.matchType)}`;
  const splitReasons = text => String(text || '').split(';').map(part => part.trim()).filter(Boolean);

  // Indice mes -> campana -> palabra clave. Una palabra clave en varios grupos de
  // anuncios de la campana se suma en una fila; asi se sigue igual de mes a mes.
  function buildIndex() {
    const campaigns = {};
    state.index = {};
    state.months.forEach(month => {
      const byCampaign = {};
      month.keywords.forEach(row => {
        const group = byCampaign[row.campaign] || (byCampaign[row.campaign] = {});
        const key = keywordKey(row);
        let entry = group[key];
        if (!entry) {
          entry = group[key] = {
            key, keyword: row.keyword, matchType: row.matchType || '', status: row.status || '',
            reasons: [], adGroups: [], impressions: 0, clicks: 0, cost: 0, conversions: 0,
            topShare: row.topShare || null, lostRank: row.lostRank || null
          };
        } else {
          // Las cuotas de impresiones de dos grupos no se pueden sumar.
          entry.topShare = null;
          entry.lostRank = null;
        }
        BASE_FIELDS.forEach(field => { entry[field] += Number(row[field]) || 0; });
        splitReasons(row.reasons).forEach(reason => { if (entry.reasons.indexOf(reason) < 0) entry.reasons.push(reason); });
        if (row.adGroup && entry.adGroups.indexOf(row.adGroup) < 0) entry.adGroups.push(row.adGroup);
        campaigns[row.campaign] = true;
      });
      state.index[month.id] = byCampaign;
    });
    state.campaigns = Object.keys(campaigns).sort((a, b) => campaignLabel(a).localeCompare(campaignLabel(b), 'es'));
  }

  function setData(data) {
    const previousDefault = state.data && state.data.defaultMonth;
    state.data = data;
    state.months = normalizeMonths(data);
    buildIndex();
    const ids = state.months.map(month => month.id);
    const latest = ids[ids.length - 1] || null;
    // Si se estaba viendo el ultimo mes y llega uno nuevo, se pasa al nuevo.
    if (!state.monthId || ids.indexOf(state.monthId) < 0 || (previousDefault && state.monthId === previousDefault)) state.monthId = latest;
    if (state.campaign && state.campaigns.indexOf(state.campaign) < 0) state.campaign = '';
  }

  const currentMonth = () => state.months.find(month => month.id === state.monthId) || null;

  function previousMonth(monthId) {
    const index = state.months.findIndex(month => month.id === monthId);
    return index > 0 ? state.months[index - 1] : null;
  }

  function campaignRows(monthId, campaign) {
    const group = (state.index[monthId] || {})[campaign];
    return group ? Object.keys(group).map(key => group[key]) : [];
  }

  function totalsOf(rows) {
    const totals = { impressions: 0, clicks: 0, cost: 0, conversions: 0, count: rows.length };
    rows.forEach(row => BASE_FIELDS.forEach(field => { totals[field] += Number(row[field]) || 0; }));
    return totals;
  }

  // Las razones se calculan sobre las sumas, igual que Google Ads.
  function metricValue(totals, metric) {
    if (!totals) return null;
    if (metric === 'ctr') return totals.impressions > 0 ? totals.clicks / totals.impressions : null;
    if (metric === 'cpc') return totals.clicks > 0 ? totals.cost / totals.clicks : null;
    if (metric === 'conversionRate') return totals.clicks > 0 ? totals.conversions / totals.clicks : null;
    if (metric === 'costPerConversion') return totals.conversions > 0 ? totals.cost / totals.conversions : null;
    return Number(totals[metric]) || 0;
  }

  // Serie mensual de una palabra clave (key) o de toda la campana (key = null).
  function seriesOf(campaign, key) {
    return state.months.map(month => {
      if (key === null) {
        const rows = campaignRows(month.id, campaign);
        return { id: month.id, totals: rows.length ? totalsOf(rows) : null };
      }
      const group = (state.index[month.id] || {})[campaign];
      return { id: month.id, totals: group && group[key] ? group[key] : null };
    });
  }

  function visibleCampaigns(monthId) {
    if (state.campaign) return [state.campaign];
    const source = monthId ? Object.keys(state.index[monthId] || {}) : state.campaigns;
    const cost = campaign => (monthId
      ? totalsOf(campaignRows(monthId, campaign)).cost
      : state.months.reduce((total, month) => total + totalsOf(campaignRows(month.id, campaign)).cost, 0));
    return source.slice().sort((a, b) => cost(b) - cost(a));
  }

  const campaignPaused = rows => rows.length > 0 && rows.every(row => row.reasons.some(reason => normalize(reason) === 'campana detenida'));

  // --- Piezas de la vista ---

  function statusTone(status) {
    const plain = normalize(status);
    if (plain === 'apta') return 'green';
    if (plain.indexOf('limitad') === 0) return 'amber';
    return 'muted';
  }

  function deltaTone(change, metric) {
    const info = METRICS[metric];
    if (info.neutral || Math.abs(change) < 0.005) return '';
    return (info.lowerIsBetter ? change < 0 : change > 0) ? 'up' : 'down';
  }

  const deltaPct = change => `${change > 0 ? '+' : ''}${(change * 100).toLocaleString('es-PE', { maximumFractionDigits: 0 })}%`;

  function deltaHtml(series, index, metric) {
    if (index <= 0) return '<span class="kw-delta">Sin mes anterior</span>';
    const before = series[index - 1];
    const now = series[index];
    if (!before.totals) return `<span class="kw-delta new">Nueva vs ${escapeHtml(shortMonth(before.id))}</span>`;
    const current = metricValue(now.totals, metric);
    const previous = metricValue(before.totals, metric);
    if (!isNum(current) || !isNum(previous) || previous === 0) return `<span class="kw-delta">Sin base en ${escapeHtml(shortMonth(before.id))}</span>`;
    const change = current / previous - 1;
    return `<span class="kw-delta ${deltaTone(change, metric)}">${deltaPct(change)} vs ${escapeHtml(shortMonth(before.id))}</span>`;
  }

  // Linea de tendencia: el indicador en cada mes cargado; el punto lleno es el mes elegido.
  function sparkline(series, metric) {
    const width = 104;
    const height = 28;
    const pad = 3;
    const unit = METRICS[metric].unit;
    const points = series.map(item => ({ id: item.id, value: item.totals ? metricValue(item.totals, metric) : null }));
    const values = points.map(point => point.value).filter(isNum);
    const title = points.map(point => `${shortMonth(point.id)}: ${isNum(point.value) ? format(point.value, unit) : 'sin datos'}`).join(' | ');
    if (!values.length) return '<span class="kw-delta">Sin datos</span>';
    const max = Math.max(...values);
    const min = Math.min(0, ...values);
    const span = max - min || 1;
    const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
    let path = '';
    let pen = false;
    const dots = [];
    points.forEach((point, index) => {
      if (!isNum(point.value)) { pen = false; return; }
      const x = (pad + index * step).toFixed(1);
      const y = (height - pad - ((point.value - min) / span) * (height - pad * 2)).toFixed(1);
      path += `${pen ? 'L' : 'M'}${x} ${y} `;
      pen = true;
      const current = point.id === state.monthId;
      dots.push(`<circle cx="${x}" cy="${y}" r="${current ? 2.8 : 1.5}"${current ? ' class="is-current"' : ''}/>`);
    });
    return `<svg class="kw-spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(title)}"><title>${escapeHtml(title)}</title><path d="${path.trim()}"/>${dots.join('')}</svg>`;
  }

  // Lectura del mes: compara el costo por conversion de la palabra clave con el de su campana.
  function reading(entry, campaignCpa) {
    if (!entry.impressions) return ['Sin impresiones', 'muted', 'No apareció en búsquedas este mes.'];
    if (!entry.clicks) return ['Sin clics', 'muted', `${fmtCount(entry.impressions)} impresiones sin clics.`];
    if (!entry.conversions) return [entry.cost > 0 ? 'Gasta sin convertir' : 'Sin conversiones', 'red', `${fmtMoney(entry.cost)} en ${fmtCount(entry.clicks)} clics sin conversiones.`];
    const cpa = entry.cost / entry.conversions;
    if (!isNum(campaignCpa) || cpa <= campaignCpa) return ['Eficiente', 'green', `Costo por conversión ${fmtMoney(cpa)}; campaña ${fmtMoney(campaignCpa)}.`];
    return ['CPA alto', 'amber', `Costo por conversión ${fmtMoney(cpa)}, sobre el de la campaña (${fmtMoney(campaignCpa)}).`];
  }

  function campaignHead(campaign, rows, facts) {
    const paused = campaignPaused(rows);
    const pill = rows.length
      ? `<span class="status-pill ${paused ? 'muted' : 'green'}" title="Estado al exportar el informe">${paused ? 'Campaña detenida' : 'Activa'}</span>`
      : '';
    return `
      <header class="kw-campaign-head">
        <div class="campaign-name"><span>${escapeHtml(campaignLabel(campaign))}</span>${campaignLabel(campaign) === campaign ? '' : `<small>${escapeHtml(campaign)}</small>`}</div>
        ${pill}
      </header>
      <dl class="kw-facts">${facts.map(([term, value, note]) => `<div><dt>${term}</dt><dd>${value}${note || ''}</dd></div>`).join('')}</dl>`;
  }

  function monthCard(campaign) {
    const month = currentMonth();
    const rows = campaignRows(state.monthId, campaign).sort((a, b) => b.cost - a.cost || b.clicks - a.clicks || b.impressions - a.impressions);
    if (!rows.length) {
      return `<article class="panel kw-campaign">${campaignHead(campaign, rows, [])}<div class="empty-state kw-empty"><strong>Sin palabras clave en ${escapeHtml(month ? month.label : 'el mes')}</strong><span>Cambia de mes o mira la evolución mensual de la campaña.</span></div></article>`;
    }
    const totals = totalsOf(rows);
    const cpa = metricValue(totals, 'costPerConversion');
    const index = state.months.findIndex(item => item.id === state.monthId);
    const campaignSeries = seriesOf(campaign, null);
    const metric = METRICS[state.metric];
    const facts = [
      ['Palabras clave', fmtCount(rows.length), `<small>${rows.filter(row => row.conversions > 0).length} con conversiones</small>`],
      ['Impresiones', fmtCount(totals.impressions)],
      ['Clics', fmtCount(totals.clicks), `<small>CTR ${fmtPercent(metricValue(totals, 'ctr'))}</small>`],
      ['Costo', fmtMoney(totals.cost), `<small>CPC ${fmtMoney(metricValue(totals, 'cpc'))}</small>`],
      ['Conversiones', fmtDecimal(totals.conversions), `<small>Tasa ${fmtPercent(metricValue(totals, 'conversionRate'))}</small>`],
      ['Costo x conversión', fmtMoney(cpa)],
      [`${metric.label} vs mes anterior`, '', deltaHtml(campaignSeries, index, state.metric)]
    ];

    const body = rows.map(entry => {
      const series = seriesOf(campaign, entry.key);
      const [label, tone, detail] = reading(entry, cpa);
      const reasons = entry.reasons.join('; ');
      const groups = entry.adGroups.length > 1 ? ` · ${entry.adGroups.length} grupos` : '';
      return `
          <tr>
            <td class="kw-name"><span>${escapeHtml(entry.keyword)}</span><small>${escapeHtml(entry.matchType || 'Sin concordancia')}${groups}</small></td>
            <td><span class="status-pill ${statusTone(entry.status)}"${reasons ? ` title="${escapeHtml(reasons)}"` : ''}>${escapeHtml(entry.status || '-')}</span>${reasons ? `<small class="kw-reason">${escapeHtml(reasons)}</small>` : ''}</td>
            <td class="num">${fmtCount(entry.impressions)}</td>
            <td class="num">${fmtCount(entry.clicks)}</td>
            <td class="num">${fmtPercent(metricValue(entry, 'ctr'))}</td>
            <td class="num">${fmtMoney(metricValue(entry, 'cpc'))}</td>
            <td class="num kw-strong">${fmtMoney(entry.cost)}</td>
            <td class="num">${fmtDecimal(entry.conversions)}</td>
            <td class="num">${fmtMoney(metricValue(entry, 'costPerConversion'))}</td>
            <td class="num">${escapeHtml(entry.lostRank || '-')}${entry.topShare ? `<small>Parte sup. ${escapeHtml(entry.topShare)}</small>` : ''}</td>
            <td class="kw-trend">${sparkline(series, state.metric)}${deltaHtml(series, index, state.metric)}</td>
            <td><span class="status-pill ${tone}" title="${escapeHtml(detail)}">${label}</span></td>
          </tr>`;
    }).join('');

    return `
      <article class="panel kw-campaign">
        ${campaignHead(campaign, rows, facts)}
        <div class="table-scroll">
          <table class="data-table kw-table">
            <thead><tr><th>Palabra clave</th><th>Estado</th><th class="num">Impr.</th><th class="num">Clics</th><th class="num">CTR</th><th class="num">CPC</th><th class="num">Costo</th><th class="num">Conv.</th><th class="num">Costo/conv.</th><th class="num" title="% de impresiones perdidas por ranking; debajo, % en la parte superior">Perdidas x ranking</th><th>Tendencia: ${escapeHtml(metric.label)}</th><th>Lectura</th></tr></thead>
            <tbody>${body}
            </tbody>
            <tfoot>
              <tr>
                <td>Total campaña</td><td></td>
                <td class="num">${fmtCount(totals.impressions)}</td>
                <td class="num">${fmtCount(totals.clicks)}</td>
                <td class="num">${fmtPercent(metricValue(totals, 'ctr'))}</td>
                <td class="num">${fmtMoney(metricValue(totals, 'cpc'))}</td>
                <td class="num">${fmtMoney(totals.cost)}</td>
                <td class="num">${fmtDecimal(totals.conversions)}</td>
                <td class="num">${fmtMoney(cpa)}</td>
                <td></td>
                <td class="kw-trend">${sparkline(campaignSeries, state.metric)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </article>`;
  }

  // Evolucion mensual: una fila por palabra clave y una columna por mes con el indicador elegido.
  function trendCard(campaign) {
    const metric = METRICS[state.metric];
    const keys = {};
    state.months.forEach(month => campaignRows(month.id, campaign).forEach(row => { keys[row.key] = row; }));
    const rows = Object.keys(keys).map(key => {
      const series = seriesOf(campaign, key);
      const total = totalsOf(series.filter(item => item.totals).map(item => item.totals));
      return { entry: keys[key], series, total };
    }).sort((a, b) => b.total.cost - a.total.cost || b.total.clicks - a.total.clicks);
    const campaignSeries = seriesOf(campaign, null);
    const allTotals = totalsOf(campaignSeries.filter(item => item.totals).map(item => item.totals));
    const activeMonths = campaignSeries.filter(item => item.totals).length;
    const latestRows = campaignRows(state.months[state.months.length - 1].id, campaign);
    const facts = [
      ['Palabras clave', fmtCount(rows.length), '<small>en el periodo</small>'],
      ['Meses con datos', `${activeMonths} de ${state.months.length}`],
      ['Clics', fmtCount(allTotals.clicks), `<small>CTR ${fmtPercent(metricValue(allTotals, 'ctr'))}</small>`],
      ['Costo', fmtMoney(allTotals.cost)],
      ['Conversiones', fmtDecimal(allTotals.conversions)],
      ['Costo x conversión', fmtMoney(metricValue(allTotals, 'costPerConversion'))]
    ];

    const cell = (totals, max) => {
      const value = totals ? metricValue(totals, state.metric) : null;
      if (!isNum(value)) return '<td class="num kw-heat-empty">-</td>';
      const alpha = max > 0 && value > 0 ? (0.06 + 0.34 * (value / max)).toFixed(3) : 0;
      return `<td class="num"${alpha ? ` style="background:rgba(2,132,199,${alpha})"` : ''}>${format(value, metric.unit)}</td>`;
    };
    const head = state.months.map(month => `<th class="num${month.id === state.monthId ? ' kw-col-active' : ''}">${escapeHtml(shortMonth(month.id))}</th>`).join('');
    const body = rows.map(({ entry, series, total }) => {
      const values = series.map(item => (item.totals ? metricValue(item.totals, state.metric) : null)).filter(isNum);
      const max = values.length ? Math.max(...values) : 0;
      return `
          <tr>
            <td class="kw-name"><span>${escapeHtml(entry.keyword)}</span><small>${escapeHtml(entry.matchType || 'Sin concordancia')}</small></td>
            ${series.map(item => cell(item.totals, max)).join('')}
            <td class="num kw-strong">${format(metricValue(total, state.metric), metric.unit)}</td>
          </tr>`;
    }).join('');
    const footValues = campaignSeries.map(item => (item.totals ? metricValue(item.totals, state.metric) : null)).filter(isNum);
    const footMax = footValues.length ? Math.max(...footValues) : 0;

    return `
      <article class="panel kw-campaign">
        ${campaignHead(campaign, latestRows, facts)}
        <div class="table-scroll">
          <table class="data-table kw-table kw-trend-table">
            <thead><tr><th>Palabra clave</th>${head}<th class="num">Acumulado</th></tr></thead>
            <tbody>${body}
            </tbody>
            <tfoot><tr><td>Total campaña</td>${campaignSeries.map(item => cell(item.totals, footMax)).join('')}<td class="num">${format(metricValue(allTotals, state.metric), metric.unit)}</td></tr></tfoot>
          </table>
        </div>
      </article>`;
  }

  // --- Render ---

  function lastSyncLabel() {
    const stamp = state.data && state.data.drive && state.data.drive.lastSync;
    if (!stamp) return 'Sin sincronizar con Drive';
    const date = new Date(stamp);
    if (Number.isNaN(date.getTime())) return `Datos actualizados: ${stamp}`;
    const fecha = date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
    const hora = date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    return `Datos actualizados: ${fecha}, ${hora}`;
  }

  function renderFilters() {
    const host = document.getElementById('kw-filters');
    if (!host) return;
    const month = currentMonth();
    const inMonth = state.index[state.monthId] || {};
    const monthOptions = state.months.slice().reverse()
      .map(item => `<option value="${escapeHtml(item.id)}"${item.id === state.monthId ? ' selected' : ''}>${escapeHtml(item.label)}</option>`).join('');
    const campaignOptions = ['<option value="">Todas las campañas</option>'].concat(state.campaigns.map(campaign => (
      `<option value="${escapeHtml(campaign)}"${campaign === state.campaign ? ' selected' : ''}>${escapeHtml(campaignLabel(campaign))}${inMonth[campaign] ? '' : ' (sin datos en el mes)'}</option>`
    ))).join('');
    const metricOptions = Object.keys(METRICS)
      .map(key => `<option value="${key}"${key === state.metric ? ' selected' : ''}>${METRICS[key].label}</option>`).join('');
    const source = month && month.sourceFile ? `Fuente: ${month.sourceFile}` : 'Fuente pendiente de cargar';
    const count = Object.keys(inMonth).length;
    host.innerHTML = `
      <label class="retail-filter" for="kw-filter-month">
        <span>Mes</span>
        <select id="kw-filter-month"${state.months.length > 1 ? '' : ' disabled'}>${monthOptions}</select>
        <small title="${escapeHtml(source)}">${escapeHtml(source)}</small>
      </label>
      <label class="retail-filter" for="kw-filter-campaign">
        <span>Campaña</span>
        <select id="kw-filter-campaign">${campaignOptions}</select>
        <small>${count} ${count === 1 ? 'campaña' : 'campañas'} con palabras clave en el mes</small>
      </label>
      <label class="retail-filter" for="kw-filter-metric">
        <span>Indicador de tendencia</span>
        <select id="kw-filter-metric">${metricOptions}</select>
        <small>Línea de tendencia y evolución mensual</small>
      </label>
      <div class="retail-filter filter-sync">
        <span>Actualización</span>
        <button class="sync-btn${state.running ? ' is-busy' : ''}" id="kw-sync-now" type="button"${state.running ? ' disabled' : ''}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
          <b>Actualizar</b>
        </button>
        <small id="kw-sync-status" class="${state.syncTone || ''}">${escapeHtml(state.syncMessage || lastSyncLabel())}</small>
      </div>`;
  }

  function renderKpis() {
    const host = document.getElementById('kw-kpis');
    if (!host) return;
    const month = currentMonth();
    const previous = previousMonth(state.monthId);
    const campaigns = visibleCampaigns(state.monthId);
    const rows = [].concat(...campaigns.map(campaign => campaignRows(state.monthId, campaign)));
    const totals = totalsOf(rows);
    const before = previous ? totalsOf([].concat(...campaigns.map(campaign => campaignRows(previous.id, campaign)))) : null;
    const vs = metric => {
      if (!before) return 'Sin mes anterior';
      const now = metricValue(totals, metric);
      const old = metricValue(before, metric);
      if (!isNum(now) || !isNum(old) || old === 0) return `Sin base en ${shortMonth(previous.id)}`;
      const change = now / old - 1;
      return `<b class="kw-delta-inline ${deltaTone(change, metric)}">${deltaPct(change)}</b> vs ${shortMonth(previous.id)}`;
    };
    const wasted = rows.filter(row => row.cost > 0 && !row.conversions);
    const wastedCost = wasted.reduce((total, row) => total + row.cost, 0);
    const cards = [
      ['Palabras clave', fmtCount(rows.length), `${rows.filter(row => row.conversions > 0).length} con conversiones`],
      ['Impresiones', fmtCount(totals.impressions), vs('impressions')],
      ['Clics', fmtCount(totals.clicks), `CTR ${fmtPercent(metricValue(totals, 'ctr'))} · ${vs('clicks')}`],
      ['Costo', fmtMoney(totals.cost), vs('cost')],
      ['Conversiones', fmtDecimal(totals.conversions), vs('conversions')],
      ['Costo x conversión', fmtMoney(metricValue(totals, 'costPerConversion')), vs('costPerConversion')],
      ['Gasto sin conversiones', fmtMoney(wastedCost), `${wasted.length} ${wasted.length === 1 ? 'palabra clave' : 'palabras clave'} · ${fmtPercent(totals.cost > 0 ? wastedCost / totals.cost : null)} del costo`]
    ];
    host.innerHTML = cards.map(([label, value, meta]) => `<div class="kpi-pill"><span>${label}</span><strong>${value}</strong><small>${meta}</small></div>`).join('');
    host.setAttribute('aria-label', `Resumen de palabras clave de ${month ? month.label : 'el mes'}`);
  }

  function renderCampaigns() {
    const host = document.getElementById('kw-campaigns');
    const title = document.getElementById('kw-campaigns-title');
    const sub = document.getElementById('kw-campaigns-sub');
    const foot = document.getElementById('kw-foot');
    if (!host) return;
    const month = currentMonth();
    const metric = METRICS[state.metric];
    document.querySelectorAll('[data-kw-view]').forEach(button => {
      const active = button.dataset.kwView === state.view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    if (state.view === 'trend') {
      const campaigns = visibleCampaigns(null);
      const first = state.months[0];
      const last = state.months[state.months.length - 1];
      if (title) title.textContent = `Evolución mensual | ${metric.label}`;
      if (sub) sub.textContent = `${campaigns.length} ${campaigns.length === 1 ? 'campaña' : 'campañas'} | ${state.months.length} meses, de ${first.label} a ${last.label}.`;
      host.innerHTML = campaigns.map(trendCard).join('');
      if (foot) foot.textContent = `Cada celda es ${metric.label.toLowerCase()} de la palabra clave en el mes; el color más intenso marca el valor más alto de su fila. "-" = la palabra clave no aparece en el informe de ese mes. Acumulado = suma de los meses (CTR y costo por conversión se recalculan sobre las sumas). El mes resaltado es el del filtro.`;
      return;
    }

    const campaigns = visibleCampaigns(state.monthId);
    const rows = [].concat(...campaigns.map(campaign => campaignRows(state.monthId, campaign)));
    if (title) title.textContent = `Comportamiento por campaña | ${month ? month.label : ''}`;
    if (sub) sub.textContent = `${campaigns.length} ${campaigns.length === 1 ? 'campaña' : 'campañas'} | ${rows.length} palabras clave | ${fmtMoney(totalsOf(rows).cost)} de costo en el mes.`;
    host.innerHTML = campaigns.length
      ? campaigns.map(monthCard).join('')
      : `<div class="empty-state"><strong>Sin palabras clave en ${escapeHtml(month ? month.label : 'el mes')}</strong><span>El informe del mes no trae filas.</span></div>`;
    if (foot) {
      foot.textContent = 'CTR = clics / impresiones, CPC = costo / clics y costo por conversión = costo / conversiones, calculados sobre las sumas como en Google Ads. '
        + 'Una palabra clave en varios grupos de anuncios de la campaña se suma en una fila. '
        + `Tendencia = ${metric.label.toLowerCase()} de la palabra clave en cada mes cargado (punto lleno = mes del filtro), con la variación contra el mes anterior. `
        + 'Lectura: Eficiente = costo por conversión igual o menor al de su campaña; CPA alto = mayor; Gasta sin convertir = tuvo costo y ninguna conversión. '
        + 'Las cuotas de impresiones vienen acotadas por Google Ads (< 10%, > 90%). Estado = el de la palabra clave al exportar el informe.';
    }
  }

  // La barra superior y el pie son de la vista activa: con otra vista abierta no se tocan.
  function updateSourceLabels() {
    const view = document.getElementById('view-keywords');
    if (!view || !view.classList.contains('visible')) return;
    const month = currentMonth();
    const status = document.getElementById('topbar-status');
    if (status && month) status.textContent = `Informe de palabras clave | ${month.label}`;
    const source = document.getElementById('footer-source');
    if (source && month) source.textContent = `Fuente: ${month.sourceFile || 'data/aquarius-palabras-clave-2026.json'} (Drive: Google Ads Aquarius Keywords)`;
  }

  function render() {
    if (!state.months.length) {
      renderEmpty();
      return;
    }
    renderFilters();
    renderKpis();
    renderCampaigns();
    updateSourceLabels();
  }

  function renderEmpty() {
    renderFilters();
    const kpis = document.getElementById('kw-kpis');
    if (kpis) kpis.innerHTML = '';
    const host = document.getElementById('kw-campaigns');
    if (host) host.innerHTML = '<div class="empty-state"><strong>Sin informes de palabras clave</strong><span>Sube la hoja del mes a la carpeta de Drive "Google Ads Aquarius Keywords" y pulsa Actualizar.</span></div>';
  }

  function renderError(error) {
    console.error('[keywords]', error);
    const host = document.getElementById('kw-campaigns');
    if (host) host.innerHTML = `<div class="data-notice error"><strong>No se pudo cargar el análisis de palabras clave.</strong>${escapeHtml(error && error.message ? error.message : error)}</div>`;
  }

  // --- Preferencias y cache ---

  function readPrefs() {
    try {
      const prefs = JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}');
      if (prefs.monthId) state.monthId = prefs.monthId;
      if (prefs.campaign) state.campaign = prefs.campaign;
      if (METRICS[prefs.metric]) state.metric = prefs.metric;
      if (prefs.view === 'trend') state.view = 'trend';
    } catch (error) {
      /* sin preferencias guardadas: valores por defecto */
    }
  }

  function savePrefs() {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ monthId: state.monthId, campaign: state.campaign, metric: state.metric, view: state.view }));
    } catch (error) {
      /* sin almacenamiento: la seleccion dura lo que la pestana */
    }
  }

  function readCache() {
    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeCache(data) {
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (error) {
      /* sin espacio en localStorage: la data sigue viva en memoria */
    }
  }

  const syncStamp = data => (data && data.drive && data.drive.lastSync) || '';

  async function loadConfig() {
    let config = window.AQUARIUS_DRIVE_CONFIG;
    if (!config || !config.keywords) {
      try {
        const response = await fetch('data/drive-config.json', { cache: 'no-store' });
        if (response.ok) config = Object.assign({}, await response.json(), config || {});
      } catch (error) {
        /* sin configuracion: el boton usa la lista de hojas de la ultima sincronizacion */
      }
    }
    config = config || {};
    return { folderId: (config.keywords && config.keywords.folderId) || '', apiKey: config.apiKey || '' };
  }

  async function load() {
    let data = window.AQUARIUS_KEYWORDS_DATA;
    if (!data) {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`No se encontró ${DATA_URL} (HTTP ${response.status})`);
      data = await response.json();
    }
    // Lo que el navegador actualizo antes gana contra la publicacion si es mas reciente.
    const cached = readCache();
    if (cached && Array.isArray(cached.months) && cached.months.length && syncStamp(cached) > syncStamp(data)) data = cached;
    setData(data);
    state.config = await loadConfig();
  }

  // --- Boton Actualizar ---

  function setStatus(text, tone) {
    state.syncMessage = text;
    state.syncTone = tone || null;
    const node = document.getElementById('kw-sync-status');
    if (!node) return;
    node.textContent = text;
    node.classList.remove('is-error', 'is-working', 'is-ok');
    if (tone) node.classList.add(tone);
  }

  function setBusy(busy) {
    state.running = busy;
    const button = document.getElementById('kw-sync-now');
    if (!button) return;
    button.classList.toggle('is-busy', busy);
    button.disabled = busy;
  }

  async function listFiles() {
    const config = state.config || {};
    if (config.apiKey && config.folderId) {
      try {
        const query = encodeURIComponent(`'${config.folderId}' in parents and trashed = false`);
        const url = `https://www.googleapis.com/drive/v3/files?q=${query}&key=${encodeURIComponent(config.apiKey)}`
          + `&fields=${encodeURIComponent('files(id,name,modifiedTime,mimeType)')}&pageSize=200`;
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Drive respondio ${response.status}`);
        const payload = await response.json();
        const files = (payload.files || []).filter(file => file.mimeType === SHEET_MIME || /\.csv$/i.test(file.name));
        if (files.length) return { files, discovery: 'navegador (API)' };
      } catch (error) {
        console.warn('[keywords] no se pudo listar la carpeta; uso la ultima lista conocida', error);
      }
    }
    const known = ((state.data && state.data.drive && state.data.drive.files) || []).filter(file => file && file.id);
    return { files: known, discovery: 'navegador' };
  }

  async function downloadFile(file) {
    const config = state.config || {};
    let url;
    if (/\.csv$/i.test(file.name)) {
      if (!config.apiKey) throw new Error(`${file.name}: un CSV de Drive solo se lee con API key`);
      url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&key=${encodeURIComponent(config.apiKey)}`;
    } else {
      // La exportacion CSV de Sheets responde con CORS abierto: no necesita API key.
      url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(file.id)}/export?format=csv`;
    }
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${file.name} (${response.status})`);
    return response.text();
  }

  function mergeIntoData(base, reports, files, discovery) {
    const data = JSON.parse(JSON.stringify(base || {}));
    const byId = {};
    (Array.isArray(data.months) ? data.months : []).forEach(month => { byId[month.id] = month; });
    reports.forEach(report => {
      const month = byId[report.monthId] || { id: report.monthId };
      month.label = monthLabel(report.monthId);
      month.sourceFile = report.sourceFile;
      month.driveFileId = report.fileId;
      if (report.period) month.period = report.period;
      else delete month.period;
      month.keywords = report.keywords;
      byId[report.monthId] = month;
    });
    data.months = Object.keys(byId).sort().map(id => byId[id]);
    data.defaultMonth = data.months.length ? data.months[data.months.length - 1].id : null;
    data.drive = {
      folderId: (state.config && state.config.folderId) || (data.drive && data.drive.folderId) || '',
      discovery,
      lastSync: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      files: files.map(file => ({ id: file.id, name: file.name, modifiedTime: file.modifiedTime || null }))
    };
    return data;
  }

  // Sin hojas conocidas ni API key el navegador no puede listar la carpeta (sin CORS):
  // se trae la ultima publicacion, que es lo que deja la sincronizacion diaria.
  function reloadPublished() {
    setStatus('Buscando la última publicación...', 'is-working');
    setBusy(true);
    const url = new URL(window.location.href);
    url.searchParams.set('sync', String(Date.now()));
    window.location.replace(url.toString());
  }

  async function syncFromDrive() {
    if (state.running) return;
    setBusy(true);
    setStatus('Leyendo las hojas de Drive...', 'is-working');
    try {
      const { files, discovery } = await listFiles();
      if (!files.length) {
        reloadPublished();
        return;
      }
      const results = await Promise.allSettled(files.map(async file => {
        const report = parseKeywordReport(await downloadFile(file), file.name);
        return report ? Object.assign(report, { sourceFile: file.name, fileId: file.id }) : null;
      }));
      const reports = [];
      const keep = [];
      let failed = 0;
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          reports.push(result.value);
          keep.push(files[index]);
        } else if (result.status === 'rejected') {
          // Un error de red se reintenta en la proxima actualizacion: la hoja sigue en la lista.
          failed += 1;
          keep.push(files[index]);
          console.error('[keywords]', result.reason);
        }
      });
      if (!reports.length) throw new Error('ninguna hoja trajo el informe de palabras clave');
      const data = mergeIntoData(state.data, reports, keep, discovery);
      setData(data);
      writeCache(data);
      const message = `${reports.length} ${reports.length === 1 ? 'mes actualizado' : 'meses actualizados'} desde Drive ahora`
        + (failed ? ` (${failed} con error)` : '');
      setStatus(message, failed ? 'is-error' : 'is-ok');
      setBusy(false);
      render();
    } catch (error) {
      console.error('[keywords]', error);
      setStatus(`No se pudo actualizar: ${error.message}`, 'is-error');
      setBusy(false);
    }
  }

  // --- Eventos e inicio ---

  function wireEvents() {
    const view = document.getElementById('view-keywords');
    if (!view) return;
    // Los filtros se vuelven a pintar en cada render, asi que se escuchan en la seccion.
    view.addEventListener('change', event => {
      const target = event.target;
      if (target.id === 'kw-filter-month') state.monthId = target.value;
      else if (target.id === 'kw-filter-campaign') state.campaign = target.value;
      else if (target.id === 'kw-filter-metric') state.metric = METRICS[target.value] ? target.value : 'clicks';
      else return;
      savePrefs();
      render();
    });
    view.addEventListener('click', event => {
      const viewButton = event.target.closest('[data-kw-view]');
      if (viewButton) {
        state.view = viewButton.dataset.kwView === 'trend' ? 'trend' : 'month';
        savePrefs();
        render();
        return;
      }
      if (event.target.closest('#kw-sync-now')) syncFromDrive();
    });
  }

  // Se inicia al abrir la vista (navigation.js): la primera vez carga los datos.
  function init() {
    if (!loading) {
      wireEvents();
      readPrefs();
      loading = load();
    }
    return loading.then(render, renderError);
  }

  window.AquariusKeywords = {
    init,
    render,
    sync: syncFromDrive,
    // Se expone para depurar: permite probar el parser con un CSV cualquiera.
    parseKeywordReport,
    getData: () => state.data
  };
})();
