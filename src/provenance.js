// Provenance: the delivered file carries its license. For JPEGs the EXIF is rewritten without
// re-encoding the image (pixels untouched). Other formats are delivered as-is with the certificate.
const fs = require('fs');
const piexif = require('piexifjs');
const PDFDocument = require('pdfkit');

function stampJpeg(file, { ref, maker, licensee, use, ends, fingerprint, base }) {
  const bin = fs.readFileSync(file).toString('binary');
  let exif;
  try { exif = piexif.load(bin); } catch (e) { exif = { '0th': {}, Exif: {}, GPS: {}, '1st': {}, thumbnail: null }; }
  exif['0th'] = exif['0th'] || {};
  exif['0th'][piexif.ImageIFD.Artist] = maker;
  exif['0th'][piexif.ImageIFD.Copyright] = `(c) ${maker}. Licensed to ${licensee} under Watermark ${ref}. Verify at ${base}/verify?ref=${ref}`;
  exif['0th'][piexif.ImageIFD.ImageDescription] = `Watermark license ${ref}: ${use}${ends ? `, until ${ends.slice(0, 10)}` : ''}. Original fingerprint sha256:${fingerprint}`;
  const out = piexif.insert(piexif.dump(exif), bin);
  return Buffer.from(out, 'binary');
}

function certificatePdf(res, { ref, title, maker, house, licensee, use, description, starts, ends, fee, fingerprint, ledgerHash, base, intended }) {
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 72, left: 72, right: 72, bottom: 72 }, info: { Title: `Watermark license ${ref}`, Author: 'Watermark' } });
  doc.pipe(res);
  const ink = '#111111', mu = '#6f6c66';
  doc.fillColor(mu).fontSize(9).text('WATERMARK LICENSE', { characterSpacing: 2 });
  doc.moveDown(0.6).fillColor(ink).font('Times-Roman').fontSize(30).text(ref);
  doc.moveDown(1);
  const row = (k, v) => { if (!v) return; doc.font('Helvetica').fontSize(8).fillColor(mu).text(k.toUpperCase(), { characterSpacing: 1.5 }); doc.font('Times-Roman').fontSize(13).fillColor(ink).text(v); doc.moveDown(0.6); };
  row('Work', title);
  row('Maker', house ? `${maker}, ${house}` : maker);
  row('Licensee', licensee);
  row('Use', `${use}: ${description}`);
  if (intended) row('As described by the licensee', intended);
  row('Term', ends ? `${starts.slice(0, 10)} to ${ends.slice(0, 10)}` : `From ${starts.slice(0, 10)}, perpetual`);
  if (fee) row('Fee', fee);
  row('Fingerprint of the original (SHA-256)', fingerprint);
  if (ledgerHash) row('Ledger entry', ledgerHash);
  doc.moveDown(0.6).font('Times-Roman').fontSize(11.5).fillColor(ink).text(
    `${maker} grants ${licensee} a non-exclusive, non-transferable license to use the work above for the use and term shown, with credit to ${maker} where the use allows. Copyright stays with the maker. Any other use needs a new license. The full terms are at ${base}/terms.`,
    { lineGap: 3 });
  doc.moveDown(1).font('Helvetica').fontSize(8.5).fillColor(mu).text(`Verify this license at ${base}/verify?ref=${ref}`);
  doc.end();
}

module.exports = { stampJpeg, certificatePdf };
