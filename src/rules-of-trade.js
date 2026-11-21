// The trade's own rules, kept by the machine (docs/MARKET.md, #165). Every number here is a draft for Will.
//   An edition, once one has sold, is never enlarged: its size may stay or come down to what is sold, never go up,
//   and a numbered edition with a sale is never opened again. By the maker and by the Studio alike.
//   A price, once one has sold at it, is never lowered in public: it may stay or rise.
//   A piece acquired less than MARKET_HOLD_DAYS ago (draft: 365) is not offered again; a gift is not a sale, so it
//   neither starts the clock nor is stopped by it.

// cur: the size now (null = open), want: the size asked for (null = open), sold: how many are sold.
function size(cur, want, sold) {
  if (!(sold > 0)) return want;
  if (cur == null) return want == null ? null : Math.max(want, sold); // an open edition with sales may be closed, never below what is sold
  if (want == null) return cur; // a numbered edition with a sale is never opened
  return Math.min(cur, Math.max(want, sold));
}
// cur and want in cents; with a sale, the price may stay or rise (a price with a sale is not taken away either).
function price(cur, want, sold) {
  if (!(sold > 0) || cur == null) return want;
  if (want == null) return cur;
  return Math.max(cur, want);
}
const holdDays = () => { const n = Number(process.env.MARKET_HOLD_DAYS); return Number.isFinite(n) && n >= 0 ? n : 365; };
// SQLite's datetime('now') text ('YYYY-MM-DD HH:MM:SS', UTC) or an ISO time → a Date.
const when = s => { if (!s) return null; const t = String(s); const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : t.replace(' ', 'T') + 'Z'); return isNaN(d) ? null : d; };
// soldAt: when the piece was last sold (its issue, or its last trade). liftedAt: when the Studio lifted its hold.
function heldUntil(soldAt, liftedAt, now = new Date()) {
  const s = when(soldAt); if (!s) return null;
  const l = when(liftedAt); if (l && l >= s) return null;
  const until = new Date(s.getTime() + holdDays() * 864e5);
  return until > now ? until : null;
}
module.exports = { size, price, holdDays, heldUntil, when };
