/* ============================================================
   alertas-core.js — estado del mes de Google Ads y los avisos que salen de el.

   Lo usan el panel de Notificaciones del tablero (js/notificaciones.js) y el
   correo de alertas (scripts/alertas.js): el aviso que se ve en el tablero y el
   que llega por correo salen del mismo calculo.

   El mes es el ultimo con inversion. El corte es el fin del rango del informe,
   nunca despues de hoy en Lima (igual que monthCutoff de objectives.js). El
   ritmo diario es el acumulado entre los dias con datos y el cierre proyectado
   es ese ritmo por los dias del mes, el mismo metodo del modulo Proyecciones.
   La referencia del mes son dos cosas: el presupuesto de Google Ads (el diario
   de las campanas por los dias del mes) y el mes anterior, llevado a mes
   completo cuando su informe quedo a medias.

   Expone window.AquariusAlertas en el navegador y module.exports en Node.
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AquariusAlertas = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const MARCA = 'Aquarius';
  // Cada marca nombra distinto el resultado de la cuenta (Aquarius dice conversaciones).
  const VOCAB = { conv: 'conversaciones', conv1: 'conversación', convCap: 'Conversaciones' };
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
    'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const ABR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];

  // Umbrales del semaforo, sobre el cierre proyectado (en %).
  const LIMITES = {
    convAmbar: 95, convRojo: 80,      // conversaciones proyectadas vs el mes anterior
    gastoAmbar: 105, gastoRojo: 115,  // gasto proyectado vs el presupuesto del mes
    gastoFlojo: 80,                   // presupuesto que va a quedar sin usar
    cpaAmbar: 110, cpaRojo: 130,      // costo por conversacion proyectado vs el mes anterior
  };
  const NIVEL_LABEL = { verde: 'En track', ambar: 'Atencion', rojo: 'Riesgo', gris: 'Sin referencia' };

  // ── Ciclo Mensual de Analisis y Optimizacion ──────────────────────────────
  // Las reglas de la marca (data/reglas.json) dicen en que parte del mes vamos. El hito no cambia
  // ningun numero: cambia el orden en que se leen los avisos, que es el orden en que conviene
  // mirarlos esa semana. Sin reglas sincronizadas no hay hito y los avisos salen como siempre.
  //
  // Lo que se le dice al cliente lo pone CONTEXTO_HITO, no la hoja: la instruccion estrategica de
  // la hoja esta escrita para la agencia (habla del cliente en tercera persona) y se queda en LR
  // Suite. Aca solo entra la accion, que es la que dice que toca mirar.
  const CONTEXTO_HITO = {
    alerta_pacing: 'Arranca el mes: se fija el ritmo de inversion y se proyecta en cuanto va a cerrar.',
    pausar_fatigados: 'Toca mirar las piezas: cuales siguen trayendo resultados y cuales ya se agotaron.',
    alerta_overlap: 'Toca mirar a quien le estamos hablando y abrir la segmentacion si el volumen se estanco.',
    escalar_presupuesto: 'Ultima semana: exprimir lo que queda del presupuesto y medir el mes contra lo proyectado.',
  };

  // Que aviso conviene leer primero en cada hito. Los que no se nombran van despues, en su orden de
  // siempre: el hito prioriza, no esconde.
  const ORDEN_HITO = {
    alerta_pacing: ['gasto', 'conversiones', 'cpa'],
    pausar_fatigados: ['secas', 'lider', 'cpa'],
    alerta_overlap: ['lider', 'secas', 'conversiones'],
    escalar_presupuesto: ['gasto', 'lider', 'conversiones'],
  };

  const OPERADORES = {
    '<': (left, right) => left < right,
    '<=': (left, right) => left <= right,
    '==': (left, right) => left === right,
    '>=': (left, right) => left >= right,
    '>': (left, right) => left > right,
    '!=': (left, right) => left !== right,
  };

  const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const isNum = value => Number.isFinite(Number(value));
  const money = value => `S/. ${num(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const moneyCorto = value => `S/. ${Math.round(num(value)).toLocaleString('es-PE')}`;
  const count = value => num(value).toLocaleString('es-PE', { maximumFractionDigits: 0 });
  const decimal = value => num(value).toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pctTxt = value => `${Math.round(num(value))}%`;
  const signedPct = value => `${num(value) >= 0 ? '+' : '-'}${Math.abs(Math.round(num(value)))}%`;
  const corta = iso => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? `${Number(String(iso).slice(8, 10))} ${ABR[Number(String(iso).slice(5, 7)) - 1]}` : '');
  const sum = (rows, field) => rows.reduce((total, row) => total + num(row[field]), 0);

  const mesAnterior = id => {
    const [year, month] = String(id).split('-').map(Number);
    return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  };

  // Hoy en Lima (UTC-5 todo el ano).
  const hoyLima = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);

  // El operador se compara tal como esta escrito en la hoja: una celda con «mayor que» en lugar de
  // «>» deja la regla sin aplicar, que es mejor que adivinar que se quiso decir.
  function cumple(regla, dia) {
    if (!regla || regla.metrica !== 'dias_mes') return false;
    const comparar = OPERADORES[String(regla.operador || '').trim()];
    const valor = Number(regla.valor);
    return Boolean(comparar) && Number.isFinite(valor) && comparar(dia, valor);
  }

  // Los hitos se evaluan en el orden de la hoja y gana el primero que cumple: con «<= 7», «<= 14»,
  // «<= 21» y «> 21», el dia 10 cae en el segundo y solo en el segundo. La semana sale de la
  // posicion en la hoja y no del dia, para que siga siendo la correcta en una marca que movio su
  // corte.
  function hitoDe(reglas, dia) {
    const lista = Array.isArray(reglas) ? reglas : ((reglas && reglas.reglas) || []);
    const indice = lista.findIndex(regla => cumple(regla, dia));
    return indice === -1 ? null : Object.assign({}, lista[indice], { semana: indice + 1 });
  }

  // Meses con inversion, en orden, normalizados a un solo formato para los avisos y el correo.
  function meses(data) {
    const hoy = hoyLima();
    return (((data && data.months) || []))
      .filter(month => /^\d{4}-\d{2}$/.test(String(month.id)))
      .map(month => {
        const registros = Array.isArray(month.records) ? month.records : [];
        const totales = month.totals || {};
        const pick = (field, fallback) => (isNum(totales[field]) ? num(totales[field]) : fallback);
        const [year, number] = String(month.id).split('-').map(Number);
        const diasMes = new Date(Date.UTC(year, number, 0)).getUTCDate();
        const fin = month.period && /^\d{4}-\d{2}-\d{2}$/.test(String(month.period.end))
          ? String(month.period.end)
          : `${month.id}-${String(diasMes).padStart(2, '0')}`;
        const corte = hoy < fin ? hoy : fin;
        const dias = corte.slice(0, 7) === month.id
          ? Math.min(diasMes, Math.max(1, Number(corte.slice(8, 10))))
          : diasMes;
        const presupuestoDiario = isNum(month.dailyBudget) ? num(month.dailyBudget) : null;
        return {
          id: month.id,
          label: `${MESES[number - 1]} ${year}`,
          nombre: MESES[number - 1],
          year,
          dias,
          diasMes,
          cerrado: dias >= diasMes,
          corte,
          gasto: pick('cost', sum(registros, 'cost')),
          conversiones: pick('conversions', sum(registros, 'conversions')),
          clics: pick('clicks', sum(registros, 'clicks')),
          impresiones: pick('impressions', sum(registros, 'impressions')),
          // Google Ads fija presupuestos diarios: el del mes es el diario vigente por los dias del mes.
          presupuesto: presupuestoDiario ? presupuestoDiario * diasMes : null,
          presupuestoDiario,
          campanas: registros.map(record => ({
            nombre: record.campaign,
            gasto: num(record.cost),
            conversiones: num(record.conversions),
            clics: num(record.clicks),
            estado: record.status || '',
            presupuestoDiario: isNum(record.dailyBudget) ? num(record.dailyBudget) : null,
          })).sort((a, b) => b.gasto - a.gasto),
        };
      })
      .filter(month => month.gasto > 0);
  }

  // Un mes incompleto se lleva a mes completo con su propio ritmo, para comparar meses enteros.
  function cierreDe(mes) {
    if (!mes) return null;
    const factor = mes.cerrado ? 1 : mes.diasMes / mes.dias;
    return {
      gasto: mes.gasto * factor,
      conversiones: mes.conversiones * factor,
      estimado: !mes.cerrado,
      cpa: mes.conversiones > 0 ? mes.gasto / mes.conversiones : null,
    };
  }

  // Estado del ultimo mes con inversion: ritmo, cierre proyectado y como queda frente a sus referencias.
  function estado(data, reglas) {
    const lista = meses(data);
    if (!lista.length) return null;
    const mes = lista[lista.length - 1];
    const previo = lista.slice(0, -1).reverse().find(item => item.id === mesAnterior(mes.id))
      || lista[lista.length - 2] || null;
    const previoCierre = cierreDe(previo);

    const proyectar = valor => (mes.cerrado ? valor : (valor / mes.dias) * mes.diasMes);
    const gasto = { real: mes.gasto, ritmo: mes.gasto / mes.dias, cierre: proyectar(mes.gasto) };
    const conv = { real: mes.conversiones, ritmo: mes.conversiones / mes.dias, cierre: proyectar(mes.conversiones) };
    const cpa = {
      real: conv.real > 0 ? gasto.real / conv.real : null,
      cierre: conv.cierre > 0 ? gasto.cierre / conv.cierre : null,
      previo: previoCierre && previoCierre.conversiones > 0 ? previoCierre.gasto / previoCierre.conversiones : null,
    };
    const diasRest = Math.max(0, mes.diasMes - mes.dias);

    const gastoPct = mes.presupuesto ? (gasto.cierre / mes.presupuesto) * 100 : null;
    const convPct = previoCierre && previoCierre.conversiones > 0 ? (conv.cierre / previoCierre.conversiones) * 100 : null;
    const cpaPct = cpa.previo && cpa.cierre ? (cpa.cierre / cpa.previo) * 100 : null;

    // El semaforo mira las tres referencias y se queda con la peor; sin ninguna, no opina.
    let nivel = 'gris';
    if (convPct != null || gastoPct != null || cpaPct != null) {
      const rojo = (convPct != null && convPct < LIMITES.convRojo)
        || (gastoPct != null && gastoPct > LIMITES.gastoRojo)
        || (cpaPct != null && cpaPct > LIMITES.cpaRojo);
      const ambar = (convPct != null && convPct < LIMITES.convAmbar)
        || (gastoPct != null && (gastoPct > LIMITES.gastoAmbar || gastoPct < LIMITES.gastoFlojo))
        || (cpaPct != null && cpaPct > LIMITES.cpaAmbar);
      nivel = rojo ? 'rojo' : ambar ? 'ambar' : 'verde';
    }

    return {
      marca: MARCA, vocab: VOCAB, mes, previo, previoCierre, meses: lista,
      gasto, conv, cpa, diasRest, nivel, nivelLabel: NIVEL_LABEL[nivel],
      presupuesto: mes.presupuesto, gastoPct, convPct, cpaPct,
      corteLabel: corta(mes.corte) || `dia ${mes.dias}`,
      // El hito se mide con el dia que cubre el informe, no con la fecha de quien mira: un mes
      // cerrado se lee con su ultimo dia, que es el final del ciclo.
      hito: hitoDe(reglas, mes.dias),
    };
  }

  // Avisos del mes, en orden de importancia. tone: red, amber, green o blue.
  function avisos(e) {
    if (!e) return [];
    const items = [];
    const { mes, previo, previoCierre, gasto, conv, cpa, diasRest } = e;
    const V = VOCAB;
    const tono = (pct, ambar, rojo) => (pct > rojo ? 'red' : pct > ambar ? 'amber' : 'green');

    // 1. Gasto proyectado frente al presupuesto del mes.
    if (e.presupuesto) {
      const sobra = e.presupuesto - gasto.cierre;
      items.push({
        id: 'gasto',
        tone: e.gastoPct > LIMITES.gastoRojo ? 'red'
          : e.gastoPct > LIMITES.gastoAmbar || e.gastoPct < LIMITES.gastoFlojo ? 'amber' : 'green',
        titulo: sobra >= 0
          ? `El mes cierra en ${moneyCorto(gasto.cierre)}: ${moneyCorto(sobra)} del presupuesto sin usar`
          : `El mes cierra en ${moneyCorto(gasto.cierre)}: ${moneyCorto(-sobra)} sobre el presupuesto`,
        lineas: [
          `Invertido ${money(gasto.real)} de ${moneyCorto(e.presupuesto)} al ${e.corteLabel} (dia ${mes.dias} de ${mes.diasMes}) · ritmo ${money(gasto.ritmo)} por dia`,
          diasRest > 0
            ? `Para cerrar justo en el presupuesto quedan ${money(Math.max(0, e.presupuesto - gasto.real) / diasRest)} por dia en los ${diasRest} dias que faltan.`
            : 'Mes cerrado: es el gasto final del informe.',
        ],
        badge: { valor: pctTxt(e.gastoPct), etiqueta: 'del presupuesto' },
        vista: 'view-projections',
      });
    }

    // 2. Conversaciones proyectadas frente al mes anterior.
    if (e.convPct != null) {
      const delta = e.convPct - 100;
      items.push({
        id: 'conversiones',
        tone: e.convPct < LIMITES.convRojo ? 'red' : e.convPct < LIMITES.convAmbar ? 'amber' : 'green',
        titulo: `${V.convCap} al cierre: ${count(Math.round(conv.cierre))} · ${signedPct(delta)} vs ${previo.nombre.toLowerCase()}`,
        lineas: [
          `${count(Math.round(conv.real))} ${V.conv} al ${e.corteLabel} a un ritmo de ${decimal(conv.ritmo)} por dia; ${previo.nombre} cerro en ${count(Math.round(previoCierre.conversiones))}${previoCierre.estimado ? ' (informe a medias, llevado a mes completo)' : ''}.`,
          diasRest > 0 && e.convPct < 100
            ? `Igualar ${previo.nombre.toLowerCase()} pide ${decimal(Math.max(0, previoCierre.conversiones - conv.real) / diasRest)} ${V.conv} por dia en los ${diasRest} dias que faltan.`
            : '',
        ],
        badge: { valor: signedPct(delta), etiqueta: `vs ${previo.nombre.slice(0, 3).toLowerCase()}.` },
        vista: 'view-projections',
      });
    }

    // 3. Costo por conversacion proyectado frente al mes anterior.
    if (e.cpaPct != null) {
      const delta = e.cpaPct - 100;
      items.push({
        id: 'cpa',
        tone: tono(e.cpaPct, LIMITES.cpaAmbar, LIMITES.cpaRojo),
        titulo: `Cada ${V.conv1} sale ${pctTxt(Math.abs(delta))} ${delta >= 0 ? 'más cara' : 'más barata'} que en ${previo.nombre.toLowerCase()}`,
        lineas: [`${money(cpa.cierre)} proyectado al cierre contra ${money(cpa.previo)} de ${previo.nombre}.`],
        badge: { valor: signedPct(delta), etiqueta: `costo x ${V.conv1}` },
        vista: 'view-projections',
      });
    }

    // 4. Campanas que gastan y no traen nada.
    const secas = mes.campanas.filter(c => c.gasto > 0 && c.conversiones === 0);
    if (secas.length) {
      const perdido = secas.reduce((total, c) => total + c.gasto, 0);
      items.push({
        id: 'secas',
        tone: perdido > gasto.real * 0.2 ? 'red' : 'amber',
        titulo: secas.length === 1
          ? `${secas[0].nombre} gasta sin ${V.conv}`
          : `${secas.length} campañas gastan sin ${V.conv}`,
        lineas: [
          secas.slice(0, 4).map(c => `${c.nombre}: ${money(c.gasto)}`).join(' · '),
          `${moneyCorto(perdido)} del mes (${pctTxt(gasto.real > 0 ? (perdido / gasto.real) * 100 : 0)} de la inversion) todavia no trae ${V.conv}.`,
        ],
        badge: { valor: moneyCorto(perdido), etiqueta: `sin ${V.conv}` },
        vista: 'view-obj',
      });
    }

    // 5. La campana que sostiene el mes.
    const lider = mes.campanas.filter(c => c.conversiones > 0).sort((a, b) => b.conversiones - a.conversiones)[0];
    if (lider && conv.real > 0) {
      const parte = (lider.conversiones / conv.real) * 100;
      items.push({
        id: 'lider',
        tone: 'blue',
        titulo: `${lider.nombre} trae ${pctTxt(parte)} de las ${V.conv} del mes`,
        lineas: [`${count(Math.round(lider.conversiones))} de ${count(Math.round(conv.real))} ${V.conv} con ${money(lider.gasto)} invertidos, a ${money(lider.gasto / lider.conversiones)} cada una.`],
        badge: { valor: count(Math.round(lider.conversiones)), etiqueta: V.conv },
        vista: 'view-obj',
      });
    }

    // Sin reglas sincronizadas los avisos salen como siempre: el tablero del cliente no explica
    // que falta configurar, porque eso es cosa de la agencia.
    if (!e.hito) return items;

    // El hito ordena: primero lo que toca mirar esta semana y despues el resto, cada uno en su
    // orden de siempre. Ningun aviso se esconde: un gasto disparado se sigue viendo en la semana
    // de las creatividades, solo que mas abajo.
    const orden = ORDEN_HITO[e.hito.accion] || [];
    const peso = id => {
      const puesto = orden.indexOf(id);
      return puesto === -1 ? orden.length : puesto;
    };
    const ordenados = items
      .map((item, entrada) => ({ item, entrada }))
      .sort((a, b) => peso(a.item.id) - peso(b.item.id) || a.entrada - b.entrada)
      .map(entry => entry.item);

    // Una accion que este modulo no conoce ordena igual (por su orden de siempre) pero no encabeza
    // con una linea inventada.
    const contexto = CONTEXTO_HITO[e.hito.accion];
    if (!contexto) return ordenados;

    return [{
      id: 'hito',
      tone: 'blue',
      titulo: `Semana ${e.hito.semana} del mes`,
      lineas: [contexto],
      badge: { valor: `dia ${mes.dias}`, etiqueta: `de ${mes.diasMes}` },
      vista: 'view-projections',
    }].concat(ordenados);
  }

  return {
    MARCA, VOCAB, MESES, ABR, LIMITES, NIVEL_LABEL, CONTEXTO_HITO, ORDEN_HITO,
    meses, estado, avisos, cierreDe, mesAnterior, hoyLima, hitoDe, cumple,
    money, moneyCorto, count, decimal, pctTxt, signedPct, corta,
  };
});
