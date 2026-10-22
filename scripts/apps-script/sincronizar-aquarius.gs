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
 * El token nunca va en este archivo: vive solo en las Propiedades del script.
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
  return accion === 'action=sync' ? sincronizarDesdeBoton_() : respuestaBoton_({ ok: false, error: 'Solicitud no valida.' });
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
