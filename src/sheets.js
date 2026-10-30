// The contact sheet (30 Oct, Will: "put strong series of photos in what are called contact sheets, because I love the
// old contact sheets of the past, where you can see the artist shot a bunch of different frames and then the frame that
// was the best of all of them circled with the red outline or the white chalk"; "people can see the frames around the
// frame"; "nostalgic, old school"; "you can click into one, blow it up, navigate through each image"; "the coolest
// contact sheet you can imagine").
// A sheet is found, never made by hand: a maker's frames taken one after another in one place (no gap over
// SHEET_GAP_MIN minutes between two), at least SHEET_MIN of them, with at least one frame on view. Up to 36 frames, a
// roll, around the chosen one. The chosen frame is circled in red china marker (the maker may circle another); other
// frames on view carry a tick. Printed as a contact print: strips of film on photographic paper, the rebate black, the
// sprocket holes, the edge numbers, the maker's name and the place written on the paper in marker.
// What shows: a frame on view, always. An outtake (kept back from the walls but not held back) only once the maker has
// opened the sheet; until then, and always for a frame held back (keep_back), a child Al has read, a safety hold or a
// work for the adult rooms, the frame is a wash of its colours ("held back, kept in the archive"), never the picture.
// The maker sees every frame true. A tap opens any open frame large; arrows, a swipe or the keys walk the roll; a
// loupe rides the cursor on a computer.
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GAP = () => Number(process.env.SHEET_GAP_MIN || 30) * 60e3;
const MIN = () => Number(process.env.SHEET_MIN || 4);
const ROLL = 36;

function mountSheets(app, { db, V, images, cache, originalPath, ledger, makerOf, isStudio }) {
  for (const [c, t] of [['sheet_open', 'INTEGER NOT NULL DEFAULT 0'], ['sheet_pick', 'INTEGER NOT NULL DEFAULT 0']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name=?").get(c)) db.exec(`ALTER TABLE works ADD COLUMN ${c} ${t}`);
  const esc = V.esc, tidy = V.tidy || (s => s);
  const mslug = m => (V.makerSlug ? V.makerSlug(m) : m.handle);
  const owner = (req, m) => { const me = makerOf(req); return !!((me && me.id === m.id) || isStudio(req)); };
  const onView = w => w.status === 'held' && !w.keep_back;
  const time = s => { let t = String(s || '').replace(' ', 'T'); if (!t || /^\d{4}-\d\d-\d\d$/.test(t)) return null; if (!/(Z|[+-]\d\d:?\d\d)$/.test(t)) t += 'Z'; const d = new Date(t); return isNaN(d) ? null : d; };
  const score = w => { try { const g = JSON.parse(w.al_grade || 'null'); return g && !g.refused ? +g.score || 0 : 0; } catch (e) { return 0; } };
  const attr = w => { try { return JSON.parse(w.attribution || 'null') || {}; } catch (e) { return {}; } };
  // A frame that never shows true to anyone but the maker, whatever the sheet says.
  const guarded = w => { if (w.keep_back) return true; if (w.zone === 'mature') return true; const a = attr(w); if (a.people && a.people.minors) return true; if (a.safety && (a.safety.sexual || a.safety.nudity)) return true; return false; };

  // Runs are kept a few minutes per maker; any act of the maker's here clears them.
  const RUNS = new Map(); let HOUSE = { at: 0, sheets: [] };
  const COLS = 'id, slug, title, status, keep_back, flag, stars, curated, width, height, taken_at, place, attribution, zone, al_grade, sheet_open, sheet_pick, maker_id';
  function runsOf(makerId) {
    const k = RUNS.get(makerId); if (k && Date.now() - k.at < 180e3) return k;
    const rows = db.prepare(`SELECT ${COLS} FROM works WHERE maker_id=? AND status IN ('held','hidden') AND taken_at IS NOT NULL AND taken_at<>'' AND COALESCE(flag,'')<>'reject' AND COALESCE(disputed,0)=0`).all(makerId)
      .map(w => ({ ...w, t: time(w.taken_at) })).filter(w => w.t).sort((a, b) => (a.t - b.t) || (a.id - b.id));
    const runs = []; let cur = [];
    const samePlace = (a, b) => !a.place || !b.place || String(a.place).trim() === String(b.place).trim();
    for (const w of rows) { const p = cur[cur.length - 1]; if (p && (w.t - p.t > GAP() || !samePlace(p, w))) { runs.push(cur); cur = []; } cur.push(w); }
    if (cur.length) runs.push(cur);
    const sheets = []; const bySlug = new Map(); let roll = 0;
    for (const r of runs) {
      if (r.length < MIN() || !r.some(onView)) continue;
      const vis = r.filter(onView);
      const chosen = r.filter(w => w.sheet_pick && onView(w)).pop() || vis.slice().sort((a, b) => (b.curated - a.curated) || ((b.stars || 0) - (a.stars || 0)) || (score(b) - score(a)) || (a.id - b.id))[0];
      const at = r.indexOf(chosen); const start = r.length > ROLL ? Math.max(0, Math.min(r.length - ROLL, at - Math.floor(ROLL / 2))) : 0;
      const fr = r.slice(start, start + ROLL);
      const s = { roll: ++roll, pick: chosen, frames: fr, first: start + 1, total: r.length, open: r.some(w => w.sheet_open), place: (r.find(w => w.place) || {}).place || '', from: r[0].t, to: r[r.length - 1].t, maker_id: makerId };
      sheets.push(s); for (const w of fr) bySlug.set(w.slug, s);
    }
    const v = { at: Date.now(), sheets, bySlug }; RUNS.set(makerId, v); if (RUNS.size > 400) RUNS.delete(RUNS.keys().next().value);
    return v;
  }
  const forget = id => { RUNS.delete(id); HOUSE.at = 0; if (app.locals.wanderBaseDirty) app.locals.wanderBaseDirty(); };
  const sheetOf = w => (w && w.maker_id ? runsOf(w.maker_id).bySlug.get(w.slug) : null) || null;
  const href = s => `/sheet/${encodeURIComponent(s.pick.slug)}`;
  // What a frame is to this viewer: true (the picture), or a wash.
  const trueFor = (s, w, mine) => mine || onView(w) || (s.open && !guarded(w));
  const lineOf = s => `${s.frames.length} frame${s.frames.length === 1 ? '' : 's'}${s.total > s.frames.length ? ` of ${s.total}` : ''}`;
  // For Wander and the work page: is this frame on a sheet, and where is it.
  function of(w) { const s = sheetOf(w); return s ? { href: href(s), n: s.frames.length, line: lineOf(s) } : null; }
  function list(m) { return runsOf(m.id).sheets.slice().sort((a, b) => b.from - a.from); }
  // Every sheet of the house with an open run or three frames on view, for Wander's screen.
  function house() {
    if (Date.now() - HOUSE.at < 600e3) return HOUSE.sheets;
    const ids = db.prepare("SELECT DISTINCT w.maker_id id FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND w.taken_at IS NOT NULL AND COALESCE(m.standing,'open')<>'held'").all().map(r => r.id);
    const out = []; for (const id of ids) for (const s of runsOf(id).sheets) if (s.open || s.frames.filter(onView).length >= 2) out.push(s);
    HOUSE = { at: Date.now(), sheets: out }; return out;
  }

  // The hand-drawn loop of a china marker: a wobbling ellipse that overshoots where it began, seeded by the slug.
  function seed(x) { let h = 2166136261; for (const ch of String(x)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return () => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0; return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }
  function loop(key) {
    const r = seed(key); const a0 = -2.2 + r() * 0.8, turn = Math.PI * 2 + 0.45 + r() * 0.35; const k1 = r() * 6, k2 = r() * 6;
    const pts = []; for (let i = 0; i <= 48; i++) { const t = i / 48, a = a0 + t * turn; const wob = 1 + 0.035 * Math.sin(a * 2 + k1) + 0.025 * Math.sin(a * 3 + k2) + (t > 0.9 ? (t - 0.9) * 0.6 : 0); pts.push([50 + 53 * wob * Math.cos(a), 50 + 57 * wob * Math.sin(a)]); }
    return 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L');
  }
  const mark = (kind, key) => kind === 'pick'
    ? `<svg class="ctc-loop" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${loop(key)}" vector-effect="non-scaling-stroke"/></svg>`
    : `<svg class="ctc-tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13.5c2.2 1.4 3.6 3 4.8 5.2C10.6 12.2 14.8 6.6 21 3.4"/></svg>`;
  const fmtDay = d => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const marker = d => `${d.getUTCDate()}.${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][d.getUTCMonth()]}.${String(d.getUTCFullYear()).slice(2)}`;
  const hour = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).toLowerCase();

  function framesJSON(s, mine) {
    return s.frames.map((w, i) => { const tr = trueFor(s, w, mine); return { n: s.first + i, slug: tr ? w.slug : null, img: tr ? `/img/${w.slug}/large` : `/sheet/wash/${w.slug}`, thumb: tr ? `/img/${w.slug}/thumb` : `/sheet/wash/${w.slug}`, on: onView(w), open: tr, pick: w.id === s.pick.id, title: onView(w) ? tidy(w.title) : null, at: hour(w.t), href: onView(w) ? `/w/${w.slug}` : null, pt: (w.height || 2) > (w.width || 3), out: !onView(w), wslug: mine ? w.slug : null }; });
  }
  // The roll: strips of film on paper. Used whole on the sheet and as a nine-frame cut in Wander.
  function film(s, mine, { max = ROLL, cls = '', still = false } = {}) {
    const fr = framesJSON(s, mine); let a = 0;
    if (fr.length > max) { const at = fr.findIndex(f => f.pick); a = Math.max(0, Math.min(fr.length - max, at - Math.floor(max / 2))); }
    return `<ol class="ctc-film${cls}">${fr.slice(a, a + max).map((f, i) => `<li class="ctc-f${f.pt ? ' ctc-pt' : ''}${f.open ? '' : ' ctc-held'}${f.pick ? ' ctc-pk' : ''}" data-i="${a + i}"><span class="ctc-ed" aria-hidden="true">${(f.n % 6 === 1) ? 'WATERMARK 400' : ''}</span>${still ? `<span class="ctc-x">` : `<button type="button" class="ctc-x" data-ctc-open="${a + i}" aria-label="Frame ${f.n}${f.title ? ': ' + esc(f.title) : ''}">`}<img src="${esc(f.thumb)}" alt="" loading="lazy" decoding="async" draggable="false">${still ? '</span>' : '</button>'}${f.pick ? mark('pick', s.pick.slug) : f.on ? mark('tick') : ''}<span class="ctc-no" aria-hidden="true">${f.n}<i>▸${f.n}A</i></span></li>`).join('')}</ol>`;
  }

  // The wash of a frame's colours, never the picture: public, since it shows nothing.
  app.get('/sheet/wash/:slug', async (req, res) => {
    const w = db.prepare("SELECT * FROM works WHERE slug=? AND status IN ('held','hidden')").get(req.params.slug); if (!w) return res.sendStatus(404);
    try {
      const out = path.join(cache, `${w.slug}-sheetwash.jpg`);
      if (!fs.existsSync(out)) {
        const src = await images.derivative(await originalPath(w), cache, w.slug, 'thumb', 'jpg');
        const r = (w.width || 3) / (w.height || 2); const W = 600, H = Math.max(160, Math.round(W / r));
        const tiny = await sharp(src).resize(10, Math.max(4, Math.round(10 / r)), { fit: 'fill' }).blur(1.2).toBuffer();
        const tmp = `${out}.${process.pid}.tmp`;
        await sharp(tiny).resize(W, H, { kernel: 'cubic' }).blur(24).modulate({ brightness: 0.7, saturation: 0.75 }).jpeg({ quality: 70 }).toFile(tmp);
        try { fs.renameSync(tmp, out); } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* there */ } }
      }
      res.set('Cache-Control', 'public, max-age=86400'); res.type('image/jpeg').sendFile(out);
    } catch (e) { res.sendStatus(404); }
  });

  app.get('/sheet/:slug', (req, res) => {
    const w = db.prepare('SELECT * FROM works WHERE slug=?').get(req.params.slug); if (!w) return res.sendStatus(404);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id); if (!m) return res.sendStatus(404);
    const mine = owner(req, m); const s = sheetOf(w);
    if (!s || (!mine && w.keep_back)) return res.redirect(302, `/w/${encodeURIComponent(w.slug)}`);
    res.set('Cache-Control', mine ? 'private, no-store' : 'public, max-age=120');
    const fr = framesJSON(s, mine); const nOut = fr.filter(f => f.out).length, nWash = fr.filter(f => !f.open).length;
    const back = /^\/[a-z]/.test(String(req.query.back || '')) ? String(req.query.back) : `/w/${s.pick.slug}`;
    const day = s.from ? fmtDay(s.from) : ''; const span = s.from && s.to ? `${hour(s.from)} to ${hour(s.to)}` : '';
    const data = JSON.stringify({ frames: fr, mine, slug: s.pick.slug, maker: m.name, place: s.place, back, open: s.open }).replace(/</g, '\\u003c');
    res.send(V.layout({ title: `Contact sheet · ${tidy(s.pick.title)} · ${m.name}`, path: '/wander', bare: true, body: `<main class="ctc" data-ctc>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Permanent+Marker&display=swap">
<header class="ctc-top"><a class="ctc-back" href="${esc(back)}" aria-label="Back">←</a><span>Contact sheet</span><button type="button" class="ctc-silver-b" data-ctc-silver aria-pressed="false">Print in silver</button></header>
<div class="ctc-desk">
<article class="ctc-paper" aria-label="Contact sheet: ${esc(m.name)}${s.place ? ', ' + esc(s.place) : ''}">
<span class="ctc-tape ctc-tape-l" aria-hidden="true"></span><span class="ctc-tape ctc-tape-r" aria-hidden="true"></span>
<p class="ctc-hand">${esc(String(m.name || '').toUpperCase())}${s.place ? ` — ${esc(String(s.place).split(',')[0].toUpperCase())}` : ''}${s.from ? ` — ${marker(s.from)}` : ''}<span>ROLL ${s.roll}</span></p>
${film(s, mine)}
<p class="ctc-stamp" aria-hidden="true">WATERMARK · CONTACT</p>
<p class="ctc-foot">${esc(lineOf(s))}${day ? ` · ${esc(day)}` : ''}${span ? `, ${esc(span)}` : ''}. The circled frame is the one ${esc(String(m.name || '').split(' ')[0])} chose.${nWash ? ` <span class="ctc-gem">◆</span> ${nWash} held back by the photographer, kept in the archive.` : ''}</p>
</article>
<aside class="ctc-side"><p class="ctc-k">The frames around the frame</p><h1>${esc(tidy(s.pick.title))}</h1><p class="ctc-by"><a href="/m/${esc(mslug(m))}">${esc(m.name)}</a>${s.place ? ` · ${esc(s.place)}` : ''}</p>
<p class="ctc-say">Every frame on the roll, as it was shot. Tap any frame to blow it up; walk the roll with the arrows.</p>
<p class="ctc-acts"><a class="ctc-go" href="/w/${esc(s.pick.slug)}">The photograph</a><a class="ctc-go2" href="/wander?at=${esc(s.pick.slug)}">Wander from here</a></p>
${mine ? `<div class="ctc-own"><p>This is your sheet. ${nOut ? `${s.open ? 'Open: your outtakes show to everyone (never a frame you held back, a child, or work for the adult rooms).' : `Closed: your ${nOut} outtake${nOut === 1 ? '' : 's'} show to others as a wash of colour.`}` : 'Every frame on it is on view.'} Open a frame and tap <b>Circle this one</b> to choose another.</p>${nOut ? `<form method="post" action="/sheet/${esc(s.pick.slug)}/open" data-ctc-form><input type="hidden" name="on" value="${s.open ? 0 : 1}"><button type="submit">${s.open ? 'Close the sheet' : 'Open the sheet to everyone'}</button></form>` : ''}<a href="/account/sheets">All your contact sheets</a></div>` : ''}
</aside></div>
<div class="ctc-loupe" data-ctc-loupe hidden aria-hidden="true"><div></div></div>
<section class="ctc-v" data-ctc-v hidden aria-label="Frame"><div class="ctc-vs" data-ctc-stage><img data-ctc-img alt="" draggable="false"></div>
<header class="ctc-vt"><span data-ctc-no></span><span data-ctc-t></span><button type="button" data-ctc-close aria-label="Back to the sheet">×</button></header>
<footer class="ctc-vd"><button type="button" data-ctc-prev aria-label="Frame before">‹</button><span class="ctc-vstrip" data-ctc-strip></span><button type="button" data-ctc-next aria-label="Frame after">›</button></footer>
<p class="ctc-vact" data-ctc-act></p></section>
<script>window.__WM_SHEET=${data}</script><script src="/static/sheet.js" defer></script></main>` }));
  });

  function setOpen(s, on) { for (const w of s.frames) db.prepare('UPDATE works SET sheet_open=? WHERE id=?').run(on ? 1 : 0, w.id); }
  function guard(req, res) {
    const w = db.prepare('SELECT * FROM works WHERE slug=?').get(req.params.slug); if (!w) { res.sendStatus(404); return null; }
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id); if (!m || !owner(req, m)) { res.status(403).json({ ok: false }); return null; }
    const s = sheetOf(w); if (!s) { res.status(404).json({ ok: false, why: 'Not on a sheet.' }); return null; }
    return { w, m, s };
  }
  const answer = (req, res, j, to) => (/json/.test(req.get('accept') || '') || (req.body && req.body.json)) ? res.json(j) : res.redirect(303, to);
  app.post('/sheet/:slug/open', (req, res) => {
    const g = guard(req, res); if (!g) return; const on = !(req.body && req.body.on === '0');
    setOpen(g.s, on); forget(g.m.id);
    ledger.append(db, on ? 'sheet.opened' : 'sheet.closed', g.s.pick.slug, { maker: g.m.handle, frames: g.s.frames.length });
    answer(req, res, { ok: true, open: on }, `/sheet/${g.s.pick.slug}`);
  });
  app.post('/sheet/:slug/pick', (req, res) => {
    const g = guard(req, res); if (!g) return;
    if (!onView(g.w)) return res.status(400).json({ ok: false, why: 'Only a frame on view can be circled.' });
    const all = runsOf(g.m.id); for (const s of all.sheets) if (s === g.s) for (const w of s.frames) db.prepare('UPDATE works SET sheet_pick=0 WHERE id=?').run(w.id);
    db.prepare('UPDATE works SET sheet_pick=1 WHERE id=?').run(g.w.id); forget(g.m.id);
    answer(req, res, { ok: true, href: `/sheet/${g.w.slug}` }, `/sheet/${g.w.slug}`);
  });
  // The maker's contact sheets.
  app.get('/account/sheets', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/sheets');
    const ss = list(m); res.set('Cache-Control', 'private, no-store');
    const out = ss.filter(s => s.frames.some(w => !onView(w))).length, closed = ss.filter(s => !s.open && s.frames.some(w => !onView(w))).length;
    res.send(V.layout({ title: 'Contact sheets · Watermark', path: '/account', body: `<main class="wrap ctc-list"><p class="k">Your studio</p><h1>Contact sheets.</h1>
<p class="lede">Found from the moment of capture: frames shot one after another in one place, the one on view circled. ${ss.length} sheet${ss.length === 1 ? '' : 's'}${out ? `; ${out} with outtakes, ${closed} closed` : ''}. A closed sheet shows your outtakes to others as a wash of colour; an open one shows them true. A frame you held back, a child, or work for the adult rooms never shows.</p>
${closed ? `<form method="post" action="/account/sheets/all"><input type="hidden" name="on" value="1"><button type="submit" class="btn">Open all ${closed}</button></form>` : ''}
<ul class="ctc-ls">${ss.map(s => `<li><a href="${href(s)}"><img src="/img/${esc(s.pick.slug)}/thumb" alt="" loading="lazy"><b>${esc(tidy(s.pick.title))}</b><span>${esc(s.place || '')}${s.from ? ` · ${esc(fmtDay(s.from))}` : ''} · ${esc(lineOf(s))}${s.frames.some(w => !onView(w)) ? (s.open ? ' · open' : ' · closed') : ''}</span></a></li>`).join('') || '<li>No sheets yet: they appear when four or more frames were shot one after another in one place and one is on view.</li>'}</ul></main>` }));
  });
  app.post('/account/sheets/all', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401); const on = !(req.body && req.body.on === '0'); let n = 0;
    for (const s of list(m)) if (!!s.open !== on) { setOpen(s, on); n++; }
    forget(m.id); ledger.append(db, on ? 'sheet.opened' : 'sheet.closed', m.handle, { maker: m.handle, sheets: n, all: true });
    answer(req, res, { ok: true, n }, '/account/sheets');
  });

  // Wander's screen: a cut of nine frames from a sheet, the chosen one circled.
  function screen(seen) {
    const all = house(); if (!all.length) return null;
    for (let i = 0; i < 4; i++) {
      const s = all[Math.floor(Math.random() * all.length)]; const slug = `c:${s.pick.slug}`; if (seen.includes(slug)) continue;
      const m = db.prepare('SELECT * FROM makers WHERE id=?').get(s.maker_id); if (!m) continue;
      return { kind: 'sheet', slug, pick: s.pick.slug, title: tidy(s.pick.title), maker: m.name, place: s.place || '', day: s.from ? fmtDay(s.from) : '', n: s.frames.length, href: href(s) + '?back=' + encodeURIComponent(`/wander?at=${s.pick.slug}`), film: film(s, false, { max: 9, cls: ' ctc-cut', still: true }) };
    }
    return null;
  }
  const card = w => `<section class="st-i st-sheet" data-slug="${esc(w.slug)}" data-kind="sheet"><article class="st-sh"><a class="ctc-paper ctc-mini" href="${esc(w.href)}">${w.film}</a><p class="k">From the contact sheet</p><h2>${esc(w.title)}</h2><p class="st-shby">${esc(w.maker)}${w.place ? ` · ${esc(w.place)}` : ''}${w.day ? ` · ${esc(w.day)}` : ''}</p><a class="st-shgo" href="${esc(w.href)}">See the whole roll · ${w.n} frames</a></article></section>`;
  const STYLE = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Permanent+Marker&display=swap">';

  app.locals.sheets = { of, list, screen, card, film, runsOf, forget, STYLE };
  return app.locals.sheets;
}
module.exports = { mountSheets };
