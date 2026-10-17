// Provenance: the delivered file carries its license. For JPEGs the EXIF is rewritten without
// re-encoding the image (pixels untouched). Other formats are delivered as-is with the certificate.
const fs = require('fs');
const piexif = require('piexifjs');
const PDFDocument = require('pdfkit');

function stampJpeg(file, { ref, maker, licensee, use, ends, fingerprint, base, conditions }) {
  const bin = fs.readFileSync(file).toString('binary');
  let exif;
  try { exif = piexif.load(bin); } catch (e) { exif = { '0th': {}, Exif: {}, GPS: {}, '1st': {}, thumbnail: null }; }
  exif['0th'] = exif['0th'] || {};
  exif['0th'][piexif.ImageIFD.Artist] = maker;
  exif['0th'][piexif.ImageIFD.Copyright] = `(c) ${maker}. Licensed to ${licensee} under Watermark ${ref}. Verify at ${base}/verify?ref=${ref}`;
  exif['0th'][piexif.ImageIFD.ImageDescription] = `Watermark license ${ref}: ${use}${ends ? `, until ${ends.slice(0, 10)}` : ''}. ${conditions ? ` ${conditions}.` : ''} Original fingerprint sha256:${fingerprint}`;
  const out = piexif.insert(piexif.dump(exif), bin);
  return Buffer.from(out, 'binary');
}

// The Watermark wave, as in the logo.
const WAVE = 'M40.9019,20.248c.0496.0348.1284.1018.21.14.0392.0183.1355.0555.1748.0725.142.0613.2106.0623.2106.0623.4242.1069.61-.0405.61-.0405,0,0,.0188-.0104.0372-.0243.0184-.014.0363-.0314.0458-.0406.0151-.0146.0539-.0644.0539-.0644,0,0,.052-.0909.0637-.1237.0071-.0198.024-.0795.024-.0795.0222-.0965.0109-.1126.0246-.2317.0093-.0811-.0287-.3268-.0598-.4078-.0365-.0952-.1166-.3107-.1703-.4046-.0609-.1065-.288-.3048-.3726-.4039-.0684-.0801-.1447-.1568-.2296-.2285-.1278-.108-.4529-.423-.699-.5881-.1149-.077-.4531-.3086-.661-.3576-.1954-.0461-.5058-.1799-.7093-.2207-.1562-.0313-.3892-.0664-.5873-.0663-.1141.0029-1.5885.0597-2.7094,1.0659-.3753.3369-.3855.3946-.8039.8574-1.32,1.4605-2.8991,1.493-4.248.0839-2.6425-2.7603-4.3029-2.7712-7.0126-.0458-1.4491,1.4575-2.8945,1.5826-4.2166-.0527-2.0205-2.4992-5.04-2.4249-6.9906-.0205-1.4506,1.788-2.9277,1.5387-4.6146-.3402-1.5584-1.7356-3.6345-2.0457-5.3761-.7779-.3208.2335-.6042.5574-.9828.9127-.3769.3368-.7879,2.0455.8259,1.4273.2077-.0796.4772-.3289.6437-.4599,1.37-1.0769,2.6549-.9274,3.9243.3511,2.7283,2.7477,4.1663,2.7285,6.9293-.0031,1.449-1.4325,2.9109-1.5845,4.2323.0157,2.0744,2.512,4.8342,2.5441,6.9759.0433,1.4851-1.7342,2.9311-1.5102,4.6445.3102,1.7438,1.8528,3.6846,2.1267,5.4476.7528.2651-.2066.5093-.4648.7507-.7199.9751-1.0303,1.776-1.4668,2.6072-1.416,0-.052.6333.1119.8306.2146.0961.05.3577.1959.4835.268.0829.0476.2447.1927.3365.2464l.1702.1427.1157.0958.071.0558Z';

function certificatePdf(res, { ref, title, maker, house, licensee, use, description, starts, ends, fee, fingerprint, ledgerHash, base, intended, conditions, credentials = false }) {
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 72, left: 72, right: 72, bottom: 72 }, info: { Title: `Watermark license ${ref}`, Author: 'Watermark' } });
  doc.pipe(res);
  const ink = '#111111', mu = '#6f6c66';
  // The Watermark Shield, struck in the top corner.
  const sx = doc.page.width - 72 - 40, sy = 66;
  doc.save().translate(sx, sy).lineWidth(1.4).strokeColor(ink)
    .path('M20 1.5 L37.5 6.5 V22 C37.5 33.2 30.1 40.6 20 44.4 C9.9 40.6 2.5 33.2 2.5 22 V6.5 Z').stroke()
    .lineWidth(0.6).strokeOpacity(0.55).path('M20 5.4 L34 9.4 V22 C34 31 28.2 37.2 20 40.6 C11.8 37.2 6 31 6 22 V9.4 Z').stroke().strokeOpacity(1)
    .translate(7.5, 17.6).scale(25 / 41).translate(-1.5, -14.2).path(WAVE).fill(ink).restore();
  doc.fillColor(mu).fontSize(9).text('WATERMARK LICENSE', { characterSpacing: 2 });
  doc.moveDown(0.6).fillColor(ink).font('Times-Roman').fontSize(30).text(ref);
  doc.moveDown(1);
  const row = (k, v) => { if (!v) return; doc.font('Helvetica').fontSize(8).fillColor(mu).text(k.toUpperCase(), { characterSpacing: 1.5 }); doc.font('Times-Roman').fontSize(13).fillColor(ink).text(v); doc.moveDown(0.6); };
  row('Work', title);
  row('Maker', house ? `${maker}, ${house}` : maker);
  row('Licensee', licensee);
  row('Use', `${use}: ${description}`);
  if (intended) row('As described by the licensee', intended);
  if (conditions) row("The maker's conditions", conditions);
  row('Term', ends ? `${starts.slice(0, 10)} to ${ends.slice(0, 10)}` : `From ${starts.slice(0, 10)}, perpetual`);
  if (fee) row('Fee', fee);
  row('Fingerprint of the original (SHA-256)', fingerprint);
  if (ledgerHash) row('Ledger entry', ledgerHash);
  doc.moveDown(0.6).font('Times-Roman').fontSize(11.5).fillColor(ink).text(
    `${maker} grants ${licensee} a non-exclusive, non-transferable license to use the work above for the use and term shown, with credit to ${maker} where the use allows. Copyright stays with the maker. Any other use needs a new license. The full terms are at ${base}/terms.`,
    { lineGap: 3 });
  if (credentials) doc.moveDown(0.8).font('Helvetica').fontSize(8.5).fillColor(mu).text('The delivered file carries Content Credentials (C2PA) signed by Watermark: the maker, the copyright holder and this license. Inspect it at contentcredentials.org/verify.', { lineGap: 2 });
  doc.moveDown(1).font('Helvetica').fontSize(8.5).fillColor(mu).text(`Verify this license at ${base}/verify?ref=${ref}`);
  doc.end();
}

module.exports = { stampJpeg, certificatePdf };
