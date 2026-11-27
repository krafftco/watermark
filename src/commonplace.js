// The readers' feed and the commonplace book (Will, 27 Oct: "a readers' feed; what is the short form of a book; snippets
// and paragraphs"). The short form of a book is the passage: a paragraph that stands on its own, the sentence you underline.
// Franklin and Jefferson both kept one as a commonplace book, passages copied out of what they read, in their own hand.
// Here: Wander, for words. /wander?in=shelf is one passage a screen on the paper, chosen so it reads whole (`passage`: a
// public book, a chapter, a paragraph of 180–720 characters that begins like a sentence and ends like one), the book standing
// small beside it; tap opens the book at that place with the passage lit (/read/<slug>?c=&q=); Keep copies it into your
// commonplace book (`commonplace`: buyer, text, chapter, paragraph, the words); Share sends the quote card the house already
// makes. /yours/commonplace is the book: your passages in order, each to its place; a line of your own under any; remove.
const crypto = require('crypto');

function mountCommonplace(app, { db, V, C, buyerOf, ledger }) {
  const { esc } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS commonplace (id INTEGER PRIMARY KEY, buyer_id INTEGER NOT NULL, text_id INTEGER NOT NULL, chapter INTEGER NOT NULL DEFAULT 0, para INTEGER NOT NULL DEFAULT 0, passage TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (buyer_id, text_id, chapter, para));`);
  const I = require('./icons');
  const byName = a => { const x = String(a || '').trim(); const m = x.match(/^([^,]+),\s*([^,(]+)(.*)$/); return m ? `${m[2].trim()} ${m[1].trim()}` : x; };
  const chaptersOf = body => { const chs = []; let cur = { head: null, paras: [] }; for (const p of String(body || '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean)) { if (/^##?\s/.test(p)) { if (cur.head || cur.paras.length) chs.push(cur); cur = { head: p.replace(/^#+\s*/, ''), paras: [] }; } else cur.paras.push(p); } if (cur.head || cur.paras.length) chs.push(cur); return chs; };
  const plain = p => String(p).replace(/\*([^*\n]{1,200}?)\*/g, '$1');
  const whole = p => { const t = plain(p); return t.length >= 180 && t.length <= 720 && /^[“"'‘A-Z]/.test(t) && /[.!?…”"’]$/.test(t) && !/^\* \* \*$/.test(t) && !/\b(CHAPTER|BOOK|PART)\b/.test(t.slice(0, 12)); };
  const CLOTH = ['#2b3a4a', '#4a2b2b', '#2b4a3a', '#3a2b4a', '#4a3a2b', '#2b2b2b'];
  const hashOf = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  // (#126, 27 Nov; live answered /wander 503 on 25–27 Nov: "the thread held 8525 ms without a turn") The shelf used to
  // read whole books to choose one paragraph, on the visitor's path, several times a page. Now the choosing is a chore:
  // `gather` (the worker's round) reads one book at a time, in the back room, and keeps up to KEPT of its whole passages
  // in `passages` (a few hundred characters each), with one line a book in `passage_marks` (how many it kept, and the
  // book's stamp, so a changed book is read again and a book is turned over to other passages every TURN days).
  // A visitor's page asks for the list of books by id (ids and counts only, kept two minutes in memory), draws its books
  // and a number in each, and reads those few kept rows by their index. No body is read on a visitor's path.
  db.exec(`CREATE TABLE IF NOT EXISTS passages (id INTEGER PRIMARY KEY, text_id INTEGER NOT NULL, seq INTEGER NOT NULL, chapter INTEGER NOT NULL DEFAULT 0, para INTEGER NOT NULL DEFAULT 0, head TEXT, passage TEXT NOT NULL, chapters INTEGER NOT NULL DEFAULT 0, UNIQUE (text_id, seq));
    CREATE TABLE IF NOT EXISTS passage_marks (text_id INTEGER PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, stamp TEXT NOT NULL DEFAULT '', at TEXT NOT NULL DEFAULT (datetime('now')));`);
  const KEPT = 48, TURN = 7, POOL_MS = 120000, POOL_MAX = 2000;
  const candidates = body => { const chs = chaptersOf(body); const cands = []; chs.forEach((c, ci) => c.paras.forEach((p, pi) => { if (whole(p)) cands.push({ ci, pi, head: c.head || null, text: plain(p) }); })); return { cands, n: chs.length }; };

  // The chore. One book a turn of the loop's hand: its body is read here and nowhere on the shelf's road.
  function gatherOne(id) {
    const t = db.prepare("SELECT id, body, COALESCE(updated_at, created_at, '') AS stamp FROM texts WHERE id=?").get(id); if (!t) return 0;
    const { cands, n } = candidates(t.body);
    for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
    const keep = cands.slice(0, KEPT);
    db.transaction(() => {
      db.prepare('DELETE FROM passages WHERE text_id=?').run(t.id); db.prepare('DELETE FROM passage_marks WHERE text_id=?').run(t.id);
      const ins = db.prepare('INSERT INTO passages (text_id, seq, chapter, para, head, passage, chapters) VALUES (?,?,?,?,?,?,?)');
      keep.forEach((x, i) => ins.run(t.id, i, x.ci, x.pi, x.head ? String(x.head).slice(0, 300) : null, x.text, n));
      db.prepare("INSERT INTO passage_marks (text_id, n, stamp, at) VALUES (?,?,?,datetime('now'))").run(t.id, keep.length, t.stamp);
    })();
    return keep.length;
  }
  // A round: the books not yet read, changed since, or due a turn (at most `max`); then what left the shelf is taken off.
  function gather(max = 8) {
    const due = db.prepare("SELECT t.id FROM texts t LEFT JOIN passage_marks k ON k.text_id=t.id WHERE t.status='held' AND t.public=1 AND COALESCE(t.subscribers_only,0)=0 AND t.kind IN ('book','essay','document','history','paper') AND t.body IS NOT NULL AND (k.text_id IS NULL OR k.stamp <> COALESCE(t.updated_at, t.created_at, '') OR k.at < ?) ORDER BY t.id LIMIT ?").all(new Date(Date.now() - TURN * 86400e3).toISOString().slice(0, 19).replace('T', ' '), max);
    let kept = 0; for (const r of due) kept += gatherOne(r.id);
    const gone = db.prepare("SELECT k.text_id FROM passage_marks k LEFT JOIN texts t ON t.id=k.text_id AND t.status='held' AND t.public=1 AND COALESCE(t.subscribers_only,0)=0 AND t.kind IN ('book','essay','document','history','paper') AND t.body IS NOT NULL WHERE t.id IS NULL ORDER BY k.text_id LIMIT 200").all();
    for (const g of gone) { db.prepare('DELETE FROM passages WHERE text_id=?').run(g.text_id); db.prepare('DELETE FROM passage_marks WHERE text_id=?').run(g.text_id); }
    if (due.length || gone.length) pool.at = 0;
    return { books: due.length, kept, gone: gone.length, more: due.length >= max };
  }

  // The books that hold kept passages: ids and counts, never a word of them. Kept two minutes; a house of more than
  // POOL_MAX books is walked a stretch at a time (the next list begins where this one ended).
  const pool = { at: 0, rows: [], after: 0 };
  function books() {
    if (Date.now() - pool.at < POOL_MS) return pool.rows;
    let rows = db.prepare('SELECT text_id, n FROM passage_marks WHERE n > 0 AND text_id > ? ORDER BY text_id LIMIT ?').all(pool.after, POOL_MAX);
    if (!rows.length && pool.after) rows = db.prepare('SELECT text_id, n FROM passage_marks WHERE n > 0 AND text_id > ? ORDER BY text_id LIMIT ?').all(0, POOL_MAX);
    pool.after = rows.length >= POOL_MAX ? rows[rows.length - 1].text_id : 0; pool.rows = rows; pool.at = Date.now();
    return rows;
  }
  // Passages, never one the visitor has seen this visit (`seen` carries p:<slug>:<c>:<p>), a different book each while
  // there are books. A kept passage of a book that has changed since, or has left the shelf, is not shown.
  function passages(seen = [], n = 6) {
    const bs = books(); if (!bs.length) return [];
    const out = [], drawn = new Set(), has = new Set(seen);
    const one = db.prepare("SELECT p.chapter, p.para, p.head, p.passage, p.chapters, t.id, t.slug, t.title, t.author, w.slug AS cover FROM passages p JOIN passage_marks k ON k.text_id=p.text_id JOIN texts t ON t.id=p.text_id LEFT JOIN works w ON w.id=t.cover_work_id WHERE p.text_id=? AND p.seq=? AND t.status='held' AND t.public=1 AND COALESCE(t.subscribers_only,0)=0 AND k.stamp = COALESCE(t.updated_at, t.created_at, '')");
    let order = [];
    for (let tries = 0; tries < n * 3 && out.length < n; tries++) {
      if (!order.length) { order = bs.slice(); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } order = order.slice(0, n * 3); }
      const b = order.pop(); const seq = Math.floor(Math.random() * b.n); const key = b.text_id + ':' + seq; if (drawn.has(key)) continue; drawn.add(key);
      const r = one.get(b.text_id, seq); if (!r) continue;
      const slug = `p:${r.slug}:${r.chapter}:${r.para}`; if (has.has(slug)) continue; has.add(slug);
      const q = r.passage.split(/\s+/).slice(0, 12).join(' ');
      out.push({ kind: 'text', passage: true, slug, book: r.slug, textId: r.id, title: r.title, author: byName(r.author), cloth: CLOTH[(hashOf(r.title || r.slug) >>> 7) % CLOTH.length], head: r.head || null, c: r.chapter, p: r.para, excerpt: [r.passage], href: `/read/${r.slug}?c=${r.chapter}&q=${encodeURIComponent(q)}`, cover: r.cover ? `/img/${r.cover}/screen` : null, n: r.chapters });
    }
    return out;
  }
  const passage = (seen = []) => passages(seen, 1)[0] || null;

  // The round runs where the chores run, on one process of the house (the lease `timer:passages`); a first shelf, or a
  // long feed of new books, is read eight books at a time with the loop turning between.
  const ROLE = require('./role');
  const round = () => { if (app.locals.governor && app.locals.governor.chores && !app.locals.governor.chores()) return; try { const g = gather(); if (g.books || g.gone) console.log('[passages]', g.books, 'books read,', g.kept, 'passages kept' + (g.gone ? `, ${g.gone} off the shelf` : '')); if (g.more) setTimeout(round, 2000).unref(); } catch (e) { console.error('[passages]', e.message); } };
  const tick = () => (app.locals.instances ? app.locals.instances.pinned('passages', 5 * 60e3, round) : round)();
  if (ROLE.chores && !app.locals.noTimers && process.env.NODE_ENV !== 'test') { setTimeout(tick, 20e3).unref(); setInterval(tick, 5 * 60e3).unref(); }

  // Keep a passage. The words are checked against the book, so a commonplace entry is always a true quotation.
  app.post('/commonplace/keep', (req, res) => {
    const b = buyerOf(req); const json = req.body.json || /application\/json/.test(req.headers.accept || '');
    if (!b) return json ? res.status(401).json({ ok: false, signin: true }) : res.redirect('/signin?next=' + encodeURIComponent(req.body.back || '/wander?in=shelf') + '&why=commonplace');
    const t = db.prepare("SELECT id, slug, COALESCE(updated_at, created_at, '') AS stamp FROM texts WHERE slug=? AND status='held' AND public=1 AND COALESCE(subscribers_only,0)=0").get(String(req.body.book || '')); if (!t) return json ? res.status(404).json({ ok: false }) : res.sendStatus(404);
    const c = +req.body.c || 0, p = +req.body.p || 0;
    // The kept passage is the book's own paragraph, copied out by the worker from the book as it stands (the stamp); only
    // a passage the shelf no longer keeps (a page left open over a turn) is looked up in the book itself, this one book.
    const kept = db.prepare('SELECT p.passage FROM passages p JOIN passage_marks k ON k.text_id=p.text_id WHERE p.text_id=? AND p.chapter=? AND p.para=? AND k.stamp=? LIMIT 1').get(t.id, c, p, t.stamp);
    let para = kept ? kept.passage : null;
    if (!para) { const chs = chaptersOf(db.prepare('SELECT body FROM texts WHERE id=?').get(t.id).body); para = chs[c] && chs[c].paras[p]; }
    if (!para) return json ? res.status(400).json({ ok: false }) : res.sendStatus(400);
    db.prepare('INSERT OR IGNORE INTO commonplace (buyer_id, text_id, chapter, para, passage) VALUES (?,?,?,?,?)').run(b.id, t.id, c, p, plain(para).slice(0, 2000));
    const n = db.prepare('SELECT COUNT(*) n FROM commonplace WHERE buyer_id=?').get(b.id).n;
    if (json) return res.json({ ok: true, n }); res.redirect(req.body.back || '/yours/commonplace');
  });
  app.post('/commonplace/:id/note', (req, res) => { const b = buyerOf(req); if (!b) return res.sendStatus(401); db.prepare('UPDATE commonplace SET note=? WHERE id=? AND buyer_id=?').run(String(req.body.note || '').trim().slice(0, 600) || null, +req.params.id, b.id); res.redirect('/yours/commonplace#e' + req.params.id); });
  app.post('/commonplace/:id/remove', (req, res) => { const b = buyerOf(req); if (!b) return res.sendStatus(401); db.prepare('DELETE FROM commonplace WHERE id=? AND buyer_id=?').run(+req.params.id, b.id); res.redirect('/yours/commonplace'); });

  // The book itself.
  app.get('/yours/commonplace', (req, res) => {
    const b = buyerOf(req); if (!b) return res.redirect('/signin?next=/yours/commonplace&why=commonplace');
    const rows = db.prepare("SELECT c.*, t.slug, t.title, t.author FROM commonplace c JOIN texts t ON t.id=c.text_id WHERE c.buyer_id=? ORDER BY c.id DESC").all(b.id);
    const first = (b.name || '').split(' ')[0];
    res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: 'Your commonplace book · Watermark', path: '/yours/commonplace', desc: '', body: `<main class="wrap cpb"><p class="k"><a href="/yours">Yours</a> · The commonplace book</p><h1>${first ? `${esc(first)}’s` : 'Your'} commonplace book.</h1>
<p class="lede">Passages copied out of what you read, kept in your own hand. Franklin kept one; so did Jefferson. Each line here is a true quotation, checked against the book, and opens the book at its place.</p>
${rows.length ? `<ol class="cpb-l">${rows.map(r => `<li class="cpb-e" id="e${r.id}"><blockquote><p>${esc(r.passage)}</p></blockquote><p class="cpb-src">— <a href="/read/${esc(r.slug)}?c=${r.chapter}&q=${encodeURIComponent(r.passage.split(/\s+/).slice(0, 12).join(' '))}">${esc(r.author ? `${byName(r.author)}, ` : '')}<i>${esc(r.title)}</i></a></p>${r.note ? `<p class="cpb-note">${esc(r.note)}</p>` : ''}<details class="cpb-acts"><summary>In your own hand</summary><form method="post" action="/commonplace/${r.id}/note"><textarea name="note" rows="2" maxlength="600" placeholder="A line of your own, under it.">${esc(r.note || '')}</textarea><button>Keep the line</button></form><form method="post" action="/commonplace/${r.id}/remove"><button>Take it out</button></form></details></li>`).join('')}</ol>` : `<p class="note">Nothing copied out yet. <a href="/wander?in=shelf">Wander the shelf</a>: one passage a screen, and Keep the ones that stop you.</p>`}
<p class="cpb-foot"><a class="buy-btn" href="/wander?in=shelf">${I.wave}<span>Wander the shelf</span></a></p></main>` }));
  });

  app.locals.commonplace = { passage, passages, gather, whole, count: b => b ? db.prepare('SELECT COUNT(*) n FROM commonplace WHERE buyer_id=?').get(b.id).n : 0 };
  return app.locals.commonplace;
}

module.exports = { mountCommonplace };
