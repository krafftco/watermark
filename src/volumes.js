'use strict';
// The volume (Will, 10 Nov: "how in the world can we start assembling these books or pages into a binder thing someone
// can flip through if multiple pages are attached … the best art history and learning resource in the world … look up
// these master drawings, study them, collect them and grow as an artist").
//
// A codex, a sketchbook, a treatise came into the house a folio at a time, each folio its own work. A volume binds them
// again: an ordered set of works with a title, an artist and a keeper, flipped through one page a screen on a phone and
// as a spread of two on a wide screen. The house proposes volumes itself by reading the records (`propose`): works of
// one artist whose titles share a stem and differ by a page or folio number, or carry the same title outright, VOL_MIN
// (6) or more, in page order (the number; a recto before its verso; else the source's own file name, read naturally).
// A person looks, renames, and opens it (Studio → Volumes). Open: the volume has its address (/volume/<slug>), stands on
// the artist's page as a bound book, answers in Find by name, and its pages after the first leave the open walls
// (`works.vol_page`, read by wall.sql), so Wander meets the book once and not three hundred folios. Every page keeps
// its own record, and from any page: Study it on the easel, its record, a note. Nothing is merged or deleted; closing
// a volume puts every page back as it was.
const VOL_MIN = Math.max(2, Number(process.env.VOL_MIN || 6));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const slugify = s => norm(s).replace(/\s+/g, '-').slice(0, 70) || 'volume';
// The trailing page mark of a title: "…, folio 12 verso", "… f. 3r", "… (page 14)", "… 194", "… 000R-12".
const TAIL = /[\s,.;:\-–—(\[]*(?:(?:fol(?:io)?|f|pp?|page|pl(?:ate)?|no?|feuillet|carta|c|sheet|leaf|tav(?:ola)?)\b\.?\s*)?(\d{1,4})\s*(recto|verso|[rv])?[\s)\]]*$/i;
function pageOf(title) {
  const t = String(title || '').trim(); const m = t.match(TAIL);
  if (!m || m.index < 6 || (/\(\s*\d{4}\s*\)\s*$/.test(t) && !m[2])) return { stem: t, n: null, side: 0 };
  const side = m[2] ? (/^v/i.test(m[2]) ? 2 : 1) : 0;
  return { stem: t.slice(0, m.index).trim(), n: Number(m[1]), side };
}
const VER = (process.env.RENDER_GIT_COMMIT || String(Date.now())).slice(0, 8);
const natural = (a, b) => String(a || '').localeCompare(String(b || ''), 'en', { numeric: true, sensitivity: 'base' });

function mountVolumes(app, { db, V, studioOnly, ledger }) {
  const { esc, tidy } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS volumes (id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, stem TEXT NOT NULL, title TEXT NOT NULL, line TEXT, artist_id INTEGER, keeper TEXT, status TEXT NOT NULL DEFAULT 'proposed', n INTEGER NOT NULL DEFAULT 0, created_at TEXT, opened_at TEXT);
    CREATE TABLE IF NOT EXISTS volume_pages (volume_id INTEGER NOT NULL, work_id INTEGER NOT NULL, pos INTEGER NOT NULL DEFAULT 0, label TEXT, PRIMARY KEY (volume_id, work_id))`);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name=?").get('vol_page')) db.exec('ALTER TABLE works ADD COLUMN vol_page INTEGER');
  // A page laid in by hand (13 Nov): when; a hidden work of the house's own is shown as a page only when it was placed so.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('volume_pages') WHERE name=?").get('placed')) db.exec('ALTER TABLE volume_pages ADD COLUMN placed TEXT');
  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
  const bySlug = s => db.prepare('SELECT * FROM volumes WHERE slug=?').get(String(s || ''));
  const byId = id => db.prepare('SELECT * FROM volumes WHERE id=?').get(Number(id) || 0);
  const artistOf = v => (v.artist_id ? db.prepare('SELECT id, slug, name, born, died FROM artists WHERE id=?').get(v.artist_id) : null);
  const pagesOf = v => db.prepare("SELECT w.id, w.slug, w.title, w.width, w.height, w.taken_at, w.medium, w.open, w.status, p.pos, p.label FROM volume_pages p JOIN works w ON w.id=p.work_id WHERE p.volume_id=? AND (w.status='held' OR (w.status='hidden' AND p.placed IS NOT NULL)) AND COALESCE(w.keep_back,0)=0 ORDER BY p.pos, w.id").all(v.id);
  const uniqueSlug = base => { let s = base, i = 2; while (bySlug(s)) s = `${base}-${i++}`; return s; };

  // The house reads one artist's records (or every artist's) and proposes what looks bound.
  function propose({ artistId = null } = {}) {
    const artists = artistId ? [{ id: Number(artistId) }] : db.prepare("SELECT artist_id id FROM works WHERE artist_id IS NOT NULL AND status='held' GROUP BY artist_id HAVING COUNT(*)>=?").all(VOL_MIN);
    let made = 0, pages = 0;
    for (const a of artists) {
      const ws = db.prepare("SELECT id, slug, title, source_url, taken_at FROM works WHERE artist_id=? AND status='held' AND COALESCE(keep_back,0)=0 ORDER BY id").all(a.id);
      const groups = new Map();
      for (const w of ws) { const p = pageOf(tidy(w.title)); const k = norm(p.stem); if (k.length < 8) continue; if (!groups.has(k)) groups.set(k, { stem: p.stem, list: [] }); groups.get(k).list.push({ w, n: p.n, side: p.side }); }
      for (const [k, g] of groups) {
        if (g.list.length < VOL_MIN) continue;
        if (db.prepare('SELECT 1 FROM volumes WHERE artist_id=? AND stem=?').get(a.id, k)) continue;
        const numbered = g.list.filter(x => x.n !== null).length >= g.list.length * 0.8;
        g.list.sort((x, y) => numbered ? ((x.n ?? 1e9) - (y.n ?? 1e9)) || (x.side - y.side) || natural(x.w.source_url, y.w.source_url) || (x.w.id - y.w.id) : natural(x.w.source_url, y.w.source_url) || (x.w.id - y.w.id));
        const title = g.stem.replace(/[\s,.;:\-–—(]+$/, '');
        const id = Number(db.prepare("INSERT INTO volumes (slug, stem, title, artist_id, status, n, created_at) VALUES (?, ?, ?, ?, 'proposed', ?, ?)").run(uniqueSlug(slugify(title)), k, title.slice(0, 200), a.id, g.list.length, now()).lastInsertRowid);
        const ins = db.prepare('INSERT INTO volume_pages (volume_id, work_id, pos, label) VALUES (?, ?, ?, ?)');
        g.list.forEach((x, i) => ins.run(id, x.w.id, i, x.n !== null ? `${x.n}${x.side === 1 ? 'r' : x.side === 2 ? 'v' : ''}` : null));
        made++; pages += g.list.length;
      }
    }
    return { made, pages };
  }
  // Open: the address answers, and the pages after the first leave the open walls. Close: every page as it was.
  function open(v) {
    const ps = db.prepare('SELECT work_id, pos FROM volume_pages WHERE volume_id=? ORDER BY pos').all(v.id);
    ps.forEach((p, i) => db.prepare('UPDATE works SET vol_page=? WHERE id=?').run(i === 0 ? 0 : v.id, p.work_id));
    db.prepare("UPDATE volumes SET status='open', opened_at=COALESCE(opened_at, ?), n=? WHERE id=?").run(now(), ps.length, v.id);
    try { ledger.append(db, 'volume.opened', v.slug, { title: v.title, pages: ps.length }); } catch (e) { /* */ }
    renew(v);
  }
  function close(v, status = 'closed') {
    db.prepare('UPDATE works SET vol_page=NULL WHERE vol_page=?').run(v.id);
    db.prepare('UPDATE volumes SET status=? WHERE id=?').run(status, v.id);
    renew(v);
  }
  function renew(v) { try { if (app.locals.findIndexDirty) app.locals.findIndexDirty(); const a = artistOf(v); if (a && app.locals.art && app.locals.art.uncache) app.locals.art.uncache(a.slug); } catch (e) { /* */ } }
  // Pages by hand (13 Nov, Will: "How can I bring the picture into the Leonardo da Vinci book"): add, take out, move.
  // Every change lays the whole order again in one transaction: pos 0..n-1 with no gaps, volumes.n the count, and for
  // an open volume works.vol_page as `open` sets it (the first page 0, the others the volume's id). A proposed, closed or
  // set-aside volume changes its pages without touching works.vol_page. The edge holds only pictures, which do not
  // change here, so it is not told (open and close do not tell it either).
  const rowsOf = v => db.prepare('SELECT work_id FROM volume_pages WHERE volume_id=? ORDER BY pos, work_id LIMIT 5000').all(v.id).map(r => r.work_id);
  function lay(v, ids) {
    const up = db.prepare('UPDATE volume_pages SET pos=? WHERE volume_id=? AND work_id=?');
    ids.forEach((id, i) => up.run(i, v.id, id));
    db.prepare('UPDATE volumes SET n=? WHERE id=?').run(ids.length, v.id);
    if (v.status === 'open') { const vp = db.prepare('UPDATE works SET vol_page=? WHERE id=?'); ids.forEach((id, i) => vp.run(i === 0 ? 0 : v.id, id)); }
  }
  // A pasted address → a work's slug: slug, /w/slug, /m/<maker>/slug, /easel/slug, /wander?at=slug, or any of these as a
  // full address of the house. Another site's address is not read.
  const HOUSE_HOST = /^(?:[a-z0-9-]+\.)*krafftco\.com$|^watermark[a-z0-9-]*\.onrender\.com$|^localhost$|^127\.0\.0\.1$/i;
  function slugFrom(s, host) {
    let t = String(s || '').trim(); if (!t) return null;
    if (/^[a-z0-9][a-z0-9-]{0,119}$/i.test(t)) return t.toLowerCase();
    let u; try { u = new URL(t, 'http://localhost'); } catch (e) { return null; }
    if (/^[a-z]+:\/\//i.test(t)) { const h = u.hostname.toLowerCase(); if (!(HOUSE_HOST.test(h) || (host && h === String(host).toLowerCase().split(':')[0]))) return { foreign: true }; }
    const seg = u.pathname.split('/').filter(Boolean).map(x => { try { return decodeURIComponent(x); } catch (e) { return x; } });
    let slug = null;
    if (seg[0] === 'wander') slug = u.searchParams.get('at');
    else if ((seg[0] === 'w' || seg[0] === 'easel') && seg[1]) slug = seg[1];
    else if (seg[0] === 'm' && seg[2]) slug = seg[2];
    return slug && /^[a-z0-9][a-z0-9-]{0,119}$/i.test(slug) ? slug.toLowerCase() : null;
  }
  // A living maker's own picture (frick.js's LIVING): not open, and its maker a person or an estate.
  const livingOf = w => { if (w.open) return false; const m = w.maker_id ? db.prepare('SELECT kind, handle FROM makers WHERE id=?').get(w.maker_id) : null; return !!m && ['maker', 'estate', 'writer'].includes(m.kind || 'maker') && m.handle !== 'the-public-domain'; };
  // Returns { ok: message, pos } or { no: message }.
  function addPage(v, { at, after = null, label = '', living = false, host = null } = {}) {
    const slug = slugFrom(at, host);
    if (slug && slug.foreign) return { no: 'That address is not the house’s.' };
    const w = slug ? db.prepare('SELECT id, slug, title, status, keep_back, open, maker_id FROM works WHERE slug=?').get(slug) : null;
    if (!w) return { no: 'No work at that address.' };
    if (w.keep_back) return { no: 'Its maker keeps that picture back.' };
    const live = livingOf(w);
    const priv = w.status === 'hidden' && app.locals.deliveries && app.locals.deliveries.guarded && app.locals.deliveries.guarded(w.id);
    if (!(w.status === 'held' || (w.status === 'hidden' && !live && !priv))) return { no: w.status === 'hidden' ? 'Its maker keeps that picture off the walls.' : 'That work is not on view and cannot be placed.' };
    if (live && !living) return { no: 'A living maker’s picture: tick the box to place it.' };
    const ids = rowsOf(v);
    if (ids.includes(w.id)) return { no: `Already page ${ids.indexOf(w.id) + 1} of this volume.` };
    const other = db.prepare("SELECT v.title FROM volume_pages p JOIN volumes v ON v.id=p.volume_id WHERE p.work_id=? AND v.status='open' AND v.id<>? LIMIT 1").get(w.id, v.id);
    if (other) return { no: `Already a page of ${tidy(other.title)}, which is open.` };
    const n = after === null || after === undefined || String(after).trim() === '' ? ids.length : Math.min(ids.length, Math.max(0, parseInt(after, 10) || 0));
    db.transaction(() => {
      db.prepare('INSERT INTO volume_pages (volume_id, work_id, pos, label, placed) VALUES (?, ?, ?, ?, ?)').run(v.id, w.id, n, String(label || '').trim().slice(0, 60) || null, now());
      ids.splice(n, 0, w.id); lay(v, ids);
    })();
    try { ledger.append(db, 'volume.page.added', v.slug, { work: w.slug, page: n + 1, living: live || undefined }); } catch (e) { /* */ }
    renew(v); return { ok: `Added as page ${n + 1}.`, pos: n };
  }
  function takeOut(v, workId) {
    const ids = rowsOf(v); const i = ids.indexOf(Number(workId)); if (i < 0) return { no: 'Not a page of this volume.' };
    const w = db.prepare('SELECT slug FROM works WHERE id=?').get(ids[i]);
    db.transaction(() => {
      db.prepare('DELETE FROM volume_pages WHERE volume_id=? AND work_id=?').run(v.id, ids[i]);
      if (v.status === 'open') db.prepare('UPDATE works SET vol_page=NULL WHERE id=?').run(ids[i]);
      ids.splice(i, 1); lay(v, ids);
    })();
    try { ledger.append(db, 'volume.page.removed', v.slug, { work: w && w.slug, page: i + 1 }); } catch (e) { /* */ }
    renew(v); return { ok: v.status === 'open' ? 'Taken out; it is back on the walls.' : 'Taken out.' };
  }
  function movePage(v, workId, d) {
    const ids = rowsOf(v); const i = ids.indexOf(Number(workId)); if (i < 0) return { no: 'Not a page of this volume.' };
    const j = i + (d < 0 ? -1 : 1); if (j < 0 || j >= ids.length) return { no: d < 0 ? 'Already the first page.' : 'Already the last page.' };
    const w = db.prepare('SELECT slug FROM works WHERE id=?').get(ids[i]);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    db.transaction(() => lay(v, ids))();
    try { ledger.append(db, 'volume.page.moved', v.slug, { work: w && w.slug, from: i + 1, to: j + 1 }); } catch (e) { /* */ }
    renew(v); return { ok: `Moved to page ${j + 1}.` };
  }
  const openOf = artistId => db.prepare("SELECT * FROM volumes WHERE status='open' AND artist_id=? ORDER BY title").all(artistId);
  const cover = v => db.prepare("SELECT w.slug FROM volume_pages p JOIN works w ON w.id=p.work_id WHERE p.volume_id=? AND w.status='held' ORDER BY p.pos LIMIT 1").get(v.id);
  const card = v => { const c = cover(v); const a = artistOf(v); return `<a class="vlm-card" href="/volume/${esc(v.slug)}">${c ? `<span class="vlm-bk"><img src="/img/${esc(c.slug)}/thumb" alt="" loading="lazy"></span>` : ''}<b>${esc(tidy(v.title))}</b><i>${a ? esc(a.name) + ' · ' : ''}${v.n.toLocaleString('en-US')} pages</i></a>`; };
  // On the artist's page: their bound volumes, standing as books.
  function strip(a) { const vs = openOf(a.id); return vs.length ? `<section class="vlm-strip" id="volumes"><h2>Bound volumes</h2><p class="vlm-sl">Notebooks, codices and treatises, page by page as they were bound.</p><div class="vlm-row">${vs.map(card).join('')}</div></section>` : ''; }
  // On a page's own record: where it is bound.
  function line(w) { if (w.vol_page === null || w.vol_page === undefined) return ''; const r = db.prepare("SELECT v.slug, v.title, v.n, p.pos FROM volume_pages p JOIN volumes v ON v.id=p.volume_id WHERE p.work_id=? AND v.status='open' LIMIT 1").get(w.id); return r ? `<p class="vlm-line"><a href="/volume/${esc(r.slug)}?p=${r.pos + 1}">Page ${r.pos + 1} of ${r.n.toLocaleString('en-US')} · ${esc(tidy(r.title))}</a><span>open the volume and turn the pages</span></p>` : ''; }

  // The volume, flipped through.
  app.get('/volume/:slug', (req, res, next) => {
    const v = bySlug(req.params.slug); if (!v) return next();
    const studio = (() => { try { return !!req.cookies.wm_s; } catch (e) { return false; } })();
    if (v.status !== 'open' && !studio) return next();
    const ps = pagesOf(v); if (!ps.length) return next();
    const a = artistOf(v); const at = Math.min(ps.length, Math.max(1, parseInt(req.query.p, 10) || 1));
    const data = ps.map(p => ({ s: p.slug, t: tidy(p.title), l: p.label || '', w: p.width || 0, h: p.height || 0 }));
    const I = require('./icons');
    const body = `<main class="vlm" data-vlm data-at="${at}">
<header class="vlm-bar"><a class="vlm-x" href="${a ? `/art/${esc(a.slug)}#volumes` : '/volumes'}" aria-label="Close">${I.close || '×'}</a><div class="vlm-tt"><b>${esc(tidy(v.title))}</b><i>${a ? `<a href="/art/${esc(a.slug)}">${esc(a.name)}</a>` : ''}${v.keeper ? ` · ${esc(v.keeper)}` : ''}</i></div><span class="vlm-n" data-vlm-n>${at} of ${ps.length}</span></header>
<div class="vlm-stage" data-vlm-stage><button class="vlm-go vlm-prev" data-vlm-prev aria-label="The page before">${I.back || '‹'}</button><div class="vlm-spread" data-vlm-spread><img class="vlm-pg vlm-l" data-vlm-l alt="" draggable="false"><img class="vlm-pg vlm-r" data-vlm-r alt="" draggable="false"></div><button class="vlm-go vlm-next" data-vlm-next aria-label="The next page">${I.next || '›'}</button></div>
<footer class="vlm-foot"><p class="vlm-cap" data-vlm-cap></p><nav class="vlm-acts"><a data-vlm-study href="#">${I.easel || ''}<span>Study</span></a><a data-vlm-rec href="#">${I.page || ''}<span>Record</span></a><button type="button" data-vlm-note>${I.pencil || ''}<span>Note</span></button><button type="button" data-send data-send-title="${esc(tidy(v.title))}" data-send-url="/volume/${esc(v.slug)}">${I.share || ''}<span>Share</span></button></nav>
<div class="vlm-thumbs" data-vlm-thumbs>${ps.map((p, i) => `<button type="button" data-vlm-t="${i + 1}" title="${esc(p.label ? `${p.label} · ` : '')}${i + 1}"><img src="/img/${esc(p.slug)}/thumb" alt="" loading="lazy" draggable="false"></button>`).join('')}</div></footer>
${v.status !== 'open' ? '<p class="vlm-draft">Proposed: only the house sees this until it is opened.</p>' : ''}
</main><script>window.__VLM=${JSON.stringify({ slug: v.slug, pages: data }).replace(/</g, '\\u003c')};</script><script src="/static/volume.js?v=${VER}" defer></script>`;
    const c = ps[0];
    res.send(V.layout({ title: `${tidy(v.title)}${a ? `, ${a.name}` : ''} · Watermark`, bare: true, path: `/volume/${v.slug}`, image: c ? `/img/${c.slug}/large?f=jpg` : null, desc: `${tidy(v.title)}${a ? ` by ${a.name}` : ''}: ${ps.length} pages, bound again and turned one at a time.`, body }));
  });
  // Every open volume.
  app.get('/volumes', (req, res) => {
    const vs = db.prepare("SELECT * FROM volumes WHERE status='open' ORDER BY opened_at DESC LIMIT 400").all();
    res.send(V.layout({ title: 'Bound volumes · Watermark', path: '/volumes', desc: 'Notebooks, codices, sketchbooks and treatises, page by page as they were bound.', body: `<main class="wrap vlm-ix"><p class="k">Look</p><h1>Bound volumes.</h1><p class="lede">Notebooks, codices, sketchbooks and treatises came into the house a page at a time. Here they are bound again: open one and turn the pages, study any page on the easel, keep a note beside it.</p>${vs.length ? `<div class="vlm-row vlm-grid">${vs.map(card).join('')}</div>` : '<p>No volume is open yet.</p>'}</main>` }));
  });

  // The Studio's desk.
  app.get('/studio/volumes', studioOnly, (req, res) => {
    const st = String(req.query.show || 'proposed'); const vs = db.prepare('SELECT * FROM volumes WHERE status=? ORDER BY n DESC, id LIMIT 300').all(['proposed', 'open', 'closed', 'dropped'].includes(st) ? st : 'proposed');
    const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM volumes GROUP BY status').all().map(r => [r.status, r.n]));
    const opened = Number(req.query.pages) || 0; const back = `show=${encodeURIComponent(st)}`;
    // The pages of one volume, opened on the desk: in order, each with its label, moved or taken out by hand; and a page added.
    const pages = v => {
      const ps = db.prepare('SELECT w.id, w.slug, w.title, w.status, w.keep_back, p.pos, p.label, p.placed FROM volume_pages p JOIN works w ON w.id=p.work_id WHERE p.volume_id=? ORDER BY p.pos, w.id LIMIT 5000').all(v.id);
      const act = (p, d, t, cls = '') => `<form method="post" action="/studio/volumes/${v.id}/pages/${p.id}/${d}?${back}"><button class="${cls || 'link'}"${(d === 'earlier' && p === ps[0]) || (d === 'later' && p === ps[ps.length - 1]) ? ' disabled' : ''}>${t}</button></form>`;
      const shown = p => (p.status === 'held' || (p.status === 'hidden' && p.placed)) && !p.keep_back;
      return `<div class="vlm-pgs" id="pages-${v.id}"><ol class="vlm-pgl">${ps.map((p, i) => `<li class="vlm-pgi"><img src="/img/${esc(p.slug)}/thumb" alt="" loading="lazy"><b>${i + 1}${p.label ? ` · ${esc(p.label)}` : ''}</b><a href="/w/${esc(p.slug)}">${esc(tidy(p.title))}</a>${shown(p) ? '' : '<small>not shown</small>'}<span class="vlm-pga">${act(p, 'earlier', 'Move earlier')}${act(p, 'later', 'Move later')}${act(p, 'out', 'Take out')}</span></li>`).join('')}</ol>
<form method="post" action="/studio/volumes/${v.id}/pages?${back}" class="vlm-add"><input name="at" required placeholder="A work’s address or its slug" aria-label="A work’s address or its slug"><input name="after" type="number" min="0" max="${ps.length}" placeholder="After page (empty: at the end)" aria-label="After page"><input name="label" maxlength="60" placeholder="Label (optional)" aria-label="Label"><label class="vlm-tick"><input type="checkbox" name="living" value="1"> This maker’s own picture, placed in the volume at the Studio’s word</label><button>Add a page</button></form></div>`;
    };
    const row = v => { const a = artistOf(v); const first = db.prepare("SELECT w.slug FROM volume_pages p JOIN works w ON w.id=p.work_id WHERE p.volume_id=? ORDER BY p.pos LIMIT 5").all(v.id); return `<article class="vlm-dk" id="v-${v.id}"><div class="vlm-dkp">${first.map(f => `<img src="/img/${esc(f.slug)}/thumb" alt="" loading="lazy">`).join('')}</div><form method="post" action="/studio/volumes/${v.id}"><input name="title" value="${esc(v.title)}" aria-label="Title"><input name="keeper" value="${esc(v.keeper || '')}" placeholder="Kept at (the library or museum)"><input name="line" value="${esc(v.line || '')}" placeholder="A line about it"><p>${a ? esc(a.name) + ' · ' : ''}${v.n} pages · <a href="/volume/${esc(v.slug)}">Look through it</a> · ${opened === v.id ? `<a href="?${back}#v-${v.id}">Close the pages</a>` : `<a href="?${back}&pages=${v.id}#pages-${v.id}">The pages</a>`}</p><p><button name="do" value="save" class="link">Save</button> ${v.status === 'open' ? '<button name="do" value="close">Close it</button>' : '<button name="do" value="open">Open it</button>'} ${v.status !== 'dropped' ? '<button name="do" value="drop" class="link">Not a volume</button>' : ''}</p></form>${opened === v.id ? pages(v) : ''}</article>`; };
    res.send(V.layout({ title: 'Volumes · Studio', studio: true, path: '/studio/volumes', body: `<main class="wrap"><h1>Volumes</h1><p class="lede">Pages that belong together, bound again. The house proposes; you look, name it, and open it.</p>${req.query.ok ? `<p class="ok">${esc(String(req.query.ok))}</p>` : ''}
<form method="post" action="/studio/volumes/propose" class="vlm-pf"><input name="artist" placeholder="An artist’s page name (leonardo-da-vinci), or leave empty for every artist"><button>Propose volumes</button></form>
<p class="vlm-tabs">${['proposed', 'open', 'closed', 'dropped'].map(s => `<a href="?show=${s}"${s === st ? ' aria-current="true"' : ''}>${s[0].toUpperCase() + s.slice(1)} <small>${counts[s] || 0}</small></a>`).join(' · ')}</p>${vs.map(row).join('') || '<p>Nothing here.</p>'}</main>` }));
  });
  app.post('/studio/volumes/propose', studioOnly, (req, res) => {
    const slug = String((req.body && req.body.artist) || '').trim(); let artistId = null;
    if (slug) { const a = db.prepare('SELECT id FROM artists WHERE slug=?').get(slug); if (!a) return res.redirect('/studio/volumes?ok=' + encodeURIComponent('No artist by that page name.')); artistId = a.id; }
    const r = propose({ artistId });
    res.redirect('/studio/volumes?ok=' + encodeURIComponent(r.made ? `${r.made} proposed, ${r.pages.toLocaleString('en-US')} pages in all.` : 'Nothing new to propose.'));
  });
  app.post('/studio/volumes/:id', studioOnly, (req, res) => {
    const v = byId(req.params.id); if (!v) return res.sendStatus(404); const b = req.body || {};
    const t = String(b.title || '').trim().slice(0, 200);
    db.prepare('UPDATE volumes SET title=?, keeper=?, line=? WHERE id=?').run(t || v.title, String(b.keeper || '').trim().slice(0, 160) || null, String(b.line || '').trim().slice(0, 300) || null, v.id);
    const nv = byId(v.id); let ok = 'Saved.';
    if (b.do === 'open') { open(nv); ok = `Open: /volume/${nv.slug}`; } else if (b.do === 'close') { close(nv); ok = 'Closed; every page is back as it was.'; } else if (b.do === 'drop') { close(nv, 'dropped'); ok = 'Set aside.'; }
    res.redirect(`/studio/volumes?show=${b.do === 'open' ? 'open' : encodeURIComponent(String(req.query.show || 'proposed'))}&ok=${encodeURIComponent(ok)}`);
  });
  // The pages by hand: every answer goes back to the desk with this volume's pages open and a plain line.
  const toPages = (res, v, r) => res.redirect(`/studio/volumes?show=${encodeURIComponent(v.status)}&pages=${v.id}&ok=${encodeURIComponent(r.ok || r.no)}#pages-${v.id}`);
  app.post('/studio/volumes/:id/pages', studioOnly, (req, res) => {
    const v = byId(req.params.id); if (!v) return res.redirect('/studio/volumes?ok=' + encodeURIComponent('No such volume.')); const b = req.body || {};
    toPages(res, v, addPage(v, { at: b.at, after: b.after, label: b.label, living: b.living === '1', host: req.get('host') }));
  });
  app.post('/studio/volumes/:id/pages/:work/:do', studioOnly, (req, res) => {
    const v = byId(req.params.id); if (!v) return res.redirect('/studio/volumes?ok=' + encodeURIComponent('No such volume.'));
    const d = req.params.do; const r = d === 'out' ? takeOut(v, req.params.work) : d === 'earlier' ? movePage(v, req.params.work, -1) : d === 'later' ? movePage(v, req.params.work, 1) : { no: 'Nothing done.' };
    toPages(res, v, r);
  });
  // Find: the open volumes by name.
  const forFind = () => db.prepare("SELECT v.slug, v.title, v.n, a.name artist, (SELECT w.slug FROM volume_pages p JOIN works w ON w.id=p.work_id WHERE p.volume_id=v.id ORDER BY p.pos LIMIT 1) cover FROM volumes v LEFT JOIN artists a ON a.id=v.artist_id WHERE v.status='open'").all();
  app.locals.volumes = { propose, open, close, strip, line, pageOf, bySlug, byId, pagesOf, forFind, addPage, takeOut, movePage, slugFrom, VOL_MIN };
  return app.locals.volumes;
}
module.exports = { mountVolumes, pageOf };
