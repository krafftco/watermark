// Editions of the house (Will, 27 Oct: "think about how we want to really make some great jewels of books"; "do it,
// start with Franklin's biography and then yes all of these"; docs/HOUSE.md 'Editions of the house'). Six hundred bound
// titles is a library; a jewel is one book given everything: the text edited, the pictures chosen, read aloud in the
// house voice, the jacket read by a person, a facing translation, an introduction in someone's own voice, a printed run.
// This module: the mark (`texts.edition`), the shelf at the head of the Library, the page's block, the plate door (a
// great edition's pictures brought onto a book by hand, from Commons or any address), the reading aloud (a chapter at a
// time into the vault, served to the reader and to the Listening Room as a record), the twelve on the Studio's desk.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');

// The twelve (drafts): found on the shelf by title and author; the illustrator and the edition a person should look for.
const TWELVE = [
  { title: /autobiography of benjamin franklin/i, author: /franklin/i, name: 'The Autobiography of Benjamin Franklin', plates: 'Duplessis’s portrait (1778), the Franklin press, the Pennsylvania Gazette, Poor Richard’s Almanack: Commons, all public domain.' },
  { title: /alice.s adventures in wonderland/i, author: /carroll/i, name: 'Alice’s Adventures in Wonderland', illustrator: 'John Tenniel', plates: 'Tenniel, 1865: in the Gutenberg HTML already.' },
  { title: /grimm.s fairy tales|household tales/i, author: /grimm/i, name: 'Grimm’s Fairy Tales', illustrator: 'Arthur Rackham', plates: 'Rackham, 1909 (Constable): Commons, category “Arthur Rackham – Grimm”.' },
  { title: /paradise lost/i, author: /milton/i, name: 'Paradise Lost', illustrator: 'Gustave Doré', plates: 'Doré, 1866: Commons, “Paradise Lost by Gustave Doré”.' },
  { title: /^(the )?(divine comedy|inferno)/i, author: /dante|alighieri/i, name: 'The Inferno', illustrator: 'Gustave Doré', plates: 'Doré, 1861: Commons; the Italian facing (Gutenberg 1012).' },
  { title: /^walden/i, author: /thoreau/i, name: 'Walden', plates: 'The 1854 title page, the Walden Pond survey, the house: Commons.' },
  { title: /leaves of grass/i, author: /whitman/i, name: 'Leaves of Grass', plates: 'The 1855 frontispiece (Hollyer’s engraving of Whitman): Commons.' },
  { title: /^meditations/i, author: /aurelius/i, name: 'Meditations', plates: 'The equestrian statue, the Column, the busts: Commons.' },
  { title: /moby.dick|the whale/i, author: /melville/i, name: 'Moby-Dick', illustrator: 'Rockwell Kent', plates: 'Kent, 1930 (Lakeside Press): check the rights; the 1892 edition’s plates are free.' },
  { title: /treasure island/i, author: /stevenson/i, name: 'Treasure Island', illustrator: 'N. C. Wyeth', plates: 'Wyeth, 1911 (Scribner’s): public domain; Commons, “Treasure Island (Wyeth)”.' },
  { title: /wind in the willows/i, author: /grahame/i, name: 'The Wind in the Willows', illustrator: 'E. H. Shepard', plates: 'Shepard, 1931: check the rights (Shepard died 1976); Paul Bransom, 1913, is free.' },
  { title: /pride and prejudice/i, author: /austen/i, name: 'Pride and Prejudice', illustrator: 'Hugh Thomson', plates: 'Thomson, 1894 (the Peacock edition): Commons, “Pride and Prejudice (Thomson)”.' },
];

const MIN_SIDE = 220, MAX_BYTES = 12e6, MAX_PLATES = 120;

function mountJewels(app, { db, V, C, store, isStudio, ledger, doFetch, governor }) {
  const { esc, tidy } = V; const I = require('./icons');
  const dir = path.join(C.dataDir, 'texts'); fs.mkdirSync(dir, { recursive: true });
  const rdir = path.join(C.dataDir, 'readings'); fs.mkdirSync(rdir, { recursive: true });
  let migrated = false;
  function migrate() { // the texts table is library.js's, made after this mounts
    if (migrated) return true;
    try { for (const [col, ddl] of [['edition', 'TEXT'], ['edition_no', 'INTEGER'], ['edition_intro', 'TEXT'], ['edition_intro_by', 'TEXT'], ['edition_at', 'TEXT']]) if (!db.prepare(`SELECT 1 FROM pragma_table_info('texts') WHERE name='${col}'`).get()) db.exec(`ALTER TABLE texts ADD COLUMN ${col} ${ddl}`); migrated = true; return true; } catch (e) { return false; }
  }
  setTimeout(migrate, 0);
  db.exec(`CREATE TABLE IF NOT EXISTS readings (id INTEGER PRIMARY KEY, text_id INTEGER NOT NULL, chapter INTEGER NOT NULL, hash TEXT NOT NULL, file TEXT NOT NULL, bytes INTEGER, provider TEXT, voice TEXT, made_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(text_id, chapter))`);
  const picturesOf = t => { try { return t && t.pictures ? JSON.parse(t.pictures) : []; } catch (e) { return []; } };
  const BP = () => app.locals.bookplates;

  // The mark.
  const jewels = () => { if (!migrate()) return []; return db.prepare("SELECT t.*, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.edition='jewel' AND t.status='held' ORDER BY t.edition_no, t.id").all(); };
  const isJewel = t => !!(t && t.edition === 'jewel');
  function make(t, { by = 'studio' } = {}) {
    migrate(); if (isJewel(t)) return t.edition_no;
    const no = (db.prepare("SELECT COALESCE(MAX(edition_no),0)+1 n FROM texts").get().n);
    db.prepare("UPDATE texts SET edition='jewel', edition_no=?, edition_at=datetime('now') WHERE id=?").run(no, t.id);
    try { ledger.append(db, 'edition.made', t.slug, { title: t.title, no, by }); } catch (e) { /* */ }
    if (app.locals.findIndexDirty) app.locals.findIndexDirty();
    return no;
  }
  function unmake(t) { migrate(); db.prepare("UPDATE texts SET edition=NULL WHERE id=?").run(t.id); try { ledger.append(db, 'edition.unmade', t.slug, { title: t.title }); } catch (e) { /* */ } }

  // The twelve: which are on the shelf, which are already editions.
  function twelve() {
    migrate(); const list = db.prepare("SELECT id, slug, title, author, edition, edition_no, pictures, illustrator FROM texts WHERE status='held' AND public=1").all();
    return TWELVE.map(j => { const t = list.find(x => j.title.test(String(x.title || '')) && j.author.test(String(x.author || ''))); return { ...j, t, jewel: t && t.edition === 'jewel', pictures: t ? picturesOf(t).length : 0 }; });
  }

  // What a jewel has, part by part.
  function parts(t) {
    const ps = picturesOf(t); const rd = readings(t); const chs = chaptersOf(t.body).length; const J = app.locals.jacket;
    const se = /standardebooks\.org/.test(String(t.source || ''));
    return [
      { k: 'text', name: 'The text', done: se, line: se ? 'The Standard Ebooks edition, set for the house.' : 'The Project Gutenberg text; the Standard Ebooks edition is the finer one.' },
      { k: 'pictures', name: 'The pictures', done: ps.length > 0, line: ps.length ? `${ps.length} plate${ps.length === 1 ? '' : 's'}${t.illustrator ? `, ${t.illustrator}` : ''}.` : 'None yet.' },
      { k: 'voice', name: 'Read aloud', done: chs > 0 && rd.length >= chs, line: rd.length ? `${rd.length} of ${chs} chapter${chs === 1 ? '' : 's'} in the house voice.` : 'Not yet read.' },
      { k: 'jacket', name: 'The jacket', done: !!(J && J.line && J.line(t)), line: J && J.line && J.line(t) ? 'Written.' : 'Not yet written.' },
      { k: 'intro', name: 'An introduction', done: !!t.edition_intro, line: t.edition_intro ? `By ${t.edition_intro_by || 'the house'}.` : 'Not yet.' },
      { k: 'print', name: 'The printed edition', done: false, line: 'A numbered run through the press, to come.' },
    ];
  }
  function chaptersOf(body) { return BP() ? BP().chaptersOf(body) : []; }

  // The plates: pictures brought onto a book by hand. A line each: an address (or a Commons File: name) | the chapter
  // (1-based; blank or 0 for the end plates) | a caption. Kept beside the book's own pictures through the same pipeline.
  async function sourceOf(line) {
    let s = line.trim(); if (!s) return null;
    if (/^File:/i.test(s) || /commons\.wikimedia\.org\/wiki\/File:/i.test(s)) {
      const name = s.replace(/^.*\/wiki\//, '').replace(/^File:/i, ''); const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=2400&titles=${encodeURIComponent('File:' + decodeURIComponent(name))}`;
      const r = await doFetch(url); if (!r.ok) throw new Error(`commons ${r.status}`); const j = await r.json(); const p = Object.values((j.query || {}).pages || {})[0]; const ii = p && (p.imageinfo || [])[0]; if (!ii) throw new Error('not on Commons');
      const em = ii.extmetadata || {}; const v = k => String(((em[k] || {}).value || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return { url: ii.thumburl || ii.url, credit: [v('Artist').replace(/\s*\(.*$/, ''), v('LicenseShortName')].filter(Boolean).join(' · '), caption: v('ObjectName') || '' };
    }
    if (/^https?:\/\//i.test(s)) return { url: s, credit: '', caption: '' };
    return null;
  }
  async function addPlates(t, lines) {
    const sharp = require('sharp'); const ps = picturesOf(t); const chs = chaptersOf(t.body); let added = 0; const missed = [];
    fs.mkdirSync(path.join(dir, t.slug), { recursive: true });
    for (const raw of String(lines || '').split(/\r?\n/)) {
      if (!raw.trim() || ps.length >= MAX_PLATES) continue;
      const [a, b, ...rest] = raw.split('|'); const chapter = Math.max(0, parseInt(String(b || '').trim(), 10) || 0); let caption = rest.join('|').trim();
      try {
        const src = await sourceOf(a); if (!src) { missed.push(`${raw.trim()}: not an address`); continue; }
        if (!caption) caption = src.caption || '';
        const ir = await doFetch(src.url); if (!ir.ok) { missed.push(`${raw.trim()}: ${ir.status}`); continue; }
        const buf = Buffer.from(await ir.arrayBuffer()); if (buf.length < 1500 || buf.length > MAX_BYTES) { missed.push(`${raw.trim()}: ${buf.length} bytes`); continue; }
        const meta = await sharp(buf, { failOn: 'error' }).metadata(); if (!meta.width || Math.min(meta.width, meta.height) < MIN_SIDE) { missed.push(`${raw.trim()}: too small`); continue; }
        const n = ps.reduce((m, p) => Math.max(m, p.n), 0) + 1; const file = path.join(dir, t.slug, `pl-${n}.jpg`);
        const info = await sharp(buf).rotate().resize({ width: 1600, height: 2000, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(file);
        try { if (store && store.kind === 's3') await store.put(`texts/${t.slug}/pl-${n}.jpg`, file, 'image/jpeg'); } catch (e) { /* the local copy serves */ }
        const where = chapter && chapter <= chs.length ? { c: chapter - 1, p: 0, at: 'before' } : { c: -1, p: -1, at: 'end' };
        ps.push({ n, w: info.width, h: info.height, caption: caption.slice(0, 300), credit: src.credit || '', cover: ps.length === 0, by: 'hand', ...where }); added++;
      } catch (e) { missed.push(`${raw.trim()}: ${e.message}`); }
    }
    db.prepare('UPDATE texts SET pictures=? WHERE id=?').run(JSON.stringify(ps), t.id);
    try { if (added) ledger.append(db, 'edition.plated', t.slug, { title: t.title, added }); } catch (e) { /* */ }
    return { added, missed };
  }

  // Read aloud: a chapter at a time into the vault; served to the reader and, as a record, to the Listening Room.
  const readings = t => { try { return db.prepare('SELECT * FROM readings WHERE text_id=? ORDER BY chapter').all(t.id); } catch (e) { return []; } };
  const S = () => app.locals.speech;
  const textOf = ch => [ch.head ? ch.head.replace(/\*/g, '') : '', ...ch.paras.map(p => p.replace(/[*_]/g, ''))].filter(Boolean).join('\n\n');
  async function readChapter(t, c) {
    const chs = chaptersOf(t.body); const ch = chs[c]; if (!ch) return null; const sp = S(); if (!sp || !sp.on() || !sp.render) throw new Error('no voice: set ELEVENLABS_API_KEY or OPENAI_API_KEY');
    const text = textOf(ch).slice(0, 60000); const hash = sp.hashOf(text);
    const had = db.prepare('SELECT * FROM readings WHERE text_id=? AND chapter=?').get(t.id, c); if (had && had.hash === hash) return had;
    const buf = await sp.render(text); const key = `readings/${t.slug}-${c}-${hash}.mp3`; const local = path.join(rdir, path.basename(key));
    fs.writeFileSync(local, buf); try { if (store && store.kind === 's3') await store.put(key, local, 'audio/mpeg'); } catch (e) { console.error('[readings] store', e.message); }
    db.prepare('INSERT INTO readings (text_id, chapter, hash, file, bytes, provider, voice) VALUES (?,?,?,?,?,?,?) ON CONFLICT(text_id, chapter) DO UPDATE SET hash=excluded.hash, file=excluded.file, bytes=excluded.bytes, provider=excluded.provider, voice=excluded.voice, made_at=datetime(\'now\')').run(t.id, c, hash, key, buf.length, sp.provider(), sp.voice());
    return db.prepare('SELECT * FROM readings WHERE text_id=? AND chapter=?').get(t.id, c);
  }
  const q = []; let on = false; const job = { done: [], missed: [] };
  async function pump() {
    if (on) return; if (governor && !governor.chores()) return; on = true;
    try {
      while (q.length) {
        const { slug, c } = q.shift();
        const t = db.prepare('SELECT * FROM texts WHERE slug=?').get(slug); if (!t) continue;
        try { await (governor ? governor.turn('reading', () => readChapter(t, c)) : readChapter(t, c)); job.done.push(`${t.title} · ${c + 1}`); record(t); } catch (e) { job.missed.push(`${t.title} · ${c + 1}: ${e.message}`); if (/no voice|\b(401|402|403|429)\b/.test(e.message)) { q.length = 0; break; } }
        if (governor) await governor.settle('reading');
      }
    } finally { on = false; }
  }
  function readAloud(t) { const chs = chaptersOf(t.body); const have = new Set(readings(t).map(r => r.chapter)); let n = 0; chs.forEach((ch, c) => { if (!have.has(c) && !q.some(x => x.slug === t.slug && x.c === c)) { q.push({ slug: t.slug, c }); n++; } }); setTimeout(pump, app.locals.noTimers ? 0 : 300); return n; }
  // The record in the Listening Room: the chapters as sides, the binding as the sleeve; made or refreshed as chapters land.
  function record(t) {
    const rd = readings(t); if (!rd.length) return null; const chs = chaptersOf(t.body);
    const files = rd.map(r => ({ url: `/read/${t.slug}/audio/${r.chapter}`, title: (chs[r.chapter] && chs[r.chapter].head) ? chs[r.chapter].head.replace(/\*/g, '') : `Chapter ${r.chapter + 1}`, seconds: null }));
    const slug = `reading-${t.slug}`; const by = require('./binding').byName(t.author);
    const row = db.prepare('SELECT id FROM recordings WHERE slug=?').get(slug);
    const vals = { title: tidy(t.title), performer: 'Read by the house', composer: by, year: String(t.year || ''), files: JSON.stringify(files), credit: `${by ? by + '. ' : ''}Read aloud in the house voice.`, line: `${tidy(t.title)}, read a chapter at a time in the house voice.`, cover_url: `/binding/${t.slug}.svg`, license: 'pd' };
    if (row) db.prepare('UPDATE recordings SET title=?, performer=?, composer=?, year=?, files=?, credit=?, line=?, cover_url=? WHERE id=?').run(vals.title, vals.performer, vals.composer, vals.year, vals.files, vals.credit, vals.line, vals.cover_url, row.id);
    else { db.prepare("INSERT INTO recordings (slug, title, performer, composer, year, source, files, license, credit, line, cover_url, status) VALUES (?,?,?,?,?,'reading',?,?,?,?,?,'playing')").run(slug, vals.title, vals.performer, vals.composer, vals.year, vals.files, vals.license, vals.credit, vals.line, vals.cover_url); try { ledger.append(db, 'edition.read', t.slug, { title: t.title, chapters: rd.length }); } catch (e) { /* */ } }
    return slug;
  }
  app.get('/read/:slug/audio/:c', async (req, res) => {
    const t = db.prepare("SELECT id, slug, public, status FROM texts WHERE slug=?").get(String(req.params.slug)); if (!t || t.status !== 'held' || (!t.public && !isStudio(req))) return res.sendStatus(404);
    const r = db.prepare('SELECT * FROM readings WHERE text_id=? AND chapter=?').get(t.id, +req.params.c); if (!r) return res.sendStatus(404);
    const local = path.join(rdir, path.basename(r.file));
    if (!fs.existsSync(local)) { try { if (store && store.kind === 's3') { const b = await store.get(r.file); if (b) fs.writeFileSync(local, b); } } catch (e) { /* below */ } }
    if (!fs.existsSync(local)) return res.sendStatus(404);
    res.set('Cache-Control', 'public, max-age=86400'); res.type('audio/mpeg'); res.sendFile(local);
  });

  // The page's block, the shelf, the cover's line, the reader's player.
  function block(t, req) {
    migrate(); const studio = isStudio(req); if (!isJewel(t) && !studio) return '';
    const P = parts(t); const j = TWELVE.find(x => x.title.test(String(t.title || '')) && x.author.test(String(t.author || '')));
    const desk = studio ? `<div class="jl-desk">${isJewel(t) ? `<form method="post" action="/studio/library/${esc(t.slug)}/edition"><input type="hidden" name="do" value="unmake"><button type="submit">Take it off the editions shelf</button></form>` : `<form method="post" action="/studio/library/${esc(t.slug)}/edition"><input type="hidden" name="do" value="make"><button type="submit" class="buy-btn">Make it an edition of the house</button></form>`}
<form method="post" action="/studio/library/${esc(t.slug)}/plates" class="jl-f"><label>Bring plates by hand <small>a line each: an address or a Commons File: name · | the chapter (blank for the end plates) · | a caption${j && j.plates ? `. ${esc(j.plates)}` : ''}</small><textarea name="lines" rows="4" placeholder="File:Joseph_Siffred_Duplessis_-_Benjamin_Franklin_-_Google_Art_Project.jpg | 1 | Franklin in 1778, by Duplessis"></textarea></label><button type="submit">Bring them</button></form>
<form method="post" action="/studio/library/${esc(t.slug)}/read-aloud" class="jl-f"><button type="submit">${readings(t).length ? 'Read the rest aloud' : 'Read it aloud, in the house voice'}</button><small>${S() && S().on() ? `${S().provider()} · a chapter at a time, one lane, in the background.` : 'No voice is set (ELEVENLABS_API_KEY or OPENAI_API_KEY).'}</small></form>
<form method="post" action="/studio/library/${esc(t.slug)}/intro" class="jl-f"><label>An introduction, in someone’s own voice<textarea name="intro" rows="6">${esc(t.edition_intro || '')}</textarea></label><label>By <input name="by" value="${esc(t.edition_intro_by || '')}" placeholder="Will Fullerton"></label><button type="submit">Set</button></form></div>` : '';
    if (!isJewel(t)) return `<section class="jl jl-not"><p class="k">Editions of the house</p><p>Not yet an edition.${j ? ` One of the twelve: ${esc(j.name)}.` : ''}</p>${desk}</section>`;
    return `<section class="jl" id="edition"><p class="k">${I.wave} An edition of the house · No. ${t.edition_no}</p><h2>Given everything.</h2><ul class="jl-parts">${P.map(p => `<li class="${p.done ? 'on' : ''}"><b>${esc(p.name)}</b><span>${esc(p.line)}</span></li>`).join('')}</ul>${t.edition_intro ? `<div class="jl-intro"><p class="k">An introduction${t.edition_intro_by ? ` · ${esc(t.edition_intro_by)}` : ''}</p>${t.edition_intro.split(/\n\s*\n/).map(p => `<p>${esc(p.trim())}</p>`).join('')}</div>` : ''}${readings(t).length ? `<p class="jl-hear"><a href="/listening/reading-${esc(t.slug)}">Hear it read, in the Listening Room</a> · ${readings(t).length} chapter${readings(t).length === 1 ? '' : 's'}</p>` : ''}${desk}</section>`;
  }
  const coverLine = t => (isJewel(t) ? `<p class="jl-cv">${I.wave} An edition of the house, No. ${t.edition_no}${t.edition_intro_by ? ` · introduced by ${esc(t.edition_intro_by)}` : ''}</p>` : '');
  const hearChapter = (t, c) => { const r = db.prepare('SELECT 1 FROM readings WHERE text_id=? AND chapter=?').get(t.id, c); return r ? `<p class="jl-play"><audio controls preload="none" src="/read/${esc(t.slug)}/audio/${c}"></audio><small>Read in the house voice.</small></p>` : ''; };
  function shelf() { const js = jewels(); if (!js.length || !app.locals.shelves) return ''; return app.locals.shelves.plank('Editions of the house', js.map(t => ({ ...t, hasBody: !!t.body, note: `No. ${t.edition_no}` })), { line: 'A book given everything: the text, the plates, the voice, an introduction, a printed run.', id: 'shelf-editions' }); }
  // The twelve, on the Studio's desk.
  function desk() {
    const rows = twelve();
    return `<section class="jl-tw"><h2>The twelve</h2><p class="note">The first editions of the house, one a week. Found on the shelf by title; made by a press of the button; the plates and the voice from each book’s page.</p><table class="tbl"><thead><tr><th>Book</th><th>On the shelf</th><th>Plates</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.name)}${r.illustrator ? `<br><small>${esc(r.illustrator)}</small>` : ''}</td><td>${r.t ? `<a href="/library/${esc(r.t.slug)}">${esc(tidy(r.t.title))}</a>${r.jewel ? ` · <b>No. ${r.t.edition_no}</b>` : ''}` : `<a href="/studio/reading?q=${encodeURIComponent(r.name)}">Not yet · find it</a>`}</td><td>${r.t ? `${r.pictures || '0'}<br><small>${esc(r.plates || '')}</small>` : ''}</td><td>${r.t && !r.jewel ? `<form method="post" action="/studio/library/${esc(r.t.slug)}/edition"><input type="hidden" name="do" value="make"><button type="submit">Make it</button></form>` : ''}</td></tr>`).join('')}</tbody></table></section>`;
  }

  const back = (req, t, ok) => `/library/${encodeURIComponent(t.slug)}?ok=${encodeURIComponent(ok)}#edition`;
  app.post('/studio/library/:slug/edition', (req, res) => { if (!isStudio(req)) return res.sendStatus(403); const t = db.prepare('SELECT * FROM texts WHERE slug=?').get(String(req.params.slug)); if (!t) return res.sendStatus(404); if (req.body.do === 'unmake') { unmake(t); return res.redirect(`/library/${encodeURIComponent(t.slug)}`); } const no = make(t); res.redirect(back(req, t, `An edition of the house, No. ${no}.`)); });
  app.post('/studio/library/:slug/plates', async (req, res) => { if (!isStudio(req)) return res.sendStatus(403); const t = db.prepare('SELECT * FROM texts WHERE slug=?').get(String(req.params.slug)); if (!t) return res.sendStatus(404); try { const r = await addPlates(t, req.body.lines); res.redirect(back(req, t, `${r.added} plate${r.added === 1 ? '' : 's'} in${r.missed.length ? `; not: ${r.missed.join('; ').slice(0, 400)}` : ''}.`)); } catch (e) { res.redirect(back(req, t, `Not brought: ${e.message}`)); } });
  app.post('/studio/library/:slug/read-aloud', (req, res) => { if (!isStudio(req)) return res.sendStatus(403); const t = db.prepare('SELECT * FROM texts WHERE slug=?').get(String(req.params.slug)); if (!t) return res.sendStatus(404); const n = readAloud(t); res.redirect(back(req, t, n ? `${n} chapter${n === 1 ? '' : 's'} queued for the house voice; each lands as it is read.` : 'Every chapter is read.')); });
  app.post('/studio/library/:slug/intro', (req, res) => { if (!isStudio(req)) return res.sendStatus(403); migrate(); const t = db.prepare('SELECT * FROM texts WHERE slug=?').get(String(req.params.slug)); if (!t) return res.sendStatus(404); db.prepare('UPDATE texts SET edition_intro=?, edition_intro_by=? WHERE id=?').run(String(req.body.intro || '').trim().slice(0, 20000) || null, String(req.body.by || '').trim().slice(0, 120) || null, t.id); res.redirect(back(req, t, 'The introduction is set.')); });

  app.locals.jewels = { TWELVE, jewels, isJewel, make, unmake, twelve, parts, addPlates, readAloud, readChapter, readings, record, block, coverLine, hearChapter, shelf, desk, job };
  return app.locals.jewels;
}
module.exports = { mountJewels, TWELVE };
