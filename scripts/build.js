#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const DIST_HTML = path.join(DIST_DIR, 'index.html');

function readFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function main() {
  let html = readFile('index.html');
  const css = readFile('css/dashboard.css');
  const app = readFile('js/objectives.js');
  const reservationGoals = readFile('js/reservation-goals.js');
  const messagesCalculator = readFile('js/messages-calculator.js');
  const navigation = readFile('js/navigation.js');
  const sidebar = readFile('js/sidebar.js');
  const data = readFile('data/amador-ads-2026.json').replace(/</g, '\\u003c');
  const juneData = readFile('data/amador-june-sheet-2026.json').replace(/</g, '\\u003c');

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
    `<script>window.AMADOR_ADS_DATA = ${data};window.AMADOR_JUNE_DATA = ${juneData};</script></head>`
  );

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST_DIR, 'data'), { recursive: true });
  fs.writeFileSync(DIST_HTML, html, 'utf8');
  fs.copyFileSync(
    path.join(ROOT, 'data', 'amador-ads-2026.json'),
    path.join(DIST_DIR, 'data', 'amador-ads-2026.json')
  );

  console.log(`[build] escrito dist/index.html (${(fs.statSync(DIST_HTML).size / 1024).toFixed(1)} KB)`);
}

try {
  main();
} catch (error) {
  console.error('[build] error:', error.message);
  process.exit(1);
}
