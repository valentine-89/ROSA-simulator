const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = __dirname;
const DB_PATH = path.join(ROOT, 'sample.sqlite');
const STOREFRONT_PATH = path.join(ROOT, 'storefront_page.html');

for (const suffix of ['', '-shm', '-wal']) {
  try { fs.unlinkSync(DB_PATH + suffix); } catch (error) {}
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE retail_site (
  site_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  support_phone TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'VND'
);

CREATE TABLE retail_stores (
  store_id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES retail_site(site_id),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE retail_categories (
  category_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE retail_products (
  product_id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES retail_categories(category_id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'item',
  sale_price REAL NOT NULL DEFAULT 0,
  cost_price REAL NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE retail_store_products (
  store_id TEXT NOT NULL REFERENCES retail_stores(store_id),
  product_id TEXT NOT NULL REFERENCES retail_products(product_id),
  sale_price REAL,
  stock_qty REAL NOT NULL DEFAULT 0,
  reserved_qty REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, product_id)
);

CREATE TABLE retail_machines (
  machine_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES retail_stores(store_id),
  name TEXT NOT NULL,
  ioid TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'offline',
  last_seen_at INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE retail_machine_positions (
  machine_id TEXT NOT NULL REFERENCES retail_machines(machine_id),
  position_no INTEGER NOT NULL,
  product_id TEXT REFERENCES retail_products(product_id),
  capacity REAL NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 0,
  reserved_qty REAL NOT NULL DEFAULT 0,
  sale_price REAL,
  status TEXT NOT NULL DEFAULT 'enabled',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (machine_id, position_no)
);

CREATE TABLE retail_users (
  user_id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'customer',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE retail_order_links (
  link_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES retail_stores(store_id),
  machine_id TEXT REFERENCES retail_machines(machine_id),
  page_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  require_phone INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE retail_orders (
  order_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  order_code TEXT NOT NULL UNIQUE,
  link_id TEXT REFERENCES retail_order_links(link_id),
  store_id TEXT NOT NULL REFERENCES retail_stores(store_id),
  machine_id TEXT REFERENCES retail_machines(machine_id),
  customer_user_id TEXT REFERENCES retail_users(user_id),
  customer_phone TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT NOT NULL DEFAULT 'cod',
  subtotal REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT 'iot-page',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE retail_order_items (
  order_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES retail_orders(order_id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES retail_products(product_id),
  position_no INTEGER,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL
);

CREATE TABLE retail_sales (
  sale_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  order_id TEXT REFERENCES retail_orders(order_id),
  store_id TEXT NOT NULL REFERENCES retail_stores(store_id),
  machine_id TEXT REFERENCES retail_machines(machine_id),
  channel TEXT NOT NULL DEFAULT 'vending',
  payment_method TEXT NOT NULL DEFAULT 'cash',
  total REAL NOT NULL DEFAULT 0,
  sold_at INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE retail_sale_items (
  sale_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id TEXT NOT NULL REFERENCES retail_sales(sale_id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES retail_products(product_id),
  position_no INTEGER,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL
);

CREATE TABLE retail_inventory_movements (
  movement_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  store_id TEXT NOT NULL REFERENCES retail_stores(store_id),
  product_id TEXT NOT NULL REFERENCES retail_products(product_id),
  machine_id TEXT,
  position_no INTEGER,
  movement_type TEXT NOT NULL,
  quantity_delta REAL NOT NULL,
  stock_after REAL,
  reference_id TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE (request_id, store_id, product_id, movement_type)
);

CREATE TABLE retail_device_requests (
  request_id TEXT PRIMARY KEY,
  device_type TEXT NOT NULL,
  device_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  message TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE system_pages (
  page_id TEXT PRIMARY KEY,
  html TEXT NOT NULL,
  require_email INTEGER NOT NULL DEFAULT 0,
  require_phone INTEGER NOT NULL DEFAULT 0,
  sync_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT ''
);

CREATE TABLE system_cmds (
  cmd_id TEXT PRIMARY KEY,
  command_template TEXT NOT NULL,
  require_email INTEGER NOT NULL DEFAULT 0,
  require_phone INTEGER NOT NULL DEFAULT 0,
  sync_id TEXT NOT NULL,
  params_schema TEXT,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE system_macros (
  name TEXT PRIMARY KEY,
  comment TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_store_products_stock ON retail_store_products(store_id, enabled, stock_qty, min_stock);
CREATE INDEX idx_products_category ON retail_products(category_id, enabled, name);
CREATE INDEX idx_machine_positions_product ON retail_machine_positions(product_id, machine_id);
CREATE INDEX idx_orders_created ON retail_orders(created_at DESC);
CREATE INDEX idx_orders_status_machine ON retail_orders(status, machine_id, created_at);
CREATE INDEX idx_sales_sold_at ON retail_sales(sold_at DESC);
CREATE INDEX idx_sales_store_time ON retail_sales(store_id, sold_at DESC);
CREATE INDEX idx_users_search ON retail_users(name, phone, email);
CREATE INDEX idx_inventory_movements_time ON retail_inventory_movements(created_at DESC);
`);

const now = Date.now();
const day = 86400000;

db.prepare(`INSERT INTO retail_site VALUES (?, ?, ?, ?, ?, ?)`).run(
  'SITE-DEMO', 'ROSA Retail Demo', 'ROSA Mart', 'TP. Hồ Chí Minh', '1900 6868', 'VND'
);

const insertStore = db.prepare(`INSERT INTO retail_stores VALUES (?, 'SITE-DEMO', ?, ?, ?, 1, ?)`);
insertStore.run('STORE-HCM', 'HCM01', 'ROSA Mart Nguyễn Huệ', '42 Nguyễn Huệ, Quận 1, TP.HCM', now - 120 * day);
insertStore.run('STORE-TD', 'TDC01', 'ROSA Mart Thủ Đức', '18 Võ Văn Ngân, TP. Thủ Đức', now - 90 * day);

const categories = [
  ['CAT-DRINK', 'Đồ uống', 'Nước giải khát, cà phê và sữa', 1],
  ['CAT-SNACK', 'Đồ ăn nhanh', 'Bánh, snack và thực phẩm tiện lợi', 2],
  ['CAT-CARE', 'Chăm sóc cá nhân', 'Sản phẩm thiết yếu hằng ngày', 3],
  ['CAT-HOME', 'Gia dụng nhỏ', 'Vật dụng tiện ích', 4]
];
const insertCategory = db.prepare(`INSERT INTO retail_categories VALUES (?, ?, ?, ?, 1)`);
categories.forEach((row) => insertCategory.run(...row));

const products = [
  ['P-WATER', 'DRK-WATER-500', '8938505974190', 'CAT-DRINK', 'Nước khoáng 500ml', 'Nước khoáng tinh khiết, chai nhỏ tiện mang theo.', 'https://images.unsplash.com/photo-1606168094336-48f205276929?auto=format&fit=crop&w=640&q=85', 'chai', 10000, 5500],
  ['P-COLA', 'DRK-COLA-330', '8934588232112', 'CAT-DRINK', 'Nước ngọt Cola 330ml', 'Lon lạnh, vị cola truyền thống.', 'https://images.unsplash.com/photo-1629203851122-3726ecdf080e?auto=format&fit=crop&w=640&q=85', 'lon', 15000, 9000],
  ['P-COFFEE', 'DRK-COFFEE-250', '8936025776620', 'CAT-DRINK', 'Cà phê sữa chai', 'Cà phê rang xay và sữa, dùng lạnh.', 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=640&q=85', 'chai', 25000, 14500],
  ['P-MILK', 'DRK-MILK-180', '8934673573105', 'CAT-DRINK', 'Sữa tươi 180ml', 'Sữa tươi tiệt trùng ít đường.', 'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=640&q=85', 'hộp', 14000, 9200],
  ['P-CHIPS', 'SNK-CHIPS-45', '8936079120875', 'CAT-SNACK', 'Snack khoai tây', 'Khoai tây lát giòn vị muối nhẹ.', 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=640&q=85', 'gói', 18000, 10500],
  ['P-COOKIE', 'SNK-COOKIE-80', '8935001703353', 'CAT-SNACK', 'Bánh quy bơ', 'Bánh quy giòn thơm bơ, gói nhỏ.', 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?auto=format&fit=crop&w=640&q=85', 'gói', 22000, 13000],
  ['P-TISSUE', 'CARE-TISSUE-10', '8935030211003', 'CAT-CARE', 'Khăn giấy bỏ túi', 'Khăn giấy mềm ba lớp, gói 10 tờ.', 'https://images.unsplash.com/photo-1584556812952-905ffd0c611a?auto=format&fit=crop&w=640&q=85', 'gói', 12000, 6500],
  ['P-SANITIZER', 'CARE-SANI-60', '8938511691104', 'CAT-CARE', 'Gel rửa tay 60ml', 'Gel làm sạch tay nhanh, chai nhỏ.', 'https://images.unsplash.com/photo-1584483766114-2cea6facdf57?auto=format&fit=crop&w=640&q=85', 'chai', 30000, 17500]
];
const insertProduct = db.prepare(`INSERT INTO retail_products (product_id,sku,barcode,category_id,name,description,image_url,unit,sale_price,cost_price,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`);
products.forEach((row) => insertProduct.run(...row, now - 45 * day, now - day));

const stockMap = {
  'STORE-HCM': [68, 42, 18, 35, 27, 6, 21, 9],
  'STORE-TD': [44, 31, 11, 26, 19, 15, 12, 5]
};
const insertStock = db.prepare(`INSERT INTO retail_store_products VALUES (?, ?, NULL, ?, 0, ?, 1, ?)`);
Object.keys(stockMap).forEach((storeId) => {
  products.forEach((product, index) => insertStock.run(storeId, product[0], stockMap[storeId][index], index === 0 ? 20 : 10, now - index * 3600000));
});

const insertMachine = db.prepare(`INSERT INTO retail_machines VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
insertMachine.run('VM-HCM-01', 'STORE-HCM', 'Máy Nguyễn Huệ 01', '<<ioid>>', 'Sảnh tầng 1', 'online', now - 4 * 60000, now - 60 * day, now - 4 * 60000);
insertMachine.run('VM-HCM-02', 'STORE-HCM', 'Máy Nguyễn Huệ 02', 'IO-DEMO-02', 'Khu văn phòng tầng 3', 'warning', now - 34 * 60000, now - 50 * day, now - 34 * 60000);
insertMachine.run('VM-TD-01', 'STORE-TD', 'Máy Thủ Đức 01', 'IO-DEMO-03', 'Sảnh thư viện', 'offline', now - 26 * 3600000, now - 40 * day, now - 26 * 3600000);

const insertPosition = db.prepare(`INSERT INTO retail_machine_positions VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`);
[
  ['VM-HCM-01',1,'P-WATER',12,9,'enabled'],['VM-HCM-01',2,'P-COLA',12,7,'enabled'],['VM-HCM-01',3,'P-COFFEE',8,5,'enabled'],['VM-HCM-01',4,'P-MILK',8,3,'enabled'],['VM-HCM-01',5,'P-CHIPS',10,8,'enabled'],['VM-HCM-01',6,'P-COOKIE',10,2,'enabled'],
  ['VM-HCM-02',1,'P-WATER',12,2,'enabled'],['VM-HCM-02',2,'P-COLA',12,1,'enabled'],['VM-HCM-02',3,'P-CHIPS',10,3,'enabled'],['VM-HCM-02',4,'P-TISSUE',10,0,'disabled'],
  ['VM-TD-01',1,'P-WATER',12,6,'enabled'],['VM-TD-01',2,'P-COLA',12,5,'enabled'],['VM-TD-01',3,'P-COOKIE',10,4,'enabled'],['VM-TD-01',4,'P-SANITIZER',8,2,'enabled']
].forEach((row) => insertPosition.run(...row, now - 2 * 3600000));

const users = [
  ['USR-ADMIN','0901000001','Nguyễn Minh Anh','minhanh@rosa.vn','admin'],
  ['USR-STAFF-01','0901000002','Trần Quốc Bảo','bao@rosa.vn','staff'],
  ['USR-STAFF-02','0901000003','Lê Thu Hà','ha@rosa.vn','staff'],
  ['USR-CUST-01','0912345678','Phạm Gia Huy','huy@example.com','customer'],
  ['USR-CUST-02','0987654321','Vũ Thanh Mai','mai@example.com','customer'],
  ['USR-CUST-03','0938123456','Đỗ Khánh Linh','linh@example.com','customer']
];
const insertUser = db.prepare(`INSERT INTO retail_users VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`);
users.forEach((row, index) => insertUser.run(...row, now - (70 - index * 4) * day, now - index * day));

const storefrontHtml = fs.readFileSync(STOREFRONT_PATH, 'utf8');
const insertLink = db.prepare(`INSERT INTO retail_order_links VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
insertLink.run('SHOP-HCM', 'STORE-HCM', null, 'retail-shop-hcm', 'ROSA Mart Nguyễn Huệ', 'Thực phẩm và đồ dùng tiện lợi, sẵn sàng tại cửa hàng.', 1, now - 20 * day, now);
insertLink.run('SHOP-VM01', 'STORE-HCM', 'VM-HCM-01', 'retail-vm-hcm-01', 'Máy Nguyễn Huệ 01', 'Chọn trước sản phẩm và nhận trực tiếp tại máy.', 1, now - 15 * day, now);

function pageMeta(linkId, storeId, machineId) {
  return JSON.stringify({
    pageType: 'retail-storefront',
    hideLink: false,
    publicApi: {
      stream: true,
      maxBodyBytes: 4096,
      rateLimit: { limit: 80, windowMs: 60000 },
      context: { link_id: linkId, store_id: storeId, machine_id: machineId || '' },
      macros: {
        'retail-link-state': {},
        'retail-link-create-order': {
          params: {
            cart_json: { type: 'string', required: true, maxLength: 2048 },
            client_request_id: { type: 'string', required: true, maxLength: 96, pattern: '^[A-Za-z0-9._:-]+$' },
            payment_method: { type: 'string', required: true, enum: ['cod', 'cash'] },
            note: { type: 'string', required: false, maxLength: 240 }
          }
        }
      }
    }
  });
}

const insertPage = db.prepare(`INSERT INTO system_pages VALUES (?, ?, 0, 1, '<<syncid>>', 1, ?, ?)`);
insertPage.run('retail-shop-hcm', storefrontHtml, 'ROSA Mart Nguyễn Huệ', pageMeta('SHOP-HCM', 'STORE-HCM', ''));
insertPage.run('retail-vm-hcm-01', storefrontHtml, 'Máy Nguyễn Huệ 01', pageMeta('SHOP-VM01', 'STORE-HCM', 'VM-HCM-01'));

const insertOrder = db.prepare(`INSERT INTO retail_orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insertOrderItem = db.prepare(`INSERT INTO retail_order_items (order_id,product_id,position_no,quantity,unit_price,line_total) VALUES (?,?,?,?,?,?)`);
const insertSale = db.prepare(`INSERT INTO retail_sales VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insertSaleItem = db.prepare(`INSERT INTO retail_sale_items (sale_id,product_id,position_no,quantity,unit_price,line_total) VALUES (?,?,?,?,?,?)`);

const saleSeed = [
  [0,'P-WATER',2,10000,'fulfilled','vending'],[0,'P-COLA',1,15000,'fulfilled','iot-page'],[1,'P-COFFEE',2,25000,'fulfilled','vending'],[1,'P-CHIPS',2,18000,'fulfilled','iot-page'],
  [2,'P-WATER',3,10000,'fulfilled','vending'],[2,'P-COOKIE',1,22000,'fulfilled','iot-page'],[3,'P-MILK',2,14000,'fulfilled','vending'],[3,'P-COLA',3,15000,'fulfilled','vending'],
  [4,'P-SANITIZER',1,30000,'fulfilled','iot-page'],[4,'P-CHIPS',3,18000,'fulfilled','vending'],[5,'P-WATER',4,10000,'fulfilled','vending'],[5,'P-COFFEE',1,25000,'fulfilled','iot-page'],
  [6,'P-COLA',4,15000,'fulfilled','vending'],[6,'P-COOKIE',2,22000,'fulfilled','iot-page'],[0,'P-MILK',1,14000,'pending','iot-page'],[0,'P-CHIPS',1,18000,'confirmed','iot-page']
];

saleSeed.forEach((row, index) => {
  const [daysAgo, productId, qty, price, status, channel] = row;
  const created = now - daysAgo * day - (index % 5) * 37 * 60000;
  const orderId = `ORDER-SEED-${String(index + 1).padStart(3, '0')}`;
  const orderCode = `R${new Date(created).toISOString().slice(5,10).replace('-','')}${String(index + 1).padStart(3, '0')}`;
  const user = users[3 + (index % 3)];
  insertOrder.run(orderId, `REQ-SEED-${index + 1}`, orderCode, channel === 'iot-page' ? 'SHOP-HCM' : null, index % 4 === 0 ? 'STORE-TD' : 'STORE-HCM', channel === 'vending' ? 'VM-HCM-01' : null, user[0], user[1], user[2], status, 'cash', price * qty, price * qty, '', channel, created, created, status === 'fulfilled' ? created + 120000 : null);
  insertOrderItem.run(orderId, productId, channel === 'vending' ? (index % 6) + 1 : null, qty, price, price * qty);
  if (status === 'fulfilled') {
    const saleId = `SALE-SEED-${String(index + 1).padStart(3, '0')}`;
    insertSale.run(saleId, `SALE-REQ-SEED-${index + 1}`, orderId, index % 4 === 0 ? 'STORE-TD' : 'STORE-HCM', channel === 'vending' ? 'VM-HCM-01' : null, channel, 'cash', price * qty, created + 120000, 'Dữ liệu mẫu');
    insertSaleItem.run(saleId, productId, channel === 'vending' ? (index % 6) + 1 : null, qty, price, price * qty);
  }
});

function addMacro(name, comment, source) {
  db.prepare(`INSERT INTO system_macros (name, comment, source, enabled) VALUES (?, ?, ?, 1)`).run(name, comment, source.trim());
}

addMacro('retail-admin-overview', 'Dashboard overview: KPIs, seven-day revenue, store performance, recent orders and operational alerts.', String.raw`
WITH RECURSIVE days(d) AS (
  SELECT date('now','localtime','-6 days')
  UNION ALL SELECT date(d,'+1 day') FROM days WHERE d < date('now','localtime')
)
SELECT 'kpi' AS row_type, 'summary' AS id, 'Tổng quan' AS label, '' AS sub_label, 'ok' AS status,
       COALESCE((SELECT SUM(total) FROM retail_sales WHERE date(sold_at/1000,'unixepoch','localtime')=date('now','localtime')),0) AS value1,
       COALESCE((SELECT COUNT(*) FROM retail_orders WHERE date(created_at/1000,'unixepoch','localtime')=date('now','localtime')),0) AS value2,
       COALESCE((SELECT COUNT(*) FROM retail_machines WHERE enabled<>0 AND status='online'),0) AS value3,
       COALESCE((SELECT COUNT(*) FROM retail_store_products WHERE enabled<>0 AND stock_qty-reserved_qty<=min_stock),0) AS value4,
       CASE WHEN COALESCE((SELECT SUM(total) FROM retail_sales WHERE date(sold_at/1000,'unixepoch','localtime')=date('now','localtime','-1 day')),0)=0 THEN 0
            ELSE ROUND(((SELECT COALESCE(SUM(total),0) FROM retail_sales WHERE date(sold_at/1000,'unixepoch','localtime')=date('now','localtime')) /
                        (SELECT SUM(total) FROM retail_sales WHERE date(sold_at/1000,'unixepoch','localtime')=date('now','localtime','-1 day')) - 1) * 100,1) END AS value5,
       COALESCE((SELECT COUNT(*) FROM retail_machines WHERE enabled<>0 AND status<>'online'),0) AS value6,
       unixepoch('now')*1000 AS ts, '' AS detail
UNION ALL
SELECT 'trend', d, strftime('%d/%m',d), '', 'ok',
       COALESCE((SELECT SUM(s.total) FROM retail_sales s WHERE date(s.sold_at/1000,'unixepoch','localtime')=d),0),
       COALESCE((SELECT COUNT(*) FROM retail_sales s WHERE date(s.sold_at/1000,'unixepoch','localtime')=d),0),
       0,0,0,0, unixepoch(d)*1000, '' FROM days
UNION ALL
SELECT 'store', st.store_id, st.name, st.address, CASE WHEN st.enabled<>0 THEN 'enabled' ELSE 'disabled' END,
       COALESCE((SELECT SUM(s.total) FROM retail_sales s WHERE s.store_id=st.store_id AND s.sold_at>=unixepoch('now','-7 days')*1000),0),
       COALESCE((SELECT COUNT(*) FROM retail_orders o WHERE o.store_id=st.store_id AND o.created_at>=unixepoch('now','-7 days')*1000),0),
       COALESCE((SELECT COUNT(*) FROM retail_store_products sp WHERE sp.store_id=st.store_id AND sp.stock_qty-sp.reserved_qty<=sp.min_stock),0),
       0,0,0, st.created_at, '' FROM retail_stores st
WHERE st.enabled<>0 AND (COALESCE(:store_id,'')='' OR st.store_id=:store_id)
UNION ALL
SELECT 'order', o.order_id, o.order_code, COALESCE(NULLIF(o.customer_name,''),NULLIF(o.customer_phone,''),'Khách lẻ'), o.status,
       o.total, (SELECT COALESCE(SUM(quantity),0) FROM retail_order_items oi WHERE oi.order_id=o.order_id), 0,0,0,0, o.created_at,
       json_object('store_id',o.store_id,'machine_id',COALESCE(o.machine_id,''),'channel',o.channel)
FROM (SELECT * FROM retail_orders WHERE (COALESCE(:store_id,'')='' OR store_id=:store_id) ORDER BY created_at DESC LIMIT 8) o
UNION ALL
SELECT 'alert', sp.store_id||':'||sp.product_id, p.name,
       st.name||' · còn '||ROUND(sp.stock_qty-sp.reserved_qty,1)||' '||p.unit,
       CASE WHEN sp.stock_qty-sp.reserved_qty<=0 THEN 'critical' ELSE 'warning' END,
       sp.stock_qty-sp.reserved_qty, sp.min_stock,0,0,0,0,sp.updated_at,
       json_object('store_id',sp.store_id,'product_id',sp.product_id)
FROM retail_store_products sp JOIN retail_products p ON p.product_id=sp.product_id JOIN retail_stores st ON st.store_id=sp.store_id
WHERE sp.enabled<>0 AND sp.stock_qty-sp.reserved_qty<=sp.min_stock AND (COALESCE(:store_id,'')='' OR sp.store_id=:store_id)
UNION ALL
SELECT 'alert', m.machine_id, m.name, m.location, CASE WHEN m.status='offline' THEN 'critical' ELSE 'warning' END,
       0,0,0,0,0,0,m.last_seen_at,json_object('machine_id',m.machine_id,'store_id',m.store_id)
FROM retail_machines m WHERE m.enabled<>0 AND m.status<>'online' AND (COALESCE(:store_id,'')='' OR m.store_id=:store_id);
`);

addMacro('retail-admin-machines', 'Machine manager state with per-machine availability and every vending position.', String.raw`
SELECT 'machine' AS row_type, m.machine_id AS id, '' AS parent_id, m.name AS label,
       st.name||' · '||m.location AS sub_label, m.status,
       COUNT(mp.position_no) AS value1, COALESCE(SUM(mp.quantity-mp.reserved_qty),0) AS value2,
       COALESCE(SUM(mp.capacity),0) AS value3, 0 AS value4, m.last_seen_at AS ts,
       json_object('store_id',m.store_id,'ioid',m.ioid,'location',m.location,'enabled',m.enabled) AS detail
FROM retail_machines m JOIN retail_stores st ON st.store_id=m.store_id
LEFT JOIN retail_machine_positions mp ON mp.machine_id=m.machine_id
WHERE (COALESCE(:store_id,'')='' OR m.store_id=:store_id)
GROUP BY m.machine_id
UNION ALL
SELECT 'position', CAST(mp.position_no AS TEXT), mp.machine_id, COALESCE(p.name,'Chưa gắn sản phẩm'),
       COALESCE(p.sku,''), mp.status, mp.quantity-mp.reserved_qty, mp.capacity,
       COALESCE(mp.sale_price,p.sale_price,0), 0, mp.updated_at,
       json_object('product_id',COALESCE(mp.product_id,''),'image_url',COALESCE(p.image_url,''),'unit',COALESCE(p.unit,''))
FROM retail_machine_positions mp JOIN retail_machines m ON m.machine_id=mp.machine_id
LEFT JOIN retail_products p ON p.product_id=mp.product_id
WHERE (COALESCE(:store_id,'')='' OR m.store_id=:store_id)
ORDER BY row_type, label, parent_id, id;
`);

addMacro('retail-admin-inventory', 'Inventory catalog with category rows and per-store stock, reservation, threshold, price and product media.', String.raw`
SELECT 'category' AS row_type, c.category_id AS id, c.name AS label, c.description AS sub_label,
       CASE WHEN c.enabled<>0 THEN 'enabled' ELSE 'disabled' END AS status,
       COUNT(DISTINCT p.product_id) AS value1,0 AS value2,0 AS value3,0 AS value4,0 AS value5,
       0 AS ts, '{}' AS detail
FROM retail_categories c LEFT JOIN retail_products p ON p.category_id=c.category_id AND p.enabled<>0
WHERE c.enabled<>0 GROUP BY c.category_id
UNION ALL
SELECT 'product', p.product_id, p.name, c.name,
       CASE WHEN sp.stock_qty-sp.reserved_qty<=0 THEN 'out' WHEN sp.stock_qty-sp.reserved_qty<=sp.min_stock THEN 'low' ELSE 'ok' END,
       sp.stock_qty, sp.reserved_qty, sp.min_stock, COALESCE(sp.sale_price,p.sale_price), p.cost_price,
       sp.updated_at,
       json_object('sku',p.sku,'barcode',p.barcode,'image_url',p.image_url,'unit',p.unit,'store_id',sp.store_id,'store_name',st.name,'description',p.description)
FROM retail_store_products sp JOIN retail_products p ON p.product_id=sp.product_id
JOIN retail_categories c ON c.category_id=p.category_id JOIN retail_stores st ON st.store_id=sp.store_id
WHERE p.enabled<>0 AND sp.enabled<>0
  AND (COALESCE(:store_id,'')='' OR sp.store_id=:store_id)
  AND (COALESCE(:category_id,'')='' OR p.category_id=:category_id)
  AND (COALESCE(:search,'')='' OR lower(p.name||' '||p.sku||' '||p.barcode) LIKE '%'||lower(:search)||'%')
ORDER BY row_type, sub_label, label LIMIT COALESCE(CAST(NULLIF(:limit,'') AS INTEGER),100);
`);

addMacro('retail-admin-sales', 'Sales reporting with KPIs, 14-day trend, top products and order operations table.', String.raw`
WITH RECURSIVE days(d) AS (
  SELECT date('now','localtime','-13 days')
  UNION ALL SELECT date(d,'+1 day') FROM days WHERE d<date('now','localtime')
)
SELECT 'kpi' AS row_type,'summary' AS id,'Báo cáo' AS label,'' AS sub_label,'ok' AS status,
       COALESCE((SELECT SUM(total) FROM retail_sales WHERE sold_at>=unixepoch('now','-14 days')*1000 AND (COALESCE(:store_id,'')='' OR store_id=:store_id)),0) AS value1,
       COALESCE((SELECT COUNT(*) FROM retail_orders WHERE created_at>=unixepoch('now','-14 days')*1000 AND (COALESCE(:store_id,'')='' OR store_id=:store_id)),0) AS value2,
       COALESCE((SELECT AVG(total) FROM retail_sales WHERE sold_at>=unixepoch('now','-14 days')*1000 AND (COALESCE(:store_id,'')='' OR store_id=:store_id)),0) AS value3,
       COALESCE((SELECT COUNT(*) FROM retail_orders WHERE status IN ('pending','confirmed','processing') AND (COALESCE(:store_id,'')='' OR store_id=:store_id)),0) AS value4,
       0 AS value5,0 AS value6,unixepoch('now')*1000 AS ts,'' AS detail
UNION ALL
SELECT 'trend',d,strftime('%d/%m',d),'','ok',
       COALESCE((SELECT SUM(s.total) FROM retail_sales s WHERE date(s.sold_at/1000,'unixepoch','localtime')=d AND (COALESCE(:store_id,'')='' OR s.store_id=:store_id)),0),
       COALESCE((SELECT COUNT(*) FROM retail_sales s WHERE date(s.sold_at/1000,'unixepoch','localtime')=d AND (COALESCE(:store_id,'')='' OR s.store_id=:store_id)),0),
       0,0,0,0,unixepoch(d)*1000,'' FROM days
UNION ALL
SELECT 'product',x.product_id,x.name,x.sku,'ok',x.revenue,x.quantity,0,0,0,0,x.last_sale,json_object('image_url',x.image_url)
FROM (SELECT p.product_id,p.name,p.sku,p.image_url,SUM(si.line_total) AS revenue,SUM(si.quantity) AS quantity,MAX(s.sold_at) AS last_sale
      FROM retail_sale_items si JOIN retail_sales s ON s.sale_id=si.sale_id JOIN retail_products p ON p.product_id=si.product_id
      WHERE s.sold_at>=unixepoch('now','-30 days')*1000 AND (COALESCE(:store_id,'')='' OR s.store_id=:store_id)
      GROUP BY p.product_id ORDER BY revenue DESC LIMIT 6) x
UNION ALL
SELECT 'order',o.order_id,o.order_code,COALESCE(NULLIF(o.customer_name,''),NULLIF(o.customer_phone,''),'Khách lẻ'),o.status,
       o.total,(SELECT COALESCE(SUM(quantity),0) FROM retail_order_items oi WHERE oi.order_id=o.order_id),0,0,0,0,o.created_at,
       json_object('phone',o.customer_phone,'channel',o.channel,'store_name',(SELECT name FROM retail_stores WHERE store_id=o.store_id),'machine_id',COALESCE(o.machine_id,''))
FROM (SELECT * FROM retail_orders
      WHERE (COALESCE(:store_id,'')='' OR store_id=:store_id) AND (COALESCE(:status,'')='' OR status=:status)
      ORDER BY created_at DESC LIMIT COALESCE(CAST(NULLIF(:limit,'') AS INTEGER),100)) o;
`);

addMacro('retail-admin-users', 'Search and paginate customers, staff and administrators with order aggregates.', String.raw`
SELECT 'user' AS row_type,u.user_id AS id,u.name AS label,u.phone,u.email,u.role,u.status,
       COUNT(DISTINCT o.order_id) AS value1,COALESCE(SUM(CASE WHEN o.status='fulfilled' THEN o.total ELSE 0 END),0) AS value2,
       MAX(o.created_at) AS ts
FROM retail_users u LEFT JOIN retail_orders o ON o.customer_user_id=u.user_id
WHERE COALESCE(:search,'')='' OR lower(u.name||' '||u.phone||' '||u.email) LIKE '%'||lower(:search)||'%'
GROUP BY u.user_id ORDER BY u.updated_at DESC
LIMIT COALESCE(CAST(NULLIF(:limit,'') AS INTEGER),100) OFFSET COALESCE(CAST(NULLIF(:offset,'') AS INTEGER),0);
`);

addMacro('retail-admin-links', 'List secure storefront links and their store or vending-machine scope.', String.raw`
SELECT 'link' AS row_type,l.page_id AS id,l.title AS label,l.subtitle AS sub_label,
       CASE WHEN l.enabled<>0 THEN 'enabled' ELSE 'disabled' END AS status,l.updated_at AS ts,
       json_object('link_id',l.link_id,'store_id',l.store_id,'store_name',st.name,'machine_id',COALESCE(l.machine_id,''),
                   'scope',CASE WHEN l.machine_id IS NULL OR l.machine_id='' THEN st.name ELSE COALESCE(m.name,l.machine_id) END,
                   'require_phone',l.require_phone,'ioid',COALESCE(NULLIF(m.ioid,''),:ioid)) AS detail
FROM retail_order_links l JOIN retail_stores st ON st.store_id=l.store_id
LEFT JOIN retail_machines m ON m.machine_id=l.machine_id
WHERE (COALESCE(:store_id,'')='' OR l.store_id=:store_id)
ORDER BY l.updated_at DESC;
`);

addMacro('retail-admin-save-product', 'Create or update a catalog product and initialize inventory at every enabled store.', String.raw`
INSERT INTO retail_products (product_id,sku,barcode,category_id,name,description,image_url,unit,sale_price,cost_price,enabled,created_at,updated_at)
SELECT trim(:product_id),trim(:sku),trim(COALESCE(:barcode,'')),trim(:category_id),trim(:name),trim(COALESCE(:description,'')),
       trim(COALESCE(:image_url,'')),trim(COALESCE(NULLIF(:unit,''),'item')),MAX(0,CAST(COALESCE(NULLIF(:sale_price,''),'0') AS REAL)),
       MAX(0,CAST(COALESCE(NULLIF(:cost_price,''),'0') AS REAL)),1,unixepoch('now')*1000,unixepoch('now')*1000
WHERE trim(COALESCE(:product_id,''))<>'' AND trim(COALESCE(:sku,''))<>'' AND trim(COALESCE(:name,''))<>''
  AND EXISTS (SELECT 1 FROM retail_categories WHERE category_id=trim(:category_id) AND enabled<>0)
ON CONFLICT(product_id) DO UPDATE SET sku=excluded.sku,barcode=excluded.barcode,category_id=excluded.category_id,name=excluded.name,
  description=excluded.description,image_url=excluded.image_url,unit=excluded.unit,sale_price=excluded.sale_price,cost_price=excluded.cost_price,enabled=1,updated_at=excluded.updated_at;
INSERT OR IGNORE INTO retail_store_products (store_id,product_id,sale_price,stock_qty,reserved_qty,min_stock,enabled,updated_at)
SELECT store_id,trim(:product_id),NULL,0,0,5,1,unixepoch('now')*1000 FROM retail_stores
WHERE enabled<>0 AND EXISTS (SELECT 1 FROM retail_products WHERE product_id=trim(:product_id));
SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_products WHERE product_id=trim(:product_id)) THEN 'OK' ELSE 'FAIL' END AS c1,
       trim(COALESCE(:product_id,'')) AS product_id,
       CASE WHEN EXISTS (SELECT 1 FROM retail_products WHERE product_id=trim(:product_id)) THEN 'Đã lưu sản phẩm.' ELSE 'Dữ liệu sản phẩm không hợp lệ.' END AS message;
`);

addMacro('retail-admin-adjust-stock', 'Idempotent admin inventory adjustment with movement ledger.', String.raw`
DROP TABLE IF EXISTS temp._retail_adjust_input;
CREATE TEMP TABLE _retail_adjust_input AS
SELECT trim(COALESCE(:request_id,'')) AS request_id,trim(COALESCE(:store_id,'')) AS store_id,trim(COALESCE(:product_id,'')) AS product_id,
       CAST(COALESCE(NULLIF(:quantity_delta,''),'0') AS REAL) AS quantity_delta,
       trim(COALESCE(NULLIF(:movement_type,''),'manual_adjustment')) AS movement_type,
       trim(COALESCE(:note,'')) AS note,unixepoch('now')*1000 AS now_ms,
       CASE WHEN trim(COALESCE(:request_id,''))='' THEN 'MISSING_REQUEST_ID'
            WHEN CAST(COALESCE(NULLIF(:quantity_delta,''),'0') AS REAL)=0 THEN 'ZERO_QUANTITY'
            WHEN NOT EXISTS (SELECT 1 FROM retail_store_products WHERE store_id=trim(:store_id) AND product_id=trim(:product_id)) THEN 'PRODUCT_NOT_IN_STORE'
            WHEN EXISTS (SELECT 1 FROM retail_inventory_movements WHERE request_id=trim(:request_id) AND store_id=trim(:store_id) AND product_id=trim(:product_id)) THEN 'DUPLICATE'
            ELSE 'OK' END AS validation_code;
INSERT INTO retail_inventory_movements (movement_id,request_id,store_id,product_id,machine_id,position_no,movement_type,quantity_delta,stock_after,reference_id,note,created_at)
SELECT 'MOV-'||request_id,request_id,store_id,product_id,NULL,NULL,movement_type,quantity_delta,
       (SELECT stock_qty FROM retail_store_products sp WHERE sp.store_id=i.store_id AND sp.product_id=i.product_id)+quantity_delta,
       '',note,now_ms FROM _retail_adjust_input i WHERE validation_code='OK';
UPDATE retail_store_products
SET stock_qty=MAX(0,stock_qty+(SELECT quantity_delta FROM _retail_adjust_input)),updated_at=(SELECT now_ms FROM _retail_adjust_input)
WHERE store_id=(SELECT store_id FROM _retail_adjust_input) AND product_id=(SELECT product_id FROM _retail_adjust_input)
  AND (SELECT validation_code FROM _retail_adjust_input)='OK';
SELECT CASE WHEN validation_code IN ('OK','DUPLICATE') THEN 'OK' ELSE 'FAIL' END AS c1,
       validation_code AS code,request_id,store_id,product_id,
       COALESCE((SELECT stock_qty FROM retail_store_products sp WHERE sp.store_id=i.store_id AND sp.product_id=i.product_id),0) AS stock_qty
FROM _retail_adjust_input i;
DROP TABLE IF EXISTS temp._retail_adjust_input;
`);

addMacro('retail-admin-save-machine', 'Create or update a vending machine without changing historical position or sales data.', String.raw`
INSERT INTO retail_machines (machine_id,store_id,name,ioid,location,status,last_seen_at,enabled,created_at,updated_at)
SELECT trim(:machine_id),trim(:store_id),trim(:name),trim(COALESCE(:ioid,'')),trim(COALESCE(:location,'')),
       CASE WHEN :status IN ('online','warning','offline') THEN :status ELSE 'offline' END,
       unixepoch('now')*1000,1,unixepoch('now')*1000,unixepoch('now')*1000
WHERE trim(COALESCE(:machine_id,''))<>'' AND trim(COALESCE(:name,''))<>''
  AND EXISTS (SELECT 1 FROM retail_stores WHERE store_id=trim(:store_id) AND enabled<>0)
ON CONFLICT(machine_id) DO UPDATE SET store_id=excluded.store_id,name=excluded.name,ioid=excluded.ioid,location=excluded.location,
  status=excluded.status,enabled=1,updated_at=excluded.updated_at;
SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_machines WHERE machine_id=trim(:machine_id)) THEN 'OK' ELSE 'FAIL' END AS c1,
       trim(COALESCE(:machine_id,'')) AS machine_id;
`);

addMacro('retail-admin-save-user', 'Create or update a customer, staff member or administrator.', String.raw`
INSERT INTO retail_users (user_id,phone,name,email,role,status,created_at,updated_at)
SELECT trim(:user_id),trim(:phone),trim(:name),trim(COALESCE(:email,'')),
       CASE WHEN :role IN ('customer','staff','admin') THEN :role ELSE 'customer' END,
       CASE WHEN :status IN ('active','disabled') THEN :status ELSE 'active' END,
       unixepoch('now')*1000,unixepoch('now')*1000
WHERE trim(COALESCE(:user_id,''))<>'' AND trim(COALESCE(:phone,''))<>'' AND trim(COALESCE(:name,''))<>''
ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,name=excluded.name,email=excluded.email,role=excluded.role,status=excluded.status,updated_at=excluded.updated_at;
SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_users WHERE user_id=trim(:user_id)) THEN 'OK' ELSE 'FAIL' END AS c1,
       trim(COALESCE(:user_id,'')) AS user_id;
`);

addMacro('retail-admin-save-link', 'Create or update a secure retail storefront and its scoped iot-page public API allowlist.', String.raw`
INSERT INTO retail_order_links (link_id,store_id,machine_id,page_id,title,subtitle,require_phone,enabled,created_at,updated_at)
SELECT trim(:link_id),trim(:store_id),NULLIF(trim(COALESCE(:machine_id,'')),''),trim(:page_id),trim(:title),trim(COALESCE(:subtitle,'')),
       CASE WHEN CAST(COALESCE(NULLIF(:require_phone,''),'1') AS INTEGER)<>0 THEN 1 ELSE 0 END,
       CASE WHEN CAST(COALESCE(NULLIF(:enabled,''),'1') AS INTEGER)<>0 THEN 1 ELSE 0 END,
       unixepoch('now')*1000,unixepoch('now')*1000
WHERE trim(COALESCE(:link_id,''))<>'' AND trim(COALESCE(:page_id,''))<>'' AND trim(COALESCE(:title,''))<>''
  AND EXISTS (SELECT 1 FROM retail_stores WHERE store_id=trim(:store_id))
  AND (trim(COALESCE(:machine_id,''))='' OR EXISTS (SELECT 1 FROM retail_machines WHERE machine_id=trim(:machine_id) AND store_id=trim(:store_id)))
ON CONFLICT(link_id) DO UPDATE SET store_id=excluded.store_id,machine_id=excluded.machine_id,page_id=excluded.page_id,title=excluded.title,
  subtitle=excluded.subtitle,require_phone=excluded.require_phone,enabled=excluded.enabled,updated_at=excluded.updated_at;
INSERT INTO system_pages (page_id,html,require_email,require_phone,sync_id,enabled,title,meta)
SELECT l.page_id,
       COALESCE((SELECT html FROM system_pages WHERE page_id='retail-shop-hcm' LIMIT 1),'<!doctype html><meta charset="utf-8"><title>Retail</title><main>Retail storefront</main>'),
       0,l.require_phone,COALESCE(NULLIF(:sync_id,''),'<<syncid>>'),l.enabled,l.title,
       json_object('pageType','retail-storefront','hideLink',json('false'),'publicApi',json_object(
         'stream',json('true'),'maxBodyBytes',4096,'rateLimit',json_object('limit',80,'windowMs',60000),
         'context',json_object('link_id',l.link_id,'store_id',l.store_id,'machine_id',COALESCE(l.machine_id,'')),
         'macros',json_object(
           'retail-link-state',json_object(),
           'retail-link-create-order',json_object('params',json_object(
             'cart_json',json_object('type','string','required',json('true'),'maxLength',2048),
             'client_request_id',json_object('type','string','required',json('true'),'maxLength',96,'pattern','^[A-Za-z0-9._:-]+$'),
             'payment_method',json_object('type','string','required',json('true'),'enum',json_array('cod','cash')),
             'note',json_object('type','string','required',json('false'),'maxLength',240)
           ))
         )
       ))
FROM retail_order_links l WHERE l.link_id=trim(:link_id)
ON CONFLICT(page_id) DO UPDATE SET html=excluded.html,require_phone=excluded.require_phone,sync_id=excluded.sync_id,
  enabled=excluded.enabled,title=excluded.title,meta=excluded.meta;
SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_order_links WHERE link_id=trim(:link_id)) THEN 'OK' ELSE 'FAIL' END AS c1,
       trim(COALESCE(:link_id,'')) AS link_id,trim(COALESCE(:page_id,'')) AS page_id;
`);

addMacro('retail-admin-order-status', 'Update order workflow; cancellation releases reserved inventory. Fulfillment remains device-driven.', String.raw`
DROP TABLE IF EXISTS temp._retail_status_input;
CREATE TEMP TABLE _retail_status_input AS
SELECT trim(COALESCE(:request_id,'')) AS request_id,trim(COALESCE(:order_id,'')) AS order_id,trim(COALESCE(:status,'')) AS next_status,
       trim(COALESCE(:note,'')) AS note,unixepoch('now')*1000 AS now_ms,
       CASE WHEN trim(COALESCE(:request_id,''))='' THEN 'MISSING_REQUEST_ID'
            WHEN :status NOT IN ('pending','confirmed','processing','cancelled') THEN 'DEVICE_REQUIRED_FOR_FULFILLMENT'
            WHEN NOT EXISTS (SELECT 1 FROM retail_orders WHERE order_id=trim(:order_id)) THEN 'ORDER_NOT_FOUND'
            WHEN EXISTS (SELECT 1 FROM retail_device_requests WHERE request_id=trim(:request_id)) THEN 'DUPLICATE'
            WHEN (SELECT status FROM retail_orders WHERE order_id=trim(:order_id)) IN ('fulfilled','cancelled') THEN 'FINAL_STATE'
            ELSE 'OK' END AS validation_code;
INSERT INTO retail_device_requests VALUES ((SELECT request_id FROM _retail_status_input),'admin','dashboard','order_status',
  CASE WHEN (SELECT validation_code FROM _retail_status_input)='OK' THEN 'applied' ELSE 'failed' END,
  (SELECT validation_code FROM _retail_status_input),(SELECT now_ms FROM _retail_status_input),(SELECT now_ms FROM _retail_status_input))
ON CONFLICT(request_id) DO NOTHING;
UPDATE retail_store_products
SET reserved_qty=MAX(0,reserved_qty-COALESCE((SELECT SUM(oi.quantity) FROM retail_order_items oi,retail_orders o,_retail_status_input i
  WHERE oi.order_id=o.order_id AND o.order_id=i.order_id AND o.store_id=retail_store_products.store_id AND oi.product_id=retail_store_products.product_id AND i.next_status='cancelled' AND i.validation_code='OK'),0)),
  updated_at=(SELECT now_ms FROM _retail_status_input)
WHERE EXISTS (SELECT 1 FROM retail_order_items oi,retail_orders o,_retail_status_input i
  WHERE oi.order_id=o.order_id AND o.order_id=i.order_id AND o.store_id=retail_store_products.store_id AND oi.product_id=retail_store_products.product_id AND i.next_status='cancelled' AND i.validation_code='OK' AND o.machine_id IS NULL);
UPDATE retail_machine_positions
SET reserved_qty=MAX(0,reserved_qty-COALESCE((SELECT SUM(oi.quantity) FROM retail_order_items oi,retail_orders o,_retail_status_input i
  WHERE oi.order_id=o.order_id AND o.order_id=i.order_id AND o.machine_id=retail_machine_positions.machine_id AND oi.product_id=retail_machine_positions.product_id AND i.next_status='cancelled' AND i.validation_code='OK'),0)),
  updated_at=(SELECT now_ms FROM _retail_status_input)
WHERE EXISTS (SELECT 1 FROM retail_order_items oi,retail_orders o,_retail_status_input i
  WHERE oi.order_id=o.order_id AND o.order_id=i.order_id AND o.machine_id=retail_machine_positions.machine_id AND oi.product_id=retail_machine_positions.product_id AND i.next_status='cancelled' AND i.validation_code='OK');
UPDATE retail_orders SET status=(SELECT next_status FROM _retail_status_input),note=trim(note||' '||(SELECT note FROM _retail_status_input)),updated_at=(SELECT now_ms FROM _retail_status_input)
WHERE order_id=(SELECT order_id FROM _retail_status_input) AND (SELECT validation_code FROM _retail_status_input)='OK';
SELECT CASE WHEN validation_code IN ('OK','DUPLICATE') THEN 'OK' ELSE 'FAIL' END AS c1,validation_code AS code,order_id,next_status AS status FROM _retail_status_input;
DROP TABLE IF EXISTS temp._retail_status_input;
`);

addMacro('retail-link-state', 'Public storefront state scoped by system_pages context; returns link, categories and available products only.', String.raw`
SELECT 'link' AS row_type,l.link_id AS id,l.title AS label,l.subtitle,'' AS category_id,'' AS category_name,'' AS image_url,
       0 AS price,0 AS stock,'' AS unit,CASE WHEN l.enabled<>0 THEN 'enabled' ELSE 'disabled' END AS status,
       st.name AS store_name,st.address AS store_address
FROM retail_order_links l JOIN retail_stores st ON st.store_id=l.store_id
WHERE l.link_id=COALESCE(NULLIF(:link_id,''),'') AND l.store_id=COALESCE(NULLIF(:store_id,''),l.store_id) AND l.enabled<>0
UNION ALL
SELECT 'category',c.category_id,c.name,c.description,c.category_id,c.name,'',0,
       COUNT(DISTINCT p.product_id),'','enabled',st.name,st.address
FROM retail_order_links l JOIN retail_stores st ON st.store_id=l.store_id
JOIN retail_categories c ON c.enabled<>0 JOIN retail_products p ON p.category_id=c.category_id AND p.enabled<>0
WHERE l.link_id=COALESCE(NULLIF(:link_id,''),'') AND l.enabled<>0
  AND ((COALESCE(NULLIF(:machine_id,''),l.machine_id,'')<>'' AND EXISTS (
         SELECT 1 FROM retail_machine_positions mp WHERE mp.machine_id=COALESCE(NULLIF(:machine_id,''),l.machine_id) AND mp.product_id=p.product_id AND mp.status='enabled' AND mp.quantity-mp.reserved_qty>0))
    OR (COALESCE(NULLIF(:machine_id,''),l.machine_id,'')='' AND EXISTS (
         SELECT 1 FROM retail_store_products sp WHERE sp.store_id=l.store_id AND sp.product_id=p.product_id AND sp.enabled<>0 AND sp.stock_qty-sp.reserved_qty>0)))
GROUP BY c.category_id
UNION ALL
SELECT 'product',p.product_id,p.name,p.description,p.category_id,c.name,p.image_url,
       CASE WHEN COALESCE(NULLIF(:machine_id,''),l.machine_id,'')<>'' THEN COALESCE((SELECT mp.sale_price FROM retail_machine_positions mp WHERE mp.machine_id=COALESCE(NULLIF(:machine_id,''),l.machine_id) AND mp.product_id=p.product_id LIMIT 1),p.sale_price)
            ELSE COALESCE(sp.sale_price,p.sale_price) END,
       CASE WHEN COALESCE(NULLIF(:machine_id,''),l.machine_id,'')<>'' THEN COALESCE((SELECT SUM(mp.quantity-mp.reserved_qty) FROM retail_machine_positions mp WHERE mp.machine_id=COALESCE(NULLIF(:machine_id,''),l.machine_id) AND mp.product_id=p.product_id AND mp.status='enabled'),0)
            ELSE sp.stock_qty-sp.reserved_qty END,
       p.unit,CASE WHEN p.enabled<>0 THEN 'enabled' ELSE 'disabled' END,st.name,st.address
FROM retail_order_links l JOIN retail_stores st ON st.store_id=l.store_id
JOIN retail_store_products sp ON sp.store_id=l.store_id AND sp.enabled<>0
JOIN retail_products p ON p.product_id=sp.product_id AND p.enabled<>0
JOIN retail_categories c ON c.category_id=p.category_id AND c.enabled<>0
WHERE l.link_id=COALESCE(NULLIF(:link_id,''),'') AND l.enabled<>0
  AND ((COALESCE(NULLIF(:machine_id,''),l.machine_id,'')<>'' AND EXISTS (
         SELECT 1 FROM retail_machine_positions mp WHERE mp.machine_id=COALESCE(NULLIF(:machine_id,''),l.machine_id) AND mp.product_id=p.product_id AND mp.status='enabled' AND mp.quantity-mp.reserved_qty>0))
    OR (COALESCE(NULLIF(:machine_id,''),l.machine_id,'')='' AND sp.stock_qty-sp.reserved_qty>0))
ORDER BY row_type,category_name,label;
`);

addMacro('retail-link-create-order', 'Public idempotent order creation from JSON cart with scoped link, verified identity and inventory reservation.', String.raw`
DROP TABLE IF EXISTS temp._retail_link_ctx;
DROP TABLE IF EXISTS temp._retail_cart;
DROP TABLE IF EXISTS temp._retail_order_guard;
DROP TABLE IF EXISTS temp._retail_new_order;
CREATE TEMP TABLE _retail_link_ctx AS
SELECT l.link_id,l.store_id,l.machine_id,l.page_id,l.title,st.name AS store_name
FROM retail_order_links l JOIN retail_stores st ON st.store_id=l.store_id
WHERE l.link_id=COALESCE(NULLIF(:link_id,''),'') AND l.store_id=COALESCE(NULLIF(:store_id,''),l.store_id)
  AND COALESCE(l.machine_id,'')=COALESCE(NULLIF(:machine_id,''),COALESCE(l.machine_id,'')) AND l.enabled<>0 AND st.enabled<>0 LIMIT 1;
CREATE TEMP TABLE _retail_cart AS
SELECT trim(json_extract(j.value,'$.product_id')) AS product_id,
       MAX(1,MIN(99,CAST(json_extract(j.value,'$.qty') AS INTEGER))) AS quantity,
       p.name,p.unit,
       CASE WHEN COALESCE(c.machine_id,'')<>'' THEN COALESCE((SELECT mp.sale_price FROM retail_machine_positions mp WHERE mp.machine_id=c.machine_id AND mp.product_id=p.product_id AND mp.status='enabled' LIMIT 1),p.sale_price)
            ELSE COALESCE(sp.sale_price,p.sale_price) END AS unit_price,
       CASE WHEN COALESCE(c.machine_id,'')<>'' THEN COALESCE((SELECT SUM(mp.quantity-mp.reserved_qty) FROM retail_machine_positions mp WHERE mp.machine_id=c.machine_id AND mp.product_id=p.product_id AND mp.status='enabled'),0)
            ELSE sp.stock_qty-sp.reserved_qty END AS available_qty,
       CASE WHEN COALESCE(c.machine_id,'')<>'' THEN (SELECT MIN(mp.position_no) FROM retail_machine_positions mp WHERE mp.machine_id=c.machine_id AND mp.product_id=p.product_id AND mp.status='enabled') ELSE NULL END AS position_no
FROM json_each(CASE WHEN json_valid(COALESCE(:cart_json,'')) THEN :cart_json ELSE '[]' END) j
CROSS JOIN _retail_link_ctx c JOIN retail_products p ON p.product_id=trim(json_extract(j.value,'$.product_id')) AND p.enabled<>0
JOIN retail_store_products sp ON sp.store_id=c.store_id AND sp.product_id=p.product_id AND sp.enabled<>0
GROUP BY p.product_id;
CREATE TEMP TABLE _retail_order_guard AS
SELECT CASE WHEN trim(COALESCE(:client_request_id,''))='' THEN 'MISSING_REQUEST_ID'
            WHEN EXISTS (SELECT 1 FROM retail_orders WHERE request_id=trim(:client_request_id)) THEN 'DUPLICATE'
            WHEN NOT EXISTS (SELECT 1 FROM _retail_link_ctx) THEN 'LINK_NOT_FOUND'
            WHEN NOT json_valid(COALESCE(:cart_json,'')) THEN 'INVALID_CART'
            WHEN NOT EXISTS (SELECT 1 FROM _retail_cart) THEN 'EMPTY_CART'
            WHEN EXISTS (SELECT 1 FROM _retail_cart WHERE quantity>available_qty OR available_qty<=0) THEN 'INSUFFICIENT_STOCK'
            WHEN :payment_method NOT IN ('cod','cash') THEN 'INVALID_PAYMENT'
            ELSE 'OK' END AS code;
INSERT INTO retail_users (user_id,phone,name,email,role,status,created_at,updated_at)
SELECT 'USR-'||lower(hex(randomblob(6))),trim(:phone),COALESCE(NULLIF(trim(:username),''),trim(:phone)),trim(COALESCE(:email,'')),'customer','active',unixepoch('now')*1000,unixepoch('now')*1000
WHERE (SELECT code FROM _retail_order_guard)='OK' AND trim(COALESCE(:phone,''))<>''
ON CONFLICT(phone) DO UPDATE SET name=COALESCE(NULLIF(excluded.name,''),retail_users.name),email=COALESCE(NULLIF(excluded.email,''),retail_users.email),updated_at=excluded.updated_at;
CREATE TEMP TABLE _retail_new_order AS
SELECT 'ORDER-'||lower(hex(randomblob(8))) AS order_id,trim(:client_request_id) AS request_id,
       'R'||substr(strftime('%Y%m%d%H%M%S','now','localtime'),3)||upper(substr(hex(randomblob(2)),1,4)) AS order_code,
       c.link_id,c.store_id,c.machine_id,
       (SELECT user_id FROM retail_users WHERE phone=trim(:phone) LIMIT 1) AS user_id,
       trim(COALESCE(:phone,'')) AS phone,COALESCE(NULLIF(trim(:username),''),trim(COALESCE(:phone,'')),'Khách hàng') AS customer_name,
       SUM(x.quantity*x.unit_price) AS total,unixepoch('now')*1000 AS now_ms
FROM _retail_link_ctx c CROSS JOIN _retail_cart x
WHERE (SELECT code FROM _retail_order_guard)='OK'
HAVING (SELECT code FROM _retail_order_guard)='OK' AND SUM(x.quantity*x.unit_price)>0;
INSERT INTO retail_orders (order_id,request_id,order_code,link_id,store_id,machine_id,customer_user_id,customer_phone,customer_name,status,payment_method,subtotal,total,note,channel,created_at,updated_at,completed_at)
SELECT order_id,request_id,order_code,link_id,store_id,machine_id,user_id,phone,customer_name,'pending',:payment_method,total,total,trim(COALESCE(:note,'')),'iot-page',now_ms,now_ms,NULL
FROM _retail_new_order WHERE total>0;
INSERT INTO retail_order_items (order_id,product_id,position_no,quantity,unit_price,line_total)
SELECT o.order_id,c.product_id,c.position_no,c.quantity,c.unit_price,c.quantity*c.unit_price FROM _retail_cart c CROSS JOIN _retail_new_order o;
UPDATE retail_store_products
SET reserved_qty=reserved_qty+(SELECT quantity FROM _retail_cart c WHERE c.product_id=retail_store_products.product_id),updated_at=unixepoch('now')*1000
WHERE store_id=(SELECT store_id FROM _retail_new_order) AND product_id IN (SELECT product_id FROM _retail_cart)
  AND COALESCE((SELECT machine_id FROM _retail_new_order),'')='';
UPDATE retail_machine_positions
SET reserved_qty=reserved_qty+(SELECT quantity FROM _retail_cart c WHERE c.product_id=retail_machine_positions.product_id),updated_at=unixepoch('now')*1000
WHERE machine_id=(SELECT machine_id FROM _retail_new_order) AND product_id IN (SELECT product_id FROM _retail_cart);
SELECT CASE WHEN g.code IN ('OK','DUPLICATE') THEN 'OK' ELSE 'FAIL' END AS c1,g.code,
       COALESCE(n.order_id,o.order_id,'') AS order_id,COALESCE(n.order_code,o.order_code,'') AS order_code,
       COALESCE(n.total,o.total,0) AS total,
       CASE WHEN g.code='DUPLICATE' THEN 'Đơn hàng đã được tiếp nhận trước đó.' WHEN g.code='OK' THEN 'Đã tiếp nhận đơn hàng.' ELSE g.code END AS message
FROM _retail_order_guard g LEFT JOIN _retail_new_order n ON 1=1 LEFT JOIN retail_orders o ON o.request_id=trim(:client_request_id);
DROP TABLE IF EXISTS temp._retail_new_order;
DROP TABLE IF EXISTS temp._retail_order_guard;
DROP TABLE IF EXISTS temp._retail_cart;
DROP TABLE IF EXISTS temp._retail_link_ctx;
`);

addMacro('retail-io-catalog', 'Device API: read vending-machine position, product, price and available quantity.', String.raw`
SELECT 'OK' AS c1,m.machine_id AS c2,CAST(mp.position_no AS INTEGER) AS position_no,p.product_id,p.sku,p.barcode,p.name,
       COALESCE(mp.sale_price,p.sale_price) AS price,MAX(0,mp.quantity-mp.reserved_qty) AS quantity,p.unit,mp.status,
       m.name AS machine_name,m.store_id
FROM retail_machines m JOIN retail_machine_positions mp ON mp.machine_id=m.machine_id
LEFT JOIN retail_products p ON p.product_id=mp.product_id
WHERE m.machine_id=COALESCE(NULLIF(:machine_id,''),NULLIF(:c1,'')) AND m.enabled<>0
ORDER BY mp.position_no;
`);

addMacro('retail-io-stock-levels', 'Warehouse device API: read current store inventory by store and optional SKU search.', String.raw`
SELECT 'OK' AS c1,sp.store_id AS c2,p.sku AS c3,sp.product_id,p.barcode,p.name,
       sp.stock_qty,sp.reserved_qty,MAX(0,sp.stock_qty-sp.reserved_qty) AS available_qty,sp.min_stock,p.unit,sp.updated_at
FROM retail_store_products sp JOIN retail_products p ON p.product_id=sp.product_id
WHERE sp.store_id=COALESCE(NULLIF(:store_id,''),NULLIF(:c1,'')) AND sp.enabled<>0 AND p.enabled<>0
  AND (COALESCE(NULLIF(:sku,''),NULLIF(:c2,''),'')='' OR p.sku=COALESCE(NULLIF(:sku,''),NULLIF(:c2,'')) OR p.barcode=COALESCE(NULLIF(:sku,''),NULLIF(:c2,'')))
ORDER BY p.sku;
`);

addMacro('retail-io-stock-report', 'Warehouse device API: idempotent stock-in, stock-out or count adjustment by SKU/barcode.', String.raw`
DROP TABLE IF EXISTS temp._retail_stock_report;
CREATE TEMP TABLE _retail_stock_report AS
SELECT trim(COALESCE(NULLIF(:request_id,''),NULLIF(:c1,''))) AS request_id,
       trim(COALESCE(NULLIF(:store_id,''),NULLIF(:c2,''))) AS store_id,
       trim(COALESCE(NULLIF(:sku,''),NULLIF(:c3,''))) AS sku,
       CAST(COALESCE(NULLIF(:quantity_delta,''),NULLIF(:c4,''),'0') AS REAL) AS quantity_delta,
       lower(trim(COALESCE(NULLIF(:movement_type,''),NULLIF(:c5,''),'stock_in'))) AS movement_type,
       trim(COALESCE(NULLIF(:reference_id,''),NULLIF(:c6,''),'')) AS reference_id,
       trim(COALESCE(NULLIF(:note,''),NULLIF(:c7,''),'')) AS note,unixepoch('now')*1000 AS now_ms;
ALTER TABLE _retail_stock_report ADD COLUMN product_id TEXT;
UPDATE _retail_stock_report SET product_id=(SELECT product_id FROM retail_products p WHERE p.sku=_retail_stock_report.sku OR p.barcode=_retail_stock_report.sku LIMIT 1);
ALTER TABLE _retail_stock_report ADD COLUMN validation_code TEXT;
UPDATE _retail_stock_report SET validation_code=CASE
  WHEN request_id='' THEN 'MISSING_REQUEST_ID' WHEN store_id='' THEN 'MISSING_STORE' WHEN sku='' THEN 'MISSING_SKU'
  WHEN quantity_delta=0 THEN 'ZERO_QUANTITY' WHEN movement_type NOT IN ('stock_in','stock_out','count_adjustment','return') THEN 'INVALID_MOVEMENT'
  WHEN product_id IS NULL OR NOT EXISTS (SELECT 1 FROM retail_store_products sp WHERE sp.store_id=_retail_stock_report.store_id AND sp.product_id=_retail_stock_report.product_id) THEN 'PRODUCT_NOT_IN_STORE'
  WHEN EXISTS (SELECT 1 FROM retail_device_requests r WHERE r.request_id=_retail_stock_report.request_id) THEN 'DUPLICATE'
  WHEN quantity_delta<0 AND (SELECT stock_qty FROM retail_store_products sp WHERE sp.store_id=_retail_stock_report.store_id AND sp.product_id=_retail_stock_report.product_id)+quantity_delta<0 THEN 'INSUFFICIENT_STOCK'
  ELSE 'OK' END;
INSERT INTO retail_device_requests
SELECT request_id,'warehouse',store_id,'stock_report',CASE WHEN validation_code='OK' THEN 'applied' ELSE 'failed' END,validation_code,now_ms,now_ms
FROM _retail_stock_report WHERE 1=1 ON CONFLICT(request_id) DO NOTHING;
INSERT INTO retail_inventory_movements (movement_id,request_id,store_id,product_id,machine_id,position_no,movement_type,quantity_delta,stock_after,reference_id,note,created_at)
SELECT 'MOV-'||request_id,request_id,store_id,product_id,NULL,NULL,movement_type,quantity_delta,
       (SELECT stock_qty FROM retail_store_products sp WHERE sp.store_id=i.store_id AND sp.product_id=i.product_id)+quantity_delta,
       reference_id,note,now_ms FROM _retail_stock_report i WHERE validation_code='OK';
UPDATE retail_store_products SET stock_qty=stock_qty+(SELECT quantity_delta FROM _retail_stock_report),updated_at=(SELECT now_ms FROM _retail_stock_report)
WHERE store_id=(SELECT store_id FROM _retail_stock_report) AND product_id=(SELECT product_id FROM _retail_stock_report)
  AND (SELECT validation_code FROM _retail_stock_report)='OK';
SELECT CASE WHEN validation_code IN ('OK','DUPLICATE') THEN 'OK' ELSE 'FAIL' END AS c1,request_id AS c2,validation_code AS code,
       store_id,sku,product_id,COALESCE((SELECT stock_qty FROM retail_store_products sp WHERE sp.store_id=i.store_id AND sp.product_id=i.product_id),0) AS stock_qty
FROM _retail_stock_report i;
DROP TABLE IF EXISTS temp._retail_stock_report;
`);

addMacro('retail-io-machine-restock', 'Vending device API: transfer stock from store inventory into one machine position, idempotent by request_id.', String.raw`
DROP TABLE IF EXISTS temp._retail_restock;
CREATE TEMP TABLE _retail_restock AS
SELECT trim(COALESCE(NULLIF(:request_id,''),NULLIF(:c1,''))) AS request_id,
       trim(COALESCE(NULLIF(:machine_id,''),NULLIF(:c2,''))) AS machine_id,
       CAST(COALESCE(NULLIF(:position_no,''),NULLIF(:c3,''),'0') AS INTEGER) AS position_no,
       CAST(COALESCE(NULLIF(:quantity,''),NULLIF(:c4,''),'0') AS REAL) AS quantity,
       trim(COALESCE(NULLIF(:note,''),NULLIF(:c5,''),'')) AS note,unixepoch('now')*1000 AS now_ms;
ALTER TABLE _retail_restock ADD COLUMN store_id TEXT;
ALTER TABLE _retail_restock ADD COLUMN product_id TEXT;
UPDATE _retail_restock SET store_id=(SELECT store_id FROM retail_machines WHERE machine_id=_retail_restock.machine_id),
  product_id=(SELECT product_id FROM retail_machine_positions WHERE machine_id=_retail_restock.machine_id AND position_no=_retail_restock.position_no);
ALTER TABLE _retail_restock ADD COLUMN validation_code TEXT;
UPDATE _retail_restock SET validation_code=CASE WHEN request_id='' THEN 'MISSING_REQUEST_ID' WHEN quantity<=0 THEN 'INVALID_QUANTITY'
  WHEN product_id IS NULL THEN 'POSITION_NOT_FOUND' WHEN EXISTS (SELECT 1 FROM retail_device_requests WHERE request_id=_retail_restock.request_id) THEN 'DUPLICATE'
  WHEN quantity>(SELECT capacity-quantity FROM retail_machine_positions mp WHERE mp.machine_id=_retail_restock.machine_id AND mp.position_no=_retail_restock.position_no) THEN 'CAPACITY_EXCEEDED'
  WHEN quantity>(SELECT stock_qty-reserved_qty FROM retail_store_products sp WHERE sp.store_id=_retail_restock.store_id AND sp.product_id=_retail_restock.product_id) THEN 'INSUFFICIENT_STORE_STOCK'
  ELSE 'OK' END;
INSERT INTO retail_device_requests SELECT request_id,'vending',machine_id,'restock',CASE WHEN validation_code='OK' THEN 'applied' ELSE 'failed' END,validation_code,now_ms,now_ms
FROM _retail_restock WHERE 1=1 ON CONFLICT(request_id) DO NOTHING;
UPDATE retail_store_products SET stock_qty=stock_qty-(SELECT quantity FROM _retail_restock),updated_at=(SELECT now_ms FROM _retail_restock)
WHERE store_id=(SELECT store_id FROM _retail_restock) AND product_id=(SELECT product_id FROM _retail_restock) AND (SELECT validation_code FROM _retail_restock)='OK';
UPDATE retail_machine_positions SET quantity=quantity+(SELECT quantity FROM _retail_restock),updated_at=(SELECT now_ms FROM _retail_restock)
WHERE machine_id=(SELECT machine_id FROM _retail_restock) AND position_no=(SELECT position_no FROM _retail_restock) AND (SELECT validation_code FROM _retail_restock)='OK';
INSERT INTO retail_inventory_movements (movement_id,request_id,store_id,product_id,machine_id,position_no,movement_type,quantity_delta,stock_after,reference_id,note,created_at)
SELECT 'MOV-'||request_id,request_id,store_id,product_id,machine_id,position_no,'machine_restock',-quantity,
       (SELECT stock_qty FROM retail_store_products sp WHERE sp.store_id=i.store_id AND sp.product_id=i.product_id),machine_id,note,now_ms
FROM _retail_restock i WHERE validation_code='OK';
SELECT CASE WHEN validation_code IN ('OK','DUPLICATE') THEN 'OK' ELSE 'FAIL' END AS c1,request_id AS c2,validation_code AS code,
       machine_id,position_no,product_id,
       COALESCE((SELECT quantity FROM retail_machine_positions mp WHERE mp.machine_id=i.machine_id AND mp.position_no=i.position_no),0) AS machine_quantity
FROM _retail_restock i;
DROP TABLE IF EXISTS temp._retail_restock;
`);

addMacro('retail-io-sale-report', 'Vending device API: idempotent direct sale report using JSON position/quantity lines.', String.raw`
DROP TABLE IF EXISTS temp._retail_sale_input;
DROP TABLE IF EXISTS temp._retail_sale_lines;
DROP TABLE IF EXISTS temp._retail_sale_guard;
CREATE TEMP TABLE _retail_sale_input AS
SELECT trim(COALESCE(NULLIF(:request_id,''),NULLIF(:c1,''))) AS request_id,
       trim(COALESCE(NULLIF(:machine_id,''),NULLIF(:c2,''))) AS machine_id,
       COALESCE(NULLIF(:items_json,''),NULLIF(:c3,''),'') AS items_json,
       trim(COALESCE(NULLIF(:payment_method,''),NULLIF(:c4,''),'cash')) AS payment_method,
       trim(COALESCE(NULLIF(:note,''),NULLIF(:c5,''),'')) AS note,unixepoch('now')*1000 AS now_ms;
CREATE TEMP TABLE _retail_sale_lines AS
SELECT CAST(json_extract(j.value,'$.position') AS INTEGER) AS position_no,
       MAX(1,MIN(99,CAST(json_extract(j.value,'$.qty') AS INTEGER))) AS quantity,
       mp.product_id,p.name,COALESCE(mp.sale_price,p.sale_price) AS unit_price,mp.quantity-mp.reserved_qty AS available_qty
FROM _retail_sale_input i,json_each(CASE WHEN json_valid(i.items_json) THEN i.items_json ELSE '[]' END) j
JOIN retail_machine_positions mp ON mp.machine_id=i.machine_id AND mp.position_no=CAST(json_extract(j.value,'$.position') AS INTEGER) AND mp.status='enabled'
JOIN retail_products p ON p.product_id=mp.product_id AND p.enabled<>0 GROUP BY mp.position_no;
CREATE TEMP TABLE _retail_sale_guard AS
SELECT CASE WHEN i.request_id='' THEN 'MISSING_REQUEST_ID' WHEN NOT EXISTS (SELECT 1 FROM retail_machines WHERE machine_id=i.machine_id AND enabled<>0) THEN 'MACHINE_NOT_FOUND'
  WHEN EXISTS (SELECT 1 FROM retail_device_requests WHERE request_id=i.request_id) THEN 'DUPLICATE'
  WHEN NOT json_valid(i.items_json) OR NOT EXISTS (SELECT 1 FROM _retail_sale_lines) THEN 'INVALID_ITEMS'
  WHEN EXISTS (SELECT 1 FROM _retail_sale_lines WHERE quantity>available_qty) THEN 'INSUFFICIENT_STOCK'
  ELSE 'OK' END AS code FROM _retail_sale_input i;
INSERT INTO retail_device_requests SELECT request_id,'vending',machine_id,'sale_report',CASE WHEN g.code='OK' THEN 'applied' ELSE 'failed' END,g.code,now_ms,now_ms
FROM _retail_sale_input i CROSS JOIN _retail_sale_guard g WHERE 1=1 ON CONFLICT(request_id) DO NOTHING;
INSERT INTO retail_sales (sale_id,request_id,order_id,store_id,machine_id,channel,payment_method,total,sold_at,note)
SELECT 'SALE-'||lower(hex(randomblob(8))),i.request_id,NULL,m.store_id,i.machine_id,'vending',i.payment_method,
       (SELECT SUM(quantity*unit_price) FROM _retail_sale_lines),i.now_ms,i.note
FROM _retail_sale_input i JOIN retail_machines m ON m.machine_id=i.machine_id CROSS JOIN _retail_sale_guard g WHERE g.code='OK';
INSERT INTO retail_sale_items (sale_id,product_id,position_no,quantity,unit_price,line_total)
SELECT s.sale_id,l.product_id,l.position_no,l.quantity,l.unit_price,l.quantity*l.unit_price
FROM _retail_sale_lines l JOIN retail_sales s ON s.request_id=(SELECT request_id FROM _retail_sale_input) WHERE (SELECT code FROM _retail_sale_guard)='OK';
UPDATE retail_machine_positions SET quantity=quantity-(SELECT l.quantity FROM _retail_sale_lines l WHERE l.position_no=retail_machine_positions.position_no),updated_at=(SELECT now_ms FROM _retail_sale_input)
WHERE machine_id=(SELECT machine_id FROM _retail_sale_input) AND position_no IN (SELECT position_no FROM _retail_sale_lines) AND (SELECT code FROM _retail_sale_guard)='OK';
UPDATE retail_machines SET status='online',last_seen_at=(SELECT now_ms FROM _retail_sale_input),updated_at=(SELECT now_ms FROM _retail_sale_input)
WHERE machine_id=(SELECT machine_id FROM _retail_sale_input) AND (SELECT code FROM _retail_sale_guard)='OK';
SELECT CASE WHEN g.code IN ('OK','DUPLICATE') THEN 'OK' ELSE 'FAIL' END AS c1,i.request_id AS c2,g.code,
       COALESCE((SELECT sale_id FROM retail_sales WHERE request_id=i.request_id),'') AS sale_id,
       COALESCE((SELECT total FROM retail_sales WHERE request_id=i.request_id),0) AS total
FROM _retail_sale_input i CROSS JOIN _retail_sale_guard g;
DROP TABLE IF EXISTS temp._retail_sale_guard;
DROP TABLE IF EXISTS temp._retail_sale_lines;
DROP TABLE IF EXISTS temp._retail_sale_input;
`);

addMacro('retail-io-order-next', 'Vending device API: fetch the oldest pending or confirmed order and its position lines.', String.raw`
WITH next_order AS (
  SELECT * FROM retail_orders WHERE machine_id=COALESCE(NULLIF(:machine_id,''),NULLIF(:c1,'')) AND status IN ('pending','confirmed') ORDER BY created_at LIMIT 1
)
SELECT 'order' AS row_type,'OK' AS c1,o.order_code AS c2,o.order_id,o.order_code,o.status,o.total,o.customer_phone,o.note,o.created_at,
       NULL AS position_no,NULL AS product_id,NULL AS sku,NULL AS quantity,NULL AS unit_price
FROM next_order o
UNION ALL
SELECT 'item','OK',o.order_code,o.order_id,o.order_code,o.status,o.total,o.customer_phone,o.note,o.created_at,
       COALESCE(oi.position_no,(SELECT MIN(position_no) FROM retail_machine_positions mp WHERE mp.machine_id=o.machine_id AND mp.product_id=oi.product_id)),
       oi.product_id,p.sku,oi.quantity,oi.unit_price
FROM next_order o JOIN retail_order_items oi ON oi.order_id=o.order_id JOIN retail_products p ON p.product_id=oi.product_id
ORDER BY row_type,position_no;
`);

addMacro('retail-io-order-complete', 'Vending device API: atomically fulfill a reserved storefront order, create sale ledger and decrement machine stock.', String.raw`
DROP TABLE IF EXISTS temp._retail_complete_input;
DROP TABLE IF EXISTS temp._retail_complete_order;
DROP TABLE IF EXISTS temp._retail_complete_guard;
CREATE TEMP TABLE _retail_complete_input AS
SELECT trim(COALESCE(NULLIF(:request_id,''),NULLIF(:c1,''))) AS request_id,
       trim(COALESCE(NULLIF(:machine_id,''),NULLIF(:c2,''))) AS machine_id,
       trim(COALESCE(NULLIF(:order_code,''),NULLIF(:c3,''))) AS order_code,
       lower(trim(COALESCE(NULLIF(:result,''),NULLIF(:c4,''),'fulfilled'))) AS result,
       trim(COALESCE(NULLIF(:note,''),NULLIF(:c5,''),'')) AS note,unixepoch('now')*1000 AS now_ms;
CREATE TEMP TABLE _retail_complete_order AS
SELECT o.* FROM retail_orders o,_retail_complete_input i WHERE o.order_code=i.order_code AND o.machine_id=i.machine_id LIMIT 1;
CREATE TEMP TABLE _retail_complete_guard AS
SELECT CASE WHEN i.request_id='' THEN 'MISSING_REQUEST_ID' WHEN EXISTS (SELECT 1 FROM retail_device_requests WHERE request_id=i.request_id) THEN 'DUPLICATE'
  WHEN NOT EXISTS (SELECT 1 FROM _retail_complete_order) THEN 'ORDER_NOT_FOUND' WHEN i.result NOT IN ('fulfilled','failed') THEN 'INVALID_RESULT'
  WHEN (SELECT status FROM _retail_complete_order) IN ('fulfilled','cancelled') THEN 'FINAL_STATE'
  WHEN i.result='fulfilled' AND EXISTS (SELECT 1 FROM retail_order_items oi JOIN _retail_complete_order o ON o.order_id=oi.order_id
    WHERE oi.quantity>(SELECT quantity FROM retail_machine_positions mp WHERE mp.machine_id=o.machine_id AND mp.product_id=oi.product_id LIMIT 1)) THEN 'INSUFFICIENT_STOCK'
  ELSE 'OK' END AS code FROM _retail_complete_input i;
INSERT INTO retail_device_requests SELECT i.request_id,'vending',i.machine_id,'order_complete',CASE WHEN g.code='OK' THEN 'applied' ELSE 'failed' END,g.code,i.now_ms,i.now_ms
FROM _retail_complete_input i CROSS JOIN _retail_complete_guard g WHERE 1=1 ON CONFLICT(request_id) DO NOTHING;
INSERT INTO retail_sales (sale_id,request_id,order_id,store_id,machine_id,channel,payment_method,total,sold_at,note)
SELECT 'SALE-'||lower(hex(randomblob(8))),i.request_id,o.order_id,o.store_id,o.machine_id,'iot-page',o.payment_method,o.total,i.now_ms,i.note
FROM _retail_complete_input i CROSS JOIN _retail_complete_order o CROSS JOIN _retail_complete_guard g WHERE g.code='OK' AND i.result='fulfilled';
INSERT INTO retail_sale_items (sale_id,product_id,position_no,quantity,unit_price,line_total)
SELECT s.sale_id,oi.product_id,COALESCE(oi.position_no,(SELECT MIN(position_no) FROM retail_machine_positions mp WHERE mp.machine_id=o.machine_id AND mp.product_id=oi.product_id)),oi.quantity,oi.unit_price,oi.line_total
FROM retail_order_items oi CROSS JOIN _retail_complete_order o JOIN retail_sales s ON s.order_id=o.order_id
WHERE oi.order_id=o.order_id AND (SELECT code FROM _retail_complete_guard)='OK' AND (SELECT result FROM _retail_complete_input)='fulfilled';
UPDATE retail_machine_positions
SET quantity=quantity-COALESCE((SELECT SUM(oi.quantity) FROM retail_order_items oi,_retail_complete_order o WHERE oi.order_id=o.order_id AND oi.product_id=retail_machine_positions.product_id),0),
    reserved_qty=MAX(0,reserved_qty-COALESCE((SELECT SUM(oi.quantity) FROM retail_order_items oi,_retail_complete_order o WHERE oi.order_id=o.order_id AND oi.product_id=retail_machine_positions.product_id),0)),
    updated_at=(SELECT now_ms FROM _retail_complete_input)
WHERE machine_id=(SELECT machine_id FROM _retail_complete_order) AND product_id IN (SELECT product_id FROM retail_order_items WHERE order_id=(SELECT order_id FROM _retail_complete_order))
  AND (SELECT code FROM _retail_complete_guard)='OK' AND (SELECT result FROM _retail_complete_input)='fulfilled';
UPDATE retail_machine_positions
SET reserved_qty=MAX(0,reserved_qty-COALESCE((SELECT SUM(oi.quantity) FROM retail_order_items oi,_retail_complete_order o WHERE oi.order_id=o.order_id AND oi.product_id=retail_machine_positions.product_id),0)),
    updated_at=(SELECT now_ms FROM _retail_complete_input)
WHERE machine_id=(SELECT machine_id FROM _retail_complete_order) AND product_id IN (SELECT product_id FROM retail_order_items WHERE order_id=(SELECT order_id FROM _retail_complete_order))
  AND (SELECT code FROM _retail_complete_guard)='OK' AND (SELECT result FROM _retail_complete_input)='failed';
UPDATE retail_orders SET status=CASE WHEN (SELECT result FROM _retail_complete_input)='fulfilled' THEN 'fulfilled' ELSE 'cancelled' END,
  note=trim(note||' '||(SELECT note FROM _retail_complete_input)),updated_at=(SELECT now_ms FROM _retail_complete_input),
  completed_at=CASE WHEN (SELECT result FROM _retail_complete_input)='fulfilled' THEN (SELECT now_ms FROM _retail_complete_input) ELSE completed_at END
WHERE order_id=(SELECT order_id FROM _retail_complete_order) AND (SELECT code FROM _retail_complete_guard)='OK';
SELECT CASE WHEN g.code IN ('OK','DUPLICATE') THEN 'OK' ELSE 'FAIL' END AS c1,i.request_id AS c2,g.code,
       COALESCE((SELECT order_code FROM _retail_complete_order),'') AS order_code,
       COALESCE((SELECT status FROM retail_orders WHERE order_id=(SELECT order_id FROM _retail_complete_order)),'') AS status
FROM _retail_complete_input i CROSS JOIN _retail_complete_guard g;
DROP TABLE IF EXISTS temp._retail_complete_guard;
DROP TABLE IF EXISTS temp._retail_complete_order;
DROP TABLE IF EXISTS temp._retail_complete_input;
`);

db.prepare(`INSERT INTO system_cmds (cmd_id,command_template,require_email,require_phone,sync_id,params_schema,enabled) VALUES (?,?,?,?,?,?,1)`).run(
  'retail-machine-dispense',
  'retail_dispense,{{order_code}},{{position_list}},{{quantity_list}}',
  0,
  0,
  '<<syncid>>',
  JSON.stringify({
    order_code: { type: 'string', required: true, maxLength: 64, pattern: '^[A-Za-z0-9._:-]+$' },
    position_list: { type: 'string', required: true, maxLength: 160, pattern: '^[0-9,]+$' },
    quantity_list: { type: 'string', required: true, maxLength: 160, pattern: '^[0-9.,]+$' }
  })
);

const integrity = db.pragma('integrity_check', { simple: true });
if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity}`);
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();

console.log(`Built ${DB_PATH}`);
