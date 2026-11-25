// A print order, as the person who bought the print reads it (#224). One place for the three things every page and
// letter about a bought print says: which print it is (its own number in its edition, never the work's collector
// number), where it is now, and when its maker is paid. The room (/yours/p/:ref), the certificate (/c/:ref), the
// thank-you page, the receipt letter and the line on /you all read from here, so they cannot drift.
// EVERY SENTENCE HERE IS A DRAFT FOR WILL. Nothing here moves money or changes when it clears: the rules are
// src/payouts.js's (a print taken by hand clears HOLD_DAYS after it is paid; any other print when it is sent).
const rightsOf = l => { try { return l && l.rights ? JSON.parse(l.rights) : null; } catch (e) { return null; } };

// The print of a licence row: null unless the order was for a print.
function printOf(l) { const t = rightsOf(l); return t && t.print ? t.print : null; }
// Its number in its edition: the order's own (the maker may write another when they sign it), else the papers'.
function numberOf(l, o) {
  const p = printOf(l) || {};
  const no = (o && o.edition_no) || p.no || null, of = p.edition_n || null;
  return { no, of, text: no ? `No. ${no}${of ? ` of ${of}` : ''}` : '' };
}
// The order a print licence was paid with (the newest, if the house ever wrote two).
function orderOf(db, l) {
  try { return db.prepare("SELECT id, kind, size, paper, framed, pickup, by_maker, edition_no, status, at FROM print_orders WHERE license_id=? AND kind IN ('edition','open') ORDER BY id DESC LIMIT 1").get(l.id) || null; } catch (e) { return null; }
}
// Where the print is, in a few words (the words the holder's room has used since #193).
function where(o, maker) {
  if (!o) return '';
  const m = o.by_maker ? (o.pickup
    ? { asked: `waiting with ${maker}, to take by hand`, making: `waiting with ${maker}, to take by hand`, done: 'in your hands' }
    : { asked: `with ${maker}, who makes and sends it`, making: `being made by ${maker}`, sent: `sent by ${maker}`, done: 'delivered' })
    : { asked: 'with the house', making: 'being printed', sent: 'sent', done: 'delivered' };
  return m[o.status] || String(o.status || '');
}
// When the maker is paid, as payouts.js clears it. Nothing is said for a print of an open work (no maker is paid).
function paidWhen(l, o, maker, holdDays = 7) {
  const p = printOf(l); if (!p || p.open || (o && o.kind === 'open')) return '';
  const hand = p.made === 'hand' || (o && o.by_maker && o.pickup);
  return hand
    ? `${maker}’s part clears ${holdDays} days after you paid and goes to them on the Friday after; they may keep the print until it has.`
    : `${maker}’s part clears when the print is sent, and goes to them on the Friday after.`;
}
// Everything a page needs, in one call.
function of(db, l, maker, holdDays = 7) {
  const p = printOf(l); if (!p) return null;
  const o = orderOf(db, l), n = numberOf(l, o), w = where(o, maker);
  const what = [o && o.size ? o.size : p.label ? `${p.label} in` : '', (o && o.paper) || p.paper || '', (o && o.framed) || p.framed ? 'framed' : ''].filter(Boolean).join(', ');
  return { o, print: p, no: n.no, of: n.of, number: n.text, what, where: w, paid: paidWhen(l, o, maker, holdDays) };
}
module.exports = { printOf, numberOf, orderOf, where, paidWhen, of };
