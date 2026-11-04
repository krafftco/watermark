// The notebook (Will, 4 Nov: "the like and the bravo and the save… just an intake for people's ideas"; "notes on a work";
// "a dictation feature… talk about how it makes them feel… keep that recording private or make it public"; "upload a
// finished audio file for that work"; "what have they tipped their hat to, what have they bravoed"; "everything someone
// stood in front of… and how long they looked").
//   · A note on a work: a line, said aloud (the browser's dictation writes it while you speak) or recorded as a voice, or a
//     finished recording brought in. Private by default; shared, it hangs under the work with your first name.
//   · Kept (/yours/kept): everything you have done before a work in one place: notes, voice, hats, bravos, walls, frames,
//     what you collected, and what you looked at with how long; sorted by when, by how long, by maker; found by a word.
//     It is yours alone. Nothing of it is told to anyone, and the house never sells it.
//   · What held people (/account/held): for a maker or a museum, their own works by how long people stood and came back,
//     the hats, bravos, saves and shared notes, counted, never named, and only once three people have stood before a work.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function mountNotebook(app, { db, C, V, store, buyerOf, makerOf, isStudio, ledger }) {
  const { esc, layout } = V; const I = require('./icons');
  db.exec(`CREATE TABLE IF NOT EXISTS work_notes (id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, buyer_id INTEGER NOT NULL, body TEXT,
    file TEXT, mime TEXT, seconds INTEGER, bytes INTEGER, kind TEXT NOT NULL DEFAULT 'line', public INTEGER NOT NULL DEFAULT 0,
    at TEXT NOT NULL DEFAULT (datetime('now')), removed_at TEXT)`);
  db.exec('CREATE INDEX IF NOT EXISTS work_notes_buyer ON work_notes (buyer_id, at)');
  db.exec('CREATE INDEX IF NOT EXISTS work_notes_work ON work_notes (work_id, public)');
  const MAX_MB = +(process.env.NOTE_MAX_MB || 60), MAX_S = +(process.env.NOTE_MAX_SECONDS || 1200);
  const multer = require('multer'); const dir = path.join(C.dataDir, 'incoming'); fs.mkdirSync(dir, { recursive: true });
  const upload = multer({ dest: dir, limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 }, fileFilter: (req, f, cb) => cb(null, /^(audio|video)\//.test(f.mimetype)) });
  const ext = m => (/mp4|m4a|aac/.test(m) ? 'm4a' : /ogg/.test(m) ? 'ogg' : /mpeg|mp3/.test(m) ? 'mp3' : /wav/.test(m) ? 'wav' : /flac/.test(m) ? 'flac' : 'webm');

  // Who is writing: a person with a name to the house (a collector with an email, or a maker through their gallery).
  function who(req) {
    const b = buyerOf(req); if (b && b.email) return b;
    const m = makerOf && makerOf(req);
    if (m) { if (m.buyer_id) { const mb = db.prepare('SELECT * FROM buyers WHERE id=?').get(m.buyer_id); if (mb) return mb; } if (b) return b; }
    return null;
  }
  const work = slug => db.prepare("SELECT w.*, m.name maker_name, m.handle FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.slug=? AND w.status NOT IN ('quarantined','merged')").get(String(slug || ''));
  const first = n => String(n || '').trim().split(/\s+/)[0] || 'Someone';
  const nameOf = b => first(b && (b.name || (b.email ? '' : '')) || 'Someone');
  const may = (req, n) => { if (isStudio(req)) return true; const b = who(req); if (b && b.id === n.buyer_id) return true; const m = makerOf && makerOf(req); const w = db.prepare('SELECT maker_id FROM works WHERE id=?').get(n.work_id); return !!(m && w && w.maker_id === m.id); };
  const dur = s => { s = Math.round(+s || 0); if (s < 60) return `${Math.max(1, s)} s`; if (s < 3600) return `${Math.round(s / 60)} min`; const h = Math.floor(s / 3600), mm = Math.round((s % 3600) / 60); return mm ? `${h} h ${mm} min` : `${h} h`; };

  // Keep a note: a line, a recording, or both.
  app.post('/w/:slug/note', upload.single('voice'), (req, res, next) => (req.file && app.locals.bagcheck ? app.locals.bagcheck.gate('audio', { json: true })(req, res, next) : next()), async (req, res) => {
    const drop = () => { if (req.file) fs.unlink(req.file.path, () => {}); };
    const w = work(req.params.slug); if (!w) { drop(); return res.status(404).json({ error: 'No such work.' }); }
    const b = who(req); if (!b) { drop(); return res.status(401).json({ go: `/signin?next=${encodeURIComponent(`/w/${w.slug}`)}` }); }
    const recent = db.prepare("SELECT COUNT(*) n FROM work_notes WHERE buyer_id=? AND at > datetime('now','-10 minutes')").get(b.id).n;
    if (recent >= 30) { drop(); return res.status(429).json({ error: 'A moment: that is a great many notes in ten minutes.' }); }
    const body = String(req.body.body || '').replace(/\r/g, '').trim().slice(0, 4000) || null;
    if (!body && !req.file) return res.status(400).json({ error: 'Write a line or record one.' });
    const pub = req.body.public === '1' || req.body.public === 'on' ? 1 : 0;
    if (pub && body && /https?:\/\/|www\./i.test(body)) { drop(); return res.status(400).json({ error: 'A shared note carries no links.' }); }
    let file = null, mime = null, bytes = null, seconds = null, kind = 'line';
    if (req.file) {
      mime = req.file.mimetype; bytes = req.file.size; seconds = Math.min(MAX_S, Math.round(+req.body.seconds || 0)) || null;
      kind = req.body.made === 'file' ? 'recording' : 'voice';
      file = `notes/${b.id}-${w.id}-${crypto.randomBytes(6).toString('hex')}.${ext(mime)}`;
      try { await store.put(file, req.file.path); } catch (e) { console.error('[notebook vault]', e.message); drop(); return res.status(503).json({ error: 'The vault could not take it just now. Try again.' }); }
      drop();
    }
    const id = db.prepare('INSERT INTO work_notes (work_id, buyer_id, body, file, mime, seconds, bytes, kind, public) VALUES (?,?,?,?,?,?,?,?,?)').run(w.id, b.id, body, file, mime, seconds, bytes, kind, pub).lastInsertRowid;
    try { ledger.append(db, 'note.kept', w.slug, { kind, public: !!pub }); } catch (e) { /* */ }
    if (pub && app.locals.notify) { try { app.locals.notify.tell({ maker_id: w.maker_id, kind: 'note', slug: w.slug, title: `${nameOf(b)} left a note on ${w.title}`, href: `/w/${w.slug}#kept-notes` }); } catch (e) { /* */ } }
    res.set('Cache-Control', 'private, no-store').json({ ok: true, id, public: !!pub, audio: file ? `/note/${id}/audio` : null, kept: '/yours/kept' });
  });

  app.get('/note/:id/audio', async (req, res) => {
    const n = db.prepare('SELECT * FROM work_notes WHERE id=? AND removed_at IS NULL').get(+req.params.id); if (!n || !n.file) return res.sendStatus(404);
    if (!n.public && !may(req, n)) return res.sendStatus(404);
    let buf; try { buf = await store.get(n.file); } catch (e) { buf = null; } if (!buf) return res.sendStatus(404);
    res.set({ 'Content-Type': n.mime || 'audio/webm', 'Accept-Ranges': 'bytes', 'Cache-Control': n.public ? 'public, max-age=3600' : 'private, no-store' });
    const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (r) { const a = r[1] ? +r[1] : 0, e = r[2] ? Math.min(+r[2], buf.length - 1) : buf.length - 1; if (a > e || a >= buf.length) { res.set('Content-Range', `bytes */${buf.length}`); return res.sendStatus(416); } res.status(206).set({ 'Content-Range': `bytes ${a}-${e}/${buf.length}`, 'Content-Length': e - a + 1 }); return res.end(buf.subarray(a, e + 1)); }
    res.set('Content-Length', buf.length); res.end(buf);
  });
  const back = (req, res, fallback) => (req.query.json || /json/.test(req.headers.accept || '') ? res.json({ ok: true }) : res.redirect(String(req.body.back || '').startsWith('/') ? String(req.body.back) : fallback));
  app.post('/note/:id/remove', async (req, res) => {
    const n = db.prepare('SELECT * FROM work_notes WHERE id=? AND removed_at IS NULL').get(+req.params.id); if (!n) return res.sendStatus(404); if (!may(req, n)) return res.sendStatus(403);
    db.prepare("UPDATE work_notes SET removed_at=datetime('now') WHERE id=?").run(n.id);
    if (n.file) { try { if (store.del) await store.del(n.file); } catch (e) { /* */ } }
    back(req, res, '/yours/kept?k=notes');
  });
  app.post('/note/:id/public', (req, res) => {
    const n = db.prepare('SELECT * FROM work_notes WHERE id=? AND removed_at IS NULL').get(+req.params.id); if (!n) return res.sendStatus(404);
    const b = who(req); if (!(b && b.id === n.buyer_id)) return res.sendStatus(403); // only the writer shares or keeps
    const on = req.body.on === '1' ? 1 : 0;
    if (on && n.body && /https?:\/\/|www\./i.test(n.body)) return res.status(400).json({ error: 'A shared note carries no links.' });
    db.prepare('UPDATE work_notes SET public=? WHERE id=?').run(on, n.id); back(req, res, '/yours/kept?k=notes');
  });

  // Under the work: the notes shared, and the visitor's own.
  function block(w, req) {
    const b = req ? who(req) : null;
    const rows = db.prepare(`SELECT n.*, bu.name bname FROM work_notes n JOIN buyers bu ON bu.id=n.buyer_id WHERE n.work_id=? AND n.removed_at IS NULL AND (n.public=1 OR n.buyer_id=?) ORDER BY n.at DESC LIMIT 60`).all(w.id, b ? b.id : -1);
    if (!rows.length) return '';
    const mod = req && (isStudio(req) || (makerOf && makerOf(req) && makerOf(req).id === w.maker_id));
    return `<section class="nbk-w" id="kept-notes"><h2>Notes</h2><p class="note">What people thought before it, in their words and their voices.</p><ul>${rows.map(n => {
      const mine = b && n.buyer_id === b.id;
      return `<li class="nbk-n${n.public ? '' : ' nbk-pv'}">${n.body ? `<p>${esc(n.body).replace(/\n/g, '<br>')}</p>` : ''}${n.file ? `<audio controls preload="none" src="/note/${n.id}/audio"></audio>` : ''}<span class="nbk-by">${mine ? (n.public ? 'You, shared' : 'You, kept to yourself') : esc(first(n.bname))} · ${esc(String(n.at).slice(0, 10))}${n.kind === 'recording' ? ' · a recording' : n.file ? ' · said aloud' : ''}</span>${mine || mod ? `<form method="post" action="/note/${n.id}/remove" class="inline"><input type="hidden" name="back" value="/w/${esc(w.slug)}#kept-notes"><button class="nbk-x" title="Take it down">Take down</button></form>` : ''}</li>`;
    }).join('')}</ul></section>`;
  }

  // Kept: everything you did before a work, in one place.
  const KINDS = [['all', 'All'], ['notes', 'Notes'], ['voice', 'Voice'], ['looked', 'Looked at'], ['hats', 'Hats'], ['bravos', 'Bravos'], ['saved', 'Saved'], ['frames', 'Frames'], ['collected', 'Collected']];
  function kept(b, viewer) {
    const by = new Map(); // work id → { w, marks, at, secs, visits, notes: [] }
    const touch = (r, mark, at, extra) => {
      if (!r || !r.slug) return; let e = by.get(r.wid);
      if (!e) { e = { slug: r.slug, title: r.title, maker: r.maker_name, place: r.place, marks: new Set(), at: '', secs: 0, visits: 0, notes: [] }; by.set(r.wid, e); }
      e.marks.add(mark); if (String(at || '') > e.at) e.at = String(at || ''); if (extra) extra(e);
    };
    const W = "w.id wid, w.slug, w.title, w.place, m.name maker_name FROM works w JOIN makers m ON m.id=w.maker_id";
    const OK = "w.status NOT IN ('quarantined','merged')";
    for (const n of db.prepare(`SELECT n.id nid, n.body, n.file, n.kind, n.public, n.at, n.seconds, ${W} JOIN work_notes n ON n.work_id=w.id WHERE n.buyer_id=? AND n.removed_at IS NULL AND ${OK}`).all(b.id))
      touch(n, n.file ? 'voice' : 'notes', n.at, e => { e.notes.push(n); if (n.body) e.marks.add('notes'); });
    for (const r of db.prepare(`SELECT a.at, ${W} JOIN applause a ON a.work_id=w.id WHERE a.buyer_id=? AND ${OK}`).all(b.id)) touch(r, 'hats', r.at);
    for (const r of db.prepare(`SELECT a.at, ${W} JOIN bravos a ON a.work_id=w.id WHERE a.buyer_id=? AND ${OK}`).all(b.id)) touch(r, 'bravos', r.at);
    for (const r of db.prepare(`SELECT h.created_at at, ${W} JOIN hang_works hw ON hw.work_id=w.id JOIN hangs h ON h.id=hw.hang_id WHERE h.buyer_id=? AND ${OK}`).all(b.id)) touch(r, 'saved', r.at);
    try { for (const r of db.prepare(`SELECT d.at, ${W} JOIN work_details d ON d.work_id=w.id WHERE d.by_buyer=? AND ${OK}`).all(b.id)) touch(r, 'frames', r.at); } catch (e) { /* none yet */ }
    for (const r of db.prepare(`SELECT l.created_at at, ${W} JOIN licenses l ON l.work_id=w.id WHERE l.buyer_id=? AND l.status='active' AND ${OK}`).all(b.id)) touch(r, 'collected', r.at);
    for (const r of db.prepare(`SELECT SUM(COALESCE(s.seconds,0)) secs, SUM(COALESCE(s.visits,1)) visits, MAX(COALESCE(s.last_at, s.at)) at, ${W} JOIN stood s ON s.work_id=w.id WHERE (s.buyer_id=? OR (s.viewer=? AND s.viewer<>'')) AND ${OK} GROUP BY w.id, w.slug, w.title, w.place, m.name`).all(b.id, viewer || ''))
      touch(r, 'looked', r.at, e => { e.secs += +r.secs || 0; e.visits += +r.visits || 0; });
    return [...by.values()];
  }
  const MARK = { notes: 'a note', voice: 'your voice', hats: 'a hat', bravos: 'Bravo', saved: 'on a wall', frames: 'a frame', collected: 'yours' };

  app.get('/yours/kept', (req, res) => {
    const b = who(req); if (!b) return res.redirect('/signin?next=' + encodeURIComponent('/yours/kept'));
    const k = KINDS.some(x => x[0] === req.query.k) ? req.query.k : 'all';
    const sort = ['recent', 'longest', 'maker', 'returns'].includes(req.query.sort) ? req.query.sort : (k === 'looked' ? 'longest' : 'recent');
    const all = kept(b, req.cookies && req.cookies.wm_v);
    const n = key => key === 'all' ? all.length : all.filter(e => e.marks.has(key)).length;
    let list = k === 'all' ? all : all.filter(e => e.marks.has(k));
    list.sort(sort === 'longest' ? (a, c) => c.secs - a.secs : sort === 'returns' ? (a, c) => c.visits - a.visits : sort === 'maker' ? (a, c) => String(a.maker).localeCompare(String(c.maker)) || c.at.localeCompare(a.at) : (a, c) => c.at.localeCompare(a.at));
    const secs = all.reduce((s, e) => s + e.secs, 0);
    const chip = ([key, label]) => n(key) || key === 'all' ? `<a class="nbk-c${key === k ? ' on' : ''}" href="/yours/kept${key === 'all' ? '' : `?k=${key}`}">${label}<i>${n(key)}</i></a>` : '';
    const srt = ['recent', 'longest', 'returns', 'maker'].map(s => `<a class="${s === sort ? 'on' : ''}" href="/yours/kept?${k === 'all' ? '' : `k=${k}&`}sort=${s}">${{ recent: 'Lately', longest: 'Longest looked', returns: 'Most returned to', maker: 'By maker' }[s]}</a>`).join('');
    const tile = e => {
      const q = [e.title, e.maker, e.place, ...e.notes.map(x => x.body || '')].join(' ').toLowerCase();
      return `<li class="nbk-t" data-q="${esc(q)}"><a class="nbk-i" href="/w/${esc(e.slug)}"><img src="/img/${esc(e.slug)}/thumb" alt="" loading="lazy"></a><div class="nbk-d"><a href="/w/${esc(e.slug)}"><b>${esc(e.title)}</b></a><span>${esc(e.maker || '')}${e.place ? ` · ${esc(e.place)}` : ''}</span>
<p class="nbk-m">${e.secs ? `<em title="How long you stood before it, in all">${dur(e.secs)}${e.visits > 1 ? ` · ${e.visits} visits` : ''}</em>` : ''}${[...e.marks].filter(x => MARK[x]).map(x => `<i class="nbk-k nbk-${x}">${MARK[x]}</i>`).join('')}</p>
${e.notes.map(x => `<div class="nbk-n${x.public ? '' : ' nbk-pv'}">${x.body ? `<p>${esc(x.body).replace(/\n/g, '<br>')}</p>` : ''}${x.file ? `<audio controls preload="none" src="/note/${x.nid}/audio"></audio>` : ''}<span class="nbk-by">${esc(String(x.at).slice(0, 10))} · ${x.public ? 'shared under the work' : 'yours alone'}</span><form method="post" action="/note/${x.nid}/public" class="inline"><input type="hidden" name="on" value="${x.public ? 0 : 1}"><input type="hidden" name="back" value="/yours/kept${k === 'all' ? '' : `?k=${k}`}"><button>${x.public ? 'Keep it to myself' : 'Share it'}</button></form><form method="post" action="/note/${x.nid}/remove" class="inline"><input type="hidden" name="back" value="/yours/kept${k === 'all' ? '' : `?k=${k}`}"><button>Take it out</button></form></div>`).join('')}
<button type="button" class="nbk-add" data-note="${esc(e.slug)}">${I.pencil}<span>Add a note</span></button></div></li>`;
    };
    res.set('Cache-Control', 'private, no-store').send(layout({ title: 'Kept · Watermark', path: '/yours/kept', body: `<section class="nbk">
<p class="k">You</p><h1>Kept.</h1><p class="lede">Everything you have done before a work: what you wrote and said, the hats and the bravos, the walls you put it on, the frames you cut, what you collected, and what you looked at, with how long.${secs ? ` <b>${dur(secs)}</b> in all, before ${all.filter(e => e.secs).length} works.` : ''} It is yours alone; nothing here is told to anyone.</p>
<nav class="nbk-cs">${KINDS.map(chip).join('')}</nav><div class="nbk-bar"><input type="search" placeholder="Find in what you kept" data-nbk-q aria-label="Find in what you kept"><span class="nbk-s">${srt}</span></div>
${list.length ? `<ul class="nbk-l">${list.map(tile).join('')}</ul>` : `<p class="note">Nothing here yet. <a href="/wander">Wander</a>, and press Note on anything that stops you: write a line or say it aloud.</p>`}
<p class="nbk-foot"><a href="/yours/looking">Your looking, told back</a> · <a href="/yours">You</a></p></section>
<script>(function(){var q=document.querySelector('[data-nbk-q]');if(!q)return;q.addEventListener('input',function(){var v=q.value.toLowerCase().trim();document.querySelectorAll('.nbk-t').forEach(function(t){t.hidden=v&&t.dataset.q.indexOf(v)<0})})})();</script>` }));
  });

  // What held people: a maker's or a museum's own works, by how people stood before them. Counted, never named.
  const FLOOR = +(process.env.HELD_FLOOR || 3);
  app.get('/account/held', (req, res) => {
    const m = makerOf && makerOf(req); if (!m) return res.redirect('/signin?next=/account/held');
    const span = req.query.span === 'all' ? null : (+req.query.days || 90);
    const since = span ? `AND COALESCE(s.last_at, s.at) > datetime('now','-${Math.max(1, Math.min(3650, span))} days')` : '';
    const rows = db.prepare(`SELECT w.id, w.slug, w.title, w.status, COUNT(*) people, SUM(COALESCE(s.seconds,0)) secs, SUM(CASE WHEN COALESCE(s.visits,1)>1 THEN 1 ELSE 0 END) back FROM works w JOIN stood s ON s.work_id=w.id WHERE w.maker_id=? ${since} GROUP BY w.id, w.slug, w.title, w.status`).all(m.id).filter(r => r.people >= FLOOR);
    const cnt = (t, id) => { try { return db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE work_id=?`).get(id).n; } catch (e) { return 0; } };
    for (const r of rows) { r.avg = r.secs / r.people; r.hats = cnt('applause', r.id); r.bravos = cnt('bravos', r.id); r.notes = db.prepare('SELECT COUNT(*) n FROM work_notes WHERE work_id=? AND public=1 AND removed_at IS NULL').get(r.id).n; r.saved = cnt('hang_works', r.id); r.backPct = Math.round(100 * r.back / r.people); }
    const by = req.query.by === 'people' ? 'people' : req.query.by === 'back' ? 'backPct' : 'avg';
    rows.sort((a, c) => c[by] - a[by]);
    const off = rows.filter(r => r.status !== 'held').slice(0, 12);
    const tbl = list => `<table class="tbl hld-t"><tr><th></th><th>Work</th><th>People</th><th>Each stood</th><th>Came back</th><th>Hats</th><th>Bravos</th><th>Saved</th><th>Notes</th></tr>${list.map(r => `<tr><td><img class="hld-th" src="/img/${esc(r.slug)}/thumb" alt=""></td><td><a href="/w/${esc(r.slug)}">${esc(r.title)}</a>${r.status !== 'held' ? ' <i class="hld-off">not on view</i>' : ''}</td><td>${r.people}</td><td>${dur(r.avg)}</td><td>${r.backPct}%</td><td>${r.hats}</td><td>${r.bravos}</td><td>${r.saved}</td><td>${r.notes}</td></tr>`).join('')}</table>`;
    const link = (k, v, l) => `<a class="${(req.query[k] || '') === v ? 'on' : ''}" href="/account/held?${k}=${v}${k !== 'by' && req.query.by ? `&by=${esc(req.query.by)}` : ''}${k !== 'days' && k !== 'span' && req.query.days ? `&days=${esc(req.query.days)}` : ''}">${l}</a>`;
    res.set('Cache-Control', 'private, no-store').send(layout({ title: 'What held people · Watermark', path: '/account/held', studio: true, body: `<section class="studio-wrap hld">
<p class="k">${m.kind === 'institution' ? 'The institution' : 'Your studio'}</p><h1>What held people.</h1><p class="lede">Your works by how long people stood before them and came back. What to hang next, what to bring out of the store, what to put in front. People are counted, never named, and a work shows only once ${FLOOR} people have stood before it.</p>
<p class="nbk-s">${link('by', 'avg', 'Longest each')}${link('by', 'people', 'Most people')}${link('by', 'back', 'Most returned to')} · ${link('days', '30', '30 days')}${link('days', '90', '90 days')}${link('span', 'all', 'All time')}</p>
${rows.length ? tbl(rows.slice(0, 100)) : '<p class="note">Not enough looking yet to say. It fills in as people wander.</p>'}
${off.length ? `<h2>Not on view, and holding people</h2><p class="note">Works kept back or off the walls that people stood before anyway: worth a second look.</p>${tbl(off)}` : ''}</section>` }));
  });

  const api = { block, kept, dur };
  app.locals.notebook = api;
  return api;
}

module.exports = { mountNotebook };
