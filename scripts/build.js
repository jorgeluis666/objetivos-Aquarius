#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const DIST_HTML = path.join(DIST_DIR, 'index.html');
function readFile(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function inlineCss(html) {
  return html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>/g, (match, href) => /^https?:\/\//.test(href) ? match : `<style>\n/* ${href} */\n${readFile(href)}\n</style>`);
}
function inlineScripts(html) {
  return html.replace(/<script\s+src="([^"]+)"\s*><\/script>/g, (match, src) => /^https?:\/\//.test(src) ? match : `<script>\n/* ${src} */\n${readFile(src)}\n</script>`);
}
function main() {
  let html = inlineCss(readFile('index.html'));
  html = inlineScripts(html);
  const dataJson = readFile('data/amador-ads-2026.json').replace(/</g, '\\u003c');
  html = html.replace('</head>', `<script>window.AMADOR_ADS_DATA = ${dataJson};</script>\n</head>`);
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST_DIR, 'data'), { recursive: true });
  fs.writeFileSync(DIST_HTML, html, 'utf8');
  fs.copyFileSync(path.join(ROOT, 'data', 'amador-ads-2026.json'), path.join(DIST_DIR, 'data', 'amador-ads-2026.json'));
  console.log(`[build] escrito dist/index.html (${(fs.statSync(DIST_HTML).size / 1024).toFixed(1)} KB)`);
}
try { main(); } catch (error) { console.error('[build] error:', error.message); process.exit(1); }
