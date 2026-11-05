// The bridge to the U.S. Copyright Office. The Office has no public API for filing: registrations are
// made in its own system (eCO) by the author, the claimant or their authorised agent. So Watermark does
// everything around the filing: it groups the photographs the way the Office allows (up to 750 by one
// author, published in one calendar year; or unpublished), prepares the title list and the deposit
// copies, tracks each group from filed to registered, and once a registration number is entered it
// shows on every photograph in the group, with the badge, on the Shield and on the work's life.
// Fees as published by the Office (Oct 2026): $55 for a group of published or unpublished photographs.
const archiver = require('archiver');

const MAX = 750;
const FEE = 5500;

function mountCopyright(app, { db, C, maker, studioOnly, ledger, images, originalPath, cache, V, S }) {
  db.exec(`CREATE TABLE IF NOT EXISTS copyright_groups (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, year INTEGER, title TEXT, sr TEXT, reg TEXT,
    status TEXT NOT NULL DEFAULT 'prepared', created_at TEXT NOT NULL DEFAULT (datetime('now')), filed_at TEXT, registered_at TEXT)`);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='copyright_group'").get()) db.exec('ALTER TABLE works ADD COLUMN copyright_group INTEGER');

  // When a work was published, as the Office reads it (5 Nov). Copyright law's publication is distribution of copies
  // to the public: the first paid copy is the surest date; a work put on view and offered for Collect is very likely
  // published from that day; a work only ever kept back is unpublished. Read in two queries for a maker's works, so a
  // page of 750 never asks the database 1,500 times.
  const day = v => (v ? String(v).replace('T', ' ').slice(0, 10) : null);
  function pubMap(makerId) {
    const sold = {}, shown = {};
    for (const r of db.prepare("SELECT l.work_id id, MIN(l.created_at) at FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND COALESCE(l.price_cents,0)>0 AND l.status IN ('active','expired') GROUP BY l.work_id").all(makerId)) sold[r.id] = day(r.at);
    for (const r of db.prepare("SELECT g.subject slug, MIN(g.at) at FROM ledger g JOIN works w ON w.slug=g.subject WHERE w.maker_id=? AND g.type='work.published' GROUP BY g.subject").all(makerId)) shown[r.slug] = day(r.at);
    return w => {
      const a = sold[w.id], b = shown[w.slug] || (w.status === 'held' ? day(w.created_at) : null);
      if (a && (!b || a <= b)) return { date: a, how: 'sold', line: `first sold on ${a}` };
      if (b) return { date: b, how: 'shown', line: `on view and offered on Watermark since ${b}` };
      return null;
    };
  }
  // Photographs not yet in any group, sorted into the groups the Office accepts.
  function proposals() {
    const rows = db.prepare("SELECT id, slug, title, status, created_at, taken_at, open, artist_id, maker_id FROM works WHERE maker_id=? AND status IN ('held','hidden') AND copyright_group IS NULL AND (copyright_reg IS NULL OR copyright_reg='') ORDER BY created_at, id").all(maker.id).filter(w => registrable(w));
    const out = [];
    const byYear = {}, pub = pubMap(maker.id);
    for (const w of rows) {
      const p = pub(w);
      const key = p ? 'pub-' + p.date.slice(0, 4) : 'unpub';
      (byYear[key] = byYear[key] || []).push(w);
    }
    for (const [key, list] of Object.entries(byYear)) {
      for (let i = 0; i < list.length; i += MAX) {
        const chunk = list.slice(i, i + MAX);
        const pub = key !== 'unpub', year = pub ? Number(key.slice(4)) : null;
        out.push({ key: `${key}-${i / MAX + 1}`, kind: pub ? 'GRPPH' : 'GRUPH', year, works: chunk,
          label: pub ? `Published in ${year}` : 'Unpublished', part: list.length > MAX ? i / MAX + 1 : null });
      }
    }
    return out;
  }
  const groups = () => db.prepare('SELECT g.*, (SELECT COUNT(*) FROM works w WHERE w.copyright_group=g.id) n FROM copyright_groups g ORDER BY g.id DESC').all()
    .map(g => { if (g.status !== 'prepared') return g; const r = review(g); return { ...g, stops: r.stops, to_check: r.checks, ready: r.ready }; });

  // Before filing (5 Nov, Will: the people at the Office "eventually want to do this … they need help"). Every group is
  // read against the Office's rules for group registration of photographs, work by work, and said plainly: what stops
  // it (fix before filing), what to check (the Office may ask), and what the record already proves. The same reading is
  // written out as a packet in the shape of the group application, ready for the Office's coming registration system
  // and its API. The house's reading of published rules, not legal advice.
  const NAMEISH = /\.(jpe?g|tiff?|png|dng|heic)$|^(img|dsc|dscf|_?mg|l\d|p\d|joe|untitled)?[\s_-]*\d{3,}$/i;
  const AI = /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|algorithmicMedia/i;
  const credOf = w => { try { return w.credentials ? JSON.parse(w.credentials) : null; } catch (e) { return null; } };
  function checksOf(w, kind, year, pub) {
    const out = [], stop = l => out.push({ level: 'stop', line: l }), check = l => out.push({ level: 'check', line: l }), proof = l => out.push({ level: 'proof', line: l });
    const x = notOurs(w); if (x) stop(x.line);
    if (Number(w.disputed) > 0) stop('Under a claim: settle it before it is registered.');
    if (w.copyright_reg) stop(`Already registered, ${w.copyright_reg}.`);
    if (!w.title || !String(w.title).trim()) stop('No title: the Office lists every photograph by its title.');
    else if (NAMEISH.test(String(w.title).trim())) check(`The title reads as a file name (${String(w.title).trim()}); the Office takes it, but a title is a better record.`);
    const k = w.kind || 'photograph';
    if (k !== 'photograph') stop(`Recorded as a ${k}: group registration of photographs takes photographs only.`);
    const p = pub(w);
    if (kind === 'GRPPH') {
      if (!p) stop('Never published: it belongs in a group of unpublished photographs.');
      else if (year && Number(p.date.slice(0, 4)) !== Number(year)) stop(`Published in ${p.date.slice(0, 4)}, not ${year}: one calendar year a group.`);
      else if (p.how === 'shown') check(`Publication date from the house: ${p.line}. If it was first published elsewhere (Krafft Studios, a book, a client), that earlier date is the one to give.`);
      else proof(`Published: ${p.line}.`);
    } else {
      if (p && p.how === 'sold') stop(`It has been published (${p.line}): it belongs in a group of published photographs.`);
      else if (p) stop(`It has been on view and offered for sale since ${p.date}, which is very likely publication: file it with the published group of that year.`);
      if (!w.taken_at) check('No date of creation in the file; the arrival date is used. Confirm it.');
    }
    const c = credOf(w);
    if (c && AI.test(JSON.stringify(c))) stop('Its Content Credentials say generative AI made some of it: the AI-made part must be disclosed and excluded, so file it on its own, not in a group.');
    const ev = [w.camera ? `made with a ${w.camera}` : '', c && c.camera_signer ? `signed at capture by ${c.camera_signer}` : '', w.raw_file ? 'the raw negative kept in the vault' : ''].filter(Boolean);
    if (ev.length) proof(`Human authorship on the record: ${ev.join(', ')}.`); else check('No camera record in the file: be ready to show it is a photograph you made.');
    proof(`Fingerprinted on arrival (${String(w.sha256 || '').slice(0, 12)}…) and entered on the house's register.`);
    return out;
  }
  const rowsOf = gid => db.prepare('SELECT id, slug, title, status, created_at, taken_at, open, artist_id, maker_id, kind, disputed, copyright_reg, credentials, camera, raw_file, sha256, accession FROM works WHERE copyright_group=? ORDER BY created_at, id').all(gid);
  function review(g) {
    const ws = rowsOf(g.id), pub = pubMap(ws.length ? ws[0].maker_id : maker.id);
    const works = ws.map(w => ({ w, p: pub(w), checks: checksOf(w, g.kind, g.year, pub) }));
    const m = makerOf(ws.length ? ws[0].maker_id : maker.id);
    const group = [];
    if (works.length > MAX) group.push({ level: 'stop', line: `${works.length} photographs: the Office takes ${MAX} a group.` });
    if (!works.length) group.push({ level: 'stop', line: 'The group is empty.' });
    if (new Set(ws.map(w => w.maker_id)).size > 1) group.push({ level: 'stop', line: 'More than one author: a group is one author’s photographs.' });
    group.push({ level: 'proof', line: `One author and claimant: ${m.name || 'the maker'}.` });
    group.push({ level: 'check', line: 'eCO asks the claimant’s address and the author’s citizenship or domicile; the house does not keep them. Have them to hand.' });
    if (g.kind === 'GRPPH') group.push({ level: 'check', line: 'Not a work made for hire, and no earlier registration of these photographs: if either, ask counsel before filing.' });
    const dates = works.map(x => g.kind === 'GRPPH' ? (x.p && x.p.date) : day(x.w.taken_at || x.w.created_at)).filter(Boolean).sort();
    const stops = works.filter(x => x.checks.some(c => c.level === 'stop')).length + (group.some(c => c.level === 'stop') ? 1 : 0);
    return { g, m, works, group, stops, checks: works.filter(x => x.checks.some(c => c.level === 'check')).length, earliest: dates[0] || null, latest: dates[dates.length - 1] || null, ready: stops === 0 };
  }
  // The packet: the group application's fields, the title list and the deposit's files, with the reading beside each.
  function packet(g) {
    const r = review(g), pubd = g.kind === 'GRPPH';
    const years = r.works.map(x => Number(String(x.w.taken_at || x.w.created_at || '').slice(0, 4))).filter(Boolean);
    return { format: 'watermark.copyright-packet/1', made_at: new Date().toISOString(), office: 'U.S. Copyright Office',
      draft: 'Prepared by Watermark from its own record, in the shape of the Office’s group application for photographs. Not filed; not legal advice. Confirm every field before filing.',
      ready: r.ready, stops: r.stops, to_check: r.checks,
      application: { type: g.kind, name: pubd ? 'Group Registration for Published Photographs' : 'Group Registration for Unpublished Photographs', fee_usd: FEE / 100,
        title_of_group: g.title, number_of_photographs: r.works.length,
        author: { name: r.m.name || null, citizenship: null, domicile: null, work_made_for_hire: false, authorship: 'Photographs' },
        claimant: { name: r.m.name || null, address: null, transfer_statement: null },
        year_of_completion: years.length ? Math.max(...years) : null,
        ...(pubd ? { publication: { earliest: r.earliest, latest: r.latest, year: g.year, nation: 'United States' } } : { dates_of_creation: { earliest: r.earliest, latest: r.latest } }),
        limitation_of_claim: null, rights_and_permissions: { name: 'Watermark', email: process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com', url: C.base } },
      checks: r.group,
      photographs: r.works.map((x, i) => ({ n: i + 1, title: x.w.title, file_name: `${x.w.slug}.jpg`,
        ...(pubd ? { date_of_publication: x.p ? x.p.date : null, publication_basis: x.p ? x.p.how : null } : { date_of_creation: day(x.w.taken_at || x.w.created_at) }),
        accession: x.w.accession || null, master_sha256: x.w.sha256 || null, record: `${C.base}/w/${x.w.slug}`,
        checks: x.checks.map(c => ({ level: c.level, line: c.line })) })),
      deposit: { file: `copyright-group-${g.id}-deposit.zip`, format: 'JPEG, one a photograph, named as in the title list', url: `${C.base}/studio/copyright/${g.id}/deposit.zip` },
      status: { status: g.status, service_request: g.sr || null, registration: g.reg || null } };
  }
  app.locals.copyrightChecks = (w, kind) => { const pub = pubMap(w.maker_id); return checksOf(w, kind || (pub(w) ? 'GRPPH' : 'GRUPH'), null, pub); };
  app.get('/studio/copyright/:id/packet.json', studioOnly, (req, res) => {
    const g = db.prepare('SELECT * FROM copyright_groups WHERE id=?').get(Number(req.params.id)); if (!g) return res.sendStatus(404);
    res.set('Content-Disposition', `attachment; filename="copyright-group-${g.id}-packet.json"`).type('application/json').send(JSON.stringify(packet(g), null, 2));
  });
  app.get('/studio/copyright/:id', studioOnly, (req, res, next) => {
    if (!/^\d+$/.test(req.params.id)) return next();
    const g = db.prepare('SELECT * FROM copyright_groups WHERE id=?').get(Number(req.params.id)); if (!g) return res.redirect('/studio/copyright');
    res.send(S.copyrightGroup(review(g), { fee: FEE }));
  });
  app.get('/studio/copyright', studioOnly, (req, res) => {
    const reg = db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND copyright_reg IS NOT NULL AND copyright_reg!=''").get(maker.id).n;
    res.send(S.copyright({ proposals: proposals(), groups: groups(), reg, fee: FEE, notice: req.query.ok }));
  });
  // Prepare a group: the photographs are set aside for this filing.
  app.post('/studio/copyright/prepare', studioOnly, (req, res) => {
    const p = proposals().find(x => x.key === String((req.body || {}).key)); if (!p) return res.redirect('/studio/copyright');
    const id = db.prepare('INSERT INTO copyright_groups (kind, year, title) VALUES (?,?,?)').run(p.kind, p.year, `${maker.name}: ${p.label}${p.part ? `, part ${p.part}` : ''}`).lastInsertRowid;
    const set = db.prepare('UPDATE works SET copyright_group=? WHERE id=?'); p.works.forEach(w => set.run(id, w.id));
    ledger.append(db, 'copyright.prepared', `group-${id}`, { kind: p.kind, year: p.year, works: p.works.length });
    res.redirect('/studio/copyright?ok=' + encodeURIComponent(`Group prepared: ${p.works.length} photograph${p.works.length === 1 ? "" : "s"}. Download the title list and the deposit, then file it in eCO.`));
  });
  // The title list, in the order and form the group application asks for.
  app.get('/studio/copyright/:id/titles.csv', studioOnly, (req, res) => {
    const g = db.prepare('SELECT * FROM copyright_groups WHERE id=?').get(Number(req.params.id)); if (!g) return res.sendStatus(404);
    const ws = db.prepare('SELECT * FROM works WHERE copyright_group=? ORDER BY created_at, id').all(g.id), pub = pubMap(ws.length ? ws[0].maker_id : maker.id);
    const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [['Title', 'File name', g.kind === 'GRPPH' ? 'Publication date' : 'Date of creation', 'Accession'].map(q).join(',')]
      .concat(ws.map(w => [w.title, `${w.slug}.jpg`, g.kind === 'GRPPH' ? ((pub(w) || {}).date || day(w.created_at)) : String(w.taken_at || w.created_at).slice(0, 10), w.accession || ''].map(q).join(',')));
    res.set('Content-Disposition', `attachment; filename="copyright-group-${g.id}-titles.csv"`).type('text/csv').send(lines.join('\r\n'));
  });
  // The deposit: one JPEG for each photograph, named as in the title list.
  app.get('/studio/copyright/:id/deposit.zip', studioOnly, async (req, res) => {
    const g = db.prepare('SELECT * FROM copyright_groups WHERE id=?').get(Number(req.params.id)); if (!g) return res.sendStatus(404);
    const ws = db.prepare('SELECT * FROM works WHERE copyright_group=? ORDER BY created_at, id').all(g.id);
    res.set('Content-Disposition', `attachment; filename="copyright-group-${g.id}-deposit.zip"`).type('application/zip');
    const zip = archiver('zip', { zlib: { level: 0 } }); zip.on('error', e => { console.error('[copyright]', e.message); res.end(); }); zip.pipe(res);
    for (const w of ws) { try { zip.file(await images.derivativeOf(() => originalPath(w), cache, w.slug, 'screen'), { name: `${w.slug}.jpg` }); } catch (e) { /* missing original: left out */ } }
    zip.finalize();
  });
  app.post('/studio/copyright/:id', studioOnly, (req, res) => {
    const g = db.prepare('SELECT * FROM copyright_groups WHERE id=?').get(Number(req.params.id)); if (!g) return res.redirect('/studio/copyright');
    const b = req.body || {}, t = v => String(v || '').trim().slice(0, 40);
    if (b.act === 'filed' && t(b.sr)) {
      db.prepare("UPDATE copyright_groups SET sr=?, status='filed', filed_at=datetime('now') WHERE id=?").run(t(b.sr), g.id);
      ledger.append(db, 'copyright.filed', `group-${g.id}`, { sr: t(b.sr) });
    } else if (b.act === 'registered' && /^[A-Z]{1,4}\s?[A-Za-z0-9-]{3,}/i.test(t(b.reg))) {
      const reg = t(b.reg).toUpperCase();
      db.prepare("UPDATE copyright_groups SET reg=?, status='registered', registered_at=datetime('now') WHERE id=?").run(reg, g.id);
      db.prepare('UPDATE works SET copyright_reg=? WHERE copyright_group=?').run(reg, g.id);
      ledger.append(db, 'copyright.registered', `group-${g.id}`, { reg, works: db.prepare('SELECT COUNT(*) n FROM works WHERE copyright_group=?').get(g.id).n });
    } else if (b.act === 'release' && g.status === 'prepared') {
      db.prepare('UPDATE works SET copyright_group=NULL WHERE copyright_group=?').run(g.id);
      db.prepare('DELETE FROM copyright_groups WHERE id=?').run(g.id);
    }
    res.redirect('/studio/copyright');
  });
  // Where a photograph stands with the Office, in one line, for the work page and the Shield.
  // Copyright exists from the moment the photograph is made; registration is the public record of it.
  // What is not the house's (or the maker's) to register: the public domain, an open licence's holder, another
  // artist's work, a museum's collection. These are told plainly and never asked to be registered (5 Nov).
  const LIC = { 'cc-by': 'CC BY', 'cc-by-sa': 'CC BY-SA', 'cc-by-nc': 'CC BY-NC' };
  const makerOf = id => db.prepare('SELECT id, name, kind, handle FROM makers WHERE id=?').get(id) || {};
  function notOurs(w) {
    if (w.open === 'pd') return { state: 'open', line: 'In the public domain: there is no copyright in it to register, and a faithful photograph of it adds none.' };
    if (w.open === 'cc0') return { state: 'open', line: 'Dedicated to the public domain (CC0) by its holder: there is nothing to register.' };
    if (w.open && LIC[w.open]) return { state: 'open', line: `Shared by its holder under ${LIC[w.open]}; any registration is the holder’s, not the house’s.` };
    const m = makerOf(w.maker_id);
    if (w.artist_id) {
      const a = db.prepare('SELECT * FROM artists WHERE id=?').get(w.artist_id); let r = null; try { r = a && app.locals.art && app.locals.art.rights ? app.locals.art.rights(a, w) : null; } catch (e) { r = null; }
      if (r && r.state === 'pd') return { state: 'open', line: `${a.name}’s work is in the public domain: there is no copyright in it to register.` };
      if (a) return { state: 'artist', line: `The work is ${a.name}’s; its copyright, and any registration, are the artist’s or their estate’s.` };
    }
    if (m.kind === 'institution' || m.handle === 'the-public-domain') return { state: 'held', line: `Held in the collection of ${m.name}; any registration is the holder’s.` };
    return null;
  }
  const registrable = w => !notOurs(w);
  function stateOf(w) {
    if (!w.copyright_reg) { const x = notOurs(w); if (x) return x; }
    if (w.copyright_reg) return { state: 'registered', reg: w.copyright_reg, line: `Registered with the U.S. Copyright Office, ${w.copyright_reg}.` };
    const g = w.copyright_group ? db.prepare('SELECT * FROM copyright_groups WHERE id=?').get(w.copyright_group) : null;
    if (g && g.status === 'filed') return { state: 'filed', sr: g.sr, line: `Filed with the U.S. Copyright Office${g.filed_at ? ` on ${new Date(g.filed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}; registration pending${g.sr ? ` (service request ${g.sr})` : ''}.` };
    if (g) return { state: 'prepared', line: `Prepared for registration with the U.S. Copyright Office${g.title ? `, in the group ${g.title.replace(/^.*?: /, '')}` : ''}.` };
    return { state: 'none', line: 'Copyright held by the maker from the moment it was made; not yet registered with the U.S. Copyright Office.' };
  }
  app.locals.copyrightState = stateOf; app.locals.copyrightRegistrable = registrable;
  // The public account of the bridge, for the Office and for anyone who asks how it works.
  app.get('/copyright', (req, res) => {
    const n = { registered: db.prepare("SELECT COUNT(*) n FROM works WHERE copyright_reg IS NOT NULL AND copyright_reg!=''").get().n,
      filed: db.prepare("SELECT COUNT(*) n FROM works w JOIN copyright_groups g ON g.id=w.copyright_group WHERE g.status='filed'").get().n,
      held: db.prepare("SELECT COUNT(*) n FROM works WHERE status='held'").get().n, groups: db.prepare("SELECT COUNT(*) n FROM copyright_groups WHERE status='registered'").get().n,
      prepared: db.prepare("SELECT COUNT(*) n FROM works w JOIN copyright_groups g ON g.id=w.copyright_group WHERE g.status='prepared' AND (w.copyright_reg IS NULL OR w.copyright_reg='')").get().n };
    res.send(V.copyrightPage({ n, fee: FEE, max: MAX }));
  });
  return { proposals, groups, stateOf, review, packet };
}

module.exports = { mountCopyright, MAX, FEE };
