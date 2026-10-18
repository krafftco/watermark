// The mark. Policy of the house (Will, 17 Oct 2026): every image that leaves the house carries its maker, its
// copyright, its license and the way back to the register, in three layers, always, with no switch:
//   1. In the open: XMP (IPTC Core and Extension, Dublin Core, xmpRights, PLUS) naming the creator, the copyright
//      holder, the credit, the licensor, the web statement of rights (the license page) and the registry id, so
//      search engines show the work as licensable and point to the house; the EXIF stamp of provenance.js stays.
//   2. Sealed: Content Credentials (credentials.js), when the house has its certificate.
//   3. Within the picture: an invisible mark, unique to each delivery, so a copy found anywhere traces back to the
//      license, the person it was delivered to, and the day. The mark is a pattern of tiny brightness shifts on
//      8×8 blocks, placed by a key only the house holds, repeated hundreds of times across the picture, and read
//      back by correlation. It survives recompression and screenshots at the same size; it does not survive a
//      heavy resize or crop (that is what the fingerprint, the dhash and the register are for).
// Share-size copies (the ones made to be passed around) also carry a quiet visible credit in the corner.
const crypto = require('crypto');
const sharp = require('sharp');

const BITS = 40;                 // 32 bits of payload + 8 of check
const DELTA = 3;                 // the shift, in 8-bit levels: below what the eye sees on a photograph

function rng(seed) { let x = seed.readUInt32LE(0) || 1, y = seed.readUInt32LE(4) || 2, z = seed.readUInt32LE(8) || 3, w = seed.readUInt32LE(12) || 4; return () => { const t = x ^ (x << 11); x = y; y = z; z = w; w = (w ^ (w >>> 19)) ^ (t ^ (t >>> 8)); return (w >>> 0) / 4294967296; }; }
const seedOf = key => crypto.createHmac('sha256', String(key)).update('watermark-mark-v1').digest();
const check = p => ((p ^ (p >>> 8) ^ (p >>> 16) ^ (p >>> 24)) & 0xff);
const toBits = payload => { const c = check(payload >>> 0); const bits = []; for (let i = 31; i >= 0; i--) bits.push((payload >>> i) & 1); for (let i = 7; i >= 0; i--) bits.push((c >>> i) & 1); return bits; };

// Which blocks carry which bit: a fixed shuffle of the block grid by the key, the same at embed and at read.
function layout(bw, bh, key) {
  const n = bw * bh, r = rng(seedOf(key)), idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i;
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
  const per = Math.floor(n / BITS), map = []; for (let b = 0; b < BITS; b++) map.push(idx.subarray(b * per, (b + 1) * per));
  return map;
}

// Embed: returns the marked image as a buffer in the given format (jpeg at 92, png lossless).
async function embed(input, payload, key, { format = 'jpeg', quality = 92 } = {}) {
  const { data, info } = await sharp(input).rotate().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info; const bw = Math.floor(W / 8), bh = Math.floor(H / 8);
  if (bw * bh < BITS * 8) return sharp(input).rotate().toFormat(format, { quality }).toBuffer();  // too small to carry a mark
  const map = layout(bw, bh, key), bits = toBits(payload);
  for (let b = 0; b < BITS; b++) { const s = bits[b] ? DELTA : -DELTA; const blocks = map[b];
    for (let k = 0; k < blocks.length; k++) { const bx = blocks[k] % bw, by = Math.floor(blocks[k] / bw);
      for (let y = by * 8; y < by * 8 + 8; y++) { let p = (y * W + bx * 8) * C; for (let x = 0; x < 8; x++, p += C) { for (let c = 0; c < Math.min(3, C); c++) { const v = data[p + c] + s; data[p + c] = v < 0 ? 0 : v > 255 ? 255 : v; } } } } }
  const out = sharp(data, { raw: { width: W, height: H, channels: C } });
  return format === 'png' ? out.png().toBuffer() : format === 'tiff' ? out.tiff({ compression: 'lzw' }).toBuffer() : out.jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
}

// Read: the payload and how surely it was read (the mean agreement of the repeated blocks), or null.
async function read(input, key) {
  const { data, info } = await sharp(input).rotate().greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info; const bw = Math.floor(W / 8), bh = Math.floor(H / 8);
  if (bw * bh < BITS * 8) return null;
  // Block means, then each block less the mean of its neighbours: the picture falls away, the shifts stay.
  const m = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) { let s = 0; for (let y = by * 8; y < by * 8 + 8; y++) { let p = y * W + bx * 8; for (let x = 0; x < 8; x++, p++) s += data[p]; } m[by * bw + bx] = s / 64; }
  const d = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) { let s = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const x = bx + dx, y = by + dy; if (x < 0 || y < 0 || x >= bw || y >= bh) continue; s += m[y * bw + x]; n++; } d[by * bw + bx] = m[by * bw + bx] - s / n; }
  const map = layout(bw, bh, key); let payload = 0, c = 0, strength = 0;
  for (let b = 0; b < BITS; b++) { let sum = 0; const blocks = map[b]; for (let k = 0; k < blocks.length; k++) sum += d[blocks[k]]; const bit = sum > 0 ? 1 : 0; strength += Math.abs(sum / blocks.length) / DELTA; if (b < 32) payload = (payload << 1) | bit; else c = (c << 1) | bit; }
  payload = payload >>> 0; const sure = strength / BITS;
  if (check(payload) !== c) return { payload: null, sure, ok: false };
  return { payload, sure, ok: sure > 0.25 };
}

// The open layer: an XMP packet the way IPTC and PLUS write it, so the file says who made it, who holds the rights,
// where it is licensed and where its record is, to any reader (Photoshop, Lightroom, Google Images, the OS).
function xmp({ title, maker, year, credit, copyright, licensor, statement, registry, accession, ref, licensee, use, ends, noAI, caption = null, number = null }) {
  const e = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Watermark"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:plus="http://ns.useplus.org/ldf/xmp/1.0/" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/" xmlns:wm="https://watermark.krafftco.com/ns/1.0/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${e(title)}</rdf:li></rdf:Alt></dc:title>${caption ? `\n<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${e(caption)}</rdf:li></rdf:Alt></dc:description>` : ''}
<dc:creator><rdf:Seq><rdf:li>${e(maker)}</rdf:li></rdf:Seq></dc:creator>
<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${e(copyright)}</rdf:li></rdf:Alt></dc:rights>
<xmpRights:Marked>True</xmpRights:Marked>
<xmpRights:WebStatement>${e(statement)}</xmpRights:WebStatement>
<xmpRights:UsageTerms><rdf:Alt><rdf:li xml:lang="x-default">${e(licensee ? `Licensed to ${licensee}: ${use}${ends ? `, until ${String(ends).slice(0, 10)}` : ''}. Watermark ${ref}. Not for AI training.` : `Held and licensed at the source on Watermark.${noAI ? ' Not for AI training.' : ''}`)}</rdf:li></rdf:Alt></xmpRights:UsageTerms>
<photoshop:Credit>${e(credit)}</photoshop:Credit>
<photoshop:Source>Watermark</photoshop:Source>
<plus:Licensor><rdf:Seq><rdf:li rdf:parseType="Resource"><plus:LicensorName>Watermark, a Krafft company</plus:LicensorName><plus:LicensorURL>${e(licensor)}</plus:LicensorURL></rdf:li></rdf:Seq></plus:Licensor>
<plus:CopyrightOwner><rdf:Seq><rdf:li rdf:parseType="Resource"><plus:CopyrightOwnerName>${e(maker)}</plus:CopyrightOwnerName></rdf:li></rdf:Seq></plus:CopyrightOwner>
<plus:ImageSupplierImageID>${e(accession)}</plus:ImageSupplierImageID>
<Iptc4xmpExt:RegistryId><rdf:Bag><rdf:li rdf:parseType="Resource"><Iptc4xmpExt:RegOrgId>watermark.krafftco.com</Iptc4xmpExt:RegOrgId><Iptc4xmpExt:RegItemId>${e(ref || accession)}</Iptc4xmpExt:RegItemId></rdf:li></rdf:Bag></Iptc4xmpExt:RegistryId>
<Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture</Iptc4xmpExt:DigitalSourceType>
<Iptc4xmpCore:CreatorContactInfo rdf:parseType="Resource"><Iptc4xmpCore:CiUrlWork>${e(licensor)}</Iptc4xmpCore:CiUrlWork></Iptc4xmpCore:CreatorContactInfo>
<wm:accession>${e(accession)}</wm:accession>${ref ? `<wm:license>${e(ref)}</wm:license>` : ''}${number ? `<wm:number>${e(number)}</wm:number>` : ''}${year ? `<wm:year>${e(year)}</wm:year>` : ''}<wm:register>${e(statement)}</wm:register>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;
}
// Put the XMP packet into a JPEG as an APP1 segment, after any EXIF, pixels untouched.
function withXmp(jpeg, packet) {
  if (!(jpeg[0] === 0xff && jpeg[1] === 0xd8)) return jpeg;
  const body = Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from(packet, 'utf8')]);
  if (body.length + 2 > 65533) return jpeg;
  const seg = Buffer.concat([Buffer.from([0xff, 0xe1, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff]), body]);
  let p = 2; // walk past APP0/APP1 so the XMP sits with the other headers
  while (p + 4 < jpeg.length && jpeg[p] === 0xff && (jpeg[p + 1] === 0xe0 || jpeg[p + 1] === 0xe1)) { const len = jpeg.readUInt16BE(p + 2); const isXmp = jpeg[p + 1] === 0xe1 && jpeg.slice(p + 4, p + 33).toString('latin1').startsWith('http://ns.adobe.com/xap/1.0/'); if (isXmp) { return Buffer.concat([jpeg.slice(0, p), seg, jpeg.slice(p + 2 + len)]); } p += 2 + len; }
  return Buffer.concat([jpeg.slice(0, p), seg, jpeg.slice(p)]);
}
function readXmp(buf) {
  const s = buf.toString('latin1'); const i = s.indexOf('<x:xmpmeta'); if (i < 0) return null; const j = s.indexOf('</x:xmpmeta>', i); if (j < 0) return null;
  const x = Buffer.from(s.slice(i, j + 12), 'latin1').toString('utf8'); const get = t => { const m = x.match(new RegExp(`<${t}>([^<]*)</${t}>`)); return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&quot;/g, '"') : null; };
  return { license: get('wm:license'), accession: get('wm:accession'), register: get('wm:register'), creator: (x.match(/<dc:creator>[\s\S]*?<rdf:li>([^<]*)<\/rdf:li>/) || [])[1] || null };
}

// The visible credit on a share-size copy: a hairline strip, bottom right, the maker and the address.
async function credit(input, { maker, url }) {
  const meta = await sharp(input).metadata(); const W = meta.width || 1600, fs = Math.max(11, Math.round(W / 110)), pad = Math.round(fs * 0.8);
  const text = `© ${maker} · ${url}`.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${fs * 2 + pad}"><text x="${W - pad}" y="${fs + pad / 2}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="${fs}" fill="#fff" fill-opacity=".72" stroke="#000" stroke-opacity=".35" stroke-width=".6" paint-order="stroke">${text}</text></svg>`);
  return sharp(input).composite([{ input: svg, gravity: 'south' }]).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

module.exports = { embed, read, xmp, withXmp, readXmp, credit, BITS, DELTA };
