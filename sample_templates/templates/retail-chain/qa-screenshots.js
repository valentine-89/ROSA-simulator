const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const root = __dirname;
const db = new Database(path.join(root, 'sample.sqlite'));
const outputDir = path.join(process.cwd(), '.tmp');
fs.mkdirSync(outputDir, { recursive: true });

function splitSql(sql) {
  const statements = [];
  let current = '';
  let single = false;
  let double = false;
  let backtick = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (lineComment) {
      current += char;
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }
    if (!single && !double && !backtick && char === '-' && next === '-') {
      current += char + next;
      index += 1;
      lineComment = true;
      continue;
    }
    if (!single && !double && !backtick && char === '/' && next === '*') {
      current += char + next;
      index += 1;
      blockComment = true;
      continue;
    }
    if (char === "'" && !double && !backtick) {
      if (single && next === "'") {
        current += char + next;
        index += 1;
        continue;
      }
      single = !single;
    } else if (char === '"' && !single && !backtick) {
      double = !double;
    } else if (char === '`' && !single && !double) {
      backtick = !backtick;
    }
    if (char === ';' && !single && !double && !backtick) {
      if (current.trim()) statements.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

function runMacro(name, payload) {
  const source = db.prepare('SELECT source FROM system_macros WHERE name=?').pluck().get(name);
  if (!source) throw new Error(`Missing macro ${name}`);
  let rows = [];
  const tx = db.transaction(() => {
    for (const statement of splitSql(source)) {
      const values = [];
      const sql = statement.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, key) => {
        values.push(Object.prototype.hasOwnProperty.call(payload, key) ? String(payload[key]) : null);
        return '?';
      });
      const prepared = db.prepare(sql);
      if (/^(select|with|pragma|show|describe|explain)\b/i.test(statement.trim())) rows = prepared.all(values);
      else prepared.run(values);
    }
  });
  tx();
  return rows;
}

async function installApiRoutes(page) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/stream') || url.pathname.includes('/iot-page-stream/')) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    let body = {};
    try { body = request.postDataJSON() || {}; } catch (error) {}
    try {
      let payload = body;
      if (url.pathname.includes('/api/iot-page-macro/')) {
        payload = {
          macro: body.macro,
          link_id: 'SHOP-HCM',
          store_id: 'STORE-HCM',
          machine_id: '',
          phone: '0912345678',
          username: 'Phạm Gia Huy',
          email: 'huy@example.com',
          ...(body.params || {}),
        };
      }
      const rows = runMacro(payload.macro, { ioid: 'IO-DEMO', sync_id: 'SYNC', ...payload });
      const response = url.pathname.includes('/api/iot-page-macro/')
        ? { ok: true, macro: payload.macro, rows }
        : rows;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
    } catch (error) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: error.message }) });
    }
  });
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: window.innerWidth }));
  if (overflow.body > overflow.viewport + 2) throw new Error(`${label} horizontal overflow: ${overflow.body} > ${overflow.viewport}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  desktop.on('console', (message) => { if (message.type() === 'error') errors.push(`desktop console: ${message.text()}`); });
  desktop.on('pageerror', (error) => errors.push(`desktop page: ${error.message}`));
  await installApiRoutes(desktop);
  await desktop.goto('http://127.0.0.1:4173/sample_dashboards/retail-chain/dashboard_overview_vi.html?sessionId=IO-DEMO&syncId=SYNC', { waitUntil: 'networkidle' });
  await desktop.locator('.rt-kpi').first().waitFor();
  await desktop.evaluate(() => {
    const status = document.getElementById('rt-live-status');
    if (status) { status.dataset.state = 'live'; status.textContent = 'Đã đồng bộ'; }
  });
  await assertNoHorizontalOverflow(desktop, 'desktop overview');
  await desktop.screenshot({ path: path.join(root, 'sample.png'), fullPage: true });
  await desktop.screenshot({ path: path.join(outputDir, 'retail-overview-desktop.png'), fullPage: true });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  mobile.on('console', (message) => { if (message.type() === 'error') errors.push(`mobile console: ${message.text()}`); });
  mobile.on('pageerror', (error) => errors.push(`mobile page: ${error.message}`));
  await installApiRoutes(mobile);
  await mobile.goto('http://127.0.0.1:4173/sample_dashboards/retail-chain/dashboard_inventory_vi.html?sessionId=IO-DEMO&syncId=SYNC', { waitUntil: 'networkidle' });
  await mobile.locator('.rt-table').waitFor();
  await assertNoHorizontalOverflow(mobile, 'mobile inventory');
  await mobile.screenshot({ path: path.join(outputDir, 'retail-inventory-mobile.png'), fullPage: true });

  const storefront = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  storefront.on('console', (message) => { if (message.type() === 'error') errors.push(`storefront console: ${message.text()}`); });
  storefront.on('pageerror', (error) => errors.push(`storefront page: ${error.message}`));
  await storefront.route('http://127.0.0.1:4173/iot-page/IO-DEMO/retail-shop-hcm', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(root, 'storefront_page.html'), 'utf8') });
  });
  await installApiRoutes(storefront);
  await storefront.goto('http://127.0.0.1:4173/iot-page/IO-DEMO/retail-shop-hcm', { waitUntil: 'networkidle' });
  await storefront.locator('.product').first().waitFor();
  await assertNoHorizontalOverflow(storefront, 'mobile storefront');
  await storefront.locator('.add').first().click();
  await storefront.locator('#checkout').click();
  await storefront.locator('#sheet:not([hidden])').waitFor();
  await storefront.screenshot({ path: path.join(outputDir, 'retail-storefront-mobile.png'), fullPage: true });

  await browser.close();
  db.close();
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Retail-chain browser QA passed.');
})().catch((error) => {
  try { db.close(); } catch (closeError) {}
  console.error(error);
  process.exitCode = 1;
});
