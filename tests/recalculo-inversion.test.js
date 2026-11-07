// Pruebas del Recálculo de inversión (js/recalculo-inversion.js). Se corren con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/recalculo-inversion.js');

// Caso Aquarius: hoy 05/11/2026, corte 04/11, 26 días restantes, el mismo presupuesto en octubre y noviembre.
const CASO = [
  // campaña, ppto. mes, gasto octubre, gasto 1-4 nov, diario actual
  ['GESTIONLOGISTICA', 528.27, 207.52, 10.10, 28.5],
  ['FOTOGRAMETRÍACONDRONES', 300.00, 510.41, 0.00, 30],
  ['ACTIVOSFIJOS', 526.41, 88.19, 1.49, 28.4],
  ['VALUACIONESCOMERCIALES', 300.00, 262.86, 0.00, 30],
  ['OUTSOURCINGDEALMACENES', 396.66, 55.60, 13.69, 21.4],
  ['ALMACENAMIENTO', 316.96, 245.73, 60.75, 17.1],
  ['ESTUDIOTECNICODEMERMAS', 300.00, 250.11, 0.00, 30],
  ['PRODUCTOSTI', 231.70, 167.37, 31.59, 12.5],
];
const SIN_SALDO = [19.93, 11.54, 20.19, 11.54, 14.73, 9.85, 11.54, 7.70];
const CON_SALDO = [32.27, 3.45, 37.04, 12.97, 27.85, 12.59, 13.46, 10.17];

// El gasto de noviembre repartido en los días 1 a 4 (el informe por día lo cubre hasta ayer).
function porDiaNoviembre(total) {
  const parte = Math.round((total / 4) * 100) / 100;
  return {
    '2026-11-01': parte, '2026-11-02': parte, '2026-11-03': parte,
    '2026-11-04': Math.round((total - parte * 3) * 100) / 100,
  };
}

function casoAquarius(conSaldo, extra = {}) {
  return Object.assign({
    hoy: '2026-11-05',
    conSaldo,
    porDia: [{ desde: '2026-11-01', hasta: '2026-11-04' }],
    totalHasta: null,
    campanas: CASO.map(([campana, ppto, octubre, noviembre, diario]) => ({
      campana, estado: 'Habilitada', activa: true,
      presupuestoMes: ppto, presupuestoMesAnterior: ppto, gastoMesAnterior: octubre,
      diarioActual: diario, gastoMes: noviembre, gastoPorDia: porDiaNoviembre(noviembre),
    })),
  }, extra);
}

const diarios = resultado => resultado.filas.map(fila => fila.diarioRecomendado);
const alertasDe = fila => fila.alertas.map(alerta => alerta.texto);

test('caso Aquarius sin saldo: corte, días restantes y diario recomendado', () => {
  const resultado = R.recalcular(casoAquarius(false));
  assert.equal(resultado.corte, '2026-11-04');
  assert.equal(resultado.diasRestantes, 26);
  assert.equal(resultado.fuente, 'diario');
  assert.deepEqual(diarios(resultado), SIN_SALDO);
  assert.equal(resultado.totales.diarioRecomendado, 107.02);
  assert.equal(resultado.avisos.length, 0);
  // Sin saldo, las columnas del mes anterior no se llenan.
  assert.equal(resultado.filas[0].saldoMesAnterior, null);
  assert.equal(resultado.filas[0].presupuestoEfectivo, 528.27);
  assert.equal(resultado.filas[0].gastoAcumulado, 10.10);
  assert.equal(resultado.filas[0].porGastar, 518.17);
});

test('caso Aquarius con saldo: diario recomendado, total y sobregasto de Fotogrametría', () => {
  const resultado = R.recalcular(casoAquarius(true));
  assert.deepEqual(diarios(resultado), CON_SALDO);
  // Total = suma de los diarios redondeados, lo que queda cargado en Google Ads.
  assert.equal(resultado.totales.diarioRecomendado, 149.80);
  const foto = resultado.filas.find(fila => fila.campana === 'FOTOGRAMETRÍACONDRONES');
  assert.equal(foto.saldoMesAnterior, -210.41);
  assert.equal(foto.presupuestoEfectivo, 89.59);
  assert.ok(alertasDe(foto).includes('Sobregasto mes anterior: S/ 210.41'));
  const gestion = resultado.filas[0];
  assert.equal(gestion.saldoMesAnterior, 320.75);
  assert.equal(gestion.presupuestoEfectivo, 849.02);
  assert.equal(resultado.totales.saldoMesAnterior, Math.round((CASO.reduce((t, c) => t + c[1] - c[2], 0)) * 100) / 100);
});

test('con el total del mes del informe de campañas da lo mismo y avisa si incluye hoy', () => {
  const entrada = casoAquarius(true, { porDia: [], totalHasta: '2026-11-05' });
  const resultado = R.recalcular(entrada);
  assert.equal(resultado.fuente, 'total');
  assert.equal(resultado.corte, '2026-11-04');
  assert.deepEqual(diarios(resultado), CON_SALDO);
  assert.ok(resultado.avisos.some(aviso => aviso.tipo === 'incluye-hoy'));
  assert.ok(!resultado.avisos.some(aviso => aviso.tipo === 'gasto-disponible'));
});

test('primer día del mes: gasto acumulado 0, corte el último día del mes anterior', () => {
  const entrada = casoAquarius(false, { hoy: '2026-11-01', porDia: [{ desde: '2026-10-01', hasta: '2026-10-31' }], totalHasta: null });
  const resultado = R.recalcular(entrada);
  assert.equal(resultado.corte, '2026-10-31');
  assert.equal(resultado.diasRestantes, 30);
  assert.equal(resultado.avisos.length, 0);
  resultado.filas.forEach(fila => assert.equal(fila.gastoAcumulado, 0));
  assert.equal(resultado.filas[0].diarioRecomendado, R.r2(528.27 / 30));
});

test('último día del mes: 1 día restante y el diario es todo lo que falta', () => {
  const entrada = casoAquarius(false, {
    hoy: '2026-11-30',
    porDia: [{ desde: '2026-11-01', hasta: '2026-11-29' }],
  });
  const resultado = R.recalcular(entrada);
  assert.equal(resultado.corte, '2026-11-29');
  assert.equal(resultado.diasRestantes, 1);
  resultado.filas.forEach(fila => assert.equal(fila.diarioRecomendado, fila.porGastar));
});

test('sobregasto que deja el presupuesto efectivo en 0: diario 0 y presupuesto agotado', () => {
  const resultado = R.recalcular({
    hoy: '2026-11-05', conSaldo: true, porDia: [{ desde: '2026-11-01', hasta: '2026-11-04' }],
    campanas: [{
      campana: 'X', estado: 'Habilitada', activa: true, presupuestoMes: 300, presupuestoMesAnterior: 300,
      gastoMesAnterior: 700, diarioActual: 10, gastoPorDia: { '2026-11-02': 10 },
    }],
  });
  const fila = resultado.filas[0];
  assert.equal(fila.saldoMesAnterior, -400);
  assert.equal(fila.presupuestoEfectivo, 0);
  assert.equal(fila.porGastar, -10);
  assert.equal(fila.diarioRecomendado, 0);
  assert.equal(fila.agotado, true);
  assert.deepEqual(alertasDe(fila).slice(0, 2), ['Presupuesto agotado', 'Sobregasto mes anterior: S/ 400.00']);
});

test('sin gasto de ayer: corta en el último día con datos y avisa', () => {
  const entrada = casoAquarius(false, { porDia: [{ desde: '2026-11-01', hasta: '2026-11-02' }] });
  const resultado = R.recalcular(entrada);
  assert.equal(resultado.corte, '2026-11-02');
  assert.equal(resultado.diasRestantes, 26);
  assert.deepEqual(resultado.avisos.map(aviso => aviso.texto), ['Gasto disponible hasta 02/11']);
  // Solo suma los días 1 y 2.
  const gestion = resultado.filas[0];
  assert.equal(gestion.gastoAcumulado, R.r2(porDiaNoviembre(10.10)['2026-11-01'] * 2));
});

test('el total del mes que no llega a ayer también avisa', () => {
  const resultado = R.recalcular(casoAquarius(false, { porDia: [], totalHasta: '2026-11-03' }));
  assert.equal(resultado.corte, '2026-11-03');
  assert.deepEqual(resultado.avisos.map(aviso => aviso.texto), ['Gasto disponible hasta 03/11']);
});

test('sin presupuesto del mes anterior: sin saldo y lo dice', () => {
  const entrada = casoAquarius(true);
  entrada.campanas[0].presupuestoMesAnterior = null;
  const fila = R.recalcular(entrada).filas[0];
  assert.equal(fila.saldoMesAnterior, null);
  assert.equal(fila.presupuestoEfectivo, 528.27);
  assert.equal(fila.diarioRecomendado, 19.93);
  assert.ok(alertasDe(fila).includes('Sin presupuesto del mes anterior'));
});

test('sin presupuesto del mes: no recomienda y no entra al total', () => {
  const entrada = casoAquarius(false);
  entrada.campanas[0].presupuestoMes = null;
  const resultado = R.recalcular(entrada);
  assert.equal(resultado.filas[0].diarioRecomendado, null);
  assert.ok(alertasDe(resultado.filas[0]).includes('Falta el presupuesto del mes'));
  assert.equal(resultado.totales.diarioRecomendado, R.r2(107.02 - 19.93));
});

test('campaña pausada con saldo: alerta Finalizada / pausada', () => {
  const entrada = casoAquarius(false);
  Object.assign(entrada.campanas[1], { estado: 'En pausa', activa: false });
  const fila = R.recalcular(entrada).filas[1];
  assert.ok(alertasDe(fila).some(texto => texto.startsWith('Finalizada / pausada')));
});

test('no consume presupuesto: últimos 7 días con el informe por día', () => {
  const resultado = R.recalcular({
    hoy: '2026-11-20', conSaldo: false, porDia: [{ desde: '2026-11-01', hasta: '2026-11-19' }],
    campanas: [
      // 7 días a 4 de un diario de 10 = 40%: avisa.
      { campana: 'Baja', estado: 'Habilitada', activa: true, presupuestoMes: 300, diarioActual: 10,
        gastoPorDia: Object.fromEntries([13, 14, 15, 16, 17, 18, 19].map(d => [`2026-11-${d}`, 4])) },
      // 7 días a 6 = 60%: no avisa.
      { campana: 'Normal', estado: 'Habilitada', activa: true, presupuestoMes: 300, diarioActual: 10,
        gastoPorDia: Object.fromEntries([13, 14, 15, 16, 17, 18, 19].map(d => [`2026-11-${d}`, 6])) },
    ],
  });
  assert.ok(alertasDe(resultado.filas[0]).some(texto => texto.startsWith('No consume presupuesto') && texto.includes('últimos 7 días')));
  assert.ok(!alertasDe(resultado.filas[1]).some(texto => texto.startsWith('No consume presupuesto')));
});

test('no consume presupuesto: sin informe por día usa el promedio del mes', () => {
  const resultado = R.recalcular(casoAquarius(false, { porDia: [], totalHasta: '2026-11-04' }));
  const foto = resultado.filas.find(fila => fila.campana === 'FOTOGRAMETRÍACONDRONES');
  const almacenamiento = resultado.filas.find(fila => fila.campana === 'ALMACENAMIENTO');
  assert.ok(alertasDe(foto).some(texto => texto.includes('promedio de 4 días del mes')));
  // 60.75 / 4 = 15.19 por día contra un diario de 17.10: más de la mitad, no avisa.
  assert.ok(!alertasDe(almacenamiento).some(texto => texto.startsWith('No consume')));
});

test('tope mensual de Google Ads: avisa en un mes de 31 días, no en uno de 30', () => {
  const campana = { campana: 'X', estado: 'Habilitada', activa: true, presupuestoMes: 310, diarioActual: 10, gastoPorDia: {} };
  const diciembre = R.recalcular({ hoy: '2026-12-01', conSaldo: false, porDia: [], campanas: [campana] });
  assert.equal(diciembre.filas[0].diarioRecomendado, 10);
  assert.ok(alertasDe(diciembre.filas[0]).some(texto => texto.startsWith('Tope mensual de Google Ads: cobra como máximo S/ 304.00')));
  const noviembre = R.recalcular({ hoy: '2026-11-01', conSaldo: false, porDia: [], campanas: [Object.assign({}, campana, { presupuestoMes: 300 })] });
  assert.ok(!alertasDe(noviembre.filas[0]).some(texto => texto.startsWith('Tope mensual')));
});

test('corte sin ningún dato de gasto', () => {
  const resultado = R.recalcular({ hoy: '2026-11-10', conSaldo: false, porDia: [], totalHasta: null, campanas: [] });
  assert.equal(resultado.corte, null);
  assert.equal(resultado.avisos[0].tipo, 'sin-gasto');
});

test('Copiar (TSV) y Exportar CSV: encabezado, columnas según el modo y fila de totales', () => {
  const sin = R.recalcular(casoAquarius(false));
  const tsv = R.aTsv(sin, 'Aquarius').split('\n');
  assert.equal(tsv[0], 'Cliente\tAquarius');
  assert.equal(tsv[2], 'Fecha de corte\t2026-11-04');
  assert.equal(tsv[3], 'Días restantes\t26');
  const cabecera = tsv[6].split('\t');
  assert.ok(!cabecera.includes('Saldo mes anterior'));
  assert.equal(cabecera.length, 10);
  const total = tsv[tsv.length - 1].split('\t');
  assert.equal(total[0], 'Total');
  assert.equal(total[cabecera.indexOf('Diario recomendado')], '107.02');

  const con = R.recalcular(casoAquarius(true));
  const csv = R.aCsv(con, 'Aquarius').split('\r\n');
  const columnas = csv[6].split(',');
  assert.equal(columnas.length, 13);
  assert.ok(columnas.includes('Saldo mes anterior'));
  const foto = csv.find(linea => linea.startsWith('FOTOGRAMETRÍACONDRONES'));
  assert.ok(foto.includes('-210.41'));
  assert.ok(foto.includes('Sobregasto mes anterior: S/ 210.41'));
});

test('CSV: un nombre que empieza con = no se abre como fórmula', () => {
  const entrada = casoAquarius(false);
  entrada.campanas[0].campana = '=HYPERLINK("x")';
  const csv = R.aCsv(R.recalcular(entrada), 'Aquarius');
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
});

// ── Con el JSON del tablero ────────────────────────────────────────────────
// Recorte del informe real: octubre completo con su informe por día y noviembre al 05/11 (06:03 de Lima).
function datosTablero() {
  const prefijo = 'IDG_AQUARIUSCONSULTING_PE_SKAG-';
  const records = (mes, extra) => CASO.map(([campana, , octubre, noviembre, diario]) => ({
    campaign: prefijo + campana, cost: mes === '2026-10' ? octubre : noviembre, status: 'Habilitada', dailyBudget: diario,
  })).concat(extra || []);
  const pausada = { campaign: 'Aquarius Consulting', cost: 0, status: 'En pausa', dailyBudget: 12 };
  return {
    months: [
      {
        id: '2026-10', period: { start: '2026-10-01', end: '2026-10-31' }, records: records('2026-10', [pausada]),
        detail: { table: { columns: ['d', 'campaign', 'cost', 'clicks', 'conversions'], campaigns: [prefijo + 'GESTIONLOGISTICA'], rows: [[1, 0, 5, 1, 0], [31, 0, 7, 1, 0]] } },
      },
      { id: '2026-11', period: { start: '2026-11-01', end: '2026-11-05' }, records: records('2026-11', [pausada]) },
    ],
  };
}

test('desde el JSON del tablero: arma la entrada y reproduce el caso Aquarius', () => {
  const presupuestos = { '2026-10': {}, '2026-11': {} };
  CASO.forEach(([campana, ppto]) => {
    const key = R.clave(`IDG_AQUARIUSCONSULTING_PE_SKAG-${campana}`);
    presupuestos['2026-10'][key] = ppto;
    presupuestos['2026-11'][key] = ppto;
  });
  const etiqueta = nombre => nombre.replace('IDG_AQUARIUSCONSULTING_PE_SKAG-', '');
  const entrada = R.entradaDesdeDatos(datosTablero(), { hoy: '2026-11-05', conSaldo: true, presupuestos, etiqueta });
  // La campaña en pausa, sin gasto ni presupuesto, no entra.
  assert.equal(entrada.campanas.length, 8);
  assert.equal(entrada.totalHasta, '2026-11-05');
  assert.deepEqual(entrada.porDia, [{ desde: '2026-10-01', hasta: '2026-10-31' }]);
  assert.equal(entrada.campanas.find(c => c.etiqueta === 'GESTIONLOGISTICA').gastoPorDia['2026-10-31'], 7);

  const resultado = R.recalcular(entrada);
  assert.equal(resultado.corte, '2026-11-04');
  assert.equal(resultado.fuente, 'total');
  const porNombre = Object.fromEntries(resultado.filas.map(fila => [fila.etiqueta, fila.diarioRecomendado]));
  CASO.forEach(([campana], index) => assert.equal(porNombre[campana], CON_SALDO[index], campana));
  assert.equal(resultado.totales.diarioRecomendado, 149.80);

  const sinSaldo = R.recalcular(R.entradaDesdeDatos(datosTablero(), { hoy: '2026-11-05', conSaldo: false, presupuestos, etiqueta }));
  const sinNombre = Object.fromEntries(sinSaldo.filas.map(fila => [fila.etiqueta, fila.diarioRecomendado]));
  CASO.forEach(([campana], index) => assert.equal(sinNombre[campana], SIN_SALDO[index], campana));
});

test('desde el JSON del tablero: presupuesto de una campaña que el informe no trae', () => {
  const entrada = R.entradaDesdeDatos(datosTablero(), {
    hoy: '2026-11-05', conSaldo: false, presupuestos: { '2026-11': { nueva: 260 } }, nombres: { nueva: 'Nueva' },
  });
  const nueva = entrada.campanas.find(c => c.campana === 'Nueva');
  assert.equal(nueva.estado, 'Sin informe');
  assert.equal(R.recalcular(entrada).filas.find(f => f.campana === 'Nueva').diarioRecomendado, 10);
});
