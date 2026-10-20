/**
 * CRM de leads de Aquarius: guarda en una hoja de Google privada los leads reales que el cliente registra en el
 * tablero (modulo Leads). Los datos nunca pasan por el repositorio publico.
 *
 * Instalacion (una sola vez, ver README > Leads):
 * 1. Crear una hoja de calculo de Google (por ejemplo "Aquarius - CRM de leads") en la cuenta de la agencia.
 * 2. En la hoja: Extensiones > Apps Script, pegar este archivo y guardar.
 * 3. Ejecutar crearToken() una vez: crea la pestana Leads y deja el token en el registro de ejecucion.
 * 4. Implementar > Nueva implementacion > Aplicacion web: ejecutar como "Yo", acceso "Cualquier usuario".
 *    Copiar la URL /exec.
 * 5. En GitHub > Settings > Secrets and variables > Actions: AQ_CRM_URL = la URL y AQ_CRM_TOKEN = el token.
 *    El siguiente deploy incrusta los dos dentro del HTML cifrado del tablero.
 *
 * Contrato (POST con cuerpo JSON en text/plain, asi el navegador no hace preflight de CORS):
 *   { token, action: 'list' }                 -> { ok, leads: [...], updatedAt }
 *   { token, action: 'save', lead: {...} }    -> { ok, lead }      (crea o actualiza por id)
 *   { token, action: 'delete', id }           -> { ok }
 * Un error responde { ok: false, error }.
 *
 * No se guardan telefonos ni correos: el tablero los rechaza y este script tambien.
 */

const SHEET_NAME = 'Leads';
const COLUMNS = ['id', 'fecha', 'plataforma', 'campana', 'canal', 'estado', 'monto', 'referencia', 'nota', 'creado', 'actualizado'];
const PLATAFORMAS = ['Google Ads', 'Meta Ads', 'Otro'];
const CANALES = ['Formulario web', 'WhatsApp', 'Llamada', 'Correo', 'Otro'];
const ESTADOS = ['Nuevo', 'Contactado', 'Calificado', 'Cotizado', 'Venta', 'Perdido', 'No valido'];
const MAX_TEXT = 160;

function doPost(e) {
  return respond(() => {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    authorize(body.token);
    if (body.action === 'list') return { leads: readLeads(), updatedAt: new Date().toISOString() };
    if (body.action === 'save') return { lead: withLock(() => saveLead(body.lead || {})) };
    if (body.action === 'delete') {
      withLock(() => deleteLead(String(body.id || '')));
      return {};
    }
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
  }
  return tab;
}

function readLeads() {
  const values = sheet().getDataRange().getValues();
  return values.slice(1).filter(row => row[0]).map(row => {
    const lead = {};
    COLUMNS.forEach((column, index) => { lead[column] = row[index]; });
    lead.fecha = lead.fecha instanceof Date ? Utilities.formatDate(lead.fecha, 'America/Lima', 'yyyy-MM-dd') : String(lead.fecha);
    lead.monto = lead.monto === '' ? null : Number(lead.monto);
    ['creado', 'actualizado'].forEach(field => {
      if (lead[field] instanceof Date) lead[field] = lead[field].toISOString();
    });
    // getValues() devuelve el texto sin el apostrofo que lo protege de leerse como formula.
    ['referencia', 'nota', 'campana'].forEach(field => { lead[field] = String(lead[field] == null ? '' : lead[field]); });
    return lead;
  });
}

function saveLead(input) {
  const lead = clean(input);
  const tab = sheet();
  const ids = tab.getRange(1, 1, Math.max(tab.getLastRow(), 1), 1).getValues().map(row => String(row[0]));
  const now = new Date().toISOString();
  const index = lead.id ? ids.indexOf(lead.id) : -1;
  if (index > 0) {
    const created = tab.getRange(index + 1, COLUMNS.indexOf('creado') + 1).getValue();
    lead.creado = created instanceof Date ? created.toISOString() : String(created || now);
  } else {
    lead.id = lead.id || Utilities.getUuid();
    lead.creado = now;
  }
  lead.actualizado = now;
  const row = COLUMNS.map(column => cellValue(column, lead[column]));
  if (index > 0) tab.getRange(index + 1, 1, 1, COLUMNS.length).setValues([row]);
  else tab.appendRow(row);
  return lead;
}

function deleteLead(id) {
  if (!id) throw new Error('Falta el id');
  const tab = sheet();
  const ids = tab.getRange(1, 1, Math.max(tab.getLastRow(), 1), 1).getValues().map(row => String(row[0]));
  const index = ids.indexOf(id);
  if (index > 0) tab.deleteRow(index + 1);
}

// Valida y normaliza un lead: valores de las listas, fecha AAAA-MM-DD, monto solo en ventas y textos cortos.
function clean(input) {
  const pick = (value, allowed, fallback) => (allowed.indexOf(value) >= 0 ? value : fallback);
  const fecha = String(input.fecha || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('Fecha no valida');
  const estado = pick(input.estado, ESTADOS, 'Nuevo');
  const monto = estado === 'Venta' && input.monto !== null && input.monto !== '' && isFinite(Number(input.monto))
    ? Math.max(0, Math.round(Number(input.monto) * 100) / 100)
    : null;
  const text = value => {
    const plain = String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    if (hasContact(plain)) throw new Error('No guardes telefonos ni correos en el CRM');
    return plain;
  };
  return {
    id: /^[\w-]{8,64}$/.test(String(input.id || '')) ? String(input.id) : '',
    fecha,
    plataforma: pick(input.plataforma, PLATAFORMAS, 'Otro'),
    campana: String(input.campana || '').slice(0, 120),
    canal: pick(input.canal, CANALES, 'Otro'),
    estado,
    monto,
    referencia: text(input.referencia),
    nota: text(input.nota)
  };
}

// Correos y celulares peruanos (9 digitos que empiezan con 9, con o sin +51). Fechas y RUC pasan.
function hasContact(text) {
  return /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(text) || /(?:^|\D)(?:\+?51[\s.-]?)?9\d{2}[\s.-]?\d{3}[\s.-]?\d{3}(?!\d)/.test(text);
}

// Un texto que empieza con =, +, - o @ se guardaria como formula: va con un apostrofo delante.
function cellValue(column, value) {
  if (value === null || value === undefined) return '';
  if ((column === 'referencia' || column === 'nota' || column === 'campana') && /^[=+\-@]/.test(String(value))) return `'${value}`;
  return value;
}

// Crea (o cambia) el token y la pestana Leads. El token queda en el registro de ejecucion para copiarlo a GitHub.
function crearToken() {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('CRM_TOKEN', token);
  sheet();
  console.log(`Token del CRM (copialo al secret AQ_CRM_TOKEN de GitHub): ${token}`);
}
