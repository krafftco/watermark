// The estate (Will, 4 Nov: "basically this is like the modern catalog: you can carry a modern catalog of all your work
// ever created; you could hand over the keys to your catalog, and you could also sell your entire estate"). Three parts.
// (1) The catalogue as one object: /account/estate/catalogue.pdf (a catalogue raisonné set by the house: a title page,
// then every work with its picture, title, year, place, kind and medium, accession, fingerprint, register entry and
// licences) and /account/estate/catalogue.zip (the PDF, works.csv, a README, and with ?masters=1 every master byte for
// byte, streamed one at a time so nothing large sits in memory). (2) Succession: the maker names up to three people
// (`estate_heirs`: name, email, relation, role heir|executor) and may tell them at once; a named person's page
// /estate/h/:token says what they hold (nothing yet) and, when the time comes, takes a request for the keys with the
// papers (a death certificate or letters testamentary, through the bag check 'papers'). The maker is written to at
// once with a one-tap stop (/estate/stop/:token), and nothing is granted for ESTATE_WAIT_DAYS (30) or until the house
// has looked at the papers (Studio → /studio/estate). Granted: a seat at the maker's desk (an `institution_staff` row,
// role 'estate', so the person signs in as themselves and acts for the studio through the same door as a museum's
// team), `makers.estate_at`, the maker page reads 'Kept by the estate'. (3) The sale of the whole catalogue with its
// copyrights is by letter with the house: a copyright passes only by a signed written assignment (17 U.S.C. §204),
// recorded with the Copyright Office; the house prepares the catalogue and the record, counsel the assignment. Every
// word a draft for Will and counsel. Nothing of the estate is told on the register but the grant (hidden).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDF = require('pdfkit');
const archiver = require('archiver');
const ROLES = { heir: 'Heir', executor: 'Executor' };
const WAIT = () => Math.max(0, +(process.env.ESTATE_WAIT_DAYS || 30));
const MAX_HEIRS = 3;
const HOUSE = process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com';

function mountEstate(app, { db, V, C, mail, ledger, isStudio, studioOnly, makerOf, images, originalPath, cache, upload, bagcheck }) {
  const { esc, date } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS estate_heirs (id INTEGER PRIMARY KEY, maker_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, relation TEXT, role TEXT NOT NULL DEFAULT 'heir',
    token TEXT NOT NULL UNIQUE, stop_token TEXT, status TEXT NOT NULL DEFAULT 'named', told_at TEXT, asked_at TEXT, proof TEXT, proof_name TEXT, ask_note TEXT,
    decided_at TEXT, word TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  for (const [c, t] of [['estate_at', 'TEXT']]) { try { db.exec(`ALTER TABLE makers ADD COLUMN ${c} ${t}`); } catch (e) { /* there */ } }
  const dir = path.join(C.dataDir, 'estate'); fs.mkdirSync(dir, { recursive: true });
  const first = n => String(n || '').trim().split(/\s+/)[0] || '';
  const works = m => db.prepare("SELECT id, slug, title, taken_at, place, kind, medium, accession, sha256, width, height, bytes, status, stars, original_file FROM works WHERE maker_id=? AND status IN ('held','hidden','restoring') ORDER BY COALESCE(taken_at, created_at), id").all(m.id);
  const entryOf = slug => { try { const r = db.prepare("SELECT seq FROM ledger WHERE subject=? AND type='work.registered' ORDER BY seq LIMIT 1").get(slug); return r ? r.seq : null; } catch (e) { return null; } };
  const licOf = id => { try { return db.prepare("SELECT COUNT(*) n FROM licenses WHERE work_id=? AND status IN ('active','expired')").get(id).n; } catch (e) { return 0; } };
  const yearOf = w => (String(w.taken_at || '').match(/^(\d{4})/) || [])[1] || '';
  const heirsOf = m => db.prepare("SELECT * FROM estate_heirs WHERE maker_id=? AND status!='removed' ORDER BY id").all(m.id);
  const gb = b => (b / 1e9).toFixed(b > 1e10 ? 0 : 1);

  // The catalogue, set as a book.
  async function pdf(m, out) {
    const doc = new PDF({ size: 'LETTER', margin: 54, info: { Title: `${m.name}: the catalogue`, Author: m.name, Creator: 'Watermark' } });
    doc.pipe(out);
    const ws = works(m), now = new Date();
    doc.font('Times-Roman').fontSize(11).fillColor('#555').text('WATERMARK', { characterSpacing: 3 });
    doc.moveDown(8).fillColor('#111').fontSize(34).text(m.name);
    doc.moveDown(0.6).fontSize(16).fillColor('#444').text('The catalogue of the work');
    doc.moveDown(2).fontSize(11).fillColor('#555').text(`${ws.length.toLocaleString('en-US')} works, as held on Watermark on ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`);
    doc.moveDown(0.4).text('Each work carries its fingerprint (SHA-256 of the master) and its entry on the house’s register, so any copy can be checked against the record at ' + C.base + '/verify.');
    for (const [i, w] of ws.entries()) {
      if (i % 3 === 0) doc.addPage();
      const top = 54 + (i % 3) * 228;
      let buf = null;
      try { buf = await fs.promises.readFile(await images.derivativeOf(() => originalPath(w), cache, w.slug, 'thumb', 'jpg')); } catch (e) { buf = null; }
      if (buf) { try { doc.image(buf, 54, top, { fit: [200, 200], align: 'center', valign: 'center' }); } catch (e) { /* unreadable */ } }
      const x = 278, wdt = 280;
      doc.fillColor('#111').font('Times-Roman').fontSize(14).text(w.title || 'Untitled', x, top, { width: wdt });
      doc.fontSize(10).fillColor('#444').text([yearOf(w), w.place].filter(Boolean).join(' · ') || ' ', { width: wdt });
      doc.moveDown(0.5).fontSize(9).fillColor('#555');
      const rows = [['No.', String(i + 1)], ['Accession', w.accession || '—'], ['Kind', [w.kind || 'photograph', w.medium].filter(Boolean).join(', ')], ['Size', w.width ? `${w.width} × ${w.height} px` : '—'], ['On view', w.status === 'held' ? 'Yes' : 'Kept back'], ['Licences', String(licOf(w.id))], ['Register', entryOf(w.slug) != null ? `entry ${entryOf(w.slug)}` : '—'], ['Fingerprint', w.sha256 || '—']];
      for (const [k, v] of rows) doc.text(`${k}: ${v}`, { width: wdt });
      doc.fillColor('#888').text(`${C.base}/w/${w.slug}`, { width: wdt, link: `${C.base}/w/${w.slug}` });
    }
    doc.end();
  }
  const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function csv(m) {
    const head = ['no', 'title', 'year', 'place', 'kind', 'medium', 'accession', 'on_view', 'width', 'height', 'bytes', 'stars', 'licences', 'register_entry', 'sha256', 'page', 'master_file'];
    return [head.join(','), ...works(m).map((w, i) => [i + 1, w.title, yearOf(w), w.place, w.kind || 'photograph', w.medium, w.accession, w.status === 'held' ? 'yes' : 'no', w.width, w.height, w.bytes, w.stars, licOf(w.id), entryOf(w.slug), w.sha256, `${C.base}/w/${w.slug}`, fileName(w, i)].map(csvCell).join(','))].join('\n') + '\n';
  }
  const fileName = (w, i) => `masters/${String(i + 1).padStart(4, '0')} ${String(w.title || w.slug).replace(/[\/\\:*?"<>|]+/g, ' ').trim().slice(0, 80)}${path.extname(w.original_file || '.jpg') || '.jpg'}`;
  const readme = (m, masters) => `${m.name}: the catalogue\n\nMade by Watermark on ${new Date().toISOString().slice(0, 10)}.\n\ncatalogue.pdf  every work with its picture and record\nworks.csv      the same records, one a line, for a spreadsheet or another system\n${masters ? 'masters/       every master, byte for byte as it was given to the house\n' : ''}\nEach work's fingerprint (sha256) is the SHA-256 of its master. Any copy can be checked at ${C.base}/verify.\nThe copyright in every work stays with ${m.name} (or whoever holds it). This file is a record, not a transfer.\n`;

  // The maker's room.
  app.get('/account/estate', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/estate');
    const ws = works(m), bytes = ws.reduce((a, w) => a + (+w.bytes || 0), 0), hs = heirsOf(m), ok = req.query.ok ? String(req.query.ok) : '';
    res.send(V.layout({ title: 'Your estate · Watermark', path: '/account/estate', studio: true, body: `<section class="studio-wrap est"><p class="k">Your estate</p><h1>The catalogue of your work.</h1>
<p class="lede">Everything you have made, kept as one record: every work with its picture, its date and place, its fingerprint and its entry on the register. Take it with you at any time; name who keeps it after you.</p>${ok ? `<p class="ok">${esc(ok)}</p>` : ''}
<section class="est-b"><h2>Take the catalogue</h2><p>${ws.length.toLocaleString('en-US')} works${bytes ? ` · ${gb(bytes)} GB of masters` : ''}.</p>
<p class="est-acts"><a class="buy-btn" href="/account/estate/catalogue.pdf">The catalogue (PDF)</a> <a class="buy-btn ghost" href="/account/estate/catalogue.zip">The catalogue and the records (zip)</a> <a class="buy-btn ghost" href="/account/estate/catalogue.zip?masters=1">With every master${bytes ? ` (${gb(bytes)} GB)` : ''}</a></p>
<p class="note">The masters leave byte for byte, as you gave them. A large archive takes a while; leave the tab open until it finishes.</p></section>
<section class="est-b"><h2>Who keeps it after you</h2><p>Name up to ${MAX_HEIRS} people. Nothing passes while you live. When the time comes, the person you named asks for the keys with the papers; you are written to first with a way to stop it, and the house looks at the papers before anything is opened. Then they sign in as themselves and keep your studio: the work, the record, the money owed, the licences.</p>
${hs.length ? `<table class="tbl est-t"><tr><th>Name</th><th>As</th><th>Email</th><th>State</th><th></th></tr>${hs.map(h => `<tr><td>${esc(h.name)}${h.relation ? ` <i>${esc(h.relation)}</i>` : ''}</td><td>${ROLES[h.role] || esc(h.role)}</td><td>${esc(h.email)}</td><td>${h.status === 'asked' ? `<b>Asked for the keys ${esc(date(h.asked_at))}</b> · <a href="/estate/stop/${esc(h.stop_token)}">Stop it</a>` : h.status === 'granted' ? 'Holds the keys' : h.status === 'declined' ? 'Asked; refused' : h.told_at ? 'Named, and told' : 'Named'}</td><td>${h.status === 'named' || h.status === 'declined' ? `<form method="post" action="/account/estate/heirs/${h.id}/remove"><button class="link">Take off</button></form>` : ''}</td></tr>`).join('')}</table>` : ''}
${hs.length < MAX_HEIRS ? `<form method="post" action="/account/estate/heirs" class="est-f"><label><span>Name</span><input name="name" required maxlength="120"></label><label><span>Email</span><input type="email" name="email" required maxlength="160"></label><label><span>Who they are to you</span><input name="relation" maxlength="60" placeholder="Daughter, executor, gallery…"></label><label><span>As</span><select name="role"><option value="heir">Heir</option><option value="executor">Executor</option></select></label><label class="est-tell"><input type="checkbox" name="tell" value="1" checked> Write to them now, so they know</label><button class="buy-btn">Name them</button></form>` : ''}</section>
<section class="est-b"><h2>Selling the whole of it</h2><p>A catalogue can be sold whole: every work, its record and its copyrights, to a foundation, a museum, a collector or a publisher. Copyright passes only by a signed assignment in writing, recorded with the Copyright Office; the house prepares the catalogue and the record, and counsel draws the assignment. Begin by letter: <a href="mailto:${esc(HOUSE)}?subject=${encodeURIComponent('Selling the catalogue of ' + m.name)}">${esc(HOUSE)}</a>.</p></section>
<p class="note">Drafts for counsel: the request for the keys, the waiting period, and the assignment.</p></section>` }));
  });
  app.get('/account/estate/catalogue.pdf', async (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${m.handle}-catalogue.pdf"`, 'Cache-Control': 'private, no-store' });
    try { ledger.append(db, 'estate.catalogue', m.handle, { pdf: true }); } catch (e) { /* */ }
    await pdf(m, res).catch(e => { console.error('[estate] pdf', e.message); res.end(); });
  });
  app.get('/account/estate/catalogue.zip', async (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const masters = req.query.masters === '1';
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${m.handle}-catalogue${masters ? '-with-masters' : ''}.zip"`, 'Cache-Control': 'private, no-store' });
    const zip = archiver('zip', { store: true }); zip.on('error', e => { console.error('[estate] zip', e.message); res.end(); }); zip.pipe(res);
    try { ledger.append(db, 'estate.catalogue', m.handle, { masters }); } catch (e) { /* */ }
    zip.append(readme(m, masters), { name: 'README.txt' });
    zip.append(csv(m), { name: 'works.csv' });
    const { PassThrough } = require('stream'); const p = new PassThrough(); zip.append(p, { name: 'catalogue.pdf' });
    await new Promise(ok => { p.on('end', ok); pdf(m, p).catch(e => { console.error('[estate] pdf', e.message); p.end(); }); });
    if (masters) {
      for (const [i, w] of works(m).entries()) {
        let f = null; try { f = await originalPath(w); } catch (e) { f = null; }
        if (!f || !fs.existsSync(f)) continue;
        await new Promise(ok => { zip.once('entry', ok); zip.file(f, { name: fileName(w, i) }); });
      }
    }
    zip.finalize();
  });
  app.post('/account/estate/heirs', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const b = req.body || {}, name = String(b.name || '').trim().slice(0, 120), email = String(b.email || '').trim().toLowerCase().slice(0, 160), relation = String(b.relation || '').trim().slice(0, 60), role = ROLES[b.role] ? b.role : 'heir';
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.redirect('/account/estate?ok=' + encodeURIComponent('A name and an email, please.'));
    if (heirsOf(m).length >= MAX_HEIRS) return res.redirect('/account/estate?ok=' + encodeURIComponent(`Up to ${MAX_HEIRS}.`));
    const token = crypto.randomBytes(24).toString('base64url'), stop = crypto.randomBytes(24).toString('base64url'), tell = String(b.tell) === '1';
    db.prepare("INSERT INTO estate_heirs (maker_id, name, email, relation, role, token, stop_token, told_at) VALUES (?,?,?,?,?,?,?,?)").run(m.id, name, email, relation || null, role, token, stop, tell ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null);
    if (tell) mail.send({ to: email, subject: `${m.name} has named you`, text: `${first(name)},\n\n${m.name} keeps their work on Watermark, and has named you ${role === 'executor' ? 'the executor' : 'an heir'} of it: the catalogue of everything they have made, its record, and what it earns.\n\nNothing passes now, and there is nothing for you to do. Keep this letter. When the time comes, this is your door:\n\n${C.base}/estate/h/${token}\n\nWatermark` }).catch(() => {});
    try { ledger.append(db, 'estate.named', m.handle, { role }); } catch (e) { /* */ }
    res.redirect('/account/estate?ok=' + encodeURIComponent(`${name} is named.${tell ? ' They have a letter.' : ''}`));
  });
  app.post('/account/estate/heirs/:id/remove', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    db.prepare("UPDATE estate_heirs SET status='removed' WHERE id=? AND maker_id=? AND status IN ('named','declined')").run(+req.params.id, m.id);
    res.redirect('/account/estate?ok=' + encodeURIComponent('Taken off.'));
  });

  // The named person's door.
  const heirByToken = t => db.prepare("SELECT * FROM estate_heirs WHERE token=? AND status!='removed'").get(String(t));
  app.get('/estate/h/:token', (req, res) => {
    const h = heirByToken(req.params.token); if (!h) return res.sendStatus(404);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(h.maker_id); if (!m) return res.sendStatus(404);
    res.set('Cache-Control', 'private, no-store');
    const body = h.status === 'granted' ? `<p>You hold the keys to ${esc(m.name)}’s studio. Your letter carries the way in; sign in with ${esc(h.email)} and choose ${esc(m.name)} at <a href="/staff/as/${esc(m.handle)}">their desk</a>.</p>`
      : h.status === 'asked' ? `<p>Your request reached the house on ${esc(date(h.asked_at))}. The house reads the papers, and ${esc(first(m.name))} is written to first; nothing opens for ${WAIT()} days from your request. You will have a letter either way.</p>`
      : `<p>${esc(m.name)} has named you ${h.role === 'executor' ? 'the executor' : 'an heir'} of the work they keep here. Nothing passes while they live, and there is nothing to do now.</p>
<details class="est-ask"><summary>When the time comes: ask for the keys</summary><form method="post" action="/estate/h/${esc(h.token)}/ask" enctype="multipart/form-data" class="est-f"><label><span>The papers (a death certificate, or letters testamentary)</span><input type="file" name="proof" accept="application/pdf,image/jpeg,image/png" required></label><label><span>A word for the house</span><textarea name="note" maxlength="1200" rows="4"></textarea></label><label class="est-tell"><input type="checkbox" name="attest" value="1" required> What I give here is true, and I am the person named.</label><button class="buy-btn">Ask for the keys</button></form></details>`;
    res.send(V.layout({ title: `The estate of ${m.name} · Watermark`, path: '/estate', body: `<section class="studio-wrap est"><p class="k">The estate</p><h1>${esc(first(h.name))}, ${esc(m.name)} named you.</h1>${body}<p class="note">Questions by letter: ${esc(HOUSE)}.</p></section>` }));
  });
  const proofUp = upload || require('multer')({ dest: dir, limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  app.post('/estate/h/:token/ask', (req, res, next) => proofUp.single('proof')(req, res, next), (req, res, next) => (bagcheck ? bagcheck.gate('papers')(req, res, next) : next()), async (req, res) => {
    const h = heirByToken(req.params.token); if (!h || h.status !== 'named') { if (req.file) fs.unlink(req.file.path, () => {}); return res.redirect(h ? `/estate/h/${h.token}` : '/'); }
    if (!req.file || String((req.body || {}).attest) !== '1') return res.redirect(`/estate/h/${h.token}`);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(h.maker_id);
    const dest = path.join(dir, `${h.id}-${crypto.randomBytes(6).toString('hex')}${path.extname(req.file.originalname || '') || '.pdf'}`);
    await fs.promises.rename(req.file.path, dest).catch(async () => { await fs.promises.copyFile(req.file.path, dest); fs.unlink(req.file.path, () => {}); });
    db.prepare("UPDATE estate_heirs SET status='asked', asked_at=datetime('now'), proof=?, proof_name=?, ask_note=? WHERE id=?").run(dest, String(req.file.originalname || '').slice(0, 120), String((req.body || {}).note || '').slice(0, 1200), h.id);
    try { ledger.append(db, 'estate.asked', m.handle, { role: h.role }); } catch (e) { /* */ }
    if (m.email) mail.send({ to: m.email, subject: 'Someone has asked for the keys to your studio', text: `${first(m.name)},\n\n${h.name}, whom you named ${h.role === 'executor' ? 'executor' : 'an heir'} of your work on Watermark, has asked for the keys to your studio, with papers saying you have died.\n\nIf you are reading this, stop it with one tap:\n\n${C.base}/estate/stop/${h.stop_token}\n\nNothing opens for ${WAIT()} days, and not before the house has read the papers.\n\nWatermark` }).catch(() => {});
    mail.send({ to: HOUSE, subject: `Estate: ${h.name} asks for the keys to ${m.name}’s studio`, text: `${h.name} (${h.email}, ${h.relation || h.role}) asks for the keys to ${m.name} (${m.handle}).\n\nRead the papers and decide: ${C.base}/studio/estate` }).catch(() => {});
    res.redirect(`/estate/h/${h.token}`);
  });
  app.get('/estate/stop/:token', (req, res) => {
    const h = db.prepare("SELECT * FROM estate_heirs WHERE stop_token=?").get(String(req.params.token)); if (!h) return res.sendStatus(404);
    res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: 'Stop it · Watermark', path: '/estate', body: `<section class="studio-wrap est"><p class="k">Your estate</p><h1>${h.status === 'asked' ? 'Stop the request for your keys.' : 'Nothing is waiting.'}</h1>${h.status === 'asked' ? `<p>${esc(h.name)} asked on ${esc(date(h.asked_at))}. One tap refuses it; nothing opens, and they are told the request was refused.</p><form method="post" action="/estate/stop/${esc(h.stop_token)}"><button class="buy-btn">Stop it</button></form>` : '<p>No request for your keys is open.</p>'}</section>` }));
  });
  app.post('/estate/stop/:token', (req, res) => {
    const h = db.prepare("SELECT * FROM estate_heirs WHERE stop_token=?").get(String(req.params.token)); if (!h) return res.sendStatus(404);
    if (h.status === 'asked') {
      db.prepare("UPDATE estate_heirs SET status='declined', decided_at=datetime('now'), word='Stopped by the maker' WHERE id=?").run(h.id);
      mail.send({ to: h.email, subject: 'Your request for the keys', text: `${first(h.name)},\n\nYour request for the keys was refused.\n\nWatermark` }).catch(() => {});
      try { const m = db.prepare('SELECT handle FROM makers WHERE id=?').get(h.maker_id); ledger.append(db, 'estate.stopped', m ? m.handle : 'house', {}); } catch (e) { /* */ }
    }
    res.redirect(`/estate/stop/${h.stop_token}`);
  });

  // The house's desk.
  const daysSince = t => (Date.now() - Date.parse(String(t).replace(' ', 'T') + 'Z')) / 864e5;
  app.get('/studio/estate', studioOnly, (req, res) => {
    const rows = db.prepare("SELECT h.*, m.name AS maker_name, m.handle FROM estate_heirs h JOIN makers m ON m.id=h.maker_id WHERE h.status IN ('asked','granted','declined') ORDER BY CASE h.status WHEN 'asked' THEN 0 ELSE 1 END, h.asked_at DESC").all();
    const named = db.prepare("SELECT COUNT(*) n FROM estate_heirs WHERE status='named'").get().n;
    res.send(V.layout({ title: 'Estates · Studio', path: '/studio/estate', studio: true, body: `<section class="studio-wrap est"><p class="k">The house</p><h1>Estates.</h1><p class="lede">${named} people named by makers. A request for the keys waits ${WAIT()} days and the house’s look at the papers; the maker is written to first with a way to stop it.${req.query.ok ? ` <b>${esc(String(req.query.ok))}</b>` : ''}</p>
${rows.length ? rows.map(h => { const d = h.asked_at ? Math.floor(daysSince(h.asked_at)) : 0, ready = d >= WAIT(); return `<article class="est-r"><h3>${esc(h.name)} <i>${esc(h.relation || ROLES[h.role] || h.role)}</i> → ${esc(h.maker_name)}</h3><p>${esc(h.email)} · asked ${esc(date(h.asked_at))} · ${h.status === 'asked' ? (ready ? 'the wait is over' : `${WAIT() - d} days left`) : esc(h.status)}${h.word ? ` · ${esc(h.word)}` : ''}</p>${h.ask_note ? `<blockquote>${esc(h.ask_note)}</blockquote>` : ''}${h.proof ? `<p><a href="/studio/estate/${h.id}/proof">The papers (${esc(h.proof_name || 'file')})</a></p>` : ''}${h.status === 'asked' ? `<form method="post" action="/studio/estate/${h.id}" class="est-f"><input name="word" maxlength="200" placeholder="A word (kept)"><button class="buy-btn" name="do" value="grant"${ready ? '' : ' disabled title="The wait is not over"'}>Grant the keys</button><button class="link" name="do" value="decline">Refuse</button></form>` : ''}</article>`; }).join('') : '<p>No requests.</p>'}</section>` }));
  });
  app.get('/studio/estate/:id/proof', studioOnly, (req, res) => {
    const h = db.prepare('SELECT * FROM estate_heirs WHERE id=?').get(+req.params.id); if (!h || !h.proof || !fs.existsSync(h.proof)) return res.sendStatus(404);
    res.set('Cache-Control', 'private, no-store'); res.sendFile(h.proof);
  });
  app.post('/studio/estate/:id', studioOnly, (req, res) => {
    const h = db.prepare("SELECT * FROM estate_heirs WHERE id=? AND status='asked'").get(+req.params.id); if (!h) return res.redirect('/studio/estate');
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(h.maker_id); const word = String((req.body || {}).word || '').slice(0, 200);
    if ((req.body || {}).do === 'grant') {
      if (daysSince(h.asked_at) < WAIT()) return res.redirect('/studio/estate?ok=' + encodeURIComponent('The wait is not over.'));
      const t = crypto.randomBytes(24).toString('base64url');
      db.prepare("INSERT INTO institution_staff (maker_id, email, name, role, token) VALUES (?,?,?,?,?)").run(m.id, h.email, h.name, 'estate', t);
      db.prepare("UPDATE estate_heirs SET status='granted', decided_at=datetime('now'), word=? WHERE id=?").run(word || null, h.id);
      db.prepare("UPDATE makers SET estate_at=COALESCE(estate_at, datetime('now')) WHERE id=?").run(m.id);
      mail.send({ to: h.email, subject: `The keys to ${m.name}’s studio`, text: `${first(h.name)},\n\nThe keys to ${m.name}’s studio on Watermark are yours to keep. Open the studio once from this link, on the device you open it on:\n\n${C.base}/staff/join/${t}\n\nAfter that, sign in with ${h.email} and choose ${m.name}.\n\nWith our sympathy,\nWatermark` }).catch(() => {});
      try { ledger.append(db, 'estate.granted', m.handle, { role: h.role }); } catch (e) { /* */ }
      return res.redirect('/studio/estate?ok=' + encodeURIComponent(`Granted. ${h.name} has a letter.`));
    }
    db.prepare("UPDATE estate_heirs SET status='declined', decided_at=datetime('now'), word=? WHERE id=?").run(word || 'Refused by the house', h.id);
    mail.send({ to: h.email, subject: 'Your request for the keys', text: `${first(h.name)},\n\nThe house could not grant your request for the keys${word ? `: ${word}` : ''}. Write to ${HOUSE} with anything further.\n\nWatermark` }).catch(() => {});
    res.redirect('/studio/estate?ok=' + encodeURIComponent('Refused; they have a letter.'));
  });

  // The public explainer.
  app.get('/estate', (req, res) => res.send(V.layout({ title: 'Your estate · Watermark', path: '/estate', desc: 'The catalogue of everything you have made, kept as one record, handed on when the time comes.', body: `<section class="studio-wrap est est-pub"><p class="k">Your estate</p><h1>The catalogue of everything you have made.</h1>
<p class="lede">Every work you keep here is a record: its picture, its date and place, its fingerprint, its entry on the register, what it has earned. Together they are the catalogue of your work, the book a museum would spend years making, kept as you go.</p>
<div class="est-3"><div><h2>Take it with you</h2><p>The catalogue as a book, the records as a spreadsheet, and every master byte for byte, whenever you like.</p></div><div><h2>Hand over the keys</h2><p>Name who keeps it after you. Nothing passes while you live; when the time comes, the person you named asks with the papers, you are written to first, and the house reads the papers before anything opens.</p></div><div><h2>Sell the whole of it</h2><p>A catalogue can pass whole, with its copyrights, to a foundation, a museum, a collector or a publisher. The house prepares the record; counsel draws the assignment.</p></div></div>
<p><a class="buy-btn" href="/account/estate">Your estate</a> <a class="buy-btn ghost" href="/join">Open your museum</a></p></section>` })));

  app.locals.estate = { works, csv, pdf, heirsOf, WAIT };
  return app.locals.estate;
}
module.exports = { mountEstate };
