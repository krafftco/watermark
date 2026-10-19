// The letters a sale sends (Will, 18 Oct): the collector's should arrive like an invitation to the Masters, the
// nicest delivery of a print there is, with the rights it carries and the agreement set out; one day it is the
// receipt for a $100,000 work. The maker's is a congratulations: someone has chosen their photograph.
// Email-safe: tables, inline styles, system serifs (Didot/Bodoni on Apple, Georgia elsewhere), one photograph
// served as JPEG from the house, a plain-text twin of every word.
const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SERIF = "'Didot','Bodoni 72','Bodoni MT',Georgia,'Times New Roman',serif";
const BODY = "Georgia,'Times New Roman',serif";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const INK = '#151412', MUTED = '#7a756c', LINE = '#e6e1d6', PAPER = '#f5f2eb', CARD = '#fcfbf8';
const ord = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const clean = t => String(t || '').trim().replace(/[.\s]+$/, '');

function frame({ base, preheader, body }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>Watermark</title>
<style>@media (max-width:600px){.wm-pad{padding-left:26px!important;padding-right:26px!important}.wm-h{font-size:34px!important}.wm-mount{padding:16px!important}.wm-col{display:block!important;width:100%!important;padding-left:0!important;padding-right:0!important}.wm-sig{white-space:nowrap}}</style></head>
<body style="margin:0;padding:0;background:${PAPER};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAPER}">${esc(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:40px 12px 48px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${CARD};border:1px solid ${LINE}">
<tr><td align="center" style="padding:44px 48px 6px" class="wm-pad"><a href="${base}" style="text-decoration:none"><img src="${base}/static/mail/wordmark.png" width="124" alt="Watermark" style="display:block;border:0;width:124px;height:auto"></a></td></tr>
${body}
</table>
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px"><tr><td align="center" style="padding:26px 24px 0;font:10px/1.8 ${SANS};letter-spacing:.22em;text-transform:uppercase;color:#a29d93">Watermark &middot; A Krafft company<br><a href="${base}" style="color:#a29d93;text-decoration:none">watermark.krafftco.com</a></td></tr></table>
</td></tr></table></body></html>`;
}
const kicker = t => `<tr><td align="center" style="padding:30px 48px 0" class="wm-pad"><p style="margin:0;font:10px/1 ${SANS};letter-spacing:.32em;text-transform:uppercase;color:${MUTED}">${t}</p></td></tr>`;
const headline = t => `<tr><td align="center" style="padding:18px 48px 0" class="wm-pad"><h1 class="wm-h" style="margin:0;font:400 40px/1.12 ${SERIF};color:${INK};letter-spacing:-.005em">${t}</h1></td></tr>`;
const lede = t => `<tr><td align="center" style="padding:16px 56px 0" class="wm-pad"><p style="margin:0;font:italic 17px/1.6 ${BODY};color:#4a463f">${t}</p></td></tr>`;
// The photograph on a cotton mount, with the pencil line beneath: number, title and year, the maker's hand.
function mount({ img, href, title, year, maker, no, of }) {
  return `<tr><td style="padding:34px 40px 0" class="wm-pad"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid ${LINE};box-shadow:0 1px 0 ${LINE}">
<tr><td class="wm-mount" style="padding:30px 30px 18px"><a href="${href}" style="text-decoration:none"><img src="${img}" width="460" alt="${esc(title)}" style="display:block;width:100%;max-width:100%;height:auto;border:0;outline:1px solid rgba(0,0,0,.06)"></a></td></tr>
<tr><td style="padding:0 30px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font:italic 13px/1.4 ${BODY};color:#8b867c" width="26%">${no ? `${no}${of ? `/${of}` : ''}` : ''}</td>
<td align="center" style="font:italic 13px/1.4 ${BODY};color:#8b867c">${esc(title)}${year ? `, ${esc(year)}` : ''}</td>
<td align="right" class="wm-sig" style="font:italic 15px/1.2 ${BODY};color:#5a554c;white-space:nowrap" width="30%">${esc(maker)}</td></tr></table></td></tr></table></td></tr>`;
}
function button(label, url) {
  return `<tr><td align="center" style="padding:34px 48px 0" class="wm-pad"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${INK}"><a href="${url}" style="display:inline-block;padding:17px 34px;font:600 11px/1 ${SANS};letter-spacing:.24em;text-transform:uppercase;color:#f7f5ef;text-decoration:none">${esc(label)}</a></td></tr></table></td></tr>`;
}
const links = items => `<tr><td align="center" style="padding:18px 48px 0" class="wm-pad"><p style="margin:0;font:12px/1.9 ${SANS};letter-spacing:.06em;color:${MUTED}">${items.filter(Boolean).map(([t, u]) => `<a href="${u}" style="color:${INK};text-decoration:underline;text-decoration-color:#c9c3b6;text-underline-offset:3px">${esc(t)}</a>`).join(' &nbsp;&middot;&nbsp; ')}</p></td></tr>`;
const rule = () => `<tr><td style="padding:40px 48px 0" class="wm-pad"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid ${LINE};font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>`;
const section = t => `<tr><td style="padding:30px 48px 0" class="wm-pad"><p style="margin:0;font:10px/1 ${SANS};letter-spacing:.3em;text-transform:uppercase;color:${MUTED}">${t}</p></td></tr>`;
function rights(can, cannot) {
  const li = (a, mark) => a.map(x => `<tr><td valign="top" width="22" style="padding:7px 0;font:14px/1.5 ${BODY};color:${mark === '+' ? INK : '#a29d93'}">${mark === '+' ? '&#10003;' : '&#8211;'}</td><td style="padding:7px 0;font:15px/1.5 ${BODY};color:${mark === '+' ? INK : '#5f5a51'}">${esc(x)}</td></tr>`).join('');
  return `<tr><td style="padding:14px 48px 0" class="wm-pad"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td class="wm-col" valign="top" width="50%" style="padding-right:14px"><p style="margin:6px 0 4px;font:italic 15px/1.4 ${BODY};color:${MUTED}">You may</p><table role="presentation" cellpadding="0" cellspacing="0">${li(can, '+')}</table></td>
<td class="wm-col" valign="top" width="50%" style="padding-left:14px"><p style="margin:6px 0 4px;font:italic 15px/1.4 ${BODY};color:${MUTED}">You may not</p><table role="presentation" cellpadding="0" cellspacing="0">${li(cannot, '-')}</table></td>
</tr></table></td></tr>`;
}
function ledgerRows(rows) {
  return `<tr><td style="padding:14px 48px 0" class="wm-pad"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.filter(Boolean).map(([k, v, mono]) => `<tr><td style="padding:11px 0;border-bottom:1px solid ${LINE};font:10px/1.4 ${SANS};letter-spacing:.2em;text-transform:uppercase;color:${MUTED}" width="42%">${esc(k)}</td><td align="right" style="padding:11px 0;border-bottom:1px solid ${LINE};font:${mono ? `15px/1.4 'SF Mono',Menlo,Consolas,monospace;letter-spacing:.06em` : `15px/1.4 ${BODY}`};color:${INK}">${v}</td></tr>`).join('')}</table></td></tr>`;
}
const para = (t, pad = '18px') => `<tr><td style="padding:${pad} 48px 0" class="wm-pad"><p style="margin:0;font:15px/1.65 ${BODY};color:#3c3933">${t}</p></td></tr>`;
const close = t => `<tr><td align="center" style="padding:40px 48px 48px" class="wm-pad">${t}</td></tr>`;

// The proof: a 5 × 7 from the house's print room, offered in the letter.
const proof = c => `<tr><td style="padding:34px 48px 0" class="wm-pad"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3efe6"><tr><td style="padding:22px 26px"><p style="margin:0 0 6px;font:10px/1 ${SANS};letter-spacing:.3em;text-transform:uppercase;color:${MUTED}">The proof</p><p style="margin:0 0 8px;font:italic 19px/1.3 ${BODY};color:${INK}">Hold it in your hand.</p><p style="margin:0;font:14px/1.6 ${BODY};color:#3c3933">A 5 &times; 7 print of <i>${esc(clean(c.title))}</i> from the house&rsquo;s own print room: pigment on Hahnem&uuml;hle Photo Rag, ${c.no ? 'your number' : 'the title'} in pencil beneath, posted to you. ${esc(c.proof.price)}. <a href="${c.proof.url}" style="color:${INK}">Ask for the proof &rarr;</a></p></td></tr></table></td></tr>`;

// The collector's letter.
function collected(c) {
  const title = clean(c.title), first = String(c.name || '').trim().split(/\s+/)[0];
  const personal = c.kind !== 'print' && c.personal;
  const head = c.kind === 'print' ? `<i>${esc(title)}</i> is yours.` : personal ? `<i>${esc(title)}</i> is yours.` : `<i>${esc(title)}</i> is licensed to ${esc(c.who)}.`;
  const no = c.no ? `No.&nbsp;${c.no}` : '';
  const html = frame({ base: c.base, preheader: `${title}, by ${c.maker}${c.no ? `, No. ${c.no}` : ''}. ${personal ? 'In your gallery now.' : 'Your license and the file are inside.'}`, body: [
    kicker(`${personal ? 'Collected' : c.kind === 'print' ? 'Acquired' : 'Licensed'}${c.name ? ` by ${esc(c.name)}` : ''}${c.no ? ` &nbsp;&middot;&nbsp; <span style="white-space:nowrap">No. ${c.no}${c.of ? ` of ${c.of}` : ''}</span>` : ''}`),
    headline(head),
    lede(`A photograph by ${esc(c.maker)}${c.place ? `, made in ${esc(c.place)}` : ''}. ${personal ? 'From today it hangs in your gallery, numbered and registered in your name.' : 'The file, the license and the agreement are yours for the term.'}`),
    mount({ img: c.img, href: c.galleryUrl, title, year: c.year, maker: c.maker, no, of: c.of }),
    button(personal ? 'See it in your gallery' : 'Open your license', personal ? c.galleryUrl : c.certUrl),
    links([c.fileUrl && ['Save the photograph', c.fileUrl], c.printUrl && ['Print it', c.printUrl], ['The certificate', c.certUrl], ['The agreement', c.contractUrl]]),
    c.proof ? proof(c) : '',
    rule(),
    section('What you hold'),
    rights(c.can, c.cannot),
    section('The particulars'),
    ledgerRows([
      ['Photograph', `<i>${esc(title)}</i>`],
      ['Made by', esc(c.maker)],
      c.no && ['Number', `${c.no}${c.of ? ` of ${c.of}` : ''}`],
      ['Held as', esc(c.useName)],
      ['Term', c.ends ? `Until ${esc(c.ends)}` : 'For good'],
      ['Paid', `${esc(c.fee)}${c.date ? ` &nbsp;<span style="color:${MUTED}">${esc(c.date)}</span>` : ''}`],
      c.share && ['To the maker', esc(c.share)],
      ['Watermark number', esc(c.number), true],
    ]),
    para(`Your agreement with ${esc(c.maker)} is set out in full at <a href="${c.contractUrl}" style="color:${INK}">the agreement</a>. You accepted it when you paid; its fingerprint is kept in the house register, so neither side can change a word of it.`, '26px'),
    para(`The photograph carries its papers inside the file: who made it, this number, and how to reach the maker. Anyone can check them at <a href="${c.checkUrl}" style="color:${INK}">${esc(c.checkUrl.replace(/^https?:\/\//, ''))}</a>.`),
    close(`<p style="margin:0;font:italic 17px/1.5 ${BODY};color:#4a463f">Thank you for collecting.</p><p style="margin:14px 0 0;font:10px/1 ${SANS};letter-spacing:.32em;text-transform:uppercase;color:${MUTED}">The house</p>`),
  ].join('') });
  const text = [
    `${personal ? `${title} is yours.` : `${title} is licensed to ${c.who}.`}`,
    `A photograph by ${c.maker}${c.place ? `, made in ${c.place}` : ''}${c.no ? `. No. ${c.no}${c.of ? ` of ${c.of}` : ''}` : ''}.`,
    personal ? `In your gallery: ${c.galleryUrl}` : `Your license: ${c.certUrl}`,
    c.fileUrl ? `Save the photograph: ${c.fileUrl}` : '',
    c.printUrl ? `Print it (the sizes it holds, how, or the house prints it): ${c.printUrl}` : '',
    c.proof ? `Hold it in your hand: the proof, a 5 x 7 print from the house's print room on Hahnemuhle Photo Rag, your number in pencil, posted, ${c.proof.price}: ${c.proof.url}` : '',
    `The certificate: ${c.certUrl}\nThe agreement: ${c.contractUrl}`,
    `You may:\n${c.can.map(x => `  - ${x}`).join('\n')}\nYou may not:\n${c.cannot.map(x => `  - ${x}`).join('\n')}`,
    `Held as: ${c.useName}. Term: ${c.ends ? `until ${c.ends}` : 'for good'}. Paid: ${c.fee}.${c.share ? ` To the maker: ${c.share}.` : ''}`,
    `Watermark number: ${c.number}. Anyone can check it: ${c.checkUrl}`,
    'Thank you for collecting.\nThe house',
  ].filter(Boolean).join('\n\n');
  const subject = personal ? `${title} is yours${c.no ? `, No. ${c.no}` : ''}` : `Your license for ${title}`;
  return { subject, text, html };
}

// The maker's letter: a congratulations.
function sold(c) {
  const title = clean(c.title), first = String(c.maker || '').split(/\s+/)[0];
  const times = c.times > 1 ? `the ${ord(c.times)} time it has been chosen` : 'the first time it has been chosen';
  const html = frame({ base: c.base, preheader: `${c.who} chose ${title}. ${c.share} is yours.`, body: [
    kicker(`Congratulations${first ? `, ${esc(first)}` : ''}`),
    headline(`<i>${esc(title)}</i> has been ${c.personal ? 'collected' : 'licensed'}.`),
    lede(`${esc(c.who)} chose it${c.personal ? ' for their gallery' : ` ${esc(c.useSays || 'for their work')}`}. It is ${times}${c.allTimes > 1 ? `, and your work has now been chosen ${c.allTimes} times` : ''}.`),
    mount({ img: c.img, href: c.studioUrl, title, year: c.year, maker: c.maker, no: c.no ? `No.&nbsp;${c.no}` : '', of: c.of }),
    `<tr><td align="center" style="padding:34px 48px 0" class="wm-pad"><p style="margin:0;font:10px/1 ${SANS};letter-spacing:.3em;text-transform:uppercase;color:${MUTED}">Yours from this sale</p><p style="margin:12px 0 0;font:400 46px/1 ${SERIF};color:${INK}">${esc(c.share)}</p><p style="margin:10px 0 0;font:italic 14px/1.5 ${BODY};color:${MUTED}">${esc(c.pct)}% of ${esc(c.fee)}${c.month ? `. ${esc(c.month)} this month` : ''}.</p></td></tr>`,
    button('See it in your studio', c.studioUrl),
    links([['Getting paid', c.payUrl], ['The license', c.certUrl]]),
    rule(),
    ledgerRows([
      ['Photograph', `<i>${esc(title)}</i>`],
      c.no && ['Number', `${c.no}${c.of ? ` of ${c.of}` : ''}`],
      ['Chosen as', esc(c.useName)],
      ['By', esc(c.who)],
      ['Paid', esc(c.fee)],
      ['Watermark number', esc(c.number), true],
    ]),
    para('The file went out with your name, the copyright and this number inside it; the certificate and the agreement went with it. There is nothing for you to do.', '26px'),
    close(`<p style="margin:0;font:italic 17px/1.5 ${BODY};color:#4a463f">Someone saw what you saw, and wanted to keep it.</p><p style="margin:14px 0 0;font:10px/1 ${SANS};letter-spacing:.32em;text-transform:uppercase;color:${MUTED}">The house</p>`),
  ].join('') });
  const text = [
    `Congratulations${first ? `, ${first}` : ''}.`,
    `${title} has been ${c.personal ? 'collected' : 'licensed'} by ${c.who}. It is ${times}.`,
    `Yours from this sale: ${c.share} (${c.pct}% of ${c.fee}).${c.month ? ` ${c.month} this month.` : ''}`,
    `${c.no ? `No. ${c.no}${c.of ? ` of ${c.of}` : ''}. ` : ''}Watermark number ${c.number}.`,
    `See it in your studio: ${c.studioUrl}\nGetting paid: ${c.payUrl}`,
    'Someone saw what you saw, and wanted to keep it.\nThe house',
  ].join('\n\n');
  return { subject: `Congratulations: ${title} has been ${c.personal ? 'collected' : 'licensed'}`, text, html };
}

// The wall letter (Will, 19 Oct): thirty days after a Collect with nothing printed, one letter: the piece on its
// mount, 'Ready to hang', the proof. Sent once per piece, never again.
function ready(c) {
  const title = clean(c.title), no = c.no ? `No.&nbsp;${c.no}` : '';
  const html = frame({ base: c.base, preheader: `${title} has been yours a month. It would look well on a wall.`, body: [
    kicker(`In your gallery a month${c.no ? ` &nbsp;&middot;&nbsp; <span style="white-space:nowrap">No. ${c.no}${c.of ? ` of ${c.of}` : ''}</span>` : ''}`),
    headline(`Ready to hang.`),
    lede(`<i>${esc(title)}</i> has been yours for a month, on a screen. On paper it has weight and an edge, and it is there when you come home.`),
    mount({ img: c.img, href: c.printUrl, title, year: c.year, maker: c.maker, no, of: c.of }),
    proof(c),
    para(`Or print it yourself: your piece shows the sizes its file holds, and <a href="${c.guideUrl}" style="color:${INK}">the house&rsquo;s guide</a> says how, in five steps. When it is made, record it on the piece, so the print stays with the number.`, '26px'),
    button('Print it', c.printUrl),
    close(`<p style="margin:0;font:italic 17px/1.5 ${BODY};color:#4a463f">A photograph is finished when it is printed.</p><p style="margin:14px 0 0;font:10px/1 ${SANS};letter-spacing:.32em;text-transform:uppercase;color:${MUTED}">The house</p>`),
  ].join('') });
  const text = [
    `Ready to hang.`,
    `${title}, by ${c.maker}${c.no ? `, No. ${c.no}${c.of ? ` of ${c.of}` : ''}` : ''}, has been yours for a month, on a screen. On paper it has weight and an edge.`,
    `The proof: a 5 x 7 print from the house's print room on Hahnemuhle Photo Rag, ${c.no ? 'your number' : 'the title'} in pencil, posted, ${c.proof.price}: ${c.proof.url}`,
    `Or print it yourself: ${c.printUrl}\nThe house's guide: ${c.guideUrl}`,
    'A photograph is finished when it is printed.\nThe house',
  ].join('\n\n');
  return { subject: `${title}: ready to hang`, text, html };
}

module.exports = { collected, sold, ready, frame };
