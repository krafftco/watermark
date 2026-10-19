// The register, read aloud. Every entry on the ledger is a moment in the life of the house: a photograph
// entering the archive, its first tip of the hat, a collector taking a number, a license going out, a
// trade, a name on the wall. Here each entry becomes a sentence in plain words with the photograph beside
// it, grouped by day. Private things (sign-ins, keys, seats' emails) are kept off the public stream;
// nothing on it names a person who did not choose to be named. The hash stays, small, for those who look.
const USE = { social: 'collected', reference: 'collected as the Reference', editorial: 'licensed for a story', commercial: 'licensed to a company', campaign: 'licensed for a campaign', print: 'ordered as a print' };
const HIDDEN = new Set(['client.licensed', 'print.asked', 'proof.collected', 'terms.accepted', 'terms.reviewed', 'terms.draft', 'backup.failed', 'studio.opened', 'studio.action', 'key.given', 'license.pass.asked', 'license.pass.kept', 'work.split', 'work.released', 'claim.received', 'claim.accepted', 'claim.declined', 'partner.added', 'partner.connected', 'partner.disconnected', 'comp.taken', 'trade.quote', 'curator.invited', 'license.checkout', 'license.undone', 'representation.earned', 'representation.ended', 'introduction.issued', 'cabinet.kept', 'showing.opened', 'curation.earned', 'pocket.cashed', 'dispute.opened', 'dispute.answered', 'dispute.dismissed', 'dispute.withdrawn', 'signin.email', 'collector.passkey', 'maker.passkey', 'license.seat', 'license.seat.claimed', 'license.seat.file', 'license.seat.removed', 'license.seats.added', 'market.refunded', 'license.undone', 'patron.ending', 'license.renewal_offered']);

function mountRegister(app, { db, V, ledger }) {
  const workBySlug = db.prepare("SELECT id, slug, title, maker_id, width, height, status FROM works WHERE slug=?");
  const workByRef = db.prepare("SELECT w.id, w.slug, w.title, w.maker_id, w.width, w.height, w.status, l.collector_no, u.key AS use_key FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id WHERE l.ref=?");
  const makerByHandle = db.prepare('SELECT id, name, handle FROM makers WHERE handle=?');
  const makerById = db.prepare('SELECT id, name, handle FROM makers WHERE id=?');
  const esc = V.esc, tidy = V.tidy, money = V.money;
  const T = w => (w ? `<a href="/w/${esc(w.slug)}"><i>${esc(tidy(w.title).replace(/[.\s]+$/, ''))}</i></a>` : 'a photograph');
  const by = w => { const m = w && makerById.get(w.maker_id); return m ? ` by ${V.mlink ? V.mlink(m.name) : esc(m.name)}` : ''; };
  const no = (w, d) => { const n = (w && w.collector_no) || (d && d.collector_no); return n ? `, No.&nbsp;${n}` : ''; };
  const data = e => { try { return JSON.parse(e.data || '{}'); } catch (x) { return {}; } };
  const HOUSE = { watermark: 'Watermark', krafft: 'Krafft', studios: 'Krafft Studios', advisory: 'Krafft Advisory', ventures: 'Krafft Ventures', dgc: 'Dallas Golf Club' };
  const LV = { friend: 'a Friend', patron: 'a Patron', benefactor: 'a Benefactor', medici: 'a Medici', once: 'a friend' };

  // One entry → { text, work, kind } or null when it stays private.
  function tell(e) {
    if (HIDDEN.has(e.type)) return null;
    const d = data(e), t = e.type;
    let w = d.work ? workBySlug.get(d.work) : null;
    if (!w && /^WM-/.test(e.subject)) w = workByRef.get(e.subject);
    if (!w) { const ws = workBySlug.get(e.subject); if (ws) w = ws; }
    if (w && w.status !== 'held') w = null; // a private or withdrawn work stays unnamed
    const k = { kind: 'life' };
    switch (t) {
      case 'work.registered': return { ...k, kind: 'birth', work: w, text: `${T(w)}${by(w)} entered the archive${d.accession ? `, ${esc(d.accession)}` : ''}.` };
      case 'work.published': return { ...k, kind: 'birth', work: w, text: `${T(w)}${by(w)} was shown for the first time.` };
      case 'work.bravo': return { ...k, kind: 'applause', work: w, text: `Someone called Bravo! for ${T(w)}.` };
      case 'work.applauded': return { ...k, kind: 'applause', work: w, text: `Someone tipped their hat to ${T(w)}.` };
      case 'work.guide': return { ...k, work: w, text: `${T(w)} received its wall text.` };
      case 'work.master': return { ...k, work: w, text: `${T(w)} received its master.` };
      case 'text.shelved': return { ...k, kind: 'birth', work: null, text: `<a href="/library/${esc(e.subject)}">${esc(d.title || e.subject)}</a> was shelved in the Library.` };
      case 'text.taken': return { ...k, kind: 'sale', work: null, text: `A copy of <a href="/library/${esc(e.subject)}">${esc(e.subject.replace(/-/g, ' '))}</a> was taken from the Library.` };
      case 'archive.issued': return { ...k, work: w, text: `The archival master of ${T(w)} was issued, with its papers.` };
      case 'maker.invited': return { ...k, kind: 'birth', work: null, text: `A maker was invited to the house.` };
      case 'work.terms': return { ...k, work: w, text: `The terms of ${T(w)} were set by its maker.` };
      case 'work.voice': return { ...k, work: w, text: `Someone spoke about ${T(w)}.` };
      case 'license.granted': {
        if (d.set) return { ...k, kind: 'collect', work: w, text: `A set of ${d.works ? d.works.length : 'several'} photographs was collected together.` };
        const u = USE[d.use || (w && w.use_key)] || 'licensed';
        return { ...k, kind: 'collect', work: w, text: `${T(w)}${by(w)} was ${u}${no(w, d)}.` }; }
      case 'license.requested': return { ...k, work: w, text: `A license was asked for ${T(w)}.` };
      case 'license.quoted': return { ...k, work: w, text: `Terms were offered for ${T(w)}.` };
      case 'license.declined': return { ...k, work: w, text: `A request for ${T(w)} was declined by its maker.` };
      case 'license.transferred': return { ...k, kind: 'trade', work: w, text: `${T(w)}${no(w, d)} passed to a new collector${d.how === 'trade' ? ', in a trade' : ''}.` };
      case 'file.delivered': return { ...k, work: w, text: `A copy of ${T(w)} went out under its license.` };
      case 'print.recorded': return { ...k, work: w, text: `A print of ${T(w)} was made${d.size ? `, ${esc(d.size)}` : ''}.` };
      case 'seal.created': return { ...k, work: w, text: `A sealed copy of ${T(w)} was made.` };
      case 'editions.set': return { ...k, text: 'Edition sizes were set across the collection.' };
      case 'market.offered': return { ...k, kind: 'trade', work: w, text: `${T(w)}${no(w, d)} was put up on the market${d.ask ? ` at ${money(d.ask)}` : ''}.` };
      case 'market.withdrawn': return { ...k, kind: 'trade', work: w, text: `${T(w)}${no(w, d)} was taken off the market.` };
      case 'market.bid': case 'market.offer': return { ...k, kind: 'trade', work: w, text: `An offer was made for ${T(w)}${no(w, d)}.` };
      case 'market.accepted': return { ...k, kind: 'trade', work: w, text: `An offer for ${T(w)}${no(w, d)} was accepted.` };
      case 'market.traded': return { ...k, kind: 'trade', work: w, text: `${T(w)}${no(w, d)} sold on the market${d.price ? ` for ${money(d.price)}` : ''}; the photographer received a royalty.` };
      case 'swap.offered': { const a = workBySlug.get(d.give), b = workBySlug.get(d.want); return { ...k, kind: 'trade', work: b || w, text: `A trade was offered: ${T(a)}, No.&nbsp;${d.give_no || '?'}, for ${T(b)}, No.&nbsp;${d.want_no || '?'}.` }; }
      case 'swap.declined': return { ...k, kind: 'trade', text: 'A trade was declined.' };
      case 'swap.traded': { const a = workBySlug.get(d.give), b = workBySlug.get(d.want); return { ...k, kind: 'trade', work: a || w, text: `${T(a)}, No.&nbsp;${d.give_no || '?'}, and ${T(b)}, No.&nbsp;${d.want_no || '?'}, changed hands in a trade.` }; }
      case 'payout.sent': return { ...k, kind: 'trade', text: 'A collector was paid their share.' };
      case 'tip.given': { const m = d.to ? makerByHandle.get(d.to) : null; return { ...k, kind: 'applause', text: `A tip${d.amount ? ` of ${money(d.amount)}` : ''} was left for ${m ? esc(m.name) : 'a maker'}${d.story ? ', for a story' : ''}.` }; }
      case 'gallery.signed': return { ...k, kind: 'applause', text: 'A visitor signed a collector’s guest book.' };
      case 'house.signed': return { ...k, kind: 'applause', text: `Someone signed the ${HOUSE[e.subject] || 'house'} guest book.` };
      case 'friend.joined': return { ...k, kind: 'patron', text: `${HOUSE[d.house] || 'The house'} gained ${LV[d.level] || 'a friend'}.` };
      case 'friend.gave': return { ...k, kind: 'patron', text: `A gift${d.amount ? ` of ${money(d.amount)}` : ''} was made to ${HOUSE[d.house] || 'the house'}.` };
      case 'keeping.begun': return { ...k, text: 'A maker entrusted a larger archive to the vault.' };
      case 'maker.introduced': return { ...k, kind: 'birth', text: `A new maker entered the house${d.by && /^maker:/.test(d.by) ? `, introduced by ${esc(d.by.slice(6))}` : d.by === 'house' ? ', introduced by the house' : ''}.` };
      case 'representation.began': return { ...k, kind: 'life', text: `${esc(d.gallery || 'A gallery')} now represents <a href="/m/${esc(e.ref)}">a maker of the house</a>.` };
      case 'show.opening': return { ...k, kind: 'life', text: `A show opens ${esc(d.opens || '')}: <a href="/hang/${esc(d.slug || '')}">${esc(d.title || 'a show')}</a>${d.venue ? ', at ' + esc(d.venue) : ''}.` };
      case 'hang.opened': return { ...k, kind: 'life', text: `A curator hung a wall: <a href="/hang/${esc(d.slug || '')}">${esc(d.title || 'a hang')}</a>.` };
      case 'balcony.night': { const bw = d.wall ? workBySlug.get(d.wall) : null; return { ...k, kind: 'applause', work: bw || null, text: `The balcony was open${d.host ? `, ${esc(d.host)} hosting` : ''}${bw ? `; on the wall, ${T(bw)}` : ''}; ${d.came === 1 ? 'one came' : `${d.came || 0} came`}. Nothing said was kept.` }; }
      case 'dispute.upheld': return { ...k, kind: 'life', text: 'A claim about a photograph was upheld by the house; it came down, and its holders were told.' };
      case 'keeping.moved': return { ...k, text: 'A maker moved their archive to a larger shelf.' };
      case 'maker.joined': { const m = makerByHandle.get(e.subject); return { ...k, kind: 'birth', text: `${m ? esc(m.name) : 'A maker'} opened a studio on Watermark.` }; }
      case 'maker.culled': return { ...k, text: 'A maker graded their archive and set the best in front.' };
      case 'copyright.prepared': return { ...k, kind: 'office', text: `${d.works === 1 ? 'A photograph was' : `${d.works || 'A group of'} photographs were`} prepared for registration with the U.S. Copyright Office.` };
      case 'copyright.filed': return { ...k, kind: 'office', text: 'A group of photographs was filed with the U.S. Copyright Office.' };
      case 'copyright.registered': return { ...k, kind: 'office', text: `${d.works === 1 ? 'A photograph was' : `${d.works || 'A group of'} photographs were`} registered with the U.S. Copyright Office${d.reg ? `, ${esc(d.reg)}` : ''}.` };
      default: return { ...k, text: `${esc(t.replace(/[._]/g, ' '))}.` };
    }
  }

  // Chapters of the register, so the stream can be read in scope and scale.
  const CHAPTERS = {
    arrivals: { name: 'Arrivals', types: ['work.registered', 'work.published', 'maker.joined', 'work.master', 'work.guide'] },
    applause: { name: 'Applause', types: ['work.bravo', 'work.applauded', 'gallery.signed', 'house.signed', 'tip.given', 'work.voice'] },
    collected: { name: 'Collected & licensed', types: ['license.granted', 'license.checkout', 'license.requested', 'license.quoted', 'license.declined', 'file.delivered', 'print.recorded', 'seal.created'] },
    trades: { name: 'Trades', types: ['license.transferred', 'market.offered', 'market.withdrawn', 'market.bid', 'market.offer', 'market.accepted', 'market.traded', 'swap.offered', 'swap.declined', 'swap.traded', 'payout.sent'] },
    patrons: { name: 'Patrons', types: ['friend.joined', 'friend.gave', 'keeping.begun', 'keeping.moved'] },
    office: { name: 'Copyright Office', types: ['copyright.prepared', 'copyright.filed', 'copyright.registered'] },
  };
  const SPANS = { today: ['Today', '-1 day'], week: ['This week', '-7 days'], month: ['This month', '-30 days'], year: ['This year', '-365 days'], all: ['All time', null] };
  app.get('/ledger', (req, res) => {
    const chapter = CHAPTERS[req.query.chapter] ? req.query.chapter : null, span = SPANS[req.query.span] ? req.query.span : 'all', order = req.query.order === 'oldest' ? 'ASC' : 'DESC';
    const where = [], args = [];
    if (chapter) { where.push(`type IN (${CHAPTERS[chapter].types.map(() => '?').join(',')})`); args.push(...CHAPTERS[chapter].types); }
    if (SPANS[span][1]) { where.push("at > datetime('now', ?)"); args.push(SPANS[span][1]); }
    const entries = db.prepare(`SELECT * FROM ledger ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY seq ${order} LIMIT 400`).all(...args);
    const told = entries.map(e => ({ e, line: tell(e) })).filter(x => x.line);
    const tally = Object.fromEntries(Object.entries(CHAPTERS).map(([k, c]) => [k, db.prepare(`SELECT COUNT(*) n FROM ledger WHERE type IN (${c.types.map(() => '?').join(',')})${SPANS[span][1] ? " AND at > datetime('now', ?)" : ''}`).get(...c.types, ...(SPANS[span][1] ? [SPANS[span][1]] : [])).n]));
    const counts = { all: db.prepare('SELECT COUNT(*) n FROM ledger').get().n, works: db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='work.registered'").get().n, collected: db.prepare("SELECT COUNT(*) n FROM ledger WHERE type IN ('license.granted')").get().n, hats: db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='work.applauded'").get().n };
    res.send(V.registerPage({ told, check: req.query.check === 'full' ? ledger.verifyAll(db) : ledger.verify(db), counts, chapters: CHAPTERS, chapter, spans: SPANS, span, order: order === 'ASC' ? 'oldest' : 'newest', tally }));
  });
  // The last few moments in the house, for the front door.
  // Launch fix 2.1: the same thing happening to the same photograph in a row is one line with a count.
  const GROUPED = { 'work.bravo': (n, w) => `${n} people called Bravo! for ${T(w)}.`, 'file.delivered': (n, w) => `${n} copies of ${T(w)} went out under its license.`, 'work.applauded': (n, w) => `${n} people tipped their hats to ${T(w)}.`,
    'license.granted': (n, w) => `${T(w)}${by(w)} was collected ${n} times.`, 'work.voice': (n, w) => `${n} people spoke about ${T(w)}.` };
  app.locals.lately = (n = 6) => {
    const out = [];
    for (const e of db.prepare('SELECT * FROM ledger ORDER BY seq DESC LIMIT 200').all()) {
      const line = tell(e); if (!line) continue;
      const key = e.type + '|' + (line.work ? line.work.slug : line.text), last = out[out.length - 1];
      if (last && last.key === key) { last.n++; continue; }
      if (out.length >= n) break;
      out.push({ e, line, key, n: 1 });
    }
    return out.map(x => x.n > 1 ? { e: x.e, line: { ...x.line, text: GROUPED[x.e.type] && x.line.work ? GROUPED[x.e.type](x.n, x.line.work) : `${x.line.text.replace(/\.$/, '')} (${x.n} times).` } } : { e: x.e, line: x.line });
  };
  return { tell };
}

module.exports = { mountRegister, HIDDEN };
