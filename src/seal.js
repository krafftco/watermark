// The Watermark sealed image (.wmk). Designed independently from public standards:
// AES-256-GCM (NIST SP 800-38D), envelope encryption, and the browser's Web Crypto API.
//
// A sealed file can travel anywhere (email, Dropbox, a USB stick) and still belongs to its maker.
// The photograph inside is encrypted. The outside carries who made it, its terms and a small preview.
// It opens only in a Watermark viewer, which asks Watermark for the key every time; the maker can
// see each opening and can close the file at any moment by revoking the seal.
//
// Layout (all integers big-endian):
//   "WMK1"                      4 bytes, magic and version
//   header length               uint32
//   header                      UTF-8 JSON, public: maker, title, credit, terms, seal id, access code
//   preview length              uint32
//   preview                     JPEG, at most 600 px, unencrypted
//   iv                          12 bytes
//   ciphertext + GCM tag        the image, encrypted with a key that never leaves Watermark unwrapped.
//                               The header is bound as additional data, so altering it breaks the seal.
const crypto = require('crypto');

const MAGIC = Buffer.from('WMK1');

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }

function seal({ image, preview, header }) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const head = Buffer.from(JSON.stringify(header), 'utf8');
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(head);
  const body = Buffer.concat([c.update(image), c.final(), c.getAuthTag()]);
  return { key, file: Buffer.concat([MAGIC, u32(head.length), head, u32(preview.length), preview, iv, body]) };
}

function parse(file) {
  if (!file.slice(0, 4).equals(MAGIC)) throw new Error('Not a Watermark sealed file');
  let o = 4;
  const hl = file.readUInt32BE(o); o += 4;
  const head = file.slice(o, o + hl); o += hl;
  const pl = file.readUInt32BE(o); o += 4;
  const preview = file.slice(o, o + pl); o += pl;
  const iv = file.slice(o, o + 12); o += 12;
  return { header: JSON.parse(head.toString('utf8')), headBytes: head, preview, iv, body: file.slice(o) };
}

function open(file, key) {
  const p = parse(file);
  const d = crypto.createDecipheriv('aes-256-gcm', key, p.iv);
  d.setAAD(p.headBytes);
  d.setAuthTag(p.body.slice(-16));
  return Buffer.concat([d.update(p.body.slice(0, -16)), d.final()]);
}

// Data keys are stored wrapped under a key-encryption key derived from the server secret.
const kek = secret => crypto.createHash('sha256').update('watermark-kek:' + (process.env.WATERMARK_KEK || secret)).digest();
function wrap(key, secret) {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', kek(secret), iv);
  return Buffer.concat([iv, c.update(key), c.final(), c.getAuthTag()]).toString('base64');
}
function unwrap(b64, secret) {
  const b = Buffer.from(b64, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', kek(secret), b.slice(0, 12));
  d.setAuthTag(b.slice(-16)); return Buffer.concat([d.update(b.slice(12, -16)), d.final()]);
}

module.exports = { seal, parse, open, wrap, unwrap };
