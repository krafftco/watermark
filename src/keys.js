// The Keys (Will, 19 Oct): the house's private members' club, Krafft's, across Studios and Watermark; the balcony
// lounge above the Great Hall. Every maker, collector and curator holds keys; the Keys is where every conversation
// lives, and nothing social is ever on the wall. Keys are earned, never bought: a maker's by invitation (a studio
// opened), a collector's with the first piece collected, a curator's by a maker's or the house's invitation (keys to
// an archive, a gallery, a wall shown). Each key is numbered in its kind, in the order given, and never reissued.
// Friends of the house is dues, not a door. This file: the keys themselves (`keys`), their issue and backfill,
// the door (/keys), and what the rest of the house asks: `holds(req)`.
const I = require('./icons');
const fs = require('fs');
const path = require('path');

const KINDS = { maker: 'The maker’s key', collector: 'The collector’s key', curator: 'The curator’s key' };

// The marks of the Keys (Will, 19 Oct): the matchbook of the Keys restaurant, Indianapolis, born 1947, vectorised
// by Will (THE_KEYS/the_keys.ai): the wordmark 'The KEYS' (the word Restaurant taken off, Will 19 Oct: the Keys is the club now) and the bunch of keys on their tassel.
// Family material; free to use. Inlined so they take the page's colour.
const MARK = {};
for (const n of ['bunch', 'mark', 'matchbook']) { try { MARK[n] = fs.readFileSync(path.join(__dirname, '..', 'public', 'keys', n + '.svg'), 'utf8').replace('<svg ', `<svg class="kmk kmk-${n}" aria-hidden="true" `); } catch (e) { MARK[n] = ''; } }

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

  // The rooms of the club (Will, 19 Oct: the Keys is the club; open all day and night, all over the world, so it
  // needs rooms, each curated, some kept for certain hours; paint the scene, after the Morgan's library; and, for the
  // day the house holds raw masters of sound and film, a listening room and a screening room). Each room: where it
  // leads, its hours, whether it is open now; a room not yet built is shown with its door closed, so the house is
  // honest about what is coming.
  function rooms() {
    const bal = app.locals.balcony ? app.locals.balcony.state() : null; const open = !!(bal && bal.open);
    const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: process.env.BALCONY_TZ || 'America/New_York' }).format(new Date()));
    return [
      { key: 'lounge', name: 'The Bar Lounge', line: 'Where the pictures of who came hang. The benches: one under every work and every wall, the talk kept, signed, a sentence at least.', hours: 'Always open', now: true, href: '/bench', cta: 'Find a bench', glyph: 'stand' },
      { key: 'champagne', name: 'The Champagne Room', line: 'The balcony. A host, a wall for the night, the piano for new work, a word between two people. Nothing said is kept.', hours: `Nine in the evening to midnight, New York time${open ? '' : ` · opens in ${((21 - hour) + 24) % 24 || 24} hour${((21 - hour) + 24) % 24 === 1 ? '' : 's'}`}`, now: open, href: '/balcony', cta: open ? 'Go up' : 'Look through the window', glyph: 'key' },
      { key: 'library', name: 'The Library', line: 'The shelf of texts, the study beneath every guide, the atelier’s guides to the craft. Read in your own time.', hours: 'Always open', now: true, href: '/library', cta: 'Read', glyph: 'guide' },
      { key: 'viewing', name: 'The Viewing Room', line: 'The photograph alone on a dark wall, the guide read aloud, the next decoded while you stand. The stroll on a phone; the long gallery in a headset.', hours: 'Always open', now: true, href: '/stroll', cta: 'Wander', glyph: 'wave' },
      { key: 'print', name: 'The Print Room', line: 'Pigment on cotton rag from the house’s own press. The proof, the sizes your file prints at, and how to hang it at fifty-seven inches.', hours: 'Always open · prints posted within the week', now: true, href: '/print', cta: 'Print your work', glyph: 'page' },
      { key: 'keyhole', name: 'The Keyhole Room', line: 'The dinner. Twelve at one table with a maker, in a city, once a month, shot by Studios. Not first come: names go down and the house draws the table, the Circle first. Elegant privacy in entertaining.', hours: 'Monthly · by the draw', now: true, href: '/season', cta: 'Put your name down', glyph: 'card' },
      { key: 'season', name: 'The Season', line: 'The nights the house throws, in the real world: openings, late nights, salons with the makers, screenings, walks. Who is coming, by first name; leave your card for anyone there.', hours: 'In a city near you', now: true, href: '/season', cta: 'The nights', glyph: 'card' },
      { key: 'circle', name: 'The Circle', line: 'The young members, under forty, by the year. Every night first; the dinner; the artists; the introductions. The coolest room in the house, and it is the people.', hours: 'By the year', now: true, href: '/circle', cta: 'Join the Circle', glyph: 'key' },
      { key: 'listening', name: 'The Listening Room', line: 'Hi-fi. The raw master of a recording, played as it was made, on the house’s own system; vinyl when the house presses it. A room for the day the vault holds sound.', hours: 'Not yet open', now: false, soon: true, href: null, cta: 'Someday', glyph: 'pause' },
      { key: 'screening', name: 'The Screening Room', line: 'Not a stream: a private screening. Films chosen by the people who make them and the people who restore them, shown whole, at the highest resolution the master allows, in surround sound, to your home theatre; it plays through, as a cinema does, and a pause opens the filmmaker’s notes. The Paris, the Metrograph, at home. A room for the day the vault holds moving pictures.', hours: 'Not yet open', now: false, soon: true, href: null, cta: 'Someday', glyph: 'play' },
    ];
  }
  const roomCard = r => `<${r.href ? `a href="${esc(r.href)}"` : 'div'} class="kr${r.now ? ' open' : ''}${r.soon ? ' soon' : ''}"><span class="kr-g">${I[r.glyph] || I.key}</span><span class="kr-st">${r.now ? 'Open now' : r.soon ? 'Not yet open' : 'Closed'}</span><b>${esc(r.name)}</b><i>${esc(r.line)}</i><small>${esc(r.hours)}</small><em>${esc(r.cta)}${r.href ? ' →' : ''}</em></${r.href ? 'a' : 'div'}>`;
  app.locals.keyRooms = rooms;

  // The door.
  app.get('/keys', (req, res) => {
    const mine = holds(req); const kinds = Object.keys(mine).filter(k => k !== 'house');
    const counts = Object.fromEntries(db.prepare('SELECT kind, COUNT(*) n FROM keys GROUP BY kind').all().map(r => [r.kind, r.n]));
    const b = buyerOf(req), m = makerOf(req);
    const room = (kind, title, line, how, href, cta) => `<section class="ky-room ky-${kind}${mine[kind] ? ' held' : ''}"><div class="ky-key">${I.key}</div><p class="k">${esc(title)}</p><h2>${esc(line)}</h2><p>${how}</p>${mine[kind] ? `<p class="ky-no">Yours: No. ${mine[kind].no}. <a href="${href}">${cta} →</a></p>` : `<p class="ky-how">${counts[kind] || 0} given.</p>`}</section>`;
    res.send(V.layout({ title: 'The Keys · Watermark', path: '/keys', desc: 'The house’s private members’ club, since 1947. Every maker, collector and curator holds keys.', body: `<section class="ky">
<header class="ky-cover"><div class="ky-cover-in"><a class="ky-mark" href="/keys/story" title="The story of the Keys">${MARK.mark}</a><p class="ky-since">Indianapolis, 1947 · Watermark, 2026</p></div><div class="ky-damask" aria-hidden="true"></div></header>
<div class="ky-h"><p class="k">The house</p><h1>The Keys.</h1>
<p class="lede">The Keys is the club: the house’s own, private, for its members. The galleries below are silent, as a museum’s are; up here the members talk, about what they just saw, what they hold, what they are making. Keys are earned, never bought. ${kinds.length ? `You hold ${kinds.length === 1 ? 'one' : kinds.length}.` : 'Anyone may look in through the window.'}</p>
<p class="ky-comm"><span class="ky-script">Keys Comments</span> The Keys was born in 1947 on North Meridian Street, Indianapolis, a restaurant kept by two sisters; the keys it gave its guests opened the front door. The house carries the name, the keys and the manner on. <a href="/keys/story">The story →</a></p>
<p class="ky-ep">“It is my extreme pleasure to welcome you among our honored guests.” <span>Mary Helen Krafft, 1968. The house’s standard since.</span></p>
<p class="ky-q">Are you a maker, a collector, or a curator?</p></div>
<div class="ky-rooms">
${room('maker', KINDS.maker, 'You make the work.', 'Given with a studio, by invitation. It opens your archive, kept forever; your page; your prices; the register; the print room; the piano, where new work is shown first; and a night of your own to host.', m ? '/account' : '/makers', m ? 'Your studio' : 'Apply')}
${room('collector', KINDS.collector, 'You keep the work.', `Given with the first piece you collect. It opens your gallery and your walls, the benches under every work, the balcony, and the dinner. The first hundred collectors are founders, for good.${(() => { const F = app.locals.founders && app.locals.founders.first(); return F ? ` The first collector of the house: ${F.public && F.code ? `<a href="/g/${esc(F.code)}">${esc(F.name || 'a collector')}</a>` : esc(F.name || 'a collector')}${app.locals.founders.note() ? `, ${esc(app.locals.founders.note())}` : ''}.` : ''; })()}`, b ? '/yours' : '/collection', 'Your gallery')}
${room('curator', KINDS.curator, 'You choose what hangs.', 'Given by a maker who hands you the keys to an archive, by a gallery that opens here, or when a wall you hung is shown and placed. It opens the archives you have been given, the right to hang shows, the curation share, and hosting.', '/curate', 'The archives open to you')}
</div>
<section class="ky-rm"><p class="k">The club</p><h2>The rooms.</h2><p class="ky-rml">Open all day and all night, all over the world. Some rooms keep hours; the rest are always lit. Each is curated: a host, a wall, a programme. Two are built for a day the house has not yet reached, and their doors say so.</p><div class="kr-grid">${rooms().map(roomCard).join('')}</div><p class="ky-rml ky-enjoy">The rooms reach into your own: <a href="/enjoy">how to enjoy the work in the real world</a>, on a television, through good speakers, in a headset, on paper.</p></section>
<section class="ky-rules" id="dinner"><h2>The rules of the house.</h2><ul>
<li><b>Nothing social on the wall.</b> No comment, count or feed ever sits beside a work. The talk is here, one door away.</li>
<li><b>You may speak once you have stood before it.</b> A bench under a work opens to those who have looked, held, or been well seen.</li>
<li><b>Signed, and a sentence at least.</b> No reactions, no down-votes, no leaderboard. The makers’ and curators’ regard is the only rating.</li>
<li><b>Hours.</b> The balcony opens in the evening and closes at midnight; the night is shelved for those who were there.</li>
<li><b>Discretion.</b> No one’s looking is shown to anyone. What is said on the balcony stays with the members of that night.</li>
<li><b>The dinner.</b> Once a month, twelve keyholders at one table, in a city. Shot by Studios.</li></ul>
<p class="ky-foot"><a href="/balcony">The balcony</a> opens in the evening; the benches are under every work and wall. <a href="/friends">Friends of the house</a> is how members give more; it opens nothing on its own.</p></section></section>` }));
  });

  // The story (Will, 19 Oct: "my great-grandmother started this restaurant, the Keys; we need to tell that story",
  // and the story of the name). From the Keys' own 1968 menu (Keys Comments, signed Mary Helen Krafft, Mrs. Wm. R.)
  // and Will. Every word a draft for Will; the blanks in the name's story are his to fill.
  app.get('/keys/story', (req, res) => {
    const menu = (n, cap) => `<figure class="ks-menu"><img src="/static/keys/menu-${n}.jpg" alt="${esc(cap)}" loading="lazy"><figcaption>${esc(cap)}</figcaption></figure>`;
    res.send(V.layout({ title: 'The story of the Keys · Watermark', path: '/keys/story', desc: 'The Keys was born in 1947 on North Meridian Street, Indianapolis. The house carries the name, the keys and the manner on.', body: `<article class="ks">
<header class="ks-cover"><div class="ks-cover-in">${MARK.matchbook}</div><div class="ky-damask" aria-hidden="true"></div></header>
<div class="ks-body">
<p class="k">The house · <a href="/keys">The Keys</a></p>
<h1>Born in 1947.</h1>
<p class="lede">A restaurant on North Meridian Street, Indianapolis, kept by two sisters. The keys it gave its guests opened the front door. Seventy-nine years on, the house gives keys again.</p>

<h2 class="ky-script">The restaurant</h2>
<p>The Keys opened in 1947 at 1820 North Meridian Street, in a mansion built around 1890, one of the supper clubs that made North Meridian the street to dine on. Two sisters began it; one of them, Mary Helen Krafft, kept it as proprietress for the decades that followed. Her portrait, painted by the Swiss artist Hans Limbach in 1947, hung on the right wall of the foyer; the portrait of her husband, William R. Krafft, hung on the left. Over the bar was a photograph of the Indiana State Capitol taken in 1937, and through the lounge and the rooms hung paintings by European and Indiana artists.</p>
<p>The original keys issued to guests were used to open the front door. Over the years, by the restaurant’s own count, many thousands of them went home with guests from France, England, Holland, Belgium, Saudi Arabia, Colombia, Brazil, South Africa, Italy, Germany. The bar lounge kept the pictures of the famous who came: Clare Boothe Luce, Helen Hayes, Arnold Palmer, Alan Shepard, Walter Cronkite, Barbara Stanwyck, Liberace, Gene Autry, Victor Borge, Arthur Godfrey, and diplomats of many nations.</p>
<p>The private rooms were the Champagne Room, the Arthur Godfrey Room and the Keyhole Room, furnished with antiques, “for persons wishing elegant privacy in entertaining.” The beef and the pork were the Keys’ own: Blue Ribbon steers and swine shown each year at the State Fair and raised on the family’s Fulton County farm. The menu won nine Holiday Magazine awards for dining distinction and carried the house’s one plea: <em>“The essence of culinary art is time. We ask your kind indulgence.”</em></p>
<p>Each menu closed with a column headed <span class="ky-script">Keys Comments</span>, signed <span class="ks-sig">Mary Helen Krafft</span> (Mrs. Wm. R.): “It is my extreme pleasure to welcome you among our honored guests.”</p>

<div class="ks-menus">${menu(1, 'The menu’s cover: red damask, the keys in gold. 1968.')}${menu(4, 'The back page: the rooms, Keys Comments, and the front door. 1968.')}${menu(3, 'From the Roaster and Broiler; From the Sea and Stream; From Our Indiana Farm.')}${menu(2, 'Fine Wines; Appetizers; the Keys’ Caesar, tossed at the table.')}</div>

<h2 class="ky-script">The name</h2>
<p>Krafft is the family name on the restaurant’s door: Mary Helen Krafft’s, and William R. Krafft’s, whose portrait faced hers across the foyer. The Krafft men sold automobiles in Indianapolis; the restaurant and the dealership were the same family, the same street life, the same era of the city. <span class="ks-blank">[Will: the dealership’s name, the make, the years, and Ed Krafft’s place in the line, from the pictures and obituaries. The family tree runs from them to you.]</span></p>
<p>Krafft, the company, takes the name forward: Design, Studios and Ventures, of which Watermark is one. The Keys at Watermark is the family’s restaurant brought to the 21st century: a clubhouse for the people who make, keep and choose the work, with the same rules of hospitality. You are welcomed by name. The talk is at the table, not on the wall. What is said in the room stays with the people who were there. And the keys are given, never sold.</p>

<h2 class="ky-script">What carries over</h2>
<ul class="ks-list">
<li><b>The keys.</b> A guest of the restaurant left with a key to the front door. A maker, a collector or a curator of the house holds a numbered key: the maker’s, the collector’s, the curator’s.</li>
<li><b>The rooms.</b> The benches under every work are the bar lounge, where the pictures of who came hang. The balcony is the Champagne Room, open in the evening, with a host. The dinner is the Keyhole Room: twelve at one table, in a city, once a month.</li>
<li><b>The manner.</b> Signed, a sentence at least; the house’s regard the only rating; discretion. “The essence of culinary art is time.” So is the essence of looking.</li>
<li><b>The look.</b> Red damask, the keys in gold, the script. The matchbook said <i>close cover before striking</i>; the house says <i>look before you speak</i>.</li>
</ul>
<p class="ks-draft">A draft, from the Keys’ 1968 menu and family memory, for Will to confirm.</p>
<p class="ky-foot"><a href="/keys">The Keys</a> · <a href="/balcony">The balcony</a></p>
</div></article>` }));
  });

  // Enjoying it in the real world (Will, 19 Oct: tell people how to get more out of the experience; Sonos, Dolby
  // Atmos and Vision, stereo, the left and the right speaker; real ways to enjoy art in the real world). A guide, not
  // a shop: the house names what helps and never sells it. Words a draft.
  app.get('/enjoy', (req, res) => {
    res.send(V.layout({ title: 'Enjoying it in the real world · The Keys · Watermark', path: '/enjoy', desc: 'How to get more from the work: on a television, through good speakers, in a headset, on paper.', body: `<section class="ej"><p class="k"><a href="/keys">The Keys</a> · The rooms</p><h1>Enjoying it in the real world.</h1>
<p class="lede">The house is built to be seen on a phone, and built harder to be seen off one. These are the ways the rooms reach into yours: none of them required, each of them a step up. The house sells none of this; it only says what helps.</p>
<section class="ej-s"><h2>On the wall at home: a television.</h2><p>Any television becomes a wall with <a href="/frame">the frame</a>: a set of works, chosen for the evening, cross-fading slowly, the plate shown for a moment. Turn the picture mode to <i>Filmmaker</i> or <i>Cinema</i> and motion smoothing off; a photograph wants no processing. A Samsung Frame or an OLED hung at eye level, fifty-seven inches to the centre, is the museum’s own height. Dim the room. The work carries the light.</p></section>
<section class="ej-s"><h2>In your ears: the guide, read.</h2><p>Every guide is read aloud in the house voice. Headphones, or one good speaker, are enough. If you listen through a Sonos or any pair of speakers, sit between them: the voice is mixed for a room, not a phone, and a reading heard from the middle of the room is a different thing from one heard from your hand.</p></section>
<section class="ej-s"><h2>Someday, the sound and the film: Atmos, Vision, surround.</h2><p>When the vault holds raw masters of sound and moving pictures, the listening room and the screening room will play them as they were made: a recording in stereo, the left and the right exactly as the engineer placed them, or in Dolby Atmos where it was mixed that way; a film in Dolby Vision and surround sound to a home theatre, shown whole. Until then: a receiver that passes Atmos and Vision, a pair of good speakers set at ear height and as far from each other as they are from you, and a screen that does not smooth motion. That is the whole of it.</p></section>
<section class="ej-s"><h2>In a headset.</h2><p>Any wall or gallery opens in <a href="/vr?in=collection">the long gallery, the rotunda, or the night</a> on a Quest, a Vision Pro or any WebXR browser. Stand before a work at its true size; walk to the next. The grand spaces the work deserves, without the flight.</p></section>
<section class="ej-s"><h2>On paper.</h2><p>Nothing is finished until it is printed. <a href="/print">The print room</a> says what your file prints at, on which paper, and how to frame it; the proof, a five by seven on cotton rag from the house’s own press, is the first object most collectors own.</p></section>
<section class="ej-s"><h2>In person.</h2><p>The dinner, once a month, twelve keyholders at one table; the openings; the shows galleries mount here and in their rooms. The house is a place; it meets you in the world when it can.</p></section>
<p class="note">A draft, for Will to confirm. Brands are named for help, never for a fee.</p></section>` }));
  });
  app.locals.keys = { issue, holds, any, ofMaker, ofBuyer, tag, tags, KINDS, backfill, MARK };
  return app.locals.keys;
}
module.exports = { mountKeys, KINDS };
