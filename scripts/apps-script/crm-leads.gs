/**
 * CRM de leads de Aquarius: guarda en una hoja de Google privada lo que el cliente completa en el tablero
 * (modulo Leads) para cada campana y mes: leads reales, calificados, ventas y monto vendido. Los datos nunca
 * pasan por el repositorio publico.
 *
 * Instalacion (una sola vez, ver README > Leads):
 * 1. Crear una hoja de calculo de Google (por ejemplo "Aquarius - CRM de leads") en una carpeta privada.
 * 2. En la hoja: Extensiones > Apps Script, pegar este archivo y guardar.
 * 3. Ejecutar crearToken() una vez: crea la pestana y deja el token en el registro de ejecucion.
 * 4. Implementar > Nueva implementacion > Aplicacion web: ejecutar como "Yo", acceso "Cualquier usuario".
 *    Copiar la URL /exec.
 * 5. En GitHub > Settings > Secrets and variables > Actions: AQ_CRM_URL = la URL y AQ_CRM_TOKEN = el token.
 * Si se cambia este codigo: Implementar > Gestionar implementaciones > editar > Version: Nueva version.
 * La URL y el token no cambian.
 *
 * Contrato (POST con cuerpo JSON en text/plain, asi el navegador no hace preflight de CORS):
 *   { token, action: 'list' }               -> { ok, rows: [...], updatedAt }
 *   { token, action: 'save', row: {...} }   -> { ok, row }   (una fila por mes y campana; vacia = se borra)
 *   { token, action: 'presupuestos-list' }  -> { ok, rows: [{ mes, campana, presupuesto, actualizado }] }
 *   { token, action: 'presupuestos-save', rows: [{ mes, campana, presupuesto }] }  (presupuesto vacio = se borra)
 *   { token, action: 'recalculos-list' }    -> { ok, rows: [...] }  (una fila por campana de cada recalculo)
 *   { token, action: 'recalculos-save', recalculo: {...} }  -> { ok, id, guardado }
 * Un error responde { ok: false, error }.
 */

const SHEET_NAME = 'Leads por campana';
const COLUMNS = ['mes', 'plataforma', 'campana', 'leads', 'calificados', 'ventas', 'monto', 'actualizado'];
const COUNTS = ['leads', 'calificados', 'ventas'];
const PLATAFORMAS = ['Google Ads', 'Meta Ads', 'Otro'];

function doPost(e) {
  return respond(() => {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    authorize(body.token);
    if (body.action === 'list') return { rows: readRows(), updatedAt: new Date().toISOString() };
    if (body.action === 'save') return { row: withLock(() => saveRow(body.row || {})) };
    // Acciones sugeridas del modulo Proyecciones: que se marco como hecho este mes.
    if (body.action === 'acciones-list') return { rows: readAcciones(), updatedAt: new Date().toISOString() };
    if (body.action === 'acciones-save') return { row: withLock(() => saveAccion(body.row || {})) };
    // Recalculo de inversion (modulo Proyecciones): presupuesto del mes por campana e historial.
    if (body.action === 'presupuestos-list') return { rows: readPresupuestos(), updatedAt: new Date().toISOString() };
    if (body.action === 'presupuestos-save') return { rows: withLock(() => savePresupuestos(body.rows || [])) };
    if (body.action === 'recalculos-list') return { rows: readRecalculos() };
    if (body.action === 'recalculos-save') return withLock(() => saveRecalculo(body.recalculo || {}));
    throw new Error('Accion no valida');
  });
}

// Una visita directa a la URL solo dice que el servicio esta arriba, sin datos.
function doGet() {
  return respond(() => ({ service: 'crm-leads-aquarius' }));
}

function respond(handler) {
  let payload;
  try {
    payload = Object.assign({ ok: true }, handler());
  } catch (error) {
    payload = { ok: false, error: String((error && error.message) || error) };
  }
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function authorize(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('CRM_TOKEN');
  if (!expected || typeof token !== 'string' || token !== expected) throw new Error('No autorizado');
}

function withLock(task) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    return task();
  } finally {
    lock.releaseLock();
  }
}

function sheet() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let tab = book.getSheetByName(SHEET_NAME);
  if (!tab) {
    tab = book.insertSheet(SHEET_NAME);
    tab.appendRow(COLUMNS);
    tab.setFrozenRows(1);
    // El mes como texto: si no, la hoja lo convierte en fecha.
    tab.getRange('A:A').setNumberFormat('@');
  }
  return tab;
}

// ── Acciones sugeridas ──────────────────────────────────────────────────────
// Pestana aparte en la misma hoja: una fila por mes y accion. El id de la accion lo arma el tablero
// (tipo + campana, nunca el monto), asi que lo marcado sigue marcado aunque las cifras cambien.
const ACCIONES_SHEET = 'Acciones del mes';
const ACCIONES_COLUMNS = ['mes', 'accion', 'hecha', 'actualizado'];

function accionesSheet() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let tab = book.getSheetByName(ACCIONES_SHEET);
  if (!tab) {
    tab = book.insertSheet(ACCIONES_SHEET);
    tab.appendRow(ACCIONES_COLUMNS);
    tab.setFrozenRows(1);
    // El mes como texto: si no, la hoja lo convierte en fecha.
    tab.getRange('A:A').setNumberFormat('@');
  }
  return tab;
}

function readAcciones() {
  return accionesSheet().getDataRange().getValues().slice(1)
    .filter(values => values[0] && values[1])
    .map(values => ({
      mes: values[0] instanceof Date ? Utilities.formatDate(values[0], 'America/Lima', 'yyyy-MM') : String(values[0]),
      accion: String(values[1]),
      hecha: values[2] === true || String(values[2]).toLowerCase() === 'true',
      actualizado: values[3] instanceof Date ? values[3].toISOString() : String(values[3] || ''),
    }));
}

function saveAccion(row) {
  const mes = String(row.mes || '').trim();
  const accion = String(row.accion || '').trim();
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('Mes no valido');
  if (!accion) throw new Error('Falta la accion');

  const tab = accionesSheet();
  const values = tab.getDataRange().getValues();
  const buscado = `${mes}|${accion}`;
  let fila = 0;
  for (let i = 1; i < values.length; i += 1) {
    const suMes = values[i][0] instanceof Date
      ? Utilities.formatDate(values[i][0], 'America/Lima', 'yyyy-MM')
      : String(values[i][0]);
    if (`${suMes}|${String(values[i][1])}` === buscado) { fila = i + 1; break; }
  }

  const hecha = row.hecha === true;
  // Desmarcar borra la fila: la hoja guarda lo hecho, no un historial de idas y vueltas.
  if (!hecha) {
    if (fila) tab.deleteRow(fila);
    return { mes, accion, hecha: false };
  }

  const datos = [mes, accion, true, new Date()];
  if (fila) tab.getRange(fila, 1, 1, ACCIONES_COLUMNS.length).setValues([datos]);
  else tab.appendRow(datos);
  return { mes, accion, hecha: true };
}

// ── Recalculo de inversion ──────────────────────────────────────────────────
// Presupuesto planificado del mes por campana: lo carga el equipo en el panel (o aqui mismo en la hoja).
// Una fila por mes y campana; el recalculo lo usa para el mes en curso y, con el saldo, para el anterior.
const PRESUPUESTOS_SHEET = 'Presupuesto por campana';
const PRESUPUESTOS_COLUMNS = ['mes', 'campana', 'presupuesto', 'actualizado'];

// Historial: una fila por campana de cada recalculo guardado; el id agrupa las filas de un mismo recalculo.
const RECALCULOS_SHEET = 'Recalculos de inversion';
const RECALCULOS_COLUMNS = ['id', 'guardado', 'cliente', 'mes', 'corte', 'dias_restantes', 'modo', 'responsable',
  'campana', 'estado', 'ppto_mes', 'ppto_mes_anterior', 'gasto_mes_anterior', 'saldo_mes_anterior', 'ppto_efectivo',
  'gasto_acumulado', 'por_gastar', 'diario_actual', 'diario_recomendado', 'diferencia', 'alertas'];
const RECALCULO_MONTOS = ['ppto_mes', 'ppto_mes_anterior', 'gasto_mes_anterior', 'saldo_mes_anterior', 'ppto_efectivo',
  'gasto_acumulado', 'por_gastar', 'diario_actual', 'diario_recomendado', 'diferencia'];
// Lo que manda el tablero (camelCase) para cada columna de montos.
const RECALCULO_CAMPOS = {
  ppto_mes: 'presupuestoMes', ppto_mes_anterior: 'presupuestoMesAnterior', gasto_mes_anterior: 'gastoMesAnterior',
  saldo_mes_anterior: 'saldoMesAnterior', ppto_efectivo: 'presupuestoEfectivo', gasto_acumulado: 'gastoAcumulado',
  por_gastar: 'porGastar', diario_actual: 'diarioActual', diario_recomendado: 'diarioRecomendado', diferencia: 'diferencia'
};

function tabWith(name, columns, textColumns) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let tab = book.getSheetByName(name);
  if (!tab) {
    tab = book.insertSheet(name);
    tab.appendRow(columns);
    tab.setFrozenRows(1);
    // Mes y fechas como texto: si no, la hoja los convierte en fecha.
    textColumns.forEach(letter => tab.getRange(`${letter}:${letter}`).setNumberFormat('@'));
  }
  return tab;
}

const presupuestosSheet = () => tabWith(PRESUPUESTOS_SHEET, PRESUPUESTOS_COLUMNS, ['A']);
const recalculosSheet = () => tabWith(RECALCULOS_SHEET, RECALCULOS_COLUMNS, ['A', 'D', 'E']);

const textOf = value => (value instanceof Date ? Utilities.formatDate(value, 'America/Lima', 'yyyy-MM') : String(value == null ? '' : value));
const isoDay = value => (value instanceof Date ? Utilities.formatDate(value, 'America/Lima', 'yyyy-MM-dd') : String(value == null ? '' : value));
const amountOf = value => (value === '' || value === null || value === undefined || !isFinite(Number(value)) ? null : Number(value));

function readPresupuestos() {
  return presupuestosSheet().getDataRange().getValues().slice(1)
    .filter(values => values[0] && values[1] !== '' && amountOf(values[2]) !== null)
    .map(values => ({
      mes: textOf(values[0]),
      campana: String(values[1]).replace(/^'/, ''),
      presupuesto: amountOf(values[2]),
      actualizado: values[3] instanceof Date ? values[3].toISOString() : String(values[3] || '')
    }));
}

// Crea, cambia o (si llega vacio) borra el presupuesto de cada mes y campana. Varias filas en una sola llamada.
function savePresupuestos(rows) {
  if (!Array.isArray(rows) || rows.length > 300) throw new Error('Lista de presupuestos no valida');
  const tab = presupuestosSheet();
  const values = tab.getDataRange().getValues();
  const index = {};
  for (let i = 1; i < values.length; i += 1) {
    index[`${textOf(values[i][0])}|${normalize(String(values[i][1]).replace(/^'/, ''))}`] = i + 1;
  }
  const borrar = [];
  const saved = [];
  rows.forEach(input => {
    const mes = String(input.mes || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error('Mes no valido');
    const campana = String(input.campana || '').trim().slice(0, 160);
    if (!campana) throw new Error('Falta la campana');
    const fila = index[`${mes}|${normalize(campana)}`];
    const monto = amountOf(input.presupuesto);
    if (input.presupuesto !== null && input.presupuesto !== '' && input.presupuesto !== undefined && (monto === null || monto < 0)) {
      throw new Error('El presupuesto es un numero desde 0');
    }
    if (monto === null) {
      if (fila) borrar.push(fila);
      saved.push({ mes, campana, presupuesto: null });
      return;
    }
    const line = [mes, cellValue('campana', campana), Math.round(monto * 100) / 100, new Date()];
    if (fila) tab.getRange(fila, 1, 1, PRESUPUESTOS_COLUMNS.length).setValues([line]);
    else {
      tab.appendRow(line);
      index[`${mes}|${normalize(campana)}`] = tab.getLastRow();
    }
    saved.push({ mes, campana, presupuesto: Math.round(monto * 100) / 100 });
  });
  // De abajo hacia arriba, para que borrar una fila no corra las demas.
  borrar.sort((a, b) => b - a).forEach(fila => tab.deleteRow(fila));
  return saved;
}

function readRecalculos() {
  return recalculosSheet().getDataRange().getValues().slice(1).filter(values => values[0]).map(values => {
    const row = {};
    RECALCULOS_COLUMNS.forEach((column, position) => { row[column] = values[position]; });
    row.id = String(row.id);
    row.guardado = row.guardado instanceof Date ? row.guardado.toISOString() : String(row.guardado || '');
    row.mes = textOf(row.mes);
    row.corte = isoDay(row.corte);
    row.dias_restantes = amountOf(row.dias_restantes);
    ['cliente', 'modo', 'responsable', 'campana', 'estado', 'alertas'].forEach(column => {
      row[column] = String(row[column] == null ? '' : row[column]).replace(/^'/, '');
    });
    RECALCULO_MONTOS.forEach(column => { row[column] = amountOf(row[column]); });
    return row;
  });
}

// Agrega las filas de un recalculo. Un id que ya esta en la hoja no se vuelve a guardar.
function saveRecalculo(input) {
  const id = String(input.id || '').trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new Error('Id de recalculo no valido');
  const mes = String(input.mes || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error('Mes no valido');
  const corte = String(input.corte || '');
  if (corte && !/^\d{4}-\d{2}-\d{2}$/.test(corte)) throw new Error('Fecha de corte no valida');
  const filas = Array.isArray(input.filas) ? input.filas : [];
  if (!filas.length || filas.length > 200) throw new Error('El recalculo no trae campanas');

  const tab = recalculosSheet();
  const ids = tab.getLastRow() > 1 ? tab.getRange(2, 1, tab.getLastRow() - 1, 1).getValues() : [];
  const guardado = new Date();
  if (ids.some(value => String(value[0]) === id)) return { id, guardado: guardado.toISOString(), repetido: true };

  const texto = (value, max) => cellValue('campana', String(value == null ? '' : value).slice(0, max));
  const lines = filas.map(fila => {
    const row = {
      id, guardado, cliente: texto(input.cliente, 80), mes, corte,
      dias_restantes: amountOf(input.diasRestantes), modo: texto(input.modo, 60), responsable: texto(input.responsable, 80),
      campana: texto(fila.campana, 160), estado: texto(fila.estado, 60), alertas: texto(fila.alertas, 600)
    };
    RECALCULO_MONTOS.forEach(column => {
      const value = amountOf(fila[RECALCULO_CAMPOS[column]]);
      row[column] = value === null ? '' : Math.round(value * 100) / 100;
    });
    return RECALCULOS_COLUMNS.map(column => (row[column] === null || row[column] === undefined ? '' : row[column]));
  });
  tab.getRange(tab.getLastRow() + 1, 1, lines.length, RECALCULOS_COLUMNS.length).setValues(lines);
  return { id, guardado: guardado.toISOString() };
}

const keyOf = row => `${row.mes}|${normalize(row.campana)}`;

function normalize(text) {
  return String(text == null ? '' : text).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function readRows() {
  return sheet().getDataRange().getValues().slice(1).filter(values => values[0] && values[2]).map(values => {
    const row = {};
    COLUMNS.forEach((column, index) => { row[column] = values[index]; });
    row.mes = row.mes instanceof Date ? Utilities.formatDate(row.mes, 'America/Lima', 'yyyy-MM') : String(row.mes);
    row.campana = String(row.campana);
    COUNTS.concat('monto').forEach(field => { row[field] = row[field] === '' || row[field] === null ? null : Number(row[field]); });
    if (row.actualizado instanceof Date) row.actualizado = row.actualizado.toISOString();
    return row;
  });
}

// Crea, actualiza o (si llega vacia) borra la fila del mes y la campana.
function saveRow(input) {
  const row = clean(input);
  const tab = sheet();
  const values = tab.getDataRange().getValues();
  const index = values.findIndex((existing, position) => position > 0
    && keyOf({ mes: existing[0] instanceof Date ? Utilities.formatDate(existing[0], 'America/Lima', 'yyyy-MM') : String(existing[0]), campana: existing[2] }) === keyOf(row));
  const empty = COUNTS.concat('monto').every(field => row[field] === null);
  if (empty) {
    if (index > 0) tab.deleteRow(index + 1);
    return row;
  }
  row.actualizado = new Date().toISOString();
  const line = COLUMNS.map(column => cellValue(column, row[column]));
  if (index > 0) tab.getRange(index + 1, 1, 1, COLUMNS.length).setValues([line]);
  else tab.appendRow(line);
  return row;
}

// Mes AAAA-MM, campana obligatoria, conteos enteros no negativos y monto con dos decimales. Vacio = sin dato.
function clean(input) {
  const mes = String(input.mes || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error('Mes no valido');
  const campana = String(input.campana || '').trim().slice(0, 120);
  if (!campana) throw new Error('Falta la campana');
  const count = value => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!isFinite(number) || number < 0 || Math.floor(number) !== number) throw new Error('Los conteos son numeros enteros desde 0');
    return number;
  };
  const row = {
    mes,
    plataforma: PLATAFORMAS.indexOf(input.plataforma) >= 0 ? input.plataforma : 'Otro',
    campana,
    leads: count(input.leads),
    calificados: count(input.calificados),
    ventas: count(input.ventas),
    monto: null
  };
  if (input.monto !== null && input.monto !== undefined && input.monto !== '') {
    const monto = Number(input.monto);
    if (!isFinite(monto) || monto < 0) throw new Error('El monto es un numero desde 0');
    row.monto = Math.round(monto * 100) / 100;
  }
  return row;
}

// Un texto que empieza con =, +, - o @ se guardaria como formula: va con un apostrofo delante.
function cellValue(column, value) {
  if (value === null || value === undefined) return '';
  if (column === 'campana' && /^[=+\-@]/.test(String(value))) return `'${value}`;
  return value;
}

// Crea (o cambia) el token y la pestana. El token queda en el registro de ejecucion para copiarlo a GitHub.
function crearToken() {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('CRM_TOKEN', token);
  sheet();
  console.log(`Token del CRM (copialo al secret AQ_CRM_TOKEN de GitHub): ${token}`);
}
