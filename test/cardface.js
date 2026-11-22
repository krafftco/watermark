// The story and post cards (#210, 22 Nov: the first guest's album story on Instagram). For a tall and a wide picture,
// in an album and as the work's own card:
//   1. a story keeps everything it draws between y=250 and y=1590 (rows 0–249 and 1591–1919 are the dark, by pixel),
//      clear of Instagram's name bar and its reply bar; a post keeps 60 px of dark on every side;
//   2. the foot is the house's logo, drawn from its own paths (the logo's pixels are found where it stands), never the
//      word typed;
//   3. the maker's Instagram handle is under the credit when their account has one, and absent when not;
//   4. no album address is drawn; the album's share panel offers "Tag @handle" with a copy button only with a handle,
//      and the picture itself is never touched (the served copy is the same before and after).
// CARDS=<dir> keeps each card as a PNG.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const crypto = require('crypto'); const sharp = require('sharp');
const { createApp } = require('../src/app');
const CF = require('../src/cardface');
const KEEP = process.env.CARDS || '';
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-cardface-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'cardface', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const fails = []; const ok = (c, m) => { if (!c) { fails.push(m); console.log('FAIL ' + m); } };
  db.prepare("INSERT INTO makers (handle, name, kind, instagram, joined_at, door) VALUES ('ada', 'Ada Lens', 'maker', 'adalens', datetime('now'), 'house')").run();
  const ada = db.prepare("SELECT * FROM makers WHERE handle='ada'").get();
  // A field of soft noise (each its own picture to the fingerprint), mid-grey so its edge is far from the dark.
  const pic = (w, h, k) => sharp({ create: { width: w, height: h, channels: 3, noise: { type: 'gaussian', mean: 110 + k * 30, sigma: 40 } } }).jpeg({ quality: 88 }).toBuffer();
  const put = async (title, w, h, k) => { const f = path.join(dir, `in-${k}.jpg`); fs.writeFileSync(f, await pic(w, h, k)); const x = await app.locals.registerWork({ file: f, title, makerId: ada.id, originalName: path.basename(f) }); db.prepare("UPDATE works SET status='held', place='Dallas', taken_at='2026-11-21T20:00:00.000Z' WHERE slug=?").run(x.slug); return x.slug; };
  const tall = await put('The Long Table', 1600, 2400, 0), wide = await put('The Dance Floor', 2400, 1600, 1);
  const tok = crypto.randomBytes(12).toString('hex');
  db.prepare("INSERT INTO deliveries (token, maker_id, title, client_name) VALUES (?, ?, 'ANI.31', 'Ani')").run(tok, ada.id);
  const did = db.prepare('SELECT id FROM deliveries WHERE token=?').get(tok).id;
  [tall, wide].forEach((s, i) => db.prepare('INSERT INTO delivery_works (delivery_id, work_id, pos, ref) VALUES (?, (SELECT id FROM works WHERE slug=?), ?, ?)').run(did, s, i, `R-${i}`));
  const before = {}; for (const s of [tall, wide]) before[s] = crypto.createHash('sha1').update(Buffer.from(await (await fetch(`${base}/img/${s}/large`)).arrayBuffer())).digest('hex');

  const BG = [0x0b, 0x0a, 0x09];
  // Rows (or columns) of a raw RGB buffer that hold anything but the dark (a JPEG's flat dark wobbles by a step or two).
  const lit = (raw, W, H, rows, cols) => { const out = []; for (const [y0, y1] of rows) for (let y = y0; y <= y1; y++) for (const [x0, x1] of cols) for (let x = x0; x <= x1; x++) { const i = (y * W + x) * 3; if (Math.abs(raw[i] - BG[0]) > 6 || Math.abs(raw[i + 1] - BG[1]) > 6 || Math.abs(raw[i + 2] - BG[2]) > 6) { out.push(`${x},${y}`); break; } } return out; };
  // The logo as the card draws it, on the dark, to find it in the card.
  const logoRef = async () => { const lh = CF.LOGO_PX * 22.295 / 84.7023; const svg = `<svg width="${CF.LOGO_PX}" height="${Math.ceil(lh)}" xmlns="http://www.w3.org/2000/svg"><g transform="scale(${(CF.LOGO_PX / 84.7023).toFixed(5)})" fill="#a39d92">${CF.logoPaths()}</g></svg>`; return sharp({ create: { width: CF.LOGO_PX, height: Math.ceil(lh), channels: 3, background: '#0b0a09' } }).composite([{ input: Buffer.from(svg) }]).removeAlpha().raw().toBuffer(); };
  const ref = await logoRef();
  const logoAt = async (buf, kind, foot) => {
    const L = CF.layout(kind, [], foot); const x = Math.round((1080 - CF.LOGO_PX) / 2), y = Math.round(L.logoTop);
    const raw = await sharp(buf).extract({ left: x, top: y, width: CF.LOGO_PX, height: Math.ceil(L.lh) }).raw().toBuffer();
    let d = 0, on = 0; for (let i = 0; i < ref.length; i++) { d += Math.abs(raw[i] - ref[i]); if (ref[i] > 80) on++; }
    return { diff: d / ref.length, on };
  };
  const svgOf = name => [...CF.drawn.entries()].filter(([k]) => k.includes(name)).map(([, v]) => v).pop() || '';
  const texts = svg => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);

  async function check(label, url, kind, { handle, foot, slug }) {
    const r = await fetch(base + url); ok(r.status === 200, `${label}: answers (${r.status})`); if (r.status !== 200) return;
    const buf = Buffer.from(await r.arrayBuffer()); const meta = await sharp(buf).metadata(); const W = 1080, H = kind === 'post' ? 1350 : 1920;
    ok(meta.width === W && meta.height === H, `${label}: ${meta.width}×${meta.height}`);
    const raw = await sharp(buf).raw().toBuffer();
    if (kind === 'story') {
      const out = lit(raw, W, H, [[0, 249], [1591, 1919]], [[0, W - 1]]);
      ok(!out.length, `${label}: rows 0–249 and 1591–1919 are the dark (lit at ${out.slice(0, 4).join(' ')})`);
      const inner = lit(raw, W, H, [[250, 1590]], [[0, 59], [W - 60, W - 1]]); ok(!inner.length, `${label}: 60 px of dark at each side (${inner.slice(0, 3).join(' ')})`);
    } else {
      const out = lit(raw, W, H, [[0, 59], [H - 60, H - 1]], [[0, W - 1]]).concat(lit(raw, W, H, [[60, H - 61]], [[0, 59], [W - 60, W - 1]]));
      ok(!out.length, `${label}: 60 px of dark on every side (lit at ${out.slice(0, 4).join(' ')})`);
    }
    const lg = await logoAt(buf, kind, foot); ok(lg.diff < 6 && lg.on > 300, `${label}: the logo stands at the foot (mean difference ${lg.diff.toFixed(2)})`);
    const svg = svgOf(slug + '-'); const t = texts(svg);
    ok(svg.includes(CF.logoPaths().slice(0, 60)), `${label}: the logo is drawn from its paths`);
    ok(!t.some(x => /^\s*watermark\s*$/i.test(x)), `${label}: the word is not typed (${t.join(' | ')})`);
    ok(handle ? t.includes(handle) : !t.some(x => x.startsWith('@')), `${label}: the handle ${handle ? 'shows' : 'is absent'} (${t.join(' | ')})`);
    ok(!t.some(x => /\/a\/|\/deliver\//i.test(x)) && !t.some(x => x.includes(tok)), `${label}: no album address on the card`);
    if (KEEP) { fs.mkdirSync(KEEP, { recursive: true }); await sharp(buf).png().toFile(path.join(KEEP, `${label.replace(/\W+/g, '-')}.png`)); }
  }

  for (const [nm, s] of [['tall', tall], ['wide', wide]]) {
    for (const kind of ['story', 'post']) {
      await check(`album ${kind} ${nm}`, `/deliver/${tok}/${s}/${kind}.jpg`, kind, { handle: '@adalens', slug: s });
      await check(`work ${kind} ${nm}`, `/w/${s}/${kind}.jpg`, kind, { handle: '@adalens', foot: 'x', slug: s });
    }
  }
  let page = await (await fetch(`${base}/deliver/${tok}`)).text();
  ok(/data-dv-copy="@adalens"/.test(page) && /Tag <b>@adalens<\/b>/.test(page), 'the share panel: Tag @adalens, with a copy button');
  // Without a handle: none drawn, none offered; the new card is a new file (the old one is not served).
  db.prepare('UPDATE makers SET instagram=NULL WHERE id=?').run(ada.id); CF.drawn.clear();
  for (const kind of ['story', 'post']) {
    await check(`album ${kind} tall, no handle`, `/deliver/${tok}/${tall}/${kind}.jpg`, kind, { handle: '', slug: tall });
    await check(`work ${kind} wide, no handle`, `/w/${wide}/${kind}.jpg`, kind, { handle: '', foot: 'x', slug: wide });
  }
  page = await (await fetch(`${base}/deliver/${tok}`)).text();
  ok(!/data-dv-copy=/.test(page) && !/Tag <b>@/.test(page), 'no handle, no Tag line');
  ok(!/data-dv-story[^>]*\/a\/|navigator\.share\(\{[^}]*url/.test(page), 'the card is shared as a file alone, never with the album\'s link');
  for (const s of [tall, wide]) ok(crypto.createHash('sha1').update(Buffer.from(await (await fetch(`${base}/img/${s}/large`)).arrayBuffer())).digest('hex') === before[s], `the served picture ${s} is untouched`);
  ok(CF.igOf('@@Will.F_ullerton!') === '@Will.F_ullerton' && CF.igOf('') === '' && CF.igOf(null) === '', 'a handle is said with one @');

  srv.close();
  if (fails.length) { console.error(`cardface: ${fails.length} failed`); process.exit(1); }
  console.log('cardface: ok'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
