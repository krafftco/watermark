// For the trade, retired (Will, 20 Nov, #178: "the house is not a stock library"). There was a working side here: a
// priced catalogue at /trade with megapixel filters, comps and a quote for a set, turned on by a cookie (`wm_trade`).
// It is gone. Licensing stays where it belongs: on each work's own licence page (/license/:slug: its uses, each with
// its price or Ask) and by enquiry to the house from that page ('Ask about using this work'). What is left here:
// the old doors, which clear the cookie and lead to the collection, and the enquiry.
const ORIENT = { landscape: 'Landscape', portrait: 'Portrait', square: 'Square', pano: 'Panoramic' };
const orient = w => { if (!w.width || !w.height) return null; const r = w.width / w.height; return r >= 2 ? 'pano' : r > 1.08 ? 'landscape' : r < 0.93 ? 'portrait' : 'square'; };
const mp = w => (w.width && w.height ? Math.round(w.width * w.height / 1e5) / 10 : null);

function mountTrade(app, { db, C, V, mk, mail, ledger }) {
  const esc = V.esc, tidy = V.tidy;
  const HOUSE = () => process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com';
  const safe = b => { b = String(b || ''); return /^\/[^/\\]/.test(b) ? b.slice(0, 300) : null; };
  // The old doors. Each clears the switch an earlier visit left on the device and leads on; none is a page any more.
  // (Never kept by the edge or the browser: a kept redirect would leave the cookie where it is.)
  const clear = res => { res.cookie('wm_trade', '', { maxAge: 0, sameSite: 'lax', path: '/', secure: C.base.startsWith('https') }); res.set('Cache-Control', 'private, no-store'); };
  app.get(['/trade', '/trade/on'], (req, res) => { clear(res); res.redirect('/collection'); });
  app.get('/trade/off', (req, res) => { clear(res); res.redirect(safe(req.query.back) || '/collection'); });

  // 'Ask about using this work', from a work's licence page: the file's size there, and a short letter to the house.
  const form = (w, v = {}, err = '') => `<form method="post" action="/license/${esc(w.slug)}/ask" class="tr-ask-f">
${err ? `<p class="err">${esc(err)}</p>` : ''}<p>A use that is not listed, several works for one job, a price for a run or a territory: say what you need and the house answers in writing, within one working day.</p>
<label><span>Your email</span><input type="email" name="email" required maxlength="160" autocomplete="email" value="${esc(v.email || '')}"></label>
<label><span>Company or publication</span><input name="company" maxlength="120" autocomplete="organization" value="${esc(v.company || '')}"></label>
<label><span>The use</span><textarea name="note" rows="3" maxlength="600" placeholder="Where it will appear, the run, the territory, the date">${esc(v.note || '')}</textarea></label>
<input type="text" name="website" class="hpot" tabindex="-1" autocomplete="off" aria-hidden="true">
<button class="buy-btn">Send to the house</button></form>`;
  app.locals.askAbout = w => `<aside class="tr-ask" id="ask">${w.width && w.height ? `<p class="tr-ask-size">The file: ${Number(w.width).toLocaleString('en-US')} &times; ${Number(w.height).toLocaleString('en-US')} pixels.</p>` : ''}
<p><a href="/license/${esc(w.slug)}/ask">Ask about using this work</a></p></aside>`;
  // The letter has its own leaf, so the licence page itself stays free of fields: paying there asks for nothing.
  const leaf = (w, v, err) => `<section class="narrow"><p class="k">Using a work</p><h1>Ask about using this work.</h1><p class="lede">${esc(tidy(w.title))}, by ${esc(mk(w).name)}.</p><div class="tr-ask">${form(w, v, err)}</div><p><a class="link" href="/license/${esc(w.slug)}">Back to the work</a></p></section>`;
  app.get('/license/:slug/ask', (req, res) => {
    const w = db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(String(req.params.slug));
    if (!w) return res.redirect('/collection');
    res.send(V.layout({ title: `Ask about using ${tidy(w.title)} · Watermark`, desc: 'Ask the house about using this work.', body: leaf(w) }));
  });

  // The enquiry: one letter to the house and to each maker, with the works, the use and the job. /license/:slug/ask
  // is its door now; /trade/quote (the retired catalogue's form, which could carry a set) answers for one more
  // release so a page left open still sends, and then goes.
  app.post(['/license/:slug/ask', '/trade/quote'], (req, res) => {
    const x = req.body || {}; const slugs = (req.params.slug ? [req.params.slug] : [].concat(x.w || [])).slice(0, 60);
    const email = String(x.email || '').trim().slice(0, 160); 
    const works = slugs.map(s => db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(String(s))).filter(Boolean);
    const use = String(x.use || '').slice(0, 30), company = String(x.company || '').trim().slice(0, 120), note = String(x.note || '').trim().slice(0, 600);
    const back = works[0] ? `/license/${works[0].slug}` : '/collection';
    const said = (title, h1, inner) => res.send(V.layout({ title: `${title} · Watermark`, body: `<section class="narrow"><p class="k">Using a work</p><h1>${h1}</h1>${inner}</section>` }));
    // A person is always told, and always has a next press: the work is gone, or the address will not take a letter.
    if (!works.length) return said('Ask about using a work', 'That work is not here to ask about.', '<p class="lede">It may have been taken down, or the page was open a long while. Every work says on its own page how it may be used.</p><p><a class="buy-btn" href="/collection">The collection</a></p>');
    if (x.website) return said('Asked', 'Asked.', `<p><a class="buy-btn" href="${esc(back)}">Back to the work</a></p>`); // a machine filled the hidden field: nothing is sent
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.send(V.layout({ title: 'Ask about using this work · Watermark', body: leaf(works[0], { email, company, note }, 'An address the house can answer, please: that one does not look whole.') }));
    const lines = works.map(w => `- ${tidy(w.title)}, ${mk(w).name} (${w.accession || w.slug}): ${C.base}/w/${w.slug}`).join('\n');
    const text = `Someone asks about using ${works.length === 1 ? 'a work' : `${works.length} works`}.\n\nFrom: ${email}${company ? `, ${company}` : ''}\nUse: ${use || 'not said'}\nThe job: ${note || 'not said'}\n\n${lines}\n\nAnswer from the Studio, or reply to ${email}.`;
    ledger.append(db, 'trade.quote', `quote-${Date.now().toString(36)}`, { n: works.length, use });
    if (mail.on()) {
      mail.send({ to: HOUSE(), subject: `An enquiry about ${works.length === 1 ? 'a work' : `${works.length} works`}${company ? `, ${company}` : ''}`, text, replyTo: email });
      for (const mid of [...new Set(works.map(w => w.maker_id))]) { const m = db.prepare('SELECT * FROM makers WHERE id=?').get(mid); if (m && m.email) mail.send({ to: m.email, subject: `Someone asks about using your work${company ? `, ${company}` : ''}`, text }); }
      mail.send({ to: email, subject: 'Your enquiry to Watermark', text: `Thank you. The house has your enquiry about ${works.length === 1 ? 'this work' : `these ${works.length} works`} and will answer within one working day.\n\n${lines}\n\nWatermark` });
    }
    for (const mid of [...new Set(works.map(w => w.maker_id))]) if (app.locals.notify) app.locals.notify.tell({ maker_id: mid, kind: 'requested', slug: works.find(w => w.maker_id === mid).slug, href: '/account/requests', title: `An enquiry about using your work${company ? `, from ${company}` : ''}`, body: `${works.filter(w => w.maker_id === mid).length} of your works${use ? `, for ${use}` : ''}.` }).catch(() => {});
    said('Asked', 'Asked.', `<p class="lede">The house answers within one working day${mail.on() ? `, to ${esc(email)}` : ''}.</p><p><a class="buy-btn" href="${esc(back)}">Back to the work</a></p>`);
  });
}

module.exports = { mountTrade, orient, mp, ORIENT };
