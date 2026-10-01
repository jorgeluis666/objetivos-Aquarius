#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const DIST_HTML = path.join(DIST_DIR, 'index.html');

function readFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

// GitHub Pages no tiene Basic Auth: con AQ_PAGE_PASSWORD el tablero se cifra (AES-256-GCM, llave
// PBKDF2-SHA256) dentro de deploy/pages-gate.html, que lo descifra en el navegador con la clave.
// La salida es compatible con WebCrypto: el tag de GCM va pegado al final del texto cifrado.
const PBKDF2_ITERATIONS = 600000;

function encryptPage(html, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password.normalize('NFC'), salt, PBKDF2_ITERATIONS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(html, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const payload = JSON.stringify({
    iterations: PBKDF2_ITERATIONS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    data: data.toString('base64'),
  });
  const template = readFile('deploy/pages-gate.html');
  if (template.split('__PAYLOAD__').length !== 2) throw new Error('deploy/pages-gate.html debe contener __PAYLOAD__ exactamente una vez');
  return template.replace('__PAYLOAD__', () => payload).replace(/\r\n?/g, '\n');
}

function main() {
  let html = readFile('index.html');
  // Al incrustar el CSS la ruta pasa a resolverse desde dist/index.html,
  // asi que '../assets/' tiene que quedar como 'assets/'.
  const css = readFile('css/dashboard.css').replaceAll('../assets/', 'assets/');
  // '\\u003c' es el texto < (no el caracter <): un "</script>" en los datos cerraria el <script>.
  const data = readFile('data/aquarius-lima-retail-2026.json').replace(/</g, '\\u003c');

  // Los assets llevan ?v=<version> para evitar caches viejos, asi que el build ubica cada etiqueta
  // ignorando ese sufijo. Reemplazos con funcion: una cadena de reemplazo interpretaria "$'" o "$&"
  // dentro del codigo o de los datos.
  html = html.replace(/<link rel="stylesheet" href="css\/dashboard\.css(?:\?[^"]*)?">/, () => `<style>${css}</style>`);
  // Se incrustan, en el orden de index.html, todos los js/ que carga: no hay otra lista que mantener.
  html = html.replace(/<script src="js\/([\w-]+\.js)(?:\?[^"]*)?"><\/script>/g, (_, file) => `<script>${readFile(`js/${file}`)}</script>`);
  // dist/ solo lleva index.html, assets/ y CNAME: un css o js local que no se incruste quedaria roto.
  if (/<link rel="stylesheet" href="(?!https:)|<script src="(?!https:)/.test(html)) {
    throw new Error('index.html carga un css o js local que el build no incrusta');
  }
  // Configuracion de la carpeta de Drive. La clave publica no vive en el repo:
  // llega por AQ_DRIVE_API_KEY y solo queda dentro del HTML cifrado.
  const driveConfig = JSON.parse(readFile('data/drive-config.json'));
  driveConfig.apiKey = process.env.AQ_DRIVE_API_KEY || driveConfig.apiKey || '';
  const driveJson = JSON.stringify(driveConfig).replace(/</g, '\u003c');
  if (driveConfig.apiKey) console.log('[build] sincronizacion desde el navegador habilitada');
  else console.warn('[build] sin AQ_DRIVE_API_KEY: el boton Sincronizar trae la ultima publicacion');

  html = html.replace('</head>', () => `<script>window.AQUARIUS_RETAIL_DATA = ${data};window.AQUARIUS_DRIVE_CONFIG = ${driveJson};</script></head>`);

  try {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  } catch (error) {
    console.warn(`[build] no se pudo limpiar dist completo: ${error.message}`);
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });
  // Los datos van dentro del HTML (cifrado con clave): dist/ no lleva la carpeta data/.
  const pagePassword = process.env.AQ_PAGE_PASSWORD || '';
  fs.writeFileSync(DIST_HTML, pagePassword ? encryptPage(html, pagePassword) : html, 'utf8');
  if (pagePassword) console.log('[build] dist/index.html cifrado con AQ_PAGE_PASSWORD');
  else console.warn('[build] sin AQ_PAGE_PASSWORD: dist/index.html queda sin clave (solo para uso local)');

  // El logo y el fondo del acceso se referencian por URL, no se incrustan.
  fs.cpSync(path.join(ROOT, 'assets'), path.join(DIST_DIR, 'assets'), { recursive: true });
  // Dominio propio en GitHub Pages; va junto al sitio igual que en los demas tableros de la agencia.
  fs.copyFileSync(path.join(ROOT, 'CNAME'), path.join(DIST_DIR, 'CNAME'));

  console.log(`[build] escrito dist/index.html (${(fs.statSync(DIST_HTML).size / 1024).toFixed(1)} KB)`);
}

try {
  main();
} catch (error) {
  console.error('[build] error:', error.message);
  process.exit(1);
}
