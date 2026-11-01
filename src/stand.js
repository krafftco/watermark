'use strict';
// The stand (Will, 31 Oct, going out on Halloween with the Q3 and the Instax: "shooting and delivering and demoing and
// giving people prints"; "maybe even sell to them on the spot"; "could I charge someone via Apple Pay"; "upload and make a
// print and a license and a check out, all one experience"). The maker's phone, at a party:
//   /account/stand            what came in today (kept back or shown), newest first, a tap each;
//   /account/stand/:slug      the picture full screen to hand over: a code to scan that opens the work's own page, where
//                             the Collect is one tap with Apple Pay on their phone (the licence and the file are theirs on
//                             paying, the letter follows); 'Print on Instax' for the maker's own printer; the next picture.
// Selling needs the work on view: the first tap on Sell asks the maker's word once a visit (that it is theirs and that a
// personal Collect needs no release), then publishes it as /account/works/:slug/show does. No card is ever taken on the
// maker's phone: the buyer pays on their own.
function mountStand(app, { db, V, C, makerOf, ledger, originalPath }) {
  const { esc, tidy } = V; const QR = require('./qr'); const KEEP = require('./keep');
  const mine = (req, slug) => { const m = makerOf(req); if (!m) return [null, null]; const w = db.prepare("SELECT * FROM works WHERE slug=? AND maker_id=? AND status IN ('held','hidden')").get(String(slug), m.id); return [m, w]; };
  const priceOf = w => { try { const j = app.locals.workJSON(w); const u = (j.uses || []).find(x => x.key === 'social' && x.instant); return u ? u.price_cents : null; } catch (e) { return null; } };
  const money = c => c == null ? '' : `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

  app.get('/account/stand', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/stand');
    const ws = db.prepare("SELECT * FROM works WHERE maker_id=? AND status IN ('held','hidden') AND created_at >= datetime('now', '-36 hours') ORDER BY id DESC LIMIT 120").all(m.id);
    const older = ws.length ? [] : db.prepare("SELECT * FROM works WHERE maker_id=? AND status IN ('held','hidden') ORDER BY id DESC LIMIT 24").all(m.id);
    const tile = w => `<a class="sd2-t" href="/account/stand/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"><span>${w.status === 'held' ? 'On view' : 'Kept back'}</span></a>`;
    res.send(V.layout({ title: 'The stand · Watermark', bare: true, path: '/account/stand', body: `<main class="sd2"><header class="sd2-h"><a href="/account">← Your studio</a><h1>The stand</h1><p>Shoot, send it in, hand them the phone. They scan, pay with Apple Pay on their own phone, and it is theirs: the file, the licence, the letter. You print the Instax.</p>
<p class="sd2-acts"><a class="buy-btn" href="/account/upload">Send in tonight’s</a><a class="btn" href="/account/deliveries">Make an album</a></p></header>
${ws.length ? `<h2>Today</h2><div class="sd2-g">${ws.map(tile).join('')}</div>` : older.length ? `<h2>Nothing new today. The latest:</h2><div class="sd2-g">${older.map(tile).join('')}</div>` : '<p class="sd2-e">Nothing in the vault yet. Send in tonight’s first.</p>'}</main>` }));
  });

  app.get('/account/stand/:slug', (req, res) => {
    const [m, w] = mine(req, req.params.slug); if (!m) return res.redirect(`/signin?next=/account/stand/${encodeURIComponent(req.params.slug)}`); if (!w) return res.sendStatus(404);
    const next = db.prepare("SELECT slug FROM works WHERE maker_id=? AND status IN ('held','hidden') AND id<? ORDER BY id DESC LIMIT 1").get(m.id, w.id);
    const prev = db.prepare("SELECT slug FROM works WHERE maker_id=? AND status IN ('held','hidden') AND id>? ORDER BY id ASC LIMIT 1").get(m.id, w.id);
    const url = `${C.base}/m/${m.handle}/${w.slug}?from=stand`; const shown = w.status === 'held'; const p = shown ? priceOf(w) : null;
    res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: `${tidy(w.title)} · The stand`, bare: true, path: '/account/stand', body: `<main class="sd2 sd2-one"><a class="sd2-x" href="/account/stand" aria-label="Back to the stand">×</a>
<figure class="sd2-pic"><img src="/img/${esc(w.slug)}/large" alt=""></figure>
<section class="sd2-sell">${shown ? `<div class="sd2-qr">${QR.svg(url, { size: 220 })}</div><p class="sd2-say"><b>Scan to make it yours${p ? ` · ${money(p)}` : ''}</b><br>Apple Pay on your phone. The file and the licence are yours at once, and your gallery opens with it: no account to make, no password. Your email gets you in.</p>`
      : `<form method="post" action="/account/stand/${esc(w.slug)}/sell" class="sd2-f"><label class="sd2-ck"><input type="checkbox" name="attest" value="1" required> I made this and hold the rights. A personal Collect needs no release; a company’s use would.</label><button class="buy-btn">Put it on view to sell</button></form>`}
<p class="sd2-row"><a class="btn" href="/account/stand/${esc(w.slug)}/instax" download>Print on Instax</a>${shown ? `<a class="btn" href="${esc(url)}">Open its page</a>` : ''}</p>
<p class="sd2-nav">${prev ? `<a href="/account/stand/${esc(prev.slug)}">← Newer</a>` : '<span></span>'}${next ? `<a href="/account/stand/${esc(next.slug)}">Older →</a>` : '<span></span>'}</p></section></main>` }));
  });

  app.post('/account/stand/:slug/sell', (req, res) => {
    const [m, w] = mine(req, req.params.slug); if (!m || !w) return res.sendStatus(404);
    const back = `/account/stand/${encodeURIComponent(w.slug)}`;
    if (w.status === 'held') return res.redirect(back);
    if ((req.body || {}).attest !== '1' || m.standing === 'held' || w.keep_back) return res.redirect(back);
    if (app.locals.mayHang && !app.locals.mayHang(m)) return res.redirect('/account?need=wall');
    db.prepare("UPDATE works SET status='held' WHERE id=?").run(w.id);
    try { ledger.append(db, 'work.published', w.slug, { maker: m.handle, attested: 'rights and releases', by: 'stand' }); } catch (e) { /* */ }
    try { if (app.locals.legal) app.locals.legal.accept('maker', m.id, 'makers', req.ip, w.slug); } catch (e) { /* */ }
    res.redirect(back);
  });

  // The maker's own Instax file, from the original (the holder's room's recipe).
  app.get('/account/stand/:slug/instax', async (req, res) => {
    const [m, w] = mine(req, req.params.slug); if (!m || !w) return res.sendStatus(404);
    try {
      const src = await originalPath(w); const out = await KEEP.instaxFile(src, { film: String(req.query.film || 'mini'), look: String(req.query.look || 'film') });
      const name = `${tidy(w.title).replace(/[^\w ,.'-]+/g, '').slice(0, 60) || 'Watermark'} (${out.film.name}).jpg`;
      res.set('Content-Type', 'image/jpeg').set('Cache-Control', 'private, no-store').set('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`).send(out.buf);
    } catch (e) { console.error('[stand]', e.message); res.sendStatus(500); }
  });
}
module.exports = { mountStand };
