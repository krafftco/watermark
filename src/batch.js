// Batch (Will, 20 Oct: "you need to be able to batch accept and publish things; going in one by one is not
// acceptable"). Tick works on the maker's studio or on Studio → Works, and a bar rises: Publish (one attestation
// for all), Make private, Stars 1–5, a place, a kind, Curated (the Studio); Select all. One POST does the lot and
// says how many it touched. Publishing by batch is the same act as publishing one: the maker's attestation, the
// Maker Agreement accepted, `work.published` on the register for each, and the house's door (`mayHang`) and the
// maker's standing respected; what cannot be published is counted and said.
//   POST /account/works/batch and POST /studio/works/batch: slugs (an array or a comma string), do publish|hide|
//   stars|place|kind|curate|uncurate, stars 0–5, place, kind, attest=1 for publish.
//   The bar: `public/batch.js` on both lists (`[data-batch]` form with `[name=slugs]` boxes and `.bt-bar`).
function mountBatch(app, { db, ledger, studioOnly, isStudio, makerOf, mayHang, KINDS }) {
  const parse = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(x => String(x).trim()).filter(Boolean).slice(0, 500);
  function run(works, body, who, m) {
    const act = String(body.do || ''); let done = 0, refused = 0, why = '';
    for (const w of works) {
      if (act === 'publish') {
        if (w.status === 'held') continue;
        if (body.attest !== '1') { refused++; why = 'the attestation'; continue; }
        if (m && m.standing === 'held') { refused++; why = 'your account is held'; continue; }
        if (m && mayHang && !mayHang(m)) { refused++; why = 'the house has not yet invited you to hang'; continue; }
        if (!['hidden', 'held'].includes(w.status)) { refused++; why = `off view (${w.status})`; continue; }
        db.prepare("UPDATE works SET status='held' WHERE id=?").run(w.id);
        ledger.append(db, 'work.published', w.slug, { maker: who, attested: 'rights and releases', batch: true }); done++;
      } else if (act === 'hide') {
        if (w.status !== 'held') continue;
        db.prepare("UPDATE works SET status='hidden' WHERE id=?").run(w.id); ledger.append(db, 'work.hidden', w.slug, { by: who, batch: true }); done++;
      } else if (act === 'stars') {
        const n = Math.max(0, Math.min(5, parseInt(body.stars, 10) || 0));
        db.prepare('UPDATE works SET stars=?, curated=CASE WHEN ?=5 THEN 1 WHEN curated=1 AND ?<5 THEN 0 ELSE curated END WHERE id=?').run(n, n, n, w.id); done++;
      } else if (act === 'place') {
        const place = String(body.place || '').trim().slice(0, 120); if (!place) { refused++; why = 'a place'; continue; }
        db.prepare('UPDATE works SET place=? WHERE id=?').run(place, w.id); done++;
      } else if (act === 'kind') {
        const kind = String(body.kind || '').trim(); if (!KINDS.includes(kind)) { refused++; why = 'a kind'; continue; }
        db.prepare('UPDATE works SET kind=? WHERE id=?').run(kind, w.id); done++;
      } else if (act === 'curate' || act === 'uncurate') {
        db.prepare('UPDATE works SET curated=? WHERE id=?').run(act === 'curate' ? 1 : 0, w.id); done++;
      } else if (act === 'flag') { // Lightroom's flags (25 Oct): pick, reject, or none; nothing else changes.
        const f = ['pick', 'reject'].includes(String(body.flag)) ? String(body.flag) : null;
        try { db.prepare('UPDATE works SET flag=? WHERE id=?').run(f, w.id); done++; } catch (e) { refused++; why = 'flags'; }
      }
    }
    if (done && app.locals.findIndexDirty) app.locals.findIndexDirty();
    const word = { publish: 'published', hide: 'made private', stars: 'graded', place: 'given a place', kind: 'given a kind', curate: 'marked curated', uncurate: 'unmarked', flag: body.flag === 'pick' ? 'picked' : body.flag === 'reject' ? 'rejected' : 'unflagged' }[act] || 'touched';
    return `${done} ${word}${refused ? `; ${refused} not: ${why}` : ''}.`;
  }
  app.post('/account/works/batch', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const slugs = parse(req.body.slugs); if (!slugs.length) return req.body.json ? res.json({ ok: false, msg: 'Select some works first.' }) : res.redirect('/account?ok=' + encodeURIComponent('Tick some works first.'));
    const works = db.prepare(`SELECT * FROM works WHERE maker_id=? AND slug IN (${slugs.map(() => '?').join(',')})`).all(m.id, ...slugs);
    const msg = run(works, req.body, m.handle, m);
    if (req.body.do === 'publish' && app.locals.legal && works.length) { try { app.locals.legal.accept('maker', m.id, 'makers', req.ip, 'batch'); } catch (e) { /* quiet */ } }
    if (req.body.json) { // the Library (25 Oct): the answer and each work's state, so the tiles repaint without a reload
      const now = db.prepare(`SELECT slug, status, stars, curated, flag, place, kind FROM works WHERE maker_id=? AND slug IN (${slugs.map(() => '?').join(',')})`).all(m.id, ...slugs);
      return res.json({ ok: true, msg, works: now.map(w => ({ slug: w.slug, status: w.status === 'held' ? 'public' : w.status === 'hidden' ? 'private' : w.status, stars: w.stars || 0, curated: !!w.curated, flag: w.flag || null, place: w.place || '', kind: w.kind || 'photograph' })) });
    }
    res.redirect('/account?ok=' + encodeURIComponent(msg) + '#works');
  });
  app.post('/studio/works/batch', studioOnly, (req, res) => {
    const slugs = parse(req.body.slugs); if (!slugs.length) return res.redirect('/studio/trove?ok=' + encodeURIComponent('Tick some works first.'));
    const works = db.prepare(`SELECT * FROM works WHERE slug IN (${slugs.map(() => '?').join(',')})`).all(...slugs);
    const msg = run(works, { ...req.body, attest: req.body.do === 'publish' ? '1' : req.body.attest }, 'studio', null);
    const back = /^\/studio\/(trove|works)/.test(String(req.body.back || '')) ? String(req.body.back).slice(0, 200) : '/studio/trove';
    res.redirect(back + (back.includes('?') ? '&' : '?') + 'ok=' + encodeURIComponent(msg));
  });
  // The bar, as HTML, for either list.
  const bar = ({ action, studio = false, back = '' }) => `<div class="bt-bar" data-bt-bar hidden><span class="bt-n"><b data-bt-n>0</b> selected</span>
<button type="button" class="link" data-bt-all>All</button><button type="button" class="link" data-bt-none>None</button>
<span class="bt-acts">
<button class="buy-btn bt-pub" name="do" value="publish" data-bt-publish>Publish</button>
<button class="link" name="do" value="hide">Make private</button>
<label class="bt-stars">Stars <select name="stars"><option value="">…</option><option value="5">5</option><option value="4">4</option><option value="3">3</option><option value="2">2</option><option value="1">1</option><option value="0">0, clear</option></select><button class="link" name="do" value="stars">Grade</button></label>
<label class="bt-place">Place <input name="place" placeholder="Florence, Italy"><button class="link" name="do" value="place">Set</button></label>
${studio ? `<button class="link" name="do" value="curate">Curated</button><button class="link" name="do" value="uncurate">Not curated</button>` : ''}
</span>
<label class="bt-attest" data-bt-attest hidden><input type="checkbox" name="attest" value="1"> I hold the rights to these, and releases for anyone identifiable, and I accept <a href="/legal/makers" target="_blank">the Maker Agreement</a></label>
${back ? `<input type="hidden" name="back" value="${back.replace(/"/g, '&quot;')}">` : ''}</div>`;
  app.locals.batch = { bar };
}
module.exports = { mountBatch };
