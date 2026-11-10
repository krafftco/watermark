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
  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
  const bySlug = s => db.prepare('SELECT * FROM volumes WHERE slug=?').get(String(s || ''));
  const byId = id => db.prepare('SELECT * FROM volumes WHERE id=?').get(Number(id) || 0);
  const artistOf = v => (v.artist_id ? db.prepare('SELECT id, slug, name, born, died FROM artists WHERE id=?').get(v.artist_id) : null);
  const pagesOf = v => db.prepare("SELECT w.id, w.slug, w.title, w.width, w.height, w.taken_at, w.medium, w.open, w.status, p.pos, p.label FROM volume_pages p JOIN works w ON w.id=p.work_id WHERE p.volume_id=? AND w.status='held' AND COALESCE(w.keep_back,0)=0 ORDER BY p.pos, w.id").all(v.id);
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
    const row = v => { const a = artistOf(v); const first = db.prepare("SELECT w.slug FROM volume_pages p JOIN works w ON w.id=p.work_id WHERE p.volume_id=? ORDER BY p.pos LIMIT 5").all(v.id); return `<article class="vlm-dk"><div class="vlm-dkp">${first.map(f => `<img src="/img/${esc(f.slug)}/thumb" alt="" loading="lazy">`).join('')}</div><form method="post" action="/studio/volumes/${v.id}"><input name="title" value="${esc(v.title)}" aria-label="Title"><input name="keeper" value="${esc(v.keeper || '')}" placeholder="Kept at (the library or museum)"><input name="line" value="${esc(v.line || '')}" placeholder="A line about it"><p>${a ? esc(a.name) + ' · ' : ''}${v.n} pages · <a href="/volume/${esc(v.slug)}">Look through it</a></p><p><button name="do" value="save" class="link">Save</button> ${v.status === 'open' ? '<button name="do" value="close">Close it</button>' : '<button name="do" value="open">Open it</button>'} ${v.status !== 'dropped' ? '<button name="do" value="drop" class="link">Not a volume</button>' : ''}</p></form></article>`; };
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
  // Find: the open volumes by name.
  const forFind = () => db.prepare("SELECT v.slug, v.title, v.n, a.name artist, (SELECT w.slug FROM volume_pages p JOIN works w ON w.id=p.work_id WHERE p.volume_id=v.id ORDER BY p.pos LIMIT 1) cover FROM volumes v LEFT JOIN artists a ON a.id=v.artist_id WHERE v.status='open'").all();
  app.locals.volumes = { propose, open, close, strip, line, pageOf, bySlug, byId, pagesOf, forFind, VOL_MIN };
  return app.locals.volumes;
}
module.exports = { mountVolumes, pageOf };
