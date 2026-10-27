// What's new (Will, 27 Oct: "we built a product and it is a legitimate shipped product; we've done the MVP and now every
// launch is adding on"). CHANGELOG.md is the record; /releases shows it in the house's voice; the footer carries the version.
const fs = require('fs'); const path = require('path');
const FILE = path.join(__dirname, '..', 'CHANGELOG.md');
function read() { try { return fs.readFileSync(FILE, 'utf8'); } catch (e) { return ''; } }
function releases() {
  const out = []; let cur = null;
  for (const line of read().split('\n')) {
    const h = line.match(/^## ([\d.]+) · (.+?) · (.+)$/);
    if (h) { cur = { version: h[1], name: h[2], date: h[3], paras: [], items: [] }; out.push(cur); continue; }
    if (!cur) continue;
    const it = line.match(/^- (.*)$/); if (it) { cur.items.push(it[1]); continue; }
    if (line.trim()) { if (cur.items.length) cur.items[cur.items.length - 1] += ' ' + line.trim(); else if (cur.paras.length && !/^\s*$/.test(line) && !cur._gap) cur.paras[cur.paras.length - 1] += ' ' + line.trim(); else cur.paras.push(line.trim()); cur._gap = false; } else cur._gap = true;
  }
  return out;
}
const current = () => (releases()[0] || {}).version || '1.0';
function mountReleases(app, { V }) {
  const { esc } = V;
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
  app.get('/releases', (req, res) => {
    const rs = releases();
    res.send(V.layout({ title: 'What’s new · Watermark', path: '/releases', desc: 'Each release of the house, named and dated.', body: `<main class="wrap rls"><p class="k">The house</p><h1>What’s new.</h1>
<p class="lede">Watermark is a shipped product. Each release is named and dated here, in plain words. Nothing is announced that is not already running.</p>
${rs.map(r => `<section class="rls-r"><h2>${esc(r.version)} · ${esc(r.name)}</h2><p class="k">${esc(r.date)}</p>${r.paras.map(p => `<p>${inline(p)}</p>`).join('')}<ul>${r.items.map(i => `<li>${inline(i)}</li>`).join('')}</ul></section>`).join('')}
<p class="note">The record is kept in the open, in the house’s own repository, as CHANGELOG.md.</p></main>` }));
  });
  app.locals.releases = { releases, current };
  return app.locals.releases;
}
module.exports = { mountReleases, releases, current };
