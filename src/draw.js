// Draw (Will, 26 Oct: "painting, drawing": the second of the house's creative tools, after Write; the easel is the
// seed). A sheet on the dark wall with real brushes: pencil, ink, brush, wash and an eraser, pressure where the
// device has it, layers, undo. Draw from a held work: the picture stands beside the sheet (or beneath it, to trace)
// with the easel's tools over it (grid, values, notan). A drawing is yours: it lives in your browser until you keep
// it, kept under your name when you are signed in (a maker or a collector), taken out as a PNG and as the house's
// own file (.wmd, a JSON of layers) that opens again here; and a maker can put a drawing in the vault as a work of
// kind 'drawing'. Nothing of a drawing is told to anyone; nothing on the register until it is a work.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

function mountDraw(app, { db, V, C, ledger, makerOf, buyerOf, mk, store, registerWork }) {
  const { esc, tidy } = V; const I = require('./icons');
  db.exec(`CREATE TABLE IF NOT EXISTS drawings (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL DEFAULT 'Untitled', ref_slug TEXT, width INTEGER, height INTEGER, layers INTEGER NOT NULL DEFAULT 1, bytes INTEGER NOT NULL DEFAULT 0, sha256 TEXT, work_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE INDEX IF NOT EXISTS drawings_owner ON drawings (owner, updated_at)`);
  const dir = path.join(C.dataDir, 'drawings'); fs.mkdirSync(dir, { recursive: true });
  const MAX_WMD = (+process.env.DRAW_MAX_MB || 40) * 1024 * 1024;
  const who = req => { const m = makerOf(req); if (m) return { key: `m:${m.id}`, m, b: null, name: m.name }; const b = buyerOf(req); if (b) return { key: `b:${b.id}`, m: null, b, name: b.name }; return null; };
  const mine = (o, id) => (o ? db.prepare('SELECT * FROM drawings WHERE id=? AND owner=?').get(Number(id), o.key) : null);
  const files = d => ({ wmd: path.join(dir, `${d.id}.wmd`), png: path.join(dir, `${d.id}.png`) });
  const dataUrl = s => { const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(s || '')); return m ? Buffer.from(m[1], 'base64') : null; };
  const list = o => (o ? db.prepare('SELECT * FROM drawings WHERE owner=? ORDER BY updated_at DESC LIMIT 200').all(o.key) : []);

  // The sheet.
  function sheet(req, res, { d = null, ref = null } = {}) {
    const o = who(req); const qb = String(req.query.back || '').replace(/[^\w\-/?=&.%]/g, ''); const back = qb && qb.startsWith('/') ? qb : d ? '/draw/mine' : ref ? `/w/${ref.slug}` : (o ? '/draw/mine' : '/house');
    const rm = ref ? mk(ref) : null;
    const tool = (k, key, word, title) => `<button type="button" data-dw-tool="${k}" aria-pressed="false" title="${esc(title)} (${key})"><span class="dw-k">${key}</span>${word}</button>`;
    const body = `<main class="dw" data-draw data-owner="${o ? esc(o.key) : ''}" data-maker="${o && o.m ? '1' : ''}" data-id="${d ? d.id : ''}" data-file="${d ? `/draw/d/${d.id}/file` : ''}" data-ref="${ref ? esc(ref.slug) : ''}" data-ref-src="${ref ? `/img/${esc(ref.slug)}/large` : ''}" data-ar="${ref && ref.width && ref.height ? (ref.width / ref.height).toFixed(4) : '1.5'}" data-title="${esc(d ? d.title : ref ? `After ${tidy(ref.title)}` : 'Untitled')}">
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="dw-notan" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="discrete" tableValues="0.06 0.94"/><feFuncG type="discrete" tableValues="0.06 0.94"/><feFuncB type="discrete" tableValues="0.06 0.94"/></feComponentTransfer></filter></svg>
<header class="dw-top"><a class="dw-back" href="${esc(back)}">${I.back}<span>Back</span></a>
<input class="dw-title" data-dw-title value="${esc(d ? d.title : ref ? `After ${tidy(ref.title)}` : 'Untitled')}" maxlength="120" aria-label="The drawing's title">
<span class="dw-state" data-dw-state aria-live="polite"></span>
<div class="dw-acts">
<button type="button" data-dw="undo" title="Undo (⌘Z)">${I.back}<span>Undo</span></button><button type="button" data-dw="redo" title="Redo (⌘⇧Z)">${I.next}<span>Redo</span></button>
${ref ? `<button type="button" data-dw="ref" aria-pressed="true" title="The reference beside the sheet (R)"><span>Reference</span></button><button type="button" data-dw="trace" aria-pressed="false" title="The reference under the sheet, faint, to trace (Shift+T)"><span>Trace</span></button>` : ''}
<button type="button" data-dw="mirror" aria-pressed="false" title="Mirror the sheet to see your errors fresh (M)"><span>Mirror</span></button>
<button type="button" data-dw="fit" title="Fit (0)"><span>Fit</span></button>
<button type="button" class="dw-layb" data-dw="layers" title="The layers"><span>Layers</span></button>
<button type="button" data-dw="png" title="Take the drawing out as a PNG">${I.out}<span>PNG</span></button>
<button type="button" data-dw="wmd" title="Take the house's own file (.wmd): every layer, opens here again">${I.page}<span>File</span></button>
<label class="dw-open" title="Open a .wmd, or lay a picture in as a layer">${I.in}<span>Open</span><input type="file" data-dw-open accept=".wmd,application/json,image/*" hidden></label>
${o ? `<button type="button" class="dw-keep" data-dw="keep" title="Keep it under your name on Watermark (⌘S)">${I.check}<span>Keep</span></button>` : `<a class="dw-keep" href="/signin?next=${encodeURIComponent(req.originalUrl)}" title="Sign in to keep drawings under your name">${I.key}<span>Sign in to keep</span></a>`}
${d && o && o.m ? `<form method="post" action="/draw/d/${d.id}/vault" data-dw-vault><button class="dw-vault" title="Put the drawing in the vault as a work of your own: deeded, fingerprinted, kept back until you publish it">${I.collect}<span>To the vault</span></button></form>` : ''}
</div></header>
<div class="dw-room" data-dw-room>
<div class="dw-stage" data-dw-stage><div class="dw-paper" data-dw-paper>${ref ? `<img class="dw-trace" data-dw-traceim src="/img/${esc(ref.slug)}/large" alt="" hidden draggable="false">` : ''}<canvas data-dw-canvas></canvas><canvas class="dw-live" data-dw-live></canvas></div></div>
${ref ? `<aside class="dw-ref" data-dw-ref><div class="dw-refw"><img data-dw-refim src="/img/${esc(ref.slug)}/large" alt="${esc(tidy(ref.title))}" draggable="false"><div class="dw-grid" data-dw-grid hidden></div></div>
<p class="dw-plate"><b>${esc(tidy(ref.title))}</b>${rm ? ` · ${esc(rm.name)}` : ''}${ref.place ? ` · ${esc(ref.place)}` : ''}</p>
<nav class="dw-reft" aria-label="The reference"><button type="button" data-dw-rf="grid" aria-pressed="false" title="Grid (G)">Grid</button><button type="button" data-dw-rf="values" aria-pressed="false" title="Values (V)">Values</button><button type="button" data-dw-rf="squint" aria-pressed="false" title="Squint (S)">Squint</button><button type="button" data-dw-rf="notan" aria-pressed="false" title="Notan (N)">Notan</button><a href="/easel/${esc(ref.slug)}?back=${encodeURIComponent(req.originalUrl)}" title="The easel: the picture alone, large">Easel</a></nav></aside>` : ''}
</div>
<nav class="dw-tools" aria-label="The tools">
${tool('pencil', 'P', 'Pencil', 'A hard graphite line, lighter with a light hand')}${tool('ink', 'I', 'Ink', 'A pen: a dark line that thickens as you press')}${tool('brush', 'B', 'Brush', 'A soft round brush')}${tool('wash', 'W', 'Wash', 'A wide, thin wash that builds where it overlaps')}${tool('eraser', 'E', 'Eraser', 'Lifts what is on the layer')}${tool('hand', 'H', 'Hand', 'Move and zoom the sheet (or two fingers, or space)')}
<label class="dw-size" title="Size ([ and ])"><span>Size</span><input type="range" min="1" max="200" value="6" data-dw-size><output data-dw-sizeo>6</output></label>
<label class="dw-op" title="Opacity"><span>Opacity</span><input type="range" min="2" max="100" value="100" data-dw-opacity><output data-dw-opo>100</output></label>
<div class="dw-colors" data-dw-colors>${['#111111', '#4a4a4a', '#8a8a8a', '#ffffff', '#5e0b14', '#c9a24a', '#2a4d69', '#3b6b3f', '#b4552d', '#e3d3b5', '#6b4f3a', '#d9bc7c'].map((c, i) => `<button type="button" data-dw-color="${c}" style="--c:${c}" aria-pressed="${i === 0 ? 'true' : 'false'}" title="${c}"></button>`).join('')}<label class="dw-pick" title="Any colour"><input type="color" value="#111111" data-dw-picker><span>+</span></label></div>
</nav>
<aside class="dw-layers" data-dw-layers><p class="k">Layers <button type="button" data-dw="addlayer" title="A new layer above (⌘L)">${I.plus}<span>Add</span></button></p><ol data-dw-layerlist></ol>
<div class="dw-lacts"><button type="button" data-dw="layerup" title="Bring forward">${I.back}</button><button type="button" data-dw="layerdown" title="Send back">${I.next}</button><label title="The layer's opacity"><input type="range" min="0" max="100" value="100" data-dw-lop></label><button type="button" data-dw="dellayer" title="Remove the layer">${I.close}</button></div></aside>
<p class="dw-hint" data-dw-hint>Draw with a pen, a finger or a mouse; two fingers (or space) move the sheet. P I B W E for the tools, [ ] for size, ⌘Z undoes. ${o ? 'Keep saves it under your name; ' : ''}PNG and File take it out. Al: start with the big shapes; the detail is a lie until the gesture is true.</p>
<template data-dw-ic="eye">${I.eye}</template><template data-dw-ic="check">${I.check}</template>
</main><script src="/static/draw.js?v=${V.VER}" defer></script>`;
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: `${d ? tidy(d.title) : ref ? `Draw · ${tidy(ref.title)}` : 'Draw'} · Watermark`, path: '/draw', bare: true, body }));
  }

  app.get('/draw', (req, res) => sheet(req, res));
  app.get('/draw/from/:slug', (req, res) => {
    const w = db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(req.params.slug); if (!w) return res.redirect('/draw');
    if (app.locals.zone && app.locals.zone.mature(w) && !app.locals.zone.open(req)) return res.redirect(`/w/${encodeURIComponent(w.slug)}`);
    sheet(req, res, { ref: w });
  });
  // Your drawings.
  app.get('/draw/mine', (req, res) => {
    const o = who(req); if (!o) return res.redirect('/signin?next=/draw/mine');
    const ds = list(o);
    const body = `<section class="cx-intro dwm"><p class="k">Draw</p><h1>Your drawings.</h1>
<p class="lede">What you have drawn in the house, kept under your name. Open one to go on, take it out as a PNG or the house's file${o.m ? ', or put it in the vault as a work of your own' : ''}. Nothing here is shown to anyone.</p>
<p class="dwm-new"><a class="buy-btn" href="/draw">A blank sheet</a> <a class="link" href="/wander">Or draw from a work: open it and choose Draw</a></p>
${ds.length ? `<div class="dwm-grid">${ds.map(d => `<a class="dwm-card" href="/draw/d/${d.id}"><img src="/draw/d/${d.id}/png?v=${encodeURIComponent(d.updated_at)}" alt="" loading="lazy"><b>${esc(tidy(d.title))}</b><i>${esc(String(d.updated_at).slice(0, 10))} · ${d.layers} layer${d.layers === 1 ? '' : 's'}${d.work_id ? ' · in the vault' : ''}</i></a>`).join('')}</div>` : '<p class="yc-shelf">Nothing drawn yet.</p>'}
</section>`;
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: 'Your drawings · Watermark', path: '/draw', body }));
  });
  app.get('/draw/d/:id', (req, res) => { const o = who(req); const d = mine(o, req.params.id); if (!d) return o ? res.redirect('/draw/mine') : res.redirect(`/signin?next=${encodeURIComponent(req.originalUrl)}`); const ref = d.ref_slug ? db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(d.ref_slug) : null; sheet(req, res, { d, ref }); });
  app.get('/draw/d/:id/file', (req, res) => { const d = mine(who(req), req.params.id); if (!d) return res.sendStatus(404); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Content-Disposition', `attachment; filename="${(tidy(d.title) || 'drawing').replace(/[^\w .-]+/g, '')}.wmd"`); res.type('application/json').sendFile(files(d).wmd); });
  app.get('/draw/d/:id/png', (req, res) => { const d = mine(who(req), req.params.id); if (!d) return res.sendStatus(404); res.setHeader('Cache-Control', 'private, no-store'); res.type('image/png').sendFile(files(d).png); });
  // Keep: the house's file (every layer) and the flattened PNG, under the owner's name.
  // The drawing arrives as its own type, so the house's 64 KB body limits for forms and JSON do not apply to it.
  const bodyOf = require('express').json({ type: 'application/x-watermark-drawing+json', limit: MAX_WMD + 4 * 1024 * 1024 });
  app.post('/draw/save', bodyOf, (req, res) => {
    const o = who(req); if (!o) return res.status(401).json({ error: 'Sign in to keep a drawing.' });
    const b = req.body || {}; const wmd = String(b.wmd || ''); if (!wmd || wmd.length > MAX_WMD) return res.status(400).json({ error: wmd ? 'The drawing is too large to keep here; take it out as a file.' : 'Nothing to keep.' });
    let j; try { j = JSON.parse(wmd); } catch (e) { return res.status(400).json({ error: 'Not a drawing.' }); }
    if (!j || !Array.isArray(j.layers) || !j.layers.length || !(j.w > 0 && j.h > 0)) return res.status(400).json({ error: 'Not a drawing.' });
    const png = dataUrl(b.png); if (!png || png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) return res.status(400).json({ error: 'The flattened picture did not arrive.' });
    const title = String(b.title || j.title || 'Untitled').trim().slice(0, 120) || 'Untitled';
    let d = b.id ? mine(o, b.id) : null;
    if (d) db.prepare("UPDATE drawings SET title=?, width=?, height=?, layers=?, bytes=?, sha256=?, updated_at=datetime('now') WHERE id=?").run(title, j.w, j.h, j.layers.length, wmd.length, crypto.createHash('sha256').update(png).digest('hex'), d.id);
    else { const id = db.prepare('INSERT INTO drawings (owner, title, ref_slug, width, height, layers, bytes, sha256) VALUES (?,?,?,?,?,?,?,?)').run(o.key, title, j.ref ? String(j.ref).slice(0, 80) : null, j.w, j.h, j.layers.length, wmd.length, crypto.createHash('sha256').update(png).digest('hex')).lastInsertRowid; d = db.prepare('SELECT * FROM drawings WHERE id=?').get(id); }
    const f = files(d); fs.writeFileSync(f.wmd, wmd); fs.writeFileSync(f.png, png);
    if (store && store.kind === 's3') { Promise.all([store.put(`drawings/${d.id}.wmd`, f.wmd, 'application/json'), store.put(`drawings/${d.id}.png`, f.png, 'image/png')]).catch(e => console.warn('[draw] vault', e.message)); }
    res.json({ ok: true, id: d.id, href: `/draw/d/${d.id}` });
  });
  app.post('/draw/d/:id/remove', (req, res) => {
    const o = who(req); const d = mine(o, req.params.id); if (!d) return res.sendStatus(404);
    const f = files(d); [f.wmd, f.png].forEach(p => { try { fs.unlinkSync(p); } catch (e) { /* */ } });
    db.prepare('DELETE FROM drawings WHERE id=?').run(d.id); res.redirect('/draw/mine');
  });
  // To the vault: a maker's drawing becomes a work of their own, kind 'drawing', kept back until published.
  app.post('/draw/d/:id/vault', async (req, res) => {
    const o = who(req); const d = mine(o, req.params.id); if (!d || !o.m) return res.sendStatus(d ? 403 : 404);
    if (d.work_id) { const w = db.prepare('SELECT slug FROM works WHERE id=?').get(d.work_id); if (w) return res.redirect(`/account/works/${w.slug}`); }
    const f = files(d); const tmp = path.join(C.dataDir, 'incoming', `draw-${d.id}-${Date.now()}.png`); fs.mkdirSync(path.dirname(tmp), { recursive: true }); fs.copyFileSync(f.png, tmp);
    try {
      const w = await registerWork({ file: tmp, title: d.title, caption: d.ref_slug ? `Drawn from ${d.ref_slug} on Watermark.` : null, originalName: `${d.title}.png`, makerId: o.m.id, kind: 'drawing' });
      db.prepare("UPDATE works SET status='hidden', credit=COALESCE(credit, ?) WHERE id=?").run(o.m.name, w.id); // kept back until the maker publishes it
      db.prepare('UPDATE drawings SET work_id=? WHERE id=?').run(w.id, d.id);
      try { ledger.append(db, 'drawing.vaulted', w.slug, { drawing: d.id }); } catch (e) { /* */ }
      res.redirect(`/account/works/${w.slug}?ok=drawn`);
    } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* */ } res.status(400).send(V.layout({ title: 'The vault · Watermark', body: `<section class="cx-intro"><h1>Not this one.</h1><p class="lede">${esc(e.message)}</p><p><a href="/draw/d/${d.id}">Back to the drawing</a></p></section>` })); }
  });
  // The door on a work's page and in the rails.
  const door = (w, { cls = '' } = {}) => `<a class="${cls}" href="/draw/from/${esc(w.slug)}" title="Draw from it: the picture beside a sheet with real brushes">${I.pencil}<span>Draw</span></a>`;
  app.locals.draw = { door, list, who };
  return app.locals.draw;
}
module.exports = { mountDraw };
