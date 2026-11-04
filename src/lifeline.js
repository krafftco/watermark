// The line beside a name (Will, 4 Nov: "show something next to the name… living and dead… if they're alive, active,
// and how long they've been producing work"; "real email, real face, real name, real paid… the most human version of
// social media"). After the museum's wall label, which everyone already reads:
//   the dead:   Winslow Homer (1836–1910)
//   the living: Will Fullerton (b. 1991)     when the maker chooses to show the year (makers.born_show)
//               Will Fullerton · making since 2014   otherwise, from their earliest dated work
//   at work:    a small gold dot, 'at work', when something of theirs went up in the last AT_WORK_DAYS (30)
//   Verified:   a real email, a real face (a portrait) and a real name checked by Stripe for payouts (the bank told).
// Museums, companies and the public-domain shelf carry their name alone. Nothing here is a count.

function mountLifeline(app, { db, V }) {
  const { esc } = V;
  for (const [c, d] of [['born', 'INTEGER'], ['born_show', 'INTEGER NOT NULL DEFAULT 0']]) {
    try { if (!db.prepare("SELECT 1 FROM pragma_table_info('makers') WHERE name=?").get(c)) db.exec(`ALTER TABLE makers ADD COLUMN ${c} ${d}`); } catch (e) { /* made */ }
  }
  const DAYS = +(process.env.AT_WORK_DAYS || 30);
  const cache = new Map(); // maker id → { at, v }
  const PEOPLE = new Set(['maker', 'writer', null, undefined, '']);

  function of(m) {
    if (!m || !m.id) return null;
    const c = cache.get(m.id); if (c && Date.now() - c.at < 300e3) return c.v;
    let v = { person: PEOPLE.has(m.kind) };
    if (v.person) {
      try {
        const r = db.prepare(`SELECT MIN(substr(taken_at,1,4)) since, MAX(created_at) last FROM works WHERE maker_id=? AND status='held'`).get(m.id) || {};
        const since = +r.since; v.since = since > 1800 && since <= new Date().getFullYear() ? since : null;
        v.atWork = !!(r.last && (Date.now() - Date.parse(String(r.last).replace(' ', 'T') + 'Z')) < DAYS * 864e5);
        const born = +m.born; v.born = m.born_show && born > 1900 ? born : null;
        const told = db.prepare("SELECT 1 FROM settings WHERE k LIKE ?").get(`bank_told_${m.id}_%`);
        v.verified = !!(m.email && m.portrait && told);
      } catch (e) { /* quiet */ }
    }
    cache.set(m.id, { at: Date.now(), v }); return v;
  }
  // The line as HTML, to sit right after the name.
  function html(m) {
    const v = of(m); if (!v || !v.person) return '';
    const bits = [];
    if (v.born) bits.push(`<span class="lfl-y">(b. ${v.born})</span>`); else if (v.since) bits.push(`<span class="lfl-y">making since ${v.since}</span>`);
    if (v.atWork) bits.push('<span class="lfl-w" title="Put up new work in the last month">at work</span>');
    if (v.verified) bits.push('<span class="lfl-v" title="A real person: their email, their face, and their name checked for payouts">Verified</span>');
    return bits.length ? ` <span class="lfl">${bits.join('')}</span>` : '';
  }
  // The same in words, for Wander's plate (the client builds its own markup).
  function text(m) {
    const v = of(m); if (!v || !v.person) return null;
    return { years: v.born ? `b. ${v.born}` : v.since ? `since ${v.since}` : null, atWork: !!v.atWork, verified: !!v.verified };
  }
  // An artist of the hall: their dates, the museum's way.
  const dateWords = a => (a && a.died ? `${a.born || '?'}–${a.died}` : a && a.born ? `b. ${a.born}` : null);
  const dates = a => { const d = dateWords(a); return d ? ` <span class="lfl"><span class="lfl-y">(${d})</span></span>` : ''; };
  const forget = id => cache.delete(id);
  const api = { of, html, text, dates, dateWords, forget };
  app.locals.lifeline = api; if (V.setLifeline) V.setLifeline(api);
  return api;
}

module.exports = { mountLifeline };
