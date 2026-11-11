'use strict';
// Backgrounds (Will, 2 Nov: "give people the ability to save these files as perfect backgrounds; sized for their
// iPhone, their Duo, their MacBook; the point is more ways to live with art"; and the Samsung Frame). A work made to the
// exact pixels of a screen: filled to the edge (cropped where the eye is least, by sharp's attention), or set whole on
// the dark like a print in a mat. Never stretched past what the file holds: when filling would enlarge a picture more
// than half again, it is set whole instead. The colour and the maker's name travel inside the file.
// Who may take one: anyone, for an open work (the public domain, CC0, CC BY); the holder of any licence on a maker's
// work (a Collect is a personal copy; a background is the most personal use there is); the maker and the house. Anyone
// else is shown the sizes and the way to Collect.
const SCREENS = [
  ['iphone', 'iPhone', 1320, 2868, 'Lock screen and home screen'],
  ['ipad', 'iPad', 2064, 2752, 'Upright; turns with it'],
  ['duo', 'Surface Duo, both screens', 2784, 1892, 'Open, across the hinge'],
  ['duo1', 'Surface Duo, one screen', 1344, 1892, 'Folded'],
  ['macbook', 'MacBook', 3456, 2234, 'The desktop, a 16-inch Pro; any MacBook scales it'],
  ['5k', 'Studio Display, 5K', 5120, 2880, 'The desktop, edge to edge'],
  ['frame', 'Samsung Frame, 4K', 3840, 2160, 'Art Mode: upload it in the SmartThings app'],
  ['tv', 'A television, 4K', 3840, 2160, 'Any 4K screen as a wall'],
];
const MAX_UP = 1.5;

function mountBackgrounds(app, { db, V, C, images, originalPath, buyerOf, makerOf, isStudio, ledger, cache }) {
  const { esc, tidy } = V; const sharp = require('sharp'); const path = require('path'); const fs = require('fs');
  const dir = path.join(cache, 'backgrounds'); try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* */ }
  const open = w => !!w.open && w.open !== 'cc-by-nc';
  function may(req, w) {
    if (open(w)) return true; const me = makerOf(req); if ((me && me.id === w.maker_id) || isStudio(req)) return true;
    const b = buyerOf(req); return !!(b && b.id && db.prepare("SELECT 1 FROM licenses WHERE work_id=? AND buyer_id=? AND status='active' LIMIT 1").get(w.id, b.id));
  }
  const byName = (w) => { const m = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id); const a = app.locals.art && m && m.kind === 'institution' ? app.locals.art.ofWork(w) : null; return a ? a.name : (m ? m.name : ''); };
  async function make(w, key, mode) {
    const sc = SCREENS.find(s => s[0] === key); if (!sc) throw new Error('which screen'); const [, , W, H] = sc;
    const out = path.join(dir, `${w.slug}-${key}-${mode}-${String(w.sha256 || w.id).slice(0, 10)}.jpg`); if (fs.existsSync(out)) return out;
    const src = await originalPath(w); const meta = await sharp(src).rotate().metadata(); const iw = meta.autoOrient ? meta.autoOrient.width : meta.width, ih = meta.autoOrient ? meta.autoOrient.height : meta.height;
    const cover = Math.max(W / iw, H / ih); const fill = mode === 'fill' && cover <= MAX_UP;
    const keep = images.gamut ? await images.gamut(src).catch(() => 'srgb') : 'srgb';
    let pipe;
    if (fill) pipe = sharp(src).rotate().resize(W, H, { fit: 'cover', position: sharp.strategy.attention, kernel: 'lanczos3' });
    else { const s = Math.min(W * 0.86 / iw, H * 0.86 / ih, MAX_UP); const pw = Math.round(iw * s), ph = Math.round(ih * s);
      const pic = await sharp(src).rotate().resize(pw, ph, { kernel: 'lanczos3' }).toBuffer();
      pipe = sharp({ create: { width: W, height: H, channels: 3, background: key === 'frame' ? '#f3efe7' : '#0b0a09' } }).composite([{ input: pic, left: Math.round((W - pw) / 2), top: Math.round((H - ph) / 2) }]); }
    const who = byName(w); const tmp = `${out}.${process.pid}.tmp`;
    await pipe.withIccProfile(keep === 'p3' ? 'p3' : 'srgb').withExif({ IFD0: { Artist: who, Copyright: `${tidy(w.title)}, ${who}. ${open(w) ? 'Public domain.' : 'All rights reserved; for your own screen.'} Watermark.`, ImageDescription: `${tidy(w.title)}, ${who}. A background from Watermark.` } }).jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(tmp);
    fs.renameSync(tmp, out); return out;
  }
  // (9 Nov, the evening a crawler followed every Fill · Whole · See it link of the open works: each one fetched a master
  // from the vault and cut a 4K file on the website, hundreds waiting in line, and the whole house slowed behind them.)
  // No crawler is answered; a person may take BG_PER_10MIN (12) in ten minutes; one is made at a time and at most
  // BG_WAITING (3) wait, the rest are asked to come back. A file already made is served at once, outside the line.
  const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|python|curl\/|wget|go-http|okhttp|java\/|scrapy|httpclient|monitor|uptime|render\/|pingdom|betterstack|gpt|claude|anthropic|perplexity|bytespider|ccbot|amazonbot|applebot|yandex|baidu|semrush|ahrefs|mj12|dotbot|petal/i;
  const PER = Math.max(1, Number(process.env.BG_PER_10MIN || 12)), WAITING = Math.max(0, Number(process.env.BG_WAITING || 3));
  const took = new Map(); let lane = Promise.resolve(), waiting = 0;
  const madeAlready = (w, key, mode) => { const f = path.join(dir, `${w.slug}-${key}-${mode}-${String(w.sha256 || w.id).slice(0, 10)}.jpg`); return fs.existsSync(f); };
  function gate(req, res, w, key, mode) {
    const ua = String(req.headers['user-agent'] || ''); if (!ua || BOT.test(ua)) { res.set('X-Robots-Tag', 'noindex, nofollow'); res.sendStatus(403); return false; }
    if (madeAlready(w, key, mode)) return true;
    // (11 Nov) no count by address and no turning away here: the heavy doors (heavy.js) keep crawlers out and make people wait their turn.
    return true;
  }
  const inLane = fn => { waiting++; const run = lane.then(fn, fn); lane = run.then(() => { waiting--; }, () => { waiting--; }); return run; };
  app.get('/w/:slug/background/:key', async (req, res) => {
    const w = db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(String(req.params.slug)); if (!w) return res.sendStatus(404);
    if (!may(req, w)) return res.redirect(`/w/${w.slug}#backgrounds`);
    const sc = SCREENS.find(s => s[0] === req.params.key); if (!sc) return res.sendStatus(404);
    const mode = req.query.mode === 'whole' ? 'whole' : 'fill';
    try {
      if (!gate(req, res, w, sc[0], mode)) return;
      const f = madeAlready(w, sc[0], mode) ? await make(w, sc[0], mode) : await inLane(() => make(w, sc[0], mode));
      const name = `${tidy(w.title)}, ${byName(w)} (${sc[1]}).jpg`;
      res.set('Content-Disposition', `${req.query.see ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]/g, '').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
      res.set('Cache-Control', open(w) ? 'public, max-age=86400' : 'private, no-store');
      try { ledger.append(db, 'work.background', w.slug, { screen: sc[0], mode }); } catch (e) { /* */ }
      res.type('image/jpeg').sendFile(f);
    } catch (e) { console.error('[backgrounds]', w.slug, e.message); res.sendStatus(500); }
  });
  // On the work page: the screens, the two ways, and who may take one.
  function block(w, req) {
    const ok = may(req, w); const m = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id);
    const ws = w.width || 0, hs = w.height || 0;
    if (!ok) return `<section class="bgx bgx-min" id="backgrounds"><p class="bgx-l"><b>As a background.</b> Made to the exact pixels of your phone, your Mac or your television, for those who hold it. <a href="/license/${esc(w.slug)}">Collect it</a> and every size is yours.</p></section>`; // 3 Nov: a stranger gets one line, not eight empty screens
    return `<section class="bgx" id="backgrounds"><p class="k">Live with it</p><h2>As a background.</h2><p class="bgx-l">${ok ? 'Made to the exact pixels of your screen. Filled to the edge, or set whole on the dark like a print in its mat.' : `Made to the exact pixels of your screen, for those who hold it. <a href="/license/${esc(w.slug)}">Collect it</a> and every size is yours.`}</p>
<div class="bgx-g">${SCREENS.map(([k, n, W, H, line]) => { const tight = ws && hs && Math.max(W / ws, H / hs) > MAX_UP; return `<div class="bgx-s"><span class="bgx-shape" style="aspect-ratio:${W}/${H}"></span><b>${esc(n)}</b><i>${W} × ${H}${tight ? ' · set whole: the file is smaller than the screen' : ''}</i><small>${esc(line)}</small>${ok ? `<span class="bgx-a"><a href="/w/${esc(w.slug)}/background/${k}" download rel="nofollow">Fill</a><a href="/w/${esc(w.slug)}/background/${k}?mode=whole" download rel="nofollow">Whole</a><a href="/w/${esc(w.slug)}/background/${k}?see=1" target="_blank" rel="noopener nofollow">See it</a></span>` : ''}</div>`; }).join('')}</div>
${ok ? `<p class="bgx-n">On an iPhone: open it, Share, Use as Wallpaper. On a Mac: right-click the desktop, Change Wallpaper, add the file. On the Frame: the SmartThings app, Art Mode, My Photos, add it. ${open(w) ? 'Free: the work belongs to everyone.' : `${esc(m ? m.name : 'The maker')}’s name and the copyright are written inside the file.`}</p>` : ''}</section>`;
  }
  app.locals.backgrounds = { block, make, may, SCREENS };
  return app.locals.backgrounds;
}
module.exports = { mountBackgrounds, SCREENS };
