/* Solar Shop ERP - frontend (vanilla JS) */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qf = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const fdate = d => d ? d.split('-').reverse().join('-') : '';
const STATES = ['Andhra Pradesh','Bihar','Chandigarh','Chhattisgarh','Delhi','Gujarat','Haryana','Himachal Pradesh','Jammu & Kashmir','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Odisha','Punjab','Rajasthan','Tamil Nadu','Telangana','Uttar Pradesh','Uttarakhand','West Bengal'];
const CATS = ['Solar Panel', 'Inverter', 'Battery', 'Charge Controller', 'Structure', 'Cable/Wire', 'Other'];

let TOKEN = localStorage.getItem('erp_token') || '';
let SETTINGS = {};

async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401 && path !== '/login') { showLogin(); throw new Error('Please log in'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = err ? 'err' : ''; t.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 3200);
}
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

/* ---------------- modal ---------------- */
let closeStack = [];
function modal(title, body, { footer = '', wide = false, onMount } = {}) {
  const m = $('#modal');
  m.innerHTML = `<div class="mbox ${wide ? 'wide' : ''}"><div class="mh"><h3>${title}</h3><button class="x" type="button">×</button></div>
    <div class="mb">${body}</div>${footer ? `<div class="mf">${footer}</div>` : ''}</div>`;
  m.classList.remove('hidden');
  const close = () => { m.classList.add('hidden'); m.innerHTML = ''; };
  $('.x', m).onclick = close;
  m.onmousedown = e => { if (e.target === m) close(); };
  if (onMount) onMount(m, close);
  return close;
}
const formVals = root => {
  const o = {};
  root.querySelectorAll('[name]').forEach(el => { o[el.name] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value; });
  return o;
};
const opt = (list, val, label = x => x.name, v = x => x.id) =>
  list.map(x => `<option value="${esc(v(x))}" ${String(v(x)) === String(val) ? 'selected' : ''}>${esc(label(x))}</option>`).join('');
const field = (label, name, val = '', type = 'text', extra = '') =>
  `<div><label class="f">${label}</label><input name="${name}" type="${type}" value="${esc(val)}" ${extra}></div>`;

/* ---------------- auth ---------------- */
function showLogin() { TOKEN = ''; localStorage.removeItem('erp_token'); $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const r = await api('/login', 'POST', formVals(e.target));
    TOKEN = r.token; localStorage.setItem('erp_token', TOKEN); $('#loginErr').textContent = ''; boot();
  } catch (er) { $('#loginErr').textContent = er.message; }
};
$('#logout').onclick = async () => { try { await api('/logout', 'POST', {}); } catch {} showLogin(); };

async function boot() {
  try { SETTINGS = await api('/settings'); } catch { return showLogin(); }
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#brandName').textContent = SETTINGS.shop_name || 'Solar ERP';
  route();
}
window.addEventListener('hashchange', route);

const PAGES = {};
function route() {
  const name = (location.hash.replace('#/', '') || 'dashboard');
  document.querySelectorAll('#side a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#/' + name));
  const p = PAGES[name] || PAGES.dashboard;
  $('#main').innerHTML = '<p class="muted">Loading...</p>';
  guard(p)();
}

/* ---------------- dashboard ---------------- */
PAGES.dashboard = async () => {
  const d = await api('/dashboard');
  const card = (k, v, cls = '') => `<div class="card ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const list = (rowsx, nk) => rowsx.length ? `<table><tbody>${rowsx.map(r => `<tr><td><b>${esc(r[nk])}</b><div class="hint">${esc(r.party)} • ${fdate(r.date)}</div></td>
    <td class="r">${inr(r.total)}<div class="hint ${r.total - r.paid > 0 ? 'neg' : 'pos'}">${r.total - r.paid > 0 ? 'Due ' + inr(r.total - r.paid) : 'Paid'}</div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No bills yet</div>';
  $('#main').innerHTML = `<h2>Dashboard</h2>
  <div class="cards">
    ${card('Total stock in godowns (qty)', qf(d.stock_qty), 'sunny')}
    ${card('Stock value (at purchase price)', inr(d.stock_value), 'sunny')}
    ${card("Today's sales", inr(d.today_sales), 'good')}
    ${card("This month's sales", inr(d.month_sales), 'good')}
    ${card("This month's purchases", inr(d.month_purchase))}
    ${card('Receivable from customers', inr(d.receivable), d.receivable > 0 ? 'warn' : '')}
    ${card('Payable to suppliers', inr(d.payable), d.payable > 0 ? 'warn' : '')}
    ${card('Active Employees', d.employees)}
    ${card('Salary paid this month', inr(d.month_salary))}
  </div>
  <div class="panel"><h3>⚠️ Low stock items</h3>${d.low_stock.length ? `<table><tbody>${d.low_stock.map(p =>
    `<tr><td>${esc(p.name)}</td><td class="r neg">${qf(p.qty)} ${esc(p.unit)} left (min ${qf(p.min_stock)})</td></tr>`).join('')}</tbody></table>` : '<div class="muted">All items are sufficiently stocked ✔</div>'}</div>
  <div class="two">
    <div class="panel"><h3>Recent Dispatches / Invoices</h3>${list(d.recent_sales, 'invoice_no')}</div>
    <div class="panel"><h3>Recent Goods Received</h3>${list(d.recent_purchases, 'bill_no')}</div>
  </div>`;
};

/* ---------------- products ---------------- */
PAGES.products = async () => {
  const list = await api('/products');
  $('#main').innerHTML = `<h2>Products</h2>
  <div class="bar"><input id="q" placeholder="Search product..."><span class="sp"></span><button class="btn sun" id="add">+ New Product</button></div>
  <div class="tw"><table><thead><tr><th>Name</th><th>Category</th><th>HSN</th><th class="r">GST%</th><th class="r">Purchase Rate</th><th class="r">Sale Rate</th><th class="r">Total Stock</th><th>Status</th><th></th></tr></thead>
  <tbody id="tb"></tbody></table></div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase();
    const rowsx = list.filter(p => (p.name + p.brand + p.category).toLowerCase().includes(q));
    $('#tb').innerHTML = rowsx.map(p => `<tr><td><b>${esc(p.name)}</b><div class="hint">${esc(p.brand)}</div></td><td>${esc(p.category)}</td><td>${esc(p.hsn)}</td>
      <td class="r">${p.gst_rate}%</td><td class="r">${inr(p.purchase_price)}</td><td class="r">${inr(p.sale_price)}</td>
      <td class="r ${p.min_stock && p.stock <= p.min_stock ? 'neg' : ''}"><b>${qf(p.stock)}</b> ${esc(p.unit)}</td>
      <td>${p.active ? '<span class="badge b-g">Active</span>' : '<span class="badge b-r">Inactive</span>'}</td>
      <td><button class="btn ghost sm" data-id="${p.id}">Edit</button></td></tr>`).join('') || '<tr><td colspan="9" class="empty">No products yet. Click "+ New Product".</td></tr>';
    $('#tb').querySelectorAll('[data-id]').forEach(b => b.onclick = () => productForm(list.find(p => p.id == b.dataset.id)));
  };
  $('#q').oninput = draw; $('#add').onclick = () => productForm(); draw();
};
function productForm(p = {}) {
  modal(p.id ? 'Edit Product' : 'New Product', `<div class="grid" id="f">
    <div class="full">${field('Product name *', 'name', p.name, 'text', 'placeholder="e.g. Waaree 540W Mono PERC Panel"')}</div>
    <div><label class="f">Category</label><select name="category">${opt(CATS, p.category || 'Solar Panel', x => x, x => x)}</select></div>
    ${field('Brand', 'brand', p.brand)}
    ${field('HSN Code', 'hsn', p.hsn ?? '8541')}
    ${field('Unit (Nos/Mtr/Set)', 'unit', p.unit ?? 'Nos')}
    ${field('GST %', 'gst_rate', p.gst_rate ?? 12, 'number', 'step="0.01"')}
    ${field('Min. stock (alert)', 'min_stock', p.min_stock ?? 0, 'number')}
    ${field('Purchase Rate (₹)', 'purchase_price', p.purchase_price ?? 0, 'number', 'step="0.01"')}
    ${field('Sale Rate (₹)', 'sale_price', p.sale_price ?? 0, 'number', 'step="0.01"')}
    <div><label class="f">Status</label><select name="active"><option value="1" ${p.active !== 0 ? 'selected' : ''}>Active</option><option value="0" ${p.active === 0 ? 'selected' : ''}>Inactive</option></select></div>
  </div>`, {
    footer: '<button class="btn ghost" id="c">Cancel</button><button class="btn sun" id="s">Save</button>',
    onMount: (m, close) => {
      $('#c', m).onclick = close;
      $('#s', m).onclick = guard(async () => {
        const v = formVals($('#f', m)); v.active = Number(v.active);
        if (p.id) await api('/products/' + p.id, 'PUT', v); else await api('/products', 'POST', v);
        close(); toast('Saved ✔'); PAGES.products();
      });
    }
  });
}

/* ---------------- godowns ---------------- */
PAGES.godowns = async () => {
  const list = await api('/godowns');
  $('#main').innerHTML = `<h2>Godown List</h2><div class="bar"><span class="sp"></span><button class="btn sun" id="add">+ New Godown</button></div>
  <div class="tw"><table><thead><tr><th>Godown</th><th>Location</th><th class="r">Total Qty</th><th>Status</th><th></th></tr></thead><tbody>
  ${list.map(g => `<tr><td><b>${esc(g.name)}</b></td><td>${esc(g.location)}</td><td class="r">${qf(g.total_qty)}</td>
   <td>${g.active ? '<span class="badge b-g">Active</span>' : '<span class="badge b-r">Inactive</span>'}</td><td><button class="btn ghost sm" data-id="${g.id}">Edit</button></td></tr>`).join('')}
  </tbody></table></div>`;
  const form = (g = {}) => modal(g.id ? 'Edit Godown' : 'New Godown', `<div class="grid" id="f">${field('Godown name *', 'name', g.name)}${field('Location / Address', 'location', g.location)}
    <div><label class="f">Status</label><select name="active"><option value="1" ${g.active !== 0 ? 'selected' : ''}>Active</option><option value="0" ${g.active === 0 ? 'selected' : ''}>Inactive</option></select></div></div>`, {
    footer: '<button class="btn ghost" id="c">Cancel</button><button class="btn sun" id="s">Save</button>',
    onMount: (m, close) => { $('#c', m).onclick = close; $('#s', m).onclick = guard(async () => {
      const v = formVals($('#f', m)); v.active = Number(v.active);
      if (g.id) await api('/godowns/' + g.id, 'PUT', v); else await api('/godowns', 'POST', v);
      close(); toast('Saved ✔'); PAGES.godowns(); }); }
  });
  $('#add').onclick = () => form();
  $('#main').querySelectorAll('[data-id]').forEach(b => b.onclick = () => form(list.find(g => g.id == b.dataset.id)));
};

/* ---------------- stock ---------------- */
PAGES.stock = async () => {
  const s = await api('/stock');
  $('#main').innerHTML = `<h2>Stock by Godown</h2>
  <div class="bar"><input id="q" placeholder="Search..."><span class="sp"></span>
    <button class="btn ghost" id="mv">📜 Stock History</button><button class="btn ghost" id="tr">⇄ Godown Transfer</button><button class="btn sun" id="adj">± Adjust Stock</button></div>
  <div class="tw"><table><thead><tr><th>Product</th>${s.godowns.map(g => `<th class="r">${esc(g.name)}</th>`).join('')}<th class="r">Total Stock</th><th class="r">Stock Value</th></tr></thead>
  <tbody id="tb"></tbody><tfoot id="tf"></tfoot></table></div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase(); let tv = 0;
    const items = s.items.filter(i => i.name.toLowerCase().includes(q));
    $('#tb').innerHTML = items.map(i => { tv += i.value; return `<tr><td><b>${esc(i.name)}</b><div class="hint">${esc(i.category)}</div></td>
      ${s.godowns.map(g => `<td class="r">${qf(i.per_godown[g.id] || 0)}</td>`).join('')}
      <td class="r ${i.min_stock && i.total <= i.min_stock ? 'neg' : ''}"><b>${qf(i.total)}</b> ${esc(i.unit)}</td><td class="r">${inr(i.value)}</td></tr>`; }).join('')
      || `<tr><td colspan="${s.godowns.length + 3}" class="empty">No products</td></tr>`;
    $('#tf').innerHTML = `<tr><td colspan="${s.godowns.length + 2}" class="r"><b>Total Stock Value</b></td><td class="r"><b>${inr(tv)}</b></td></tr>`;
  };
  $('#q').oninput = draw; draw();
  const pSel = () => opt(s.items, '', x => x.name), gSel = () => opt(s.godowns, '', x => x.name);
  $('#adj').onclick = () => modal('Adjust Stock', `<div class="grid" id="f">
    <div class="full"><label class="f">Product</label><select name="product_id">${pSel()}</select></div>
    <div><label class="f">Godown</label><select name="godown_id">${gSel()}</select></div>
    ${field('Quantity (+ to add, - to remove)', 'qty', '', 'number', 'step="any"')}
    ${field('Date', 'date', today(), 'date')}${field('Note', 'note', 'Opening stock')}</div>
    <p class="hint">When starting, enter your existing stock as "Opening stock". Stock from bills is added or removed automatically.</p>`, {
    footer: '<button class="btn ghost" id="c">Cancel</button><button class="btn sun" id="s">Save</button>',
    onMount: (m, close) => { $('#c', m).onclick = close; $('#s', m).onclick = guard(async () => { await api('/stock/adjust', 'POST', formVals($('#f', m))); close(); toast('Stock updated ✔'); PAGES.stock(); }); }
  });
  $('#tr').onclick = () => modal('Transfer Between Godowns', `<div class="grid" id="f">
    <div class="full"><label class="f">Product</label><select name="product_id">${pSel()}</select></div>
    <div><label class="f">From</label><select name="from_godown">${gSel()}</select></div>
    <div><label class="f">To</label><select name="to_godown">${opt(s.godowns, s.godowns[1]?.id, x => x.name)}</select></div>
    ${field('Quantity', 'qty', '', 'number', 'step="any"')}${field('Date', 'date', today(), 'date')}</div>`, {
    footer: '<button class="btn ghost" id="c">Cancel</button><button class="btn sun" id="s">Transfer</button>',
    onMount: (m, close) => { $('#c', m).onclick = close; $('#s', m).onclick = guard(async () => { await api('/stock/transfer', 'POST', formVals($('#f', m))); close(); toast('Transferred ✔'); PAGES.stock(); }); }
  });
  $('#mv').onclick = guard(async () => {
    const moves = await api('/stock/moves');
    modal('Stock History (last 300)', `<div class="tw"><table><thead><tr><th>Date</th><th>Product</th><th>Godown</th><th class="r">Qty</th><th>Type</th><th>Ref</th></tr></thead><tbody>
    ${moves.map(m => `<tr><td>${fdate(m.date)}</td><td>${esc(m.product)}</td><td>${esc(m.godown)}</td><td class="r ${m.qty < 0 ? 'neg' : 'pos'}">${m.qty > 0 ? '+' : ''}${qf(m.qty)}</td><td>${esc(m.type)}</td><td>${esc(m.ref)}<div class="hint">${esc(m.note)}</div></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No entries yet</td></tr>'}</tbody></table></div>`, { wide: true });
  });
};

/* ---------------- parties ---------------- */
let partyTab = 'customer';
PAGES.parties = async () => {
  const all = await api('/parties');
  $('#main').innerHTML = `<h2>Parties (Customers / Suppliers)</h2>
  <div class="bar"><div class="tabs"><button data-t="customer">Customers</button><button data-t="supplier">Suppliers</button></div><input id="q" placeholder="Search..."><span class="sp"></span><button class="btn sun" id="add">+ New Party</button></div>
  <div class="tw"><table><thead><tr><th>Name</th><th>Phone</th><th>GSTIN</th><th>City / State</th><th class="r">Balance Due</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>`;
  const draw = () => {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === partyTab));
    const q = $('#q').value.toLowerCase();
    const l = all.filter(p => p.type === partyTab && (p.name + p.phone + p.city).toLowerCase().includes(q));
    $('#tb').innerHTML = l.map(p => { const due = partyTab === 'customer' ? p.sale_due : p.purchase_due;
      return `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.phone)}</td><td>${esc(p.gstin)}</td><td>${esc(p.city)} ${esc(p.state)}</td>
      <td class="r ${due > 0 ? 'neg' : ''}">${inr(due)}<div class="hint">${partyTab === 'customer' ? 'receivable' : 'payable'}</div></td><td><button class="btn ghost sm" data-id="${p.id}">Edit</button></td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">No parties</td></tr>';
    $('#tb').querySelectorAll('[data-id]').forEach(b => b.onclick = () => partyForm(all.find(p => p.id == b.dataset.id)));
  };
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { partyTab = b.dataset.t; draw(); });
  $('#q').oninput = draw; $('#add').onclick = () => partyForm(); draw();
};
function partyForm(p = {}, after) {
  modal(p.id ? 'Edit Party' : 'New Party', `<div class="grid" id="f">
    <div class="full">${field('Name *', 'name', p.name)}</div>
    <div><label class="f">Type</label><select name="type"><option value="customer" ${(p.type || partyTab) === 'customer' ? 'selected' : ''}>Customer</option><option value="supplier" ${(p.type || partyTab) === 'supplier' ? 'selected' : ''}>Supplier</option></select></div>
    ${field('Phone', 'phone', p.phone)}${field('GSTIN', 'gstin', p.gstin)}${field('City', 'city', p.city)}
    <div><label class="f">State (needed for GST)</label><input name="state" list="states" value="${esc(p.state ?? SETTINGS.state)}"><datalist id="states">${STATES.map(s => `<option>${s}</option>`).join('')}</datalist></div>
    <div class="full"><label class="f">Address</label><textarea name="address" rows="2">${esc(p.address)}</textarea></div></div>`, {
    footer: '<button class="btn ghost" id="c">Cancel</button><button class="btn sun" id="s">Save</button>',
    onMount: (m, close) => { $('#c', m).onclick = close; $('#s', m).onclick = guard(async () => {
      const v = formVals($('#f', m));
      let id = p.id; if (p.id) await api('/parties/' + p.id, 'PUT', v); else id = (await api('/parties', 'POST', v)).id;
      close(); toast('Saved ✔'); if (after) after(id); else PAGES.parties(); }); }
  });
}

/* ---------------- bills (sales / purchases) ---------------- */
const BILL = {
  sale: { base: 'sales', title: 'Dispatch / Sales Invoice', pt: 'customer', numLabel: 'Invoice No', newLabel: '+ New Invoice' },
  purchase: { base: 'purchases', title: 'Goods Received (Purchase Bill)', pt: 'supplier', numLabel: 'Bill No', newLabel: '+ New Receipt' }
};
const billPage = kind => async () => {
  const B = BILL[kind], first = new Date(); first.setDate(1);
  const from = first.toISOString().slice(0, 10);
  $('#main').innerHTML = `<h2>${B.title}</h2>
  <div class="bar"><label class="muted">From</label><input type="date" id="from" value="${from}"><label class="muted">To</label><input type="date" id="to" value="${today()}">
  <button class="btn ghost" id="go">Show</button><span class="sp"></span><button class="btn sun" id="add">${B.newLabel}</button></div>
  <div class="tw"><table><thead><tr><th>${B.numLabel}</th><th>Date</th><th>Party</th><th class="r">Total</th><th class="r">Paid</th><th class="r">Due</th><th>Status</th><th></th></tr></thead><tbody id="tb"></tbody><tfoot id="tf"></tfoot></table></div>`;
  const load = guard(async () => {
    const l = await api(`/${B.base}?from=${$('#from').value}&to=${$('#to').value}`);
    let t = 0, p = 0;
    $('#tb').innerHTML = l.map(b => { if (b.status === 'active') { t += b.total; p += b.paid; }
      return `<tr><td><b>${esc(b.number)}</b></td><td>${fdate(b.date)}</td><td>${esc(b.party_name)}</td><td class="r">${inr(b.total)}</td><td class="r">${inr(b.paid)}</td>
      <td class="r ${b.balance > 0 && b.status === 'active' ? 'neg' : ''}">${inr(b.balance)}</td>
      <td>${b.status === 'cancelled' ? '<span class="badge b-r">Cancelled</span>' : b.balance > 0 ? '<span class="badge b-y">Due</span>' : '<span class="badge b-g">Paid</span>'}</td>
      <td><button class="btn ghost sm" data-id="${b.id}">View</button> <button class="btn ghost sm" data-print="${b.id}">🖨 Print</button></td></tr>`; }).join('') || '<tr><td colspan="8" class="empty">No bills in this period</td></tr>';
    $('#tf').innerHTML = `<tr><td colspan="3" class="r"><b>Total (active bills)</b></td><td class="r"><b>${inr(t)}</b></td><td class="r"><b>${inr(p)}</b></td><td class="r"><b>${inr(t - p)}</b></td><td colspan="2"></td></tr>`;
    $('#tb').querySelectorAll('[data-id]').forEach(b => b.onclick = () => billView(kind, b.dataset.id, load));
    $('#tb').querySelectorAll('[data-print]').forEach(b => b.onclick = () => printBill(kind, b.dataset.print));
  });
  $('#go').onclick = load; $('#add').onclick = () => billForm(kind, load); load();
};
PAGES.sales = billPage('sale'); PAGES.purchases = billPage('purchase');
const printBill = (kind, id) => window.open(`/print.html?type=${kind}&id=${id}`, '_blank');

async function billView(kind, id, reload) {
  const b = await api(`/${BILL[kind].base}/${id}`);
  const close = modal(`${BILL[kind].numLabel}: ${esc(b.number)} ${b.status === 'cancelled' ? '<span class="badge b-r">Cancelled</span>' : ''}`, `
    <p><b>${esc(b.party.name)}</b> • ${esc(b.party.phone)} <span class="muted">${esc(b.party.gstin)}</span><br><span class="hint">${fdate(b.date)} • Godown: ${esc(b.godown.name)} ${b.vehicle ? '• Vehicle: ' + esc(b.vehicle) : ''}</span></p>
    <div class="tw"><table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Taxable</th><th class="r">GST</th><th class="r">Amount</th></tr></thead><tbody>
    ${b.items.map(i => `<tr><td>${esc(i.product_name)}</td><td class="r">${qf(i.qty)}</td><td class="r">${inr(i.rate)}</td><td class="r">${inr(i.taxable)}</td><td class="r">${i.gst_rate}%</td><td class="r">${inr(i.line_total)}</td></tr>`).join('')}</tbody></table></div>
    <div class="tot" style="margin-top:12px"><div><span>Subtotal</span><span>${inr(b.subtotal)}</span></div><div><span>Discount</span><span>- ${inr(b.discount_amt)}</span></div>
    <div><span>Taxable</span><span>${inr(b.taxable)}</span></div>${b.igst ? `<div><span>IGST</span><span>${inr(b.igst)}</span></div>` : `<div><span>CGST</span><span>${inr(b.cgst)}</span></div><div><span>SGST</span><span>${inr(b.sgst)}</span></div>`}
    <div><span>Round off</span><span>${inr(b.round_off)}</span></div><div class="g"><span>Total</span><span>${inr(b.total)}</span></div>
    <div><span>Paid</span><span class="pos">${inr(b.paid)}</span></div><div><span>Due</span><span class="${b.balance > 0 ? 'neg' : ''}">${inr(b.balance)}</span></div></div>
    ${b.payments.length ? `<h4>Payments</h4>${b.payments.map(p => `<div class="hint">${fdate(p.date)} • ${inr(p.amount)} • ${esc(p.mode)} ${esc(p.note)}</div>`).join('')}` : ''}
    ${b.status === 'active' && b.balance > 0 ? `<div class="grid" id="pf" style="margin-top:14px">${field('Payment (₹)', 'amount', b.balance, 'number', 'step="0.01"')}
      <div><label class="f">Mode</label><select name="mode"><option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Cheque</option></select></div>${field('Date', 'date', today(), 'date')}<div style="align-self:end"><button class="btn sun" id="pay">Add Payment</button></div></div>` : ''}`,
    { wide: true, footer: `${b.status === 'active' ? '<button class="btn red" id="cx">Cancel Bill</button>' : ''}<button class="btn" id="pr">🖨 Print</button>`,
      onMount: (m, c) => {
        $('#pr', m).onclick = () => printBill(kind, id);
        if ($('#cx', m)) $('#cx', m).onclick = guard(async () => { if (!confirm('Cancel this bill? Stock will be restored.')) return;
          await api(`/${BILL[kind].base}/${id}/cancel`, 'POST', {}); c(); toast('Bill cancelled'); reload(); });
        if ($('#pay', m)) $('#pay', m).onclick = guard(async () => { await api(`/${BILL[kind].base}/${id}/pay`, 'POST', formVals($('#pf', m))); c(); toast('Payment added ✔'); reload(); });
      } });
}

async function billForm(kind, reload) {
  const B = BILL[kind];
  const [products, godowns, parties, stock] = await Promise.all([api('/products'), api('/godowns'), api(`/parties?type=${B.pt}`), api('/stock')]);
  const prods = products.filter(p => p.active), gds = godowns.filter(g => g.active);
  const stockMap = {}; stock.items.forEach(i => stockMap[i.id] = i.per_godown);
  const rowHtml = () => `<tr><td style="min-width:230px"><select class="pid"><option value="">-- Select product --</option>${opt(prods, '', p => p.name)}</select><div class="hint st"></div></td>
    <td><input class="qty" type="number" min="0" step="any" value="1" style="width:80px"></td><td><input class="rate" type="number" min="0" step="0.01" style="width:105px"></td>
    <td><input class="gst" type="number" min="0" step="0.01" style="width:70px"></td><td class="r amt" style="min-width:110px">₹0.00</td><td><button class="btn ghost sm del" type="button">✕</button></td></tr>`;
  modal(B.newLabel.replace('+ ', ''), `<div id="bf">
    <div class="grid" style="grid-template-columns:repeat(4,1fr)">
      <div style="grid-column:span 2"><label class="f">${kind === 'sale' ? 'Customer' : 'Supplier'} * <a href="#" id="np" style="font-weight:400">(+ new party)</a></label><select name="party_id" id="party"></select></div>
      ${kind === 'purchase' ? field('Supplier Bill No *', 'bill_no') : field('Vehicle No', 'vehicle')}
      ${field('Date', 'date', today(), 'date')}
      <div><label class="f">Godown</label><select name="godown_id" id="gd">${opt(gds, '', g => g.name)}</select></div>
    </div>
    <div class="tw items" style="margin-top:14px"><table><thead><tr><th>Item</th><th>Qty</th><th>Rate (₹)</th><th>GST %</th><th class="r">Amount (incl. GST)</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
    <button class="btn ghost sm" id="addrow" type="button" style="margin:10px 0">+ Add item</button>
    <div class="grid" style="margin-top:6px">
      <div><div class="grid"><div><label class="f">Discount type</label><select name="discount_type" id="dt"><option value="amount">Amount (₹)</option><option value="percent">Percent (%)</option></select></div>
        ${field('Discount', 'discount_value', 0, 'number', 'step="0.01" min="0" id="dv"')}
        ${field('Amount paid now (₹)', 'paid', 0, 'number', 'step="0.01" min="0"')}
        <div><label class="f">Payment mode</label><select name="pay_mode"><option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Cheque</option></select></div>
        <div class="full"><label class="f">Note</label><input name="notes"></div></div></div>
      <div class="tot" id="tot"></div></div></div>`, {
    wide: true, footer: `<button class="btn ghost" id="c">Cancel</button><button class="btn sun" id="s">Save ${kind === 'sale' ? '& Create Invoice' : 'Receipt'}</button>`,
    onMount: (m, close) => {
      const partySel = $('#party', m);
      const fillParties = (sel) => { partySel.innerHTML = '<option value="">-- Select --</option>' + opt(parties, sel, p => p.name + (p.phone ? ' • ' + p.phone : '')); };
      fillParties('');
      $('#np', m).onclick = e => { e.preventDefault(); partyForm({ type: B.pt }, async id => { parties.splice(0, parties.length, ...(await api(`/parties?type=${B.pt}`))); billForm(kind, reload); }); };
      const tbody = $('#rows', m);
      const interstate = () => { const p = parties.find(x => x.id == partySel.value); return !!(p && p.state && SETTINGS.state && p.state.trim().toLowerCase() !== SETTINGS.state.trim().toLowerCase()); };
      const calc = () => {
        const lines = [...tbody.rows].map(tr => ({ tr, qty: +$('.qty', tr).value || 0, rate: +$('.rate', tr).value || 0, gst: +$('.gst', tr).value || 0 }));
        lines.forEach(l => l.gross = r2(l.qty * l.rate));
        const sub = r2(lines.reduce((s, l) => s + l.gross, 0));
        let disc = $('#dt', m).value === 'percent' ? r2(sub * (+$('[name=discount_value]', m).value || 0) / 100) : r2(+$('[name=discount_value]', m).value || 0);
        disc = Math.min(Math.max(disc, 0), sub);
        let taxable = 0, gst = 0;
        lines.forEach(l => { const t = r2(l.gross - (sub ? disc * l.gross / sub : 0)), g = r2(t * l.gst / 100); l.t = t; l.g = g; taxable += t; gst += g; $('.amt', l.tr).textContent = inr(t + g); });
        taxable = r2(taxable); gst = r2(gst);
        const inter = interstate(), exact = taxable + gst, total = Math.round(exact);
        $('#tot', m).innerHTML = `<div><span>Subtotal</span><span>${inr(sub)}</span></div><div><span>Discount</span><span>- ${inr(disc)}</span></div><div><span>Taxable Value</span><span>${inr(taxable)}</span></div>
          ${inter ? `<div><span>IGST</span><span>${inr(gst)}</span></div>` : `<div><span>CGST</span><span>${inr(gst / 2)}</span></div><div><span>SGST</span><span>${inr(gst - r2(gst / 2))}</span></div>`}
          <div><span>Round off</span><span>${inr(total - exact)}</span></div><div class="g"><span>Total</span><span>${inr(total)}</span></div>`;
      };
      const stockHint = tr => {
        if (kind !== 'sale') return; const pid = $('.pid', tr).value, g = $('#gd', m).value;
        const q = pid ? (stockMap[pid]?.[g] || 0) : null; const h = $('.st', tr);
        h.textContent = q === null ? '' : `Stock in this godown: ${qf(q)}`; h.className = 'hint st ' + (q !== null && +$('.qty', tr).value > q ? 'neg' : '');
      };
      const addRow = () => {
        tbody.insertAdjacentHTML('beforeend', rowHtml()); const tr = tbody.lastElementChild;
        $('.pid', tr).onchange = () => { const p = prods.find(x => x.id == $('.pid', tr).value); if (p) { $('.rate', tr).value = kind === 'sale' ? p.sale_price : p.purchase_price; $('.gst', tr).value = p.gst_rate; } stockHint(tr); calc(); };
        tr.querySelectorAll('input').forEach(i => i.oninput = () => { stockHint(tr); calc(); });
        $('.del', tr).onclick = () => { if (tbody.rows.length > 1) { tr.remove(); calc(); } };
      };
      addRow(); $('#addrow', m).onclick = addRow;
      m.querySelectorAll('#dt,[name=discount_value]').forEach(e => e.oninput = calc);
      partySel.onchange = calc; $('#gd', m).onchange = () => { [...tbody.rows].forEach(stockHint); };
      calc();
      $('#c', m).onclick = close;
      $('#s', m).onclick = guard(async () => {
        const v = formVals($('#bf', m));
        v.items = [...tbody.rows].map(tr => ({ product_id: $('.pid', tr).value, qty: $('.qty', tr).value, rate: $('.rate', tr).value, gst_rate: $('.gst', tr).value })).filter(i => i.product_id);
        if (!v.party_id) throw new Error('Select a party');
        const saved = await api('/' + B.base, 'POST', v);
        close(); toast('Bill saved ✔'); reload();
        if (confirm('Print this bill?')) printBill(kind, saved.id);
      });
    }
  });
}

/* ---------------- employees ---------------- */
PAGES.employees = async () => {
  const list = await api('/employees');
  $('#main').innerHTML = `<h2>Employee Records</h2><div class="bar"><span class="sp"></span><button class="btn sun" id="add">+ New Employee</button></div>
  <div class="tw"><table><thead><tr><th>Name</th><th>Designation</th><th>Phone</th><th>Joining</th><th class="r">Monthly Salary</th><th>Status</th><th></th></tr></thead><tbody>
  ${list.map(e => `<tr><td><b>${esc(e.name)}</b><div class="hint">${esc(e.address)}</div></td><td>${esc(e.designation)}</td><td>${esc(e.phone)}</td><td>${fdate(e.joining_date)}</td><td class="r">${inr(e.salary)}</td>
  <td>${e.status === 'active' ? '<span class="badge b-g">Working</span>' : '<span class="badge b-r">Left</span>'}</td>
  <td><button class="btn ghost sm" data-id="${e.id}">Edit</button> <button class="btn ghost sm" data-h="${e.id}">Salary History</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No employees</td></tr>'}</tbody></table></div>`;
  const form = (e = {}) => modal(e.id ? 'Edit Employee' : 'New Employee', `<div class="grid" id="f">${field('Name *', 'name', e.name)}${field('Designation / Role', 'designation', e.designation)}
    ${field('Phone', 'phone', e.phone)}${field('Aadhaar No', 'aadhaar', e.aadhaar)}${field('Joining Date', 'joining_date', e.joining_date || today(), 'date')}${field('Monthly Salary (₹)', 'salary', e.salary || 0, 'number')}
    <div class="full"><label class="f">Address</label><input name="address" value="${esc(e.address)}"></div>
    <div><label class="f">Status</label><select name="status"><option value="active" ${e.status !== 'left' ? 'selected' : ''}>Working</option><option value="left" ${e.status === 'left' ? 'selected' : ''}>Left</option></select></div>
    ${field('Note', 'notes', e.notes)}</div>`, {
    footer: '<button class="btn ghost" id="c">Cancel</button><button class="btn sun" id="s">Save</button>',
    onMount: (m, close) => { $('#c', m).onclick = close; $('#s', m).onclick = guard(async () => {
      const v = formVals($('#f', m)); if (e.id) await api('/employees/' + e.id, 'PUT', v); else await api('/employees', 'POST', v);
      close(); toast('Saved ✔'); PAGES.employees(); }); }
  });
  $('#add').onclick = () => form();
  $('#main').querySelectorAll('[data-id]').forEach(b => b.onclick = () => form(list.find(e => e.id == b.dataset.id)));
  $('#main').querySelectorAll('[data-h]').forEach(b => b.onclick = guard(async () => {
    const h = await api('/salary/history/' + b.dataset.h);
    modal('Salary History', `<div class="tw"><table><thead><tr><th>Month</th><th class="r">Salary</th><th class="r">Bonus</th><th class="r">Deduction</th><th class="r">Advance</th><th class="r">Net</th><th>Date</th></tr></thead><tbody>
    ${h.map(x => `<tr><td>${x.month}</td><td class="r">${inr(x.base)}</td><td class="r">${inr(x.bonus)}</td><td class="r">${inr(x.deduction)}</td><td class="r">${inr(x.advance)}</td><td class="r"><b>${inr(x.net)}</b></td><td>${fdate(x.paid_date)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No salary paid yet</td></tr>'}</tbody></table></div>`, { wide: true });
  }));
};

/* ---------------- salary ---------------- */
PAGES.salary = async () => {
  const month = PAGES.salary.m || today().slice(0, 7);
  const list = await api('/salary?month=' + month);
  const paid = list.filter(x => x.payment_id), tot = paid.reduce((s, x) => s + x.net, 0);
  $('#main').innerHTML = `<h2>Salary</h2><div class="bar"><label class="muted">Month</label><input type="month" id="m" value="${month}">
    <span class="sp"></span><span>Paid this month: <b>${inr(tot)}</b> (${paid.length}/${list.length} employees)</span></div>
  <div class="tw"><table><thead><tr><th>Employee</th><th class="r">Salary</th><th class="r">Bonus</th><th class="r">Deduction</th><th class="r">Advance</th><th class="r">Net Paid</th><th>Status</th><th></th></tr></thead><tbody>
  ${list.map(x => x.payment_id ? `<tr><td><b>${esc(x.name)}</b><div class="hint">${esc(x.designation)}</div></td><td class="r">${inr(x.base)}</td><td class="r">${inr(x.bonus)}</td><td class="r">${inr(x.deduction)}</td><td class="r">${inr(x.advance)}</td><td class="r"><b>${inr(x.net)}</b></td>
    <td><span class="badge b-g">Paid • ${fdate(x.paid_date)}</span></td><td><button class="btn ghost sm" data-slip="${x.employee_id}">Slip</button> <button class="btn ghost sm" data-del="${x.payment_id}">Remove</button></td></tr>`
    : `<tr><td><b>${esc(x.name)}</b><div class="hint">${esc(x.designation)}</div></td><td class="r">${inr(x.salary)}</td><td colspan="4" class="muted">—</td><td><span class="badge b-y">Pending</span></td><td><button class="btn sun sm" data-pay="${x.employee_id}">Pay Salary</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">Add employees first under Employees</td></tr>'}</tbody></table></div>`;
  $('#m').onchange = e => { PAGES.salary.m = e.target.value; PAGES.salary(); };
  $('#main').querySelectorAll('[data-pay]').forEach(b => b.onclick = () => {
    const x = list.find(l => l.employee_id == b.dataset.pay);
    modal('Pay Salary: ' + esc(x.name) + ' (' + month + ')', `<div class="grid" id="f">${field('Salary (₹)', 'base', x.salary, 'number')}${field('Bonus / Overtime (₹)', 'bonus', 0, 'number')}
      ${field('Deduction (leave etc.) (₹)', 'deduction', 0, 'number')}${field('Advance recovered (₹)', 'advance', 0, 'number')}
      <div><label class="f">Mode</label><select name="mode"><option>Cash</option><option>UPI</option><option>Bank Transfer</option></select></div>${field('Date', 'paid_date', today(), 'date')}
      <div class="full">${field('Note', 'note')}</div><div class="full"><b>Net Salary: <span id="net"></span></b></div></div>`, {
      footer: '<button class="btn ghost" id="c">Cancel</button><button class="btn sun" id="s">Mark Salary Paid ✔</button>',
      onMount: (m, close) => {
        const upd = () => { const v = formVals($('#f', m)); $('#net', m).textContent = inr((+v.base || 0) + (+v.bonus || 0) - (+v.deduction || 0) - (+v.advance || 0)); };
        m.querySelectorAll('input').forEach(i => i.oninput = upd); upd(); $('#c', m).onclick = close;
        $('#s', m).onclick = guard(async () => { await api('/salary', 'POST', { ...formVals($('#f', m)), employee_id: x.employee_id, month }); close(); toast('Salary saved ✔'); PAGES.salary(); });
      } });
  });
  $('#main').querySelectorAll('[data-del]').forEach(b => b.onclick = guard(async () => { if (!confirm('Remove this salary entry?')) return; await api('/salary/' + b.dataset.del, 'DELETE', {}); PAGES.salary(); }));
  $('#main').querySelectorAll('[data-slip]').forEach(b => b.onclick = () => {
    const x = list.find(l => l.employee_id == b.dataset.slip);
    const w = window.open('', '_blank');
    w.document.write(`<title>Salary Slip</title><body style="font-family:Arial;max-width:520px;margin:30px auto;border:2px solid #0f2a47;padding:22px"><h2 style="text-align:center;margin:0;color:#0f2a47">${esc(SETTINGS.shop_name)}</h2>
    <p style="text-align:center;margin:2px 0 14px;font-size:12px">${esc(SETTINGS.address)}</p><h3 style="text-align:center;border-top:1px solid #999;border-bottom:1px solid #999;padding:6px">SALARY SLIP — ${month}</h3>
    <p><b>Name:</b> ${esc(x.name)}<br><b>Designation:</b> ${esc(x.designation)}</p><table style="width:100%;border-collapse:collapse" border="1" cellpadding="7">
    <tr><td>Salary</td><td align="right">${inr(x.base)}</td></tr><tr><td>Bonus / Overtime</td><td align="right">${inr(x.bonus)}</td></tr><tr><td>Deduction</td><td align="right">- ${inr(x.deduction)}</td></tr>
    <tr><td>Advance recovered</td><td align="right">- ${inr(x.advance)}</td></tr><tr><td><b>Net Salary</b></td><td align="right"><b>${inr(x.net)}</b></td></tr></table>
    <p>Payment: ${esc(x.mode)} • ${fdate(x.paid_date)}</p><br><br><p style="display:flex;justify-content:space-between"><span>Employee signature</span><span>${esc(SETTINGS.signatory)}</span></p><script>setTimeout(()=>print(),300)<\/script></body>`);
    w.document.close();
  });
};

/* ---------------- settings ---------------- */
PAGES.settings = async () => {
  SETTINGS = await api('/settings'); const s = SETTINGS;
  $('#main').innerHTML = `<h2>Settings &amp; Backup</h2>
  <div class="panel"><h3>Shop Details (printed on invoices)</h3><div class="grid" id="sf">
    ${field('Shop name', 'shop_name', s.shop_name)}${field('Tagline', 'tagline', s.tagline)}
    <div class="full">${field('Address', 'address', s.address)}</div>${field('Phone', 'phone', s.phone)}${field('Email', 'email', s.email)}
    ${field('GSTIN', 'gstin', s.gstin)}<div><label class="f">Shop State (decides CGST/SGST vs IGST)</label><input name="state" list="states" value="${esc(s.state)}"><datalist id="states">${STATES.map(x => `<option>${x}</option>`).join('')}</datalist></div>
    ${field('Invoice prefix', 'invoice_prefix', s.invoice_prefix)}${field('Authorised Signatory', 'signatory', s.signatory)}
    <div class="full"><label class="f">Bank Details (printed at the bottom of the invoice)</label><textarea name="bank_details" rows="2">${esc(s.bank_details)}</textarea></div>
    <div class="full"><label class="f">Terms &amp; Conditions</label><textarea name="terms" rows="3">${esc(s.terms)}</textarea></div></div>
    <div style="margin-top:12px"><button class="btn sun" id="ss">Save</button></div></div>
  <div class="two"><div class="panel"><h3>Change Password</h3><div id="pw">${field('Old password', 'old_password', '', 'password')}<div style="height:8px"></div>${field('New password (min 6)', 'new_password', '', 'password')}</div>
    <div style="margin-top:12px"><button class="btn" id="cp">Change</button></div></div>
  <div class="panel"><h3>Database Backup</h3><p class="muted">All data is saved in the server file <code>data/solar.db</code>. Download a backup regularly and keep it somewhere safe (Google Drive / pen drive).</p>
    <button class="btn" id="bk">⬇ Download Backup</button></div></div>`;
  $('#ss').onclick = guard(async () => { SETTINGS = await api('/settings', 'PUT', formVals($('#sf'))); $('#brandName').textContent = SETTINGS.shop_name; toast('Settings saved ✔'); });
  $('#cp').onclick = guard(async () => { await api('/change-password', 'POST', formVals($('#pw'))); toast('Password changed ✔'); $('#pw').querySelectorAll('input').forEach(i => i.value = ''); });
  $('#bk').onclick = guard(async () => {
    const r = await fetch('/api/backup', { headers: { Authorization: 'Bearer ' + TOKEN } }); if (!r.ok) throw new Error('Backup failed');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `solar-backup-${today()}.db`; a.click();
  });
};

boot();
