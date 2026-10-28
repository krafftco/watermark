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
const LICENSES = { pd: 'Public domain', cc0: 'CC0, no rights reserved', 'cc-by': 'CC BY', 'cc-by-sa': 'CC BY-SA', 'cc-by-nd': 'CC BY-ND', maker: 'The maker’s own, all rights reserved' };
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
    // 'licenses/publicdomain' and 'choose/publicdomain' are the uploader's word, not a mark: in, but marked so the house looks before it plays.
    if (/publicdomain/.test(url)) return { ok: true, license: 'pd', url, trust: 'uploader', note: 'said to be public domain by its uploader; the house checks before it plays' };
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
    const pick = {}, lossless = {}; const urlOf = f => `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(f.name).replace(/%2F/g, '/')}`;
    for (const f of audio) { const base = f.name.replace(/\.[^.]+$/, '').replace(/_(vbr|64kb)$/i, ''); if (/\.flac$/i.test(f.name)) { lossless[base] = urlOf(f); continue; } const score = /\.mp3$/i.test(f.name) ? 3 : /\.m4a$/i.test(f.name) ? 2 : /\.ogg$|\.oga$/i.test(f.name) ? 1 : 0; if (!pick[base] || pick[base].score < score) pick[base] = { f, score }; }
    for (const base of Object.keys(lossless)) if (!pick[base]) pick[base] = { f: audio.find(f => f.name.replace(/\.[^.]+$/, '') === base && /\.flac$/i.test(f.name)), score: 0 };
    return Object.values(pick).map(({ f }) => ({ name: f.name, url: urlOf(f), flac: lossless[f.name.replace(/\.[^.]+$/, '').replace(/_(vbr|64kb)$/i, '')] || null, title: tidy(String(f.title || f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '))), seconds: f.length ? (/:/.test(String(f.length)) ? String(f.length).split(':').reduce((a, b) => a * 60 + (+b), 0) : Math.round(+f.length)) : null, track: f.track ? +String(f.track).split('/')[0] : null })).sort((a, b) => (a.track || 999) - (b.track || 999) || a.name.localeCompare(b.name));
  }
  function tidyTracks(list) {
    const clean = t => String(t || '').replace(/_/g, ' ').replace(/\s+/g, ' ').replace(/\s*-\s*$/, '').trim();
    let names = list.map(t => clean(t.title));
    if (names.length > 1) { // the prefix they all share ('Ludwig van Beethoven - symphony no. 5 in c minor, op. 67 - ') goes
      let p = names[0]; for (const n of names) { let k = 0; while (k < p.length && k < n.length && p[k] === n[k]) k++; p = p.slice(0, k); }
      const cut = p.lastIndexOf(' - '); if (cut > 0) names = names.map(n => n.slice(cut + 3));
    } else if (names.length === 1) { const parts = names[0].split(/\s+-\s+/); if (parts.length >= 2) names = [parts[parts.length - 1]]; }
    return list.map((t, i) => { let n = names[i] || t.title; n = n.replace(/^\d+[\s.-]+/, '').replace(/\b([ivx]+)\.(?=\s|$)/gi, (m, r) => r.toUpperCase() + '.').replace(/\b(allegro|adagio|andante|largo|presto|scherzo|menuetto|finale|rondo|vivace|moderato|lento|grave|allegretto|andantino|prestissimo)\b/gi, m => m[0].toUpperCase() + m.slice(1).toLowerCase()); n = n.charAt(0).toUpperCase() + n.slice(1); return { ...t, title: n || t.title }; });
  }
  // The Archive's words come through a wrong decoding now and then (1804â08): put the common ones right.
  const unmoji = x => String(x || '').replace(/â\u0080\u0094/g, '—').replace(/â\u0080\u0093/g, '–').replace(/â\u0080\u0099/g, '’').replace(/â\u0080\u0098/g, '‘').replace(/â\u0080\u009c|â\u0080\u009d/g, '"').replace(/â\u0080\u00a6/g, '…').replace(/Ã©/g, 'é').replace(/Ã¨/g, 'è').replace(/Ã¶/g, 'ö').replace(/Ã¼/g, 'ü').replace(/Ã¤/g, 'ä').replace(/Ã\u00a0/g, 'à').replace(/Â/g, '');
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
    const list = tidyTracks(tracks(id, data.files || [])); if (!list.length) return { ok: false, why: 'The record carries no playable audio.' };
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
  // The cover: a held work when one is set, the Archive's picture when it has one, else the house's own label (below):
  // every record has a face, so the shelf, the rows, the bar and the lock screen never show a blank.
  const cover = r => r.cover_slug ? `/img/${encodeURIComponent(r.cover_slug)}/screen` : r.cover_url || `/listening/${encodeURIComponent(r.slug)}/label.svg`;
  // The house's record label (Will, 24 Oct: what to show for a record with no picture, at least for now): drawn here,
  // after the paper labels of the period: a disc with a coloured label, a gold ring, the composer in small capitals,
  // the title in the serif, the performer beneath, the year; the shellac dark and oxblood or deep blue, the open
  // repertoire on cream. SVG so it is sharp at every size; PNG for the lock screen's artwork.
  const LABELS = [['#5e0b14', '#e6c875'], ['#1f2f55', '#e6c875'], ['#1e3a2f', '#e6c875'], ['#2a2420', '#e6c875'], ['#5a3a16', '#f0dca8']];
  const CREAM = [['#e9dcc0', '#3a2a1a'], ['#d9c9a5', '#2a2a2a'], ['#e3d4b4', '#5e0b14']];
  const hashOf = x => { let h = 7; for (const c of String(x)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const wrap = (t, n) => { const words = String(t || '').split(/\s+/); const lines = []; let cur = ''; for (const w of words) { if ((cur + ' ' + w).trim().length > n && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) lines.push(cur); return lines.slice(0, 3); };
  function labelSvg(r) {
    const shellac = r.license === 'pd' && r.year && +r.year <= PD_RECORDING_YEAR; const h = hashOf(r.slug);
    const [bg, fg] = (shellac ? LABELS : CREAM)[h % (shellac ? LABELS.length : CREAM.length)];
    const title = wrap(r.title, 22), fs1 = title.some(l => l.length > 16) ? 30 : 36; const comp = r.composer && r.composer !== r.performer ? r.composer : ''; const perf = r.performer || '';
    const ty = 218 - (title.length - 1) * fs1 * 0.62;
    const tx = (txt, y, size, extra = '') => `<text x="256" y="${y}" text-anchor="middle" font-size="${size}" ${extra}>${esc(txt)}</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#1a1917"/><stop offset=".55" stop-color="#121110"/><stop offset=".56" stop-color="#1c1b19"/><stop offset=".62" stop-color="#111"/><stop offset=".7" stop-color="#1b1a18"/><stop offset=".8" stop-color="#0f0e0d"/><stop offset=".9" stop-color="#1a1917"/><stop offset="1" stop-color="#0c0b0a"/></radialGradient></defs>
<circle cx="256" cy="256" r="256" fill="url(#g)"/>
<circle cx="256" cy="256" r="150" fill="${bg}"/><circle cx="256" cy="256" r="150" fill="none" stroke="${fg}" stroke-opacity=".9" stroke-width="2"/><circle cx="256" cy="256" r="140" fill="none" stroke="${fg}" stroke-opacity=".35" stroke-width="1"/>
<g fill="${fg}" font-family="Georgia, 'Times New Roman', serif">
${comp ? tx(comp.toUpperCase(), 142, 12, 'letter-spacing="3" opacity=".9"') : tx('THE LISTENING ROOM', 142, 11, 'letter-spacing="3" opacity=".7"')}
${title.map((l, i) => tx(l, ty + i * fs1 * 1.1, fs1)).join('')}
${perf ? tx(perf, 312, 15, 'font-style="italic" opacity=".92"') : ''}
${r.year ? tx(String(r.year), 350, 12, 'letter-spacing="2" opacity=".75"') : ''}
${tx('WATERMARK', 384, 9, 'letter-spacing="4" opacity=".55"')}
</g><circle cx="256" cy="256" r="6" fill="#0b0a09" stroke="${fg}" stroke-opacity=".4"/></svg>`;
  }
  app.get('/listening/:slug/label.svg', (req, res) => { const r = rec(req.params.slug); if (!r) return res.sendStatus(404); res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(labelSvg(r)); });
  app.get('/listening/:slug/label.png', async (req, res) => { const r = rec(req.params.slug); if (!r) return res.sendStatus(404); try { const png = await require('sharp')(Buffer.from(labelSvg(r)), { density: 144 }).resize(512, 512).png().toBuffer(); res.type('image/png').set('Cache-Control', 'public, max-age=86400').send(png); } catch (e) { res.redirect(`/listening/${encodeURIComponent(r.slug)}/label.svg`); } });
  const K = () => app.locals.keys; const keyed = req => { const k = K() ? K().holds(req) : {}; return Object.keys(k).length > 0 || isStudio(req); };
  // Tonight's record: deterministic by the day, so the room holds still.
  function tonight() { const all = db.prepare("SELECT * FROM recordings WHERE status='playing' ORDER BY id").all(); if (!all.length) return null; const d = new Date(); const n = (d.getUTCFullYear() * 400 + d.getUTCMonth() * 31 + d.getUTCDate()); return all[n % all.length]; }
  const card = r => `<a class="lr-card" href="/listening/${esc(r.slug)}">${cover(r) ? `<img src="${esc(cover(r))}" alt="" loading="lazy">` : `<span class="lr-sleeve"><b>${esc(r.title)}</b></span>`}<span class="lr-ct"><b>${esc(r.title)}</b><i>${esc(r.performer || r.composer || '')}${r.year ? ` · ${esc(r.year)}` : ''}</i><small>${r.seconds ? mmss(r.seconds) + ' · ' : ''}${r.source === 'maker' ? `${I.key} For keyholders` : esc(LICENSES[r.license] || r.license)}</small></span></a>`;
  // After the last side: the next record on the shelf (by id, round), so the room carries on as a radio does.
  function nextOf(r) { const rows = db.prepare("SELECT slug, title, performer, composer, cover_slug, cover_url FROM recordings WHERE status='playing' ORDER BY id").all(); if (rows.length < 2) return null; const i = rows.findIndex(x => x.slug === r.slug); const n = rows[(i + 1) % rows.length]; return { href: `/listening/${n.slug}?play=1`, title: n.title, by: n.performer || n.composer || '', img: n.cover_slug ? `/img/${n.cover_slug}/screen` : n.cover_url || null }; }
  // One record as the app reads it.
  function recordJSON(r) { return { slug: r.slug, art: r.cover_slug || r.cover_url ? cover(r) : `/listening/${encodeURIComponent(r.slug)}/label.png`, title: r.title, performer: r.performer || '', composer: r.composer || '', by: r.performer || r.composer || '', year: r.year || '', cover: cover(r), line: r.line || '', why: r.why || '', body: unmoji(r.body || ''), credit: r.credit || '', license: LICENSES[r.license] || r.license, license_url: r.license_url || null, ia: r.ia_id || null, source: r.source, chosen: r.chosen_by || '', tracks: tidyTracks(J(r.files)).map(t => ({ url: t.url, flac: t.flac || null, title: t.title, seconds: t.seconds || null })), seconds: r.seconds || null }; }
  function shelves() {
    const all = db.prepare("SELECT * FROM recordings WHERE status='playing' ORDER BY id DESC").all();
    const shellac = all.filter(r => r.license === 'pd' && r.year && +r.year <= PD_RECORDING_YEAR), open = all.filter(r => !shellac.includes(r) && r.source === 'archive'), makers = all.filter(r => r.source === 'maker'), readings = all.filter(r => r.source === 'reading');
    return { all, groups: [['shellac', 'The shellac', 'Recordings of the early century.', shellac], ['open', 'The open repertoire', 'Recorded and released free.', open], ['makers', 'From the makers', 'Masters, as they were made.', makers], ['readings', 'Read aloud', 'The editions of the house, a chapter a side, in the house voice.', readings]].filter(g => g[3].length) };
  }
  // The app's data: every playing record, with its sides, so the room never reloads.
  app.get('/api/listening', (req, res) => { const sh = shelves(); const t = tonight(); res.set('Cache-Control', 'public, max-age=60'); res.json({ tonight: t ? t.slug : null, groups: sh.groups.map(g => ({ key: g[0], title: g[1], line: g[2], records: g[3].map(r => r.slug) })), records: sh.all.map(recordJSON), pd_year: PD_RECORDING_YEAR }); });
  // The room is one page (Will, 24 Oct: "a Spotify-like experience": the music never stops when you move). The shelf,
  // each record and the queue are views of one document; the player is a bar at the foot that stays; the address
  // follows (/listening, /listening/<record>). Without the script the page still reads: the shelf, or the record.
  function shell(req, res, slug) {
    const sh = shelves(); const t = tonight(); const r0 = slug ? rec(slug) : null;
    if (slug && (!r0 || (r0.status !== 'playing' && !isStudio(req)))) return res.sendStatus(404);
    if (r0 && r0.source === 'maker' && !keyed(req) && !(makerOf(req) && makerOf(req).id === r0.maker_id)) return res.status(403).send(V.layout({ title: `${r0.title} · The Listening Room`, path: `/listening/${r0.slug}`, body: `<section class="ky-page lr"><div class="ky-h"><p class="k"><a href="/listening">The Listening Room</a></p><h1>${esc(r0.title)}</h1><p class="bc-door">A maker’s master plays for keyholders. <a href="/keys">The Keys</a>.</p></div></section>` }));
    if (r0) { try { db.prepare('UPDATE recordings SET plays=plays+1 WHERE id=?').run(r0.id); } catch (e) { /* */ } }
    const canHear = keyed(req); const lock = j => (j.source === 'maker' && !canHear ? { ...j, tracks: [], locked: true } : j);
    const data = { tonight: t ? t.slug : null, groups: sh.groups.map(g => ({ key: g[0], title: g[1], line: g[2], records: g[3].map(r => r.slug) })), records: sh.all.concat(r0 && !sh.all.find(x => x.id === r0.id) ? [r0] : []).map(recordJSON).map(lock), open: r0 ? r0.slug : null, wander: '/wander', pd_year: PD_RECORDING_YEAR };
    const disc = r => `<a class="lr-card" href="/listening/${esc(r.slug)}" data-lr-open="${esc(r.slug)}">${cover(r) ? `<img src="${esc(cover(r))}" alt="" loading="lazy">` : `<span class="lr-sleeve"><b>${esc(r.title)}</b></span>`}<span class="lr-ct"><b>${esc(r.title)}</b><i>${esc(r.performer || r.composer || '')}${r.year ? ` · ${esc(r.year)}` : ''}</i><small>${r.seconds ? mmss(r.seconds) + ' · ' : ''}${esc(LICENSES[r.license] || r.license)}</small></span></a>`;
    const shelfHtml = `<section class="lr-shelfv" data-lr-view="shelf"${r0 ? ' hidden' : ''}>
<div class="ky-h"><p class="k"><a href="/keys">The Keys</a></p><h1>The Listening Room.</h1>${app.locals.roomPlate ? app.locals.roomPlate('listening') : ''}<p class="lede">A record is chosen, set on the turntable, and played whole, with the sleeve beside it. The shellac of the early century; the open recordings of the repertoire; and, as the vault takes sound, makers’ own masters.</p>${sh.all.length ? `<p class="lr-acts"><button type="button" class="lr-fib lr-gold" data-lr-playall>${I.play}<span>Play the shelf</span></button></p>` : ''}</div>
${t ? `<section class="lr-tonight"><p class="k">On the turntable</p><a class="lr-big" href="/listening/${esc(t.slug)}" data-lr-open="${esc(t.slug)}">${cover(t) ? `<img src="${esc(cover(t))}" alt="">` : `<span class="lr-sleeve"><b>${esc(t.title)}</b></span>`}<span><b>${esc(t.title)}</b><i>${esc(t.performer || t.composer || '')}${t.year ? `, ${esc(t.year)}` : ''}</i>${t.line ? `<em>${esc(t.line)}</em>` : ''}<small>${I.play} Play it through</small></span></a></section>` : `<p class="note">The first records are being chosen.</p>`}
${sh.groups.map(g => `<section class="lr-shelf"><p class="k">${esc(g[1])}</p><h2>${esc(g[2])}</h2><div class="lr-grid">${g[3].map(disc).join('')}</div></section>`).join('')}
<section class="ky-rules"><h2>How the room works.</h2><ul><li><b>Chosen, not catalogued.</b> Every record is here because someone in the house chose it and wrote the sleeve.</li><li><b>Played whole.</b> A side plays through, and the next record follows, as a radio does. You may lift the needle; the room does not shuffle.</li><li><b>Clear at the door.</b> Public-domain recordings (in the United States, published through ${PD_RECORDING_YEAR}), CC0, and CC BY, BY-SA and BY-ND releases, each with its credit line. Nothing non-commercial, nothing uncleared.</li><li><b>The makers’ own.</b> A maker’s recording is held like a photograph: the master in the vault, the rights the maker’s. ${I.key} A key opens the makers’ shelf.</li></ul></section></section>`;
    const recordHtml = r0 ? recordView(r0) : '<section class="lr-recv" data-lr-view="record" hidden></section>';
    res.send(V.layout({ title: r0 ? `${r0.title} · The Listening Room · Watermark` : 'The Listening Room · The Keys · Watermark', path: r0 ? `/listening/${r0.slug}` : '/listening', desc: r0 ? (r0.line || r0.credit) : 'Records chosen and played whole: the shellac of the early century, the open recordings of the classical repertoire, and makers’ own masters. With the notes.', bare: true, body: `<main class="lr-room lr-app" data-lr data-lr-app>
<header class="sc-top"><a href="/keys" class="tw-back lr-home">${I.back}<span>The Keys</span></a><button type="button" class="tw-back lr-toshelf" data-lr-toshelf${r0 ? '' : ' hidden'}>${I.back}<span>The shelf</span></button><p class="tw-title"><b>The Listening Room</b></p></header>
${shelfHtml}
${recordHtml}
<footer class="lr-foot lr-foot-app"><p>Played whole, in the Keys. ${esc(C.base.replace(/^https?:\/\//, ''))}/listening</p></footer>
<div class="lr-wall" data-lr-wall hidden><div class="lr-mini"><button type="button" class="lr-play lr-play-s" data-lr-play2 aria-label="Play or pause">${I.play}${I.pause}</button><span class="lr-minit"><b data-lr-minib></b><i data-lr-minitr></i></span><button type="button" class="lr-fib" data-lr-wallx>${I.close}<span>The room</span></button></div></div>
<div class="lr-bar2" data-lr-bar hidden><button type="button" class="lr-bar-cov" data-lr-barcover aria-label="Open the record"><img alt="" data-lr-barimg><span class="lr-sleeve lr-sleeve-s" data-lr-barsl hidden></span></button><span class="lr-bar-t"><b data-lr-bart></b><i data-lr-barby></i></span><span class="lr-bar-c"><button type="button" class="lr-bar-b" data-lr-prev aria-label="Previous">${I.back}</button><button type="button" class="lr-play lr-play-s" data-lr-play aria-label="Play">${I.play}${I.pause}</button><button type="button" class="lr-bar-b" data-lr-nexttr aria-label="Next">${I.next}</button></span><span class="lr-time" data-lr-time>0:00</span><button type="button" class="lr-bar-b" data-lr-queue aria-label="The queue" title="The queue">${I.more}</button><div class="lr-bar-prog" data-lr-bar2prog><i data-lr-fill></i></div></div>
<aside class="lr-queue" data-lr-queuev hidden><header><p class="k">The queue</p><button type="button" class="lr-fib" data-lr-queuex>${I.close}<span>Close</span></button></header><ol data-lr-queuelist></ol></aside>
<audio data-lr-audio preload="metadata"></audio><template data-lr-ic="play">${I.play}</template><template data-lr-ic="wave">${I.wave}</template>
<script>window.__LRA=${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
</main><script src="/static/stay.js?v=${esc(V.VER)}" defer></script><script src="/static/listening.js?v=${esc(V.VER)}" defer></script>` }));
  }
  function recordView(r) {
    const list = tidyTracks(J(r.files));
    return `<section class="lr-recv" data-lr-view="record" data-lr-slug="${esc(r.slug)}">
<section class="lr-deck">
<figure class="lr-disc"><span class="lr-platter" data-lr-platter>${cover(r) ? `<img src="${esc(cover(r))}" alt="">` : `<span class="lr-label"><b>${esc(r.title)}</b></span>`}</span><span class="lr-arm" data-lr-arm></span></figure>
<div class="lr-side">
<p class="k">${esc(r.chosen_by ? `Chosen by ${r.chosen_by}` : 'On the turntable')}</p><h1 data-lr-h1>${esc(r.title)}</h1><p class="lr-by">${esc(r.performer || '')}${r.composer && r.composer !== r.performer ? ` · ${esc(r.composer)}` : ''}${r.year ? ` · ${esc(r.year)}` : ''}</p>
${r.line ? `<p class="lede">${esc(r.line)}</p>` : ''}
<div class="lr-fi"><button type="button" class="lr-fib lr-gold" data-lr-playrec>${I.play}<span>Play it through</span></button><button type="button" class="lr-fib" data-lr-fi aria-pressed="false" title="Lossless when the record has it (FLAC); otherwise the light file"><span class="lr-fidot"></span><span data-lr-fit>Light</span></button><button type="button" class="lr-fib" data-lr-wander title="The house's pictures on the wall while it plays">${I.wave}<span>Wander with it</span></button></div>
<ol class="lr-tracks" data-lr-tracks>${list.map((t, i) => `<li><button type="button" data-lr-track="${i}"><span class="lr-n">${i + 1}</span><span class="lr-tt">${esc(t.title)}</span><span class="lr-tl">${t.seconds ? mmss(t.seconds) : ''}</span></button></li>`).join('')}</ol>
</div></section>
${r.body || r.why ? `<section class="lr-notes"><p class="k">The sleeve</p>${r.why ? `<p class="lr-why">${esc(r.why)}</p>` : ''}${r.body ? (r.source === 'archive' && !r.why ? `<details class="lr-arch"><summary>From the Archive’s record</summary><p>${esc(unmoji(r.body))}</p></details>` : `<p>${esc(unmoji(r.body))}</p>`) : ''}</section>` : ''}
<p class="lr-credit">${esc(r.credit || '')}${r.license_url ? ` <a href="${esc(r.license_url)}" rel="license">The licence</a>.` : ''}${r.ia_id ? ` <a href="https://archive.org/details/${esc(r.ia_id)}">The record at the Archive</a>.` : ''}</p>
</section>`;
  }
  app.get('/listening', (req, res, next) => (app.locals.minute ? app.locals.minute((q, r) => shell(q, r, null)) : (q, r) => shell(q, r, null))(req, res, next)); // a stranger's shelf once a minute (28 Oct)
  app.get('/listening/:slug', (req, res) => shell(req, res, String(req.params.slug)));
  // The Studio: search the Archive, bring a record in, write the sleeve, set it playing.
  app.get('/studio/listening', async (req, res) => {
    if (!isStudio(req)) return res.sendStatus(403); V.setDeskPath('/studio/listening');
    const q = String(req.query.q || '').trim(); const found = q ? await search(q) : null;
    const rows = db.prepare('SELECT * FROM recordings ORDER BY id DESC').all();
    const works = db.prepare("SELECT slug, title FROM works WHERE status='held' ORDER BY stars DESC, id DESC LIMIT 200").all();
    res.send(V.layout({ title: 'The Listening Room · Studio', path: '/studio/listening', studio: true, body: `<section class="desk"><header class="dk-h"><p class="k">Programme</p><h1>The Listening Room.</h1><p class="lede">Records brought in from the Internet Archive, cleared at the door (public domain through ${PD_RECORDING_YEAR}, CC0, CC BY / BY-SA / BY-ND; never NC), the sleeve written here, set playing. The files stay at the Archive.</p>${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}</header>
<form method="get" class="rq-f" action="/studio/listening"><label>Search the Archive<input name="q" value="${esc(q)}" placeholder="Caruso 1920 · Musopen Chopin · Open Goldberg"></label><button class="buy-btn">Search</button></form>
<form method="post" class="rq-f" action="/studio/listening/bring"><label>Or an identifier or address<input name="id" placeholder="78_…  or https://archive.org/details/…"></label><button class="buy-btn">Bring it in</button></form>
${found ? found.error ? `<p class="note">${esc(found.error)}</p>` : `<table class="tbl lr-found"><thead><tr><th>Record</th><th>Who</th><th>Year</th><th>At the door</th><th></th></tr></thead><tbody>${found.docs.map(d => `<tr><td><a href="https://archive.org/details/${esc(d.id)}">${esc(d.title || d.id)}</a><br><small>${esc(d.id)}</small></td><td>${esc(d.creator || '')}</td><td>${esc(d.year || '')}</td><td>${d.door.ok ? `<b>${esc(LICENSES[d.door.license])}</b>${d.door.trust === 'uploader' ? '<br><small>the uploader’s word: check it</small>' : ''}` : `<small>${esc(d.door.why)}</small>`}</td><td>${d.door.ok ? `<form method="post" action="/studio/listening/bring"><input type="hidden" name="id" value="${esc(d.id)}"><button class="buy-btn small">Bring in</button></form>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}
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
  // The first evening (Will, 24 Oct: "load it up with the stuff that lasts; the work people should listen to, that helps
  // their brain and mind"): records whose provenance the house trusts without a second look (Musopen's own commissions,
  // Kimiko Ishizaka's open Bach, the Great 78 Project's discs through 1925), each with a line. Words are drafts.
  const FIRST = [
    ['The_Open_Goldberg_Variations-11823', 'Bach, the Goldberg Variations. Kimiko Ishizaka, recorded in 2012 and given to the world. Begin with the Aria; stay for the thirty.'],
    ['bach-well-tempered-clavier-book-1', 'Bach, the Well-Tempered Clavier, Book I. Twenty-four preludes and fugues, one in every key: the whole of music in one book.'],
    ['pandacd-715-js-bach-the-art-of-the-fugue-kunst-der-fuge-bwv-1080', 'Bach, The Art of Fugue. His last thought, unfinished: the music stops where his hand did.'],
    ['musopen-chopin', 'Chopin, complete, recorded for everyone by Musopen. Put on a nocturne after dark.'],
    ['musopen-mozart-marriage-of-figaro-compressed', 'Mozart, The Marriage of Figaro. Four hours that end in forgiveness.'],
    ['78_valse-in-d-flat-major_sergei-rachmaninoff-chopin_gbia0012582a', 'Rachmaninoff plays Chopin, 1921. One composer’s hands on another’s waltz.'],
    ['78_prelude-in-c-sharp-minor_sergei-rachmaninoff_gbia0284165a', 'Rachmaninoff plays his own Prelude in C-sharp minor, 1921, the piece he could never leave a hall without playing.'],
    ['78_tosca---recondita-armonia-strange-harmony_enrico-caruso-puccini-victor-orchestra_gbia0012569a', 'Caruso, 1909. Recondita armonia: the voice that made the record a thing worth owning.'],
    ['78_rigoletto---la-donna-e-mobile-woman-is-fickle_enrico-caruso-verdi-victor-orchestr_gbia0012560a', 'Caruso, 1908. La donna è mobile, from a horn, on shellac, a century on.'],
    ['78_tears_king-olivers-jazz-band-hardin-armstrong-joe-oliver-louis-armstrong-johnny-do_gbia0001053a', 'King Oliver’s Creole Jazz Band with the young Louis Armstrong, 1923. Jazz as it left New Orleans.'],
    ['78_yellow-dog-blues_bessie-smith-hendersons-hot-six_gbia0464774a', 'Bessie Smith, 1925. The Empress of the Blues, with Fletcher Henderson’s men behind her.'],
    ['78_songs-my-mother-taught-me_fritz-kreisler-dvorak-kreisler-carl-lamson_gbia0016601a', 'Kreisler, 1916. Dvořák’s song, on a violin, in three minutes.'],
    ['78_mazurka-in-f-sharp-minor_ignace-jan-paderewski-chopin_gbia0015773a', 'Paderewski plays Chopin, 1924: the pianist who became a prime minister, playing the poet of his country.'],
    ['SymphonyNo.5', 'Beethoven, the Fifth. The four notes everyone knows, and the forty minutes after them that almost no one has sat through.'],
    ['78_boheme-o-soave-fanciulla-thou-sweetest-maiden_nellie-melba-and-enrico-caruso-pucc_gbia0105023a', 'Melba and Caruso, 1907. O soave fanciulla: two of the great voices of the century, together, on one disc.'],
    ['78_ave-maria_jascha-heifetz-andr-benoist-schubert-wilhelmj_gbia0294145a', 'Heifetz, 1917, sixteen years old. Schubert’s Ave Maria.'],
    ['78_cradle-song-brahms-op.-49-no.-4_rosa-ponselle-brahms_gbia0005361a', 'Rosa Ponselle, 1924. Brahms’s lullaby, sung by the voice Caruso discovered.'],
  ];
  // Said as a person says them: the Archive's own titles read like file names.
  const NAMES = {
    'The_Open_Goldberg_Variations-11823': ['The Goldberg Variations', 'Kimiko Ishizaka', 'J. S. Bach'],
    'bach-well-tempered-clavier-book-1': ['The Well-Tempered Clavier, Book I', 'Kimiko Ishizaka', 'J. S. Bach'],
    'pandacd-715-js-bach-the-art-of-the-fugue-kunst-der-fuge-bwv-1080': ['The Art of Fugue', 'Kimiko Ishizaka', 'J. S. Bach'],
    'musopen-chopin': ['Chopin, complete', 'Musopen', 'Frédéric Chopin'],
    'musopen-mozart-marriage-of-figaro-compressed': ['The Marriage of Figaro', 'Musopen', 'W. A. Mozart'],
    '78_valse-in-d-flat-major_sergei-rachmaninoff-chopin_gbia0012582a': ['Valse in D-flat major, the Minute Waltz', 'Sergei Rachmaninoff', 'Frédéric Chopin'],
    '78_prelude-in-c-sharp-minor_sergei-rachmaninoff_gbia0284165a': ['Prelude in C-sharp minor', 'Sergei Rachmaninoff', 'Sergei Rachmaninoff'],
    '78_tosca---recondita-armonia-strange-harmony_enrico-caruso-puccini-victor-orchestra_gbia0012569a': ['Recondita armonia, from Tosca', 'Enrico Caruso', 'Giacomo Puccini'],
    '78_rigoletto---la-donna-e-mobile-woman-is-fickle_enrico-caruso-verdi-victor-orchestr_gbia0012560a': ['La donna è mobile, from Rigoletto', 'Enrico Caruso', 'Giuseppe Verdi'],
    '78_tears_king-olivers-jazz-band-hardin-armstrong-joe-oliver-louis-armstrong-johnny-do_gbia0001053a': ['Tears', 'King Oliver’s Creole Jazz Band, with Louis Armstrong', null],
    '78_yellow-dog-blues_bessie-smith-hendersons-hot-six_gbia0464774a': ['Yellow Dog Blues', 'Bessie Smith', 'W. C. Handy'],
    '78_songs-my-mother-taught-me_fritz-kreisler-dvorak-kreisler-carl-lamson_gbia0016601a': ['Songs My Mother Taught Me', 'Fritz Kreisler', 'Antonín Dvořák'],
    '78_mazurka-in-f-sharp-minor_ignace-jan-paderewski-chopin_gbia0015773a': ['Mazurka in F-sharp minor', 'Ignacy Jan Paderewski', 'Frédéric Chopin'],
    'SymphonyNo.5': ['Symphony No. 5 in C minor', 'Musopen', 'Ludwig van Beethoven'],
    '78_boheme-o-soave-fanciulla-thou-sweetest-maiden_nellie-melba-and-enrico-caruso-pucc_gbia0105023a': ['O soave fanciulla, from La bohème', 'Nellie Melba and Enrico Caruso', 'Giacomo Puccini'],
    '78_ave-maria_jascha-heifetz-andr-benoist-schubert-wilhelmj_gbia0294145a': ['Ave Maria', 'Jascha Heifetz', 'Franz Schubert'],
    '78_cradle-song-brahms-op.-49-no.-4_rosa-ponselle-brahms_gbia0005361a': ['Wiegenlied, the Cradle Song', 'Rosa Ponselle', 'Johannes Brahms'],
  };
  const CUT = ['78_whispering_paul-whiteman-and-his-ambassador-orchestra-schonberger_gbia0120433a', '78_stars-and-stripes-forever_john-philip-sousa_gbia0086020b'];
  function tidySeed() { for (const id of CUT) { try { db.prepare("UPDATE recordings SET status='shelved' WHERE ia_id=? AND chosen_by='the house'").run(id); } catch (e) { /* */ } } for (const [id, [title, performer, composer]] of Object.entries(NAMES)) { try { db.prepare('UPDATE recordings SET title=?, performer=?, composer=COALESCE(?, composer) WHERE ia_id=?').run(title, performer, composer, id); } catch (e) { /* */ } } }
  tidySeed();
  let seeding = false;
  async function seed() {
    if (seeding) return; seeding = true;
    for (const [id, line] of FIRST) {
      if (db.prepare('SELECT 1 FROM recordings WHERE ia_id=?').get(id)) continue;
      try { const out = await bring(id, 'the house'); if (out.ok) { db.prepare("UPDATE recordings SET line=?, status='playing' WHERE slug=?").run(line, out.slug); try { ledger.append(db, 'recording.playing', out.slug, { title: out.title, by: 'the house' }); } catch (e) { /* */ } console.log('[listening] on the turntable:', out.title); } else console.log('[listening] not brought in:', id, out.why); } catch (e) { console.log('[listening] seed', id, e.message); }
      await new Promise(r => setTimeout(r, 2500));
    }
    tidySeed(); seeding = false;
  }
  if (process.env.NODE_ENV !== 'test' && !process.env.NO_SEED) app.locals.governor.boot('listening seed', () => seed());
  app.locals.listening = { tidyTracks, unmoji, seed, FIRST, bring, shelveMeta, clear, tracks, search, tonight, open: () => db.prepare("SELECT COUNT(*) n FROM recordings WHERE status='playing'").get().n > 0, LICENSES, PD_RECORDING_YEAR };
  return app.locals.listening;
}
module.exports = { mountListening, LICENSES };
