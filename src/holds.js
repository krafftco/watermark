// What you hold (#176; Will, 20 Nov: "the collector must be able to say in one breath what they own").
// One sentence form, built here and nowhere else, read at three moments: before paying (the work's page, the licence
// page, the basket), on the papers (the certificate, the holder's room, the thank-you page, the letter) and at resale
// (the market's pages, the offer forms). Four short sentences, always in this order:
//   what you hold · what you may do with it · what stays with the maker · what happens when you pass it on.
//
// EVERY WORD HERE IS A DRAFT FOR WILL, and nothing here grants anything. Each clause restates what the house already
// grants, and names its source:
//   SCL    the Standard Content License as assembled for the order (src/contract.js: 1, 2.1, 2.3, 2.4, 7.1, 9.3)
//   terms  the terms of the house (src/legal.js: "Collecting and licensing", "The market, trades and gifts")
//   trade  the market's own rules (src/market.js ROYALTY and FEE; src/rules-of-trade.js holdDays; all drafts)
//   open   the open licences as the house states them (src/open.js; docs/SOURCES.md)
// Where a page and the licence disagree, or the licence is silent, the clause is left out and the question is in
// docs/COUNSEL.md (44 to 48). We say what the house built; we do not give legal advice.
const K = require('./contract');
const TR = require('./rules-of-trade');

const M = () => require('./market'); // the royalty and the fee are the market's own numbers (drafts), read when asked
const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const list = a => (a.length <= 1 ? a.join('') : a.length === 2 ? a.join(' and ') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const dur = m => (m % 12 === 0 ? `${m / 12} year${m === 12 ? '' : 's'}` : `${m} months`);
const pct = x => `${Math.round(x * 100)}%`;

// The terms of an order, whole: a stored licence's own (licenses.rights) where it has them, else as the contract
// would assemble them for the use. The licence decides; nothing is judged here.
function termsOf(use, t) {
  const base = K.terms({ use, never: (t && t.never) || [], add: (t && t.added) || [], extras: (t && t.extras) || [] });
  if (!t) return base;
  return { ...base, ...t, rights: Array.isArray(t.rights) ? t.rights : base.rights, extras: Array.isArray(t.extras) ? t.extras : base.extras,
    personal: typeof t.personal === 'boolean' ? t.personal : base.personal, transferable: typeof t.transferable === 'boolean' ? t.transferable : base.transferable,
    term_months: t.term_months !== undefined ? t.term_months : base.term_months };
}
// Which kind of holding this is: an open print (an object made from a free picture), a print, a collected personal
// piece, or a licence for a use.
function kindOf(use, t, open) {
  if (open) return 'open';
  if (use && use.kind === 'print') return 'print';
  return t.personal ? 'collect' : 'license';
}

// The market's part of "when you pass it on", for a numbered piece of an edition (the only pieces the market takes).
// The holding time is a draft (MARKET_HOLD_DAYS) and counsel question 43; at 0 days nothing is said of it.
function marketLine(maker) {
  const d = TR.holdDays();
  return `Offered on the house’s market, ${pct(M().ROYALTY)} of the price goes to ${maker} and ${pct(M().FEE)} to the house${d > 0 ? `, and a piece is not offered there until ${d} days after it was last sold` : ''}.`;
}

// statement({ use, t, maker, open, no, of, edition, will }) → { kind, hold, may, stays, pass, text }
//   use      the use's row (key, kind, name, term_months)
//   t        the terms of the order (optional: a stored licence's `rights`)
//   maker    the maker's name
//   open     for a print of an open work: its key (pd, cc0, cc-by, cc-by-sa)
//   no, of   a collected piece's number and its edition's size, when known
//   edition  the work is a limited edition (so the market's rules apply to its numbered pieces)
//   will     before paying: "You will hold"
function statement({ use, t = null, maker = 'the maker', open = null, no = null, of = null, edition = false, will = false } = {}) {
  const tt = termsOf(use || { key: 'social', kind: 'license' }, t);
  const kind = kindOf(use, tt, open);
  const You = will ? 'You will hold' : 'You hold';
  const num = no ? `No. ${no}${of ? ` of ${of}` : ''}, ` : '';
  let hold, may, stays, pass;
  if (kind === 'open') {
    // SCL 2.1 (print); open: the picture is free to everyone; thank-you page and docs/SOURCES.md ("no copyright is claimed here").
    hold = `${You} a print of this work: an object that is yours.`;
    may = 'You may hang it and show it, in private or in public.';
    stays = open === 'pd' || open === 'cc0'
      ? 'Nothing is kept back: the picture is in the public domain, free to everyone, and no copyright is claimed here.'
      : 'The picture stays free to everyone under its open license, with its maker credited.';
    pass = 'If you pass it on, the print itself is yours to sell or to give.';
  } else if (kind === 'print') {
    // SCL 2.1 (print): "display the print privately or publicly and may sell or give the print itself. No right to reproduce".
    hold = `${You} a print of this work: an object that is yours.`;
    may = 'You may hang it and show it, in private or in public.';
    stays = `The copyright stays with ${maker}: the print carries no right to copy the picture.`;
    pass = 'If you pass it on, the print itself is yours to sell or to give.';
  } else if (kind === 'collect') {
    // terms: "a numbered, personal, non-commercial copy"; "a license to a copy of a work, kept in your name". SCL 2.1 (personal), 2.3, 1, 9.3.
    hold = `${You} ${num}a numbered, personal copy of this work, kept in your name and recorded on the register.`.replace(/(No\. [^,]+), a numbered,/, '$1: a numbered,');
    may = `You may keep it and show it on your own accounts and devices, credited to ${maker}, and not for a business.`;
    stays = `The copyright stays with ${maker}, with every right not named here.`;
    pass = passLine(tt, maker, edition);
  } else {
    // SCL 1 (term, rights reserved), 2.1 (the uses paid for), 2.3 (credit), 2.4 (one company or client), 7.1, 9.3.
    const uses = K.RIGHTS.filter(r => tt.rights.includes(r.key)).map(r => r.phrase);
    hold = `${You} a license to use this work${use && use.name ? ` (${use.name})` : ''}, ${tt.term_months ? `for ${dur(tt.term_months)} from the day of your order` : 'with no end date'}.`;
    may = `You may use it ${uses.length ? `on ${list(uses)}` : 'as the agreement names'}, for ${tt.extras.includes('entities') ? 'more than one company or client' : 'yourself or one company or client'}, credited to ${maker}.`;
    stays = `The copyright stays with ${maker}, with every use not named here.`;
    pass = passLine(tt, maker, false);
  }
  return { kind, hold, may, stays, pass, text: [hold, may, stays, pass].join(' ') };
}
// SCL 9.3, as the order carries it: transferable "in whole and not in part, to one other person by a transfer recorded
// on the Watermark register", or not at all without the maker's written consent.
function passLine(tt, maker, edition) {
  if (!tt.transferable) return `It is not passed on: the license stays with you unless ${maker} agrees in writing.`;
  return `If you pass it on, it goes whole to one other person through the house: the register records it and it leaves your gallery.${edition ? ` ${marketLine(maker)}` : ''}`;
}

// The same four sentences as a block for a page. `tag` is p unless the place needs another; `attrs` for a page's own hooks.
function block(args, { tag = 'p', cls = '', attrs = '' } = {}) {
  const s = statement(args);
  return `<${tag} class="holds${cls ? ' ' + cls : ''}" data-holds="${s.kind}"${attrs ? ' ' + attrs : ''}><b>What you ${args.will ? 'will ' : ''}hold.</b> ${esc(s.text)}</${tag}>`;
}

// The same, for a license already made: its own stored terms decide (licenses.rights), its number, its work's edition.
function ofLicense(lic, use, w, maker, more = {}) {
  let t = null; try { t = lic && lic.rights ? JSON.parse(lic.rights) : null; } catch (e) { t = null; }
  const open = t && (t.open || (t.print && t.print.open)) ? (typeof t.open === 'string' ? t.open : (w && w.open) || 'pd') : null;
  return { use, t, maker, open, no: lic && lic.collector_no ? lic.collector_no : null, of: w && w.edition_size ? w.edition_size : null, edition: !!(w && w.edition_size && lic && lic.collector_no), ...more };
}

// At resale, to the holder who offers a piece (trade; terms "The market, trades and gifts").
function offering(maker = 'the maker') {
  const d = TR.holdDays();
  return `It stays in your gallery until it sells; then it passes whole to its new holder and leaves yours. ${pct(M().ROYALTY)} of the price goes to ${maker} and ${pct(M().FEE)} to the house.${d > 0 ? ` Its new holder may not offer it on the market for ${d} days.` : ''}`;
}

// Words a visitor never reads at these moments (Will's rule; test/holds.js holds the pages to it).
const NEVER = ['blockchain', 'token', 'nft', 'ledger', 'hash', 'cryptographic', 'on-chain', 'mint', 'wallet', 'bitcoin', 'opentimestamps'];

module.exports = { statement, block, ofLicense, offering, marketLine, kindOf, termsOf, NEVER };
