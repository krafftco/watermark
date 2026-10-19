// The Keys (Will, 19 Oct): the house's private members' club, Krafft's, across Studios and Watermark; the balcony
// lounge above the Great Hall. Every maker, collector and curator holds keys; the Keys is where every conversation
// lives, and nothing social is ever on the wall. Keys are earned, never bought: a maker's by invitation (a studio
// opened), a collector's with the first piece collected, a curator's by a maker's or the house's invitation (keys to
// an archive, a gallery, a wall shown). Each key is numbered in its kind, in the order given, and never reissued.
// Friends of the house is dues, not a door. This file: the keys themselves (`keys`), their issue and backfill,
// the door (/keys), and what the rest of the house asks: `holds(req)`.
const I = require('./icons');

const KINDS = { maker: 'The maker’s key', collector: 'The collector’s key', curator: 'The curator’s key' };

function mountKeys(app, { db, V, C, ledger, buyerOf, makerOf, isStudio }) {
  db.exec(`CREATE TABLE IF NOT EXISTS keys (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, maker_id INTEGER, buyer_id INTEGER, no INTEGER NOT NULL,
    how TEXT, at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(kind, maker_id), UNIQUE(kind, buyer_id));
    CREATE INDEX IF NOT EXISTS keys_buyer ON keys(buyer_id); CREATE INDEX IF NOT EXISTS keys_maker ON keys(maker_id)`);
  const { esc } = V;
  const next = kind => (db.prepare('SELECT COALESCE(MAX(no),0)+1 n FROM keys WHERE kind=?').get(kind).n);
  // Give a key, once. holder: { maker_id } or { buyer_id }. Returns the key row.
  function issue(kind, holder, how) {
    if (!KINDS[kind]) return null;
    const col = holder.maker_id ? 'maker_id' : 'buyer_id', id = holder.maker_id || holder.buyer_id; if (!id) return null;
    const had = db.prepare(`SELECT * FROM keys WHERE kind=? AND ${col}=?`).get(kind, id); if (had) return had;
    const no = next(kind);
    const kid = db.prepare(`INSERT INTO keys (kind, ${col}, no, how) VALUES (?,?,?,?)`).run(kind, id, no, how || null).lastInsertRowid;
    try { ledger.append(db, 'key.given', `${kind}-${no}`, { kind, no, how: how || null }); } catch (e) { /* */ }
    return db.prepare('SELECT * FROM keys WHERE id=?').get(kid);
  }
  const ofMaker = m => (m ? db.prepare('SELECT * FROM keys WHERE maker_id=? ORDER BY id').all(m.id) : []);
  const ofBuyer = b => (b ? db.prepare('SELECT * FROM keys WHERE buyer_id=? ORDER BY id').all(b.id) : []);
  // What this visitor holds: the union of their maker's and collector's keys, by kind.
  function holds(req) {
    const m = makerOf(req), b = buyerOf(req); const out = {};
    for (const k of [...ofMaker(m), ...ofBuyer(b)]) if (!out[k.kind] || out[k.kind].no > k.no) out[k.kind] = k;
    if (isStudio(req) && !Object.keys(out).length) out.house = { kind: 'house', no: 0 };
    return out;
  }
  const any = req => Object.keys(holds(req)).length > 0;

  // Backfill: everyone already in the house who has earned a key, in the order they earned it.
  function backfill() {
    let n = 0;
    for (const m of db.prepare("SELECT * FROM makers WHERE COALESCE(kind,'') NOT IN ('writer') ORDER BY COALESCE(joined_at, created_at, '9999'), id").all()) {
      if (m.kind === 'gallery') { if (issue('curator', { maker_id: m.id }, 'gallery')) n++; }
      else if (issue('maker', { maker_id: m.id }, 'studio')) n++;
    }
    for (const r of db.prepare(`SELECT l.buyer_id, MIN(l.starts_at) first FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.status IN ('active','expired') AND l.price_cents > 0 AND l.buyer_id IS NOT NULL AND u.key IN ('social','reference') GROUP BY l.buyer_id ORDER BY first, l.buyer_id`).all()) {
      if (issue('collector', { buyer_id: r.buyer_id }, 'collected')) n++;
    }
    try { for (const c of db.prepare("SELECT buyer_id, MIN(joined_at) j FROM curators WHERE status='on' AND buyer_id IS NOT NULL GROUP BY buyer_id ORDER BY j").all()) if (issue('curator', { buyer_id: c.buyer_id }, 'keys to an archive')) n++; } catch (e) { /* no curators yet */ }
    try { for (const h of db.prepare('SELECT buyer_id, MIN(created_at) j FROM hangs WHERE public=1 GROUP BY buyer_id ORDER BY j').all()) if (issue('curator', { buyer_id: h.buyer_id }, 'a wall shown')) n++; } catch (e) { /* */ }
    return n;
  }
  const n0 = backfill(); if (n0) console.log('[keys]', n0, 'keys given');
  // Keys are given the moment they are earned: on the register's own events, and by a sweep every ten minutes for the rest.
  const orig = ledger.append;
  ledger.append = function (d, type, subject, data) {
    const e = orig.apply(this, arguments);
    try {
      if (d === db && type === 'license.granted' && data && data.paid && ['social', 'reference'].includes(data.use)) { const l = db.prepare('SELECT buyer_id FROM licenses WHERE ref=?').get(subject); if (l && l.buyer_id) issue('collector', { buyer_id: l.buyer_id }, 'collected'); }
      if (d === db && type === 'hang.opened') { const h = db.prepare('SELECT buyer_id FROM hangs WHERE id=?').get(Number(String(subject).replace('hang-', ''))); if (h) issue('curator', { buyer_id: h.buyer_id }, 'a wall shown'); }
      if (d === db && (type === 'work.published' || type === 'maker.invited' || type === 'maker.introduced')) { const m = db.prepare('SELECT id, kind FROM makers WHERE handle=? OR id=?').get(String((data && data.maker) || subject), Number(String(subject).replace('maker-', '')) || 0); if (m && m.kind !== 'writer') issue(m.kind === 'gallery' ? 'curator' : 'maker', { maker_id: m.id }, 'studio'); }
    } catch (x) { console.error('[keys]', x.message); }
    return e;
  };

  // The brass key, with its number, shown on a studio, a gallery, a page.
  const tag = (k, { link = true } = {}) => (k ? `<${link ? 'a href="/keys"' : 'span'} class="key-tag key-${esc(k.kind)}" title="${esc(KINDS[k.kind] || 'The Keys')}">${I.key}<span>The Keys · No. ${k.no}</span></${link ? 'a' : 'span'}>` : '');
  const tags = ks => ks.map(k => tag(k)).join('');

  // The door.
  app.get('/keys', (req, res) => {
    const mine = holds(req); const kinds = Object.keys(mine).filter(k => k !== 'house');
    const counts = Object.fromEntries(db.prepare('SELECT kind, COUNT(*) n FROM keys GROUP BY kind').all().map(r => [r.kind, r.n]));
    const b = buyerOf(req), m = makerOf(req);
    const room = (kind, title, line, how, href, cta) => `<section class="ky-room ky-${kind}${mine[kind] ? ' held' : ''}"><div class="ky-key">${I.key}</div><p class="k">${esc(title)}</p><h2>${esc(line)}</h2><p>${how}</p>${mine[kind] ? `<p class="ky-no">Yours: No. ${mine[kind].no}. <a href="${href}">${cta} →</a></p>` : `<p class="ky-how">${counts[kind] || 0} given.</p>`}</section>`;
    res.send(V.layout({ title: 'The Keys · Watermark', path: '/keys', desc: 'The house’s private members’ club. Every maker, collector and curator holds keys.', body: `<section class="ky"><header class="ky-h"><p class="k">The house</p><h1>The Keys.</h1>
<p class="lede">The galleries are silent, as a museum’s are. Above them is the balcony, where the members talk: about what they just saw, what they hold, what they are making. The Keys is the house’s private members’ club. Keys are earned, never bought. ${kinds.length ? `You hold ${kinds.length === 1 ? 'one' : kinds.length}.` : 'Anyone may look in through the window.'}</p>
<p class="ky-q">Are you a maker, a collector, or a curator?</p></header>
<div class="ky-rooms">
${room('maker', KINDS.maker, 'You make the work.', 'Given with a studio, by invitation. It opens your archive, kept forever; your page; your prices; the register; the print room; the piano, where new work is shown first; and a night of your own to host.', m ? '/account' : '/makers', m ? 'Your studio' : 'Apply')}
${room('collector', KINDS.collector, 'You keep the work.', 'Given with the first piece you collect. It opens your gallery and your walls, the benches under every work, the balcony, and the dinner. The first hundred collectors are founders, for good.', b ? '/yours' : '/collection', 'Your gallery')}
${room('curator', KINDS.curator, 'You choose what hangs.', 'Given by a maker who hands you the keys to an archive, by a gallery that opens here, or when a wall you hung is shown and placed. It opens the archives you have been given, the right to hang shows, the curation share, and hosting.', '/curate', 'The archives open to you')}
</div>
<section class="ky-rules"><h2>The rules of the house.</h2><ul>
<li><b>Nothing social on the wall.</b> No comment, count or feed ever sits beside a work. The talk is here, one door away.</li>
<li><b>You may speak once you have stood before it.</b> A bench under a work opens to those who have looked, held, or been well seen.</li>
<li><b>Signed, and a sentence at least.</b> No reactions, no down-votes, no leaderboard. The makers’ and curators’ regard is the only rating.</li>
<li><b>Hours.</b> The balcony opens in the evening and closes at midnight; the night is shelved for those who were there.</li>
<li><b>Discretion.</b> No one’s looking is shown to anyone. What is said on the balcony stays with the members of that night.</li>
<li><b>The dinner.</b> Once a month, twelve keyholders at one table, in a city. Shot by Studios.</li></ul>
<p class="ky-foot"><a href="/balcony">The balcony</a> opens in the evening; the benches are under every work and wall. <a href="/friends">Friends of the house</a> is how members give more; it opens nothing on its own.</p></section></section>` }));
  });
  app.locals.keys = { issue, holds, any, ofMaker, ofBuyer, tag, tags, KINDS, backfill };
  return app.locals.keys;
}
module.exports = { mountKeys, KINDS };
