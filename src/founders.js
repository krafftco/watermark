// The first collector (Will, 19 Oct: "my mom was the first real collector; her profile has to be honoured, publicly,
// before anything starts; founding members, and then: first collector, the founder's mother"). The Founding
// Collectors are the first hundred to collect (foundingNo in app.js, by first purchase). The house names the first
// of them by hand (`settings.first_collector` = buyers.id), so No. 1 is the person who was first in truth, whatever
// a test purchase or a clock says; everyone else moves down one. A line beside the honour (`first_collector_note`,
// e.g. "the founder’s mother") is the house's to write; a draft until Will confirms. Studio → Back office → Founders.
function mountFounders(app, { db, V, isStudio, FOUNDING = 100 }) {
  const { esc } = V;
  const get = k => { const r = db.prepare('SELECT v FROM settings WHERE k=?').get(k); return r ? r.v : null; };
  const set = (k, v) => db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v);
  const firstId = () => Number(get('first_collector')) || null;
  const first = () => { const id = firstId(); return id ? db.prepare('SELECT * FROM buyers WHERE id=?').get(id) : null; };
  const note = () => get('first_collector_note') || '';
  // The first hundred, by first paid numbered piece; the named first collector leads whatever the clock says.
  function order() {
    const rows = db.prepare("SELECT l.buyer_id, MIN(l.starts_at) first, COUNT(*) n FROM licenses l WHERE l.buyer_id IS NOT NULL AND l.collector_no IS NOT NULL AND l.status IN ('active','expired') GROUP BY l.buyer_id ORDER BY MIN(l.starts_at), l.buyer_id").all();
    const id = firstId(); if (!id) return rows.slice(0, FOUNDING);
    const me = rows.find(r => r.buyer_id === id) || { buyer_id: id, first: null, n: 0 };
    return [me, ...rows.filter(r => r.buyer_id !== id)].slice(0, FOUNDING);
  }
  const no = b => { if (!b) return null; const i = order().findIndex(r => r.buyer_id === b.id); return i < 0 ? null : i + 1; };
  const isFirst = b => !!(b && firstId() === b.id);
  // Seeded once from the environment (FIRST_COLLECTOR: a name, an email or a gallery code), so the live house can be
  // set from Render before the Studio is opened; the Studio's choice wins afterwards.
  function find(q) {
    q = String(q || '').trim(); if (!q) return [];
    const like = `%${q}%`;
    return db.prepare('SELECT * FROM buyers WHERE id=? OR code=? OR name LIKE ? OR email LIKE ? ORDER BY id LIMIT 12').all(Number(q) || -1, q, like, like);
  }
  if (process.env.FIRST_COLLECTOR && !firstId()) { const m = find(process.env.FIRST_COLLECTOR); if (m.length === 1) { set('first_collector', String(m[0].id)); console.log('[founders] first collector set from the environment:', m[0].name || m[0].email || m[0].code); } else console.log('[founders] FIRST_COLLECTOR matched', m.length, 'people; set it in Studio → Founders'); }

  app.get('/studio/founders', (req, res) => {
    if (!isStudio(req)) return res.redirect('/studio/login');
    const f = first(), q = String(req.query.q || '').trim(), found = q ? find(q) : [];
    const rows = order().map((r, i) => ({ ...r, no: i + 1, b: db.prepare('SELECT id, name, email, code, public FROM buyers WHERE id=?').get(r.buyer_id) || {} }));
    res.send(V.layout({ title: 'Founders · Studio · Watermark', studio: true, path: '/studio/founders', body: `<section class="studio-wrap"><p class="k">The house</p><h1>The Founding Collectors.</h1>
<p class="lede">The first hundred people to collect a numbered piece are Founding Collectors, marked so on their galleries for good. The house names the first of them by hand, so No. 1 is the person who truly was first, not a test purchase or a clock.</p>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
<section class="fdr-first"><p class="k">The first collector</p>${f ? `<p class="fdr-who"><b>${esc(f.name || f.email || f.code)}</b>${f.email ? ` · ${esc(f.email)}` : ''} · gallery <code>${esc(f.code || '')}</code>${f.public ? ` · <a href="/g/${esc(f.code)}">public</a>` : ' · private'}</p>` : '<p class="fdr-who">Not yet named. Everyone is numbered by their first purchase.</p>'}
<form method="post" action="/studio/founders/note" class="fdr-note"><label>The line beside the honour (a draft until Will confirms; e.g. “the founder’s mother”)<input name="note" value="${esc(note())}" maxlength="80" placeholder="the founder’s mother"></label><button class="buy-btn">Keep the line</button></form>
<form method="get" action="/studio/founders" class="fdr-find"><label>Name the first collector: find by name, email, gallery code or number<input name="q" value="${esc(q)}" placeholder="Amy Fullerton"></label><button class="buy-btn">Find</button></form>
${q ? (found.length ? `<ul class="fdr-found">${found.map(b => `<li><b>${esc(b.name || '(no name)')}</b> · ${esc(b.email || 'no email')} · <code>${esc(b.code || '')}</code> · ${db.prepare("SELECT COUNT(*) n FROM licenses WHERE buyer_id=? AND collector_no IS NOT NULL AND status IN ('active','expired')").get(b.id).n} numbered piece(s)<form method="post" action="/studio/founders/first" style="display:inline"><input type="hidden" name="id" value="${b.id}"><button class="link">Name as the first collector</button></form></li>`).join('')}</ul>` : '<p class="note">No one by that word.</p>') : ''}
${f ? '<form method="post" action="/studio/founders/first"><input type="hidden" name="id" value=""><button class="link">Un-name (back to the clock)</button></form>' : ''}</section>
<h2>The first ${rows.length} of ${FOUNDING}</h2>
<table class="tbl"><tr><th>No.</th><th>Collector</th><th>First piece</th><th>Pieces</th><th>Gallery</th></tr>${rows.map(r => `<tr${r.no === 1 ? ' class="fdr-one"' : ''}><td>${r.no}</td><td>${esc(r.b.name || r.b.email || r.b.code || '?')}${r.no === 1 && f ? ' · the first collector' : ''}</td><td>${esc(String(r.first || '').slice(0, 10))}</td><td>${r.n}</td><td>${r.b.code ? `<a href="/g/${esc(r.b.code)}">${r.b.public ? 'public' : 'private'}</a>` : ''}</td></tr>`).join('')}</table></section>` }));
  });
  app.post('/studio/founders/first', (req, res) => {
    if (!isStudio(req)) return res.sendStatus(403);
    const id = Number((req.body || {}).id) || 0;
    if (!id) { db.prepare("DELETE FROM settings WHERE k='first_collector'").run(); return res.redirect('/studio/founders?ok=' + encodeURIComponent('Back to the order of the clock.')); }
    const b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); if (!b) return res.sendStatus(404);
    set('first_collector', String(id));
    res.redirect('/studio/founders?ok=' + encodeURIComponent(`${b.name || b.email || b.code} is the first collector, No. 1.`));
  });
  app.post('/studio/founders/note', (req, res) => {
    if (!isStudio(req)) return res.sendStatus(403);
    set('first_collector_note', String((req.body || {}).note || '').replace(/<[^>]*>/g, '').trim().slice(0, 80));
    res.redirect('/studio/founders?ok=' + encodeURIComponent('The line is kept.'));
  });
  app.locals.founders = { first, firstId, isFirst, no, note, order };
  return app.locals.founders;
}
module.exports = { mountFounders };
