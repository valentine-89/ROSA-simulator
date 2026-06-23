const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const sourcePath = path.join(__dirname, 'sample.sqlite');
const targetPath = path.join(process.cwd(), '.tmp', 'retail-chain-smoke.sqlite');
fs.mkdirSync(path.dirname(targetPath), { recursive: true });
for (const suffix of ['', '-shm', '-wal']) {
  try { fs.unlinkSync(targetPath + suffix); } catch (error) {}
}
fs.copyFileSync(sourcePath, targetPath);

const db = new Database(targetPath);

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
      const params = [];
      const sql = statement.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, key) => {
        params.push(Object.prototype.hasOwnProperty.call(payload, key) ? String(payload[key]) : null);
        return '?';
      });
      const prepared = db.prepare(sql);
      if (/^(select|with|pragma|show|describe|explain)\b/i.test(statement.trim())) rows = prepared.all(params);
      else prepared.run(params);
    }
  });
  tx();
  return rows;
}

function scalar(sql, ...params) {
  return db.prepare(sql).pluck().get(...params);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const beforeOrders = scalar('SELECT COUNT(*) FROM retail_orders');
const beforeSales = scalar('SELECT COUNT(*) FROM retail_sales');
const beforePosition = scalar("SELECT quantity FROM retail_machine_positions WHERE machine_id='VM-HCM-01' AND position_no=1");
const beforeStock = scalar("SELECT stock_qty FROM retail_store_products WHERE store_id='STORE-HCM' AND product_id='P-WATER'");
const beforeLinks = scalar('SELECT COUNT(*) FROM retail_order_links');

const linkPayload = {
  link_id: 'SHOP-SMOKE', page_id: 'retail-shop-smoke', store_id: 'STORE-HCM', machine_id: '',
  title: 'Smoke Storefront', subtitle: 'QA', require_phone: '1', enabled: '1', sync_id: 'SYNC',
};
runMacro('retail-admin-save-link', linkPayload);
runMacro('retail-admin-save-link', { ...linkPayload, title: 'Smoke Storefront Updated' });
assert(scalar('SELECT COUNT(*) FROM retail_order_links') === beforeLinks + 1, 'Link upsert created duplicates');
assert(scalar("SELECT require_phone FROM system_pages WHERE page_id='retail-shop-smoke'") === 1, 'Secure system page was not created');

const stateRows = runMacro('retail-link-state', { link_id: 'SHOP-VM01', store_id: 'STORE-HCM', machine_id: 'VM-HCM-01' });
assert(stateRows.some((row) => row.row_type === 'product'), 'Storefront did not return products');

const orderPayload = {
  link_id: 'SHOP-VM01', store_id: 'STORE-HCM', machine_id: 'VM-HCM-01',
  cart_json: '[{"product_id":"P-WATER","qty":1}]', client_request_id: 'SMOKE-WEB-1',
  payment_method: 'cash', note: '', phone: '0912345678', username: 'Smoke User', email: '',
};
const created = runMacro('retail-link-create-order', orderPayload)[0];
const repeated = runMacro('retail-link-create-order', orderPayload)[0];
assert(created.c1 === 'OK' && repeated.code === 'DUPLICATE', 'Public order idempotency failed');
assert(scalar('SELECT COUNT(*) FROM retail_orders') === beforeOrders + 1, 'Duplicate public order was inserted');

const queueRows = runMacro('retail-io-order-next', { c1: 'VM-HCM-01' });
assert(queueRows.some((row) => row.order_code === created.order_code), 'Vending queue did not return created order');

const completePayload = { c1: 'SMOKE-DONE-1', c2: 'VM-HCM-01', c3: created.order_code, c4: 'fulfilled', c5: 'dispensed' };
const completed = runMacro('retail-io-order-complete', completePayload)[0];
const completedAgain = runMacro('retail-io-order-complete', completePayload)[0];
assert(completed.c1 === 'OK' && completedAgain.code === 'DUPLICATE', 'Order completion idempotency failed');

const stockPayload = { c1: 'SMOKE-STOCK-1', c2: 'STORE-HCM', c3: 'DRK-WATER-500', c4: '5', c5: 'stock_in', c6: 'PO-SMOKE', c7: 'test' };
runMacro('retail-io-stock-report', stockPayload);
runMacro('retail-io-stock-report', stockPayload);
assert(scalar("SELECT stock_qty FROM retail_store_products WHERE store_id='STORE-HCM' AND product_id='P-WATER'") === beforeStock + 5, 'Stock report was applied more than once');

const restockPayload = { c1: 'SMOKE-RESTOCK-1', c2: 'VM-HCM-01', c3: '1', c4: '1', c5: 'test' };
runMacro('retail-io-machine-restock', restockPayload);
runMacro('retail-io-machine-restock', restockPayload);

const salePayload = { c1: 'SMOKE-SALE-1', c2: 'VM-HCM-01', c3: '[{"position":1,"qty":1}]', c4: 'cash', c5: 'test' };
runMacro('retail-io-sale-report', salePayload);
runMacro('retail-io-sale-report', salePayload);

assert(scalar('SELECT COUNT(*) FROM retail_sales') === beforeSales + 2, 'Sales were duplicated or missing');
assert(scalar("SELECT quantity FROM retail_machine_positions WHERE machine_id='VM-HCM-01' AND position_no=1") === beforePosition - 1, 'Machine quantity does not match complete + restock + direct sale');
assert(db.pragma('integrity_check', { simple: true }) === 'ok', 'SQLite integrity check failed');

db.close();
console.log('Retail-chain smoke test passed.');
