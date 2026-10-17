// The atelier. Inside every studio, the house keeps what a working photographer needs to grow: how to scan,
// how to catalogue, how to develop, how to register and price and license, how to look. Written in the house's
// voice, plain and exact, the way Leica's own guides or a museum's conservation notes are written; the Studio
// edits them; makers read them from their rail. Every guide is a draft until Will confirms it. The books
// behind them live in the Library.
const { layout, esc, setDeskPath } = require('./views');

const SECTIONS = [['craft', 'The craft'], ['archive', 'The archive'], ['business', 'The business'], ['looking', 'Looking']];

const SEED = [
  { slug: 'scanning-film', section: 'craft', title: 'Scanning film so it lasts', summary: 'One scan, done properly, is the archive. How to make it.', body: `Scan once, at the highest quality you can afford, and never again. The scan is the master; everything else is made from it.

**The scanner.** A dedicated film scanner (a Plustek or a Nikon Coolscan, used) or a camera scan with a macro lens and a copy stand. A camera scan with a 40-megapixel body and a good light panel beats most flatbeds for 35 mm; a flatbed (Epson V850) is fine for medium and large format.

**Resolution.** For 35 mm, 4,000 to 5,000 ppi: a frame becomes roughly 5,500 by 3,700 pixels, 20 megapixels, enough for a 16 by 24 print. Medium format at 3,200 ppi. More than that is grain, not detail.

**Bit depth and colour.** Scan to 16-bit TIFF, not JPEG. Keep the raw scan flat; set black and white points in the editor, not in the scanner software, and keep the untouched scan beside the edited one.

**Dust.** Clean the film with a blower, never a cloth. Scan with the emulsion side down. Spot in software, lightly; a little dust is a photograph, a lot is a scan.

**Naming.** Roll, frame, date: \`2024-09-florence-r03-f17.tif\`. The name should say where it came from without opening it. Then put it in the house: the fingerprint, the register and the mark do the rest.

**Keep the negatives.** In archival sleeves, in a box, in the dark, cool and dry. The scan is the master for the world; the negative is the master for you.` },
  { slug: 'cataloguing-an-archive', section: 'archive', title: 'Cataloguing an archive', summary: 'Accession numbers, titles, places, the few fields that matter, and the grade.', body: `A museum catalogues so that a work can be found in a hundred years by someone who never met the maker. Do the same for your own work, now, while you remember.

**The accession number.** The house gives every photograph one on arrival (WM.2026.0007). Keep it. It is the name that never changes, however the title does.

**The title.** Short, specific, in title case; the house sets the case and keeps your wording. *The Lamb*, not *Stained glass lamb window in Florence church IMG_4471*. If it is untitled, say so: *Untitled (Arno, Dusk)*.

**Place and date.** The place as a person would say it: Florence, Italy. The date the photograph was made, from the camera when it knows, by hand when it does not. A year is better than nothing.

**Medium and dimensions.** Digital photograph, or gelatin silver print, or scan from Kodak Portra 400 negative. Pixel dimensions are recorded for you; for prints, the sheet and the image in centimetres.

**Keywords.** Five, not fifty. What is in the picture, where, and the series it belongs to.

**The grade.** One to five stars, and the five are the jewels. Grade everything; the grade is how the house knows what to show first, and the cull is how the edit gets better. A catalogue with no grades is a pile.

**The credit line.** How you want to be named beside the work. It travels with every file the house delivers.` },
  { slug: 'developing-black-and-white', section: 'craft', title: 'Developing black and white at home', summary: 'A kitchen, a changing bag, a tank and twenty minutes. The method that does not vary.', body: `Black and white is the film you can develop yourself, reliably, with nothing more than a tank, a changing bag, a thermometer and a kitchen sink. Colour (C-41) is possible at home but demands tight temperature control; send it out until you have a reason not to.

**What you need.** A daylight tank with reels (Paterson), a changing bag, a thermometer, three measuring jugs, a timer, and the chemistry: developer (Kodak HC-110 or Ilford ID-11 for a start), stop bath, fixer, and a wetting agent. Gloves. Work where there is running water and air.

**Loading.** In the changing bag, in total darkness: open the cassette, trim the leader square, feed the film onto the reel, into the tank, lid on. Practise with a sacrificed roll in daylight first; your hands will learn it in two tries.

**The method.** Everything at 20 °C. Developer for the time on the chart for your film and dilution (the Massive Dev Chart has them all); agitate for the first thirty seconds, then four inversions every minute. Stop bath for thirty seconds. Fixer for five minutes. Wash: fill and empty the tank, five inversions, then ten, then twenty. Wetting agent for thirty seconds. Hang to dry in a dust-free room with a clip at the bottom.

**Consistency.** Same film, same developer, same time, same temperature, every roll, until you know exactly what your negatives look like. Then change one thing at a time.

**Safety.** Chemistry away from food, gloves on, the room ventilated, used fixer taken to a collection point (it carries silver), never down the drain.` },
  { slug: 'registering-your-copyright', section: 'business', title: 'Registering your copyright', summary: 'Why the U.S. registration matters, what it costs, and how the house does most of it.', body: `You own the copyright in a photograph the moment you make it. Registration with the U.S. Copyright Office is what lets you enforce it: statutory damages and attorney's fees are available only for work registered before the infringement, or within three months of first publication.

**Groups.** The Office lets a photographer register up to 750 published photographs from one calendar year in one application (GRPPH), or unpublished ones (GRUPH), for one fee ($55 as of this writing). That is how a working archive is registered: in batches, by year.

**What the house does.** Studio → Copyright groups your work the Office's way, writes the title list, and packs the deposit ZIP. You file the application on the Office's site with those two files, pay, and come back with the service request number; when the certificate arrives, enter the VA number and the house writes it onto every work in the group, on its page, on the Shield, and in every file it delivers.

**When.** Register a year's published work within three months of its first publication where you can; register everything else once a year.

**Elsewhere.** Copyright is automatic in every country that signed the Berne Convention; registration is a U.S. particular. Your work is protected abroad without it.

This is the house's understanding, not legal advice; a lawyer who knows copyright is worth one conversation a year.` },
  { slug: 'pricing-and-licensing', section: 'business', title: 'Pricing and licensing', summary: 'What a use is worth, how to set a price you can hold, and what to never allow.', body: `A price is a statement about the work and the use. Set it once, hold it, and change it on purpose.

**By use, not by file.** The same photograph is worth $5 to a person who wants it on their phone and $2,500 to a company putting it before an audience. The house sells by use: Collect, In a story, For a company, Before an audience, On a wall. Price each; the file is the same.

**Anchors.** Collect at $5 is the house's: small enough to be a reflex, numbered so it means something. For the working uses, the house's drafts (a story $350, a company $750, an audience $2,500, a wall $250) are a floor for a working photographer; raise them as your standing does. A price you are embarrassed by is wrong in both directions.

**Editions.** Limit the Collect edition on your jewels (25, 50, 100) and let the ladder raise the price as it fills. Scarcity is honest when the number is on the register.

**The never list.** Every work carries what you will never allow: AI training, merchandise, political use, whatever you choose. Set it on the work's terms. It travels in the contract and in the file.

**Approval.** For uses you want to see first, turn on approval: the buyer asks, you answer, the house takes the payment when you say yes.

**What you keep.** 85% of every sale. The rest keeps the house open.` },
  { slug: 'looking-at-photographs', section: 'looking', title: 'How to look at a photograph', summary: 'The eye is trained by looking. A short course, and the books behind it.', body: `Photographers get better by looking harder at other people's photographs than at their own. The house's viewing room is built for this; so is a museum; so is a book on a table.

**Stand in front of it.** Longer than is comfortable. Say what is in the frame before saying what it means. Where is the light coming from. What is at the edges. What was left out.

**Then ask the four questions.** What did the photographer see. Where did they stand. When did they press. What did they do afterwards (the crop, the print, the sequence). Every photograph is those four decisions.

**Sequence.** A photograph alone is a sentence; a sequence is an argument. Study books, not feeds: *The Americans* (Frank), *The Decisive Moment* (Cartier-Bresson), *Uncommon Places* (Shore), *Sleeping by the Mississippi* (Soth). Notice the order, the pairs across a spread, the pauses.

**History, briefly.** Niépce and Daguerre (the 1820s–30s); Julia Margaret Cameron and the first portraits; Atget's Paris; Stieglitz and the argument that photography is art; the FSA (Evans, Lange); Cartier-Bresson and the moment; the New York school (Frank, Klein, Arbus, Winogrand); the New Topographics and colour (Eggleston, Shore); the Düsseldorf school (the Bechers, Gursky, Struth); and the present, which you are part of.

**Read.** Szarkowski, *Looking at Photographs* and *The Photographer's Eye*. Sontag, *On Photography*. Barthes, *Camera Lucida*. Berger, *Ways of Seeing*. The Library here holds what the house can hold; the rest is in every good bookshop.

**Write.** A line in the guest book under a photograph you stood in front of is the beginning of a critic's eye. The maker may mark it well seen.` },
  { slug: 'the-professional-archive', section: 'archive', title: 'Professionalising your archive', summary: 'Three copies, two places, one register: the practice that keeps a life\'s work.', body: `The difference between a pile of files and an archive is a practice you keep every week.

**Three, two, one.** Three copies of every master; on two kinds of storage; one of them somewhere else. The house is one of the three: the original in the vault, fingerprinted, with its fixity checked on a schedule and the register saying when it arrived.

**Masters and derivatives.** The master is the file you would hand to a museum: the raw, the 16-bit scan, the full-resolution original. Derivatives (the JPEG for the web, the print file) are made from it and can be made again. Name them so you can tell them apart; never overwrite a master.

**Fixity.** A file can rot without anyone touching it. The house re-hashes every original on a schedule and tells you if one changes. Do the same at home once a year with a checksum tool.

**The edit.** Grade everything, cull hard, show the best. An archive that shows 60 of 2,000 is more valuable than one that shows all 2,000. Your standing in the house follows the same rule.

**The paperwork.** Model releases for identifiable people; the copyright registration by year; the contract for every license (the house writes it); a will that says who inherits the archive and the rights. Estates are makers here too.

**The archival master.** Any photograph can leave the house as a .wmark: the original byte for byte, the signed manifest, the register extract, the certificate of deposit. That is the file to give a museum, a lawyer, or your children.` },
];

function mountAtelier(app, { db, isStudio, makerOf, V }) {
  db.exec(`CREATE TABLE IF NOT EXISTS guides (id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, section TEXT NOT NULL, title TEXT NOT NULL, summary TEXT, body TEXT NOT NULL, by TEXT, status TEXT NOT NULL DEFAULT 'draft', sort INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const ins = db.prepare('INSERT OR IGNORE INTO guides (slug, section, title, summary, body, by, sort) VALUES (?,?,?,?,?,?,?)');
  SEED.forEach((g, i) => ins.run(g.slug, g.section, g.title, g.summary, g.body, 'The house', i));
  const all = () => db.prepare('SELECT * FROM guides ORDER BY sort, id').all();
  const one = s => db.prepare('SELECT * FROM guides WHERE slug=?').get(String(s));
  const admitted = req => !!(makerOf(req) || isStudio(req));

  app.get('/account/atelier', (req, res) => { if (!admitted(req)) return res.redirect('/signin?next=/account/atelier'); res.send(atelierPage({ guides: all(), studio: isStudio(req) })); });
  app.get('/account/atelier/:slug', (req, res) => { if (!admitted(req)) return res.redirect(`/signin?next=/account/atelier/${req.params.slug}`); const g = one(req.params.slug); if (!g) return res.sendStatus(404); res.send(guidePage({ g, guides: all(), studio: isStudio(req), ok: req.query.ok || null })); });
  app.post('/studio/atelier/:slug', (req, res) => {
    if (!isStudio(req)) return res.redirect('/studio/login'); const x = req.body || {};
    if (x.do === 'new') { const slug = String(x.slug || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60); if (!slug || one(slug)) return res.redirect('/account/atelier'); ins.run(slug, SECTIONS.some(s => s[0] === x.section) ? x.section : 'craft', String(x.title || slug).slice(0, 120), null, String(x.body || 'Write it.').slice(0, 40000), 'The house', 99); return res.redirect(`/account/atelier/${slug}?ok=new`); }
    const g = one(req.params.slug); if (!g) return res.sendStatus(404);
    db.prepare("UPDATE guides SET title=?, section=?, summary=?, body=?, by=?, status=?, updated_at=datetime('now') WHERE id=?").run(String(x.title || g.title).slice(0, 120), SECTIONS.some(s => s[0] === x.section) ? x.section : g.section, String(x.summary || '').slice(0, 300) || null, String(x.body || g.body).slice(0, 40000), String(x.by || g.by || '').slice(0, 120) || null, x.status === 'confirmed' ? 'confirmed' : 'draft', g.id);
    res.redirect(`/account/atelier/${g.slug}?ok=saved`);
  });
  app.locals.atelier = { all, one, SECTIONS };
}

// Plain prose with **bold**, `code`, and paragraphs; nothing else, so the text stays text.
const prose = t => String(t).split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*([^*]+)\*/g, '<i>$1</i>')}</p>`).join('');

function atelierPage({ guides, studio }) {
  setDeskPath('/account/atelier');
  return layout({ title: 'The atelier · Watermark', studio: true, body: `<section class="studio-wrap at"><p class="k">Your studio</p><h1>The atelier.</h1>
<p class="lede">What the house knows about the work: scanning, cataloguing, developing, registering, pricing, looking. Written plainly, kept current, yours to read. The books behind it are in the <a href="/library">Library</a>.</p>
${SECTIONS.map(([k, name]) => { const gs = guides.filter(g => g.section === k); return gs.length ? `<section class="at-sec"><header class="gh"><h2>${esc(name)}</h2><span>${gs.length}</span></header><div class="at-grid">${gs.map(g => `<a class="at-card" href="/account/atelier/${esc(g.slug)}"><b>${esc(g.title)}</b><span>${esc(g.summary || '')}</span><small>${g.status === 'confirmed' ? 'The house' : 'A draft'}${g.by && g.status === 'confirmed' ? ` · ${esc(g.by)}` : ''}</small></a>`).join('')}</div></section>` : ''; }).join('')}
${studio ? `<details class="hg-edit"><summary>Write a new guide</summary><form method="post" action="/studio/atelier/new" class="cl-f"><input type="hidden" name="do" value="new"><label><span>Slug</span><input name="slug" required maxlength="60"></label><label><span>Title</span><input name="title" required maxlength="120"></label><label><span>Section</span><select name="section">${SECTIONS.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('')}</select></label><label><span>Text (paragraphs; **bold**, *italic*)</span><textarea name="body" rows="8"></textarea></label><button class="buy-btn">Write it</button></form></details>` : ''}</section>` });
}
function guidePage({ g, guides, studio, ok }) {
  setDeskPath('/account/atelier');
  const sec = (SECTIONS.find(s => s[0] === g.section) || [])[1] || g.section;
  const next = guides[(guides.findIndex(x => x.id === g.id) + 1) % guides.length];
  return layout({ title: `${g.title} · The atelier · Watermark`, studio: true, body: `<section class="studio-wrap at-g"><p class="k"><a href="/account/atelier">The atelier</a> · ${esc(sec)}</p><h1>${esc(g.title)}</h1>${g.summary ? `<p class="lede">${esc(g.summary)}</p>` : ''}
${ok ? `<p class="ok">${ok === 'new' ? 'Written.' : 'Saved.'}</p>` : ''}
<article class="at-body">${prose(g.body)}</article>
<p class="at-foot">${g.status === 'confirmed' ? `By ${esc(g.by || 'the house')}.` : 'A draft by the house; to be confirmed.'} ${next && next.id !== g.id ? `Next: <a href="/account/atelier/${esc(next.slug)}">${esc(next.title)}</a>.` : ''}</p>
${studio ? `<details class="hg-edit"><summary>Edit this guide</summary><form method="post" action="/studio/atelier/${esc(g.slug)}" class="cl-f"><label><span>Title</span><input name="title" value="${esc(g.title)}" maxlength="120"></label><label><span>Section</span><select name="section">${SECTIONS.map(([k, n]) => `<option value="${k}"${g.section === k ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label><label><span>Summary</span><input name="summary" value="${esc(g.summary || '')}" maxlength="300"></label><label><span>Text</span><textarea name="body" rows="18">${esc(g.body)}</textarea></label><label><span>By</span><input name="by" value="${esc(g.by || '')}" maxlength="120"></label><label class="cl-oath"><input type="checkbox" name="status" value="confirmed" ${g.status === 'confirmed' ? 'checked' : ''}> Confirmed: no longer a draft</label><button class="buy-btn">Save</button></form></details>` : ''}</section>` });
}

module.exports = { mountAtelier, SECTIONS, SEED };
