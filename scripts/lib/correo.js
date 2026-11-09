'use strict';
/**
 * Envío de correo para los avisos técnicos del tablero (hoy, scripts/check-nexus.js).
 *
 * Primero el correo del hosting (SMTP_HOST / SMTP_USER / SMTP_PASS); si no están, Resend
 * (RESEND_API_KEY). Es el mismo orden que usa scripts/alertas.js, que lleva su propia copia: ese
 * script arma el correo del cliente entero al cargarse y partirlo es un cambio aparte.
 *
 * El remitente es la cuenta que se autentica: los hostings rechazan un "From" de otra.
 */

const fs = require('fs');
const path = require('path');

const CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'alertas-config.json'), 'utf8'),
);

/**
 * Los correos del equipo, para los avisos técnicos. Salen del secret AQ_ALERTAS_TECNICAS (separados
 * por comas) o de `destinatarios_tecnicos` en data/alertas-config.json.
 *
 * Nunca caen en `destinatarios` ni en la lista de la ruedita del tablero (AQ_ALERTAS_URL): esas son
 * las del cliente. Sin lista técnica, la respuesta es vacía y el envío se niega.
 */
function destinatariosTecnicos(env = process.env, config = CONFIG) {
  const delEntorno = String(env.AQ_ALERTAS_TECNICAS || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
  if (delEntorno.length) return delEntorno;
  return (config.destinatarios_tecnicos || []).map(d => d && d.email).filter(Boolean);
}

async function enviar({ para, asunto, html }) {
  const lista = (para || []).filter(Boolean);
  if (!lista.length) {
    throw new Error('No hay destinatarios técnicos: AQ_ALERTAS_TECNICAS o destinatarios_tecnicos en data/alertas-config.json.');
  }

  const smtp = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].every(nombre => process.env[nombre]);
  const resend = process.env.RESEND_API_KEY;
  if (!smtp && !resend) {
    throw new Error('Falta configurar el envío: SMTP_HOST, SMTP_USER y SMTP_PASS, o RESEND_API_KEY.');
  }

  if (smtp) {
    const nodemailer = require('nodemailer');
    const puerto = Number(process.env.SMTP_PORT) || 465;
    const transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: puerto,
      secure: puerto === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    const de = /@/.test(process.env.SMTP_USER) ? process.env.SMTP_USER : CONFIG.from_email;
    const info = await transporte.sendMail({
      from: `${CONFIG.from_name} <${de}>`,
      to: lista,
      subject: asunto,
      html,
    });
    return `correo del hosting (${process.env.SMTP_HOST}) · ${info.messageId || 'sin id'}`;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${CONFIG.from_name} <${CONFIG.from_email}>`,
      to: lista,
      subject: asunto,
      html,
    }),
  });
  const cuerpo = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(cuerpo)}`);
  return `Resend · ${(cuerpo && cuerpo.id) || 'sin id'}`;
}

module.exports = { CONFIG, destinatariosTecnicos, enviar };
