// The printing house (Will, 24 Oct: "the library Benjamin Franklin would build if he had this technology"; "allow
// other printing-press studios to make their own pages, and we get a cut of all of it; Krafft Studios' page is the
// template: the printing house; everybody becomes their own media company under our brand").
//   Franklin's enterprise was a printing house that published its own paper, its own almanac and other people's books,
//   a subscription library, and a post office that carried all of it. The house has the parts: the vault and the walls
//   (the pictures), the reading room and the Library (the books), the Bookshop (the copies), the register (the record),
//   the notices and letters (the post), Friends and Keeping (the subscription), the Keys (the Junto).
//   What this file adds is the press in every maker's hands: a writing desk (/account/writing) where a maker publishes
//   words, an essay, a journal, a book, a history, set as the reading room sets them, free or at the maker's price,
//   shelved in the Library under the maker's name, shown on the maker's page beside their pictures and books, and
//   set among the photographs in Wander. Every sale carries the house's share on top (FEE), as a photograph does.
//   The maker's page becomes their own printing house: pictures, writing, books, the shop, shows.
const KINDS = [['essay', 'An essay'], ['journal', 'A journal'], ['book', 'A book'], ['history', 'Art history'], ['paper', 'A paper']];
function mountPress(app, { db, V, C, makerOf, ledger, isStudio }) {
  const { esc, tidy, money } = V, FEE = require('./fee');
  const slugify = t => String(t).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'text';
  const mine = (m, id) => db.prepare('SELECT * FROM texts WHERE id=? AND maker_id=?').get(Number(id), m.id);
  const list = m => db.prepare("SELECT t.*, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.maker_id=? AND t.status<>'merged' ORDER BY t.id DESC").all(m.id);
  const words = b => String(b || '').split(/\s+/).filter(Boolean).length;
  function page(m, { t = null, ok = null, err = null } = {}) {
    const rows = list(m); const mk = t || {};
    const form = `<form method="post" action="/account/writing${t ? `/${t.id}` : ''}" class="pw-f">
<label><span>Title</span><input name="title" required maxlength="160" value="${esc(mk.title || '')}"></label>
<div class="pw-row"><label><span>What it is</span><select name="kind">${KINDS.map(([k, v]) => `<option value="${k}"${(mk.kind || 'essay') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label><label><span>Price, $ (blank: free to read)</span><input name="price" inputmode="decimal" value="${mk.price_cents ? (mk.price_cents / 100) : ''}"></label><label><span>Year</span><input name="year" maxlength="12" value="${esc(mk.year || '')}"></label></div>
<label><span>A line about it</span><input name="summary" maxlength="300" value="${esc(mk.summary || '')}"></label>
<label><span>The text <small>Paragraphs with a blank line between; <code>## A heading</code> for a chapter; <code>*italic*</code> and <code>**bold**</code>; <code>&gt; a quotation</code>.</small></span><textarea name="body" rows="22" required>${esc(mk.body || '')}</textarea></label>
<div class="pw-row"><label><span>Cover: one of your works (its address)</span><input name="cover" value="${esc(mk.cover || '')}" placeholder="the-staircase"></label><label class="pw-chk"><input type="checkbox" name="public" value="1"${t ? (mk.public ? ' checked' : '') : ' checked'}> Shown on your page and in the Library</label></div>
<div class="pw-acts"><button class="buy-btn">${t ? 'Save' : 'Publish'}</button>${t ? `<a href="/read/${esc(t.slug)}">Read it</a> · <a href="/library/${esc(t.slug)}">Its page</a> · <a href="/account/writing">All your writing</a>` : ''}</div>
<p class="note">${FEE.yours(m.share_pct, 'yours').replace(/^the/, 'The')}${FEE.on() ? '; the house’s share is on top, as on a photograph' : ''}. Free writing is free to all and kept like everything else: entered on the register under your name.</p></form>`;
    return V.layout({ title: 'Writing · Your studio', studio: true, body: `<section class="studio-wrap pw"><p class="k">The printing house</p><h1>${t ? `Editing <em>${esc(tidy(t.title))}</em>.` : 'Your writing.'}</h1>
<p class="lede">Words are held like pictures: an essay, a journal, a book or a history, set as the reading room sets them, on your page beside your work, in the Library, and set among the photographs in Wander. Free, or at your price.</p>
${ok ? `<p class="ok">${esc(ok)}</p>` : ''}${err ? `<p class="ok">${esc(err)}</p>` : ''}
${form}
${!t && rows.length ? `<h2>On your shelf</h2><table class="tbl"><tr><th>Title</th><th>Kind</th><th>Words</th><th>Price</th><th>Shown</th><th></th></tr>${rows.map(r => `<tr><td><a href="/library/${esc(r.slug)}">${esc(tidy(r.title))}</a></td><td>${esc((KINDS.find(k => k[0] === r.kind) || [])[1] || r.kind)}</td><td>${words(r.body).toLocaleString('en-US')}</td><td>${r.price_cents ? money(r.price_cents) : 'Free'}</td><td>${r.public && r.status === 'held' ? 'Yes' : 'No'}</td><td><a href="/account/writing/${r.id}">Edit</a> · <form method="post" action="/account/writing/${r.id}/hide" class="inl"><button>${r.status === 'held' ? 'Take down' : 'Put back'}</button></form></td></tr>`).join('')}</table>` : ''}</section>` });
  }
  app.get('/account/writing', (req, res) => { const m = makerOf(req); if (!m) return res.sendStatus(401); V.setDeskPath && V.setDeskPath('/account/writing'); res.send(page(m, { ok: req.query.ok || null })); });
  app.get('/account/writing/:id', (req, res) => { const m = makerOf(req); if (!m) return res.sendStatus(401); const t = mine(m, req.params.id); if (!t) return res.sendStatus(404); const w = t.cover_work_id ? db.prepare('SELECT slug FROM works WHERE id=?').get(t.cover_work_id) : null; res.send(page(m, { t: { ...t, cover: w ? w.slug : '' }, ok: req.query.ok || null })); });
  function take(m, b, t) {
    const title = String(b.title || '').trim().slice(0, 160); if (title.length < 2) throw new Error('A title.');
    const body = String(b.body || '').replace(/\r\n?/g, '\n').trim(); if (body.length < 200) throw new Error('At least a few paragraphs.');
    const kind = KINDS.some(k => k[0] === b.kind) ? b.kind : 'essay'; const price = b.price ? Math.round(parseFloat(b.price) * 100) || null : null;
    const cover = b.cover ? db.prepare("SELECT id FROM works WHERE slug=? AND maker_id=? AND status IN ('held','hidden')").get(String(b.cover).trim(), m.id) : null;
    const pub = b.public ? 1 : 0; const summary = String(b.summary || '').trim().slice(0, 300) || null; const year = String(b.year || '').trim().slice(0, 12) || null;
    if (t) { db.prepare("UPDATE texts SET title=?, kind=?, summary=?, body=?, price_cents=?, public=?, cover_work_id=?, year=?, updated_at=datetime('now') WHERE id=?").run(title, kind, summary, body, price, pub, cover ? cover.id : null, year, t.id); return db.prepare('SELECT * FROM texts WHERE id=?').get(t.id); }
    let slug = slugify(title); if (db.prepare('SELECT 1 FROM texts WHERE slug=?').get(slug)) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    const id = db.prepare("INSERT INTO texts (slug, kind, title, author, maker_id, year, summary, body, public, price_cents, terms, source, cover_work_id, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'held')").run(slug, kind, title, m.name, m.id, year, summary, body, pub, price, '© ' + m.name + '. All rights reserved.', null, cover ? cover.id : null).lastInsertRowid;
    try { ledger.append(db, 'text.shelved', slug, { title, author: m.name, maker: m.handle, kind, from: 'press', price_cents: price }); } catch (e) { /* */ }
    return db.prepare('SELECT * FROM texts WHERE id=?').get(id);
  }
  app.post('/account/writing', (req, res) => { const m = makerOf(req); if (!m) return res.sendStatus(401); try { const t = take(m, req.body || {}, null); res.redirect(`/account/writing/${t.id}?ok=${encodeURIComponent('Published. It is on your page and in the Library.')}`); } catch (e) { res.send(page(m, { err: e.message })); } });
  app.post('/account/writing/:id', (req, res) => { const m = makerOf(req); if (!m) return res.sendStatus(401); const t = mine(m, req.params.id); if (!t) return res.sendStatus(404); try { take(m, req.body || {}, t); res.redirect(`/account/writing/${t.id}?ok=Saved.`); } catch (e) { res.send(page(m, { t, err: e.message })); } });
  app.post('/account/writing/:id/hide', (req, res) => { const m = makerOf(req); if (!m) return res.sendStatus(401); const t = mine(m, req.params.id); if (!t) return res.sendStatus(404); db.prepare("UPDATE texts SET status=? WHERE id=?").run(t.status === 'held' ? 'hidden' : 'held', t.id); res.redirect('/account/writing'); });
  // The maker's shelves, for their page: writing, books, and the shop.
  function shelves(m) {
    const texts = db.prepare("SELECT t.*, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.maker_id=? AND t.public=1 AND t.status='held' ORDER BY t.id DESC").all(m.id);
    const writing = texts.filter(t => t.kind !== 'photobook'), books = texts.filter(t => t.kind === 'photobook');
    let copies = []; try { copies = db.prepare("SELECT c.*, t.title, t.slug FROM copies c JOIN texts t ON t.id=c.text_id WHERE c.seller_kind='maker' AND c.seller_id=? AND c.status='offered' AND c.qty>0 ORDER BY c.id DESC LIMIT 12").all(m.id); } catch (e) { copies = []; }
    return { writing, books, copies };
  }
  function block(m) {
    const { writing, books, copies } = shelves(m); if (!writing.length && !books.length && !copies.length) return '';
    const card = t => `<a class="pw-card" href="${t.body && !t.file ? `/read/${esc(t.slug)}` : `/library/${esc(t.slug)}`}">${t.cover ? `<img src="/img/${esc(t.cover)}/screen" alt="" loading="lazy">` : `<span class="pw-spine"><b>${esc(tidy(t.title))}</b></span>`}<span class="pw-ct"><b>${esc(tidy(t.title))}</b><i>${esc((KINDS.find(k => k[0] === t.kind) || ['', t.kind === 'photobook' ? 'A photo book' : t.kind])[1])}${t.year ? ` · ${esc(t.year)}` : ''}</i><small>${t.price_cents ? money(t.price_cents) : 'Read free'}</small></span></a>`;
    const KC = { first: 'First edition', signed: 'Signed copy', reprint: 'Reprint', paper: 'In paper', proof: 'Proof copy', other: 'A copy' };
    const copy = c => `<a class="pw-card" href="/library/${esc(c.slug)}#bookshop">${c.photo_slug ? `<img src="/img/${esc(c.photo_slug)}/screen" alt="" loading="lazy">` : `<span class="pw-spine"><b>${esc(tidy(c.title))}</b></span>`}<span class="pw-ct"><b>${esc(tidy(c.title))}</b><i>${esc(KC[c.kind] || 'A copy')}${c.line ? ` · ${esc(c.line)}` : ''}</i><small>${money(FEE.on() ? c.price_cents + FEE.premium(c.price_cents) : c.price_cents)}</small></span></a>`;
    const shelf = (h, line, items, fn) => items.length ? `<section class="mh-sec pw-sec"><div class="mh-wrap"><header class="gh"><h2>${h}</h2><span>${line}</span></header><div class="pw-row-c">${items.slice(0, 8).map(fn).join('')}</div></div></section>` : '';
    return shelf('Writing', `${writing.length} piece${writing.length === 1 ? '' : 's'}, set in the reading room`, writing, card) + shelf('Books', `${books.length} photo book${books.length === 1 ? '' : 's'}`, books, card) + shelf('From the shelf', 'Copies offered by the maker, shipped', copies, copy);
  }
  // The printing house, as the public reads it.
  app.get('/press', (req, res) => {
    const n = db.prepare("SELECT COUNT(DISTINCT maker_id) n FROM texts WHERE maker_id IS NOT NULL AND public=1 AND status='held'").get().n;
    res.send(V.layout({ title: 'The printing house · Watermark', path: '/press', desc: 'Every maker a media company under the house’s roof: pictures, words, books and a shop, with the record kept and every dollar of the price theirs.', body: `<section class="pw-pub"><header><p class="k">Watermark Publishing</p><h1>The printing house.</h1><p class="lede">Franklin’s printing house published its own paper and almanac, other people’s books, ran a subscription library, and carried all of it by post. The house has every part, and gives the press to everyone who makes something: your page is your own house, with your pictures, your writing, your books and your shop under one roof, the record kept, and every dollar of the price yours. The house’s share is paid by the collector, on top, and it is how the house keeps the lights on.</p></header>
<div class="pw-grid">
<div><h2>Pictures</h2><p>Held at the source, fingerprinted and deeded on arrival, collected and licensed at your prices. <a href="/makers">For those who make</a></p></div>
<div><h2>Words</h2><p>An essay, a journal, a book, a history, published from your studio and set as the reading room sets them. Free to read, or at your price. <a href="/publishing">Watermark Publishing</a></p></div>
<div><h2>Books and copies</h2><p>Photo books made from your walls; signed copies and first editions from your shelf, sold shipped. <a href="/bookshop">The Bookshop</a></p></div>
<div><h2>The record and the post</h2><p>Every arrival, sale and publication on the signed register; letters and notices carry the news to the people who follow your work. <a href="/ledger">The register</a></p></div>
<div><h2>The subscription</h2><p>Friends of the house, and Keeping for the archive, after the Library Company: a small dues that keeps the doors open. <a href="/friends">Friends of the house</a></p></div>
<div><h2>The Junto</h2><p>The Keys: benches under the work, the balcony at night, the dinner. Where the makers and the collectors meet. <a href="/keys">The Keys</a></p></div>
</div>
<p class="pw-n">${n ? `${n} maker${n === 1 ? ' has' : 's have'} published words here so far.` : 'The first words are being set.'} Makers publish from their studio under Writing; by invitation, as everything in the house is. <a href="/join">Apply with the work</a>.</p></section>` }));
  });
  app.locals.press = { block, shelves, KINDS };
  return app.locals.press;
}
module.exports = { mountPress, KINDS };
