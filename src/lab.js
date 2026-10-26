// The lab (Will, 26 Oct: "let's go hand this off to something and get people's work printed"; the pipeline for
// printing seamless, with no one at a bench). A lab is one more shop on the press (`print_shops.lab`), kept by a
// fine-art print-on-demand house with an API: never listed on /printers, never for pickups or frames, chosen after any
// local shop that can make the print and before the house's own room. It needs no desk: when a job is offered to it the
// house places the order by API with a one-time address for the master (untouched, as every shop takes it), the lab's
// callback and a ten-minute poll move the job Accepted → Printing → Shipped (tracking) → Delivered through the press's
// own `move`, so the collector is written to at each step; the letters say "the house's lab". The lab's cost is the
// house's (charged to the house's account there), so the job carries no fee. The first lab is Prodigi (PRODIGI_API_KEY
// in Render; PRODIGI_SANDBOX=1 for their sandbox); the paper SKUs (LAB_SKUS, JSON size → sku) are confirmed against
// the lab's own catalogue from Studio → The press, never assumed. Nothing of the lab is said in public copy.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HOSTS = { live: 'https://api.prodigi.com', sandbox: 'https://api.sandbox.prodigi.com' };
// Sizes the house sells → the lab's SKU. Read from Prodigi's own catalogue on 26 Oct: Hahnemühle Photo Rag is the
// line GLOBAL-HPR-<W>X<H> (308 gsm, fulfilled from the US in 48–72 h) and German Etching GLOBAL-HGE-<W>X<H>; the house's
// paper is Photo Rag unless the order names German Etching. The catalogue check confirms each size before an order
// rides on it; LAB_SKUS overrides any size.
const SIZES = ['5x7', '8x10', '11x14', '12x16', '16x20', '16x24', '20x30', '24x36'];
const familyFor = paper => /german\s*etching|\bHGE\b/i.test(String(paper || '')) ? 'HGE' : 'HPR';
const skuOf = (key, fam = 'HPR') => `GLOBAL-${fam}-${key.toUpperCase()}`;
const DEFAULT_SKUS = Object.fromEntries(SIZES.map(k => [k, skuOf(k)]));
const sizeKey = (size, kind) => { if (kind === 'proof') return '5x7'; const n = (String(size || '').match(/\d+(\.\d+)?/g) || []).map(Number).sort((a, b) => a - b); return n.length >= 2 ? `${n[0]}x${n[1]}` : null; };

function mountLab(app, { db, V, C, ledger, mail, studioOnly, originalPath, press }) {
  for (const sql of ['ALTER TABLE print_shops ADD COLUMN lab TEXT', 'ALTER TABLE print_jobs ADD COLUMN lab_order TEXT', 'ALTER TABLE print_jobs ADD COLUMN lab_state TEXT', 'ALTER TABLE print_jobs ADD COLUMN lab_tries INTEGER NOT NULL DEFAULT 0', 'ALTER TABLE print_jobs ADD COLUMN lab_cost INTEGER']) { try { db.exec(sql); } catch (e) { /* has it */ } }
  db.exec('CREATE TABLE IF NOT EXISTS lab_assets (token TEXT PRIMARY KEY, job_id INTEGER NOT NULL, expires TEXT NOT NULL, takes INTEGER NOT NULL DEFAULT 0)');

  const lab = { transport: null }; // the wire; tests set `transport` to a fake, the house uses fetch
  const KEY = () => String(process.env.PRODIGI_API_KEY || '').trim();
  const on = () => !!KEY() || !!lab.transport;
  const host = () => (process.env.PRODIGI_SANDBOX === '1' ? HOSTS.sandbox : HOSTS.live);
  const skus = () => { try { return { ...DEFAULT_SKUS, ...(process.env.LAB_SKUS ? JSON.parse(process.env.LAB_SKUS) : {}) }; } catch (e) { return DEFAULT_SKUS; } };
  const attrs = () => { try { return process.env.LAB_ATTRS ? JSON.parse(process.env.LAB_ATTRS) : null; } catch (e) { return null; } };
  const maxIn = () => Math.max(7, +(process.env.LAB_MAX_IN || 36));
  const cbKey = () => crypto.createHash('sha256').update('lab-callback:' + KEY()).digest('hex').slice(0, 32);
  db.exec('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)');
  const setting = (k, v) => { if (v === undefined) { const r = db.prepare('SELECT v FROM settings WHERE k=?').get(k); return r ? r.v : null; } db.prepare('INSERT INTO settings (k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v); return v; };

  async function call(method, p, body) {
    if (lab.transport) return lab.transport(method, p, body);
    const r = await fetch(host() + '/v4.0' + p, { method, headers: { 'X-API-Key': KEY(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    let json = null; try { json = await r.json(); } catch (e) { /* no body */ }
    return { status: r.status, json };
  }

  // The lab is a shop: a maker of kind 'printer' with no desk of its own, open while the key is set.
  function ensureLab() {
    let m = db.prepare("SELECT * FROM makers WHERE handle='the-lab'").get();
    if (!m) { db.prepare("INSERT INTO makers (handle, name, email, kind, bio) VALUES ('the-lab', 'The house’s lab', NULL, 'printer', 'The house’s lab: fine-art pigment prints made to the house’s ticket when no shop near the collector can.')").run(); m = db.prepare("SELECT * FROM makers WHERE handle='the-lab'").get(); }
    let s = db.prepare('SELECT * FROM print_shops WHERE maker_id=?').get(m.id);
    if (!s) { db.prepare("INSERT INTO print_shops (maker_id, city, state, papers, max_in, framing, pickup, ships, turnaround, story, house, status, lab) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,'prodigi')").run(m.id, null, null, 'Hahnemühle German Etching; Hahnemühle Photo Rag', maxIn(), 0, 0, 1, 7, 'The house’s lab.', on() ? 'open' : 'held'); s = db.prepare('SELECT * FROM print_shops WHERE maker_id=?').get(m.id); }
    const want = on() ? 'open' : 'held'; if (s.status !== want || s.max_in !== maxIn()) { db.prepare('UPDATE print_shops SET status=?, max_in=? WHERE id=?').run(want, maxIn(), s.id); s.status = want; s.max_in = maxIn(); }
    return s;
  }
  const isLab = shop => !!(shop && shop.lab);

  const jobOf = id => db.prepare('SELECT j.*, s.lab, s.maker_id AS shop_maker FROM print_jobs j JOIN print_shops s ON s.id=j.shop_id WHERE j.id=?').get(id);
  const orderOf = id => db.prepare('SELECT o.*, l.ref, l.collector_no, l.licensee_name, w.slug, w.title, w.id AS work_id2, w.original_file, mk.name AS maker_name FROM print_orders o JOIN licenses l ON l.id=o.license_id JOIN works w ON w.id=l.work_id JOIN makers mk ON mk.id=w.maker_id WHERE o.id=?').get(id);

  // The address, read into the lab's fields. US only for now (the proof's rule).
  function recipient(o) {
    const lines = String(o.address || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
    const last = lines[lines.length - 1] || ''; const m = last.match(/^(.*?),?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/);
    const name = (o.ship_name || o.licensee_name || 'A collector').trim();
    if (!m) return { name, email: o.email || undefined, address: { line1: lines[0] || '', line2: lines.slice(1, -1).join(', ') || undefined, townOrCity: '', stateOrCounty: '', postalOrZipCode: '', countryCode: 'US' }, bad: true };
    return { name, email: o.email || undefined, address: { line1: lines[0] || '', line2: lines.length > 2 ? lines.slice(1, -1).join(', ') : undefined, townOrCity: m[1].replace(/,$/, ''), stateOrCounty: m[2], postalOrZipCode: m[3], countryCode: 'US' } };
  }

  const assetUrl = j => { const token = crypto.randomBytes(18).toString('base64url'); db.prepare("INSERT INTO lab_assets (token, job_id, expires) VALUES (?,?, datetime('now', '+3 days'))").run(token, j.id); return `${C.base}/lab/asset/${token}`; };

  function fail(j, why) {
    const tries = (j.lab_tries || 0) + 1;
    db.prepare('UPDATE print_jobs SET lab_state=?, lab_tries=?, note=? WHERE id=?').run('failed', tries, String(why).slice(0, 300), j.id);
    try { ledger.append(db, 'print.lab.failed', String(j.id), { why: String(why).slice(0, 200), tries, hidden: true }); } catch (e) { /* */ }
    if (tries >= 3) { press.move(press.jobOf(j.id), 'declined', { by: 'lab' }); mail.send({ to: process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com', subject: 'The lab could not take a print', text: `Job ${j.id}: ${why}\n\nOffered on to the next shop.\n\n${C.base}/studio/printers` }); }
    return false;
  }

  // Place the order with the lab.
  async function place(jobId) {
    const j = jobOf(jobId); if (!j || !j.lab || j.status !== 'offered') return false;
    if (!on()) return fail(j, 'no key');
    const o = orderOf(j.order_id); if (!o) return false;
    const key = sizeKey(o.size, o.kind); const fam = familyFor(o.paper); const S = skus(); const sku = key ? (fam === 'HGE' && S[key] === skuOf(key) ? skuOf(key, 'HGE') : S[key]) : null;
    if (!sku) return fail(j, `no SKU for ${o.kind === 'proof' ? 'the proof' : o.size || 'this size'}`);
    if (o.pickup) return fail(j, 'a pickup');
    const r = recipient(o); if (r.bad) return fail(j, 'the address could not be read');
    const item = { sku, copies: 1, sizing: 'fitPrintArea', merchantReference: `${o.ref}-${j.id}`, assets: [{ printArea: 'default', url: assetUrl(j) }] }; const a = attrs(); if (a) item.attributes = a;
    const body = { merchantReference: `WM ${o.ref} job ${j.id}`, shippingMethod: process.env.LAB_SHIPPING || 'Standard', callbackUrl: `${C.base}/lab/callback?k=${cbKey()}`, recipient: r, items: [item], metadata: { work: o.slug, title: o.title, maker: o.maker_name, pencil: `${o.kind === 'edition' ? `No. ${o.edition_no || ''}` : o.collector_no ? `No. ${o.collector_no}` : ''} · ${o.title}` } };
    // The price first: the lab is asked what this print will cost, and a print whose cost would eat the collector's
    // payment is never placed (LAB_MAX_COST_PCT of the price, default 80); the house is mailed to decide by hand.
    let quoted = null;
    try {
      const q = await call('POST', '/quotes', { shippingMethod: body.shippingMethod, destinationCountryCode: r.address.countryCode, currencyCode: 'USD', items: [{ sku, copies: 1, assets: [{ printArea: 'default' }] }] });
      const first = q.json && Array.isArray(q.json.quotes) ? q.json.quotes[0] : null; const cs = first && first.costSummary;
      if (cs) quoted = Math.round(((+((cs.items || {}).amount) || 0) + (+((cs.shipping || {}).amount) || 0)) * 100);
      else if (q.status === 200 || q.status === 400) return fail(j, `the lab gave no price: ${q.status} ${(q.json && (q.json.outcome || q.json.message)) || ''}`.trim());
    } catch (e) { return fail(j, `the lab could not be reached for a price: ${e.message}`); }
    const ceiling = Math.round((o.cents || 0) * Math.max(10, Math.min(100, +(process.env.LAB_MAX_COST_PCT || 80))) / 100);
    if (quoted != null && o.cents > 0 && quoted > ceiling) {
      db.prepare("UPDATE print_jobs SET lab_state='too dear', lab_tries=3, lab_cost=?, note=? WHERE id=?").run(quoted, `the lab asks $${(quoted / 100).toFixed(2)} against a price of $${(o.cents / 100).toFixed(2)}`, j.id);
      mail.send({ to: process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com', subject: `A print the lab would make at a loss: ${o.title}`, text: `${o.title}, ${o.size || 'the proof'}: the lab asks $${(quoted / 100).toFixed(2)} (print and shipping) against the collector's $${(o.cents / 100).toFixed(2)}. Not placed. Raise the price, lower the size, or place it by hand from the press desk.\n\n${C.base}/studio/printers#lab` });
      try { ledger.append(db, 'print.lab.failed', String(j.id), { why: 'too dear', quoted, cents: o.cents, hidden: true }); } catch (e) { /* */ }
      press.move(press.jobOf(j.id), 'declined', { by: 'lab' });
      return false;
    }
    let res; try { res = await call('POST', '/Orders', body); } catch (e) { return fail(j, `the lab could not be reached: ${e.message}`); }
    const out = res.json && res.json.outcome; const order = res.json && res.json.order;
    if (!order || !/^Created/i.test(String(out || ''))) return fail(j, `the lab answered ${res.status}: ${out || (res.json && (res.json.message || res.json.title)) || 'no answer'}`);
    let cost = null; try { cost = Math.round((order.charges || []).reduce((s, c) => s + (+((c.totalCost || {}).amount) || 0), 0) * 100) || null; } catch (e) { /* */ }
    if (!cost && quoted) cost = quoted;
    db.prepare("UPDATE print_jobs SET lab_order=?, lab_state=?, lab_cost=?, note=NULL WHERE id=?").run(String(order.id), (order.status && order.status.stage) || 'InProgress', cost, j.id);
    try { ledger.append(db, 'print.lab', o.ref, { job: j.id, order: String(order.id), sku, cost, hidden: true }); } catch (e) { /* */ }
    press.move(press.jobOf(j.id), 'accepted', { by: 'lab' });
    sync(order);
    return true;
  }

  // The lab's word on an order → the job's step. Stages: InProgress, Complete, Cancelled; details.inProduction and
  // shipping each NotStarted | InProgress | Complete | Error; shipments carry tracking.
  function sync(order) {
    if (!order || !order.id) return false;
    const j = db.prepare('SELECT j.*, s.lab FROM print_jobs j JOIN print_shops s ON s.id=j.shop_id WHERE j.lab_order=?').get(String(order.id)); if (!j) return false;
    const stage = (order.status && order.status.stage) || ''; const d = (order.status && order.status.details) || {};
    db.prepare('UPDATE print_jobs SET lab_state=? WHERE id=?').run(stage || j.lab_state, j.id);
    const ships = Array.isArray(order.shipments) ? order.shipments : [];
    const tr = ships.map(s => s.tracking && (s.tracking.number || s.tracking.url) ? [s.carrier && s.carrier.name, s.tracking.number, s.tracking.url].filter(Boolean).join(' ') : null).filter(Boolean)[0] || null;
    const cur = press.jobOf(j.id); if (!cur) return false;
    const step = (st, x) => { if (cur.status !== st) { press.move(cur, st, { ...(x || {}), by: 'lab' }); cur.status = st; } };
    if (/^Cancelled/i.test(stage)) { if (cur.status !== 'declined') press.move(cur, 'declined', { by: 'lab' }); return true; }
    if (/^Complete/i.test(stage)) { if (cur.status === 'accepted') step('printing'); if (cur.status === 'printing') step('shipped', { tracking: tr }); if (cur.status === 'shipped') step('delivered'); return true; }
    if (ships.length || (d.shipping && /InProgress|Complete/i.test(d.shipping))) { if (cur.status === 'accepted') step('printing'); if (cur.status === 'printing') step('shipped', { tracking: tr }); return true; }
    if (d.inProduction && /InProgress|Complete/i.test(d.inProduction)) { if (cur.status === 'accepted') step('printing'); return true; }
    return true;
  }

  async function poll() {
    if (!on()) return 0;
    const open = db.prepare("SELECT j.id, j.lab_order, j.lab_state, j.lab_tries, j.status FROM print_jobs j JOIN print_shops s ON s.id=j.shop_id WHERE s.lab IS NOT NULL AND j.status NOT IN ('delivered','declined') ORDER BY j.id").all();
    let n = 0;
    for (const j of open) {
      try {
        if (!j.lab_order) { if (j.status === 'offered' && (j.lab_tries || 0) < 3) { await place(j.id); n++; } continue; }
        const r = await call('GET', `/Orders/${encodeURIComponent(j.lab_order)}`); if (r.json && r.json.order) { sync(r.json.order); n++; }
      } catch (e) { console.error('[lab]', j.id, e.message); }
    }
    return n;
  }

  // The lab fetches the master once or twice through a one-time address; nothing else may.
  app.get('/lab/asset/:token', async (req, res) => {
    const a = db.prepare("SELECT * FROM lab_assets WHERE token=? AND expires > datetime('now')").get(String(req.params.token)); if (!a || a.takes >= 5) return res.sendStatus(404);
    const j = jobOf(a.job_id); if (!j || j.status === 'declined') return res.sendStatus(404);
    const o = orderOf(j.order_id); const w = db.prepare('SELECT * FROM works WHERE id=?').get(o.work_id2);
    let file; try { file = await originalPath(w); } catch (e) { return res.sendStatus(503); }
    db.prepare('UPDATE lab_assets SET takes=takes+1 WHERE token=?').run(a.token); db.prepare('UPDATE print_jobs SET downloads=downloads+1 WHERE id=?').run(j.id);
    try { ledger.append(db, 'print.file', o.ref, { job: j.id, by: 'lab', hidden: true }); } catch (e) { /* */ }
    const ext = path.extname(w.original_file || file).toLowerCase() || '.jpg'; const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.tif': 'image/tiff', '.tiff': 'image/tiff' }[ext] || 'application/octet-stream';
    res.set({ 'Content-Type': mime, 'Content-Disposition': `inline; filename="${o.ref}${ext}"`, 'Cache-Control': 'private, no-store' });
    fs.createReadStream(file).pipe(res);
  });

  // The lab's callback: the order as it stands.
  app.post('/lab/callback', (req, res) => {
    if (!on()) return res.sendStatus(404);
    if (String(req.query.k || '') !== cbKey()) return res.sendStatus(403);
    const b = req.body || {}; const order = b.order || (b.id && b.status ? b : null);
    try { sync(order); } catch (e) { console.error('[lab] callback', e.message); }
    res.json({ ok: true });
  });

  // Studio: the lab's state, the sizes and their SKUs against the catalogue, its jobs.
  function panel() {
    const s = ensureLab(); const S = skus(); let cat = {}; try { cat = JSON.parse(setting('lab_catalogue') || '{}'); } catch (e) { /* */ }
    const jobs = db.prepare("SELECT j.*, o.kind, o.size, o.cents AS cents_paid, l.ref, w.title FROM print_jobs j JOIN print_orders o ON o.id=j.order_id JOIN licenses l ON l.id=o.license_id JOIN works w ON w.id=l.work_id WHERE j.shop_id=? ORDER BY j.id DESC LIMIT 30").all(s.id);
    return `<section class="lab-pan" id="lab"><h2>The lab</h2><p class="note">${on() ? `On${process.env.PRODIGI_SANDBOX === '1' ? ', in the lab’s sandbox' : ''}: a print no shop near the collector can make goes to the lab by itself and comes back shipped. Up to ${s.max_in} inches; unframed; shipped, never picked up.` : 'Off. Set PRODIGI_API_KEY in Render (PRODIGI_SANDBOX=1 to try the sandbox first) and the lab opens as a shop: no desk, no bench, the order placed by the house and tracking back by itself.'} The collector reads “the house’s lab”; the lab’s name is never said in public.</p>
<table class="tbl"><tr><th>Size</th><th>SKU</th><th>The catalogue says</th></tr>${Object.entries(S).map(([k, v]) => { const c = cat[v]; return `<tr><td>${esc(k.replace('x', ' × '))} in</td><td><code>${esc(v)}</code></td><td>${c ? (c.ok ? `<b>Found</b> · ${esc(c.name || '')}${c.attrs ? `<br><small>${esc(c.attrs)}</small>` : ''}` : `<span class="warn">Not found</span> · ${esc(c.why || '')}`) : '<small>Not yet checked</small>'}</td></tr>`; }).join('')}</table>
<div class="lab-acts"><form method="post" action="/studio/lab/check"><button${on() ? '' : ' disabled'}>Check the catalogue</button></form><form method="post" action="/studio/lab/poll"><button${on() ? '' : ' disabled'}>Ask the lab about open orders</button></form></div>
<p class="pj-fine">Override a SKU with LAB_SKUS (JSON, size → sku, e.g. {"16x24":"GLOBAL-FAP-16X24"}); paper or finish attributes with LAB_ATTRS; the widest side with LAB_MAX_IN; shipping with LAB_SHIPPING (Standard); LAB_MAX_COST_PCT (80): a print the lab would make for more than that share of the collector’s price is never placed, and the house is mailed. The lab charges the house’s own account there; the job carries no fee.</p>
${jobs.length ? `<table class="tbl"><tr><th>Print</th><th>Step</th><th>The lab’s order</th><th>Paid</th><th>The lab’s cost</th><th>Kept</th><th>Note</th></tr>${jobs.map(j => `<tr><td><b>${esc(j.title)}</b><br><small>${esc(j.ref)} · ${j.kind === 'proof' ? 'the proof' : esc(j.size || '')}</small></td><td>${esc(press.STEPS[j.status] || j.status)}</td><td><small>${esc(j.lab_order || '—')} · ${esc(j.lab_state || '')}</small></td><td>${j.cents_paid ? `$${(j.cents_paid / 100).toFixed(2)}` : '—'}</td><td>${j.lab_cost ? `$${(j.lab_cost / 100).toFixed(2)}` : '—'}</td><td>${j.lab_cost && j.cents_paid ? `<b>$${((j.cents_paid - j.lab_cost) / 100).toFixed(2)}</b>` : '—'}</td><td><small>${esc(j.note || '')}</small></td></tr>`).join('')}</table>` : ''}</section>`;
  }
  app.post('/studio/lab/check', studioOnly, async (req, res) => {
    const out = {}; for (const [k, sku] of Object.entries(skus())) {
      try { const r = await call('GET', `/products/${encodeURIComponent(sku)}`); const p = r.json && r.json.product; out[sku] = p ? { ok: true, name: p.description || p.name || sku, attrs: p.attributes ? Object.entries(p.attributes).map(([a, v]) => `${a}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ') : '' } : { ok: false, why: `${r.status} ${(r.json && (r.json.outcome || r.json.message)) || ''}`.trim() }; }
      catch (e) { out[sku] = { ok: false, why: e.message }; }
    }
    setting('lab_catalogue', JSON.stringify(out));
    res.redirect('/studio/printers?ok=' + encodeURIComponent('The catalogue was asked.') + '#lab');
  });
  app.post('/studio/lab/poll', studioOnly, async (req, res) => { const n = await poll(); res.redirect('/studio/printers?ok=' + encodeURIComponent(`${n} order${n === 1 ? '' : 's'} asked about.`) + '#lab'); });

  if (!app.locals.noTimers) { const t = setInterval(() => { poll().catch(e => console.error('[lab]', e.message)); }, 10 * 60 * 1000); if (t.unref) t.unref(); setTimeout(() => { try { ensureLab(); } catch (e) { /* */ } }, 26000).unref(); }
  Object.assign(lab, { on, ensureLab, isLab, place, sync, poll, panel, skus, sizeKey, DEFAULT_SKUS, cbKey });
  app.locals.lab = lab;
  return lab;
}
module.exports = { mountLab, DEFAULT_SKUS, sizeKey, familyFor, skuOf };
