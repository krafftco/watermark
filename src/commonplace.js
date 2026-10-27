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

  // One passage, never one the visitor has seen this visit (`seen` carries p:<slug>:<c>:<p>).
  function passage(seen = [], { book = null } = {}) {
    const rows = book
      ? db.prepare("SELECT t.id, t.slug, t.title, t.author, t.body, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.status='held' AND t.public=1 AND t.slug=? AND t.body IS NOT NULL").all(book)
      : db.prepare("SELECT t.id, t.slug, t.title, t.author, t.body, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.status='held' AND t.public=1 AND t.kind IN ('book','essay','document','history','paper') AND t.body IS NOT NULL AND length(t.body) > 1200 ORDER BY RANDOM() LIMIT 8").all();
    for (const t of rows) {
      const chs = chaptersOf(t.body); const cands = [];
      chs.forEach((c, ci) => c.paras.forEach((p, pi) => { if (whole(p)) cands.push({ ci, pi, p }); }));
      if (!cands.length) continue;
      for (let k = 0; k < 12; k++) {
        const x = cands[Math.floor(Math.random() * cands.length)]; const slug = `p:${t.slug}:${x.ci}:${x.pi}`; if (seen.includes(slug)) continue;
        const text = plain(x.p); const q = text.split(/\s+/).slice(0, 12).join(' ');
        return { kind: 'text', passage: true, slug, book: t.slug, textId: t.id, title: t.title, author: byName(t.author), cloth: CLOTH[(hashOf(t.title || t.slug) >>> 7) % CLOTH.length], head: chs[x.ci].head || null, c: x.ci, p: x.pi, excerpt: [text], href: `/read/${t.slug}?c=${x.ci}&q=${encodeURIComponent(q)}`, cover: t.cover ? `/img/${t.cover}/screen` : null, n: chs.length };
      }
    }
    return null;
  }
  function passages(seen = [], n = 6) { const out = []; const s = seen.slice(); for (let i = 0; i < n * 3 && out.length < n; i++) { const p = passage(s); if (!p) break; out.push(p); s.push(p.slug); } return out; }

  // Keep a passage. The words are checked against the book, so a commonplace entry is always a true quotation.
  app.post('/commonplace/keep', (req, res) => {
    const b = buyerOf(req); const json = req.body.json || /application\/json/.test(req.headers.accept || '');
    if (!b) return json ? res.status(401).json({ ok: false, signin: true }) : res.redirect('/signin?next=' + encodeURIComponent(req.body.back || '/wander?in=shelf') + '&why=commonplace');
    const t = db.prepare("SELECT id, slug, body FROM texts WHERE slug=? AND status='held' AND public=1").get(String(req.body.book || '')); if (!t) return json ? res.status(404).json({ ok: false }) : res.sendStatus(404);
    const chs = chaptersOf(t.body); const c = +req.body.c || 0, p = +req.body.p || 0; const para = chs[c] && chs[c].paras[p]; if (!para) return json ? res.status(400).json({ ok: false }) : res.sendStatus(400);
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

  app.locals.commonplace = { passage, passages, whole, count: b => b ? db.prepare('SELECT COUNT(*) n FROM commonplace WHERE buyer_id=?').get(b.id).n : 0 };
  return app.locals.commonplace;
}

module.exports = { mountCommonplace };
