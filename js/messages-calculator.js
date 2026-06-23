(function (global) {
  const STORAGE_KEY = 'amador_messages_calculator_v1';
  const DEFAULTS = {
    target: 10000,
    actual: 0,
    ticket: 100,
    averageCpl: 2.5,
    sets: [
      { name: 'Campaña principal', messages: 100, cpl: 2.5 },
      { name: 'Reservas de eventos', messages: 100, cpl: 2.5 },
      { name: 'Remarketing', messages: 100, cpl: 2.5 },
    ],
  };

  let state = clone(DEFAULTS);
  let initialized = false;
  let feedbackTimer;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalize(source) {
    const next = source && typeof source === 'object' ? source : {};
    return {
      target: Math.max(0, number(next.target, DEFAULTS.target)),
      actual: Math.max(0, number(next.actual, DEFAULTS.actual)),
      ticket: Math.max(0.01, number(next.ticket, DEFAULTS.ticket)),
      averageCpl: Math.max(0, number(next.averageCpl, DEFAULTS.averageCpl)),
      sets: Array.isArray(next.sets) && next.sets.length
        ? next.sets.map((set, index) => ({
            name: String(set.name || `Conjunto ${index + 1}`),
            messages: Math.max(0, number(set.messages)),
            cpl: Math.max(0, number(set.cpl, next.averageCpl ?? DEFAULTS.averageCpl)),
          }))
        : clone(DEFAULTS.sets),
    };
  }

  function load() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
      if (saved) state = normalize(saved);
    } catch {
      state = clone(DEFAULTS);
    }
  }

  function persist() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Los cálculos continúan aunque el navegador bloquee localStorage.
    }
  }

  function calculate(input = state) {
    const remaining = Math.max(0, number(input.target) - number(input.actual));
    const salesNeeded = remaining / Math.max(0.01, number(input.ticket, 0.01));
    const rows = input.sets.map(set => ({
      ...set,
      investment: number(set.messages) * number(set.cpl),
    }));
    return {
      remaining,
      salesNeeded,
      rows,
      totalInvestment: rows.reduce((total, row) => total + row.investment, 0),
    };
  }

  function money(value) {
    return `S/ ${number(value).toLocaleString('es-PE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function quantity(value) {
    return number(value).toLocaleString('es-PE', { maximumFractionDigits: 2 });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[character]);
  }

  function setText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  }

  function renderInputs() {
    document.getElementById('messages-target').value = state.target;
    document.getElementById('messages-actual').value = state.actual;
    document.getElementById('messages-ticket').value = state.ticket;
    document.getElementById('messages-cpl').value = state.averageCpl;
  }

  function renderRows() {
    const result = calculate();
    document.getElementById('messages-sets').innerHTML = result.rows.map((row, index) => `
      <tr data-index="${index}">
        <td><input class="messages-table-input name" type="text" data-field="name" value="${escapeHtml(row.name)}" aria-label="Nombre del conjunto ${index + 1}"></td>
        <td class="num"><input class="messages-table-input" type="number" min="0" step="1" data-field="messages" value="${row.messages}" aria-label="Mensajes objetivo del conjunto ${index + 1}"></td>
        <td class="num"><span class="messages-cell-money"><b>S/</b><input class="messages-table-input" type="number" min="0" step="0.10" data-field="cpl" value="${row.cpl}" aria-label="Costo por lead del conjunto ${index + 1}"></span></td>
        <td class="num"><strong>${money(row.investment)}</strong></td>
        <td class="messages-row-action"><button type="button" class="messages-remove" data-remove-set="${index}" aria-label="Eliminar ${escapeHtml(row.name)}" title="Eliminar conjunto">×</button></td>
      </tr>
    `).join('');
  }

  function renderKpis() {
    const result = calculate();
    setText('messages-remaining', money(result.remaining));
    setText('messages-sales', quantity(result.salesNeeded));
    setText('messages-investment', money(result.totalInvestment));
    setText('messages-summary-total', money(result.totalInvestment));
  }

  function renderAll() {
    renderInputs();
    renderRows();
    renderKpis();
  }

  function feedback(message, error = false) {
    const element = document.getElementById('messages-feedback');
    element.textContent = message;
    element.classList.toggle('error', error);
    window.clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => {
      element.textContent = '';
      element.classList.remove('error');
    }, 3500);
  }

  function updateTopLevel(field, value) {
    const minimum = field === 'ticket' ? 0.01 : 0;
    state[field] = Math.max(minimum, number(value, minimum));
    if (field === 'averageCpl') {
      state.sets.forEach(set => { set.cpl = state.averageCpl; });
      renderRows();
    }
    persist();
    renderKpis();
  }

  function updateSet(event) {
    const input = event.target.closest('[data-field]');
    const row = event.target.closest('tr[data-index]');
    if (!input || !row) return;
    const set = state.sets[Number(row.dataset.index)];
    if (!set) return;

    if (input.dataset.field === 'name') {
      set.name = input.value;
    } else {
      set[input.dataset.field] = Math.max(0, number(input.value));
    }
    persist();
    renderKpis();

    const investmentCell = row.querySelector('td:nth-child(4) strong');
    if (investmentCell) investmentCell.textContent = money(set.messages * set.cpl);
  }

  function addSet() {
    state.sets.push({
      name: `Conjunto ${state.sets.length + 1}`,
      messages: 100,
      cpl: state.averageCpl,
    });
    persist();
    renderRows();
    renderKpis();
  }

  function removeSet(index) {
    if (state.sets.length === 1) {
      feedback('Debe permanecer al menos un conjunto de anuncios.', true);
      return;
    }
    state.sets.splice(index, 1);
    persist();
    renderRows();
    renderKpis();
  }

  function reset() {
    state = clone(DEFAULTS);
    persist();
    renderAll();
    feedback('Valores restablecidos.');
  }

  function summaryText() {
    const result = calculate();
    return [
      'CALCULADORA DE MENSAJES · AMADOR',
      '',
      `Facturación objetivo: ${money(state.target)}`,
      `Facturación realizada: ${money(state.actual)}`,
      `Facturación restante: ${money(result.remaining)}`,
      `Ticket promedio: ${money(state.ticket)}`,
      `Ventas necesarias: ${quantity(result.salesNeeded)}`,
      '',
      'CONJUNTOS DE ANUNCIOS',
      ...result.rows.map(row =>
        `• ${row.name}: ${quantity(row.messages)} mensajes × ${money(row.cpl)} CPL = ${money(row.investment)}`
      ),
      '',
      `INVERSIÓN TOTAL EN MENSAJES: ${money(result.totalInvestment)}`,
    ].join('\n');
  }

  async function copySummary() {
    const text = summaryText();
    try {
      await navigator.clipboard.writeText(text);
      feedback('Resumen copiado al portapapeles.');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      feedback(copied ? 'Resumen copiado al portapapeles.' : 'No se pudo copiar el resumen.', !copied);
    }
  }

  function exportExcel() {
    const result = calculate();
    const rows = [
      ['CALCULADORA DE MENSAJES · AMADOR'],
      [],
      ['Facturación objetivo (S/)', state.target],
      ['Facturación realizada (S/)', state.actual],
      ['Facturación restante (S/)', result.remaining],
      ['Ticket promedio (S/)', state.ticket],
      ['Ventas necesarias', result.salesNeeded],
      ['CPL promedio (S/)', state.averageCpl],
      [],
      ['Conjunto', 'Mensajes objetivo', 'Costo por lead (S/)', 'Inversión (S/)'],
      ...result.rows.map(row => [row.name, row.messages, row.cpl, row.investment]),
      ['INVERSIÓN TOTAL EN MENSAJES', '', '', result.totalInvestment],
    ];
    const xmlRows = rows.map(row => `<Row>${row.map(value => {
      const numericValue = typeof value === 'number' && Number.isFinite(value);
      const type = numericValue ? 'Number' : 'String';
      const content = numericValue ? value : escapeXml(value);
      return `<Cell><Data ss:Type="${type}">${content}</Data></Cell>`;
    }).join('')}</Row>`).join('');
    const workbook = `<?xml version="1.0"?>
      <?mso-application progid="Excel.Sheet"?>
      <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
        xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
        <Worksheet ss:Name="Mensajes">
          <Table>
            <Column ss:Width="220"/><Column ss:Width="120"/><Column ss:Width="130"/><Column ss:Width="120"/>
            ${xmlRows}
          </Table>
        </Worksheet>
      </Workbook>`;
    const blob = new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Calculadora_Mensajes_Amador.xls';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    feedback('Archivo Excel generado.');
  }

  function wireEvents() {
    const fields = {
      'messages-target': 'target',
      'messages-actual': 'actual',
      'messages-ticket': 'ticket',
      'messages-cpl': 'averageCpl',
    };
    Object.entries(fields).forEach(([id, field]) => {
      document.getElementById(id).addEventListener('input', event => {
        updateTopLevel(field, event.target.value);
      });
    });

    const rows = document.getElementById('messages-sets');
    rows.addEventListener('input', updateSet);
    rows.addEventListener('click', event => {
      const button = event.target.closest('[data-remove-set]');
      if (button) removeSet(Number(button.dataset.removeSet));
    });
    document.getElementById('messages-add-set').addEventListener('click', addSet);
    document.getElementById('messages-reset').addEventListener('click', reset);
    document.getElementById('messages-copy').addEventListener('click', copySummary);
    document.getElementById('messages-export').addEventListener('click', exportExcel);
  }

  function escapeXml(value) {
    return String(value).replace(/[<>&'"]/g, character => ({
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      "'": '&apos;',
      '"': '&quot;',
    })[character]);
  }

  function init() {
    if (initialized) return;
    initialized = true;
    load();
    wireEvents();
    renderAll();
  }

  global.MessagesCalculator = {
    init,
    calculate: input => calculate(normalize(input)),
    defaults: () => clone(DEFAULTS),
  };
})(window);
