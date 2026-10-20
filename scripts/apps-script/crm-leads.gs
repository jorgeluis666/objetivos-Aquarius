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
