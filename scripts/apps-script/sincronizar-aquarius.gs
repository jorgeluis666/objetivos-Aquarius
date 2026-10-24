/**
 * Barrido diario de Aquarius a las 10:00 de Lima.
 *
 * GitHub atrasa varias horas los workflows programados (cron), asi que la hora fija la pone
 * Google Apps Script: un activador diario llama a la API de GitHub y lanza el workflow
 * "Sincronizar Drive" (.github/workflows/sync-drive.yml), que arranca en segundos.
 *
 * Instalacion (una sola vez, ver README > Sincronizacion > Automatica):
 * 1. Crear un proyecto en https://script.google.com y pegar este archivo.
 * 2. Configuracion del proyecto > Zona horaria: (GMT-05:00) Lima.
 * 3. Configuracion del proyecto > Propiedades del script: GITHUB_TOKEN = token de GitHub de grano fino,
 *    solo para el repositorio objetivos-Aquarius, con el permiso Actions: lectura y escritura.
 * 4. Ejecutar instalarActivador() una vez y aceptar los permisos.
 * 5. Ejecutar sincronizarAquarius() para probar: en GitHub > Actions aparece la ejecucion.
 * 6. Boton "Sincronizar" del tablero: Implementar > Nueva implementacion > Aplicacion web, ejecutar como
 *    "Yo", acceso "Cualquier persona". La URL /exec va en el secret AQ_SYNC_URL del repositorio.
 *
 * 7. Lectura privada de las carpetas (ver "Lectura de Drive" al final): Propiedades del script >
 *    LECTURA_CLAVE = la misma clave del secret AQ_DRIVE_READ_KEY. Luego Implementar > Gestionar
 *    implementaciones > editar (lapiz) > Version: Nueva version > Implementar, para que la URL siga igual.
 *
 * El token y la clave nunca van en este archivo: viven solo en las Propiedades del script.
 */

const REPO = 'jorgeluis666/objetivos-Aquarius';
const WORKFLOW = 'sync-drive.yml';
const HORA = 10;
const ZONA = 'America/Lima';

function sincronizarAquarius() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Falta GITHUB_TOKEN en Configuracion del proyecto > Propiedades del script.');
  const response = UrlFetchApp.fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    payload: JSON.stringify({ ref: 'main' }),
    muteHttpExceptions: true
  });
  // GitHub responde 204 cuando acepta el pedido. Un error queda en Ejecuciones y llega por correo.
  if (response.getResponseCode() !== 204) {
    throw new Error(`GitHub respondio ${response.getResponseCode()}: ${response.getContentText().slice(0, 300)}`);
  }
  console.log('Barrido de Aquarius lanzado en GitHub Actions.');
}

// Deja un solo activador diario a las 10:00 de Lima (Apps Script lo corre dentro de unos 15 minutos de esa hora).
function instalarActivador() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'sincronizarAquarius')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('sincronizarAquarius')
    .timeBased()
    .everyDays(1)
    .atHour(HORA)
    .nearMinute(0)
    .inTimezone(ZONA)
    .create();
  console.log(`Activador diario creado: ${HORA}:00 (${ZONA}).`);
}

// ── Boton "Sincronizar" del tablero ─────────────────────────────────────────
// Publicado como aplicacion web, el boton le pide aqui el mismo barrido de sincronizarAquarius(). Solo acepta
// action=sync y como mucho un barrido cada 4 minutos para todos los visitantes (si alguien ya lo pidio, el
// tablero espera esa corrida). Los errores quedan en Ejecuciones; al tablero solo le llega un mensaje generico.
const BOTON_ESPERA_SEGUNDOS = 240;
const BOTON_CACHE = 'aquarius_boton_ultima';

function doPost(event) {
  const accion = String((event && event.postData && event.postData.contents) || '').trim();
  if (accion === 'action=sync') return sincronizarDesdeBoton_();
  const params = (event && event.parameter) || {};
  return params.action === 'leer' ? leerCarpeta_(params) : respuestaBoton_({ ok: false, error: 'Solicitud no valida.' });
}

function doGet(event) {
  const params = (event && event.parameter) || {};
  return params.action === 'sync' ? sincronizarDesdeBoton_() : respuestaBoton_({ ok: false, error: 'Solicitud no valida.' });
}

function sincronizarDesdeBoton_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return respuestaBoton_({ ok: true, pending: true });
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get(BOTON_CACHE)) return respuestaBoton_({ ok: true, pending: true });
    sincronizarAquarius();
    cache.put(BOTON_CACHE, new Date().toISOString(), BOTON_ESPERA_SEGUNDOS);
    return respuestaBoton_({ ok: true, pending: false });
  } catch (error) {
    console.error('boton', error);
    return respuestaBoton_({ ok: false, error: 'No se pudo iniciar la sincronizacion.' });
  } finally {
    lock.releaseLock();
  }
}

function respuestaBoton_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

// ── Lectura de Drive ────────────────────────────────────────────────────────
// Las carpetas de informes ya no se comparten por enlace: el barrido de GitHub (scripts/sync-drive.py y
// scripts/sync-keywords.py) las lee por aqui, con la cuenta duena del script. Solo responde con la clave de
// LECTURA_CLAVE (enviada por POST, nunca en la URL) y solo para las carpetas de abajo. Devuelve cada hoja
// exportada como CSV, igual que la exportaba Drive cuando la carpeta era publica.
// La de campanas es "02 Google Ads": se leen sus archivos, no sus subcarpetas (getFiles no las trae).
const CARPETAS_LECTURA = {
  '1MBCTlit_mxS6wOXyGsXZL3HcS5SPTEIk': '02 Google Ads (campanas)',
  '1bhxYOpSsRq2l8W8BGu_fb99-Ur73DdCO': 'Google Ads Aquarius Keywords'
};

function leerCarpeta_(params) {
  const clave = PropertiesService.getScriptProperties().getProperty('LECTURA_CLAVE');
  if (!clave || String(params.clave || '') !== clave) return respuestaBoton_({ ok: false, error: 'Clave no valida.' });
  const carpeta = String(params.carpeta || '');
  if (!CARPETAS_LECTURA[carpeta]) return respuestaBoton_({ ok: false, error: 'Carpeta no permitida.' });
  try {
    const files = [];
    const iterador = DriveApp.getFolderById(carpeta).getFiles();
    while (iterador.hasNext()) {
      const file = iterador.next();
      const tipo = file.getMimeType();
      const esHoja = tipo === MimeType.GOOGLE_SHEETS;
      if (!esHoja && !/\.csv$/i.test(file.getName())) continue;
      files.push({
        id: file.getId(),
        name: file.getName(),
        modifiedTime: file.getLastUpdated().toISOString(),
        csv: esHoja ? exportarCsv_(file.getId()) : file.getBlob().getDataAsString('UTF-8')
      });
    }
    return respuestaBoton_({ ok: true, files: files });
  } catch (error) {
    console.error('leer', error);
    return respuestaBoton_({ ok: false, error: 'No se pudo leer la carpeta.' });
  }
}

// La primera pestana como CSV, con el mismo export de Sheets que usaba la carpeta publica.
function exportarCsv_(id) {
  const response = UrlFetchApp.fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv`, {
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error(`Export ${id}: ${response.getResponseCode()}`);
  return response.getContentText('UTF-8');
}

// Ejecutar una vez desde el editor para aceptar el permiso de Drive (y comprobar que lee las dos carpetas).
function probarLectura() {
  Object.keys(CARPETAS_LECTURA).forEach(carpeta => {
    const nombres = [];
    const iterador = DriveApp.getFolderById(carpeta).getFiles();
    while (iterador.hasNext()) nombres.push(iterador.next().getName());
    console.log(`${CARPETAS_LECTURA[carpeta]}: ${nombres.join(', ') || 'sin archivos'}`);
  });
}
