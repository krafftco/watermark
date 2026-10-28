// The Writer's Desk (Will, 25 Oct: "an Obsidian-like text editor and document handler in writing and the studio";
// "files, documents, all of the productivity of craft"; "an Obsidian and Scrivener hybrid for humans"; "a feeling
// like they are at the writer's desk"; "encourage the art of writing"; "the next screenplay, the next American
// novel could be written here and published"; "Robert Caro-style writing: the craft, the drafting, the
// manuscripts"). Scrivener's binder and snapshots, Obsidian's plain text and [[links]], Caro's discipline:
//   a manuscript (`manuscripts`: a novel, a screenplay, an essay, a book of nonfiction, notes; a target of words)
//   holds pages in a tree (`pages`: folder | text | note | research; title, body in the house's plain form with
//   [[Title]] links; a synopsis for the corkboard; a status draft | revised | final; pos); every page keeps its
//   drafts (`drafts`: a snapshot taken by hand before a rewrite, or by the house once an hour of writing; restore
//   any); backlinks are found from the text; the day's words are counted (`writing_days`: maker, day, words) with
//   the target and the streak; Compile sets the binder in order into one text of the press (a `texts` row under
//   the maker, so the reading room, the PDF, the Library and the Bookshop take it), and Print the manuscript
//   gives the working PDF any time (double-spaced, the pages numbered, a screenplay in Courier).
//   Rooms: /account/desk (the desks), /account/desk/:id (the three panes: binder · the page · the inspector;
//   focus mode hides the panes; the corkboard is a folder's view). JSON: /account/desk/:id/pages,
//   POST .../pages (new), PUT .../pages/:pid (save), POST .../pages/:pid/snapshot, /restore/:did, /move, DELETE.
//   Nothing of a manuscript is told to anyone; nothing on the register until it is compiled and shelved.
function mountWritersDesk(app, { db, V, C, ledger, makerOf }) {
  const { esc, tidy, money } = V; const I = require('./icons');
  db.exec(`CREATE TABLE IF NOT EXISTS manuscripts (id INTEGER PRIMARY KEY, maker_id INTEGER NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'novel', line TEXT, target INTEGER, text_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS pages (id INTEGER PRIMARY KEY, manuscript_id INTEGER NOT NULL, parent_id INTEGER, pos INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'text', title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', synopsis TEXT, status TEXT NOT NULL DEFAULT 'draft', words INTEGER NOT NULL DEFAULT 0, snap_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS drafts (id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL, body TEXT NOT NULL, words INTEGER NOT NULL DEFAULT 0, note TEXT, by TEXT NOT NULL DEFAULT 'hand', at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS writing_days (maker_id INTEGER NOT NULL, day TEXT NOT NULL, words INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (maker_id, day));
    CREATE INDEX IF NOT EXISTS pages_ms ON pages (manuscript_id, parent_id, pos)`);
  const KINDS = [['novel', 'A novel'], ['nonfiction', 'Nonfiction'], ['screenplay', 'A screenplay'], ['essays', 'Essays'], ['poems', 'Poems'], ['notes', 'Notes']];
  const words = s => String(s || '').split(/\s+/).filter(Boolean).length;
  const day = () => new Date().toISOString().slice(0, 10);
  const mine = (m, id) => db.prepare('SELECT * FROM manuscripts WHERE id=? AND maker_id=?').get(Number(id), m.id);
  const pageOf = (ms, pid) => db.prepare('SELECT * FROM pages WHERE id=? AND manuscript_id=?').get(Number(pid), ms.id);
  const tree = ms => db.prepare('SELECT id, parent_id, pos, kind, title, synopsis, status, words, updated_at FROM pages WHERE manuscript_id=? ORDER BY parent_id, pos, id').all(ms.id);
  const total = ms => db.prepare("SELECT COALESCE(SUM(words),0) n FROM pages WHERE manuscript_id=? AND kind='text'").get(ms.id).n;
  // The day's words: the difference each save makes, credited to today (a cut counts against it, as Caro's would).
  function credit(m, delta) { if (!delta) return; db.prepare('INSERT INTO writing_days (maker_id, day, words) VALUES (?,?,?) ON CONFLICT(maker_id, day) DO UPDATE SET words=writing_days.words+excluded.words').run(m.id, day(), delta); }
  function days(m) {
    const rows = db.prepare('SELECT day, words FROM writing_days WHERE maker_id=? ORDER BY day DESC LIMIT 400').all(m.id);
    const today = (rows.find(r => r.day === day()) || {}).words || 0;
    let streak = 0; const d = new Date(); for (;;) { const k = d.toISOString().slice(0, 10); const r = rows.find(x => x.day === k); if (r && r.words > 0) { streak++; d.setDate(d.getDate() - 1); } else if (k === day()) { d.setDate(d.getDate() - 1); } else break; }
    return { today, streak, days: rows.slice(0, 60) };
  }
  // [[Links]]: a page's links by title; backlinks from every page of the manuscript that names it.
  const linksIn = body => [...new Set((String(body || '').match(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g) || []).map(x => x.replace(/^\[\[|\]\]$/g, '').split(/[|#]/)[0].trim()).filter(Boolean))];
  function backlinks(ms, page) { const t = page.title.toLowerCase(); return db.prepare('SELECT id, title, body FROM pages WHERE manuscript_id=? AND id<>?').all(ms.id, page.id).filter(p => linksIn(p.body).some(l => l.toLowerCase() === t)).map(p => ({ id: p.id, title: p.title })); }
  // Compile: the binder in order, folders as parts, texts as chapters, in the press's own form.
  function compile(ms) {
    const all = tree(ms); const byParent = {}; all.forEach(p => { (byParent[p.parent_id || 0] = byParent[p.parent_id || 0] || []).push(p); });
    const out = []; const walk = (pid, depth) => (byParent[pid] || []).forEach(p => { const full = db.prepare('SELECT body FROM pages WHERE id=?').get(p.id); if (p.kind === 'folder') { out.push(`${'#'.repeat(Math.min(2, depth + 1))} ${p.title}`); walk(p.id, depth + 1); } else if (p.kind === 'text') { if (depth === 0) out.push(`## ${p.title}`); else out.push(`**${p.title}**`); out.push(String(full.body || '').trim()); } });
    walk(0, 0); return out.filter(Boolean).join('\n\n');
  }
  function shelve(m, ms, { price = null, pub = 1 } = {}) {
    const body = compile(ms); if (words(body) < 50) throw new Error('A manuscript of at least a few paragraphs.');
    const kind = ms.kind === 'screenplay' ? 'document' : ms.kind === 'essays' ? 'essay' : 'book';
    let t = ms.text_id ? db.prepare('SELECT * FROM texts WHERE id=? AND maker_id=?').get(ms.text_id, m.id) : null;
    if (t) { db.prepare("UPDATE texts SET title=?, summary=?, body=?, price_cents=?, public=?, updated_at=datetime('now') WHERE id=?").run(ms.title, ms.line || null, body, price, pub, t.id); }
    else {
      const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
      let slug = slugify(ms.title) || `manuscript-${ms.id}`; if (db.prepare('SELECT 1 FROM texts WHERE slug=?').get(slug)) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
      const id = db.prepare("INSERT INTO texts (slug, kind, title, author, maker_id, year, summary, body, public, price_cents, terms, source, cover_work_id, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'held')").run(slug, kind, ms.title, m.name, m.id, String(new Date().getFullYear()), ms.line || null, body, pub, price, '© ' + m.name + '. All rights reserved.', null, null).lastInsertRowid;
      db.prepare('UPDATE manuscripts SET text_id=? WHERE id=?').run(id, ms.id); t = db.prepare('SELECT * FROM texts WHERE id=?').get(id);
      try { ledger.append(db, 'text.shelved', t.slug, { title: ms.title, kind, from: 'desk' }); } catch (e) { /* */ }
    }
    return db.prepare('SELECT * FROM texts WHERE id=?').get(t.id);
  }
  // Write, the app (Will, 26 Oct: "copy Obsidian"; a standalone app that works perfectly in Watermark; the first of
  // the house's creative tools). The manuscript is a vault of Markdown files: it leaves as one (.md in folders, the
  // Obsidian way) and comes in as one; search across it, the graph of its [[links]], a daily note, #tags, a reading
  // view, a quick switcher and a command palette on the page.
  const tagsIn = body => [...new Set((String(body || '').match(/(^|\s)#([\p{L}\p{N}_-]{2,40})/gu) || []).map(x => x.trim().slice(1).toLowerCase()))];
  const safeName = s => String(s || 'Untitled').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
  // /write: the door of the app. The last manuscript opened, else the desks; a stranger is told what it is.
  app.get('/write', (req, res) => {
    const m = makerOf(req);
    if (!m) return res.send(V.layout({ title: 'Write · Watermark', path: '/write', desc: 'The Writer’s Desk: a binder of pages, every draft kept, links between them, the manuscript yours as plain files.', body: `<section class="cx-intro wsd-door"><p class="k">Write</p><h1>The Writer’s Desk.</h1>
<p class="lede">A place to write the long thing: a novel, a screenplay, a book, the essays. A binder of pages you arrange as the book finds its shape; links between them and the map of those links; every draft kept; the day’s words counted. Your manuscript is plain Markdown files in folders, yours to take out any time and open anywhere, and to bring back. Nothing of it is shown to anyone until you shelve it through the press.</p>
<p class="hg-share"><a class="buy-btn" href="/signin?next=/write">Sign in and write</a> <a href="/makers">For those who make</a></p>
<ul class="wsd-craft"><li><b>The binder.</b> Folders are parts; pages are chapters, scenes, notes, research; drag to arrange; a folder opens as the corkboard.</li><li><b>Links.</b> <code>[[A page]]</code> links it; the inspector shows what links here; the graph shows the whole web.</li><li><b>Drafts.</b> A snapshot any time, the house’s own once an hour of writing; restore keeps the present as a draft too.</li><li><b>Reading view.</b> ⌘E sets the page as it will read: heads, emphasis, lists, quotes.</li><li><b>Find anything.</b> ⌘O opens any page by a few letters; ⌘P any act; ⌘F searches every page.</li><li><b>The daily note.</b> One page for today, in the Journal, in one tap.</li><li><b>Yours as files.</b> Export the manuscript as a folder of Markdown; import a folder of Markdown as a manuscript.</li><li><b>Print and shelve.</b> The working PDF any time; compile the binder into a book of the press.</li></ul></section>` }));
    const last = db.prepare('SELECT id FROM manuscripts WHERE maker_id=? ORDER BY updated_at DESC LIMIT 1').get(m.id);
    res.redirect(last ? `/account/desk/${last.id}` : '/account/desk');
  });
  // Search across the manuscript: every page's title and body, a snippet each.
  app.get('/account/desk/:id/search', (req, res) => {
    const m = makerOf(req); const ms = m && mine(m, req.params.id); if (!ms) return res.sendStatus(404);
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 80); if (!q) return res.json({ hits: [] });
    const hits = [];
    for (const p of db.prepare('SELECT id, title, kind, body FROM pages WHERE manuscript_id=? ORDER BY parent_id, pos, id').all(ms.id)) {
      const t = p.title.toLowerCase(), b = String(p.body || '').toLowerCase(); const i = b.indexOf(q), inT = t.indexOf(q) >= 0;
      if (!inT && i < 0) continue;
      let n = 0, j = i; while (j >= 0 && n < 50) { n++; j = b.indexOf(q, j + q.length); }
      const at = i >= 0 ? Math.max(0, i - 60) : 0; const snip = i >= 0 ? (at ? '…' : '') + String(p.body).slice(at, i + q.length + 80).replace(/\s+/g, ' ') + '…' : '';
      hits.push({ id: p.id, title: p.title, kind: p.kind, n, snippet: snip, inTitle: inT });
    }
    res.set('Cache-Control', 'private, no-store'); res.json({ hits: hits.slice(0, 60) });
  });
  // The graph: pages as nodes, [[links]] as edges (by title, case blind).
  app.get('/account/desk/:id/graph', (req, res) => {
    const m = makerOf(req); const ms = m && mine(m, req.params.id); if (!ms) return res.sendStatus(404);
    const all = db.prepare('SELECT id, title, kind, words, parent_id, body FROM pages WHERE manuscript_id=?').all(ms.id);
    const byTitle = {}; all.forEach(p => { byTitle[p.title.toLowerCase()] = p.id; });
    const edges = []; all.forEach(p => linksIn(p.body).forEach(l => { const to = byTitle[l.toLowerCase()]; if (to && to !== p.id) edges.push([p.id, to]); }));
    res.set('Cache-Control', 'private, no-store'); res.json({ nodes: all.map(p => ({ id: p.id, title: p.title, kind: p.kind, words: p.words || 0, parent: p.parent_id || 0, tags: tagsIn(p.body) })), edges });
  });
  // Today's page, in the Journal.
  app.post('/account/desk/:id/daily', (req, res) => {
    const m = makerOf(req); const ms = m && mine(m, req.params.id); if (!ms) return res.sendStatus(404);
    const title = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    let j = db.prepare("SELECT id FROM pages WHERE manuscript_id=? AND kind='folder' AND title='Journal'").get(ms.id);
    if (!j) { const pos = (db.prepare('SELECT COALESCE(MAX(pos),-1)+1 n FROM pages WHERE manuscript_id=? AND parent_id IS NULL').get(ms.id) || {}).n || 0; const id = db.prepare("INSERT INTO pages (manuscript_id, parent_id, pos, kind, title) VALUES (?,NULL,?,'folder','Journal')").run(ms.id, pos).lastInsertRowid; j = { id }; }
    let pg = db.prepare("SELECT id FROM pages WHERE manuscript_id=? AND parent_id=? AND title=?").get(ms.id, j.id, title);
    if (!pg) { const pos = (db.prepare('SELECT COALESCE(MAX(pos),-1)+1 n FROM pages WHERE manuscript_id=? AND parent_id=?').get(ms.id, j.id) || {}).n || 0; const id = db.prepare("INSERT INTO pages (manuscript_id, parent_id, pos, kind, title, body) VALUES (?,?,?,'text',?,'')").run(ms.id, j.id, pos, title).lastInsertRowid; pg = { id }; }
    db.prepare("UPDATE manuscripts SET updated_at=datetime('now') WHERE id=?").run(ms.id);
    res.json({ ok: true, id: pg.id, pages: tree(ms) });
  });
  // The manuscript as a vault of Markdown files: folders as folders, pages as .md (the Obsidian way), a README with the book's line.
  app.get('/account/desk/:id/export.zip', (req, res) => {
    const m = makerOf(req); const ms = m && mine(m, req.params.id); if (!ms) return res.sendStatus(404);
    const archiver = require('archiver'); const zip = archiver('zip', { zlib: { level: 6 } });
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${safeName(ms.title)}.zip"`, 'Cache-Control': 'private, no-store' });
    zip.pipe(res);
    const all = db.prepare('SELECT * FROM pages WHERE manuscript_id=? ORDER BY parent_id, pos, id').all(ms.id); const byId = Object.fromEntries(all.map(p => [p.id, p]));
    const dirOf = p => { const parts = []; let x = p.parent_id ? byId[p.parent_id] : null; let n = 0; while (x && n++ < 12) { parts.unshift(safeName(x.title)); x = x.parent_id ? byId[x.parent_id] : null; } return parts.join('/'); };
    const root = safeName(ms.title);
    zip.append(`# ${ms.title}\n\n${ms.line || ''}\n\nA manuscript from the Writer’s Desk on Watermark. Folders are parts; each page is a Markdown file; [[links]] name other pages by title. Open the folder as a vault in Obsidian, or bring it back to the desk.\n`, { name: `${root}/README.md` });
    const seen = {};
    all.forEach((p, i) => {
      if (p.kind === 'folder') { zip.append('', { name: `${root}/${[dirOf(p), safeName(p.title)].filter(Boolean).join('/')}/.keep` }); return; }
      let name = `${String(p.pos + 1).padStart(2, '0')} ${safeName(p.title)}`; if (seen[name]) name += ` (${p.id})`; seen[name] = 1;
      const front = `---\ntitle: ${JSON.stringify(p.title)}\nkind: ${p.kind}\nstatus: ${p.status || 'draft'}\n${p.synopsis ? `synopsis: ${JSON.stringify(p.synopsis)}\n` : ''}updated: ${p.updated_at || ''}\n---\n\n`;
      zip.append(front + (p.body || ''), { name: `${root}/${[dirOf(p), name + '.md'].filter(Boolean).join('/')}` });
    });
    zip.finalize();
  });
  // A folder of Markdown comes in as a manuscript (or into one): each .md a page, each folder a folder, front matter read.
  const multer = require('multer'); const up = multer({ dest: require('path').join(C.dataDir, 'incoming'), limits: { fileSize: 4 * 1024 * 1024, files: 400 } });
  app.post('/account/desk/import', up.array('files', 400), (req, res) => {
    const m = makerOf(req); if (!m) { (req.files || []).forEach(f => { try { require('fs').unlinkSync(f.path); } catch (e) { /* */ } }); return res.sendStatus(401); }
    const fs = require('fs'); const files = (req.files || []).filter(f => /\.(md|markdown|txt)$/i.test(f.originalname));
    const title = String((req.body || {}).title || '').trim().slice(0, 160) || 'An imported manuscript';
    let ms = (req.body || {}).into ? mine(m, req.body.into) : null;
    if (!ms) { const id = db.prepare("INSERT INTO manuscripts (maker_id, title, kind) VALUES (?,?,'notes')").run(m.id, title).lastInsertRowid; ms = mine(m, id); }
    const folders = {}; let n = 0;
    const folderFor = parts => { let parent = null, key = ''; for (const part of parts) { key += '/' + part; if (!folders[key]) { let f = db.prepare('SELECT id FROM pages WHERE manuscript_id=? AND kind=\'folder\' AND title=? AND ' + (parent ? 'parent_id=?' : 'parent_id IS NULL')).get(...(parent ? [ms.id, part, parent] : [ms.id, part])); if (!f) { const pos = (db.prepare('SELECT COALESCE(MAX(pos),-1)+1 n FROM pages WHERE manuscript_id=? AND ' + (parent ? 'parent_id=?' : 'parent_id IS NULL')).get(...(parent ? [ms.id, parent] : [ms.id])) || {}).n || 0; f = { id: db.prepare("INSERT INTO pages (manuscript_id, parent_id, pos, kind, title) VALUES (?,?,?,'folder',?)").run(ms.id, parent, pos, part).lastInsertRowid }; } folders[key] = f.id; } parent = folders[key]; } return parent; };
    for (const f of files) {
      let text = ''; try { text = fs.readFileSync(f.path, 'utf8'); } catch (e) { continue; } finally { try { fs.unlinkSync(f.path); } catch (e) { /* */ } }
      // The path inside the vault comes as a field beside each file (the client sends webkitRelativePath as paths[]); else the name alone.
      const paths = [].concat((req.body || {}).paths || []); const full = String(paths[files.indexOf(f)] || f.originalname).replace(/\\/g, '/');
      const parts = full.split('/').filter(Boolean); const fname = parts.pop() || 'Untitled.md';
      const dirs = parts.length > 1 ? parts.slice(1) : parts.length === 1 && paths.length ? [] : parts; // the vault's own root folder is dropped
      if (/^readme\.md$/i.test(fname) || /^\./.test(fname)) continue;
      let body = text, ttl = fname.replace(/\.(md|markdown|txt)$/i, '').replace(/^\d+\s+/, ''), status = 'draft', synopsis = null;
      const fm = /^---\n([\s\S]*?)\n---\n\n?/.exec(text);
      if (fm) { body = text.slice(fm[0].length); const g = k => { const mm = new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(fm[1]); if (!mm) return null; try { return JSON.parse(mm[1]); } catch (e) { return mm[1].trim(); } }; ttl = g('title') || ttl; status = g('status') || status; synopsis = g('synopsis'); }
      const parent = dirs.length ? folderFor(dirs) : null;
      const pos = (db.prepare('SELECT COALESCE(MAX(pos),-1)+1 n FROM pages WHERE manuscript_id=? AND ' + (parent ? 'parent_id=?' : 'parent_id IS NULL')).get(...(parent ? [ms.id, parent] : [ms.id])) || {}).n || 0;
      db.prepare("INSERT INTO pages (manuscript_id, parent_id, pos, kind, title, body, synopsis, status, words) VALUES (?,?,?,'text',?,?,?,?,?)").run(ms.id, parent, pos, String(ttl).slice(0, 200), body, synopsis, ['draft', 'revised', 'final'].includes(status) ? status : 'draft', words(body)); n++;
    }
    db.prepare("UPDATE manuscripts SET updated_at=datetime('now') WHERE id=?").run(ms.id);
    res.redirect(`/account/desk/${ms.id}?ok=${encodeURIComponent(`${n} page${n === 1 ? '' : 's'} brought in.`)}`);
  });
  // Tags of a page, for the inspector.
  app.locals.writersdesk = { tagsIn, linksIn };
  // The desks.
  app.get('/account/desk', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/desk'); V.setDeskPath && V.setDeskPath('/account/desk');
    const list = db.prepare('SELECT * FROM manuscripts WHERE maker_id=? ORDER BY updated_at DESC').all(m.id).map(ms => ({ ...ms, words: total(ms), pages: db.prepare("SELECT COUNT(*) n FROM pages WHERE manuscript_id=? AND kind='text'").get(ms.id).n }));
    const D = days(m);
    res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: 'The Writer’s Desk · Your studio', studio: true, body: `<section class="studio-wrap wsd"><p class="k">Your studio</p><h1>The Writer’s Desk.</h1>
<p class="wsd-ep">Jefferson drafted the Declaration on a lap desk of his own design, a plain mahogany box with a hinged board that went with him in a coach. Franklin taught himself to write by taking the <i>Spectator</i> apart and putting it back together from his own notes, a sentence at a time, until his came out better. A desk, a method, the day’s pages: that is all either of them had, and it is what this is.</p>
<p class="lede">A place to write the long thing: a novel, a screenplay, a book of nonfiction, the essays. A binder of pages you move as you like, plain text with links between them, every draft kept so a rewrite is never a loss, the day’s words counted, and when it is done, one press sets it into the reading room, a printed book and the Library, under your name.</p>
<div class="wsd-today"><b>${D.today.toLocaleString('en-US')}</b> words today${D.streak > 1 ? ` · <b>${D.streak}</b> days running` : ''}${D.days.length ? ` · ${D.days.reduce((n, d) => n + d.words, 0).toLocaleString('en-US')} in the last ${Math.min(60, D.days.length)} day${D.days.length === 1 ? '' : 's'}` : ''}</div>
${req.query.ok ? `<p class="ok">${esc(String(req.query.ok))}</p>` : ''}
<script>document.addEventListener('submit',function(e){var f=e.target;if(!f.matches('[data-wsd-import]'))return;var inp=f.querySelector('input[type=file]');if(!inp.files.length)return;e.preventDefault();var fd=new FormData();fd.append('title',f.querySelector('[name=title]').value||'');for(var i=0;i<inp.files.length;i++){var x=inp.files[i];if(!/\\.(md|markdown|txt)$/i.test(x.name))continue;fd.append('paths',x.webkitRelativePath||x.name);fd.append('files',x,x.name);}f.querySelector('button').disabled=true;fetch(f.action,{method:'POST',body:fd,credentials:'same-origin'}).then(function(r){location.href=r.url;}).catch(function(){f.querySelector('button').disabled=false;});});</script><form method="post" action="/account/desk/import" enctype="multipart/form-data" class="wsd-imp" data-wsd-import><label><span>Bring a folder of Markdown in (an Obsidian vault, a Scrivener export as text)</span><input type="file" name="files" multiple webkitdirectory accept=".md,.markdown,.txt"></label><input name="title" placeholder="Its title" maxlength="160"><button class="link">Bring it in</button></form>
<form method="post" action="/account/desk" class="wsd-new"><input name="title" placeholder="A title, even a working one" required maxlength="160"><select name="kind">${KINDS.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><input name="target" inputmode="numeric" placeholder="Words, if you have a number" style="width:12em"><button class="buy-btn">Open a manuscript</button></form>
${list.length ? `<div class="wsd-list">${list.map(ms => `<a class="wsd-ms" href="/account/desk/${ms.id}"><span class="k">${esc((KINDS.find(k => k[0] === ms.kind) || [])[1] || ms.kind)}</span><b>${esc(ms.title)}</b><small>${ms.words.toLocaleString('en-US')} words${ms.target ? ` of ${(+ms.target).toLocaleString('en-US')}` : ''} · ${ms.pages} page${ms.pages === 1 ? '' : 's'} · ${V.date(ms.updated_at)}${ms.text_id ? ' · shelved' : ''}</small>${ms.target ? `<i class="wsd-prog"><i style="width:${Math.min(100, Math.round(100 * ms.words / ms.target))}%"></i></i>` : ''}</a>`).join('')}</div>` : '<p class="note">No manuscript yet. Caro wrote the first draft of every book longhand and typed it three times. Yours can begin with a title.</p>'}
<h2>The craft, as the house keeps it</h2><ul class="wsd-craft"><li><b>The binder.</b> Folders are parts; pages are chapters, scenes, notes, research. Move them as the book finds its shape. A folder opens as a corkboard of cards, each with its synopsis.</li><li><b>Plain text.</b> Paragraphs with a blank line between; <code>*italic*</code> and <code>**bold**</code>; <code>[[The name of a page]]</code> links to it, and the page knows who names it.</li><li><b>Drafts.</b> Take a snapshot before a rewrite; the house takes one on its own after an hour of writing. Every draft is kept, any can be restored, none is lost.</li><li><b>The day’s words.</b> Counted on every save, against your target, with the days running. A thousand a day is a book in a season.</li><li><b>Compile and print.</b> The binder in order becomes one text: the reading room, a PDF set as a book (a screenplay in Courier), the Library and the Bookshop at your price, published by the house under your name.</li></ul>
<p class="ky-foot"><a href="/account/writing">Your writing on the shelf</a> · <a href="/press">The printing house</a> · <a href="/read/the-autobiography-of-benjamin-franklin">Franklin on method</a></p></section>` }));
  });
  app.post('/account/desk', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401); const b = req.body || {};
    const title = String(b.title || '').trim().slice(0, 160); if (!title) return res.redirect('/account/desk?ok=' + encodeURIComponent('A title.'));
    const kind = KINDS.some(k => k[0] === b.kind) ? b.kind : 'novel'; const target = parseInt(b.target, 10) > 0 ? parseInt(b.target, 10) : null;
    const id = db.prepare('INSERT INTO manuscripts (maker_id, title, kind, target) VALUES (?,?,?,?)').run(m.id, title, kind, target).lastInsertRowid;
    const first = kind === 'screenplay' ? ['FADE IN:', 'Act One'] : kind === 'notes' ? ['A first note', null] : ['Chapter One', null];
    db.prepare("INSERT INTO pages (manuscript_id, parent_id, pos, kind, title, body) VALUES (?,?,?,?,?,?)").run(id, null, 0, 'text', first[0], '');
    db.prepare("INSERT INTO pages (manuscript_id, parent_id, pos, kind, title, body) VALUES (?,?,?,?,?,?)").run(id, null, 1, 'folder', 'Research', '');
    db.prepare("INSERT INTO pages (manuscript_id, parent_id, pos, kind, title, body) VALUES (?,?,?,?,?,?)").run(id, null, 2, 'note', 'Notes to myself', '');
    res.redirect(`/account/desk/${id}`);
  });
  // The manuscript, printed: the working copy as a PDF, double-spaced, pages numbered; a screenplay in Courier.
  app.get('/account/desk/:id.pdf', (req, res) => {
    const m = makerOf(req); const ms = m && mine(m, req.params.id); if (!ms) return res.sendStatus(404);
    const PDFDocument = require('pdfkit'); const body = compile(ms); const script = ms.kind === 'screenplay';
    const W = 612, H = 792, M = { top: 72, bottom: 72, left: 90, right: 72 };
    const doc = new PDFDocument({ size: [W, H], margins: M, info: { Title: ms.title, Author: m.name }, autoFirstPage: false, bufferPages: true });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${ms.title.replace(/[^\x20-\x7e]/g, '')} (manuscript).pdf"`, 'Cache-Control': 'private, no-store' }); doc.pipe(res);
    doc.addPage(); doc.font(script ? 'Courier' : 'Times-Roman').fontSize(script ? 12 : 24).text(ms.title, M.left, 260, { align: 'center', width: W - M.left - M.right }); doc.moveDown(); doc.fontSize(12).text(`${m.name}`, { align: 'center' }); doc.moveDown(2); doc.fontSize(10).fillColor('#666').text(`A manuscript · ${words(body).toLocaleString('en-US')} words · ${V.date(new Date().toISOString())}`, { align: 'center' });
    const paras = body.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean); doc.addPage(); doc.fillColor('#111');
    for (const p of paras) {
      if (/^#\s/.test(p)) { doc.addPage(); doc.font(script ? 'Courier-Bold' : 'Times-Bold').fontSize(script ? 12 : 16).text(p.replace(/^#\s*/, '').toUpperCase(), { align: 'center' }); doc.moveDown(2); continue; }
      if (/^##\s/.test(p)) { if (doc.y > H - M.bottom - 200) doc.addPage(); doc.moveDown(1); doc.font(script ? 'Courier-Bold' : 'Times-Bold').fontSize(script ? 12 : 14).text(p.replace(/^##\s*/, ''), { align: script ? 'left' : 'center' }); doc.moveDown(1.5); continue; }
      const txt = p.replace(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
      doc.font(script ? 'Courier' : 'Times-Roman').fontSize(12).lineGap(script ? 2 : 12).text(txt, { align: 'left', indent: script ? 0 : 36, paragraphGap: script ? 12 : 0 });
    }
    const range = doc.bufferedPageRange(); for (let i = 1; i < range.count; i++) { doc.switchToPage(i); doc.font(script ? 'Courier' : 'Times-Roman').fontSize(9).fillColor('#888').text(`${m.name.split(' ').pop()} / ${ms.title.toUpperCase().slice(0, 40)} / ${i}`, M.left, M.top - 40, { width: W - M.left - M.right, align: 'right', lineBreak: false }); }
    doc.end();
  });
  // The desk itself: three panes, the page in the middle.
  app.get('/account/desk/:id', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/desk'); const ms = mine(m, req.params.id); if (!ms) return res.sendStatus(404);
    V.setDeskPath && V.setDeskPath('/account/desk');
    const D = days(m); const t = ms.text_id ? db.prepare('SELECT slug, public, price_cents FROM texts WHERE id=?').get(ms.text_id) : null;
    const LINES = ['Either write something worth reading or do something worth writing. — Franklin, 1738', 'I cannot live without books. — Jefferson, 1815', 'Determine never to be idle. No person will have occasion to complain of the want of time who never loses any. — Jefferson, 1787', 'Write with the learned, pronounce with the vulgar. — Franklin, 1738', 'Nothing gives an author so much pleasure as to find his works respectfully quoted by other learned authors. — Franklin, 1758', 'Nothing can stop the man with the right mental attitude from achieving his goal; nothing on earth can help the man with the wrong mental attitude. — Jefferson, attributed'].filter(l => !/attributed/.test(l));
    const data = { line0: LINES[Math.floor(Math.random() * LINES.length)], id: ms.id, title: ms.title, kind: ms.kind, line: ms.line || '', target: ms.target || 0, words: total(ms), pages: tree(ms), today: D.today, streak: D.streak, text: t, kinds: KINDS };
    res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: `${ms.title} · The Writer’s Desk`, studio: true, body: `<main class="wsd-room" data-wsd data-id="${ms.id}">
<header class="wsd-top"><a class="wsd-back" href="/account/desk" title="The desks">${I.back}</a><div class="wsd-tt"><input class="wsd-title" data-wsd-title value="${esc(ms.title)}" maxlength="160" aria-label="Title"><span class="wsd-kind">${esc((KINDS.find(k => k[0] === ms.kind) || [])[1] || ms.kind)}</span></div>
<div class="wsd-counts"><span data-wsd-today><b>${D.today.toLocaleString('en-US')}</b> today</span><span data-wsd-total><b>${total(ms).toLocaleString('en-US')}</b>${ms.target ? ` of ${(+ms.target).toLocaleString('en-US')}` : ''}</span>${D.streak > 1 ? `<span><b>${D.streak}</b> days</span>` : ''}</div>
<div class="wsd-acts"><button type="button" data-wsd-open title="Open any page by a few letters (⌘O)">Open</button><button type="button" data-wsd-search title="Search every page (⌘F)">Search</button><button type="button" data-wsd-read title="Reading view: the page as it will read (⌘E)" aria-pressed="false">Read</button><button type="button" data-wsd-graph title="The graph: every page and the links between them (⌘G)">Graph</button><button type="button" data-wsd-daily title="Today’s page, in the Journal (⌘D)">Today</button><button type="button" data-wsd-focus title="Focus: the page alone (⌘⇧F)">Focus</button><button type="button" data-wsd-print title="The manuscript as a PDF, set as a book">Print</button><a class="wsd-exp" href="/account/desk/${ms.id}/export.zip" title="The manuscript as a folder of Markdown: open it in Obsidian, keep it anywhere">Export</a><button type="button" data-wsd-palette title="Every act by name (⌘P)">⌘P</button><button type="button" class="buy-btn" data-wsd-compile title="Set the binder into one text of the press">${t ? 'Compile again' : 'Compile and shelve'}</button><span class="wsd-saved" data-wsd-saved></span></div></header>
<div class="wsd-panes">
<aside class="wsd-binder" data-wsd-binder><div class="wsd-bh"><span class="k">The binder</span><span class="wsd-badd"><button type="button" data-wsd-add="text" title="A new page">+ Page</button><button type="button" data-wsd-add="folder" title="A new folder: a part, an act">+ Folder</button><button type="button" data-wsd-add="note" title="A note to yourself">+ Note</button></span></div><ol class="wsd-tree" data-wsd-tree></ol><p class="wsd-bfoot">Drag to reorder; a page onto a folder moves it in.</p></aside>
<section class="wsd-page" data-wsd-pagepane><div class="wsd-cork" data-wsd-cork hidden></div><div class="wsd-ed" data-wsd-ed hidden><input class="wsd-ptitle" data-wsd-ptitle maxlength="200" aria-label="Page title"><textarea class="wsd-body${ms.kind === 'screenplay' ? ' wsd-mono' : ''}" data-wsd-body spellcheck="true" aria-label="The page" placeholder="${esc(data.line0)}"></textarea><div class="wsd-foot"><span data-wsd-pwords>0 words</span><span class="wsd-hint">⌘S saves · ⌘⇧F focus · [[ links a page · ⌘⇧S a snapshot</span></div></div><p class="wsd-none" data-wsd-none>Choose a page in the binder, or make one.</p></section>
<aside class="wsd-insp" data-wsd-insp><div class="wsd-ih"><span class="k">The inspector</span></div>
<label class="wsd-il">Synopsis <small>what this page is, for the corkboard</small><textarea data-wsd-syn rows="3" maxlength="600"></textarea></label>
<label class="wsd-il">Status <select data-wsd-status><option value="draft">Draft</option><option value="revised">Revised</option><option value="final">Final</option></select></label>
<div class="wsd-il"><span class="k">Outline</span><ul class="wsd-outline" data-wsd-outline></ul></div>
<div class="wsd-il"><span class="k">Tags</span><p class="wsd-tags" data-wsd-tags></p></div>
<div class="wsd-il"><span class="k">Links here</span><ul class="wsd-links" data-wsd-back></ul></div>
<div class="wsd-il"><span class="k">Drafts</span> <button type="button" class="link" data-wsd-snap>Take a snapshot</button><ul class="wsd-drafts" data-wsd-drafts></ul></div>
<div class="wsd-il wsd-danger"><button type="button" class="link" data-wsd-del>Remove this page</button> <small>Its drafts go with it.</small></div></aside>
</div>
<div class="wsd-read" data-wsd-readv hidden></div>
<div class="wsd-sheet" data-wsd-sheet hidden><div class="wsd-sc"><input class="wsd-si" data-wsd-sq placeholder="" autocomplete="off" spellcheck="false"><ol class="wsd-sl" data-wsd-sl></ol><p class="wsd-sk" data-wsd-sk></p></div></div>
<div class="wsd-graphv" data-wsd-graphv hidden><div class="wsd-gh"><span class="k">The graph</span><span data-wsd-gn></span><button type="button" class="link" data-wsd-gx>Close</button></div><canvas data-wsd-gc></canvas><p class="wsd-gm">Every page is a point; a line is a [[link]]. Drag the points; tap one to open it; folders hold their pages in a ring.</p></div>
<div class="wsd-compile" data-wsd-compilebox hidden><p class="k">Compile and shelve</p><p>The binder in order becomes one text of the press under your name: the reading room, a printed book, the Library and the Bookshop. Remake it any time; it keeps its address.</p><form method="post" action="/account/desk/${ms.id}/compile"><label>A line about it <input name="line" value="${esc(ms.line || '')}" maxlength="300"></label><label>Price, $ (blank: free to read) <input name="price" inputmode="decimal" value="${t && t.price_cents ? t.price_cents / 100 : ''}"></label><label class="pw-chk"><input type="checkbox" name="public" value="1" ${t ? (t.public ? 'checked' : '') : 'checked'}> Shown on your page, in the Library and in Wander</label><button class="buy-btn">${t ? 'Compile again' : 'Compile and shelve'}</button> <button type="button" class="link" data-wsd-compileno>Not now</button>${t ? ` · <a href="/read/${esc(t.slug)}">Read it</a> · <a href="/library/${esc(t.slug)}">Its page</a>` : ''}</form></div>
<script>window.__WSD=${JSON.stringify(data).replace(/</g, '\\u003c')}</script><script src="/static/writersdesk.js?v=${esc(V.VER)}" defer></script></main>` }));
  });
  app.post('/account/desk/:id/title', (req, res) => { const m = makerOf(req); const ms = m && mine(m, req.params.id); if (!ms) return res.sendStatus(404); const title = String((req.body || {}).title || '').trim().slice(0, 160); if (title) db.prepare("UPDATE manuscripts SET title=?, updated_at=datetime('now') WHERE id=?").run(title, ms.id); res.json({ ok: true }); });
  app.get('/account/desk/:id/pages', (req, res) => { const m = makerOf(req); const ms = m && mine(m, req.params.id); if (!ms) return res.sendStatus(404); res.set('Cache-Control', 'private, no-store').json({ pages: tree(ms), words: total(ms) }); });
  app.get('/account/desk/:id/pages/:pid', (req, res) => {
    const m = makerOf(req); const ms = m && mine(m, req.params.id); const p = ms && pageOf(ms, req.params.pid); if (!p) return res.sendStatus(404);
    const drafts = db.prepare('SELECT id, words, note, by, at FROM drafts WHERE page_id=? ORDER BY id DESC LIMIT 60').all(p.id);
    res.set('Cache-Control', 'private, no-store').json({ page: p, backlinks: backlinks(ms, p), drafts, tags: tagsIn(p.body) });
  });
  app.post('/account/desk/:id/pages', (req, res) => {
    const m = makerOf(req); const ms = m && mine(m, req.params.id); if (!ms) return res.sendStatus(404); const b = req.body || {};
    const kind = ['text', 'folder', 'note', 'research'].includes(b.kind) ? b.kind : 'text'; const parent = b.parent ? (pageOf(ms, b.parent) || {}).id || null : null;
    const pos = (db.prepare('SELECT COALESCE(MAX(pos),-1)+1 n FROM pages WHERE manuscript_id=? AND parent_id IS ?').get(ms.id, parent) || {}).n || 0;
    const title = String(b.title || '').trim().slice(0, 200) || (kind === 'folder' ? 'A new folder' : kind === 'note' ? 'A note' : 'Untitled');
    const id = db.prepare('INSERT INTO pages (manuscript_id, parent_id, pos, kind, title) VALUES (?,?,?,?,?)').run(ms.id, parent, pos, kind, title).lastInsertRowid;
    db.prepare("UPDATE manuscripts SET updated_at=datetime('now') WHERE id=?").run(ms.id);
    res.json({ ok: true, id, pages: tree(ms) });
  });
  app.put('/account/desk/:id/pages/:pid', (req, res) => {
    const m = makerOf(req); const ms = m && mine(m, req.params.id); const p = ms && pageOf(ms, req.params.pid); if (!p) return res.sendStatus(404); const b = req.body || {};
    const body = b.body != null ? String(b.body).replace(/\r\n?/g, '\n') : p.body; const title = b.title != null ? String(b.title).trim().slice(0, 200) || p.title : p.title;
    const synopsis = b.synopsis != null ? String(b.synopsis).slice(0, 600) : p.synopsis; const status = ['draft', 'revised', 'final'].includes(b.status) ? b.status : p.status;
    const n = words(body); credit(m, n - (p.words || 0));
    // The house's own snapshot: once an hour of writing, so a rewrite that went wrong has yesterday to go back to.
    let snapped = false; if (body !== p.body && p.body && (!p.snap_at || Date.now() - new Date(p.snap_at.replace(' ', 'T') + 'Z').getTime() > 3600e3)) { db.prepare("INSERT INTO drafts (page_id, body, words, by) VALUES (?,?,?,'house')").run(p.id, p.body, p.words || 0); db.prepare("UPDATE pages SET snap_at=datetime('now') WHERE id=?").run(p.id); snapped = true; }
    db.prepare("UPDATE pages SET body=?, title=?, synopsis=?, status=?, words=?, updated_at=datetime('now') WHERE id=?").run(body, title, synopsis, status, n, p.id);
    db.prepare("UPDATE manuscripts SET updated_at=datetime('now') WHERE id=?").run(ms.id);
    res.json({ ok: true, words: n, total: total(ms), today: days(m).today, snapped, backlinks: backlinks(ms, { ...p, title }) });
  });
  app.post('/account/desk/:id/pages/:pid/beacon', (req, res) => { // the last words on leaving the page (sendBeacon)
    const m = makerOf(req); const ms = m && mine(m, req.params.id); const p = ms && pageOf(ms, req.params.pid); if (!p) return res.sendStatus(204); const b = req.body || {}; const body = String(b.body != null ? b.body : p.body).replace(/\r\n?/g, '\n'); const n = words(body); credit(m, n - (p.words || 0));
    db.prepare("UPDATE pages SET body=?, title=?, synopsis=?, status=?, words=?, updated_at=datetime('now') WHERE id=?").run(body, String(b.title || p.title).trim().slice(0, 200) || p.title, b.synopsis != null ? String(b.synopsis).slice(0, 600) : p.synopsis, ['draft', 'revised', 'final'].includes(b.status) ? b.status : p.status, n, p.id); res.sendStatus(204); });
  app.post('/account/desk/:id/pages/:pid/snapshot', (req, res) => {
    const m = makerOf(req); const ms = m && mine(m, req.params.id); const p = ms && pageOf(ms, req.params.pid); if (!p) return res.sendStatus(404);
    const note = String((req.body || {}).note || '').trim().slice(0, 200) || null;
    db.prepare("INSERT INTO drafts (page_id, body, words, note, by) VALUES (?,?,?,?,'hand')").run(p.id, p.body, p.words || 0, note); db.prepare("UPDATE pages SET snap_at=datetime('now') WHERE id=?").run(p.id);
    res.json({ ok: true, drafts: db.prepare('SELECT id, words, note, by, at FROM drafts WHERE page_id=? ORDER BY id DESC LIMIT 60').all(p.id) });
  });
  app.get('/account/desk/:id/pages/:pid/drafts/:did', (req, res) => { const m = makerOf(req); const ms = m && mine(m, req.params.id); const p = ms && pageOf(ms, req.params.pid); const d = p && db.prepare('SELECT * FROM drafts WHERE id=? AND page_id=?').get(Number(req.params.did), p.id); if (!d) return res.sendStatus(404); res.set('Cache-Control', 'private, no-store').json({ draft: d }); });
  app.post('/account/desk/:id/pages/:pid/restore/:did', (req, res) => {
    const m = makerOf(req); const ms = m && mine(m, req.params.id); const p = ms && pageOf(ms, req.params.pid); const d = p && db.prepare('SELECT * FROM drafts WHERE id=? AND page_id=?').get(Number(req.params.did), p.id); if (!d) return res.sendStatus(404);
    db.prepare("INSERT INTO drafts (page_id, body, words, note, by) VALUES (?,?,?,?,'hand')").run(p.id, p.body, p.words || 0, 'Before restoring an earlier draft');
    credit(m, (d.words || 0) - (p.words || 0)); db.prepare("UPDATE pages SET body=?, words=?, updated_at=datetime('now'), snap_at=datetime('now') WHERE id=?").run(d.body, d.words || 0, p.id);
    res.json({ ok: true, page: pageOf(ms, p.id), drafts: db.prepare('SELECT id, words, note, by, at FROM drafts WHERE page_id=? ORDER BY id DESC LIMIT 60').all(p.id) });
  });
  app.post('/account/desk/:id/pages/:pid/move', (req, res) => {
    const m = makerOf(req); const ms = m && mine(m, req.params.id); const p = ms && pageOf(ms, req.params.pid); if (!p) return res.sendStatus(404); const b = req.body || {};
    const parent = b.parent ? (pageOf(ms, b.parent) || {}).id || null : null; if (parent === p.id) return res.json({ ok: false });
    const order = String(b.order || '').split(',').map(x => Number(x)).filter(Boolean);
    db.prepare('UPDATE pages SET parent_id=? WHERE id=?').run(parent, p.id);
    const sib = order.length ? order : db.prepare('SELECT id FROM pages WHERE manuscript_id=? AND parent_id IS ? ORDER BY pos, id').all(ms.id, parent).map(x => x.id);
    sib.forEach((id, i) => db.prepare('UPDATE pages SET pos=? WHERE id=? AND manuscript_id=?').run(i, id, ms.id));
    res.json({ ok: true, pages: tree(ms) });
  });
  app.delete('/account/desk/:id/pages/:pid', (req, res) => {
    const m = makerOf(req); const ms = m && mine(m, req.params.id); const p = ms && pageOf(ms, req.params.pid); if (!p) return res.sendStatus(404);
    const kids = db.prepare('SELECT COUNT(*) n FROM pages WHERE parent_id=?').get(p.id).n; if (kids) return res.json({ ok: false, msg: 'Empty the folder first.' });
    credit(m, -(p.words || 0)); db.prepare('DELETE FROM drafts WHERE page_id=?').run(p.id); db.prepare('DELETE FROM pages WHERE id=?').run(p.id);
    res.json({ ok: true, pages: tree(ms), total: total(ms) });
  });
  app.post('/account/desk/:id/compile', (req, res) => {
    const m = makerOf(req); const ms = m && mine(m, req.params.id); if (!ms) return res.sendStatus(404); const b = req.body || {};
    db.prepare('UPDATE manuscripts SET line=? WHERE id=?').run(String(b.line || '').trim().slice(0, 300) || null, ms.id);
    try { const t = shelve(m, mine(m, ms.id), { price: b.price ? Math.round(parseFloat(b.price) * 100) || null : null, pub: b.public ? 1 : 0 }); return res.redirect(`/account/desk/${ms.id}?ok=` + encodeURIComponent(`Shelved: ${t.title}.`)); }
    catch (e) { return res.redirect(`/account/desk/${ms.id}?ok=` + encodeURIComponent(e.message)); }
  });
  app.locals.writersDesk = { compile, shelve, days, KINDS, backlinks, linksIn };
  return app.locals.writersDesk;
}
module.exports = { mountWritersDesk };
