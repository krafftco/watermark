// The director (Will, 19 Oct: "build up my image and my profile, like the person who runs the Met: an authoritative,
// dignified presence; the first founding artist, and the creator of this creative house"). The house's maker is its
// founding director: the one who founded the institution, set its standard, chooses who hangs, and whose work was
// first on the walls. /director: a portrait, the title, the standing in numbers the house can vouch for, the
// director's statement (a draft until Will confirms), the house's record, the family line to the Keys, a letter door.
// The title also stands on the maker page beside the roles. Dignified: one portrait, the serif, no hype.
function mountDirector(app, { db, V, C }) {
  const { esc } = V;
  const house = () => db.prepare('SELECT * FROM makers WHERE handle=?').get(C.maker.handle);
  const TITLE = 'Founding director';
  const isDirector = m => !!(m && house() && m.id === house().id);
  app.get('/director', (req, res) => {
    const m = house(); if (!m) return res.sendStatus(404);
    const n = {
      works: db.prepare("SELECT COUNT(*) n FROM works WHERE status='held'").get().n,
      own: db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held'").get(m.id).n,
      makers: db.prepare("SELECT COUNT(DISTINCT maker_id) n FROM works WHERE status='held'").get().n,
      collectors: db.prepare("SELECT COUNT(DISTINCT buyer_id) n FROM licenses WHERE buyer_id IS NOT NULL AND collector_no IS NOT NULL AND status IN ('active','expired')").get().n,
      register: db.prepare('SELECT COUNT(*) n FROM ledger').get().n,
      since: (db.prepare('SELECT MIN(at) a FROM ledger').get().a || '').slice(0, 10),
      institutions: db.prepare("SELECT COUNT(*) n FROM makers WHERE kind='institution'").get().n,
    };
    const key = app.locals.keys ? app.locals.keys.ofMaker(m).find(k => k.kind === 'maker') : null;
    const best = db.prepare("SELECT * FROM works WHERE maker_id=? AND status='held' ORDER BY stars DESC, curated DESC, id ASC LIMIT 6").all(m.id);
    const hero = best[0];
    const year = n.since ? n.since.slice(0, 4) : new Date().getFullYear();
    res.send(V.layout({ title: `${m.name}, founding director · Watermark`, path: '/director', desc: `${m.name}: founding artist and founding director of Watermark, a Krafft company.`, image: hero ? `/img/${hero.slug}/screen` : null, body: `<article class="dr">
<header class="dr-h">${m.portrait ? `<img class="dr-por" src="/portrait/${esc(m.handle)}" alt="${esc(m.name)}">` : hero ? `<img class="dr-por dr-por-w" src="/img/${esc(hero.slug)}/screen" alt="">` : ''}<div class="dr-hd"><p class="k">The house</p><h1>${esc(m.name)}.</h1><p class="dr-title">${TITLE} of Watermark · Founding artist${key ? ` · The maker’s key, No. ${key.no}` : ''}</p>
<p class="lede">Founded the house in ${year}; set its standard; chooses who hangs; made the first work on its walls. Director of the museum, maker of the creative house: Krafft, of which Watermark is one company.</p></div></header>
<section class="dr-st"><p class="k">The director’s statement</p>
<p>There is no such thing as perfection in this work, and we seek it anyway, because the seeking is how you make people happy. That is what the house is for: to make people happy; to build beautiful places for beautiful work to be seen in; and to see that the people who make the work are paid.</p>
<p>Everything here is run as hospitality. You are our honoured guest. This is our house and our home, and you are welcome in it. We hope you come back.</p>
<p class="dr-sig">${esc(m.name)}</p><p class="note">A draft, in the director’s voice, until he confirms it.</p></section>
<section class="dr-nums"><div><b>${n.works.toLocaleString('en-US')}</b><span>works held</span></div><div><b>${n.makers}</b><span>maker${n.makers === 1 ? '' : 's'}</span></div><div><b>${n.collectors}</b><span>collector${n.collectors === 1 ? '' : 's'}</span></div><div><b>${n.register.toLocaleString('en-US')}</b><span>entries on the register${n.since ? `, since ${esc(n.since)}` : ''}</span></div>${n.institutions ? `<div><b>${n.institutions}</b><span>institution${n.institutions === 1 ? '' : 's'}</span></div>` : ''}</section>
${best.length ? `<section class="dr-own"><p class="k">From the director’s own hand</p><div class="dr-grid">${best.map(w => `<a class="pl" href="/m/${esc(m.handle)}/${esc(w.slug)}" style="--r:${(w.width && w.height ? w.width / w.height : 1.5).toFixed(3)}"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(w.title)}" loading="lazy" draggable="false"></a>`).join('')}</div><p><a href="/m/${esc(m.handle)}">${n.own} works held · the body of work →</a></p></section>` : ''}
<section class="dr-line"><p class="k">The line</p><p>The house carries a family name. The Keys, its members’ club, is named for the restaurant the director’s great-grandmother kept on North Meridian Street, Indianapolis, from 1947, where the keys given to guests opened the front door. <a href="/keys/story">The story →</a></p></section>
<section class="dr-ask"><p class="k">By letter</p><p>For institutions, the press, and matters of the house: <a href="mailto:${esc(process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com')}">${esc(process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com')}</a>. <a href="/about">Why the house exists</a> · <a href="/museums">For museums</a> · <a href="/keys">The Keys</a>.</p></section>
</article>` }));
  });
  app.locals.director = { TITLE, isDirector, house };
  return app.locals.director;
}
module.exports = { mountDirector };
