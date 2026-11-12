// The artists behind the work (Will, 26 Oct: "if someone takes a photograph of a painting, we should create an artist
// profile for that maker, that they can claim; a photograph can show art, but at the end of the day it is associated
// with the person that made it; people go to museums, photograph the collection and upload it; I want to look at
// paintings, at contemporary art, at Jackson Pollock on Watermark").
//
// Two people stand behind a photograph of a painting: the one who made the painting and the one who made the
// photograph. The house has always kept the second (the maker). This is the first: `artists`, one record per artist of
// a depicted work, with a page (/art/<slug>), the works in the house that show their art (each the photograph of
// record, with its photographer credited), and a door to claim the page (the artist, an estate, a foundation).
//
// The rule that decides what sells, because it has to be said plainly before "photograph the Pollock" is said at all:
// the photograph of a work in the public domain (the artist dead seventy years and more; or the work made before
// 1929) is the photographer's to show and sell as any work. The photograph of a work under copyright is shown here
// and credited, never offered for Collect or licence by the house, until the artist or their estate claims the page
// and sets terms. The dates on the artist's record decide; `blocks(w)` is consulted by `offered` and `listed`.
// Counsel reads the rule before it is relied on. Public-domain arrivals from a museum (the Met's open access) bring
// their artist with them (name, dates, nationality), so /art fills from the first import.
'use strict';
const ROLE = require('./role');

const PD_YEARS = 70; // life plus seventy, the longest common term; the house takes the conservative side
const MODEL = () => process.env.CLOSER_MODEL || 'claude-sonnet-5-5';
const on = () => !!process.env.ANTHROPIC_API_KEY;
const MOVEMENTS = ['Renaissance', 'Baroque', 'Dutch Golden Age', 'Rococo', 'Neoclassicism', 'Romanticism', 'Realism', 'Impressionism', 'Post-Impressionism', 'Symbolism', 'Expressionism', 'Cubism', 'Surrealism', 'Abstract Expressionism', 'Pop Art', 'Minimalism', 'Contemporary', 'Photography', 'Folk art', 'Ancient', 'Medieval', 'Asian art', 'African art', 'Islamic art', 'Indigenous art'];

const slugify = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'artist';
const sortName = n => { const s = String(n || '').trim(); if (/,/.test(s)) return s; const p = s.split(/\s+/); return p.length > 1 ? `${p[p.length - 1]}, ${p.slice(0, -1).join(' ')}` : s; };
const yearOf = s => { const m = String(s || '').match(/\b(1[0-9]{3}|20[0-9]{2})\b/); return m ? +m[1] : null; };
const dates = a => a.born || a.died ? `${a.born || '?'}–${a.died || ''}` : '';

function rights(a, w) {
  const y = new Date().getFullYear();
  if (!a) return { state: 'none' };
  if (a.died && y - a.died > PD_YEARS) return { state: 'pd', why: `${a.name} died in ${a.died}; the work is in the public domain.` };
  if (!a.died && a.born && y - a.born > 170) return { state: 'pd', why: `${a.name} was born in ${a.born}; the work is in the public domain.` };
  const made = w && yearOf(w.taken_at); if (made && made <= y - 96) return { state: 'pd', why: `Made in ${made}; the work is in the public domain.` };
  if (a.claim_status === 'claimed' && a.sale_ok) return { state: 'claimed', why: `${a.name}${a.died ? '’s estate' : ''} holds the rights and has set terms with the house.` };
  const strict = process.env.ART_STRICT === '1';
  return { state: 'reserved', why: `${a.name}’s work is under copyright. A photograph of it is shown here and credited${strict ? '; the house does not sell or license it' : '; it may be collected for yourself, and the house does not license it for any other use'}. The rights are ${a.died ? 'the estate’s' : 'the artist’s'}.${a.died ? ` It enters the public domain on January 1, ${a.died + PD_YEARS + 1}, in the countries that protect for life plus seventy years.` : ''}` };
}

function mountArt(app, { db, V, C, ledger, mail, isStudio, studioOnly, makerOf, mk, fetchImpl, imageOf }) {
  const { esc } = V; const doFetch = fetchImpl || fetch; const HOUSE = process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com';
  db.exec(`CREATE TABLE IF NOT EXISTS artists (id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, sort_name TEXT, born INTEGER, died INTEGER, nationality TEXT, movement TEXT,
    bio TEXT, sources TEXT, wiki TEXT, claim_status TEXT, claimed_name TEXT, claimed_email TEXT, claimed_maker_id INTEGER, sale_ok INTEGER NOT NULL DEFAULT 0, terms TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS artist_claims (id INTEGER PRIMARY KEY, artist_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, relation TEXT NOT NULL, note TEXT, ip TEXT, status TEXT NOT NULL DEFAULT 'asked', at TEXT NOT NULL DEFAULT (datetime('now')), decided_at TEXT)`);
  for (const [c, t] of [['periods', 'TEXT']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('artists') WHERE name=?").get(c)) db.exec(`ALTER TABLE artists ADD COLUMN ${c} ${t}`);
  for (const [c, t] of [['artist_id', 'INTEGER'], ['attribution', 'TEXT'], ['art_override', 'TEXT']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name=?").get(c)) db.exec(`ALTER TABLE works ADD COLUMN ${c} ${t}`);
  db.exec('CREATE INDEX IF NOT EXISTS works_artist ON works (artist_id)');

  const bySlug = s => db.prepare('SELECT * FROM artists WHERE slug=?').get(String(s));
  const byId = id => db.prepare('SELECT * FROM artists WHERE id=?').get(id);
  const ofWork = w => (w && w.artist_id ? byId(w.artist_id) : null);
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  // One record per artist: found by name (either order, accents forgiven), else made. Dates and nationality fill in
  // what is empty, never overwrite what the house or the estate has set.
  function ensure(name, extra = {}) {
    name = String(name || '').replace(/\s+/g, ' ').trim(); if (!name || /^(unknown|anonymous|various|unidentified)/i.test(name)) return null;
    const n = norm(name), ns = norm(sortName(name));
    // An index by name, rebuilt only when the hall grows (5 Nov: MoMA's thousands of artists made a scan of every
    // artist on each call too slow for a feed).
    const cnt = db.prepare('SELECT COUNT(*) n, MAX(id) m FROM artists').get(); const key = `${cnt.n}|${cnt.m}`;
    if (!ensure.idx || ensure.idx.key !== key) { const map = new Map(); for (const x of db.prepare('SELECT id, name, sort_name FROM artists').all()) for (const k of [norm(x.name), norm(x.sort_name)]) if (k && !map.has(k)) map.set(k, x.id); ensure.idx = { key, map }; }
    const hit = ensure.idx.map.get(n) || ensure.idx.map.get(ns);
    let a = hit ? byId(hit) : null;
    if (!a) {
      let slug = slugify(name); let i = 2; while (db.prepare('SELECT 1 FROM artists WHERE slug=?').get(slug)) slug = `${slugify(name)}-${i++}`;
      db.prepare('INSERT INTO artists (slug, name, sort_name, born, died, nationality, movement) VALUES (?,?,?,?,?,?,?)').run(slug, name, sortName(name), extra.born || null, extra.died || null, extra.nationality || null, extra.movement || null);
      a = bySlug(slug); try { ledger.append(db, 'artist.recorded', slug, { name }); } catch (e) { /* */ }
    } else if (extra.born || extra.died || extra.nationality || extra.movement) {
      db.prepare('UPDATE artists SET born=COALESCE(born,?), died=COALESCE(died,?), nationality=COALESCE(nationality,?), movement=COALESCE(movement,?) WHERE id=?').run(extra.born || null, extra.died || null, extra.nationality || null, extra.movement || null, a.id); a = byId(a.id);
    }
    return a;
  }
  function link(w, nameOrArtist, extra) { const a = typeof nameOrArtist === 'string' ? ensure(nameOrArtist, extra) : nameOrArtist; if (!a || !w) return null; db.prepare('UPDATE works SET artist_id=? WHERE id=?').run(a.id, w.id); return a; }
  const unlink = w => db.prepare('UPDATE works SET artist_id=NULL WHERE id=?').run(w.id);
  // What may be sold (Will, 26 Oct: "we have to know what people can and cannot sell, using AI, and be able to
  // override it"). In order: the house's own say (`works.art_override` open|closed); the linked artist's dates;
  // else Al's word on the record, when confident and not dismissed by the maker: an artist the house knows is
  // judged by their dates, an unknown one by the work's date, and the doubt closes the sale.
  const CONFIDENT = +(process.env.ART_CONFIDENCE || 0.6);
  function verdict(w) {
    if (!w) return { state: 'open' };
    if (w.art_override === 'open') return { state: 'open', by: 'house', why: 'The house has looked and opened the sale.' };
    if (w.art_override === 'closed') return { state: 'closed', by: 'house', why: 'The house has closed the sale on this work.' };
    const a = ofWork(w); if (a) { const r = rights(a, w); return { state: r.state === 'reserved' ? 'closed' : 'open', by: 'artist', why: r.why, artist: a }; }
    const s = attributionOf(w);
    if (s && s.art && s.artist && !s.dismissed && s.confidence >= CONFIDENT) {
      const known = db.prepare('SELECT * FROM artists').all().find(x => norm(x.name) === norm(s.artist) || norm(x.sort_name) === norm(s.artist));
      if (known) { const r = rights(known, w); return { state: r.state === 'reserved' ? 'closed' : 'open', by: 'al', why: `Al reads this as ${s.artist}’s work. ${r.why}`, suggested: s }; }
      const made = yearOf(s.date); if (made && made <= 1928) return { state: 'open', by: 'al', why: `Al reads this as ${s.artist}’s work, made in ${made}: public domain.`, suggested: s };
      return { state: 'closed', by: 'al', why: `Al reads this as ${s.artist}’s work${s.date ? ` (${s.date})` : ''}, and the house cannot tell that it is in the public domain, so the sale is closed until the maker or the house says otherwise.`, suggested: s };
    }
    return { state: 'open' };
  }
  // Closed for some purposes, not all (Will, 26 Oct: "it just can't be sold for some purposes"): a work under
  // copyright may be collected for yourself (the Collect) unless ART_STRICT=1 closes that too (counsel's call);
  // every licence (a story, a company, an audience, a wall, a print, the Reference) is closed. The house's own
  // 'closed' closes everything; 'open' opens everything.
  const PERSONAL = new Set(['social']);
  const STRICT = () => process.env.ART_STRICT === '1';
  function blocks(w, key) {
    const v = verdict(w); if (v.state !== 'closed') return false;
    if (v.by === 'house') return true;
    if (!key) return true;
    return STRICT() || !PERSONAL.has(key);
  }
  const closedLine = v => v.by === 'house' ? 'Shown, not sold.' : STRICT() ? 'Shown, not sold.' : 'Yours to collect, not to license.';
  const worksOf = (a, lim = 200) => db.prepare("SELECT w.*, m.name AS maker_name, m.handle FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.artist_id=? AND w.status='held' ORDER BY w.curated DESC, w.stars DESC, w.id DESC LIMIT ?").all(a.id, lim);
  const countOf = a => db.prepare("SELECT COUNT(*) n FROM works WHERE artist_id=? AND status='held'").get(a.id).n;

  // Al looks at the picture: is this a photograph of a work by someone other than the photographer, and whose?
  // A suggestion only, kept on the record for the maker to confirm; never linked by itself.
  async function attribute(w) {
    if (!on() || !imageOf) return null;
    const img = await imageOf(w);
    const record = [`Title: ${w.title}`, w.place && `Place: ${w.place}`, w.caption && `Caption: ${String(w.caption).slice(0, 600)}`, w.medium && `Medium: ${w.medium}`, w.kind && `Kind: ${w.kind}`].filter(Boolean).join('\n');
    const r = await doFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 500, system: 'You are a museum registrar and a picture editor’s rights clerk. You are shown a photograph and its record. Decide (1) whether the photograph depicts a work of art (a painting, drawing, print, sculpture, textile, installation) made by someone other than the photographer, and if so identify it as far as you honestly can; (2) whether recognisable people appear (a face or figure a person who knows them could identify; a distant crowd or a back does not count), how many, and whether any is likely a child; (3) whether anyone is nude or the picture is sexual (safety: a medical, classical-art or plainly innocent context still counts as nude, say so in the note); (4) whether private property (a home’s interior, a private building, a shop, a vehicle’s plate) or a trademark, logo, brand name or copyrighted design is prominent. Never identify a living private person by name. Answer with JSON only: {"art": true|false, "artist": "name or null", "title": "title or null", "date": "year or span or null", "medium": "or null", "movement": "one of the usual art-historical movements, or null", "museum": "where it hangs, if you know, or null", "confidence": 0 to 1, "people": {"recognisable": 0, "minors": false, "crowd": false}, "safety": {"nudity": false, "sexual": false}, "property": {"private": false, "trademark": false, "what": "one phrase or null"}, "note": "one sentence on what you see"}. Say null rather than guess; a confidence under 0.5 means you are not sure of the art.', messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img.toString('base64') } }, { type: 'text', text: `The record:\n${record}\n\nWho made the work in the picture?` }] }] }),
    });
    if (!r.ok) throw new Error(`attribute ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json(); const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    // A refusal to read the picture at all is itself a reason for the house's own look: held out of every room (29 Oct).
    if (j.stop_reason === 'refusal') { db.prepare('UPDATE works SET attribution=? WHERE id=?').run(JSON.stringify({ art: false, refused: true, at: new Date().toISOString() }), w.id); if (app.locals.safety) app.locals.safety.quarantine(w, 'the house’s reader would not read this picture'); return null; }
    const m = text.match(/\{[\s\S]*\}/); if (!m) return null;
    let s; try { s = JSON.parse(m[0]); } catch (e) { return null; }
    s = { art: !!s.art, artist: s.artist || null, title: s.title || null, date: s.date || null, medium: s.medium || null, movement: s.movement || null, museum: s.museum || null, confidence: +s.confidence || 0, people: { recognisable: Math.max(0, +((s.people || {}).recognisable) || 0), minors: !!(s.people || {}).minors, crowd: !!(s.people || {}).crowd }, safety: { nudity: !!(s.safety || {}).nudity, sexual: !!(s.safety || {}).sexual }, property: { private: !!(s.property || {}).private, trademark: !!(s.property || {}).trademark, what: (s.property || {}).what || null }, note: s.note || '', model: j.model || MODEL(), at: new Date().toISOString() };
    db.prepare('UPDATE works SET attribution=? WHERE id=?').run(JSON.stringify(s), w.id);
    if (s.people.minors && (s.safety.nudity || s.safety.sexual) && app.locals.safety) app.locals.safety.quarantine(w, 'read as a child, unclothed or in a sexual picture');
    else if ((s.safety.nudity || s.safety.sexual) && w.zone !== 'mature') { try { db.prepare("UPDATE works SET zone='mature', zone_note=COALESCE(zone_note, ?) WHERE id=?").run('Read as nude by the house; the maker may say otherwise.', w.id); } catch (e) { /* the rooms come later */ } } // adults, unclothed: the adult rooms, veiled for children
    return s;
  }
  const attributionOf = w => { try { return w.attribution ? JSON.parse(w.attribution) : null; } catch (e) { return null; } };

  // The work page: the line under the plate. 'A painting by Jackson Pollock (1912–1956), photographed by Will
  // Fullerton · Under copyright: shown, not sold.' with the artist's page.
  function label(w, makerName) {
    const a = ofWork(w); const OB = require('./object');
    if (!a) { const v = verdict(w); return v.state === 'closed' ? `<p class="ax-line"><span class="ax-res" title="${esc(v.why)}">Under review: ${esc(closedLine(v).toLowerCase().replace(/\.$/, ''))}</span></p>` : ''; }
    const r = rights(a, w);
    return `<p class="ax-line"><a href="/art/${esc(a.slug)}">${esc(OB.kindWord(w) === 'Photograph' ? 'A work' : `A ${OB.kindWord(w).toLowerCase()}`)} by ${esc(a.name)}${dates(a) ? ` (${esc(dates(a))})` : ''}</a>${makerName ? `, photographed by ${esc(makerName)}` : ''}${r.state === 'reserved' ? ` · <span class="ax-res" title="${esc(r.why)}">Under copyright: ${esc(closedLine(verdict(w)).toLowerCase().replace(/\.$/, ''))}</span>` : r.state === 'pd' ? ' · <span class="ax-pd">Public domain</span>' : ''}</p>`;
  }

  // The record's block: who made the work in the picture, Al's suggestion, a name to set, or none.
  function block(w, action) {
    const a = ofWork(w), s = attributionOf(w); const r = a ? rights(a, w) : null; const v = verdict(w); const studio = /^\/studio\//.test(action);
    return `<section class="ax-blk" id="artist"><h2>The artist of the work</h2>
<p class="ax-verdict ax-v-${v.state}"><b>${v.state === 'closed' ? closedLine(v) : 'May be sold and licensed.'}</b> ${esc(v.why || 'Nothing on the record says this is another artist’s work.')}${v.by ? ` <small>(${v.by === 'house' ? 'the house’s say' : v.by === 'al' ? 'Al’s reading; the maker or the house may say otherwise' : 'from the artist’s record'})</small>` : ''}</p>
<p class="note">If this is a photograph of someone else’s work (a painting, a sculpture, a drawing), name them: the work hangs under their name with you credited as the photographer, and their page gathers every photograph of their art in the house. ${on() ? 'Al can look and suggest who it is.' : ''}</p>
${a ? `<p class="ax-cur"><b><a href="/art/${esc(a.slug)}">${esc(a.name)}</a></b>${dates(a) ? ` · ${esc(dates(a))}` : ''}${a.movement ? ` · ${esc(a.movement)}` : ''}<br><span class="ax-why">${esc(r.why)}${r.state === 'reserved' ? (STRICT() ? ' Collect and every licence stay closed on this work until the rights holder sets terms.' : ' The licences stay closed on this work until the rights holder sets terms; the personal Collect stays open.') : ''}</span></p>
<form method="post" action="${action}" class="ax-f"><input type="hidden" name="do" value="clear"><button class="btn">Not by ${esc(a.name)}: remove</button></form>` : ''}
${!a && s && s.art && s.artist ? `<p class="ax-sug"><b>Al says:</b> ${esc(s.artist)}${s.title ? `, <i>${esc(s.title)}</i>` : ''}${s.date ? ` (${esc(s.date)})` : ''}${s.movement ? ` · ${esc(s.movement)}` : ''}${s.museum ? ` · ${esc(s.museum)}` : ''} · ${Math.round(s.confidence * 100)}% sure. ${esc(s.note || '')}</p>
<form method="post" action="${action}" class="ax-f"><input type="hidden" name="do" value="set"><input type="hidden" name="name" value="${esc(s.artist)}"><input type="hidden" name="movement" value="${esc(s.movement || '')}"><button class="buy-btn">Yes, by ${esc(s.artist)}</button></form>` : ''}
${!a && s && s.art && s.artist && !s.dismissed ? `<form method="post" action="${action}" class="ax-f"><input type="hidden" name="do" value="dismiss"><button class="btn">Not so: this is my own work</button></form>` : ''}
${!a && s && !s.art ? `<p class="ax-sug"><b>Al says:</b> this looks like the photographer’s own work, not a photograph of someone else’s. ${esc(s.note || '')}</p>` : ''}
${studio ? `<form method="post" action="${action}" class="ax-f ax-ov"><input type="hidden" name="do" value="override"><label>The house’s say<select name="value"><option value=""${!w.art_override ? ' selected' : ''}>As the rule reads it</option><option value="open"${w.art_override === 'open' ? ' selected' : ''}>Open for sale</option><option value="closed"${w.art_override === 'closed' ? ' selected' : ''}>Closed: shown, not sold</option></select></label><button class="btn">Set</button></form>` : ''}
<form method="post" action="${action}" class="ax-f ax-set"><input type="hidden" name="do" value="set"><label>${a ? 'Another name' : 'The artist’s name'}<input name="name" placeholder="Jackson Pollock" list="ax-names"></label><datalist id="ax-names">${db.prepare('SELECT name FROM artists ORDER BY sort_name LIMIT 400').all().map(x => `<option value="${esc(x.name)}">`).join('')}</datalist><label>Movement<input name="movement" list="ax-mv" placeholder="Abstract Expressionism"></label><datalist id="ax-mv">${MOVEMENTS.map(x => `<option value="${esc(x)}">`).join('')}</datalist><button class="btn">Set</button></form>
${on() && !a ? `<form method="post" action="${action}" class="ax-f"><input type="hidden" name="do" value="ask"><button class="btn">Ask Al who made it</button></form>` : ''}
</section>`;
  }

  async function act(req, res, w, back) {
    const d = String(req.body.do || '');
    if (d === 'clear') { unlink(w); return res.redirect(`${back}?ok=artist#artist`); }
    if (d === 'set') { const a = link(w, String(req.body.name || ''), { movement: String(req.body.movement || '').trim() || null }); if (a && app.locals.findIndexDirty) app.locals.findIndexDirty(); return res.redirect(`${back}?ok=${a ? 'artist' : 'noname'}#artist`); }
    if (d === 'ask') { const S = app.locals.spend; if (S && !S.ok('art.asked')) return res.redirect(`${back}?ok=${encodeURIComponent('Al has reached the day’s line; tomorrow.')}`); try { await attribute(w); } catch (e) { console.error('[art]', e.message); } return res.redirect(`${back}?ok=asked#artist`); }
    if (d === 'dismiss') { const s = attributionOf(w); if (s) { s.dismissed = true; s.dismissed_at = new Date().toISOString(); db.prepare('UPDATE works SET attribution=? WHERE id=?').run(JSON.stringify(s), w.id); try { ledger.append(db, 'artist.dismissed', w.slug, { said: s.artist }); } catch (e) { /* */ } } return res.redirect(`${back}?ok=artist#artist`); }
    if (d === 'override' && /^\/studio\//.test(back)) { const v = ['open', 'closed'].includes(req.body.value) ? req.body.value : null; db.prepare('UPDATE works SET art_override=? WHERE id=?').run(v, w.id); try { ledger.append(db, 'artist.overridden', w.slug, { to: v }); } catch (e) { /* */ } return res.redirect(`${back}?ok=artist#artist`); }
    res.redirect(`${back}#artist`);
  }
  const findWork = slug => db.prepare('SELECT * FROM works WHERE slug=?').get(String(slug));
  app.post('/account/works/:slug/art', async (req, res) => { const m = makerOf(req); const w = findWork(req.params.slug); if (!m || !w || w.maker_id !== m.id) return res.sendStatus(403); await act(req, res, w, `/account/works/${encodeURIComponent(w.slug)}`); });
  app.post('/studio/works/:slug/art', studioOnly, async (req, res) => { const w = findWork(req.params.slug); if (!w) return res.sendStatus(404); await act(req, res, w, `/studio/works/${encodeURIComponent(w.slug)}`); });

  // The room: /art. The kinds of work in the house, the movements, and every artist A–Z with one picture each.
  const cover = a => db.prepare("SELECT slug FROM works WHERE artist_id=? AND status='held' AND zone IS NOT 'mature' ORDER BY curated DESC, stars DESC, id DESC LIMIT 1").get(a.id);
  app.get('/art', (req, res, next) => (app.locals.minute ? app.locals.minute(artRoom) : artRoom)(req, res, next)); // a stranger's room once a minute (28 Oct)
  function artRoom(req, res) {
    const OB = require('./object');
    const artists = db.prepare("SELECT a.*, (SELECT COUNT(*) FROM works w WHERE w.artist_id=a.id AND w.status='held') n FROM artists a WHERE (SELECT COUNT(*) FROM works w WHERE w.artist_id=a.id AND w.status='held')>0 ORDER BY a.sort_name").all();
    const kinds = db.prepare("SELECT kind, COUNT(*) n FROM works WHERE status='held' AND (artist_id IS NOT NULL OR COALESCE(kind,'photograph')!='photograph') GROUP BY kind ORDER BY n DESC").all().filter(k => OB.KINDS[k.kind]);
    const movements = db.prepare("SELECT a.movement, COUNT(DISTINCT a.id) artists, COUNT(w.id) n FROM artists a JOIN works w ON w.artist_id=a.id AND w.status='held' WHERE a.movement IS NOT NULL AND a.movement!='' GROUP BY a.movement ORDER BY n DESC").all();
    const mv = String(req.query.movement || ''), kd = String(req.query.kind || '');
    const shown = artists.filter(a => (!mv || a.movement === mv)).filter(a => !kd || db.prepare("SELECT 1 FROM works WHERE artist_id=? AND status='held' AND kind=?").get(a.id, kd));
    const letters = [...new Set(shown.map(a => (a.sort_name || a.name)[0].toUpperCase()))];
    res.send(V.layout({ title: 'The hall · Watermark', path: '/art', desc: 'The artists behind the work in the house: paintings, sculpture, drawings, photographed and kept, each under its maker’s name.', body: `<section class="ax-room">
<header class="ax-head"><p class="k">The hall</p><h1>Every artist, and all of their work.</h1><p class="lede">A page for every artist, living or long gone: the work in the order it was made, the life as a line, and their own words beside it. Wander one from the first picture to the last. A photograph can show a painting, but the painting is someone’s. Every work of art photographed into the house hangs here under the name of the person who made it, with the photographer credited, and the artist’s page gathers all of it. Where the work is in the public domain the photographs are collected and licensed as any work; where it is under copyright they are shown and credited, may be collected for yourself, and are never licensed for a story, a company, an audience, a wall or a print until the artist or their estate sets terms.</p></header>
${kinds.length ? `<nav class="ax-kinds"><a href="/art"${!kd && !mv ? ' aria-current="page"' : ''}>Everything</a>${kinds.map(k => `<a href="/art?kind=${esc(k.kind)}"${kd === k.kind ? ' aria-current="page"' : ''}>${esc(OB.KINDS[k.kind])}s <small>${k.n}</small></a>`).join('')}</nav>` : ''}
${movements.length ? `<nav class="ax-mvs"><span>By movement</span>${movements.map(m => `<a href="/art?movement=${encodeURIComponent(m.movement)}"${mv === m.movement ? ' aria-current="page"' : ''}>${esc(m.movement)} <small>${m.artists}</small></a>`).join('')}</nav>` : ''}
${shown.length ? `<p class="ax-az">${letters.map(l => `<a href="#ax-${esc(l)}">${esc(l)}</a>`).join('')}</p><div class="ax-grid">${shown.map((a, i) => { const c = cover(a); const first = i === 0 || (shown[i - 1].sort_name || shown[i - 1].name)[0].toUpperCase() !== (a.sort_name || a.name)[0].toUpperCase(); return `<a class="ax-card" href="/art/${esc(a.slug)}"${first ? ` id="ax-${esc((a.sort_name || a.name)[0].toUpperCase())}"` : ''}><span class="ax-im">${c ? `<img src="/img/${esc(c.slug)}/thumb" alt="" loading="lazy">` : ''}</span><b>${esc(a.name)}</b><span class="ax-meta">${esc([dates(a), a.nationality, a.movement].filter(Boolean).join(' · '))}</span><span class="ax-n">${a.n} work${a.n === 1 ? '' : 's'}${rights(a).state === 'reserved' ? ' · under copyright' : ''}</span></a>`; }).join('')}</div>` : `<p class="ax-empty">No artists yet. The first arrives with the first photograph of a painting, or the first museum collection brought in.</p>`}
<section class="ax-how"><h2>Photograph the art you love</h2><p>Most museums allow photography of their permanent collection for your own use. Bring your photograph of a painting into the house, name the artist, and it hangs under their name with you as the photographer of record. If the painting is in the public domain, your photograph is yours to collect and license. If it is under copyright, it is shown and credited, yours to collect for yourself, and the house keeps every licence closed: the rights are the artist’s. <a href="/own">You already own it</a> says the rest.</p></section>
</section>` }));
  }

  // The artist's page (31 Oct): src/artistpage.js. Every work in the order it was made, the life as a line, their words.
  const AP = require('./artistpage');
  const keeps0 = w => { const m = /(?:Credit line|Credit|Museum|Collection|Repository|Institution): ([^·\n]+)/i.exec(w.caption || '') || /(Van Gogh Museum|Kröller-Müller Museum|Museum of Modern Art|Metropolitan Museum of Art|National Gallery[^.;,·]*|Art Institute of Chicago|Musée d'Orsay|Musée de l'Orangerie|Musée Marmottan[^.;,·]*|Rijksmuseum|Louvre|Uffizi|Royal Collection|British Museum|Biblioteca Ambrosiana|Hermitage|Courtauld[^.;,·]*|Getty[^.;,·]*|Cleveland Museum of Art|Philadelphia Museum of Art|Museum of Fine Arts[^.;,·]*)/i.exec(w.caption || ''); return m ? m[1].trim().slice(0, 80) : null; };
  const keeps = w => { const k = keeps0(w); return k && !/google|cultural institute|zoom level|wikimedia|commons|home page|\bimage\b|^[\w-]{8,}\b/i.test(k) ? k : ''; };
  function chronology(a) {
    // The columns the page reads, never w.* (the guides, studies and attributions of a thousand works came over the bridge on every visit, 2 Nov).
    return db.prepare("SELECT w.id, w.slug, w.title, w.caption, w.taken_at, w.kind, w.medium, w.curated, w.stars, w.width, w.height, w.source_url, w.place, w.zone, w.maker_id, w.artist_id, m.name AS maker_name, m.handle FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.artist_id=? AND w.status='held' AND COALESCE(w.zone,'all')!='mature'").all(a.id)
      .map(w => ({ ...w, y: AP.madeIn(w, a), keeps: keeps(w) })).sort((x, y) => (x.y || 99999) - (y.y || 99999) || x.id - y.id);
  }
  // The wall Wander walks for an artist: the house's, public, in the order made.
  function wallOf(a, ws) {
    const H = app.locals.hangs; if (!H || !H.houseBuyer || !ws.length) return null; const hb = H.houseBuyer(); if (!hb) return null;
    const slug = `art-${a.slug}`.slice(0, 90); let h = db.prepare('SELECT * FROM hangs WHERE slug=?').get(slug);
    if (!h) { db.prepare('INSERT INTO hangs (buyer_id, slug, title, line, public) VALUES (?,?,?,?,1)').run(hb.id, slug, a.name, 'The work, in the order it was made.'); h = db.prepare('SELECT * FROM hangs WHERE slug=?').get(slug); }
    // Only when the order changed, and then in a few statements, never one a work (2 Nov: a thousand UPDATEs over the
    // Postgres bridge on every visit was the ten seconds Vincent's page took while his catalogue came in).
    // (11 Nov, Will, a 900-pixel Monet small in the middle of the Duo: "they don't fit the frame; they all differ; if they
    // don't look stunning here, this will flop".) The wall an artist is wandered by holds to the wall standard as the
    // open walls do: only a work whose file can fill a screen (wall.sql: the long side, the standard's reading, its
    // copies made). The small files stay in the catalogue on the artist's page, each with its record. If none of the
    // artist's files holds, the wall keeps them all rather than stand empty.
    let want = ws.slice(0, 1000).map(w => w.id);
    try { const W = require('./wall'); const ok = new Set(); for (let i = 0; i < want.length; i += 400) { const part = want.slice(i, i + 400); for (const r of db.prepare(`SELECT w.id FROM works w WHERE w.id IN (${part.map(() => '?').join(',')})${W.sql('w')}`).all(...part)) ok.add(r.id); } if (ok.size) want = want.filter(id => ok.has(id)); } catch (e) { console.error('[art wall]', e.message); }
    const have = db.prepare('SELECT work_id FROM hang_works WHERE hang_id=? ORDER BY pos, work_id').all(h.id).map(r => r.work_id);
    if (have.length === want.length && have.every((id, i) => id === want[i])) return h;
    db.prepare('DELETE FROM hang_works WHERE hang_id=?').run(h.id);
    for (let i = 0; i < want.length; i += 200) { const part = want.slice(i, i + 200); db.prepare(`INSERT INTO hang_works (hang_id, work_id, pos) VALUES ${part.map(() => '(?,?,?)').join(',')}`).run(...part.flatMap((id, j) => [h.id, id, i + j])); }
    return h;
  }
  const pageCache = new Map();
  const KINDS_IN = ['painting', 'drawing', 'print', 'sculpture', 'photograph'];
  function searchBox(a, q, kind) {
    let kinds = []; try { kinds = db.prepare("SELECT COALESCE(kind,'photograph') k, COUNT(*) n FROM works WHERE artist_id=? AND status='held' AND COALESCE(keep_back,0)=0 GROUP BY COALESCE(kind,'photograph') ORDER BY COUNT(*) DESC").all(a.id).filter(x => KINDS_IN.includes(x.k)); } catch (e) { kinds = []; }
    const first = a.name.trim().split(/\s+/).pop();
    return `<form class="apl-find" action="/art/${esc(a.slug)}" method="get" role="search"><input type="search" name="q" value="${esc(q || '')}" placeholder="Find a work by ${esc(first)}: a title, a subject, a year" aria-label="Find a work by ${esc(a.name)}" autocomplete="off"><button>Find</button>${kinds.length > 1 ? `<span class="apl-kinds">${kinds.map(k => `<a href="/art/${esc(a.slug)}?kind=${k.k}"${kind === k.k ? ' aria-current="true"' : ''}>${k.k[0].toUpperCase() + k.k.slice(1)}s <small>${k.n.toLocaleString('en-US')}</small></a>`).join('')}</span>` : ''}</form>`;
  }
  function within(a, q, kind) {
    const toks = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6);
    const nameWords = new Set(a.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(Boolean));
    const words = toks.filter(t => !nameWords.has(t)); // the artist's own name is no filter on their own page
    const W = "lower(coalesce(w.title,'') || ' ' || coalesce(w.caption,'') || ' ' || coalesce(w.medium,'') || ' ' || coalesce(w.place,'') || ' ' || coalesce(w.keywords,'') || ' ' || coalesce(w.accession,'') || ' ' || coalesce(substr(w.taken_at,1,4),''))";
    const conds = words.map(t => `${W} LIKE '%${t}%'`); // letters and digits only, by the line above
    if (kind && KINDS_IN.includes(kind)) conds.push(kind === 'photograph' ? "COALESCE(w.kind,'photograph')='photograph'" : `w.kind='${kind}'`);
    let ws = []; try { ws = db.prepare(`SELECT w.slug, w.title, w.taken_at, w.medium, w.kind, w.width, w.height FROM works w WHERE w.artist_id=? AND w.status='held' AND COALESCE(w.keep_back,0)=0 AND COALESCE(w.zone,'all')<>'mature'${conds.length ? ' AND ' + conds.join(' AND ') : ''} ORDER BY w.curated DESC, w.stars DESC, w.taken_at, w.id LIMIT 240`).all(a.id); } catch (e) { console.error('[art find]', e.message); }
    let known = []; if (words.length) { try { known = db.prepare(`SELECT c.title, c.year, c.medium, c.collection, c.object_url, c.wiki FROM catalogue c WHERE c.artist_id=? AND ${words.map(t => `lower(coalesce(c.title,'') || ' ' || coalesce(c.medium,'') || ' ' || coalesce(c.collection,'') || ' ' || coalesce(c.year,'')) LIKE '%${t}%'`).join(' AND ')} ORDER BY c.year, c.title LIMIT 60`).all(a.id); } catch (e) { known = []; } }
    const have = new Set(ws.map(w => String(w.title || '').toLowerCase())); known = known.filter(c => !have.has(String(c.title || '').toLowerCase()));
    const what = [kind && KINDS_IN.includes(kind) ? kind + 's' : null, words.length ? `“${esc(words.join(' '))}”` : null].filter(Boolean).join(' · ') || 'every work';
    const tiles = ws.map(w => `<a class="apl-ft" href="/wander/art/${esc(a.slug)}?all=1&at=${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(V.tidy(w.title))}" loading="lazy"><b>${esc(V.tidy(w.title))}</b><i>${esc([String(w.taken_at || '').slice(0, 4), w.medium].filter(Boolean).join(' · '))}</i></a>`).join('');
    const body = `<main class="apl apl-found"><header class="apl-fh"><p class="k"><a href="/art">The hall</a> · <a href="/art/${esc(a.slug)}">${esc(a.name)}</a></p><h1>${esc(a.name)}${dates(a) ? ` <small>${esc(dates(a))}</small>` : ''}</h1>${searchBox(a, q, kind)}<p class="apl-fn">${ws.length ? `${ws.length === 240 ? 'The first 240' : ws.length.toLocaleString('en-US')} ${ws.length === 1 ? 'work' : 'works'} in the house for ${what}.` : `Nothing in the house by ${esc(a.name)} for ${what}.`} <a href="/art/${esc(a.slug)}">The whole page</a></p></header>
${tiles ? `<section class="apl-fg">${tiles}</section>` : ''}
${known.length ? `<section class="apl-fk"><h2>Known, and not yet in the house</h2><ul>${known.map(c => `<li><b>${esc(c.title || 'Untitled')}</b>${c.year ? `, ${esc(String(c.year))}` : ''}${c.medium ? ` · ${esc(c.medium)}` : ''}${c.collection ? ` · ${esc(c.collection)}` : ''}${c.object_url || c.wiki ? ` · <a href="${esc(c.object_url || c.wiki)}" rel="noopener">its own record</a>` : ''}</li>`).join('')}</ul></section>` : ''}
${!ws.length && !known.length ? `<p class="apl-fn2">Try one word of the title, a subject, a year, or <a href="/find?q=${encodeURIComponent(q)}">look in the whole house</a>.</p>` : ''}</main>`;
    return V.layout({ title: `${a.name}: ${q || kind || 'find'} · Watermark`, bare: true, path: `/art/${a.slug}`, desc: `Find a work by ${a.name}.`, body });
  }
  app.get('/art/:slug', (req, res, next) => {
    const a = bySlug(req.params.slug); if (!a) return next();
    // Find within one artist (Will, 10 Nov: "if I want to find a particular drawing or painting from a particular artist"):
    // ?q= a word over the title, the caption, the medium, the place and the year; ?kind= paintings, drawings, prints.
    // What the house holds first (each opens in Wander among the artist's work), then what the catalogue knows of.
    if (req.query.q !== undefined || req.query.kind) return res.send(within(a, String(req.query.q || '').replace(/['’`]s\b/g, '').slice(0, 80), String(req.query.kind || '').toLowerCase().replace(/[^a-z]/g, '')));
    const studio = isStudio(req); const whole = req.query.all === '1'; const ck = `${a.slug}|${studio ? 's' : 'p'}${whole ? '|all' : ''}`; const hit = pageCache.get(ck); if (hit && Date.now() - hit.at < 60e3) return res.send(hit.html);
    const OB = require('./object'); const ws = chronology(a); const r = rights(a, ws[0] || null); const h = wallOf(a, ws);
    const photographers = [...new Map(ws.filter(w => w.handle !== 'the-public-domain').map(w => [w.handle, w.maker_name])).entries()];
    const kinds = [...new Set(ws.map(w => OB.kindWord(w).toLowerCase() + 's'))];
    const KP = app.locals.catalogue ? db.prepare('SELECT k.qid, k.name, k.city, COUNT(c.id) n FROM catalogue c JOIN keepers k ON k.qid=c.collection_qid WHERE c.artist_id=? GROUP BY k.qid, k.name, k.city ORDER BY COUNT(c.id) DESC, k.name LIMIT 40').all(a.id) : [];
    const museums = KP.length ? KP.map(k => ({ html: `<a href="/art/visit/${esc(k.qid)}">${esc(k.name)}</a>${k.city ? `, ${esc(k.city)}` : ''} <small>${k.n}</small>` })) : [...new Set(ws.map(w => w.keeps).filter(Boolean))].slice(0, 12);
    const claimLine = a.claim_status === 'claimed' ? `This page is kept with ${esc(a.claimed_name || 'the artist’s representative')}.${a.terms ? ` ${esc(a.terms)}` : ''}` : `Are you ${esc(a.name)}, the estate, a foundation or the gallery that represents the work? The page is yours to keep: the life in your words, the dates, and what may be collected. <a href="/art/${esc(a.slug)}/claim">Write to the house</a>.`;
    let binding = null; try { binding = require('./binding'); } catch (e) { /* */ }
    const CAT = app.locals.catalogue; const cat = CAT ? CAT.of(a, ws, { limit: whole ? 4000 : 1200 }) : []; const knownN = CAT && CAT.count ? (CAT.count(a).n || cat.length) : cat.length;
    for (const c of cat) if (c.work) { c.work.title = c.title || c.work.title; c.work.medium = c.medium || c.work.medium; if (c.collection) c.work.keeps = c.collection; }
    const ghosts = cat.filter(c => !c.work).map(c => ({ ghost: true, id: 'q' + c.qid, title: c.title, y: c.year, keeps: c.collection, qid: c.qid, medium: c.medium, size: c.size, image: !!c.image, wiki: c.wiki, url: c.object_url, onView: c.on_view }));
    const show = app.locals.shows ? app.locals.shows.forPage(a) : null;
    const body = AP.render({ a, ws, find: searchBox(a) + (app.locals.volumes ? app.locals.volumes.strip(a) : ''), ghosts, show, whole, known: knownN, writings: AP.writingsOf(db, a), V, rights: r, wanderHref: h ? `/wander/art/${a.slug}` : `/wander?q=${encodeURIComponent(a.name)}`, museums, photographers, claimLine, kinds, binding, isStudio: studio });
    const hero = ws.find(w => w.curated) || ws[0];
    const html = V.layout({ title: `${a.name} · Watermark`, bare: true, path: `/art/${a.slug}`, image: hero ? `/art/${a.slug}/card.png` : null, desc: `${a.name}${dates(a) ? ` (${dates(a)})` : ''}: every work in the house in the order it was made, and their own words.`, body });
    pageCache.set(ck, { at: Date.now(), html });
    res.send(html);
  });

  // The card a link to an artist unfurls into (Will, 2 Nov): the work on the left; the name, the dates and the life as a line on the right.
  const artCards = new Map();
  app.get('/art/:slug/card.png', async (req, res) => {
    const a = bySlug(req.params.slug); if (!a) return res.sendStatus(404);
    const ws = chronology(a); const hero = ws.find(w => w.curated) || ws[0];
    const key = `${a.slug}|${hero ? hero.slug : ''}|${ws.length}|${a.born}|${a.died}`; let png = artCards.get(key);
    if (!png) {
      try {
        const sharp = require('sharp'); const X = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const GILT = '#c9a24a', INK = '#f6f1e7', W = 1200, H = 630, L = 560;
        const words = String(a.name).split(/\s+/); const lines = []; let cur = '';
        for (const wd of words) { if ((cur + ' ' + wd).trim().length > 14 && cur) { lines.push(cur); cur = wd; } else cur = (cur + ' ' + wd).trim(); } if (cur) lines.push(cur);
        const size = lines.length > 2 ? 52 : 68, lh = size * 1.08, y0 = 210;
        const sub = [a.nationality, a.movement].filter(Boolean).join(' · ');
        const yrs = new Set(ws.map(w => AP.madeIn(w, a)).filter(Boolean));
        const ys = [...yrs]; const b0 = a.born || (ys.length ? Math.min(...ys) : null), b1 = a.died || (a.born ? new Date().getFullYear() : ys.length ? Math.max(...ys) : null);
        const lx = L + 64, lw = W - lx - 64, ly = 470;
        const ticks = b0 && b1 && b1 > b0 ? [...yrs].filter(y => y >= b0 && y <= b1).map(y => { const x = lx + (y - b0) / (b1 - b0) * lw; return `<path d="M${x.toFixed(1)} ${ly - 14}v14" stroke="${GILT}" stroke-width="2"/>`; }).join('') : '';
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#0b0a09"/>
<text x="${lx}" y="120" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="15" letter-spacing="3" fill="${GILT}">THE HALL · WATERMARK</text>
${lines.map((l, i) => `<text x="${lx}" y="${y0 + i * lh}" font-family="'Bitstream Charter', 'GFS Baskerville', 'DejaVu Serif', serif" font-size="${size}" fill="${INK}">${X(l)}</text>`).join('')}
${a.born || a.died ? `<text x="${lx}" y="${y0 + lines.length * lh + 14}" font-family="'Bitstream Charter', 'DejaVu Serif', serif" font-style="italic" font-size="30" fill="${INK}" opacity=".85">${X(a.born || '?')} – ${X(a.died || 'today')}</text>` : ''}
${sub ? `<text x="${lx}" y="${y0 + lines.length * lh + 56}" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="17" letter-spacing="1" fill="${INK}" opacity=".6">${X(sub)}</text>` : ''}
${b0 && b1 && b1 > b0 ? `<path d="M${lx} ${ly}h${lw}" stroke="${INK}" stroke-opacity=".35" stroke-width="1.5"/>${ticks}<text x="${lx}" y="${ly + 30}" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="15" fill="${INK}" opacity=".6">${X(b0)}</text><text x="${lx + lw}" y="${ly + 30}" text-anchor="end" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="15" fill="${INK}" opacity=".6">${X(a.died || 'today')}</text>` : ''}
<text x="${lx}" y="${H - 54}" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="15" letter-spacing="2" fill="${INK}" opacity=".55">${ws.length ? `${ws.length} ${ws.length === 1 ? 'WORK' : 'WORKS'}, IN THE ORDER MADE` : 'THE LIFE AND THE WORK'}</text>
</svg>`;
        const layers = [];
        if (hero && app.locals.imageOf) { try { const buf = await app.locals.imageOf(hero); layers.push({ input: await sharp(buf).resize(L, H, { fit: 'cover', position: 'attention' }).jpeg({ quality: 88 }).toBuffer(), left: 0, top: 0 }); } catch (e) { /* the words stand alone */ } }
        png = await sharp(Buffer.from(svg)).composite(layers).png({ compressionLevel: 8 }).toBuffer();
        if (artCards.size > 300) artCards.delete(artCards.keys().next().value);
        artCards.set(key, png);
      } catch (e) { console.error('[art-card]', e.message); return res.sendStatus(500); }
    }
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }).send(png);
  });

  app.get('/art/:slug/claim', (req, res) => {
    const a = bySlug(req.params.slug); if (!a) return res.sendStatus(404);
    res.send(V.layout({ title: `Claim ${a.name} · Watermark`, path: `/art/${a.slug}/claim`, body: `<section class="narrow ax-cf"><p class="k"><a href="/art/${esc(a.slug)}">${esc(a.name)}</a></p><h1>Claim this page.</h1>
<p class="lede">The house keeps a page for every artist whose work has been photographed into it. The artist, the estate, a foundation or the representing gallery may keep it instead: the life in their words, the dates as they are, and the terms on which photographs of the work may be collected, if at all. ${req.query.ok === 'sent' ? '<b>Thank you. The house has your letter and will write back.</b>' : ''}</p>
<form method="post" action="/art/${esc(a.slug)}/claim" class="ax-cform"><label>Your name<input name="name" required maxlength="120"></label><label>Email<input name="email" type="email" required maxlength="200"></label><label>You are<select name="relation"><option value="artist">The artist</option><option value="estate">The estate</option><option value="foundation">A foundation</option><option value="gallery">The representing gallery</option><option value="other">Someone else with standing</option></select></label><label>A word on your standing, and how the house can check it<textarea name="note" rows="5" maxlength="2000"></textarea></label><input type="text" name="website" class="hpot" tabindex="-1" autocomplete="off" aria-hidden="true"><button class="buy-btn">Send it to the house</button></form></section>` }));
  });
  app.post('/art/:slug/claim', (req, res) => {
    const a = bySlug(req.params.slug); if (!a) return res.sendStatus(404);
    if (req.body.website) return res.redirect(`/art/${a.slug}/claim?ok=sent`);
    const name = String(req.body.name || '').trim().slice(0, 120), email = String(req.body.email || '').trim().slice(0, 200), rel = ['artist', 'estate', 'foundation', 'gallery', 'other'].includes(req.body.relation) ? req.body.relation : 'other';
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.redirect(`/art/${a.slug}/claim`);
    db.prepare('INSERT INTO artist_claims (artist_id, name, email, relation, note, ip) VALUES (?,?,?,?,?,?)').run(a.id, name, email, rel, String(req.body.note || '').slice(0, 2000) || null, req.ip || null);
    if (!a.claim_status) db.prepare("UPDATE artists SET claim_status='asked' WHERE id=?").run(a.id);
    try { ledger.append(db, 'artist.claim.asked', a.slug, { relation: rel }); } catch (e) { /* */ }
    if (mail) { mail.send({ to: HOUSE, subject: `A claim on ${a.name}’s page`, text: `${name} (${email}), ${rel}, asks to keep ${a.name}’s page.\n\n${String(req.body.note || '')}\n\nDecide: ${C.base}/studio/art/${a.slug}` }); mail.send({ to: email, subject: `${a.name}’s page on Watermark`, text: `Thank you, ${name}. The house has your letter about ${a.name}’s page and will write back once it has looked.\n\n${C.base}/art/${a.slug}\n\nWatermark` }); }
    res.redirect(`/art/${a.slug}/claim?ok=sent`);
  });

  // Studio → Back office → The art: every artist, the claims, the record to edit.
  app.get('/studio/art', studioOnly, (req, res) => {
    const list = db.prepare("SELECT a.*, (SELECT COUNT(*) FROM works w WHERE w.artist_id=a.id AND w.status='held') n, (SELECT COUNT(*) FROM artist_claims c WHERE c.artist_id=a.id AND c.status='asked') asks FROM artists a ORDER BY asks DESC, n DESC, a.sort_name").all();
    const handsOff = new Map(); try { for (const r of db.prepare("SELECT k, v FROM settings WHERE k LIKE 'hands_plan_%'").all()) { const p = JSON.parse(r.v); handsOff.set(+r.k.slice(11), p.not.length + p.versions.length + p.repeats.length); } } catch (e) { /* none */ }
    res.send(V.layout({ title: 'The art · Studio · Watermark', path: '/studio/art', studio: true, body: `<section class="studio-wrap ax-desk"><p class="k">Back office</p><h1>The artists behind the work</h1><p class="note">${list.length} artists · ${list.filter(a => a.asks).length} with a claim waiting. Dates decide what sells: an artist dead over seventy years is public domain; otherwise the work is shown and never sold until the page is claimed and terms set.</p>${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
<form method="post" action="/studio/hands/all" class="ax-f"><button class="btn">Whose hand: look at every master</button> <span class="note">${app.locals.hands && app.locals.hands.all.on ? `looking now, ${app.locals.hands.all.done} of ${app.locals.hands.all.n}` : 'workshop pieces, copies and extra files found for every artist with a catalogue; each taken off by a press on the artist’s own page'}</span></form>
<table class="tbl"><thead><tr><th>Artist</th><th>Dates</th><th>Movement</th><th>Works</th><th>Rights</th><th>Claim</th></tr></thead><tbody>${list.map(a => `<tr><td><a href="/studio/art/${esc(a.slug)}">${esc(a.name)}</a></td><td>${esc(dates(a))}</td><td>${esc(a.movement || '')}</td><td>${a.n}${(() => { const k = handsOff.get(a.id) || 0; return k ? ` · <a href="/studio/art/${esc(a.slug)}/hands"><b>${k} not theirs</b></a>` : ''; })()}</td><td>${rights(a).state}</td><td>${a.asks ? `<b>${a.asks} waiting</b>` : a.claim_status || ''}</td></tr>`).join('')}</tbody></table>
<form method="post" action="/studio/art" class="ax-new"><h2>Add an artist</h2><label>Name<input name="name" required></label><label>Born<input name="born" inputmode="numeric"></label><label>Died<input name="died" inputmode="numeric"></label><label>Movement<input name="movement"></label><button class="buy-btn">Add</button></form></section>` }));
  });
  app.post('/studio/art', studioOnly, (req, res) => { const a = ensure(String(req.body.name || ''), { born: +req.body.born || null, died: +req.body.died || null, movement: String(req.body.movement || '').trim() || null }); res.redirect(a ? `/studio/art/${a.slug}` : '/studio/art'); });
  app.get('/studio/art/:slug', studioOnly, (req, res) => {
    const a = bySlug(req.params.slug); if (!a) return res.sendStatus(404);
    const claims = db.prepare('SELECT * FROM artist_claims WHERE artist_id=? ORDER BY id DESC').all(a.id); const ws = worksOf(a, 60);
    res.send(V.layout({ title: `${a.name} · Studio · Watermark`, path: '/studio/art', studio: true, body: `<section class="studio-wrap ax-desk"><p class="k"><a href="/studio/art">The art</a></p><h1>${esc(a.name)}</h1><p class="note"><a href="/art/${esc(a.slug)}">The public page</a> · <a href="/studio/art/${esc(a.slug)}/tidy">The tidy</a> · <a href="/studio/art/${esc(a.slug)}/hands">Whose hand</a> · <a href="/studio/standard?artist=${esc(a.slug)}">The standard</a> · ${ws.length} works · rights: <b>${rights(a).state}</b>. ${esc(rights(a).why || '')}</p>
${req.query.ok ? `<p class="ok">${esc({ saved: 'Saved.', proposed: 'A show is proposed: look at it, then open it.', opened: 'The show is open.', closed: 'The show is closed; the page leads with the catalogue again.', noshow: 'Nothing of theirs is held to make a show from.', accepted: 'The claim is accepted; the page is theirs to keep.', declined: 'Declined.' }[req.query.ok] || req.query.ok)}</p>` : ''}
<form method="post" action="/studio/art/${esc(a.slug)}" class="ax-edit"><div class="ax-row"><label>Name<input name="name" value="${esc(a.name)}" required></label><label>Born<input name="born" value="${a.born || ''}" inputmode="numeric"></label><label>Died<input name="died" value="${a.died || ''}" inputmode="numeric"></label><label>Nationality<input name="nationality" value="${esc(a.nationality || '')}"></label><label>Movement<input name="movement" value="${esc(a.movement || '')}" list="ax-mv"></label><datalist id="ax-mv">${MOVEMENTS.map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
<label>The life, in paragraphs<textarea name="bio" rows="8">${esc(a.bio || '')}</textarea></label><label>Periods, a line each (<code>1886–1887 Paris: Two years with Theo in Montmartre.</code>); the page hangs the work by them<textarea name="periods" rows="5">${esc(a.periods || '')}</textarea></label><label>Read further, one address or line each<textarea name="sources" rows="3">${esc(a.sources || '')}</textarea></label><label>Wikipedia or the estate’s site<input name="wiki" value="${esc(a.wiki || '')}"></label>
<div class="ax-row"><label>Kept by (name)<input name="claimed_name" value="${esc(a.claimed_name || '')}"></label><label>Their email<input name="claimed_email" value="${esc(a.claimed_email || '')}"></label><label>Status<select name="claim_status"><option value="">None</option><option value="asked"${a.claim_status === 'asked' ? ' selected' : ''}>Asked</option><option value="claimed"${a.claim_status === 'claimed' ? ' selected' : ''}>Claimed</option></select></label><label class="ax-ck"><input type="checkbox" name="sale_ok" value="1"${a.sale_ok ? ' checked' : ''}> The rights holder allows Collect and licences (terms below)</label></div>
<label>Terms, in their words<textarea name="terms" rows="3">${esc(a.terms || '')}</textarea></label><button class="buy-btn">Save</button></form>
${app.locals.shows ? app.locals.shows.desk(a) : ''}${app.locals.catalogue ? app.locals.catalogue.desk(a) : ''}<form method="post" action="/studio/art/${esc(a.slug)}/bring" class="ax-edit"><h2>Bring in more of the work</h2><p class="note">Wikimedia Commons categories, one address a line (a category of files: Paintings by…, Drawings by…, a codex). Each file comes in under the house’s shelf for open work with its own licence read from Commons; ${rights(a).state === 'pd' ? 'this artist is in the public domain, so the photographs are open, shown, never sold.' : 'this artist is under copyright: files come in kept back until a person looks.'} The feeds run one at a time in the background (Feeds in).</p>
<label>Commons categories<textarea name="cats" rows="4" placeholder="https://commons.wikimedia.org/wiki/Category:Paintings_by_Claude_Monet"></textarea></label><label class="ax-ck"><input type="checkbox" name="words" value="1" checked> Their writings from Project Gutenberg, found by name</label><label>At most, a feed<input name="max" value="400" inputmode="numeric"></label><button class="buy-btn">Bring it in</button></form>
${claims.length ? `<h2>Claims</h2><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>As</th><th>Note</th><th></th></tr></thead><tbody>${claims.map(c => `<tr><td>${esc(V.date(c.at))}</td><td>${esc(c.name)}<br><small>${esc(c.email)}</small></td><td>${esc(c.relation)}</td><td>${esc(c.note || '')}</td><td>${c.status === 'asked' ? `<form method="post" action="/studio/art/${esc(a.slug)}/claims/${c.id}" class="ax-f"><button name="do" value="accept" class="buy-btn">Accept</button> <button name="do" value="decline" class="btn">Decline</button></form>` : esc(c.status)}</td></tr>`).join('')}</tbody></table>` : ''}
${ws.length ? `<h2>In the house</h2><div class="ax-works ax-works-s">${ws.map(w => `<a class="ax-w" href="/studio/works/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"><span><b>${esc(w.title)}</b><br><small>${esc(w.maker_name)}</small></span></a>`).join('')}</div>` : ''}</section>` }));
  });
  app.post('/studio/art/:slug', studioOnly, (req, res) => {
    const a = bySlug(req.params.slug); if (!a) return res.sendStatus(404); const b = req.body;
    db.prepare('UPDATE artists SET name=?, sort_name=?, born=?, died=?, nationality=?, movement=?, bio=?, periods=?, sources=?, wiki=?, claimed_name=?, claimed_email=?, claim_status=?, sale_ok=?, terms=? WHERE id=?')
      .run(String(b.name || a.name).trim(), sortName(String(b.name || a.name).trim()), +b.born || null, +b.died || null, String(b.nationality || '').trim() || null, String(b.movement || '').trim() || null, String(b.bio || '').trim() || null, String(b.periods || '').trim() || null, String(b.sources || '').trim() || null, String(b.wiki || '').trim() || null, String(b.claimed_name || '').trim() || null, String(b.claimed_email || '').trim() || null, b.claim_status || null, b.sale_ok ? 1 : 0, String(b.terms || '').trim() || null, a.id);
    try { ledger.append(db, 'artist.edited', a.slug, {}); } catch (e) { /* */ }
    res.redirect(`/studio/art/${a.slug}?ok=saved`);
  });
  // The house's shelf for open work (31 Oct): works whose makers died long ago, shown free, credited, never sold.
  function shelf() {
    let m = db.prepare("SELECT * FROM makers WHERE handle='the-public-domain'").get(); if (m) return m;
    db.prepare("INSERT INTO makers (handle, name, kind, house, bio, joined_at, door) VALUES ('the-public-domain', 'The public domain', 'institution', 'Open to everyone', 'Works whose makers died long ago and that belong now to everyone: shown here free, credited, never sold.', datetime('now'), 'house')").run();
    return db.prepare("SELECT * FROM makers WHERE handle='the-public-domain'").get();
  }
  // Their writings: Gutendex by name, every book whose author carries every part of the name; English first.
  async function writingsFor(a, n = 8) {
    const R = app.locals.reading; if (!R || !R.bring) return [];
    const parts = norm(a.name).split(' ').filter(p => p.length > 2 && !['van', 'von', 'der', 'den', 'del', 'della'].includes(p)); if (!parts.length) return [];
    const r = await doFetch(`${process.env.GUTENDEX || 'https://gutendex.com'}/books/?search=${encodeURIComponent(a.name)}`); if (!r.ok) return [`gutendex ${r.status}`];
    const j = await r.json(); const out = [];
    const mine = (j.results || []).filter(b => (b.authors || []).some(x => parts.every(p => norm(x.name).includes(p)))).sort((x, y) => ((y.languages || []).includes('en') - (x.languages || []).includes('en')) || (y.download_count || 0) - (x.download_count || 0)).slice(0, n);
    for (const b of mine) { try { const t = await R.bring(b.id, { by: 'the hall', meta: b }); out.push(t && t.slug); } catch (e) { out.push(`${b.id}: ${e.message}`); } }
    return out;
  }
  async function bringArtist(a, { cats = [], words = true, max = 400 } = {}) {
    const m = shelf(); const out = { feeds: [], words: [] }; const F = app.locals.feeds; const pd = rights(a).state === 'pd';
    if (F) for (const url of cats) { if (!/^https:\/\/commons\.wikimedia\.org\/wiki\/Category:/.test(url)) { out.feeds.push(`not a Commons category: ${url}`); continue; } if (db.prepare("SELECT 1 FROM feeds WHERE url=? AND status NOT IN ('failed','stopped')").get(url)) { out.feeds.push(`already: ${url}`); continue; } try { out.feeds.push(F.enqueue({ name: `${a.name}: ${decodeURIComponent(url.split('Category:')[1]).replace(/_/g, ' ')}`, url, kind: 'commons', maker: m.handle, open: pd ? 'pd' : '', show: pd ? '1' : '', max: String(max), artist: a.name })); } catch (e) { out.feeds.push(String(e.message)); } }
    if (words) { try { out.words = await writingsFor(a); } catch (e) { out.words = [String(e.message)]; } }
    pageCache.delete(a.slug); try { ledger.append(db, 'artist.brought', a.slug, { feeds: out.feeds.length }); } catch (e) { /* */ }
    return out;
  }
  app.post('/studio/art/:slug/bring', studioOnly, async (req, res) => {
    const a = bySlug(req.params.slug); if (!a) return res.sendStatus(404);
    const out = await bringArtist(a, { cats: String(req.body.cats || '').split(/\s*\n\s*/).map(s => s.trim()).filter(Boolean), words: !!req.body.words, max: Math.min(2000, +req.body.max || 400) });
    if (req.body.json) return res.json({ ok: true, ...out });
    res.redirect(`/studio/art/${a.slug}?ok=${encodeURIComponent(`${out.feeds.filter(x => typeof x === 'number').length} feeds queued · ${out.words.filter(x => x && !/:/.test(x)).length} books`)}`);
  });
  app.post('/studio/art/:slug/claims/:id', studioOnly, (req, res) => {
    const a = bySlug(req.params.slug); const c = db.prepare('SELECT * FROM artist_claims WHERE id=? AND artist_id=?').get(+req.params.id, a ? a.id : -1); if (!a || !c) return res.sendStatus(404);
    const ok = req.body.do === 'accept';
    db.prepare("UPDATE artist_claims SET status=?, decided_at=datetime('now') WHERE id=?").run(ok ? 'accepted' : 'declined', c.id);
    if (ok) { db.prepare("UPDATE artists SET claim_status='claimed', claimed_name=?, claimed_email=? WHERE id=?").run(c.name, c.email, a.id); try { ledger.append(db, 'artist.claimed', a.slug, { relation: c.relation }); } catch (e) { /* */ } }
    else if (!db.prepare("SELECT 1 FROM artist_claims WHERE artist_id=? AND status='asked'").get(a.id) && a.claim_status === 'asked') db.prepare('UPDATE artists SET claim_status=NULL WHERE id=?').run(a.id);
    if (mail) mail.send({ to: c.email, subject: `${a.name}’s page on Watermark`, text: ok ? `${c.name}, the house has accepted your claim: ${a.name}’s page is yours to keep. Write to ${HOUSE} with the life in your words, the dates, and the terms on which photographs of the work may be collected, if at all, and the house will set them.\n\n${C.base}/art/${a.slug}\n\nWatermark` : `${c.name}, thank you for writing about ${a.name}’s page. The house could not confirm the standing described, so the page stays as it is. If there is more to say, answer this letter.\n\nWatermark` });
    res.redirect(`/studio/art/${a.slug}?ok=${ok ? 'accepted' : 'declined'}`);
  });

  // Al looks at every arrival (ART_PER_RUN at a time, newest first; a minute after start, then every ten minutes),
  // so the house knows what each picture shows before anyone asks; a work it has looked at carries `attribution`.
  let filling = false;
  async function fill(n = +(process.env.ART_PER_RUN || 30)) {
    if (!on() || !imageOf || filling) return 0; filling = true; let did = 0;
    try {
      // Living makers' arrivals only (8 Nov): a museum's or the shelf's work carries its artist in the record and is read by the standard; reading it here was most of the house's bill.
      const rows = db.prepare("SELECT w.* FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status IN ('held','hidden') AND w.attribution IS NULL AND w.artist_id IS NULL AND w.hand IS NULL AND w.open IS NULL AND COALESCE(m.kind,'maker') IN ('maker','estate') AND m.handle<>'the-public-domain' ORDER BY w.id DESC LIMIT ?").all(n);
      const S = app.locals.spend;
      for (const w of rows) { if (S && !S.ok('art')) break; try { await attribute(w); did++; } catch (e) { console.error('[art] fill', w.slug, e.message); db.prepare('UPDATE works SET attribution=? WHERE id=?').run(JSON.stringify({ art: false, missed: true, at: new Date().toISOString() }), w.id); } }
    } finally { filling = false; }
    return did;
  }
  if (!app.locals.noTimers && ROLE.chores) { app.locals.governor.boot('art fill', () => fill()); setInterval(() => fill().catch(() => {}), 10 * 60 * 1000).unref(); }

  app.locals.art = { shelf, chronology, wall: a => wallOf(a, chronology(a)), uncache: slug => { for (const k of ['s', 'p', 's|all', 'p|all']) pageCache.delete(`${slug}|${k}`); }, verdict, fill, ensure, link, unlink, ofWork, rights, blocks, label, block, attribute, attributionOf, bySlug, worksOf, countOf, MOVEMENTS, dates };
}

module.exports = { mountArt, rights, slugify, sortName, MOVEMENTS, PD_YEARS };
