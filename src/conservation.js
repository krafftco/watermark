// The restoration room (Will, 20 Oct: "if it's not beautiful, don't show it"; a corrupted file goes to the
// restoration room, as in a museum; the archive and the record are held, redundant, backed up and safe; at scale,
// millions of assets). Three parts:
//   The condition check (`condition`): a few works at a time, the oldest checks first, on a schedule and on demand:
//     (1) the original decodes whole (a truncated or broken file fails), (2) its bytes still match the fingerprint
//     on the register, (3) its size matches the record, (4) each display copy the house has made is judged against
//     the original resized (src/pictures.js: no block structure, close in PSNR). Every check is a row in `conditions`.
//   Off view for conservation: a work that fails leaves the walls at once (`works.status` = 'restoring', the previous
//     status kept in `status_before`): every public query selects 'held', so it is gone from the collection, the
//     walks and the API; its own page is a sign, 'Off view for conservation', with the way on. Told on the register
//     ('… is off view for conservation', no shame in it: museums say so too); the maker told; the house mailed.
//   The room (Studio → Back office → Restoration, /studio/restoration): each work with its findings and the acts:
//     Rebuild the display copies (every rendition of the work removed and made again from the original, then
//     checked); Fetch the original from the mirror (when a mirror is on and its copy matches the fingerprint);
//     Ask the maker for the master again (a letter with the door); Back on the walls (only after a passing check);
//     Retire (to the record, hidden, deeded). Nothing is ever deleted.
//   The mirror: a second store (S3_MIRROR_BUCKET, S3_MIRROR_ENDPOINT, S3_MIRROR_REGION, and its own
//     S3_MIRROR_ACCESS_KEY_ID / S3_MIRROR_SECRET_ACCESS_KEY: another provider or another region) that receives every
//     original (`mirrors`), a few at a time, the newest first; `/healthz` and the room say how far it is.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./pictures');
const CHECK_EVERY_MS = Number(process.env.CONDITION_EVERY_MIN || 30) * 60000;
const CHECK_N = Number(process.env.CONDITION_N || 12);

function mountConservation(app, { db, V, C, ledger, mail, images, store, cache, originalPath, originals, studioOnly, mk, notify }) {
  const { esc, tidy } = V;
  for (const [c, t] of [['status_before', 'TEXT'], ['condition', "TEXT NOT NULL DEFAULT 'unchecked'"]]) if (!db.prepare(`SELECT 1 FROM pragma_table_info('works') WHERE name='${c}'`).get()) db.exec(`ALTER TABLE works ADD COLUMN ${c} ${t}`);
  db.exec(`CREATE TABLE IF NOT EXISTS conditions (id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, ok INTEGER NOT NULL, decode INTEGER, fixity INTEGER, dims INTEGER, renders INTEGER, findings TEXT, checked_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE INDEX IF NOT EXISTS conditions_work ON conditions (work_id, id);
    CREATE TABLE IF NOT EXISTS mirrors (work_id INTEGER PRIMARY KEY, key TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')), checked_at TEXT);`);
  const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
  const dayOf = s => s ? new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z')).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const lastOf = w => db.prepare('SELECT * FROM conditions WHERE work_id=? ORDER BY id DESC LIMIT 1').get(w.id) || null;
  const renditionsOf = slug => { try { return fs.readdirSync(cache).filter(f => f.startsWith(slug + '-') && /^(.+)-(thumb|screen|large|wall)m?q\d\.(jpg|webp)$/.test(f) && f.replace(/-(thumb|screen|large|wall)m?q\d\.(jpg|webp)$/, '') === slug).map(f => path.join(cache, f)); } catch (e) { return []; } };
  const sizeOf = f => (f.match(/-(thumb|screen|large|wall)m?q\d\.(jpg|webp)$/) || [])[1];

  // The mirror, when configured.
  const mirror = (() => {
    const bucket = process.env.S3_MIRROR_BUCKET; if (!bucket) return null;
    try {
      const S3 = require('@aws-sdk/client-s3');
      const creds = process.env.S3_MIRROR_ACCESS_KEY_ID ? { credentials: { accessKeyId: process.env.S3_MIRROR_ACCESS_KEY_ID, secretAccessKey: process.env.S3_MIRROR_SECRET_ACCESS_KEY || '' } } : {};
      const client = new S3.S3Client({ region: process.env.S3_MIRROR_REGION || 'us-east-1', ...(process.env.S3_MIRROR_ENDPOINT ? { endpoint: process.env.S3_MIRROR_ENDPOINT, forcePathStyle: true } : {}), ...creds });
      return require('./storage').createStore({ bucket, region: process.env.S3_MIRROR_REGION, endpoint: process.env.S3_MIRROR_ENDPOINT, client, vaultKey: process.env.VAULT_KEY });
    } catch (e) { console.error('[mirror]', e.message); return null; }
  })();
  app.locals.mirrorStore = mirror;
  async function mirrorSome(n = 10) {
    if (!mirror) return { on: false };
    const rows = db.prepare('SELECT w.* FROM works w LEFT JOIN mirrors m ON m.work_id=w.id WHERE w.original_file IS NOT NULL AND m.work_id IS NULL ORDER BY w.id DESC LIMIT ?').all(n);
    let done = 0;
    for (const w of rows) {
      try { const buf = fs.readFileSync(await originalPath(w)); if (sha256(buf) !== w.sha256) continue; const key = 'originals/' + w.original_file; await mirror.put(key, buf); db.prepare('INSERT OR REPLACE INTO mirrors (work_id, key, sha256, bytes) VALUES (?,?,?,?)').run(w.id, key, w.sha256, buf.length); done++; }
      catch (e) { console.error('[mirror]', w.slug, e.message); }
    }
    return { on: true, done, left: db.prepare('SELECT COUNT(*) n FROM works w LEFT JOIN mirrors m ON m.work_id=w.id WHERE w.original_file IS NOT NULL AND m.work_id IS NULL').get().n };
  }

  // Off view, and back.
  function offView(w, findings) {
    if (w.status === 'restoring') return;
    db.prepare("UPDATE works SET status_before=status, status='restoring', condition='unsound' WHERE id=?").run(w.id);
    if (app.locals.findIndexDirty) app.locals.findIndexDirty();
    ledger.append(db, 'work.conserving', w.slug, { maker: (mk(w) || {}).handle, was: w.status, why: findings.slice(0, 3) });
    const m = mk(w);
    const notify2 = notify || app.locals.notify; if (notify2 && m) try { notify2.tell({ maker_id: m.id, kind: 'show', href: `/account/works/${w.slug}`, title: `${tidy(w.title)} is off view for conservation`, body: findings[0] || 'The house is restoring it; the original and the record are held.' }); } catch (e) { /* told by mail */ }
    const house = mk(null);
    mail.send({ to: house.email, subject: `Off view for conservation: ${tidy(w.title)}`, text: `${tidy(w.title)} (${w.slug}) failed its condition check and has left the walls.\n\n${findings.join('\n')}\n\nThe restoration room: ${C.base}/studio/restoration` }).catch(() => {});
  }
  function backOnView(w) {
    if (w.status !== 'restoring') return;
    db.prepare("UPDATE works SET status=COALESCE(status_before,'held'), status_before=NULL, condition='sound' WHERE id=?").run(w.id);
    if (app.locals.findIndexDirty) app.locals.findIndexDirty();
    ledger.append(db, 'work.restored', w.slug, { maker: (mk(w) || {}).handle });
  }

  // The conservation verdict on a display copy (20 Oct, after two hundred works left the walls at 37.4 dB against a
  // floor of 38): a copy is unsound only when it is plainly not the picture (under DB, 30 dB: a wrong or broken image)
  // or carries a grid as heavy as a mark (BLOCKS, 2 levels). The house's own JPEG of a detailed scene sits at 36–40 dB
  // and that is the standard it was made to; the strict gate in test/pictures.js guards the pipeline, not the walls.
  const DB = Number(process.env.CONDITION_DB || 30), BLOCKS = Number(process.env.CONDITION_BLOCKS || 2);
  const sound = j => j.db >= DB && j.blocks < BLOCKS;
  // The condition check of one work.
  async function check(w, { renders = true } = {}) {
    const findings = []; let decode = null, fixity = null, dims = null, rends = null;
    let file = null, transient = false;
    // A vault or disk hiccup (the network, a full disk, a fetch cut short) is the house's trouble, not the work's: it is
    // noted and tried again later, never a reason to take the work off the walls (20 Oct: eighty works left the walls
    // in one minute while masters were being uploaded).
    try { file = await originalPath(w); } catch (e) { transient = true; findings.push(`The original could not be fetched from the vault just now: ${e.message}`); }
    if (file) {
      const d = await P.decodes(file); decode = d.ok ? 1 : 0;
      if (!d.ok) {
        // a cut-short local copy is a hiccup: drop it so the next check fetches afresh
        if (/truncated|premature|unexpected end|Input buffer/i.test(d.error || '') && store.kind === 's3') { try { fs.unlinkSync(file); } catch (e) { /* gone */ } transient = true; findings.push(`The local copy of the original was incomplete and has been dropped; it will be fetched again: ${d.error}`); }
        else findings.push(`The original does not decode whole: ${d.error}`);
      }
      const h = sha256(fs.readFileSync(file)); fixity = h === w.sha256 ? 1 : 0;
      if (!fixity) { if (transient) { /* the same hiccup */ } else if (store.kind === 's3') { try { fs.unlinkSync(file); } catch (e) { /* gone */ } transient = true; findings.push('The local copy of the original did not match the fingerprint and has been dropped; it will be fetched again.'); } else findings.push('The original’s bytes no longer match the fingerprint on the register.'); }
      if (d.ok && w.width && w.height) { const rot = d.width === w.height && d.height === w.width; dims = (d.width === w.width && d.height === w.height) || rot ? 1 : 0; if (!dims) findings.push(`The original is ${d.width}×${d.height}; the record says ${w.width}×${w.height}.`); }
      if (renders && d.ok && fixity) {
        const files = renditionsOf(w.slug).filter(f => sizeOf(f) !== 'thumb'); rends = 1; const bad = [];
        for (const f of files) {
          try { const j = await P.judge(file, f, images.SIZES[sizeOf(f)]); if (!sound(j)) { bad.push(`${path.basename(f)}: blocks ${j.blocks} (limit ${BLOCKS}), ${j.db} dB (floor ${DB})`); } }
          catch (e) { bad.push(`${path.basename(f)}: unreadable (${e.message.slice(0, 80)})`); }
        }
        // A bad display copy is the house's to remake, not the work's fault: it is removed at once and made again from
        // the original before the picture is next asked for. Only a copy that fails again after a fresh make is reported.
        if (bad.length) {
          for (const f of files) { try { fs.unlinkSync(f); } catch (e) { /* gone */ } }
          let again = [];
          try { await images.warm(file, cache, w.slug); for (const f of renditionsOf(w.slug).filter(f => sizeOf(f) !== 'thumb')) { const j = await P.judge(file, f, images.SIZES[sizeOf(f)]); if (!sound(j)) again.push(`${path.basename(f)}: blocks ${j.blocks}, ${j.db} dB`); } }
          catch (e) { transient = true; again = []; findings.push(`The display copies could not be remade just now: ${e.message.slice(0, 120)}`); }
          if (again.length) { rends = 0; findings.push(`Display copies fail the standard even when remade from the original: ${again.join('; ')}`); }
        }
      }
    }
    const ok = findings.length === 0;
    // Off view only on a hard finding (the original itself does not decode, or its bytes are wrong in the vault), and
    // only when the check before this one found the same: one bad moment never empties a wall.
    const hard = !ok && !transient;
    const before = db.prepare('SELECT ok FROM conditions WHERE work_id=? ORDER BY id DESC LIMIT 1').get(w.id);
    db.prepare('INSERT INTO conditions (work_id, ok, decode, fixity, dims, renders, findings) VALUES (?,?,?,?,?,?,?)').run(w.id, ok ? 1 : 0, decode, fixity, dims, rends, findings.length ? JSON.stringify(findings) : null);
    if (ok || hard) db.prepare("UPDATE works SET condition=? WHERE id=?").run(ok ? 'sound' : 'unsound', w.id);
    if (hard && w.status === 'held' && before && before.ok === 0) offView(w, findings);
    if (ok && w.status === 'restoring') backOnView(w);
    return { ok, findings, transient };
  }
  let running = false;
  async function condition(limit = CHECK_N) {
    if (running) return { ran: 0 }; running = true; let ran = 0, bad = 0;
    try {
      const rows = db.prepare(`SELECT w.* FROM works w LEFT JOIN (SELECT work_id, MAX(checked_at) last FROM conditions GROUP BY work_id) c ON c.work_id=w.id WHERE w.original_file IS NOT NULL AND w.status IN ('held','hidden','restoring') ORDER BY w.status='restoring' DESC, c.last IS NOT NULL, c.last LIMIT ?`).all(limit);
      for (const w of rows) { ran++; const r = await check(w); if (!r.ok) bad++; }
    } finally { running = false; }
    return { ran, bad };
  }
  // Rebuild every display copy of a work from the original, then check it.
  async function rebuild(w) {
    for (const f of renditionsOf(w.slug)) { try { fs.unlinkSync(f); } catch (e) { /* gone */ } }
    try { fs.unlinkSync(path.join(cache, `${w.slug}-screen-veil.jpg`)); } catch (e) { /* none */ }
    const file = await originalPath(w);
    await images.warm(file, cache, w.slug);
    return check(w);
  }
  async function fromMirror(w) {
    if (!mirror) return { ok: false, why: 'No mirror is configured.' };
    const row = db.prepare('SELECT * FROM mirrors WHERE work_id=?').get(w.id); if (!row) return { ok: false, why: 'The mirror holds no copy of this original.' };
    const buf = await mirror.get(row.key); if (!buf) return { ok: false, why: 'The mirror’s copy is missing.' };
    if (sha256(buf) !== w.sha256) return { ok: false, why: 'The mirror’s copy does not match the fingerprint.' };
    const p = path.join(originals, w.original_file); const tmp = `${p}.${process.pid}.tmp`; fs.writeFileSync(tmp, buf); fs.renameSync(tmp, p);
    await store.put('originals/' + w.original_file, buf);
    ledger.append(db, 'work.refetched', w.slug, { from: 'mirror' });
    return rebuild(w);
  }

  // The sign on an off-view work's page (never a 404; a museum says so).
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    const m1 = req.path.match(/^\/w\/([^/]+)\/?$/) || req.path.match(/^\/m\/[^/]+\/([^/]+)\/?$/); if (!m1) return next();
    const w = db.prepare("SELECT * FROM works WHERE slug=? AND status='restoring'").get(m1[1]); if (!w) return next();
    const maker = mk(w);
    res.status(200).send(V.layout({ title: `${tidy(w.title)} · Off view`, path: '/w', body: `<article class="cv-sign"><p class="k">Off view for conservation</p><h1>${esc(tidy(w.title))}</h1><p class="lede">${maker ? `A work by <a href="/m/${esc(maker.handle)}">${esc(maker.name)}</a>` : 'A work'} is in the restoration room. The original and its record are held; the house shows nothing it cannot show whole. It will return.</p><p><a href="/stroll">Wander on</a> · <a href="/collection">The collection</a>${maker ? ` · <a href="/m/${esc(maker.handle)}">${esc(maker.name)}’s room</a>` : ''}</p></article>` }));
  });

  // The room.
  const summary = () => ({
    checked: db.prepare('SELECT COUNT(DISTINCT work_id) n FROM conditions').get().n,
    works: db.prepare("SELECT COUNT(*) n FROM works WHERE original_file IS NOT NULL AND status IN ('held','hidden','restoring')").get().n,
    restoring: db.prepare("SELECT COUNT(*) n FROM works WHERE status='restoring'").get().n,
    unsound: db.prepare("SELECT COUNT(*) n FROM works WHERE condition='unsound'").get().n,
    last: (db.prepare('SELECT MAX(checked_at) t FROM conditions').get() || {}).t || null,
    mirror: mirror ? { on: true, done: db.prepare('SELECT COUNT(*) n FROM mirrors').get().n } : { on: false },
  });
  app.get('/studio/restoration', studioOnly, (req, res) => {
    const s = summary();
    const rows = db.prepare("SELECT * FROM works WHERE status='restoring' OR condition='unsound' ORDER BY id DESC").all();
    const recent = db.prepare('SELECT c.*, w.slug, w.title FROM conditions c JOIN works w ON w.id=c.work_id ORDER BY c.id DESC LIMIT 20').all();
    const body = `<article class="cv"><p class="k">Back office</p><h1>The restoration room.</h1>
<p class="lede">If it is not sound, it is not shown. Every original is decoded whole, matched to its fingerprint and its record, and every display copy is judged against the original resized. What fails leaves the walls and comes here; nothing is deleted.</p>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
<p class="cv-sum">${s.checked} of ${s.works} works checked · ${s.restoring} off view · last check ${s.last ? esc(dayOf(s.last)) : 'never'} · mirror ${s.mirror.on ? `on, ${s.mirror.done} of ${s.works} originals held twice` : 'off (set S3_MIRROR_BUCKET and its keys in the environment)'}</p>
<form method="post" action="/studio/restoration/check" class="inline"><button class="buy-btn">Check ${CHECK_N} now</button></form> <form method="post" action="/studio/restoration/mirror" class="inline"><button class="link">Mirror ten now</button></form>
<h2>In the room</h2>
${rows.length ? `<ul class="cv-l">${rows.map(w => { const c = lastOf(w); const f = c && c.findings ? JSON.parse(c.findings) : []; const mr = db.prepare('SELECT 1 FROM mirrors WHERE work_id=?').get(w.id); return `<li class="cv-w"><a href="/studio/works/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt=""></a><div><b>${esc(tidy(w.title))}</b> · ${w.status === 'restoring' ? `off view (was ${esc(w.status_before || 'held')})` : esc(w.status)} · checked ${c ? esc(dayOf(c.checked_at)) : 'never'}
<ul class="cv-f">${f.map(x => `<li>${esc(x)}</li>`).join('') || '<li>No findings on record.</li>'}</ul>
<p class="cv-acts"><form method="post" action="/studio/restoration/${w.id}/rebuild" class="inline"><button class="link">Rebuild the display copies</button></form> · <form method="post" action="/studio/restoration/${w.id}/mirror" class="inline"><button class="link"${mirror && mr ? '' : ' disabled'}>Fetch the original from the mirror</button></form> · <form method="post" action="/studio/restoration/${w.id}/ask" class="inline"><button class="link">Ask the maker for the master</button></form> · <form method="post" action="/studio/restoration/${w.id}/check" class="inline"><button class="link">Check again</button></form> · <form method="post" action="/studio/restoration/${w.id}/back" class="inline"><button class="link"${c && c.ok ? '' : ' disabled'}>Back on the walls</button></form> · <form method="post" action="/studio/restoration/${w.id}/retire" class="inline"><button class="link">Retire to the record</button></form></p></div></li>`; }).join('')}</ul>` : '<p class="note">Empty. Every checked work is sound.</p>'}
<h2>Recent checks</h2><table class="tbl"><tr><th>When</th><th>Work</th><th>Decode</th><th>Fingerprint</th><th>Record</th><th>Display copies</th><th></th></tr>${recent.map(c => `<tr><td>${esc(dayOf(c.checked_at))}</td><td><a href="/studio/works/${esc(c.slug)}">${esc(tidy(c.title))}</a></td><td>${c.decode == null ? '·' : c.decode ? 'whole' : 'broken'}</td><td>${c.fixity == null ? '·' : c.fixity ? 'matches' : 'differs'}</td><td>${c.dims == null ? '·' : c.dims ? 'matches' : 'differs'}</td><td>${c.renders == null ? '·' : c.renders ? 'sound' : 'fail'}</td><td>${c.ok ? 'sound' : '<b>unsound</b>'}</td></tr>`).join('')}</table>
<p class="note">The standard: an original kept byte for byte and never served; display copies made from it alone, colour-managed to sRGB, never cropped, never enlarged, nothing laid into the pixels; every copy within the gate of test/pictures.js. <a href="/studio/fixity">Conservation</a> · <a href="/studio/backups">Backups</a>.</p></article>`;
    res.send(V.layout({ title: 'The restoration room · Studio', path: '/studio', body, desk: true }));
  });
  const wk = id => db.prepare('SELECT * FROM works WHERE id=?').get(Number(id));
  app.post('/studio/restoration/check', studioOnly, async (req, res) => { const r = await condition(CHECK_N); res.redirect('/studio/restoration?ok=' + encodeURIComponent(`Checked ${r.ran}; ${r.bad} unsound.`)); });
  app.post('/studio/restoration/mirror', studioOnly, async (req, res) => { const r = await mirrorSome(10); res.redirect('/studio/restoration?ok=' + encodeURIComponent(r.on ? `Mirrored ${r.done}; ${r.left} to go.` : 'No mirror is configured.')); });
  app.post('/studio/restoration/:id/check', studioOnly, async (req, res) => { const w = wk(req.params.id); if (!w) return res.sendStatus(404); const r = await check(w); res.redirect('/studio/restoration?ok=' + encodeURIComponent(r.ok ? `${tidy(w.title)} is sound.` : `${tidy(w.title)}: ${r.findings[0]}`)); });
  app.post('/studio/restoration/:id/rebuild', studioOnly, async (req, res) => { const w = wk(req.params.id); if (!w) return res.sendStatus(404); try { const r = await rebuild(w); res.redirect('/studio/restoration?ok=' + encodeURIComponent(r.ok ? `${tidy(w.title)}: display copies rebuilt and sound.` : `${tidy(w.title)}: rebuilt, still unsound: ${r.findings[0]}`)); } catch (e) { res.redirect('/studio/restoration?ok=' + encodeURIComponent(`Could not rebuild: ${e.message}`)); } });
  app.post('/studio/restoration/:id/mirror', studioOnly, async (req, res) => { const w = wk(req.params.id); if (!w) return res.sendStatus(404); try { const r = await fromMirror(w); res.redirect('/studio/restoration?ok=' + encodeURIComponent(r.ok ? `${tidy(w.title)}: the original is back from the mirror and sound.` : (r.why || r.findings[0]))); } catch (e) { res.redirect('/studio/restoration?ok=' + encodeURIComponent(e.message)); } });
  app.post('/studio/restoration/:id/ask', studioOnly, (req, res) => {
    const w = wk(req.params.id); if (!w) return res.sendStatus(404); const m = mk(w);
    if (m && m.email) mail.send({ to: m.email, subject: `${tidy(w.title)}: the house asks for the master again`, text: `${(m.name || '').split(/\s+/)[0]},\n\n${tidy(w.title)} is in the house's restoration room: the file we hold cannot be shown whole, and the house shows nothing it cannot show whole. Would you send the master again? Put it in from your studio and the house will set it as the master and check it: ${C.base}/account/works/${w.slug}\n\nThe record and the deed are untouched. Thank you.\n\nWatermark, a Krafft company.` }).catch(() => {});
    ledger.append(db, 'work.master.asked', w.slug, { by: 'house' });
    res.redirect('/studio/restoration?ok=' + encodeURIComponent(`${m ? m.name : 'The maker'} is written to.`));
  });
  app.post('/studio/restoration/:id/back', studioOnly, (req, res) => { const w = wk(req.params.id); if (!w) return res.sendStatus(404); const c = lastOf(w); if (!c || !c.ok) return res.redirect('/studio/restoration?ok=' + encodeURIComponent('It must pass a check first.')); backOnView(w); res.redirect('/studio/restoration?ok=' + encodeURIComponent(`${tidy(w.title)} is back on the walls.`)); });
  app.post('/studio/restoration/:id/retire', studioOnly, (req, res) => { const w = wk(req.params.id); if (!w) return res.sendStatus(404); db.prepare("UPDATE works SET status='hidden', status_before=NULL WHERE id=?").run(w.id); if (app.locals.findIndexDirty) app.locals.findIndexDirty(); ledger.append(db, 'work.retired', w.slug, { by: 'house' }); res.redirect('/studio/restoration?ok=' + encodeURIComponent(`${tidy(w.title)} is retired to the record.`)); });

  if (process.env.NODE_ENV !== 'test') {
    // Recovery (20 Oct): every work off view for conservation is checked again, one at a time, and goes back on the
    // walls the moment it passes; a work whose original is truly damaged stays in the room.
    setTimeout(async () => { try { const rows = db.prepare("SELECT * FROM works WHERE status='restoring' ORDER BY id").all(); let back = 0; for (const w of rows) { const r = await check(w); if (r.ok) back++; } if (rows.length) console.log(`[conservation] recovery: ${back} of ${rows.length} back on view`); } catch (e) { console.error('[conservation] recovery', e.message); } }, 90000).unref();
    setTimeout(() => condition(CHECK_N).catch(e => console.error('[condition]', e.message)), 150000).unref();
    setInterval(() => condition(CHECK_N).catch(e => console.error('[condition]', e.message)), CHECK_EVERY_MS).unref();
    if (mirror) setInterval(() => mirrorSome(10).catch(e => console.error('[mirror]', e.message)), 10 * 60000).unref();
  }
  app.locals.conservation = { check, condition, rebuild, fromMirror, mirrorSome, backOnView, offView, summary, lastOf };
  return app.locals.conservation;
}
module.exports = { mountConservation };
