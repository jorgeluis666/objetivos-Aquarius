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
  const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const MONTH_BY_NAME = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
    agosto: 8, setiembre: 9, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
  };
  const MONTH_PREFIX = {};
  Object.keys(MONTH_BY_NAME).forEach(name => { MONTH_PREFIX[name.slice(0, 3)] = MONTH_BY_NAME[name]; });
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
    monthId: null, periodId: null, campaign: '', chart: null,
    running: false, syncMessage: null, syncTone: null
  };
  let loading = null;

  const isNum = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const fmtMoney = value => (isNum(value) ? `S/. ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—');
  const fmtCount = value => (isNum(value) ? Number(value).toLocaleString('es-PE', { maximumFractionDigits: 0 }) : '—');
  const fmtDecimal = value => (isNum(value) ? Number(value).toLocaleString('es-PE', { maximumFractionDigits: 2 }) : '—');
  const fmtPercent = value => (isNum(value) ? `${(Number(value) * 100).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : '—');
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

  // comma: el informe viene en formato espanol ("6,79" y "1.247"); si no, en ingles ("6.79" y "1,247").
  function parseNumber(value, comma) {
    const text = String(value == null ? '' : value).trim();
    if (!text || text === '--' || text === '-' || text.charAt(0) === '<') return null;
    const digits = text.replace(/[^\d,.\-]/g, '');
    const cleaned = comma ? digits.replace(/\./g, '').replace(',', '.') : digits.replace(/,/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return null;
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  }

  // En ingles Sheets leyo "1,290" como 1.29 y lo exporta "1,29": el grupo de miles siempre tiene tres
  // digitos. En espanol los miles van con punto ("1.290") y no hay nada que completar.
  function parseCount(value, comma) {
    let text = String(value == null ? '' : value).trim();
    const match = !comma && /^(\d{1,3}(?:,\d{3})*),(\d{1,2})$/.exec(text);
    if (match) text = `${match[1]},${match[2].padEnd(3, '0')}`;
    const number = parseNumber(text, comma);
    return number === null ? null : Math.round(number);
  }

  // Google Ads exporta con el formato del idioma de la cuenta. Se decide por la columna Coste y las de
  // porcentaje, que siempre traen decimales ("6,79" y "15,15%" o "6.79" y "15.15%"): los conteos no
  // sirven, porque en ingles Sheets los deja como "1,29". Igual que scripts/sync-keywords.py.
  function usesDecimalComma(rows, costPosition) {
    let es = 0;
    let en = 0;
    rows.forEach(row => row.forEach((cell, position) => {
      const text = String(cell == null ? '' : cell).trim();
      if (position !== costPosition && !/%$/.test(text)) return;
      if (/^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}%?$/.test(text)) es += 1;
      else if (/^-?(?:\d+|\d{1,3}(?:,\d{3})+)\.\d{1,2}%?$/.test(text)) en += 1;
    }));
    return es > en;
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

    const comma = usesDecimalComma(rows.slice(headerIndex + 1), columns.cost ? columns.cost.position : -1);
    const keywords = [];
    rows.slice(headerIndex + 1).forEach(row => {
      if (!row.some(cell => String(cell).trim())) return;
      // Las filas "Total: ..." resumen la cuenta, no una palabra clave.
      if (normalize(row[0]).indexOf('total') === 0) return;
      const entry = {};
      Object.keys(columns).forEach(field => {
        const column = columns[field];
        const raw = column.position < row.length ? row[column.position] : null;
        const value = column.kind === 'text' ? String(raw == null ? '' : raw).trim() : PARSERS[column.kind](raw, comma);
        if (value !== null && value !== '') entry[field] = value;
      });
      if (!entry.keyword || !entry.campaign) return;
      BASE_FIELDS.forEach(field => { if (entry[field] === undefined) entry[field] = 0; });
      keywords.push(entry);
    });
    return keywords.length ? { monthId, period, keywords } : null;
  }

  // --- Datos ---

  // Campanas de keywords.excludeCampaigns (por ejemplo, una creada en un hackeo de la cuenta).
  // Se filtran tambien al mostrar: una cache del navegador anterior a la exclusion no las devuelve.
  const isExcluded = campaign => ((state.config && state.config.exclude) || []).indexOf(normalize(campaign)) >= 0;
  const withoutExcluded = keywords => keywords.filter(row => !isExcluded(row.campaign));

  function normalizeMonths(data) {
    return (Array.isArray(data && data.months) ? data.months : [])
      .filter(month => /^\d{4}-\d{2}$/.test(String(month.id || '')))
      .map(month => ({
        id: String(month.id),
        label: /^\d{4}-\d{2}$/.test(String(month.id || '')) ? monthLabel(month.id) : (month.label || monthLabel(month.id)),
        sourceFile: month.sourceFile || null,
        period: month.period || null,
        keywords: withoutExcluded(Array.isArray(month.keywords) ? month.keywords : [])
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
    // El periodo sigue al mes salvo que se haya elegido todo el informe.
    if (state.periodId !== ALL && (!state.periodId || ids.indexOf(state.periodId) < 0)) state.periodId = state.monthId;
  }

  const currentMonth = () => state.months.find(month => month.id === state.monthId) || null;

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

  function visibleCampaigns(monthId) {
    if (state.campaign) return [state.campaign];
    const source = monthId ? Object.keys(state.index[monthId] || {}) : state.campaigns;
    const cost = campaign => (monthId
      ? totalsOf(campaignRows(monthId, campaign)).cost
      : state.months.reduce((total, month) => total + totalsOf(campaignRows(month.id, campaign)).cost, 0));
    return source.slice().sort((a, b) => cost(b) - cost(a));
  }

  // --- Render (diseño del tablero Tierra Films) ---

  // El periodo del modulo: un mes del informe o todo lo cargado.
  const ALL = 'all';

  const GRADES = {
    above: { label: 'Por encima', cls: 'grade-ok' },
    average: { label: 'En la media', cls: 'grade-mid' },
    below: { label: 'Por debajo', cls: 'grade-low' }
  };
  const COMPONENTS = {
    expectedCtr: 'rendimiento esperado del anuncio',
    adRelevance: 'relevancia del anuncio',
    landingExperience: 'experiencia en la página de destino'
  };
  // Series del grafico de evolucion: cada una con su eje, como en el tablero de Tierra Films.
  const SERIES = {
    impressions: { label: 'Impresiones', unit: 'count', color: '#2563eb', axis: 'y' },
    clicks: { label: 'Clics', unit: 'count', color: '#7c3aed', axis: 'y' },
    impressionShare: { label: 'Cuota de impresiones', unit: 'percent', color: '#0f766e', axis: 'y1' },
    lostRank: { label: 'Perdido por ranking', unit: 'percent', color: '#dc2626', axis: 'y1', dashed: true },
    cpc: { label: 'CPC medio', unit: 'money', color: '#f59e0b', axis: 'y2', dashed: true }
  };
  const CHART_METRICS = ['impressions', 'clicks', 'impressionShare', 'lostRank', 'cpc'];

  function pct(value, digits = 1) {
    return isNum(value) ? `${(Number(value) * 100).toLocaleString('es-PE', { maximumFractionDigits: digits })}%` : '—';
  }

  function signed(value, digits = 1) {
    if (!isNum(value)) return '—';
    return `${value > 0 ? '+' : ''}${(Number(value) * 100).toLocaleString('es-PE', { maximumFractionDigits: digits })}%`;
  }

  function change(current, previous) {
    if (!isNum(current) || !isNum(previous) || Number(previous) === 0) return null;
    return current / previous - 1;
  }

  function gradeCell(value) {
    const grade = GRADES[value];
    return grade ? `<span class="grade-pill ${grade.cls}">${grade.label}</span>` : '<span class="no-data">—</span>';
  }

  // Google Ads acota las cuotas de impresiones ("< 10%", "> 90%"): esas no entran al promedio.
  function shareNumber(value) {
    if (isNum(value)) return Number(value) > 1 ? Number(value) / 100 : Number(value);
    const text = String(value == null ? '' : value).trim();
    if (!text || text.charAt(0) === '<' || text.charAt(0) === '>') return null;
    const number = Number(text.replace('%', '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(number) ? number / 100 : null;
  }

  // Promedio ponderado por impresiones: una cuota sin impresiones no dice nada.
  function weighted(rows, field, read) {
    let sum = 0;
    let weight = 0;
    rows.forEach(row => {
      const value = read ? read(row[field]) : (isNum(row[field]) ? Number(row[field]) : null);
      if (value === null || !row.impressions) return;
      sum += value * row.impressions;
      weight += row.impressions;
    });
    return weight ? sum / weight : null;
  }

  function monthRows(monthId) {
    return [].concat(...visibleCampaigns(monthId).map(campaign => campaignRows(monthId, campaign)));
  }

  // Un punto del periodo: los totales del mes mas las cuotas ponderadas.
  function pointOf(month) {
    const rows = monthRows(month.id);
    const totals = totalsOf(rows);
    return {
      id: month.id,
      label: month.label,
      rows,
      totals,
      impressions: totals.impressions,
      clicks: totals.clicks,
      cost: totals.cost,
      conversions: totals.conversions,
      ctr: metricValue(totals, 'ctr'),
      cpc: metricValue(totals, 'cpc'),
      costPerConversion: metricValue(totals, 'costPerConversion'),
      impressionShare: weighted(rows, 'topShare', shareNumber),
      lostRank: weighted(rows, 'lostRank', shareNumber),
      qualityScore: weighted(rows, 'qualityScore'),
      keywordsWithImpressions: rows.filter(row => row.impressions > 0).length
    };
  }

  const allPoints = () => state.months.map(pointOf);

  function visiblePoints(points) {
    return state.periodId === ALL ? points : points.filter(point => point.id === state.periodId);
  }

  // Suma varios meses: los totales se suman y las cuotas se ponderan por impresiones.
  function aggregate(points) {
    const rows = [].concat(...points.map(point => point.rows));
    const totals = totalsOf(rows);
    return {
      rows,
      totals,
      impressions: totals.impressions,
      clicks: totals.clicks,
      cost: totals.cost,
      conversions: totals.conversions,
      ctr: metricValue(totals, 'ctr'),
      cpc: metricValue(totals, 'cpc'),
      costPerConversion: metricValue(totals, 'costPerConversion'),
      impressionShare: weighted(rows, 'topShare', shareNumber),
      lostRank: weighted(rows, 'lostRank', shareNumber),
      qualityScore: weighted(rows, 'qualityScore'),
      keywordsWithImpressions: new Set(rows.filter(row => row.impressions > 0).map(row => row.key)).size
    };
  }

  // Junta la misma palabra clave de varios meses en una fila.
  function aggregateRows(points) {
    const map = new Map();
    points.forEach(point => {
      point.rows.forEach(row => {
        let item = map.get(row.key);
        if (!item) {
          item = {
            key: row.key, keyword: row.keyword, matchType: row.matchType, status: row.status, reasons: row.reasons || [],
            impressions: 0, clicks: 0, cost: 0, conversions: 0,
            expectedCtr: null, adRelevance: null, landingExperience: null,
            shareSum: 0, shareWeight: 0, lostSum: 0, lostWeight: 0, qsSum: 0, qsWeight: 0
          };
          map.set(row.key, item);
        }
        // Los meses vienen ordenados: gana la nota mas reciente.
        Object.keys(COMPONENTS).forEach(component => { if (row[component]) item[component] = row[component]; });
        item.status = row.status || item.status;
        BASE_FIELDS.forEach(field => { item[field] += Number(row[field]) || 0; });
        const share = shareNumber(row.topShare);
        if (share !== null && row.impressions) { item.shareSum += share * row.impressions; item.shareWeight += row.impressions; }
        const lost = shareNumber(row.lostRank);
        if (lost !== null && row.impressions) { item.lostSum += lost * row.impressions; item.lostWeight += row.impressions; }
        if (isNum(row.qualityScore) && row.impressions) { item.qsSum += Number(row.qualityScore) * row.impressions; item.qsWeight += row.impressions; }
      });
    });
    return [...map.values()].map(item => Object.assign(item, {
      ctr: item.impressions ? item.clicks / item.impressions : null,
      cpc: item.clicks ? item.cost / item.clicks : null,
      costPerConversion: item.conversions ? item.cost / item.conversions : null,
      impressionShare: item.shareWeight ? item.shareSum / item.shareWeight : null,
      lostRank: item.lostWeight ? item.lostSum / item.lostWeight : null,
      qualityScore: item.qsWeight ? item.qsSum / item.qsWeight : null
    }));
  }

  function periodLabel() {
    if (state.periodId === ALL) return 'el periodo';
    const month = state.months.find(item => item.id === state.periodId);
    return month ? month.label : 'el periodo';
  }

  function lastSyncLabel() {
    const stamp = state.data && state.data.drive && state.data.drive.lastSync;
    if (!stamp) return 'Sin sincronizar con Drive';
    const date = new Date(stamp);
    if (Number.isNaN(date.getTime())) return `Datos actualizados: ${stamp}`;
    // Fecha armada a mano: Intl en es-PE escribe "set." para septiembre.
    const fecha = `${String(date.getDate()).padStart(2, '0')} ${MONTH_NAMES[date.getMonth()].slice(0, 3).toLowerCase()} ${date.getFullYear()}`;
    const hora = date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    return `Datos actualizados: ${fecha}, ${hora}`;
  }

  function renderFilters() {
    const host = document.getElementById('keywords-filters');
    if (!host) return;
    const inMonth = state.index[state.monthId] || {};
    const tabs = state.months.map(month => (
      `<button type="button" class="month-tab${month.id === state.periodId ? ' active' : ''}" data-kw-period="${escapeHtml(month.id)}">${escapeHtml(month.label.split(' ')[0])}</button>`
    )).join('');
    const campaignOptions = ['<option value="">Todas las campañas</option>'].concat(state.campaigns.map(campaign => (
      `<option value="${escapeHtml(campaign)}"${campaign === state.campaign ? ' selected' : ''}>${escapeHtml(campaignLabel(campaign))}${inMonth[campaign] ? '' : ' (sin datos en el mes)'}</option>`
    ))).join('');
    const total = state.months.reduce((sum, month) => sum + month.keywords.length, 0);
    const first = state.months[0];
    const last = state.months[state.months.length - 1];
    const sources = state.months.map(month => month.sourceFile).filter(Boolean);
    host.innerHTML = `
      <div class="retail-filter">
        <span>Mes</span>
        <div class="month-tabs filter-months">
          ${tabs}
          <button type="button" class="month-tab${state.periodId === ALL ? ' active' : ''}" data-kw-period="${ALL}">Todo el periodo</button>
        </div>
      </div>
      <label class="retail-filter" for="kw-filter-campaign">
        <span>Campaña</span>
        <select id="kw-filter-campaign">${campaignOptions}</select>
        <small>${state.campaigns.length} ${state.campaigns.length === 1 ? 'campaña' : 'campañas'} en el informe</small>
      </label>
      <div class="retail-filter filter-sync">
        <span>Actualización</span>
        <button class="sync-btn${state.running ? ' is-busy' : ''}" id="kw-sync-now" type="button"${state.running ? ' disabled' : ''}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
          <b>Actualizar</b>
        </button>
        <small id="kw-sync-status" class="${state.syncTone || ''}">${escapeHtml(state.syncMessage || lastSyncLabel())}</small>
      </div>
      <div class="retail-filter filter-hint">
        <span>Informe</span>
        <p>${fmtCount(total)} filas de palabra clave | ${state.months.length} ${state.months.length === 1 ? 'mes' : 'meses'}${first ? ` (${escapeHtml(first.label)} - ${escapeHtml(last.label)})` : ''}.<br>Fuente: ${escapeHtml(sources.length ? sources[sources.length - 1] : DATA_URL)}</p>
      </div>`;
    host.querySelectorAll('[data-kw-period]').forEach(button => {
      button.addEventListener('click', () => {
        state.periodId = button.dataset.kwPeriod;
        // El mes del filtro manda en el pie, la pildora y la sincronizacion.
        if (state.periodId !== ALL) state.monthId = state.periodId;
        savePrefs();
        render();
      });
    });
  }

  function renderKpis() {
    const host = document.getElementById('keywords-kpis');
    if (!host) return;
    const current = aggregate(visiblePoints(allPoints()));
    const cards = [
      ['Impresiones', fmtCount(current.impressions), `${fmtCount(current.keywordsWithImpressions)} palabras con impresiones`],
      ['Clics', fmtCount(current.clicks), `CTR ${pct(current.ctr, 2)}`],
      ['Cuota de impresiones', pct(current.impressionShare), 'De las subastas en las que competimos'],
      ['Perdido por ranking', pct(current.lostRank), 'No salimos por Ad Rank bajo'],
      ['Nivel de calidad', isNum(current.qualityScore) ? Number(current.qualityScore).toLocaleString('es-PE', { maximumFractionDigits: 1 }) : '—', 'Promedio ponderado (sobre 10)'],
      ['CPC medio', fmtMoney(current.cpc), `${fmtMoney(current.cost)} de gasto`]
    ];
    host.innerHTML = cards
      .map(([label, value, meta]) => `<div class="kpi-pill"><span>${label}</span><strong>${value}</strong><small>${meta}</small></div>`)
      .join('');
    host.setAttribute('aria-label', `KPIs de palabras clave de ${periodLabel()}`);
  }

  function renderChart() {
    const sub = document.getElementById('keywords-chart-sub');
    const legend = document.getElementById('keywords-legend');
    const canvas = document.getElementById('chart-keywords');
    if (!canvas) return;
    const points = allPoints();
    const selected = new Set(visiblePoints(points).map(point => point.id));
    const live = CHART_METRICS.filter(metric => points.some(point => isNum(point[metric])));
    if (sub) sub.textContent = 'Impresiones y clics contra la cuota de impresiones, lo perdido por ranking y el CPC medio de cada mes del informe.';
    if (legend) {
      legend.innerHTML = live
        .map(metric => `<span style="color:${SERIES[metric].color}"><i class="legend-line${SERIES[metric].dashed ? ' dashed' : ''}" style="${SERIES[metric].dashed ? '' : `background:${SERIES[metric].color}`}"></i><b>${SERIES[metric].label}</b></span>`)
        .join('');
    }
    if (typeof Chart === 'undefined') {
      canvas.parentElement.innerHTML = '<div class="empty-state"><strong>Gráfico no disponible sin conexión.</strong><span>La tabla sigue visible.</span></div>';
      return;
    }
    if (state.chart) state.chart.destroy();
    state.chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: points.map(point => shortMonth(point.id)),
        datasets: live.map(metric => ({
          metricKey: metric,
          label: SERIES[metric].label,
          data: points.map(point => (isNum(point[metric]) ? Number(point[metric]) : null)),
          yAxisID: SERIES[metric].axis,
          borderColor: SERIES[metric].color,
          backgroundColor: 'transparent',
          borderWidth: 2.2,
          borderDash: SERIES[metric].dashed ? [5, 4] : [],
          pointRadius: points.map(point => (state.periodId !== ALL && selected.has(point.id) ? 5 : 3)),
          pointBackgroundColor: points.map(point => (state.periodId === ALL || selected.has(point.id) ? SERIES[metric].color : '#fff')),
          pointBorderColor: SERIES[metric].color,
          tension: 0.32,
          spanGaps: true
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => points[items[0].dataIndex].label,
              label: context => ` ${SERIES[context.dataset.metricKey].label}: ${format(context.raw, SERIES[context.dataset.metricKey].unit)}`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { color: '#cbd5e1' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
          y: { beginAtZero: true, border: { display: false }, grid: { color: 'rgba(15,23,42,.06)' }, ticks: { color: '#94a3b8', font: { size: 10 }, callback: value => fmtCount(value) } },
          y1: { beginAtZero: true, max: 1, position: 'right', display: live.some(metric => SERIES[metric].axis === 'y1'), border: { display: false }, grid: { drawOnChartArea: false }, ticks: { color: '#0f766e', font: { size: 10 }, callback: value => `${Math.round(value * 100)}%` } },
          y2: { display: false, beginAtZero: true, grid: { drawOnChartArea: false } }
        }
      }
    });
  }

  // Diagnostico: de donde viene el movimiento de impresiones y clics entre los
  // dos ultimos meses del periodo elegido, y que se lleva el gasto.
  function renderDiagnosis() {
    const host = document.getElementById('keywords-diagnosis');
    const summary = document.getElementById('keywords-diagnosis-sub');
    if (!host) return;
    const points = allPoints();
    const visible = visiblePoints(points);
    const current = aggregate(visible);
    const items = [];
    const last = points[points.length - 1];
    const index = last ? points.indexOf(visible[visible.length - 1] || last) : -1;
    const now = visible[visible.length - 1] || last;
    const before = index > 0 ? points[index - 1] : null;

    if (!now) {
      host.innerHTML = '<li>Todavía no hay filas de palabra clave en el periodo elegido.</li>';
      if (summary) summary.textContent = '';
      return;
    }

    if (before) {
      const impressionsChange = change(now.impressions, before.impressions);
      const clicksChange = change(now.clicks, before.clicks);
      const costChange = change(now.cost, before.cost);
      items.push(`<li><b>Impresiones ${isNum(impressionsChange) && impressionsChange < 0 ? 'cayeron' : 'subieron'} ${signed(impressionsChange)}</b> entre ${escapeHtml(before.label)} (${fmtCount(before.impressions)} impresiones) y ${escapeHtml(now.label)} (${fmtCount(now.impressions)}). Los clics hicieron ${signed(clicksChange)} y el gasto ${signed(costChange)}.</li>`);

      const auctionsNow = now.impressionShare ? now.impressions / now.impressionShare : null;
      const auctionsBefore = before.impressionShare ? before.impressions / before.impressionShare : null;
      const auctionsChange = change(auctionsNow, auctionsBefore);
      const shareChange = change(now.impressionShare, before.impressionShare);
      if (auctionsChange !== null && shareChange !== null) {
        const byAuctions = Math.abs(auctionsChange) > Math.abs(shareChange);
        const detail = byAuctions
          ? `Las subastas en las que el anuncio era elegible pasaron de ${fmtCount(auctionsBefore)} a ${fmtCount(auctionsNow)} (${signed(auctionsChange)}), mientras la cuota de impresiones se mantuvo alrededor de ${pct(now.impressionShare)} (${signed(shareChange)}). O sea, no es que perdiéramos la pelea contra la competencia: el anuncio dejó de entrar a la subasta.`
          : `Las subastas disponibles casi no se movieron (${signed(auctionsChange)}) pero nuestra cuota de impresiones pasó de ${pct(before.impressionShare)} a ${pct(now.impressionShare)} (${signed(shareChange)}): perdimos terreno frente a la competencia.`;
        items.push(`<li><b>De dónde viene el cambio:</b> ${detail}</li>`);
      }

      const cpcChange = change(now.cpc, before.cpc);
      items.push(`<li><b>CPC medio:</b> ${fmtMoney(before.cpc)} → ${fmtMoney(now.cpc)} (${signed(cpcChange)})${isNum(cpcChange) && Math.abs(cpcChange) > 0.1 ? '. El precio del clic se movió lo suficiente como para explicar parte del cambio en clics.' : ', prácticamente igual, así que el cambio no viene de pagar más o menos por clic.'}</li>`);

      const rowsNow = aggregateRows([now]);
      const rowsBefore = new Map(aggregateRows([before]).map(row => [row.key, row]));
      const moves = rowsNow
        .map(row => ({ row, before: rowsBefore.get(row.key), diff: row.impressions - (rowsBefore.get(row.key) ? rowsBefore.get(row.key).impressions : 0) }))
        .concat(aggregateRows([before])
          .filter(row => !rowsNow.some(item => item.key === row.key))
          .map(row => ({ row: Object.assign({}, row, { impressions: 0 }), before: row, diff: -row.impressions })))
        .sort((a, b) => a.diff - b.diff);
      if (moves.length) {
        const top = moves.slice(0, 3)
          .map(item => `${escapeHtml(item.row.keyword)} (${fmtCount(item.before ? item.before.impressions : 0)} → ${fmtCount(item.row.impressions)})`)
          .join(', ');
        items.push(`<li><b>Dónde se siente más:</b> ${top}.</li>`);
      }
    } else {
      items.push(`<li><b>${escapeHtml(now.label)}:</b> ${fmtCount(now.impressions)} impresiones, ${fmtCount(now.clicks)} clics (CTR ${pct(now.ctr, 2)}), ${fmtMoney(now.cost)} de gasto y ${fmtDecimal(now.conversions)} conversiones. Hace falta un mes anterior cargado para comparar.</li>`);
    }

    if (isNum(current.lostRank)) {
      items.push(`<li><b>Problema de fondo:</b> en ${periodLabel()} perdemos ${pct(current.lostRank)} de las subastas por Ad Rank bajo y solo captamos ${pct(current.impressionShare)} del mercado al que apuntamos.</li>`);
    }

    // Lo que si se puede leer siempre: a donde se va el gasto.
    const periodRows = aggregateRows(visible);
    const wasted = periodRows.filter(row => row.cost > 0 && !row.conversions).sort((a, b) => b.cost - a.cost);
    const wastedCost = wasted.reduce((sum, row) => sum + row.cost, 0);
    if (wasted.length) {
      const top = wasted.slice(0, 3).map(row => `${escapeHtml(row.keyword)} (${fmtMoney(row.cost)})`).join(', ');
      items.push(`<li><b>Gasto sin conversiones:</b> ${wasted.length} ${wasted.length === 1 ? 'palabra clave se llevó' : 'palabras clave se llevaron'} ${fmtMoney(wastedCost)}, el ${pct(current.cost ? wastedCost / current.cost : null, 0)} del gasto de ${periodLabel()}, sin una sola conversión. Las más caras: ${top}.</li>`);
    }

    const winners = periodRows.filter(row => row.conversions > 0).sort((a, b) => b.conversions - a.conversions);
    if (winners.length) {
      const top = winners.slice(0, 3).map(row => `${escapeHtml(row.keyword)} (${fmtDecimal(row.conversions)} conv. a ${fmtMoney(row.costPerConversion)})`).join(', ');
      const share = current.conversions ? winners.slice(0, 3).reduce((sum, row) => sum + row.conversions, 0) / current.conversions : null;
      items.push(`<li><b>Lo que sí convierte:</b> ${winners.length} ${winners.length === 1 ? 'palabra clave trajo' : 'palabras clave trajeron'} las ${fmtDecimal(current.conversions)} conversiones de ${periodLabel()}${isNum(share) ? `; las tres primeras concentran el ${pct(share, 0)}` : ''}: ${top}.</li>`);
    }

    items.push(`<li><b>Cobertura:</b> ${fmtCount(current.keywordsWithImpressions)} de las ${fmtCount(periodRows.length)} palabras clave del informe tuvieron impresiones en ${periodLabel()}, sobre ${fmtCount(state.campaigns.length)} ${state.campaigns.length === 1 ? 'campaña' : 'campañas'}.</li>`);

    const components = Object.keys(COMPONENTS).filter(component => periodRows.some(row => row[component]));
    if (components.length) {
      const parts = components.map(component => {
        const known = periodRows.filter(row => GRADES[row[component]]).reduce((sum, row) => sum + row.cost, 0);
        const below = periodRows.filter(row => row[component] === 'below').reduce((sum, row) => sum + row.cost, 0);
        return `<b>${COMPONENTS[component]}</b>: ${pct(known ? below / known : null, 0)} del gasto está "por debajo de la media"`;
      });
      items.push(`<li><b>Qué parte del nivel de calidad falla:</b> ${parts.join('; ')}.</li>`);
    }

    host.innerHTML = items.join('');
    if (summary) {
      summary.textContent = before
        ? `Último mes comparado: ${now.label} contra ${before.label}. El cálculo se rehace al sincronizar con Drive.`
        : `Informe de ${now.label}. El cálculo se rehace al sincronizar con Drive.`;
    }
  }

  function renderTable() {
    const body = document.getElementById('keywords-body');
    const sub = document.getElementById('keywords-table-sub');
    if (!body) return;
    const points = allPoints();
    const visible = visiblePoints(points);
    const rows = aggregateRows(visible).sort((a, b) => (b.cost || 0) - (a.cost || 0));
    const index = visible.length ? points.indexOf(visible[0]) : -1;
    const previous = state.periodId !== ALL && index > 0
      ? new Map(aggregateRows([points[index - 1]]).map(row => [row.key, row]))
      : new Map();
    if (sub) {
      sub.textContent = `${rows.length} ${rows.length === 1 ? 'palabra' : 'palabras'} con actividad en ${periodLabel()}`
        + (previous.size ? `. % Δ compara con ${points[index - 1].label}.` : '.');
    }
    body.innerHTML = rows.map(row => {
      const before = previous.get(row.key);
      const impressionsDelta = before ? change(row.impressions, before.impressions) : null;
      const quality = isNum(row.qualityScore) ? Number(row.qualityScore).toLocaleString('es-PE', { maximumFractionDigits: 1 }) : '—';
      const qualityClass = isNum(row.qualityScore) && row.qualityScore <= 4 ? ' class="kw-low"' : '';
      const paused = /pausa|retirad|detenid/i.test(row.status || '');
      return `
        <tr>
          <td class="campaign-name"><span>${escapeHtml(row.keyword)}</span><small>${escapeHtml(row.matchType || 'Sin concordancia')}${paused ? ` | ${escapeHtml(row.status)}` : ''}</small></td>
          <td class="num">${fmtCount(row.impressions)}</td>
          <td class="num delta-cell ${impressionsDelta === null ? '' : (impressionsDelta >= 0 ? 'up' : 'down')}">${impressionsDelta === null ? '—' : signed(impressionsDelta, 0)}</td>
          <td class="num">${fmtCount(row.clicks)}</td>
          <td class="num">${pct(row.ctr, 2)}</td>
          <td class="num">${fmtMoney(row.cost)}</td>
          <td class="num">${fmtMoney(row.cpc)}</td>
          <td class="num">${fmtDecimal(row.conversions)}</td>
          <td class="num">${fmtMoney(row.costPerConversion)}</td>
          <td class="num">${pct(row.impressionShare)}</td>
          <td class="num">${pct(row.lostRank)}</td>
          <td class="num"><b${qualityClass}>${quality}</b></td>
          <td>${gradeCell(row.adRelevance)}</td>
          <td>${gradeCell(row.landingExperience)}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="14" class="table-empty">Sin palabras con actividad en este periodo.</td></tr>';
  }

  // La barra superior y el pie son de la vista activa: con otra vista abierta no se tocan.
  function updateSourceLabels() {
    const view = document.getElementById('view-keywords');
    if (!view || !view.classList.contains('visible')) return;
    const month = currentMonth();
    // Va en el detalle de la pildora ("En esta vista"); la pildora sigue a la sincronizacion.
    const status = document.getElementById('status-view');
    if (status) status.textContent = `Informe de palabras clave · ${state.periodId === ALL ? 'todo el periodo' : (month ? month.label : '')}`;
    const source = document.getElementById('footer-source');
    if (source && month) source.textContent = `Fuente: ${month.sourceFile || 'data/aquarius-palabras-clave-2026.json'} (Drive: Google Ads Aquarius Keywords)`;
  }

  function render() {
    if (!state.months.length) {
      renderEmpty();
      return;
    }
    // El periodo guardado puede venir de un informe que ya no esta cargado.
    if (state.periodId !== ALL && !state.months.some(month => month.id === state.periodId)) state.periodId = state.monthId;
    renderFilters();
    renderKpis();
    renderChart();
    renderDiagnosis();
    renderTable();
    updateSourceLabels();
  }

  function renderEmpty() {
    renderFilters();
    ['keywords-kpis', 'keywords-diagnosis', 'keywords-body'].forEach(id => {
      const host = document.getElementById(id);
      if (host) host.innerHTML = '';
    });
    const host = document.getElementById('keywords-diagnosis');
    if (host) host.innerHTML = '<li>Sube la hoja del mes a la carpeta de Drive "Google Ads Aquarius Keywords" y pulsa Actualizar.</li>';
  }

  function renderError(error) {
    console.error('[keywords]', error);
    const host = document.getElementById('keywords-diagnosis');
    if (host) host.innerHTML = `<li><b>No se pudo cargar el análisis de palabras clave.</b> ${escapeHtml(error && error.message ? error.message : error)}</li>`;
  }

  // --- Preferencias y cache ---

  function readPrefs() {
    try {
      const prefs = JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}');
      if (prefs.monthId) state.monthId = prefs.monthId;
      if (prefs.campaign) state.campaign = prefs.campaign;
      if (prefs.periodId) state.periodId = prefs.periodId;
    } catch (error) {
      /* sin preferencias guardadas: valores por defecto */
    }
  }

  function savePrefs() {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ monthId: state.monthId, periodId: state.periodId, campaign: state.campaign }));
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
    const keywords = (config && config.keywords) || {};
    return {
      folderId: keywords.folderId || '',
      apiKey: (config && config.apiKey) || '',
      exclude: (Array.isArray(keywords.excludeCampaigns) ? keywords.excludeCampaigns : []).map(normalize)
    };
  }

  async function load() {
    // La configuracion va primero: trae las campanas excluidas.
    state.config = await loadConfig();
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
        if (!response.ok) throw new Error(`Drive respondió ${response.status}`);
        const payload = await response.json();
        const files = (payload.files || []).filter(file => file.mimeType === SHEET_MIME || /\.csv$/i.test(file.name));
        if (files.length) return { files, discovery: 'navegador (API)' };
      } catch (error) {
        console.warn('[keywords] no se pudo listar la carpeta; uso la última lista conocida', error);
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
        if (!report) return null;
        report.keywords = withoutExcluded(report.keywords);
        return Object.assign(report, { sourceFile: file.name, fileId: file.id });
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
      if (target.id === 'kw-filter-campaign') state.campaign = target.value;
      else return;
      savePrefs();
      render();
    });
    view.addEventListener('click', event => {
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
