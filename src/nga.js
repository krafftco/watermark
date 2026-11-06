'use strict';
// The National Gallery of Art, Washington (Will, 6 Nov: "what else should we bring into the house, we are done with the
// Met"; "lets go"; "line it up"). The Gallery publishes its whole catalogue as open CSVs on GitHub (objects, images,
// people) and every open-access image as CC0 through its own IIIF server. The house reads the four files once a week,
// keeps an index of the works with an open primary image, and hands the feeds a hundred at a time, a classification at
// a time (paintings first), in the IIIF importer's item shape, so each work comes in through the same door (the bag check,
// registerWork, the governor, the register). The works hang on the public-domain shelf, each credited 'Courtesy National
// Gallery of Art, Washington'; the house is not connected with the Gallery. A painting is asked for at no more than
// NGA_SIDE pixels a side (the Gallery's masters run to 80 MP and more; the door and the box take 36).
const fs = require('fs');
const path = require('path');
const { csvStream } = require('./moma');

const BASE = () => process.env.NGA_DATA || 'https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data';
const SIDE = +process.env.NGA_SIDE || 6000;
const STALE_DAYS = 7;
const CREDIT = 'Courtesy National Gallery of Art, Washington';
// The order the house takes them in, and what each is called here.
const CLASSES = [['Painting', 'painting', 'Paintings'], ['Sculpture', 'sculpture', 'Sculpture'], ['Drawing', 'drawing', 'Drawings'], ['Photograph', 'photograph', 'Photographs'], ['Print', 'print', 'Prints'], ['Index of American Design', 'drawing', 'The Index of American Design'], ['Decorative Art', 'other', 'Decorative arts']];
const KIND = Object.fromEntries(CLASSES.map(c => [c[0], c[1]]));

function mountNga(app, { db, C, ledger }) {
  const dir = () => path.join(C.dataDir, 'nga');
  const idxFile = () => path.join(dir(), 'index.json');
  let idx = null, building = null;
  const job = { state: 'idle', at: null, n: 0, note: null };

  async function fetchTo(name) {
    const base = app.locals.nga.base || BASE();
    if (!/^https?:/.test(base)) return path.join(base, name);
    fs.mkdirSync(dir(), { recursive: true }); const to = path.join(dir(), name), tmp = to + '.part';
    const r = await fetch(`${base}/${name}`, { headers: { 'user-agent': 'Watermark (house@watermark.krafftco.com)' } });
    if (!r.ok) throw new Error(`the Gallery's ${name}: ${r.status}`);
    const { Readable } = require('stream'); const { pipeline } = require('stream/promises');
    await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(tmp)); fs.renameSync(tmp, to);
    if (/git-lfs\.github\.com/.test(fs.readFileSync(to, 'utf8').slice(0, 80))) throw new Error(`the Gallery's ${name} came back as a Git LFS pointer`);
    return to;
  }
  // Each file read as a stream, row objects by its header.
  async function rows(name, each) {
    let head = null;
    await csvStream(fs.createReadStream(await fetchTo(name), { encoding: 'utf8' }), async batch => {
      for (const r of batch) { if (!head) { head = r.map(h => h.trim()); continue; } const o = {}; head.forEach((h, i) => { o[h] = r[i] == null ? '' : r[i]; }); each(o); }
      await new Promise(x => setImmediate(x));
    });
  }
  const yr = v => { const n = parseInt(v, 10); return Number.isFinite(n) && n ? n : null; };

  async function build() {
    job.state = 'reading'; job.note = null;
    // 1. Open primary images.
    const img = new Map();
    await rows('published_images.csv', r => { if (r.viewtype === 'primary' && r.openaccess === '1' && !r.maxpixels && r.iiifurl) img.set(r.depictstmsobjectid, { u: r.iiifurl, w: +r.width || 0, h: +r.height || 0 }); });
    // 2. The artist of each such object (the first in display order).
    const who = new Map();
    await rows('objects_constituents.csv', r => { if (r.roletype !== 'artist' || !img.has(r.objectid)) return; const k = who.get(r.objectid); if (!k || +r.displayorder < k.o) who.set(r.objectid, { c: r.constituentid, o: +r.displayorder || 0, pre: (r.prefix || '').trim() }); });
    const want = new Set([...who.values()].map(x => x.c)); const people = new Map();
    await rows('constituents.csv', r => { if (want.has(r.constituentid)) people.set(r.constituentid, { name: (r.forwarddisplayname || r.preferreddisplayname || '').trim(), born: yr(r.beginyear), died: yr(r.endyear), nat: r.nationality || null, q: /^Q\d+$/.test(r.wikidataid || '') ? r.wikidataid : null }); });
    // 3. The works.
    const out = [];
    await rows('objects.csv', r => {
      const i = img.get(r.objectid); if (!i || !KIND[r.classification] || r.isvirtual === '1') return;
      const a = who.get(r.objectid); const p = a ? people.get(a.c) : null;
      out.push({ id: +r.objectid, t: (r.title || 'Untitled').trim().slice(0, 300), d: r.displaydate || '', y: yr(r.beginyear), m: r.medium || '', dim: (r.dimensions || '').split('\n')[0].slice(0, 200), c: r.classification, cr: r.creditline || '', acc: r.accessionnum || '', at: r.attribution || '', q: /^Q\d+$/.test(r.wikidataid || '') ? r.wikidataid : null,
        u: i.u, w: i.w, h: i.h, p: p && p.name && !/^(anonymous|unknown)/i.test(p.name) ? p : null, pre: a ? a.pre : '' });
    });
    const order = Object.fromEntries(CLASSES.map((c, k) => [c[0], k]));
    out.sort((a, b) => (order[a.c] - order[b.c]) || ((a.y || 9999) - (b.y || 9999)) || a.id - b.id);
    fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(idxFile() + '.part', JSON.stringify({ at: new Date().toISOString(), works: out })); fs.renameSync(idxFile() + '.part', idxFile());
    for (const f of ['objects.csv', 'published_images.csv', 'objects_constituents.csv', 'constituents.csv']) { try { if (/^https?:/.test(app.locals.nga.base || BASE())) fs.unlinkSync(path.join(dir(), f)); } catch (e) { /* */ } }
    idx = { at: Date.now(), works: out }; job.state = 'ready'; job.at = new Date().toISOString(); job.n = out.length;
    return idx;
  }
  // The index, read from disk when fresh, else built (one build at a time).
  async function ready({ fresh = false } = {}) {
    if (idx && !fresh && Date.now() - idx.at < STALE_DAYS * 864e5) return idx;
    if (!fresh) { try { const st = fs.statSync(idxFile()); if (Date.now() - st.mtimeMs < STALE_DAYS * 864e5) { const j = JSON.parse(fs.readFileSync(idxFile(), 'utf8')); idx = { at: st.mtimeMs, works: j.works }; job.state = 'ready'; job.n = j.works.length; return idx; } } catch (e) { /* build */ } }
    if (!building) building = build().catch(e => { job.state = 'failed'; job.note = e.message; throw e; }).finally(() => { building = null; });
    return building;
  }
  const page = id => `https://www.nga.gov/collection/art-object-page.${id}.html`;
  // Whose hand (6 Nov: a work 'after', 'workshop of', 'follower of' a master is not the master's): the qualifier is
  // kept as the attribution, and the work is never linked to the master's page as theirs.
  const NOT_THEIRS = /\b(after|workshop|studio of|follower|circle|school|style|manner|imitator|copy|replica)\b/i;
  const MAYBE = /\b(attributed|probably|possibly)\b|\?/i;
  const handOf = o => { const s = `${o.pre || ''} ${o.at || ''}`; return NOT_THEIRS.test(o.pre || '') || (o.at && NOT_THEIRS.test(o.at.split(o.p ? o.p.name : '\u0000')[0])) ? 'not' : MAYBE.test(o.pre || '') || MAYBE.test((o.at || '').split(o.p ? o.p.name : '\u0000')[0]) ? 'attributed' : null; };
  const qualified = o => handOf(o) === 'not';
  function item(o) {
    const big = Math.max(o.w, o.h) > SIDE;
    const image = `${o.u.replace(/\/$/, '')}/full/${big ? `!${SIDE},${SIDE}` : 'max'}/0/default.jpg`;
    const q = qualified(o); const meta = [[q ? 'Attribution' : 'Artist', o.at || [o.pre, o.p && o.p.name].filter(Boolean).join(' ')], ['Date', o.d], ['Medium', o.m], ['Dimensions', o.dim], ['Credit line', o.cr], ['Accession number', o.acc], ['Classification', o.c], ['Courtesy', CREDIT]].filter(([, v]) => v).map(([label, value]) => ({ label, value: String(value) }));
    return { id: page(o.id), label: o.t, summary: [o.at || (o.p && o.p.name), o.d].filter(Boolean).join(', '), image, meta, rights: 'cc0', kind: KIND[o.c] || null,
      hand: handOf(o) ? (o.at || o.pre) : null, artist: o.p && !q ? { name: o.p.name, born: o.p.born, died: o.p.died, nationality: o.p.nat } : null };
  }
  // A slice of one classification ('' = all, in the house's order).
  async function items({ cls = '', offset = 0, n = 100 } = {}) {
    const { works } = await ready(); const list = cls ? works.filter(o => o.c === cls) : works;
    return { total: list.length, items: list.slice(offset, offset + n).map(item) };
  }
  async function counts() { const { works } = await ready(); const c = {}; for (const o of works) c[o.c] = (c[o.c] || 0) + 1; return c; }
  const isNga = u => /(^|\/\/)(www\.)?nga\.gov\/open-access/.test(String(u || ''));
  const urlFor = ({ cls = '', offset = 0 } = {}) => `https://www.nga.gov/open-access-images?${new URLSearchParams({ ...(cls ? { cls } : {}), ...(offset ? { offset: String(offset) } : {}) })}`;
  const specOf = u => { try { const x = new URL(u); return { cls: x.searchParams.get('cls') || '', offset: +x.searchParams.get('offset') || 0 }; } catch (e) { return { cls: '', offset: 0 }; } };

  app.locals.nga = { ready, items, counts, item, isNga, urlFor, specOf, job, CLASSES, CREDIT, base: null };
  return app.locals.nga;
}
module.exports = { mountNga, CLASSES, CREDIT };
