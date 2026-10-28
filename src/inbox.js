// The inbox (Will, 27 Oct: a watched folder as a feed; how a registrar actually works day to day, not by pressing a button).
// An institution or a maker is given a folder the house watches: a prefix in the house's own bucket (inbox/<handle>/), or a
// Dropbox folder (DROPBOX_TOKEN in the environment; the folder's path). Every INBOX_EVERY_MIN the house looks: each new file
// comes through the same doors as a feed (a picture → `iiif.take` as the maker's work; a PDF → the document kind; a
// recording → a spoken guide on the work its sidecar names), with a sidecar for the record: `index.csv` in the folder (a row
// per file: file, title, place, date, medium, description, artist, kind, credit, rights, work) or `<name>.json` beside a file
// (the same fields). What is taken is removed from the bucket (the house holds it now) or moved to Taken/ in Dropbox; what is
// refused stays, named on the desk with why, and is not looked at twice (`inbox_seen`). Studio → Back office → Inboxes.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');

const EVERY_MIN = +process.env.INBOX_EVERY_MIN || 5;
const MAX_PER_LOOK = +process.env.INBOX_MAX || 200;
const MAX_MB = +process.env.INBOX_MAX_MB || 400;
const IMG = /\.(jpe?g|png|tiff?|webp|dng)$/i, PDF = /\.pdf$/i, AUD = /\.(mp3|m4a|wav|flac|ogg|webm|aiff?)$/i, SIDE = /\.(json|csv|srt|vtt|txt)$/i;

function mountInbox(app, { db, V, C, store, studioOnly, ledger, doFetch }) {
  const { esc } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS inboxes (id INTEGER PRIMARY KEY, maker_id INTEGER NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL, open TEXT, show INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', last_at TEXT, taken INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS inbox_seen (id INTEGER PRIMARY KEY, inbox_id INTEGER NOT NULL, key TEXT NOT NULL, size INTEGER, outcome TEXT NOT NULL, what TEXT, why TEXT, at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (inbox_id, key, size));`);
  const stage = path.join(C.dataDir, 'incoming'); fs.mkdirSync(stage, { recursive: true });
  const FE = () => require('./feeds');

  // Providers: list → [{ key, name, size }], fetch(key, file), done(key) (remove or move), the folder as a person says it.
  function provider(ib) {
    if (ib.kind === 'dropbox') {
      const token = process.env.DROPBOX_TOKEN; const root = String(ib.path).replace(/\/$/, '');
      const api = async (fn, body, content) => {
        if (!token) throw new Error('DROPBOX_TOKEN is not set in the environment');
        const r = await doFetch(`https://${content ? 'content' : 'api'}.dropboxapi.com/2/files/${fn}`, { method: 'POST', headers: content ? { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify(body) } : { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: content ? undefined : JSON.stringify(body) });
        if (!r.ok) throw new Error(`dropbox ${r.status}: ${(await r.text()).slice(0, 120)}`);
        return content ? Buffer.from(await r.arrayBuffer()) : r.json();
      };
      return {
        said: `Dropbox ${root}`,
        async list() { let j = await api('list_folder', { path: root, recursive: false, limit: 500 }); let out = j.entries || []; while (j.has_more) { j = await api('list_folder/continue', { cursor: j.cursor }); out = out.concat(j.entries || []); } return out.filter(e => e['.tag'] === 'file').map(e => ({ key: e.path_lower, name: e.name, size: e.size })); },
        async fetch(key, file) { fs.writeFileSync(file, await api('download', { path: key }, true)); },
        async done(key, name) { try { await api('move_v2', { from_path: key, to_path: `${root}/Taken/${name}`, autorename: true }); } catch (e) { /* left where it was */ } },
      };
    }
    const prefix = String(ib.path).replace(/^\/+/, '').replace(/\/?$/, '/');
    return {
      said: `the vault, ${prefix}`,
      async list() { const keys = await store.list(prefix); const out = []; for (const k of keys) { if (k === prefix || k.endsWith('/')) continue; const name = k.slice(prefix.length); if (name.includes('/')) continue; out.push({ key: k, name, size: await store.size(k) }); } return out; },
      async fetch(key, file) { if (store.download) await store.download(key, file); else { const b = await store.get(key); if (!b) throw new Error('gone'); fs.writeFileSync(file, b); } },
      async done(key) { try { await store.del(key); } catch (e) { /* left */ } },
    };
  }
  // The sidecars: index.csv (a row per file) and <name>.json beside a file.
  async function sidecars(p, files) {
    const by = {}; const idx = files.find(f => /^index\.csv$/i.test(f.name));
    if (idx) { const tmp = path.join(stage, `ib-idx-${crypto.randomBytes(4).toString('hex')}.csv`); try { await p.fetch(idx.key, tmp); const rows = FE().parseCSV(fs.readFileSync(tmp, 'utf8')); const head = (rows.shift() || []).map(h => String(h).trim().toLowerCase()); for (const r of rows) { const o = {}; head.forEach((h, i) => { if (h) o[h] = String(r[i] || '').trim(); }); const f = o.file || o.filename || o.name; if (f) by[f.toLowerCase()] = o; } } catch (e) { /* no index */ } finally { try { fs.unlinkSync(tmp); } catch (e) { /* */ } } }
    for (const f of files) if (/\.json$/i.test(f.name)) { const tmp = path.join(stage, `ib-json-${crypto.randomBytes(4).toString('hex')}.json`); try { await p.fetch(f.key, tmp); const o = JSON.parse(fs.readFileSync(tmp, 'utf8')); const base = f.name.replace(/\.json$/i, '').toLowerCase(); by[base] = { ...(by[base] || {}), ...o }; } catch (e) { /* */ } finally { try { fs.unlinkSync(tmp); } catch (e) { /* */ } } }
    return by;
  }
  const g = (o, ...ks) => { for (const k of ks) if (o && o[k]) return String(o[k]); return ''; };
  const sideOf = (by, name) => by[name.toLowerCase()] || by[name.replace(/\.[^.]+$/, '').toLowerCase()] || {};

  async function look(ib, { force = false } = {}) {
    const p = provider(ib); const m = db.prepare('SELECT * FROM makers WHERE id=?').get(ib.maker_id); if (!m) return { why: 'no maker' };
    let files; try { files = await p.list(); } catch (e) { db.prepare("UPDATE inboxes SET note=?, last_at=datetime('now') WHERE id=?").run(String(e.message).slice(0, 200), ib.id); return { why: e.message }; }
    const by = await sidecars(p, files); let taken = 0, skipped = 0, failed = 0, n = 0;
    const seen = db.prepare('SELECT 1 FROM inbox_seen WHERE inbox_id=? AND key=? AND size=?'); const mark = db.prepare('INSERT INTO inbox_seen (inbox_id, key, size, outcome, what, why) VALUES (?,?,?,?,?,?) ON CONFLICT(inbox_id, key, size) DO UPDATE SET outcome=excluded.outcome, what=excluded.what, why=excluded.why');
    for (const f of files) {
      if (n >= MAX_PER_LOOK) break; if (SIDE.test(f.name)) continue; if (!force && seen.get(ib.id, f.key, f.size)) continue; n++;
      const sc = sideOf(by, f.name); const tmp = path.join(stage, `ib-${crypto.randomBytes(5).toString('hex')}${path.extname(f.name).toLowerCase()}`);
      try {
        if (f.size > MAX_MB * 1024 * 1024) throw new Error(`over ${MAX_MB} MB`);
        await p.fetch(f.key, tmp);
        const title = g(sc, 'title', 'label', 'name') || f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
        const source = g(sc, 'source', 'source_url', 'id', 'url') || `inbox:${ib.id}:${f.name}`;
        let what;
        if (IMG.test(f.name)) {
          const meta = []; for (const [k, label] of [['date', 'Date'], ['place', 'Place'], ['medium', 'Medium'], ['credit', 'Credit'], ['artist', 'Artist'], ['rights', 'Rights']]) { const v = g(sc, k, k === 'date' ? 'year' : k, k === 'rights' ? 'license' : k); if (v) meta.push({ label, value: v }); }
          const it = { id: source, name: f.name, label: title.slice(0, 160), summary: g(sc, 'description', 'caption', 'summary') || null, file: tmp, image: null, meta, artist: g(sc, 'artist') ? { name: g(sc, 'artist') } : null, kind: g(sc, 'kind').toLowerCase() || null, rights: g(sc, 'rights', 'license') || null };
          const r = await app.locals.iiif.take(it, { id: `inbox-${ib.id}`, maker_id: m.id, open: ib.open, show: ib.show });
          if (r.skipped) { skipped++; mark.run(ib.id, f.key, f.size, 'skipped', 'held already', null); } else { taken++; what = `work:${r.w.slug}`; mark.run(ib.id, f.key, f.size, 'taken', what, null); }
        } else if (PDF.test(f.name)) {
          const D = app.locals.documents; if (!D) throw new Error('the document room is not mounted');
          const r = await D.take({ pdf: tmp }, { title, author: g(sc, 'author', 'artist', 'creator') || m.name, year: g(sc, 'year', 'date').slice(0, 12), source, terms: g(sc, 'rights', 'license', 'terms') || null, summary: g(sc, 'description', 'summary'), public: ib.show ? 1 : 0, illustrator: g(sc, 'illustrator') }, { by: 'inbox' });
          if (r.already) { skipped++; mark.run(ib.id, f.key, f.size, 'skipped', 'held already', null); } else { taken++; what = `text:${r.slug}`; mark.run(ib.id, f.key, f.size, 'taken', what, null); }
        } else if (AUD.test(f.name)) {
          const G = app.locals.audioGuides; if (!G) throw new Error('the guides room is not mounted');
          const w = G.findWork(m, g(sc, 'work', 'slug', 'accession')); if (!w) throw new Error(`a recording needs a work: the sidecar’s "work" (a slug, accession or source address of ${m.name}’s)`);
          let transcript = g(sc, 'transcript', 'words'); const tf = files.find(x => x.name.replace(/\.[^.]+$/, '') === f.name.replace(/\.[^.]+$/, '') && /\.(srt|vtt|txt)$/i.test(x.name));
          if (!transcript && tf) { const tt = path.join(stage, `ib-tx-${crypto.randomBytes(4).toString('hex')}`); try { await p.fetch(tf.key, tt); transcript = fs.readFileSync(tt, 'utf8'); } catch (e) { /* */ } finally { try { fs.unlinkSync(tt); } catch (e) { /* */ } } }
          const r = await G.keep(w, m, tmp, { title: g(sc, 'title'), speaker: g(sc, 'speaker'), role: g(sc, 'role'), lang: g(sc, 'lang', 'language') || 'en', transcript, license: g(sc, 'rights', 'license'), source, by: 'inbox' });
          if (r.already) { skipped++; mark.run(ib.id, f.key, f.size, 'skipped', 'kept already', null); } else { taken++; what = `guide:${r.id}`; mark.run(ib.id, f.key, f.size, 'taken', what, null); }
        } else throw new Error('not a picture, a PDF or a recording');
        await p.done(f.key, f.name);
      } catch (e) { failed++; mark.run(ib.id, f.key, f.size, 'refused', null, String(e.message).slice(0, 200)); }
      finally { try { fs.unlinkSync(tmp); } catch (e) { /* */ } }
    }
    db.prepare("UPDATE inboxes SET last_at=datetime('now'), taken=taken+?, skipped=skipped+?, failed=failed+?, note=NULL WHERE id=?").run(taken, skipped, failed, ib.id);
    if (taken && app.locals.findIndexDirty) app.locals.findIndexDirty();
    if (taken) { try { ledger.append(db, 'collection.imported', `inbox-${ib.id}`, { maker: m.handle, n: taken, skipped, failed, from: p.said, feed: 'inbox' }); } catch (e) { /* */ } }
    return { taken, skipped, failed, looked: n };
  }
  let busy = false;
  async function sweep() { if (busy) return; busy = true; try { for (const ib of db.prepare("SELECT * FROM inboxes WHERE status='active'").all()) { try { await look(ib); } catch (e) { console.error('[inbox]', ib.id, e.message); } } } finally { busy = false; } }
  if (!app.locals.noTimers && process.env.NODE_ENV !== 'test') { const t = setInterval(() => sweep().catch(() => {}), EVERY_MIN * 60 * 1000); if (t.unref) t.unref(); const t0 = setTimeout(() => sweep().catch(() => {}), 70 * 1000); if (t0.unref) t0.unref(); }

  // The desk.
  app.get('/studio/inbox', studioOnly, (req, res) => {
    const rows = db.prepare('SELECT i.*, m.name AS maker, m.handle FROM inboxes i JOIN makers m ON m.id=i.maker_id ORDER BY i.id DESC').all();
    const makers = db.prepare("SELECT id, name, handle, kind FROM makers WHERE standing='open' OR standing IS NULL ORDER BY kind='institution' DESC, name").all();
    const seen = db.prepare("SELECT s.*, i.path FROM inbox_seen s JOIN inboxes i ON i.id=s.inbox_id ORDER BY s.id DESC LIMIT 60").all();
    res.send(V.layout({ title: 'Inboxes · Studio', path: '/studio/inbox', desc: '', studio: true, body: `<main class="wrap ibx"><p class="k">The Studio · Back office</p><h1>Inboxes.</h1>
<p class="lede">A folder the house watches. Drop files in and they come through the same doors as a feed: a picture as the maker’s work, a PDF as a document, a recording as a spoken guide on the work its sidecar names. The record rides beside the file: <code>index.csv</code> in the folder (file, title, place, date, medium, description, artist, kind, credit, rights, work) or <code>name.json</code> beside it. Looked at every ${EVERY_MIN} minutes; what is taken leaves the folder, what is refused stays and is named here. ${process.env.DROPBOX_TOKEN ? 'Dropbox is connected.' : 'Dropbox folders need DROPBOX_TOKEN in the environment; the vault’s own inbox works now.'}</p>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
<form method="post" action="/studio/inbox" class="ibx-f"><label>For <select name="maker">${makers.map(m => `<option value="${m.id}">${esc(m.name)}${m.kind === 'institution' ? ' · institution' : ''}</option>`).join('')}</select></label>
<label>Where <select name="kind"><option value="vault">The vault’s inbox (a prefix in the house’s bucket)</option><option value="dropbox">A Dropbox folder</option></select></label>
<label>The folder <input name="path" required placeholder="inbox/the-met/ · or /Watermark/Inbox"></label>
<label>Licence on arrival <select name="open"><option value="">The institution’s terms (closed until said)</option><option value="pd">Public domain</option><option value="cc0">CC0</option><option value="cc-by">CC BY</option><option value="cc-by-sa">CC BY-SA</option></select></label>
<label class="ibx-ck"><input type="checkbox" name="show" value="1"> Shown at once (else held back for review)</label><button class="buy-btn">Watch it</button></form>
<h2>Watched · ${rows.length}</h2>${rows.length ? `<table class="tbl"><tr><th>Folder</th><th>For</th><th>Last look</th><th>In · held · refused</th><th></th></tr>${rows.map(r => `<tr><td>${esc(r.kind === 'dropbox' ? `Dropbox ${r.path}` : `vault ${r.path}`)}${r.note ? `<br><small>${esc(r.note)}</small>` : ''}</td><td>${esc(r.maker)}</td><td>${esc(r.last_at || 'never')}</td><td>${r.taken} · ${r.skipped} · ${r.failed}</td><td><form method="post" action="/studio/inbox/${r.id}/look" style="display:inline"><button>Look now</button></form> <form method="post" action="/studio/inbox/${r.id}/${r.status === 'active' ? 'pause' : 'resume'}" style="display:inline"><button>${r.status === 'active' ? 'Pause' : 'Resume'}</button></form></td></tr>`).join('')}</table>` : '<p class="note">No folder is watched yet.</p>'}
<h2>Lately</h2>${seen.length ? `<table class="tbl"><tr><th>When</th><th>File</th><th>Outcome</th><th></th></tr>${seen.map(s => `<tr><td>${esc(s.at)}</td><td>${esc(s.key.split('/').pop())}<br><small>${esc(s.path)}</small></td><td>${esc(s.outcome)}</td><td>${s.what ? esc(s.what) : s.why ? `<small>${esc(s.why)}</small>` : ''}</td></tr>`).join('')}</table>` : '<p class="note">Nothing has come through yet.</p>'}</main>` }));
  });
  app.post('/studio/inbox', studioOnly, (req, res) => {
    const b = req.body || {}; const m = db.prepare('SELECT id FROM makers WHERE id=?').get(+b.maker); const p = String(b.path || '').trim();
    if (!m || !p) return res.redirect('/studio/inbox?ok=' + encodeURIComponent('A maker and a folder.'));
    const kind = b.kind === 'dropbox' ? 'dropbox' : 'vault'; const open = ['pd', 'cc0', 'cc-by', 'cc-by-sa'].includes(b.open) ? b.open : null;
    const id = db.prepare('INSERT INTO inboxes (maker_id, kind, path, open, show) VALUES (?,?,?,?,?)').run(m.id, kind, kind === 'dropbox' ? (p.startsWith('/') ? p : '/' + p) : p.replace(/^\/+/, ''), open, b.show ? 1 : 0).lastInsertRowid;
    setTimeout(() => look(db.prepare('SELECT * FROM inboxes WHERE id=?').get(id)).catch(() => {}), app.locals.noTimers ? 0 : 50);
    res.redirect('/studio/inbox?ok=' + encodeURIComponent('Watched. The house is looking at it now.'));
  });
  app.post('/studio/inbox/:id/look', studioOnly, async (req, res) => { const ib = db.prepare('SELECT * FROM inboxes WHERE id=?').get(+req.params.id); if (!ib) return res.sendStatus(404); const r = await look(ib, { force: !!(req.body && req.body.force) }); res.redirect('/studio/inbox?ok=' + encodeURIComponent(r.why ? `Could not look: ${r.why}` : `Looked: ${r.looked} new, ${r.taken} in, ${r.skipped} held already, ${r.failed} refused.`)); });
  app.post('/studio/inbox/:id/pause', studioOnly, (req, res) => { db.prepare("UPDATE inboxes SET status='paused' WHERE id=?").run(+req.params.id); res.redirect('/studio/inbox'); });
  app.post('/studio/inbox/:id/resume', studioOnly, (req, res) => { db.prepare("UPDATE inboxes SET status='active' WHERE id=?").run(+req.params.id); res.redirect('/studio/inbox'); });

  app.locals.inbox = { look, sweep, provider, EVERY_MIN };
  return app.locals.inbox;
}

module.exports = { mountInbox };
