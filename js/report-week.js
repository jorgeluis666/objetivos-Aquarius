(function () {
  // Generacion de Reporte: el PDF de publicidad con el diseño del modelo de Aquarius ("Modelo Reporte
  // Aquarius"): laminas 16:9 con portada, contenido, resumen del mes (KPIs y clics y conversiones por dia),
  // rendimiento por campaña, palabras clave que convierten, conclusiones y cierre.
  //
  // No trae datos nuevos: el periodo, la comparacion con el mes anterior (prorrateado si el mes esta en
  // curso), los totales, las campañas y las palabras clave del mes salen de Gasto Publicitario
  // (window.AquariusGasto), asi que cada sincronizacion con Drive lo actualiza solo. La lectura del grafico,
  // los analisis, el texto "Clave" y las conclusiones vienen propuestos con lo que dicen los numeros; el
  // equipo los reescribe sobre la misma lamina y quedan guardados por mes en este navegador.
  //
  // El template es propio de Aquarius: cada tablero de marca tiene el suyo, adaptado por la marca.
  const BRAND = 'Aquarius Consulting';
  const NOTES_KEY = 'aquarius_report_notes_v1';
  const MAX_ROWS = 6;
  const PAGE_WIDTH = 1280;
  const LOGO = 'assets/logo-lima-retail.png';
  const AGENCY_LINE = 'Lima Retail · Data Driven Marketing · Power KPI · Digital Analytics';
  const CHANNEL = 'Google Ads · Search';
  const SCOPE = 'campañas de búsqueda B2B (servicios logísticos y drones)';
  const CLICKS_COLOR = '#2563eb';
  const CONV_COLOR = '#0f172a';
  const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  // Iconos de linea (24x24) de las tarjetas de contenido y conclusiones.
  const ICONS = {
    chart: '<path d="M3 3v18h18"/><path d="M8 17v-5"/><path d="M13 17V8"/><path d="M18 17v-3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    flag: '<path d="M4 22V4"/><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1"/>',
    trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
    line: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
    pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.chart}</svg>`;

  const state = { month: '', wired: false };

  const G = () => window.AquariusGasto;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const isNum = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

  // ── Formatos del modelo ("S/ 506", "S/ 2.03", "8.14%", "13", "+190.9%") ──
  const integer = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });
  const money = value => (isNum(value) ? `S/ ${integer.format(Math.round(value))}` : '—');
  const money2 = value => (isNum(value) ? `S/ ${Number(value).toFixed(2)}` : '—');
  const count = value => (isNum(value) ? integer.format(Math.round(value)) : '—');
  const percent = value => (isNum(value) ? `${(Number(value) * 100).toFixed(2).replace(/\.?0+$/, '')}%` : '—');
  // Google Ads reparte conversiones entre campañas y palabras: con decimales solo si los hay.
  const conv = value => (!isNum(value) ? '—' : Math.abs(value - Math.round(value)) < 0.005 ? integer.format(Math.round(value)) : Number(value).toFixed(2));
  const change = (current, previous) => (isNum(current) && isNum(previous) && Number(previous) !== 0 ? (Number(current) - Number(previous)) / Number(previous) : null);
  const pct1 = value => `${value >= 0 ? '+' : '-'}${Math.abs(value * 100).toFixed(1)}%`;
  const pct0 = value => `${value >= 0 ? '+' : '-'}${Math.abs(Math.round(value * 100))}%`;
  const pageNumber = value => String(value).padStart(2, '0');
  const list = items => (items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}` : items[0] || '');
  const quoted = items => list(items.map(item => `"${item}"`));

  // ── El mes del reporte ─────────────────────────────────────────────────
  function months() {
    if (!G()) return [];
    return G().months().slice().reverse().map(month => {
      const period = G().period(month.key);
      if (!period) return null;
      const from = month.firstDay;
      const to = month.lastDay;
      const short = month.shortName.toLowerCase();
      const range = `${from} – ${to}`;
      return {
        id: month.key,
        month,
        period,
        from,
        to,
        option: `${month.name} ${month.year}${period.closed ? '' : ` · ${from}–${to} (en curso)`}`,
        labels: {
          cover: period.closed ? `${month.name} ${month.year}` : `${range} ${month.name} ${month.year}`,
          intro: period.closed ? `${month.name} completo: ${SCOPE}` : `Primeros ${to - from + 1} días de ${month.name.toLowerCase()}: ${SCOPE}`,
          source: `Fuente: Google Ads · ${range} ${short} ${month.year}`,
          analysisSource: `Fuente: análisis Lima Retail sobre Google Ads · ${range} ${short} ${month.year}`,
          footer: `${BRAND} · Reporte Google Ads · ${period.closed ? `${month.name} ${month.year}` : `${from}-${to} ${month.name} ${month.year}`}`,
          note: period.closed ? '' : `**Datos del período ${range} de ${month.name.toLowerCase()}.** Las métricas se consolidan al cierre del mes.`,
          file: `${month.name}${month.year}${period.closed ? '' : `_${from}-${to}`}`,
        },
      };
    }).filter(Boolean);
  }

  // Clics y conversiones por dia: del informe por dia y campaña del mes (month.detail) cuando llega.
  function dailySeries(item) {
    const detail = Array.isArray(item.month.detail) ? item.month.detail : [];
    const byDay = new Map();
    detail.forEach(row => {
      if (row.d < item.from || row.d > item.to) return;
      const day = byDay.get(row.d) || { d: row.d, clicks: 0, conversions: 0 };
      day.clicks += Number(row.clicks) || 0;
      day.conversions += Number(row.conversions) || 0;
      byDay.set(row.d, day);
    });
    return [...byDay.values()].sort((left, right) => left.d - right.d);
  }

  function campaigns(period) {
    return G().campaigns(period).map(campaign => Object.assign({}, campaign, {
      name: campaign.label || G().campaignLabel(campaign.name),
      ctr: Number(campaign.impressions) > 0 ? campaign.clicks / campaign.impressions : null,
      costPerConversion: Number(campaign.conversions) > 0 ? campaign.cost / campaign.conversions : null,
    }));
  }

  // Palabras clave del mes, de mas a menos conversiones. La misma palabra en varias campañas o con dos
  // concordancias va en una sola fila, como la lee el cliente. Si el costo de las palabras no cuadra con el
  // de las campañas (un informe importado con los decimales corridos), no se muestra: un costo por
  // conversion inflado llevaria a depurar los terminos equivocados.
  function keywords(period, accountCost) {
    const source = G().keywords(period);
    if (!source) return null;
    const byName = new Map();
    source.forEach(row => {
      const name = String(row.keyword || '').trim().toLowerCase();
      if (!byName.has(name)) byName.set(name, { keyword: String(row.keyword || '').trim(), conversions: 0, cost: 0, impressions: 0, clicks: 0 });
      const entry = byName.get(name);
      ['conversions', 'cost', 'impressions', 'clicks'].forEach(field => { entry[field] += Number(row[field]) || 0; });
    });
    const keywordCost = [...byName.values()].reduce((sum, row) => sum + row.cost, 0);
    const costOk = !(isNum(accountCost) && accountCost > 0 && keywordCost > accountCost * 1.2);
    const rows = [...byName.values()]
      .map(row => Object.assign(row, {
        cost: costOk ? row.cost : null,
        ctr: row.impressions > 0 ? row.clicks / row.impressions : null,
        costPerConversion: costOk && row.conversions > 0 && row.cost > 0 ? row.cost / row.conversions : null,
      }))
      .filter(row => row.conversions > 0 || row.cost > 0 || row.clicks > 0)
      .sort((left, right) => right.conversions - left.conversions || (right.cost || 0) - (left.cost || 0) || right.clicks - left.clicks);
    return { rows, costOk, total: rows.reduce((sum, row) => sum + row.conversions, 0), label: G().keywordLabel(period) };
  }

  // Un termino "gasta sin convertir" si tuvo costo (o, sin costo confiable, clics) y ninguna conversion.
  const spentWithout = row => !(row.conversions > 0) && (Number(row.cost) > 0 || (row.cost === null && row.clicks > 0));

  function buildReport(item) {
    const current = G().totals(item.period);
    return {
      item,
      labels: item.labels,
      current,
      previous: G().previous(item.period),
      days: dailySeries(item),
      campaigns: campaigns(item.period),
      keywords: keywords(item.period, current.cost),
    };
  }

  // ── Textos propuestos (el equipo los reescribe sobre la lamina) ─────────
  function suggestChartNote(report) {
    const parts = [];
    const clicks = report.days.map(day => day.clicks);
    if (clicks.length > 2) {
      const mean = clicks.reduce((sum, value) => sum + value, 0) / clicks.length;
      const spread = Math.sqrt(clicks.reduce((sum, value) => sum + (value - mean) ** 2, 0) / clicks.length);
      parts.push(mean > 0 && spread / mean > 0.45 ? 'Tráfico irregular' : 'Tráfico constante');
    }
    const converting = report.campaigns.filter(campaign => campaign.conversions > 0).sort((left, right) => right.conversions - left.conversions);
    const total = converting.reduce((sum, campaign) => sum + campaign.conversions, 0);
    if (converting.length > 1 && converting[0].conversions / total < 0.5) parts.push(`las conversiones se reparten entre ${list(converting.slice(0, 3).map(campaign => campaign.name.toLowerCase()))}`);
    else if (converting.length) parts.push(`las conversiones se concentran en ${converting[0].name.toLowerCase()}`);
    const text = parts.join('; ');
    return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : '';
  }

  function suggestCampaignAnalysis(report) {
    const rows = report.campaigns;
    const total = rows.reduce((sum, campaign) => sum + (campaign.conversions || 0), 0);
    const converting = rows.filter(campaign => campaign.conversions > 0).sort((left, right) => right.conversions - left.conversions);
    const wasted = rows.filter(campaign => !(campaign.conversions > 0) && campaign.cost > 0);
    if (!converting.length) return '**Qué funciona:** ninguna campaña cerró contactos en el período. **Qué hacemos:** revisar palabras clave, anuncios y landing de cada servicio.';
    const top = converting.slice(0, 2);
    const share = Math.round((top.reduce((sum, campaign) => sum + campaign.conversions, 0) / total) * 100);
    const cheapest = [...converting].filter(campaign => isNum(campaign.costPerConversion)).sort((left, right) => left.costPerConversion - right.costPerConversion)[0];
    let works = `**Qué funciona:** ${list(top.map(campaign => `"${campaign.name}" (${conv(campaign.conversions)} conv)`))} ${top.length > 1 ? 'concentran' : 'concentra'} el ${share}% de las conversiones.`;
    if (cheapest && !top.includes(cheapest)) works += ` "${cheapest.name}" es la más eficiente (${money2(cheapest.costPerConversion)}/conv).`;
    const waste = wasted.reduce((sum, campaign) => sum + campaign.cost, 0);
    const improve = wasted.length
      ? ` **Qué mejoramos:** ${quoted(wasted.map(campaign => campaign.name))} ${wasted.length > 1 ? 'gastaron' : 'gastó'} ${money(waste)} sin convertir.`
      : ' **Qué mejoramos:** todas las campañas con inversión cerraron contactos; ajustar pujas para bajar el costo por conversión.';
    const next = ` **Qué hacemos:** reforzar ${list(top.map(campaign => campaign.name.toLowerCase()))}${wasted.length ? `, y revisar o pausar ${wasted.length > 1 ? `las ${wasted.length} que no cierran` : 'la que no cierra'}` : ''}.`;
    return `${works}${improve}${next}`;
  }

  function suggestKey(report) {
    const { rows } = report.keywords;
    const converting = rows.filter(row => row.conversions > 0);
    if (!converting.length) return 'Ningún término de búsqueda cerró contactos en el período: conviene revisar la intención de las palabras clave y las landing.';
    const [top, ...rest] = converting;
    const parts = [`"${top.keyword}" lidera con ${conv(top.conversions)} ${Math.round(top.conversions) === 1 ? 'conversión' : 'conversiones'} (${count(top.clicks)} clics).`];
    const cheap = rest.filter(row => isNum(row.costPerConversion)).sort((left, right) => left.costPerConversion - right.costPerConversion).slice(0, 2);
    if (cheap.length) parts.push(`${quoted(cheap.map(row => row.keyword))} ${cheap.length > 1 ? 'convierten' : 'convierte'} muy barato (${list(cheap.map(row => money2(row.costPerConversion)))}).`);
    if (rows.some(spentWithout)) parts.push('Los demás términos gastaron sin convertir.');
    return parts.join(' ');
  }

  function suggestKeywordAnalysis(report) {
    const { rows } = report.keywords;
    const converting = rows.filter(row => row.conversions > 0);
    const wasted = rows.filter(spentWithout).sort((left, right) => (right.cost || 0) - (left.cost || 0) || right.clicks - left.clicks);
    if (!converting.length) return '**Qué funciona:** ningún término cerró contactos. **Qué mejoramos:** revisar la concordancia y las landing. **Qué hacemos:** concentrar el presupuesto en las búsquedas con intención de contratar.';
    const names = converting.slice(0, 3).map(row => `"${row.keyword}" (${conv(row.conversions)})`);
    const works = `**Qué funciona:** ${converting.length === 1 ? 'un término cierra contactos' : `${converting.length > 3 ? 'varios' : ['', 'un', 'dos', 'tres'][converting.length]} términos cierran contactos`} — ${list(names)}.`;
    const improve = wasted.length
      ? ` **Qué mejoramos:** reforzar la puja en ${converting.length === 1 ? 'ese término' : 'esos términos'} y pausar o ajustar los que gastan sin convertir (${list(wasted.slice(0, 3).map(row => row.keyword))}).`
      : ` **Qué mejoramos:** reforzar la puja en ${converting.length === 1 ? 'ese término' : 'esos términos'} para ganar más impresiones.`;
    return `${works}${improve} **Qué hacemos:** concentrar el presupuesto en la intención de "${converting[0].keyword}", que es la que trae clientes.`;
  }

  function suggestConclusions(report) {
    const cards = [];
    const { current, previous } = report;
    const convChange = previous ? change(current.conversions, previous.conversions) : null;
    const costChange = previous ? change(current.costPerConversion, previous.costPerConversion) : null;
    const spendChange = previous ? change(current.cost, previous.cost) : null;
    if (convChange !== null) {
      const title = convChange >= 0.3 ? 'Mes en fuerte crecimiento' : convChange > 0 ? 'Mes en crecimiento' : convChange <= -0.3 ? 'Mes a la baja' : 'Mes estable';
      const efficient = costChange !== null && costChange <= 0;
      cards.push({
        icon: 'trend',
        title,
        text: `Las conversiones ${convChange >= 0 ? 'subieron' : 'bajaron'} ${pct0(convChange)}${costChange !== null ? ` y el costo por conversión ${efficient ? 'bajó' : 'subió'} ${pct0(costChange)} (a ${money(current.costPerConversion)})` : ''}. ${spendChange !== null ? `Con ${spendChange < 0 ? 'menos' : 'más'} inversión el canal se volvió ${efficient ? 'más eficiente' : 'menos eficiente'}.` : ''}`.trim(),
      });
    } else {
      cards.push({ icon: 'trend', title: 'Primer mes con datos', text: `${conv(current.conversions)} conversiones con ${money(current.cost)} de inversión (${money(current.costPerConversion)} por conversión). Es la base para comparar el próximo mes.` });
    }
    const converting = report.campaigns.filter(campaign => campaign.conversions > 0).sort((left, right) => right.conversions - left.conversions);
    const total = converting.reduce((sum, campaign) => sum + campaign.conversions, 0);
    const top = converting.slice(0, 2);
    if (top.length) {
      const share = Math.round((top.reduce((sum, campaign) => sum + campaign.conversions, 0) / total) * 100);
      cards.push({
        icon: 'search',
        title: top.length > 1 ? `${top[0].name} y ${top[1].name.toLowerCase()} mandan` : `${top[0].name} manda`,
        text: `${list(top.map(campaign => `"${campaign.name}" (${conv(campaign.conversions)})`))} ${top.length > 1 ? 'traen' : 'trae'} el ${share}% de las conversiones. Reforzar la puja en ${top.length > 1 ? 'estos servicios' : 'este servicio'} de alta demanda.`,
      });
    }
    const wasted = report.campaigns.filter(campaign => !(campaign.conversions > 0) && campaign.cost > 0);
    if (wasted.length) {
      cards.push({
        icon: 'line',
        title: 'Depurar lo que no cierra',
        text: `${quoted(wasted.map(campaign => campaign.name))} ${wasted.length > 1 ? 'gastaron' : 'gastó'} ${money(wasted.reduce((sum, campaign) => sum + campaign.cost, 0))} sin conversiones. Revisar y mover ese presupuesto a ${list(top.map(campaign => campaign.name.toLowerCase())) || 'los servicios que sí cierran'}.`,
      });
    }
    return cards.slice(0, 3);
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

  // **texto** va en negrita, como "Que funciona:" en el modelo.
  const rich = text => esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  // Texto editable sobre la lamina: al hacer clic se ve el texto con sus ** y al salir vuelve a negrita.
  const editable = (key, text, tag = 'p', className = '') => `<${tag} class="rp-edit ${className}" data-note="${esc(key)}" data-raw="${esc(text)}" title="Clic para editar · **texto** va en negrita">${rich(text)}</${tag}>`;
  const noteOr = (notes, key, suggested) => (notes[key] != null ? notes[key] : suggested);

  // ── Piezas de las laminas ──────────────────────────────────────────────
  const kpi = (label, value, foot) => `
    <div class="rp-card rp-kpi">
      <span class="rp-kpi-label">${esc(label)}</span>
      <strong>${value}</strong>
      <span class="rp-delta muted">${foot}</span>
    </div>`;

  // "▲ +59.9%": en el modelo las variaciones van en gris, con la flecha de su direccion.
  function delta(current, previous) {
    const value = change(current, previous);
    if (value === null) return '';
    return `${value >= 0 ? '▲' : '▼'} ${pct1(value)}`;
  }

  const head = (title, sub) => `<header class="rp-head"><h2>${esc(title)}</h2><p>${esc(sub)}</p></header>`;

  function footer(left, report, page, total) {
    return `
      <footer class="rp-foot">
        <span>${esc(left)}</span>
        <span class="rp-foot-right"><img src="${LOGO}" alt=""><b>Lima Retail</b>${esc(report.labels.footer)} · ${pageNumber(page)} / ${pageNumber(total)}</span>
      </footer>`;
  }

  function insight(label, iconName, key, text) {
    return `
      <div class="rp-insight">
        <span class="rp-insight-icon">${icon(iconName)}</span>
        <div>
          <span class="rp-insight-label">${label}</span>
          ${editable(key, text)}
        </div>
      </div>`;
  }

  // Clics y conversiones por dia, con lineas punteadas de referencia (como el modelo).
  function dailyChart(report) {
    const rows = report.days;
    if (!rows.length) {
      return '<p class="rp-empty rp-chart-empty">El informe por día de este mes todavía no está en el tablero: la evolución diaria aparece cuando se suba a Drive el informe de campaña por día.</p>';
    }
    const width = 1160;
    const top = 16;
    const bottom = 236;
    const left = 70;
    const right = width - 30;
    const clicks = rows.map(day => day.clicks);
    const conversions = rows.map(day => day.conversions);
    const peak = Math.max(...clicks, ...conversions, 1);
    const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find(size => peak / size <= 4) || 1000;
    const max = Math.ceil(peak / step) * step;
    const x = index => (rows.length > 1 ? left + ((right - left) * index) / (rows.length - 1) : (left + right) / 2);
    const y = value => bottom - (value / max) * (bottom - top);
    const grid = [];
    for (let value = step; value <= max; value += step) {
      grid.push(`<line x1="${left - 18}" x2="${right + 12}" y1="${y(value)}" y2="${y(value)}" class="rp-grid dashed"/><text x="${left - 40}" y="${y(value) + 4}" text-anchor="end" class="rp-tick big">${integer.format(value)}</text>`);
    }
    const line = (values, color) => `
      <polyline points="${values.map((value, index) => `${x(index)},${y(value)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>
      ${values.map((value, index) => `<circle cx="${x(index)}" cy="${y(value)}" r="3.4" fill="#fff" stroke="${color}" stroke-width="1.8"/>`).join('')}`;
    return `
      <svg class="rp-chart rp-chart-daily" viewBox="0 0 ${width} 262" preserveAspectRatio="xMidYMin meet" role="img" aria-label="Clics y conversiones por día">
        ${grid.join('')}
        <line x1="${left - 18}" x2="${right + 12}" y1="${bottom}" y2="${bottom}" class="rp-grid"/>
        ${line(clicks, CLICKS_COLOR)}
        ${line(conversions, CONV_COLOR)}
        ${rows.map((day, index) => `<text x="${x(index)}" y="${bottom + 20}" text-anchor="middle" class="rp-axis big">${day.d}</text>`).join('')}
      </svg>`;
  }

  // Tabla de campañas o palabras clave: coste, clics, conversiones, costo por conversion y CTR.
  function metricsTable(rows, nameHead, { empty }) {
    const body = rows.length ? rows.map((row, index) => {
      const zero = !(row.conversions > 0);
      return `<tr${index === 0 && !zero ? ' class="rp-top"' : ''}>
        <td class="rp-name" title="${esc(row.name)}">${esc(row.name)}</td>
        <td class="num">${money(row.cost)}</td>
        <td class="num">${count(row.clicks)}</td>
        <td class="num">${zero ? '<span class="rp-faint">0</span>' : conv(row.conversions)}</td>
        <td class="num">${zero || !isNum(row.costPerConversion) ? '<span class="rp-faint">—</span>' : money2(row.costPerConversion)}</td>
        <td class="num">${percent(row.ctr)}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="6" class="rp-empty">${esc(empty)}</td></tr>`;
    return `
      <table class="rp-table rp-keywords">
        <colgroup><col><col style="width:12%"><col style="width:10%"><col style="width:11%"><col style="width:17%"><col style="width:13%"></colgroup>
        <thead><tr><th>${esc(nameHead)}</th><th class="num">Coste</th><th class="num">Clics</th><th class="num">Conv.</th><th class="num">Costo/conv.</th><th class="num">CTR</th></tr></thead>
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
          <h1>Reporte de Publicidad</h1>
          <p class="rp-cover-client">Cliente: <b>${BRAND}</b></p>
          <p class="rp-cover-period">${esc(report.labels.cover)}&nbsp; | &nbsp;${esc(CHANNEL)}</p>
          <p class="rp-cover-intro">${esc(`${report.labels.intro} para contactos.`)}</p>
        </div>
        <footer class="rp-foot">
          <span>${AGENCY_LINE}</span>
          <span class="rp-foot-right"><img src="${LOGO}" alt=""><b>Lima Retail</b>Emitido el ${esc(issuedLabel())}</span>
        </footer>
      </section>`;
  }

  function contentsPage(report, total) {
    const items = [
      { title: 'Resumen del mes', desc: 'KPIs de la cuenta y evolución diaria.', icon: 'chart', page: 3 },
      { title: 'Campañas', desc: 'Rendimiento por servicio.', icon: 'layers', page: 4 },
      { title: 'Palabras clave', desc: 'Términos que generan conversiones.', icon: 'search', page: 5 },
      { title: 'Conclusiones', desc: 'Crecimiento y prioridades.', icon: 'flag', page: 6 },
    ];
    return `
      <section class="rp-page">
        ${head('Contenido del reporte', 'Qué encontrarás en cada sección de este informe mensual.')}
        <div class="rp-body rp-contents">
          ${items.map((item, index) => `
            <div class="rp-card rp-toc">
              <div class="rp-toc-top"><span class="rp-icon">${icon(item.icon)}</span><span class="rp-toc-num">${pageNumber(index + 1)}</span></div>
              <h3>${esc(item.title)}</h3>
              <p>${esc(item.desc)}</p>
              <span class="rp-toc-page">Página ${pageNumber(item.page)}</span>
            </div>`).join('')}
        </div>
        ${footer(report.labels.source, report, 2, total)}
      </section>`;
  }

  function summaryPage(report, notes, total) {
    const { current, previous } = report;
    const prev = key => (previous ? previous[key] : null);
    const costChange = change(current.costPerConversion, prev('costPerConversion'));
    const rate = isNum(current.conversionRate) ? `${Math.round(current.conversionRate * 100)}%` : '—';
    const cards = [
      kpi('Inversión', money(current.cost), previous ? `${delta(current.cost, prev('cost'))} vs período ant.` : 'Sin mes anterior'),
      kpi('Conversiones', conv(current.conversions), previous ? `${delta(current.conversions, prev('conversions'))} vs período ant.` : 'Contactos registrados'),
      kpi('Costo x conversión', money(current.costPerConversion), costChange === null ? 'Inversión ÷ conversiones' : `${delta(current.costPerConversion, prev('costPerConversion'))} (${costChange <= 0 ? 'mejoró' : 'empeoró'})`),
      kpi('Clics', count(current.clicks), `CTR ${percent(current.ctr)}`),
      kpi('Impresiones', count(current.impressions), delta(current.impressions, prev('impressions')) || 'Veces que se mostraron'),
      kpi('CPC medio', money2(current.cpc), 'Costo por clic'),
      kpi('CTR', percent(current.ctr), 'Clics ÷ impresiones'),
      kpi('Tasa conversión', rate, delta(current.conversionRate, prev('conversionRate')) || 'Conversiones ÷ clics'),
    ];
    return `
      <section class="rp-page">
        ${head('Resumen del mes', `${report.labels.intro}.`)}
        <div class="rp-body">
          <div class="rp-grid-5">${cards.join('')}</div>
          <div class="rp-card rp-chart-card rp-chart-wide">
            <div class="rp-card-row">
              <div>
                <div class="rp-card-title">Clics y conversiones por día</div>
                ${editable('grafico', noteOr(notes, 'grafico', suggestChartNote(report)), 'div', 'rp-card-sub')}
              </div>
              <span class="rp-legends"><span class="rp-legend"><i style="background:${CLICKS_COLOR}"></i>Clics</span><span class="rp-legend"><i style="background:${CONV_COLOR}"></i>Conversiones</span></span>
            </div>
            ${dailyChart(report)}
          </div>
        </div>
        ${footer(report.labels.source, report, 3, total)}
      </section>`;
  }

  function campaignsPage(report, notes, total) {
    const { current } = report;
    const rows = report.campaigns.slice(0, MAX_ROWS);
    const more = report.campaigns.length - rows.length;
    return `
      <section class="rp-page">
        ${head('Rendimiento por campaña', 'Las campañas de servicios, ordenadas por inversión.')}
        <div class="rp-body">
          <div class="rp-card rp-table-card">
            ${metricsTable(rows.map(campaign => Object.assign({}, campaign)), 'Campaña (servicio)', { empty: 'Sin campañas con inversión en el período.' })}
            <div class="rp-table-foot">${esc(`Total: ${money(current.cost)} · ${count(current.clicks)} clics · ${conv(current.conversions)} conversiones · costo por conversión promedio ${money(current.costPerConversion)}.${more > 0 ? ` ${more} ${more === 1 ? 'campaña más' : 'campañas más'} con menor inversión.` : ''}`)}</div>
          </div>
          ${insight('Análisis', 'pulse', 'campanas', noteOr(notes, 'campanas', suggestCampaignAnalysis(report)))}
        </div>
        ${footer(report.labels.source, report, 4, total)}
      </section>`;
  }

  function keywordsPage(report, notes, total) {
    const data = report.keywords;
    if (!data) {
      return `
        <section class="rp-page">
          ${head('Palabras clave que convierten', 'Los términos de búsqueda que generaron contactos, ordenados por conversiones.')}
          <div class="rp-body"><p class="rp-empty rp-chart-empty">Cargando el informe de palabras clave...</p></div>
          ${footer(report.labels.source, report, 5, total)}
        </section>`;
    }
    const top = data.rows.find(row => row.conversions > 0);
    const foot = data.rows.length
      ? `${top && data.total > 0 ? `"${top.keyword}" concentra ${conv(top.conversions)} de ${conv(data.total)} conversiones de palabras clave.` : ''} Informe de palabras clave de ${data.label || 'Google Ads'}.${data.costOk ? '' : ' El costo por palabra del informe no cuadra con el de las campañas (revisar la importación), así que no se muestra.'}`
      : `Sin informe de palabras clave para ${report.item.month.name} ${report.item.month.year}.`;
    return `
      <section class="rp-page">
        ${head('Palabras clave que convierten', 'Los términos de búsqueda que generaron contactos, ordenados por conversiones.')}
        <div class="rp-body">
          <div class="rp-card rp-table-card">
            ${metricsTable(data.rows.slice(0, MAX_ROWS).map(row => Object.assign({ name: row.keyword }, row)), 'Palabra clave', { empty: 'Sin palabras clave con actividad en el período.' })}
            <div class="rp-table-foot">${esc(foot.trim())}</div>
          </div>
          ${insight('Clave', 'search', 'clave', noteOr(notes, 'clave', suggestKey(report)))}
          <div class="rp-card rp-analysis">
            <div class="rp-analysis-head">${icon('chart')}<b>Análisis</b></div>
            ${editable('palabras', noteOr(notes, 'palabras', suggestKeywordAnalysis(report)))}
          </div>
        </div>
        ${footer(report.labels.source, report, 5, total)}
      </section>`;
  }

  function conclusionsPage(report, notes, total) {
    const cards = suggestConclusions(report).map((card, index) => `
      <div class="rp-card rp-conclusion">
        <div class="rp-toc-top"><span class="rp-icon framed">${icon(card.icon)}</span><span class="rp-concl-num">${pageNumber(index + 1)}</span></div>
        ${editable(`concl:${index}:title`, noteOr(notes, `concl:${index}:title`, card.title), 'h3')}
        ${editable(`concl:${index}:text`, noteOr(notes, `concl:${index}:text`, card.text))}
      </div>`).join('');
    return `
      <section class="rp-page">
        ${head('Conclusiones del período', 'Cómo evolucionó y qué priorizar.')}
        <div class="rp-body rp-centered">
          <div class="rp-grid-3 rp-conclusions">${cards}</div>
          ${report.labels.note ? `<div class="rp-note">${rich(report.labels.note)}</div>` : ''}
        </div>
        ${footer(report.labels.analysisSource, report, 6, total)}
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
      host.innerHTML = '<div class="panel"><div class="empty-state"><strong>Todavia no hay datos para el reporte</strong><span>El reporte se arma con los informes de Google Ads. En cuanto haya un mes con inversion, aparece aqui.</span></div></div>';
      return;
    }
    if (!available.some(item => item.id === state.month)) state.month = available[0].id;
    const item = available.find(entry => entry.id === state.month);
    if (select) {
      select.innerHTML = available.map(entry => `<option value="${esc(entry.id)}"${entry.id === state.month ? ' selected' : ''}>${esc(entry.option)}</option>`).join('');
    }
    const report = buildReport(item);
    const notes = readNotes()[item.id] || {};
    const total = 7;
    host.innerHTML = `
      <div class="rp-deck" id="week-doc">
        ${coverPage(report)}
        ${contentsPage(report, total)}
        ${summaryPage(report, notes, total)}
        ${campaignsPage(report, notes, total)}
        ${keywordsPage(report, notes, total)}
        ${conclusionsPage(report, notes, total)}
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
