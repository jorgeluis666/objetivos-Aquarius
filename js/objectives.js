(function () {
  const DATA_URL = 'data/aquarius-lima-retail-2026.json';
  const SERIES = {
    cost: { label: 'Inversion', unit: 'money', color: '#0284c7', fill: 'rgba(2,132,199,.18)', axis: 'y' },
    conversions: { label: 'Conversaciones', unit: 'count', color: '#7c3aed', fill: 'rgba(124,58,237,.16)', axis: 'y1' },
    costPerConversion: { label: 'Costo x Conversacion', unit: 'money', color: '#0f766e', fill: 'rgba(15,118,110,.16)', axis: 'y2' }
  };
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
  const state = { data: null, rows: [], chart: null };

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

  function renderFilters() {
    const host = document.getElementById('retail-filters');
    if (host) host.innerHTML = '';
  }

  function renderKpis() {
    const host = document.getElementById('kpi-strip');
    const rows = state.rows;
    const cost = sum(rows, 'cost');
    const conversions = sum(rows, 'conversions');
    const cards = [
      ['Coste total', fmtMoney(cost), 'Inversion registrada'],
      ['CTR promedio', fmtPercent(weightedCtr(rows)), 'Ponderado por clics'],
      ['Clics', fmtCount(sum(rows, 'clicks')), 'Trafico generado'],
      ['Conversaciones', fmtCount(conversions), 'Resultados registrados'],
      ['Costo x conversacion', fmtMoney(conversions > 0 ? cost / conversions : null), 'Inversion / conversaciones']
    ];
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

  function renderTable() {
    const body = document.getElementById('campaigns-body');
    document.getElementById('campaigns-title').textContent = 'Tabla de resultados';
    document.getElementById('campaigns-sub').textContent = `${state.rows.length} campanas importadas desde el Excel de Aquarius.`;
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
    const status = document.getElementById('topbar-status');
    const source = document.getElementById('footer-source');
    if (status) status.textContent = `${state.rows.length} campanas reflejadas`;
    if (source) source.textContent = `Fuente: ${state.data.sourceFile || DATA_URL}`;
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

  function wireEvents() {
    // Sin controles: el grafico muestra las tres barras clave siempre.
  }

  async function init() {
    try {
      state.data = window.AQUARIUS_RETAIL_DATA;
      if (!state.data) {
        const response = await fetch(DATA_URL, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        state.data = await response.json();
      }
      if (!Array.isArray(state.data.records)) throw new Error('La fuente no contiene records.');
      window.AQUARIUS_RETAIL_DATA = state.data;
      state.rows = state.data.records;
      wireEvents();
      renderAll();
      window.dispatchEvent(new CustomEvent('aquarius:data-ready', { detail: state.data }));
    } catch (error) {
      renderError(error.message);
      console.error(error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
