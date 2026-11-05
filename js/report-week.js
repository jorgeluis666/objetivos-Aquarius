(function () {
  // Generacion de Reporte: el PDF de publicidad con el diseño del template de Aquarius ("Modelo Reporte
  // Aquarius"): laminas 16:9 con portada, contenido, resumen de leads (KPIs, evolucion semanal de leads y costo
  // por lead, cierre o proyeccion), distribucion de inversion por campaña (dona y tabla), desempeño por campaña
  // (una tarjeta por servicio), una lamina de detalle por campaña (KPIs, presupuesto, clics y leads por dia,
  // palabras clave y analisis), palabras clave y calidad, conclusiones y proximos pasos, y cierre.
  //
  // No trae datos nuevos: el periodo, la comparacion con el mes anterior (prorrateado si el mes esta en
  // curso), los totales, las campañas, el informe por dia y las palabras clave del mes salen de Gasto
  // Publicitario (window.AquariusGasto), asi que cada sincronizacion con Drive lo actualiza solo. "Leads" son
  // las conversiones de Google Ads y "CPL" su costo. Los textos (destacados, analisis, conclusiones y pasos)
  // vienen propuestos con lo que dicen los numeros; el equipo los reescribe sobre la misma lamina y quedan
  // guardados por mes en este navegador.
  //
  // El template es propio de Aquarius: cada tablero de marca tiene el suyo, adaptado por la marca.
  const BRAND = 'Aquarius Consulting';
  const NOTES_KEY = 'aquarius_report_notes_v1';
  const MAX_CAMPAIGN_CARDS = 8;
  const MAX_DISTRIBUTION_ROWS = 8;
  const MAX_KEYWORD_ROWS = 8;
  const MAX_CAMPAIGN_KEYWORDS = 5;
  const MAX_QUALITY_BARS = 5;
  const PAGE_WIDTH = 1280;
  const LOGO = 'assets/logo-lima-retail.png';
  const AGENCY_LINE = 'Lima Retail · Data Driven Marketing · Power KPI · Digital Analytics';
  const CHANNEL = 'Google Ads';
  const SCOPE = 'Campaña de búsqueda B2B por servicio (SKAG) para captar empresas.';
  const BLUE = '#2563eb';
  const RED = '#e11d48';
  const INK = '#0f172a';
  // Un color por campaña, en orden de inversion: el mismo en la dona, la tabla y las tarjetas.
  const PALETTE = ['#2563eb', '#0ea5e9', '#14b8a6', '#8b5cf6', '#f59e0b', '#22c55e', '#ef4444', '#94a3b8'];
  const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  // CTR de referencia en busqueda: desde 6% es bueno, entre 3% y 6% aceptable y por debajo de 3%, bajo.
  const CTR_GOOD = 0.06;
  const CTR_OK = 0.03;
  // Una campaña "funciona" si su CPL no pasa en mas de 10% al de la cuenta; lo mismo para una palabra clave
  // frente a su referencia.
  const CPA_MARGIN = 1.1;
  // Desde este uso del presupuesto del mes una campaña se lee limitada por presupuesto.
  const BUDGET_FULL = 0.9;
  // "Funcionan mejor" pide al menos estos leads: uno solo barato puede ser casualidad.
  const MIN_KEYWORD_LEADS = 2;
  // "Mejor CTR" pide al menos estos clics.
  const MIN_CTR_CLICKS = 10;

  // Iconos de linea (24x24).
  const ICONS = {
    chart: '<path d="M3 3v18h18"/><path d="M8 17v-5"/><path d="M13 17V8"/><path d="M18 17v-3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    flag: '<path d="M4 22V4"/><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1"/>',
    trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
    pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
    bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1.1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-2-.5-2.5-1.5"/><path d="M12 6v2m0 8v2"/>',
    cross: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.chart}</svg>`;

  const state = { month: '', wired: false };

  const G = () => window.AquariusGasto;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const isNum = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

  // ── Formatos del template ("S/ 1,040", "S/ 17.9", "S/ 1.71", "9.08%", "9.5", "11 mil", "+49%") ──
  const integer = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });
  const money = value => (isNum(value) ? `S/ ${integer.format(Math.round(value))}` : '—');
  const money1 = value => (isNum(value) ? `S/ ${Number(value).toFixed(1)}` : '—');
  const money2 = value => (isNum(value) ? `S/ ${Number(value).toFixed(2)}` : '—');
  const count = value => (isNum(value) ? integer.format(Math.round(value)) : '—');
  const compact = value => (!isNum(value) ? '—' : value >= 1000 ? `${integer.format(Math.round(value / 1000))} mil` : count(value));
  const percent = value => (isNum(value) ? `${(Number(value) * 100).toFixed(2)}%` : '—');
  const percent1 = value => (isNum(value) ? `${(Number(value) * 100).toFixed(1)}%` : '—');
  const share = value => (isNum(value) ? `${Math.round(Number(value) * 100)}%` : '—');
  // Google Ads reparte conversiones entre campañas y palabras ("9.5"): con un decimal solo si lo hay.
  const leads = value => (!isNum(value) ? '—' : Math.abs(value - Math.round(value)) < 0.05 ? integer.format(Math.round(value)) : Number(value).toFixed(1));
  const change = (current, previous) => (isNum(current) && isNum(previous) && Number(previous) !== 0 ? (Number(current) - Number(previous)) / Number(previous) : null);
  const pct0 = value => `${value >= 0 ? '+' : '-'}${Math.abs(Math.round(value * 100))}%`;
  const pageNumber = value => String(value).padStart(2, '0');
  const leadCount = value => `${leads(value)} ${leads(value) === '1' ? 'lead' : 'leads'}`;
  // "8 de los 80 leads" o "0 de 1 lead"; si son todos, "los 5 leads" o "el único lead".
  const partOf = (part, total) => {
    if (!(Number(total) > 0)) return leadCount(part);
    const one = leads(total) === '1';
    if (leads(part) !== leads(total)) return `${leads(part)} de ${one ? '1 lead' : `los ${leadCount(total)}`}`;
    return one ? 'el único lead' : `los ${leadCount(total)}`;
  };
  const list = items => (items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}` : items[0] || '');
  // Los primeros de una serie mas larga: "a, b y 3 más", sin dos "y" seguidas.
  const listMore = (items, more) => (more > 0 ? `${items.join(', ')} y ${more} más` : list(items));
  const sum = (rows, field) => rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
  const bold = text => `**${text}**`;
  // El informe trae la concordancia en el texto ("control de mermas" entre comillas es de frase, [..] exacta):
  // en las tablas va aparte y en los textos sin signos, para no duplicar las comillas.
  const plainKeyword = text => String(text || '').trim().replace(/^["[]+|["\]]+$/g, '');
  const quote = row => `"${plainKeyword(row.keyword)}"`;

  // ── El mes del reporte ─────────────────────────────────────────────────
  function months() {
    if (!G()) return [];
    return G().months().slice().reverse().map(month => {
      const period = G().period(month.key);
      if (!period) return null;
      const from = month.firstDay;
      const to = month.lastDay;
      const short = month.shortName.toLowerCase();
      const range = `${from} – ${to} ${short} ${month.year}`;
      return {
        id: month.key,
        month,
        period,
        from,
        to,
        option: `${month.name} ${month.year}${period.closed ? '' : ` · ${from}–${to} (en curso)`}`,
        labels: {
          range,
          cover: `${month.name} ${month.year} · Periodo ${from} – ${to} ${short}`,
          source: `Fuente: Google Ads · ${range}`,
          analysisSource: `Fuente: análisis Lima Retail sobre Google Ads · ${BRAND} · ${month.name.toLowerCase()} ${month.year}`,
          footer: `${BRAND} · Reporte Google Ads · ${month.name} ${month.year}`,
          period: `${from} – ${to} de ${month.name.toLowerCase()} de ${month.year}`,
          file: `${month.name}${month.year}${period.closed ? '' : `_${from}-${to}`}`,
        },
      };
    }).filter(Boolean);
  }

  // Costo, clics y leads por dia del informe por dia y campaña del mes (month.detail), de la cuenta o de una
  // campaña (key). Los dias que el informe cubre sin filas de esa campaña van en cero.
  function dailySeries(item, key = null) {
    const month = item.month;
    const detail = Array.isArray(month.detail) ? month.detail : [];
    if (!detail.length) return [];
    const first = Math.max(item.from, month.detailFirst || item.from);
    const last = Math.min(item.to, month.detailLast || item.to);
    const days = new Map();
    for (let day = first; day <= last; day += 1) days.set(day, { d: day, cost: 0, clicks: 0, conversions: 0 });
    detail.forEach(row => {
      const day = days.get(row.d);
      if (!day || (key && row.campaignKey !== key)) return;
      day.cost += Number(row.cost) || 0;
      day.clicks += Number(row.clicks) || 0;
      day.conversions += Number(row.conversions) || 0;
    });
    return [...days.values()];
  }

  // Semanas de 7 dias desde el primer dia del informe (S1 = 1-7, S2 = 8-14...). Un resto de menos de 4 dias al
  // final del mes (29-31) se suma a la semana anterior: suelto pareceria una caida de leads.
  function weeklySeries(item) {
    const weeks = [];
    const days = dailySeries(item);
    days.forEach(day => {
      let index = Math.floor((day.d - days[0].d) / 7);
      if (index > 0 && days[days.length - 1].d - (days[0].d + index * 7) < 3) index -= 1;
      if (!weeks[index]) weeks[index] = { label: `S${index + 1}`, from: day.d, to: day.d, cost: 0, clicks: 0, conversions: 0 };
      const week = weeks[index];
      week.to = day.d;
      week.cost += day.cost;
      week.clicks += day.clicks;
      week.conversions += day.conversions;
    });
    return weeks.map(week => Object.assign(week, { cpl: week.conversions > 0 ? week.cost / week.conversions : null }));
  }

  // Dias en que la campaña tuvo gasto o clics, si arranco o paro a mitad del periodo (null si corrio todo el
  // periodo o no hay informe por dia): una campaña nueva no se lee igual que una de mes completo.
  function activeDays(item, key) {
    const series = dailySeries(item, key);
    const active = series.filter(day => day.cost > 0 || day.clicks > 0);
    if (!active.length || active.length >= series.length - 3) return null;
    return { count: active.length, first: active[0].d, last: active[active.length - 1].d };
  }

  // Presupuesto del mes: el presupuesto diario (el vigente al exportar el informe) por los dias del mes. En un
  // mes en curso lo que resta es lo que aun puede gastar; en uno cerrado, lo que quedo sin usar.
  function budgetOf(dailyBudget, cost, item) {
    if (!isNum(dailyBudget) || !(Number(dailyBudget) > 0)) return null;
    const month = Number(dailyBudget) * item.month.daysInMonth;
    const spent = Number(cost) || 0;
    return { daily: Number(dailyBudget), month, spent, used: spent / month, left: Math.max(0, month - spent), closed: item.period.closed };
  }

  const VERDICTS = {
    good: { tone: 'good', label: 'Funciona' },
    high: { tone: 'warn', label: 'CPL alto' },
    none: { tone: 'bad', label: 'Sin leads' },
  };

  // Veredicto de una campaña: sin leads con gasto, o su CPL frente al de la cuenta.
  function verdictOf(row, accountCpl) {
    if (!(row.conversions > 0)) return row.cost > 0 ? VERDICTS.none : null;
    if (!isNum(accountCpl) || !isNum(row.cpl) || row.cpl <= accountCpl * CPA_MARGIN) return VERDICTS.good;
    return VERDICTS.high;
  }

  function ctrLevel(ctr) {
    if (!isNum(ctr)) return null;
    if (ctr >= CTR_GOOD) return { tone: 'good', label: 'Bueno' };
    return ctr >= CTR_OK ? { tone: 'muted', label: 'Aceptable' } : { tone: 'bad', label: 'Bajo' };
  }

  // Un termino "gasta sin convertir" si tuvo costo (o, sin costo confiable, clics) y ningun lead.
  const spentWithout = row => !(row.conversions > 0) && (Number(row.cost) > 0 || (row.cost === null && row.clicks > 0));
  const byLeads = (left, right) => right.conversions - left.conversions || (right.cost || 0) - (left.cost || 0) || right.clicks - left.clicks;
  const byCost = (left, right) => (right.cost || 0) - (left.cost || 0) || right.clicks - left.clicks;

  // Lectura de una palabra clave frente a un CPL de referencia (el de su campaña en la lamina de la campaña, el
  // de la cuenta en la de palabras clave).
  function keywordVerdict(row, reference) {
    if (row.conversions > 0) {
      if (!isNum(row.cpl)) return { tone: 'muted', label: 'Convierte' };
      return !isNum(reference) || row.cpl <= reference * CPA_MARGIN ? { tone: 'good', label: 'Eficiente' } : { tone: 'warn', label: 'CPL alto' };
    }
    return spentWithout(row) ? { tone: 'bad', label: 'Sin leads' } : { tone: 'muted', label: 'Sin costo' };
  }

  // Nivel de calidad de un grupo de palabras clave: promedio ponderado por impresiones (null sin dato).
  function qualityOf(rows) {
    let total = 0;
    let weight = 0;
    rows.forEach(row => {
      if (!isNum(row.qualityScore)) return;
      const w = Math.max(Number(row.impressions) || 0, 1);
      total += row.qualityScore * w;
      weight += w;
    });
    return weight ? total / weight : null;
  }

  // Palabras clave del mes, una fila por palabra clave (texto y concordancia) y campaña: la misma palabra en
  // dos campañas va en dos filas, porque importa en cual convierte. Si el costo de las palabras no cuadra con
  // el de las campañas (un informe importado con los decimales corridos), no se muestra: un CPL inflado
  // llevaria a depurar los terminos equivocados.
  function keywords(period, accountCost) {
    const source = G().keywords(period);
    if (!source) return null;
    const costOk = !(isNum(accountCost) && accountCost > 0 && sum(source, 'cost') > accountCost * 1.2);
    const rows = source
      .map(row => Object.assign({}, row, {
        keyword: String(row.keyword || '').trim(),
        campaignName: G().campaignLabel(row.campaign),
        cost: costOk ? row.cost : null,
        ctr: row.impressions > 0 ? row.clicks / row.impressions : null,
        cpl: costOk && row.conversions > 0 && row.cost > 0 ? row.cost / row.conversions : null,
        qualityScore: isNum(row.qualityScore) ? Number(row.qualityScore) : null,
      }))
      .filter(row => row.conversions > 0 || row.cost > 0 || row.clicks > 0)
      .sort(byLeads);
    return { rows, costOk, total: sum(rows, 'conversions'), label: G().keywordLabel(period), hasQuality: rows.some(row => isNum(row.qualityScore)) };
  }

  function campaigns(item, accountCpl, keywordData) {
    return G().campaigns(item.period).map(campaign => {
      const row = Object.assign({}, campaign, {
        name: campaign.label || G().campaignLabel(campaign.name),
        ctr: Number(campaign.impressions) > 0 ? campaign.clicks / campaign.impressions : null,
        cpc: Number(campaign.clicks) > 0 ? campaign.cost / campaign.clicks : null,
        cpl: Number(campaign.conversions) > 0 ? campaign.cost / campaign.conversions : null,
        conversionRate: Number(campaign.clicks) > 0 ? (campaign.conversions || 0) / campaign.clicks : null,
      });
      row.verdict = verdictOf(row, accountCpl);
      row.budget = budgetOf(campaign.dailyBudget, campaign.cost, item);
      row.previous = typeof G().previousCampaign === 'function' ? G().previousCampaign(item.period, campaign.key) : null;
      row.keywords = keywordData ? keywordData.rows.filter(keyword => keyword.campaignKey === campaign.key) : null;
      row.quality = row.keywords ? qualityOf(row.keywords) : null;
      return row;
    });
  }

  function buildReport(item) {
    const current = G().totals(item.period);
    current.cpl = current.costPerConversion;
    const keywordData = keywords(item.period, current.cost);
    const rows = campaigns(item, current.cpl, keywordData);
    // Una lamina y un color por campaña con gasto o clics en el periodo, de mayor a menor inversion.
    const detailed = rows.filter(row => row.cost > 0 || row.clicks > 0);
    detailed.forEach((row, index) => { row.color = PALETTE[Math.min(index, PALETTE.length - 1)]; });
    const report = {
      item,
      labels: item.labels,
      current,
      previous: G().previous(item.period),
      weeks: weeklySeries(item),
      detailed,
      keywords: keywordData,
      budget: budgetOf(item.month.dailyBudget, current.cost, item),
    };
    if (report.previous) report.previous.cpl = report.previous.costPerConversion;
    report.read = readCampaigns(report);
    return report;
  }

  // ── Lecturas de campañas que comparten varias laminas ──
  function readCampaigns(report) {
    const rows = report.detailed;
    const accountCpl = report.current.cpl;
    const totalLeads = sum(rows, 'conversions');
    const converting = rows.filter(row => row.conversions > 0).sort((left, right) => right.conversions - left.conversions);
    // Demanda alta: al menos el promedio de leads de las campañas que convierten.
    const average = converting.length ? totalLeads / converting.length : 0;
    const efficient = converting
      .filter(row => row.conversions >= average && isNum(row.cpl) && (!isNum(accountCpl) || row.cpl <= accountCpl))
      .sort((left, right) => left.cpl - right.cpl);
    const cheapest = converting.filter(row => isNum(row.cpl)).sort((left, right) => left.cpl - right.cpl)[0] || null;
    // Los que mas traen: hasta 4 campañas que juntas suman al menos el 80% de los leads.
    const leaders = [];
    converting.forEach(row => {
      if (leaders.length < 4 && sum(leaders, 'conversions') < totalLeads * 0.8) leaders.push(row);
    });
    const none = rows.filter(row => row.verdict === VERDICTS.none).sort(byCost);
    const high = rows.filter(row => row.verdict === VERDICTS.high).sort(byCost);
    const ctrRanked = rows.filter(row => row.clicks >= MIN_CTR_CLICKS && isNum(row.ctr)).sort((left, right) => right.ctr - left.ctr);
    return {
      accountCpl,
      totalLeads,
      converting,
      efficient,
      cheapest,
      leaders,
      none,
      high,
      bestCtr: ctrRanked[0] || null,
      // Lo que mas urge optimizar: lo que gasto sin leads o, si no hay, el CPL mas alto.
      optimize: none[0] || high[0] || null,
      // A donde mover el presupuesto de lo que no convierte.
      target: (efficient[0] || converting[0] || {}).name || '',
    };
  }

  // "dejó S/ 680 sin usar" (mes cerrado) o "le quedan S/ 680 este mes" (mes en curso).
  const budgetLeft = budget => (!budget ? '' : budget.closed ? `dejó ${money(budget.left)} de su presupuesto sin usar` : `le quedan ${money(budget.left)} de presupuesto este mes`);
  const daysLabel = report => (report.item.period.closed ? '' : ` en ${report.item.to - report.item.from + 1} días`);
  const periodDays = report => report.item.to - report.item.from + 1;

  // Proyeccion del mes en curso: ritmo diario por los dias del mes (la misma idea que Proyecciones).
  function projection(report) {
    if (report.item.period.closed) return null;
    const factor = report.item.month.daysInMonth / periodDays(report);
    return { leads: (report.current.conversions || 0) * factor, cost: (report.current.cost || 0) * factor };
  }

  // ── Textos propuestos (el equipo los reescribe sobre la lamina) ─────────
  function suggestSummary(report) {
    const { current, previous, weeks, read } = report;
    const leadChange = previous ? change(current.conversions, previous.conversions) : null;
    const cplChange = previous ? change(current.cpl, previous.cpl) : null;
    const full = weeks.filter(week => week.to - week.from >= 4);
    const parts = [];
    if (full.length > 1) {
      const first = full[0];
      const last = full[full.length - 1];
      // La ultima semana puede traer los dias sueltos de fin de mes: se dice cuantos son.
      const span = week => (week.to - week.from > 6 ? ` (${week.to - week.from + 1} días)` : '');
      parts.push(`Los leads ${last.conversions >= first.conversions ? 'pasaron' : 'bajaron'} de ${leads(first.conversions)} en ${first.label} a ${leads(last.conversions)} en ${last.label}${span(last)}`);
    }
    if (leadChange !== null) parts.push(`${parts.length ? 'y' : 'Los leads'} ${leadChange >= 0 ? 'subieron' : 'bajaron'} ${pct0(leadChange)} frente al mes previo`);
    let highlight = parts.length ? `${parts.join(' ')}.` : '';
    if (cplChange !== null) highlight += ` El costo por lead ${cplChange <= 0 ? 'bajó' : 'subió'} ${pct0(cplChange)} (a ${money1(current.cpl)}).`;
    const level = ctrLevel(current.ctr);
    if (level) highlight += ` CTR de la cuenta ${percent(current.ctr)} (${level.label.toLowerCase()}; bueno desde ${share(CTR_GOOD)}).`;
    const quality = report.keywords && report.keywords.hasQuality ? qualityOf(report.keywords.rows) : null;
    if (isNum(quality)) highlight += ` Nivel de calidad promedio de los términos: ${Math.round(quality)}/10.`;

    const leaders = read.leaders;
    let analysis = current.conversions > 0
      ? `**Qué pasó:** ${leadCount(current.conversions)} a ${money(current.cpl)} cada uno, con tasa de conversión del ${share(current.conversionRate)}.`
      : `**Qué pasó:** ${money(current.cost)} de inversión y ${count(current.clicks)} clics${daysLabel(report)}, todavía sin leads.`;
    if (leaders.length > 1) analysis += ` ${['', '', 'Dos', 'Tres', 'Cuatro'][leaders.length]} servicios concentran ${partOf(sum(leaders, 'conversions'), read.totalLeads)}.`;
    if (read.none.length) analysis += ` **Qué no funcionó:** ${list(read.none.map(row => row.name))} ${read.none.length > 1 ? 'gastaron' : 'gastó'} ${money(sum(read.none, 'cost'))} sin leads.`;
    else if (read.high.length) analysis += ` **Qué no funcionó:** ${list(read.high.map(row => `${row.name} (CPL ${money1(row.cpl)})`))} ${read.high.length > 1 ? 'convierten' : 'convierte'} caro.`;
    analysis += ` **Acción:** sostener la inversión en los servicios que convierten${read.none.length || read.high.length ? ' y corregir o pausar lo que no cierra' : ''}.`;

    const sub = `${SCOPE} ${leadChange === null ? '' : leadChange >= 0.1 ? 'Los leads crecieron frente al mes previo' : leadChange <= -0.1 ? 'Los leads bajaron frente al mes previo' : 'Los leads se mantuvieron frente al mes previo'}${leadChange === null ? '' : cplChange !== null ? ` y el costo por lead ${cplChange <= 0 ? 'bajó' : 'subió'}.` : '.'}`.trim();

    const projected = projection(report);
    let closing;
    if (projected && current.conversions > 0) {
      closing = {
        title: `Proyección de cierre: ~${count(projected.leads)} leads`,
        text: `Con el ritmo actual (${leadCount(current.conversions)} en ${periodDays(report)} días) y manteniendo el CPL, ${report.item.month.name.toLowerCase()} cerraría en ~${count(projected.leads)} leads y ~${money(projected.cost)} de inversión. Es una estimación, no un resultado asegurado.`,
      };
    } else if (projected) {
      closing = {
        title: `Proyección de cierre: ~${money(projected.cost)}`,
        text: `Con el ritmo actual (${money(current.cost)} en ${periodDays(report)} días), ${report.item.month.name.toLowerCase()} cerraría en ~${money(projected.cost)} de inversión. Todavía no hay leads para proyectar el cierre.`,
      };
    } else {
      const budget = report.budget;
      closing = {
        title: `Cierre de ${report.item.month.name.toLowerCase()}: ${leadCount(current.conversions)}`,
        text: `${report.item.month.name} cerró con ${leadCount(current.conversions)} y ${money(current.cost)} de inversión (CPL ${money1(current.cpl)}).${budget ? ` Se usó el ${share(budget.used)} del presupuesto disponible (${money(budget.month)}): quedaron ${money(budget.left)} sin invertir.` : ''}`,
      };
    }
    return { sub, highlight: highlight.trim(), analysis, closing };
  }

  function suggestDistribution(report) {
    const { read } = report;
    const parts = [];
    if (read.leaders.length) {
      parts.push(`${list(read.leaders.map(row => row.name))} ${read.leaders.length > 1 ? 'concentran' : 'concentra'} el ${share(sum(read.leaders, 'cost') / (report.current.cost || 1))} del presupuesto y ${read.leaders.length > 1 ? 'traen' : 'trae'} ${partOf(sum(read.leaders, 'conversions'), read.totalLeads)}.`);
    }
    if (read.none.length) parts.push(`${list(read.none.map(row => row.name))} ${read.none.length > 1 ? 'gastaron' : 'gastó'} ${money(sum(read.none, 'cost'))} sin leads${read.target ? `: mover ese presupuesto a ${read.target}` : ''}.`);
    if (read.high.length) parts.push(`${list(read.high.map(row => `${row.name} (CPL ${money1(row.cpl)})`))} ${read.high.length > 1 ? 'convierten' : 'convierte'} caro.`);
    return parts.join(' ') || 'Sin campañas con inversión en el período.';
  }

  // Analisis de una campaña: que funciona, que no y que hacemos, con su presupuesto. Solo se propone reforzar
  // una palabra clave que convierte a buen costo.
  function suggestCampaign(report, campaign) {
    const { read } = report;
    const accountCpl = read.accountCpl;
    const reference = isNum(campaign.cpl) ? campaign.cpl : accountCpl;
    const keywordsOf = campaign.keywords || [];
    const converting = keywordsOf.filter(row => row.conversions > 0).sort(byLeads);
    const strong = converting.filter(row => keywordVerdict(row, reference).tone === 'good');
    const costly = converting.filter(row => keywordVerdict(row, reference).tone === 'warn').sort(byCost);
    const wasted = keywordsOf.filter(spentWithout).sort(byCost);
    // Las palabras clave del informe pueden no explicar todos los leads (otras busquedas de la campaña).
    const keywordLeads = sum(keywordsOf, 'conversions');
    const uncovered = campaign.conversions > 0 && keywordsOf.length > 0 && keywordLeads < campaign.conversions * 0.8;
    const level = ctrLevel(campaign.ctr);
    const ctrText = level ? `CTR ${percent(campaign.ctr)} (${level.label.toLowerCase()})` : '';
    const active = activeDays(report.item, campaign.key);
    const during = active ? ` en sus ${active.count} días activa` : daysLabel(report);
    const lowQuality = keywordsOf.filter(row => isNum(row.qualityScore) && row.qualityScore <= 4 && row.cost > 0).sort(byCost);
    const lines = [];

    if (campaign.conversions > 0) {
      let works = `${leadCount(campaign.conversions)} (${share(campaign.conversions / (read.totalLeads || 1))} del total) con el ${share(campaign.share)} de la inversión${ctrText ? `; ${ctrText}` : ''}.`;
      if (strong.length) works += ` ${quote(strong[0])} trae ${leads(strong[0].conversions)}${isNum(strong[0].cpl) ? ` a ${money2(strong[0].cpl)}` : ''}.`;
      if (uncovered) works += ` Las palabras clave del informe explican ${leads(keywordLeads)} de esos ${leads(campaign.conversions)}: el resto llega por otras búsquedas de la campaña.`;
      lines.push(`**Qué funciona:** ${works}`);
    } else {
      lines.push(`**Qué funciona:** ${level && level.tone !== 'bad' ? `el anuncio atrae clics (CTR ${percent(campaign.ctr)}, ${level.label.toLowerCase()}), pero ninguno terminó en lead.` : 'todavía nada: no hubo leads.'}`);
    }

    const fails = [];
    if (!(campaign.conversions > 0)) {
      const cpcHigh = isNum(campaign.cpc) && isNum(report.current.cpc) && campaign.cpc > report.current.cpc * 1.5;
      fails.push(`gastó ${money(campaign.cost)} en ${count(campaign.clicks)} clics${during} (CPC ${money2(campaign.cpc)}${cpcHigh ? `, ${(campaign.cpc / report.current.cpc).toFixed(1)} veces el de la cuenta` : ''}) sin leads.`);
    } else if (campaign.verdict === VERDICTS.high) {
      fails.push(`cada lead cuesta ${money2(campaign.cpl)}, ${pct0(campaign.cpl / accountCpl - 1)} sobre la cuenta (${money2(accountCpl)}).`);
    }
    if (costly.length) fails.push(`${list(costly.slice(0, 2).map(row => `${quote(row)} (CPL ${money2(row.cpl)})`))} ${costly.length > 1 ? 'convierten' : 'convierte'} caro.`);
    if (wasted.length && campaign.conversions > 0) fails.push(`${listMore(wasted.slice(0, 2).map(quote), wasted.length - 2)} ${wasted.length > 1 ? 'gastaron' : 'gastó'} ${money(sum(wasted, 'cost'))} sin leads.`);
    if (lowQuality.length) fails.push(`${list(lowQuality.slice(0, 2).map(row => `${quote(row)} (${Math.round(row.qualityScore)}/10)`))} con nivel de calidad bajo.`);
    if (level && level.tone === 'bad') fails.push(`el CTR es bajo (${percent(campaign.ctr)}): el anuncio no engancha con la búsqueda.`);
    // Tres hallazgos como mucho: la tarjeta tiene el alto justo para leerse en la lamina.
    lines.push(`**Qué no funciona:** ${fails.length ? fails.slice(0, 3).join(' ') : 'nada relevante: sus palabras clave con gasto convierten.'}`);

    const budget = campaign.budget;
    const left = budgetLeft(budget);
    let next;
    if (!(campaign.conversions > 0)) {
      next = `**Alerta:** cambiar palabras clave, anuncios o landing${left ? ` (${left})` : ''}; si en dos semanas no convierte, pausarla y mover el presupuesto${read.target && read.target !== campaign.name ? ` a ${read.target}` : ''}.`;
    } else if (campaign.verdict === VERDICTS.high) {
      const pause = [...costly, ...wasted].slice(0, 2);
      next = `**Qué hacemos:** bajar pujas${pause.length ? ` y pausar o ajustar ${list(pause.map(quote))}` : ''}, y probar anuncios nuevos hasta acercar el CPL a ${money1(accountCpl)}.`;
    } else if (budget && budget.used >= BUDGET_FULL) {
      next = `**Qué hacemos:** subir el presupuesto diario (${money(budget.daily)}): usó el ${share(budget.used)} del mes y convierte a buen costo.`;
    } else if (uncovered) {
      next = `**Qué hacemos:** revisar los términos de búsqueda que traen esos leads y sumarlos como palabras clave${costly.length ? `; bajar la puja en ${quote(costly[0])}` : ''}${left ? `. ${left.charAt(0).toUpperCase()}${left.slice(1)}` : ''}.`;
    } else {
      next = `**Qué hacemos:** mantenerla y subir la puja${strong.length ? ` en ${quote(strong[0])}` : ''} para ganar impresiones${left ? `; ${left}` : ''}.`;
    }
    lines.push(next);
    return lines.join('\n');
  }

  // Palabras clave: la que mas convierte, las que funcionan mejor (menor CPL con volumen) y las que gastan sin
  // convertir, cada una con su campaña; y la lectura del nivel de calidad cuando el informe lo trae.
  function suggestKeywords(report) {
    const { rows } = report.keywords;
    const converting = rows.filter(row => row.conversions > 0);
    const named = row => `${bold(plainKeyword(row.keyword))} (${row.campaignName})`;
    let top = 'Ningún término de búsqueda trajo leads en el período: revisar la intención de las palabras clave y las landing.';
    if (converting.length) {
      const [first, ...rest] = converting;
      top = `${named(first)}: ${leads(first.conversions)} de ${leads(report.keywords.total)} leads${isNum(first.cpl) ? `, a ${money2(first.cpl)}` : ''}.`;
      if (rest.length) top += ` Le siguen ${list(rest.slice(0, 2).map(row => `${named(row)} con ${leads(row.conversions)}`))}.`;
    }
    const proven = converting.filter(row => row.conversions >= MIN_KEYWORD_LEADS && isNum(row.cpl));
    const ranked = (proven.length ? proven : converting.filter(row => isNum(row.cpl))).sort((left, right) => left.cpl - right.cpl).slice(0, 3);
    let best = 'Sin costo por lead confiable para comparar.';
    if (ranked.length) {
      best = `${list(ranked.map(row => `${named(row)}: ${leadCount(row.conversions)} a ${money2(row.cpl)}${isNum(row.qualityScore) ? `, calidad ${Math.round(row.qualityScore)}/10` : ''}`))}.`;
      best += ` ${proven.length ? `El menor CPL con al menos ${MIN_KEYWORD_LEADS} leads` : 'El menor CPL'}: subir su puja.`;
    }
    const wasted = rows.filter(spentWithout).sort(byCost);
    let waste = 'Todas las palabras clave con gasto trajeron leads.';
    if (wasted.length) {
      waste = `${listMore(wasted.slice(0, 3).map(row => `${named(row)} ${money(row.cost)}`), wasted.length - 3)}:${money(sum(wasted, 'cost'))} sin leads. Pausarlas o cerrar su concordancia.`;
    }
    let quality = '';
    const scored = rows.filter(row => isNum(row.qualityScore));
    if (scored.length) {
      const high = scored.filter(row => row.qualityScore >= 7).sort(byCost);
      const low = scored.filter(row => row.qualityScore <= 5 && row.conversions > 0).sort(byLeads);
      quality = `**Qué pasó:** ${high.length ? `${list(high.slice(0, 3).map(quote))} ${high.length > 1 ? 'están' : 'está'} en calidad 7/10 o más` : 'ningún término llega a calidad 7/10'}${low.length ? `; ${quote(low[0])}, que trae ${leadCount(low[0].conversions)}, está en ${Math.round(low[0].qualityScore)}/10 y tiene margen` : ''}. **Acción:** alinear títulos y landing de los términos con calidad baja para bajar el CPC y captar más leads.`;
    }
    return { top, best, waste, quality };
  }

  function suggestConclusions(report) {
    const { current, previous, read } = report;
    const cards = [];
    const leadChange = previous ? change(current.conversions, previous.conversions) : null;
    const cplChange = previous ? change(current.cpl, previous.cpl) : null;
    const projected = projection(report);
    cards.push({
      icon: 'briefcase',
      title: current.conversions > 0 ? `${leadCount(current.conversions)} a ${money(current.cpl)} cada uno` : `${money(current.cost)} invertidos, sin leads aún`,
      text: `${leadChange !== null ? `Los leads ${leadChange >= 0 ? 'subieron' : 'bajaron'} ${pct0(leadChange)} frente al mes previo` : 'Primer mes con datos para comparar'}${cplChange !== null ? ` y el costo por lead ${cplChange <= 0 ? 'bajó' : 'subió'} ${pct0(cplChange)}` : ''}.${projected ? ` Con este ritmo, ${report.item.month.name.toLowerCase()} cerraría en ~${count(projected.leads)} leads.` : ''}`,
    });
    if (read.leaders.length) {
      const cpls = read.leaders.map(row => row.cpl).filter(isNum);
      cards.push({
        icon: 'layers',
        title: `${['', 'Un servicio lidera', 'Dos servicios lideran', 'Tres servicios lideran', 'Cuatro servicios lideran'][read.leaders.length]}`,
        text: `${list(read.leaders.map(row => row.name))} ${read.leaders.length > 1 ? 'traen' : 'trae'} ${partOf(sum(read.leaders, 'conversions'), read.totalLeads)}${cpls.length ? ` a CPL de ${cpls.length > 1 ? `${money(Math.min(...cpls))}–${Math.round(Math.max(...cpls))}` : money(cpls[0])}` : ''}. Se sostendrá y escalará la inversión en ${read.leaders.length > 1 ? 'estos servicios' : 'este servicio'}.`,
      });
    }
    if (read.optimize) {
      const row = read.optimize;
      cards.push({
        icon: 'star',
        title: `Oportunidad en ${row.name}`,
        text: row.verdict === VERDICTS.none
          ? `Gastó ${money(row.cost)} en ${count(row.clicks)} clics sin leads${row.budget ? ` y ${budgetLeft(row.budget)}` : ''}. Se ajustarán palabras clave, anuncio y página de destino; si no convierte, ese presupuesto pasa a ${read.target || 'los servicios que sí cierran'}.`
          : `Trae ${count(row.clicks)} clics pero convierte caro (CPL ${money1(row.cpl)}). Se ajustarán concordancias y página de destino para bajar su costo por lead.`,
      });
    }
    return cards.slice(0, 3);
  }

  function suggestSteps(report) {
    const { read } = report;
    const steps = [];
    if (read.leaders.length) {
      const room = report.budget && report.budget.used < 0.7;
      steps.push({
        icon: 'layers',
        title: 'Escalar los servicios que convierten',
        text: `Priorizar ${list(read.leaders.map(row => row.name))} (${share(sum(read.leaders, 'conversions') / (read.totalLeads || 1))} de los leads)${room ? ' y usar el presupuesto que hoy queda sin invertir' : ' y replicar su estructura en los servicios con margen'}.`,
      });
    }
    const fix = [...read.none, ...read.high].slice(0, 2);
    if (fix.length) {
      steps.push({
        icon: 'search',
        title: `Optimizar ${list(fix.map(row => row.name))}`,
        text: `Revisar concordancias, anuncios y páginas de destino para convertir sus ${count(sum(fix, 'clicks'))} clics en leads y bajar su CPL${read.none.length ? `; si no mejora, mover el presupuesto a ${read.target || 'lo que convierte'}` : ''}.`,
      });
    } else {
      steps.push({ icon: 'search', title: 'Ampliar lo que funciona', text: 'Sumar palabras clave y anuncios en los servicios con mejor CPL para captar más demanda.' });
    }
    return steps;
  }

  // ── Textos guardados por mes ───────────────────────────────────────────
  function readNotes() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(NOTES_KEY) || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch (error) {
      return {};
    }
  }

  function writeNotes(notes) {
    try {
      window.localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
    } catch (error) {
      // Sin localStorage el texto dura hasta recargar; el PDF se descarga igual.
    }
  }

  function saveNote(monthId, key, value) {
    const notes = readNotes();
    notes[monthId] = Object.assign({}, notes[monthId] || {}, { [key]: value });
    writeNotes(notes);
  }

  function resetNotes(monthId) {
    const notes = readNotes();
    delete notes[monthId];
    writeNotes(notes);
  }

  // **texto** va en negrita, como "Que paso:" en el template.
  const rich = text => esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  // Texto editable sobre la lamina: al hacer clic se ve el texto con sus ** y al salir vuelve a negrita.
  const editable = (key, text, tag = 'p', className = '') => `<${tag} class="rp-edit ${className}" data-note="${esc(key)}" data-raw="${esc(text)}" title="Clic para editar · **texto** va en negrita">${rich(text)}</${tag}>`;
  const noteOr = (notes, key, suggested) => (notes[key] != null ? notes[key] : suggested);

  // ── Piezas de las laminas ──────────────────────────────────────────────
  const tag = (tone, label) => `<span class="rp-tag ${tone}">${esc(label)}</span>`;
  const pill = text => (text ? `<span class="rp-pill">${esc(text)}</span>` : '');
  const meter = (used, className = '') => `<span class="rp-meter ${className}"><i style="width:${Math.min(100, Math.max(0, used * 100)).toFixed(1)}%"></i></span>`;

  // Tarjeta de KPI del template: etiqueta, insignia opcional a la derecha, valor y pie.
  const kpi = ({ label, value, foot = '', badge = '', className = '', extra = '' }) => `
    <div class="rp-card rp-kpi ${className}">
      <div class="rp-kpi-top"><span class="rp-kpi-label">${esc(label)}</span>${badge}</div>
      <strong>${value}</strong>
      ${extra}
      <span class="rp-kpi-foot">${foot}</span>
    </div>`;

  // "+49% vs mes previo": contra un mes previo casi en cero la variacion no dice nada (+52519%) y no va.
  function versus(current, previous, suffix = ' vs mes previo') {
    const value = change(current, previous);
    return value === null || Math.abs(value) > 5 ? '' : `${pct0(value)}${suffix}`;
  }

  function head(report, title, sub, after = '') {
    return `
      <header class="rp-head rp-head-row">
        <div><h2>${esc(title)}${after}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
        <span class="rp-date">${icon('calendar')}${esc(report.labels.range)}</span>
      </header>`;
  }

  function footer(left, report, page, total) {
    return `
      <footer class="rp-foot">
        <span>${esc(left)}</span>
        <span class="rp-foot-right"><img src="${LOGO}" alt=""><b>Lima Retail</b>${esc(report.labels.footer)} · ${pageNumber(page)} / ${pageNumber(total)}</span>
      </footer>`;
  }

  // Recuadro azul "DESTACADO" del template.
  function highlight(label, iconName, key, text) {
    return `
      <div class="rp-insight">
        <span class="rp-insight-icon">${icon(iconName)}</span>
        <div>
          <span class="rp-insight-label">${esc(label)}</span>
          ${editable(key, text)}
        </div>
      </div>`;
  }

  // Tarjeta blanca "Analisis" del template.
  const analysisCard = (key, text, title = 'Análisis') => `
    <div class="rp-card rp-analysis">
      <div class="rp-analysis-head">${icon('chart')}<b>${esc(title)}</b></div>
      ${editable(key, text)}
    </div>`;

  // Tarjeta de lectura con titulo de color e icono.
  const noteCard = (label, iconName, tone, key, text) => `
    <div class="rp-card rp-mini ${tone}">
      <div class="rp-mini-head">${icon(iconName)}<span>${esc(label)}</span></div>
      ${editable(key, text)}
    </div>`;

  // Etiquetas de datos de los graficos. Cada una prueba sus lados (arriba o abajo del punto, en ese orden) y,
  // si choca con otra etiqueta, con un punto o con una barra, se aleja de a 6 px hasta 12 px; la que no entra
  // en ningun lado queda sin etiqueta. El ancho se mide por la cantidad de caracteres.
  const LABEL_SIZE = 11;
  function placeLabels(labels, obstacles, bounds, size = LABEL_SIZE) {
    const taken = obstacles.slice();
    const clash = box => box.y1 < bounds.top || box.y2 > bounds.bottom
      || taken.some(other => box.x1 < other.x2 && box.x2 > other.x1 && box.y1 < other.y2 && box.y2 > other.y1);
    return labels.map(label => {
      const half = (label.text.length * size * 0.6 + 4) / 2;
      const x = Math.min(Math.max(label.x, bounds.left + half), bounds.right - half);
      for (const extra of [0, 6, 12]) {
        for (const side of label.sides) {
          const baseline = side === 'above' ? label.top - 5 - extra : label.bottom + 5 + size * 0.8 + extra;
          const box = { x1: x - half, x2: x + half, y1: baseline - size * 0.8, y2: baseline + 2 };
          if (!clash(box)) {
            taken.push(box);
            return Object.assign({}, label, { x, baseline });
          }
        }
      }
      return null;
    }).filter(Boolean);
  }

  const labelText = (item, color, className = 'rp-label') => `<text x="${item.x.toFixed(1)}" y="${item.baseline.toFixed(1)}" text-anchor="middle" class="${className}" fill="${color}">${esc(item.text)}</text>`;
  // Arriba en un pico, abajo en un valle (contra el promedio de sus vecinos).
  const sidesFor = (values, index) => {
    const around = [values[index - 1], values[index + 1]].filter(isNum);
    const valley = around.length && values[index] < around.reduce((total, value) => total + value, 0) / around.length;
    return valley ? ['below', 'above'] : ['above', 'below'];
  };

  // Evolucion de leads y costo por lead por semana, en dos paneles con su escala (como el template): cada punto
  // con su valor y la ultima semana resaltada.
  function weekChart(weeks) {
    if (!weeks.length) {
      return '<p class="rp-empty rp-chart-empty">El informe por día de este mes todavía no está en el tablero: la evolución semanal aparece cuando se suba a Drive el informe de campaña por día.</p>';
    }
    const width = 620;
    const height = 300;
    const left = 30;
    const right = width - 30;
    const panels = [
      { key: 'conversions', name: 'Leads', color: BLUE, cap: 18, top: 50, bottom: 112, format: leads },
      { key: 'cpl', name: 'Costo por lead', color: RED, cap: 146, top: 178, bottom: 228, format: money2 },
    ];
    const slot = (right - left) / weeks.length;
    const x = index => left + slot * (index + 0.5);
    const last = weeks.length - 1;
    const body = panels.map(panel => {
      const values = weeks.map(week => (isNum(week[panel.key]) ? week[panel.key] : null));
      const present = values.filter(isNum);
      const max = Math.max(...present, 0);
      const min = panel.key === 'cpl' ? Math.min(...present, max) : 0;
      const y = value => panel.bottom - ((value - min) / ((max - min) || 1)) * (panel.bottom - panel.top);
      const points = values.map((value, index) => (isNum(value) ? { x: x(index), y: y(value), value, index } : null));
      const segments = [];
      points.forEach((point, index) => { if (point && points[index - 1]) segments.push(`<line x1="${points[index - 1].x.toFixed(1)}" y1="${points[index - 1].y.toFixed(1)}" x2="${point.x.toFixed(1)}" y2="${point.y.toFixed(1)}" stroke="${panel.color}" stroke-width="2.2" stroke-linecap="round"/>`); });
      const shown = points.filter(Boolean);
      const placed = placeLabels(
        shown.map(point => ({ x: point.x, top: point.y - 5, bottom: point.y + 5, text: panel.format(point.value), sides: sidesFor(values, point.index), last: point.index === last })),
        shown.map(point => ({ x1: point.x - 6, x2: point.x + 6, y1: point.y - 6, y2: point.y + 6 })),
        { left: 0, right: width, top: panel.cap + 6, bottom: panel.bottom + 24 },
        12,
      );
      return `
        <rect x="${left - 6}" y="${panel.cap - 9}" width="10" height="10" rx="2" fill="${panel.color}"/>
        <text x="${left + 10}" y="${panel.cap}" class="rp-panel-cap">${esc(panel.name)}</text>
        <line x1="${left}" x2="${right}" y1="${panel.bottom + 4}" y2="${panel.bottom + 4}" class="rp-grid dashed"/>
        ${segments.join('')}
        ${shown.map(point => (point.index === last
          ? `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="5.5" fill="${panel.color}"/>`
          : `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4" fill="#fff" stroke="${panel.color}" stroke-width="1.8"/>`)).join('')}
        ${placed.map(item => labelText(item, item.last ? panel.color : '#475569', item.last ? 'rp-label big strong' : 'rp-label big')).join('')}`;
    }).join('');
    return `
      <svg class="rp-chart rp-chart-week" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMin meet" role="img" aria-label="Evolución de leads y costo por lead por semana">
        <rect x="${(x(last) - slot * 0.42).toFixed(1)}" y="${panels[0].cap + 8}" width="${(slot * 0.84).toFixed(1)}" height="${panels[1].bottom + 28 - panels[0].cap}" rx="6" fill="#eef4ff"/>
        <line x1="${left}" x2="${right}" y1="${panels[1].bottom + 28}" y2="${panels[1].bottom + 28}" class="rp-grid"/>
        ${body}
        ${weeks.map((week, index) => `
          <text x="${x(index).toFixed(1)}" y="${height - 22}" text-anchor="middle" class="rp-axis big${index === last ? ' strong' : ''}">${week.label}</text>
          <text x="${x(index).toFixed(1)}" y="${height - 6}" text-anchor="middle" class="rp-tick big">${week.from}–${week.to}</text>`).join('')}
      </svg>`;
  }

  // Clics (linea) y leads (barras) por dia de una campaña, en dos franjas con su propia escala sobre el mismo eje
  // de dias: los leads son pocos y en la escala de los clics quedaban pegados al piso. Cada punto y cada barra
  // lleva su valor; los dias en cero van sin etiqueta.
  function dayChart(rows, height, label) {
    if (!rows.length) {
      return '<p class="rp-empty rp-chart-empty">El informe por día de este mes todavía no está en el tablero: la evolución diaria aparece cuando se suba a Drive el informe de campaña por día.</p>';
    }
    const width = 1160;
    const left = 52;
    const right = width - 12;
    const axisY = height - 8;
    const leadBottom = axisY - 20;
    const leadTop = leadBottom - Math.round(height * 0.2);
    const clicksBottom = leadTop - 28;
    const clicksTop = 22;
    const slot = (right - left) / rows.length;
    const x = index => left + slot * (index + 0.5);
    const clicks = rows.map(day => day.clicks);
    const conversions = rows.map(day => day.conversions);
    const peak = Math.max(...clicks, 1);
    const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find(size => peak / size <= 3) || 1000;
    const max = Math.ceil(peak / step) * step;
    const y = value => clicksBottom - (value / max) * (clicksBottom - clicksTop);
    const leadPeak = Math.max(...conversions, 1);
    // La barra mas alta deja lugar para su etiqueta dentro de la franja.
    const barTop = value => leadBottom - (value / leadPeak) * (leadBottom - leadTop - 16);
    const barWidth = Math.min(16, slot * 0.45);

    const grid = [];
    for (let value = step; value <= max; value += step) {
      grid.push(`<line x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}" class="rp-grid dashed"/><text x="${left - 12}" y="${y(value) + 4}" text-anchor="end" class="rp-tick big">${integer.format(value)}</text>`);
    }
    const points = clicks.map((value, index) => ({ x: x(index), y: y(value), value }));
    const clickLabels = placeLabels(
      points.map((point, index) => (point.value > 0 ? { x: point.x, top: point.y - 3.4, bottom: point.y + 3.4, text: count(point.value), sides: sidesFor(clicks, index) } : null)).filter(Boolean),
      points.map(point => ({ x1: point.x - 4, x2: point.x + 4, y1: point.y - 4, y2: point.y + 4 })),
      { left: 0, right: width, top: 0, bottom: leadTop - 6 },
    );
    const bars = conversions.map((value, index) => (value > 0 ? { x: x(index), top: barTop(value), value } : null)).filter(Boolean);
    const barLabels = placeLabels(
      bars.map(bar => ({ x: bar.x, top: bar.top, bottom: leadBottom, text: leads(bar.value), sides: ['above'] })),
      bars.map(bar => ({ x1: bar.x - barWidth / 2, x2: bar.x + barWidth / 2, y1: bar.top, y2: leadBottom })),
      { left: 0, right: width, top: leadTop - 4, bottom: leadBottom },
    );
    return `
      <svg class="rp-chart rp-chart-daily" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMin meet" role="img" aria-label="${esc(label)}">
        ${grid.join('')}
        <line x1="${left}" x2="${right}" y1="${clicksBottom}" y2="${clicksBottom}" class="rp-grid"/>
        <polyline points="${points.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${BLUE}" stroke-width="2.2" stroke-linejoin="round"/>
        ${points.map(point => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.4" fill="#fff" stroke="${BLUE}" stroke-width="1.8"/>`).join('')}
        ${clickLabels.map(item => labelText(item, BLUE)).join('')}
        <text x="${left - 12}" y="${leadBottom - 2}" text-anchor="end" class="rp-tick big">Leads</text>
        ${bars.map(bar => `<rect x="${(bar.x - barWidth / 2).toFixed(1)}" y="${bar.top.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(leadBottom - bar.top).toFixed(1)}" rx="2" fill="${INK}"/>`).join('')}
        <line x1="${left}" x2="${right}" y1="${leadBottom}" y2="${leadBottom}" class="rp-grid"/>
        ${barLabels.map(item => labelText(item, INK)).join('')}
        ${rows.map((day, index) => `<text x="${x(index).toFixed(1)}" y="${axisY}" text-anchor="middle" class="rp-axis big">${day.d}</text>`).join('')}
      </svg>`;
  }

  const legends = items => `<span class="rp-legends">${items.map(([color, name]) => `<span class="rp-legend"><i style="background:${color}"></i>${esc(name)}</span>`).join('')}</span>`;

  // Dona de la inversion por campaña, con el total al centro.
  function donut(rows, total) {
    const radius = 78;
    const length = 2 * Math.PI * radius;
    let offset = 0;
    const arcs = rows.filter(row => row.cost > 0).map(row => {
      const part = (row.cost / (total || 1)) * length;
      const arc = `<circle cx="100" cy="100" r="${radius}" fill="none" stroke="${row.color}" stroke-width="34" stroke-dasharray="${part.toFixed(2)} ${(length - part).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 100 100)"/>`;
      offset += part;
      return arc;
    });
    return `
      <svg class="rp-donut" viewBox="0 0 200 200" role="img" aria-label="Inversión por campaña">
        ${arcs.join('')}
        <text x="100" y="101" text-anchor="middle" class="rp-donut-total">${esc(money(total))}</text>
        <text x="100" y="120" text-anchor="middle" class="rp-donut-sub">inversión</text>
      </svg>`;
  }

  const qualityBadge = value => `<span class="rp-qs">${isNum(value) ? `${Math.round(value)}/10` : '—'}</span>`;

  // Palabras clave: leads, CPL, inversion, clics, CTR y su lectura frente a reference (un CPL); con la campaña
  // y el nivel de calidad cuando corresponde.
  function keywordTable(rows, { report, reference, withCampaign, empty }) {
    const quality = Boolean(report.keywords && report.keywords.hasQuality);
    const match = row => {
      const type = String(row.matchType || '').toLowerCase();
      return type.includes('exacta') ? 'exacta' : type.includes('frase') ? 'frase' : '';
    };
    const qualityCell = row => {
      if (!isNum(row.qualityScore)) return '<span class="rp-faint">—</span>';
      const value = Math.round(row.qualityScore);
      return tag(value >= 7 ? 'good' : value >= 5 ? 'warn' : 'bad', `${value}/10`);
    };
    const columns = 7 + (withCampaign ? 1 : 0) + (quality ? 1 : 0);
    const body = rows.length ? rows.map((row, index) => {
      const zero = !(row.conversions > 0);
      const reading = keywordVerdict(row, reference);
      const type = match(row);
      return `<tr${index === 0 && !zero ? ' class="rp-top"' : ''}>
        <td class="rp-name" title="${esc(plainKeyword(row.keyword))}">${esc(plainKeyword(row.keyword))}${type ? `<span class="rp-match">${type}</span>` : ''}</td>
        ${withCampaign ? `<td class="rp-campaign" title="${esc(row.campaignName)}">${esc(row.campaignName)}</td>` : ''}
        ${quality ? `<td class="num">${qualityCell(row)}</td>` : ''}
        <td class="num">${zero ? '<span class="rp-neg">0</span>' : `<b>${leads(row.conversions)}</b>`}</td>
        <td class="num">${zero ? '<span class="rp-faint">—</span>' : money1(row.cpl)}</td>
        <td class="num">${money(row.cost)}</td>
        <td class="num">${count(row.clicks)}</td>
        <td class="num">${percent(row.ctr)}</td>
        <td>${tag(reading.tone, reading.label)}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="${columns}" class="rp-empty">${esc(empty)}</td></tr>`;
    // A todo el ancho (con campaña) las cifras caben en menos; en la lamina de la campaña la tabla es angosta.
    const widths = withCampaign ? ['7%', '9%', '9%', '7%', '8%', '11%'] : ['8%', '10%', '10%', '8%', '10%', '16%'];
    if (quality) widths.unshift(withCampaign ? '8%' : '10%');
    if (withCampaign) widths.unshift('18%');
    return `
      <table class="rp-table rp-tight rp-keywords">
        <colgroup><col>${widths.map(width => `<col style="width:${width}">`).join('')}</colgroup>
        <thead><tr><th>Palabra clave</th>${withCampaign ? '<th>Campaña</th>' : ''}${quality ? '<th class="num">Calidad</th>' : ''}<th class="num">Leads</th><th class="num">CPL</th><th class="num">Inversión</th><th class="num">Clics</th><th class="num">CTR</th><th>Lectura</th></tr></thead>
        <tbody>${body}</tbody>
      </table>`;
  }

  // ── Laminas ────────────────────────────────────────────────────────────
  function issuedLabel() {
    const now = new Date(Date.now() - 5 * 3600000);
    return `${now.getUTCDate()} ${MONTHS[now.getUTCMonth()].slice(0, 3).toLowerCase()}. ${now.getUTCFullYear()}`;
  }

  function coverPage(report) {
    return `
      <section class="rp-page rp-cover">
        <div class="rp-brand"><img src="${LOGO}" alt="Lima Retail"><div><b>Lima Retail</b><span>Data Driven Marketing</span></div></div>
        <div class="rp-cover-body">
          <span class="rp-cover-badge">G</span>
          <h1>Reporte de Publicidad</h1>
          <p class="rp-cover-client">Cliente: <b>${BRAND}</b></p>
          <p class="rp-cover-period">${esc(report.labels.cover)}<span class="rp-cover-sep"></span>${esc(CHANNEL)}</p>
        </div>
        <footer class="rp-foot">
          <span>${AGENCY_LINE}</span>
          <span class="rp-foot-right"><img src="${LOGO}" alt=""><b>Lima Retail</b>Emitido el ${esc(issuedLabel())}</span>
        </footer>
      </section>`;
  }

  function contentsPage(report, pages, total) {
    const n = report.detailed.length;
    const range = n > 1 ? `${pageNumber(pages.firstCampaign)}–${pageNumber(pages.firstCampaign + n - 1)}` : pageNumber(pages.firstCampaign);
    const items = [
      { title: 'Resumen de leads', desc: `Inversión, leads, costo por lead y ${report.item.period.closed ? 'cierre del mes' : 'proyección de cierre'}.`, icon: 'briefcase', page: pageNumber(pages.summary) },
      { title: 'Distribución de inversión', desc: 'Cómo se repartió el presupuesto por campaña (SKAG).', icon: 'layers', page: pageNumber(pages.distribution) },
      { title: 'Desempeño por campaña', desc: 'Cada servicio de un vistazo: leads, CPL, CTR y calidad.', icon: 'chart', page: pageNumber(pages.performance) },
      n ? { title: 'Detalle por campaña', desc: `Una página por servicio (${n}): qué funciona, qué no y su presupuesto.`, icon: 'grid', page: range } : null,
      { title: 'Palabras clave y calidad', desc: 'Qué términos traen leads, en qué campaña y su nivel de calidad.', icon: 'star', page: pageNumber(pages.keywords) },
      { title: 'Conclusiones', desc: 'Qué funciona y próximos pasos.', icon: 'flag', page: pageNumber(pages.conclusions) },
    ].filter(Boolean);
    return `
      <section class="rp-page">
        <header class="rp-head"><h2>Contenido del reporte</h2><p>Qué encontrarás en cada sección de este informe.</p></header>
        <div class="rp-body rp-contents rp-contents-2">
          ${items.map((item, index) => `
            <div class="rp-card rp-toc">
              <div class="rp-toc-top"><span class="rp-icon framed">${icon(item.icon)}</span><span class="rp-toc-num">${pageNumber(index + 1)}</span></div>
              <h3>${esc(item.title)}</h3>
              <p>${esc(item.desc)}</p>
              <span class="rp-toc-page">${item.page.includes('–') ? 'Páginas' : 'Página'} ${item.page}</span>
            </div>`).join('')}
        </div>
        ${footer(report.labels.source, report, 2, total)}
      </section>`;
  }

  function summaryPage(report, notes, page, total) {
    const { current, previous } = report;
    const prev = key => (previous ? previous[key] : null);
    const text = suggestSummary(report);
    const n = report.detailed.length;
    const cards = [
      kpi({ label: 'Inversión', value: money(current.cost), foot: `${n} ${n === 1 ? 'campaña' : 'campañas'} SKAG` }),
      kpi({ label: 'Leads', value: leads(current.conversions), foot: 'Conversiones', badge: pill(versus(current.conversions, prev('conversions'))) }),
      kpi({ label: 'CPL', value: isNum(current.cpl) ? money(current.cpl) : '<span class="rp-neg">Sin leads</span>', foot: 'Costo por lead', badge: pill(versus(current.cpl, prev('cpl'))) }),
      kpi({ label: 'Tasa conv.', value: share(current.conversionRate), foot: 'Clic → lead', badge: pill(versus(current.conversionRate, prev('conversionRate'), '')) }),
      kpi({ label: 'CPC medio', value: money2(current.cpc), foot: 'Costo por clic', badge: pill(versus(current.cpc, prev('cpc'), '')) }),
      kpi({ label: 'Impresiones', value: compact(current.impressions), foot: `Visibilidad · CTR ${percent(current.ctr)}`, badge: pill(versus(current.impressions, prev('impressions'), '')) }),
    ];
    return `
      <section class="rp-page">
        ${head(report, 'Resumen de leads', text.sub)}
        <div class="rp-body">
          <div class="rp-grid-6">${cards.join('')}</div>
          <div class="rp-split-2">
            <div class="rp-card rp-chart-card">
              <div class="rp-card-row">
                <div><div class="rp-card-title">Evolución de leads y costo por lead</div><div class="rp-card-sub">Por semana</div></div>
                ${legends([[BLUE, 'Leads'], [RED, 'Costo/lead']])}
              </div>
              ${weekChart(report.weeks)}
            </div>
            <div class="rp-stack">
              <div class="rp-projection">
                <span class="rp-insight-icon">${icon('trend')}</span>
                <div>
                  ${editable('resumen:cierre:titulo', noteOr(notes, 'resumen:cierre:titulo', text.closing.title), 'h3')}
                  ${editable('resumen:cierre', noteOr(notes, 'resumen:cierre', text.closing.text))}
                </div>
              </div>
              ${highlight('Destacado', 'bulb', 'resumen:destacado', noteOr(notes, 'resumen:destacado', text.highlight))}
              ${analysisCard('resumen:analisis', noteOr(notes, 'resumen:analisis', text.analysis))}
            </div>
          </div>
        </div>
        ${footer(report.labels.source, report, page, total)}
      </section>`;
  }

  function distributionPage(report, notes, page, total) {
    const { current, read } = report;
    const rows = report.detailed.slice(0, MAX_DISTRIBUTION_ROWS);
    const rest = report.detailed.slice(MAX_DISTRIBUTION_ROWS);
    const leader = read.converting[0] || report.detailed[0];
    const n = report.detailed.length;
    const cards = [
      kpi({ label: 'Inversión total', value: money(current.cost), foot: `${n} ${n === 1 ? 'campaña' : 'campañas'} SKAG` }),
      kpi({ label: 'Campaña líder', value: leader ? esc(leader.name) : '—', foot: leader ? `${share(leader.share)} del presupuesto · ${leadCount(leader.conversions)}` : '', className: 'rp-kpi-name' }),
      kpi({ label: `Top ${read.leaders.length || 1} servicios`, value: share(sum(read.leaders, 'cost') / (current.cost || 1)), foot: `del presupuesto · ${share(sum(read.leaders, 'conversions') / (read.totalLeads || 1))} de leads` }),
      kpi({ label: 'CPL promedio', value: money1(current.cpl), foot: 'Inversión ÷ leads' }),
    ];
    const body = rows.map((row, index) => `
      <tr${index === 0 ? ' class="rp-top"' : ''}>
        <td class="rp-name"><i class="rp-dot" style="background:${row.color}"></i>${esc(row.name)}</td>
        <td class="num">${money(row.cost)}</td>
        <td class="num">${percent1(row.share)}</td>
        <td class="num">${row.conversions > 0 ? `<b>${leads(row.conversions)}</b>` : '<span class="rp-neg">0</span>'}</td>
        <td class="num">${row.conversions > 0 ? money1(row.cpl) : tag('bad', 'Sin leads')}</td>
        <td class="num">${row.budget ? `<span class="rp-meter-cell">${meter(row.budget.used, 'inline')}${share(row.budget.used)} de ${money(row.budget.month)}</span>` : '<span class="rp-faint">—</span>'}</td>
      </tr>`).join('');
    const totalRow = `
      <tr class="rp-total">
        <td>Total · ${n} ${n === 1 ? 'campaña' : 'campañas'}${rest.length ? ` (${rest.length} más en el total)` : ''}</td>
        <td class="num">${money(current.cost)}</td>
        <td class="num">100%</td>
        <td class="num">${leads(current.conversions)}</td>
        <td class="num">${money1(current.cpl)}</td>
        <td class="num">${report.budget ? `${share(report.budget.used)} de ${money(report.budget.month)}` : ''}</td>
      </tr>`;
    return `
      <section class="rp-page rp-dist-page">
        ${head(report, 'Distribución de inversión por campaña', 'Cada campaña SKAG trabaja un servicio. Así se repartió el presupuesto y qué leads trajo cada uno.')}
        <div class="rp-body">
          <div class="rp-grid-4">${cards.join('')}</div>
          <div class="rp-card rp-dist-card">
            <div class="rp-card-head">${icon('layers')}<div><b>Inversión por campaña <span class="rp-card-head-sub">· cada servicio con su participación, leads, costo por lead y uso de su presupuesto del mes</span></b></div></div>
            <div class="rp-dist">
              ${donut(report.detailed, current.cost)}
              <table class="rp-table rp-tight rp-dist-table">
                <colgroup><col><col style="width:12%"><col style="width:10%"><col style="width:9%"><col style="width:13%"><col style="width:23%"></colgroup>
                <thead><tr><th>Servicio</th><th class="num">Inversión</th><th class="num">% Inv.</th><th class="num">Leads</th><th class="num">CPL</th><th class="num">Presupuesto usado</th></tr></thead>
                <tbody>${body}${totalRow}</tbody>
              </table>
            </div>
          </div>
          ${highlight('Destacado', 'bulb', 'distribucion:destacado', noteOr(notes, 'distribucion:destacado', suggestDistribution(report)))}
        </div>
        ${footer(`${report.labels.source} · presupuesto: diario vigente × días del mes`, report, page, total)}
      </section>`;
  }

  function performancePage(report, notes, page, total) {
    const { read } = report;
    const best = read.efficient[0] || read.cheapest;
    const most = read.converting[0];
    const ctr = read.bestCtr;
    const fix = read.optimize;
    const cards = [
      kpi({ label: 'Mejor CPL con demanda', value: best ? money1(best.cpl) : '—', foot: best ? `${esc(best.name)} · ${leadCount(best.conversions)}` : 'Sin leads', badge: best ? '<span class="rp-pill">Más eficiente</span>' : '' }),
      kpi({ label: 'Más leads', value: most ? leads(most.conversions) : '0', foot: most ? esc(most.name) : 'Sin leads en el período' }),
      kpi({ label: 'Mejor CTR', value: ctr ? percent1(ctr.ctr) : '—', foot: ctr ? esc(ctr.name) : '', badge: ctr ? tag(ctrLevel(ctr.ctr).tone, ctrLevel(ctr.ctr).label) : '' }),
      kpi({
        label: 'A optimizar',
        value: fix ? esc(fix.name) : 'Nada urgente',
        foot: !fix ? 'Todas convierten a buen costo' : fix.verdict === VERDICTS.none ? `${money(fix.cost)} sin leads · ${count(fix.clicks)} clics` : `${count(fix.clicks)} clics · CPL ${money1(fix.cpl)}`,
        badge: fix ? tag(fix.verdict.tone, fix.verdict.label) : '',
        className: 'rp-kpi-name',
      }),
    ];
    const shown = report.detailed.slice(0, MAX_CAMPAIGN_CARDS);
    const rest = report.detailed.slice(MAX_CAMPAIGN_CARDS);
    const campaignCards = shown.map(row => {
      const level = ctrLevel(row.ctr);
      const zero = !(row.conversions > 0);
      return `
        <div class="rp-card rp-camp-card${row === most ? ' lead' : ''}" style="--camp:${row.color}">
          <div class="rp-camp-card-top"><b title="${esc(row.name)}">${esc(row.name)}</b>${qualityBadge(row.quality)}</div>
          <div class="rp-camp-card-main"><strong class="${zero ? 'zero' : ''}">${leads(row.conversions || 0)}</strong><span class="rp-camp-sub">leads · ${zero ? 'sin leads aún' : `CPL ${money1(row.cpl)}`}</span>${row.verdict ? tag(row.verdict.tone, row.verdict.label) : ''}</div>
          <dl>
            <dt>Inversión</dt><dd>${money(row.cost)}</dd><dt>Clics</dt><dd>${count(row.clicks)}</dd>
            <dt>CTR</dt><dd class="${level ? level.tone : ''}">${percent(row.ctr)}</dd><dt>CPC</dt><dd>${money2(row.cpc)}</dd>
          </dl>
        </div>`;
    }).join('');
    const leaders = read.leaders;
    const cpls = leaders.map(row => row.cpl).filter(isNum);
    const foot = `Calidad = nivel de calidad de Google (0–10)${report.keywords && report.keywords.hasQuality ? '' : ', aparece cuando el informe de palabras clave lo trae'}. CTR en verde: bueno (desde ${share(CTR_GOOD)}); en rojo: bajo (menos de ${share(CTR_OK)}). CPL alto: más de ${Math.round((CPA_MARGIN - 1) * 100)}% sobre el de la cuenta.${leaders.length > 1 ? ` ${list(leaders.map(row => row.name))} concentran ${leads(sum(leaders, 'conversions'))} de los ${leads(read.totalLeads)} leads${cpls.length > 1 ? ` a CPL de ${money(Math.min(...cpls))}–${Math.round(Math.max(...cpls))}` : ''}.` : ''}${rest.length ? ` ${rest.length} ${rest.length === 1 ? 'campaña más' : 'campañas más'} con menor inversión.` : ''}`;
    return `
      <section class="rp-page">
        ${head(report, 'Desempeño por campaña', 'Cada campaña SKAG por separado, con sus leads y KPIs del periodo.')}
        <div class="rp-body">
          <div class="rp-grid-4">${cards.join('')}</div>
          <div class="rp-camp-cards">${campaignCards}</div>
          <p class="rp-cards-foot">${esc(foot)}</p>
        </div>
        ${footer(report.labels.source, report, page, total)}
      </section>`;
  }

  function campaignPage(report, campaign, index, notes, page, total) {
    const { read } = report;
    const prev = campaign.previous;
    const compare = report.item.period.compare;
    const zero = !(campaign.conversions > 0);
    // Contra el mes previo; "Nueva" si no corria y nada si la variacion no dice nada.
    const vs = (key, suffix = ' vs mes previo') => (prev ? versus(campaign[key], prev[key], suffix) : compare ? 'Nueva' : '');
    const level = ctrLevel(campaign.ctr);
    const accountCpl = read.accountCpl;
    const budget = campaign.budget;
    const cards = [
      kpi({ label: 'Inversión', value: money(campaign.cost), foot: prev ? `Mes previo: ${money(prev.cost)}` : compare ? `No corría en ${compare.month.name}` : 'Sin mes previo', badge: pill(`${share(campaign.share)} del total`), className: 'compact' }),
      kpi({ label: 'Leads', value: zero ? '<span class="rp-neg">0</span>' : leads(campaign.conversions), foot: `Tasa ${share(campaign.conversionRate)} clic → lead`, badge: pill(vs('conversions', '')), className: 'compact' }),
      kpi({ label: 'CPL', value: zero ? '<span class="rp-neg">Sin leads</span>' : money2(campaign.cpl), foot: zero ? `${money(campaign.cost)} gastados sin leads` : `Cuenta: ${money2(accountCpl)}`, badge: zero ? '' : pill(versus(campaign.cpl, accountCpl, ' vs cuenta')), className: 'compact' }),
      kpi({ label: 'Clics', value: count(campaign.clicks), foot: `CPC ${money2(campaign.cpc)}`, badge: pill(vs('clicks', '')), className: 'compact' }),
      kpi({ label: 'CTR', value: percent(campaign.ctr), foot: `Bueno desde ${share(CTR_GOOD)}`, badge: level ? tag(level.tone, level.label) : '', className: 'compact' }),
      budget
        ? kpi({ label: 'Presupuesto del mes', value: money(budget.month), foot: `Usó ${share(budget.used)} · ${budget.closed ? 'sin usar' : 'quedan'} ${money(budget.left)}`, extra: meter(budget.used), className: 'compact' })
        : kpi({ label: 'Presupuesto del mes', value: '—', foot: 'Sin presupuesto en el informe', className: 'compact' }),
    ];
    const keywordsOf = campaign.keywords;
    let table;
    if (!keywordsOf) {
      table = '<p class="rp-empty">Cargando el informe de palabras clave...</p>';
    } else {
      const sorted = keywordsOf.slice().sort(byLeads);
      const rest = sorted.slice(MAX_CAMPAIGN_KEYWORDS);
      const more = rest.length ? `${rest.length} ${rest.length === 1 ? 'palabra clave más' : 'palabras clave más'}${report.keywords.costOk ? ` (${money(sum(rest, 'cost'))})` : ''}.` : '';
      table = `
        ${keywordTable(sorted.slice(0, MAX_CAMPAIGN_KEYWORDS), { report, reference: isNum(campaign.cpl) ? campaign.cpl : accountCpl, withCampaign: false, empty: 'Sin palabras clave con actividad en el período.' })}
        ${more ? `<div class="rp-table-foot">${esc(more)}</div>` : ''}`;
    }
    const active = activeDays(report.item, campaign.key);
    const monthName = report.item.month.name.toLowerCase();
    const ran = !active ? '' : active.first > report.item.from ? ` · activa desde el ${active.first} de ${monthName}` : ` · activa hasta el ${active.last} de ${monthName}`;
    const sub = `Campaña ${index + 1} de ${report.detailed.length} · búsqueda · ${(campaign.status || 'sin estado').toLowerCase()}${ran} · ${share(campaign.share)} de la inversión y ${share((campaign.conversions || 0) / (read.totalLeads || 1))} de los leads${isNum(campaign.quality) ? ` · calidad ${Math.round(campaign.quality)}/10` : ''}.`;
    return `
      <section class="rp-page rp-camp-page" style="--camp:${campaign.color}">
        ${head(report, campaign.name, sub, campaign.verdict ? ` ${tag(campaign.verdict.tone, campaign.verdict.label)}` : '')}
        <div class="rp-body rp-camp-body">
          <div class="rp-grid-6">${cards.join('')}</div>
          <div class="rp-card rp-chart-card rp-chart-wide rp-camp-chart">
            <div class="rp-card-row">
              <div class="rp-card-title">Clics y leads por día</div>
              ${legends([[BLUE, 'Clics'], [INK, 'Leads']])}
            </div>
            ${dayChart(dailySeries(report.item, campaign.key), 168, `Clics y leads por día de ${campaign.name}`)}
          </div>
          <div class="rp-camp-bottom">
            <div class="rp-card rp-table-card">
              <div class="rp-card-title">Palabras clave de la campaña</div>
              ${table}
            </div>
            ${analysisCard(`camp:${campaign.key}`, noteOr(notes, `camp:${campaign.key}`, suggestCampaign(report, campaign)))}
          </div>
        </div>
        ${footer(report.labels.source, report, page, total)}
      </section>`;
  }

  function keywordsPage(report, notes, page, total) {
    const data = report.keywords;
    const title = 'Palabras clave y calidad';
    const sub = 'Qué términos traen leads, en qué campaña y su nivel de calidad en Google.';
    if (!data) {
      return `
        <section class="rp-page">
          ${head(report, title, sub)}
          <div class="rp-body"><p class="rp-empty rp-chart-empty">Cargando el informe de palabras clave...</p></div>
          ${footer(report.labels.source, report, page, total)}
        </section>`;
    }
    const wasted = data.rows.filter(spentWithout);
    const foot = data.rows.length
      ? `${data.rows.length} palabras clave con actividad; suman ${partOf(data.total, report.current.conversions)} de las campañas${wasted.length && data.costOk ? ` y ${wasted.length} gastaron ${money(sum(wasted, 'cost'))} sin leads` : ''}. Lectura frente al CPL de la cuenta (${money1(report.current.cpl)}). Informe de ${data.label || 'Google Ads'}.${data.costOk ? '' : ' El costo por palabra del informe no cuadra con el de las campañas (revisar la importación), así que no se muestra.'}`
      : `Sin informe de palabras clave para ${report.item.month.name} ${report.item.month.year}.`;
    const text = suggestKeywords(report);
    let qualityCard = '';
    if (data.hasQuality) {
      const scored = data.rows.filter(row => isNum(row.qualityScore)).sort((left, right) => (right.impressions || 0) - (left.impressions || 0)).slice(0, MAX_QUALITY_BARS);
      qualityCard = `
        <div class="rp-card rp-quality">
          <div class="rp-card-head">${icon('star')}<div><b>Nivel de calidad por término</b><span>Puntaje de Google (0–10)</span></div></div>
          <div class="rp-qbars">
            ${scored.map(row => `<span title="${esc(plainKeyword(row.keyword))}">${esc(plainKeyword(row.keyword))}</span><span class="rp-qbar"><i style="width:${(row.qualityScore * 10).toFixed(0)}%"></i></span><b>${Math.round(row.qualityScore)}/10</b>`).join('')}
          </div>
          ${editable('palabras:calidad', noteOr(notes, 'palabras:calidad', text.quality), 'p', 'rp-quality-text')}
        </div>`;
    }
    return `
      <section class="rp-page">
        ${head(report, title, sub)}
        <div class="rp-body">
          <div class="rp-card rp-table-card">
            ${keywordTable(data.rows.slice(0, qualityCard ? MAX_KEYWORD_ROWS - 2 : MAX_KEYWORD_ROWS), { report, reference: report.current.cpl, withCampaign: true, empty: 'Sin palabras clave con actividad en el período.' })}
            <div class="rp-table-foot">${esc(foot)}</div>
          </div>
          <div class="rp-fill rp-kw-cards${qualityCard ? ' with-quality' : ''}">
            ${qualityCard}
            ${noteCard('La que más convierte', 'trend', 'good', 'palabras:top', noteOr(notes, 'palabras:top', text.top))}
            ${noteCard('Funcionan mejor (menor CPL)', 'coin', 'blue', 'palabras:mejores', noteOr(notes, 'palabras:mejores', text.best))}
            ${noteCard('Gastan sin convertir', 'cross', 'bad', 'palabras:sin', noteOr(notes, 'palabras:sin', text.waste))}
          </div>
        </div>
        ${footer(`${report.labels.source} · palabras clave y calidad de Google Ads`, report, page, total)}
      </section>`;
  }

  function conclusionsPage(report, notes, page, total) {
    const cards = suggestConclusions(report).map((card, index) => `
      <div class="rp-card rp-conclusion">
        <div class="rp-toc-top"><span class="rp-icon framed">${icon(card.icon)}</span><span class="rp-concl-num">${pageNumber(index + 1)}</span></div>
        ${editable(`concl:${index}:title`, noteOr(notes, `concl:${index}:title`, card.title), 'h3')}
        ${editable(`concl:${index}:text`, noteOr(notes, `concl:${index}:text`, card.text))}
      </div>`).join('');
    const steps = suggestSteps(report).map((step, index) => `
      <div class="rp-step${index === 0 ? ' first' : ''}">
        <span class="rp-insight-icon">${icon(step.icon)}</span>
        <div>
          ${editable(`paso:${index}:title`, noteOr(notes, `paso:${index}:title`, step.title), 'b')}
          ${editable(`paso:${index}:text`, noteOr(notes, `paso:${index}:text`, step.text))}
        </div>
      </div>`).join('');
    const projected = projection(report);
    const note = projected
      ? `**Periodo:** ${report.labels.period}. La proyección de cierre (~${report.current.conversions > 0 ? `${count(projected.leads)} leads` : money(projected.cost)}) es una estimación basada en el ritmo actual, no un resultado garantizado.`
      : `**Periodo:** ${report.labels.period}. El presupuesto del mes es el diario vigente de cada campaña por los días del mes.`;
    return `
      <section class="rp-page">
        ${head(report, 'Conclusiones y próximos pasos', `Qué funcionó en ${report.item.month.name.toLowerCase()} y qué se hará en las próximas semanas.`)}
        <div class="rp-body">
          <div class="rp-grid-3 rp-conclusions">${cards}</div>
          <div class="rp-card rp-steps">
            <div class="rp-analysis-head">${icon('flag')}<b>Próximos pasos</b></div>
            <div class="rp-steps-list">${steps}</div>
          </div>
          <div class="rp-note">${rich(note)}</div>
        </div>
        ${footer(report.labels.analysisSource, report, page, total)}
      </section>`;
  }

  function closingPage() {
    return `
      <section class="rp-page rp-closing">
        <img src="${LOGO}" alt="Lima Retail">
        <b>Lima Retail</b>
        <span class="rp-closing-tag">Data Driven Marketing</span>
        <span>Power KPI · Digital Analytics</span>
      </section>`;
  }

  // ── Pintado ────────────────────────────────────────────────────────────
  function fitDeck() {
    const host = document.getElementById('week-report');
    if (!host || !host.clientWidth) return;
    host.style.setProperty('--rp-scale', String(Math.min(1, host.clientWidth / PAGE_WIDTH)));
  }

  function wireEditables(host, monthId) {
    host.querySelectorAll('[data-note]').forEach(node => {
      try {
        node.contentEditable = 'plaintext-only';
      } catch (error) {
        node.contentEditable = 'true';
      }
      node.spellcheck = false;
      node.addEventListener('focus', () => { node.textContent = node.dataset.raw; });
      node.addEventListener('input', () => {
        node.dataset.raw = node.innerText.replace(/\n+$/, '');
        saveNote(monthId, node.dataset.note, node.dataset.raw);
      });
      node.addEventListener('blur', () => { node.innerHTML = rich(node.dataset.raw); });
    });
  }

  function render() {
    const host = document.getElementById('week-report');
    if (!host || !G()) return;
    const available = months();
    const select = document.getElementById('week-select');
    if (!available.length) {
      if (select) select.innerHTML = '<option value="">Sin meses con datos</option>';
      host.innerHTML = '<div class="panel"><div class="empty-state"><strong>Todavía no hay datos para el reporte</strong><span>El reporte se arma con los informes de Google Ads. En cuanto haya un mes con inversión, aparece aquí.</span></div></div>';
      return;
    }
    if (!available.some(item => item.id === state.month)) state.month = available[0].id;
    const item = available.find(entry => entry.id === state.month);
    if (select) {
      select.innerHTML = available.map(entry => `<option value="${esc(entry.id)}"${entry.id === state.month ? ' selected' : ''}>${esc(entry.option)}</option>`).join('');
    }
    const report = buildReport(item);
    const notes = readNotes()[item.id] || {};
    // Portada, contenido, resumen, distribucion, desempeño, una por campaña, palabras clave, conclusiones y cierre.
    const n = report.detailed.length;
    const pages = { summary: 3, distribution: 4, performance: 5, firstCampaign: 6, keywords: 6 + n, conclusions: 7 + n };
    const total = 8 + n;
    // Aviso solo en pantalla (no sale en el PDF): el nivel de calidad depende de que el informe lo traiga.
    const notice = report.keywords && !report.keywords.hasQuality
      ? '<p class="rp-screen-note">El informe de palabras clave de este mes no trae el <b>Nivel de calidad</b>: la calidad de cada término y campaña aparece en cuanto la hoja de Drive lo incluya.</p>'
      : '';
    host.innerHTML = `
      ${notice}
      <div class="rp-deck" id="week-doc">
        ${coverPage(report)}
        ${contentsPage(report, pages, total)}
        ${summaryPage(report, notes, pages.summary, total)}
        ${distributionPage(report, notes, pages.distribution, total)}
        ${performancePage(report, notes, pages.performance, total)}
        ${report.detailed.map((campaign, index) => campaignPage(report, campaign, index, notes, pages.firstCampaign + index, total)).join('')}
        ${keywordsPage(report, notes, pages.keywords, total)}
        ${conclusionsPage(report, notes, pages.conclusions, total)}
        ${closingPage()}
      </div>`;
    fitDeck();
    wireEditables(host, item.id);
  }

  // El nombre del PDF lo pone el navegador con el titulo del documento: se cambia solo mientras imprime.
  function printReport() {
    const item = months().find(entry => entry.id === state.month);
    if (!item) return;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const title = document.title;
    document.title = `Reporte_Aquarius_${item.labels.file}`;
    const restore = () => {
      document.title = title;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
    window.setTimeout(restore, 2000);
  }

  function init() {
    render();
    if (state.wired) return;
    state.wired = true;
    const select = document.getElementById('week-select');
    if (select) {
      select.addEventListener('change', event => {
        state.month = event.target.value;
        render();
      });
    }
    const print = document.getElementById('week-print');
    if (print) print.addEventListener('click', printReport);
    // Sin dialogo de confirmacion: el boton vuelve directo a los textos propuestos del mes.
    const reset = document.getElementById('week-reset');
    if (reset) {
      reset.addEventListener('click', () => {
        if (!state.month) return;
        resetNotes(state.month);
        render();
      });
    }
    const host = document.getElementById('week-report');
    if (host && typeof window.ResizeObserver === 'function') new window.ResizeObserver(fitDeck).observe(host);
  }

  // Llega al cargar, al sincronizar con Drive y cuando terminan de cargar las palabras clave.
  const refresh = () => {
    if (document.getElementById('view-week')?.classList.contains('visible')) render();
  };
  window.addEventListener('aquarius:data-ready', refresh);
  window.addEventListener('aquarius:keywords-ready', refresh);

  window.AquariusReport = { init, render };
})();
