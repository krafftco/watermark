// Sharing a book (Will, 26 Oct: "we have to make it where you can share a book"; "easily in feed"; "everything has to
// be easily shareable"; "every aspect of sharing a book should be something considered and beautiful"; "frictionless,
// and add it to someone's collection"; "make people feel like they are collecting and have already collected").
// Three things, each set with care:
//  1. The card. Any link to a book unfurls (iMessage, Slack, Instagram, mail) into the house's card: the binding
//     standing on the dark wall, the title and author in gilt, one line. A link to a passage unfurls into the passage
//     itself, set in the serif on paper, with the book beneath it. /read/<slug>/card.png[?q=…], drawn by sharp.
//  2. The letter. A signed-in reader sends the book to a friend by name and address with a note: the house writes
//     the letter (the card, the note in their words, 'Read it' and 'Keep it on your shelf'). POST /read/<slug>/send.
//  3. The keeping. A link carries who sent it (?from=) and ?keep=1: the receiver sees '<Name> sent you this book'
//     on the cover and one tap puts it on their shelf (the reading list); signed in, it is kept the moment they
//     arrive, and the cover says 'On your shelf.' A book kept is a book collected: it stands among their books.
// Nothing of who sent what to whom is kept beyond the letter itself; nothing on the register.
'use strict';
const sharp = require('sharp');

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WAVE_D = 'M1.5 24.5c2.3-5 4.6-7.6 6.9-7.6s4.6 2.5 6.9 7.6 4.6 7.6 6.9 7.6 4.6-2.5 6.9-7.6 4.6-7.6 6.9-7.6 4.6 2.5 6.9 7.6';
const GILT = '#c9a24a', WALL = '#0b0a09', PAPER = '#f4efe4', INK = '#1a1714';

// Words wrapped to a width by a plain measure (a serif at this size runs about .5 em a character).
function wrap(text, chars) {
  const out = []; let line = '';
  for (const w of String(text || '').split(/\s+/).filter(Boolean)) {
    if ((line + ' ' + w).trim().length > chars && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line); return out;
}
const fit = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };

// The book's card, 1200 × 630: the binding on the wall, the words in gilt.
function cardSvg(t, { binding, byName }) {
  const author = byName(t.author); const title = fit(t.title, 90); const tl = wrap(title, 26).slice(0, 3);
  const size = title.length > 40 ? 54 : 66; const y0 = 250 - (tl.length - 1) * (size * 0.6);
  const line = fit(t.summary || '', 150); const ll = wrap(line, 58).slice(0, 2);
  const book = binding.svg(t, { w: 300 }).replace(/^<svg([^>]*)>/, (m, a) => `<svg${a.replace(/\s(width|height|x|y)="[^"]*"/g, '')} x="90" y="95" width="300" height="440">`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="${WALL}"/>
<ellipse cx="240" cy="540" rx="230" ry="26" fill="#000" opacity=".55"/>
<ellipse cx="240" cy="300" rx="330" ry="300" fill="#2a2118" opacity=".35"/>
${book}
<text x="460" y="150" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="15" letter-spacing="4" fill="${GILT}" opacity=".85">WATERMARK PUBLISHING</text>
${tl.map((l, i) => `<text x="460" y="${y0 + i * size * 1.15}" font-family="'GFS Baskerville', 'Bitstream Charter', 'DejaVu Serif', serif" font-size="${size}" fill="${GILT}">${esc(l)}</text>`).join('')}
${author ? `<text x="460" y="${y0 + tl.length * size * 1.15 + 14}" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="20" letter-spacing="3" fill="#f6f1e7" opacity=".8">${esc(author.toUpperCase())}</text>` : ''}
${ll.map((l, i) => `<text x="460" y="${y0 + tl.length * size * 1.15 + 64 + i * 32}" font-family="'Bitstream Charter', 'DejaVu Serif', serif" font-style="italic" font-size="24" fill="#f6f1e7" opacity=".7">${esc(l)}</text>`).join('')}
<g transform="translate(460 556) scale(1.3)"><path d="${WAVE_D}" fill="none" stroke="${GILT}" stroke-width="2.2" stroke-linecap="round"/></g>
<text x="530" y="580" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="16" letter-spacing="2" fill="#f6f1e7" opacity=".6">READ IT IN THE HOUSE · FREE · YOURS TO KEEP</text>
</svg>`;
}

// A passage, set on paper with the book beneath it.
function quoteSvg(t, q, { byName }) {
  const author = byName(t.author); const text = fit(q, 420);
  const size = text.length > 260 ? 28 : text.length > 140 ? 34 : 42; const lines = wrap(text, Math.round(1000 / (size * 0.48))).slice(0, 7);
  const lh = size * 1.32; const y0 = 315 - (lines.length - 1) * lh / 2 - 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="${PAPER}"/>
<rect x="28" y="28" width="1144" height="574" fill="none" stroke="${GILT}" stroke-width="1.5"/>
<rect x="36" y="36" width="1128" height="558" fill="none" stroke="${GILT}" stroke-width=".6"/>
<text x="100" y="${y0 - 30}" font-family="'GFS Baskerville', 'DejaVu Serif', serif" font-size="110" fill="${GILT}" opacity=".55">“</text>
${lines.map((l, i) => `<text x="100" y="${y0 + i * lh}" font-family="'Bitstream Charter', 'GFS Baskerville', 'DejaVu Serif', serif" font-size="${size}" fill="${INK}">${esc(l)}</text>`).join('')}
<path d="M100 528h60" stroke="${GILT}" stroke-width="1.5"/>
<text x="176" y="534" font-family="'Bitstream Charter', 'DejaVu Serif', serif" font-style="italic" font-size="22" fill="${INK}">${esc(fit(author ? `${author}, ` : '', 60))}<tspan font-style="normal">${esc(fit(t.title, 60))}</tspan></text>
<g transform="translate(100 560) scale(1.1)"><path d="${WAVE_D}" fill="none" stroke="${GILT}" stroke-width="2.2" stroke-linecap="round"/></g>
<text x="160" y="580" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="14" letter-spacing="2" fill="${INK}" opacity=".55">WATERMARK PUBLISHING · READ IT IN THE HOUSE</text>
</svg>`;
}

function mountShareBook(app, { db, V, C, mail, buyerOf, makerOf, ledger }) {
  const binding = require('./binding'); const byName = binding.byName;
  const textBy = slug => db.prepare("SELECT t.*, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.slug=? AND t.status='held' AND t.public=1").get(String(slug));
  const cards = new Map(); // slug|q → png, a day
  const base = () => (C && C.base) || process.env.BASE_URL || '';

  // The card a link unfurls into. ?q= a passage (the quote card).
  app.get('/read/:slug/card.png', async (req, res) => {
    const t = textBy(req.params.slug); if (!t) return res.sendStatus(404);
    const q = String(req.query.q || '').replace(/\s+/g, ' ').trim().slice(0, 420);
    const key = `${t.slug}|${q}`; let png = cards.get(key);
    if (!png) {
      try {
        const svg = q ? quoteSvg(t, q, { byName }) : cardSvg(t, { binding, byName });
        png = await sharp(Buffer.from(svg)).png({ compressionLevel: 8 }).toBuffer();
        if (cards.size > 400) cards.delete(cards.keys().next().value);
        cards.set(key, png);
      } catch (e) { console.error('[share-book]', e.message); return res.sendStatus(500); }
    }
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }).send(png);
  });

  // Send the book by letter. A signed-in reader (collector or maker) only; twenty a day.
  const sent = new Map(); // owner → [times]
  app.post('/read/:slug/send', async (req, res) => {
    const t = textBy(req.params.slug); if (!t) return res.sendStatus(404);
    const b = buyerOf(req), m = makerOf ? makerOf(req) : null; const json = !!(req.body && req.body.json);
    const back = `/read/${t.slug}`;
    if (!b && !m) return json ? res.status(401).json({ error: 'Sign in to send a book.', signin: `/signin?next=${encodeURIComponent(back)}` }) : res.redirect(`/signin?next=${encodeURIComponent(back)}`);
    const who = m ? `m:${m.id}` : `b:${b.id}`; const now = Date.now(); const times = (sent.get(who) || []).filter(x => now - x < 864e5);
    if (times.length >= 20) return json ? res.status(429).json({ error: 'Twenty books a day is the house’s limit.' }) : res.redirect(`${back}?ok=limit`);
    const to = String((req.body && req.body.to) || '').trim().toLowerCase(); const note = String((req.body && req.body.note) || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    const q = String((req.body && req.body.q) || '').replace(/\s+/g, ' ').trim().slice(0, 420); const c = Math.max(0, +(req.body && req.body.c) || 0);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json ? res.status(400).json({ error: 'An address, please.' }) : res.redirect(`${back}?ok=address`);
    const name = (m && m.name) || (b && (b.name || b.given_name)) || ''; const first = String(name).split(/\s+/)[0] || 'A friend';
    const author = byName(t.author);
    const url = `${base()}/read/${t.slug}?keep=1&from=${encodeURIComponent(first)}${q ? `&c=${c}&q=${encodeURIComponent(q)}` : ''}`;
    const subject = `${first} sent you a book: ${t.title}`;
    const text = [`${first} sent you a book.`, `${t.title}${author ? `, by ${author}` : ''}.${t.summary ? ` ${t.summary}` : ''}`, note ? `${first} writes: “${note}”` : '', q ? `A passage ${first} marked:\n“${q}”` : '', `Read it in the house, free, and keep it on your shelf:\n${url}`, 'Watermark, a Krafft company.'].filter(Boolean).join('\n\n');
    const html = `<div style="background:#0b0a09;padding:40px 24px;font-family:Georgia,serif;color:#f6f1e7"><div style="max-width:560px;margin:0 auto"><p style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:3px;color:#c9a24a;margin:0 0 18px">A BOOK, SENT BY ${esc(first.toUpperCase())}</p><a href="${esc(url)}" style="display:block"><img src="${esc(base())}/read/${esc(t.slug)}/card.png${q ? `?q=${encodeURIComponent(q)}` : ''}" width="560" style="width:100%;height:auto;display:block;border:1px solid #2a2118" alt="${esc(t.title)}"></a><h1 style="font-weight:400;font-size:30px;margin:28px 0 6px;color:#f6f1e7">${esc(t.title)}</h1>${author ? `<p style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:2px;color:#c9a24a;margin:0 0 20px">${esc(author.toUpperCase())}</p>` : ''}${note ? `<blockquote style="margin:0 0 24px;padding:0 0 0 18px;border-left:2px solid #c9a24a;font-style:italic;font-size:18px;line-height:1.5">${esc(note)}<br><span style="font-style:normal;font-size:14px;color:#c9a24a">— ${esc(first)}</span></blockquote>` : ''}${q ? `<p style="font-size:17px;line-height:1.55;color:#e8e1d2;margin:0 0 24px">“${esc(q)}”</p>` : ''}<p style="margin:0 0 28px"><a href="${esc(url)}" style="display:inline-block;background:#c9a24a;color:#0b0a09;text-decoration:none;padding:14px 26px;border-radius:999px;font-family:Inter,Helvetica,Arial,sans-serif;font-size:14px;letter-spacing:1px">Read it, and keep it on your shelf</a></p><p style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#9a9185;margin:0">Free, in the house’s reading room. One tap keeps it among your books. Nothing to install, nothing to pay.<br>Watermark, a Krafft company.</p></div></div>`;
    try { await mail.send({ to, subject, text, html }); } catch (e) { console.error('[share-book] mail', e.message); }
    times.push(now); sent.set(who, times);
    if (json) return res.json({ ok: true, to });
    res.redirect(`${back}?ok=sent`);
  });

  app.locals.shareBook = { cardSvg: t => cardSvg(t, { binding, byName }), quoteSvg: (t, q) => quoteSvg(t, q, { byName }) };
}

module.exports = { mountShareBook, cardSvg, quoteSvg, wrap };
