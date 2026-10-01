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
 * El parser de los CSV sigue el mismo criterio que scripts/sync-drive.py: busca
 * la fila de encabezados del informe de campana y mapea las columnas por nombre.
 */
(function () {
  'use strict';

  // El build incrusta la configuracion; en local se lee del JSON del repo.
  let CONFIG = window.AQUARIUS_DRIVE_CONFIG || {};
  const CACHE_KEY = 'aquarius_drive_cache';
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
    'ctr': ['ctr', 'percent'],
    'conversiones': ['conversions', 'number'],
    'conv.': ['conversions', 'number'],
    'costo/conv.': ['costPerConversion', 'number'],
    'coste/conv.': ['costPerConversion', 'number']
  };
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

  function parseNumber(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text || text === '--' || text === '-' || text.charAt(0) === '<') return null;
    const cleaned = text.replace(/[^\d,.\-]/g, '').replace(/,/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return null;
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  }

  const PARSERS = {
    number: parseNumber,
    int: value => { const n = parseNumber(value); return n === null ? null : Math.round(n); },
    percent: value => { const n = parseNumber(value); return n === null ? null : n / 100; }
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

    let monthId = null;
    for (let index = 0; index < headerIndex; index += 1) monthId = monthId || monthFromText(rows[index].join(' '));
    monthId = monthId || monthFromText(name);
    if (!monthId) return null;

    const columns = {};
    rows[headerIndex].forEach((cell, position) => {
      const mapped = COLUMNS[normalize(cell)];
      if (mapped && !columns[mapped[0]]) columns[mapped[0]] = { position: position, kind: mapped[1] };
    });

    const records = [];
    let totals = null;
    for (let index = headerIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row.some(cell => String(cell).trim())) continue;
      const entry = {};
      Object.keys(columns).forEach(field => {
        const column = columns[field];
        const raw = column.position < row.length ? row[column.position] : null;
        entry[field] = column.kind === 'text' ? String(raw == null ? '' : raw).trim() : PARSERS[column.kind](raw);
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
      if (entry.campaign) records.push(entry);
    }
    return records.length ? { monthId: monthId, records: records, totals: totals } : null;
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

  // --- Acceso a Drive (solo con clave publica; sin ella no hay CORS) ---

  async function driveJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('Drive respondio ' + response.status);
    return response.json();
  }

  async function listFolder() {
    const query = encodeURIComponent("'" + CONFIG.folderId + "' in parents and trashed = false");
    const url = 'https://www.googleapis.com/drive/v3/files?q=' + query
      + '&key=' + encodeURIComponent(CONFIG.apiKey)
      + '&fields=' + encodeURIComponent('files(id,name,modifiedTime)')
      + '&pageSize=200';
    const payload = await driveJson(url);
    return (payload.files || []).filter(file => /\.csv$/i.test(file.name));
  }

  async function downloadFile(file) {
    const url = 'https://www.googleapis.com/drive/v3/files/' + file.id + '?alt=media&key=' + encodeURIComponent(CONFIG.apiKey);
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
    if (!silent) setStatus('Sincronizando con Drive...', 'is-working');
    try {
      const files = await listFolder();
      if (!files.length) throw new Error('La carpeta no tiene CSV');
      const parsed = [];
      for (const file of files) {
        const text = await downloadFile(file);
        const report = parseCampaignReport(text, file.name);
        if (report) {
          report.sourceFile = file.name;
          report.fileId = file.id;
          parsed.push(report);
        }
      }
      if (!parsed.length) throw new Error('Ningun CSV tiene el informe de campana');
      const data = mergeIntoData(window.AquariusDashboard.getData(), parsed, files);
      window.AquariusDashboard.applyData(data);
      writeCache(data);
      setStatus(parsed.length + ' meses sincronizados ahora', 'is-ok');
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

  // Sin clave publica el navegador no puede leer Drive (CORS): el boton trae la
  // ultima publicacion, que es lo que deja la sincronizacion diaria del servidor.
  function reloadPublished() {
    setStatus('Buscando la ultima publicacion...', 'is-working');
    setBusy(true);
    const url = new URL(window.location.href);
    url.searchParams.set('sync', String(Date.now()));
    window.location.replace(url.toString());
  }

  function onSyncClick() {
    if (hasApiKey()) syncFromDrive(false);
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
