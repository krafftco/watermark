// IIIF (Will, 19 Oct: build what museums need so they plug straight in; the Met should use this platform, not build
// its own). Museums already speak IIIF: every serious collection publishes Presentation manifests and serves
// pictures through the Image API. So Watermark takes a manifest URL and brings a collection in (every canvas
// becomes a held work, its full-size picture fetched once, fingerprinted, sealed in the vault, registered), and
// answers the Image API for every held work, so a museum's own viewers (Mirador, UV) can show what is kept here.
// Import: Studio → Accounts → an institution (or any maker) → 'Bring in a IIIF manifest'. Works arrive held back
// ('hidden') for the institution to review unless 'show at once' is ticked; an open licence (pd, cc0…) may be set
// on all of them. Image API out: /iiif/:slug/info.json (level 0: the sizes the house keeps) and
// /iiif/:slug/full/{max|full|w,}/0/default.jpg. The public page: /museums.
const fs = require('fs');
const path = require('path');
const os = require('os');

const str = v => { if (v == null) return ''; if (typeof v === 'string') return v; if (Array.isArray(v)) return str(v[0]); if (typeof v === 'object') { const k = Object.keys(v)[0]; return k ? str(v[k]) : ''; } return String(v); };
const lang = v => { if (v && typeof v === 'object' && !Array.isArray(v)) { const k = v.en || v.none || v[Object.keys(v)[0]]; return str(k); } return str(v); };

// Reads a Presentation 2 or 3 manifest into { label, summary, items: [{ id, label, summary, image, meta }] }.
function parseManifest(m) {
  if (!m || typeof m !== 'object') throw new Error('Not a manifest.');
  const out = { label: lang(m.label), summary: lang(m.summary || m.description), items: [] };
  const imageOf = (svc, resource) => {
    const s = Array.isArray(svc) ? svc[0] : svc; const id = s && (s.id || s['@id']);
    if (id) { const profile = str(s.profile || s.type || s['@type']); const v3 = /ImageService3/.test(profile) || /ImageService3/.test(str(s.type)); return `${id.replace(/\/$/, '')}/full/${v3 ? 'max' : 'full'}/0/default.jpg`; }
    return resource && (resource.id || resource['@id']) || null;
  };
  const metaOf = md => (Array.isArray(md) ? md.map(x => ({ label: lang(x.label), value: lang(x.value) })).filter(x => x.label) : []);
  if (Array.isArray(m.items)) { // v3
    for (const c of m.items) {
      if (!c || (c.type && c.type !== 'Canvas')) continue;
      let body = null;
      for (const ap of (c.items || [])) for (const an of (ap.items || [])) { const b = Array.isArray(an.body) ? an.body[0] : an.body; if (b && (b.type === 'Image' || /image/i.test(str(b.format)))) { body = b; break; } }
      if (!body) continue;
      out.items.push({ id: c.id, label: lang(c.label) || lang(m.label), summary: lang(c.summary), image: imageOf(body.service, body), meta: metaOf(c.metadata), width: c.width, height: c.height });
    }
  } else if (Array.isArray(m.sequences)) { // v2
    for (const c of (m.sequences[0].canvases || [])) {
      const im = (c.images || [])[0]; const r = im && im.resource; if (!r) continue;
      out.items.push({ id: c['@id'], label: str(c.label) || str(m.label), summary: str(c.description), image: imageOf(r.service, r), meta: metaOf(c.metadata), width: c.width, height: c.height });
    }
  } else throw new Error('No canvases in this manifest.');
  out.items = out.items.filter(i => i.image);
  out.meta = metaOf(m.metadata);
  return out;
}

function mountIIIF(app, { db, V, C, registerWork, studioOnly, fetchImpl, images, ledger }) {
  const { esc } = V;
  const doFetch = (...a) => (fetchImpl || fetch)(...a);
  db.exec(`CREATE TABLE IF NOT EXISTS iiif_imports (id INTEGER PRIMARY KEY, maker_id INTEGER NOT NULL, url TEXT NOT NULL, label TEXT, status TEXT NOT NULL DEFAULT 'queued',
    n INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, open TEXT, show INTEGER NOT NULL DEFAULT 0,
    note TEXT, at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT)`);
  const MAX = Number(process.env.IIIF_MAX) || 300;
  const stage = path.join(C.dataDir, 'incoming'); fs.mkdirSync(stage, { recursive: true });
  const placeOf = meta => { const hit = meta.find(x => /^(place|location|geography|site|city)$/i.test(x.label)); return hit ? hit.value.slice(0, 120) : null; };
  const yearOf = (it) => { const hit = it.meta.find(x => /^(date|year|created|dated)$/i.test(x.label)); const m = hit && String(hit.value).match(/\b(1[5-9]\d\d|20\d\d)\b/); return m ? m[1] : null; };

  async function run(job) {
    db.prepare("UPDATE iiif_imports SET status='running' WHERE id=?").run(job.id);
    let man;
    try { const r = await doFetch(job.url, { headers: { accept: 'application/ld+json, application/json' } }); if (!r.ok) throw new Error(`manifest ${r.status}`); man = parseManifest(await r.json()); }
    catch (e) { db.prepare("UPDATE iiif_imports SET status='failed', note=?, finished_at=datetime('now') WHERE id=?").run(String(e.message).slice(0, 300), job.id); return; }
    db.prepare('UPDATE iiif_imports SET label=?, n=? WHERE id=?').run(man.label.slice(0, 200), Math.min(man.items.length, MAX), job.id);
    let done = 0, skipped = 0, failed = 0;
    for (const it of man.items.slice(0, MAX)) {
      if (db.prepare('SELECT 1 FROM works WHERE source_url=?').get(it.id)) { skipped++; continue; }
      const tmp = path.join(stage, `iiif-${job.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
      try {
        const r = await doFetch(it.image); if (!r.ok) throw new Error(`image ${r.status}`);
        fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
        const title = (it.label || man.label || 'Untitled').slice(0, 160);
        const caption = [it.summary, ...it.meta.filter(x => !/^(place|location|date|year)$/i.test(x.label)).slice(0, 6).map(x => `${x.label}: ${x.value}`)].filter(Boolean).join(' · ').slice(0, 1200) || null;
        const w = await registerWork({ file: tmp, title, place: placeOf(it.meta) || placeOf(man.meta), caption, source_url: it.id, originalName: 'iiif.jpg', makerId: job.maker_id });
        const year = yearOf(it);
        db.prepare("UPDATE works SET status=?, open=COALESCE(?, open), taken_at=COALESCE(taken_at, ?), medium=COALESCE(?, medium) WHERE id=?").run(job.show ? 'held' : 'hidden', job.open || null, year ? `${year}-01-01` : null, (it.meta.find(x => /^(medium|technique|materials?)$/i.test(x.label)) || {}).value || null, w.id);
        if (job.open) { try { ledger.append(db, 'work.opened', w.slug, { licence: job.open, by: 'iiif' }); } catch (e) { /* */ } }
        done++;
      } catch (e) { failed++; try { fs.unlinkSync(tmp); } catch (x) { /* */ } if (/already held/.test(e.message)) { failed--; skipped++; } }
      db.prepare('UPDATE iiif_imports SET done=?, skipped=?, failed=? WHERE id=?').run(done, skipped, failed, job.id);
    }
    db.prepare("UPDATE iiif_imports SET status='done', done=?, skipped=?, failed=?, finished_at=datetime('now') WHERE id=?").run(done, skipped, failed, job.id);
    if (app.locals.findIndexDirty) app.locals.findIndexDirty();
    try { ledger.append(db, 'collection.imported', `iiif-${job.id}`, { maker: db.prepare('SELECT handle FROM makers WHERE id=?').get(job.maker_id).handle, n: done, skipped, failed, from: job.url }); } catch (e) { /* */ }
  }
  let running = null;
  function kick() { if (running) return; const job = db.prepare("SELECT * FROM iiif_imports WHERE status='queued' ORDER BY id LIMIT 1").get(); if (!job) return; running = run(job).catch(e => console.error('[iiif]', e.message)).finally(() => { running = null; setTimeout(kick, 50); }); }

  function enqueue(makerId, body, res) {
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(+makerId); if (!m) return res.sendStatus(404);
    const url = String((body || {}).url || '').trim(); if (!/^https?:\/\/\S+$/.test(url)) return res.redirect('/studio/iiif?ok=' + encodeURIComponent('That is not a manifest address.'));
    const open = ['pd', 'cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc'].includes(body.open) ? body.open : null;
    const id = db.prepare('INSERT INTO iiif_imports (maker_id, url, open, show) VALUES (?,?,?,?)').run(m.id, url, open, body.show ? 1 : 0).lastInsertRowid;
    kick();
    res.redirect(`/studio/iiif/${id}`);
  }
  app.post('/studio/accounts/:id/iiif', studioOnly, (req, res) => enqueue(req.params.id, req.body || {}, res));
  app.get('/studio/iiif', studioOnly, (req, res) => {
    const rows = db.prepare('SELECT i.*, m.name AS maker FROM iiif_imports i JOIN makers m ON m.id=i.maker_id ORDER BY i.id DESC LIMIT 100').all();
    const makers = db.prepare("SELECT id, name, kind FROM makers WHERE COALESCE(kind,'maker')!='writer' ORDER BY kind='institution' DESC, name").all();
    res.send(V.layout({ title: 'IIIF · Studio · Watermark', studio: true, path: '/studio/iiif', body: `<section class="studio-wrap"><p class="k">The house</p><h1>Collections, brought in.</h1>
<p class="lede">A museum’s collection comes in from its IIIF manifest: every canvas becomes a held work, the full picture fetched once, fingerprinted, sealed and registered. Works arrive held back for review unless shown at once.</p>
<form method="post" action="/studio/iiif" class="iif-f"><label>Manifest address<input name="url" placeholder="https://…/manifest.json" required></label><label>For<select name="maker">${makers.map(x => `<option value="${x.id}">${esc(x.name)}${x.kind && x.kind !== 'maker' ? ` (${esc(x.kind)})` : ''}</option>`).join('')}</select></label><label>Licence on arrival<select name="open"><option value="">The institution’s terms (licensable)</option><option value="pd">Public domain</option><option value="cc0">CC0</option><option value="cc-by">CC BY</option><option value="cc-by-sa">CC BY-SA</option><option value="cc-by-nc">CC BY-NC</option></select></label><label class="iif-ck"><input type="checkbox" name="show" value="1"> Show at once (else held back for review)</label><button class="buy-btn">Bring it in</button></form>
<table class="tbl"><tr><th>When</th><th>For</th><th>Manifest</th><th>Status</th><th>Brought in</th></tr>${rows.map(r => `<tr><td>${esc(r.at.slice(0, 16))}</td><td>${esc(r.maker)}</td><td><a href="/studio/iiif/${r.id}">${esc(r.label || r.url.slice(0, 60))}</a></td><td>${esc(r.status)}${r.note ? ` · ${esc(r.note)}` : ''}</td><td>${r.done} of ${r.n}${r.skipped ? ` · ${r.skipped} already held` : ''}${r.failed ? ` · ${r.failed} failed` : ''}</td></tr>`).join('') || '<tr><td colspan="5">None yet.</td></tr>'}</table></section>` }));
  });
  app.post('/studio/iiif', studioOnly, (req, res) => enqueue((req.body || {}).maker, req.body || {}, res));
  app.get('/studio/iiif/:id', studioOnly, (req, res) => {
    const r = db.prepare('SELECT i.*, m.name AS maker, m.handle FROM iiif_imports i JOIN makers m ON m.id=i.maker_id WHERE i.id=?').get(+req.params.id); if (!r) return res.sendStatus(404);
    const works = db.prepare("SELECT slug, title, status FROM works WHERE maker_id=? AND source_url LIKE ? ORDER BY id DESC LIMIT 60").all(r.maker_id, '%');
    res.send(V.layout({ title: 'A collection, brought in · Studio · Watermark', studio: true, path: '/studio/iiif', body: `<section class="studio-wrap"><p class="k"><a href="/studio/iiif">Collections, brought in</a></p><h1>${esc(r.label || 'A manifest')}.</h1>
<p class="lede">For ${esc(r.maker)} · ${esc(r.status)} · ${r.done} of ${r.n} brought in${r.skipped ? `, ${r.skipped} already held` : ''}${r.failed ? `, ${r.failed} failed` : ''}.${r.note ? ` ${esc(r.note)}` : ''}</p>
<p class="note"><code>${esc(r.url)}</code>${r.status === 'running' || r.status === 'queued' ? ' · <a href="">Refresh</a>' : ''}</p>
${r.show ? '' : `<p>Arrived held back. <a href="/studio/works?maker=${esc(r.handle)}&status=hidden">Review and show them</a> from the works desk, or at the institution’s studio.</p>`}
<ul class="iif-list">${works.slice(0, 40).map(w => `<li><a href="/w/${esc(w.slug)}">${esc(w.title)}</a> · ${w.status}</li>`).join('')}</ul></section>` }));
  });

  // The Image API, level 0: a museum's own viewer can show what the house keeps.
  const SIZES = [{ k: 'thumb', w: 480 }, { k: 'screen', w: 1600 }, { k: 'large', w: 2400 }];
  app.get('/iiif/:slug/info.json', (req, res) => {
    const w = db.prepare("SELECT slug, width, height FROM works WHERE slug=? AND status='held'").get(req.params.slug); if (!w || !w.width) return res.status(404).json({ error: 'not held' });
    res.set({ 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/ld+json;profile="http://iiif.io/api/image/3/context.json"' });
    const sizes = SIZES.filter(s => s.w < w.width).map(s => ({ width: s.w, height: Math.round(w.height * s.w / w.width) }));
    res.json({ '@context': 'http://iiif.io/api/image/3/context.json', id: `${C.base}/iiif/${w.slug}`, type: 'ImageService3', protocol: 'http://iiif.io/api/image', profile: 'level0', width: Math.min(w.width, 2400), height: Math.round(w.height * Math.min(w.width, 2400) / w.width), sizes, rights: `${C.base}/w/${w.slug}` });
  });
  app.get('/iiif/:slug/:region/:size/:rotation/:quality', (req, res) => {
    const { slug, region, size, rotation } = req.params; const q = String(req.params.quality || '').split('.')[0];
    if (region !== 'full' || rotation !== '0' || !['default', 'color'].includes(q)) return res.status(400).json({ error: 'level 0: full region, rotation 0, default quality; sizes in info.json' });
    const w = db.prepare("SELECT slug, width FROM works WHERE slug=? AND status='held'").get(slug); if (!w) return res.status(404).json({ error: 'not held' });
    let k = 'large';
    if (size !== 'max' && size !== 'full') { const m = String(size).match(/^!?(\d*),(\d*)$/); const want = m ? Number(m[1] || 0) || (Number(m[2] || 0) * 1.5) : 0; k = want && want <= 480 ? 'thumb' : want && want <= 1600 ? 'screen' : 'large'; }
    res.set('Access-Control-Allow-Origin', '*');
    res.redirect(302, `/img/${encodeURIComponent(w.slug)}/${k}?f=jpg`);
  });

  // For museums: the public page.
  app.get('/museums', (req, res) => {
    const n = db.prepare("SELECT COUNT(*) n FROM makers WHERE kind='institution'").get().n;
    res.send(V.layout({ title: 'For museums · Watermark', path: '/museums', desc: 'Your collection, kept, shown and licensed on Watermark. It comes in from your IIIF manifest in an afternoon.', body: `<section class="mu"><header class="mu-h"><p class="k">For museums, libraries and archives</p><h1>Already built. Plug in.</h1>
<p class="lede">Watermark is the house a collection wants: a vault with a signed register, galleries people stroll through on a phone, a viewing room, a headset, a frame for the wall at home, a licensing desk for editors and companies, a print room, a members’ club. A museum does not have to build any of it. It brings its collection in and keeps the keys.</p></header>
<section class="mu-grid">
<div><p class="k">In an afternoon</p><h2>It comes in from your manifest.</h2><p>Every serious collection already publishes IIIF. Give the house a manifest address and each canvas becomes a held work: the full picture fetched once, fingerprinted, sealed in the vault, written to the register, with its label, date, place and medium. Works arrive held back until your registrar shows them.</p></div>
<div><p class="k">Your viewers keep working</p><h2>The Image API answers.</h2><p>Every held work answers <code>/iiif/&lt;work&gt;/info.json</code> and the standard size requests, so Mirador, the Universal Viewer and your own site keep showing the pictures from here. The read-only API gives the record, the credit line and the licence of every work; oEmbed gives an embed.</p></div>
<div><p class="k">For the public</p><h2>Seen as it deserves.</h2><p>The stroll (one work at a time, edge to edge, on a phone), the viewing room, the long gallery and the rotunda in a headset, a frame for the television at home, a guide read aloud, the study beneath it. Nothing social on the wall; the talk is on the benches, by the Keys’ rules.</p></div>
<div><p class="k">For the registrar</p><h2>Provenance you can check.</h2><p>A hash-chained, signed register; a fingerprint and an archival master for every work; Content Credentials on every file that leaves; fixity re-checked on a schedule; nightly backups with a restore drill; a U.S. Copyright Office bridge; claims handled by a written procedure.</p></div>
<div><p class="k">For the rights desk</p><h2>Licensing, done for you.</h2><p>Editors and companies license from a dense search built for the trade; the contract is assembled per order from counsel’s pattern; the money settles by Stripe; the delivered file carries its licence inside it. Open works (public domain, CC0) are given away, credited, with the original.</p></div>
<div><p class="k">For members</p><h2>The Keys.</h2><p>Your members hold keys: the benches under every work, the balcony in the evening, the dinner. Keys are earned, never bought; nothing said on the balcony is kept. A clubhouse the museum does not have to run.</p></div>
</section>
<section class="mu-ask"><h2>Bring a collection in.</h2><p>Write to the house with a manifest address and the name of the institution. ${n ? `${n} institution${n === 1 ? ' is' : 's are'} already here.` : 'Be the first.'} <a class="buy-btn" href="mailto:${esc(process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com')}?subject=${encodeURIComponent('A collection for Watermark')}">By letter</a> <a class="mu-alt" href="/developers">The API</a> <a class="mu-alt" href="/legal">The agreements</a></p><p class="note">Terms for institutions are drawn up with counsel; what the house keeps is yours, and leaves with you, byte for byte, in the archival master.</p></section></section>` }));
  });

  app.locals.iiif = { parseManifest, kick, run };
  return app.locals.iiif;
}
module.exports = { mountIIIF, parseManifest };
