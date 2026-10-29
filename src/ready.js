// Ready to hang (Will, 20 Oct: the stock agencies once made a career possible; Watermark is the 21st-century version:
// "when your work is ready to be shown, when people will pay you for it, that's when you're ready for Watermark; you
// can put it in beforehand, but there is a moment when it is worth presenting"; and the house must not become "a
// tranche of shit": it has to hold up as a museum, and wandering has to be through great work; the record is the
// frame on your own wall, celebrated; the house teaches a discipline: see your work as worth making).
//   Two floors. The record (free, open): every work kept, fingerprinted, deeded, the maker's own. The house (by
//   invitation): hung, sold, in the walks. The moment between is read from what the house can see, not a feeling:
//   a body of work, an edit the maker made, professional files, a page and prices. Then the house looks, in a
//   review room, at the edit large, and hangs the first show itself or writes back.
//   What wanders is the edit: the stroll, Wander and today's draw only from 3 stars and up or what the house has
//   marked, once the house holds WANDER_FLOOR of it; below that, everything held, so a small house is never empty.
const READY_WORKS = Number(process.env.READY_WORKS || 12);   // a body of work recorded (a draft)
const READY_BEST = Number(process.env.READY_BEST || 8);      // the edit: graded 4 or 5 by the maker (a draft)
const READY_MP = Number(process.env.READY_MP || 12);         // professional files: the edit at 12 MP and up
const WANDER_FLOOR = Number(process.env.WANDER_FLOOR || 40);

function mountReady(app, { db, V, C, ledger, mail, studioOnly, makerOf }) {
  const { esc, tidy } = V;
  const dayOf = s => new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z')).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  // The readiness of a maker, in real numbers.
  function readiness(m) {
    const all = db.prepare("SELECT id, slug, title, place, caption, note, stars, width, height, camera, taken_at, status FROM works WHERE maker_id=? AND status IN ('held','hidden') ORDER BY stars DESC, id").all(m.id);
    const edit = all.filter(w => (w.stars || 0) >= 4);
    const prepared = w => !!(w.title && w.place && (w.caption || w.note));
    const big = edit.filter(w => (w.width || 0) * (w.height || 0) >= READY_MP * 1e6);
    const page = !!((m.bio && m.bio.length > 20) || m.portrait);
    const priced = db.prepare('SELECT COUNT(*) n FROM uses WHERE maker_id=? AND price_cents>0').get(m.id).n > 0;
    const steps = [
      { key: 'record', t: 'Record', done: all.length >= READY_WORKS, line: all.length ? `${all.length} of ${READY_WORKS} works in the vault, each deeded and yours.` : `Bring in what you made, ${READY_WORKS} works or more. Each file gets its deed the moment it arrives.`, href: '/account/upload' },
      { key: 'edit', t: 'The edit', done: edit.length >= READY_BEST && edit.every(prepared), line: `Grade your work with stars and give each of your best a title, a place, a date and a sentence. The house looks at your four- and five-star work, ${READY_BEST} pieces or more; ${edit.length} so far${edit.length && !edit.every(prepared) ? `, ${edit.filter(w => !prepared(w)).length} not yet prepared` : ''}.`, href: '/account' },
      { key: 'files', t: 'The files', done: edit.length > 0 && big.length === edit.length, line: `Your edit at ${READY_MP} megapixels or more, so it can be printed, published and sold at every size. ${edit.length ? `${big.length} of ${edit.length} are.` : ''}`, href: '/account' },
      { key: 'page', t: 'Your page and your prices', done: page && priced, line: 'Who you are, in your own words, with a portrait; what each use costs, or “ask”.', href: '/account/profile' },
    ];
    return { all, edit, big, steps, can: steps.every(s => s.done) };
  }
  app.locals.readiness = readiness;

  // The review room: the house looks at the edit, large, and decides.
  app.get('/studio/review/:id', studioOnly, (req, res) => {
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(Number(req.params.id)); if (!m) return res.sendStatus(404);
    const r = readiness(m);
    const ask = db.prepare('SELECT * FROM house_asks WHERE maker_id=? ORDER BY id DESC LIMIT 1').get(m.id);
    const show = r.edit.length ? r.edit : r.all.slice(0, 12);
    const cams = [...new Set(show.map(w => w.camera).filter(Boolean))];
    const body = `<article class="rv"><p class="k">The house looks</p><h1>${esc(m.name)}</h1>
<p class="lede">${esc(m.place || '')}${m.place ? ' · ' : ''}${r.all.length} works recorded · ${r.edit.length} in the edit · ${r.big.length} of the edit at ${READY_MP} MP+ · ${cams.length ? `made on ${esc(cams.join(', '))}` : 'no camera recorded'} · ${m.door === 'record' ? 'the record' : 'the house'}</p>
${ask && !ask.answer ? `<p class="rv-ask">Asked on ${esc(dayOf(ask.at))}${ask.note ? `: <em>${esc(ask.note)}</em>` : ''}</p>` : ''}
${m.bio ? `<blockquote class="rv-bio">${esc(m.bio)}</blockquote>` : '<p class="note">No bio yet.</p>'}
<ol class="way-s rv-steps">${r.steps.map(s => `<li class="${s.done ? 'done' : ''}"><b>${esc(s.t)}</b><span>${esc(s.line)}</span></li>`).join('')}</ol>
<p class="note">The house has its own eye and never tells an artist what to make. It looks for craft, honesty and a body of work. Tick what the first show should hold; the rest stays in the record, the maker's, until they publish it themselves.</p>
<form method="post" action="/studio/accounts/${m.id}/invite" class="rv-f">
<div class="rv-grid">${show.map(w => `<label class="rv-w"><input type="checkbox" name="hang" value="${esc(w.slug)}"${(w.stars || 0) >= 4 ? ' checked' : ''}><img src="/img/${esc(w.slug)}/screen" alt="" loading="lazy"><span class="rv-cap">${esc(tidy(w.title || w.slug))}${w.place ? ` · ${esc(w.place)}` : ''} · ${'★'.repeat(w.stars || 0) || 'ungraded'} · ${w.width && w.height ? Math.round(w.width * w.height / 1e6) + ' MP' : '?'}${w.status === 'held' ? ' · hung' : ''}</span></label>`).join('')}</div>
<p class="rv-acts"><button class="buy-btn">Invite to the house and hang the first show</button></p></form>
<form method="post" action="/studio/accounts/${m.id}/answer" class="rv-f rv-no"><label>Not yet: a word back, in the house's voice (what you saw, and what would bring it in)<textarea name="answer" maxlength="600" rows="3"></textarea></label><button class="link">Send the word</button></form>
<p><a href="/studio/accounts">Back to Accounts</a> · <a href="/account?maker=${esc(m.handle)}">Walk their studio</a></p></article>`;
    res.send(V.layout({ title: `The house looks · ${m.name}`, path: '/studio', body, desk: true }));
  });

  // The edit wanders. A fragment for the walks: when the house holds enough graded work, only the edit.
  let floorAt = 0, floorOk = false;
  app.locals.editSql = (alias = 'w') => {
    if (Date.now() - floorAt > 60000) { floorAt = Date.now(); floorOk = db.prepare("SELECT COUNT(*) n FROM works WHERE status='held' AND (stars>=3 OR curated=1)").get().n >= WANDER_FLOOR; }
    const hall = app.locals.museums ? app.locals.museums.hallSql(alias) : ''; // the house's halls hold what was placed (museums.js)
    return (floorOk ? ` AND (${alias}.stars>=3 OR ${alias}.curated=1)` : '') + hall;
  };
  app.locals.ready = { READY_WORKS, READY_BEST, READY_MP, WANDER_FLOOR };
}
module.exports = { mountReady, READY_WORKS, READY_BEST, READY_MP, WANDER_FLOOR };
