// The Listening Room (Will, 24 Oct: "what Creative Commons works can we use to make a listening room"; "let's make it
// happen"; the Keys' room for sound, after the Screening Room's rules: chosen, played whole, with the notes).
// Three layers must clear for any recording: the composition, the recording, the performance. What clears, and is
// brought in here: recordings in the public domain (in the United States, published through 1925 under the Music
// Modernization Act: the Great 78 Project's shellac; the Library of Congress's jukebox), CC0 and public-domain
// releases (Musopen's commissions, the Open Goldberg Variations, the Open Well-Tempered Clavier), and CC-BY / BY-SA /
// BY-ND releases, played whole with the credit line. Non-commercial licences are turned away at the door: a members'
// room inside a house that sells work is not a place to argue about NC. Counsel reads the rule before it is relied on.
// The public domain comes in from the Internet Archive by identifier (its metadata API; the files stay at the Archive
// and are handed to <audio> as they are, as the Screening Room hands a master to <video>; nothing is proxied). A
// maker's own recording is the other road: a work of kind 'music' in the vault, the rights with the maker (next).
// `recordings`: one row per record (a side or an album: the files in order), with the sleeve notes the house writes.
const LICENSES = { pd: 'Public domain', cc0: 'CC0, no rights reserved', 'cc-by': 'CC BY', 'cc-by-sa': 'CC BY-SA', 'cc-by-nd': 'CC BY-ND' };
const PD_RECORDING_YEAR = +(process.env.PD_RECORDING_YEAR || (new Date().getUTCFullYear() - 101)); // US sound recordings: published this many years ago and before are public domain (1925 in 2026)
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; Watermark/1.0; +https://watermark.krafftco.com)' };
function mountListening(app, { db, V, C, ledger, isStudio, buyerOf, makerOf, fetchImpl }) {
  const { esc, tidy } = V; const I = require('./icons');
  db.exec(`CREATE TABLE IF NOT EXISTS recordings (id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, performer TEXT, composer TEXT, year TEXT, source TEXT NOT NULL DEFAULT 'archive', ia_id TEXT, files TEXT NOT NULL, license TEXT NOT NULL, license_url TEXT, credit TEXT, line TEXT, body TEXT, cover_url TEXT, cover_slug TEXT, maker_id INTEGER, chosen_by TEXT, why TEXT, seconds INTEGER, plays INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'shelved', at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const doFetch = (u, o) => (fetchImpl || fetch)(u, { signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined, ...(o || {}), headers: { ...UA, ...((o && o.headers) || {}) } });
  const slugify = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'record';
  const J = s => { try { return JSON.parse(s || '[]'); } catch (e) { return []; } };
  const mmss = s => { s = Math.round(+s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const first = v => Array.isArray(v) ? v[0] : v;
  const yearOf = m => { const y = String(first(m.year) || first(m.date) || '').match(/\d{4}/); return y ? y[0] : ''; };
  // The licence at the door: what the Archive's record says, read against the three layers.
  function clear(meta) {
    const url = String(first(meta.licenseurl) || '').toLowerCase(); const coll = [].concat(meta.collection || []).map(String); const year = +yearOf(meta) || 0;
    if (/publicdomain\/mark|publicdomain\/zero|\/zero\//.test(url)) return { ok: true, license: /zero/.test(url) ? 'cc0' : 'pd', url };
    if (/\/by-nc|\/nc\b|noncommercial/.test(url)) return { ok: false, why: 'a non-commercial licence (NC): not played in a house that sells work' };
    if (/\/by-sa\//.test(url)) return { ok: true, license: 'cc-by-sa', url };
    if (/\/by-nd\//.test(url)) return { ok: true, license: 'cc-by-nd', url };
    if (/\/by\//.test(url)) return { ok: true, license: 'cc-by', url };
    if (coll.includes('georgeblood') || coll.includes('78rpm')) { if (year && year <= PD_RECORDING_YEAR) return { ok: true, license: 'pd', url: 'https://www.loc.gov/programs/national-recording-preservation-board/' , note: `a recording published in ${year}, public domain in the United States` }; return { ok: false, why: `a 78 from ${year || 'an unknown year'}: recordings published after ${PD_RECORDING_YEAR} are not yet public domain in the United States` }; }
    if (year && year <= PD_RECORDING_YEAR && /78|shellac|cylinder/i.test(`${coll.join(' ')} ${first(meta.description) || ''}`)) return { ok: true, license: 'pd', note: `a recording published in ${year}` };
    return { ok: false, why: 'no licence the house can read on the record (the Archive carries no licence line and it is not an early recording)' };
  }
  // The files: the audio in a playable form, in the item's order, with the lengths the Archive measured.
  function tracks(id, files) {
    const audio = (files || []).filter(f => /\.(mp3|ogg|oga|m4a|flac)$/i.test(f.name || '') && !/_spectrogram|\.afpk/.test(f.name));
    const pick = {}; for (const f of audio) { const base = f.name.replace(/\.[^.]+$/, '').replace(/_(vbr|64kb)$/i, ''); const score = /\.mp3$/i.test(f.name) ? 3 : /\.m4a$/i.test(f.name) ? 2 : /\.ogg$|\.oga$/i.test(f.name) ? 1 : 0; if (!pick[base] || pick[base].score < score) pick[base] = { f, score }; }
    return Object.values(pick).map(({ f }) => ({ name: f.name, url: `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(f.name).replace(/%2F/g, '/')}`, title: tidy(String(f.title || f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '))), seconds: f.length ? (/:/.test(String(f.length)) ? String(f.length).split(':').reduce((a, b) => a * 60 + (+b), 0) : Math.round(+f.length)) : null, track: f.track ? +String(f.track).split('/')[0] : null })).sort((a, b) => (a.track || 999) - (b.track || 999) || a.name.localeCompare(b.name));
  }
  // Bring a record in by its Archive identifier.
  async function bring(id, by) {
    id = String(id || '').trim().replace(/^https?:\/\/archive\.org\/(details|download)\//, '').split(/[/?#]/)[0]; if (!id) return { ok: false, why: 'No identifier.' };
    if (db.prepare('SELECT slug FROM recordings WHERE ia_id=?').get(id)) return { ok: false, why: 'Already on the shelf.', slug: db.prepare('SELECT slug FROM recordings WHERE ia_id=?').get(id).slug };
    let data; try { const r = await doFetch(`https://archive.org/metadata/${encodeURIComponent(id)}`); if (!r.ok) return { ok: false, why: `The Archive answered ${r.status}.` }; data = await r.json(); } catch (e) { return { ok: false, why: `The Archive could not be reached: ${e.message}` }; }
    return shelveMeta(id, data, by);
  }
  function shelveMeta(id, data, by) {
    const meta = data.metadata || {}; if (!meta.title) return { ok: false, why: 'No such record at the Archive.' };
    const lic = clear(meta); if (!lic.ok) return { ok: false, why: `Turned away at the door: ${lic.why}.` };
    const list = tracks(id, data.files || []); if (!list.length) return { ok: false, why: 'The record carries no playable audio.' };
    const title = tidy(String(first(meta.title)).slice(0, 200)); let slug = slugify(title); if (db.prepare('SELECT 1 FROM recordings WHERE slug=?').get(slug)) slug = `${slug}-${id.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)}`;
    const performer = tidy(String([].concat(meta.creator || meta.artist || []).join(', ')).slice(0, 200)) || null; const composer = tidy(String(first(meta.composer) || '').slice(0, 200)) || null;
    const seconds = list.reduce((a, t) => a + (t.seconds || 0), 0) || null;
    const credit = `${performer ? performer + '. ' : ''}${title}${yearOf(meta) ? `, ${yearOf(meta)}` : ''}. ${LICENSES[lic.license]}${lic.note ? ` (${lic.note})` : ''}. From the Internet Archive, ${id}.`;
    const cover = data.misc && data.misc.image ? data.misc.image : `https://archive.org/services/img/${encodeURIComponent(id)}`;
    db.prepare('INSERT INTO recordings (slug, title, performer, composer, year, source, ia_id, files, license, license_url, credit, line, body, cover_url, chosen_by, seconds, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(slug, title, performer, composer, yearOf(meta) || null, 'archive', id, JSON.stringify(list), lic.license, lic.url || null, credit, null, String(first(meta.description) || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000) || null, cover, by || 'the house', seconds, 'shelved');
    try { ledger.append(db, 'recording.shelved', slug, { title, performer, year: yearOf(meta) || null, license: lic.license, by: by || 'the house' }); } catch (e) { /* */ }
    return { ok: true, slug, title, n: list.length, license: lic.license };
  }
  async function search(q) {
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(`(${q}) AND mediatype:audio`)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&fl[]=licenseurl&fl[]=collection&rows=30&sort[]=downloads+desc&output=json`;
    try { const r = await doFetch(url); if (!r.ok) return { error: `The Archive answered ${r.status}.` }; const j = await r.json(); return { docs: ((j.response || {}).docs || []).map(d => ({ id: d.identifier, title: first(d.title), creator: [].concat(d.creator || []).join(', '), year: first(d.year), door: clear({ licenseurl: d.licenseurl, collection: d.collection, year: d.year }) })) }; } catch (e) { return { error: e.message }; }
  }
  const rec = slug => db.prepare('SELECT r.*, m.handle AS maker_handle, m.name AS maker_name FROM recordings r LEFT JOIN makers m ON m.id=r.maker_id WHERE r.slug=?').get(String(slug));
  const cover = r => r.cover_slug ? `/img/${encodeURIComponent(r.cover_slug)}/screen` : r.cover_url || null;
  const K = () => app.locals.keys; const keyed = req => { const k = K() ? K().holds(req) : {}; return Object.keys(k).length > 0 || isStudio(req); };
  // Tonight's record: deterministic by the day, so the room holds still.
  function tonight() { const all = db.prepare("SELECT * FROM recordings WHERE status='playing' ORDER BY id").all(); if (!all.length) return null; const d = new Date(); const n = (d.getUTCFullYear() * 400 + d.getUTCMonth() * 31 + d.getUTCDate()); return all[n % all.length]; }
  const card = r => `<a class="lr-card" href="/listening/${esc(r.slug)}">${cover(r) ? `<img src="${esc(cover(r))}" alt="" loading="lazy">` : `<span class="lr-sleeve"><b>${esc(r.title)}</b></span>`}<span class="lr-ct"><b>${esc(r.title)}</b><i>${esc(r.performer || r.composer || '')}${r.year ? ` · ${esc(r.year)}` : ''}</i><small>${r.seconds ? mmss(r.seconds) + ' · ' : ''}${esc(LICENSES[r.license] || r.license)}</small></span></a>`;
  // The door.
  app.get('/listening', (req, res) => {
    const all = db.prepare("SELECT * FROM recordings WHERE status='playing' ORDER BY id DESC").all(); const t = tonight();
    const shellac = all.filter(r => r.license === 'pd' && r.year && +r.year <= PD_RECORDING_YEAR), open = all.filter(r => !shellac.includes(r) && r.source === 'archive'), makers = all.filter(r => r.source === 'maker');
    const shelf = (k, h, list) => list.length ? `<section class="lr-shelf"><p class="k">${k}</p><h2>${h}</h2><div class="lr-grid">${list.map(card).join('')}</div></section>` : '';
    res.send(V.layout({ title: 'The Listening Room · The Keys · Watermark', path: '/listening', desc: 'Records chosen and played whole: the shellac of the early century, the open recordings of the classical repertoire, and makers’ own masters. With the notes.', body: `<section class="ky-page lr">
<div class="ky-h"><p class="k"><a href="/keys">The Keys</a></p><h1>The Listening Room.</h1>
<p class="lede">A record is chosen, set on the turntable, and played whole, with the sleeve notes beside it. The shellac of the early century, digitised from the discs; the open recordings of the classical repertoire; and, as the vault takes sound, makers’ own masters, played as they were made.</p></div>
${t ? `<section class="lr-tonight"><p class="k">On the turntable</p><a class="lr-big" href="/listening/${esc(t.slug)}">${cover(t) ? `<img src="${esc(cover(t))}" alt="">` : ''}<span><b>${esc(t.title)}</b><i>${esc(t.performer || t.composer || '')}${t.year ? `, ${esc(t.year)}` : ''}</i>${t.line ? `<em>${esc(t.line)}</em>` : ''}<small>${I.play} Play it through</small></span></a></section>` : `<p class="note">The first records are being chosen.</p>`}
${shelf('The shellac', 'Recordings of the early century.', shellac)}
${shelf('The open repertoire', 'Recorded and released free.', open)}
${shelf('From the makers', 'Masters, as they were made.', makers)}
<section class="ky-rules"><h2>How the room works.</h2><ul><li><b>Chosen, not catalogued.</b> Every record is here because someone in the house chose it and wrote the sleeve.</li><li><b>Played whole.</b> A side plays through. You may lift the needle; the room does not shuffle.</li><li><b>Clear at the door.</b> Public-domain recordings (in the United States, published through ${PD_RECORDING_YEAR}), CC0, and CC BY, BY-SA and BY-ND releases, each with its credit line. Nothing non-commercial, nothing uncleared.</li><li><b>The makers’ own.</b> A maker’s recording is held like a photograph: the master in the vault, the rights the maker’s. ${I.key} A key opens the makers’ shelf.</li></ul></section>
</section>` }));
  });
  // The record.
  app.get('/listening/:slug', (req, res) => {
    const r = rec(req.params.slug); if (!r || (r.status !== 'playing' && !isStudio(req))) return res.sendStatus(404);
    if (r.source === 'maker' && !keyed(req) && !(makerOf(req) && makerOf(req).id === r.maker_id)) return res.status(403).send(V.layout({ title: `${r.title} · The Listening Room`, path: `/listening/${r.slug}`, body: `<section class="ky-page lr"><div class="ky-h"><p class="k"><a href="/listening">The Listening Room</a></p><h1>${esc(r.title)}</h1><p class="bc-door">A maker’s master plays for keyholders. <a href="/keys">The Keys</a>.</p></div></section>` }));
    const list = J(r.files); try { db.prepare('UPDATE recordings SET plays=plays+1 WHERE id=?').run(r.id); } catch (e) { /* */ }
    res.send(V.layout({ title: `${r.title} · The Listening Room · Watermark`, path: `/listening/${r.slug}`, desc: r.line || r.credit, bare: true, body: `<main class="lr-room" data-lr>
<header class="sc-top"><a href="/listening" class="tw-back">${I.back}<span>The Listening Room</span></a><p class="tw-title"><b>${esc(r.title)}</b><span>${esc(r.performer || r.composer || '')}${r.year ? `, ${esc(r.year)}` : ''}</span></p></header>
<section class="lr-deck">
<figure class="lr-disc"><span class="lr-platter" data-lr-platter>${cover(r) ? `<img src="${esc(cover(r))}" alt="">` : `<span class="lr-label"><b>${esc(r.title)}</b></span>`}</span><span class="lr-arm" data-lr-arm></span></figure>
<div class="lr-side">
<p class="k">${esc(r.chosen_by ? `Chosen by ${r.chosen_by}` : 'On the turntable')}</p><h1>${esc(r.title)}</h1><p class="lr-by">${esc(r.performer || '')}${r.composer && r.composer !== r.performer ? ` · ${esc(r.composer)}` : ''}${r.year ? ` · ${esc(r.year)}` : ''}</p>
${r.line ? `<p class="lede">${esc(r.line)}</p>` : ''}
<div class="lr-now" data-lr-now><button type="button" class="lr-play" data-lr-play aria-label="Play">${I.play}${I.pause}</button><span class="lr-nowt" data-lr-title>${esc(list[0].title)}</span><span class="lr-time" data-lr-time>0:00</span></div>
<div class="lr-bar" data-lr-bar><i data-lr-fill></i></div>
<ol class="lr-tracks" data-lr-tracks>${list.map((t, i) => `<li><button type="button" data-lr-track="${i}"><span class="lr-n">${i + 1}</span><span class="lr-tt">${esc(t.title)}</span><span class="lr-tl">${t.seconds ? mmss(t.seconds) : ''}</span></button></li>`).join('')}</ol>
<audio data-lr-audio preload="metadata" src="${esc(list[0].url)}"></audio>
</div></section>
${r.body || r.why ? `<section class="lr-notes"><p class="k">The sleeve</p>${r.why ? `<p class="lr-why">${esc(r.why)}</p>` : ''}${r.body ? `<p>${esc(r.body)}</p>` : ''}</section>` : ''}
<footer class="lr-foot"><p>${esc(r.credit || '')}${r.license_url ? ` <a href="${esc(r.license_url)}" rel="license">The licence</a>.` : ''}${r.ia_id ? ` <a href="https://archive.org/details/${esc(r.ia_id)}">The record at the Archive</a>.` : ''}</p><p>Played whole, in the Keys. ${esc(C.base.replace(/^https?:\/\//, ''))}/listening</p></footer>
<script>window.__LR=${JSON.stringify({ tracks: list.map(t => ({ url: t.url, title: t.title })) })}</script>
</main><script src="/static/listening.js?v=${esc(V.VER)}" defer></script>` }));
  });
  // The Studio: search the Archive, bring a record in, write the sleeve, set it playing.
  app.get('/studio/listening', async (req, res) => {
    if (!isStudio(req)) return res.sendStatus(403); V.setDeskPath('/studio/listening');
    const q = String(req.query.q || '').trim(); const found = q ? await search(q) : null;
    const rows = db.prepare('SELECT * FROM recordings ORDER BY id DESC').all();
    const works = db.prepare("SELECT slug, title FROM works WHERE status='held' ORDER BY stars DESC, id DESC LIMIT 200").all();
    res.send(V.layout({ title: 'The Listening Room · Studio', path: '/studio/listening', studio: true, body: `<section class="desk"><header class="dk-h"><p class="k">Programme</p><h1>The Listening Room.</h1><p class="lede">Records brought in from the Internet Archive, cleared at the door (public domain through ${PD_RECORDING_YEAR}, CC0, CC BY / BY-SA / BY-ND; never NC), the sleeve written here, set playing. The files stay at the Archive.</p>${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}</header>
<form method="get" class="rq-f" action="/studio/listening"><label>Search the Archive<input name="q" value="${esc(q)}" placeholder="Caruso 1920 · Musopen Chopin · Open Goldberg"></label><button class="buy-btn">Search</button></form>
<form method="post" class="rq-f" action="/studio/listening/bring"><label>Or an identifier or address<input name="id" placeholder="78_…  or https://archive.org/details/…"></label><button class="buy-btn">Bring it in</button></form>
${found ? found.error ? `<p class="note">${esc(found.error)}</p>` : `<table class="tbl lr-found"><thead><tr><th>Record</th><th>Who</th><th>Year</th><th>At the door</th><th></th></tr></thead><tbody>${found.docs.map(d => `<tr><td><a href="https://archive.org/details/${esc(d.id)}">${esc(d.title || d.id)}</a><br><small>${esc(d.id)}</small></td><td>${esc(d.creator || '')}</td><td>${esc(d.year || '')}</td><td>${d.door.ok ? `<b>${esc(LICENSES[d.door.license])}</b>` : `<small>${esc(d.door.why)}</small>`}</td><td>${d.door.ok ? `<form method="post" action="/studio/listening/bring"><input type="hidden" name="id" value="${esc(d.id)}"><button class="buy-btn small">Bring in</button></form>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}
<h2>The shelf</h2>${rows.length ? rows.map(r => `<details class="lr-row"><summary>${cover(r) ? `<img src="${esc(cover(r))}" alt="">` : ''}<b>${esc(r.title)}</b> <span>${esc(r.performer || '')}${r.year ? ` · ${esc(r.year)}` : ''} · ${esc(LICENSES[r.license] || r.license)} · ${J(r.files).length} tracks · ${r.status === 'playing' ? 'playing' : 'shelved'} · ${r.plays} plays</span></summary>
<form method="post" action="/studio/listening/${r.id}" class="rq-f"><label>Title<input name="title" value="${esc(r.title)}"></label><label>Performer<input name="performer" value="${esc(r.performer || '')}"></label><label>Composer<input name="composer" value="${esc(r.composer || '')}"></label><label>Year<input name="year" value="${esc(r.year || '')}"></label>
<label>A line<input name="line" value="${esc(r.line || '')}" maxlength="240"></label><label>Chosen by<input name="chosen_by" value="${esc(r.chosen_by || '')}"></label><label>Why<textarea name="why" rows="2">${esc(r.why || '')}</textarea></label><label>The sleeve<textarea name="body" rows="5">${esc(r.body || '')}</textarea></label>
<label>Cover, a held work<select name="cover_slug"><option value="">The Archive’s own image</option>${works.map(w => `<option value="${esc(w.slug)}"${w.slug === r.cover_slug ? ' selected' : ''}>${esc(w.title)}</option>`).join('')}</select></label>
<label>Status<select name="status"><option value="shelved"${r.status === 'shelved' ? ' selected' : ''}>Shelved (not shown)</option><option value="playing"${r.status === 'playing' ? ' selected' : ''}>Playing (in the room)</option></select></label>
<button class="buy-btn">Save</button> <a href="/listening/${esc(r.slug)}">Open the room</a></form></details>`).join('') : '<p class="note">Nothing on the shelf yet. Search the Archive, or bring in an identifier: try the Great 78 Project (collection georgeblood) for a 78 from 1925 or before, or Musopen for the classical repertoire.</p>'}
</section>` }));
  });
  app.post('/studio/listening/bring', async (req, res) => { if (!isStudio(req)) return res.sendStatus(403); const out = await bring(req.body.id, 'the house'); res.redirect('/studio/listening?ok=' + encodeURIComponent(out.ok ? `On the shelf: ${out.title}, ${out.n} track${out.n === 1 ? '' : 's'}, ${LICENSES[out.license]}. Write the sleeve and set it playing.` : out.why)); });
  app.post('/studio/listening/:id', (req, res) => {
    if (!isStudio(req)) return res.sendStatus(403); const r = db.prepare('SELECT * FROM recordings WHERE id=?').get(+req.params.id); if (!r) return res.sendStatus(404); const b = req.body || {};
    const s = (k, n) => String(b[k] || '').trim().slice(0, n) || null;
    db.prepare('UPDATE recordings SET title=?, performer=?, composer=?, year=?, line=?, chosen_by=?, why=?, body=?, cover_slug=?, status=? WHERE id=?').run(s('title', 200) || r.title, s('performer', 200), s('composer', 200), s('year', 12), s('line', 240), s('chosen_by', 80), s('why', 1200), s('body', 4000), s('cover_slug', 120), b.status === 'playing' ? 'playing' : 'shelved', r.id);
    if (b.status === 'playing' && r.status !== 'playing') { try { ledger.append(db, 'recording.playing', r.slug, { title: s('title', 200) || r.title, performer: s('performer', 200) || r.performer, year: s('year', 12) || r.year }); } catch (e) { /* */ } }
    res.redirect('/studio/listening?ok=' + encodeURIComponent('Saved.'));
  });
  app.locals.listening = { bring, shelveMeta, clear, tracks, search, tonight, open: () => db.prepare("SELECT COUNT(*) n FROM recordings WHERE status='playing'").get().n > 0, LICENSES, PD_RECORDING_YEAR };
  return app.locals.listening;
}
module.exports = { mountListening, LICENSES };
