#!/usr/bin/env node

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

function main() {
  let html = readFile('index.html');
  const css = readFile('css/dashboard.css').replaceAll('../assets/', 'assets/');
  const app = readFile('js/objectives.js');
  const reservationGoals = readFile('js/reservation-goals.js');
  const messagesCalculator = readFile('js/messages-calculator.js');
  const navigation = readFile('js/navigation.js');
  const sidebar = readFile('js/sidebar.js');
  const data = readFile('data/aquarius-lima-retail-2026.json').replace(/</g, '\\u003c');

  html = html.replace(
    '<link rel="stylesheet" href="css/dashboard.css">',
    `<style>${css}</style>`
  );
  html = html.replace(
    '<script src="js/objectives.js"></script>',
    `<script>${app}</script>`
  );
  html = html.replace(
    '<script src="js/reservation-goals.js"></script>',
    `<script>${reservationGoals}</script>`
  );
  html = html.replace(
    '<script src="js/messages-calculator.js"></script>',
    `<script>${messagesCalculator}</script>`
  );
  html = html.replace(
    '<script src="js/navigation.js"></script>',
    `<script>${navigation}</script>`
  );
  html = html.replace(
    '<script src="js/sidebar.js"></script>',
    `<script>${sidebar}</script>`
  );
  html = html.replace(
    '</head>',
    `<script>window.AQUARIUS_RETAIL_DATA = ${data};</script></head>`
  );

  try {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  } catch (error) {
    console.warn(`[build] no se pudo limpiar dist completo: ${error.message}`);
  }
  fs.mkdirSync(path.join(DIST_DIR, 'data'), { recursive: true });
  fs.writeFileSync(DIST_HTML, html, 'utf8');
  try {
    fs.copyFileSync(
      path.join(ROOT, 'data', 'aquarius-lima-retail-2026.json'),
      path.join(DIST_DIR, 'data', 'aquarius-lima-retail-2026.json')
    );
    copyDirectory(path.join(ROOT, 'assets'), path.join(DIST_DIR, 'assets'));
  } catch (error) {
    console.warn(`[build] index actualizado; no se pudo copiar dist/data o assets: ${error.message}`);
  }

  console.log(`[build] escrito dist/index.html (${(fs.statSync(DIST_HTML).size / 1024).toFixed(1)} KB)`);
}

try {
  main();
} catch (error) {
  console.error('[build] error:', error.message);
  process.exit(1);
}
