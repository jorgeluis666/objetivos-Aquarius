(function () {
  const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const SHORT_MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
  const METRICS = {
    investment: { key: 'investment', label: 'Inversion', unit: 'money', color: '#0284c7', fill: 'rgba(2,132,199,.10)', field: 'cost', reference: 'budget', referenceLabel: 'Presupuesto' },
    clicks: { key: 'clicks', label: 'Clics', unit: 'count', color: '#d97706', fill: 'rgba(217,119,6,.10)', field: 'clicks', reference: null, referenceLabel: null },
    conversions: { key: 'conversions', label: 'Conversaciones', unit: 'count', color: '#16a34a', fill: 'rgba(22,163,74,.10)', field: 'conversions', reference: null, referenceLabel: null }
  };

  const SCENARIO_COLOR = '#7c3aed';
  const HANDLE_HIT_RADIUS = 16;
  // Orden fijo de datasets para poder actualizar el escenario mientras se arrastra sin recrear la grafica.
  const DS = { real: 0, forecast: 1, scenario: 2, handle: 3, reference: 4 };

  // factor = cierre objetivo / cierre proyectado. Es comun a los tres indicadores porque el escenario
  // mantiene el CPC y la tasa de conversion del mes; asi cambiar de indicador conserva el escenario.
  const state = { ready: false, metric: 'investment', chart: null, projection: null, factor: 1, dragging: false };

  const money = value => Number.isFinite(Number(value))
    ? `S/ ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '-';
  const count = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('es-PE', { maximumFractionDigits: 0 }) : '-';
  const format = (value, unit) => (unit === 'money' ? money(value) : count(Math.round(Number(value) || 0)));
  const signed = (value, unit) => `${value >= 0 ? '+' : '-'}${format(Math.abs(value), unit)}`;
  // Los ritmos de conteo se muestran con un decimal: 0.8 conversaciones por dia no debe verse como 1.
  const formatPace = (value, unit) => (unit === 'money' ? money(value) : Number(value || 0).toLocaleString('es-PE', { maximumFractionDigits: 1 }));
  const signedPct = value => (value == null ? '' : `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(1)}%`);

  function toDate(iso) {
    const value = /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? `${iso}T00:00:00` : iso;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function longDate(date) {
    return date ? `${date.getDate()} de ${MONTHS[date.getMonth()].toLowerCase()} de ${date.getFullYear()}` : '-';
  }

  // El mes proyectado es el de la fecha de corte; si ese mes no tiene inversion, se usa el ultimo mes con datos.
  function pickMonth(months, cutoff) {
    const withData = months.filter(month => Number(month.cost) > 0);
    if (!withData.length) return null;
    const monthId = String(cutoff || '').slice(0, 7);
    return withData.find(month => month.id === monthId) || withData[withData.length - 1];
  }

  function buildProjection(snapshot) {
    const month = pickMonth(snapshot.months || [], snapshot.cutoff);
    if (!month) return null;

    const [year, monthNumber] = month.id.split('-').map(Number);
    const monthIndex = monthNumber - 1;
    const daysInMonth = new Date(year, monthNumber, 0).getDate();
    const cutoffDate = toDate(snapshot.cutoff);
    const sameMonth = cutoffDate && cutoffDate.getMonth() === monthIndex && cutoffDate.getFullYear() === year;
    const daysWithData = sameMonth ? Math.min(daysInMonth, Math.max(1, cutoffDate.getDate())) : daysInMonth;
    const daysLeft = daysInMonth - daysWithData;
    const closed = daysLeft === 0;

    const references = { budget: Number(month.budgetTotal) || null };

    const metrics = Object.values(METRICS).map(metric => {
      const actual = Number(month[metric.field]) || 0;
      const pace = actual / daysWithData;
      const projected = closed ? actual : pace * daysInMonth;
      const reference = metric.reference ? references[metric.reference] : null;
      return {
        ...metric,
        actual,
        pace,
        projected,
        reference,
        gap: reference == null ? null : reference - projected
      };
    });

    const byKey = Object.fromEntries(metrics.map(metric => [metric.key, metric]));
    const spend = byKey.investment;
    const clicks = byKey.clicks;
    const conversions = byKey.conversions;

    return {
      monthLabel: `${MONTHS[monthIndex]} ${year}`,
      shortMonth: SHORT_MONTHS[monthIndex],
      year,
      daysInMonth,
      daysWithData,
      daysLeft,
      closed,
      cutoffDate,
      source: snapshot.source,
      metrics,
      byKey,
      budget: references.budget,
      dailyBudget: Number(month.dailyBudget) || null,
      budgetProjectedPct: references.budget ? (spend.projected / references.budget) * 100 : null,
      costPerClick: clicks.actual ? spend.actual / clicks.actual : null,
      costPerConversion: conversions.actual ? spend.actual / conversions.actual : null,
      conversionRate: clicks.actual ? (conversions.actual / clicks.actual) * 100 : null,
      projectedCostPerClick: clicks.projected ? spend.projected / clicks.projected : null,
      projectedCostPerConversion: conversions.projected ? spend.projected / conversions.projected : null
    };
  }

  function canSimulate(projection, metric) {
    return !projection.closed && metric.projected > 0;
  }

  // El cierre objetivo nunca puede quedar por debajo de lo ya realizado.
  function clampFactor(projection, factor) {
    const min = projection.daysWithData / projection.daysInMonth;
    return Number.isFinite(factor) ? Math.max(min, factor) : 1;
  }

  function setTarget(projection, metric, value) {
    if (!canSimulate(projection, metric)) return;
    state.factor = clampFactor(projection, Number(value) / metric.projected);
  }

  function buildScenario(projection) {
    const factor = clampFactor(projection, state.factor);
    const metrics = projection.metrics.map(metric => {
      const target = metric.projected * factor;
      const pace = projection.daysLeft > 0 ? (target - metric.actual) / projection.daysLeft : null;
      return {
        ...metric,
        target,
        delta: target - metric.projected,
        deltaPct: metric.projected ? (target / metric.projected - 1) * 100 : null,
        scenarioPace: pace,
        paceChangePct: pace != null && metric.pace ? (pace / metric.pace - 1) * 100 : null,
        targetGap: metric.reference == null ? null : metric.reference - target,
        referencePct: metric.reference ? (target / metric.reference) * 100 : null
      };
    });
    return { factor, active: Math.abs(factor - 1) > 0.0005, metrics, byKey: Object.fromEntries(metrics.map(metric => [metric.key, metric])) };
  }

  function renderKpis(projection) {
    const host = document.getElementById('projection-kpis');
    if (!host) return;
    const { investment, clicks, conversions } = projection.byKey;
    const budgetHint = projection.budget
      ? `${projection.budgetProjectedPct.toFixed(0)}% del presupuesto (${money(projection.budget)})`
      : 'Sin presupuesto registrado';

    const cards = [
      { label: 'Inversion proyectada', value: money(investment.projected), hint: budgetHint },
      { label: 'Clics proyectados', value: count(Math.round(clicks.projected)), hint: `Ritmo ${formatPace(clicks.pace, 'count')} por dia` },
      { label: 'Conversaciones proyectadas', value: count(Math.round(conversions.projected)), hint: `Ritmo ${formatPace(conversions.pace, 'count')} por dia` },
      { label: 'Ritmo de inversion', value: `${money(investment.pace)} / dia`, hint: projection.closed ? 'Mes cerrado' : `Quedan ${projection.daysLeft} dias del mes` },
      { label: 'Avance del mes', value: `${projection.daysWithData} de ${projection.daysInMonth} dias`, hint: `Datos al ${longDate(projection.cutoffDate)}` }
    ];

    host.innerHTML = cards.map(card => `
      <div class="kpi-pill">
        <span>${card.label}</span>
        <strong>${card.value}</strong>
        <small>${card.hint}</small>
      </div>
    `).join('');
  }

  function renderTable(projection) {
    const body = document.getElementById('projection-body');
    if (!body) return;
    const rows = projection.metrics.map(metric => {
      const gap = metric.gap == null
        ? '<span class="no-data">Sin referencia</span>'
        : `<span class="projection-gap ${metric.gap >= 0 ? 'ok' : 'over'}">${metric.gap >= 0 ? '' : '+'}${format(Math.abs(metric.gap), metric.unit)} ${metric.gap >= 0 ? 'por debajo' : 'por encima'}</span>`;
      return `
        <tr>
          <td class="campaign-name">${metric.label}</td>
          <td class="num">${format(metric.actual, metric.unit)}</td>
          <td class="num">${formatPace(metric.pace, metric.unit)}</td>
          <td class="num projection-value">${format(metric.projected, metric.unit)}</td>
          <td class="num">${metric.reference == null ? '<span class="no-data">-</span>' : format(metric.reference, metric.unit)}</td>
          <td>${gap}</td>
        </tr>`;
    }).join('');

    const costRow = `
      <tr class="projection-cost-row">
        <td class="campaign-name">CPC / costo por conversacion</td>
        <td class="num">${money(projection.costPerClick)} / ${money(projection.costPerConversion)}</td>
        <td class="num"><span class="no-data">-</span></td>
        <td class="num projection-value">${money(projection.projectedCostPerClick)} / ${money(projection.projectedCostPerConversion)}</td>
        <td class="num"><span class="no-data">-</span></td>
        <td><span class="no-data">Se mantiene si el ritmo no cambia</span></td>
      </tr>`;

    body.innerHTML = rows + costRow;

    const head = document.getElementById('projection-actual-head');
    if (head) head.textContent = `Actual al ${projection.daysWithData}-${projection.shortMonth}`;
    const closeHead = document.getElementById('projection-close-head');
    if (closeHead) closeHead.textContent = `Proyeccion al ${projection.daysInMonth}-${projection.shortMonth}`;
  }

  function renderLegend(projection, metric, scenario) {
    const host = document.getElementById('projection-legend');
    if (!host) return;
    const items = [
      `<span><i class="legend-line" style="background:${metric.color}"></i><b>Acumulado real</b></span>`
    ];
    if (!projection.closed) {
      items.push(`<span style="color:${metric.color}"><i class="legend-line dashed"></i><b>Proyeccion al cierre</b></span>`);
    }
    if (scenario.active) {
      items.push(`<span style="color:${SCENARIO_COLOR}"><i class="legend-line dashed"></i><b>Escenario objetivo</b></span>`);
    }
    if (metric.reference != null) {
      items.push(`<span style="color:#94a3b8"><i class="legend-line dashed"></i><b>${metric.referenceLabel}</b></span>`);
    }
    if (canSimulate(projection, metric)) {
      items.push(`<span style="color:${scenario.active ? SCENARIO_COLOR : metric.color}"><i class="legend-dot"></i><b>Nodo arrastrable (cierre objetivo)</b></span>`);
    }
    host.innerHTML = items.join('');
  }

  function scenarioSeries(projection, metric, scenarioMetric) {
    const last = projection.daysInMonth - 1;
    const simulable = canSimulate(projection, metric);
    const lineData = Array.from({ length: projection.daysInMonth }, (_, index) => (
      index + 1 >= projection.daysWithData
        ? metric.actual + scenarioMetric.scenarioPace * (index + 1 - projection.daysWithData)
        : null
    ));
    const handleData = Array.from({ length: projection.daysInMonth }, (_, index) => (index === last && simulable ? scenarioMetric.target : null));
    return { lineData, handleData };
  }

  const cutoffMarker = {
    id: 'cutoffMarker',
    afterDatasetsDraw(chart, args, options) {
      const index = options?.index;
      if (index == null || index < 0) return;
      const x = chart.scales.x.getPixelForValue(index);
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#7890b5';
      ctx.font = '700 9px Inter, sans-serif';
      ctx.textAlign = x > (chart.chartArea.left + chart.chartArea.right) / 2 ? 'right' : 'left';
      ctx.fillText(options.label || 'Ultima actualizacion', x + (ctx.textAlign === 'right' ? -6 : 6), top + 10);
      ctx.restore();
    }
  };

  function renderChart(projection) {
    const canvas = document.getElementById('chart-projection');
    if (!canvas) return;
    if (typeof Chart === 'undefined') {
      canvas.parentElement.innerHTML = '<div class="empty-state"><strong>Grafico no disponible sin conexion.</strong><span>El simulador sigue funcionando con el campo numerico.</span></div>';
      return;
    }
    const metric = projection.byKey[state.metric] || projection.byKey.investment;
    const labels = Array.from({ length: projection.daysInMonth }, (_, index) => `${index + 1} ${projection.shortMonth}`);
    const real = labels.map((_, index) => (index + 1 <= projection.daysWithData ? metric.pace * (index + 1) : null));
    const forecast = labels.map((_, index) => (index + 1 >= projection.daysWithData ? metric.pace * (index + 1) : null));

    const scenario = buildScenario(projection);
    const scenarioMetric = scenario.byKey[metric.key];
    const series = scenarioSeries(projection, metric, scenarioMetric);
    const handleColor = scenario.active ? SCENARIO_COLOR : metric.color;

    const datasets = [
      { label: 'Acumulado real', data: real, borderColor: metric.color, backgroundColor: metric.fill, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .15, fill: true },
      { label: 'Proyeccion al cierre', data: projection.closed ? [] : forecast, borderColor: scenario.active ? `${metric.color}66` : metric.color, borderDash: [6, 5], borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .15, fill: false },
      { label: 'Escenario objetivo', data: scenario.active ? series.lineData : [], borderColor: SCENARIO_COLOR, borderDash: [2, 4], borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, tension: 0, fill: false },
      { label: 'Cierre objetivo', data: series.handleData, showLine: false, pointRadius: 7, pointHoverRadius: 9, pointBorderWidth: 3, pointBackgroundColor: '#fff', pointBorderColor: handleColor, pointHoverBackgroundColor: '#fff', pointHoverBorderColor: handleColor, borderColor: handleColor }
    ];
    if (metric.reference != null) {
      datasets.push({ label: metric.referenceLabel, data: labels.map(() => metric.reference), borderColor: '#94a3b8', borderDash: [3, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, fill: false });
    }
    // Margen sobre el cierre para que el nodo tenga recorrido hacia arriba al arrastrarlo.
    const suggestedMax = Math.max(metric.projected * 1.4, (metric.reference || 0) * 1.1, scenarioMetric.target * 1.25);

    const ticks = metric.unit === 'money'
      ? value => (value === 0 ? 'S/ 0' : `S/ ${(value / 1000).toFixed(1)}k`)
      : value => Number(value).toLocaleString('es-PE');

    if (state.chart) state.chart.destroy();
    state.chart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 18, right: 14, left: 4 } },
        plugins: {
          legend: { display: false },
          cutoffMarker: { index: projection.daysWithData - 1, label: `Datos al ${projection.daysWithData}-${projection.shortMonth}` },
          tooltip: {
            callbacks: {
              label: context => (context.raw == null ? null : ` ${context.dataset.label}: ${format(context.raw, metric.unit)}`)
            }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { color: '#bfdbfe' }, ticks: { color: '#7890b5', font: { size: 10 }, maxTicksLimit: 10, autoSkip: true } },
          y: { beginAtZero: true, suggestedMax, border: { display: false }, grid: { color: 'rgba(14,165,233,.16)' }, ticks: { color: '#7890b5', font: { size: 10 }, callback: ticks } }
        }
      },
      plugins: [cutoffMarker]
    });

    renderLegend(projection, metric, scenario);
  }

  // Actualizacion liviana durante el arrastre: solo cambian el escenario y el nodo.
  function updateScenario(projection) {
    const chart = state.chart;
    const metric = projection.byKey[state.metric] || projection.byKey.investment;
    const scenario = buildScenario(projection);
    if (chart) {
      const series = scenarioSeries(projection, metric, scenario.byKey[metric.key]);
      const handleColor = scenario.active ? SCENARIO_COLOR : metric.color;
      const handle = chart.data.datasets[DS.handle];
      chart.data.datasets[DS.forecast].borderColor = scenario.active ? `${metric.color}66` : metric.color;
      chart.data.datasets[DS.scenario].data = scenario.active ? series.lineData : [];
      handle.data = series.handleData;
      handle.pointBorderColor = handle.pointHoverBorderColor = handle.borderColor = handleColor;
      chart.update('none');
      renderLegend(projection, metric, scenario);
    }
    renderSimulator(projection);
  }

  function renderSimulator(projection) {
    const grid = document.getElementById('projection-sim-grid');
    if (!grid) return;
    const metric = projection.byKey[state.metric] || projection.byKey.investment;
    const scenario = buildScenario(projection);
    const selected = scenario.byKey[metric.key];
    const simulable = canSimulate(projection, metric);

    const input = document.getElementById('projection-sim-value');
    const goalButton = document.getElementById('projection-sim-goal');
    const resetButton = document.getElementById('projection-sim-reset');
    const sub = document.getElementById('projection-sim-sub');
    const note = document.getElementById('projection-sim-note');
    const label = document.getElementById('projection-sim-label');
    const prefix = document.getElementById('projection-sim-prefix');

    if (label) label.textContent = `${metric.label} al cierre`;
    if (prefix) prefix.textContent = metric.unit === 'money' ? 'S/' : '#';
    if (input) {
      input.disabled = !simulable;
      input.step = metric.unit === 'money' ? '10' : '1';
      input.min = simulable ? String(Math.ceil(metric.actual)) : '0';
      // No se pisa lo que el usuario esta escribiendo.
      if (document.activeElement !== input) {
        input.value = simulable ? (metric.unit === 'money' ? selected.target.toFixed(2) : String(Math.round(selected.target))) : '';
      }
    }
    if (resetButton) resetButton.disabled = !scenario.active;
    if (goalButton) {
      const hasGoal = simulable && metric.reference != null && metric.reference > 0;
      goalButton.hidden = !hasGoal;
      if (hasGoal) goalButton.textContent = `Llevar al ${metric.referenceLabel.toLowerCase()} (${format(metric.reference, metric.unit)})`;
    }

    if (!simulable) {
      const reason = projection.closed
        ? `${projection.monthLabel} ya cerro: el simulador se activa con el informe del mes en curso.`
        : `Todavia no hay ${metric.label.toLowerCase()} registrados para simular.`;
      if (sub) sub.textContent = reason;
      grid.innerHTML = `<div class="empty-state projection-sim-empty"><strong>Simulador no disponible</strong>${reason}</div>`;
      if (note) note.textContent = '';
      return;
    }

    if (sub) {
      sub.textContent = scenario.active
        ? `Escenario: cerrar ${projection.monthLabel} con ${format(selected.target, metric.unit)} de ${metric.label.toLowerCase()} (${signedPct(selected.deltaPct)} vs la proyeccion).`
        : 'Arrastra el nodo del ultimo dia de la grafica (o escribe el valor) hacia el cierre que quieres alcanzar.';
    }

    const referenceRow = item => {
      if (item.reference == null) return '';
      const isBudget = item.key === 'investment';
      const ok = isBudget ? item.targetGap >= 0 : item.targetGap <= 0;
      const text = isBudget
        ? (item.targetGap >= 0 ? `Quedan ${format(item.targetGap, item.unit)}` : `Excede ${format(-item.targetGap, item.unit)}`)
        : (item.targetGap > 0 ? `Faltan ${format(item.targetGap, item.unit)}` : `Cumple (+${format(-item.targetGap, item.unit)})`);
      return `<div><dt>vs ${item.referenceLabel.toLowerCase()} (${item.referencePct.toFixed(0)}%)</dt><dd class="${ok ? 'ok' : 'over'}">${text}</dd></div>`;
    };

    const cards = scenario.metrics.map(item => {
      const trend = !scenario.active ? '' : item.delta >= 0 ? 'up' : 'down';
      const perDay = item.unit === 'money' ? '/ dia' : 'por dia';
      return `
        <div class="sim-card ${item.key === metric.key ? 'selected' : ''}">
          <span>${item.label} al cierre</span>
          <strong>${format(item.target, item.unit)}</strong>
          <small class="sim-delta ${trend}">${scenario.active ? `${signed(item.delta, item.unit)} vs proyeccion (${signedPct(item.deltaPct)})` : 'Igual a la proyeccion'}</small>
          <dl>
            <div><dt>${item.key === 'investment' ? 'Presupuesto diario requerido' : 'Ritmo requerido'}</dt><dd>${formatPace(item.scenarioPace, item.unit)} ${perDay}</dd></div>
            <div><dt>Ritmo actual</dt><dd>${formatPace(item.pace, item.unit)} ${perDay}${scenario.active && item.paceChangePct != null ? ` (${signedPct(item.paceChangePct)})` : ''}</dd></div>
            <div><dt>Falta realizar</dt><dd>${format(Math.max(0, item.target - item.actual), item.unit)} en ${projection.daysLeft} dias</dd></div>
            ${referenceRow(item)}
          </dl>
        </div>`;
    });

    const spend = scenario.byKey.investment;
    cards.push(`
      <div class="sim-card efficiency">
        <span>Eficiencia del escenario</span>
        <strong>${signed(spend.delta, 'money')}</strong>
        <small class="sim-delta ${!scenario.active ? '' : spend.delta >= 0 ? 'up' : 'down'}">Inversion ${spend.delta >= 0 ? 'adicional' : 'menor'} vs el ritmo actual</small>
        <dl>
          <div><dt>CPC</dt><dd>${money(projection.costPerClick)}</dd></div>
          <div><dt>Costo por conversacion</dt><dd>${money(projection.costPerConversion)}</dd></div>
          <div><dt>Tasa de conversion</dt><dd>${projection.conversionRate == null ? '-' : `${projection.conversionRate.toFixed(1)}%`}</dd></div>
        </dl>
      </div>`);

    grid.innerHTML = cards.join('');

    if (note) {
      note.textContent = `El escenario conserva la eficiencia real del mes (CPC, costo por conversacion y tasa de conversion): mover un indicador recalcula los otros dos en la misma proporcion. El cierre objetivo no puede quedar por debajo de lo ya realizado al ${projection.daysWithData}-${projection.shortMonth}.`;
    }
  }

  function renderHeader(projection) {
    const title = document.getElementById('projection-title');
    if (title) title.textContent = `Linea de tiempo | ${projection.monthLabel}`;
    const sub = document.getElementById('projection-sub');
    if (sub) {
      sub.textContent = projection.closed
        ? `Mes cerrado con ${projection.daysInMonth} dias de datos.`
        : `Datos reales hasta el dia ${projection.daysWithData} y proyeccion lineal hasta el ${projection.daysInMonth}.`;
    }
    const note = document.getElementById('projection-note');
    if (note) {
      const budget = projection.budget
        ? ` Presupuesto = presupuesto diario de las campanas habilitadas en el informe (${money(projection.dailyBudget)}) x ${projection.daysInMonth} dias.`
        : '';
      note.textContent = `La proyeccion asume que se mantiene el ritmo promedio del mes (${money(projection.byKey.investment.pace)} por dia).${budget} Fuente: ${projection.source || 'Gasto Publicitario'}.`;
    }
    const desc = document.getElementById('projection-desc');
    if (desc) {
      desc.textContent = `Proyeccion al cierre de ${projection.monthLabel} calculada con los datos reales del modulo Gasto Publicitario, actualizados al ${longDate(projection.cutoffDate)}.`;
    }
  }

  // Sin nada que proyectar se oculta el panel en vez de vaciarlo: si luego llegan datos, se vuelve a usar.
  function toggleEmpty(empty) {
    const panel = document.getElementById('projection-panel');
    const notice = document.getElementById('projection-empty');
    const kpis = document.getElementById('projection-kpis');
    if (panel) panel.hidden = empty;
    if (notice) notice.hidden = !empty;
    if (kpis) kpis.hidden = empty;
  }

  function renderEmpty() {
    toggleEmpty(true);
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    const body = document.getElementById('projection-body');
    if (body) body.innerHTML = '<tr><td class="table-empty" colspan="6">Sin datos para proyectar.</td></tr>';
  }

  function renderWaiting() {
    const sub = document.getElementById('projection-sub');
    if (sub) sub.textContent = 'Esperando los datos del modulo Gasto Publicitario...';
    const body = document.getElementById('projection-body');
    if (body) body.innerHTML = '<tr><td class="table-empty" colspan="6">Esperando los datos del modulo Gasto Publicitario...</td></tr>';
  }

  function render() {
    // El modulo puede abrirse antes de que Gasto Publicitario termine de cargar; el evento aquarius:data-ready lo reintenta.
    const snapshot = window.AquariusDashboard?.snapshot?.();
    if (!snapshot) {
      renderWaiting();
      return;
    }
    const projection = buildProjection(snapshot);
    state.projection = projection;
    if (!projection) {
      renderEmpty();
      return;
    }
    toggleEmpty(false);
    renderHeader(projection);
    renderKpis(projection);
    renderChart(projection);
    renderTable(projection);
    renderSimulator(projection);
  }

  function handlePosition(chart, projection, metric) {
    const target = buildScenario(projection).byKey[metric.key].target;
    return { x: chart.scales.x.getPixelForValue(projection.daysInMonth - 1), y: chart.scales.y.getPixelForValue(target) };
  }

  // Misma conversion que usa Chart.js internamente; offsetX falla con zoom o transformaciones CSS.
  function pointerPosition(event, chart) {
    if (Chart.helpers?.getRelativePosition) return Chart.helpers.getRelativePosition(event, chart);
    const rect = chart.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function nearHandle(event) {
    const chart = state.chart;
    const projection = state.projection;
    if (!chart || !projection) return false;
    const metric = projection.byKey[state.metric];
    if (!metric || !canSimulate(projection, metric)) return false;
    const point = handlePosition(chart, projection, metric);
    const pointer = pointerPosition(event, chart);
    return Math.hypot(pointer.x - point.x, pointer.y - point.y) <= HANDLE_HIT_RADIUS;
  }

  function wireDrag() {
    const canvas = document.getElementById('chart-projection');
    if (!canvas) return;

    canvas.addEventListener('pointerdown', event => {
      if (!nearHandle(event)) return;
      event.preventDefault();
      state.dragging = true;
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
      // Se congela la escala durante el arrastre para que el eje no salte bajo el cursor.
      state.chart.options.scales.y.max = state.chart.scales.y.max;
      state.chart.update('none');
    });

    canvas.addEventListener('pointermove', event => {
      if (!state.dragging) {
        canvas.style.cursor = nearHandle(event) ? 'ns-resize' : '';
        return;
      }
      const chart = state.chart;
      const projection = state.projection;
      const metric = projection.byKey[state.metric];
      const { top, bottom } = chart.chartArea;
      const y = Math.min(bottom, Math.max(top, pointerPosition(event, chart).y));
      setTarget(projection, metric, chart.scales.y.getValueForPixel(y));
      updateScenario(projection);
    });

    // Al soltar se recrea la grafica: eso libera la escala y la ajusta al nuevo objetivo.
    const endDrag = event => {
      if (!state.dragging) return;
      state.dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.style.cursor = '';
      if (state.projection) renderChart(state.projection);
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    canvas.addEventListener('dblclick', event => {
      if (!nearHandle(event) || !state.projection) return;
      state.factor = 1;
      renderChart(state.projection);
      renderSimulator(state.projection);
    });
  }

  function wireSimulator() {
    const input = document.getElementById('projection-sim-value');
    input?.addEventListener('input', () => {
      const projection = state.projection;
      if (!projection || input.value === '') return;
      const metric = projection.byKey[state.metric];
      const value = Number(input.value);
      // Mientras se escribe, un valor por debajo de lo realizado se ignora en vez de corregirlo a mitad de tecleo.
      if (!Number.isFinite(value) || value < metric.actual) return;
      setTarget(projection, metric, value);
      renderChart(projection);
      renderSimulator(projection);
    });
    input?.addEventListener('change', () => {
      const projection = state.projection;
      if (!projection) return;
      const metric = projection.byKey[state.metric];
      if (input.value !== '') setTarget(projection, metric, Number(input.value));
      input.blur();
      renderChart(projection);
      renderSimulator(projection);
    });

    document.getElementById('projection-sim-goal')?.addEventListener('click', () => {
      const projection = state.projection;
      if (!projection) return;
      const metric = projection.byKey[state.metric];
      if (metric.reference == null) return;
      setTarget(projection, metric, metric.reference);
      renderChart(projection);
      renderSimulator(projection);
    });

    document.getElementById('projection-sim-reset')?.addEventListener('click', () => {
      state.factor = 1;
      if (!state.projection) return;
      renderChart(state.projection);
      renderSimulator(state.projection);
    });
  }

  function wireEvents() {
    document.getElementById('projection-metrics')?.addEventListener('change', event => {
      const input = event.target.closest('input[type="radio"]');
      if (!input) return;
      state.metric = input.value;
      document.querySelectorAll('#projection-metrics .series-toggle').forEach(label => {
        label.classList.toggle('active', label.dataset.series === state.metric);
      });
      if (state.projection) {
        renderChart(state.projection);
        renderSimulator(state.projection);
      }
    });

    wireDrag();
    wireSimulator();

    window.addEventListener('aquarius:data-ready', () => {
      if (state.ready) render();
    });
  }

  function init() {
    if (!state.ready) {
      wireEvents();
      state.ready = true;
    }
    render();
  }

  window.AquariusProjections = { init, render };
})();
