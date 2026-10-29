#!/usr/bin/env node
// watermark: send an archive to your Watermark vault from your own computer.
//
// 29 Oct 2026. The engine of the Mac app, first as one file with nothing to install beyond Node (18 or later):
//   node watermark.js login                         let this computer send to your vault (a code, approved in your browser)
//   node watermark.js push <folder> [options]       send a folder or a drive: culled, fingerprinted, never sent twice
//   node watermark.js status [import]               where an import stands
//   node watermark.js logout                        forget the key on this computer
//
// What push does, in order: walks the folder (pictures and DNGs; hidden files and Lightroom's caches left alone), reads
// the stars Lightroom wrote (an .xmp beside the file, else the XMP inside it) and keeps only what clears --stars,
// fingerprints every file (SHA-256; kept on this computer so a second run does not read the files again), makes one
// import for the batch, asks the house before each file whether it already holds those bytes, and sends the rest in
// 8 MB parts straight to the vault, several files and several parts at once, each part retried until it lands. The
// house checks every file's fingerprint when it lands; a mismatch keeps nothing. Stop it any time (Ctrl-C, a closed lid,
// a dropped Wi-Fi): run the same line again and it carries on where it stopped, part by part. Your files are only read.
'use strict';
const fs = require('fs'); const fsp = fs.promises; const path = require('path'); const os = require('os'); const crypto = require('crypto');
const { spawn } = require('child_process');

const VERSION = '0.1.0';
const HOME = process.env.WATERMARK_HOME || path.join(os.homedir(), '.watermark');
const CONF = path.join(HOME, 'config.json');
const STATE = path.join(HOME, 'state');
const DEFAULT_HOUSE = 'https://watermark.krafftco.com';
const EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.png': 'image/png', '.webp': 'image/webp', '.dng': 'image/x-adobe-dng' };
const SKIP_DIRS = /(^\.|\.lrdata$|\.lrcat-data$|^Previews$|^@eaDir$|^\$RECYCLE\.BIN$|^System Volume Information$)/;
const tty = process.stdout.isTTY;

// ---------- small things ----------
const say = (...a) => { if (tty && lineOpen) { process.stdout.write('\r\x1b[2K'); lineOpen = false; } console.log(...a); };
let lineOpen = false;
const line = s => { if (!tty) return; process.stdout.write('\r\x1b[2K' + s.slice(0, (process.stdout.columns || 100) - 1)); lineOpen = true; };
const gb = b => (b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB');
const dur = s => (s < 90 ? `${Math.max(1, Math.round(s))} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const die = (msg, code = 1) => { say(msg); process.exit(code); };
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v), { mode: 0o600 }); fs.renameSync(t, f); };

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); const next = argv[i + 1]; if (v !== undefined) o[k] = v; else if (next !== undefined && !next.startsWith('--') && !['dry', 'no-wait', 'all', 'yes', 'places'].includes(k)) { o[k] = next; i++; } else o[k] = true; }
    else o._.push(a);
  }
  return o;
}

// ---------- the house ----------
function client(conf) {
  const house = conf.house.replace(/\/$/, '');
  async function call(p, { method = 'GET', body, type = 'application/json', tries = 6 } = {}) {
    let last;
    for (let t = 0; t < tries; t++) {
      try {
        const r = await fetch(house + p, { method, headers: { authorization: `Bearer ${conf.key}`, 'content-type': type, 'user-agent': `watermark-push/${VERSION} (${os.platform()})` }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
        if (r.status === 401) { const j = await r.json().catch(() => ({})); die(j.error || 'This computer is signed out. Run: node watermark.js login', 2); }
        if (r.status >= 500 || r.status === 429) { last = new Error(`the house answered ${r.status}`); await sleep(Math.min(60000, 1500 * 2 ** t)); continue; }
        const j = await r.json().catch(() => ({ ok: false, error: `the house answered ${r.status}` }));
        return j;
      } catch (e) { last = e; await sleep(Math.min(60000, 1500 * 2 ** t)); }
    }
    throw last || new Error('the house did not answer');
  }
  return { house, call };
}

// ---------- the stars Lightroom wrote ----------
// An .xmp beside the file (raws), else the XMP packet inside it (exports carry it when metadata is included).
// Unrated is 0; Lightroom's reject is -1 (always left out when --stars is given).
function ratingIn(s) {
  const m = /xmp:Rating\s*=\s*["'](-?\d)["']/.exec(s) || /<xmp:Rating>\s*(-?\d)\s*<\/xmp:Rating>/.exec(s);
  return m ? +m[1] : null;
}
async function stars(file) {
  const dir = path.dirname(file), base = path.basename(file, path.extname(file));
  for (const side of [path.join(dir, base + '.xmp'), path.join(dir, base + '.XMP'), file + '.xmp']) {
    try { const r = ratingIn(await fsp.readFile(side, 'utf8')); if (r !== null) return r; } catch (e) { /* none */ }
  }
  let fh; try {
    fh = await fsp.open(file, 'r'); const n = /\.dng$/i.test(file) ? 4 << 20 : 1 << 20; const b = Buffer.alloc(n);
    const { bytesRead } = await fh.read(b, 0, n, 0); const r = ratingIn(b.subarray(0, bytesRead).toString('latin1'));
    return r === null ? 0 : r;
  } catch (e) { return 0; } finally { if (fh) await fh.close(); }
}

// ---------- the walk ----------
async function walk(root) {
  const out = [];
  async function go(d) {
    let es; try { es = await fsp.readdir(d, { withFileTypes: true }); } catch (e) { say(`  could not read ${d}: ${e.code || e.message}`); return; }
    es.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const e of es) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.test(e.name)) await go(f); continue; }
      if (!e.isFile() || e.name.startsWith('.')) continue;
      const type = EXT[path.extname(e.name).toLowerCase()]; if (!type) continue;
      const st = await fsp.stat(f); if (!st.size) continue;
      out.push({ abs: f, rel: path.relative(root, f), name: e.name, size: st.size, mtime: Math.floor(st.mtimeMs), type });
    }
  }
  const st = await fsp.stat(root).catch(() => null);
  if (!st) die(`There is no folder at ${root}.`);
  if (st.isFile()) { const type = EXT[path.extname(root).toLowerCase()]; if (type) out.push({ abs: root, rel: path.basename(root), name: path.basename(root), size: st.size, mtime: Math.floor(st.mtimeMs), type }); }
  else await go(root);
  return out;
}

// ---------- the fingerprint ----------
function sha256(file, onBytes) {
  return new Promise((res, rej) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file, { highWaterMark: 4 << 20 }).on('data', d => { h.update(d); if (onBytes) onBytes(d.length); }).on('end', () => res(h.digest('hex'))).on('error', rej);
  });
}

// ---------- commands ----------
async function login(o) {
  const house = String(o.house || readJSON(CONF, {}).house || DEFAULT_HOUSE).replace(/\/$/, '');
  const name = String(o.name || (os.platform() === 'darwin' ? macName() : os.hostname()) || 'a computer');
  let b; try { b = await (await fetch(house + '/api/push/begin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })).json(); } catch (e) { die(`Could not reach ${house}: ${e.message}`); }
  if (!b || !b.ok) die('The house would not begin a pairing: ' + JSON.stringify(b));
  say(`\n  Your code: ${b.code}\n\n  Open this page where you are signed in to Watermark and say yes:\n  ${b.url}\n`);
  if (os.platform() === 'darwin' && !o['no-open']) spawn('open', [b.url], { stdio: 'ignore', detached: true }).unref();
  const until = Date.now() + 10 * 60000;
  while (Date.now() < until) {
    await sleep((b.every || 3) * 1000);
    let j; try { j = await (await fetch(house + '/api/push/poll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device: b.device }) })).json(); } catch (e) { continue; }
    if (j.waiting) { line('  Waiting for your yes…'); continue; }
    if (!j.ok) die('  ' + (j.error || 'Not allowed.'));
    writeJSON(CONF, { house: j.house || house, key: j.key, maker: j.maker, name, since: new Date().toISOString() });
    say(`  This computer can send to ${j.maker.name}'s vault. The key is kept in ${CONF}.\n\n  Next:  node watermark.js push <folder> --place "Philadelphia" --stars 3 --dry`);
    return;
  }
  die('  Ten minutes passed with no answer. Run login again.');
}
function placeOf(name) {
  const w = String(name).replace(/^\d+[_\- .]*/, '').replace(/[_]+/g, ' ').trim();
  return w.split(/\s+/).map(x => (x.length <= 4 && x === x.toUpperCase() && !/^(THE|AND|OF|DE|LA|LE)$/.test(x) ? x : x.charAt(0).toUpperCase() + x.slice(1).toLowerCase())).join(' ');
}
function macName() { try { return require('child_process').execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8' }).trim(); } catch (e) { return os.hostname(); } }

async function push(o) {
  const conf = readJSON(CONF, null); if (!conf || !conf.key) die('This computer is not signed in. Run: node watermark.js login');
  const roots = o._.slice(1); if (!roots.length) die('Name a folder: node watermark.js push ~/Pictures/Exports/Philadelphia');
  const minStars = o.stars !== undefined && o.stars !== true ? +o.stars : null;
  const lanes = Math.max(1, Math.min(8, +(o.files || 3))), partLanes = Math.max(1, Math.min(16, +(o.parts || 4)));
  const H = client(conf);

  // 1. What there is.
  let all = []; for (const r of roots) { const abs = path.resolve(r.replace(/^~(?=$|\/)/, os.homedir())); for (const f of await walk(abs)) all.push({ ...f, root: abs }); }
  if (!all.length) die('No pictures in that folder (JPEG, TIFF, PNG, WebP or DNG).');
  // a raw and its export side by side: send the export, keep the raw for the house to keep beside it (DNG goes as its own file)
  say(`${all.length} file${all.length === 1 ? '' : 's'}, ${gb(all.reduce((a, f) => a + f.size, 0))}, in ${roots.join(', ')}`);

  // 2. The cull, by the stars you gave them.
  const tally = {}; let i0 = 0;
  for (const f of all) { f.stars = await stars(f.abs); tally[f.stars] = (tally[f.stars] || 0) + 1; if (++i0 % 200 === 0) line(`  reading the stars… ${i0} of ${all.length}`); }
  const tl = Object.keys(tally).map(Number).sort((a, b) => b - a).map(k => `${k > 0 ? '★'.repeat(k) : k === 0 ? 'unrated' : 'rejected'} ${tally[k]}`).join(' · ');
  say(`  stars: ${tl}`);
  let files = all;
  if (minStars !== null) { files = all.filter(f => f.stars >= minStars); say(`  --stars ${minStars}: ${files.length} kept, ${all.length - files.length} left on this computer`); }
  if (!files.length) die('Nothing clears that line. Try a lower --stars, or check that Lightroom wrote the stars (Metadata → Save Metadata to File, or include metadata when exporting).');
  const total = files.reduce((a, f) => a + f.size, 0);
  // --places: the place from the folder each file sits in under the root, as an archive is kept ("03_PHILLY" → Philly)
  if (o.places) { for (const f of files) { const seg = f.rel.split(path.sep); const dirs = seg.slice(0, -1); const numbered = dirs.filter(d => /^\d+[_\- ]/.test(d)); f.place = numbered.length ? placeOf(numbered[numbered.length - 1]) : dirs.length ? placeOf(dirs[0]) : (o.place || placeOf(path.basename(f.root))); } const ps = [...new Set(files.map(f => f.place))]; say(`  places from the folders: ${ps.slice(0, 12).join(' · ')}${ps.length > 12 ? ` and ${ps.length - 12} more` : ''}`); }

  // 3. The state kept on this computer: the fingerprints and the parts already sent, so a second run starts where this one stops.
  const sk = crypto.createHash('sha256').update(H.house + '|' + roots.map(r => path.resolve(r)).sort().join('|') + '|' + (minStars ?? '')).digest('hex').slice(0, 20);
  const sf = path.join(STATE, sk + '.json'); const S = readJSON(sf, { files: {} }); S.files = S.files || {};
  let dirty = false; const save = () => { if (dirty) { writeJSON(sf, S); dirty = false; } };
  const saver = setInterval(save, 3000); saver.unref();
  const rec = f => { const k = f.abs; let r = S.files[k]; if (!r || r.size !== f.size || r.mtime !== f.mtime) { r = S.files[k] = { size: f.size, mtime: f.mtime }; dirty = true; } return r; };

  const already = files.filter(f => rec(f).done).length;
  const left = files.filter(f => !rec(f).done);
  if (o.dry) {
    say(`\nA dry run: nothing sent.\n  would send ${left.length} file${left.length === 1 ? '' : 's'}, ${gb(left.reduce((a, f) => a + f.size, 0))}${already ? ` (${already} already sent from this computer)` : ''}`);
    for (const f of left.slice(0, 12)) say(`    ${f.rel}  ${gb(f.size)}  ${f.stars > 0 ? '★'.repeat(f.stars) : ''}`);
    if (left.length > 12) say(`    … and ${left.length - 12} more`);
    const mbps = +(o.mbps || 20); say(`  at ${mbps} Mbps up, about ${dur(left.reduce((a, f) => a + f.size, 0) * 8 / (mbps * 1e6) / 0.9)} (say --mbps N for your line)`);
    save(); return;
  }
  if (!left.length) { say(`All ${files.length} already sent from this computer.`); if (S.import) await wait(H, S.import, o); return; }

  // Keep a Mac awake while it sends (and only while).
  if (os.platform() === 'darwin') { try { spawn('caffeinate', ['-i', '-s', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref(); say('  keeping this Mac awake while it sends'); } catch (e) { /* fine */ } }

  // 4. One import for the batch (a resumed run keeps the one it began, for a day).
  if (!S.import || !S.importAt || Date.now() - S.importAt > 864e5) {
    const label = String(o.label || o.place || path.basename(path.resolve(roots[0])));
    const im = await H.call('/account/imports', { method: 'POST', type: 'application/x-watermark-import+json', body: { label, place: o.place || null, kind: o.kind || null, files: left.map(f => [f.name, f.size]) } });
    if (!im.ok) die('The house would not open an import: ' + (im.error || JSON.stringify(im)));
    S.import = im.id; S.importAt = Date.now(); S.href = im.href; dirty = true; save();
  }
  say(`  import ${S.import}: ${H.house}${S.href || `/account/imports/${S.import}`}\n`);

  // 5. Send: fingerprint a file ahead, ask, then parts.
  const t0 = Date.now(); let sentBytes = 0, sentAtStart = 0, doneN = 0; const counts = { sent: 0, held: 0, refused: 0 };
  const recent = []; // [time, bytes] for the speed over the last half minute
  const tick = n => { sentBytes += n; recent.push([Date.now(), n]); };
  let current = '';
  const show = setInterval(() => {
    const now = Date.now(); while (recent.length && recent[0][0] < now - 30000) recent.shift();
    const span = Math.max(1, (now - (recent.length ? recent[0][0] : now - 1000)) / 1000); const rate = recent.reduce((a, r) => a + r[1], 0) / span;
    const rest = total - sentBytes - sentAtStart; const s = `Sending ${doneN} of ${left.length} · ${gb(sentBytes)} of ${gb(left.reduce((a, f) => a + f.size, 0))} · ${rate > 0 ? (rate / 1e6).toFixed(1) + ' MB/s' : '…'}${rate > 1e4 ? ' · about ' + dur(rest / rate) + ' left' : ''} · ${current}`;
    if (tty) line(s); else if (now % 30000 < 1000) console.log(s);
  }, 1000); show.unref();

  let stop = false; process.on('SIGINT', () => { if (stop) process.exit(130); stop = true; save(); say('\nStopping after the parts in flight. Run the same line again to carry on.'); });

  const hashes = new Map(); // abs → Promise<sha>
  const fingerprint = f => { const r = rec(f); if (r.sha) return Promise.resolve(r.sha); if (!hashes.has(f.abs)) hashes.set(f.abs, sha256(f.abs).then(h => { r.sha = h; dirty = true; return h; })); return hashes.get(f.abs); };

  async function one(f) {
    const r = rec(f); current = f.name;
    const sha = await fingerprint(f);
    const st = await H.call('/account/arrivals/start', { method: 'POST', body: { name: f.name, size: f.size, type: f.type, sha256: sha, import_id: S.import, place: f.place || o.place || '', kind: o.kind || '', folder: path.dirname(f.rel) === '.' ? '' : path.dirname(f.rel), title: '' } });
    if (!st.ok) { counts.refused++; say(`  ✕ ${f.rel}: ${st.error || 'refused'}`); r.error = st.error; dirty = true; return; }
    if (st.already) { r.done = true; r.arrival = st.id; r.outcome = st.already; dirty = true; counts.held++; tick(0); sentAtStart += f.size; return; }
    if (r.arrival !== st.id) { r.arrival = st.id; r.etags = {}; dirty = true; }
    r.etags = r.etags || {};
    if (st.direct) {
      const need = []; for (let n = 1; n <= st.parts; n++) if (!r.etags[n]) need.push(n); else sentAtStart += Math.min(st.partSize, f.size - (n - 1) * st.partSize);
      const fh = await fsp.open(f.abs, 'r');
      try {
        let urls = {}; const getUrls = async ns => { const j = await H.call(`/account/arrivals/${st.id}/urls`, { method: 'POST', body: { parts: ns } }); if (!j.ok) throw new Error('the house would not sign the parts'); Object.assign(urls, j.urls); };
        let qi = 0;
        async function lane() {
          while (qi < need.length && !stop) {
            const n = need[qi++]; const off = (n - 1) * st.partSize, len = Math.min(st.partSize, f.size - off);
            const buf = Buffer.alloc(len); await fh.read(buf, 0, len, off);
            for (let t = 0; ; t++) {
              if (!urls[n]) await getUrls(need.slice(need.indexOf(n), need.indexOf(n) + 16));
              try {
                const res = await fetch(urls[n], { method: 'PUT', body: buf, headers: { 'content-length': String(len) } });
                if (res.ok) { r.etags[n] = (res.headers.get('etag') || '').replace(/"/g, ''); dirty = true; tick(len); break; }
                if (res.status === 403) delete urls[n]; // the signature ran out: ask again
                throw new Error(`the vault answered ${res.status}`);
              } catch (e) { if (t >= 8) throw e; await sleep(Math.min(60000, 1000 * 2 ** t)); }
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(partLanes, need.length || 1) }, lane));
      } finally { await fh.close(); }
      if (stop) return;
      const parts = Object.entries(r.etags).map(([n, etag]) => ({ n: +n, etag }));
      const d = await H.call(`/account/arrivals/${st.id}/done`, { method: 'POST', body: { parts } });
      if (!d.ok) { counts.refused++; say(`  ✕ ${f.rel}: ${d.error || 'the vault would not close it'}`); r.etags = {}; delete r.arrival; dirty = true; return; }
    } else {
      // the house's own road (a local vault): the whole file in one put, streamed
      for (let t = 0; ; t++) {
        try {
          const { Readable } = require('stream'); let n0 = 0;
          const body = Readable.toWeb(fs.createReadStream(f.abs, { highWaterMark: 1 << 20 }).on('data', d => { n0 += d.length; tick(d.length); }));
          const res = await fetch(`${H.house}/account/arrivals/${st.id}/body`, { method: 'PUT', body, duplex: 'half', headers: { authorization: `Bearer ${conf.key}`, 'content-type': 'application/octet-stream', 'content-length': String(f.size) } });
          const j = await res.json().catch(() => ({}));
          if (res.ok && j.ok) break;
          sentBytes -= n0; throw new Error(j.error || `the house answered ${res.status}`);
        } catch (e) { if (t >= 5) { counts.refused++; say(`  ✕ ${f.rel}: ${e.message}`); return; } await sleep(2000 * 2 ** t); }
      }
    }
    r.done = true; r.etags = undefined; dirty = true; counts.sent++;
  }

  let next = 0;
  async function worker() {
    while (next < left.length && !stop) {
      const f = left[next++];
      for (let k = next; k < Math.min(left.length, next + 2); k++) fingerprint(left[k]).catch(() => {}); // read ahead
      try { await one(f); } catch (e) { counts.refused++; say(`  ✕ ${f.rel}: ${e.message}`); }
      doneN++;
    }
  }
  await Promise.all(Array.from({ length: lanes }, worker));
  clearInterval(show); save();
  const secs = (Date.now() - t0) / 1000;
  say(`\n${stop ? 'Stopped' : 'Sent'}: ${counts.sent} sent${counts.held ? `, ${counts.held} the house already held (nothing sent)` : ''}${counts.refused ? `, ${counts.refused} not sent` : ''} · ${gb(sentBytes)} in ${dur(secs)}${secs > 5 ? ` (${(sentBytes / secs / 1e6).toFixed(1)} MB/s)` : ''}`);
  if (stop) process.exit(130);
  if (!o['no-wait']) await wait(H, S.import, o);
  if (counts.refused) process.exitCode = 1;
}

// The house reads each file (the bag check, the fingerprint, the picture): wait for every answer, then say them.
async function wait(H, id, o = {}) {
  say('The house is reading them (you can stop this; it carries on without you).');
  let j, last = '';
  for (let t = 0; ; t++) {
    j = await H.call(`/account/imports/${id}.json`); if (!j.ok) { say('  could not read the import: ' + (j.error || '')); return; }
    const c = j.counts; const busy = c.uploading + c.arrived + c.working;
    const s = `  ${c.held} held (${c.verified} verified) · ${c.already} already in the vault · ${c.need} need you · ${busy} being read${c.none ? ` · ${c.none} not sent` : ''}`;
    if (s !== last) { if (tty) line(s); else console.log(s); last = s; }
    if (!busy || t > 2880) break; // a day, at most
    await sleep(5000);
  }
  say(last);
  const need = (j.files || []).filter(f => f.state === 'need');
  for (const f of need.slice(0, 40)) say(`  needs you · ${f.name}: ${f.why}`);
  if (need.length > 40) say(`  … and ${need.length - 40} more on the import's page`);
  say(`\nThe import, file by file:  ${H.house}/account/imports/${id}\nThe receipt (CSV):         ${H.house}/account/imports/${id}/receipt.csv`);
}

async function status(o) {
  const conf = readJSON(CONF, null); if (!conf || !conf.key) die('This computer is not signed in. Run: node watermark.js login');
  const H = client(conf); let id = +o._[1];
  if (!id) { const ss = fs.existsSync(STATE) ? fs.readdirSync(STATE).map(f => readJSON(path.join(STATE, f), {})).filter(s => s.import).sort((a, b) => (b.importAt || 0) - (a.importAt || 0)) : []; if (!ss.length) die('No import from this computer yet.'); id = ss[0].import; }
  await wait(H, id, o);
}

function help() {
  say(`watermark ${VERSION}: send an archive to your Watermark vault.

  node watermark.js login [--house URL]      let this computer send (a code, approved where you are signed in)
  node watermark.js push <folder…> [options] send pictures and DNGs, culled by stars, never twice
  node watermark.js status [import]          where the last import (or one by number) stands
  node watermark.js logout                   forget this computer's key (end it on the site too: Your computers)

push options:
  --stars N     only what you gave N stars or more in Lightroom (rejects are always left out)
  --place P     the place, for every work in the batch ("Philadelphia")
  --places      the place from each file's folder under the one you name (EUROPE/08_FLORENCE → Florence)
  --label L     the import's name (default: the place, else the folder)
  --kind K      photograph (default), painting, drawing, print…
  --dry         say what would go, how much and how long; send nothing
  --files N     files in flight at once (3)      --parts N   parts in flight per file (4)
  --mbps N      your upload speed, for the dry run's estimate (20)
  --no-wait     do not wait for the house to read them

Stars: Lightroom Classic writes them into the file when you export with metadata, or beside a raw as an .xmp when
"Automatically write changes into XMP" is on (Catalog Settings → Metadata), or after Metadata → Save Metadata to File.
Stop it whenever you like; the same line again carries on where it stopped. Your files are only read, never changed.`);
}

(async () => {
  const o = args(process.argv.slice(2)); const cmd = o._[0];
  if (typeof fetch !== 'function') die('This needs Node 18 or later: https://nodejs.org');
  if (cmd === 'login') return login(o);
  if (cmd === 'push') return push(o);
  if (cmd === 'status') return status(o);
  if (cmd === 'logout') { try { fs.unlinkSync(CONF); } catch (e) { /* none */ } return say('Forgotten on this computer. End it on the site as well: Your studio → Your computers.'); }
  if (cmd === '--version' || cmd === 'version') return say(VERSION);
  help();
})().catch(e => { say('Something went wrong: ' + (e && e.message)); process.exit(1); });
