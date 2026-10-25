(function () {
  // Fuente de los gráficos: Inter, como el resto del tablero (Chart.js usa Helvetica por defecto).
  if (typeof Chart !== 'undefined') Chart.defaults.font.family = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  const DATA_URL = 'data/aquarius-lima-retail-2026.json';
  const MONTH_STORAGE_KEY = 'aquarius_selected_month';
  const VIEW_STORAGE_KEY = 'aquarius_chart_view';
  // Detalle del grafico: dia y semana se mueven con el filtro, mes recorre el ano.
  const CHART_VIEWS = ['day', 'week', 'year'];
  // Series del grafico principal: un punto por mes, lineas en el tiempo.
  const MONTHLY = {
    cost: { label: 'Inversión', unit: 'money', color: '#2563eb', fill: 'rgba(37,99,235,.12)', axis: 'y' },
    conversions: { label: 'Resultados', unit: 'count', color: '#7c3aed', fill: 'rgba(124,58,237,.12)', axis: 'y1' },
    costPerConversion: { label: 'Costo x resultado', unit: 'money', color: '#0f766e', fill: 'rgba(15,118,110,.12)', axis: 'y2', dashed: true },
    impressions: { label: 'Impresiones', unit: 'count', color: '#f59e0b', fill: 'rgba(245,158,11,.12)', axis: 'y3' }
  };
  const MONTHLY_ORDER = ['cost', 'conversions', 'costPerConversion', 'impressions'];
  // Series de la evolucion diaria dentro del mes.
  const DAILY = {
    cost: { label: 'Inversión', unit: 'money', color: '#2563eb', axis: 'y' },
    conversions: { label: 'Resultados', unit: 'count', color: '#7c3aed', axis: 'y1' },
    costPerConversion: { label: 'Costo x resultado', unit: 'money', color: '#0f766e', axis: 'y2', dashed: true },
    impressions: { label: 'Impresiones', unit: 'count', color: '#f59e0b', axis: 'y3' }
  };
  const DAILY_ORDER = ['cost', 'conversions', 'costPerConversion', 'impressions'];
  const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const CAMPAIGN_NAMES = {
    DIGITALIZACIONDEDCOUMENTOS: 'Digitalización de documentos',
    GESTIONLOGISTICA: 'Gestión logística',
    VALUACIONESCOMERCIALES: 'Valuaciones comerciales',
    FOTOGRAMETRIACONDRONES: 'Fotogrametría con drones',
    FOTOGRAMETRÍACONDRONES: 'Fotogrametría con drones',
    ALMACENAMIENTO: 'Almacenamiento',
    ACTIVOSFIJOS: 'Activos fijos',
    PRODUCTOSTI: 'Productos TI',
    OUTSOURCINGDEALMACENES: 'Outsourcing de almacenes'
  };
  // annual: la pestana Anual. monthId sigue siendo el mes del grafico de la cuenta y de snapshot().
  const state = { data: null, months: [], monthId: null, annual: false, daily: [], chartView: 'day', chart: null };

  // Sin dato (null) es "—", no cero: un costo por conversion sin conversiones no vale S/. 0.00.
  const fmtMoney = value => isNum(value) ? `S/. ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
  const fmtCount = value => isNum(value) ? Number(value).toLocaleString('es-PE', { maximumFractionDigits: 0 }) : '—';
  // Google Ads reparte conversiones entre campanas: pueden venir con decimales (79.5).
  const fmtDecimal = value => isNum(value) ? Number(value).toLocaleString('es-PE', { maximumFractionDigits: 2 }) : '—';
  const fmtPercent = value => isNum(value) ? `${(Number(value) * 100).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : '—';
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function sum(rows, field) {
    return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
  }

  function average(rows, field) {
    const values = rows.map(row => Number(row[field])).filter(Number.isFinite);
    if (!values.length) return null;
    return values.reduce((total, value) => total + value, 0) / values.length;
  }

  function weightedCtr(rows) {
    const clicks = sum(rows, 'clicks');
    const impressions = rows.reduce((total, row) => total + (Number(row.ctr) > 0 ? Number(row.clicks || 0) / Number(row.ctr) : 0), 0);
    return impressions > 0 ? clicks / impressions : average(rows, 'ctr');
  }

  function formatValue(value, unit, short = false) {
    if (unit === 'money') {
      if (short && Number.isFinite(Number(value)) && Math.abs(Number(value)) >= 1000) return `S/. ${(Number(value) / 1000).toFixed(1)}k`;
      return fmtMoney(value);
    }
    if (unit === 'percent') return fmtPercent(value);
    if (unit === 'decimal') return fmtDecimal(value);
    return fmtCount(value);
  }

  function monthLabel(monthId) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(monthId || ''));
    if (!match) return monthId ? String(monthId) : 'Sin mes';
    return `${MONTH_NAMES[Number(match[2]) - 1]} ${match[1]}`;
  }

  function formatDay(isoDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
    return match ? String(Number(match[3])) : String(isoDate || '');
  }

  function formatLongDate(isoDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
    if (!match) return String(isoDate || '');
    return `${Number(match[3])} de ${MONTH_NAMES[Number(match[2]) - 1].toLowerCase()} ${match[1]}`;
  }

  function campaignLabel(name) {
    const raw = String(name || '').replace(/^IDG_AQUARIUSCONSULTING_PE_SKAG-/i, '');
    const key = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    if (CAMPAIGN_NAMES[raw] || CAMPAIGN_NAMES[key]) return CAMPAIGN_NAMES[raw] || CAMPAIGN_NAMES[key];
    return raw
      .replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Number(null) es 0, asi que los vacios necesitan un chequeo estricto.
  const isNum = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

  // Lee la serie diaria del mes: formato nuevo (daily.rows) y el anterior
  // (impressions.daily), que solo traia impresiones.
  function dailyRows(month) {
    if (month.daily && Array.isArray(month.daily.rows)) return month.daily.rows;
    if (month.impressions && Array.isArray(month.impressions.daily)) return month.impressions.daily;
    return [];
  }

  function dailyTotal(field) {
    return state.daily.reduce((total, row) => total + (isNum(row[field]) ? Number(row[field]) : 0), 0);
  }

  // Totales de un mes: los del informe de campana si vienen en la fuente, y si
  // no la suma de sus campanas. Son la base del grafico de lineas en el tiempo.
  function monthTotals(month) {
    const records = month.records || [];
    const totals = month.totals || {};
    const pick = (field, fallback) => (isNum(totals[field]) ? Number(totals[field]) : fallback);
    const cost = pick('cost', sum(records, 'cost'));
    const clicks = pick('clicks', sum(records, 'clicks'));
    const conversions = pick('conversions', sum(records, 'conversions'));
    const impressionsFromRecords = records.some(row => isNum(row.impressions)) ? sum(records, 'impressions') : null;
    const dailyImpressions = (month.daily || []).reduce((total, row) => total + (isNum(row.impressions) ? Number(row.impressions) : 0), 0);
    const impressions = pick('impressions', impressionsFromRecords !== null ? impressionsFromRecords : (dailyImpressions || null));
    return {
      id: month.id,
      label: month.label,
      shortLabel: shortMonthLabel(month.id, month.label),
      cost,
      clicks,
      conversions,
      impressions: isNum(impressions) ? Number(impressions) : null,
      costPerConversion: conversions > 0 ? cost / conversions : null,
      ctr: isNum(impressions) && Number(impressions) > 0 ? clicks / Number(impressions) : (isNum(totals.ctr) ? Number(totals.ctr) : weightedCtr(records)),
      hasData: records.length > 0 || isNum(totals.cost)
    };
  }

  function shortMonthLabel(monthId, label) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(monthId || ''));
    if (!match) return label || String(monthId || '');
    return `${MONTH_NAMES[Number(match[2]) - 1].slice(0, 3)} ${match[1].slice(2)}`;
  }

  function monthlyTotals() {
    return state.months.map(monthTotals).filter(month => month.hasData);
  }

  // Acepta el esquema por meses y tambien el formato antiguo de un solo bloque de records.
  function normalizeMonths(data) {
    if (Array.isArray(data.months) && data.months.length) {
      return data.months
        .map(month => ({
          id: String(month.id || ''),
          label: /^\d{4}-\d{2}$/.test(String(month.id || '')) ? monthLabel(month.id) : (month.label || monthLabel(month.id)),
          sourceFile: month.sourceFile || null,
          records: Array.isArray(month.records) ? month.records : [],
          totals: month.totals || null,
          daily: dailyRows(month),
          period: month.period || null,
          dailyBudget: isNum(month.dailyBudget) ? Number(month.dailyBudget) : null,
          // Informe por dia y campana (opcional, ver detailRows): hoy no llega.
          detail: month.detail || null,
          // Campanas de excludeCampaigns que traia el informe: el tablero las avisa.
          excluded: Array.isArray(month.excluded) ? month.excluded : []
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    }
    if (Array.isArray(data.records)) {
      const id = data.month || 'historico';
      return [{
        id,
        label: /^\d{4}-\d{2}$/.test(id) ? monthLabel(id) : 'Histórico',
        sourceFile: data.sourceFile || null,
        records: data.records,
        totals: null,
        daily: [],
        period: null,
        dailyBudget: null,
        detail: null,
        excluded: []
      }];
    }
    return [];
  }

  // 'month' es la vista diaria de las versiones anteriores.
  function normalizeView(view) {
    if (view === 'month') return 'day';
    return CHART_VIEWS.includes(view) ? view : 'day';
  }

  function readStoredView() {
    try {
      return window.localStorage.getItem(VIEW_STORAGE_KEY);
    } catch (error) {
      return null;
    }
  }

  function setChartView(view) {
    state.chartView = CHART_VIEWS.includes(view) ? view : 'day';
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, state.chartView);
    } catch (error) {
      /* sin almacenamiento: la vista dura lo que la pestana */
    }
    renderChart();
  }

  function readStoredMonth() {
    try {
      return window.localStorage.getItem(MONTH_STORAGE_KEY);
    } catch (error) {
      return null;
    }
  }

  function storeMonth(monthId) {
    try {
      window.localStorage.setItem(MONTH_STORAGE_KEY, monthId);
    } catch (error) {
      /* almacenamiento no disponible: la seleccion solo vive en la sesion */
    }
  }

  function selectMonth(monthId, persist = true) {
    const month = state.months.find(item => item.id === monthId) || state.months[state.months.length - 1];
    if (!month) return;
    state.monthId = month.id;
    state.daily = month.daily || [];
    if (persist) storeMonth(month.id);
  }

  function currentMonth() {
    return state.months.find(month => month.id === state.monthId) || null;
  }

  // Fecha y hora local de una sincronizacion: "1 oct 2026, 17:48" (sin el ano con withYear = false).
  function stampLabel(stamp, withYear = true) {
    if (!stamp) return null;
    const date = new Date(stamp);
    if (Number.isNaN(date.getTime())) return String(stamp);
    const pad = value => String(value).padStart(2, '0');
    const fecha = `${date.getDate()} ${MONTH_NAMES[date.getMonth()].slice(0, 3).toLowerCase()}${withYear ? ` ${date.getFullYear()}` : ''}`;
    return `${fecha}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // Los archivos de Drive pueden traer el mes cruzado en el nombre (el mes sale del rango
  // del informe): la fuente se nombra por la carpeta, nunca por el archivo.
  function folderName() {
    const config = window.AQUARIUS_DRIVE_CONFIG || gasto.config || {};
    return config.folderName || '02 Google Ads';
  }

  // ── Sincronizacion: pildora de la barra superior con su detalle y el boton Sincronizar ──
  // drive-sync.js maneja el boton (#sync-now) y escribe su avance en #sync-status, dentro del detalle.
  // El barrido diario corre en GitHub Actions (.github/workflows/sync-drive.yml): lo lanza después de las extracciones de 06:00, 13:00 y 18:00 de Lima
  // (aproximadamente 30 minutos más tarde) un activador de Google Apps Script (scripts/apps-script/sincronizar-aquarius.gs). El tablero lee
  // su ultima ejecucion de la API publica de GitHub: sin credenciales, 60 consultas por hora y por IP.
  const SYNC_HOURS_LIMA = [6, 13, 18];
  const SYNC_RUNS_URL = 'https://api.github.com/repos/jorgeluis666/objetivos-Aquarius/actions/workflows/sync-drive.yml/runs?per_page=1';
  // Sin barrido en mas de un dia y algo, la pildora pasa a ambar.
  const STALE_SWEEP_HOURS = 30;
  const sweep = { run: null, status: 'idle', checkedAt: 0 };
  const safeUrl = url => (/^https:\/\//i.test(String(url || '')) ? String(url) : null);

  function nextSyncLabel() {
    const now = new Date();
    const lima = new Date(now.getTime() - 5 * 3600000);
    const candidates = SYNC_HOURS_LIMA.map(hour => new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate(), hour + 5)));
    const next = candidates.find(date => date > now) || new Date(candidates[0].getTime() + 86400000);
    return `${stampLabel(next, false)} · 06:00, 13:00 y 18:00 (Lima). Publicación después del barrido de Drive, aprox. 30 min más tarde`;
  }

  // Ultima ejecucion del barrido. Se consulta al cargar y al abrir el detalle (como mucho cada 10 minutos).
  async function loadLastSweep(force = false) {
    if (sweep.status === 'loading' || (!force && Date.now() - sweep.checkedAt < 10 * 60000)) return;
    sweep.status = 'loading';
    try {
      const response = await fetch(SYNC_RUNS_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`GitHub respondió ${response.status}`);
      const payload = await response.json();
      sweep.run = (payload.workflow_runs || [])[0] || null;
      sweep.status = 'ok';
    } catch (error) {
      sweep.status = 'error';
      console.warn('[gasto] no se pudo leer el último barrido', error);
    }
    sweep.checkedAt = Date.now();
    renderStatusCard();
    updateSourceLabels();
  }

  function sweepInfo() {
    const run = sweep.run;
    if (!run) return null;
    const at = run.run_started_at || run.created_at;
    const done = run.status === 'completed';
    const hours = (Date.now() - new Date(at).getTime()) / 3600000;
    return {
      at,
      running: !done,
      ok: done && run.conclusion === 'success',
      failed: done && run.conclusion !== 'success',
      stale: hours > STALE_SWEEP_HOURS,
      url: safeUrl(run.html_url)
    };
  }

  function folderHtml(label, url) {
    const href = safeUrl(url);
    return `${escapeHtml(label)}${href ? ` · <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Abrir</a>` : ''}`;
  }

  const latestGastoMonth = () => gastoMonthByKey(gasto.latestKey);

  // Texto de la pildora en Gasto Publicitario: hasta que dia llegan los datos y el ultimo barrido. Si GitHub no
  // responde, la fecha de la ultima vez que cambiaron los datos.
  function syncPillLabel() {
    const latest = latestGastoMonth();
    if (!latest) return 'Sin informes de campaña';
    const info = sweepInfo();
    const changed = stampLabel(state.data && state.data.drive && state.data.drive.lastSync, false);
    const tail = info ? ` | barrido ${stampLabel(info.at, false)}${info.failed ? ' (falló)' : ''}` : changed ? ` | actualizado ${changed}` : '';
    return `Datos al ${latest.lastDay} de ${latest.name.toLowerCase()}${tail}`;
  }

  function renderStatusCard() {
    const set = (id, html) => {
      const node = document.getElementById(id);
      if (node) node.innerHTML = html;
    };
    const config = window.AQUARIUS_DRIVE_CONFIG || gasto.config || {};
    const latest = latestGastoMonth();
    const count = gasto.months.filter(month => month.hasData).length;
    const drive = (state.data && state.data.drive) || {};
    const last = stampLabel(drive.lastSync);
    const info = sweepInfo();
    set('status-data', latest ? escapeHtml(`${dayRange(latest, latest.firstDay, latest.lastDay)} ${latest.year}`) : 'Sin informes');
    set('status-months', `${count} ${count === 1 ? 'mes' : 'meses'} con informe de campaña`);
    let sweepHtml = sweep.status === 'error' ? 'No se pudo consultar GitHub' : 'Consultando...';
    if (info) {
      const result = info.running ? 'en curso' : info.ok ? 'correcto' : 'falló';
      sweepHtml = `${escapeHtml(`${stampLabel(info.at)} · ${result}`)}${info.url ? ` · <a href="${escapeHtml(info.url)}" target="_blank" rel="noopener noreferrer">Ver</a>` : ''}`;
    }
    set('status-sweep', sweepHtml);
    set('status-last', last ? escapeHtml(`${last}${/^navegador/.test(drive.discovery || '') ? ' · desde el tablero' : ''}`) : 'Sin datos de Drive');
    set('status-next', escapeHtml(nextSyncLabel()));
    // Un barrido fallido o atrasado tine la pildora de ambar en todas las vistas.
    const pill = document.getElementById('data-status-btn');
    if (pill && info) pill.classList.toggle('warn', info.failed || info.stale);
    set('status-folder', folderHtml(folderName(), config.folderUrl));
    const kwLatest = gasto.kwMonths.get([...gasto.kwMonths.keys()].sort().pop());
    const kwLast = stampLabel(gasto.kwSync, false);
    const kwText = gasto.kwStatus === 'loading' ? 'Cargando...'
      : gasto.kwStatus === 'error' ? 'No se pudo leer'
      : kwLatest ? `Hasta ${kwLatest.name} ${kwLatest.year}${kwLast ? ` · ${kwLast}` : ''}` : 'Sin informes';
    set('status-keywords', escapeHtml(kwText));
    set('status-kw-folder', folderHtml(kwFolderName(), config.keywords && config.keywords.folderUrl));
    // Aviso fijo del detalle: mes en curso y meses sin informe. Los mensajes del boton van aparte (#sync-status).
    const notes = [];
    if (info && info.failed) notes.push('El último barrido falló: revisa la ejecución en GitHub > Actions.');
    else if (info && info.stale) notes.push('No hay barrido desde hace más de un día: revisa el activador de Google Apps Script.');
    if (latest && !latest.complete) notes.push(`${latest.name} está en curso: el informe llega hasta el ${latest.lastDay} de ${latest.name.toLowerCase()}.`);
    const missing = missingMonths();
    if (missing.length) notes.push(`Falta el informe de campaña de ${missing.map(monthLabel).join(', ')}.`);
    set('status-note', escapeHtml(notes.join(' ')));
  }

  function wireStatusCard() {
    const button = document.getElementById('data-status-btn');
    const card = document.getElementById('data-status-card');
    if (!button || !card) return;
    const close = () => {
      card.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    };
    button.addEventListener('click', event => {
      event.stopPropagation();
      const open = card.hidden;
      // La proxima sincronizacion depende de la hora: se recalcula al abrir el detalle, junto con el ultimo barrido.
      if (open) {
        renderStatusCard();
        loadLastSweep();
      }
      card.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
    });
    // El boton Sincronizar abre el detalle para mostrar su avance: ese clic no lo cierra.
    document.addEventListener('click', event => {
      const sync = event.target.closest && event.target.closest('#sync-now');
      if (!card.hidden && !sync && !card.contains(event.target) && !button.contains(event.target)) close();
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  }

  // Grafico principal: lineas en el tiempo con un punto por mes cargado.
  // El grafico sigue a la pestana: Dia y Semana muestran el mes elegido y Mes, todo lo que va
  // del ano. En Anual solo queda la vista Mes.
  function renderChart() {
    // Dia y semana necesitan la serie diaria del mes. Si no existe, los botones
    // quedan apagados y el grafico cae a la vista del ano sin perder la eleccion.
    const hasDaily = !state.annual && state.daily.length > 0;
    const view = state.chartView !== 'year' && !hasDaily ? 'year' : state.chartView;
    document.querySelectorAll('[data-chart-view]').forEach(button => {
      const target = button.dataset.chartView;
      const available = target === 'year' || hasDaily;
      const active = target === view;
      button.disabled = !available;
      button.title = available ? '' : (state.annual ? 'En Anual el gráfico muestra los meses del año' : 'Este mes no tiene detalle por día');
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (view === 'year') renderYearView();
    else renderMonthView(view);
  }

  // Vista total: un punto por mes con todo lo que va del ano.
  function renderYearView() {
    const panel = document.getElementById('chart-panel');
    const months = monthlyTotals();
    const note = document.getElementById('chart-note');
    if (note) { note.hidden = true; note.textContent = ''; }
    if (panel) panel.hidden = !months.length;
    if (!months.length) {
      if (state.chart) { state.chart.destroy(); state.chart = null; }
      return;
    }
    // En Anual ningun mes se resalta: el periodo es todo el ano.
    const highlight = state.annual ? null : state.monthId;
    const metrics = MONTHLY_ORDER.filter(metric => months.some(month => isNum(month[metric])));
    document.getElementById('chart-title').textContent = 'Evolución mensual | Inversión, resultados y costo por resultado';
    const sub = document.getElementById('chart-sub');
    if (sub) {
      const totalCost = months.reduce((total, month) => total + (month.cost || 0), 0);
      const totalConversions = months.reduce((total, month) => total + (month.conversions || 0), 0);
      sub.textContent = `${months.length} meses | ${fmtMoney(totalCost)} de inversión | ${fmtCount(totalConversions)} resultados | ${fmtMoney(totalConversions > 0 ? totalCost / totalConversions : null)} por resultado en el acumulado.`;
    }
    const legend = document.querySelector('.chart-legend span');
    if (legend) {
      legend.innerHTML = metrics.map(metric => `<i class="legend-line" style="background:${MONTHLY[metric].color}"></i><b>${MONTHLY[metric].label}</b>`).join('');
    }
    const canvas = document.getElementById('chart-monthly');
    if (typeof Chart === 'undefined') {
      canvas.parentElement.innerHTML = '<div class="empty-state"><strong>Gráfico no disponible sin conexión.</strong><span>La tabla de resultados sigue visible.</span></div>';
      return;
    }
    if (state.chart) state.chart.destroy();
    state.chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: months.map(month => month.shortLabel),
        datasets: metrics.map(metric => {
          const series = MONTHLY[metric];
          return {
            metricKey: metric,
            label: series.label,
            data: months.map(month => (isNum(month[metric]) ? Number(month[metric]) : null)),
            yAxisID: series.axis,
            borderColor: series.color,
            backgroundColor: series.fill,
            borderWidth: 2.2,
            borderDash: series.dashed ? [5, 4] : [],
            tension: 0.3,
            spanGaps: true,
            fill: false,
            // El mes del filtro se marca con un punto mas grande.
            pointRadius: months.map(month => (month.id === highlight ? 6 : 3)),
            pointHoverRadius: 7,
            pointBackgroundColor: months.map(month => (month.id === highlight ? series.color : '#fff')),
            pointBorderColor: series.color,
            pointBorderWidth: 2
          };
        })
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        onClick: (event, elements) => {
          // Un clic en el grafico cambia el mes seleccionado (y sale de Anual).
          if (!elements.length) return;
          const month = months[elements[0].index];
          if (month && (month.id !== state.monthId || state.annual)) selectTab(month.id);
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => months[items[0].dataIndex].label,
              label: context => {
                const series = MONTHLY[context.dataset.metricKey];
                return ` ${series.label}: ${formatValue(context.raw, series.unit)}`;
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { color: '#cbd5e1' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
          y: {
            beginAtZero: true,
            border: { display: false },
            grid: { color: 'rgba(15,23,42,.06)' },
            ticks: { color: '#94a3b8', font: { size: 10 }, callback: value => formatValue(value, 'money', true) }
          },
          y1: {
            beginAtZero: true,
            position: 'right',
            border: { display: false },
            grid: { drawOnChartArea: false },
            ticks: { color: '#7c3aed', font: { size: 10 }, precision: 0 }
          },
          // Ejes ocultos: cada serie conserva su escala y su forma se lee igual.
          y2: { display: false, beginAtZero: true, grid: { drawOnChartArea: false } },
          y3: { display: false, beginAtZero: true, grid: { drawOnChartArea: false } }
        }
      }
    });
  }

  // Evolucion diaria dentro del mes: una linea por indicador disponible.
  //
  // Cuando el mes trae los totales de campanas pero no el export diario de
  // inversion y resultados, esas dos series se reparten entre los dias segun las
  // impresiones de cada dia. Quedan marcadas como estimadas y desaparecen en
  // cuanto se importe la serie diaria real.
  function dailySeries() {
    const rows = state.daily.map(row => Object.assign({}, row));
    const estimated = new Set();
    // Mismos totales que los KPIs: los del informe cuando vienen en la fuente.
    const month = currentMonth();
    const totals = month ? monthTotals(month) : { cost: 0, conversions: 0 };
    const monthlyCost = Number(totals.cost) || 0;
    const monthlyConversions = Number(totals.conversions) || 0;
    const hasDailyCost = rows.some(row => isNum(row.cost));
    const hasDailyConversions = rows.some(row => isNum(row.conversions));

    if (rows.length && (!hasDailyCost || !hasDailyConversions) && (monthlyCost > 0 || monthlyConversions > 0)) {
      const totalImpressions = rows.reduce((total, row) => total + (isNum(row.impressions) ? Number(row.impressions) : 0), 0);
      const weightOf = row => (totalImpressions > 0 && isNum(row.impressions) ? Number(row.impressions) / totalImpressions : 1 / rows.length);
      if (!hasDailyCost && monthlyCost > 0) {
        rows.forEach(row => { row.cost = monthlyCost * weightOf(row); });
        estimated.add('cost');
      }
      if (!hasDailyConversions && monthlyConversions > 0) {
        rows.forEach(row => { row.conversions = monthlyConversions * weightOf(row); });
        estimated.add('conversions');
      }
    }

    rows.forEach(row => {
      const cost = isNum(row.cost) ? Number(row.cost) : null;
      const conversions = isNum(row.conversions) ? Number(row.conversions) : null;
      row.costPerConversion = cost !== null && conversions !== null && conversions > 0 ? cost / conversions : null;
    });
    if (estimated.has('cost') || estimated.has('conversions')) estimated.add('costPerConversion');

    const active = DAILY_ORDER.filter(metric => rows.some(row => isNum(row[metric])));
    return { rows, active, estimated };
  }

  function dailySummary(rows, active, estimated, weeks) {
    const month = currentMonth();
    const scope = weeks ? `${weeks} semanas (${rows.length} días)` : `${rows.length} días`;
    const parts = [`${scope} de ${month ? month.label : 'el periodo'}`];
    const totalOf = metric => rows.reduce((total, row) => total + (isNum(row[metric]) ? Number(row[metric]) : 0), 0);
    if (active.includes('cost')) parts.push(`${fmtMoney(totalOf('cost'))} de inversión`);
    if (active.includes('conversions')) parts.push(`${fmtCount(totalOf('conversions'))} resultados`);
    if (active.includes('cost') && active.includes('conversions')) {
      const conversions = totalOf('conversions');
      parts.push(`${fmtMoney(conversions > 0 ? totalOf('cost') / conversions : null)} por resultado`);
    }
    if (active.includes('impressions')) parts.push(`${fmtCount(dailyTotal('impressions'))} impresiones`);
    const estimatedLabels = active.filter(metric => estimated.has(metric)).map(metric => DAILY[metric].label.toLowerCase());
    const tail = estimatedLabels.length ? ` ${estimatedLabels.join(', ')} estimados a partir del total del mes.` : '';
    return `${parts.join(' | ')}.${tail}`;
  }

  // Vista Mes: evolucion diaria dentro del mes del filtro.
  // Agrupa la serie diaria en bloques de siete dias contados desde el 1 del mes
  // (1-7, 8-14, ...). Solo el ultimo bloque puede quedar corto, asi que las
  // caidas de los extremos no se confunden con semanas incompletas del calendario.
  function weeklyFromDaily(rows) {
    const buckets = new Map();
    rows.forEach(row => {
      const day = Number(String(row.date).slice(8, 10));
      if (!day) return;
      const index = Math.floor((day - 1) / 7);
      const bucket = buckets.get(index) || { index, first: row.date, last: row.date, days: 0 };
      bucket.first = row.date < bucket.first ? row.date : bucket.first;
      bucket.last = row.date > bucket.last ? row.date : bucket.last;
      bucket.days += 1;
      ['cost', 'conversions', 'impressions', 'clicks'].forEach(field => {
        if (!isNum(row[field])) return;
        bucket[field] = (isNum(bucket[field]) ? bucket[field] : 0) + Number(row[field]);
      });
      buckets.set(index, bucket);
    });
    return [...buckets.values()]
      .sort((a, b) => a.index - b.index)
      .map(bucket => Object.assign(bucket, {
        date: bucket.first,
        costPerConversion: isNum(bucket.cost) && isNum(bucket.conversions) && bucket.conversions > 0
          ? bucket.cost / bucket.conversions
          : null,
        label: weekLabel(bucket.first, bucket.last),
        longLabel: weekLongLabel(bucket.first, bucket.last, bucket.days)
      }));
  }

  function weekLabel(first, last) {
    const month = MONTH_NAMES[Number(first.slice(5, 7)) - 1].slice(0, 3).toLowerCase();
    const from = Number(first.slice(8, 10));
    const to = Number(last.slice(8, 10));
    return from === to ? `${from} ${month}` : `${from}-${to} ${month}`;
  }

  function weekLongLabel(first, last, days) {
    const corto = days && days < 7 ? ` (${days} ${days === 1 ? 'día' : 'días'})` : '';
    if (first === last) return `${formatLongDate(first)}${corto}`;
    return `Del ${formatLongDate(first)} al ${formatLongDate(last)}${corto}`;
  }

  function renderMonthView(granularity) {
    const panel = document.getElementById('chart-panel');
    if (!panel) return;
    const weekly = granularity === 'week';
    const detail = weekly ? 'semanal' : 'diaria';
    const { rows: dayRows, active, estimated } = dailySeries();
    const rows = weekly ? weeklyFromDaily(dayRows) : dayRows;
    const month = currentMonth();
    panel.hidden = false;
    if (!rows.length || !active.length) {
      if (state.chart) { state.chart.destroy(); state.chart = null; }
      document.getElementById('chart-title').textContent = `Evolución ${detail} | ${month ? month.label : ''}`.trim();
      document.getElementById('chart-sub').textContent = 'Este mes no tiene detalle por día.';
      const emptyLegend = document.querySelector('.chart-legend span');
      if (emptyLegend) emptyLegend.innerHTML = '';
      const emptyNote = document.getElementById('chart-note');
      if (emptyNote) {
        emptyNote.hidden = false;
        emptyNote.textContent = 'Sin serie diaria para este mes. En la vista Mes sí aparece junto a los demás meses del año.';
      }
      return;
    }
    document.getElementById('chart-title').textContent = `Evolución ${detail} | ${month ? month.label : ''}`.trim();
    document.getElementById('chart-sub').textContent = dailySummary(dayRows, active, estimated, weekly ? rows.length : 0);
    const legend = document.querySelector('.chart-legend span');
    if (legend) {
      legend.innerHTML = active.map(metric => `<i class="legend-line" style="background:${DAILY[metric].color}"></i><b>${DAILY[metric].label}${estimated.has(metric) ? ' (est.)' : ''}</b>`).join('');
    }
    const note = document.getElementById('chart-note');
    if (note) {
      const missing = ['cost', 'conversions'].filter(metric => !active.includes(metric)).map(metric => DAILY[metric].label.toLowerCase());
      const guessed = ['cost', 'conversions'].filter(metric => estimated.has(metric)).map(metric => DAILY[metric].label.toLowerCase());
      note.hidden = !missing.length && !guessed.length;
      if (guessed.length) {
        note.textContent = `Líneas punteadas: ${guessed.join(' y ')} del mes repartidos entre los días según las impresiones de cada día, no son cifras diarias reales. Al importar el export diario con las columnas Fecha, Coste y Resultados se reemplazan por los valores reales.`;
      } else if (missing.length) {
        note.textContent = `Falta el detalle diario de ${missing.join(' y ')}. Envía el export diario con las columnas Fecha, Coste y Resultados y este gráfico las dibujará junto a las impresiones.`;
      } else {
        note.textContent = '';
      }
    }
    const canvas = document.getElementById('chart-monthly');
    if (typeof Chart === 'undefined') {
      canvas.parentElement.innerHTML = '<div class="empty-state"><strong>Gráfico no disponible sin conexión.</strong><span>Los totales siguen visibles en los KPIs.</span></div>';
      return;
    }
    if (state.chart) state.chart.destroy();
    // Sin resultados diarios, las impresiones pasan al eje visible de conteo.
    const impressionsAlone = active.includes('impressions') && !active.includes('conversions');
    const axisFor = metric => (metric === 'impressions' && impressionsAlone ? 'y1' : DAILY[metric].axis);
    const usesMoney = active.some(metric => axisFor(metric) === 'y');
    const usesCount = active.some(metric => axisFor(metric) === 'y1');
    const costPerResultValues = rows.map(row => Number(row.costPerConversion)).filter(value => Number.isFinite(value) && value > 0);
    state.chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: rows.map(row => (weekly ? row.label : formatDay(row.date))),
        datasets: active.map(metric => {
          const series = DAILY[metric];
          return {
            metricKey: metric,
            label: series.label,
            data: rows.map(row => (isNum(row[metric]) ? Number(row[metric]) : null)),
            yAxisID: axisFor(metric),
            borderColor: series.color,
            backgroundColor: active.length === 1 ? 'rgba(245,158,11,.14)' : 'transparent',
            borderWidth: 2,
            borderDash: estimated.has(metric) || series.dashed ? [5, 4] : [],
            pointRadius: rows.length > 20 ? 2 : 4,
            pointHoverRadius: 5,
            pointBackgroundColor: series.color,
            tension: 0.32,
            spanGaps: true,
            fill: active.length === 1
          };
        })
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => (weekly ? rows[items[0].dataIndex].longLabel : formatLongDate(rows[items[0].dataIndex].date)),
              label: context => {
                const metric = context.dataset.metricKey;
                const series = DAILY[metric];
                return ` ${series.label}: ${formatValue(context.raw, series.unit)}${estimated.has(metric) ? ' (estimado)' : ''}`;
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { color: '#cbd5e1' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
          y: {
            display: usesMoney,
            beginAtZero: true,
            border: { display: false },
            grid: { color: 'rgba(15,23,42,.06)' },
            ticks: { color: '#94a3b8', font: { size: 10 }, callback: value => formatValue(value, 'money', true) }
          },
          y1: {
            display: usesCount,
            position: usesMoney ? 'right' : 'left',
            beginAtZero: true,
            border: { display: false },
            grid: { color: usesMoney ? 'rgba(0,0,0,0)' : 'rgba(15,23,42,.06)', drawOnChartArea: !usesMoney },
            ticks: { color: '#94a3b8', font: { size: 10 }, callback: value => fmtCount(value) }
          },
          // Ejes ocultos: cada serie conserva su escala y su forma se lee igual.
          y2: {
            display: false,
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            suggestedMax: (costPerResultValues.length ? Math.max(...costPerResultValues) : 1) * 1.8
          },
          y3: { display: false, beginAtZero: true, grid: { drawOnChartArea: false } }
        }
      }
    });
  }

  // ════════════════════════════════════════════════════════════
  // Gasto publicitario: pestanas de mes y Anual, periodo con KPIs, distribucion
  // por campana con un cuadro por campana y el ranking de palabras clave del periodo.
  // Todas las campanas son de Busqueda (una SKAG por servicio): los cuadros van
  // por campana. El informe de campana trae un total por mes; las palabras clave
  // salen de data/aquarius-palabras-clave-2026.json, tal como lo publica el build.
  // ════════════════════════════════════════════════════════════
  const YEAR_KEY = 'anual';
  const KEYWORDS_URL = 'data/aquarius-palabras-clave-2026.json';
  const CONFIG_URL = 'data/drive-config.json';
  // Indicadores, vista y minimizado del grafico de cada campana, por campana.
  const CAMP_CHARTS_KEY = 'aquarius_gasto_campaign_charts';
  const KW_COMPACT_KEY = 'aquarius_gasto_kw_compact';
  const SHORT_NAMES = MONTH_NAMES.map(name => name.slice(0, 3));
  const SUMS = ['cost', 'impressions', 'clicks', 'conversions'];
  const SUM_NAMES = { cost: 'inversión', impressions: 'impresiones', clicks: 'clics', conversions: 'conversiones' };
  // Sumas de las que sale cada cociente.
  const RATE_USES = { ctr: ['clicks', 'impressions'], cpc: ['cost', 'clicks'], costPerConversion: ['cost', 'conversions'], conversionRate: ['conversions', 'clicks'] };
  // Sumas que trae el informe por dia y campana (months[].detail): no trae impresiones.
  const DETAIL_SUMS = ['cost', 'clicks', 'conversions'];
  const CHART_COLOR = '#2563eb';
  const AXIS_COLOR = '#94a3b8';
  const GRID_COLOR = 'rgba(15,23,42,.06)';
  const PREVIOUS_COLOR = '#94a3b8';
  const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';
  // Por dia necesita el informe por dia y campana (months[].detail); sin el, solo Por mes. No hay acumulado
  // del mes: siempre sube y hace ver un crecimiento que no hay.
  const MODES = [
    { key: 'daily', label: 'Por día' },
    { key: 'monthly', label: 'Por mes' }
  ];
  // Indicadores del grafico de cada campana. daily: el campo del informe por dia (no trae impresiones).
  // ratio: cociente de dos sumas del dia o del mes (sin conversiones, hueco). color: el de su linea cuando los
  // indicadores van juntos en un solo cuadro.
  const CAMPAIGN_METRICS = [
    { key: 'cost', label: 'Inversión', unit: 'money', daily: 'cost', color: CHART_COLOR },
    { key: 'conversions', label: 'Conversiones', unit: 'decimal', daily: 'conversions', color: '#0f766e' },
    { key: 'clicks', label: 'Clics', unit: 'count', daily: 'clicks', color: '#ea580c' },
    { key: 'impressions', label: 'Impresiones', unit: 'count', daily: null, color: '#7c3aed' },
    { key: 'costPerConversion', label: 'Costo por conversión', unit: 'money', daily: null, ratio: ['cost', 'conversions'], color: '#db2777' }
  ];
  const DEFAULT_METRICS = ['cost', 'conversions'];
  // better: hacia donde una variacion es buena (null = neutra).
  const CAMPAIGN_KPIS = [
    { key: 'cost', label: 'Inversión', unit: 'money', better: null },
    { key: 'clicks', label: 'Clics', unit: 'count', better: 'up' },
    { key: 'ctr', label: 'CTR', unit: 'percent', better: 'up' },
    { key: 'cpc', label: 'CPC', unit: 'money', better: 'down' },
    { key: 'conversions', label: 'Conversiones', unit: 'decimal', better: 'up' },
    { key: 'costPerConversion', label: 'Costo por conversión', unit: 'money', better: 'down' },
    { key: 'dailyBudget', label: 'Presupuesto diario', unit: 'money', better: null }
  ];
  // perMonth: en Anual muestra su promedio mensual en lugar de la variacion. uses: sumas de las que depende.
  const KPIS = [
    { key: 'cost', label: 'Inversión', hint: 'Costo del periodo', better: null, unit: 'money', perMonth: true, uses: ['cost'] },
    { key: 'impressions', label: 'Impresiones', hint: 'Veces que se mostraron los anuncios', better: 'up', unit: 'count', perMonth: true, uses: ['impressions'] },
    { key: 'clicks', label: 'Clics', hint: 'Clics en los anuncios', better: 'up', unit: 'count', perMonth: true, uses: ['clicks'] },
    { key: 'ctr', label: 'CTR', hint: 'Clics / impresiones', better: 'up', unit: 'percent', uses: RATE_USES.ctr },
    { key: 'cpc', label: 'CPC prom.', hint: 'Costo por clic', better: 'down', unit: 'money', uses: RATE_USES.cpc },
    { key: 'conversions', label: 'Conversiones', hint: 'Contactos registrados', better: 'up', unit: 'decimal', perMonth: true, uses: ['conversions'] },
    { key: 'costPerConversion', label: 'Costo por conversión', hint: 'Inversión / conversiones', better: 'down', unit: 'money', uses: RATE_USES.costPerConversion },
    { key: 'conversionRate', label: 'Tasa de conversión', hint: 'Conversiones / clics', better: 'up', unit: 'percent', uses: RATE_USES.conversionRate }
  ];

  const gasto = {
    months: [],
    latestKey: null,
    campaignCharts: readJson(CAMP_CHARTS_KEY),
    charts: new Map(),
    // Palabras clave: 'loading' hasta que llega el JSON; kwMonths = id -> mes con sus campanas.
    kwStatus: 'loading',
    kwMonths: new Map(),
    config: null,
    kwSync: null,
    kwFilter: 'all',
    compact: readSetting(KW_COMPACT_KEY) === 'true',
    fullscreen: false,
    tabsHome: null
  };

  function readSetting(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }
  function saveSetting(key, value) {
    try { window.localStorage.setItem(key, String(value)); } catch (error) { /* almacenamiento bloqueado */ }
  }
  function readJson(key) {
    try {
      const value = JSON.parse(readSetting(key) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (error) {
      return {};
    }
  }

  const normalizeText = text => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  // Una campana se identifica por su nombre sin tildes: el informe de campana y el de palabras clave coinciden asi.
  const campaignKey = normalizeText;
  const keywordKey = row => `${normalizeText(row.keyword)}|${normalizeText(row.matchType)}`;
  const slug = text => String(text).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const monthKeyOf = (year, number) => `${year}-${String(number).padStart(2, '0')}`;
  const limaToday = () => new Date(Date.now() - 5 * 3600000);
  const dayRange = (month, from, to) => `${from}-${to} ${month.name}`;

  // Un render que reemplaza el HTML de host no saca el foco del control que se estaba usando (pestana o chip).
  function keepFocus(host, render) {
    const active = document.activeElement;
    if (!host || !active || active === host || !host.contains(active)) { render(); return; }
    const sig = node => [node.tagName, node.getAttribute('name'), node.getAttribute('value'),
      ...[...node.attributes].filter(attr => attr.name.startsWith('data-')).map(attr => `${attr.name}=${attr.value}`)].join('|');
    const wanted = sig(active);
    render();
    if (document.activeElement === active) return;
    const match = [...host.querySelectorAll(active.tagName)].find(node => sig(node) === wanted);
    if (match) match.focus({ preventScroll: true });
  }

  // ── Datos: meses del informe de campana ──
  const pickSums = item => Object.fromEntries(SUMS.map(field => [field, isNum(item[field]) ? Number(item[field]) : null]));
  const isActive = item => ['cost', 'impressions', 'clicks', 'conversions'].some(field => Number(item[field]) > 0);
  const ratio = (a, b) => (isNum(a) && isNum(b) && Number(b) !== 0 ? Number(a) / Number(b) : null);

  // CTR, CPC, costo y tasa de conversion se recalculan sobre las sumas; nunca se promedian.
  function derive(totals) {
    return Object.assign({}, totals, {
      ctr: ratio(totals.clicks, totals.impressions),
      cpc: ratio(totals.cost, totals.clicks),
      costPerConversion: ratio(totals.cost, totals.conversions),
      conversionRate: ratio(totals.conversions, totals.clicks)
    });
  }
  // Suma campo a campo; si un sumando no informa el campo (null), la suma tampoco.
  function sumOf(items) {
    return Object.fromEntries(SUMS.map(field => [field, items.reduce((total, item) => (total === null || !isNum(item[field]) ? null : total + Number(item[field])), 0)]));
  }
  const scale = (totals, factor) => Object.fromEntries(SUMS.map(field => [field, isNum(totals[field]) ? totals[field] * factor : null]));
  const listText = items => (items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}` : items.join(''));

  // Mes anterior en un mes en curso: las sumas del tramo real donde las hay y el resto prorrateado; cada cociente,
  // del tramo si sus dos sumas son reales y si no, el del mes anterior completo (full).
  function tramoTotals(totals, full, factor, tramo) {
    const sums = Object.assign(scale(totals, factor), tramo);
    const real = derive(sums);
    return Object.assign(sums, Object.fromEntries(Object.entries(RATE_USES)
      .map(([key, uses]) => [key, uses.every(field => field in tramo) ? real[key] : full[key]])));
  }

  // Sumas reales del informe por dia de un mes entre los dias from y to: de una campana (key) o de la cuenta
  // (las campanas del informe de campana del mes, sin las excluidas). Solo si el informe por dia cubre todo el
  // tramo; si no, {} (todo prorrateado). Impresiones nunca: el informe por dia no las trae.
  function detailTramo(month, from, to, key = null) {
    if (!month.detail || month.detailFirst > from || month.detailLast < to) return {};
    const keys = new Set(key ? [key] : month.campaigns.map(campaign => campaign.key));
    const rows = month.detail.filter(row => row.d >= from && row.d <= to && keys.has(row.campaignKey));
    return Object.fromEntries(DETAIL_SUMS.map(field => [field, rows.reduce((total, row) => total + row[field], 0)]));
  }

  // Informe por dia y campana (months[].detail.table: columns, rows y la lista de campanas por indice).
  // Hoy no llega; con el, los cuadros ofrecen Por dia y el mes en curso se compara con el tramo real.
  function detailRows(month) {
    const table = month.detail && month.detail.table;
    if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return null;
    const at = Object.fromEntries(table.columns.map((name, index) => [name, index]));
    const names = Array.isArray(table.campaigns) ? table.campaigns : [];
    return table.rows.map(row => {
      const campaign = names[row[at.campaign]] || '';
      return { d: Number(row[at.d]), campaignKey: campaignKey(campaign), cost: Number(row[at.cost]) || 0, clicks: Number(row[at.clicks]) || 0, conversions: Number(row[at.conversions]) || 0 };
    }).filter(row => row.d > 0);
  }

  function gastoMonth(month) {
    const [year, number] = month.id.split('-').map(Number);
    const daysInMonth = new Date(year, number, 0).getDate();
    const dayOf = iso => (typeof iso === 'string' && iso.startsWith(month.id) ? Number(iso.slice(8, 10)) : null);
    const firstDay = (month.period && dayOf(month.period.start)) || 1;
    const lastDay = (month.period && dayOf(month.period.end)) || daysInMonth;
    const totals = monthTotals(month);
    const detail = detailRows(month);
    const days = detail ? detail.map(row => row.d) : [];
    return {
      key: month.id,
      label: month.label,
      name: MONTH_NAMES[number - 1],
      shortName: SHORT_NAMES[number - 1],
      year,
      month: number,
      daysInMonth,
      firstDay,
      lastDay,
      complete: firstDay === 1 && lastDay === daysInMonth,
      totals: pickSums(totals),
      dailyBudget: month.dailyBudget,
      campaigns: month.records.map(record => Object.assign(pickSums(record), {
        name: record.campaign,
        key: campaignKey(record.campaign),
        label: campaignLabel(record.campaign),
        status: record.status || '',
        dailyBudget: isNum(record.dailyBudget) ? Number(record.dailyBudget) : null
      })),
      excluded: month.excluded || [],
      detail,
      detailFirst: days.length ? Math.min(...days) : null,
      detailLast: days.length ? Math.max(...days) : null,
      hasData: totals.hasData
    };
  }

  function buildGastoMonths() {
    gasto.months = state.months.filter(month => /^\d{4}-\d{2}$/.test(month.id)).map(gastoMonth);
    const withData = gasto.months.filter(month => month.hasData);
    gasto.latestKey = withData.length ? withData[withData.length - 1].key : null;
    // Un mes anterior al ultimo con datos ya termino aunque su informe no llegue al ultimo dia.
    gasto.months.forEach(month => { month.past = Boolean(gasto.latestKey && month.key < gasto.latestKey); });
  }

  const gastoMonthByKey = key => gasto.months.find(month => month.key === key) || null;
  function previousKey(month) {
    const date = new Date(month.year, month.month - 2, 1);
    return monthKeyOf(date.getFullYear(), date.getMonth() + 1);
  }
  function selectedGastoMonth() {
    const month = gastoMonthByKey(state.monthId);
    return month && month.hasData ? month : gastoMonthByKey(gasto.latestKey);
  }
  const viewYear = () => (selectedGastoMonth() || { year: limaToday().getUTCFullYear() }).year;

  // Mes cerrado: contra el mes anterior completo. Mes en curso: cada suma contra el mismo tramo del mes anterior
  // cuando el informe por dia (months[].detail) cubre esos dias; las que no (impresiones siempre, y todas
  // mientras no llegue ese informe), contra el mes anterior prorrateado a los mismos dias, porque el informe de
  // campana llega con un total por mes. Un cociente (CTR, CPC, costo y tasa de conversion) sale del tramo si sus
  // dos sumas son reales; si no, es el del mes anterior completo (no cambia al prorratear). Solo el mes
  // calendario anterior.
  function periodOf(month) {
    if (!month || !month.hasData) return null;
    const closed = month.complete || month.past;
    const days = month.lastDay - month.firstDay + 1;
    const previous = gastoMonthByKey(previousKey(month));
    let compare = null;
    if (previous && previous.hasData) {
      const previousDays = previous.lastDay - previous.firstDay + 1;
      const factor = closed ? 1 : Math.min(1, days / previousDays);
      const full = dayRange(previous, previous.firstDay, previous.lastDay);
      if (factor >= 1) {
        compare = { month: previous, factor: 1, tramo: {}, label: full, shortFor: () => full };
      } else {
        const tramo = detailTramo(previous, month.firstDay, month.lastDay);
        const real = SUMS.filter(field => field in tramo);
        const tramoLabel = dayRange(previous, month.firstDay, month.lastDay);
        const prorated = `${previous.name} prorrateado a ${days} ${days === 1 ? 'día' : 'días'}`;
        compare = {
          month: previous,
          factor,
          tramo,
          label: real.length === SUMS.length
            ? `${tramoLabel} (informe por día)`
            : real.length
              ? `${tramoLabel} en ${listText(real.map(field => SUM_NAMES[field]))} (informe por día); el resto, ${prorated}`
              : prorated,
          shortFor: uses => (uses.length && uses.every(field => field in tramo) ? tramoLabel : `${previous.shortName} prorrateado`)
        };
      }
    }
    return { month, months: [month], year: month.year, closed, compare, label: dayRange(month, month.firstDay, month.lastDay) };
  }

  // Anual: acumulado de los meses del ano con informe, sin comparacion (no hay informes del ano anterior).
  function yearPeriod(year) {
    const months = gasto.months.filter(month => month.hasData && month.year === year);
    if (!months.length) return null;
    const first = months[0];
    const last = months[months.length - 1];
    return {
      annual: true, month: null, months, year, compare: null,
      closed: last.month === 12 && last.complete,
      label: `${first.firstDay} ${first.name} - ${last.lastDay} ${last.name}`
    };
  }

  function currentPeriod() {
    if (state.annual) {
      const period = yearPeriod(viewYear());
      if (period) return period;
    }
    return periodOf(selectedGastoMonth());
  }

  const periodTotals = period => derive(sumOf(period.months.map(month => month.totals)));
  function previousTotals(period) {
    if (!period.compare) return null;
    const { month, factor, tramo } = period.compare;
    const full = derive(month.totals);
    if (factor >= 1) return full;
    return tramoTotals(month.totals, full, factor, tramo);
  }

  // Campanas del periodo, de mayor a menor inversion (en Anual, sumadas por nombre; estado y presupuesto del ultimo mes).
  function periodCampaigns(period) {
    const byKey = new Map();
    period.months.forEach(month => month.campaigns.forEach(campaign => {
      if (!byKey.has(campaign.key)) byKey.set(campaign.key, { items: [], months: [] });
      const entry = byKey.get(campaign.key);
      entry.items.push(campaign);
      if (isActive(campaign)) entry.months.push(month);
    }));
    const total = periodTotals(period).cost || 0;
    return [...byKey.values()]
      .map(({ items, months }) => {
        const last = items[items.length - 1];
        const sums = derive(sumOf(items));
        return Object.assign(sums, {
          key: last.key, name: last.name, label: last.label, status: last.status, dailyBudget: last.dailyBudget,
          months, share: total > 0 && isNum(sums.cost) ? sums.cost / total : null
        });
      })
      .filter(isActive)
      .sort((a, b) => (b.cost || 0) - (a.cost || 0) || (b.conversions || 0) - (a.conversions || 0));
  }

  // La campana en el mes de comparacion, con la misma regla que el total: su tramo real del informe por dia
  // (que viene por campana) o prorrateada. El presupuesto diario no se prorratea.
  function previousCampaign(period, key) {
    if (!period.compare) return null;
    const { month, factor } = period.compare;
    const campaign = month.campaigns.find(item => item.key === key);
    if (!campaign || !isActive(campaign)) return null;
    const full = derive(pickSums(campaign));
    const totals = factor >= 1 ? full
      : tramoTotals(campaign, full, factor, detailTramo(month, period.month.firstDay, period.month.lastDay, key));
    return Object.assign(totals, { dailyBudget: campaign.dailyBudget });
  }

  // ── Datos: palabras clave por mes ──
  // Una fila por palabra clave + concordancia dentro de su campana, como en el modulo Palabras Clave:
  // si esta en varios grupos de anuncios, se suma. Las campanas de keywords.excludeCampaigns no entran.
  function buildKeywordMonths(data, config) {
    const exclude = ((config && config.keywords && config.keywords.excludeCampaigns) || []).map(normalizeText);
    const months = new Map();
    (Array.isArray(data && data.months) ? data.months : []).forEach(month => {
      const id = String(month.id || '');
      if (!/^\d{4}-\d{2}$/.test(id)) return;
      const [year, number] = id.split('-').map(Number);
      const daysInMonth = new Date(year, number, 0).getDate();
      const dayOf = iso => (typeof iso === 'string' && iso.startsWith(id) ? Number(iso.slice(8, 10)) : null);
      const firstDay = (month.period && dayOf(month.period.start)) || 1;
      const lastDay = (month.period && dayOf(month.period.end)) || daysInMonth;
      const byCampaign = new Map();
      (Array.isArray(month.keywords) ? month.keywords : []).forEach(row => {
        const cKey = campaignKey(row.campaign);
        if (!row.keyword || !cKey || exclude.includes(cKey)) return;
        if (!byCampaign.has(cKey)) byCampaign.set(cKey, new Map());
        const group = byCampaign.get(cKey);
        const key = keywordKey(row);
        if (!group.has(key)) group.set(key, { key, keyword: row.keyword, matchType: row.matchType || '', campaign: row.campaign, impressions: 0, clicks: 0, cost: 0, conversions: 0 });
        const entry = group.get(key);
        SUMS.forEach(field => { entry[field] += Number(row[field]) || 0; });
      });
      months.set(id, {
        id, name: MONTH_NAMES[number - 1], shortName: SHORT_NAMES[number - 1], year, month: number,
        daysInMonth, firstDay, lastDay, complete: firstDay === 1 && lastDay === daysInMonth, byCampaign
      });
    });
    return months;
  }

  // Filas del periodo (una o varias campanas). En Anual se suman los meses; id = campana|palabra clave.
  function keywordRows(kwMonths, onlyCampaign = null) {
    const byId = new Map();
    kwMonths.forEach(month => month.byCampaign.forEach((entries, cKey) => {
      if (onlyCampaign && cKey !== onlyCampaign) return;
      entries.forEach(entry => {
        const id = `${cKey}|${entry.key}`;
        if (!byId.has(id)) byId.set(id, { id, key: entry.key, campaignKey: cKey, campaign: entry.campaign, keyword: entry.keyword, matchType: entry.matchType, impressions: 0, clicks: 0, cost: 0, conversions: 0 });
        const row = byId.get(id);
        SUMS.forEach(field => { row[field] += entry[field]; });
      });
    }));
    return [...byId.values()].map(derive);
  }

  // Meses del periodo con informe de palabras clave.
  function keywordScope(period) {
    const months = period.months.map(month => gasto.kwMonths.get(month.key)).filter(Boolean);
    let label = '';
    if (period.annual) label = months.map(month => month.shortName).join(', ');
    else if (months.length) label = months[0].complete ? `${months[0].name} ${months[0].year}` : `${dayRange(months[0], months[0].firstDay, months[0].lastDay)} ${months[0].year}`;
    return { months, label };
  }

  // Comparacion de las palabras clave con el mes calendario anterior. Los informes son mensuales: si el del
  // mes es parcial, solo se compara cuando el anterior cubre los mismos dias; si no, no hay comparacion.
  function keywordCompare(period) {
    if (period.annual) return { compare: null, reason: null };
    const current = gasto.kwMonths.get(period.month.key);
    if (!current) return { compare: null, reason: null };
    const previousId = previousKey(period.month);
    const previous = gasto.kwMonths.get(previousId);
    if (!previous) return { compare: null, reason: `Sin informe de palabras clave de ${monthLabel(previousId)} para comparar.` };
    if (current.complete && previous.complete) return { compare: { month: previous, label: previous.name }, reason: null };
    if (current.firstDay === previous.firstDay && current.lastDay === previous.lastDay) {
      return { compare: { month: previous, label: dayRange(previous, previous.firstDay, previous.lastDay) }, reason: null };
    }
    return { compare: null, reason: `Sin comparación: el informe de palabras clave de ${current.name} y el de ${previous.name} no cubren los mismos días.` };
  }

  // ── Celdas compartidas ──
  const change = (current, previous) => (isNum(current) && isNum(previous) && Number(previous) !== 0 ? (current - previous) / previous : null);
  const pctText = (value, decimals = 1) => `${(Math.abs(value) * 100).toLocaleString('es-PE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;

  // "▲ 12.3% vs 1-31 Julio". El color depende de si subir es bueno para ese indicador. Sin compareLabel queda
  // solo "▲ 12.3%" (KPIs de cada campana, cuyo subtitulo ya dice contra que periodo se compara).
  function deltaHtml(current, previous, better, compareLabel) {
    const d = change(current, previous);
    if (d === null) return compareLabel ? `<small class="gasto-delta flat">Sin dato en ${escapeHtml(compareLabel)}</small>` : '';
    const direction = Math.abs(d) < 0.0005 ? 'flat' : d > 0 ? 'up' : 'down';
    const tone = direction === 'flat' || !better ? 'flat' : direction === better ? 'good' : 'bad';
    const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '●';
    return `<small class="gasto-delta ${tone}">${arrow} ${pctText(d)}${compareLabel ? ` vs ${escapeHtml(compareLabel)}` : ''}</small>`;
  }

  // Variacion con el mes anterior: "Nuevo" si no estaba, verde o rojo si no.
  function variationCell(current, previous) {
    if (previous === null || previous === undefined) return '<span class="status-pill new">Nuevo</span>';
    const d = change(current, previous);
    if (d === null) return '<span class="no-data">—</span>';
    return `<span class="status-pill ${d >= 0 ? 'green' : 'red'}">${d >= 0 ? '▲' : '▼'} ${pctText(d, 0)}</span>`;
  }

  function statusPill(status) {
    const plain = normalizeText(status);
    const tone = /^habilitad/.test(plain) ? 'green' : !plain || /^(detenid|pausad|en pausa|quitad|eliminad)/.test(plain) ? 'muted' : 'amber';
    return `<span class="status-pill ${tone}">${escapeHtml(status || 'Sin estado')}</span>`;
  }

  const shareCell = share => (isNum(share)
    ? `<td class="gasto-share-col"><span class="gasto-share"><span style="width:${Math.min(100, share * 100).toFixed(1)}%"></span></span><b>${fmtPercent(share)}</b></td>`
    : '<td class="gasto-share-col"><span class="no-data">—</span></td>');

  // ── Pestanas de mes ──
  function renderTabs(period) {
    const host = document.getElementById('month-tabs');
    if (!host) return;
    const year = viewYear();
    const yearOk = Boolean(yearPeriod(year));
    const annual = Boolean(period && period.annual);
    const selected = period && period.month ? period.month.key : null;
    keepFocus(host, () => {
      host.innerHTML = MONTH_NAMES.map((name, index) => {
        const key = monthKeyOf(year, index + 1);
        const month = gastoMonthByKey(key);
        const ok = Boolean(month && month.hasData);
        const on = !annual && key === selected;
        return `<button type="button" class="month-tab${on ? ' active' : ''}" data-month="${key}" aria-pressed="${on}"${ok ? '' : ' disabled title="Sin informe de campaña en la carpeta de Drive"'}>${name}${key === gasto.latestKey ? '<span class="current-dot" title="Último mes con datos"></span>' : ''}</button>`;
      }).join('') + `<button type="button" class="month-tab${annual ? ' active' : ''}" data-month="${YEAR_KEY}" aria-pressed="${annual}" title="${yearOk ? `Acumulado ${year} de los meses con informe` : 'Sin informes de campaña'}"${yearOk ? '' : ' disabled'}>Anual</button>`;
    });
  }

  // Huecos de la carpeta: meses sin informe de campana entre el primero y el ultimo con datos.
  function missingMonths() {
    const withData = gasto.months.filter(month => month.hasData);
    const missing = [];
    if (withData.length < 2) return missing;
    const first = withData[0];
    const last = withData[withData.length - 1];
    for (let date = new Date(first.year, first.month - 1, 1); ; date.setMonth(date.getMonth() + 1)) {
      const key = monthKeyOf(date.getFullYear(), date.getMonth() + 1);
      if (key >= last.key) break;
      const month = gastoMonthByKey(key);
      if (!month || !month.hasData) missing.push(key);
    }
    return missing;
  }

  function renderAlerts(period) {
    const host = document.getElementById('gasto-alerts');
    if (!host) return;
    // Campanas excluidas en los meses del periodo: su gasto no entra en ninguna cifra del tablero.
    const excludedNotes = (period ? period.months : []).flatMap(month => month.excluded.map(item => (
      `<b>Excluida:</b> ${escapeHtml(month.label)} no incluye la campaña «${escapeHtml(item.campaign)}» `
      + `(${fmtMoney(item.cost)}, ${fmtCount(item.impressions)} impresiones, ${fmtCount(item.clicks)} clics): está excluida del tablero.`
    )));
    const notes = missingMonths().map(key => {
      const [year, number] = key.split('-').map(Number);
      const nextMonth = gastoMonthByKey(monthKeyOf(number === 12 ? year + 1 : year, number === 12 ? 1 : number + 1));
      const parts = [`<b>Pendiente:</b> ${escapeHtml(monthLabel(key))} no tiene informe de campaña en la carpeta ${escapeHtml(folderName())}`];
      if (gasto.kwMonths.has(key)) parts.push(' (sí tiene informe de palabras clave)');
      parts.push('. ');
      if (nextMonth && nextMonth.hasData) parts.push(`${escapeHtml(nextMonth.name)} queda sin mes anterior para comparar. `);
      parts.push('Sube el CSV del mes a la carpeta y pulsa Sincronizar, arriba a la derecha.');
      return parts.join('');
    }).concat(excludedNotes);
    host.innerHTML = notes.map(note => `<p>${note}</p>`).join('');
    host.hidden = !notes.length;
  }

  // ── Periodo y KPIs ──
  function renderPeriod(period) {
    const title = document.getElementById('gasto-period-title');
    const sub = document.getElementById('gasto-period-sub');
    if (period.annual) {
      const count = period.months.length;
      const closed = period.closed || period.year < limaToday().getUTCFullYear();
      title.textContent = `Periodo: ${period.label} ${period.year}${closed ? '' : ' (año en curso)'}`;
      sub.textContent = `Acumulado de ${count} ${count === 1 ? 'mes' : 'meses'} con informe de campaña (${period.months.map(month => month.shortName).join(', ')}). Sin año anterior para comparar.`;
    } else {
      title.textContent = `Periodo: ${period.label} ${period.year}${period.closed ? '' : ' (mes en curso)'}`;
      sub.textContent = !period.compare ? 'Sin mes anterior para comparar'
        : period.compare.factor < 1 && !Object.keys(period.compare.tramo).length ? `Comparación vs ${period.compare.label} (el informe de campaña llega con un total por mes)`
        : `Comparación vs ${period.compare.label}`;
    }
    const current = periodTotals(period);
    const previous = previousTotals(period);
    let average = null;
    if (period.annual) {
      // Mientras haya meses cerrados el mes en curso queda fuera: un mes a medias bajaria el promedio.
      const closed = period.months.filter(month => month.complete || month.past);
      const months = closed.length ? closed : period.months;
      average = Object.fromEntries(KPIS.filter(kpi => kpi.perMonth).map(kpi => [kpi.key, months.reduce((total, month) => total + (Number(month.totals[kpi.key]) || 0), 0) / months.length]));
      average.basis = `Promedio de ${months.map(month => month.name).join(', ')}`;
    }
    document.getElementById('kpi-strip').innerHTML = KPIS.map(kpi => {
      let line = `<small>${kpi.hint}</small>`;
      if (previous) line = deltaHtml(current[kpi.key], previous[kpi.key], kpi.better, period.compare.shortFor(kpi.uses));
      else if (average && kpi.perMonth) line = `<small title="${escapeHtml(average.basis)}">Prom. mensual: ${formatValue(average[kpi.key], kpi.unit)}</small>`;
      return `<div class="kpi-pill"><span>${kpi.label}</span><strong>${formatValue(current[kpi.key], kpi.unit)}</strong>${line}</div>`;
    }).join('');
  }

  // ── Distribucion de inversion por campana ──
  function renderDistribution(period, campaigns) {
    const total = periodTotals(period);
    const lastMonth = period.months[period.months.length - 1];
    document.getElementById('gasto-dist-sub').textContent = `${period.label} ${period.year} | ${campaigns.length} ${campaigns.length === 1 ? 'campaña' : 'campañas'} con inversión, impresiones o clics.${period.annual ? ' Estado y presupuesto del último mes.' : ''}`;
    const money = value => (isNum(value) ? fmtMoney(value) : '<span class="no-data">—</span>');
    document.getElementById('gasto-dist-body').innerHTML = campaigns.map(campaign => `
      <tr>
        <td class="campaign-name"><span>${escapeHtml(campaign.label)}</span><small>${escapeHtml(campaign.name)}</small></td>
        <td>${statusPill(campaign.status)}</td>
        <td class="num">${money(campaign.dailyBudget)}</td>
        <td class="num">${money(campaign.cost)}</td>
        ${shareCell(campaign.share)}
        <td class="num">${fmtCount(campaign.impressions)}</td>
        <td class="num">${fmtCount(campaign.clicks)}</td>
        <td class="num">${fmtPercent(campaign.ctr)}</td>
        <td class="num">${fmtMoney(campaign.cpc)}</td>
        <td class="num">${fmtDecimal(campaign.conversions)}</td>
        <td class="num">${fmtMoney(campaign.costPerConversion)}</td>
        <td class="num">${fmtPercent(campaign.conversionRate)}</td>
      </tr>`).join('') + `
      <tr class="gasto-total-row">
        <td>Total del periodo</td>
        <td></td>
        <td class="num" title="Suma del presupuesto diario de las campañas habilitadas">${money(lastMonth.dailyBudget)}</td>
        <td class="num">${fmtMoney(total.cost)}</td>
        <td class="gasto-share-col"><b>100%</b></td>
        <td class="num">${fmtCount(total.impressions)}</td>
        <td class="num">${fmtCount(total.clicks)}</td>
        <td class="num">${fmtPercent(total.ctr)}</td>
        <td class="num">${fmtMoney(total.cpc)}</td>
        <td class="num">${fmtDecimal(total.conversions)}</td>
        <td class="num">${fmtMoney(total.costPerConversion)}</td>
        <td class="num">${fmtPercent(total.conversionRate)}</td>
      </tr>`;
  }

  // ── Cuadro de cada campana ──
  function campaignSettings(key) {
    const saved = gasto.campaignCharts[key] || {};
    const metrics = CAMPAIGN_METRICS.map(metric => metric.key).filter(metricKey => Array.isArray(saved.metrics) && saved.metrics.includes(metricKey));
    return {
      metrics: metrics.length ? metrics : DEFAULT_METRICS,
      // Con informe por dia abre por dia; sin el, el cuadro cae a Por mes. Una vista guardada en el acumulado
      // del mes (ya no se ofrece) vuelve a Por dia.
      mode: MODES.some(mode => mode.key === saved.mode) ? saved.mode : 'daily',
      collapsed: saved.collapsed === true,
      // Varios indicadores en un solo cuadro (cada uno con su escala) en vez de paneles apilados.
      combined: saved.combined === true
    };
  }
  function saveCampaignSettings(key, changes) {
    gasto.campaignCharts[key] = Object.assign(campaignSettings(key), changes);
    saveSetting(CAMP_CHARTS_KEY, JSON.stringify(gasto.campaignCharts));
  }
  const campaignBlock = key => [...document.querySelectorAll('#gasto-blocks .gasto-camp-block')].find(node => node.dataset.campaign === key) || null;
  const hasCampaignDaily = (period, key) => !period.annual && Boolean(period.month.detail && period.month.detail.some(row => row.campaignKey === key && isActive(row)));

  // Palabras clave de la campana en el periodo, con sus conversiones contra el mes anterior. En una campana
  // SKAG el grupo de anuncios es la campana: el detalle util es la palabra clave.
  function campaignKeywordsHtml(period, campaign) {
    const head = '<div class="gasto-kw-block-head"><div class="panel-title">Palabras clave de la campaña</div>';
    const folder = escapeHtml(kwFolderName());
    if (gasto.kwStatus === 'loading') return `${head}<div class="panel-sub">Cargando palabras clave...</div></div>`;
    if (gasto.kwStatus === 'error') return `${head}<div class="panel-sub">No se pudo leer el informe de palabras clave.</div></div>`;
    const scope = keywordScope(period);
    if (!scope.months.length) {
      const what = period.annual ? 'Ningún mes del periodo tiene' : `${escapeHtml(period.month.label)} no tiene`;
      return `${head}<div class="panel-sub">${what} informe de palabras clave. Súbelo a la carpeta ${folder} de Drive.</div></div>`;
    }
    const all = keywordRows(scope.months, campaign.key);
    const rows = all.filter(isActive).sort((a, b) => b.cost - a.cost || b.conversions - a.conversions || b.clicks - a.clicks);
    if (!rows.length) {
      return `${head}<div class="panel-sub">El informe de palabras clave de ${escapeHtml(scope.label)} no trae ${all.length ? 'actividad' : 'filas'} de esta campaña.</div></div>`;
    }
    const { compare, reason } = keywordCompare(period);
    const previous = new Map(compare ? keywordRows([compare.month], campaign.key).map(row => [row.key, row]) : []);
    const kwCost = rows.reduce((total, row) => total + row.cost, 0);
    const hidden = all.length - rows.length;
    const cols = [['Palabra clave'], ['Conversiones', true]]
      .concat(compare ? [[`Conversiones ${compare.label}`, true], ['Variación', true]] : [])
      .concat([['Costo por conversión', true], ['Inversión', true], ['% de la campaña'], ['Impresiones', true], ['Clics', true], ['CPC', true]]);
    const body = rows.map(row => {
      const before = previous.get(row.key);
      return `<tr>
          <td class="gasto-kw-name"><span>${escapeHtml(row.keyword)}</span><small>${escapeHtml(row.matchType || 'Sin concordancia')}</small></td>
          <td class="num gasto-strong">${fmtDecimal(row.conversions)}</td>
          ${compare ? `<td class="num">${before ? fmtDecimal(before.conversions) : '<span class="no-data">—</span>'}</td><td class="num">${variationCell(row.conversions, before ? before.conversions : null)}</td>` : ''}
          <td class="num">${fmtMoney(row.costPerConversion)}</td>
          <td class="num">${fmtMoney(row.cost)}</td>
          ${shareCell(kwCost > 0 ? row.cost / kwCost : null)}
          <td class="num">${fmtCount(row.impressions)}</td>
          <td class="num">${fmtCount(row.clicks)}</td>
          <td class="num">${fmtMoney(row.cpc)}</td>
        </tr>`;
    }).join('');
    const notes = [`${rows.length} ${rows.length === 1 ? 'palabra clave' : 'palabras clave'} con actividad en ${escapeHtml(scope.label)}: ${fmtMoney(kwCost)} de ${fmtMoney(campaign.cost)} de la campaña.`];
    if (compare) notes.push(`Conversiones contra ${escapeHtml(compare.label)}.`);
    else if (reason) notes.push(escapeHtml(reason));
    if (hidden) notes.push(`${hidden} sin impresiones no se muestran.`);
    if (period.annual && scope.months.length < period.months.length) notes.push('Solo los meses del periodo con informe de palabras clave.');
    return `${head}<div class="panel-sub">${notes.join(' ')}</div></div>
      <div class="table-scroll">
        <table class="data-table gasto-kw-table">
          <thead><tr>${cols.map(([label, numeric]) => `<th${numeric ? ' class="num"' : ''}>${escapeHtml(label)}</th>`).join('')}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  function campaignHtml(period, campaign, before) {
    const key = escapeHtml(campaign.key);
    const id = slug(campaign.key);
    const settings = campaignSettings(campaign.key);
    let comparison = '';
    if (period.annual) {
      const months = campaign.months;
      comparison = months.length === period.months.length
        ? `. Activa en los ${months.length} ${months.length === 1 ? 'mes' : 'meses'}`
        : `. Activa en ${months.map(month => month.shortName).join(', ')}`;
    } else if (period.compare) {
      comparison = before ? ` vs ${period.compare.label}` : `. Nueva: no corría en ${period.compare.month.name}`;
    }
    const kpis = CAMPAIGN_KPIS.map(kpi => `
      <div><dt>${kpi.label}</dt><dd>${formatValue(campaign[kpi.key], kpi.unit)}${before ? deltaHtml(campaign[kpi.key], before[kpi.key], kpi.better) : ''}</dd></div>`).join('');
    return `
      <section class="gasto-camp-block${settings.collapsed ? ' is-collapsed' : ''}" data-campaign="${key}">
        <div class="gasto-camp-head">
          <div class="gasto-camp-heading">
            <div class="gasto-camp-title">Campaña ${escapeHtml(campaign.label)}<em>${fmtPercent(campaign.share)} de la inversión</em>${statusPill(campaign.status)}</div>
            <div class="panel-sub">${escapeHtml(campaign.name)} | ${escapeHtml(`${period.label} ${period.year}`)}${escapeHtml(comparison)}</div>
          </div>
          <div class="gasto-camp-controls">
            <div class="gasto-chips" data-camp-modes role="radiogroup" aria-label="Vista del gráfico de ${escapeHtml(campaign.label)}"></div>
            <button type="button" class="gasto-camp-toggle" data-camp-toggle aria-controls="gasto-camp-body-${id}">${CHEVRON}</button>
          </div>
        </div>
        <dl class="gasto-camp-kpis">${kpis}</dl>
        <div class="gasto-camp-body" id="gasto-camp-body-${id}">
          <div class="gasto-chips gasto-camp-metrics" data-camp-metrics role="group" aria-label="Indicadores del gráfico de ${escapeHtml(campaign.label)}"></div>
          <div class="chart-wrap h-300"><canvas id="chart-gasto-${id}" role="img" aria-label="Gráfico de la campaña ${escapeHtml(campaign.label)}"></canvas></div>
          <div class="gasto-legend" data-camp-legend></div>
          ${campaignKeywordsHtml(period, campaign)}
        </div>
      </section>`;
  }

  // Chips de un grafico: radio para la vista, casillas para los indicadores (selected es entonces una lista).
  function chipsHtml(items, selected, name, multiple = false) {
    return items.map(item => {
      const on = multiple ? selected.includes(item.key) : item.key === selected;
      return `<label class="gasto-chip${on ? ' active' : ''}"><input type="${multiple ? 'checkbox' : 'radio'}" name="${escapeHtml(name)}" value="${escapeHtml(item.key)}"${on ? ' checked' : ''}>${escapeHtml(item.label)}</label>`;
    }).join('');
  }

  // ── Graficos de cada campana ──
  // Un mes sin informe o en que la campana no corrio queda como hueco. Un cociente sale de las sumas del mes
  // (el mismo costo por conversion del KPI de la campana).
  function monthlyValue(month, metric, key) {
    if (!month || !month.hasData) return null;
    const campaign = month.campaigns.find(item => item.key === key);
    if (!campaign || !isActive(campaign)) return null;
    const value = metric.ratio ? derive(campaign)[metric.key] : campaign[metric.key];
    return isNum(value) ? Number(value) : null;
  }

  // Valores por dia del informe por dia (indice 0 = dia 1). Fuera de los dias que cubre quedan en null.
  function dailyValues(month, field, key) {
    const values = Array.from({ length: month.daysInMonth }, (_, index) => (index + 1 >= month.detailFirst && index + 1 <= month.detailLast ? 0 : null));
    month.detail.forEach(row => { if (row.campaignKey === key && values[row.d - 1] !== null && values[row.d - 1] !== undefined) values[row.d - 1] += row[field]; });
    return values;
  }
  // Un indicador por dia: su campo o, si es cociente, el de las dos sumas del dia (un dia sin conversiones, hueco).
  const inDaily = metric => (metric.ratio ? metric.ratio.every(field => DETAIL_SUMS.includes(field)) : Boolean(metric.daily));
  function metricDaily(month, metric, key) {
    if (!metric.ratio) return dailyValues(month, metric.daily, key);
    const [top, bottom] = metric.ratio.map(field => dailyValues(month, field, key));
    return top.map((value, index) => ratio(value, bottom[index]));
  }

  // Por mes: los 12 meses del ano. Por dia: el mes contra el mes anterior en el mismo dia. compare = false deja
  // solo el mes elegido (varios indicadores a la vez); color, el de la linea (uno por indicador en un solo cuadro).
  // Cada punto lleva su valor (valueLabels); el mes del periodo va resaltado.
  function lineSeries(metric, modeKey, period, key, compare = true, color = CHART_COLOR) {
    if (modeKey === 'monthly') {
      const year = viewYear();
      const data = MONTH_NAMES.map((_, index) => monthlyValue(gastoMonthByKey(monthKeyOf(year, index + 1)), metric, key));
      const withValue = data.map((value, index) => (value === null ? -1 : index)).filter(index => index >= 0);
      const marked = period.annual ? withValue[withValue.length - 1] : period.month.month - 1;
      return {
        labels: SHORT_NAMES,
        datasets: [{
          label: metric.label, unit: metric.unit, data, valueLabels: true,
          borderColor: color, backgroundColor: 'rgba(37,99,235,.10)', fill: true, borderWidth: 2, tension: 0.25, spanGaps: false,
          pointRadius: data.map((_, index) => (index === marked ? 6 : 4)), pointHoverRadius: 7,
          pointBackgroundColor: data.map((_, index) => (index === marked ? color : '#fff')), pointBorderColor: color, pointBorderWidth: 2
        }],
        legend: [`<span><i class="legend-line" style="background:${CHART_COLOR}"></i><b>${escapeHtml(metric.label)} por mes, ${year}</b></span>`]
      };
    }
    const month = period.month;
    const values = metricDaily(month, metric, key);
    const series = {
      labels: Array.from({ length: month.daysInMonth }, (_, index) => `${index + 1}`),
      datasets: [{
        label: compare ? month.name : metric.label, unit: metric.unit, data: values, valueLabels: true,
        borderColor: color, fill: false, borderWidth: 2, tension: 0.2, spanGaps: false,
        pointRadius: values.map(value => (value === null ? 0 : 2)), pointHoverRadius: 4, pointBackgroundColor: color, pointBorderColor: color
      }],
      legend: [`<span><i class="legend-line" style="background:${CHART_COLOR}"></i><b>${escapeHtml(month.name)} ${month.year} · informe por día</b></span>`]
    };
    const previous = gastoMonthByKey(previousKey(month));
    if (compare && previous && previous.detail) {
      const previousValues = metricDaily(previous, metric, key).slice(0, month.daysInMonth);
      if (previousValues.some(value => value)) {
        series.datasets.push({ label: previous.name, unit: metric.unit, data: previousValues, borderColor: PREVIOUS_COLOR, borderDash: [6, 5], fill: false, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.2 });
        series.legend.push(`<span><i class="legend-line gasto-legend-dashed" style="color:${PREVIOUS_COLOR}"></i><b>${escapeHtml(previous.name)} (mismo día del mes)</b></span>`);
      }
    }
    return series;
  }

  // Un indicador: su linea (contra el mes anterior en la vista diaria). Varios: uno por panel apilado, cada uno
  // con su escala sobre el mismo eje x, o, con combined, todos en un solo cuadro con un color cada uno.
  function campaignSeries(metrics, modeKey, period, key, combined = false) {
    if (metrics.length === 1) return lineSeries(metrics[0], modeKey, period, key);
    const parts = metrics.map(metric => lineSeries(metric, modeKey, period, key, false, combined ? metric.color : CHART_COLOR));
    const datasets = parts.map((part, index) => Object.assign({}, part.datasets[0], { label: metrics[index].label, yAxisID: `y${index}` },
      // En un solo cuadro sin relleno (se taparian) y cada valor con el color de su linea.
      combined ? { fill: false, labelColor: metrics[index].color } : {}));
    if (combined) {
      const what = modeKey === 'monthly' ? `Por mes, ${viewYear()}` : `Por día, ${period.month.name} ${period.month.year} (informe por día)`;
      return {
        labels: parts[0].labels,
        datasets,
        legend: metrics.map(metric => `<span><i class="legend-line" style="background:${metric.color}"></i><b>${escapeHtml(metric.label)}</b></span>`)
          .concat(`<span>${escapeHtml(what)}. Cada indicador con su escala: compara la forma y lee el valor en el punto.</span>`)
      };
    }
    const what = modeKey === 'monthly' ? `${metrics.length} indicadores por mes, ${viewYear()}` : `${period.month.name} ${period.month.year} · informe por día`;
    return {
      labels: parts[0].labels,
      datasets,
      legend: [`<span><i class="legend-line" style="background:${CHART_COLOR}"></i><b>${escapeHtml(what)}</b></span>`, '<span>Cada indicador con su escala.</span>']
    };
  }

  const tickValue = (unit, value) => (unit === 'money'
    ? `S/. ${Number(value).toLocaleString('es-PE', { maximumFractionDigits: 0 })}`
    : Number(value).toLocaleString('es-PE', { notation: Math.abs(value) >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }));

  // Con un indicador hay un solo eje y; con varios, un eje por indicador apilado en vertical (paneles con su
  // escala) sobre el mismo eje x. Nunca dos escalas superpuestas: los cruces entre lineas no significarian nada.
  // En un solo cuadro (combined) cada indicador tiene su escala sin eje visible: dos escalas a la vista sobre las
  // mismas lineas confunden, y el valor ya va en cada punto.
  function yScales(metrics, combined = false) {
    const base = unit => ({ beginAtZero: true, border: { display: false }, ticks: { color: AXIS_COLOR, font: { size: 10 }, callback: value => tickValue(unit, value) } });
    if (metrics.length === 1) return { y: Object.assign(base(metrics[0].unit), { grace: '12%', grid: { color: GRID_COLOR } }) };
    if (combined) return Object.fromEntries(metrics.map((metric, index) => [`y${index}`, { display: false, beginAtZero: true, grace: '18%' }]));
    // Chart.js apila de abajo hacia arriba en el orden de los ejes: se dan al reves para que el primero quede arriba.
    return Object.fromEntries(metrics.map((metric, index) => [`y${index}`, Object.assign(base(metric.unit), {
      stack: 'metrics',
      stackWeight: 1,
      grace: '25%',
      // El tope de cada panel cae sobre el cero del panel de arriba: se omite para que no se encimen.
      ticks: Object.assign(base(metric.unit).ticks, { maxTicksLimit: 5, callback: (value, tickIndex, ticks) => (index > 0 && tickIndex === ticks.length - 1 ? '' : tickValue(metric.unit, value)) }),
      // La linea del cero marca el piso de cada panel.
      grid: { color: ctx => (ctx.tick && ctx.tick.value === 0 ? '#cbd5e1' : GRID_COLOR) },
      panelLabel: metric.label
    })]).reverse());
  }

  const CHART_PLUGINS = [{
    // Valor en cada punto (valueLabels: true), menos los ceros (el punto ya esta en la base). Va arriba en un
    // pico y abajo en un valle, para no montarse en la linea; si choca con otra etiqueta o se sale de su panel
    // prueba el otro lado y, si tampoco cabe, se omite (queda en el tooltip).
    id: 'gastoValueLabels',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      const placed = [];
      const overlaps = box => placed.some(other => !(box.right < other.left || box.left > other.right || box.bottom < other.top || box.top > other.bottom));
      ctx.save();
      // Los nombres de los paneles (gastoPanelLabels) tambien ocupan lugar.
      ctx.font = '600 11px Inter, sans-serif';
      Object.values(chart.scales).forEach(scaleItem => {
        if (!scaleItem.options.panelLabel) return;
        const left = chart.chartArea.left + 4;
        placed.push({ left, right: left + ctx.measureText(scaleItem.options.panelLabel).width + 8, top: scaleItem.top + 2, bottom: scaleItem.top + 18 });
      });
      ctx.font = '600 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,.92)';
      chart.data.datasets.forEach((dataset, datasetIndex) => {
        if (dataset.valueLabels !== true) return;
        const meta = chart.getDatasetMeta(datasetIndex);
        const scale = chart.scales[meta.yAxisID];
        // Solo el panel de arriba puede usar el margen superior del grafico.
        const top = scale.top <= chart.chartArea.top + 1 ? chart.chartArea.top - 22 : scale.top;
        ctx.fillStyle = dataset.labelColor || '#334155';
        meta.data.forEach((point, index) => {
          const value = dataset.data[index];
          if (value === null || value === undefined || Number(value) === 0) return;
          // Soles sin decimales, salvo montos chicos (S/. 0.40 no debe leerse S/. 0).
          const text = dataset.unit === 'money' && Math.abs(value) >= 10 ? tickValue('money', Math.round(value)) : formatValue(value, dataset.unit);
          const half = ctx.measureText(text).width / 2 + 2;
          const before = dataset.data[index - 1];
          const after = dataset.data[index + 1];
          const valley = isNum(before) && isNum(after) && value < before && value < after;
          const sides = valley ? [point.y + 13, point.y - 12] : [point.y - 12, point.y + 13];
          // Pegada al borde, la etiqueta se corre hacia adentro para no cortarse.
          const x = Math.min(Math.max(point.x, half), chart.width - half);
          const box = sides
            .map(y => ({ y, left: x - half, right: x + half, top: y - 6, bottom: y + 6 }))
            .find(item => item.top >= top && item.bottom <= scale.bottom && !overlaps(item));
          if (!box) return;
          placed.push(box);
          ctx.strokeText(text, x, box.y);
          ctx.fillText(text, x, box.y);
        });
      });
      ctx.restore();
    }
  }, {
    // Nombre de cada panel arriba a la izquierda (solo con varios indicadores).
    id: 'gastoPanelLabels',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textBaseline = 'top';
      Object.values(chart.scales).forEach(scale => {
        const label = scale.options.panelLabel;
        if (!label) return;
        const x = chart.chartArea.left + 8;
        const y = scale.top + 4;
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.fillRect(x - 4, y - 2, ctx.measureText(label).width + 8, 16);
        ctx.fillStyle = '#475569';
        ctx.fillText(label, x, y);
      });
      ctx.restore();
    }
  }, {
    // Linea vertical en el punto del tooltip, a lo alto de todos los paneles.
    id: 'gastoCrosshair',
    afterDatasetsDraw(chart) {
      const active = (chart.tooltip && chart.tooltip.getActiveElements()) || [];
      if (!active.length) return;
      const x = active[0].element.x;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, chart.chartArea.top);
      ctx.lineTo(x, chart.chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    }
  }];

  function destroyCampaignChart(id) {
    const chart = gasto.charts.get(id);
    if (chart) chart.destroy();
    gasto.charts.delete(id);
  }

  function drawCampaignChart(canvas, series, metrics, modeKey, combined = false) {
    if (typeof Chart === 'undefined') {
      canvas.parentElement.innerHTML = '<div class="empty-state"><strong>Gráfico no disponible sin conexión.</strong><span>Los KPIs y las tablas siguen visibles.</span></div>';
      return;
    }
    const year = viewYear();
    gasto.charts.set(canvas.id, new Chart(canvas, {
      type: 'line',
      data: { labels: series.labels, datasets: series.datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 24, right: 12, left: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: item => item.raw !== null && item.raw !== undefined,
            callbacks: {
              title: items => (modeKey === 'monthly' ? `${MONTH_NAMES[items[0].dataIndex]} ${year}` : `Día ${items[0].label}`),
              label: context => ` ${context.dataset.label}: ${formatValue(context.raw, context.dataset.unit)}`
            }
          }
        },
        scales: Object.assign({
          x: { grid: { display: false }, border: { color: '#cbd5e1' }, ticks: { color: AXIS_COLOR, font: { size: 10 }, autoSkip: true, maxTicksLimit: modeKey === 'monthly' ? 12 : 16 } }
        }, yScales(metrics, combined))
      },
      plugins: CHART_PLUGINS
    }));
  }

  // Los controles del cuadro lo redibujan solo con la clave; renderCampaigns le pasa el periodo y sus campanas.
  function renderCampaignChart(key, period = currentPeriod(), campaigns = null) {
    const block = campaignBlock(key);
    const list = campaigns || (period ? periodCampaigns(period) : []);
    const campaign = list.find(item => item.key === key);
    if (!block || !campaign) return;
    const settings = campaignSettings(key);
    const daily = hasCampaignDaily(period, key);
    const modes = daily ? MODES : MODES.filter(mode => mode.key === 'monthly');
    const modeKey = daily && modes.some(mode => mode.key === settings.mode) ? settings.mode : 'monthly';
    // El informe por dia no trae impresiones: ese indicador solo aparece por mes. El costo por conversion por dia,
    // solo si algun dia tuvo conversiones (si no, seria un grafico vacio).
    const metrics = CAMPAIGN_METRICS.filter(metric => modeKey === 'monthly'
      || (inDaily(metric) && (!metric.ratio || metricDaily(period.month, metric, key).some(value => value !== null))));
    let selected = metrics.filter(metric => settings.metrics.includes(metric.key));
    if (!selected.length) selected = metrics.filter(metric => DEFAULT_METRICS.includes(metric.key));
    if (!selected.length) selected = metrics.slice(0, 1);
    const toggle = block.querySelector('[data-camp-toggle]');
    block.classList.toggle('is-collapsed', settings.collapsed);
    toggle.setAttribute('aria-expanded', String(!settings.collapsed));
    toggle.title = `${settings.collapsed ? 'Expandir' : 'Minimizar'} la campaña ${campaign.label}`;
    toggle.setAttribute('aria-label', toggle.title);
    const modesHost = block.querySelector('[data-camp-modes]');
    const metricsHost = block.querySelector('[data-camp-metrics]');
    const id = slug(key);
    keepFocus(modesHost, () => { modesHost.innerHTML = chipsHtml(modes, modeKey, `gasto-mode-${id}`); });
    const combined = settings.combined && selected.length > 1;
    // El boton de un solo cuadro aparece con dos o mas indicadores marcados.
    const combineButton = selected.length > 1
      ? `<button type="button" class="gasto-chip gasto-combine${combined ? ' active' : ''}" data-camp-combine aria-pressed="${combined}" title="${combined ? 'Volver a un panel por indicador' : 'Juntar los indicadores en un solo cuadro'}">Un solo cuadro</button>`
      : '';
    keepFocus(metricsHost, () => { metricsHost.innerHTML = chipsHtml(metrics, selected.map(metric => metric.key), `gasto-metric-${id}`, true) + combineButton; });
    const canvas = block.querySelector('canvas');
    if (!canvas) return;
    destroyCampaignChart(canvas.id);
    if (settings.collapsed) return;
    const series = campaignSeries(selected, modeKey, period, key, combined);
    // Cada panel extra suma alto para que ninguno quede aplastado; en un solo cuadro, algo mas de alto para las etiquetas.
    canvas.parentElement.style.height = combined ? '380px' : selected.length > 1 ? `${90 + 135 * selected.length}px` : '';
    block.querySelector('[data-camp-legend]').innerHTML = series.legend.join('');
    drawCampaignChart(canvas, series, selected, modeKey, combined);
  }

  function destroyCampaignCharts() {
    [...gasto.charts.keys()].forEach(destroyCampaignChart);
  }

  function renderCampaigns(period, campaigns) {
    const host = document.getElementById('gasto-blocks');
    destroyCampaignCharts();
    host.innerHTML = campaigns.map(campaign => campaignHtml(period, campaign, previousCampaign(period, campaign.key))).join('');
    campaigns.forEach(campaign => renderCampaignChart(campaign.key, period, campaigns));
  }

  // ── Ranking de palabras clave del periodo ──
  function kwFolderName() {
    const config = window.AQUARIUS_DRIVE_CONFIG || gasto.config || {};
    return (config.keywords && config.keywords.folderName) || 'Google Ads Aquarius Keywords';
  }

  function renderRanking(period, campaigns) {
    const panel = document.getElementById('gasto-kw-panel');
    const body = document.getElementById('gasto-kw-body');
    const select = document.getElementById('gasto-kw-campaign');
    const sub = document.getElementById('gasto-kw-sub');
    if (!panel || !body) return;
    const { compare, reason } = gasto.kwStatus === 'ok' ? keywordCompare(period) : { compare: null, reason: null };
    panel.classList.toggle('no-compare', !compare);
    document.getElementById('gasto-kw-title').textContent = `Ranking de palabras clave | ${period.label} ${period.year}`;
    document.getElementById('gasto-kw-prev-head').textContent = compare ? `Conversiones ${compare.label}` : 'Mes anterior';
    const empty = text => {
      sub.textContent = '';
      select.innerHTML = '<option value="all">Todas las campañas</option>';
      body.innerHTML = `<tr><td class="table-empty" colspan="11">${text}</td></tr>`;
    };
    if (gasto.kwStatus === 'loading') { empty('Cargando palabras clave...'); return; }
    if (gasto.kwStatus === 'error') { empty('No se pudo leer el informe de palabras clave.'); return; }
    const scope = keywordScope(period);
    if (!scope.months.length) {
      empty(`${period.annual ? 'Ningún mes del periodo tiene' : `${escapeHtml(period.month.label)} no tiene`} informe de palabras clave. Súbelo a la carpeta ${escapeHtml(kwFolderName())} de Drive.`);
      return;
    }
    const order = new Map(campaigns.map((campaign, index) => [campaign.key, index]));
    const previous = new Map(compare ? keywordRows([compare.month]).map(row => [row.id, row]) : []);
    const all = keywordRows(scope.months).filter(isActive);
    // Las campanas que no estan en el informe de campana van al final, por su inversion en palabras clave.
    const kwCost = new Map();
    all.forEach(row => kwCost.set(row.campaignKey, (kwCost.get(row.campaignKey) || 0) + row.cost));
    const rank = key => (order.has(key) ? order.get(key) : campaigns.length + 1 / (1 + (kwCost.get(key) || 0)));
    all.sort((a, b) => rank(a.campaignKey) - rank(b.campaignKey) || b.conversions - a.conversions || b.cost - a.cost);
    const leaders = new Set();
    all.forEach(row => { if (row.conversions > 0 && !leaders.has(row.campaignKey)) { leaders.add(row.campaignKey); row.leader = true; } });
    const present = [...new Set(all.map(row => row.campaignKey))];
    if (gasto.kwFilter !== 'all' && !present.includes(gasto.kwFilter)) gasto.kwFilter = 'all';
    select.innerHTML = ['<option value="all">Todas las campañas</option>']
      .concat(present.map(key => {
        const row = all.find(item => item.campaignKey === key);
        return `<option value="${escapeHtml(key)}"${key === gasto.kwFilter ? ' selected' : ''}>${escapeHtml(campaignLabel(row.campaign))}</option>`;
      })).join('');
    const rows = gasto.kwFilter === 'all' ? all : all.filter(row => row.campaignKey === gasto.kwFilter);
    sub.textContent = `${rows.length} ${rows.length === 1 ? 'palabra clave ordenada' : 'palabras clave ordenadas'} por conversiones dentro de cada campaña, del informe de palabras clave de ${scope.label}. La estrella marca a la líder de cada campaña.${compare ? '' : reason ? ` ${reason}` : ''}`;
    body.innerHTML = rows.map(row => {
      const before = previous.get(row.id);
      return `
        <tr>
          <td class="gasto-rank-campaign" title="${escapeHtml(row.campaign)}"><span>${escapeHtml(campaignLabel(row.campaign))}</span></td>
          <td class="gasto-rank-keyword" title="${escapeHtml(`${row.keyword} (${row.matchType || 'Sin concordancia'})`)}"><span>${row.leader ? '<b class="gasto-leader" title="Líder de la campaña">★</b> ' : ''}${escapeHtml(row.keyword)}</span><small>${escapeHtml(row.matchType || 'Sin concordancia')}</small></td>
          <td class="num gasto-strong">${fmtDecimal(row.conversions)}</td>
          <td class="num">${before ? fmtDecimal(before.conversions) : '<span class="no-data">—</span>'}</td>
          <td class="num">${compare ? variationCell(row.conversions, before ? before.conversions : null) : '<span class="no-data">—</span>'}</td>
          <td class="num">${fmtMoney(row.costPerConversion)}</td>
          <td class="num">${fmtMoney(row.cost)}</td>
          <td class="num">${fmtCount(row.impressions)}</td>
          <td class="num">${fmtCount(row.clicks)}</td>
          <td class="num">${fmtPercent(row.ctr)}</td>
          <td class="num">${fmtMoney(row.cpc)}</td>
        </tr>`;
    }).join('') || '<tr><td class="table-empty" colspan="11">No hay palabras clave de esta campaña en el periodo.</td></tr>';
  }

  // ── Herramientas del ranking: compacto y pantalla completa ──
  function applyCompact() {
    const panel = document.getElementById('gasto-kw-panel');
    const button = document.getElementById('gasto-kw-density');
    if (!panel || !button) return;
    panel.classList.toggle('is-compact', gasto.compact);
    button.setAttribute('aria-pressed', String(gasto.compact));
    button.textContent = gasto.compact ? 'Cómodo' : 'Compacto';
    button.title = gasto.compact ? 'Volver a filas amplias' : 'Reducir el alto de las filas';
  }
  function toggleCompact() {
    gasto.compact = !gasto.compact;
    saveSetting(KW_COMPACT_KEY, gasto.compact);
    applyCompact();
  }

  function toggleFullscreen(force) {
    const panel = document.getElementById('gasto-kw-panel');
    const button = document.getElementById('gasto-kw-expand');
    const tabs = document.getElementById('month-tabs');
    if (!panel || !button || !tabs) return;
    const next = force === undefined ? !gasto.fullscreen : Boolean(force);
    if (next === gasto.fullscreen) return;
    gasto.fullscreen = next;
    const scroll = panel.querySelector('.gasto-rank-scroll');
    panel.classList.toggle('is-fullscreen', next);
    document.body.classList.toggle('gasto-table-fullscreen', next);
    // Las pestanas de mes viajan al panel para poder cambiar de mes sin salir.
    if (next) {
      gasto.tabsHome = { parent: tabs.parentNode, next: tabs.nextSibling };
      panel.insertBefore(tabs, scroll);
    } else if (gasto.tabsHome) {
      gasto.tabsHome.parent.insertBefore(tabs, gasto.tabsHome.next);
      gasto.tabsHome = null;
    }
    button.setAttribute('aria-pressed', String(next));
    button.textContent = next ? '✕ Salir' : '⤢ Pantalla completa';
    button.title = next ? 'Salir de pantalla completa (Esc)' : 'Ver la tabla en pantalla completa (Esc para salir)';
    if (next) scroll.focus();
  }

  function openKeywordsView() {
    toggleFullscreen(false);
    const button = document.querySelector('.s-item[data-view-target="view-keywords"]');
    if (button) button.click();
    window.scrollTo(0, 0);
  }

  // ── Render ──
  function selectTab(value) {
    if (value === YEAR_KEY) {
      state.annual = true;
      storeMonth(YEAR_KEY);
    } else {
      state.annual = false;
      selectMonth(value);
    }
    renderAll();
  }

  function renderGasto() {
    const period = currentPeriod();
    renderTabs(period);
    renderAlerts(period);
    if (!period) {
      document.getElementById('gasto-period-title').textContent = 'Sin informes de campaña';
      document.getElementById('gasto-period-sub').textContent = `Sube el CSV del mes a la carpeta ${folderName()} de Drive y sincroniza.`;
      document.getElementById('kpi-strip').innerHTML = '';
      document.getElementById('gasto-dist-body').innerHTML = '<tr><td class="table-empty" colspan="12">Sin resultados para mostrar.</td></tr>';
      destroyCampaignCharts();
      document.getElementById('gasto-blocks').innerHTML = '';
      document.getElementById('gasto-kw-body').innerHTML = '<tr><td class="table-empty" colspan="11">Sin resultados para mostrar.</td></tr>';
      return;
    }
    const campaigns = periodCampaigns(period);
    renderPeriod(period);
    renderDistribution(period, campaigns);
    renderCampaigns(period, campaigns);
    renderRanking(period, campaigns);
  }

  // Las palabras clave llegan aparte: el informe de campana se pinta sin esperarlas.
  async function loadKeywords() {
    const fetchJson = async url => {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${url} (HTTP ${response.status})`);
      return response.json();
    };
    try {
      const [data, config] = await Promise.all([
        window.AQUARIUS_KEYWORDS_DATA || fetchJson(KEYWORDS_URL),
        window.AQUARIUS_DRIVE_CONFIG && window.AQUARIUS_DRIVE_CONFIG.keywords ? window.AQUARIUS_DRIVE_CONFIG : fetchJson(CONFIG_URL).catch(() => ({}))
      ]);
      gasto.config = config || {};
      gasto.kwMonths = buildKeywordMonths(data, gasto.config);
      gasto.kwSync = (data && data.drive && data.drive.lastSync) || null;
      gasto.kwStatus = 'ok';
    } catch (error) {
      gasto.kwStatus = 'error';
      console.error('[gasto] palabras clave', error);
    }
    renderStatusCard();
    if (state.data && gasto.months.length) renderGasto();
    // Generacion de Reporte arma su pagina de palabras clave con estos meses: se repinta al llegar.
    window.dispatchEvent(new CustomEvent('aquarius:keywords-ready'));
  }

  function updateSourceLabels() {
    // La barra superior y el pie son de la vista activa: con otra vista abierta no se pisan.
    if (!document.getElementById('view-obj').classList.contains('visible')) return;
    const period = currentPeriod();
    const label = period ? (period.annual ? `Anual ${period.year}` : period.month.label) : null;
    const count = period ? periodCampaigns(period).length : 0;
    const status = document.getElementById('topbar-status');
    const source = document.getElementById('footer-source');
    const footerStatus = document.getElementById('footer-status');
    const caption = document.getElementById('topbar-caption');
    if (status) status.textContent = syncPillLabel();
    if (source) source.textContent = `Fuente: ${DATA_URL} (Drive: ${folderName()})`;
    if (footerStatus) footerStatus.textContent = label ? `Periodo ${label} | ${count} ${count === 1 ? 'campaña' : 'campañas'}` : 'Resultados de pauta digital';
    if (caption) caption.textContent = label ? `Branding y ventas | ${label}` : 'Branding y ventas';
  }

  function renderAll() {
    renderStatusCard();
    renderGasto();
    renderChart();
    updateSourceLabels();
  }

  function renderError(message) {
    document.getElementById('view-obj').innerHTML = `<div class="data-notice error"><strong>No se pudo cargar la tabla de resultados.</strong>${escapeHtml(message)}</div>`;
  }

  // Eventos por delegacion en la vista: tablas, cuadros y pestanas se repintan.
  function wireEvents() {
    const view = document.getElementById('view-obj');
    if (!view) return;
    view.addEventListener('click', event => {
      const tab = event.target.closest('#month-tabs .month-tab:not(:disabled)');
      if (tab) {
        const value = tab.dataset.month;
        if ((value === YEAR_KEY && state.annual) || (value === state.monthId && !state.annual)) return;
        selectTab(value);
        return;
      }
      const toggle = event.target.closest('[data-camp-toggle]');
      if (toggle) {
        const key = toggle.closest('.gasto-camp-block').dataset.campaign;
        saveCampaignSettings(key, { collapsed: !campaignSettings(key).collapsed });
        renderCampaignChart(key);
        return;
      }
      const combine = event.target.closest('[data-camp-combine]');
      if (combine) {
        const key = combine.closest('.gasto-camp-block').dataset.campaign;
        saveCampaignSettings(key, { combined: !campaignSettings(key).combined });
        renderCampaignChart(key);
        return;
      }
      if (event.target.closest('#gasto-kw-density')) { toggleCompact(); return; }
      if (event.target.closest('#gasto-kw-expand')) { toggleFullscreen(); return; }
      if (event.target.closest('#gasto-kw-more')) openKeywordsView();
    });
    view.addEventListener('change', event => {
      if (event.target.id === 'gasto-kw-campaign') {
        gasto.kwFilter = event.target.value;
        const period = currentPeriod();
        if (period) renderRanking(period, periodCampaigns(period));
        return;
      }
      const input = event.target.closest('.gasto-camp-block input');
      if (!input) return;
      const block = input.closest('.gasto-camp-block');
      const key = block.dataset.campaign;
      if (input.closest('[data-camp-modes]')) {
        saveCampaignSettings(key, { mode: input.value });
      } else {
        // Siempre queda al menos un indicador: desmarcar el ultimo lo deja como estaba.
        const checked = [...block.querySelectorAll('[data-camp-metrics] input:checked')].map(item => item.value);
        if (checked.length) saveCampaignSettings(key, { metrics: checked });
      }
      renderCampaignChart(key);
    });
    // Esc y el cambio de modulo cierran la pantalla completa (con el panel fijo la pagina quedaria bloqueada).
    document.addEventListener('keydown', event => { if (event.key === 'Escape') toggleFullscreen(false); });
    document.querySelectorAll('.s-item').forEach(button => button.addEventListener('click', () => toggleFullscreen(false)));
    applyCompact();
  }

  async function init() {
    try {
      wireStatusCard();
      wireEvents();
      loadKeywords();
      state.data = window.AQUARIUS_RETAIL_DATA;
      if (!state.data) {
        const response = await fetch(DATA_URL, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        state.data = await response.json();
      }
      state.months = normalizeMonths(state.data);
      if (!state.months.length) throw new Error('La fuente no contiene meses con datos.');
      window.AQUARIUS_RETAIL_DATA = state.data;
      buildGastoMonths();
      // El mes elegido se guarda en aquarius_selected_month; 'anual' es la pestana Anual.
      const stored = readStoredMonth();
      state.annual = stored === YEAR_KEY;
      const initialMonth = state.months.some(month => month.id === stored)
        ? stored
        : (state.data.defaultMonth || state.months[state.months.length - 1].id);
      selectMonth(initialMonth, false);
      state.chartView = normalizeView(readStoredView());
      renderAll();
      loadLastSweep(true);
      window.dispatchEvent(new CustomEvent('aquarius:data-ready', { detail: state.data }));
    } catch (error) {
      renderError(error.message);
      console.error(error);
    }
  }

  // Corte de un mes: fin del rango del informe de Google Ads o, sin rango, el ultimo dia del mes.
  // Nunca es posterior a hoy en Lima (UTC-5 todo el ano): un informe de "este mes" puede traer el mes
  // completo. No se usa la fecha de sincronizacion porque un CSV importado a mano no la actualiza.
  function monthCutoff(month) {
    const [year, number] = month.id.split('-').map(Number);
    const end = month.period && /^\d{4}-\d{2}-\d{2}$/.test(month.period.end)
      ? month.period.end
      : `${month.id}-${String(new Date(year, number, 0).getDate()).padStart(2, '0')}`;
    const today = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
    return today < end ? today : end;
  }

  // Snapshot de solo lectura para los modulos que dependen de estos datos (Proyecciones).
  function snapshot() {
    if (!state.data) return null;
    const months = state.months.filter(month => /^\d{4}-\d{2}$/.test(month.id) && monthTotals(month).hasData);
    const latest = months[months.length - 1];
    return {
      cutoff: latest ? monthCutoff(latest) : null,
      source: (latest && latest.sourceFile) || DATA_URL,
      year: latest ? Number(latest.id.slice(0, 4)) : null,
      lastSync: (state.data.drive && state.data.drive.lastSync) || null,
      months: months.map(month => {
        const totals = monthTotals(month);
        const [year, number] = month.id.split('-').map(Number);
        return {
          id: month.id,
          name: MONTH_NAMES[number - 1],
          label: month.label,
          cost: totals.cost,
          clicks: totals.clicks,
          conversions: totals.conversions,
          impressions: totals.impressions,
          dailyBudget: month.dailyBudget,
          // Google Ads fija presupuestos diarios: el del mes es el diario vigente por los dias del mes.
          budgetTotal: month.dailyBudget ? month.dailyBudget * new Date(year, number, 0).getDate() : null,
          period: month.period ? Object.assign({}, month.period) : null,
          campaigns: month.records.map(record => Object.assign({ label: campaignLabel(record.campaign) }, record))
        };
      })
    };
  }

  // Generacion de Reporte arma el PDF del mes con los mismos calculos de Gasto Publicitario: periodo y
  // comparacion (mes anterior prorrateado), totales, campanas y palabras clave del mes.
  window.AquariusGasto = {
    months: () => gasto.months.filter(month => month.hasData),
    period: key => periodOf(gastoMonthByKey(key)),
    totals: periodTotals,
    previous: previousTotals,
    campaigns: periodCampaigns,
    keywords: period => (gasto.kwMonths && gasto.kwMonths.size ? keywordRows(keywordScope(period).months) : null),
    keywordLabel: period => (gasto.kwMonths && gasto.kwMonths.size ? keywordScope(period).label : ''),
    campaignLabel
  };

  // Interfaz publica del modulo: drive-sync.js la usa para pintar la data que
  // acaba de traer de Drive sin recargar la pagina.
  window.AquariusDashboard = {
    getData: () => state.data,
    applyData(data) {
      const months = normalizeMonths(data);
      if (!months.length) throw new Error('La data sincronizada no trae meses.');
      state.data = data;
      state.months = months;
      window.AQUARIUS_RETAIL_DATA = data;
      buildGastoMonths();
      const keep = state.months.some(month => month.id === state.monthId) ? state.monthId : (data.defaultMonth || months[months.length - 1].id);
      selectMonth(keep, false);
      renderAll();
      window.dispatchEvent(new CustomEvent('aquarius:data-ready', { detail: data }));
    },
    render: renderAll,
    snapshot
  };

  // Los botones de vista viven en el encabezado del panel, que no se repinta.
  document.addEventListener('click', event => {
    const button = event.target.closest && event.target.closest('[data-chart-view]');
    if (button && button.dataset.chartView !== state.chartView) setChartView(button.dataset.chartView);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
