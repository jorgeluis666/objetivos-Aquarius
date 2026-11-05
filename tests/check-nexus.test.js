'use strict';
// Pruebas del aviso de datos atrasados (scripts/check-nexus.js y scripts/lib/correo.js).
// Corren con `npm test`, sin red ni secretos.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const check = require('../scripts/check-nexus.js');
const { destinatariosTecnicos } = require('../scripts/lib/correo.js');

const RAIZ = path.join(__dirname, '..');
// Una hora de Lima (UTC-5) en milisegundos UTC: lima('2026-11-04 08:00').
const lima = texto => Date.parse(`${texto.replace(' ', 'T')}:00-05:00`);

/** Un archivo como los de data/: meses con period.end y la hoja de Drive del último. */
function doc(...fines) {
  const months = fines.map((fin, i) => ({
    id: fin.slice(0, 7),
    period: { start: `${fin.slice(0, 7)}-01`, end: fin },
    driveFileId: `hoja-${i}`,
  }));
  return {
    months,
    drive: { files: months.map((m, i) => ({ id: `hoja-${i}`, modifiedTime: `${m.period.end}T23:02:00.000Z` })) },
  };
}
const fuentes = (campanas, palabras = campanas) => [
  { nombre: 'Informe de campañas', archivo: 'data/aquarius-lima-retail-2026.json', doc: campanas },
  { nombre: 'Palabras clave', archivo: 'data/aquarius-palabras-clave-2026.json', doc: palabras },
];

// ── El día que tiene que cubrir el informe ──────────────────────────────────────────────────────

test('antes de las 07:00 de Lima basta con que el informe llegue a ayer', () => {
  assert.equal(check.diaEsperado(lima('2026-11-04 00:30')), '2026-11-03');
  assert.equal(check.diaEsperado(lima('2026-11-04 06:31')), '2026-11-03');
  assert.equal(check.diaEsperado(lima('2026-11-04 06:59')), '2026-11-03');
});

test('desde las 07:00 de Lima el informe tiene que llegar a hoy', () => {
  assert.equal(check.diaEsperado(lima('2026-11-04 07:00')), '2026-11-04');
  assert.equal(check.diaEsperado(lima('2026-11-04 13:30')), '2026-11-04');
  assert.equal(check.diaEsperado(lima('2026-11-04 23:59')), '2026-11-04');
});

test('el último día es el period.end más nuevo, aunque los meses vengan desordenados', () => {
  assert.equal(check.ultimoDia(doc('2026-11-05', '2026-10-31')), '2026-11-05');
  assert.equal(check.ultimoDia({ months: [{ id: '2026-11' }, { period: { end: 'ayer' } }] }), null);
  assert.equal(check.ultimoDia({}), null);
});

test('la hora de la hoja sale del archivo de Drive del mes más nuevo', () => {
  assert.equal(check.horaDeHoja(doc('2026-10-31', '2026-11-03')), Date.parse('2026-11-03T23:02:00.000Z'));
  assert.equal(check.horaDeHoja({ months: [{ period: { end: '2026-11-03' } }] }), null);
});

// ── La revisión ─────────────────────────────────────────────────────────────────────────────────

test('al día: el informe de hoy después de la captura de las 06:00', () => {
  const informe = check.revisar(fuentes(doc('2026-10-31', '2026-11-05')), lima('2026-11-05 08:00'));
  assert.equal(informe.ok, true);
  assert.deepEqual(informe.hallazgos, []);
  assert.match(informe.resumen, /hasta el 2026-11-05/);
});

test('la caída del 4/11: a las 08:00 el informe sigue en el 3/11 y avisa', () => {
  const informe = check.revisar(fuentes(doc('2026-11-03')), lima('2026-11-04 08:00'));
  assert.equal(informe.ok, false);
  assert.equal(informe.esperado, '2026-11-04');
  assert.equal(informe.hallazgos.length, 2);
  assert.match(informe.hallazgos[0].titulo, /Informe de campañas: el informe no avanza/);
  assert.match(informe.hallazgos[0].detalle, /hasta el 2026-11-03 .* al 2026-11-04 \(un día de atraso\)/);
  assert.match(informe.hallazgos[0].detalle, /hoja de Nexus .* 2026-11-03 18:02 de Lima/);
  assert.match(informe.hallazgos[1].titulo, /Palabras clave/);
});

test('la caída del 4/11: con el barrido de las 06:30 todavía no avisa', () => {
  const informe = check.revisar(fuentes(doc('2026-11-03')), lima('2026-11-04 06:31'));
  assert.equal(informe.ok, true);
});

test('cuenta los días de atraso', () => {
  const informe = check.revisar(fuentes(doc('2026-11-02')), lima('2026-11-05 13:30'));
  assert.match(informe.hallazgos[0].detalle, /3 días de atraso/);
});

test('cambio de mes: el 1 de noviembre tiene que haber hoja de noviembre', () => {
  const ahora = lima('2026-11-01 08:00');
  assert.equal(check.revisar(fuentes(doc('2026-10-31')), ahora).ok, false);
  assert.equal(check.revisar(fuentes(doc('2026-10-31', '2026-11-01')), ahora).ok, true);
  // Antes de las 07:00, octubre completo todavía alcanza.
  assert.equal(check.revisar(fuentes(doc('2026-10-31')), lima('2026-11-01 06:40')).ok, true);
});

test('si solo se atrasan las palabras clave, avisa solo por ellas', () => {
  const informe = check.revisar(fuentes(doc('2026-11-05'), doc('2026-11-03')), lima('2026-11-05 13:30'));
  assert.equal(informe.ok, false);
  assert.equal(informe.hallazgos.length, 1);
  assert.match(informe.hallazgos[0].titulo, /^Palabras clave/);
});

test('un archivo que falta o no trae período también es un hallazgo', () => {
  const sinArchivo = fuentes(doc('2026-11-05'));
  sinArchivo[1] = { ...sinArchivo[1], doc: null, error: 'no existe' };
  const a = check.revisar(sinArchivo, lima('2026-11-05 13:30'));
  assert.equal(a.ok, false);
  assert.match(a.hallazgos[0].titulo, /Palabras clave: no se pudo leer/);

  const b = check.revisar(fuentes(doc('2026-11-05'), { months: [{ id: '2026-11' }] }), lima('2026-11-05 13:30'));
  assert.match(b.hallazgos[0].titulo, /Palabras clave: sin período/);
});

test('los archivos de data/ de hoy se pueden revisar', () => {
  const reales = check.FUENTES.map(f => ({ ...f, doc: JSON.parse(fs.readFileSync(path.join(RAIZ, f.archivo), 'utf8')) }));
  reales.forEach(f => assert.ok(check.ultimoDia(f.doc), `${f.archivo} sin period.end`));
  // A mediodía del día más viejo de los dos archivos, tiene que salir al día.
  const hasta = reales.map(f => check.ultimoDia(f.doc)).sort()[0];
  assert.equal(check.revisar(reales, lima(`${hasta} 12:00`)).ok, true);
});

// ── Dónde mirar ─────────────────────────────────────────────────────────────────────────────────

test('el barrido corre bien pero no trae nada nuevo: es Nexus', () => {
  const ahora = lima('2026-11-04 08:00');
  const causa = check.causaProbable({ creado: lima('2026-11-04 06:30'), conclusion: 'success' }, ahora);
  assert.equal(causa.donde, 'nexus');
  assert.match(causa.texto, /Nexus no está escribiendo las hojas/);
});

test('el barrido no corre hace más de 13 horas: son los activadores del Apps Script', () => {
  const ahora = lima('2026-11-04 08:00');
  const causa = check.causaProbable({ creado: lima('2026-11-03 18:30'), conclusion: 'success' }, ahora);
  assert.equal(causa.donde, 'barrido');
  assert.match(causa.texto, /sincronizar-aquarius\.gs/);
});

test('el último barrido falló', () => {
  const ahora = lima('2026-11-04 08:00');
  const causa = check.causaProbable({ creado: lima('2026-11-04 06:30'), conclusion: 'failure' }, ahora);
  assert.equal(causa.donde, 'barrido');
  assert.match(causa.texto, /terminó en «failure»/);
});

test('sin datos del barrido, nombra las dos posibilidades', () => {
  assert.equal(check.causaProbable(null, Date.now()).donde, 'nexus-o-barrido');
});

// ── La memoria: la corrida anterior ─────────────────────────────────────────────────────────────

/** Un cliente de GitHub de mentira: rutas → respuestas. */
function github({ corridas, pasos = {} }) {
  const pedidas = [];
  const gh = async ruta => {
    pedidas.push(ruta);
    if (ruta.startsWith(`/actions/workflows/${check.WORKFLOW}/runs`)) return { workflow_runs: corridas };
    const id = (ruta.match(/^\/actions\/runs\/(\d+)\/jobs$/) || [])[1];
    if (id) return { jobs: [{ steps: pasos[id] || [] }] };
    throw new Error(`ruta inesperada ${ruta}`);
  };
  gh.pedidas = pedidas;
  return gh;
}
const rojo = [
  { name: 'Revisar la frescura del dato', conclusion: 'success' },
  { name: check.PASO_ROJO, conclusion: 'failure' },
];
const envioFallido = [
  { name: 'Revisar la frescura del dato', conclusion: 'failure' },
  { name: check.PASO_ROJO, conclusion: 'skipped' },
];

test('ya avisado: la corrida automática anterior quedó en rojo en «Dato atrasado»', async () => {
  const gh = github({
    corridas: [
      { id: 9, event: 'workflow_run', conclusion: 'failure' }, // la propia
      { id: 8, event: 'schedule', conclusion: 'failure' },
    ],
    pasos: { 8: rojo },
  });
  assert.equal(await check.yaAvisado(gh, 9), true);
  assert.ok(gh.pedidas.includes('/actions/runs/8/jobs'));
});

test('no avisado: la anterior quedó en verde', async () => {
  const gh = github({ corridas: [{ id: 8, event: 'workflow_run', conclusion: 'success' }] });
  assert.equal(await check.yaAvisado(gh, 9), false);
  assert.equal(gh.pedidas.length, 1, 'con una corrida en verde no hace falta mirar sus pasos');
});

test('no avisado: la anterior falló en el envío, así que el correo no salió y se reintenta', async () => {
  const gh = github({ corridas: [{ id: 8, event: 'schedule', conclusion: 'failure' }], pasos: { 8: envioFallido } });
  assert.equal(await check.yaAvisado(gh, 9), false);
});

test('las corridas manuales (simulación o prueba) no cuentan como memoria', async () => {
  const gh = github({
    corridas: [
      { id: 8, event: 'workflow_dispatch', conclusion: 'success' },
      { id: 7, event: 'workflow_run', conclusion: 'failure' },
    ],
    pasos: { 7: rojo },
  });
  assert.equal(await check.yaAvisado(gh, 9), true);
});

test('sin corridas anteriores no hay aviso previo', async () => {
  assert.equal(await check.yaAvisado(github({ corridas: [] }), 1), false);
});

test('el último barrido sale de la API de Actions', async () => {
  const gh = async ruta => {
    assert.match(ruta, /^\/actions\/workflows\/sync-drive\.yml\/runs\?status=completed/);
    return { workflow_runs: [{ run_started_at: '2026-11-04T11:30:00Z', conclusion: 'success', html_url: 'u' }] };
  };
  assert.deepEqual(await check.ultimoBarrido(gh), {
    creado: Date.parse('2026-11-04T11:30:00Z'),
    conclusion: 'success',
    url: 'u',
  });
  assert.equal(await check.ultimoBarrido(async () => ({ workflow_runs: [] })), null);
});

// ── Destinatarios: solo el equipo ───────────────────────────────────────────────────────────────

test('los destinatarios técnicos salen del secret si está', () => {
  const env = { AQ_ALERTAS_TECNICAS: ' a@limaretail.com, b@limaretail.com ,' };
  assert.deepEqual(destinatariosTecnicos(env, {}), ['a@limaretail.com', 'b@limaretail.com']);
});

test('sin secret, salen de destinatarios_tecnicos', () => {
  const config = { destinatarios_tecnicos: [{ email: 'equipo@limaretail.com' }] };
  assert.deepEqual(destinatariosTecnicos({}, config), ['equipo@limaretail.com']);
});

test('nunca caen en la lista del cliente', () => {
  const config = { destinatarios: [{ email: 'cliente@aquarius.pe' }] };
  assert.deepEqual(destinatariosTecnicos({}, config), []);
  assert.deepEqual(destinatariosTecnicos({ AQ_ALERTAS_URL: 'https://x', AQ_ALERTAS_TOKEN: 't' }, config), []);
});

test('data/alertas-config.json: el aviso técnico va solo a correos de la agencia', () => {
  const config = JSON.parse(fs.readFileSync(path.join(RAIZ, 'data', 'alertas-config.json'), 'utf8'));
  const lista = destinatariosTecnicos({}, config);
  assert.ok(lista.length > 0, 'falta destinatarios_tecnicos');
  lista.forEach(correo => assert.match(correo, /@limaretail\.com$/));
});

// ── El workflow y el correo ─────────────────────────────────────────────────────────────────────

test('el workflow tiene el paso que el script busca y escucha al barrido por su nombre', () => {
  const flujo = fs.readFileSync(path.join(RAIZ, '.github', 'workflows', check.WORKFLOW), 'utf8');
  const barrido = fs.readFileSync(path.join(RAIZ, '.github', 'workflows', 'sync-drive.yml'), 'utf8');
  assert.match(flujo, new RegExp(`- name: ${check.PASO_ROJO}\\r?\\n\\s+if: steps\\.revisar\\.outputs\\.atrasado == 'true'`));
  const nombre = barrido.match(/^name: (.+)$/m)[1].trim();
  assert.ok(flujo.includes(`workflows: ["${nombre}"]`), `alerta-datos.yml no escucha a «${nombre}»`);
  // La lista de la ruedita del tablero es la del cliente: este workflow no la recibe.
  assert.doesNotMatch(flujo, /AQ_ALERTAS_URL|AQ_ALERTAS_TOKEN/);
  // Ni dispara el barrido (que encadena la alerta semanal al cliente).
  assert.doesNotMatch(flujo, /gh workflow run|workflow_dispatch.*sync-drive/);
});

test('el correo de falla lleva los hallazgos, dónde mirar y escapa el HTML', () => {
  const informe = check.revisar(fuentes(doc('2026-11-03')), lima('2026-11-04 08:00'));
  informe.hallazgos[0].detalle += ' <b>';
  const nexus = check.correoFalla(informe, { donde: 'nexus', texto: 'Nexus no escribe' });
  assert.match(nexus, /dejaron de actualizarse/);
  assert.match(nexus, /el informe no avanza/);
  assert.match(nexus, /Nexus no escribe/);
  assert.match(nexus, /storage\/sync\/cron\.log/);
  assert.match(nexus, /&lt;b&gt;/);
  assert.doesNotMatch(nexus, / <b>/);

  const barrido = check.correoFalla(informe, { donde: 'barrido', texto: 'El barrido no corre' });
  assert.doesNotMatch(barrido, /cron\.log/, 'si el problema es el barrido, no manda a mirar el hosting');
});

test('los correos de vuelta y de prueba llevan el resumen', () => {
  const informe = check.revisar(fuentes(doc('2026-11-05')), lima('2026-11-05 08:00'));
  assert.match(check.correoVuelta(informe), /volvieron a actualizarse[\s\S]*hasta el 2026-11-05/);
  assert.match(check.correoPrueba(informe), /Prueba del aviso[\s\S]*hasta el 2026-11-05/);
});
