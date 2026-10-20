/**
 * drive-sync.js - sincroniza el gasto publicitario con la carpeta de Google Drive.
 *
 * Dos caminos, segun la configuracion que incrusta el build:
 *
 * 1. Con apiKey (clave publica de Google restringida al dominio): el boton
 *    Sincronizar lee la carpeta y los CSV directo desde el navegador, y ademas
 *    sincroniza solo cuando pasaron autoSyncHours horas desde la ultima vez.
 * 2. Sin apiKey: el boton recarga el tablero para traer la ultima publicacion.
 *    La sincronizacion diaria sigue corriendo en GitHub Actions.
 *
 * El parser sigue el mismo criterio que scripts/sync-drive.py: busca la fila de
 * encabezados del informe de campana, mapea las columnas por nombre y lee los
 * numeros en formato espanol o ingles. Las hojas de calculo se exportan a CSV.
 */
(function () {
  'use strict';

  // El build incrusta la configuracion; en local se lee del JSON del repo.
  let CONFIG = window.AQUARIUS_DRIVE_CONFIG || {};
  const CACHE_KEY = 'aquarius_drive_cache';
  const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
  const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const MONTH_BY_NAME = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
    agosto: 8, setiembre: 9, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
  };
  const COLUMNS = {
    'campana': ['campaign', 'text'],
    'costo': ['cost', 'number'],
    'coste': ['cost', 'number'],
    'impr.': ['impressions', 'int'],
    'impr': ['impressions', 'int'],
    'impresiones': ['impressions', 'int'],
    'clics': ['clicks', 'int'],
    'prom. cpc': ['cpc', 'number'],
    'cpc medio': ['cpc', 'number'],
    'ctr': ['ctr', 'percent'],
    'tipo de campana': ['type', 'text'],
    'conversiones': ['conversions', 'number'],
    'conv.': ['conversions', 'number'],
    'costo/conv.': ['costPerConversion', 'number'],
    'coste/conv.': ['costPerConversion', 'number']
  };
  // Columnas que no van a cada campana sino al presupuesto diario del mes.
  const BUDGET_COLUMNS = {
    'presupuesto': 'budget',
    'nombre del presupuesto': 'budgetName',
    'tipo de presupuesto': 'budgetType',
    'estado de la campana': 'status'
  };
  // El rango del informe puede venir como "1 de agosto de 2026" o "1 ago 2026".
  const MONTH_PREFIX = {};
  Object.keys(MONTH_BY_NAME).forEach(name => { MONTH_PREFIX[name.slice(0, 3)] = MONTH_BY_NAME[name]; });
  const DELTA_FIELDS = {
    cost: 'costDelta',
    ctr: 'ctrDelta',
    clicks: 'clicksDelta',
    conversions: 'conversionsDelta',
    costPerConversion: 'costPerConversionDelta',
    impressions: 'impressionsDelta'
  };

  const normalize = text => String(text == null ? '' : text).trim().toLowerCase()
    .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n')
    .replace(/\s+/g, ' ');

  // Google Sheets en espanol exporta 99,46 y 1.894; el CSV de Google Ads en ingles, 99.46 y 1,894.
  // Una coma seguida de uno o dos digitos solo existe en el formato espanol: decide como leer el archivo.
  const DECIMAL_COMMA = /^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}%?$/;
  const DOT_THOUSANDS = /^-?\d{1,3}(?:\.\d{3})+$/;
  const DOT_DECIMAL = /^-?\d+\.\d{1,2}%?$/;

  function usesDecimalComma(rows) {
    const cells = [].concat(...rows).map(cell => String(cell).trim());
    if (cells.some(cell => DECIMAL_COMMA.test(cell))) return true;
    // Sin decimales a la vista, un 1.894 sin ningun 9.39 tambien delata el formato espanol.
    return cells.some(cell => DOT_THOUSANDS.test(cell)) && !cells.some(cell => DOT_DECIMAL.test(cell));
  }

  function parseNumber(value, comma) {
    const text = String(value == null ? '' : value).trim();
    if (!text || text === '--' || text === '-' || text.charAt(0) === '<') return null;
    const digits = text.replace(/[^\d,.\-]/g, '');
    const cleaned = comma ? digits.replace(/\./g, '').replace(/,/g, '.') : digits.replace(/,/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return null;
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  }

  const PARSERS = {
    number: parseNumber,
    int: (value, comma) => { const n = parseNumber(value, comma); return n === null ? null : Math.round(n); },
    percent: (value, comma) => { const n = parseNumber(value, comma); return n === null ? null : n / 100; }
  };

  // Lector de CSV con comillas: los exports traen "1,885" y textos con comas.
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
    if (named && MONTH_BY_NAME[named[1]]) {
      return named[2] + '-' + String(MONTH_BY_NAME[named[1]]).padStart(2, '0');
    }
    const numeric = /(\d{4})[-_.](\d{2})/.exec(plain);
    return numeric ? numeric[1] + '-' + numeric[2] : null;
  }

  // Lee el rango del informe: 1 de agosto de 2026 - 31 de agosto de 2026.
  function periodFromText(text) {
    const plain = normalize(text);
    const pattern = /\b(\d{1,2})\s+(?:de\s+)?([a-z]{3})[a-z]*\.?\s+(?:de\s+)?(\d{4})/g;
    const dates = [];
    let match;
    while ((match = pattern.exec(plain))) {
      if (MONTH_PREFIX[match[2]]) {
        dates.push(match[3] + '-' + String(MONTH_PREFIX[match[2]]).padStart(2, '0') + '-' + match[1].padStart(2, '0'));
      }
    }
    return dates.length >= 2 ? { start: dates[0], end: dates[dates.length - 1] } : null;
  }

  // Anota estado y presupuesto diario de la campana y lo suma al del mes si esta habilitada.
  function addBudget(budgets, entry, row, positions, comma) {
    const cell = field => (positions[field] !== undefined && positions[field] < row.length ? String(row[positions[field]]).trim() : '');
    const status = cell('status');
    const kind = normalize(cell('budgetType'));
    // Un presupuesto total de campana no es diario.
    const amount = !kind || kind.indexOf('diari') === 0 ? parseNumber(cell('budget'), comma) : null;
    if (status) entry.status = status;
    if (amount === null) return;
    entry.dailyBudget = amount;
    // Una campana detenida no gasta en lo que queda del mes; un presupuesto compartido se cuenta una vez.
    if (status && normalize(status).indexOf('habilitad') !== 0) return;
    const shared = cell('budgetName');
    budgets[shared && shared !== '--' ? 'budget:' + shared : 'campaign:' + entry.campaign] = amount;
  }

  function monthLabel(monthId) {
    const parts = String(monthId || '').split('-');
    return parts.length === 2 ? MONTH_NAMES[Number(parts[1]) - 1] + ' ' + parts[0] : String(monthId || '');
  }

  function parseCampaignReport(text, name) {
    const rows = parseCsv(text);
    let headerIndex = -1;
    for (let index = 0; index < Math.min(rows.length, 12); index += 1) {
      const plain = rows[index].map(normalize);
      if (plain.indexOf('campana') >= 0 && plain.some(cell => cell === 'costo' || cell === 'coste')) {
        headerIndex = index;
        break;
      }
    }
    if (headerIndex < 0) return null;
    // Un informe por dia (o por anuncio) tambien trae Campana y Costo, pero repite cada campana una vez por fila.
    if (rows[headerIndex].map(normalize).indexOf('dia') >= 0) return null;

    let monthId = null;
    let period = null;
    for (let index = 0; index < headerIndex; index += 1) {
      monthId = monthId || monthFromText(rows[index].join(' '));
      period = period || periodFromText(rows[index].join(' '));
    }
    monthId = monthId || monthFromText(name);
    if (!monthId) return null;

    const columns = {};
    const budgetColumns = {};
    rows[headerIndex].forEach((cell, position) => {
      const mapped = COLUMNS[normalize(cell)];
      if (mapped && !columns[mapped[0]]) columns[mapped[0]] = { position: position, kind: mapped[1] };
      const budgetField = BUDGET_COLUMNS[normalize(cell)];
      if (budgetField && budgetColumns[budgetField] === undefined) budgetColumns[budgetField] = position;
    });

    const records = [];
    const excluded = [];
    const budgets = {};
    let totals = null;
    const comma = usesDecimalComma(rows.slice(headerIndex + 1));
    // Campanas de excludeCampaigns (data/drive-config.json): no se guardan y su gasto sale de los totales.
    const exclude = (CONFIG.excludeCampaigns || []).map(normalize);
    for (let index = headerIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row.some(cell => String(cell).trim())) continue;
      const entry = {};
      Object.keys(columns).forEach(field => {
        const column = columns[field];
        const raw = column.position < row.length ? row[column.position] : null;
        entry[field] = column.kind === 'text' ? String(raw == null ? '' : raw).trim() : PARSERS[column.kind](raw, comma);
      });
      const first = normalize(row[0]);
      if (first.indexOf('total') === 0) {
        if (first.indexOf('total: campanas') === 0 || !totals) {
          totals = {};
          ['cost', 'impressions', 'clicks', 'ctr', 'conversions', 'costPerConversion']
            .forEach(field => { totals[field] = entry[field] === undefined ? null : entry[field]; });
        }
        continue;
      }
      if (entry.campaign && exclude.indexOf(normalize(entry.campaign)) >= 0) {
        excluded.push({ campaign: entry.campaign, cost: entry.cost, impressions: entry.impressions, clicks: entry.clicks, conversions: entry.conversions });
        continue;
      }
      if (entry.campaign) {
        addBudget(budgets, entry, row, budgetColumns, comma);
        records.push(entry);
      }
    }
    const names = records.map(record => normalize(record.campaign));
    if (new Set(names).size < names.length) return null;
    // Los totales del informe incluyen las campanas excluidas; la suma de las campanas guardadas, no.
    const reportTotals = Boolean(totals);
    if (!totals && records.length) {
      // Sin fila Total en el informe, los totales del mes son la suma de sus campanas (nunca los de antes).
      totals = {};
      ['cost', 'impressions', 'clicks', 'conversions'].forEach(field => {
        const values = records.map(record => record[field]);
        totals[field] = values.some(value => value === null || value === undefined) ? null : Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;
      });
      totals.ctr = totals.impressions ? totals.clicks / totals.impressions : null;
      totals.costPerConversion = totals.conversions ? Math.round(totals.cost / totals.conversions * 100) / 100 : null;
    }
    if (excluded.length && reportTotals) {
      // Se descuentan las campanas excluidas y se recalculan los cocientes.
      ['cost', 'impressions', 'clicks', 'conversions'].forEach(field => {
        if (totals[field] === null) return;
        totals[field] = Math.round((totals[field] - excluded.reduce((total, item) => total + (item[field] || 0), 0)) * 100) / 100;
      });
      totals.ctr = totals.impressions ? totals.clicks / totals.impressions : null;
      totals.costPerConversion = totals.conversions ? Math.round(totals.cost / totals.conversions * 100) / 100 : null;
    }
    const amounts = Object.keys(budgets).map(key => budgets[key]);
    const dailyBudget = amounts.length ? Math.round(amounts.reduce((total, value) => total + value, 0) * 100) / 100 : null;
    return records.length
      ? { monthId: monthId, records: records, totals: totals, period: period, dailyBudget: dailyBudget, excluded: excluded.length ? excluded : null }
      : null;
  }

  function applyDeltas(months) {
    let previous = {};
    months.slice().sort((a, b) => String(a.id).localeCompare(String(b.id))).forEach(month => {
      const current = {};
      (month.records || []).forEach(record => {
        const before = previous[record.campaign];
        Object.keys(DELTA_FIELDS).forEach(field => {
          const value = record[field];
          const old = before ? before[field] : null;
          record[DELTA_FIELDS[field]] = (!before || old === null || old === undefined || old === 0 || value === null || value === undefined)
            ? null
            : value / old - 1;
        });
        current[record.campaign] = record;
      });
      previous = current;
    });
  }

  // --- Acceso a Drive ---
  // Listar la carpeta pide la clave publica (la vista de la carpeta no tiene CORS). Sin ella se usan las hojas
  // que dejo el ultimo barrido diario: la exportacion CSV de Google Sheets responde con CORS abierto.

  async function driveJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('Drive respondio ' + response.status);
    return response.json();
  }

  async function listFolder() {
    if (!hasApiKey()) {
      const known = ((window.AquariusDashboard.getData() || {}).drive || {}).files || [];
      return known.filter(file => file && file.id && !/\.csv$/i.test(file.name || ''))
        .map(file => Object.assign({ mimeType: SHEET_MIME }, file));
    }
    const query = encodeURIComponent("'" + CONFIG.folderId + "' in parents and trashed = false");
    const url = 'https://www.googleapis.com/drive/v3/files?q=' + query
      + '&key=' + encodeURIComponent(CONFIG.apiKey)
      + '&fields=' + encodeURIComponent('files(id,name,modifiedTime,mimeType)')
      + '&pageSize=200';
    const payload = await driveJson(url);
    // Las subcarpetas (Keywords, Terminos de busqueda...) quedan fuera: solo hojas y CSV.
    return (payload.files || []).filter(file => file.mimeType === SHEET_MIME || /\.csv$/i.test(file.name));
  }

  async function downloadFile(file) {
    const url = file.mimeType === SHEET_MIME
      ? 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(file.id) + '/export?format=csv'
      : 'https://www.googleapis.com/drive/v3/files/' + file.id + '?alt=media&key=' + encodeURIComponent(CONFIG.apiKey);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo bajar ' + file.name + ' (' + response.status + ')');
    return response.text();
  }

  // Mezcla lo que vino de Drive con la data actual: las series diarias ya
  // cargadas se conservan, los meses nuevos se agregan.
  function mergeIntoData(base, parsedMonths, files) {
    const data = JSON.parse(JSON.stringify(base || {}));
    const months = Array.isArray(data.months) ? data.months : [];
    const byId = {};
    months.forEach(month => { byId[month.id] = month; });
    parsedMonths.forEach(parsed => {
      const month = byId[parsed.monthId] || { id: parsed.monthId, label: monthLabel(parsed.monthId) };
      month.label = month.label || monthLabel(parsed.monthId);
      month.sourceFile = parsed.sourceFile;
      month.driveFileId = parsed.fileId;
      month.records = parsed.records;
      if (parsed.totals) month.totals = parsed.totals;
      // El rango da la fecha de corte de Proyecciones; el presupuesto es el vigente al exportar.
      ['period', 'dailyBudget', 'excluded'].forEach(key => {
        if (parsed[key] === null) delete month[key];
        else month[key] = parsed[key];
      });
      byId[parsed.monthId] = month;
    });
    data.months = Object.keys(byId).sort().map(id => byId[id]);
    applyDeltas(data.months);
    data.defaultMonth = data.months.length ? data.months[data.months.length - 1].id : null;
    data.drive = {
      folderId: CONFIG.folderId,
      discovery: 'navegador',
      lastSync: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      files: files.map(file => ({ id: file.id, name: file.name, modifiedTime: file.modifiedTime || null }))
    };
    return data;
  }

  // --- Estado del boton ---

  let running = false;

  function setStatus(text, tone) {
    // Un error tine de ambar la pildora de la barra superior: el mensaje queda en su detalle. Un resultado bueno no
    // la limpia: el ambar del barrido diario fallido lo maneja objectives.js.
    const pill = document.getElementById('data-status-btn');
    if (pill && tone === 'is-error') pill.classList.add('warn');
    const node = document.getElementById('sync-status');
    if (!node) return;
    node.textContent = text;
    node.classList.remove('is-error', 'is-working', 'is-ok');
    if (tone) node.classList.add(tone);
  }

  function setBusy(busy) {
    const button = document.getElementById('sync-now');
    if (!button) return;
    button.classList.toggle('is-busy', busy);
    button.disabled = busy;
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

  async function syncFromDrive(silent) {
    if (running) return;
    running = true;
    setBusy(true);
    if (!silent) setStatus('Leyendo los informes de Drive...', 'is-working');
    try {
      const files = await listFolder();
      if (!files.length) throw new Error('no hay informes conocidos de la carpeta');
      // Un archivo que falla no frena al resto: su mes queda como estaba.
      const results = await Promise.allSettled(files.map(async file => {
        const report = parseCampaignReport(await downloadFile(file), file.name);
        return report ? Object.assign(report, { sourceFile: file.name, fileId: file.id }) : null;
      }));
      const failed = results.filter(result => result.status === 'rejected');
      failed.forEach(result => console.error('[drive-sync]', result.reason));
      // Dos informes del mismo mes: gana el que llega mas lejos en el mes.
      const byMonth = {};
      results.forEach(result => {
        const report = result.status === 'fulfilled' ? result.value : null;
        if (!report) return;
        const end = (report.period && report.period.end) || '';
        const current = byMonth[report.monthId];
        if (!current || ((current.period && current.period.end) || '') < end) byMonth[report.monthId] = report;
      });
      const parsed = Object.keys(byMonth).map(id => byMonth[id]);
      if (!parsed.length) throw new Error('ningun archivo trajo el informe de campana');
      const data = mergeIntoData(window.AquariusDashboard.getData(), parsed, files);
      window.AquariusDashboard.applyData(data);
      writeCache(data);
      const latest = parsed.slice().sort((a, b) => String(a.monthId).localeCompare(String(b.monthId))).pop();
      const until = latest.period && latest.period.end ? ', datos al ' + Number(latest.period.end.slice(8, 10)) + ' de ' + MONTH_NAMES[Number(latest.period.end.slice(5, 7)) - 1].toLowerCase() : '';
      setStatus(parsed.length + ' meses leidos de Drive ahora' + until + (failed.length ? ' (' + failed.length + ' archivos con error)' : '') + '.', failed.length ? 'is-error' : 'is-ok');
      return data;
    } catch (error) {
      console.error('[drive-sync]', error);
      setStatus('No se pudo sincronizar: ' + error.message, 'is-error');
      return null;
    } finally {
      running = false;
      setBusy(false);
    }
  }

  const hasApiKey = () => !!(CONFIG.apiKey && CONFIG.folderId);

  // Sin informes conocidos (y sin clave para listar la carpeta) queda traer la ultima publicacion, que es lo
  // que deja el barrido diario del servidor.
  function reloadPublished() {
    setStatus('Buscando la ultima publicacion...', 'is-working');
    setBusy(true);
    const url = new URL(window.location.href);
    url.searchParams.set('sync', String(Date.now()));
    window.location.replace(url.toString());
  }

  // El avance y el resultado se ven en el detalle de la pildora, que se abre al pulsar el boton.
  function openStatusCard() {
    const card = document.getElementById('data-status-card');
    const pill = document.getElementById('data-status-btn');
    if (!card || !pill) return;
    card.hidden = false;
    pill.setAttribute('aria-expanded', 'true');
  }

  function onSyncClick() {
    openStatusCard();
    const known = ((window.AquariusDashboard.getData() || {}).drive || {}).files || [];
    if (hasApiKey() || known.some(file => file && file.id)) syncFromDrive(false);
    else reloadPublished();
  }

  function hoursSince(stamp) {
    if (!stamp) return Infinity;
    const date = new Date(stamp);
    if (Number.isNaN(date.getTime())) return Infinity;
    return (Date.now() - date.getTime()) / 3600000;
  }

  // Sincronizacion automatica diaria del navegador: al abrir el tablero, si la
  // ultima sincronizacion ya tiene mas horas que autoSyncHours, se repite sola.
  function maybeAutoSync() {
    if (!hasApiKey()) return;
    const every = Number(CONFIG.autoSyncHours || 24);
    if (!(every > 0)) return;
    const current = window.AquariusDashboard.getData();
    if (hoursSince(syncStamp(current)) < every) return;
    syncFromDrive(true);
  }

  // La data que el navegador sincronizo antes gana contra la incrustada en el
  // build si es mas reciente: asi una recarga no retrocede a la publicacion vieja.
  function restoreCache() {
    const cached = readCache();
    if (!cached || !Array.isArray(cached.months) || !cached.months.length) return;
    const current = window.AquariusDashboard.getData();
    if (syncStamp(cached) <= syncStamp(current)) return;
    try {
      window.AquariusDashboard.applyData(cached);
    } catch (error) {
      console.error('[drive-sync] cache invalido', error);
    }
  }

  async function loadConfig() {
    if (CONFIG && CONFIG.folderId) return CONFIG;
    try {
      const response = await fetch('data/drive-config.json', { cache: 'no-store' });
      if (response.ok) {
        CONFIG = Object.assign({}, await response.json(), CONFIG);
        window.AQUARIUS_DRIVE_CONFIG = CONFIG;
      }
    } catch (error) {
      /* sin configuracion: el boton se queda en modo publicacion */
    }
    return CONFIG;
  }

  async function start() {
    if (!window.AquariusDashboard) return;
    restoreCache();
    await loadConfig();
    maybeAutoSync();
  }

  // El filtro se vuelve a pintar en cada render, asi que el clic se escucha arriba.
  document.addEventListener('click', event => {
    const button = event.target.closest && event.target.closest('#sync-now');
    if (button) onSyncClick();
  });

  // Se expone para depurar: permite probar el parser con un CSV cualquiera.
  window.AquariusDriveSync = {
    parseCampaignReport: parseCampaignReport,
    sync: () => syncFromDrive(false),
    isConfigured: hasApiKey
  };

  if (window.AquariusDashboard) start();
  else window.addEventListener('aquarius:data-ready', function once() {
    window.removeEventListener('aquarius:data-ready', once);
    start();
  });
})();
