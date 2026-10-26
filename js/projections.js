(function () {
  const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const SHORT_MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const METRICS = {
    investment: { key: 'investment', label: 'Inversión', unit: 'money', color: '#2563eb', fill: 'rgba(37,99,235,.10)', field: 'cost', reference: 'budget', referenceLabel: 'Presupuesto' },
    clicks: { key: 'clicks', label: 'Clics', unit: 'count', color: '#d97706', fill: 'rgba(217,119,6,.10)', field: 'clicks', reference: null, referenceLabel: null },
    conversions: { key: 'conversions', label: 'Conversaciones', unit: 'count', color: '#16a34a', fill: 'rgba(22,163,74,.10)', field: 'conversions', reference: null, referenceLabel: null }
  };

  // Los botones del grafico siguen a Tierra Films; los clics quedan en la tabla y en el simulador.
  const CHART_ORDER = ['investment', 'conversions', 'costPerConversion'];
  const RATIO_METRIC = {
    key: 'costPerConversion', label: 'Costo x conversación', unit: 'money',
    color: '#0f766e', fill: 'transparent', ratio: true, drag: false,
    reference: null, referenceLabel: null
  };

  const SCENARIO_COLOR = '#7c3aed';
  const HANDLE_HIT_RADIUS = 16;
  // Orden fijo de datasets para poder actualizar el escenario mientras se arrastra sin recrear la grafica.
  const DS = { real: 0, forecast: 1, scenario: 2, handle: 3, reference: 4 };

  // factor = cierre objetivo / cierre proyectado. Es comun a los tres indicadores porque el escenario
  // mantiene el CPC y la tasa de conversion del mes; asi cambiar de indicador conserva el escenario.
  // goal = cierre objetivo en conversaciones; marginalCpa = lo que cuesta cada una de las que faltan.
  const state = { ready: false, metric: 'investment', chart: null, projection: null, goal: null, marginalCpa: null, dragging: false };

  const money = value => Number.isFinite(Number(value))
    ? `S/. ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';
  const count = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('es-PE', { maximumFractionDigits: 0 }) : '—';
  const format = (value, unit) => (unit === 'money' ? money(value) : count(Math.round(Number(value) || 0)));
  const signed = (value, unit) => `${value >= 0 ? '+' : '-'}${format(Math.abs(value), unit)}`;
  // Los ritmos de conteo se muestran con un decimal: 0.8 conversaciones por dia no debe verse como 1.
  const formatPace = (value, unit) => (unit === 'money' ? money(value) : Number(value || 0).toLocaleString('es-PE', { maximumFractionDigits: 1 }));
  const signedPct = value => (value == null ? '' : `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(1)}%`);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function toDate(iso) {
    const value = /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? `${iso}T00:00:00` : iso;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function longDate(date) {
    return date ? `${date.getDate()} de ${MONTHS[date.getMonth()].toLowerCase()} de ${date.getFullYear()}` : '—';
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
    byKey.costPerConversion = {
      ...RATIO_METRIC,
      actual: conversions.actual ? spend.actual / conversions.actual : null,
      pace: null,
      projected: conversions.projected ? spend.projected / conversions.projected : null,
      gap: null
    };

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
      projectedCostPerConversion: conversions.projected ? spend.projected / conversions.projected : null,
      monthIndex,
      // Las impresiones no entran al grafico, pero si a la tabla de cierre y a las semanas que faltan.
      impressions: (() => {
        const actual = Number(month.impressions) || 0;
        const pace = actual / daysWithData;
        return { actual, pace, projected: closed ? actual : pace * daysInMonth };
      })(),
      campaigns: month.campaigns || [],
      previous: (snapshot.months || []).find(item => item.id === previousMonth(month.id)) || null
    };
  }

  const previousMonth = monthId => {
    const [year, month] = monthId.split('-').map(Number);
    return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  };

  // Un cuadro por campana del mes proyectado, con el mismo metodo que la proyeccion general: ritmo diario de la
  // campana x dias del mes. Se suman las campanas con gasto el mes anterior que aun no salen en el informe, para
  // que ninguna quede fuera. Una campana detenida cierra con lo ya gastado.
  function buildCampaignProjections(projection) {
    const current = projection.campaigns;
    const previous = (projection.previous?.campaigns || []).filter(campaign => Number(campaign.cost) > 0);
    const names = [...new Set([...current, ...previous].map(campaign => campaign.campaign))];
    return names.map(name => {
      const now = current.find(campaign => campaign.campaign === name) || null;
      const before = previous.find(campaign => campaign.campaign === name) || null;
      // El informe del mes proyectado es el mas reciente: manda en estado y presupuesto.
      const info = now || before;
      const active = !info.status || /^habilitad/i.test(info.status);
      const dailyBudget = Number(info.dailyBudget) || null;
      const metrics = Object.values(METRICS).map(metric => {
        const actual = Number(now?.[metric.field]) || 0;
        const pace = actual / projection.daysWithData;
        const projected = projection.closed || !active ? actual : pace * projection.daysInMonth;
        const reference = metric.reference === 'budget' && active && dailyBudget ? dailyBudget * projection.daysInMonth : null;
        return { ...metric, actual, pace, projected, reference, gap: reference == null ? null : reference - projected };
      });
      return {
        label: info.label || info.campaign,
        campaign: info.campaign,
        status: info.status || null,
        active,
        dailyBudget,
        metrics,
        byKey: Object.fromEntries(metrics.map(metric => [metric.key, metric])),
        previousCost: before ? Number(before.cost) : null
      };
    }).sort((a, b) => b.byKey.investment.projected - a.byKey.investment.projected || (b.previousCost || 0) - (a.previousCost || 0));
  }

  function canSimulate(projection, metric) {
    return !projection.closed && metric.drag !== false && metric.projected > 0;
  }

  // Costo de cada conversación adicional: por defecto el que proyecta el mes.
  function baseCpa(projection) {
    const { investment, conversions } = projection.byKey;
    if (conversions.projected > 0) return investment.projected / conversions.projected;
    return projection.costPerConversion || 0;
  }

  function marginalCpa(projection) {
    return Number.isFinite(state.marginalCpa) && state.marginalCpa > 0 ? state.marginalCpa : baseCpa(projection);
  }

  // El cierre objetivo nunca puede quedar por debajo de lo ya realizado.
  function goalOf(projection) {
    const conversions = projection.byKey.conversions;
    const goal = Number.isFinite(state.goal) ? state.goal : conversions.projected;
    return Math.max(conversions.actual, goal);
  }

  // El objetivo se fija en conversaciones; el gasto sale del costo marginal y el
  // resto de los indicadores sigue la misma proporcion.
  function setTarget(projection, metric, value) {
    if (!canSimulate(projection, metric)) return;
    const conversions = projection.byKey.conversions;
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    if (metric.key === 'conversions') {
      state.goal = number;
      return;
    }
    if (metric.key === 'investment') {
      const cpa = marginalCpa(projection);
      state.goal = cpa > 0
        ? conversions.actual + (number - projection.byKey.investment.actual) / cpa
        : conversions.projected;
      return;
    }
    const ratio = metric.projected > 0 ? number / metric.projected : 1;
    state.goal = conversions.projected * ratio;
  }

  function buildScenario(projection) {
    const conversions = projection.byKey.conversions;
    const investment = projection.byKey.investment;
    const goal = goalOf(projection);
    const cpa = marginalCpa(projection);
    const cost = investment.actual + (goal - conversions.actual) * cpa;
    const ratio = conversions.projected > 0 ? goal / conversions.projected : 1;
    const metrics = projection.metrics.map(metric => {
      let target;
      if (metric.key === 'conversions') target = goal;
      else if (metric.key === 'investment') target = cost;
      else target = metric.projected * ratio;
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
    return {
      goal,
      cpa,
      ratio,
      active: Math.abs(goal - conversions.projected) > 0.05 || (Number.isFinite(state.marginalCpa) && state.marginalCpa > 0),
      metrics,
      byKey: Object.fromEntries(metrics.map(metric => [metric.key, metric]))
    };
  }

  function renderKpis(projection) {
    const host = document.getElementById('projection-kpis');
    if (!host) return;
    const { investment, clicks, conversions } = projection.byKey;
    const previous = projection.previous;
    const before = previous ? Number(previous.conversions) || 0 : 0;
    const cards = [
      [`Gasto al ${projection.daysWithData}-${projection.shortMonth}`, money(investment.actual),
        `${projection.daysWithData} de ${projection.daysInMonth} días`],
      ['Gasto proyectado', money(investment.projected),
        projection.budget ? `${projection.budgetProjectedPct.toFixed(0)}% del presupuesto (${money(projection.budget)})` : 'Al cierre del mes'],
      ['Conversaciones proyectadas', count(Math.round(conversions.projected)),
        before ? `${count(Math.round(before))} en ${String(previous.name || previous.label || '').toLowerCase()}` : `${count(Math.round(conversions.actual))} reales`],
      ['Costo x conversación', money(projection.projectedCostPerConversion),
        `Real a la fecha ${money(projection.costPerConversion)}`],
      ['Clics proyectados', count(Math.round(clicks.projected)), `CPC ${money(projection.projectedCostPerClick)}`],
      ['Días restantes', String(projection.daysLeft),
        projection.daysLeft ? `Del ${projection.daysWithData + 1} al ${projection.daysInMonth} ${projection.shortMonth.toLowerCase()}` : 'Mes cerrado']
    ];
    host.innerHTML = cards.map(([label, value, hint]) => `
      <div class="kpi-pill">
        <span>${label}</span>
        <strong>${value}</strong>
        <small>${hint}</small>
      </div>
    `).join('');
  }

  // Botones del grafico, como en Tierra Films: gasto, conversaciones y el cociente entre ambos.
  function renderToggles(projection) {
    const host = document.getElementById('projection-metrics');
    if (!host) return;
    host.innerHTML = CHART_ORDER.map(key => {
      const metric = projection.byKey[key];
      if (!metric) return '';
      const active = key === state.metric;
      const style = active ? ` style="color:${metric.color};border-color:${metric.color};background:${metric.color}14"` : '';
      return `<label class="series-toggle${active ? ' active' : ''}" data-series="${key}"${style}><input type="radio" name="projection-metric" value="${key}"${active ? ' checked' : ''}>${metric.label}</label>`;
    }).join('');
  }

  const ratioOf = (top, bottom) => (Number(bottom) > 0 ? Number(top) / Number(bottom) : null);
  const shareOf = (top, bottom) => (Number(bottom) > 0 ? (Number(top) / Number(bottom)) * 100 : null);

  function cell(value, unit) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    if (unit === 'percent') return `${Number(value).toLocaleString('es-PE', { maximumFractionDigits: 2 })}%`;
    return format(value, unit);
  }

  // Verde cuando el cierre mejora el mes anterior; inverse invierte la lectura
  // en los costos, donde bajar es lo bueno.
  function gapBadge(value, reference, inverse) {
    if (!Number.isFinite(Number(value)) || !Number.isFinite(Number(reference)) || Number(reference) === 0) {
      return '<span class="projection-gap">—</span>';
    }
    const diff = Number(value) / Number(reference) - 1;
    const good = inverse ? diff <= 0 : diff >= 0;
    return `<span class="projection-gap ${good ? 'ok' : 'over'}">${diff > 0 ? '+' : ''}${(diff * 100).toLocaleString('es-PE', { maximumFractionDigits: 1 })}%</span>`;
  }

  function renderTable(projection) {
    const body = document.getElementById('projection-body');
    if (!body) return;
    const scenario = buildScenario(projection);
    const previous = projection.previous;
    const { investment, clicks, conversions } = projection.byKey;
    const sim = scenario.byKey;
    const impressions = projection.impressions;
    const simImpressions = impressions.projected * scenario.ratio;
    const prev = field => (previous ? Number(previous[field]) || 0 : null);

    const rows = [
      { label: 'Gasto', unit: 'money', actual: investment.actual, pace: investment.pace, close: investment.projected, sim: sim.investment.target, ref: prev('cost') },
      { label: 'Conversaciones', unit: 'count', actual: conversions.actual, pace: conversions.pace, close: conversions.projected, sim: sim.conversions.target, ref: prev('conversions') },
      { label: 'Costo x conversación', unit: 'money', rate: true, inverse: true, actual: ratioOf(investment.actual, conversions.actual), close: ratioOf(investment.projected, conversions.projected), sim: ratioOf(sim.investment.target, sim.conversions.target), ref: previous ? ratioOf(previous.cost, previous.conversions) : null },
      { label: 'Impresiones', unit: 'count', actual: impressions.actual, pace: impressions.pace, close: impressions.projected, sim: simImpressions, ref: prev('impressions') },
      { label: 'Clics', unit: 'count', actual: clicks.actual, pace: clicks.pace, close: clicks.projected, sim: sim.clicks.target, ref: prev('clicks') },
      { label: 'CTR', unit: 'percent', rate: true, actual: shareOf(clicks.actual, impressions.actual), close: shareOf(clicks.projected, impressions.projected), sim: shareOf(sim.clicks.target, simImpressions), ref: previous ? shareOf(previous.clicks, previous.impressions) : null },
      { label: 'CPC medio', unit: 'money', rate: true, inverse: true, actual: ratioOf(investment.actual, clicks.actual), close: ratioOf(investment.projected, clicks.projected), sim: ratioOf(sim.investment.target, sim.clicks.target), ref: previous ? ratioOf(previous.cost, previous.clicks) : null }
    ];

    body.innerHTML = rows.map(row => `
        <tr class="${row.rate ? 'projection-cost-row' : ''}">
          <td>${row.label}</td>
          <td class="num">${cell(row.actual, row.unit)}</td>
          <td class="num">${row.rate ? '—' : formatPace(row.pace, row.unit)}</td>
          <td class="num projection-value">${cell(row.close, row.unit)}</td>
          <td class="num projection-sim-value">${cell(row.sim, row.unit)}</td>
          <td class="num">${cell(row.ref, row.unit)}</td>
          <td>${row.ref == null ? '<span class="projection-gap">—</span>' : gapBadge(row.close, row.ref, row.inverse)}</td>
        </tr>`).join('');

    const set = (id, text) => { const node = document.getElementById(id); if (node) node.textContent = text; };
    set('projection-actual-head', `Real al ${projection.daysWithData}-${projection.shortMonth}`);
    set('projection-close-head', `Cierre ${projection.monthLabel.split(' ')[0]}`);
    set('projection-sim-head', scenario.active ? 'Simulación' : 'Simulación (=)');
    set('projection-ref-head', previous ? previous.label || previous.name : 'Mes anterior');
    set('projection-table-sub', `Ritmo diario = acumulado real / ${projection.daysWithData} días con datos. Cierre = real + ritmo diario x ${projection.daysLeft} días restantes.`);
  }

  // Semanas que faltan para cerrar el mes, con el ritmo del escenario.
  function renderWeeks(projection) {
    const body = document.getElementById('projection-weeks-body');
    if (!body) return;
    const scenario = buildScenario(projection);
    const left = projection.daysLeft;
    const sub = document.getElementById('projection-weeks-sub');
    if (sub) {
      sub.textContent = scenario.active
        ? 'Lo que tendría que aportar cada semana restante para llegar al cierre simulado.'
        : 'Lo que aportaría cada semana restante del mes al ritmo actual.';
    }
    if (!left) {
      body.innerHTML = '<tr><td colspan="7" class="table-empty">El mes ya está cerrado con datos reales.</td></tr>';
      return;
    }
    const rate = {
      cost: (scenario.byKey.investment.target - projection.byKey.investment.actual) / left,
      conversions: (scenario.byKey.conversions.target - projection.byKey.conversions.actual) / left,
      clicks: projection.byKey.clicks.pace * scenario.ratio,
      impressions: projection.impressions.pace * scenario.ratio
    };
    // Las semanas van de lunes a domingo y se cortan al terminar el mes.
    const weeks = [];
    for (let day = projection.daysWithData + 1; day <= projection.daysInMonth; day += 1) {
      const date = new Date(projection.year, projection.monthIndex, day);
      const last = weeks[weeks.length - 1];
      if (!last || date.getDay() === 1) weeks.push({ start: day, end: day });
      else last.end = day;
    }
    body.innerHTML = weeks.map(week => {
      const days = week.end - week.start + 1;
      const cost = rate.cost * days;
      const conversions = rate.conversions * days;
      return `
        <tr>
          <td class="campaign-name"><span>${week.start} - ${week.end} ${projection.shortMonth}</span><small>${days} ${days === 1 ? 'día' : 'días'}</small></td>
          <td class="num">${money(cost)}</td>
          <td class="num">${money(cost / days)}</td>
          <td class="num">${count(Math.round(rate.impressions * days))}</td>
          <td class="num">${count(Math.round(rate.clicks * days))}</td>
          <td class="num">${Number(conversions).toLocaleString('es-PE', { maximumFractionDigits: 1 })}</td>
          <td class="num">${money(conversions > 0 ? cost / conversions : null)}</td>
        </tr>`;
    }).join('');
  }

  function renderLegend(projection, metric, scenario) {
    const host = document.getElementById('projection-legend');
    if (!host) return;
    const items = [
      `<span><i class="legend-line" style="background:${metric.color}"></i><b>Acumulado real</b></span>`
    ];
    if (!projection.closed) {
      items.push(`<span style="color:${metric.color}"><i class="legend-line dashed"></i><b>Proyección al cierre</b></span>`);
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

  function scenarioSeries(projection, metric, scenario) {
    const days = projection.daysInMonth;
    const lastIndex = days - 1;
    if (metric.ratio) {
      // El cociente no se arrastra: su linea sale de acumular el gasto y las conversiones del escenario.
      const spend = projection.byKey.investment;
      const conversions = projection.byKey.conversions;
      const costPerDay = scenario.byKey.investment.scenarioPace || 0;
      const convPerDay = scenario.byKey.conversions.scenarioPace || 0;
      const lineData = Array.from({ length: days }, (_, index) => {
        const step = index + 1 - projection.daysWithData;
        if (step < 0) return null;
        const conv = conversions.actual + convPerDay * step;
        return conv > 0 ? (spend.actual + costPerDay * step) / conv : null;
      });
      return { lineData, handleData: Array.from({ length: days }, () => null) };
    }
    const scenarioMetric = scenario.byKey[metric.key];
    const simulable = canSimulate(projection, metric);
    const lineData = Array.from({ length: days }, (_, index) => (
      index + 1 >= projection.daysWithData
        ? metric.actual + scenarioMetric.scenarioPace * (index + 1 - projection.daysWithData)
        : null
    ));
    const handleData = Array.from({ length: days }, (_, index) => (index === lastIndex && simulable ? scenarioMetric.target : null));
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
      ctx.fillStyle = '#94a3b8';
      ctx.font = '700 9px Inter, sans-serif';
      ctx.textAlign = x > (chart.chartArea.left + chart.chartArea.right) / 2 ? 'right' : 'left';
      ctx.fillText(options.label || 'Última actualización', x + (ctx.textAlign === 'right' ? -6 : 6), top + 10);
      ctx.restore();
    }
  };

  function renderChart(projection) {
    const canvas = document.getElementById('chart-projection');
    if (!canvas) return;
    if (typeof Chart === 'undefined') {
      canvas.parentElement.innerHTML = '<div class="empty-state"><strong>Gráfico no disponible sin conexión.</strong><span>El simulador sigue funcionando con el campo numérico.</span></div>';
      return;
    }
    const metric = projection.byKey[state.metric] || projection.byKey.investment;
    const labels = Array.from({ length: projection.daysInMonth }, (_, index) => `${index + 1} ${projection.shortMonth}`);
    // El cociente se acumula aparte: gasto acumulado entre conversiones acumuladas.
    const spend = projection.byKey.investment;
    const conv = projection.byKey.conversions;
    const at = index => (metric.ratio
      ? (conv.pace * (index + 1) > 0 ? (spend.pace * (index + 1)) / (conv.pace * (index + 1)) : null)
      : metric.pace * (index + 1));
    const real = labels.map((_, index) => (index + 1 <= projection.daysWithData ? at(index) : null));
    const forecast = labels.map((_, index) => (index + 1 >= projection.daysWithData ? at(index) : null));

    const scenario = buildScenario(projection);
    const scenarioMetric = scenario.byKey[metric.key] || null;
    const series = scenarioSeries(projection, metric, scenario);
    const handleColor = scenario.active ? SCENARIO_COLOR : metric.color;

    const datasets = [
      { label: metric.ratio ? 'Real a la fecha' : 'Acumulado real', data: real, borderColor: metric.color, backgroundColor: metric.fill, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .15, fill: !metric.ratio },
      { label: 'Proyección al cierre', data: projection.closed ? [] : forecast, borderColor: scenario.active ? `${metric.color}66` : metric.color, borderDash: [6, 5], borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .15, fill: false },
      { label: 'Escenario objetivo', data: scenario.active ? series.lineData : [], borderColor: SCENARIO_COLOR, borderDash: [2, 4], borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, tension: 0, fill: false },
      { label: 'Cierre objetivo', data: series.handleData, showLine: false, pointRadius: 7, pointHoverRadius: 9, pointBorderWidth: 3, pointBackgroundColor: '#fff', pointBorderColor: handleColor, pointHoverBackgroundColor: '#fff', pointHoverBorderColor: handleColor, borderColor: handleColor }
    ];
    if (metric.reference != null) {
      datasets.push({ label: metric.referenceLabel, data: labels.map(() => metric.reference), borderColor: '#94a3b8', borderDash: [3, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, fill: false });
    }
    // Margen sobre el cierre para que el nodo tenga recorrido hacia arriba al arrastrarlo.
    const suggestedMax = metric.ratio
      ? undefined
      : Math.max(metric.projected * 1.4, (metric.reference || 0) * 1.1, scenarioMetric.target * 1.25);

    const ticks = metric.ratio
      ? value => `S/. ${Number(value).toLocaleString('es-PE', { maximumFractionDigits: 2 })}`
      : metric.unit === 'money'
        ? value => (value === 0 ? 'S/. 0' : `S/. ${(value / 1000).toFixed(1)}k`)
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
          x: { grid: { display: false }, border: { color: '#cbd5e1' }, ticks: { color: '#94a3b8', font: { size: 10 }, maxTicksLimit: 10, autoSkip: true } },
          y: { beginAtZero: !metric.ratio, suggestedMax, border: { display: false }, grid: { color: 'rgba(15,23,42,.06)' }, ticks: { color: '#94a3b8', font: { size: 10 }, callback: ticks } }
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
      const series = scenarioSeries(projection, metric, scenario);
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
    const conversions = projection.byKey.conversions;
    const simulable = canSimulate(projection, conversions);

    const goalInput = document.getElementById('projection-goal');
    const cpaInput = document.getElementById('projection-cpa');
    const prevButton = document.getElementById('projection-sim-prev');
    const resetButton = document.getElementById('projection-sim-reset');
    const sub = document.getElementById('projection-sim-sub');
    const note = document.getElementById('projection-sim-note');

    // No se pisa lo que el usuario esta escribiendo.
    if (goalInput) {
      goalInput.disabled = !simulable;
      goalInput.min = String(Math.ceil(conversions.actual));
      if (document.activeElement !== goalInput) goalInput.value = simulable ? String(Math.round(scenario.goal)) : '';
    }
    if (cpaInput) {
      cpaInput.disabled = !simulable;
      if (document.activeElement !== cpaInput) cpaInput.value = simulable ? scenario.cpa.toFixed(2) : '';
    }
    if (resetButton) resetButton.disabled = !scenario.active;
    if (prevButton) {
      const before = projection.previous ? Number(projection.previous.conversions) || 0 : 0;
      prevButton.hidden = !(simulable && before > 0);
      if (!prevButton.hidden) prevButton.textContent = `Igualar ${projection.previous.name || 'mes anterior'} (${count(Math.round(before))})`;
    }

    if (!simulable) {
      const reason = projection.closed
        ? `${projection.monthLabel} ya cerró: el simulador se activa con el informe del mes en curso.`
        : 'Todavía no hay conversaciones registradas para simular.';
      if (sub) sub.textContent = reason;
      grid.innerHTML = `<div class="empty-state projection-sim-empty"><strong>Simulador no disponible</strong>${reason}</div>`;
      if (note) note.textContent = '';
      return;
    }

    if (sub) {
      sub.textContent = scenario.active
        ? `Escenario: cerrar ${projection.monthLabel} con ${count(Math.round(scenario.goal))} conversaciones (${signedPct(scenario.byKey.conversions.deltaPct)} vs la proyección).`
        : 'Arrastra el nodo del último día de la gráfica o escribe la meta: se recalcula cuánto gasto exigen esas conversaciones.';
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
      const perDay = item.unit === 'money' ? '/ día' : 'por día';
      return `
        <div class="sim-card ${item.key === metric.key ? 'selected' : ''}">
          <span>${item.label} al cierre</span>
          <strong>${format(item.target, item.unit)}</strong>
          <small class="sim-delta ${trend}">${scenario.active ? `${signed(item.delta, item.unit)} vs proyección (${signedPct(item.deltaPct)})` : 'Igual a la proyección'}</small>
          <dl>
            <div><dt>${item.key === 'investment' ? 'Presupuesto diario requerido' : 'Ritmo requerido'}</dt><dd>${formatPace(item.scenarioPace, item.unit)} ${perDay}</dd></div>
            <div><dt>Ritmo actual</dt><dd>${formatPace(item.pace, item.unit)} ${perDay}${scenario.active && item.paceChangePct != null ? ` (${signedPct(item.paceChangePct)})` : ''}</dd></div>
            <div><dt>Falta realizar</dt><dd>${format(Math.max(0, item.target - item.actual), item.unit)} en ${projection.daysLeft} días</dd></div>
            ${referenceRow(item)}
          </dl>
        </div>`;
    });

    const spend = scenario.byKey.investment;
    cards.push(`
      <div class="sim-card efficiency">
        <span>Eficiencia del escenario</span>
        <strong>${signed(spend.delta, 'money')}</strong>
        <small class="sim-delta ${!scenario.active ? '' : spend.delta >= 0 ? 'up' : 'down'}">Inversión ${spend.delta >= 0 ? 'adicional' : 'menor'} vs el ritmo actual</small>
        <dl>
          <div><dt>CPC</dt><dd>${money(projection.costPerClick)}</dd></div>
          <div><dt>Costo por conversación</dt><dd>${money(projection.costPerConversion)}</dd></div>
          <div><dt>Tasa de conversión</dt><dd>${projection.conversionRate == null ? '—' : `${projection.conversionRate.toFixed(1)}%`}</dd></div>
        </dl>
      </div>`);

    grid.innerHTML = cards.join('');

    if (note) {
      note.textContent = scenario.active
        ? `Frente a la proyección base: ${signed(scenario.byKey.conversions.delta, 'count')} conversaciones y ${signed(scenario.byKey.investment.delta, 'money')} de gasto, a ${money(scenario.cpa)} cada conversación adicional. Cambia ese costo marginal si esperas que las conversaciones extra salgan más caras.`
        : `La simulación arranca en la proyección del mes. Cada conversación adicional se valoriza a ${money(scenario.cpa)}: cámbialo si esperas que salgan más caras. El cierre no puede quedar por debajo de lo ya realizado al ${projection.daysWithData}-${projection.shortMonth}.`;
    }
  }

  function renderHeader(projection) {
    const title = document.getElementById('projection-title');
    if (title) title.textContent = `Línea de tiempo | ${projection.monthLabel}`;
    const sub = document.getElementById('projection-sub');
    if (sub) {
      sub.textContent = projection.closed
        ? `Mes cerrado con ${projection.daysInMonth} días de datos.`
        : `Datos reales hasta el día ${projection.daysWithData} y proyección lineal hasta el ${projection.daysInMonth}.`;
    }
    const note = document.getElementById('projection-note');
    if (note) {
      const budget = projection.budget
        ? ` Presupuesto = presupuesto diario de las campañas habilitadas en el informe (${money(projection.dailyBudget)}) x ${projection.daysInMonth} días.`
        : '';
      note.textContent = `La proyección asume que se mantiene el ritmo promedio del mes (${money(projection.byKey.investment.pace)} por día).${budget} Fuente: ${projection.source || 'Gasto publicitario'}.`;
    }
    const desc = document.getElementById('projection-desc');
    if (desc) {
      desc.textContent = `Proyección al cierre de ${projection.monthLabel} calculada con los datos reales del módulo Gasto publicitario, actualizados al ${longDate(projection.cutoffDate)}.`;
    }
  }

  function campaignCard(card, projection, previousName) {
    const spend = card.byKey.investment;
    const realDay = `${projection.daysWithData}-${projection.shortMonth}`;
    const closeDay = `${projection.daysInMonth}-${projection.shortMonth}`;
    const rows = card.metrics.map(metric => `
          <tr>
            <td>${metric.label}</td>
            <td class="num">${format(metric.actual, metric.unit)}</td>
            <td class="num">${formatPace(metric.pace, metric.unit)}</td>
            <td class="num projection-value">${format(metric.projected, metric.unit)}</td>
          </tr>`).join('');

    let budget;
    if (!card.active) {
      budget = `<p class="campaign-card-note">${escapeHtml(card.status)}: cierra el mes con lo ya gastado.</p>`;
    } else if (spend.reference == null) {
      budget = '<p class="campaign-card-note">El informe no trae presupuesto diario para esta campaña.</p>';
    } else {
      const pct = (spend.projected / spend.reference) * 100;
      const over = spend.gap < 0;
      budget = `
        <div class="campaign-card-budget">
          <div><span>Presupuesto del mes</span><b>${money(spend.reference)}</b></div>
          <div class="campaign-meter" role="img" aria-label="Proyección al ${pct.toFixed(0)}% del presupuesto"><i class="${over ? 'over' : ''}" style="width:${Math.min(100, pct).toFixed(1)}%"></i></div>
          <div><small>${money(card.dailyBudget)} x ${projection.daysInMonth} días | proyección al ${pct.toFixed(0)}%</small><span class="projection-gap ${over ? 'over' : 'ok'}">${over ? 'Excede' : 'Quedan'} ${money(Math.abs(spend.gap))}</span></div>
        </div>`;
    }

    const clicks = card.byKey.clicks.actual;
    const conversions = card.byKey.conversions.actual;
    const facts = [
      ['CPC', clicks ? money(spend.actual / clicks) : '—'],
      ['Costo x conversación', conversions ? money(spend.actual / conversions) : '—']
    ];
    if (previousName) facts.push([`Gasto ${previousName.toLowerCase()}`, card.previousCost == null ? '—' : money(card.previousCost)]);

    return `
      <article class="campaign-card">
        <header class="campaign-card-head">
          <div class="campaign-name"><span>${escapeHtml(card.label)}</span><small>${escapeHtml(card.campaign)}</small></div>
          ${card.status ? `<span class="status-pill ${card.active ? 'green' : 'muted'}">${escapeHtml(card.status)}</span>` : ''}
        </header>
        <table class="campaign-card-table">
          <thead><tr><th>Indicador</th><th class="num">Real al ${realDay}</th><th class="num">Ritmo diario</th><th class="num">Proyección ${closeDay}</th></tr></thead>
          <tbody>${rows}
          </tbody>
        </table>
        ${budget}
        <dl class="campaign-card-facts">${facts.map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join('')}</dl>
      </article>`;
  }

  function renderCampaignCards(projection) {
    const grid = document.getElementById('projection-campaigns-grid');
    if (!grid) return;
    const title = document.getElementById('projection-campaigns-title');
    const sub = document.getElementById('projection-campaigns-sub');
    const foot = document.getElementById('projection-campaigns-foot');
    const cards = buildCampaignProjections(projection);
    if (title) title.textContent = `Proyección por campaña | ${projection.monthLabel}`;
    if (!cards.length) {
      if (sub) sub.textContent = `El informe de ${projection.monthLabel} no trae campañas.`;
      if (foot) foot.textContent = '';
      grid.innerHTML = '<div class="empty-state projection-sim-empty"><strong>Sin campañas para proyectar</strong>Sube el informe de campaña del mes a la carpeta de Drive y sincroniza.</div>';
      return;
    }

    const sum = (key, field) => cards.reduce((total, card) => total + card.byKey[key][field], 0);
    const realDay = `${projection.daysWithData}-${projection.shortMonth}`;
    const days = projection.daysWithData;
    if (sub) {
      sub.textContent = `${cards.length} campañas | ${money(sum('investment', 'actual'))} invertidos al ${realDay} | ${money(sum('investment', 'projected'))} proyectados al cierre del mes.`;
    }
    const previousName = projection.previous ? MONTHS[Number(projection.previous.id.slice(5)) - 1] : null;
    grid.innerHTML = cards.map(card => campaignCard(card, projection, previousName)).join('');

    if (foot) {
      // Con pocos dias un solo dia fuerte o en cero mueve mucho la proyeccion; se avisa la primera semana.
      const early = !projection.closed && days < 7
        ? ` Con ${days} ${days === 1 ? 'día' : 'días'} de datos la proyección es muy sensible: se estabiliza a medida que llegan más días.`
        : '';
      foot.textContent = `Cada cuadro usa el ritmo diario de la campaña (real al ${realDay} / ${days} ${days === 1 ? 'día' : 'días'}) x ${projection.daysInMonth} días. Presupuesto del mes = presupuesto diario de la campaña x ${projection.daysInMonth} días, el vigente al exportar el informe. Una campaña detenida cierra con lo ya gastado.${early}`;
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
    if (body) body.innerHTML = '<tr><td class="table-empty" colspan="7">Sin datos para proyectar.</td></tr>';
    const grid = document.getElementById('projection-campaigns-grid');
    if (grid) grid.innerHTML = '<div class="empty-state projection-sim-empty"><strong>Sin campañas para proyectar</strong>Todavía no hay inversión registrada.</div>';
  }

  function renderWaiting() {
    const sub = document.getElementById('projection-sub');
    if (sub) sub.textContent = 'Esperando los datos del módulo Gasto publicitario...';
    const body = document.getElementById('projection-body');
    if (body) body.innerHTML = '<tr><td class="table-empty" colspan="7">Esperando los datos del módulo Gasto publicitario...</td></tr>';
    const grid = document.getElementById('projection-campaigns-grid');
    if (grid) grid.innerHTML = '<div class="empty-state projection-sim-empty">Esperando los datos del módulo Gasto publicitario...</div>';
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
    renderToggles(projection);
    renderChart(projection);
    renderTable(projection);
    renderSimulator(projection);
    renderWeeks(projection);
    renderCampaignCards(projection);
  }

  function handlePosition(chart, projection, metric) {
    const entry = buildScenario(projection).byKey[metric.key];
    if (!entry) return null;
    const target = entry.target;
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
    if (!point) return false;
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
      state.goal = null;
      state.marginalCpa = null;
      renderChart(state.projection);
      renderSimulator(state.projection);
    });
  }

  function wireSimulator() {
    const goalInput = document.getElementById('projection-goal');
    const cpaInput = document.getElementById('projection-cpa');

    const apply = () => {
      const projection = state.projection;
      if (!projection) return;
      renderChart(projection);
      renderTable(projection);
      renderWeeks(projection);
      renderSimulator(projection);
    };

    goalInput?.addEventListener('input', () => {
      const projection = state.projection;
      if (!projection || goalInput.value === '') return;
      const value = Number(goalInput.value);
      // Mientras se escribe, un valor por debajo de lo realizado se ignora en vez de corregirlo a mitad de tecleo.
      if (!Number.isFinite(value) || value < projection.byKey.conversions.actual) return;
      state.goal = value;
      apply();
    });
    goalInput?.addEventListener('change', () => {
      const projection = state.projection;
      if (!projection) return;
      if (goalInput.value !== '') state.goal = Number(goalInput.value);
      goalInput.blur();
      apply();
    });

    cpaInput?.addEventListener('change', () => {
      const value = Number(cpaInput.value);
      state.marginalCpa = Number.isFinite(value) && value > 0 ? value : null;
      cpaInput.blur();
      apply();
    });

    document.getElementById('projection-sim-prev')?.addEventListener('click', () => {
      const projection = state.projection;
      if (!projection || !projection.previous) return;
      state.goal = Number(projection.previous.conversions) || 0;
      apply();
    });

    document.getElementById('projection-sim-reset')?.addEventListener('click', () => {
      state.goal = null;
      state.marginalCpa = null;
      apply();
    });
  }

  function wireEvents() {
    document.getElementById('projection-metrics')?.addEventListener('change', event => {
      const input = event.target.closest('input[type="radio"]');
      if (!input) return;
      state.metric = input.value;
      if (state.projection) {
        renderToggles(state.projection);
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
