(function () {
  const DATA_URL = 'data/aquarius-lima-retail-2026.json';
  const MONTH_STORAGE_KEY = 'aquarius_selected_month';
  const VIEW_STORAGE_KEY = 'aquarius_chart_view';
  // Series del grafico principal: un punto por mes, lineas en el tiempo.
  const MONTHLY = {
    cost: { label: 'Inversion', unit: 'money', color: '#0284c7', fill: 'rgba(2,132,199,.12)', axis: 'y' },
    conversions: { label: 'Resultados', unit: 'count', color: '#7c3aed', fill: 'rgba(124,58,237,.12)', axis: 'y1' },
    costPerConversion: { label: 'Costo x resultado', unit: 'money', color: '#0f766e', fill: 'rgba(15,118,110,.12)', axis: 'y2', dashed: true },
    impressions: { label: 'Impresiones', unit: 'count', color: '#f59e0b', fill: 'rgba(245,158,11,.12)', axis: 'y3' }
  };
  const MONTHLY_ORDER = ['cost', 'conversions', 'costPerConversion', 'impressions'];
  // Series de la evolucion diaria dentro del mes.
  const DAILY = {
    cost: { label: 'Inversion', unit: 'money', color: '#0284c7', axis: 'y' },
    conversions: { label: 'Resultados', unit: 'count', color: '#7c3aed', axis: 'y1' },
    costPerConversion: { label: 'Costo x resultado', unit: 'money', color: '#0f766e', axis: 'y2', dashed: true },
    impressions: { label: 'Impresiones', unit: 'count', color: '#f59e0b', axis: 'y3' }
  };
  const DAILY_ORDER = ['cost', 'conversions', 'costPerConversion', 'impressions'];
  const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const CAMPAIGN_NAMES = {
    DIGITALIZACIONDEDCOUMENTOS: 'Digitalizacion de documentos',
    GESTIONLOGISTICA: 'Gestion logistica',
    VALUACIONESCOMERCIALES: 'Valuaciones comerciales',
    FOTOGRAMETRIACONDRONES: 'Fotogrametria con drones',
    FOTOGRAMETRÍACONDRONES: 'Fotogrametria con drones',
    ALMACENAMIENTO: 'Almacenamiento',
    ACTIVOSFIJOS: 'Activos fijos',
    PRODUCTOSTI: 'Productos TI',
    OUTSOURCINGDEALMACENES: 'Outsourcing de almacenes'
  };
  const state = { data: null, months: [], monthId: null, rows: [], daily: [], chartView: 'month', chart: null };

  const fmtMoney = value => Number.isFinite(Number(value)) ? `S/ ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-';
  const fmtCount = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('es-PE', { maximumFractionDigits: 0 }) : '-';
  const fmtPercent = value => Number.isFinite(Number(value)) ? `${(Number(value) * 100).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : '-';
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
      if (short && Number.isFinite(Number(value)) && Math.abs(Number(value)) >= 1000) return `S/ ${(Number(value) / 1000).toFixed(1)}k`;
      return fmtMoney(value);
    }
    if (unit === 'percent') return fmtPercent(value);
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
    const key = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (CAMPAIGN_NAMES[raw] || CAMPAIGN_NAMES[key]) return CAMPAIGN_NAMES[raw] || CAMPAIGN_NAMES[key];
    return raw
      .replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function sortedRows(metric = 'cost') {
    return [...state.rows].sort((a, b) => Number(b[metric] || 0) - Number(a[metric] || 0));
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

  function dailyHas(field) {
    return state.daily.some(row => isNum(row[field]));
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
          label: month.label || monthLabel(month.id),
          sourceFile: month.sourceFile || null,
          records: Array.isArray(month.records) ? month.records : [],
          totals: month.totals || null,
          daily: dailyRows(month),
          period: month.period || null,
          dailyBudget: isNum(month.dailyBudget) ? Number(month.dailyBudget) : null
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    }
    if (Array.isArray(data.records)) {
      const id = data.month || 'historico';
      return [{
        id,
        label: /^\d{4}-\d{2}$/.test(id) ? monthLabel(id) : 'Historico',
        sourceFile: data.sourceFile || null,
        records: data.records,
        totals: null,
        daily: [],
        period: null,
        dailyBudget: null
      }];
    }
    return [];
  }

  function readStoredView() {
    try {
      return window.localStorage.getItem(VIEW_STORAGE_KEY);
    } catch (error) {
      return null;
    }
  }

  function setChartView(view) {
    state.chartView = view === 'year' ? 'year' : 'month';
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
    state.rows = month.records || [];
    state.daily = month.daily || [];
    if (persist) storeMonth(month.id);
  }

  function currentMonth() {
    return state.months.find(month => month.id === state.monthId) || null;
  }

  // Fecha de la ultima sincronizacion, venga de la fuente publicada o del
  // navegador (drive-sync.js la actualiza al terminar).
  function lastSyncLabel() {
    const drive = (state.data && state.data.drive) || {};
    const stamp = drive.lastSync;
    if (!stamp) return 'Sin sincronizar con Drive';
    const date = new Date(stamp);
    if (Number.isNaN(date.getTime())) return `Datos actualizados: ${stamp}`;
    const fecha = date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
    const hora = date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    return `Datos actualizados: ${fecha}, ${hora}`;
  }

  function renderFilters() {
    const host = document.getElementById('retail-filters');
    if (!host) return;
    const month = currentMonth();
    const options = state.months
      .map(item => `<option value="${escapeHtml(item.id)}"${item.id === state.monthId ? ' selected' : ''}>${escapeHtml(item.label)}</option>`)
      .reverse()
      .join('');
    const source = month && month.sourceFile ? `Fuente: ${month.sourceFile}` : 'Fuente pendiente de cargar';
    host.innerHTML = `
      <label class="retail-filter" for="filter-month">
        <span>Mes</span>
        <select id="filter-month"${state.months.length > 1 ? '' : ' disabled'}>${options}</select>
        <small title="${escapeHtml(source)}">${escapeHtml(source)}</small>
      </label>
      <div class="retail-filter filter-hint">
        <span>Periodos cargados</span>
        <p>${state.months.length} ${state.months.length === 1 ? 'mes disponible' : 'meses disponibles'}. Cada CSV nuevo en Drive se agrega a este filtro.</p>
      </div>
      <div class="retail-filter filter-sync">
        <span>Sincronizacion</span>
        <button class="sync-btn" id="sync-now" type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
          <b>Sincronizar</b>
        </button>
        <small id="sync-status">${escapeHtml(lastSyncLabel())}</small>
      </div>
    `;
    const select = document.getElementById('filter-month');
    if (select) {
      select.addEventListener('change', event => {
        selectMonth(event.target.value);
        renderAll();
      });
    }
  }

  function renderKpis() {
    const host = document.getElementById('kpi-strip');
    const month = currentMonth();
    const totals = month ? monthTotals(month) : null;
    const hasData = !!(totals && totals.hasData);
    const impressions = totals && isNum(totals.impressions) ? Number(totals.impressions) : null;
    const days = state.daily.filter(row => isNum(row.impressions)).length;
    const cards = [
      ['Coste total', hasData ? fmtMoney(totals.cost) : '-', 'Inversion registrada'],
      ['CTR promedio', hasData && isNum(totals.ctr) ? fmtPercent(totals.ctr) : '-', impressions ? 'Clics / impresiones del mes' : 'Ponderado por clics'],
      ['Clics', hasData ? fmtCount(totals.clicks) : '-', 'Trafico generado'],
      ['Conversaciones', hasData ? fmtCount(totals.conversions) : '-', 'Resultados registrados'],
      ['Costo x conversacion', hasData && isNum(totals.costPerConversion) ? fmtMoney(totals.costPerConversion) : '-', 'Inversion / conversaciones']
    ];
    if (impressions !== null) {
      cards.push(['Impresiones', fmtCount(impressions), days ? `Promedio ${fmtCount(impressions / days)} x dia` : 'Total del mes']);
    }
    host.innerHTML = cards.map(([label, value, meta]) => `<div class="kpi-pill"><span>${label}</span><strong>${value}</strong><small>${meta}</small></div>`).join('');
  }

  function renderTabs() {
    const host = document.getElementById('month-tabs');
    if (host) host.innerHTML = '';
  }

  // Grafico principal: lineas en el tiempo con un punto por mes cargado.
  // El grafico sigue al filtro: por defecto muestra el mes elegido y con el boton
  // Vision total pasa a todo lo que va del ano.
  function renderChart() {
    const notice = document.getElementById('records-empty');
    if (notice) {
      const hasRecords = state.rows.length > 0;
      notice.hidden = hasRecords;
      notice.innerHTML = hasRecords ? '' : `<strong>Sin tabla de campanas para ${escapeHtml(currentMonth() ? currentMonth().label : 'este mes')}.</strong>Agrega el CSV del mes a la carpeta de Drive y sincroniza.`;
    }
    document.querySelectorAll('[data-chart-view]').forEach(button => {
      const active = button.dataset.chartView === state.chartView;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (state.chartView === 'year') renderYearView();
    else renderMonthView();
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
    const metrics = MONTHLY_ORDER.filter(metric => months.some(month => isNum(month[metric])));
    document.getElementById('chart-title').textContent = 'Evolucion mensual | Inversion, resultados y costo por resultado';
    const sub = document.getElementById('chart-sub');
    if (sub) {
      const totalCost = months.reduce((total, month) => total + (month.cost || 0), 0);
      const totalConversions = months.reduce((total, month) => total + (month.conversions || 0), 0);
      sub.textContent = `${months.length} meses | ${fmtMoney(totalCost)} de inversion | ${fmtCount(totalConversions)} resultados | ${fmtMoney(totalConversions > 0 ? totalCost / totalConversions : null)} por resultado en el acumulado.`;
    }
    const legend = document.querySelector('.chart-legend span');
    if (legend) {
      legend.innerHTML = metrics.map(metric => `<i class="legend-line" style="background:${MONTHLY[metric].color}"></i><b>${MONTHLY[metric].label}</b>`).join('');
    }
    const canvas = document.getElementById('chart-monthly');
    if (typeof Chart === 'undefined') {
      canvas.parentElement.innerHTML = '<div class="empty-state"><strong>Grafico no disponible sin conexion.</strong><span>La tabla de resultados sigue visible.</span></div>';
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
            pointRadius: months.map(month => (month.id === state.monthId ? 6 : 3)),
            pointHoverRadius: 7,
            pointBackgroundColor: months.map(month => (month.id === state.monthId ? series.color : '#fff')),
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
          // Un clic en el grafico cambia el mes seleccionado.
          if (!elements.length) return;
          const month = months[elements[0].index];
          if (month && month.id !== state.monthId) { selectMonth(month.id); renderAll(); }
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
          x: { grid: { display: false }, border: { color: '#bfdbfe' }, ticks: { color: '#7890b5', font: { size: 11, weight: '600' } } },
          y: {
            beginAtZero: true,
            border: { display: false },
            grid: { color: 'rgba(14,165,233,.16)' },
            ticks: { color: '#7890b5', font: { size: 10 }, callback: value => formatValue(value, 'money', true) }
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

  function dailySummary(rows, active, estimated) {
    const month = currentMonth();
    const parts = [`${rows.length} dias de ${month ? month.label : 'el periodo'}`];
    const totalOf = metric => rows.reduce((total, row) => total + (isNum(row[metric]) ? Number(row[metric]) : 0), 0);
    if (active.includes('cost')) parts.push(`${fmtMoney(totalOf('cost'))} de inversion`);
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
  function renderMonthView() {
    const panel = document.getElementById('chart-panel');
    if (!panel) return;
    const { rows, active, estimated } = dailySeries();
    const month = currentMonth();
    panel.hidden = false;
    if (!rows.length || !active.length) {
      if (state.chart) { state.chart.destroy(); state.chart = null; }
      document.getElementById('chart-title').textContent = `Evolucion diaria | ${month ? month.label : ''}`.trim();
      document.getElementById('chart-sub').textContent = 'Este mes no tiene detalle por dia.';
      const emptyLegend = document.querySelector('.chart-legend span');
      if (emptyLegend) emptyLegend.innerHTML = '';
      const emptyNote = document.getElementById('chart-note');
      if (emptyNote) {
        emptyNote.hidden = false;
        emptyNote.textContent = 'Sin serie diaria para este mes. En Vision total si aparece con los demas meses del ano.';
      }
      return;
    }
    document.getElementById('chart-title').textContent = `Evolucion diaria | ${month ? month.label : ''}`.trim();
    document.getElementById('chart-sub').textContent = dailySummary(rows, active, estimated);
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
        note.textContent = `Lineas punteadas: ${guessed.join(' y ')} del mes repartidos entre los dias segun las impresiones de cada dia, no son cifras diarias reales. Al importar el export diario con las columnas Fecha, Coste y Resultados se reemplazan por los valores reales.`;
      } else if (missing.length) {
        note.textContent = `Falta el detalle diario de ${missing.join(' y ')}. Envia el export diario con las columnas Fecha, Coste y Resultados y este grafico las dibujara junto a las impresiones.`;
      } else {
        note.textContent = '';
      }
    }
    const canvas = document.getElementById('chart-monthly');
    if (typeof Chart === 'undefined') {
      canvas.parentElement.innerHTML = '<div class="empty-state"><strong>Grafico no disponible sin conexion.</strong><span>Los totales siguen visibles en los KPIs.</span></div>';
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
        labels: rows.map(row => formatDay(row.date)),
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
            pointRadius: rows.length > 20 ? 2 : 3,
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
              title: items => formatLongDate(rows[items[0].dataIndex].date),
              label: context => {
                const metric = context.dataset.metricKey;
                const series = DAILY[metric];
                return ` ${series.label}: ${formatValue(context.raw, series.unit)}${estimated.has(metric) ? ' (estimado)' : ''}`;
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { color: '#bfdbfe' }, ticks: { color: '#7890b5', font: { size: 10 } } },
          y: {
            display: usesMoney,
            beginAtZero: true,
            border: { display: false },
            grid: { color: 'rgba(14,165,233,.16)' },
            ticks: { color: '#7890b5', font: { size: 10 }, callback: value => formatValue(value, 'money', true) }
          },
          y1: {
            display: usesCount,
            position: usesMoney ? 'right' : 'left',
            beginAtZero: true,
            border: { display: false },
            grid: { color: usesMoney ? 'rgba(0,0,0,0)' : 'rgba(14,165,233,.16)', drawOnChartArea: !usesMoney },
            ticks: { color: '#7890b5', font: { size: 10 }, callback: value => fmtCount(value) }
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

  function renderTable() {
    const body = document.getElementById('campaigns-body');
    const month = currentMonth();
    document.getElementById('campaigns-title').textContent = `Tabla de resultados${month ? ` | ${month.label}` : ''}`;
    document.getElementById('campaigns-sub').textContent = state.rows.length
      ? `${state.rows.length} campanas importadas para ${month ? month.label : 'el periodo seleccionado'}.`
      : 'Sin tabla de campanas para el mes seleccionado.';
    if (!state.rows.length) {
      body.innerHTML = '<tr><td colspan="11" class="table-empty">Sin resultados para mostrar.</td></tr>';
      return;
    }
    body.innerHTML = sortedRows('cost').map(row => `
      <tr>
        <td class="campaign-name"><span>${escapeHtml(campaignLabel(row.campaign))}</span><small>${escapeHtml(row.campaign)}</small></td>
        <td class="num">${fmtMoney(row.cost)}</td>
        <td class="num">${formatValue(row.costDelta, 'percent')}</td>
        <td class="num">${fmtPercent(row.ctr)}</td>
        <td class="num">${formatValue(row.ctrDelta, 'percent')}</td>
        <td class="num">${fmtCount(row.clicks)}</td>
        <td class="num">${formatValue(row.clicksDelta, 'percent')}</td>
        <td class="num">${fmtCount(row.conversions)}</td>
        <td class="num">${formatValue(row.conversionsDelta, 'percent')}</td>
        <td class="num">${fmtMoney(row.costPerConversion)}</td>
        <td class="num">${formatValue(row.costPerConversionDelta, 'percent')}</td>
      </tr>
    `).join('');
  }

  function updateSourceLabels() {
    // La barra superior y el pie son de la vista activa: con otra vista abierta no se pisan.
    if (!document.getElementById('view-obj').classList.contains('visible')) return;
    const month = currentMonth();
    const status = document.getElementById('topbar-status');
    const source = document.getElementById('footer-source');
    const footerStatus = document.getElementById('footer-status');
    const caption = document.getElementById('topbar-caption');
    if (status) status.textContent = month ? `${month.label} | ${state.rows.length} campanas` : 'Sin data cargada';
    if (source) source.textContent = `Fuente: ${(month && month.sourceFile) || DATA_URL}`;
    if (footerStatus) footerStatus.textContent = month ? `Periodo ${month.label}` : 'Resultados de pauta digital';
    if (caption) caption.textContent = month ? `Branding y ventas | ${month.label}` : 'Branding y ventas';
  }

  function renderAll() {
    renderFilters();
    renderKpis();
    renderChart();
    renderTabs();
    renderTable();
    updateSourceLabels();
  }

  function renderError(message) {
    document.getElementById('view-obj').innerHTML = `<div class="data-notice error"><strong>No se pudo cargar la tabla de resultados.</strong>${escapeHtml(message)}</div>`;
  }

  async function init() {
    try {
      state.data = window.AQUARIUS_RETAIL_DATA;
      if (!state.data) {
        const response = await fetch(DATA_URL, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        state.data = await response.json();
      }
      state.months = normalizeMonths(state.data);
      if (!state.months.length) throw new Error('La fuente no contiene meses con datos.');
      window.AQUARIUS_RETAIL_DATA = state.data;
      const stored = readStoredMonth();
      const initialMonth = state.months.some(month => month.id === stored)
        ? stored
        : (state.data.defaultMonth || state.months[state.months.length - 1].id);
      selectMonth(initialMonth, false);
      state.chartView = readStoredView() === 'year' ? 'year' : 'month';
      renderAll();
      window.dispatchEvent(new CustomEvent('aquarius:data-ready', { detail: state.data }));
    } catch (error) {
      renderError(error.message);
      console.error(error);
    }
  }

  // Dia de la ultima sincronizacion en Lima (UTC-5 todo el ano, sin horario de verano).
  function syncDay() {
    const date = new Date((state.data && state.data.drive && state.data.drive.lastSync) || '');
    return Number.isNaN(date.getTime()) ? null : new Date(date.getTime() - 5 * 3600000).toISOString().slice(0, 10);
  }

  // Corte de un mes: fin del rango del informe de Google Ads o, sin rango, el ultimo dia del mes.
  // Nunca es posterior a la sincronizacion: un informe de "este mes" puede traer el mes completo.
  function monthCutoff(month) {
    const [year, number] = month.id.split('-').map(Number);
    const end = month.period && /^\d{4}-\d{2}-\d{2}$/.test(month.period.end)
      ? month.period.end
      : `${month.id}-${String(new Date(year, number, 0).getDate()).padStart(2, '0')}`;
    const synced = syncDay();
    return synced && synced < end ? synced : end;
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
          campaigns: month.records.map(record => Object.assign({}, record))
        };
      })
    };
  }

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
