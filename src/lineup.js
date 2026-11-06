'use strict';
// The line (Will, 2 Nov: "let's keep it coming; build something that lets us do it"). Bringing in a great collection is
// not one press but hundreds: the Met a hundred at a time, a department after a department, an artist's whole life's
// work after another's. The line is the queue in front of the feeds: line up as much as you like, from a phone, and the
// house works through it one at a time, starting the next the moment the last is done, through the same doors as any
// feed (the bag check, the governor, the register). Nothing runs while the house is being shown or the chores are held,
// and nothing runs beside another feed: one heavy job at a time is the house's rule (27 Oct).
// Kinds: 'met' (a Met Open Access search: a department, a word, highlights or all, a hundred at a time; 'keep going'
// lines up the next hundred when this one is done, so the Met keeps coming until the search runs dry), 'artist' (a name:
// the artist's page made if need be, the catalogue read from Wikidata, every open photograph brought in).
const ROLE = require('./role');

const DEPTS = [[11, 'European Paintings'], [1, 'The American Wing'], [9, 'Drawings and Prints'], [6, 'Asian Art'], [19, 'Photographs'], [21, 'Modern and Contemporary Art'], [12, 'European Sculpture and Decorative Arts'], [10, 'Egyptian Art'], [13, 'Greek and Roman Art'], [14, 'Islamic Art'], [17, 'Medieval Art'], [7, 'The Cloisters'], [15, 'The Robert Lehman Collection'], [5, 'Arts of Africa, Oceania, and the Americas'], [3, 'Ancient Near Eastern Art'], [4, 'Arms and Armor'], [8, 'The Costume Institute'], [18, 'Musical Instruments']];
// The masters: every one in the public domain everywhere (died well over seventy years ago). Drafts for Will's eye.
const MASTERS = ['Vincent van Gogh', 'Leonardo da Vinci', 'Rembrandt', 'Johannes Vermeer', 'Michelangelo', 'Raphael', 'Claude Monet', 'Paul Cézanne', 'Edgar Degas', 'J. M. W. Turner', 'Katsushika Hokusai', 'Albrecht Dürer', 'Caravaggio', 'Diego Velázquez', 'Francisco Goya', 'Pieter Bruegel the Elder', 'Titian', 'Sandro Botticelli', 'Édouard Manet', 'Pierre-Auguste Renoir', 'Georges Seurat', 'Paul Gauguin', 'John Singer Sargent', 'Winslow Homer', 'Mary Cassatt', 'Gustav Klimt', 'Jan van Eyck', 'Hieronymus Bosch', 'Peter Paul Rubens', 'Utagawa Hiroshige'];
const PER = 100;

function mountLineup(app, { db, V, studioOnly }) {
  const esc = V.esc;
  db.exec(`CREATE TABLE IF NOT EXISTS lineup (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, label TEXT, spec TEXT, status TEXT NOT NULL DEFAULT 'waiting',
    feed_id INTEGER, pos INTEGER NOT NULL DEFAULT 0, note TEXT, made_at TEXT DEFAULT (datetime('now')), started_at TEXT, done_at TEXT)`);
  const setting = k => { const r = db.prepare('SELECT v FROM settings WHERE k=?').get(k); return r ? r.v : null; };
  const put = (k, v) => db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));
  const paused = () => setting('line_paused') === '1';
  const specOf = r => { try { return JSON.parse(r.spec || '{}'); } catch (e) { return {}; } };
  const nextPos = () => ((db.prepare('SELECT MAX(pos) AS p FROM lineup').get() || {}).p || 0) + 1;

  function add(kind, label, spec) {
    return db.prepare('INSERT INTO lineup (kind, label, spec, pos) VALUES (?,?,?,?)').run(kind, String(label).slice(0, 160), JSON.stringify(spec || {}), nextPos()).lastInsertRowid;
  }
  function metLabel(s) { const d = DEPTS.find(x => x[0] === +s.dept); return `The Met · ${d ? d[1] : s.q && s.q !== '*' ? `“${s.q}”` : 'everything open'}${s.highlight ? ', highlights' : ''} · ${s.offset + 1}–${s.offset + s.n}`; }
  function addMet(s) {
    const spec = { dept: +s.dept || null, q: String(s.q || '').trim().slice(0, 80) || '*', highlight: !!s.highlight, n: Math.min(Math.max(+s.n || PER, 10), 500), offset: Math.max(0, +s.offset || 0), more: !!s.more };
    return add('met', metLabel(spec), spec);
  }
  function ngaLabel(s) { const c = (app.locals.nga ? app.locals.nga.CLASSES : []).find(x => x[0] === s.cls); return `The National Gallery of Art · ${c ? c[2] : 'everything open'} · ${s.offset + 1}–${s.offset + s.n}`; }
  function addNga(s) {
    const classes = app.locals.nga ? app.locals.nga.CLASSES.map(c => c[0]) : [];
    const spec = { cls: classes.includes(s.cls) ? s.cls : '', n: Math.min(Math.max(+s.n || PER, 10), 500), offset: Math.max(0, +s.offset || 0), more: !!s.more };
    return add('nga', ngaLabel(spec), spec);
  }
  function metUrl(s) {
    const u = new URL('https://collectionapi.metmuseum.org/public/collection/v1.1/search');
    u.searchParams.set('q', s.q || '*'); u.searchParams.set('hasImages', 'true');
    if (s.highlight) u.searchParams.set('isHighlight', 'true'); if (s.dept) u.searchParams.set('departmentId', String(s.dept));
    if (s.offset) u.searchParams.set('offset', String(s.offset)); return u.toString();
  }

  async function start(item) {
    const F = app.locals.feeds, s = specOf(item);
    if (!F) throw new Error('the feeds are not mounted');
    if (item.kind === 'met') {
      const I = app.locals.iiif; const m = s.maker ? db.prepare('SELECT * FROM makers WHERE handle=?').get(s.maker) : I && I.demoDesk ? I.demoDesk() : null;
      if (!m) throw new Error('no desk for the Met');
      return { feed: F.enqueue({ maker: m.id, url: metUrl(s), kind: 'met', open: 'cc0', show: '1', max: String(s.n), name: item.label }) };
    }
    if (item.kind === 'nga') {
      // The National Gallery of Art (6 Nov): its open access onto the public-domain shelf, a slice at a time.
      const N = app.locals.nga, A = app.locals.art; if (!N || !A || !A.shelf) throw new Error('the Gallery reader is not mounted');
      return { feed: F.enqueue({ maker: A.shelf().id, url: N.urlFor({ cls: s.cls || '', offset: s.offset || 0 }), kind: 'nga', open: 'cc0', show: '1', max: String(s.n), name: item.label }) };
    }
    if (item.kind === 'artist') {
      const A = app.locals.art, C = app.locals.catalogue; if (!A || !C) throw new Error('the hall is not mounted');
      let a = A.ensure(s.name); if (typeof a === 'number') a = db.prepare('SELECT * FROM artists WHERE id=?').get(a);
      if (a && !a.slug && a.id) a = db.prepare('SELECT * FROM artists WHERE id=?').get(a.id);
      if (!a) throw new Error('could not make the artist’s page');
      const r = await C.read(a);
      const fresh = db.prepare('SELECT * FROM artists WHERE id=?').get(a.id);
      if (!r || !r.pictures) return { done: true, note: `The catalogue: ${r ? r.n : 0} works, none with an open photograph yet.` };
      return { feed: C.bring(fresh), note: `The catalogue: ${r.n} works, ${r.pictures} with an open photograph.`, slug: fresh.slug };
    }
    throw new Error('unknown kind');
  }

  let busy = false;
  async function tick() {
    if (busy) return; busy = true;
    try {
      // What is running: is its feed done?
      const run = db.prepare("SELECT * FROM lineup WHERE status='running' ORDER BY pos LIMIT 1").get();
      if (run) {
        const f = run.feed_id ? db.prepare('SELECT status, taken, skipped, failed, looked FROM feeds WHERE id=?').get(run.feed_id) : null;
        if (f && ['queued', 'running', 'paused'].includes(f.status)) return;
        const ok = !f || f.status === 'done';
        db.prepare("UPDATE lineup SET status=?, done_at=datetime('now'), note=COALESCE(note,'') || ? WHERE id=?").run(ok ? 'done' : 'failed', f ? ` ${f.taken || 0} in, ${f.skipped || 0} already held, ${f.failed || 0} missed.` : '', run.id);
        const s = specOf(run);
        // Keep going: the next hundred, while the last hundred found anything at all.
        // The next slice takes the finished one's place in the line, so a run finishes before the next begins (paintings first means all of them).
        let next = null;
        if (run.kind === 'met' && s.more && f && (f.looked || 0) >= Math.min(s.n, 1)) next = addMet({ ...s, offset: s.offset + s.n });
        // The Gallery: the next slice while this one was full (a short slice is the end of the classification).
        if (run.kind === 'nga' && s.more && f && (f.looked || 0) >= s.n) next = addNga({ ...s, offset: s.offset + s.n });
        if (next) db.prepare('UPDATE lineup SET pos=? WHERE id=?').run(run.pos, next);
        return;
      }
      if (paused()) return;
      if (app.locals.governor && !app.locals.governor.chores()) return;
      if (db.prepare("SELECT 1 FROM feeds WHERE status IN ('queued','running')").get()) return; // one heavy job at a time
      const item = db.prepare("SELECT * FROM lineup WHERE status='waiting' ORDER BY pos, id LIMIT 1").get(); if (!item) return;
      db.prepare("UPDATE lineup SET status='running', started_at=datetime('now') WHERE id=?").run(item.id);
      try {
        const r = await start(item);
        if (r.done) db.prepare("UPDATE lineup SET status='done', done_at=datetime('now'), note=? WHERE id=?").run(r.note || null, item.id);
        else db.prepare('UPDATE lineup SET feed_id=?, note=? WHERE id=?').run(r.feed, r.note || null, item.id);
      } catch (e) { db.prepare("UPDATE lineup SET status='failed', done_at=datetime('now'), note=? WHERE id=?").run(String(e.message || e).slice(0, 300), item.id); }
    } catch (e) { console.error('[line]', e.message); } finally { busy = false; }
  }
  if (ROLE.chores && !app.locals.noTimers) { setTimeout(tick, 150000).unref(); setInterval(tick, 30000).unref(); }

  const wordOf = r => r.status === 'waiting' ? 'Waiting' : r.status === 'running' ? 'Coming in' : r.status === 'done' ? 'Done' : r.status === 'failed' ? 'Stopped' : r.status;
  function page(req) {
    const rows = db.prepare("SELECT l.*, f.taken, f.looked, f.max AS fmax, f.status AS fstatus FROM lineup l LEFT JOIN feeds f ON f.id=l.feed_id ORDER BY CASE l.status WHEN 'running' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END, CASE WHEN l.status IN ('done','failed') THEN -l.id ELSE l.pos END LIMIT 200").all();
    const waiting = rows.filter(r => r.status === 'waiting').length; const ok = req.query.ok ? `<p class="bl-ok">${esc(req.query.ok)}</p>` : '';
    const held = app.locals.governor && !app.locals.governor.chores();
    const row = r => `<li class="bl-r bl-${esc(r.status)}"><div><b>${esc(r.label)}</b><small>${wordOf(r)}${r.status === 'running' && r.feed_id ? ` · ${r.taken || 0} in of ${r.fmax || '…'}` : ''}${r.note ? ` · ${esc(r.note.trim())}` : ''}${r.feed_id ? ` · <a href="/studio/feeds/${r.feed_id}">the run</a>` : ''}</small></div>${r.status === 'waiting' ? `<form method="post" action="/studio/line/${r.id}"><button name="do" value="first" title="Next in line">Next</button><button name="do" value="remove" title="Take it out of the line">×</button></form>` : r.status === 'failed' ? `<form method="post" action="/studio/line/${r.id}"><button name="do" value="again">Again</button></form>` : ''}</li>`;
    return V.layout({ title: 'The line · Studio · Watermark', studio: true, path: '/studio/line', body: `<main class="bl"><p class="k">Bringing in</p><h1>The line.</h1>
<p class="lede">Line up as much as you like; the house brings it in one run at a time, starting the next the moment the last is done. It never runs beside another feed, and it holds while the house is being shown.</p>${ok}
<p class="bl-state">${paused() ? '<b>The line is paused.</b>' : held ? '<b>Held:</b> the house’s chores are held (being shown, or switched off).' : waiting ? `${waiting} waiting.` : 'Nothing waiting.'} <form method="post" action="/studio/line/pause" class="bl-in"><button>${paused() ? 'Run the line' : 'Pause the line'}</button></form></p>
<section class="bl-add"><h2>The Met</h2><form method="post" action="/studio/line/met"><label>Department<select name="dept"><option value="">Every department</option>${DEPTS.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('')}</select></label><label>A word (optional)<input name="q" placeholder="e.g. landscape, Vermeer, portrait"></label><label class="bl-ck"><input type="checkbox" name="highlight" value="1" checked> Highlights only</label><label class="bl-ck"><input type="checkbox" name="more" value="1" checked> Keep going, a hundred at a time, until the search runs dry</label><button class="buy-btn">Line it up</button></form>
<p class="bl-quick"><b>In one press:</b> <form method="post" action="/studio/line/met" class="bl-in"><input type="hidden" name="highlight" value="1"><input type="hidden" name="more" value="1"><button>Every Met highlight</button></form> <form method="post" action="/studio/line/met" class="bl-in"><input type="hidden" name="dept" value="11"><input type="hidden" name="more" value="1"><button>All of European Paintings</button></form> <form method="post" action="/studio/line/met" class="bl-in"><input type="hidden" name="dept" value="6"><input type="hidden" name="highlight" value="1"><input type="hidden" name="more" value="1"><button>Asian Art highlights</button></form></p></section>
<section class="bl-add"><h2>The National Gallery of Art, Washington</h2><p class="note">Every open-access image is CC0; each work comes onto the public-domain shelf credited ‘${esc(app.locals.nga ? app.locals.nga.CREDIT : '')}’. Workshop pieces and copies come in under their own attribution, never as the master’s.${app.locals.nga && app.locals.nga.job.n ? ` The index holds ${app.locals.nga.job.n.toLocaleString('en-US')} works.` : ''}</p>
<form method="post" action="/studio/line/nga"><label>Classification<select name="cls">${(app.locals.nga ? app.locals.nga.CLASSES : []).map(c => `<option value="${esc(c[0])}">${esc(c[2])}</option>`).join('')}</select></label><label class="bl-ck"><input type="checkbox" name="more" value="1" checked> Keep going, a hundred at a time, until it runs dry</label><button class="buy-btn">Line it up</button></form>
<p class="bl-quick"><b>In one press:</b> <form method="post" action="/studio/line/nga/all" class="bl-in"><button>All of it, paintings first</button></form></p></section>
<section class="bl-add"><h2>An artist’s whole work</h2><form method="post" action="/studio/line/artist"><label>Names, one a line<textarea name="names" rows="3" placeholder="Vincent van Gogh&#10;Leonardo da Vinci"></textarea></label><button class="buy-btn">Line them up</button></form>
<form method="post" action="/studio/line/masters" class="bl-in"><button>The masters, ${MASTERS.length} of them</button></form> <span class="note">${esc(MASTERS.slice(0, 6).join(' · '))} and more. Each: the page, the catalogue read, every public-domain photograph brought in.</span></section>
<section><h2>In line</h2>${rows.length ? `<ol class="bl-list">${rows.map(row).join('')}</ol>` : '<p class="note">Nothing yet.</p>'}</section></main>` });
  }
  app.get('/studio/line', studioOnly, (req, res) => res.send(page(req)));
  app.get('/studio/line.json', studioOnly, (req, res) => res.json({ paused: paused(), items: db.prepare('SELECT id, kind, label, status, feed_id, note FROM lineup ORDER BY id DESC LIMIT 200').all() }));
  const back = (res, msg) => res.redirect('/studio/line?ok=' + encodeURIComponent(msg));
  const soon = () => { if (!app.locals.noTimers) setTimeout(tick, 50); };
  app.post('/studio/line/met', studioOnly, (req, res) => { addMet(req.body || {}); soon(); back(res, 'In line: the Met.'); });
  app.post('/studio/line/nga', studioOnly, (req, res) => { addNga(req.body || {}); soon(); back(res, 'In line: the National Gallery of Art.'); });
  app.post('/studio/line/nga/all', studioOnly, (req, res) => {
    const have = new Set(db.prepare("SELECT spec FROM lineup WHERE kind='nga' AND status IN ('waiting','running')").all().map(r => specOf(r).cls));
    let n = 0; for (const [cls] of (app.locals.nga ? app.locals.nga.CLASSES : [])) if (!have.has(cls)) { addNga({ cls, more: 1 }); n++; }
    soon(); back(res, n ? `In line: the National Gallery of Art, ${n} classifications, paintings first.` : 'Already in line.');
  });
  app.post('/studio/line/artist', studioOnly, (req, res) => {
    const names = String((req.body || {}).names || '').split(/\n|;/).map(x => x.trim()).filter(Boolean).slice(0, 100);
    const have = new Set(db.prepare("SELECT spec FROM lineup WHERE kind='artist' AND status IN ('waiting','running')").all().map(r => (specOf(r).name || '').toLowerCase()));
    let n = 0; for (const name of names) if (!have.has(name.toLowerCase())) { add('artist', name, { name }); n++; }
    soon(); back(res, n ? `In line: ${n} ${n === 1 ? 'artist' : 'artists'}.` : 'Already in line.');
  });
  app.post('/studio/line/masters', studioOnly, (req, res) => {
    const have = new Set(db.prepare("SELECT spec FROM lineup WHERE kind='artist'").all().map(r => (specOf(r).name || '').toLowerCase()));
    let n = 0; for (const name of MASTERS) if (!have.has(name.toLowerCase())) { add('artist', name, { name }); n++; }
    soon(); back(res, n ? `In line: ${n} masters.` : 'The masters are already in line.');
  });
  app.post('/studio/line/pause', studioOnly, (req, res) => { put('line_paused', paused() ? '0' : '1'); soon(); back(res, paused() ? 'Paused. What is coming in finishes; nothing new starts.' : 'Running.'); });
  app.post('/studio/line/:id', studioOnly, (req, res) => {
    const r = db.prepare('SELECT * FROM lineup WHERE id=?').get(+req.params.id); if (!r) return res.sendStatus(404); const d = (req.body || {}).do;
    if (d === 'remove' && r.status === 'waiting') db.prepare('DELETE FROM lineup WHERE id=?').run(r.id);
    else if (d === 'first' && r.status === 'waiting') db.prepare('UPDATE lineup SET pos=? WHERE id=?').run(((db.prepare("SELECT MIN(pos) AS p FROM lineup WHERE status='waiting'").get() || {}).p || 1) - 1, r.id);
    else if (d === 'again' && r.status === 'failed') db.prepare("UPDATE lineup SET status='waiting', note=NULL, feed_id=NULL, pos=? WHERE id=?").run(nextPos(), r.id);
    soon(); back(res, 'Done.');
  });
  app.locals.line = { add, addMet, addNga, tick, metUrl, MASTERS, DEPTS };
  return app.locals.line;
}
module.exports = { mountLineup, MASTERS, DEPTS };
