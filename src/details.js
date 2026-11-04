// Frames within the frame (Will, 4 Nov: "finding frames within frames… a work so vast you create a frame to isolate a
// subject, and that's where you see the masterful nature of a painting"; "like little segments of carpets sold";
// the woman holding her daughter while she watches the sea, apart from the boy on the boat).
// A detail is a rectangle of a work (fractions of the upright picture), kept with an address of its own:
//   /w/:slug/frame       the framer: the whole picture with a frame to move and size (Free, 4:5, 1:1, 3:2, 16:9)
//   POST /w/:slug/frame  keeps it → /w/:slug/d/:n
//   /w/:slug/d/:n        the detail on the dark wall: 'A detail of <title>, by <artist>', a line in the framer's words,
//                        See the whole, Frame another, Share; a print of it when the work is open (editions' openBlock)
//   /img/:slug/detail/:n the picture of the detail (2400 on its long side, from the original; cached)
//   /details             details people kept, the newest first, and the works framed most
// Anyone may frame a work on view (it is a way of looking); only an open work's detail is sold, as a print, through the
// same door as the whole, so the tenth goes to the buyer's cause. A living maker's detail is never sold without them.

const fs = require('fs'); const path = require('path');

function mountDetails(app, { db, V, C, q, mk, images, originalPath, cache, buyerOf, makerOf, isStudio, zone, ledger }) {
  const { esc, layout } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS work_details (id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, n INTEGER NOT NULL,
    x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL, line TEXT, by_buyer INTEGER, by_maker INTEGER, viewer TEXT,
    at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(work_id, n))`);
  db.exec('CREATE INDEX IF NOT EXISTS work_details_at ON work_details (at)');
  const dir = path.join(cache, 'details'); fs.mkdirSync(dir, { recursive: true });
  const tidy = t => String(t || '').replace(/[.\s]+$/, '');

  const onView = w => w && w.status === 'held' && !w.keep_back && !w.disputed;
  const mayView = (req, w) => {
    if (!w) return false; if (isStudio(req)) return true; const m = makerOf(req); if (m && m.id === w.maker_id) return true;
    if (!onView(w)) return false; if (w.zone === 'mature' && !(zone && zone.open && zone.open(req))) return false; return true;
  };
  const artistOf = w => { try { return w.artist_id ? db.prepare('SELECT name, slug FROM artists WHERE id=?').get(w.artist_id) : null; } catch (e) { return null; } };
  const byOf = w => { const a = artistOf(w); const m = mk(w); return a && m && m.kind !== 'maker' ? a.name : (m ? m.name : ''); };
  const get = (w, n) => db.prepare('SELECT * FROM work_details WHERE work_id=? AND n=?').get(w.id, +n || 0);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // The detail's own pixels on its long side, from the work's upright size.
  const px = (w, d) => ({ w: Math.round((w.width || 0) * d.w), h: Math.round((w.height || 0) * d.h) });

  // The picture of a detail, from the original, cut after the EXIF turn.
  async function cut(w, d, long = 2400) {
    const out = path.join(dir, `${w.slug}-${d.n}-${long}-${w.sha256 ? w.sha256.slice(0, 8) : 'x'}.jpg`);
    if (fs.existsSync(out)) return out; fs.mkdirSync(dir, { recursive: true });
    const sharp = require('sharp'); const file = await originalPath(w);
    const meta = await sharp(file, { failOn: 'none', limitInputPixels: false }).metadata();
    const W = meta.orientation >= 5 ? meta.height : meta.width, H = meta.orientation >= 5 ? meta.width : meta.height;
    const left = clamp(Math.round(d.x * W), 0, W - 2), top = clamp(Math.round(d.y * H), 0, H - 2);
    const width = clamp(Math.round(d.w * W), 2, W - left), height = clamp(Math.round(d.h * H), 2, H - top);
    const tmp = out + '.tmp';
    await sharp(file, { failOn: 'none', limitInputPixels: false }).rotate().extract({ left, top, width, height })
      .resize({ width: width >= height ? Math.min(long, width) : null, height: height > width ? Math.min(long, height) : null, kernel: 'lanczos3' })
      .jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(tmp);
    fs.renameSync(tmp, out); return out;
  }
  // A full-resolution cut for a print (the lab and the shops): the original's own pixels inside the frame.
  async function cutFull(w, d, to) {
    const sharp = require('sharp'); const file = await originalPath(w);
    const meta = await sharp(file, { failOn: 'none', limitInputPixels: false }).metadata();
    const W = meta.orientation >= 5 ? meta.height : meta.width, H = meta.orientation >= 5 ? meta.width : meta.height;
    const left = clamp(Math.round(d.x * W), 0, W - 2), top = clamp(Math.round(d.y * H), 0, H - 2);
    await sharp(file, { failOn: 'none', limitInputPixels: false }).rotate()
      .extract({ left, top, width: clamp(Math.round(d.w * W), 2, W - left), height: clamp(Math.round(d.h * H), 2, H - top) })
      .withIccProfile(images && images.gamut ? await images.gamut(file).catch(() => 'srgb') : 'srgb')
      .jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toFile(to);
    return to;
  }

  // The framer.
  app.get('/w/:slug/frame', (req, res) => {
    const w = q.work.get(req.params.slug); if (!mayView(req, w)) return res.sendStatus(404);
    const by = byOf(w); const back = `/w/${w.slug}`;
    res.set('Cache-Control', 'private, no-store').send(layout({ title: `Frame a detail · ${tidy(w.title)} · Watermark`, path: `/w/${w.slug}/frame`, bare: true, body: `<main class="fz" data-fz data-slug="${esc(w.slug)}" data-w="${w.width || 0}" data-h="${w.height || 0}">
<header class="fz-top"><a class="fz-x" href="${esc(back)}" aria-label="Back to the work">&larr;</a><p><b>${esc(tidy(w.title))}</b><span>${esc(by)}</span></p></header>
<div class="fz-stage" data-fz-stage><img src="/img/${esc(w.slug)}/large" alt="${esc(tidy(w.title))}" draggable="false" data-fz-img><div class="fz-box" data-fz-box hidden><i data-c="nw"></i><i data-c="ne"></i><i data-c="sw"></i><i data-c="se"></i></div></div>
<form class="fz-deck" method="post" action="/w/${esc(w.slug)}/frame" data-fz-form>
<p class="fz-say">Move the frame to the part you love. Its corners size it.</p>
<div class="fz-ar" role="group" aria-label="Shape">${[['free', 'Free'], ['0.8', '4:5'], ['1', '1:1'], ['1.5', '3:2'], ['1.7778', '16:9']].map(([v, l], i) => `<button type="button" data-ar="${v}"${i === 1 ? ' aria-pressed="true"' : ''}>${l}</button>`).join('')}</div>
<input type="hidden" name="x"><input type="hidden" name="y"><input type="hidden" name="w"><input type="hidden" name="h">
<input name="line" maxlength="140" placeholder="A line about what you see, if you like" autocomplete="off">
<button class="buy-btn">Keep this frame</button></form></main><script src="/static/framer.js?v=${esc(V.VER)}" defer></script>` }));
  });

  const slow = new Map(); setInterval(() => slow.clear(), 3600e3).unref();
  app.post('/w/:slug/frame', (req, res) => {
    const w = q.work.get(req.params.slug); if (!mayView(req, w)) return res.sendStatus(404);
    const k = req.ip; const n0 = (slow.get(k) || 0) + 1; slow.set(k, n0); if (n0 > 40) return res.sendStatus(429);
    let x = +req.body.x, y = +req.body.y, ww = +req.body.w, hh = +req.body.h;
    if (![x, y, ww, hh].every(Number.isFinite)) return res.redirect(`/w/${w.slug}/frame`);
    x = clamp(x, 0, 1); y = clamp(y, 0, 1); ww = clamp(ww, 0.02, 1 - x); hh = clamp(hh, 0.02, 1 - y);
    if (ww > 0.97 && hh > 0.97) return res.redirect(`/w/${w.slug}`); // the whole is the whole
    // Never a frame smaller than 240 pixels of the original on its short side: a detail must hold up on a wall.
    if (w.width && w.height && Math.min(ww * w.width, hh * w.height) < 240) return res.redirect(`/w/${w.slug}/frame?small=1`);
    const line = String(req.body.line || '').replace(/\s+/g, ' ').trim().slice(0, 140) || null;
    if (line && /https?:|www\./i.test(line)) return res.redirect(`/w/${w.slug}/frame`);
    const n = (db.prepare('SELECT COALESCE(MAX(n),0)+1 n FROM work_details WHERE work_id=?').get(w.id).n);
    const b = buyerOf(req); const m = makerOf(req);
    db.prepare('INSERT INTO work_details (work_id, n, x, y, w, h, line, by_buyer, by_maker, viewer) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(w.id, n, x, y, ww, hh, line, b ? b.id : null, m ? m.id : null, (req.cookies && req.cookies.wm_v) || null);
    res.redirect(303, `/w/${w.slug}/d/${n}`);
  });

  app.get('/img/:slug/detail/:n', async (req, res) => {
    const w = q.work.get(req.params.slug); if (!mayView(req, w)) return res.sendStatus(404);
    const d = get(w, String(req.params.n).replace(/\.jpg$/, '')); if (!d) return res.sendStatus(404);
    try { const f = await cut(w, d, req.query.s === 'thumb' ? 640 : 2400); res.set('Cache-Control', onView(w) ? 'public, max-age=86400' : 'private, no-store').type('image/jpeg'); fs.createReadStream(f).pipe(res); }
    catch (e) { console.error('[details]', e.message); res.sendStatus(404); }
  });

  app.get('/w/:slug/d/:n', (req, res) => {
    const w = q.work.get(req.params.slug); if (!mayView(req, w)) return res.sendStatus(404);
    const d = get(w, req.params.n); if (!d) return res.redirect(`/w/${w.slug}`);
    const by = byOf(w); const p = px(w, d); const others = db.prepare('SELECT * FROM work_details WHERE work_id=? AND n<>? ORDER BY n DESC LIMIT 8').all(w.id, d.n);
    const print = app.locals.openPrints ? app.locals.openPrints.block(w, d) : '';
    const title = `A detail of ${tidy(w.title)}`;
    res.send(layout({ title: `${title} · ${by} · Watermark`, desc: d.line || `${title}, by ${by}. A frame within the frame, kept on Watermark.`, path: `/w/${w.slug}/d/${d.n}`, image: `/img/${w.slug}/detail/${d.n}`, type: 'article', body: `<article class="dtl">
<figure class="dtl-f"><img src="/img/${esc(w.slug)}/detail/${d.n}" alt="${esc(title)}" width="${p.w || ''}" height="${p.h || ''}"></figure>
<div class="dtl-t"><p class="k">A frame within the frame</p><h1>A detail of <i>${esc(tidy(w.title))}</i></h1><p class="dtl-by">${esc(by)}</p>${(() => { const f = framer(d); return f && f.name ? `<p class="dtl-fr">Framed by ${f.href ? `<a href="${esc(f.href)}">${esc(f.name)}</a>` : esc(f.name)}</p>` : ''; })()}${d.line ? `<blockquote class="dtl-line">${esc(d.line)}</blockquote>` : ''}
<p class="dtl-acts"><a class="buy-btn" href="/w/${esc(w.slug)}">See the whole</a>${['pd', 'cc0', 'cc-by', 'cc-by-sa'].includes(w.open) ? `<a href="/w/${esc(w.slug)}/d/${d.n}/save" download>Save it</a>` : ''}<a href="/w/${esc(w.slug)}/frame">Frame another</a><button type="button" data-send data-send-title="${esc(title)}" data-send-text="${esc(`${title}, by ${by}.`)}">Share</button></p>
<a class="dtl-whole" href="/w/${esc(w.slug)}"><span class="dtl-mini"><img src="/img/${esc(w.slug)}/thumb" alt=""><i style="left:${(d.x * 100).toFixed(2)}%;top:${(d.y * 100).toFixed(2)}%;width:${(d.w * 100).toFixed(2)}%;height:${(d.h * 100).toFixed(2)}%"></i></span><small>Where it sits in the whole</small></a></div>
${print}
${others.length ? `<section class="dtl-more"><h2>Other frames people kept in it</h2><div class="dtl-grid">${others.map(o => `<a href="/w/${esc(w.slug)}/d/${o.n}"><img src="/img/${esc(w.slug)}/detail/${o.n}?s=thumb" alt="" loading="lazy">${o.line ? `<span>${esc(o.line)}</span>` : ''}</a>`).join('')}</div></section>` : ''}</article>` }));
  });

  app.get('/details', (req, res) => {
    const rows = db.prepare("SELECT d.*, w.slug, w.title, w.maker_id, w.artist_id, w.zone FROM work_details d JOIN works w ON w.id=d.work_id WHERE w.status='held' AND COALESCE(w.keep_back,0)=0 AND COALESCE(w.zone,'all')<>'mature' ORDER BY d.id DESC LIMIT 60").all();
    const most = db.prepare("SELECT w.slug, w.title, COUNT(*) n FROM work_details d JOIN works w ON w.id=d.work_id WHERE w.status='held' AND COALESCE(w.keep_back,0)=0 AND COALESCE(w.zone,'all')<>'mature' GROUP BY w.slug, w.title ORDER BY COUNT(*) DESC LIMIT 8").all();
    res.send(layout({ title: 'Frames within the frame · Watermark', path: '/details', body: `<section class="dtl-room"><p class="k">Look closer</p><h1>Frames within the frame.</h1><p class="lede">A great picture holds many pictures. These are the parts people stopped at and kept: a face, a hand, a sail on the horizon. Frame your own from any work: tap Frame on its page.</p>
${most.length ? `<p class="dtl-most">Framed most: ${most.map(m => `<a href="/w/${esc(m.slug)}">${esc(tidy(m.title))}</a> (${m.n})`).join(' · ')}</p>` : ''}
${rows.length ? `<div class="dtl-grid dtl-grid-l">${rows.map(r => `<a href="/w/${esc(r.slug)}/d/${r.n}"><img src="/img/${esc(r.slug)}/detail/${r.n}?s=thumb" alt="" loading="lazy"><span><b>${esc(tidy(r.title))}</b>${r.line ? ` · ${esc(r.line)}` : ''}</span></a>`).join('')}</div>` : '<p class="note">No frames kept yet. Be the first: open any work and tap Frame.</p>'}</section>` }));
  });

  // The file a print is made from: the original, or, for a detail, the original's own pixels inside the frame.
  app.locals.printFile = async (w, o) => {
    let r = null; try { r = o && o.lic_rights ? JSON.parse(o.lic_rights) : null; } catch (e) { r = null; }
    const d = r && r.print && r.print.detail; if (!d) return originalPath(w);
    const to = path.join(dir, `print-${w.slug}-${d.n || 0}-${w.sha256 ? w.sha256.slice(0, 8) : 'x'}.jpg`);
    if (fs.existsSync(to)) return to; fs.mkdirSync(dir, { recursive: true }); await cutFull(w, d, to + '.tmp'); fs.renameSync(to + '.tmp', to); return to;
  };
  // Who framed it: the framer's name on the detail, and their share when it sells (FRAMER_PCT of a print of their frame,
  // from the house's side, into their pocket, as a curator's is). A frame made signed out carries no name and earns nothing.
  const FRAMER_PCT = +(process.env.FRAMER_PCT || 10);
  function framer(d) {
    try {
      if (d.by_maker) { const m = db.prepare('SELECT id, name, handle, buyer_id FROM makers WHERE id=?').get(d.by_maker); if (m) return { name: m.name, href: `/m/${m.handle}`, buyer: m.buyer_id || null }; }
      if (d.by_buyer) { const b = db.prepare('SELECT id, name, code, public FROM buyers WHERE id=?').get(d.by_buyer); if (b && b.name) return { name: b.name, href: b.public && b.code ? `/g/${b.code}` : null, buyer: b.id }; if (b) return { name: null, href: null, buyer: b.id }; }
    } catch (e) { /* quiet */ }
    return null;
  }
  function reward(l, w, n) {
    const d = get(w, n); if (!d) return 0; const f = framer(d); if (!f || !f.buyer || f.buyer === l.buyer_id) return 0;
    const cents = Math.floor((l.price_cents || 0) * FRAMER_PCT / 100); if (!(cents > 0) || !app.locals.pocket) return 0;
    if (db.prepare("SELECT 1 FROM pocket WHERE kind='curation' AND ref=? AND buyer_id=?").get(l.ref, f.buyer)) return 0;
    app.locals.pocket.credit({ id: f.buyer }, cents, 'curation', l.ref, `Your frame of ${tidy(w.title)} was printed`);
    try { ledger.append(db, 'curation.earned', l.ref, { work: w.slug, via: `detail:${d.n}`, amount: cents }); } catch (e) { /* */ }
    return cents;
  }
  // Save it: an open work's detail is everyone's to keep, so the house gives it whole, credited, at 2,400 pixels,
  // better than a screenshot: no bars, no buttons, the right colour, the names in the file.
  app.get('/w/:slug/d/:n/save', async (req, res) => {
    const w = q.work.get(req.params.slug); if (!mayView(req, w)) return res.sendStatus(404);
    const d = get(w, req.params.n); if (!d) return res.sendStatus(404);
    if (!['pd', 'cc0', 'cc-by', 'cc-by-sa'].includes(w.open)) return res.redirect(`/w/${w.slug}/d/${d.n}`);
    try { const file = await cut(w, d, 2400); const name = `A detail of ${tidy(w.title)}, ${byOf(w)}.jpg`.replace(/[\/:*?"<>|]/g, ''); const ascii = name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '');
      res.set({ 'Content-Type': 'image/jpeg', 'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`, 'Cache-Control': 'public, max-age=86400' }); fs.createReadStream(file).pipe(res); }
    catch (e) { res.sendStatus(404); }
  });
  const api = { get, cut, cutFull, px, mayView, framer, reward };
  app.locals.details = api;
  return api;
}

module.exports = { mountDetails };
