// The clearance desk (Will, 26 Oct: "we can accept this work; here is what you can and cannot do with it if it
// doesn't have this, this and that; help people navigate what they can do with street photography, what they need
// model releases for; the ultimate guide that just solves the problem; these are great portraits, but to license them
// for a brand campaign you have to have a model release; the maker uploads the high-resolution masters, and also the
// model release").
//
// For every work the house answers one question per use: may this be licensed for that, and if not, what paper
// would change the answer. The rule the trade has always used, said plainly:
//   a recognisable person → a model release from each, for a company's use or a campaign (editorial, fine-art
//     prints and a personal copy need none); a child → the release signed by a parent or guardian;
//   private property or a prominent trademark → a property release, for a company's use or a campaign;
//   another artist's work → the artist's rights (src/art.js).
// Al reads every arrival (art.js `attribute`: people, property, art); the maker answers with the papers (a signed
// release, kept in the vault, private) or an attestation (no recognisable people; nothing private or branded), and
// the house may overrule either way. A closed use is simply not offered; the record says why and what to add.
// Counsel reads the rule and the house's forms before they are relied on; nothing here is legal advice.
'use strict';
const fs = require('fs'), path = require('path');

const COMMERCIAL = new Set(['commercial', 'campaign']); // the uses that want releases; editorial, print, social and reference do not
const NEED = { people: 'a model release from each recognisable person', minor: 'signed by a parent or guardian for a child', property: 'a property release for the private property or trademark shown' };

function mountClearance(app, { db, V, C, store, ledger, isStudio, studioOnly, makerOf, bagcheck }) {
  const { esc } = V;
  db.exec("CREATE TABLE IF NOT EXISTS work_releases (id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL, signed_on TEXT, kept_at TEXT, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))"); // the same table splits.js keeps (either may mount first)
  for (const [c, t] of [['clear_attest', 'TEXT'], ['clear_override', 'TEXT']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name=?").get(c)) db.exec(`ALTER TABLE works ADD COLUMN ${c} ${t}`);
  for (const [c, t] of [['file', 'TEXT'], ['mime', 'TEXT'], ['minor', 'INTEGER NOT NULL DEFAULT 0'], ['by', 'TEXT']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('work_releases') WHERE name=?").get(c)) db.exec(`ALTER TABLE work_releases ADD COLUMN ${c} ${t}`);
  const dir = path.join(C.dataDir, 'releases'); fs.mkdirSync(dir, { recursive: true });
  const multer = require('multer'); const upload = multer({ dest: dir, limits: { fileSize: 40 * 1024 * 1024, files: 1 } });

  const reading = w => (app.locals.art ? app.locals.art.attributionOf(w) : null);
  const attestOf = w => { try { return w.clear_attest ? JSON.parse(w.clear_attest) : {}; } catch (e) { return {}; } };
  const releases = w => db.prepare('SELECT * FROM work_releases WHERE work_id=? ORDER BY id').all(w.id);

  // The answer for one work: what Al saw, what papers are held, what each use needs.
  function needs(w) {
    const r = reading(w) || {}, a = attestOf(w), rel = releases(w);
    const people = a.no_people ? 0 : Math.max(0, (r.people || {}).recognisable || 0);
    const minors = !a.no_people && !!(r.people || {}).minors;
    const property = !a.no_property && !!((r.property || {}).private || (r.property || {}).trademark);
    const have = { person: rel.filter(x => x.kind === 'person').length, guardian: rel.filter(x => x.kind === 'person' && x.minor).length, property: rel.filter(x => x.kind === 'property').length };
    const missing = [];
    if (people > have.person) missing.push({ kind: 'person', n: people - have.person, text: `${NEED.people} (${have.person} of ${people} held)` });
    if (minors && !have.guardian) missing.push({ kind: 'minor', text: NEED.minor });
    if (property && !have.property) missing.push({ kind: 'property', text: `${NEED.property}${(r.property || {}).what ? `: ${(r.property || {}).what}` : ''}` });
    const seen = !!(r && r.at);
    const uses = {};
    for (const k of ['social', 'editorial', 'print', 'reference']) uses[k] = { ok: true, why: k === 'editorial' ? 'A story needs no release: the picture is news or comment.' : k === 'print' ? 'A print is a work of art, not an advertisement.' : 'A personal copy.' };
    for (const k of ['commercial', 'campaign']) {
      if (w.clear_override === 'open') uses[k] = { ok: true, why: 'The house has looked and opened it.' };
      else if (w.clear_override === 'closed') uses[k] = { ok: false, why: 'The house has closed it.', missing: [] };
      else if (missing.length) uses[k] = { ok: false, why: 'Needs ' + missing.map(m => m.text).join('; ') + '.', missing };
      else uses[k] = { ok: true, why: people || property ? 'Released: the papers are held.' : seen ? 'Nothing in the picture needs a release.' : 'Not yet read; open until the house looks.' };
    }
    return { people, minors, property, what: (r.property || {}).what || null, crowd: !!(r.people || {}).crowd, seen, have, missing, uses, attest: a, override: w.clear_override || null, released: { model: people > 0 && have.person >= people && (!minors || have.guardian > 0), property: property && have.property > 0 } };
  }
  const blocks = (w, key) => COMMERCIAL.has(key) && !needs(w).uses[key].ok;

  // The record's card: a row per use, the papers held, the doors.
  function block(w, action) {
    const n = needs(w), r = reading(w) || {}; const studio = /^\/studio\//.test(action); const rel = releases(w);
    const USES = [['social', 'Collect'], ['editorial', 'In a story'], ['print', 'On a wall'], ['commercial', 'For a company'], ['campaign', 'Before an audience']];
    return `<section class="clr" id="clearance"><h2>What may be done with it</h2>
<p class="note">The house answers, for each use, whether this picture may be licensed for it, and what paper would change the answer. The rule of the trade: a recognisable person needs a model release for a company's use or a campaign (never for a story, a print or a personal copy); a child's release is signed by a parent or guardian; private property or a prominent trademark needs a property release. <a href="/clearance">The guide</a> · the house's forms: <a href="/release/model.pdf">model release</a> · <a href="/release/property.pdf">property release</a>.</p>
<p class="clr-seen">${n.seen ? `<b>Al sees:</b> ${n.people ? `${n.people} recognisable ${n.people === 1 ? 'person' : 'people'}${n.minors ? ', one of them perhaps a child' : ''}` : n.crowd ? 'a crowd, no one recognisable' : 'no recognisable people'}; ${n.property ? `private property or a trademark${n.what ? ` (${esc(n.what)})` : ''}` : 'nothing private or branded'}${r.art && r.artist ? `; a work by ${esc(r.artist)}` : ''}. <small>${esc(r.note || '')}</small>` : '<b>Not yet read.</b> Al looks at every arrival within a few minutes; until then every use stands open.'}${n.attest.no_people || n.attest.no_property ? ` <i>The maker attests: ${[n.attest.no_people && 'no recognisable people', n.attest.no_property && 'nothing private or branded'].filter(Boolean).join('; ')}.</i>` : ''}</p>
<table class="tbl clr-tbl"><thead><tr><th>Use</th><th></th><th>Why</th></tr></thead><tbody>${USES.map(([k, name]) => { const u = n.uses[k]; return `<tr class="${u.ok ? 'clr-ok' : 'clr-no'}"><td>${esc(name)}</td><td>${u.ok ? '✓ May be licensed' : '✗ Not yet'}</td><td>${esc(u.why)}</td></tr>`; }).join('')}</tbody></table>
${rel.length ? `<h3>Releases held</h3><ul class="clr-rel">${rel.map(x => `<li>${x.kind === 'person' ? 'Model' : 'Property'} release · ${esc(x.subject)}${x.minor ? ' (a child; signed by the guardian)' : ''}${x.signed_on ? ` · signed ${esc(x.signed_on)}` : ''}${x.file ? ` · <a href="${action}/releases/${x.id}/file">the signed form</a>` : x.kept_at ? ` · kept at ${esc(x.kept_at)}` : ''} <form method="post" action="${action}" class="clr-inl"><input type="hidden" name="do" value="unrelease"><input type="hidden" name="id" value="${x.id}"><button class="btn">Remove</button></form></li>`).join('')}</ul>` : ''}
<form method="post" action="${action}" enctype="multipart/form-data" class="clr-f"><h3>Add a release</h3><div class="clr-row"><label>Kind<select name="kind"><option value="person">Model release (a person)</option><option value="property">Property release</option></select></label><label>Who, or what<input name="subject" required placeholder="Jane Doe · the Rossi house" maxlength="160"></label><label>Signed on<input name="signed_on" type="date"></label><label class="clr-ck"><input type="checkbox" name="minor" value="1"> A child; signed by a parent or guardian</label></div><div class="clr-row"><label>The signed form (PDF or a photograph of it; kept in the vault, never shown)<input type="file" name="file" accept="application/pdf,image/*"></label><label>Or where it is kept on paper<input name="kept_at" placeholder="the studio's file" maxlength="200"></label></div><input type="hidden" name="do" value="release"><button class="buy-btn">Keep it</button></form>
<form method="post" action="${action}" class="clr-f clr-attest"><h3>Or say what the picture holds</h3><label class="clr-ck"><input type="checkbox" name="no_people" value="1"${n.attest.no_people ? ' checked' : ''}> There are no recognisable people in this picture (a crowd, a back, a distant figure do not count)</label><label class="clr-ck"><input type="checkbox" name="no_property" value="1"${n.attest.no_property ? ' checked' : ''}> Nothing private or branded is prominent in it</label><input type="hidden" name="do" value="attest"><button class="btn">I attest</button><small>Your word is kept with the record and the Maker Agreement stands behind it.</small></form>
${studio ? `<form method="post" action="${action}" class="clr-f clr-ov"><input type="hidden" name="do" value="override"><label>The house's say on a company's use and a campaign<select name="value"><option value=""${!w.clear_override ? ' selected' : ''}>As the rule reads it</option><option value="open"${w.clear_override === 'open' ? ' selected' : ''}>Open</option><option value="closed"${w.clear_override === 'closed' ? ' selected' : ''}>Closed</option></select></label><button class="btn">Set</button></form>` : ''}
</section>`;
  }

  async function act(req, res, w, back) {
    const d = String(req.body.do || ''); const who = /^\/studio\//.test(back) ? 'house' : 'maker';
    if (d === 'release') {
      const kind = req.body.kind === 'property' ? 'property' : 'person'; const subject = String(req.body.subject || '').trim().slice(0, 160); if (!subject) { if (req.file) try { fs.unlinkSync(req.file.path); } catch (e) { /* */ } return res.redirect(`${back}?ok=nosubject#clearance`); }
      let file = null, mime = null, mime0 = null;
      if (req.file) { const head = Buffer.alloc(8); try { const fd = fs.openSync(req.file.path, 'r'); fs.readSync(fd, head, 0, 8, 0); fs.closeSync(fd); } catch (e) { /* */ } const ext = head.slice(0, 4).toString() === '%PDF' ? 'pdf' : head[0] === 0x89 && head[1] === 0x50 ? 'png' : 'jpg'; if (ext === 'pdf') mime0 = 'application/pdf'; const name = `release-${w.id}-${Date.now()}.${ext}`; const dest = path.join(dir, name); fs.renameSync(req.file.path, dest); file = name; mime = mime0 || req.file.mimetype; try { if (store && store.put) await store.put('releases/' + name, dest, mime); } catch (e) { console.error('[clearance] vault', e.message); } }
      db.prepare('INSERT INTO work_releases (work_id, kind, subject, signed_on, kept_at, note, file, mime, minor, by) VALUES (?,?,?,?,?,?,?,?,?,?)').run(w.id, kind, subject, /^\d{4}-\d{2}-\d{2}$/.test(req.body.signed_on || '') ? req.body.signed_on : null, String(req.body.kept_at || '').trim().slice(0, 200) || null, null, file, mime, req.body.minor ? 1 : 0, who);
      try { ledger.append(db, 'release.kept', w.slug, { kind, minor: !!req.body.minor, file: !!file }); } catch (e) { /* */ }
      return res.redirect(`${back}?ok=release#clearance`);
    }
    if (d === 'unrelease') { const x = db.prepare('SELECT * FROM work_releases WHERE id=? AND work_id=?').get(+req.body.id, w.id); if (x) { db.prepare('DELETE FROM work_releases WHERE id=?').run(x.id); if (x.file) try { fs.unlinkSync(path.join(dir, x.file)); } catch (e) { /* */ } } return res.redirect(`${back}?ok=release#clearance`); }
    if (d === 'attest') { const a = { no_people: !!req.body.no_people, no_property: !!req.body.no_property, by: who, at: new Date().toISOString() }; db.prepare('UPDATE works SET clear_attest=? WHERE id=?').run(JSON.stringify(a), w.id); try { ledger.append(db, 'clearance.attested', w.slug, a); } catch (e) { /* */ } return res.redirect(`${back}?ok=attest#clearance`); }
    if (d === 'override' && who === 'house') { const v = ['open', 'closed'].includes(req.body.value) ? req.body.value : null; db.prepare('UPDATE works SET clear_override=? WHERE id=?').run(v, w.id); try { ledger.append(db, 'clearance.overridden', w.slug, { to: v }); } catch (e) { /* */ } return res.redirect(`${back}?ok=attest#clearance`); }
    res.redirect(`${back}#clearance`);
  }
  const findWork = slug => db.prepare('SELECT * FROM works WHERE slug=?').get(String(slug));
  const gate = (req, res, next) => (req.file && bagcheck ? bagcheck.gate('papers')(req, res, next) : next());
  const mine = (req, res, next) => { const m = makerOf(req); const w = findWork(req.params.slug); if (!m || !w || w.maker_id !== m.id) return res.sendStatus(403); req.work = w; next(); };
  app.post('/account/works/:slug/clearance', mine, (req, res, next) => upload.single('file')(req, res, e => (e ? res.redirect(`/account/works/${req.params.slug}?ok=file#clearance`) : next())), gate, (req, res) => act(req, res, req.work, `/account/works/${encodeURIComponent(req.work.slug)}`));
  app.post('/studio/works/:slug/clearance', studioOnly, (req, res, next) => { const w = findWork(req.params.slug); if (!w) return res.sendStatus(404); req.work = w; next(); }, (req, res, next) => upload.single('file')(req, res, e => (e ? res.redirect(`/studio/works/${req.params.slug}?ok=file#clearance`) : next())), gate, (req, res) => act(req, res, req.work, `/studio/works/${encodeURIComponent(req.work.slug)}`));
  const serveFile = async (req, res, w) => { const x = db.prepare('SELECT * FROM work_releases WHERE id=? AND work_id=?').get(+req.params.id, w.id); if (!x || !x.file) return res.sendStatus(404); const p = path.join(dir, path.basename(x.file)); if (!fs.existsSync(p) && store && store.get) { try { await store.get('releases/' + x.file, p); } catch (e) { return res.sendStatus(404); } } res.set('Cache-Control', 'private, no-store'); res.sendFile(p); };
  app.get('/account/works/:slug/clearance/releases/:id/file', mine, (req, res) => serveFile(req, res, req.work));
  app.get('/studio/works/:slug/clearance/releases/:id/file', studioOnly, (req, res) => { const w = findWork(req.params.slug); if (!w) return res.sendStatus(404); serveFile(req, res, w); });

  // The guide, and the house's forms (drafts for counsel).
  app.get('/clearance', (req, res) => res.send(V.layout({ title: 'What you can do with a photograph · Watermark', path: '/clearance', desc: 'Street photography, portraits, model releases, property releases: what a photograph may be licensed for, and the paper that changes the answer.', body: `<section class="narrow clr-guide"><p class="k">The clearance desk</p><h1>What you can do with a photograph.</h1>
<p class="lede">You can photograph almost anything you can see from a public place. What you can <em>sell the use of</em> depends on what is in the picture and what the buyer means to do with it. The house reads every picture when it arrives and says, use by use, what it may be licensed for and what paper would open the rest. Here is the rule it reads by.</p>
<h2>Three uses that need no paper</h2>
<p><b>In a story.</b> News, a feature, a book, an essay, a report: editorial use. A recognisable person in a photograph used to tell a true story needs no release. This is the whole of street photography and photojournalism.</p>
<p><b>On a wall.</b> A print is a work of art. Selling an artist's print of a photograph with a person in it is not advertising, and needs no release in the usual case.</p>
<p><b>A personal copy.</b> Collect: a copy for yourself, your screen, your own accounts. No release.</p>
<h2>Two uses that do</h2>
<p><b>For a company</b> and <b>before an audience</b>: the face of a website, a campaign, a package, a billboard, anything that sells or promotes. A recognisable person in that picture must have signed a <b>model release</b>, each of them; for a child, a parent or guardian signs. Private property shown prominently (a home, a shop, a car's plate) or a <b>trademark</b>, a logo, a branded design, wants a <b>property release</b> from its owner. Without the paper the house does not offer those two uses on the work; the other three stay open.</p>
<h2>What the house does</h2>
<ol><li>Al looks at every arrival and says what it sees: recognisable people, a child, private property, a trademark, another artist's work.</li><li>Every use stands open or closed on the work's record, with the reason, and the picture hangs either way.</li><li>You add the paper, a signed release kept in the vault and never shown, or you attest that there is no one recognisable or nothing private in the picture, and the use opens.</li><li>The house can look for itself and overrule either way. Buyers of the trade see which pictures are released.</li></ol>
<h2>The house's forms</h2>
<p>Two plain releases, one page each, to print, sign and keep here: <a class="buy-btn" href="/release/model.pdf">Model release (PDF)</a> <a class="buy-btn" href="/release/property.pdf">Property release (PDF)</a></p>
<p class="note">The rule above is the trade's usual practice in the United States, said plainly; it is not legal advice, the law differs by country and by state, and the house's forms are drafts until counsel confirms them. When in doubt, get the release: it costs a signature and opens every use.</p></section>` })));

  function releasePdf(kind) {
    const PDFDocument = require('pdfkit'); const doc = new PDFDocument({ size: 'LETTER', margins: { top: 64, bottom: 64, left: 72, right: 72 } });
    const H = kind === 'property' ? 'Property Release' : 'Model Release'; const L = (t, o = {}) => doc.font('Times-Roman').fontSize(11).text(t, { paragraphGap: 8, lineGap: 2, ...o });
    doc.font('Times-Bold').fontSize(20).text(H, { paragraphGap: 4 }); doc.font('Times-Italic').fontSize(10).text('Watermark · a Krafft company · a draft form, for the maker’s own use', { paragraphGap: 16 });
    if (kind === 'property') {
      L('I own or control the property described below, or am authorised by its owner to sign this release.');
      L('Property: ________________________________________________   Address: ________________________________________________');
      L('I grant the Photographer named below, and anyone the Photographer licenses through Watermark, the irrevocable right to use photographs of the property, in whole or in part, in any medium now known or later devised, for any purpose including advertising, trade, publication and display, without further payment to me and without the right to inspect or approve the finished use.');
      L('I waive any claim arising from the use of the photographs, including claims of invasion of privacy, defamation or infringement of any right in the property or in any mark, design or work shown on it that I own or control.');
    } else {
      L('I, the person named below, grant the Photographer named below, and anyone the Photographer licenses through Watermark, the irrevocable right to use photographs of me taken on the date below, in whole or in part, with or without my name, in any medium now known or later devised, for any purpose including advertising, trade, publication and display, without further payment to me and without the right to inspect or approve the finished use or the words beside it.');
      L('I waive any claim arising from the use of the photographs, including claims of invasion of privacy, right of publicity, defamation or blurring and alteration, except that the photographs will not be used in a way that is defamatory of me.');
      L('I am eighteen or over, or the parent or guardian named below signs for me.');
      L('Name: ________________________________________________   Date of the photographs: ________________________');
      L('Address: _____________________________________________   Email or telephone: ______________________________');
      L('Parent or guardian (if under eighteen): _______________________________   Relationship: _________________________');
    }
    L('Photographer: ________________________________________   Description of the photographs or shoot: _______________________________');
    L('I have read this release and understand it. I am signing it freely.');
    L('Signed: _____________________________________________   Date: _______________________');
    L('Witness (optional): ______________________________________   Date: _______________________');
    doc.font('Times-Italic').fontSize(9).text(`A draft form provided by Watermark (${C.base}/clearance) for the maker’s own use; not legal advice; counsel reviews the wording before it is relied on. Keep the signed form with the work’s record on Watermark.`, { paragraphGap: 0 });
    doc.end(); return doc;
  }
  app.get('/release/:kind.pdf', (req, res) => { const kind = req.params.kind === 'property' ? 'property' : req.params.kind === 'model' ? 'person' : null; if (!kind) return res.sendStatus(404); res.set('Content-Type', 'application/pdf'); res.set('Content-Disposition', `inline; filename="Watermark ${kind === 'property' ? 'property' : 'model'} release.pdf"`); res.set('Cache-Control', 'public, max-age=3600'); releasePdf(kind).pipe(res); });

  app.locals.clearance = { needs, blocks, block, releases, COMMERCIAL };
}

module.exports = { mountClearance, COMMERCIAL };
