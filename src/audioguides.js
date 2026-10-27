// Audio guides as objects (Will, 27 Oct: "we are training for ingest of all sorts of different media"). A spoken guide is a
// recording and its transcript, attached to a work, from whoever made it: a museum's curator, the maker, a guide of the
// house. No museum publishes its guide audio openly (the survey of 27 Oct), so this is a format the house defines and offers:
// the file kept byte for byte in the vault under guides/, the words beside it, a licence on each, served with ranges.
// Shown under the work's Look closer (`block`); Wander's guide sheet plays it when the house has no recording of its own
// (`first`). Doors: the maker's desk /account/guides (an institution's team or any maker, for their own works: the file, the
// work, who speaks, the words as text or an .srt/.vtt), Feeds in kind 'guides' (a CSV: work, audio, transcript, title, speaker,
// role, lang, license). `guide.spoken` on the register (public: 'The Met added a spoken guide to X').
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');

const MAX_MB = +process.env.GUIDE_MAX_MB || 80;
const EXT = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'm4a', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/x-flac': 'flac' };
const ext = m => EXT[String(m || '').toLowerCase()] || 'mp3';
const mimeOf = name => ({ mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', webm: 'audio/webm', wav: 'audio/wav', flac: 'audio/flac' })[String(name || '').split('.').pop().toLowerCase()] || 'audio/mpeg';

// A transcript from .srt or .vtt: the cues' words, the timings dropped, joined into paragraphs at gaps over 2 s.
function plainTranscript(t) {
  t = String(t || '').replace(/\r/g, '');
  if (!/-->/.test(t)) return t.trim();
  const out = []; let last = null; let para = [];
  for (const block of t.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter(l => l.trim() && !/^\d+$/.test(l.trim()) && !/^WEBVTT/.test(l) && !/^(NOTE|STYLE)\b/.test(l));
    const ti = lines.findIndex(l => /-->/.test(l)); if (ti < 0) continue;
    const [s0, s1] = lines[ti].split('-->'); const start = toSec(s0), end = toSec(s1) || start; const words = lines.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); if (!words) continue;
    if (last != null && start - last > 2 && para.length) { out.push(para.join(' ')); para = []; }
    para.push(words); last = end;
  }
  if (para.length) out.push(para.join(' '));
  return out.join('\n\n');
}
function toSec(s) { const m = String(s).trim().match(/(\d+):(\d+):(\d+)[.,](\d+)|(\d+):(\d+)[.,](\d+)/); if (!m) return 0; return m[1] != null ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : +m[5] * 60 + +m[6] + +m[7] / 1000; }

function mountAudioGuides(app, { db, V, C, store, isStudio, studioOnly, ledger, makerOf, upload, doFetch, bagcheck }) {
  const { esc, tidy } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS audio_guides (id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, maker_id INTEGER, title TEXT, speaker TEXT, role TEXT, lang TEXT NOT NULL DEFAULT 'en', file TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER, seconds INTEGER, sha256 TEXT, transcript TEXT, license TEXT, source TEXT, status TEXT NOT NULL DEFAULT 'held', created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE INDEX IF NOT EXISTS audio_guides_work ON audio_guides (work_id, status);`);
  const dir = path.join(C.dataDir, 'guides'); fs.mkdirSync(dir, { recursive: true });
  const incoming = path.join(C.dataDir, 'incoming'); fs.mkdirSync(incoming, { recursive: true });
  const I = require('./icons');
  const of = w => w ? db.prepare("SELECT g.*, m.name AS maker_name, m.handle AS maker_handle, m.kind AS maker_kind FROM audio_guides g LEFT JOIN makers m ON m.id=g.maker_id WHERE g.work_id=? AND g.status='held' ORDER BY g.id").all(w.id) : [];
  const can = (req, w) => { if (isStudio(req)) return true; const m = makerOf(req); return !!(m && w && m.id === w.maker_id); };
  const findWork = (m, key) => { key = String(key || '').trim(); if (!key) return null; const own = m ? ' AND maker_id=' + (+m.id) : ''; return db.prepare(`SELECT * FROM works WHERE status IN ('held','hidden') AND (slug=? OR source_url=? OR accession=?)${own} LIMIT 1`).get(key, key, key) || (/^https?:/.test(key) ? null : db.prepare(`SELECT * FROM works WHERE status IN ('held','hidden') AND slug LIKE ?${own} LIMIT 1`).get(key.toLowerCase().replace(/[^a-z0-9]+/g, '-'))); };

  // Keep one: the file (already on disk, checked by the bag check or by its bytes here), the words, who speaks, under which licence.
  async function keep(w, m, file, { mime, title, speaker, role, lang, transcript, license, source, seconds, by = 'desk' } = {}) {
    const st = fs.statSync(file); if (st.size > MAX_MB * 1024 * 1024) throw new Error(`over ${MAX_MB} MB`);
    if (bagcheck) { const v = await bagcheck.check(file, { expect: 'audio' }); if (!v.ok) throw new Error(v.reason || 'not a sound file the house knows'); mime = mime || (v.mime || mime); }
    const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (db.prepare("SELECT 1 FROM audio_guides WHERE work_id=? AND sha256=? AND status='held'").get(w.id, sha)) return { already: true };
    const name = `${w.slug}-${sha.slice(0, 10)}.${ext(mime)}`; const key = `guides/${name}`; const local = path.join(dir, name);
    fs.copyFileSync(file, local);
    try { if (store && store.kind === 's3') await store.put(key, local, mime || 'audio/mpeg'); } catch (e) { console.error('[guides vault]', e.message); }
    const id = db.prepare('INSERT INTO audio_guides (work_id, maker_id, title, speaker, role, lang, file, mime, bytes, seconds, sha256, transcript, license, source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(w.id, m ? m.id : null, String(title || '').trim().slice(0, 160) || null, String(speaker || '').trim().slice(0, 120) || null, String(role || '').trim().slice(0, 80) || null, String(lang || 'en').slice(0, 5), key, mime || 'audio/mpeg', st.size, +seconds || null, sha, plainTranscript(transcript).slice(0, 60000) || null, String(license || '').trim().slice(0, 200) || null, String(source || '').trim().slice(0, 300) || null).lastInsertRowid;
    try { ledger.append(db, 'guide.spoken', w.slug, { title: w.title, by: m ? m.name : null, speaker: speaker || null, transcript: !!transcript, how: by }); } catch (e) { /* */ }
    return { id };
  }
  // A row of a feed (CSV: work, audio, transcript, title, speaker, role, lang, license, source): the file fetched, the words fetched or taken as given.
  async function bringRow(row, job) {
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(job.maker_id); const w = findWork(m, row.work); if (!w) throw new Error(`no work of ${m ? m.name : 'the maker'} answers to “${row.work}”`);
    const url = String(row.audio || '').trim(); if (!/^https?:\/\//.test(url)) throw new Error('an https address of the recording');
    if (db.prepare("SELECT 1 FROM audio_guides WHERE work_id=? AND source=? AND status='held'").get(w.id, url)) return { already: true };
    const r = await doFetch(url); if (!r.ok) throw new Error(`audio ${r.status}`); const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > MAX_MB * 1024 * 1024) throw new Error(`over ${MAX_MB} MB`);
    const tmp = path.join(incoming, `guide-${crypto.randomBytes(6).toString('hex')}.${ext(mimeOf(url.split('?')[0])) }`); fs.writeFileSync(tmp, buf);
    let transcript = String(row.transcript || '').trim();
    if (/^https?:\/\//.test(transcript)) { try { const tr = await doFetch(transcript); transcript = tr.ok ? await tr.text() : ''; } catch (e) { transcript = ''; } }
    try { return await keep(w, m, tmp, { mime: String(r.headers.get('content-type') || '').split(';')[0] || mimeOf(url), title: row.title, speaker: row.speaker, role: row.role, lang: row.lang, transcript, license: row.license || job.open || null, source: url, by: 'feed' }); } finally { try { fs.unlinkSync(tmp); } catch (e) { /* */ } }
  }

  // The recording, with ranges.
  app.get('/guide/:id/audio', async (req, res) => {
    const g = db.prepare("SELECT g.*, w.status AS wstatus FROM audio_guides g JOIN works w ON w.id=g.work_id WHERE g.id=?").get(+req.params.id);
    if (!g || g.status !== 'held' || (g.wstatus !== 'held' && !isStudio(req))) return res.sendStatus(404);
    const local = path.join(dir, path.basename(g.file)); let buf = null;
    if (fs.existsSync(local)) buf = fs.readFileSync(local); else { try { buf = await store.get(g.file); if (buf) fs.writeFileSync(local, buf); } catch (e) { buf = null; } }
    if (!buf) return res.sendStatus(404);
    res.set({ 'Content-Type': g.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': g.wstatus === 'held' ? 'public, max-age=86400' : 'private, no-store' });
    const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (r) { const a = r[1] ? +r[1] : 0, b = r[2] ? Math.min(+r[2], buf.length - 1) : buf.length - 1; if (a > b || a >= buf.length) { res.set('Content-Range', `bytes */${buf.length}`); return res.sendStatus(416); } res.status(206).set({ 'Content-Range': `bytes ${a}-${b}/${buf.length}`, 'Content-Length': b - a + 1 }); return res.end(buf.subarray(a, b + 1)); }
    res.set('Content-Length', buf.length); res.end(buf);
  });
  app.get('/guide/:id.json', (req, res) => {
    const g = db.prepare("SELECT g.*, w.status AS wstatus, w.slug, m.name AS maker_name FROM audio_guides g JOIN works w ON w.id=g.work_id LEFT JOIN makers m ON m.id=g.maker_id WHERE g.id=?").get(+req.params.id);
    if (!g || g.status !== 'held' || g.wstatus !== 'held') return res.sendStatus(404);
    res.set('Cache-Control', 'public, max-age=3600'); res.json({ id: g.id, work: g.slug, title: g.title, speaker: g.speaker, role: g.role, by: g.maker_name, lang: g.lang, src: `/guide/${g.id}/audio`, seconds: g.seconds, transcript: g.transcript, license: g.license, source: g.source });
  });

  // Under the work's guide: each spoken guide with its player and its words.
  const who = g => [g.speaker, g.role].filter(Boolean).join(', ') || (g.maker_name ? `${g.maker_name}` : 'a guide');
  function block(w) {
    const gs = of(w); if (!gs.length) return '';
    return `<section class="agd" id="spoken"><p class="k">Spoken guides · ${gs.length}</p>${gs.map(g => `<article class="agd-g"><header><b>${esc(g.title || `${who(g)} on ${tidy(w.title)}`)}</b><span>${esc(who(g))}${g.maker_name && g.speaker ? ` · ${esc(g.maker_name)}` : ''}${g.seconds ? ` · ${Math.floor(g.seconds / 60)}:${String(g.seconds % 60).padStart(2, '0')}` : ''}${g.lang && g.lang !== 'en' ? ` · ${esc(g.lang.toUpperCase())}` : ''}</span></header><audio controls preload="none" src="/guide/${g.id}/audio"></audio>${g.transcript ? `<details class="agd-tx"><summary>The words</summary>${g.transcript.split(/\n{2,}/).map(p => `<p>${esc(p.trim())}</p>`).join('')}</details>` : ''}${g.license || g.source ? `<p class="agd-lic">${g.license ? esc(g.license) : ''}${g.source && /^https?:/.test(g.source) ? ` · <a href="${esc(g.source)}" rel="noopener">the source</a>` : ''}</p>` : ''}</article>`).join('')}</section>`;
  }
  // For Wander: the first spoken guide, when the house has no recording of its own.
  const first = w => { const g = of(w)[0]; return g ? { src: `/guide/${g.id}/audio`, transcript: g.transcript, by: who(g) + (g.maker_name && g.speaker ? `, ${g.maker_name}` : ''), id: g.id } : null; };

  // The desk: a maker's (or an institution's team's) spoken guides on their own works.
  const DESK = '/account/guides';
  app.get(DESK, (req, res) => {
    const m = makerOf(req); if (!m && !isStudio(req)) return res.redirect('/signin?next=' + encodeURIComponent(DESK));
    const mine = m ? db.prepare("SELECT g.*, w.slug, w.title AS wtitle FROM audio_guides g JOIN works w ON w.id=g.work_id WHERE g.maker_id=? AND g.status='held' ORDER BY g.id DESC").all(m.id) : db.prepare("SELECT g.*, w.slug, w.title AS wtitle FROM audio_guides g JOIN works w ON w.id=g.work_id WHERE g.status='held' ORDER BY g.id DESC LIMIT 200").all();
    const works = m ? db.prepare("SELECT slug, title FROM works WHERE maker_id=? AND status IN ('held','hidden') ORDER BY id DESC LIMIT 400").all(m.id) : [];
    res.send(V.layout({ title: 'Spoken guides · Watermark', path: DESK, studio: true, body: `<section class="studio-wrap agk"><p class="k">Your studio</p><h1>Spoken guides.</h1>
<p class="lede">A recording and its words, on one of your works: a curator speaking, the maker speaking, a guide of the house. The file is kept as it came; the words sit beside it, so it reads as well as plays. Shown under the work’s guide, and played in Wander when the house has no reading of its own.</p>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
${m ? `<form method="post" action="${DESK}" enctype="multipart/form-data" class="agk-f">
<label>The work<input name="work" list="agk-works" required placeholder="its slug, accession or source address"><datalist id="agk-works">${works.map(w => `<option value="${esc(w.slug)}">${esc(tidy(w.title))}</option>`).join('')}</datalist></label>
<label>The recording (MP3, M4A, WAV, FLAC, OGG; to ${MAX_MB} MB)<input type="file" name="file" accept="audio/*" required></label>
<label>Title<input name="title" maxlength="160" placeholder="On the light in the staircase"></label>
<label>Who speaks<input name="speaker" maxlength="120" placeholder="Ada Lovelace"></label>
<label>Their role<input name="role" maxlength="80" placeholder="Curator of photographs"></label>
<label>Language<input name="lang" maxlength="5" value="en"></label>
<label>Licence<input name="license" maxlength="200" placeholder="© ${esc(m.name)}. Played in the house. · CC BY 4.0"></label>
<label>The words (paste the transcript, or an .srt/.vtt beside it)<textarea name="transcript" rows="8"></textarea></label>
<label>Or the words as a file<input type="file" name="words" accept=".txt,.srt,.vtt,text/plain,text/vtt"></label>
<button class="buy-btn" type="submit">Keep it</button></form>
<p class="note">Many at once: Feeds in takes a CSV (work, audio, transcript, title, speaker, role, lang, license).</p>` : ''}
<div class="agk-kept"><h2>Kept · ${mine.length}</h2>${mine.length ? `<table class="tbl"><tr><th>Work</th><th>Guide</th><th>Words</th><th></th></tr>${mine.map(g => `<tr><td><a href="/w/${esc(g.slug)}#spoken">${esc(tidy(g.wtitle))}</a></td><td>${esc(g.title || '')}<br><small>${esc(who(g))}${g.seconds ? ` · ${g.seconds}s` : ''}${g.license ? ` · ${esc(g.license)}` : ''}</small></td><td>${g.transcript ? `${g.transcript.split(/\s+/).length} words` : 'none'}</td><td><audio controls preload="none" src="/guide/${g.id}/audio" style="height:32px;max-width:220px"></audio> <form method="post" action="${DESK}/${g.id}/remove" style="display:inline"><button>Remove</button></form></td></tr>`).join('')}</table>` : '<p class="note">Nothing yet.</p>'}</div></section>` }));
  });
  app.post(DESK, upload.fields([{ name: 'file', maxCount: 1 }, { name: 'words', maxCount: 1 }]), async (req, res) => {
    const m = makerOf(req); const files = req.files || {}; const f = (files.file || [])[0]; const wf = (files.words || [])[0];
    const drop = () => { for (const x of [f, wf]) if (x) { try { fs.unlinkSync(x.path); } catch (e) { /* */ } } };
    if (!m && !isStudio(req)) { drop(); return res.sendStatus(403); }
    const w = findWork(m, req.body.work); if (!w || !f) { drop(); return res.redirect(`${DESK}?ok=` + encodeURIComponent(!w ? 'Which work? Its slug, accession or source address, and one of yours.' : 'The recording, please.')); }
    if (!can(req, w)) { drop(); return res.sendStatus(403); }
    let transcript = String(req.body.transcript || ''); if (wf) { try { if (fs.statSync(wf.path).size < 2 * 1024 * 1024) transcript = transcript || fs.readFileSync(wf.path, 'utf8'); } catch (e) { /* */ } }
    try { const r = await keep(w, m || db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id), f.path, { mime: f.mimetype, title: req.body.title, speaker: req.body.speaker, role: req.body.role, lang: req.body.lang, transcript, license: req.body.license, by: 'desk' }); drop(); res.redirect(`${DESK}?ok=` + encodeURIComponent(r.already ? 'That recording is already kept on this work.' : `Kept, on ${tidy(w.title)}.`)); }
    catch (e) { drop(); res.redirect(`${DESK}?ok=` + encodeURIComponent(`Not kept: ${e.message}`)); }
  });
  app.post(`${DESK}/:id/remove`, (req, res) => {
    const g = db.prepare('SELECT g.*, w.maker_id AS wm FROM audio_guides g JOIN works w ON w.id=g.work_id WHERE g.id=?').get(+req.params.id); if (!g) return res.sendStatus(404);
    const m = makerOf(req); if (!isStudio(req) && !(m && (m.id === g.maker_id || m.id === g.wm))) return res.sendStatus(403);
    db.prepare("UPDATE audio_guides SET status='removed' WHERE id=?").run(g.id); res.redirect(`${DESK}?ok=Removed.`);
  });

  app.locals.audioGuides = { of, block, first, keep, bringRow, findWork, plainTranscript, MAX_MB };
  return app.locals.audioGuides;
}

module.exports = { mountAudioGuides, plainTranscript };
