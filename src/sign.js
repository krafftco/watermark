// Signed on the spot (Will, 26 Oct: "the legal way a photographer can open Watermark on their phone and get someone to
// sign a release immediately with a little gesture, a sign of the finger"). The maker opens the release on the phone
// and hands it over: the subject reads it, gives a name (and, for a child, the guardian's), agrees to sign
// electronically, and signs with a finger. The house makes the record the law asks for (E-SIGN and UETA: intent to
// sign, consent to an electronic record, a copy to the signer, a record kept): a one-page PDF with the release text,
// the name, the date and place, the signature as drawn, the maker, the work when there is one, and an audit line (the
// moment in UTC, the address, the device, the record's own fingerprint), kept in the vault under `releases/` beside
// the uploaded forms, on `work_releases` so the clearance desk opens the commercial uses at once; a signed link to
// their copy goes to the subject when they give an address. A release signed before the photograph is uploaded waits
// (work_id 0) and is attached from the work's record. Counsel reads the wording before it is relied on.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TEXT = {
  person: [
    'I grant the Photographer named below, and anyone the Photographer licenses through Watermark, the irrevocable right to use photographs of me taken on the date below, in whole or in part, with or without my name, in any medium now known or later devised, for any purpose including advertising and trade.',
    'I waive any claim arising from the use of the photographs, including claims of invasion of privacy, right of publicity, defamation or blurring and alteration, except that the photographs will not be used in a way that is defamatory of me.',
    'I am eighteen or over, or the parent or guardian named below signs for me.',
  ],
  property: [
    'I own or control the property described below, or am authorised by its owner to sign this release.',
    'I grant the Photographer named below, and anyone the Photographer licenses through Watermark, the irrevocable right to use photographs of the property, in whole or in part, in any medium now known or later devised, for any purpose including advertising and trade.',
    'I waive any claim arising from the use of the photographs, including claims of invasion of privacy, defamation or infringement of any right in the property or in any mark, design or work shown on it that I own or control.',
  ],
};
const CONSENT = 'I agree to sign this release electronically and to receive my copy electronically; I have read it and I am signing it freely.';

function mountSign(app, { db, V, C, store, ledger, mail, makerOf, isStudio }) {
  const dir = path.join(C.dataDir, 'releases'); fs.mkdirSync(dir, { recursive: true });
  for (const [c, t] of [['maker_id', 'INTEGER'], ['token', 'TEXT'], ['email', 'TEXT'], ['sha256', 'TEXT'], ['place', 'TEXT']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('work_releases') WHERE name=?").get(c)) db.exec(`ALTER TABLE work_releases ADD COLUMN ${c} ${t}`);
  const HOUSE = process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com';
  const workOf = (m, slug) => (slug ? db.prepare("SELECT * FROM works WHERE slug=? AND maker_id=? AND status IN ('held','hidden','restoring')").get(String(slug), m.id) : null);

  // The page the maker hands over.
  app.get('/account/release/sign', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=' + encodeURIComponent(req.originalUrl));
    const w = workOf(m, req.query.work); const kind = req.query.kind === 'property' ? 'property' : 'person';
    const I = require('./icons'); const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    res.set('Cache-Control', 'private, no-store').send(V.layout({ title: 'Sign a release · Watermark', bare: true, path: '/account/release/sign', body: `<main class="sg" data-sign>
<header class="sg-top"><a class="sg-back" href="${w ? `/account/works/${esc(w.slug)}#clearance` : '/account'}">${I.back}<span>Back</span></a><p class="k">Watermark · ${kind === 'property' ? 'Property release' : 'Model release'}</p><div class="sg-sw"><a href="?${w ? `work=${esc(w.slug)}&` : ''}kind=person"${kind === 'person' ? ' aria-current="true"' : ''}>A person</a><a href="?${w ? `work=${esc(w.slug)}&` : ''}kind=property"${kind === 'property' ? ' aria-current="true"' : ''}>Property</a></div></header>
<form method="post" action="/account/release/sign" class="sg-f" data-sg-form><input type="hidden" name="kind" value="${kind}">${w ? `<input type="hidden" name="work" value="${esc(w.slug)}">` : ''}<input type="hidden" name="sig" data-sg-sig>
<section class="sg-who">${w ? `<img class="sg-th" src="/img/${esc(w.slug)}/thumb" alt="">` : ''}<div><h1>${kind === 'property' ? 'A release for the property.' : 'A release for the photographs.'}</h1><p class="sg-ph">Photographer: <b>${esc(m.name)}</b>${w ? ` · ${esc(V.tidy(w.title))}` : ''} · ${esc(today)}</p></div></section>
<section class="sg-text">${TEXT[kind].map(p => `<p>${esc(p)}</p>`).join('')}</section>
<section class="sg-fields">
<label><span>${kind === 'property' ? 'Your name' : 'Your name'}</span><input name="subject" required maxlength="160" autocomplete="name" autocapitalize="words"></label>
${kind === 'property' ? '<label><span>The property (what and where)</span><input name="place" required maxlength="200"></label>' : '<label class="sg-ck"><input type="checkbox" name="minor" value="1" data-sg-minor><span>The person photographed is under eighteen; I am their parent or guardian</span></label><label data-sg-guardian hidden><span>The child’s name</span><input name="child" maxlength="160"></label>'}
<label><span>Email, for your copy (optional)</span><input name="email" type="email" maxlength="160" autocomplete="email" inputmode="email"></label>
<label class="sg-ck"><input type="checkbox" name="agree" value="1" required><span>${esc(CONSENT)}</span></label>
</section>
<section class="sg-pad"><p class="k">Sign here, with your finger</p><div class="sg-canvas"><canvas data-sg-canvas width="900" height="300"></canvas><span class="sg-line"></span></div><p class="sg-padacts"><button type="button" data-sg-clear>Clear</button><span class="sg-hint" data-sg-hint>Draw your signature above.</span></p></section>
<button type="submit" class="buy-btn sg-go" data-sg-go disabled>Sign the release</button>
<p class="sg-fine">On signing, the house keeps this page as a signed record with the date, the time and the device, with the photographer’s work; a copy goes to the address above. <a href="/clearance">What a release is for</a>. The wording is the house’s draft form; not legal advice.</p>
</form></main><script src="/static/sign.js?v=${esc(V.VER)}" defer></script>` }));
  });

  app.post('/account/release/sign', async (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const x = req.body || {}; const kind = x.kind === 'property' ? 'property' : 'person';
    const w = workOf(m, x.work); const subject = String(x.subject || '').trim().slice(0, 160); const email = String(x.email || '').trim().toLowerCase().slice(0, 160);
    const minor = kind === 'person' && x.minor === '1'; const child = String(x.child || '').trim().slice(0, 160); const place = String(x.place || '').trim().slice(0, 200);
    const sig = String(x.sig || ''); const m64 = sig.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!subject || x.agree !== '1' || !m64 || (minor && !child) || (kind === 'property' && !place)) return res.status(400).send(V.sign ? V.sign(400) : 'The release needs a name, the agreement and a signature.');
    const png = Buffer.from(m64[1], 'base64'); if (png.length < 200 || png.length > 600000 || png.slice(1, 4).toString() !== 'PNG') return res.sendStatus(400);
    const now = new Date(); const stamp = now.toISOString(); const ip = req.ip || ''; const ua = String(req.get('user-agent') || '').slice(0, 200);
    const id = db.prepare('INSERT INTO work_releases (work_id, maker_id, kind, subject, signed_on, minor, by, email, place) VALUES (?,?,?,?,?,?,?,?,?)').run(w ? w.id : 0, m.id, kind, minor && child ? `${child} (signed by ${subject}, parent or guardian)` : subject, stamp.slice(0, 10), minor ? 1 : 0, 'signed on the house', email || null, place || null).lastInsertRowid;
    // The record: one page, the text, the particulars, the signature as drawn, the audit line.
    const PDFDocument = require('pdfkit'); const doc = new PDFDocument({ size: 'LETTER', margins: { top: 64, bottom: 64, left: 72, right: 72 } });
    const chunks = []; doc.on('data', c => chunks.push(c)); const done = new Promise(r => doc.on('end', r));
    const L = (t, o = {}) => doc.font('Times-Roman').fontSize(11).text(t, { paragraphGap: 8, lineGap: 2, ...o });
    doc.font('Times-Bold').fontSize(20).text(kind === 'property' ? 'Property Release' : 'Model Release', { paragraphGap: 4 });
    doc.font('Times-Italic').fontSize(10).text(`Signed electronically on Watermark · a Krafft company · release No. ${id}`, { paragraphGap: 16 });
    TEXT[kind].forEach(p => L(p));
    L(`Photographer: ${m.name}${w ? `   ·   Photographs: ${V.tidy(w.title)}${w.accession ? ` (${w.accession})` : ''}` : '   ·   Photographs: of this date, to be attached'}`);
    L(kind === 'property' ? `Property: ${place}` : (minor ? `Person photographed: ${child} (under eighteen)   ·   Parent or guardian: ${subject}` : `Name: ${subject}`));
    if (email) L(`Email: ${email}`);
    L(`Date: ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`);
    L(CONSENT);
    doc.moveDown(0.5); const y = doc.y; try { doc.image(png, 72, y, { fit: [300, 100] }); } catch (e) { /* the signature failed to draw; the record still stands */ }
    doc.moveTo(72, y + 104).lineTo(372, y + 104).stroke(); doc.y = y + 110; L(`Signed: ${subject}`);
    doc.moveDown(1); doc.font('Times-Italic').fontSize(8).text(`Record of signing: ${stamp} UTC · from ${ip} · ${ua} · kept by Watermark (${C.base}) under release No. ${id} with the photographer’s record${w ? ` of ${V.tidy(w.title)}` : ''}. The signer agreed to sign electronically and to receive this copy electronically. The wording is the house’s draft form and not legal advice.`);
    doc.end(); await done; const buf = Buffer.concat(chunks); const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const name = `sig-${id}-${sha.slice(0, 10)}.pdf`; fs.writeFileSync(path.join(dir, name), buf);
    try { if (store && store.put) await store.put('releases/' + name, buf, 'application/pdf'); } catch (e) { console.error('[sign] vault', e.message); }
    const token = crypto.randomBytes(16).toString('base64url');
    db.prepare('UPDATE work_releases SET file=?, mime=?, sha256=?, token=? WHERE id=?').run(name, 'application/pdf', sha, token, id);
    try { ledger.append(db, 'release.signed', w ? w.slug : `maker:${m.handle}`, { kind, minor, id, sha256: sha }); } catch (e) { /* */ }
    if (email) mail.send({ to: email, subject: `Your copy of the release you signed for ${m.name}`, text: `Thank you. This is your copy of the ${kind === 'property' ? 'property' : 'model'} release you signed today for ${m.name}${w ? ` (${V.tidy(w.title)})` : ''} on Watermark:\n\n${C.base}/release/r/${token}\n\nThe record carries the date, the time and your signature as you drew it; its fingerprint is ${sha}. Keep this letter.\n\nWatermark, a Krafft company.` });
    res.redirect(w ? `/account/works/${w.slug}?ok=signed#clearance` : `/account/release/sign?done=${id}`);
  });

  // The signer's own copy, by the link in their letter.
  app.get('/release/r/:token', async (req, res) => {
    const x = db.prepare('SELECT * FROM work_releases WHERE token=? AND file IS NOT NULL').get(String(req.params.token)); if (!x) return res.sendStatus(404);
    const p = path.join(dir, path.basename(x.file)); if (!fs.existsSync(p) && store && store.get) { try { await store.get('releases/' + x.file, p); } catch (e) { return res.sendStatus(404); } }
    res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="release-${x.id}.pdf"` }); res.sendFile(p);
  });

  // A release signed before the photograph came in: attached from the work's record.
  app.post('/account/works/:slug/clearance/attach', (req, res) => {
    const m = makerOf(req); const w = m && workOf(m, req.params.slug); if (!w) return res.sendStatus(403);
    const x = db.prepare('SELECT * FROM work_releases WHERE id=? AND maker_id=? AND work_id=0').get(+(req.body || {}).id, m.id); if (!x) return res.redirect(`/account/works/${w.slug}#clearance`);
    db.prepare('UPDATE work_releases SET work_id=? WHERE id=?').run(w.id, x.id);
    try { ledger.append(db, 'release.kept', w.slug, { kind: x.kind, minor: !!x.minor, file: !!x.file, signed: true }); } catch (e) { /* */ }
    res.redirect(`/account/works/${w.slug}?ok=release#clearance`);
  });
  const pending = m => db.prepare('SELECT * FROM work_releases WHERE maker_id=? AND work_id=0 ORDER BY id DESC LIMIT 40').all(m.id);
  // The door on the work's record and in the vault.
  app.locals.signRelease = {
    block(w, m) {
      if (!m) return '';
      const waiting = pending(m);
      return `<div class="sg-door"><a class="buy-btn" href="/account/release/sign?work=${esc(w.slug)}">Sign a release now, on this phone</a><span>Hand the phone over: they read it, sign with a finger, and the uses open at once.</span>${waiting.length ? `<form method="post" action="/account/works/${esc(w.slug)}/clearance/attach" class="sg-attach"><label>Signed on the spot, not yet attached<select name="id">${waiting.map(x => `<option value="${x.id}">${esc(x.subject)} · ${x.kind === 'property' ? 'property' : 'model'} · ${esc(x.signed_on || '')}</option>`).join('')}</select></label><button>Attach to this work</button></form>` : ''}</div>`;
    },
    line: () => `<p class="sg-vt">Photographing people or a place that will be licensed? <a href="/account/release/sign">Get the release signed on this phone</a>, before or after the upload.</p>`,
    pending, TEXT,
  };
}
module.exports = { mountSign, TEXT, CONSENT };
