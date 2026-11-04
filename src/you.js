'use strict';
// You (Will, 3 Nov: "what does it actually mean to manage or use your Yours"; "let's do it"). The You tab is the
// thing in your pocket: everything that is yours, with the papers, in one place, not a control panel. Three layers:
// who you are here (one line: your name, your key, your pocket, Settings), what is new or needs you (a band that
// shows only when something is real), and what you have (one library, filtered by chips: Collected · Reading ·
// Walls · Albums · My work). Every tile opens to its own room, where the managing happens (arrange, show or keep
// private, live with it, keep the record, pass it on). The older rooms (?tab=files, cabinet, market, settings…)
// answer as before; this is the front of them.

const KINDS = [['collected', 'Collected'], ['reading', 'Reading'], ['walls', 'Walls'], ['albums', 'Albums'], ['work', 'My work']];

function mountYou({ db, V, app }) {
  const { esc, money } = V;
  const q = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch (e) { return []; } };
  const one = (sql, ...a) => { try { return db.prepare(sql).get(...a); } catch (e) { return null; } };
  const ago = s => { const d = new Date(String(s || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(s || '')) ? '' : 'Z')); if (isNaN(d)) return ''; const m = Math.round((Date.now() - d) / 60000); return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };

  // Everything this person has, as tiles of one shape: { k, href, img, title, line, round }.
  function library(b, m, col, hand) {
    const out = { collected: [], reading: [], walls: [], albums: [], work: [] };
    for (const i of col.items) out.collected.push({ href: i.ref ? `/yours/p/${i.ref}` : `/w/${i.slug}`, img: `/img/${i.slug}/screen`, title: i.title, line: `${i.collector_no ? `No. ${i.collector_no}${i.edition_size ? ` of ${i.edition_size}` : ''} · ` : ''}${i.maker}${i.status === 'expired' ? ' · ended' : ''}` });
    for (const r of q(`SELECT r.status, r.chapter, r.chapters, r.pct, t.slug, t.title, t.author FROM reading_list r JOIN texts t ON t.id=r.text_id WHERE r.buyer_id=? AND t.public=1 ORDER BY CASE r.status WHEN 'reading' THEN 0 WHEN 'want' THEN 1 ELSE 2 END, r.updated_at DESC LIMIT 200`, b.id))
      out.reading.push({ href: `/read/${r.slug}`, img: `/binding/${r.slug}.svg`, book: true, title: r.title, line: r.status === 'reading' ? (r.chapters ? `Chapter ${r.chapter + 1} of ${r.chapters}` : 'Reading') : r.status === 'want' ? 'Want to read' : 'Read', pct: r.status === 'reading' ? r.pct : null });
    const cp = one('SELECT COUNT(*) n FROM commonplace WHERE buyer_id=?', b.id);
    if (cp && cp.n) out.reading.push({ href: '/yours/commonplace', img: null, title: 'Your commonplace book', line: `${cp.n} passage${cp.n === 1 ? '' : 's'} kept`, plain: '❦' });
    for (const h of q(`SELECT h.id, h.slug, h.title, h.public, (SELECT COUNT(*) FROM hang_works x WHERE x.hang_id=h.id) n, (SELECT w.slug FROM hang_works x JOIN works w ON w.id=x.work_id WHERE x.hang_id=h.id ORDER BY x.pos LIMIT 1) first FROM hangs h WHERE h.buyer_id=? ORDER BY h.id DESC LIMIT 100`, b.id))
      out.walls.push({ href: `/g/${b.code}/hang/${h.slug}`, img: h.first ? `/img/${h.first}/screen` : null, title: h.title, line: `${h.n} work${h.n === 1 ? '' : 's'} · ${h.public ? 'on view' : 'private'}`, plain: h.first ? null : '+' });
    const mail = String(b.email || '').toLowerCase();
    const albums = new Map();
    if (mail) for (const d of q(`SELECT d.token, d.title, m.name AS maker, (SELECT w.slug FROM delivery_works x JOIN works w ON w.id=x.work_id WHERE x.delivery_id=d.id ORDER BY x.pos LIMIT 1) first, (SELECT COUNT(*) FROM delivery_works x WHERE x.delivery_id=d.id) n FROM deliveries d JOIN makers m ON m.id=d.maker_id WHERE lower(d.client_email)=? AND d.status='open' ORDER BY d.id DESC LIMIT 60`, mail))
      albums.set(d.token, { href: `/deliver/${d.token}`, img: d.first ? `/img/${d.first}/screen` : null, title: d.title, line: `From ${d.maker} · ${d.n}` });
    for (const d of q(`SELECT x.token AS mtoken, d.token, d.title, m.name AS maker, (SELECT w.slug FROM delivery_works y JOIN works w ON w.id=y.work_id WHERE y.delivery_id=d.id ORDER BY y.pos LIMIT 1) first, (SELECT COUNT(*) FROM delivery_works y WHERE y.delivery_id=d.id) n FROM delivery_members x JOIN deliveries d ON d.id=x.delivery_id JOIN makers m ON m.id=d.maker_id WHERE x.status='in' AND d.status='open' AND (x.buyer_id=? OR (? <> '' AND lower(x.email)=?)) ORDER BY x.id DESC LIMIT 60`, b.id, mail, mail))
      if (!albums.has(d.token)) albums.set(d.token, { href: `/in/${d.mtoken}`, img: d.first ? `/img/${d.first}/screen` : null, title: d.title, line: `From ${d.maker} · ${d.n}` });
    out.albums = [...albums.values()];
    if (m) {
      for (const w of q(`SELECT slug, title, place, status, stars FROM works WHERE maker_id=? AND status IN ('held','hidden') ORDER BY CASE WHEN stars>=5 THEN 0 ELSE 1 END, id DESC LIMIT 60`, m.id))
        out.work.push({ href: `/m/${V.makerSlug(m)}/${w.slug}`, img: `/img/${w.slug}/screen`, title: w.title, line: `${w.status === 'held' ? 'On view' : 'Kept back'}${w.place ? ` · ${String(w.place).split(',')[0]}` : ''}` });
      for (const t of q(`SELECT slug, title, kind FROM texts WHERE maker_id=? ORDER BY id DESC LIMIT 20`, m.id))
        out.work.push({ href: `/read/${t.slug}`, img: `/binding/${t.slug}.svg`, book: true, title: t.title, line: 'Your writing' });
    }
    return out;
  }

  // What is new or needs you: only what is real, the newest few.
  function news(b, m) {
    const rows = [];
    for (const n of q(`SELECT title, href, at FROM notices WHERE read_at IS NULL AND (buyer_id=? OR (? > 0 AND maker_id=?)) ORDER BY id DESC LIMIT 3`, b.id, m ? m.id : 0, m ? m.id : 0))
      rows.push({ href: n.href || '/notices', text: n.title, when: ago(n.at) });
    for (const o of q(`SELECT o.status, o.kind, w.title FROM print_orders o JOIN licenses l ON l.id=o.license_id JOIN works w ON w.id=l.work_id WHERE (o.buyer_id=? OR l.buyer_id=?) AND o.status IN ('asked','making','sent') ORDER BY o.id DESC LIMIT 2`, b.id, b.id))
      rows.push({ href: '/yours?tab=files', text: `Your ${o.kind === 'proof' ? 'proof' : 'print'} of ${o.title} ${o.status === 'sent' ? 'is on its way' : o.status === 'making' ? 'is being made' : 'is with the print room'}`, when: '' });
    return rows.slice(0, 4);
  }

  const tile = t => `<a class="yu-t${t.book ? ' yu-bk' : ''}" href="${esc(t.href)}"><span class="yu-im">${t.img ? `<img src="${esc(t.img)}" alt="" loading="lazy" draggable="false">` : `<i>${esc(t.plain || '')}</i>`}${t.pct != null ? `<b class="yu-pct" style="width:${Math.max(4, Math.min(100, t.pct))}%"></b>` : ''}</span><span class="yu-ti">${esc(t.title)}</span><span class="yu-li">${esc(t.line || '')}</span></a>`;

  function page({ b, req, col, hand, m, isMaker, isHouse }) {
    const lib = library(b, m, col, hand);
    const counts = Object.fromEntries(KINDS.map(([k]) => [k, lib[k].length]));
    const total = Object.values(counts).reduce((a, n) => a + n, 0);
    const k = KINDS.some(([x]) => x === req.query.k) ? req.query.k : 'all';
    const name = b.name || (m && m.name) || null;
    const keys = app.locals.keys ? app.locals.keys.ofBuyer(b) : [];
    const ck = keys.find(x => x.kind === 'collector') || keys[0];
    const pocket = app.locals.pocket ? app.locals.pocket.balance(b) : 0;
    const facts = [b.email ? esc(b.email) : null, ck ? `<a href="/keys">Key No. ${ck.no}</a>` : null, pocket > 0 ? `<a href="/yours?tab=settings#pocket">${money(pocket)} in your pocket</a>` : null].filter(Boolean);
    const nw = news(b, m);
    const chips = [['all', 'All', total], ...KINDS.map(([x, l]) => [x, l, counts[x]])].filter(([x, , n]) => x === 'all' || n);
    const section = ([x, label]) => {
      const list = lib[x]; if (!list.length) return '';
      const more = list.length > 8;
      return `<section class="yu-sec"><header><h2>${label}</h2>${more ? `<a href="/yours?k=${x}">All ${list.length}</a>` : ''}</header><div class="yu-row">${list.slice(0, 8).map(tile).join('')}</div></section>`;
    };
    const acts = x => ({
      collected: `<a href="/wander?in=mine">Wander them</a><a href="/yours?tab=gallery">Arrange and show</a><a href="/yours?tab=files">Papers and licences</a>${b.public ? `<a href="/g/${esc(b.code)}">Your public gallery</a>` : ''}`,
      reading: `<a href="/yours/reading">Your reading</a><a href="/library">The Library</a>`,
      walls: `<a href="/yours?tab=hangs">Make a wall</a>`,
      albums: '',
      work: `<a href="/account">Your studio</a><a href="/account/table">The Library</a><a href="/account/upload">Add work</a>`,
    }[x] || '');
    const body = `<section class="yu">
<header class="yu-h"><div><p class="k">You</p><h1>${esc(name || 'Yours')}</h1>${facts.length ? `<p class="yu-f">${facts.join(' · ')}</p>` : ''}</div>
<nav class="yu-hn">${isMaker ? '<a href="/account">Studio</a>' : ''}${isHouse ? '<a href="/studio">The house</a>' : ''}<a href="/yours?tab=settings">Settings</a></nav></header>
${nw.length ? `<ul class="yu-new">${nw.map(n => `<li><a href="${esc(n.href)}"><span>${esc(n.text)}</span>${n.when ? `<i>${esc(n.when)}</i>` : ''}</a></li>`).join('')}${nw.length >= 3 ? '<li class="yu-all"><a href="/notices">Every notice</a></li>' : ''}</ul>` : ''}
${total ? `<nav class="yu-chips" aria-label="What you have">${chips.map(([x, l, n]) => `<a href="${x === 'all' ? '/yours' : `/yours?k=${x}`}"${x === k ? ' aria-current="page"' : ''}>${l}${x === 'all' ? '' : ` <i>${n}</i>`}</a>`).join('')}</nav>
${k === 'all' ? KINDS.map(section).join('') : `<div class="yu-acts">${acts(k)}</div><div class="yu-grid">${lib[k].map(tile).join('')}</div>`}`
  : `<div class="yu-empty"><p>Nothing here yet. What you collect, read, hang and are given will be kept here, with its papers.</p><div class="yc-next"><a href="/wander" data-nv-wander><b>Look around</b><span>Wander the collection, one work at a time.</span></a><a href="${isMaker ? '/account' : '/join'}"><b>${isMaker ? 'Your studio' : 'Make things?'}</b><span>${isMaker ? 'Your work, your page, your prices.' : 'Open your museum: put your work in, keep it, hang the best.'}</span></a></div></div>`}
<nav class="yu-more" aria-label="Everything else"><a href="/yours?tab=files">Papers and licences</a><a href="/yours?tab=cabinet">Your cabinet</a><a href="/yours?tab=market">The market</a><a href="/yours/following">Following</a><a href="/yours/looking">Your looking</a><a href="/notices">Notices</a><a href="/yours/devices">Your devices</a><a href="/yours?tab=settings">Settings</a></nav>
</section>`;
    return V.layout({ title: `${name ? `${name} · ` : ''}You · Watermark`, path: '/yours', body });
  }

  app.locals.you = { page, library, news, KINDS };
  return app.locals.you;
}

module.exports = { mountYou, KINDS };
