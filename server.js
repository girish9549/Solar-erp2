/* Solar Shop ERP - zero-dependency server (Node 22+ , built-in SQLite)
 * Run:  node server.js     (PORT env var optional, default 3000)
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || undefined; // on the internet: 127.0.0.1 (Caddy sits in front)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'solar.db');

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

/* ------------------------------------------------------------------ schema */
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, role TEXT DEFAULT 'admin');
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS godowns(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, location TEXT DEFAULT '', active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT DEFAULT 'Solar Panel', brand TEXT DEFAULT '',
  hsn TEXT DEFAULT '8541', unit TEXT DEFAULT 'Nos', gst_rate REAL DEFAULT 12,
  purchase_price REAL DEFAULT 0, sale_price REAL DEFAULT 0, min_stock REAL DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS stock(
  product_id INTEGER NOT NULL REFERENCES products(id), godown_id INTEGER NOT NULL REFERENCES godowns(id),
  qty REAL NOT NULL DEFAULT 0, PRIMARY KEY(product_id, godown_id));
CREATE TABLE IF NOT EXISTS stock_moves(
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, product_id INTEGER NOT NULL, godown_id INTEGER NOT NULL,
  qty REAL NOT NULL, type TEXT NOT NULL, ref TEXT DEFAULT '', note TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS parties(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'customer', phone TEXT DEFAULT '',
  gstin TEXT DEFAULT '', address TEXT DEFAULT '', city TEXT DEFAULT '', state TEXT DEFAULT '', active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS purchases(
  id INTEGER PRIMARY KEY, bill_no TEXT NOT NULL, party_id INTEGER NOT NULL REFERENCES parties(id), date TEXT NOT NULL,
  godown_id INTEGER NOT NULL REFERENCES godowns(id), subtotal REAL, discount_type TEXT DEFAULT 'amount', discount_value REAL DEFAULT 0,
  discount_amt REAL, taxable REAL, cgst REAL, sgst REAL, igst REAL, round_off REAL, total REAL, paid REAL DEFAULT 0,
  notes TEXT DEFAULT '', status TEXT DEFAULT 'active', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS purchase_items(
  id INTEGER PRIMARY KEY, purchase_id INTEGER NOT NULL REFERENCES purchases(id), product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL, rate REAL, gst_rate REAL, gross REAL, taxable REAL, gst_amt REAL, line_total REAL);
CREATE TABLE IF NOT EXISTS sales(
  id INTEGER PRIMARY KEY, invoice_no TEXT NOT NULL UNIQUE, fy TEXT, seq INTEGER, party_id INTEGER NOT NULL REFERENCES parties(id),
  date TEXT NOT NULL, godown_id INTEGER NOT NULL REFERENCES godowns(id), vehicle TEXT DEFAULT '', subtotal REAL,
  discount_type TEXT DEFAULT 'amount', discount_value REAL DEFAULT 0, discount_amt REAL, taxable REAL, cgst REAL, sgst REAL, igst REAL,
  round_off REAL, total REAL, paid REAL DEFAULT 0, notes TEXT DEFAULT '', status TEXT DEFAULT 'active', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sale_items(
  id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL, rate REAL, gst_rate REAL, gross REAL, taxable REAL, gst_amt REAL, line_total REAL);
CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY, ref_type TEXT NOT NULL, ref_id INTEGER NOT NULL, amount REAL NOT NULL, date TEXT NOT NULL,
  mode TEXT DEFAULT 'Cash', note TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS employees(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT DEFAULT '', designation TEXT DEFAULT '', address TEXT DEFAULT '',
  aadhaar TEXT DEFAULT '', joining_date TEXT DEFAULT '', salary REAL DEFAULT 0, status TEXT DEFAULT 'active', notes TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS salary_payments(
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), month TEXT NOT NULL,
  base REAL DEFAULT 0, bonus REAL DEFAULT 0, deduction REAL DEFAULT 0, advance REAL DEFAULT 0, net REAL DEFAULT 0,
  paid_date TEXT, mode TEXT DEFAULT 'Cash', note TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(employee_id, month));
`);

/* ----------------------------------------------------------- default data */
const DEFAULT_SETTINGS = {
  shop_name: 'Your Solar Shop', tagline: 'Solar Panels | Inverters | Batteries | Installation',
  address: 'Enter your shop address here', phone: '', email: '', gstin: '', state: 'Haryana',
  invoice_prefix: 'INV', bank_details: '', terms: '1. Goods once sold will not be taken back.\n2. Warranty on panels/inverters as per the manufacturer\'s terms.\n3. Subject to local jurisdiction.',
  signatory: 'Authorised Signatory'
};
for (const [k, v] of Object.entries(DEFAULT_SETTINGS))
  db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(k, v);


// migrate old default texts (only if the shop never changed them)
for (const [k, o, n] of [
  ['address', 'Shop address yaha likhein', DEFAULT_SETTINGS.address],
  ['terms', '1. Maal bik jane ke baad wapas nahi hoga.\n2. Panel/Inverter ki warranty manufacturer ke niyam anusar.\n3. Subject to local jurisdiction.', DEFAULT_SETTINGS.terms]])
  db.prepare('UPDATE settings SET value=? WHERE key=? AND value=?').run(n, k, o);

function hashPw(pw, salt) { return crypto.scryptSync(pw, salt, 32).toString('hex'); }
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const salt = crypto.randomBytes(8).toString('hex');
  db.prepare('INSERT INTO users(username,salt,hash) VALUES(?,?,?)').run('admin', salt, hashPw('admin123', salt));
  console.log('Default login created -> user: admin  password: admin123  (change it after login)');
}
if (!db.prepare('SELECT 1 FROM godowns LIMIT 1').get())
  db.prepare('INSERT INTO godowns(name,location) VALUES(?,?)').run('Main Godown', 'Main');

/* ----------------------------------------------------------------- helpers */
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = msg => { throw new HttpError(400, msg); };

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
const rows = (sql, ...p) => db.prepare(sql).all(...p).map(r => ({ ...r }));
const row = (sql, ...p) => { const r = db.prepare(sql).get(...p); return r ? { ...r } : undefined; };
const run = (sql, ...p) => db.prepare(sql).run(...p);
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // IST date

const getSettings = () => Object.fromEntries(rows('SELECT key,value FROM settings').map(r => [r.key, r.value]));
const fyOf = d => { const [y, m] = d.split('-').map(Number); const s = m >= 4 ? y : y - 1; return `${s}-${String(s + 1).slice(2)}`; };

function changeStock(product_id, godown_id, delta, type, ref, date, note = '') {
  run('INSERT OR IGNORE INTO stock(product_id,godown_id,qty) VALUES(?,?,0)', product_id, godown_id);
  const cur = row('SELECT qty FROM stock WHERE product_id=? AND godown_id=?', product_id, godown_id).qty;
  if (cur + delta < -1e-9) {
    const p = row('SELECT name FROM products WHERE id=?', product_id);
    const g = row('SELECT name FROM godowns WHERE id=?', godown_id);
    bad(`Insufficient stock: only ${cur} of "${p.name}" left in ${g.name}`);
  }
  run('UPDATE stock SET qty = qty + ? WHERE product_id=? AND godown_id=?', delta, product_id, godown_id);
  run('INSERT INTO stock_moves(date,product_id,godown_id,qty,type,ref,note) VALUES(?,?,?,?,?,?,?)',
    date, product_id, godown_id, delta, type, ref, note);
}

/* Bill calculation (GST and discount) - the server computes the final amount */
function calcBill(items, discount_type, discount_value, interstate) {
  if (!Array.isArray(items) || !items.length) bad('At least one item is required');
  const lines = items.map(it => {
    const qty = num(it.qty), rate = num(it.rate), gst_rate = num(it.gst_rate);
    if (!it.product_id) bad('Select a product for every item');
    if (qty <= 0) bad('Quantity must be greater than 0');
    if (rate < 0) bad('Invalid rate');
    return { product_id: Number(it.product_id), qty, rate, gst_rate, gross: r2(qty * rate) };
  });
  const subtotal = r2(lines.reduce((s, l) => s + l.gross, 0));
  let discount_amt = discount_type === 'percent' ? r2(subtotal * num(discount_value) / 100) : r2(num(discount_value));
  if (discount_amt < 0) discount_amt = 0;
  if (discount_amt > subtotal) bad('Discount cannot exceed the bill amount');
  let taxable = 0, gst = 0;
  for (const l of lines) {
    const share = subtotal ? l.gross / subtotal : 0;
    l.taxable = r2(l.gross - discount_amt * share);
    l.gst_amt = r2(l.taxable * l.gst_rate / 100);
    l.line_total = r2(l.taxable + l.gst_amt);
    taxable += l.taxable; gst += l.gst_amt;
  }
  taxable = r2(taxable); gst = r2(gst);
  const cgst = interstate ? 0 : r2(gst / 2), sgst = interstate ? 0 : r2(gst - r2(gst / 2));
  const igst = interstate ? gst : 0;
  const exact = taxable + gst, total = Math.round(exact), round_off = r2(total - exact);
  return { lines, subtotal, discount_amt, taxable, cgst, sgst, igst, round_off, total };
}
const isInterstate = (party, settings) =>
  !!(party.state && settings.state && party.state.trim().toLowerCase() !== settings.state.trim().toLowerCase());

/* ---------------------------------------------------------- bill handlers */
function createBill(kind, b) {
  const S = getSettings();
  const party = row('SELECT * FROM parties WHERE id=?', b.party_id) || bad('Select a party');
  const godown = row('SELECT * FROM godowns WHERE id=?', b.godown_id) || bad('Select a godown');
  const date = b.date || today();
  const c = calcBill(b.items, b.discount_type === 'percent' ? 'percent' : 'amount', b.discount_value, isInterstate(party, S));
  const paid = r2(num(b.paid));
  if (paid < 0 || paid > c.total) bad('Invalid paid amount');

  return tx(() => {
    const T = kind === 'sale' ? 'sales' : 'purchases';
    const I = kind === 'sale' ? 'sale_items' : 'purchase_items';
    const FK = kind === 'sale' ? 'sale_id' : 'purchase_id';
    let id, no;
    const common = [b.party_id, date, b.godown_id, c.subtotal, b.discount_type === 'percent' ? 'percent' : 'amount',
      num(b.discount_value), c.discount_amt, c.taxable, c.cgst, c.sgst, c.igst, c.round_off, c.total, 0, b.notes || ''];
    if (kind === 'sale') {
      const fy = fyOf(date);
      const seq = (row('SELECT MAX(seq) m FROM sales WHERE fy=?', fy).m || 0) + 1;
      no = `${S.invoice_prefix || 'INV'}/${fy}/${String(seq).padStart(4, '0')}`;
      id = Number(run(`INSERT INTO sales(invoice_no,fy,seq,party_id,date,godown_id,subtotal,discount_type,discount_value,discount_amt,taxable,cgst,sgst,igst,round_off,total,paid,notes,vehicle)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, no, fy, seq, ...common, b.vehicle || '').lastInsertRowid);
    } else {
      no = (b.bill_no || '').trim() || bad('Enter the supplier bill number');
      id = Number(run(`INSERT INTO purchases(bill_no,party_id,date,godown_id,subtotal,discount_type,discount_value,discount_amt,taxable,cgst,sgst,igst,round_off,total,paid,notes)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, no, ...common).lastInsertRowid);
    }
    for (const l of c.lines) {
      run(`INSERT INTO ${I}(${FK},product_id,qty,rate,gst_rate,gross,taxable,gst_amt,line_total) VALUES(?,?,?,?,?,?,?,?,?)`,
        id, l.product_id, l.qty, l.rate, l.gst_rate, l.gross, l.taxable, l.gst_amt, l.line_total);
      changeStock(l.product_id, b.godown_id, kind === 'sale' ? -l.qty : l.qty,
        kind === 'sale' ? 'DISPATCH' : 'RECEIPT', no, date, party.name);
    }
    if (paid > 0) addPayment(kind, id, paid, date, b.pay_mode || 'Cash', 'Paid with bill');
    return getBill(kind, id);
  });
}

function addPayment(kind, id, amount, date, mode, note) {
  const T = kind === 'sale' ? 'sales' : 'purchases';
  const bill = row(`SELECT total,paid,status FROM ${T} WHERE id=?`, id) || bad('Bill not found');
  if (bill.status !== 'active') bad('Cannot add a payment to a cancelled bill');
  amount = r2(amount);
  if (amount <= 0) bad('Amount must be greater than 0');
  if (amount > r2(bill.total - bill.paid) + 0.001) bad('Amount exceeds the balance due');
  run('INSERT INTO payments(ref_type,ref_id,amount,date,mode,note) VALUES(?,?,?,?,?,?)', kind, id, amount, date || today(), mode || 'Cash', note || '');
  run(`UPDATE ${T} SET paid = paid + ? WHERE id=?`, amount, id);
}

function getBill(kind, id) {
  const T = kind === 'sale' ? 'sales' : 'purchases';
  const I = kind === 'sale' ? 'sale_items' : 'purchase_items';
  const FK = kind === 'sale' ? 'sale_id' : 'purchase_id';
  const bill = row(`SELECT * FROM ${T} WHERE id=?`, id) || (() => { throw new HttpError(404, 'Bill not found'); })();
  bill.items = rows(`SELECT i.*, p.name product_name, p.hsn, p.unit FROM ${I} i JOIN products p ON p.id=i.product_id WHERE i.${FK}=? ORDER BY i.id`, id);
  bill.party = row('SELECT * FROM parties WHERE id=?', bill.party_id);
  bill.godown = row('SELECT * FROM godowns WHERE id=?', bill.godown_id);
  bill.payments = rows('SELECT * FROM payments WHERE ref_type=? AND ref_id=? ORDER BY id', kind, id);
  bill.balance = r2(bill.total - bill.paid);
  bill.number = kind === 'sale' ? bill.invoice_no : bill.bill_no;
  return bill;
}

function cancelBill(kind, id) {
  return tx(() => {
    const bill = getBill(kind, id);
    if (bill.status === 'cancelled') bad('Bill is already cancelled');
    for (const it of bill.items)
      changeStock(it.product_id, bill.godown_id, kind === 'sale' ? it.qty : -it.qty,
        'CANCEL', bill.number, today(), 'Bill cancelled');
    run(`UPDATE ${kind === 'sale' ? 'sales' : 'purchases'} SET status='cancelled' WHERE id=?`, id);
    return getBill(kind, id);
  });
}

/* --------------------------------------------------------------- generic */
function crud(table, fields) {
  return {
    insert(b) {
      const vals = fields.map(f => b[f] ?? null);
      return Number(run(`INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`, ...vals).lastInsertRowid);
    },
    update(id, b) {
      const fs_ = fields.filter(f => f in b);
      if (!fs_.length) return;
      run(`UPDATE ${table} SET ${fs_.map(f => f + '=?').join(',')} WHERE id=?`, ...fs_.map(f => b[f]), id);
    }
  };
}
const productF = ['name', 'category', 'brand', 'hsn', 'unit', 'gst_rate', 'purchase_price', 'sale_price', 'min_stock', 'active'];
const partyF = ['name', 'type', 'phone', 'gstin', 'address', 'city', 'state', 'active'];
const empF = ['name', 'phone', 'designation', 'address', 'aadhaar', 'joining_date', 'salary', 'status', 'notes'];
const C = { products: crud('products', productF), parties: crud('parties', partyF), employees: crud('employees', empF), godowns: crud('godowns', ['name', 'location', 'active']) };

/* ----------------------------------------------------------------- routes */
const routes = [];
const route = (method, pattern, fn, open = false) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, fn, open });
};

const attempts = new Map(); // ip -> {n, t}  (to block password guessing)
route('POST', '/api/login', ({ body, ip }) => {
  const a = attempts.get(ip);
  if (a && Date.now() - a.t < 15 * 60e3 && a.n >= 8) throw new HttpError(429, 'Too many failed attempts. Try again after 15 minutes');
  const u = row('SELECT * FROM users WHERE username=?', (body.username || '').trim());
  if (!u || hashPw(body.password || '', u.salt) !== u.hash) {
    const c = attempts.get(ip);
    attempts.set(ip, c && Date.now() - c.t < 15 * 60e3 ? { n: c.n + 1, t: c.t } : { n: 1, t: Date.now() });
    throw new HttpError(401, 'Incorrect username or password');
  }
  attempts.delete(ip);
  const token = crypto.randomBytes(24).toString('hex');
  run('INSERT INTO sessions(token,user_id) VALUES(?,?)', token, u.id);
  return { token, username: u.username };
}, true);
route('POST', '/api/logout', ({ token }) => { run('DELETE FROM sessions WHERE token=?', token); return { ok: true }; });
route('POST', '/api/change-password', ({ body, user }) => {
  const u = row('SELECT * FROM users WHERE id=?', user.id);
  if (hashPw(body.old_password || '', u.salt) !== u.hash) bad('Old password is incorrect');
  if (!body.new_password || body.new_password.length < 6) bad('New password must be at least 6 characters');
  const salt = crypto.randomBytes(8).toString('hex');
  run('UPDATE users SET salt=?, hash=? WHERE id=?', salt, hashPw(body.new_password, salt), u.id);
  return { ok: true };
});

route('GET', '/api/settings', () => getSettings());
route('PUT', '/api/settings', ({ body }) => {
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in body) run('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', k, String(body[k] ?? ''));
  return getSettings();
});

/* dashboard */
route('GET', '/api/dashboard', () => {
  const t = today(), m = t.slice(0, 7);
  const stockValue = row(`SELECT COALESCE(SUM(s.qty*p.purchase_price),0) v, COALESCE(SUM(s.qty),0) q FROM stock s JOIN products p ON p.id=s.product_id`);
  const low = rows(`SELECT p.id,p.name,p.min_stock,p.unit,COALESCE(SUM(s.qty),0) qty FROM products p LEFT JOIN stock s ON s.product_id=p.id
    WHERE p.active=1 GROUP BY p.id HAVING qty <= p.min_stock AND p.min_stock > 0`);
  return {
    stock_value: r2(stockValue.v), stock_qty: stockValue.q,
    products: row('SELECT COUNT(*) c FROM products WHERE active=1').c,
    today_sales: r2(row(`SELECT COALESCE(SUM(total),0) v FROM sales WHERE status='active' AND date=?`, t).v),
    month_sales: r2(row(`SELECT COALESCE(SUM(total),0) v FROM sales WHERE status='active' AND substr(date,1,7)=?`, m).v),
    month_purchase: r2(row(`SELECT COALESCE(SUM(total),0) v FROM purchases WHERE status='active' AND substr(date,1,7)=?`, m).v),
    receivable: r2(row(`SELECT COALESCE(SUM(total-paid),0) v FROM sales WHERE status='active'`).v),
    payable: r2(row(`SELECT COALESCE(SUM(total-paid),0) v FROM purchases WHERE status='active'`).v),
    employees: row(`SELECT COUNT(*) c FROM employees WHERE status='active'`).c,
    month_salary: r2(row(`SELECT COALESCE(SUM(net),0) v FROM salary_payments WHERE month=?`, m).v),
    low_stock: low,
    recent_sales: rows(`SELECT s.id,s.invoice_no,s.date,s.total,s.paid,p.name party FROM sales s JOIN parties p ON p.id=s.party_id WHERE s.status='active' ORDER BY s.id DESC LIMIT 6`),
    recent_purchases: rows(`SELECT s.id,s.bill_no,s.date,s.total,s.paid,p.name party FROM purchases s JOIN parties p ON p.id=s.party_id WHERE s.status='active' ORDER BY s.id DESC LIMIT 6`)
  };
});

/* products */
route('GET', '/api/products', () => rows(`SELECT p.*, COALESCE((SELECT SUM(qty) FROM stock WHERE product_id=p.id),0) stock FROM products p ORDER BY p.active DESC, p.name`));
route('POST', '/api/products', ({ body }) => {
  if (!(body.name || '').trim()) bad('Enter the product name');
  return { id: C.products.insert({ ...{ category: 'Solar Panel', hsn: '8541', unit: 'Nos', gst_rate: 12, purchase_price: 0, sale_price: 0, min_stock: 0, active: 1, brand: '' }, ...body }) };
});
route('PUT', '/api/products/:id', ({ params, body }) => { C.products.update(params.id, body); return { ok: true }; });

/* godowns */
route('GET', '/api/godowns', () => rows(`SELECT g.*, COALESCE((SELECT SUM(qty) FROM stock WHERE godown_id=g.id),0) total_qty FROM godowns g ORDER BY g.name`));
route('POST', '/api/godowns', ({ body }) => {
  if (!(body.name || '').trim()) bad('Enter the godown name');
  try { return { id: C.godowns.insert({ location: '', active: 1, ...body }) }; } catch { bad('A godown with this name already exists'); }
});
route('PUT', '/api/godowns/:id', ({ params, body }) => { C.godowns.update(params.id, body); return { ok: true }; });

/* stock */
route('GET', '/api/stock', () => {
  const products = rows(`SELECT id,name,category,unit,min_stock,purchase_price,sale_price FROM products WHERE active=1 ORDER BY name`);
  const godowns = rows(`SELECT id,name FROM godowns WHERE active=1 ORDER BY name`);
  const st = rows('SELECT product_id,godown_id,qty FROM stock');
  const map = {}; st.forEach(s => { (map[s.product_id] ||= {})[s.godown_id] = s.qty; });
  return {
    godowns,
    items: products.map(p => {
      const per = map[p.id] || {};
      const total = Object.values(per).reduce((a, b) => a + b, 0);
      return { ...p, per_godown: per, total, value: r2(total * p.purchase_price) };
    })
  };
});
route('GET', '/api/stock/moves', ({ query }) => {
  const w = [], p = [];
  if (query.product_id) { w.push('m.product_id=?'); p.push(query.product_id); }
  if (query.godown_id) { w.push('m.godown_id=?'); p.push(query.godown_id); }
  return rows(`SELECT m.*, pr.name product, g.name godown FROM stock_moves m JOIN products pr ON pr.id=m.product_id JOIN godowns g ON g.id=m.godown_id
    ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY m.id DESC LIMIT 300`, ...p);
});
route('POST', '/api/stock/adjust', ({ body }) => tx(() => {
  const qty = num(body.qty);
  if (!qty) bad('Enter a quantity (+ or -)');
  changeStock(Number(body.product_id), Number(body.godown_id), qty, qty > 0 ? 'ADJUST+' : 'ADJUST-', 'Manual', body.date || today(), body.note || 'Opening/Adjustment');
  return { ok: true };
}));
route('POST', '/api/stock/transfer', ({ body }) => tx(() => {
  const qty = num(body.qty), from = Number(body.from_godown), to = Number(body.to_godown), pid = Number(body.product_id);
  if (qty <= 0) bad('Quantity must be greater than 0');
  if (from === to) bad('Source and destination godowns must be different');
  const d = body.date || today();
  changeStock(pid, from, -qty, 'TRANSFER-OUT', 'Transfer', d, body.note || '');
  changeStock(pid, to, qty, 'TRANSFER-IN', 'Transfer', d, body.note || '');
  return { ok: true };
}));

/* parties */
route('GET', '/api/parties', ({ query }) => {
  const rowsP = rows(`SELECT * FROM parties ${query.type ? 'WHERE type=?' : ''} ORDER BY active DESC, name`, ...(query.type ? [query.type] : []));
  for (const p of rowsP) {
    p.sale_due = r2(row(`SELECT COALESCE(SUM(total-paid),0) v FROM sales WHERE party_id=? AND status='active'`, p.id).v);
    p.purchase_due = r2(row(`SELECT COALESCE(SUM(total-paid),0) v FROM purchases WHERE party_id=? AND status='active'`, p.id).v);
  }
  return rowsP;
});
route('POST', '/api/parties', ({ body }) => {
  if (!(body.name || '').trim()) bad('Enter the party name');
  return { id: C.parties.insert({ type: 'customer', phone: '', gstin: '', address: '', city: '', state: '', active: 1, ...body }) };
});
route('PUT', '/api/parties/:id', ({ params, body }) => { C.parties.update(params.id, body); return { ok: true }; });

/* bills */
for (const [kind, base] of [['sale', 'sales'], ['purchase', 'purchases']]) {
  route('GET', `/api/${base}`, ({ query }) => {
    const w = [], p = [];
    if (query.from) { w.push('b.date>=?'); p.push(query.from); }
    if (query.to) { w.push('b.date<=?'); p.push(query.to); }
    if (query.party_id) { w.push('b.party_id=?'); p.push(query.party_id); }
    return rows(`SELECT b.*, pa.name party_name, ${kind === 'sale' ? 'b.invoice_no' : 'b.bill_no'} number, (b.total-b.paid) balance
      FROM ${base} b JOIN parties pa ON pa.id=b.party_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY b.date DESC, b.id DESC LIMIT 500`, ...p);
  });
  route('GET', `/api/${base}/:id`, ({ params }) => getBill(kind, Number(params.id)));
  route('POST', `/api/${base}`, ({ body }) => createBill(kind, body));
  route('POST', `/api/${base}/:id/cancel`, ({ params }) => cancelBill(kind, Number(params.id)));
  route('POST', `/api/${base}/:id/pay`, ({ params, body }) => tx(() => {
    addPayment(kind, Number(params.id), num(body.amount), body.date, body.mode, body.note);
    return getBill(kind, Number(params.id));
  }));
}

/* employees & salary */
route('GET', '/api/employees', () => rows('SELECT * FROM employees ORDER BY status, name'));
route('POST', '/api/employees', ({ body }) => {
  if (!(body.name || '').trim()) bad('Enter the employee name');
  return { id: C.employees.insert({ phone: '', designation: '', address: '', aadhaar: '', joining_date: today(), salary: 0, status: 'active', notes: '', ...body }) };
});
route('PUT', '/api/employees/:id', ({ params, body }) => { C.employees.update(params.id, body); return { ok: true }; });

route('GET', '/api/salary', ({ query }) => {
  const month = query.month || today().slice(0, 7);
  return rows(`SELECT e.id employee_id, e.name, e.designation, e.salary, e.status,
      sp.id payment_id, sp.base, sp.bonus, sp.deduction, sp.advance, sp.net, sp.paid_date, sp.mode, sp.note
    FROM employees e LEFT JOIN salary_payments sp ON sp.employee_id=e.id AND sp.month=?
    WHERE e.status='active' OR sp.id IS NOT NULL ORDER BY e.name`, month).map(r => ({ ...r, month }));
});
route('POST', '/api/salary', ({ body }) => {
  const emp = row('SELECT * FROM employees WHERE id=?', body.employee_id) || bad('Select an employee');
  if (!/^\d{4}-\d{2}$/.test(body.month || '')) bad('Select a month');
  const base = num(body.base, emp.salary), bonus = num(body.bonus), deduction = num(body.deduction), advance = num(body.advance);
  const net = r2(base + bonus - deduction - advance);
  if (net < 0) bad('Net salary cannot be negative');
  try {
    run(`INSERT INTO salary_payments(employee_id,month,base,bonus,deduction,advance,net,paid_date,mode,note) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      emp.id, body.month, base, bonus, deduction, advance, net, body.paid_date || today(), body.mode || 'Cash', body.note || '');
  } catch { bad('Salary for this month has already been paid'); }
  return { ok: true, net };
});
route('DELETE', '/api/salary/:id', ({ params }) => { run('DELETE FROM salary_payments WHERE id=?', params.id); return { ok: true }; });
route('GET', '/api/salary/history/:id', ({ params }) => rows('SELECT * FROM salary_payments WHERE employee_id=? ORDER BY month DESC', params.id));

/* backup */
route('GET', '/api/backup', () => {
  const f = path.join(DATA_DIR, `backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
  const buf = fs.readFileSync(f); fs.unlinkSync(f);
  return { __raw: buf, type: 'application/octet-stream', name: `solar-backup-${today()}.db` };
});

/* ------------------------------------------------------------------ server */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ''; req.on('data', c => { d += c; if (d.length > 2e6) { req.destroy(); reject(new HttpError(413, 'Too large')); } });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { reject(new HttpError(400, 'Bad JSON')); } });
  });
}
const send = (res, code, data, headers = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      const pn = url.pathname.replace(/\/+$/, '');
      let matched = null, params = {};
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(pn);
        if (m) { matched = r; r.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1])); break; }
      }
      if (!matched) throw new HttpError(404, 'API not found');
      const token = (req.headers.authorization || '').replace('Bearer ', '') || url.searchParams.get('token') || '';
      let user = null;
      if (!matched.open) {
        user = row('SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?', token);
        if (!user) throw new HttpError(401, 'Please log in');
      }
      const body = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : {};
      const query = Object.fromEntries(url.searchParams);
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
      const out = matched.fn({ params, body, query, user, token, ip });
      if (out && out.__raw) {
        res.writeHead(200, { 'Content-Type': out.type, 'Content-Disposition': `attachment; filename="${out.name}"` });
        return res.end(out.__raw);
      }
      return send(res, 200, out);
    }
    // static files
    let rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Server error: ' + e.message });
  }
}).listen(PORT, HOST, () => console.log(`Solar ERP is running -> http://localhost:${PORT}   (DB: ${DB_FILE})`));
