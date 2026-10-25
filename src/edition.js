// The house's edition (Will, 24 Oct: "an app as revolutionary as the Gutenberg press"): a book set from its text into a
// printable book block, a PDF, the way the reading room sets it: a title page with the imprint, chapters opening on
// their own page with a small-capital number, the text justified with first-line indents, running heads (the title
// left, the chapter right) and page numbers, a colophon. 5.5 × 8.5 in, the trade size, so a printer binds it as it is.
// /read/:slug.pdf: free texts to anyone; a priced text to the maker, the Studio, or the holder of a paid copy (?t=token).
// Set in Times for now (the fonts the reading room uses are served from Google; the press needs the files on disk).
const PDFDocument = require('pdfkit');
function mountEdition(app, { db, V, C, isStudio, makerOf, buyerOf, imageOf = null }) {
  const { tidy } = V;
  const byName = a => { const x = String(a || '').trim(); const m = x.match(/^([^,]+),\s*([^,(]+)(.*)$/); return m ? `${m[2].trim()} ${m[1].trim()}` : x; };
  const un = s => String(s).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*\n]{1,200}?)\*/g, '$1');
  function chapters(body) {
    const chs = []; let cur = { head: null, paras: [] };
    for (const p of String(body || '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean)) { if (/^##?\s/.test(p)) { if (cur.head || cur.paras.length) chs.push(cur); cur = { head: p.replace(/^#+\s*/, ''), paras: [] }; } else cur.paras.push(p); }
    if (cur.head || cur.paras.length) chs.push(cur);
    return chs;
  }
  async function build(t, res) {
    const W = 396, H = 612, M = { top: 64, bottom: 60, left: 54, right: 54 }; // 5.5 × 8.5 in
    const doc = new PDFDocument({ size: [W, H], margins: M, info: { Title: tidy(t.title), Author: byName(t.author) || 'Watermark Publishing', Creator: 'Watermark Publishing' }, autoFirstPage: false, bufferPages: true });
    doc.pipe(res);
    const author = byName(t.author); const chs = chapters(t.body);
    // The title page.
    doc.addPage(); doc.font('Times-Roman').fontSize(9).fillColor('#777').text('WATERMARK PUBLISHING', M.left, 150, { align: 'center', characterSpacing: 2, width: W - M.left - M.right });
    doc.moveDown(4); doc.fillColor('#111').fontSize(28).text(tidy(t.title), { align: 'center', width: W - M.left - M.right });
    if (author) { doc.moveDown(1); doc.font('Times-Italic').fontSize(14).text(author, { align: 'center', width: W - M.left - M.right }); }
    doc.font('Times-Roman').fontSize(9).fillColor('#777').text(t.maker_id ? 'Published by the house' : 'The house’s edition', M.left, H - 120, { align: 'center', width: W - M.left - M.right });
    doc.text(String(t.terms || 'Public domain'), { align: 'center', width: W - M.left - M.right });
    // The chapters, each on a new page.
    const first = [];
    chs.forEach((c, i) => {
      doc.addPage(); first.push(doc.bufferedPageRange().count - 1);
      doc.fillColor('#111');
      if (c.head && chs.length > 1) { doc.font('Times-Roman').fontSize(9).fillColor('#777').text(`${i + 1} OF ${chs.length}`, { align: 'center', characterSpacing: 2 }); doc.moveDown(0.6); doc.fillColor('#111').fontSize(18).text(c.head, { align: 'center' }); doc.moveDown(1.6); }
      else if (c.head) { doc.font('Times-Roman').fontSize(18).text(c.head, { align: 'center' }); doc.moveDown(1.6); }
      doc.font('Times-Roman').fontSize(11.2).lineGap(3.2);
      c.paras.forEach((p, j) => { if (p === '* * *') { doc.moveDown(0.5); doc.text('⁂', { align: 'center' }); doc.moveDown(0.5); return; } doc.text(un(p), { align: 'justify', indent: j === 0 ? 0 : 16, paragraphGap: 0 }); });
    });
    // The plates (25 Oct): a photo book's or an almanack's pictures, one to a page, fitted within the margins, the
    // line beneath in italic; the picture is the house's screen copy, never the master.
    let plates = []; try { plates = t.plates ? JSON.parse(t.plates) : []; } catch (e) { plates = []; } const platePages = new Set();
    for (const pl of plates) {
      const w = db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(pl.slug); if (!w || !imageOf) continue;
      let buf = null; try { buf = await imageOf(w); } catch (e) { buf = null; } if (!buf) continue;
      doc.addPage(); platePages.add(doc.bufferedPageRange().count - 1); const iw = W - M.left - M.right, ih = H - M.top - M.bottom - 60;
      doc.image(buf, M.left, M.top, { fit: [iw, ih], align: 'center', valign: 'center' });
      doc.font('Times-Italic').fontSize(9.5).fillColor('#333').text(`${tidy(w.title)}${w.place ? `, ${w.place}` : ''}${w.taken_at ? `, ${String(w.taken_at).slice(0, 4)}` : ''}${pl.note ? `. ${pl.note}` : ''}`, M.left, H - M.bottom - 36, { width: iw, align: 'center' });
    }
    // The colophon.
    doc.addPage(); doc.font('Times-Roman').fontSize(9).fillColor('#777').text('COLOPHON', { align: 'center', characterSpacing: 2 }); doc.moveDown(1);
    doc.fillColor('#333').fontSize(10).text(`${tidy(t.title)}${author ? `, by ${author}` : ''}. ${t.maker_id ? 'Published by the house' : 'Set by Watermark Publishing' + (t.source && /gutenberg/.test(t.source) ? ' from the Project Gutenberg text' : '')} for the house’s reading room and for paper. ${t.terms || 'Public domain'}${/public domain/i.test(t.terms || '') || !t.terms ? ': read it freely, keep it, pass it on.' : '.'}`, { align: 'center' });
    doc.moveDown(1); doc.text(`${C.base.replace(/^https?:\/\//, '')}/read/${t.slug}`, { align: 'center' });
    // Running heads and page numbers on the text pages.
    const range = doc.bufferedPageRange(); let chapterAt = -1;
    for (let p = range.start; p < range.start + range.count; p++) {
      if (p === 0 || p === range.count - 1) continue; doc.switchToPage(p);
      const k = first.indexOf(p); if (k >= 0) chapterAt = k;
      const head = chapterAt >= 0 && chs[chapterAt] && chs[chapterAt].head ? chs[chapterAt].head : '';
      doc.font('Times-Roman').fontSize(8).fillColor('#888');
      const y = M.top - 28;
      if (k < 0 && !platePages.has(p)) { doc.text(tidy(t.title).toUpperCase(), M.left, y, { width: (W - M.left - M.right) / 2, align: 'left', characterSpacing: 1, lineBreak: false }); doc.text(head.toUpperCase(), W / 2, y, { width: (W - M.left - M.right) / 2, align: 'right', characterSpacing: 1, lineBreak: false }); }
      doc.text(String(p), M.left, H - M.bottom + 20, { width: W - M.left - M.right, align: 'center', lineBreak: false });
    }
    doc.end();
  }
  app.get('/read/:slug.pdf', async (req, res) => {
    const t = db.prepare('SELECT * FROM texts WHERE slug=?').get(String(req.params.slug));
    if (!t || (!t.body && !t.plates) || t.status !== 'held' || (!t.public && !isStudio(req))) return res.sendStatus(404);
    if (t.price_cents) { // a priced text: the maker, the Studio, or a paid copy's holder
      const m = makerOf ? makerOf(req) : null; const b = buyerOf ? buyerOf(req) : null;
      const paid = req.query.t ? db.prepare("SELECT 1 FROM text_orders WHERE text_id=? AND token=? AND status='paid'").get(t.id, String(req.query.t)) : b ? db.prepare("SELECT 1 FROM text_orders WHERE text_id=? AND buyer_id=? AND status='paid'").get(t.id, b.id) : null;
      if (!paid && !isStudio(req) && !(m && m.id === t.maker_id)) return res.status(402).redirect(`/library/${t.slug}`);
    }
    const name = `${tidy(t.title)}${t.author ? `, ${byName(t.author)}` : ''} (Watermark Publishing).pdf`.replace(/[\/:*?"<>|]/g, '');
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name.replace(/[^\x20-\x7e]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`, 'Cache-Control': t.price_cents ? 'private, no-store' : 'public, max-age=3600' });
    try { await build(t, res); } catch (e) { console.error('[edition]', e.message); if (!res.headersSent) res.sendStatus(500); }
  });
  return { build };
}
module.exports = { mountEdition };
