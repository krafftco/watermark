// The tenth that goes to a cause (Will, 4 Nov: "a museum of your choosing, or a charity of your choosing"; "a mechanism
// where people feel that when they buy art, they get to give to a cause they really adore").
// On a print of an open work the house gives OPEN_GIVE_PCT of the price away. The buyer chooses where it goes:
//   · the museum that keeps the original (the default),
//   · a cause the house has listed (Studio → The gifts; listed only once the cause has said yes: some states require a
//     charity's written consent before its name is used in a sale, a commercial co-venture; counsel reads it),
//   · a cause of their own, named in their words: the house gives to it when it is a registered charity, and to the
//     museum when it is not (said on the form).
// The gift is the house's, from its own side: it is not the buyer's donation and not tax-deductible for them (said).
// Every gift is kept in `gifts` (owed → given, paid by hand) and told on the register when given, totalled by recipient.

// A draft list for Will: the art world and the great charities beside it. Not shown to the public until listed.
const SUGGEST = ['The Salvation Army | https://www.salvationarmyusa.org | Help where it is needed, in every town', 'St. Jude Children\'s Research Hospital | https://www.stjude.org | No family receives a bill', 'Feeding America | https://www.feedingamerica.org | Food banks across the country', 'Doctors Without Borders | https://www.doctorswithoutborders.org | Medical care where it is hardest to reach', 'Habitat for Humanity | https://www.habitat.org | Homes built with the people who live in them', 'American Red Cross | https://www.redcross.org | Disaster relief and blood', 'The New York Public Library | https://www.nypl.org | Free to everyone, since 1895', 'Artists Fellowship | https://www.artistsfellowship.org | Help for artists in need, since 1859', 'Americans for the Arts | https://www.americansforthearts.org | The arts in every community', 'A local museum or library you love | | Named by the buyer'].join('\n');

function mountGifts(app, { db, V, ledger, studioOnly }) {
  const { esc, money } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS gifts (id INTEGER PRIMARY KEY, license_id INTEGER, work_id INTEGER, cents INTEGER NOT NULL,
    to_kind TEXT NOT NULL, to_key TEXT, to_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'owed', given_at TEXT, note TEXT,
    at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec('CREATE INDEX IF NOT EXISTS gifts_status ON gifts (status, to_name)');

  const setting = k => { try { const r = db.prepare('SELECT v FROM settings WHERE k=?').get(k); return r ? r.v : null; } catch (e) { return null; } };
  const put = (k, v) => db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v);
  const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 48);
  // Causes the house lists: 'Name | https://site | a line' one a line, set on Studio → The gifts.
  const causes = () => String(setting('causes') || '').split('\n').map(l => l.split('|').map(x => x.trim())).filter(p => p[0])
    .map(([name, site, line]) => ({ key: slug(name), name, site: /^https:\/\//.test(site || '') ? site : '', line: line || '' }));

  // The museum that keeps the original, when the catalogue knows it.
  function museumOf(w) {
    try { const r = app.locals.catalogue && app.locals.catalogue.rowOfWork(w); if (r && r.collection) return r.collection; } catch (e) { /* quiet */ }
    return null;
  }

  // The choice on the form.
  function field(w, pct) {
    const mus = museumOf(w); const list = causes();
    return `<fieldset class="gv"><legend>A tenth of it goes to a cause. You choose.</legend>
<label class="gv-o"><input type="radio" name="give_to" value="museum" checked><span><b>${mus ? esc(mus) : 'The museum that keeps it'}</b><i>Where the original hangs, so it keeps being looked after.</i></span></label>
${list.map(c => `<label class="gv-o"><input type="radio" name="give_to" value="cause:${esc(c.key)}"><span><b>${esc(c.name)}</b>${c.line ? `<i>${esc(c.line)}</i>` : ''}</span></label>`).join('')}
<label class="gv-o gv-own"><input type="radio" name="give_to" value="own"><span><b>A cause of your own</b><i>A museum, a school, a charity you love. Name it.</i><input name="give_name" maxlength="120" placeholder="Its name, and the city" autocomplete="off"></span></label>
<p class="gv-fine">${pct}% of the price, given by the house from its own side, in your name if you like. We give to a cause of your own when it is a registered charity, and to the museum when it is not. It is the house's gift, so it is not tax-deductible for you.</p></fieldset>
<script>(function(){var f=document.currentScript.previousElementSibling,i=f.querySelector('input[name=give_name]');if(!i)return;i.addEventListener('focus',function(){f.querySelector('input[value=own]').checked=true});})();</script>`;
  }

  // Read the choice from the form; anything unreadable falls back to the museum.
  function choose(body, w) {
    const v = String((body && body.give_to) || 'museum'); const mus = museumOf(w);
    const museum = { to: 'museum', key: null, name: mus || 'The museum that keeps the original' };
    if (v.startsWith('cause:')) { const c = causes().find(x => x.key === v.slice(6)); return c ? { to: 'cause', key: c.key, name: c.name } : museum; }
    if (v === 'own') { const n = String(body.give_name || '').replace(/\s+/g, ' ').trim().slice(0, 120); if (n.length >= 3 && !/https?:|www\./i.test(n)) return { to: 'own', key: null, name: n, fallback: museum.name }; }
    return museum;
  }

  function record(l, w, cents, give) {
    if (!cents || !give) return;
    if (db.prepare('SELECT 1 FROM gifts WHERE license_id=?').get(l.id)) return;
    db.prepare('INSERT INTO gifts (license_id, work_id, cents, to_kind, to_key, to_name, note) VALUES (?,?,?,?,?,?,?)')
      .run(l.id, w.id, cents, give.to, give.key || null, give.name, give.to === 'own' ? `If not a registered charity: ${give.fallback}` : null);
  }

  // Studio → The gifts: what is owed, by recipient; mark given; the causes the house lists.
  app.get('/studio/gifts', studioOnly, (req, res) => {
    const owed = db.prepare("SELECT to_name, to_kind, COUNT(*) n, SUM(cents) cents, MIN(at) since FROM gifts WHERE status='owed' GROUP BY to_name, to_kind ORDER BY SUM(cents) DESC").all();
    const given = db.prepare("SELECT to_name, COUNT(*) n, SUM(cents) cents, MAX(given_at) last FROM gifts WHERE status='given' GROUP BY to_name ORDER BY SUM(cents) DESC").all();
    const kind = k => ({ museum: 'the museum that keeps it', cause: 'a cause the house lists', own: 'named by the buyer: check it is a registered charity' }[k] || k);
    res.set('Cache-Control', 'private, no-store').send(V.layout({ title: 'The gifts · Studio', path: '/studio/gifts', studio: true, body: `<section class="studio-wrap gvs">
<p class="k">The house</p><h1>The gifts.</h1><p class="lede">A tenth of every print of an open work goes where its buyer chose. Pay each by hand, then mark it given; the register says so.</p>${req.query.ok ? `<p class="ok">${esc(String(req.query.ok))}</p>` : ''}
<h2>Owed</h2>${owed.length ? `<table class="tbl"><tr><th>To</th><th>Who chose</th><th>Prints</th><th>Owed</th><th>Since</th><th></th></tr>${owed.map(g => `<tr><td><b>${esc(g.to_name)}</b></td><td>${esc(kind(g.to_kind))}</td><td>${g.n}</td><td>${money(g.cents)}</td><td>${esc(String(g.since).slice(0, 10))}</td><td><form method="post" action="/studio/gifts/given" class="inline"><input type="hidden" name="to" value="${esc(g.to_name)}"><input name="note" placeholder="How it was given" maxlength="160"><button class="buy-btn">Given</button></form></td></tr>`).join('')}</table>` : '<p class="note">Nothing owed.</p>'}
<h2>Given</h2>${given.length ? `<table class="tbl"><tr><th>To</th><th>Prints</th><th>In all</th><th>Last</th></tr>${given.map(g => `<tr><td>${esc(g.to_name)}</td><td>${g.n}</td><td>${money(g.cents)}</td><td>${esc(String(g.last || '').slice(0, 10))}</td></tr>`).join('')}</table>` : '<p class="note">Nothing given yet.</p>'}
<h2>The causes the house lists</h2><p class="note">One a line: Name | https://their site | a line about them. List a cause only once it has said yes to being named (counsel: commercial co-venture rules in some states).</p>
<details class="gv-sug"><summary>Causes to ask first (a draft list)</summary><p class="note">Write to each and list it once it says yes. Until then, anyone can still name it as a cause of their own.</p><pre>${esc(SUGGEST)}</pre></details>
<form method="post" action="/studio/gifts/causes"><textarea name="causes" rows="6" style="width:100%">${esc(setting('causes') || '')}</textarea><button class="buy-btn">Keep</button></form></section>` }));
  });
  app.post('/studio/gifts/given', studioOnly, (req, res) => {
    const to = String(req.body.to || ''); const rows = db.prepare("SELECT * FROM gifts WHERE status='owed' AND to_name=?").all(to);
    if (!rows.length) return res.redirect('/studio/gifts');
    const cents = rows.reduce((a, g) => a + g.cents, 0); const note = String(req.body.note || '').slice(0, 160) || null;
    db.prepare("UPDATE gifts SET status='given', given_at=datetime('now'), note=COALESCE(?, note) WHERE status='owed' AND to_name=?").run(note, to);
    ledger.append(db, 'gift.given', 'house', { to, amount: cents, prints: rows.length });
    res.redirect('/studio/gifts?ok=' + encodeURIComponent(`${money(cents)} given to ${to}.`));
  });
  app.post('/studio/gifts/causes', studioOnly, (req, res) => { put('causes', String(req.body.causes || '').slice(0, 6000)); res.redirect('/studio/gifts?ok=Kept'); });

  const api = { field, choose, record, causes, museumOf };
  app.locals.gifts = api;
  return api;
}

module.exports = { mountGifts };
