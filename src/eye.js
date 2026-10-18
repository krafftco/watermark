// See the watermark (Will, 18 Oct): the watermark is not a stamp on the picture; it is what the picture carries.
// Who made it, its number, who holds the copyright, how the maker is paid, who holds it now, how to have it,
// and the proof. The eye on every photograph opens it. Nothing personal: holders are counted, never named.
function mountEye(app, { db, V }) {
  const MONEY = c => V.money(c);
  app.get('/api/eye/:slug', (req, res) => {
    const w = db.prepare('SELECT * FROM works WHERE slug=?').get(String(req.params.slug));
    if (!w || w.status !== 'held') return res.status(404).json({ none: true });
    const j = app.locals.workJSON(w);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id) || {};
    const holders = db.prepare("SELECT COUNT(DISTINCT COALESCE(buyer_id, -id)) n FROM licenses WHERE work_id=? AND status IN ('active','expired') AND price_cents > 0").get(w.id).n;
    const working = db.prepare("SELECT COUNT(*) n FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.work_id=? AND l.status='active' AND u.key NOT IN ('social','reference')").get(w.id).n;
    const first = (m.name || j.maker.name || '').split(' ')[0];
    const share = m.share_pct || 85;
    const never = { ai: 'Training AI', alter: 'Altering the picture', political: 'Political campaigns', sensitive: 'Tobacco, firearms or gambling' };
    res.set('Cache-Control', 'no-store').json({
      slug: w.slug, title: j.title, number: j.id, maker: j.maker.name, makerHref: `/m/${j.maker.slug}`, place: j.place, year: j.year,
      copyright: j.copyright.registered ? `© ${j.maker.name}. Registered with the U.S. Copyright Office${j.copyright.registration ? `, ${j.copyright.registration}` : ''}.` : `© ${j.maker.name}, from the moment it was made.`,
      paid: `${share}% of every sale goes to ${first}.`,
      held: holders ? `${holders} ${holders === 1 ? 'person holds' : 'people hold'} it${working ? `; ${working} licensed to use it now` : ''}.` : 'No one holds it yet.',
      uses: (j.uses || []).map(u => ({ name: u.name, price: u.price_cents != null && u.instant ? MONEY(u.price_cents) : 'Ask', href: `/license/${w.slug}?use=${u.key}` })),
      never: (j.rules && j.rules.never || []).map(k => never[k] || k),
      proof: j.register ? `Fingerprinted and entered in the register, No. ${j.register.entry}, ${new Date(j.register.registered_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.` : 'Fingerprinted on arrival.',
      life: `/w/${w.slug}/life`, verify: '/verify', open: j.open || null,
    });
  });
}
module.exports = { mountEye };
