#!/usr/bin/env node
'use strict';
/**
 * Vigila que los informes de Google Ads de Aquarius sigan llegando al tablero.
 *
 * El 4/11/2026 Nexus no escribió ninguna hoja en todo el día (al crontab del hosting le faltaban
 * las líneas de sync-ads y sync-meta) y el tablero se quedó con la captura del 3/11 a las 18:00.
 * El barrido de Drive corrió en verde las tres veces, porque no había nada nuevo que copiar, y nadie
 * se enteró hasta el día siguiente.
 *
 * Nexus escribe las hojas de Aquarius a las 06, 13 y 18 de Lima, y cada informe llega hasta el día
 * en que se escribe: el de las 06:00 ya trae el día de hoy. Así que desde las 07:00 de Lima (la
 * franja de las 06 más una hora, para que entre el barrido de las 06:30) el informe más nuevo tiene
 * que llegar hasta hoy; antes de esa hora, hasta ayer. Esto lo mira en los dos archivos que alimenta
 * Nexus:
 *
 *   data/aquarius-lima-retail-2026.json     informe de campañas (months[].period.end)
 *   data/aquarius-palabras-clave-2026.json  palabras clave      (months[].period.end)
 *
 * Por qué el día del informe y no la hora de la hoja: el barrido solo commitea cuando cambian las
 * cifras, así que la hora de modificación que queda en el repo puede ser vieja sin que nada falle
 * (una mañana sin gasto, por ejemplo). El día del informe cambia siempre con la captura de las 06:00.
 * Lo que se pierde: si faltan solo las de 13:00 o 18:00, se nota a la mañana siguiente.
 *
 * Si hay hallazgo, manda un correo al equipo (nunca a los destinatarios del cliente) y deja la
 * corrida en rojo con el paso «Dato atrasado» del workflow. Ese rojo es la memoria: antes de
 * escribir, mira la corrida automática anterior y, si terminó en rojo en ese paso, no repite el
 * correo. Así una caída de tres días avisa una vez y no doce; cuando el dato vuelve, avisa que se
 * recuperó. Si lo que falló fue el envío (otro paso en rojo), la corrida siguiente lo reintenta.
 * El repositorio es público: por eso la memoria va en el historial de corridas y no en un issue.
 *
 * Uso:
 *   node scripts/check-nexus.js              envía de verdad (necesita GITHUB_TOKEN y SMTP/Resend)
 *   node scripts/check-nexus.js --dry-run    solo imprime el diagnóstico
 *   node scripts/check-nexus.js --probar     manda un correo de prueba aunque esté todo bien
 *
 * El de prueba existe porque el camino del envío, si no, solo se estrena el día de una caída, que
 * es el peor momento para descubrir que no sale.
 */

const fs = require('fs');
const path = require('path');
const { CONFIG, destinatariosTecnicos, enviar } = require('./lib/correo.js');

const RAIZ = path.join(__dirname, '..');
const FUENTES = [
  { nombre: 'Informe de campañas', archivo: 'data/aquarius-lima-retail-2026.json' },
  { nombre: 'Palabras clave', archivo: 'data/aquarius-palabras-clave-2026.json' },
];
const WORKFLOW = 'alerta-datos.yml';
const BARRIDO = 'sync-drive.yml';
// El paso que deja la corrida en rojo cuando el dato está atrasado. Tiene que llamarse igual que en
// .github/workflows/alerta-datos.yml: lo comprueba tests/check-nexus.test.js.
const PASO_ROJO = 'Dato atrasado';
// Solo las corridas automáticas cuentan como memoria: una manual es una simulación o una prueba.
const AUTOMATICAS = new Set(['schedule', 'workflow_run']);

const HORA = 3600000;
const LIMA = -5 * HORA;     // Lima es UTC-5 todo el año
const FRANJA = 6;           // la primera escritura del día de Nexus: 06:00 de Lima
const MARGEN_MIN = 60;      // a las 07:00 el barrido de las 06:30 ya la tuvo que traer
const BARRIDO_MAX_H = 13;   // entre barridos hay como mucho 12 h (de 18:30 a 06:30)
const DIA = /^\d{4}-\d{2}-\d{2}$/;

const fechaLima = ms => new Date(ms + LIMA).toISOString().slice(0, 10);
const horaLima = ms => new Date(ms + LIMA).toISOString().slice(0, 16).replace('T', ' ');

/** El día hasta el que tiene que llegar el informe: hoy desde las 07:00 de Lima, ayer antes. */
function diaEsperado(ahora) {
  return fechaLima(ahora - (FRANJA * 60 + MARGEN_MIN) * 60000);
}

const mesesConPeriodo = doc =>
  ((doc && doc.months) || []).filter(m => m && m.period && DIA.test(m.period.end || ''));

/** El último día que cubre el archivo: el period.end más nuevo de sus meses. */
function ultimoDia(doc) {
  const fines = mesesConPeriodo(doc).map(m => m.period.end).sort();
  return fines.length ? fines[fines.length - 1] : null;
}

/** La hora en que Nexus escribió la hoja del mes más nuevo, según el último barrido que commiteó. */
function horaDeHoja(doc) {
  const meses = mesesConPeriodo(doc).sort((a, b) => a.period.end.localeCompare(b.period.end));
  const mes = meses[meses.length - 1];
  if (!mes || !mes.driveFileId) return null;
  const hoja = ((doc.drive && doc.drive.files) || []).find(f => f && f.id === mes.driveFileId);
  const ms = Date.parse((hoja && hoja.modifiedTime) || '');
  return Number.isFinite(ms) ? ms : null;
}

/**
 * fuentes: [{ nombre, archivo, doc, error }] con los JSON ya leídos (doc null si no se pudo).
 * Devuelve { ok, esperado, hallazgos: [{ titulo, detalle }], resumen }.
 */
function revisar(fuentes, ahora) {
  const esperado = diaEsperado(ahora);
  const hallazgos = [];

  const filas = fuentes.map(({ nombre, archivo, doc, error }) => {
    if (!doc) {
      hallazgos.push({ titulo: `${nombre}: no se pudo leer`, detalle: `${archivo}: ${error || 'no está'}.` });
      return { nombre, hasta: null, hoja: null };
    }
    const hasta = ultimoDia(doc);
    const hoja = horaDeHoja(doc);
    if (!hasta) {
      hallazgos.push({
        titulo: `${nombre}: sin período`,
        detalle: `Ningún mes de ${archivo} trae period.end, así que no se sabe hasta qué día llega.`,
      });
    } else if (hasta < esperado) {
      const dias = Math.round((Date.parse(esperado) - Date.parse(hasta)) / (24 * HORA));
      hallazgos.push({
        titulo: `${nombre}: el informe no avanza`,
        detalle:
          `Llega hasta el ${hasta} y ya tendría que llegar al ${esperado} ` +
          `(${dias === 1 ? 'un día' : `${dias} días`} de atraso).` +
          (hoja ? ` La última hoja de Nexus que entró al tablero es del ${horaLima(hoja)} de Lima.` : ''),
      });
    }
    return { nombre, hasta, hoja };
  });

  const etiqueta = 'Tiene que llegar';
  const ancho = Math.max(etiqueta.length, ...filas.map(f => f.nombre.length));
  const resumen = [
    ...filas.map(f =>
      `${f.nombre.padEnd(ancho)} : hasta el ${f.hasta || '—'}` +
      (f.hoja ? ` · hoja de Nexus del ${horaLima(f.hoja)}` : ''),
    ),
    `${etiqueta.padEnd(ancho)} : al ${esperado} (son las ${horaLima(ahora)} de Lima)`,
  ].join('\n');

  return { ok: hallazgos.length === 0, esperado, hallazgos, resumen };
}

/**
 * Dónde mirar, según el último barrido de Drive: { donde: 'nexus' | 'barrido' | 'nexus-o-barrido', texto }.
 * barrido: { creado (ms), conclusion, url } o null si no se pudo consultar.
 */
function causaProbable(barrido, ahora) {
  if (!barrido) {
    return {
      donde: 'nexus-o-barrido',
      texto:
        'No se pudo ver el último barrido de Drive. Puede ser Nexus (el cron del hosting no escribió las ' +
        'hojas) o el barrido (los activadores del Apps Script no lo lanzaron).',
    };
  }
  const cuando = horaLima(barrido.creado);
  if (ahora - barrido.creado > BARRIDO_MAX_H * HORA) {
    return {
      donde: 'barrido',
      texto:
        `El barrido de Drive no corre desde el ${cuando} de Lima. Revisar los activadores de ` +
        'scripts/apps-script/sincronizar-aquarius.gs y que su token de GitHub no haya vencido.',
    };
  }
  if (barrido.conclusion !== 'success') {
    return {
      donde: 'barrido',
      texto: `El último barrido de Drive (${cuando} de Lima) terminó en «${barrido.conclusion}». Mirar esa corrida en Actions.`,
    };
  }
  return {
    donde: 'nexus',
    texto:
      `El barrido de Drive corre bien (el último, ${cuando} de Lima) pero no trae informes nuevos: ` +
      'Nexus no está escribiendo las hojas. Suele ser el cron del hosting.',
  };
}

// ── GitHub: el último barrido y cómo terminó la corrida anterior (la memoria) ─────────────────────
function clienteGithub(env = process.env) {
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPOSITORY;
  if (!token || !repo) return null;
  return async ruta => {
    const res = await fetch(`https://api.github.com/repos/${repo}${ruta}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub ${res.status} en ${ruta}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  };
}

async function ultimoBarrido(gh) {
  const datos = await gh(`/actions/workflows/${BARRIDO}/runs?status=completed&per_page=1`);
  const corrida = ((datos && datos.workflow_runs) || [])[0];
  if (!corrida) return null;
  const creado = Date.parse(corrida.run_started_at || corrida.created_at || '');
  return Number.isFinite(creado) ? { creado, conclusion: corrida.conclusion, url: corrida.html_url } : null;
}

/**
 * true si hay una caída avisada y todavía abierta: la última corrida automática que decidió algo
 * terminó en rojo en el paso PASO_ROJO. Una en verde la cierra (o nunca hubo caída).
 *
 * Las que fallaron en otro paso (el envío o la API de GitHub) o se cancelaron no deciden nada: el
 * correo que intentaron no salió. Se saltan y se mira la anterior, así se reintenta tanto el aviso
 * de caída como el de vuelta. Si el de vuelta falla, la caída sigue abierta hasta que salga.
 */
async function yaAvisado(gh, propio) {
  const datos = await gh(`/actions/workflows/${WORKFLOW}/runs?status=completed&per_page=20`);
  const corridas = ((datos && datos.workflow_runs) || []).filter(
    r => String(r.id) !== String(propio || '') && AUTOMATICAS.has(r.event),
  );
  for (const corrida of corridas) {
    if (corrida.conclusion === 'success') return false;
    if (corrida.conclusion !== 'failure') continue;
    const trabajos = await gh(`/actions/runs/${corrida.id}/jobs`);
    const marcada = ((trabajos && trabajos.jobs) || []).some(trabajo =>
      (trabajo.steps || []).some(paso => paso.name === PASO_ROJO && paso.conclusion === 'failure'),
    );
    if (marcada) return true;
  }
  return false;
}

// ── Correo ────────────────────────────────────────────────────────────────────────────────────────
const AZUL = '#2563eb';
const esc = texto =>
  String(texto).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const envoltura = (titulo, color, cuerpo) => `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f1f5f9;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    <div style="background:${color};color:#fff;padding:16px 20px;font-size:16px;font-weight:600">${esc(titulo)}</div>
    <div style="padding:20px;color:#0f172a;font-size:14px;line-height:1.6">${cuerpo}</div>
    <div style="padding:14px 20px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px">
      ${esc(CONFIG.workspace)} · aviso técnico, solo para el equipo ·
      <a href="${esc(CONFIG.url_dashboard)}" style="color:${AZUL}">abrir el tablero</a>
    </div>
  </div>
</div>`;

const bloqueResumen = informe =>
  `<pre style="background:#f8fafc;padding:12px;border-radius:8px;font-size:12px;color:#334155;white-space:pre-wrap">${esc(informe.resumen)}</pre>`;

const COMANDOS_NEXUS = `
  <p style="margin-top:18px;padding:12px;background:#f8fafc;border-left:3px solid ${AZUL};color:#334155">
    En la Terminal de cPanel, que esté la línea de <code>sync-ads</code> en el crontab y qué dice su log:<br>
    <code style="font-size:12px">crontab -l | grep -iE 'ads|meta|gasto'</code><br>
    <code style="font-size:12px">tail -n 20 ~/apps/nexus/storage/sync/cron.log</code>
  </p>`;

function correoFalla(informe, causa) {
  const donde = causa || causaProbable(null, Date.now());
  return envoltura(
    'Los informes de Google Ads de Aquarius dejaron de actualizarse',
    '#b91c1c',
    `<p>El tablero de Aquarius sigue mostrando cifras, pero son las de la última captura que entró. Las nuevas no llegaron.</p>
     ${informe.hallazgos.map(h => `<p><strong>${esc(h.titulo)}.</strong> ${esc(h.detalle)}</p>`).join('')}
     <p><strong>Dónde mirar.</strong> ${esc(donde.texto)}</p>
     ${donde.donde === 'barrido' ? '' : COMANDOS_NEXUS}
     ${bloqueResumen(informe)}
     <p style="color:#64748b;font-size:13px">No se repite este correo mientras el problema siga abierto. Cuando el dato vuelva, te aviso.</p>`,
  );
}

const correoVuelta = informe =>
  envoltura(
    'Los informes de Google Ads de Aquarius volvieron a actualizarse',
    '#15803d',
    `<p>Ya está entrando el dato otra vez.</p>${bloqueResumen(informe)}`,
  );

const correoPrueba = informe =>
  envoltura(
    'Prueba del aviso de datos de Aquarius',
    AZUL,
    `<p>Si te llegó este correo, el aviso de datos atrasados puede escribirte. Así están hoy los informes:</p>
     ${bloqueResumen(informe)}`,
  );

// ── Principal ─────────────────────────────────────────────────────────────────────────────────────
function leer({ nombre, archivo }) {
  try {
    return { nombre, archivo, doc: JSON.parse(fs.readFileSync(path.join(RAIZ, archivo), 'utf8')) };
  } catch (err) {
    return { nombre, archivo, doc: null, error: err.code === 'ENOENT' ? 'no existe' : err.message };
  }
}

/** Deja la salida atrasado=true para que el paso PASO_ROJO del workflow ponga la corrida en rojo. */
function marcarAtrasado(env) {
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, 'atrasado=true\n');
  else console.warn('::warning::Sin GITHUB_OUTPUT: la corrida no queda marcada y el correo podría repetirse.');
}

async function principal(argv = process.argv, env = process.env) {
  const ahora = Date.now();
  const informe = revisar(FUENTES.map(leer), ahora);

  console.log(informe.ok ? '✅ Los informes de Google Ads están al día\n' : '🔴 Los informes de Google Ads están atrasados\n');
  console.log(informe.resumen + '\n');
  informe.hallazgos.forEach(h => console.log(`  · ${h.titulo}: ${h.detalle}`));

  const gh = clienteGithub(env);
  let causa = null;
  if (!informe.ok) {
    const barrido = gh
      ? await ultimoBarrido(gh).catch(err => {
          console.warn(`::warning::No se pudo leer el último barrido de Drive (${err.message}).`);
          return null;
        })
      : null;
    causa = causaProbable(barrido, ahora);
    console.log(`\n  Dónde mirar: ${causa.texto}`);
  }

  // Sin token no se puede saber si el correo ya salió, y repetirlo en cada barrido es peor que no
  // mandarlo: fuera de GitHub Actions esto solo diagnostica.
  const simulacro = argv.includes('--dry-run') || env.DRY_RUN === 'true' || !gh;
  if (simulacro) {
    if (!informe.ok) console.log('::warning::Los informes están atrasados (simulación: no se envía correo).');
    console.log('\n[simulación] No se envía correo.');
    return;
  }

  const para = destinatariosTecnicos(env);

  if (argv.includes('--probar') || env.PROBAR_ENVIO === 'true') {
    const detalle = await enviar({ para, asunto: '🔔 Aquarius · prueba del aviso de datos', html: correoPrueba(informe) });
    console.log(`\nCorreo de prueba enviado a ${para.join(', ')} por ${detalle}.`);
    return;
  }

  const avisado = await yaAvisado(gh, env.GITHUB_RUN_ID);

  if (informe.ok) {
    if (!avisado) return;
    const detalle = await enviar({
      para,
      asunto: '✅ Aquarius · los informes de Google Ads volvieron a actualizarse',
      html: correoVuelta(informe),
    });
    console.log(`\nAvisado que se recuperó, a ${para.join(', ')} por ${detalle}.`);
    return;
  }

  if (avisado) {
    console.log(`\nLa corrida anterior ya terminó en «${PASO_ROJO}»: el correo ya salió y no se repite.`);
  } else {
    const detalle = await enviar({
      para,
      asunto: '🔴 Aquarius · los informes de Google Ads dejaron de actualizarse',
      html: correoFalla(informe, causa),
    });
    console.log(`\nCorreo enviado a ${para.join(', ')} por ${detalle}.`);
  }

  // Solo después de enviar: si el envío falla, este paso queda en rojo y no el de PASO_ROJO, y la
  // corrida siguiente vuelve a intentarlo.
  marcarAtrasado(env);
}

if (require.main === module) {
  principal().catch(err => {
    console.error('\n❌ ' + err.message);
    process.exit(1);
  });
}

module.exports = {
  FUENTES,
  PASO_ROJO,
  WORKFLOW,
  diaEsperado,
  ultimoDia,
  horaDeHoja,
  revisar,
  causaProbable,
  ultimoBarrido,
  yaAvisado,
  correoFalla,
  correoVuelta,
  correoPrueba,
  principal,
};
