/* ============================================================
   recalculo-inversion.js — Recálculo de inversión (solo el cálculo).

   Dice cuánto debería gastar por día cada campaña desde hoy hasta fin de mes
   para cerrar en su presupuesto. Solo recomienda: nada de aquí toca Google Ads.

   - Fecha de corte: ayer en Lima. Si el gasto no llega a ayer, el último día
     con datos, y el aviso «Gasto disponible hasta DD/MM».
   - Gasto acumulado: del día 1 al corte (con el informe por día) o el total
     del mes del informe de campañas cuando no hay informe por día.
   - Días restantes: de hoy al último día del mes, ambos incluidos (mínimo 1).
   - Por gastar = presupuesto efectivo − gasto acumulado.
   - Diario recomendado = por gastar ÷ días restantes, a 2 decimales; con
     por gastar ≤ 0 es 0 y la campaña queda en «Presupuesto agotado».
   - Con «Saldo mes anterior»: saldo = presupuesto anterior − gasto anterior y
     efectivo = presupuesto del mes + saldo, nunca menos de 0.
   - El total del diario recomendado es la suma de los diarios ya redondeados:
     lo mismo que queda cargado en Google Ads.

   No usa el DOM ni la hora del sistema: todo entra por parámetros, así que se
   prueba con node --test (tests/recalculo-inversion.test.js).
   Expone window.AquariusRecalculo en el navegador y module.exports en Node.
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AquariusRecalculo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Google Ads cobra en un mes como máximo el presupuesto diario promedio × 30.4.
  const TOPE_DIAS = 30.4;
  // «No consume presupuesto»: gastó menos de la mitad de su diario en los últimos 7 días.
  const CONSUMO_MINIMO = 0.5;
  const DIAS_CONSUMO = 7;

  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const DAY = 86400000;

  // Redondeo a céntimos sin el error de coma flotante (1.005 → 1.01).
  function r2(value) {
    if (value == null || !Number.isFinite(Number(value))) return null;
    const number = Number(value);
    return (Math.sign(number) * Math.round(Math.abs(number) * 100 + 1e-7)) / 100 || 0;
  }

  const num = value => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

  // Fechas ISO (AAAA-MM-DD) en UTC: así no las mueve la zona horaria del equipo.
  const toTime = iso => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const fromTime = time => new Date(time).toISOString().slice(0, 10);
  const addDays = (iso, days) => fromTime(toTime(iso) + days * DAY);
  const daysBetween = (from, to) => Math.round((toTime(to) - toTime(from)) / DAY);
  const daysInMonth = monthId => new Date(Date.UTC(Number(monthId.slice(0, 4)), Number(monthId.slice(5, 7)), 0)).getUTCDate();
  const ddmm = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
  const minIso = (a, b) => (a <= b ? a : b);

  function mesAnterior(monthId) {
    const year = Number(monthId.slice(0, 4));
    const month = Number(monthId.slice(5, 7));
    return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  }

  // Montos para los textos de las alertas: «S/ 1,234.56».
  function soles(value) {
    const amount = r2(Math.abs(Number(value) || 0)).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `S/ ${amount}`;
  }

  // ¿Están todos los días de [desde, hasta] dentro de algún tramo del informe por día?
  function cubierto(tramos, desde, hasta) {
    for (let day = desde; day <= hasta; day = addDays(day, 1)) {
      if (!tramos.some(tramo => tramo.desde <= day && day <= tramo.hasta)) return false;
    }
    return true;
  }

  // Último día d tal que todo [inicio, d] está cubierto por el informe por día (o null).
  function cubiertoHasta(tramos, inicio, limite) {
    let ultimo = null;
    for (let day = inicio; day <= limite; day = addDays(day, 1)) {
      if (!tramos.some(tramo => tramo.desde <= day && day <= tramo.hasta)) break;
      ultimo = day;
    }
    return ultimo;
  }

  function sumaDias(porDia, desde, hasta) {
    let total = 0;
    Object.keys(porDia || {}).forEach(day => {
      if (day >= desde && day <= hasta) total += Number(porDia[day]) || 0;
    });
    return total;
  }

  /**
   * Fecha de corte y de dónde sale el gasto del mes.
   * @param {string} hoy            Hoy en Lima, AAAA-MM-DD.
   * @param {Array}  porDia         Tramos que cubre el informe por día: [{ desde, hasta }].
   * @param {string} totalHasta     Fin del informe de campañas del mes en curso (total por campaña), o null.
   */
  function corteDe(hoy, porDia, totalHasta) {
    const mes = hoy.slice(0, 7);
    const inicio = `${mes}-01`;
    const ayer = addDays(hoy, -1);
    const tramos = Array.isArray(porDia) ? porDia.filter(tramo => tramo && ISO.test(tramo.desde) && ISO.test(tramo.hasta)) : [];
    const total = ISO.test(String(totalHasta || '')) && totalHasta >= inicio ? totalHasta : null;

    // El primer día del mes el corte es el último día del mes anterior: no hay gasto del mes que sumar.
    if (ayer < inicio) {
      return { mes, inicio, ayer, corte: ayer, fuente: 'sin-gasto', datosHasta: ayer, incluyeHoy: false };
    }

    const diario = cubiertoHasta(tramos, inicio, ayer);
    // Manda el informe por día si llega a ayer; si no, el total del mes si llega más lejos.
    if (diario === ayer || (diario && (!total || diario >= minIso(total, ayer)))) {
      return { mes, inicio, ayer, corte: diario, fuente: 'diario', datosHasta: diario, incluyeHoy: false };
    }
    if (total) {
      // El informe de «este mes» puede llegar a hoy: el total trae lo que va del día.
      return { mes, inicio, ayer, corte: minIso(total, ayer), fuente: 'total', datosHasta: total, incluyeHoy: total >= hoy };
    }
    // Sin gasto del mes: el último día con datos es del mes anterior (si lo hay) y el acumulado es 0.
    const previos = tramos.map(tramo => minIso(tramo.hasta, ayer)).filter(day => day < inicio).sort();
    const datosHasta = previos.length ? previos[previos.length - 1] : null;
    return { mes, inicio, ayer, corte: datosHasta, fuente: 'sin-gasto', datosHasta, incluyeHoy: false };
  }

  /**
   * Recálculo de inversión del mes de «hoy».
   * entrada = {
   *   hoy: 'AAAA-MM-DD',              hoy en Lima
   *   conSaldo: boolean,              suma el saldo del mes anterior
   *   porDia: [{ desde, hasta }],     tramos que cubre el informe por día (sin fila = 0 ese día)
   *   totalHasta: 'AAAA-MM-DD'|null,  fin del informe de campañas del mes en curso
   *   campanas: [{
   *     campana, etiqueta?, estado, activa,
   *     presupuestoMes, presupuestoMesAnterior, gastoMesAnterior,
   *     diarioActual,                 presupuesto diario vigente en Google Ads
   *     gastoMes,                     total del mes del informe de campañas
   *     gastoPorDia: { 'AAAA-MM-DD': gasto }   del mes en curso y del anterior
   *   }]
   * }
   */
  function recalcular(entrada) {
    const hoy = String(entrada && entrada.hoy || '');
    if (!ISO.test(hoy)) throw new Error('recalcular: hoy debe ser AAAA-MM-DD');
    const conSaldo = Boolean(entrada.conSaldo);
    const corte = corteDe(hoy, entrada.porDia, entrada.totalHasta);
    const diasMes = daysInMonth(corte.mes);
    const diasRestantes = Math.max(1, diasMes - Number(hoy.slice(8, 10)) + 1);
    const diasTranscurridos = diasMes - diasRestantes;
    const tramos = Array.isArray(entrada.porDia) ? entrada.porDia : [];

    const avisos = [];
    if (corte.datosHasta && corte.datosHasta < corte.ayer) {
      avisos.push({ tipo: 'gasto-disponible', texto: `Gasto disponible hasta ${ddmm(corte.datosHasta)}` });
    } else if (!corte.datosHasta) {
      avisos.push({ tipo: 'sin-gasto', texto: 'Sin datos de gasto: el gasto acumulado se toma como 0' });
    }
    if (corte.incluyeHoy) {
      avisos.push({ tipo: 'incluye-hoy', texto: `El informe llega al ${ddmm(corte.datosHasta)}: el gasto acumulado puede incluir lo que va de hoy` });
    }
    (entrada.avisos || []).forEach(aviso => { if (aviso && aviso.texto) avisos.push(aviso); });

    // Últimos 7 días hasta el corte: con el informe por día si los cubre; si no, el promedio del mes.
    const ventana = corte.corte ? { desde: addDays(corte.corte, -(DIAS_CONSUMO - 1)), hasta: corte.corte } : null;
    const ventanaCubierta = Boolean(ventana && cubierto(tramos, ventana.desde, ventana.hasta));
    const diasConGasto = corte.fuente === 'sin-gasto' || !corte.corte ? 0 : daysBetween(corte.inicio, corte.corte) + 1;

    const filas = (entrada.campanas || []).map(item => {
      const presupuestoMes = r2(num(item.presupuestoMes));
      const presupuestoMesAnterior = r2(num(item.presupuestoMesAnterior));
      const gastoMesAnterior = r2(num(item.gastoMesAnterior));
      const diarioActual = r2(num(item.diarioActual));
      const activa = item.activa !== false;
      const alertas = [];

      let gastoAcumulado = 0;
      if (corte.fuente === 'diario') gastoAcumulado = sumaDias(item.gastoPorDia, corte.inicio, corte.corte);
      else if (corte.fuente === 'total') gastoAcumulado = Number(item.gastoMes) || 0;
      gastoAcumulado = r2(gastoAcumulado);

      let saldoMesAnterior = null;
      if (conSaldo) {
        if (presupuestoMesAnterior == null) {
          alertas.push({ tipo: 'sin-presupuesto-anterior', tono: 'muted', texto: 'Sin presupuesto del mes anterior' });
        } else {
          saldoMesAnterior = r2(presupuestoMesAnterior - (gastoMesAnterior || 0));
          if (saldoMesAnterior < 0) {
            alertas.push({ tipo: 'sobregasto-anterior', tono: 'amber', texto: `Sobregasto mes anterior: ${soles(-saldoMesAnterior)}` });
          }
        }
      }

      let presupuestoEfectivo = null;
      let porGastar = null;
      let diarioRecomendado = null;
      let agotado = false;
      if (presupuestoMes == null) {
        alertas.unshift({ tipo: 'sin-presupuesto', tono: 'muted', texto: 'Falta el presupuesto del mes' });
      } else {
        presupuestoEfectivo = Math.max(0, r2(presupuestoMes + (saldoMesAnterior || 0)));
        porGastar = r2(presupuestoEfectivo - gastoAcumulado);
        agotado = porGastar <= 0;
        diarioRecomendado = agotado ? 0 : r2(porGastar / diasRestantes);
        if (agotado) alertas.unshift({ tipo: 'agotado', tono: 'red', texto: 'Presupuesto agotado' });
      }

      if (!activa && porGastar != null && porGastar > 0) {
        alertas.push({ tipo: 'pausada', tono: 'amber', texto: `Finalizada / pausada con saldo de ${soles(porGastar)}` });
      }

      // No consume: menos de la mitad de su diario. Con 7 días de informe por día, esos 7 días; sin él, el promedio del mes.
      if (activa && diarioActual > 0) {
        let promedio = null;
        let base = '';
        if (ventanaCubierta) {
          promedio = sumaDias(item.gastoPorDia, ventana.desde, ventana.hasta) / DIAS_CONSUMO;
          base = 'últimos 7 días';
        } else if (diasConGasto > 0) {
          promedio = gastoAcumulado / diasConGasto;
          base = `promedio de ${diasConGasto} ${diasConGasto === 1 ? 'día' : 'días'} del mes`;
        }
        if (promedio != null && promedio < diarioActual * CONSUMO_MINIMO) {
          alertas.push({
            tipo: 'no-consume', tono: 'amber',
            texto: `No consume presupuesto: ${soles(promedio)} por día (${base}), ${Math.round((promedio / diarioActual) * 100)}% de su diario`,
          });
        }
      }

      // Tope mensual: Google cobra a lo más el diario promedio del mes × 30.4. El promedio junta lo ya
      // corrido (lo gastado o el diario actual por los días que pasaron, lo que sea mayor, porque no hay
      // historial de diarios) y el diario recomendado por los días que faltan, sin redondear: el redondeo
      // a céntimos daría avisos falsos en presupuestos chicos. En meses de 30 días o menos no salta; en
      // los de 31, el diario del mes por 30.4 queda debajo del presupuesto y el aviso lo dice.
      if (!agotado && diarioRecomendado != null && presupuestoEfectivo > 0) {
        const corrido = Math.max(gastoAcumulado, (diarioActual || 0) * diasTranscurridos);
        const promedio = (corrido + porGastar) / diasMes;
        const tope = r2(promedio * TOPE_DIAS);
        if (tope < presupuestoEfectivo) {
          alertas.push({
            tipo: 'tope-google', tono: 'amber',
            texto: `Tope mensual de Google Ads: cobra como máximo ${soles(tope)} (diario promedio × ${TOPE_DIAS}), menos que el presupuesto efectivo`,
          });
        }
      }

      return {
        campana: String(item.campana || ''),
        etiqueta: String(item.etiqueta || item.campana || ''),
        estado: item.estado || '',
        activa,
        presupuestoMes,
        presupuestoMesAnterior: conSaldo ? presupuestoMesAnterior : null,
        gastoMesAnterior: conSaldo ? gastoMesAnterior : null,
        saldoMesAnterior,
        presupuestoEfectivo,
        gastoAcumulado,
        porGastar,
        diarioActual,
        diarioRecomendado,
        diferencia: diarioRecomendado == null || diarioActual == null ? null : r2(diarioRecomendado - diarioActual),
        agotado,
        alertas,
      };
    });

    const suma = field => {
      const values = filas.map(fila => fila[field]).filter(value => value != null);
      return values.length ? r2(values.reduce((total, value) => total + value, 0)) : null;
    };
    const totales = {
      presupuestoMes: suma('presupuestoMes'),
      presupuestoMesAnterior: conSaldo ? suma('presupuestoMesAnterior') : null,
      gastoMesAnterior: conSaldo ? suma('gastoMesAnterior') : null,
      saldoMesAnterior: conSaldo ? suma('saldoMesAnterior') : null,
      presupuestoEfectivo: suma('presupuestoEfectivo'),
      gastoAcumulado: suma('gastoAcumulado'),
      porGastar: suma('porGastar'),
      diarioActual: suma('diarioActual'),
      // Suma de los diarios ya redondeados: es lo que se carga en Google Ads.
      diarioRecomendado: suma('diarioRecomendado'),
      diferencia: null,
    };
    if (totales.diarioRecomendado != null && totales.diarioActual != null) {
      totales.diferencia = r2(totales.diarioRecomendado - totales.diarioActual);
    }

    return {
      hoy,
      mes: corte.mes,
      mesAnterior: mesAnterior(corte.mes),
      ayer: corte.ayer,
      corte: corte.corte,
      fuente: corte.fuente,
      datosHasta: corte.datosHasta,
      incluyeHoy: corte.incluyeHoy,
      diasMes,
      diasRestantes,
      diasTranscurridos,
      conSaldo,
      modo: conSaldo ? 'Con saldo del mes anterior' : 'Sin saldo del mes anterior',
      avisos,
      filas,
      totales,
    };
  }

  // ── Entrada desde los datos del tablero ──────────────────────────────────────
  // Misma clave que la hoja del CRM: sin tildes, sin mayúsculas y con un solo espacio.
  function clave(text) {
    return String(text == null ? '' : text).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  const activaPorEstado = estado => !estado || /^habilitad/i.test(String(estado));

  // Gasto por día y campaña de months[].detail.table. El tramo cubierto va del primer al último día con
  // filas, igual que el módulo Gasto publicitario (sin fila = 0 ese día).
  function detalleDe(month) {
    const table = month && month.detail && month.detail.table;
    if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows) || !table.rows.length) return null;
    const at = Object.fromEntries(table.columns.map((name, index) => [name, index]));
    const names = Array.isArray(table.campaigns) ? table.campaigns : [];
    const porCampana = {};
    let first = 99;
    let last = 0;
    table.rows.forEach(row => {
      const day = Number(row[at.d]);
      if (!(day > 0)) return;
      first = Math.min(first, day);
      last = Math.max(last, day);
      const key = clave(names[row[at.campaign]]);
      const iso = `${month.id}-${String(day).padStart(2, '0')}`;
      porCampana[key] = porCampana[key] || {};
      porCampana[key][iso] = (porCampana[key][iso] || 0) + (Number(row[at.cost]) || 0);
    });
    if (!last) return null;
    const dd = day => `${month.id}-${String(day).padStart(2, '0')}`;
    return { tramo: { desde: dd(first), hasta: dd(last) }, porCampana };
  }

  /**
   * Arma la entrada de recalcular() con el JSON del tablero (data/aquarius-lima-retail-2026.json).
   * opciones = { hoy, conSaldo, presupuestos: { 'AAAA-MM': { [clave(campaña)]: monto } }, etiqueta(nombre) }
   * Entran las campañas del informe del mes (o del mes anterior si aún no hay) que están habilitadas,
   * que gastaron en el mes o que tienen presupuesto cargado; más las que tienen presupuesto y no salen en el informe.
   */
  function entradaDesdeDatos(data, opciones) {
    const hoy = opciones.hoy;
    const mes = hoy.slice(0, 7);
    const anterior = mesAnterior(mes);
    const months = (data && Array.isArray(data.months) ? data.months : []);
    const actual = months.find(month => month.id === mes) || null;
    const previo = months.find(month => month.id === anterior) || null;
    const presupuestos = opciones.presupuestos || {};
    const pptoMes = presupuestos[mes] || {};
    const pptoAnterior = presupuestos[anterior] || {};
    const etiqueta = typeof opciones.etiqueta === 'function' ? opciones.etiqueta : name => name;
    const avisos = [];

    const detalles = [detalleDe(previo), detalleDe(actual)].filter(Boolean);
    const gastoDe = (records, key) => {
      const record = (records || []).find(item => clave(item.campaign) === key);
      return record ? Number(record.cost) || 0 : 0;
    };

    const base = actual ? actual.records || [] : (previo ? previo.records || [] : []);
    const vistos = new Set();
    const campanas = [];
    base.forEach(record => {
      const key = clave(record.campaign);
      if (!key || vistos.has(key)) return;
      const gastoMes = actual ? gastoDe(actual.records, key) : 0;
      const tienePpto = num(pptoMes[key]) != null;
      if (!activaPorEstado(record.status) && !(gastoMes > 0) && !tienePpto) return;
      vistos.add(key);
      campanas.push({
        campana: record.campaign,
        etiqueta: etiqueta(record.campaign),
        estado: record.status || '',
        activa: activaPorEstado(record.status),
        presupuestoMes: num(pptoMes[key]),
        presupuestoMesAnterior: num(pptoAnterior[key]),
        gastoMesAnterior: previo ? gastoDe(previo.records, key) : null,
        diarioActual: num(record.dailyBudget),
        gastoMes,
        gastoPorDia: Object.assign({}, ...detalles.map(detalle => detalle.porCampana[key] || {})),
      });
    });
    // Presupuesto cargado para una campaña que el informe no trae (nueva o renombrada).
    Object.keys(pptoMes).forEach(key => {
      if (vistos.has(key) || num(pptoMes[key]) == null) return;
      vistos.add(key);
      const nombre = (opciones.nombres && opciones.nombres[key]) || key;
      campanas.push({
        campana: nombre, etiqueta: etiqueta(nombre), estado: 'Sin informe', activa: true,
        presupuestoMes: num(pptoMes[key]), presupuestoMesAnterior: num(pptoAnterior[key]),
        gastoMesAnterior: previo ? gastoDe(previo.records, key) : null, diarioActual: null, gastoMes: 0,
        gastoPorDia: Object.assign({}, ...detalles.map(detalle => detalle.porCampana[key] || {})),
      });
    });

    if (opciones.conSaldo) {
      if (!previo) {
        avisos.push({ tipo: 'sin-mes-anterior', texto: `No hay informe de ${anterior}: el gasto del mes anterior se toma como 0` });
      } else {
        const fin = `${anterior}-${String(daysInMonth(anterior)).padStart(2, '0')}`;
        const hasta = previo.period && ISO.test(String(previo.period.end)) ? previo.period.end : fin;
        if (hasta < fin) avisos.push({ tipo: 'mes-anterior-incompleto', texto: `El informe del mes anterior llega al ${ddmm(hasta)}: su gasto puede estar incompleto` });
      }
    }

    // Activas primero; dentro, de mayor a menor presupuesto.
    campanas.sort((a, b) => (b.activa - a.activa) || ((b.presupuestoMes || 0) - (a.presupuestoMes || 0)) || a.etiqueta.localeCompare(b.etiqueta));

    let totalHasta = null;
    if (actual) {
      totalHasta = actual.period && ISO.test(String(actual.period.end))
        ? actual.period.end
        : `${mes}-${String(daysInMonth(mes)).padStart(2, '0')}`;
    }

    return {
      hoy,
      conSaldo: Boolean(opciones.conSaldo),
      porDia: detalles.map(detalle => detalle.tramo),
      totalHasta,
      campanas,
      avisos,
    };
  }

  // ── Copiar / exportar ───────────────────────────────────────────────────────
  // Mismas columnas que la tabla; las del mes anterior solo con el saldo activado.
  function columnas(conSaldo) {
    const base = [
      ['campana', 'Campaña'], ['estado', 'Estado'], ['presupuestoMes', 'Ppto. mes'],
    ];
    const saldo = [
      ['presupuestoMesAnterior', 'Ppto. mes anterior'], ['gastoMesAnterior', 'Gasto mes anterior'], ['saldoMesAnterior', 'Saldo mes anterior'],
    ];
    const resto = [
      ['presupuestoEfectivo', 'Ppto. efectivo'], ['gastoAcumulado', 'Gasto acumulado al corte'], ['porGastar', 'Por gastar'],
      ['diarioActual', 'Diario actual'], ['diarioRecomendado', 'Diario recomendado'], ['diferencia', 'Diferencia'], ['alertas', 'Alertas'],
    ];
    return base.concat(conSaldo ? saldo : [], resto);
  }

  const TEXTO = new Set(['campana', 'estado', 'alertas']);

  // Las cifras van sin separador de miles y con punto: así las lee bien una hoja de cálculo.
  function filasPlanas(resultado) {
    const cols = columnas(resultado.conSaldo);
    const valor = (fila, key) => {
      if (key === 'campana') return fila.etiqueta || fila.campana;
      if (key === 'estado') return fila.agotado ? `${fila.estado} · Presupuesto agotado`.replace(/^ · /, '') : fila.estado;
      if (key === 'alertas') return (fila.alertas || []).filter(alerta => alerta.tipo !== 'agotado').map(alerta => alerta.texto).join(' | ');
      return fila[key] == null ? '' : Number(fila[key]).toFixed(2);
    };
    const cuerpo = resultado.filas.map(fila => cols.map(([key]) => valor(fila, key)));
    const total = cols.map(([key], index) => {
      if (index === 0) return 'Total';
      if (TEXTO.has(key)) return '';
      const value = resultado.totales[key];
      return value == null ? '' : Number(value).toFixed(2);
    });
    return [cols.map(([, label]) => label)].concat(cuerpo, [total]);
  }

  function encabezado(resultado, cliente) {
    return [
      ['Cliente', cliente || ''], ['Mes', resultado.mes], ['Fecha de corte', resultado.corte || ''],
      ['Días restantes', String(resultado.diasRestantes)], ['Modo', resultado.modo],
    ];
  }

  function aTsv(resultado, cliente) {
    const limpio = value => String(value).replace(/[\t\r\n]+/g, ' ');
    return encabezado(resultado, cliente).concat([[]], filasPlanas(resultado))
      .map(row => row.map(limpio).join('\t')).join('\n');
  }

  function aCsv(resultado, cliente) {
    const celda = value => {
      let text = String(value);
      // Un texto que empieza con =, +, - o @ se abriría como fórmula en Excel o Sheets.
      if (/^[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
      return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return encabezado(resultado, cliente).concat([[]], filasPlanas(resultado))
      .map(row => row.map(celda).join(',')).join('\r\n');
  }

  return {
    TOPE_DIAS, CONSUMO_MINIMO, DIAS_CONSUMO,
    recalcular, corteDe, entradaDesdeDatos, columnas, aTsv, aCsv, filasPlanas,
    clave, r2, soles, ddmm, addDays, daysInMonth, mesAnterior,
  };
});
