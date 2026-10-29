// Imports (29 Oct, Will: "we have to be the best at managing these large files; we never can mess up; someday we're
// going to be entrusted with big, big imports; this has to be seamless"). A dump is one thing, not 363 loose files:
// the list of what was chosen is kept when the person presses Send, every arrival is tied to it, and the import
// page says at every moment where each file is: not sent yet · sending · being read · held (verified: the bytes the
// house holds are the bytes that left the computer) · already in the vault · needs you (with why). When every file
// has an answer the maker is told by notice and letter, and the receipt (CSV) can be kept. Nothing here moves a file;
// it reads the arrivals. A file in two imports (chosen again) answers in both: the manifest is matched by name and
// size against the latest arrival of the same hand.
//   Table `imports`: id, by ('studio' | 'm:<id>'), purpose (master | work), maker_id, label, place, kind, manifest
//   (JSON [[name, size], …]), n, bytes, created_at, finished_at, told_at.
//   Routes, at /studio and /account: POST …/imports {label, place, kind, files} → {id, href}; GET …/imports (the list);
//   GET …/imports/:id (the page; ?frag=1 the table alone, for the page's own refresh); GET …/imports/:id.json;
//   GET …/imports/:id/receipt.csv.
const MAX_FILES = Number(process.env.IMPORT_MAX_FILES || 20000);

function mountImports(app, { db, studioOnly, makerOf }) {
  db.exec(`CREATE TABLE IF NOT EXISTS imports (id INTEGER PRIMARY KEY, by TEXT NOT NULL, purpose TEXT NOT NULL, maker_id INTEGER, label TEXT, place TEXT, kind TEXT,
    manifest TEXT NOT NULL, n INTEGER NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT, told_at TEXT)`);
  const V = require('./views'); const esc = V.esc;
  const maker = req => (makerOf ? makerOf(req) : null);
  const whoOf = (req, base) => (base === '/studio' ? 'studio' : (maker(req) ? `m:${maker(req).id}` : null));
  const byId = id => db.prepare('SELECT * FROM imports WHERE id=?').get(+id);
  const mineOf = (req, base) => { const i = byId(req.params.id); const w = whoOf(req, base); return i && w && i.by === w ? i : null; };
  const fmt = b => (b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? Math.round(b / 1e6) + ' MB' : Math.round(b / 1e3) + ' KB');

  // Where each chosen file stands, from the latest arrival of the same hand with the same name and size.
  const STATE = { none: 'Not sent yet', uploading: 'Sending', arrived: 'In the vault, waiting to be read', working: 'Being read', held: 'Held', already: 'Already in the vault', need: 'Needs you' };
  function rows(imp) {
    let man = []; try { man = JSON.parse(imp.manifest) || []; } catch (e) { man = []; }
    const latest = db.prepare(`SELECT id, status, outcome, slug, title, error, verified, result, done_at FROM arrivals WHERE by=? AND purpose=? AND name=? AND size=? AND created_at >= ? ORDER BY id DESC LIMIT 1`);
    return man.map(([name, size]) => {
      const a = latest.get(imp.by, imp.purpose, String(name), +size, imp.created_at.slice(0, 10) + ' 00:00:00');
      let st = 'none', why = '';
      if (a) {
        if (a.status === 'uploading' || a.status === 'arrived' || a.status === 'working') st = a.status;
        else if (a.status === 'done') st = a.outcome === 'known' || a.outcome === 'held' ? 'already' : 'held';
        else if (a.status === 'failed') { if (/already held|already in the vault/i.test(a.error || '')) st = 'already'; else { st = 'need'; why = a.error || 'Could not be taken in.'; } }
      }
      return { name: String(name), size: +size, state: st, label: STATE[st], why, verified: !!(a && a.verified), slug: a && a.slug, title: a && a.title, arrival: a && a.id, at: a && a.done_at };
    });
  }
  function summary(imp) {
    const rs = rows(imp); const c = { chosen: rs.length, none: 0, uploading: 0, arrived: 0, working: 0, held: 0, already: 0, need: 0, verified: 0 };
    for (const r of rs) { c[r.state]++; if (r.verified) c.verified++; }
    c.sent = c.chosen - c.none - c.uploading; c.answered = c.held + c.already + c.need; c.done = c.answered === c.chosen;
    return { c, rs };
  }
  // Finished when every file has its answer; a day on, what was never sent is named and the import is closed so the
  // maker hears: choosing the folder again sends only what is missing (the house asks before sending).
  async function check(id) {
    const imp = byId(id); if (!imp || imp.finished_at) return;
    const { c } = summary(imp);
    const old = db.prepare("SELECT 1 FROM imports WHERE id=? AND created_at < datetime('now','-1 day')").get(imp.id);
    if (!c.done && !(old && c.uploading + c.arrived + c.working === 0)) return;
    db.prepare("UPDATE imports SET finished_at=datetime('now') WHERE id=? AND finished_at IS NULL").run(imp.id);
    if (imp.told_at) return; db.prepare("UPDATE imports SET told_at=datetime('now') WHERE id=?").run(imp.id);
    const title = `${imp.label || 'Your import'}: ${c.held + c.already} of ${c.chosen} in the vault${c.need ? `; ${c.need} need${c.need === 1 ? 's' : ''} you` : ''}${c.none ? `; ${c.none} not sent` : ''}.`;
    const href = (imp.purpose === 'master' ? '/studio' : '/account') + '/imports/' + imp.id;
    try { if (imp.maker_id && app.locals.notify) await app.locals.notify.tell({ maker_id: imp.maker_id, kind: 'import', title, body: c.verified ? `Every file held was checked against the fingerprint taken on your computer: ${c.verified} verified.` : '', href }); } catch (e) { console.error('[imports] tell', e.message); }
    try {
      const m = imp.maker_id ? db.prepare('SELECT * FROM makers WHERE id=?').get(imp.maker_id) : null; const mail = require('./mail');
      const to = m && m.email ? m.email : process.env.HOUSE_EMAIL; const base = process.env.BASE_URL || '';
      if (to) await mail.send({ to, subject: title, text: `${title}\n\n${c.held} held${c.verified ? ` (${c.verified} verified: the bytes the house holds are the bytes that left your computer)` : ''}, ${c.already} already in the vault${c.need ? `, ${c.need} need you` : ''}${c.none ? `, ${c.none} not sent (choose the same files again: only those go)` : ''}.\n\nThe import, file by file, and its receipt:\n${base}${href}\n\nWatermark` });
    } catch (e) { console.error('[imports] letter', e.message); }
  }
  const pending = new Set();
  const soon = id => { if (!id || pending.has(id)) return; pending.add(id); setTimeout(() => { pending.delete(id); check(id).catch(e => console.error('[imports]', e.message)); }, 1500).unref(); };

  for (const base of ['/studio', '/account']) {
    const guard = base === '/studio' ? studioOnly : (req, res, next) => (maker(req) ? next() : (req.method === 'GET' && !/\.(json|csv)$/.test(req.path) ? res.redirect('/signin?next=' + encodeURIComponent(req.originalUrl)) : res.status(401).json({ ok: false, error: 'Sign in.' })));
    const purpose = base === '/studio' ? 'master' : 'work';
    // The list rides as its own type (an import of 20,000 files is a megabyte; the house's form limit is 64 KB).
    app.post(`${base}/imports`, guard, require('express').json({ type: 'application/x-watermark-import+json', limit: '8mb' }), (req, res) => {
      let files = []; try { files = typeof req.body.files === 'string' ? JSON.parse(req.body.files) : req.body.files; } catch (e) { files = []; }
      files = (Array.isArray(files) ? files : []).filter(f => Array.isArray(f) && f[0] && +f[1] > 0).slice(0, MAX_FILES).map(f => [String(f[0]).slice(0, 200), Math.floor(+f[1])]);
      if (!files.length) return res.status(400).json({ ok: false, error: 'Nothing chosen.' });
      const m = purpose === 'work' ? maker(req) : null; const bytes = files.reduce((a, f) => a + f[1], 0);
      const r = db.prepare('INSERT INTO imports (by, purpose, maker_id, label, place, kind, manifest, n, bytes) VALUES (?,?,?,?,?,?,?,?,?)').run(whoOf(req, base), purpose, m ? m.id : null,
        String(req.body.label || '').trim().slice(0, 120) || null, String(req.body.place || '').trim().slice(0, 120) || null, String(req.body.kind || '').trim().slice(0, 30) || null, JSON.stringify(files), files.length, bytes);
      res.json({ ok: true, id: r.lastInsertRowid, href: `${base}/imports/${r.lastInsertRowid}` });
    });
    app.get(`${base}/imports/:id.json`, guard, (req, res) => { const i = mineOf(req, base); if (!i) return res.status(404).json({ ok: false }); res.set('Cache-Control', 'private, no-store'); const { c, rs } = summary(i); res.json({ ok: true, id: i.id, label: i.label, place: i.place, created_at: i.created_at, finished_at: i.finished_at, counts: c, files: rs }); });
    app.get(`${base}/imports/:id/receipt.csv`, guard, (req, res) => {
      const i = mineOf(req, base); if (!i) return res.sendStatus(404); const { c, rs } = summary(i);
      const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const lines = [['file', 'bytes', 'state', 'verified', 'work', 'title', 'why', 'answered_at'].join(',')].concat(rs.map(r => [r.name, r.size, r.label, r.verified ? 'yes' : '', r.slug || '', r.title || '', r.why, r.at || ''].map(q).join(',')));
      lines.push('', ['chosen', c.chosen].join(','), ['held', c.held].join(','), ['verified', c.verified].join(','), ['already in the vault', c.already].join(','), ['needs you', c.need].join(','), ['not sent', c.none].join(','));
      res.setHeader('Content-Disposition', `attachment; filename="watermark-import-${i.id}.csv"`); res.type('text/csv; charset=utf-8').send(lines.join('\n') + '\n');
    });
    app.get(`${base}/imports`, guard, (req, res) => {
      const w = whoOf(req, base); const list = db.prepare('SELECT * FROM imports WHERE by=? AND purpose=? ORDER BY id DESC LIMIT 60').all(w, purpose);
      const body = `<section class="studio-wrap imx"><p class="k">${base === '/studio' ? 'The house' : 'Your studio'}</p><h1>Imports.</h1><p class="lede">Every batch put into the vault, and where each file stands.</p>
<ol class="imx-list">${list.map(i => { const { c } = summary(i); return `<li><a href="${base}/imports/${i.id}"><b>${esc(i.label || i.place || 'Import ' + i.id)}</b><span>${i.created_at.slice(0, 16)} · ${c.chosen} files, ${fmt(i.bytes)}</span><span class="imx-c">${c.held + c.already} in${c.need ? ` · <em>${c.need} need you</em>` : ''}${c.none ? ` · ${c.none} not sent` : ''}${c.done ? ' · done' : ''}</span></a></li>`; }).join('') || '<li class="muted">Nothing imported yet.</li>'}</ol></section>`;
      res.send(V.layout({ title: 'Imports · Watermark', path: base + '/imports', studio: true, body }));
    });
    app.get(`${base}/imports/:id`, guard, (req, res) => {
      const i = mineOf(req, base); if (!i) return res.sendStatus(404); res.set('Cache-Control', 'private, no-store');
      const { c, rs } = summary(i);
      const order = { need: 0, uploading: 1, working: 2, arrived: 3, none: 4, held: 5, already: 6 };
      const sorted = rs.slice().sort((a, b) => order[a.state] - order[b.state]);
      const table = `<div class="imx-n"><span><b>${c.chosen}</b> chosen</span><span><b>${c.sent}</b> sent</span><span><b>${c.verified}</b> verified</span><span><b>${c.held}</b> held</span><span><b>${c.already}</b> already in</span><span class="${c.need ? 'imx-need' : ''}"><b>${c.need}</b> need you</span>${c.none ? `<span><b>${c.none}</b> not sent</span>` : ''}</div>
<div class="imx-bar"><i style="width:${(100 * c.answered / Math.max(1, c.chosen)).toFixed(1)}%"></i></div>
<p class="imx-say">${c.done ? (c.need ? `Finished. ${c.need} need${c.need === 1 ? 's' : ''} you: the reasons are beside each.` : `Finished. Every file has its answer.`) : c.none && c.none === c.chosen - c.answered - c.uploading - c.arrived - c.working ? `${c.none} not sent yet. Choose the same files again in the vault: the house asks before sending and only these go.` : `Under way: ${c.answered} of ${c.chosen} answered. This page keeps itself current; you can close it.`}</p>
<table class="tbl imx-t"><thead><tr><th>File</th><th>Size</th><th>Where it is</th><th></th></tr></thead><tbody>${sorted.map(r => `<tr class="imx-${r.state}"><td>${r.slug ? `<a href="${base === '/studio' ? '/studio/works/' : '/account/works/'}${encodeURIComponent(r.slug)}">${esc(r.name)}</a>` : esc(r.name)}</td><td>${fmt(r.size)}</td><td>${esc(r.label)}${r.verified ? ' · <span class="imx-v" title="The fingerprint of the bytes held matches the one taken on the computer it came from">verified</span>' : ''}</td><td class="muted">${esc(r.why)}</td></tr>`).join('')}</tbody></table>`;
      if (req.query.frag) return res.send(table);
      const body = `<section class="studio-wrap imx"><p class="k"><a href="${base}/imports">Imports</a></p><h1>${esc(i.label || i.place || 'Import ' + i.id)}.</h1>
<p class="lede">${c.chosen} files, ${fmt(i.bytes)}, put in on ${i.created_at.slice(0, 16)} UTC${i.place ? ` · ${esc(i.place)}` : ''}. <a href="${base}/imports/${i.id}/receipt.csv">The receipt (CSV)</a></p>
<div id="imxT">${table}</div></section>
${c.done ? '' : `<script>(function(){var t=document.getElementById('imxT');setInterval(function(){fetch(location.pathname+'?frag=1',{credentials:'same-origin',cache:'no-store'}).then(function(r){return r.ok?r.text():null}).then(function(h){if(h)t.innerHTML=h})},5000)})();</script>`}`;
      res.send(V.layout({ title: `${i.label || 'Import'} · Watermark`, path: base + '/imports', studio: true, body }));
    });
  }
  // Any import still open is looked at every ten minutes (a day-old one with nothing moving is closed and told).
  if (process.env.NODE_ENV !== 'test') setInterval(() => { for (const r of db.prepare('SELECT id FROM imports WHERE finished_at IS NULL').all()) check(r.id).catch(() => {}); }, 10 * 60e3).unref();
  app.locals.imports = { check, soon, summary, rows, byId };
}
module.exports = { mountImports };
