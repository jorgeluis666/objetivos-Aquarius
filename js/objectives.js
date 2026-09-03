(function () {
  const DATA_URL = 'data/aquarius-lima-retail-2026.json';
  const MONTH_STORAGE_KEY = 'aquarius_selected_month';
  const SERIES = {
    cost: { label: 'Inversion', unit: 'money', color: '#0284c7', fill: 'rgba(2,132,199,.18)', axis: 'y' },
    conversions: { label: 'Conversaciones', unit: 'count', color: '#7c3aed', fill: 'rgba(124,58,237,.16)', axis: 'y1' },
    costPerConversion: { label: 'Costo x Conversacion', unit: 'money', color: '#0f766e', fill: 'rgba(15,118,110,.16)', axis: 'y2' }
  };
  // Series de la evolucion diaria dentro del mes.
  const DAILY = {
    cost: { label: 'Inversion', unit: 'money', color: '#0284c7', axis: 'y' },
    conversions: { label: 'Resultados', unit: 'count', color: '#7c3aed', axis: 'y1' },
    costPerConversion: { label: 'Costo x resultado', unit: 'money', color: '#0f766e', axis: 'y', dashed: true },
    impressions: { label: 'Impresiones', unit: 'count', color: '#f59e0b', axis: 'y1' }
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
  const state = { data: null, months: [], monthId: null, rows: [], daily: [], chart: null, dailyChart: null };

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

  // Acepta el esquema por meses y tambien el formato antiguo de un solo bloque de records.
  function normalizeMonths(data) {
    if (Array.isArray(data.months) && data.months.length) {
      return data.months
        .map(month => ({
          id: String(month.id || ''),
          label: month.label || monthLabel(month.id),
          sourceFile: month.sourceFile || null,
          records: Array.isArray(month.records) ? month.records : [],
          daily: dailyRows(month)
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
        daily: []
      }];
    }
    return [];
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
        <p>${state.months.length} ${state.months.length === 1 ? 'mes disponible' : 'meses disponibles'}. Cada nuevo cierre se agrega a este filtro.</p>
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
    const rows = state.rows;
    const hasRows = rows.length > 0;
    const cost = sum(rows, 'cost');
    const conversions = sum(rows, 'conversions');
    const cards = [
      ['Coste total', hasRows ? fmtMoney(cost) : '-', 'Inversion registrada'],
      ['CTR promedio', hasRows ? fmtPercent(weightedCtr(rows)) : '-', 'Ponderado por clics'],
      ['Clics', hasRows ? fmtCount(sum(rows, 'clicks')) : '-', 'Trafico generado'],
      ['Conversaciones', hasRows ? fmtCount(conversions) : '-', 'Resultados registrados'],
      ['Costo x conversacion', hasRows && conversions > 0 ? fmtMoney(cost / conversions) : '-', 'Inversion / conversaciones']
    ];
    if (dailyHas('impressions')) {
      const total = dailyTotal('impressions');
      const days = state.daily.filter(row => isNum(row.impressions)).length;
      cards.push(['Impresiones', fmtCount(total), `Promedio ${fmtCount(days ? total / days : null)} x dia`]);
      // Con impresiones reales el CTR sale de la serie diaria, no del CTR por campana.
      if (hasRows && total > 0) {
        cards[1] = ['CTR promedio', fmtPercent(sum(rows, 'clicks') / total), 'Clics / impresiones del mes'];
      }
    }
    host.innerHTML = cards.map(([label, value, meta]) => `<div class="kpi-pill"><span>${label}</span><strong>${value}</strong><small>${meta}</small></div>`).join('');
  }

  function renderTabs() {
    const host = document.getElementById('month-tabs');
    if (host) host.innerHTML = '';
  }

  function chartOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: context => {
              const series = SERIES[context.dataset.metricKey];
              return ` ${series.label}: ${formatValue(context.raw, series.unit)}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, border: { color: '#bfdbfe' }, ticks: { color: '#7890b5', font: { size: 10 }, maxRotation: 35, minRotation: 0 } },
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
        y2: {
          beginAtZero: true,
          display: false,
          grid: { drawOnChartArea: false }
        }
      }
    };
  }

  function renderChart() {
    const panel = document.getElementById('chart-panel');
    const notice = document.getElementById('records-empty');
    const hasRows = state.rows.length > 0;
    if (panel) panel.hidden = !hasRows;
    if (notice) {
      notice.hidden = hasRows;
      notice.innerHTML = hasRows ? '' : `<strong>Sin tabla de campanas para ${escapeHtml(currentMonth() ? currentMonth().label : 'este mes')}.</strong>Envia el Excel de resultados de pauta y se cargara en este mismo filtro.`;
    }
    if (!hasRows) {
      if (state.chart) { state.chart.destroy(); state.chart = null; }
      return;
    }
    const rows = sortedRows();
    const labels = rows.map(row => campaignLabel(row.campaign));
    const metrics = ['cost', 'conversions', 'costPerConversion'];
    document.getElementById('chart-title').textContent = 'Resultados por campana | Inversion, Conversaciones y Costo x Conversacion';
    const legend = document.querySelector('.chart-legend span');
    if (legend) {
      legend.innerHTML = metrics.map(metric => `<i class="legend-line" style="background:${SERIES[metric].color}"></i><b>${SERIES[metric].label}</b>`).join('');
    }
    const canvas = document.getElementById('chart-monthly');
    if (typeof Chart === 'undefined') {
      canvas.parentElement.innerHTML = '<div class="empty-state"><strong>Grafico no disponible sin conexion.</strong><span>La tabla de resultados sigue visible.</span></div>';
      return;
    }
    if (state.chart) state.chart.destroy();
    state.chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: metrics.map(metric => ({
          metricKey: metric,
          label: SERIES[metric].label,
          data: rows.map(row => Number(row[metric] || 0)),
          yAxisID: SERIES[metric].axis,
          borderColor: SERIES[metric].color,
          backgroundColor: SERIES[metric].fill,
          borderWidth: 1.4,
          borderRadius: 4,
          barPercentage: 0.58,
          categoryPercentage: 0.64,
          maxBarThickness: 22
        }))
      },
      options: chartOptions(),
      plugins: [{
        id: 'insideBarValues',
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          ctx.save();
          chart.data.datasets.forEach((dataset, datasetIndex) => {
            const series = SERIES[dataset.metricKey];
            const meta = chart.getDatasetMeta(datasetIndex);
            meta.data.forEach((bar, index) => {
              const value = dataset.data[index];
              if (!Number.isFinite(Number(value)) || Number(value) <= 0) return;
              const label = formatValue(value, series.unit, true);
              const top = Math.min(bar.y, bar.base);
              const bottom = Math.max(bar.y, bar.base);
              const height = bottom - top;
              ctx.fillStyle = series.color;
              ctx.font = '700 9px Inter, sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              const y = height > 28 ? top + 14 : top - 8;
              ctx.fillText(label, bar.x, y);
            });
          });
          ctx.restore();
        }
      }]
    });
  }

  // Evolucion diaria dentro del mes: una linea por indicador disponible.
  function dailySeries() {
    const rows = state.daily.map(row => {
      const cost = isNum(row.cost) ? Number(row.cost) : null;
      const conversions = isNum(row.conversions) ? Number(row.conversions) : null;
      return Object.assign({}, row, {
        costPerConversion: Number.isFinite(cost) && Number.isFinite(conversions) && conversions > 0 ? cost / conversions : null
      });
    });
    const active = DAILY_ORDER.filter(metric => rows.some(row => isNum(row[metric])));
    return { rows, active };
  }

  function dailySummary(rows, active) {
    const month = currentMonth();
    const parts = [`${rows.length} dias de ${month ? month.label : 'el periodo'}`];
    if (active.includes('cost')) parts.push(`${fmtMoney(dailyTotal('cost'))} de inversion`);
    if (active.includes('conversions')) parts.push(`${fmtCount(dailyTotal('conversions'))} resultados`);
    if (active.includes('cost') && active.includes('conversions')) {
      const conversions = dailyTotal('conversions');
      parts.push(`${fmtMoney(conversions > 0 ? dailyTotal('cost') / conversions : null)} por resultado`);
    }
    if (active.includes('impressions')) parts.push(`${fmtCount(dailyTotal('impressions'))} impresiones`);
    return `${parts.join(' | ')}.`;
  }

  function renderDaily() {
    const panel = document.getElementById('daily-panel');
    if (!panel) return;
    const { rows, active } = dailySeries();
    if (!rows.length || !active.length) {
      panel.hidden = true;
      if (state.dailyChart) { state.dailyChart.destroy(); state.dailyChart = null; }
      return;
    }
    panel.hidden = false;
    const month = currentMonth();
    document.getElementById('daily-title').textContent = `Evolucion diaria | ${month ? month.label : ''}`.trim();
    document.getElementById('daily-sub').textContent = dailySummary(rows, active);
    const legend = document.querySelector('.daily-legend span');
    if (legend) {
      legend.innerHTML = active.map(metric => `<i class="legend-line" style="background:${DAILY[metric].color}"></i><b>${DAILY[metric].label}</b>`).join('');
    }
    const note = document.getElementById('daily-note');
    if (note) {
      const missing = ['cost', 'conversions'].filter(metric => !active.includes(metric)).map(metric => DAILY[metric].label.toLowerCase());
      note.hidden = !missing.length;
      note.textContent = missing.length
        ? `Falta el detalle diario de ${missing.join(' y ')}. Envia el export diario con las columnas Fecha, Coste y Resultados y este grafico las dibujara junto a las impresiones.`
        : '';
    }
    const canvas = document.getElementById('chart-daily');
    if (typeof Chart === 'undefined') {
      canvas.parentElement.innerHTML = '<div class="empty-state"><strong>Grafico no disponible sin conexion.</strong><span>Los totales siguen visibles en los KPIs.</span></div>';
      return;
    }
    if (state.dailyChart) state.dailyChart.destroy();
    const usesMoney = active.some(metric => DAILY[metric].axis === 'y');
    const usesCount = active.some(metric => DAILY[metric].axis === 'y1');
    state.dailyChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: rows.map(row => formatDay(row.date)),
        datasets: active.map(metric => {
          const series = DAILY[metric];
          return {
            metricKey: metric,
            label: series.label,
            data: rows.map(row => (isNum(row[metric]) ? Number(row[metric]) : null)),
            yAxisID: series.axis,
            borderColor: series.color,
            backgroundColor: active.length === 1 ? 'rgba(245,158,11,.14)' : 'transparent',
            borderWidth: 2,
            borderDash: series.dashed ? [5, 4] : [],
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
                const series = DAILY[context.dataset.metricKey];
                return ` ${series.label}: ${formatValue(context.raw, series.unit)}`;
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
          }
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
    renderDaily();
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
      renderAll();
      window.dispatchEvent(new CustomEvent('aquarius:data-ready', { detail: state.data }));
    } catch (error) {
      renderError(error.message);
      console.error(error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
