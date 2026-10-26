#!/usr/bin/env node
/* ============================================================
   scripts/alertas.js — Alerta de Google Ads de Aquarius.

   Sale los lunes a las 6:00 p. m. de Lima (ALERTA_MOTIVO=lunes, una vez por semana) y cada vez que
   entran datos nuevos al repositorio (ALERTA_MOTIVO=datos: solo si cambiaron las cifras del mes
   frente al ultimo envio).

   Lee:
     data/aquarius-lima-retail-2026.json  → informes de Google Ads (campanas, meses, presupuesto
                                            diario); es el mismo archivo que publica el tablero, asi
                                            que el correo y la pagina muestran los mismos numeros
     data/alertas-config.json             → remitente y destinatarios por defecto
     Destinatarios: los que se configuran con la ruedita de Notificaciones del tablero (Web App de
     scripts/apps-script/alertas-destinatarios.gs, por AQ_ALERTAS_URL y AQ_ALERTAS_TOKEN); si no esta
     conectado o todavia no se guardo una lista, los de alertas-config.json.

   El estado del mes y los avisos salen de js/alertas-core.js, el mismo modulo que pinta el panel de
   Notificaciones del tablero.

   Envia email HTML por el correo del hosting (SMTP) o, si no esta configurado, por Resend.
   Registra el envio en data/alertas-envios.json (idempotencia).

   Uso:
     node scripts/alertas.js             # envio real
     node scripts/alertas.js --dry-run   # simula sin enviar
     node scripts/alertas.js --force     # ignora idempotencia (reenvia)
     node scripts/alertas.js --preview correo.html   # escribe el correo en un archivo, sin enviar

   Variables de entorno para el envio real (una de las dos opciones):
     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS → cuenta de correo del hosting (alertas@limaretail.com)
     RESEND_API_KEY   → API key de Resend
   Variables opcionales:
     DRY_RUN=true     → equivale a --dry-run (para GitHub Actions)
     ALERTA_MOTIVO    → lunes | datos | manual (por defecto, manual: como el lunes)
     AQ_ALERTAS_URL, AQ_ALERTAS_TOKEN → lista de destinatarios del tablero
     DASHBOARD_URL    → enlace del correo, si debe ser otro que el de alertas-config.json
   ============================================================ */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const Core = require('../js/alertas-core.js');

const ROOT    = path.join(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';
const FORCE   = process.argv.includes('--force');
// --preview archivo.html: escribe el correo en ese archivo y termina, sin enviar ni registrar.
const PREVIEW = process.argv.includes('--preview') ? process.argv[process.argv.indexOf('--preview') + 1] : null;
const MOTIVO  = ['lunes', 'datos'].includes(process.env.ALERTA_MOTIVO) ? process.env.ALERTA_MOTIVO : 'manual';

const DATA_FILE = 'data/aquarius-lima-retail-2026.json';
const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// Lima = UTC-5 sin DST. Se trabaja en UTC y se restan 5 horas.
const limaDate = () => new Date(Date.now() - 5 * 3600 * 1000);

// Semana ISO 8601 — ej. "2026-W43"
function isoWeek(d) {
  const date   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ── Cargar archivos ──────────────────────────────────────────
// El barrido de Drive (scripts/sync-drive.py) deja la data en el repositorio: el correo lee el mismo
// archivo que se publica en el tablero.
const data = readJson(DATA_FILE);
const fuente = `${DATA_FILE}${data.drive && data.drive.lastSync ? ` (barrido ${String(data.drive.lastSync).slice(0, 10)})` : ''}`;
const config = readJson('data/alertas-config.json');
// Las reglas del Ciclo Mensual ordenan los avisos igual que en el tablero: el correo y el panel
// dicen lo mismo y en el mismo orden. Si el archivo no esta, los avisos salen sin ordenar por hito.
let reglas = null;
try {
  reglas = readJson('data/reglas.json');
} catch (error) {
  console.warn(`  Reglas     : sin data/reglas.json (${error.code || error.message})`);
}
// URL del tablero: la variable DASHBOARD_URL del repo, si existe, manda sobre el JSON.
if (process.env.DASHBOARD_URL) config.url_dashboard = process.env.DASHBOARD_URL;
const enviosPath = path.join(ROOT, 'data/alertas-envios.json');
const enviosData = readJson('data/alertas-envios.json');

const lima    = limaDate();
const weekKey = isoWeek(lima);
const fechaLabel = lima.toLocaleDateString('es-PE', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
});

const e = Core.estado(data, reglas);
console.log(`\n▶ Alerta de Google Ads ${weekKey}${DRY_RUN ? ' [DRY-RUN]' : ''}`);
console.log(`  Fecha Lima : ${fechaLabel}`);
console.log(`  Datos      : ${fuente}`);
if (!e) {
  console.log('\n⏭  Todavia no hay un mes con inversion en los informes: no hay alerta que enviar.\n');
  process.exit(0);
}
const { mes, previo, previoCierre, gasto, conv, cpa, diasRest } = e;
const V = Core.VOCAB;
console.log(`  Mes        : ${mes.label} · datos al ${e.corteLabel} (dia ${mes.dias} de ${mes.diasMes})`);

// ── Idempotencia ─────────────────────────────────────────────
// Huella de las cifras del mes: el repositorio se reescribe en cada barrido de Drive, asi que lo que
// cuenta es si cambiaron los numeros.
const huella = crypto.createHash('sha256').update(JSON.stringify({
  id: mes.id, dias: mes.dias, gasto: mes.gasto, conversiones: mes.conversiones,
  campanas: mes.campanas.map(c => [c.nombre, c.gasto, c.conversiones]),
})).digest('hex').slice(0, 16);
console.log(`  Motivo     : ${MOTIVO}`);
if (!FORCE && !DRY_RUN && !PREVIEW) {
  if (MOTIVO === 'datos' && enviosData.ultimaHuella === huella) {
    console.log('\n⏭  Las cifras del mes no cambiaron desde el ultimo envio: no hay alerta que mandar.\n');
    process.exit(0);
  }
  if (MOTIVO !== 'datos' && enviosData.enviados[weekKey]) {
    console.log(`\n⏭  Semana ${weekKey} ya registrada (${enviosData.enviados[weekKey]}).`);
    console.log('   Usa --force para reenviar.\n');
    process.exit(0);
  }
}

// ── Log de métricas ──────────────────────────────────────────
const avisos = Core.avisos(e);
console.log(`\n📊 ${mes.label}:`);
console.log(`   Invertido   : ${Core.money(gasto.real)}${e.presupuesto ? ` de ${Core.moneyCorto(e.presupuesto)}` : ''}`);
console.log(`   Cierre      : ${Core.money(gasto.cierre)}${e.gastoPct != null ? ` (${Core.pctTxt(e.gastoPct)} del presupuesto)` : ''}`);
console.log(`   ${V.convCap.padEnd(12)}: ${Core.count(Math.round(conv.real))} → cierre ${Core.count(Math.round(conv.cierre))}${e.convPct != null ? ` (${Core.signedPct(e.convPct - 100)} vs ${previo.nombre})` : ''}`);
console.log(`   Costo x ${V.conv1}: ${cpa.cierre ? Core.money(cpa.cierre) : '—'}${e.cpaPct != null ? ` (${Core.signedPct(e.cpaPct - 100)})` : ''}`);
console.log(`   Nivel       : ${e.nivelLabel}`);
avisos.forEach(a => console.log(`   · [${a.tone}] ${a.titulo}`));

// ── Helpers HTML ─────────────────────────────────────────────
// El correo usa la estetica del tablero: fondo #f6fbff, tarjetas blancas con borde #dbeafe y radio
// 12px, Inter, etiquetas en mayusculas espaciadas, pildoras verde / ambar / roja y el azul de la
// marca. Todo va en tablas y estilos en linea para que Gmail y Outlook lo respeten.
const MARCA = Core.MARCA;
const LOGO  = new URL('assets/aquarius-isotipo.png', config.url_dashboard).href;
const C = {
  bg: '#f6fbff', card: '#ffffff', border: '#dbeafe', head: '#f8fafc',
  text: '#0f172a', text2: '#52647d', muted: '#94a3b8', brand: '#2563eb', track: '#e2e8f0',
};
const FONT = "Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const TONO = {
  verde: { fg: '#047857', bg: '#d1fae5', bd: '#a7f3d0', val: '#059669', box: '#ecfdf5' },
  ambar: { fg: '#b45309', bg: '#fef3c7', bd: '#fde68a', val: '#d97706', box: '#fffbeb' },
  rojo:  { fg: '#b91c1c', bg: '#fee2e2', bd: '#fecaca', val: '#dc2626', box: '#fef2f2' },
  azul:  { fg: '#1d4ed8', bg: '#dbeafe', bd: '#bfdbfe', val: '#2563eb', box: '#eff6ff' },
  gris:  { fg: '#52647d', bg: '#f1f5f9', bd: '#e2e8f0', val: '#52647d', box: '#f8fafc' },
};
const TONO_AVISO = { green: TONO.verde, amber: TONO.ambar, red: TONO.rojo, blue: TONO.azul };
const NIVEL_TONO = { verde: TONO.verde, ambar: TONO.ambar, rojo: TONO.rojo, gris: TONO.gris };
const NIVEL_TXT  = { verde: '✅ En track', ambar: '⚠️ Atención', rojo: '🚨 Riesgo', gris: '• Sin referencia' };
const tonoNivel  = NIVEL_TONO[e.nivel];

const money = Core.money;
const moneyCorto = Core.moneyCorto;
const count = Core.count;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const pill = (texto, t) =>
  `<span style="display:inline-block;background:${t.bg};color:${t.fg};border:1px solid ${t.bd};border-radius:6px;padding:2px 8px;font-size:11px;font-weight:600;white-space:nowrap;">${texto}</span>`;

// Barra de avance como la del tablero: riel gris de 6px y el tramo cumplido en el color del avance.
function barra(p, t, ancho = 72) {
  const lleno = Math.max(2, Math.round(ancho * Math.min(Math.max(p, 0), 100) / 100));
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
    <td width="${lleno}" height="6" style="width:${lleno}px;height:6px;background:${t.val};border-radius:3px 0 0 3px;font-size:0;line-height:0;">&nbsp;</td>
    ${ancho - lleno > 0 ? `<td width="${ancho - lleno}" height="6" style="width:${ancho - lleno}px;height:6px;background:${C.track};border-radius:0 3px 3px 0;font-size:0;line-height:0;">&nbsp;</td>` : ''}
  </tr></table>`;
}

const etiqueta = texto =>
  `<div style="font-size:11px;font-weight:700;color:${C.text2};text-transform:uppercase;letter-spacing:0.08em;margin:0 0 10px;">${texto}</div>`;

function kpi(lbl, valor, color, sub, p, t) {
  return `<td valign="top" style="background:${C.card};border:1px solid ${C.border};border-radius:12px;padding:12px 14px;">
    <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.12em;">${lbl}</div>
    <div style="font-size:20px;font-weight:600;color:${color};letter-spacing:-0.02em;margin-top:6px;white-space:nowrap;">${valor}</div>
    ${p == null ? '' : `<div style="margin-top:8px;">${barra(p, t, 120)}</div>`}
    <div style="font-size:11px;color:${C.text2};margin-top:6px;">${sub}</div>
  </td>`;
}

const th = (texto, align = 'right') =>
  `<th style="padding:9px 12px;text-align:${align};font-size:11px;font-weight:700;color:${C.text2};text-transform:uppercase;letter-spacing:0.08em;background:${C.head};border-bottom:1px solid ${C.border};white-space:nowrap;">${texto}</th>`;

// Una fila por campana del mes: inversion, resultados y que parte del gasto se lleva.
function campaignRows() {
  return mes.campanas.map(c => {
    const parte = gasto.real > 0 ? (c.gasto / gasto.real) * 100 : 0;
    const cpaC = c.conversiones > 0 ? c.gasto / c.conversiones : null;
    const t = c.conversiones > 0 ? TONO.azul : TONO.rojo;
    const td = `padding:10px 12px;border-bottom:1px solid ${C.border};font-size:13px;color:${C.text};`;
    return `<tr>
      <td style="${td}font-weight:600;">${esc(c.nombre)}${c.estado && !/^habilitad/i.test(c.estado) ? ` ${pill(esc(c.estado), TONO.gris)}` : ''}</td>
      <td style="${td}text-align:right;white-space:nowrap;">${money(c.gasto)}</td>
      <td style="${td}text-align:right;white-space:nowrap;font-weight:600;color:${c.conversiones > 0 ? C.text : TONO.rojo.val};">${count(Math.round(c.conversiones))}</td>
      <td style="${td}text-align:right;white-space:nowrap;color:${C.text2};">${cpaC ? money(cpaC) : '—'}</td>
      <td style="${td}text-align:right;">
        <table role="presentation" cellpadding="0" cellspacing="0" align="right" style="border-collapse:collapse;"><tr>
          <td style="padding-right:8px;">${barra(parte, t, 56)}</td>
          <td style="font-size:12px;font-weight:700;color:${t.val};white-space:nowrap;">${Core.pctTxt(parte)}</td>
        </tr></table>
      </td>
    </tr>`;
  }).join('');
}

// Hasta tres meses anteriores con inversion, como cerraron.
const mesesPrevios = e.meses.slice(0, -1).slice(-3).reverse();

// Recuadro de aviso con el tono de las pildoras (fondo suave y borde del mismo color).
const avisoHTML = (t, titulo, cuerpo) =>
  `<tr><td style="padding:12px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${t.box};border:1px solid ${t.bd};border-radius:12px;">
      <tr><td style="padding:14px 18px;font-family:${FONT};">
        <div style="font-size:14px;font-weight:700;color:${t.fg};margin-bottom:6px;">${titulo}</div>
        <div style="font-size:13px;line-height:1.55;color:${C.text};">${cuerpo}</div>
      </td></tr>
    </table>
  </td></tr>`;

const tarjeta = cuerpo =>
  `<tr><td style="padding:12px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.border};border-radius:12px;">
      <tr><td style="padding:20px;font-family:${FONT};">${cuerpo}</td></tr>
    </table>
  </td></tr>`;

const titularResumen = e.presupuesto
  ? `${mes.label}: ${Core.pctTxt(e.gastoPct)} del presupuesto proyectado`
  : `${mes.label}: ${count(Math.round(conv.cierre))} ${V.conv} proyectadas al cierre`;

// ── Template HTML del email ───────────────────────────────────
const htmlEmail = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<title>${MARCA} · Alerta de Google Ads</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};font-family:${FONT};color:${C.text};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};">
  <tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;font-family:${FONT};">

    <!-- Encabezado: marca como en el panel lateral del tablero -->
    <tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.border};border-radius:12px;">
        <tr>
          <td style="padding:16px 12px 16px 20px;width:44px;" width="44"><img src="${LOGO}" width="44" height="44" alt="${MARCA}" style="display:block;width:44px;height:44px;border-radius:50%;border:0;"></td>
          <td style="padding:16px 0;">
            <div style="font-size:18px;font-weight:800;color:${C.text};line-height:1.1;">${MARCA}</div>
            <div style="font-size:12px;color:${C.muted};margin-top:3px;">BI Agencia Lima Retail</div>
          </td>
          <td align="right" style="padding:16px 20px;">${pill(NIVEL_TXT[e.nivel], tonoNivel)}</td>
        </tr>
      </table>
    </td></tr>

    <!-- Resumen del mes -->
    ${tarjeta(`
      ${etiqueta(`${MOTIVO === 'datos' ? 'Datos actualizados' : 'Alerta semanal de Google Ads'} · ${weekKey}`)}
      <div style="font-size:20px;font-weight:700;color:${C.text};letter-spacing:-0.02em;">${titularResumen}</div>
      <div style="font-size:14px;color:${C.text2};margin-top:6px;line-height:1.5;">
        ${fechaLabel.charAt(0).toUpperCase() + fechaLabel.slice(1)} · informes de Google Ads al ${e.corteLabel}, día ${mes.dias} de ${mes.diasMes} del mes.
        Al ritmo de <strong style="color:${C.text};">${money(gasto.ritmo)} por día</strong>, el mes cierra en ${money(gasto.cierre)}
        con ${count(Math.round(conv.cierre))} ${V.conv}${cpa.cierre ? ` a ${money(cpa.cierre)} cada una` : ''}.
      </div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
        <tr>
          ${kpi('Invertido', money(gasto.real), C.text,
            e.presupuesto ? `${Core.pctTxt((gasto.real / e.presupuesto) * 100)} del presupuesto · al ${e.corteLabel}` : `al ${e.corteLabel}`,
            e.presupuesto ? (gasto.real / e.presupuesto) * 100 : null, TONO.gris)}
          <td width="10" style="width:10px;"></td>
          ${kpi('Cierre proyectado', money(gasto.cierre), tonoNivel.val,
            e.presupuesto ? `${Core.pctTxt(e.gastoPct)} de ${moneyCorto(e.presupuesto)}` : `${diasRest} días por delante`,
            e.presupuesto ? e.gastoPct : null, tonoNivel)}
          <td width="10" style="width:10px;"></td>
          ${kpi(`${V.convCap} al cierre`, count(Math.round(conv.cierre)), C.text,
            e.convPct != null ? `${Core.signedPct(e.convPct - 100)} vs ${previo.nombre} (${count(Math.round(previoCierre.conversiones))})` : `${Core.decimal(conv.ritmo)} por día`,
            e.convPct != null ? e.convPct : null, e.convPct != null && e.convPct < Core.LIMITES.convRojo ? TONO.rojo : e.convPct != null && e.convPct < Core.LIMITES.convAmbar ? TONO.ambar : TONO.verde)}
        </tr>
      </table>
    `)}

    <!-- Inversión por campaña -->
    ${tarjeta(`
      ${etiqueta(`Campañas de ${esc(mes.nombre.toLowerCase())}`)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:12px;border-collapse:separate;border-spacing:0;overflow:hidden;">
        <thead><tr>${th('Campaña', 'left')}${th('Inversión')}${th(V.convCap)}${th(`Costo x ${V.conv1}`)}${th('% del gasto')}</tr></thead>
        <tbody>${campaignRows()}</tbody>
      </table>
      ${e.presupuesto && diasRest > 0 ? `
      <div style="font-size:13px;color:${C.text2};margin-top:14px;line-height:1.55;">
        Quedan <strong style="color:${C.text};">${moneyCorto(Math.max(0, e.presupuesto - gasto.real))}</strong> de presupuesto para los
        <strong style="color:${C.text};">${diasRest} días</strong> que faltan: ${money(Math.max(0, e.presupuesto - gasto.real) / diasRest)} por día
        (ritmo actual: ${money(gasto.ritmo)} por día).
      </div>` : ''}
    `)}

    ${avisos.map(a => avisoHTML(TONO_AVISO[a.tone] || TONO.gris, esc(a.titulo),
      a.lineas.filter(Boolean).map(l => esc(l)).join('<br>'))).join('')}

    ${mesesPrevios.length > 0 ? tarjeta(`
      ${etiqueta('Meses anteriores')}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:12px;border-collapse:separate;border-spacing:0;overflow:hidden;">
        <thead><tr>${th('Mes', 'left')}${th('Inversión')}${th(V.convCap)}${th(`Costo x ${V.conv1}`)}${th('', 'right')}</tr></thead>
        <tbody>
        ${mesesPrevios.map(m => {
          const cierre = Core.cierreDe(m);
          const cpaM = cierre.conversiones > 0 ? cierre.gasto / cierre.conversiones : null;
          const td = `padding:10px 12px;border-bottom:1px solid ${C.border};font-size:13px;color:${C.text};`;
          return `<tr>
            <td style="${td}font-weight:600;">${esc(m.nombre)}</td>
            <td style="${td}text-align:right;white-space:nowrap;">${money(m.gasto)}</td>
            <td style="${td}text-align:right;white-space:nowrap;">${count(Math.round(m.conversiones))}</td>
            <td style="${td}text-align:right;white-space:nowrap;color:${C.text2};">${cpaM ? money(cpaM) : '—'}</td>
            <td style="${td}text-align:right;">${m.cerrado ? pill('mes completo', TONO.gris) : pill(`informe al día ${m.dias}`, TONO.ambar)}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
    `) : ''}

    <!-- Botón y pie -->
    <tr><td align="center" style="padding:22px 0 8px;">
      <a href="${config.url_dashboard}" style="display:inline-block;background:${C.brand};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:9px;font-size:14px;font-weight:600;font-family:${FONT};">Ver el tablero de ${MARCA}</a>
    </td></tr>
    <tr><td align="center" style="padding:8px 0 0;font-size:11px;line-height:1.6;color:${C.muted};font-family:${FONT};">
      ${config.workspace} · alerta automática (${weekKey}): los lunes a las 6:00 p. m. y cada vez que entran datos nuevos.<br>
      Informes de Google Ads de las carpetas de Drive de ${MARCA}; el cierre proyectado usa el ritmo del mes, como el módulo Proyecciones.
    </td></tr>

  </table>
  </td></tr>
</table>
</body>
</html>`;

if (PREVIEW) {
  fs.writeFileSync(PREVIEW, htmlEmail, 'utf8');
  console.log(`\n🖼  Vista previa escrita en ${PREVIEW} (sin envío).\n`);
  process.exit(0);
}

// Asunto: el nivel manda; despues, el dato que mas pesa del mes.
const detalle = e.presupuesto
  ? ` · ${Core.pctTxt(e.gastoPct)} del presupuesto`
  : e.convPct != null ? ` · ${Core.signedPct(e.convPct - 100)} en ${V.conv}` : '';
const subject = `${NIVEL_TXT[e.nivel]} · ${mes.label} · ${count(Math.round(conv.cierre))} ${V.conv} proyectadas${detalle} · Lima Retail`;

// ── Destinatarios ─────────────────────────────────────────────
// Los de la ruedita del tablero; si el Web App no esta conectado, no responde o nunca se guardo una
// lista, los de alertas-config.json. Una lista guardada vacia significa que no se envia.
async function destinatarios() {
  const url = process.env.AQ_ALERTAS_URL;
  const token = process.env.AQ_ALERTAS_TOKEN;
  const porDefecto = { lista: config.destinatarios || [], fuente: 'data/alertas-config.json' };
  if (!url || !token) return porDefecto;
  try {
    const res = await fetch(`${url}?token=${encodeURIComponent(token)}`);
    const body = await res.json();
    if (!body.ok) throw new Error(body.error || `HTTP ${res.status}`);
    if (!Array.isArray(body.destinatarios)) return { ...porDefecto, fuente: 'data/alertas-config.json (el tablero todavía no guardó una lista)' };
    return { lista: body.destinatarios, fuente: 'configuración del tablero' };
  } catch (error) {
    console.warn(`::warning::No se pudo leer la lista del tablero (${error.message}); se usa data/alertas-config.json`);
    return porDefecto;
  }
}

// ── Registrar envío ──────────────────────────────────────────
function registrarEnvio() {
  if (MOTIVO !== 'datos') enviosData.enviados[weekKey] = new Date().toISOString();
  enviosData.ultimaHuella = huella;
  enviosData.ultimoEnvio = { fecha: new Date().toISOString(), motivo: MOTIVO, mes: mes.id };
  fs.writeFileSync(enviosPath, JSON.stringify(enviosData, null, 2) + '\n', 'utf8');
  console.log(`📝 Registrado en alertas-envios.json: ${MOTIVO === 'datos' ? 'datos actualizados' : weekKey}\n`);
}

// ── Envío por el correo del hosting (SMTP) ────────────────────
// El remitente es la misma cuenta que se autentica: los hostings rechazan un "From" de otra cuenta.
async function enviarSmtp(toList) {
  const nodemailer = require('nodemailer');
  const port = Number(process.env.SMTP_PORT) || 465;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const from = /@/.test(process.env.SMTP_USER) ? process.env.SMTP_USER : config.from_email;
  const info = await transporter.sendMail({
    from: `${config.from_name} <${from}>`,
    to: toList,
    subject,
    html: htmlEmail,
  });
  return info.messageId || '(sin id)';
}

(async () => {
  const { lista, fuente: fuenteLista } = await destinatarios();
  const para = lista.map(d => (d.nombre ? `${d.nombre} <${d.email}>` : d.email)).join(', ');

  if (DRY_RUN) {
    console.log('\n─────────────────────────────────────────');
    console.log('[DRY-RUN] Email que se enviaría:');
    console.log('  Asunto :', subject);
    console.log('  Para   :', para || '(nadie)', `· ${fuenteLista}`);
    console.log('  Tamaño :', Math.round(htmlEmail.length / 1024), 'KB');
    console.log('[DRY-RUN] Sin envíos reales. FIN.\n');
    return;
  }

  if (!lista.length) {
    console.log(`\n⏭  La lista de destinatarios está vacía (${fuenteLista}): no se envía.\n`);
    return;
  }

  const toList = lista.map(d => d.email);
  const smtp = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].every(name => process.env[name]);
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!smtp && !RESEND_KEY) {
    console.error('\n❌ Falta la configuración de envío: SMTP_HOST, SMTP_USER y SMTP_PASS (correo del hosting) o RESEND_API_KEY.');
    console.error('   Exportá las variables o usá --dry-run para simular.\n');
    process.exit(1);
  }

  console.log(`\n📧 Enviando a: ${para} (${fuenteLista})`);
  console.log(`   Asunto: ${subject}`);

  if (smtp) {
    const id = await enviarSmtp(toList);
    console.log(`\n✅ Email enviado por el correo del hosting (${process.env.SMTP_HOST}). ID: ${id}`);
    registrarEnvio();
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${config.from_name} <${config.from_email}>`, to: toList, subject, html: htmlEmail }),
  });
  const body = await res.json().catch(() => res.text());
  if (!res.ok) {
    console.error(`\n❌ Error Resend ${res.status}:`, JSON.stringify(body, null, 2));
    process.exit(1);
  }
  console.log(`\n✅ Email enviado. Resend ID: ${body.id || '(desconocido)'}`);
  registrarEnvio();
})().catch(error => {
  console.error('\n❌ Error fatal:', error.message);
  process.exit(1);
});
