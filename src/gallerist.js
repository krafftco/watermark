// The gallerist (Will, 4 Nov: "one of the things artists struggle with is to be salable"; "communicate it in a very human
// way"; "our version of a gallery; gallerist too"). Most work that does not sell is not wanting as art; it is not set up
// to be bought: the best picture kept back, no print size, a file too small to print, a portrait waiting on a release, the
// work that holds people not in front. The gallerist reads what people did before the maker's work (counted, never
// named; a work speaks only once GALLERIST_FLOOR people have stood before it) and writes a note in plain words: what
// happened, why it matters, one thing to do. It never says what to make. The notes are the maker's alone (their desk,
// /account/gallerist, and the first one in the Friday letter). Every word a draft for Will.
function mountGallerist(app, { db, V, makerOf, isStudio }) {
  const { esc, layout } = V;
  const FLOOR = +(process.env.GALLERIST_FLOOR || 3);
  const PRINT_MP = 24;
  const mp = w => (w.width && w.height ? w.width * w.height / 1e6 : 0);
  const dur = s => { s = Math.round(+s || 0); if (s < 60) return `${Math.max(1, s)} seconds`; const m = Math.round(s / 60); return m === 1 ? 'a minute' : `${m} minutes`; };
  const cnt = (sql, id) => { try { return db.prepare(sql).get(id).n; } catch (e) { return 0; } };
  const title = w => esc(V.tidy ? V.tidy(w.title) : w.title);

  function stats(m) {
    const rows = db.prepare(`SELECT w.id, w.slug, w.title, w.status, w.keep_back, w.stars, w.curated, w.width, w.height, w.open,
        COUNT(s.id) people, SUM(COALESCE(s.seconds,0)) secs, SUM(CASE WHEN COALESCE(s.visits,1)>1 THEN 1 ELSE 0 END) back
      FROM works w LEFT JOIN stood s ON s.work_id=w.id WHERE w.maker_id=? AND w.status IN ('held','hidden')
      GROUP BY w.id, w.slug, w.title, w.status, w.keep_back, w.stars, w.curated, w.width, w.height, w.open`).all(m.id);
    for (const r of rows) {
      r.people = +r.people || 0; r.secs = +r.secs || 0; r.back = +r.back || 0;
      r.avg = r.people ? r.secs / r.people : 0;
      r.hats = cnt('SELECT COUNT(*) n FROM applause WHERE work_id=?', r.id);
      r.bravos = cnt('SELECT COUNT(*) n FROM bravos WHERE work_id=?', r.id);
      r.saves = cnt('SELECT COUNT(*) n FROM hang_works WHERE work_id=?', r.id);
      r.sold = cnt("SELECT COUNT(*) n FROM licenses WHERE work_id=? AND status='active' AND price_cents>0", r.id);
      r.weight = r.secs + r.back * 60 + r.bravos * 120 + r.hats * 15 + r.saves * 45;
    }
    return rows;
  }
  const printOpen = w => cnt('SELECT COUNT(*) n FROM print_editions WHERE work_id=? AND active=1', w.id) > 0;

  // One note for a work: the first thing standing between it and someone who wants it.
  function noteFor(w, ctx) {
    const t = `<b>${title(w)}</b>`, who = w.people === 1 ? 'one person' : `${w.people} people`;
    const stay = w.people ? `, and they stayed about ${dur(w.avg)}` : '';
    const came = w.back ? ` ${w.back === 1 ? 'One of them came back' : `${w.back} of them came back`}.` : '';
    const rec = `/account/works/${encodeURIComponent(w.slug)}`;
    if (w.status === 'hidden' && !w.keep_back) return { kind: 'show', text: `You've kept ${t} to yourself. ${who[0].toUpperCase() + who.slice(1)} found it anyway${stay}.${came} It might be the best thing you have shown no one.`, act: 'Show it', post: { do: 'publish', attest: '1' } };
    if (w.status !== 'held' || w.open) return null;
    const cl = app.locals.clearance ? (() => { try { return app.locals.clearance.needs(w); } catch (e) { return null; } })() : null;
    if (cl && cl.missing && cl.missing.some(x => x.kind === 'person' || x.kind === 'minor')) return { kind: 'release', text: `${t} is the kind of picture a company asks for. It needs the signature of the person in it first. You can have it on your phone in a minute.`, act: 'Sign a release', href: `/account/release/sign?work=${encodeURIComponent(w.slug)}` };
    if (!w.sold && w.people >= FLOOR && !printOpen(w)) {
      if (mp(w) >= PRINT_MP) return { kind: 'print', text: `${t} stops people. Most stand before it about ${dur(w.avg)}.${came} Right now the only way to own it is a small copy. Offer it as a print?`, act: 'Open a print', href: `${rec}#editions` };
      return { kind: 'master', text: `${t} could hang above a sofa, but not at this size: the file here is ${mp(w).toFixed(1)} megapixels. Send the full file and it can be printed at 24 inches.`, act: 'Send the full file', href: '/account/upload' };
    }
    if (!w.curated && (w.stars || 0) < 4 && ctx.rank < 3) return { kind: 'front', text: `${t} holds people longer than almost anything you show, but it isn't in front. Put it there?`, act: 'Put it in front', post: { do: 'stars', stars: '5' } };
    return null;
  }

  function notes(m, n = 12) {
    const rows = stats(m).filter(w => w.people >= FLOOR || w.bravos || w.saves).sort((a, b) => b.weight - a.weight);
    const out = []; let rank = 0;
    for (const w of rows) { const x = noteFor(w, { rank: rank++ }); if (x) out.push({ ...x, slug: w.slug, title: w.title }); if (out.length >= n) break; }
    return out;
  }
  const plain = s => String(s).replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const first = m => { const x = notes(m, 1)[0]; return x ? { text: plain(x.text), act: x.act, href: x.href || '/account/gallerist', slug: x.slug } : null; };

  app.get('/account/gallerist', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/gallerist');
    const list = notes(m);
    const firstName = String(m.name || '').split(/\s+/)[0] || 'you';
    const card = x => `<article class="gst-n" data-slug="${esc(x.slug)}"><a class="gst-i" href="/w/${esc(x.slug)}"><img src="/img/${esc(x.slug)}/thumb" alt="" loading="lazy"></a><div><p>${x.text}</p>${x.post
      ? `${x.post.do === 'publish' ? '<label class="gst-at"><input type="checkbox" data-gst-at> I made this and hold the rights to it</label>' : ''}<button class="gst-a" data-gst='${esc(JSON.stringify({ ...x.post, slugs: x.slug }))}'>${esc(x.act)}</button>`
      : `<a class="gst-a" href="${esc(x.href)}">${esc(x.act)}</a>`}<span class="gst-say" aria-live="polite"></span></div></article>`;
    res.set('Cache-Control', 'private, no-store').send(layout({ title: 'Your gallerist · Watermark', path: '/account/gallerist', studio: true, body: `<section class="studio-wrap gst">
<p class="k">Your gallerist</p><h1>Notes on your work, ${esc(firstName)}.</h1>
<p class="lede">I watch what people do in front of your work: how long they stay, what they come back to, what they save. When something is keeping a picture from the people who want it, I write it here. What you make is yours. Making it easy to have is mine.</p>
${list.length ? list.map(card).join('') : `<p class="note">Nothing to tell you yet. Once a few people have stood before your work, I'll write.</p>`}
<p class="gst-foot">People are counted here, never named. <a href="/account/held">The full count</a> · <a href="/account">Your studio</a></p></section>
<script>(function(){document.querySelectorAll('[data-gst]').forEach(function(b){b.addEventListener('click',function(){var d=JSON.parse(b.getAttribute('data-gst'));d.json='1';var say=b.parentNode.querySelector('.gst-say'),at=b.parentNode.querySelector('[data-gst-at]');if(at&&!at.checked){say.textContent='Tick the line above first: it is your word that the picture is yours.';return}b.disabled=true;fetch('/account/works/batch',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(d).toString()}).then(function(r){return r.json()}).then(function(j){say.textContent=j.msg||'Done.';if(j.ok!==false){b.textContent='Done';b.closest('.gst-n').classList.add('gst-done')}else b.disabled=false}).catch(function(){b.disabled=false;say.textContent='Try again in a moment.'})})})})();</script>` }));
  });

  const api = { notes, first, stats };
  app.locals.gallerist = api;
  return api;
}

module.exports = { mountGallerist };
