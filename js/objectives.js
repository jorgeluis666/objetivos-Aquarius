(function () {
  const DATA_URL = 'data/amador-ads-2026.json';
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const SHORT_MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const SERIES = {
    total: { label: 'Total', color: '#2563eb', fill: 'rgba(37,99,235,.11)' },
    sales: { label: 'Ventas', color: '#b91c1c', fill: 'rgba(185,28,28,.10)' },
    branding: { label: 'Branding', color: '#7c3aed', fill: 'rgba(124,58,237,.10)' },
  };
  const state = { data: null, type: 'total', month: 'Junio', chart: null };
  const fmtMoney = value => value == null ? '-' : `S/. ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtShort = value => {
    if (value == null) return '';
    if (value >= 1000) return `S/. ${(value / 1000).toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}k`;
    return `S/. ${Math.round(value)}`;
  };
  function sourceMonth(name) { return state.data.months.find(month => month.name === name); }
  function valueFor(name, type) {
    const month = sourceMonth(name);
    if (!month) return null;
    if (type === 'total') return month.spend;
    return month.spendBreakdown?.[type] ?? null;
  }
  function renderTabs() {
    const host = document.getElementById('month-tabs');
    host.innerHTML = MONTHS.map(name => {
      const available = !!sourceMonth(name);
      const selected = name === state.month;
      return `<button type="button" class="month-tab ${selected ? 'active' : ''}" data-month="${name}" ${available ? '' : 'disabled'}>${name}${name === 'Junio' ? '<span class="current-dot"></span>' : ''}</button>`;
    }).join('');
    host.querySelectorAll('.month-tab:not(:disabled)').forEach(button => {
      button.addEventListener('click', () => { state.month = button.dataset.month; renderTabs(); renderCampaigns(); });
    });
  }
  function statusClass(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'activa' || normalized === 'activo') return 'green';
    if (normalized === 'finalizada' || normalized === 'finalizado') return 'red';
    return 'muted';
  }
  function computeDuration(start, end) {
    if (!start || !end) return null;
    const MON = {Ene:0,Feb:1,Mar:2,Abr:3,May:4,Jun:5,Jul:6,Ago:7,Sep:8,Oct:9,Nov:10,Dic:11,Jan:0,Apr:3,Jun:5,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    const parse = s => { const m = s.match(/^(\d{1,2})-([A-Za-z]{3})$/); return m && MON[m[2]] !== undefined ? new Date(2026, MON[m[2]], +m[1]) : new Date(s); };
    try { return Math.round((parse(end) - parse(start)) / 86400000) + 1; } catch { return null; }
  }
  function renderAdLinks(urls) {
    if (!urls?.length) return '<span class="no-data">—</span>';
    return `<div class="ad-links">${urls.map((url,i) => `<a href="${url}" target="_blank" rel="noopener noreferrer">Anuncio ${i+1}</a>`).join('')}</div>`;
  }
  function renderCampaigns() {
    const month = sourceMonth(state.month);
    const campaigns = month.campaigns || [];
    const active = campaigns.filter(c => ['activa', 'activo'].includes(String(c.status || '').toLowerCase())).length;
    document.getElementById('campaigns-title').textContent = `Campanas de ${month.name} 2026`;
    document.getElementById('campaigns-sub').textContent = campaigns.length ? `${active} activas de ${campaigns.length} campanas registradas.` : 'Sin detalle de campanas en el archivo fuente.';
    const body = document.getElementById('campaigns-body');
    if (!campaigns.length) { body.innerHTML = '<tr><td colspan="21" class="table-empty">Sin campanas registradas para este mes.</td></tr>'; return; }
    const rows = [];
    let totalReservas = 0;
    for (const c of campaigns) {
      const ads = c.ads?.length ? c.ads : [null];
      const span = ads.length;
      ads.forEach((ad, i) => {
        const budget = ad?.budget ?? c.budget;
        const spent = ad?.spent ?? (span === 1 ? c.spent : null);
        const daily = ad?.dailyAmount ?? c.dailyAmount;
        const obj = ad?.objective ?? c.objective;
        const st = ad?.status ?? c.status;
        const start = ad?.startDate ?? c.startDate ?? null;
        const end = ad?.endDate ?? c.endDate ?? null;
        const dur = ad?.duration ?? c.duration ?? computeDuration(start, end);
        const adUrl = ad?.adUrl ?? c.adUrls?.[i] ?? null;
        const adName = ad?.name ?? (c.adUrls?.[i] ? `Anuncio ${i+1}` : '—');
        const reservas = Number(ad?.reservas ?? (span === 1 ? c.reservas : 0) ?? 0);
        const daysLeft = ad?.daysRemaining ?? null;
        const adBalance = ad?.balance ?? (budget != null && spent != null ? budget - spent : null);
        const newDaily = ad?.newDailyAmount ?? null;
        const observation = ad?.observation ?? (i === 0 ? c.observation : null);
        totalReservas += reservas;
        const rs = span > 1 ? ` rowspan="${span}"` : '';
        let tr = '<tr>';
        if (i === 0) tr += `<td class="type-col"${rs}>${c.type || '—'}</td>`;
        if (i === 0) tr += `<td class="campaign-name"${rs}>${c.name}</td>`;
        tr += `<td class="ad-name-col">${adName}</td>`;
        tr += `<td><span class="objective-pill">${obj || '—'}</span></td>`;
        tr += `<td class="resultados-col">${reservas}</td>`;
        tr += `<td><span class="status-pill ${statusClass(st)}">${st || '—'}</span></td>`;
        tr += `<td class="date-col">${start || '—'}</td>`;
        tr += `<td class="date-col">${end || '—'}</td>`;
        tr += `<td class="num">${dur != null ? dur + ' d' : '—'}</td>`;
        tr += `<td class="num">${daysLeft != null ? daysLeft : '—'}</td>`;
        tr += `<td class="num">${fmtMoney(daily)}</td>`;
        tr += `<td class="num">${fmtMoney(budget)}</td>`;
        tr += `<td class="num">${fmtMoney(spent)}</td>`;
        if (i === 0) tr += `<td class="num campaign-total"${rs}>${fmtMoney(c.budget)}</td>`;
        if (i === 0) tr += `<td class="num campaign-total"${rs}>${fmtMoney(c.spent)}</td>`;
        tr += `<td class="num">${fmtMoney(adBalance)}</td>`;
        if (i === 0) tr += `<td class="num campaign-total"${rs}>${fmtMoney(c.balance)}</td>`;
        if (i === 0) tr += `<td class="num campaign-total"${rs}>${fmtMoney(c.realBalance)}</td>`;
        tr += `<td class="num">${fmtMoney(newDaily)}</td>`;
        tr += `<td class="observation-col">${observation || '—'}</td>`;
        tr += `<td>${adUrl ? `<div class="ad-links"><a href="${adUrl}" target="_blank" rel="noopener noreferrer">${adName !== '—' ? adName : 'Ver'}</a></div>` : (i === 0 && !ad ? renderAdLinks(c.adUrls) : '<span class="no-data">—</span>')}</td>`;
        tr += '</tr>';
        rows.push(tr);
      });
    }
    rows.push(`<tr class="reservations-total-row"><td colspan="4">Total actualizado ${month.name.toLowerCase()}</td><td class="resultados-col">${totalReservas}</td><td colspan="7"></td><td class="num">${fmtMoney(month.adSpendTotal)}</td><td class="num">${fmtMoney(month.budgetTotal)}</td><td class="num">${fmtMoney(month.spend)}</td><td class="num">${fmtMoney(month.balanceTotal)}</td><td class="num">${fmtMoney(month.balanceTotal)}</td><td></td><td class="num">${fmtMoney(month.newDailyTotal)}</td><td>${month.totalObservation || ''}</td><td></td></tr>`);
    body.innerHTML = rows.join('');
  }
  function chartOptions(series) {
    return { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, layout: { padding: { top: 24, right: 12, left: 4 } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => ` ${series.label}: ${fmtMoney(context.raw)}` } } }, scales: { x: { grid: { display: false }, border: { color: '#cbd5e1' }, ticks: { color: '#7890b5', font: { size: 10 } } }, y: { beginAtZero: true, suggestedMax: 3500, border: { display: false }, grid: { color: 'rgba(148,163,184,.20)' }, ticks: { color: '#7890b5', font: { size: 10 }, callback: value => value === 0 ? 'S/. 0' : `S/. ${(value / 1000).toFixed(1)}k` } } } };
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
    state.chart = new Chart(canvas, { type: 'line', data: { labels: SHORT_MONTHS, datasets: [{ label: series.label, data: values, borderColor: series.color, backgroundColor: series.fill, borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 7, pointBackgroundColor: series.color, pointBorderColor: series.color, tension: .25, fill: true, spanGaps: false }] }, options: chartOptions(series), plugins: [{ id: 'valueLabels', afterDatasetsDraw(chart) { const ctx = chart.ctx; const meta = chart.getDatasetMeta(0); ctx.save(); ctx.fillStyle = series.color; ctx.font = '600 10px Inter, sans-serif'; ctx.textAlign = 'center'; meta.data.forEach((point,index) => { const value = values[index]; if (value == null) return; ctx.fillText(fmtShort(value), point.x, point.y - 13); }); ctx.restore(); } }] });
  }
  function wireSelector() { document.getElementById('spend-type-select').addEventListener('change', event => { state.type = event.target.value; renderChart(); }); }
  async function init() {
    try {
      if (window.AMADOR_ADS_DATA) state.data = window.AMADOR_ADS_DATA;
      else { const response = await fetch(DATA_URL, { cache: 'no-store' }); if (!response.ok) throw new Error(`HTTP ${response.status}`); state.data = await response.json(); }
      wireSelector(); renderChart(); renderTabs(); renderCampaigns();
    } catch (error) { document.getElementById('view-obj').innerHTML = '<div class="data-notice error"><strong>No se pudo cargar la informacion de Amador.</strong></div>'; console.error(error); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
