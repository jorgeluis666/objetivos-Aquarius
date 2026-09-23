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

function copyDirectory(source, target) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(sourcePath, targetPath);
    else fs.copyFileSync(sourcePath, targetPath);
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// El acceso lo controla Apache (HTTP Basic Auth), no el navegador. HTPASSWD_PATH es la ruta absoluta
// del archivo de claves en el servidor (la que crea cPanel > Privacidad de directorios). Si falta,
// se deja un marcador: Apache responde 500 en vez de servir el tablero sin clave.
function writeHtaccess(html) {
  const htpasswdPath = (process.env.HTPASSWD_PATH || '').trim();
  if (!htpasswdPath) console.warn('[build] falta HTPASSWD_PATH; dist/.htaccess queda con un marcador y el sitio no abrira');
  // CSP con el hash de cada <script> inline, porque el build mete todo el JS dentro del HTML.
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => `'sha256-${crypto.createHash('sha256').update(match[1], 'utf8').digest('base64')}'`);
  const csp = [
    "default-src 'self'",
    `script-src 'self' https://cdnjs.cloudflare.com ${hashes.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
  const template = readFile('deploy/.htaccess');
  for (const token of ['__HTPASSWD_PATH__', '__CSP__']) {
    if (template.split(token).length !== 2) throw new Error(`deploy/.htaccess debe contener ${token} exactamente una vez`);
  }
  const output = template
    .replace('__HTPASSWD_PATH__', htpasswdPath || '/RUTA/NO/CONFIGURADA/.htpasswd')
    .replace('__CSP__', csp);
  fs.writeFileSync(path.join(DIST_DIR, '.htaccess'), output, 'utf8');
}

function main() {
  let html = readFile('index.html');
  const css = readFile('css/dashboard.css').replaceAll('../assets/', 'assets/');
  const app = readFile('js/objectives.js');
  const reservationGoals = readFile('js/reservation-goals.js');
  const messagesCalculator = readFile('js/messages-calculator.js');
  const navigation = readFile('js/navigation.js');
  const sidebar = readFile('js/sidebar.js');
  const data = readFile('data/aquarius-lima-retail-2026.json').replace(/</g, '\\u003c');

  // Los assets llevan ?v=<version> para evitar caches viejos en el navegador,
  // asi que el build ubica cada etiqueta ignorando ese sufijo.
  const styleTag = file => new RegExp('<link rel="stylesheet" href="' + escapeRegExp(file) + '(?:\\?[^"]*)?">');
  const scriptTag = file => new RegExp('<script src="' + escapeRegExp(file) + '(?:\\?[^"]*)?"></script>');
  // Si una etiqueta no se encuentra, dist quedaria pidiendo js/ o css/, que no se publican.
  const inline = (pattern, replacement, file) => {
    if (!pattern.test(html)) throw new Error(`index.html no referencia ${file}`);
    html = html.replace(pattern, () => replacement);
  };

  inline(styleTag('css/dashboard.css'), `<style>${css}</style>`, 'css/dashboard.css');
  inline(scriptTag('js/objectives.js'), `<script>${app}</script>`, 'js/objectives.js');
  inline(scriptTag('js/reservation-goals.js'), `<script>${reservationGoals}</script>`, 'js/reservation-goals.js');
  inline(scriptTag('js/messages-calculator.js'), `<script>${messagesCalculator}</script>`, 'js/messages-calculator.js');
  inline(scriptTag('js/navigation.js'), `<script>${navigation}</script>`, 'js/navigation.js');
  inline(scriptTag('js/sidebar.js'), `<script>${sidebar}</script>`, 'js/sidebar.js');
  html = html.replace(
    '</head>',
    () => `<script>window.AQUARIUS_RETAIL_DATA = ${data};</script></head>`
  );

  // El navegador convierte CRLF en LF antes de calcular el hash CSP de cada <script>; si el HTML
  // conserva CRLF (archivos editados en Windows) los hashes no coinciden y el tablero no carga.
  html = html.replace(/\r\n?/g, '\n');

  try {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  } catch (error) {
    console.warn(`[build] no se pudo limpiar dist completo: ${error.message}`);
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(DIST_HTML, html, 'utf8');
  // Los datos ya van incrustados en el HTML (window.AQUARIUS_RETAIL_DATA) y objectives.js solo
  // hace fetch si faltan, asi que no se publica ningun JSON ni data/csv-backups.
  copyDirectory(path.join(ROOT, 'assets'), path.join(DIST_DIR, 'assets'));
  writeHtaccess(html);

  console.log(`[build] escrito dist/index.html (${(fs.statSync(DIST_HTML).size / 1024).toFixed(1)} KB)`);
}

try {
  main();
} catch (error) {
  console.error('[build] error:', error.message);
  process.exit(1);
}
