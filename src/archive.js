const ROLE = require('./role');
// The archival master: Watermark's own file, .wmark. The digital Met holds the object, not a picture of it.
//
// A .wmark is one container (zip, stored, never recompressed) holding the original exactly as it is held in
// the vault, with its papers:
//   original/<file>     the master, byte for byte (a JPEG from the camera stays that JPEG; a TIFF stays a TIFF)
//   manifest.json       accession, title, maker, copyright, fingerprints, camera, date, place, the Copyright
//                       Office line, the register's entries for this work, the house's public key
//   manifest.sig        the house's Ed25519 signature over the manifest's bytes
//   register.json       the same entries, as the register publishes them (hash, previous hash, signature)
//   certificate.pdf     the certificate of deposit
//   README.txt          how to verify the file without asking Watermark
// Verification needs nothing but the file and the house's public key (published at /ledger.json): the
// signature proves the house wrote the papers; the fingerprint in the papers must equal the hash of the
// original inside; and the register's own chain ties the work to everything recorded before and after it.
//
// Conservation: every original in the vault is re-hashed on a schedule against its fingerprint (fixity),
// and the result is recorded. The work page says when it was last verified. A failure is told to the house
// at once, never to the public.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const PDFDocument = require('pdfkit');
const ledger = require('./ledger');
const multer = require('multer');

const FORMAT = 'wmark/1';
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const canon = o => JSON.stringify(o, null, 2);

function mountArchive(app, { db, C, q, V, mk, originalPath, images, isStudio, makerOf, heldBy, mail, upload, copyrightState }) {
  db.exec(`CREATE TABLE IF NOT EXISTS fixity (id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, checked_at TEXT NOT NULL DEFAULT (datetime('now')), ok INTEGER NOT NULL, sha256 TEXT, note TEXT);
    CREATE INDEX IF NOT EXISTS fixity_work ON fixity(work_id, checked_at)`);

  const entriesOf = w => db.prepare("SELECT seq, at, type, subject, data, prev_hash, hash, sig FROM ledger WHERE subject=? AND type NOT IN ('work.viewed') ORDER BY seq").all(w.slug);
  const lastFixity = w => db.prepare('SELECT * FROM fixity WHERE work_id=? ORDER BY id DESC LIMIT 1').get(w.id) || null;

  function manifest(w, maker) {
    const office = copyrightState ? copyrightState(w) : null;
    let cred = null; try { cred = w.credentials ? JSON.parse(w.credentials) : null; } catch (e) { /* unreadable */ }
    const fx = lastFixity(w);
    return {
      format: FORMAT, house: 'Watermark, a Krafft company', base: C.base, issued_at: new Date().toISOString(),
      accession: w.accession, title: w.title, title_given: w.title_given || w.title, place: w.place || null, caption: w.caption || null,
      maker: { name: maker.name, house: maker.house || null, handle: maker.handle, page: `${C.base}/m/${V.makerSlug(maker)}` },
      copyright: { holder: maker.name, year: (w.taken_at || w.created_at || '').slice(0, 4) || null, notice: `© ${(w.taken_at || w.created_at || '').slice(0, 4)} ${maker.name}. All rights reserved.`,
        us_registration: w.copyright_reg || null, office: office ? office.line : null },
      original: { file: w.original_file, sha256: w.sha256, dhash: w.dhash || null, width: w.width, height: w.height, megapixels: w.width && w.height ? Math.round(w.width * w.height / 1e5) / 10 : null, bytes: w.bytes || null,
        camera: w.camera || null, lens: w.lens || null, taken_at: w.taken_at || null, master_at: w.master_at || null, content_credentials: cred && !cred.none ? cred : null },
      registered_at: w.created_at, fixity: fx ? { checked_at: fx.checked_at, ok: !!fx.ok } : null,
      register: entriesOf(w).map(e => ({ seq: e.seq, at: e.at, type: e.type, hash: e.hash, prev_hash: e.prev_hash, sig: e.sig })),
      house_key: { algorithm: 'ed25519', public: ledger.publicKey(), register: `${C.base}/ledger.json` },
      verify: `${C.base}/verify`,
    };
  }

  function certificate(doc, m) {
    doc.font('Times-Roman');
    doc.fontSize(10).fillColor('#666').text('WATERMARK · A KRAFFT COMPANY', { characterSpacing: 2 });
    doc.moveDown(2).fontSize(26).fillColor('#000').text('Certificate of Deposit');
    doc.moveDown(0.5).fontSize(12).fillColor('#333').text(`This certifies that the photograph below is held in the Watermark vault as an archival master, registered to its maker, fingerprinted on arrival and checked for fixity on a schedule. The file in this container is that master, byte for byte.`, { width: 440 });
    doc.moveDown(1.5);
    const row = (k, v) => { doc.fontSize(9).fillColor('#777').text(k.toUpperCase(), { characterSpacing: 1.5 }); doc.fontSize(12).fillColor('#000').text(v || '—', { width: 440 }); doc.moveDown(0.6); };
    row('Accession', m.accession); row('Title', m.title); row('Maker', `${m.maker.name}${m.maker.house ? `, ${m.maker.house}` : ''}`); row('Copyright', m.copyright.notice);
    if (m.copyright.us_registration) row('U.S. Copyright Office', m.copyright.us_registration);
    row('Registered on Watermark', String(m.registered_at || '').slice(0, 10)); row('Original', `${m.original.width} × ${m.original.height} pixels (${m.original.megapixels} MP)${m.original.camera ? `, ${m.original.camera}` : ''}${m.original.taken_at ? `, made ${String(m.original.taken_at).slice(0, 10)}` : ''}`);
    row('Fingerprint (SHA-256)', m.original.sha256); if (m.fixity) row('Fixity', `${m.fixity.ok ? 'Verified' : 'FAILED'} ${String(m.fixity.checked_at).slice(0, 10)}`);
    row('Register', `${m.register.length} entries, the first at seq ${m.register[0] ? m.register[0].seq : '—'}; published at ${m.house_key.register}`);
    row('House key', m.house_key.public || 'unsigned (no key on this server)');
    doc.moveDown(1).fontSize(9).fillColor('#777').text(`Issued ${m.issued_at}. Verify this file at ${m.verify}, or offline with the public key above: the signature in manifest.sig is Ed25519 over the bytes of manifest.json; the SHA-256 of the original must equal the fingerprint in the manifest.`, { width: 440 });
  }

  const README = m => `WATERMARK ARCHIVAL MASTER (.wmark)
${m.accession} · ${m.title} · ${m.maker.name}

This container holds the original photograph exactly as Watermark holds it, with its papers.

  original/        the master, byte for byte
  manifest.json    what the house records about it
  manifest.sig     the house's signature (Ed25519, hex) over the bytes of manifest.json
  register.json    the register's entries for this work
  certificate.pdf  the certificate of deposit

To verify without asking anyone:
  1. sha256 of the file in original/ must equal manifest.json → original.sha256
  2. manifest.sig must verify against manifest.json with the house's public key
     (manifest.json → house_key.public; also published at ${m.house_key.register})
  3. each register entry's hash must equal sha256(seq|at|type|subject|data|prev_hash), and chain

Or drop the file on ${m.verify}.
`;

  // Write the archive to a stream. Stored, never deflated: the original stays byte-identical and a reader can
  // slice it out with any zip tool.
  async function write(w, maker, out) {
    const m = manifest(w, maker);
    const mj = Buffer.from(canon(m)); const sig = ledger.sign(sha256(mj)) || '';
    const file = await originalPath(w);
    const zip = archiver('zip', { store: true });
    zip.pipe(out);
    zip.file(file, { name: `original/${w.original_file}` });
    zip.append(mj, { name: 'manifest.json' });
    zip.append(sig, { name: 'manifest.sig' });
    zip.append(canon({ house: m.house_key, entries: entriesOf(w) }), { name: 'register.json' });
    const pdf = new PDFDocument({ size: 'A4', margin: 64 }); certificate(pdf, m); pdf.end();
    zip.append(pdf, { name: 'certificate.pdf' });
    zip.append(README(m), { name: 'README.txt' });
    await zip.finalize();
    return m;
  }

  // Who may take the archive: the maker, the Studio, or a holder of the Reference.
  const may = (req, w) => isStudio(req) || ((makerOf(req) || {}).id === w.maker_id) || (heldBy(req, w) || []).some(l => l.use_key === 'reference' || l.key === 'reference');
  app.get('/w/:slug/archive.wmark', async (req, res) => {
    const w = q.work.get(req.params.slug); if (!w) return res.sendStatus(404);
    if (!may(req, w)) return res.status(403).send(V.notFound ? V.notFound({ why: 'The archival master goes to the maker, the house, and whoever holds the Reference.' }) : 'Not yours to take.');
    const maker = mk(w);
    res.set('Content-Type', 'application/vnd.watermark.archive+zip');
    res.set('Content-Disposition', `attachment; filename="${w.accession || w.slug}.wmark"`);
    ledger.append(db, 'archive.issued', w.slug, { to: isStudio(req) ? 'studio' : (makerOf(req) || {}).id === w.maker_id ? 'maker' : 'reference-holder' });
    try { await write(w, maker, res); } catch (e) { console.error('[archive]', e.message); if (!res.headersSent) res.status(500).send('The original could not be read from the vault.'); }
  });

  // Verification: a .wmark, or any image file, dropped on the house.
  async function verifyBuffer(buf, name) {
    const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
    if (!isZip) {
      const h = sha256(buf); const w = db.prepare('SELECT * FROM works WHERE sha256=?').get(h);
      if (w) return { kind: 'image', genuine: true, w, h, say: 'This file is the original held in the vault, byte for byte.' };
      // A delivered copy: its bytes, its XMP or the mark within the picture lead back to the license and the person it went to.
      if (app.locals.mark) { const t = await app.locals.mark.trace(buf); if (t && t.rendition) { const rw = db.prepare('SELECT * FROM works WHERE slug=?').get(t.work.slug); return { kind: 'image', genuine: false, delivered: false, w: rw, h, trace: t, say: `This is a copy taken from the house’s own walls: the screen rendition of ${V.tidy(rw.title)}, which carries the house’s mark. It never left under a license; no one holds it.` }; } if (t) { const tw = t.work_id ? db.prepare('SELECT * FROM works WHERE id=?').get(t.work_id) : null; const who = t.licensee_company || t.licensee_name || t.to_whom; return { kind: 'image', genuine: true, delivered: true, w: tw, h, trace: t, say: `This file left the house on ${String(t.at).slice(0, 10)}${t.ref ? `, under license ${t.ref}` : ', free and clear'}${who ? `, delivered to ${who}` : ''}${t.size === 'share' ? ', as a share-size copy' : ''}. Read from ${t.how === 'bytes' ? 'its bytes' : t.how === 'xmp' ? 'the record written into the file' : 'the mark within the picture'}.` }; } }
      let near = null; try { const tmp = path.join(require('os').tmpdir(), `wm-v-${Date.now()}`); fs.writeFileSync(tmp, buf); const d = await images.dhash(tmp); fs.unlinkSync(tmp); near = db.prepare('SELECT * FROM works').all().map(x => ({ x, d: x.dhash ? images.hamming(d, x.dhash) : 99 })).filter(o => o.d <= 10).sort((a, b) => a.d - b.d)[0] || null; } catch (e) { /* not an image */ }
      if (near) return { kind: 'image', genuine: false, w: near.x, h, say: `This is a copy of a photograph held here, not the original: the picture matches, the bytes do not.` };
      return { kind: 'image', genuine: false, w: null, h, say: 'Nothing held here matches this file.' };
    }
    const unzipper = require('unzipper');
    const dir = await unzipper.Open.buffer(buf);
    const get = n => { const f = dir.files.find(x => x.path === n); return f ? f.buffer() : null; };
    const mj = await get('manifest.json'), sigB = await get('manifest.sig');
    if (!mj) return { kind: 'wmark', genuine: false, say: 'This is not a Watermark archive: no manifest inside.' };
    let m = null; try { m = JSON.parse(mj.toString()); } catch (e) { return { kind: 'wmark', genuine: false, say: 'The manifest cannot be read.' }; }
    const checks = [];
    const pub = ledger.publicKey();
    const sigOk = !!(sigB && pub && ledger.checkSig(sha256(mj), sigB.toString().trim(), pub));
    checks.push({ k: 'The house\'s signature over the papers', ok: sigOk, note: pub ? (sigOk ? 'Verified with the house key.' : 'Does not verify: the papers were altered, or signed by another house.') : 'This server has no signing key.' });
    const of = dir.files.find(x => x.path.startsWith('original/'));
    const ob = of ? await of.buffer() : null; const oh = ob ? sha256(ob) : null;
    checks.push({ k: 'The original inside matches its fingerprint', ok: !!(oh && m.original && oh === m.original.sha256), note: oh ? (oh === (m.original || {}).sha256 ? 'Byte for byte.' : 'The file inside is not the one the papers describe.') : 'No original inside.' });
    const w = m.accession ? db.prepare('SELECT * FROM works WHERE accession=?').get(m.accession) : null;
    checks.push({ k: 'Held by the house today', ok: !!(w && w.sha256 === oh), note: w ? (w.sha256 === oh ? `${w.accession}: the vault holds this exact file.` : 'The house holds a different master under this accession (a later, larger original replaces an earlier one; the register says when).') : 'No work under this accession.' });
    const reg = Array.isArray(m.register) ? m.register : [];
    const regOk = reg.length > 0 && reg.every(e => { const row = db.prepare('SELECT hash FROM ledger WHERE seq=?').get(e.seq); return row && row.hash === e.hash; });
    checks.push({ k: 'The register entries agree with the house\'s register', ok: regOk, note: regOk ? `${reg.length} entries, each hash found at its place in the chain.` : 'The entries differ from the register.' });
    const genuine = checks.every(c => c.ok);
    return { kind: 'wmark', genuine, held: !!(w && w.sha256 === oh), m, w, checks, h: oh, say: genuine ? 'Genuine. The original and its papers are exactly as the house issued them.' : 'This archive does not verify in every respect.' };
  }
  const take = multer({ dest: path.join(C.dataDir, 'incoming'), limits: { fileSize: 400 * 1024 * 1024 } }); // any file: a .wmark is a zip
  app.post('/verify', take.single('file'), (req, res, next) => (req.file ? app.locals.bagcheck.gate('proof')(req, res, next) : next()), async (req, res) => {
    if (!req.file) return res.redirect('/verify');
    let buf; try { buf = fs.readFileSync(req.file.path); } finally { try { fs.unlinkSync(req.file.path); } catch (e) { /* gone */ } }
    try { const r = await verifyBuffer(buf, req.file.originalname); res.send(V.verifyFile({ r, name: req.file.originalname, maker: r.w ? mk(r.w) : null })); }
    catch (e) { console.error('[verify]', e.message); res.send(V.verifyFile({ r: { kind: 'wmark', genuine: false, say: 'The file could not be read.' }, name: req.file.originalname, maker: null })); }
  });

  // Fixity: the originals re-hashed against their fingerprints, the oldest checks first, a few at a time.
  let running = false;
  async function fixity(limit = 25) {
    if (running) return { ran: 0 }; running = true;
    const rows = db.prepare(`SELECT w.* FROM works w LEFT JOIN (SELECT work_id, MAX(checked_at) last FROM fixity GROUP BY work_id) f ON f.work_id=w.id
      WHERE w.original_file IS NOT NULL ORDER BY f.last IS NOT NULL, f.last LIMIT ?`).all(limit);
    let ok = 0, bad = [];
    try {
      for (const w of rows) {
        try {
          const h = sha256(fs.readFileSync(await originalPath(w)));
          const good = h === w.sha256;
          db.prepare('INSERT INTO fixity (work_id, ok, sha256) VALUES (?,?,?)').run(w.id, good ? 1 : 0, h);
          if (good) ok++; else bad.push(w);
        } catch (e) { db.prepare('INSERT INTO fixity (work_id, ok, note) VALUES (?,0,?)').run(w.id, e.message.slice(0, 200)); bad.push(w); }
      }
      if (bad.length) {
        ledger.append(db, 'fixity.failed', 'vault', { works: bad.map(w => w.slug) });
        const house = mk(null);
        mail.send({ to: house.email, subject: `Fixity failed on ${bad.length} original${bad.length === 1 ? '' : 's'}`, text: `The vault check could not confirm these originals against their fingerprints:\n\n${bad.map(w => `${w.accession} ${w.title} (${w.slug})`).join('\n')}\n\nSee ${C.base}/studio/fixity.` });
      }
    } finally { running = false; }
    return { ran: rows.length, ok, bad: bad.length };
  }
  const fixityOf = w => lastFixity(w);
  const summary = () => ({
    checked: db.prepare('SELECT COUNT(DISTINCT work_id) n FROM fixity').get().n,
    works: db.prepare('SELECT COUNT(*) n FROM works WHERE original_file IS NOT NULL').get().n,
    failing: db.prepare('SELECT COUNT(*) n FROM (SELECT work_id, ok FROM fixity f WHERE id=(SELECT MAX(id) FROM fixity WHERE work_id=f.work_id)) WHERE ok=0').get().n,
    last: (db.prepare('SELECT MAX(checked_at) t FROM fixity').get() || {}).t || null,
  });
  if (process.env.NODE_ENV !== 'test' && ROLE.chores) setInterval(() => fixity(25).catch(e => console.error('[fixity]', e.message)), 6 * 60 * 60 * 1000).unref();

  app.locals.archive = { manifest, write, verifyBuffer, fixity, fixityOf, summary, FORMAT };
  return app.locals.archive;
}

module.exports = { mountArchive, FORMAT };
