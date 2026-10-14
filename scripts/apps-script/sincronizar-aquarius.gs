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
