'use strict';
// The cull (Will, 11 Nov: "a feature similar to picnic.photos: swiping left and right could publish or unpublish a
// photo, which would allow you to cull very quickly"). The maker's own work one picture at a time on the dark wall,
// as Wander shows it; a swipe right puts it on view, a swipe left keeps it back, a swipe up leaves it for later;
// Undo takes the last one back. Every swipe is one small POST; nothing reloads.
//   GET  /account/cull            the room (?deck=undecided|private|public|all, ?place=, ?at=slug)
//   GET  /account/cull.json       the deck (up to CULL_MAX), newest first
//   POST /account/cull/say        {slug, to: show|hide|later|undo, attest, was, kept} → {ok, status, msg}
// `works.cull_at` marks a work as decided, so the Undecided deck never serves it twice. Showing is the same act as
// publishing anywhere else: the maker's attestation (asked once a visit), the Maker Agreement, the wall's room
// (`mayHang`), the account's standing, `work.published` on the register. A swipe right on a work the maker had kept
// back lets it go: the swipe is their word. (POST /account/cull, the older cull by stars, is accounts.js's.)
const I = require('./icons');
function mountCull(app, { db, V, ledger, makerOf, mayHang }) {
  const { esc, tidy } = V;
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='cull_at'").get()) db.exec('ALTER TABLE works ADD COLUMN cull_at TEXT');
  const MAX = Math.max(20, Number(process.env.CULL_MAX || 800));
  const DECKS = { undecided: ['Undecided', "AND w.cull_at IS NULL AND w.status='hidden'"], private: ['Not on view', "AND w.status='hidden'"], public: ['On view', "AND w.status='held'"], all: ['Everything', ''] };
  const deckOf = q => (DECKS[String(q || '')] ? String(q) : 'undecided');
  function deck(m, key, place) {
    const word = String(place || '').trim().slice(0, 120);
    const rows = db.prepare(`SELECT w.slug, w.title, w.place, w.status, w.stars, w.keep_back, w.width, w.height, w.taken_at, w.created_at FROM works w
      WHERE w.maker_id=? AND w.status IN ('held','hidden') ${DECKS[key][1]} ${word ? 'AND lower(w.place)=lower(?)' : ''}
      ORDER BY COALESCE(w.taken_at, w.created_at) DESC, w.id DESC LIMIT ${MAX}`).all(...(word ? [m.id, word] : [m.id]));
    return rows.map(w => ({ slug: w.slug, title: tidy(w.title), place: w.place || '', status: w.status === 'held' ? 'public' : 'private', stars: w.stars || 0, kept: w.keep_back ? 1 : 0, w: w.width || 0, h: w.height || 0, at: String(w.taken_at || w.created_at || '').slice(0, 10) }));
  }
  const counts = m => { const r = {}; for (const k of Object.keys(DECKS)) r[k] = db.prepare(`SELECT COUNT(*) AS n FROM works w WHERE w.maker_id=? AND w.status IN ('held','hidden') ${DECKS[k][1]}`).get(m.id).n; return r; };
  const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  const dirty = () => { try { app.locals.findIndexDirty && app.locals.findIndexDirty(); } catch (e) { /* quiet */ } };

  app.get('/account/cull.json', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const key = deckOf(req.query.deck);
    res.set('Cache-Control', 'private, no-store').json({ deck: key, works: deck(m, key, req.query.place), counts: counts(m) });
  });

  app.post('/account/cull/say', (req, res) => {
    const m = makerOf(req); if (!m) return res.status(401).json({ ok: false, msg: 'Sign in again.' });
    const w = db.prepare("SELECT * FROM works WHERE maker_id=? AND slug=?").get(m.id, String(req.body.slug || ''));
    if (!w) return res.status(404).json({ ok: false, msg: 'That work is not yours.' });
    if (!['held', 'hidden'].includes(w.status)) return res.json({ ok: false, msg: `It is off view (${w.status}); the house has it.` });
    const to = String(req.body.to || '');
    const say = (ok, msg) => { const x = db.prepare('SELECT status, keep_back FROM works WHERE id=?').get(w.id); return res.json({ ok, msg: msg || '', status: x.status === 'held' ? 'public' : 'private', kept: x.keep_back ? 1 : 0 }); };
    if (to === 'show') {
      if (w.status !== 'held') {
        if (String(req.body.attest) !== '1') return say(false, 'attest');
        if (m.standing === 'held') return say(false, 'Your account is held; nothing can go on view just now.');
        if (mayHang && !mayHang(m)) return say(false, `Your museum's walls are full (${app.locals.museums ? app.locals.museums.MUSEUM_WALL : 36} on view). Take one down first: swipe left on one that is on view.`);
        const g = app.locals.companies && app.locals.companies.gate(w); if (g) return say(false, g);
        db.prepare("UPDATE works SET status='held', keep_back=0, cull_at=? WHERE id=?").run(now(), w.id);
        ledger.append(db, 'work.published', w.slug, { maker: m.handle, attested: 'rights and releases', by: 'cull' });
        try { app.locals.legal && app.locals.legal.accept('maker', m.id, 'makers', req.ip, 'cull'); } catch (e) { /* quiet */ }
        dirty();
      } else db.prepare('UPDATE works SET cull_at=? WHERE id=?').run(now(), w.id);
      return say(true);
    }
    if (to === 'hide') {
      if (w.status === 'held') { db.prepare("UPDATE works SET status='hidden', cull_at=? WHERE id=?").run(now(), w.id); ledger.append(db, 'work.hidden', w.slug, { by: m.handle, how: 'cull' }); dirty(); }
      else db.prepare('UPDATE works SET cull_at=? WHERE id=?').run(now(), w.id);
      return say(true);
    }
    if (to === 'later') return say(true);
    if (to === 'undo') { // back to what it was before the swipe
      const was = String(req.body.was) === 'public' ? 'held' : 'hidden'; const kept = String(req.body.kept) === '1' ? 1 : 0;
      if (was === 'held' && w.status !== 'held') { // it was on view a moment ago: the same rules, the word already given
        if (m.standing === 'held') return say(false, 'Your account is held.');
        db.prepare("UPDATE works SET status='held', keep_back=0, cull_at=NULL WHERE id=?").run(w.id); ledger.append(db, 'work.published', w.slug, { maker: m.handle, attested: 'rights and releases', by: 'cull', undo: true });
      } else if (was === 'hidden' && w.status === 'held') { db.prepare("UPDATE works SET status='hidden', keep_back=?, cull_at=NULL WHERE id=?").run(kept, w.id); ledger.append(db, 'work.hidden', w.slug, { by: m.handle, how: 'cull', undo: true }); }
      else db.prepare('UPDATE works SET cull_at=NULL WHERE id=?').run(w.id);
      dirty(); return say(true);
    }
    res.status(400).json({ ok: false, msg: 'show, hide, later or undo' });
  });

  app.get('/account/cull', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/cull');
    const key = deckOf(req.query.deck); const place = String(req.query.place || '').slice(0, 120); const n = counts(m);
    const places = db.prepare("SELECT place, COUNT(*) AS n FROM works WHERE maker_id=? AND status IN ('held','hidden') AND place IS NOT NULL AND place<>'' GROUP BY place ORDER BY COUNT(*) DESC LIMIT 60").all(m.id);
    const VER = (V.VER || process.env.RENDER_GIT_COMMIT || '').slice(0, 8);
    const link = (k, p) => `/account/cull?deck=${k}${p ? '&place=' + encodeURIComponent(p) : ''}`;
    res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: 'The cull · Your studio', bare: true, path: '/account/cull', body: `<main class="cll" data-cll data-deck="${esc(key)}" data-place="${esc(place)}" data-at="${esc(String(req.query.at || ''))}">
<header class="cll-top"><a class="cll-x" href="/account/table" aria-label="Back to the Library">${I.close}</a>
<nav class="cll-decks" aria-label="Which works">${Object.keys(DECKS).map(k => `<a href="${link(k, place)}"${k === key ? ' aria-current="true"' : ''}>${DECKS[k][0]} <small>${n[k]}</small></a>`).join('')}</nav>
${places.length > 1 ? `<label class="cll-place"><select data-cll-place aria-label="A place"><option value="">Every place</option>${places.map(p => `<option value="${esc(p.place)}"${p.place.toLowerCase() === place.toLowerCase() ? ' selected' : ''}>${esc(p.place)} · ${p.n}</option>`).join('')}</select></label>` : ''}
<span class="cll-count" data-cll-count></span></header>
<div class="cll-stage" data-cll-stage><p class="cll-wait" data-cll-wait>One moment.</p></div>
<span class="cll-tag cll-tag-y" aria-hidden="true">On view</span><span class="cll-tag cll-tag-n" aria-hidden="true">Kept back</span><span class="cll-tag cll-tag-l" aria-hidden="true">Later</span>
<p class="cll-plate" data-cll-plate></p>
<div class="cll-deck" data-cll-acts hidden>
<button type="button" class="cll-b cll-no" data-cll-do="hide" title="Keep it back (←)">${I.back}<span>Keep back</span></button>
<button type="button" class="cll-b cll-un" data-cll-do="undo" title="Take the last one back (Z)" disabled><span>Undo</span></button>
<button type="button" class="cll-b cll-la" data-cll-do="later" title="Leave it for later (↑ or space)"><span>Later</span></button>
<button type="button" class="cll-b cll-yes" data-cll-do="show" title="Put it on view (→)"><span>On view</span>${I.next}</button></div>
<p class="cll-hint" data-cll-hint>Swipe right to put it on view, left to keep it back, up to leave it for later. Keys: ← → ↑, Z to undo, 1–5 to grade.</p>
<div class="cll-attest" data-cll-attest hidden><label><input type="checkbox" data-cll-attest-cb> These are mine and I hold the rights (showing them needs no release; a company’s or a campaign’s use waits for one), and I accept <a href="/legal/makers" target="_blank">the Maker Agreement</a>.</label><span><button type="button" class="buy-btn" data-cll-attest-go>Put it on view</button> <button type="button" class="link" data-cll-attest-no>Not now</button></span></div>
<div class="cll-end" data-cll-end hidden><p class="k">The cull</p><h1 data-cll-end-h>That is all of them.</h1><p data-cll-end-l></p><p class="cll-end-a"><a class="buy-btn" href="/wander?in=studio">Wander what is on view</a> <a class="link" href="/account/table">The Library</a> <a class="link" href="${link('private', place)}">Go through what is not on view</a></p></div>
<p class="cll-say" data-cll-say hidden></p>
</main><script src="/static/cull.js?v=${esc(VER)}" defer></script>` }));
  });
  app.locals.cull = { deck, counts, DECKS };
  return app.locals.cull;
}
module.exports = { mountCull };
