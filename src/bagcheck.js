// The bag check at the door (Will, 21 Oct: "everything has to pass and clear a test before it can come into the house;
// sniffed and inspected; quickly, but a little TSA; like the New York Public Library or the Met: you are not carrying
// any weapons when you upload something"). Every file that arrives, by any door (the vault, the masters desk, arrivals
// from the bucket, a portrait, the cabinet, a claim's evidence, /verify, bring-it-home, a tour's voice), is looked at
// before anything reads it as a picture:
//   1. What it is, by its first bytes, never by its name or the browser's word: JPEG, PNG, TIFF, WebP for a photograph;
//      WebM, Ogg, MP4/M4A, MP3, WAV for a voice; a zip for a .wmark; a PDF where papers are allowed. Anything else is
//      turned away with its real name (an HTML page, a script, a program, an SVG, a PostScript file).
//   2. Nothing hidden in it: a zip inside a picture (a polyglot), a page or a script in the bytes, an executable's
//      header, or more than a little trailing cargo after a JPEG's end.
//   3. It decodes, whole, and it is a size a photograph can be (no decompression bombs: at most 400 megapixels, no
//      side over 30,000 px); a voice is at most its door's size.
// The verdict is kept (`bagcheck` table: where, who, name, bytes, type, ok, reason) and a refusal is told on the
// register (`upload.refused`, hidden). The person is told in plain words what was wrong, never a stack trace.
// `check(file, { expect, name, where, who, ip })` → { ok, type, ext, mime, reason, bytes }. `gate(expect)` is the
// Express middleware after multer; `throwIfBad` is for the chokepoints inside (images.inspect's callers).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const MAX_PIXELS = Number(process.env.BAGCHECK_MAX_MP || 400) * 1e6;
const MAX_SIDE = Number(process.env.BAGCHECK_MAX_SIDE || 30000);
const TRAIL = 64 * 1024; // bytes allowed after a JPEG's EOI (some cameras and editors leave a little)
const IMAGE = { jpeg: ['.jpg', 'image/jpeg'], png: ['.png', 'image/png'], tiff: ['.tif', 'image/tiff'], webp: ['.webp', 'image/webp'] };
const DNG = ['.dng', 'image/x-adobe-dng'];
const AUDIO = { webm: ['.webm', 'audio/webm'], ogg: ['.ogg', 'audio/ogg'], mp4: ['.m4a', 'audio/mp4'], mp3: ['.mp3', 'audio/mpeg'], wav: ['.wav', 'audio/wav'], flac: ['.flac', 'audio/flac'], aiff: ['.aiff', 'audio/aiff'] };
const EXPECT = { image: Object.keys(IMAGE), audio: Object.keys(AUDIO), archive: ['zip'], papers: ['pdf', ...Object.keys(IMAGE)], proof: ['zip', ...Object.keys(IMAGE)] };

// What a file is, from its first bytes; and what it must never be.
function sniff(head) {
  const h = head, s = h.toString('latin1', 0, Math.min(h.length, 64));
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return 'jpeg';
  if (h.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if ((h[0] === 0x49 && h[1] === 0x49 && h[2] === 0x2a && h[3] === 0) || (h[0] === 0x4d && h[1] === 0x4d && h[2] === 0 && h[3] === 0x2a)) return 'tiff';
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return 'webp';
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WAVE') return 'wav';
  if (s.startsWith('fLaC')) return 'flac';
  if (s.startsWith('FORM') && /^(AIFF|AIFC)$/.test(s.slice(8, 12))) return 'aiff';
  if (h.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm';
  if (s.startsWith('OggS')) return 'ogg';
  if (s.slice(4, 8) === 'ftyp') return /^(heic|heix|hevc|mif1|msf1|avif)/.test(s.slice(8, 12)) ? 'heic' : 'mp4';
  if (s.startsWith('ID3') || (h[0] === 0xff && (h[1] & 0xe6) === 0xe2)) return 'mp3';
  if (s.startsWith('PK\x03\x04') || s.startsWith('PK\x05\x06')) return 'zip';
  if (s.startsWith('%PDF')) return 'pdf';
  if (s.startsWith('MZ') || s.startsWith('\x7fELF') || h.slice(0, 4).equals(Buffer.from([0xcf, 0xfa, 0xed, 0xfe])) || h.slice(0, 4).equals(Buffer.from([0xca, 0xfe, 0xba, 0xbe]))) return 'program';
  if (s.startsWith('%!PS')) return 'postscript';
  if (/^\s*<(\?xml|svg)/i.test(s)) return 'svg';
  if (/^\s*<(!doctype|html|script|body)/i.test(s)) return 'html';
  if (/^#!/.test(s)) return 'script';
  if (s.startsWith('GIF8')) return 'gif';
  if (s.startsWith('BM')) return 'bmp';
  if (s.startsWith('8BPS')) return 'psd';
  if (h.slice(0, 4).equals(Buffer.from([0x1f, 0x8b, 0x08, 0]))) return 'gzip';
  if (s.startsWith('Rar!')) return 'rar';
  if (s.startsWith('\x00\x00\x00\x0cjP')) return 'jp2';
  return 'unknown';
}
const NAMES = { program: 'a program', postscript: 'a PostScript file', svg: 'an SVG', html: 'a web page', script: 'a script', gif: 'a GIF', bmp: 'a bitmap', psd: 'a Photoshop file', gzip: 'a compressed archive', rar: 'an archive', jp2: 'a JPEG 2000', heic: 'a HEIC', zip: 'a zip archive', pdf: 'a PDF', unknown: 'not a kind of file the house recognises', mp4: 'a video or audio file', mp3: 'an MP3', wav: 'a WAV', ogg: 'an Ogg', webm: 'a WebM' };
const say = t => NAMES[t] || `a ${t.toUpperCase()}`;

// The body: nothing hidden. Read in chunks; look for a zip inside, a page or a script, a second program header.
// (A zip's header is matched with its version bytes too, so a run of pixels is never mistaken for one: six bytes, not four.)
const CARGO = [[/PK\x03\x04[\x0a\x14\x2d\x33\x3f]\x00/, 'a zip archive inside it'], [/<script[\s>]/i, 'a script inside it'], [/<\?php/, 'PHP inside it'], [/<!DOCTYPE html/i, 'a web page inside it'], [/<html[\s>]/i, 'a web page inside it'], [/<iframe[\s>]/i, 'an embedded page inside it'], [/javascript:/i, 'a script inside it']];
async function cargo(file, type) {
  return new Promise((resolve) => {
    let carry = '', found = null, size = 0, lastEOI = -1, pos = 0;
    const st = fs.createReadStream(file, { highWaterMark: 1 << 20 });
    st.on('data', d => {
      size += d.length;
      const s = carry + d.toString('latin1'); // latin1: one byte, one char; the search is byte-exact
      for (const [re, why] of CARGO) { if (!found && !(type === 'zip' && /zip/.test(why)) && re.test(s)) found = why; } // a zip is a zip
      if (type === 'jpeg') { const i = s.lastIndexOf('\xff\xd9'); if (i >= 0) lastEOI = pos - carry.length + i; }
      pos += d.length; carry = s.slice(-16);
    });
    st.on('end', () => {
      const trailing = type === 'jpeg' && lastEOI >= 0 && size - lastEOI - 2 > TRAIL ? Math.round((size - lastEOI) / 1024) : 0;
      resolve({ found, size, trailing });
    });
    st.on('error', () => resolve({ found: 'it could not be read', size }));
  });
}

async function check(file, { expect = 'image', name = '', where = '', who = '', ip = '' } = {}, db = null, ledger = null) {
  const allowed = EXPECT[expect] || EXPECT.image;
  let bytes = 0; try { bytes = fs.statSync(file).size; } catch (e) { return verdict(false, 'unknown', 'The file did not arrive.'); }
  if (!bytes) return verdict(false, 'unknown', 'The file is empty.');
  const fd = fs.openSync(file, 'r'); const head = Buffer.alloc(64); const n = fs.readSync(fd, head, 0, 64, 0); fs.closeSync(fd);
  const type = sniff(head.slice(0, n));
  if (!allowed.includes(type)) {
    const want = expect === 'audio' ? 'a recording (WAV, FLAC, AIFF, MP3, M4A, Ogg or WebM)' : expect === 'archive' ? 'a .wmark archival master' : expect === 'papers' ? 'a photograph or a PDF' : expect === 'proof' ? 'a photograph or a .wmark' : 'a photograph (JPEG, PNG, TIFF or WebP)';
    const why = type === 'heic' ? 'This is a HEIC. Export it as a JPEG or a TIFF and bring that.' : `This is ${say(type)}, not ${want}.`;
    return verdict(false, type, why);
  }
  // A DNG (26 Oct, the raw door): a TIFF whose main image is the sensor's data. The house reads the preview inside
  // (src/raw.js), never the raw data; one without a full-size preview is turned away with the way to make one.
  if (type === 'tiff' && expect === 'image') { const raw = require('./raw'); if (raw.isDng(file)) { const u = raw.unwrap(file, { min: 1600, to: `${file}.preview.jpg` }); if (!u.jpeg) return verdict(false, 'dng', raw.NO_PREVIEW); try { await sharp(u.jpeg, { failOn: 'error', limitInputPixels: MAX_PIXELS }).resize(96, 96, { fit: 'inside' }).raw().toBuffer(); } catch (e) { return verdict(false, 'dng', 'The preview inside the DNG does not decode whole.'); } return verdict(true, 'dng', null); } }
  const c = await cargo(file, type);
  if (c.found) return verdict(false, type, `The file carries ${c.found}. The house takes the picture alone.`);
  if (IMAGE[type]) {
    let meta; try { meta = await sharp(file, { failOn: 'error', limitInputPixels: MAX_PIXELS }).metadata(); } catch (e) { return verdict(false, type, 'The picture does not open as a picture.'); }
    const w = meta.width || 0, h = meta.height || 0;
    if (!w || !h) return verdict(false, type, 'The picture has no size.');
    if (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_PIXELS) return verdict(false, type, `The picture is ${w.toLocaleString('en-US')} × ${h.toLocaleString('en-US')} px, larger than the house takes (${Math.round(MAX_PIXELS / 1e6)} megapixels).`);
    // A whole decode, small: a truncated or corrupt file fails here, not on a visitor's wall later.
    try { await sharp(file, { failOn: 'error', limitInputPixels: MAX_PIXELS }).rotate().resize(96, 96, { fit: 'inside' }).raw().toBuffer(); } catch (e) { return verdict(false, type, 'The picture is damaged or cut short; it does not decode whole.'); }
    // Whole and sound, yet with a long tail after the picture's end: cargo, not a photograph.
    if (c.trailing) return verdict(false, type, `The file carries ${c.trailing} KB appended after the end of the picture. The house takes the picture alone.`);
  }
  return verdict(true, type, null);
  function verdict(ok, t, reason) {
    const ext = (IMAGE[t] || AUDIO[t] || (t === 'dng' ? DNG : null) || { zip: ['.zip', 'application/zip'], pdf: ['.pdf', 'application/pdf'] }[t] || ['', 'application/octet-stream'])[0];
    const mime = (IMAGE[t] || AUDIO[t] || (t === 'dng' ? DNG : null) || { zip: ['.zip', 'application/zip'], pdf: ['.pdf', 'application/pdf'] }[t] || ['', 'application/octet-stream'])[1];
    if (db) { try { db.prepare('INSERT INTO bagcheck (where_, who, ip, name, bytes, type, ok, reason) VALUES (?,?,?,?,?,?,?,?)').run(String(where).slice(0, 80), String(who).slice(0, 120), String(ip).slice(0, 64), String(name).slice(0, 200), bytes, t, ok ? 1 : 0, reason); } catch (e) { /* */ } }
    if (!ok && ledger && db) { try { ledger.append(db, 'upload.refused', String(where).slice(0, 80) || 'door', { type: t, reason, who: String(who).slice(0, 120) || undefined }); } catch (e) { /* */ } }
    return { ok, type: t, ext, mime, reason, bytes };
  }
}

function mountBagcheck(app, { db, V, ledger, studioOnly, makerOf, buyerOf }) {
  db.exec("CREATE TABLE IF NOT EXISTS bagcheck (id INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now')), where_ TEXT, who TEXT, ip TEXT, name TEXT, bytes INTEGER, type TEXT, ok INTEGER NOT NULL, reason TEXT)");
  const whoOf = req => { try { const m = makerOf && makerOf(req); if (m) return `m:${m.handle}`; const b = buyerOf && buyerOf(req); if (b) return `b:${b.code || b.id}`; } catch (e) { /* */ } return ''; };
  const ipOf = req => (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
  const run = (file, opts, req) => check(file, { ...opts, who: opts.who || whoOf(req), ip: ipOf(req), where: opts.where || (req.baseUrl + req.path) }, db, ledger);
  // The middleware after multer: the file in req.file (or each in req.files) is checked; a refusal unlinks it and answers.
  const gate = (expect, { field = 'file', json = false } = {}) => async (req, res, next) => {
    const files = req.files ? [].concat(...Object.values(req.files)) : req.file ? [req.file] : [];
    for (const f of files) {
      const v = await run(f.path, { expect, name: f.originalname }, req);
      if (!v.ok) {
        for (const g of files) { try { fs.unlinkSync(g.path); } catch (e) { /* */ } }
        if (json || /application\/json/.test(req.headers.accept || '')) return res.status(415).json({ error: v.reason, refused: true });
        return res.status(415).send(V.layout({ title: 'Turned away at the door · Watermark', body: `<section class="narrow bgc"><p class="k">The door</p><h1>That file cannot come in.</h1><p class="lede">${V.esc(v.reason)}</p><p class="note">Every file is looked at before it enters the house: what it is, by its own bytes; that nothing is hidden in it; that it opens whole. Bring the photograph itself and it will be welcome.</p><p><a href="javascript:history.back()">Back</a></p></section>` }));
      }
      f.bagcheck = v;
    }
    next();
  };
  // For the chokepoints inside (takeMaster, takeWork, replaceMaster): throws a user-facing error.
  const throwIfBad = async (file, opts = {}) => { const v = await check(file, { expect: 'image', ...opts }, db, ledger); if (!v.ok) { const e = new Error(v.reason); e.user = true; e.refused = true; throw e; } return v; };
  // Studio → Back office → The door: what was turned away, and who keeps bringing the wrong thing.
  app.get('/studio/bagcheck', studioOnly, (req, res) => {
    const rows = db.prepare('SELECT * FROM bagcheck WHERE ok=0 ORDER BY id DESC LIMIT 200').all();
    const n = db.prepare("SELECT COUNT(*) n, SUM(ok) ok FROM bagcheck WHERE at > datetime('now','-7 days')").get();
    const repeat = db.prepare("SELECT who, COUNT(*) n FROM bagcheck WHERE ok=0 AND who!='' AND at > datetime('now','-1 day') GROUP BY who HAVING COUNT(*)>=5 ORDER BY COUNT(*) DESC").all();
    res.send(V.layout({ title: 'The door · Watermark', path: '/studio/bagcheck', studio: true, body: `<section class="studio-wrap bgc"><p class="k">Back office</p><h1>The door.</h1>
<p class="lede">Every file is looked at before it enters: what it is by its own bytes, that nothing is hidden in it, that it opens whole and is a size a photograph can be. This week: ${(n.n || 0).toLocaleString('en-US')} looked at, ${(n.ok || 0).toLocaleString('en-US')} let in, ${((n.n || 0) - (n.ok || 0)).toLocaleString('en-US')} turned away.</p>
${repeat.length ? `<h2>Kept bringing the wrong thing today</h2><ul>${repeat.map(r => `<li><b>${V.esc(r.who)}</b> · ${r.n} refusals</li>`).join('')}</ul>` : ''}
<h2>Turned away</h2>${rows.length ? `<table class="tbl"><tr><th>When</th><th>Door</th><th>Who</th><th>File</th><th>Size</th><th>It was</th><th>Why</th></tr>${rows.map(r => `<tr><td>${V.esc(r.at)}</td><td>${V.esc(r.where_ || '')}</td><td>${V.esc(r.who || r.ip || '')}</td><td>${V.esc(r.name || '')}</td><td>${Math.round((r.bytes || 0) / 1024).toLocaleString('en-US')} KB</td><td>${V.esc(r.type)}</td><td>${V.esc(r.reason || '')}</td></tr>`).join('')}</table>` : '<p>Nothing has been turned away.</p>'}</section>` }));
  });
  app.locals.bagcheck = { check: (file, opts) => check(file, opts, db, ledger), gate, throwIfBad, sniff };
  return app.locals.bagcheck;
}
module.exports = { mountBagcheck, check, sniff, EXPECT };
