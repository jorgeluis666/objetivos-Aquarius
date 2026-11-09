const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup(now = '2026-11-09T15:00:00Z') {
  const code = fs.readFileSync(path.join(__dirname, '../js/objectives.js'), 'utf8')
    .replace('window.AquariusGasto = {', 'window.testGasto = gasto; window.AquariusGasto = {');
  const context = { window: {}, document: { readyState: 'loading', addEventListener() {} },
    Date: class extends Date { static now() { return Date.parse(now); } }, Intl, console };
  vm.runInNewContext(code, context);
  const month = { key: '2026-11', year: 2026, month: 11, name: 'Noviembre', shortName: 'Nov',
    firstDay: 1, lastDay: 9, daysInMonth: 30, hasData: true, complete: false,
    totals: { cost: 900, clicks: 90, conversions: 9, impressions: 9000 },
    campaigns: [{ key: 'a', cost: 900, clicks: 90, conversions: 9, impressions: 9000 }],
    detailFirst: 1, detailLast: 9,
    detail: Array.from({ length: 9 }, (_, i) => ({ d: i + 1, campaignKey: 'a', cost: 100, clicks: 10, conversions: 1 })) };
  context.window.testGasto.months = [month];
  return { api: context.window.AquariusGasto, month, context };
}

test('Monday report closes Sunday and excludes Monday from sums without mutating dashboard', () => {
  const { api, month } = setup();
  const period = api.reportPeriod(month.key);
  assert.equal(period.month.lastDay, 8);
  assert.equal(api.totals(period).cost, 800);
  assert.equal(api.totals(period).conversions, 8);
  assert.equal(api.totals(period).impressions, null);
  assert.equal(api.campaigns(period)[0].cost, 800);
  assert.equal(api.totals(api.period(month.key)).cost, 900);
});
test('Missing daily data requires exact cutoff data', () => {
  const { api, month } = setup();
  month.detail = null;
  assert.ok(api.reportPeriod(month.key).unavailable);
  month.lastDay = 8;
  assert.equal(api.reportPeriod(month.key).unavailable, undefined);
});
test('Sunday in progress and month without completed Sunday', () => {
  const sunday = setup('2026-11-08T20:00:00Z');
  assert.equal(sunday.api.reportPeriod('2026-11').month.lastDay, 1);
  const first = setup('2026-11-01T20:00:00Z');
  assert.ok(first.api.reportPeriod('2026-11').unavailable);
});
test('Closed months preserve the complete reporting period', () => {
  const { api, month } = setup();
  month.complete = true;
  month.lastDay = 30;
  assert.equal(api.reportPeriod(month.key).month.lastDay, 30);
});

test('Recovered November snapshot renders the report and matching keyword data', () => {
  const { api, context } = setup();
  context.window.AQUARIUS_REPORT_SNAPSHOTS = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/report-snapshots.json'), 'utf8'));
  const period = api.reportPeriod('2026-11');
  assert.equal(period.unavailable, undefined);
  assert.equal(api.totals(period).cost, 465.1);
  assert.equal(api.totals(period).clicks, 603);
  assert.equal(api.totals(period).conversions, 36);
  assert.ok(api.keywords(period).length > 0);
  const host = { innerHTML: '', querySelectorAll: () => [] };
  const select = { innerHTML: '' };
  const print = {};
  context.document.getElementById = id => ({ 'week-report': host, 'week-select': select, 'week-print': print }[id]);
  context.window.addEventListener = () => {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/report-week.js'), 'utf8'), context);
  context.window.AquariusReport.render();
  assert.match(select.innerHTML, /1–8 \(en curso\)/);
  assert.match(host.innerHTML, /Periodo 1 – 8/);
  assert.match(host.innerHTML, /Captura:/);
  assert.match(host.innerHTML, /Resultados por servicio/);
  assert.match(host.innerHTML, /S\/ 465\.10/);
  assert.doesNotMatch(host.innerHTML, /rp-empty rp-chart-empty/);
  assert.doesNotMatch(host.innerHTML, /Reporte pendiente de datos|NaN|undefined/);
  assert.equal(print.disabled, false);
});

function matchingDailyCapture() {
  const result = setup();
  result.context.window.AQUARIUS_REPORT_SNAPSHOTS = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/report-snapshots.json'), 'utf8'));
  const saved = result.api.reportPeriod('2026-11').month;
  result.month.campaigns = saved.campaigns;
  // Synthetic reconciliation fixture, never written to production data.
  result.month.detail = saved.campaigns.flatMap(c => [1, 8].map(d => ({
    d, campaignKey: c.key, cost: c.cost / 2, clicks: c.clicks / 2, conversions: c.conversions / 2,
  })));
  result.month.detail.push({ d: 9, campaignKey: saved.campaigns[0].key, cost: 500, clicks: 50, conversions: 5 });
  return result;
}

test('Late daily import enriches matching cutoff and produces daily lead/CPL lines', () => {
  const { api, month, context } = matchingDailyCapture();
  const period = api.reportPeriod('2026-11');
  assert.equal(period.month.detailLast, 8);
  assert.ok(period.month.detail.length);
  assert.ok(period.month.detail.every(row => row.d <= 8));
  assert.equal(api.totals(period).cost, 465.1);
  assert.equal(month.detail.at(-1).d, 9);
  const host = { innerHTML: '', querySelectorAll: () => [] };
  context.document.getElementById = id => ({ 'week-report': host, 'week-select': { innerHTML: '' }, 'week-print': {} }[id]);
  context.window.addEventListener = () => {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/report-week.js'), 'utf8'), context);
  context.window.AquariusReport.render();
  assert.match(host.innerHTML, /aria-label="Evolución de leads y costo por lead por día"/);
  assert.doesNotMatch(host.innerHTML, /NaN|undefined/);
});

test('Daily import with different totals never overwrites a saved cutoff', () => {
  const { api, month } = matchingDailyCapture();
  month.detail[0].cost += 10;
  const period = api.reportPeriod('2026-11');
  assert.equal(period.month.detail, null);
  assert.equal(api.totals(period).cost, 465.1);
});

test('Daily import requires complete coverage through the cutoff', () => {
  const { api, month } = matchingDailyCapture();
  month.detailLast = 7;
  assert.equal(api.reportPeriod('2026-11').month.detail, null);
});
