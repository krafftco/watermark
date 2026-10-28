// The digest (27 Oct, SECURITY.md 'error and health digests to the house'): nobody should have to open /healthz to know.
// Two letters. The morning digest, once a day at DIGEST_HOUR (13 UTC, nine in New York): the day before in numbers
// (visitors, collects and dollars, sign-ins, work arrived), what went wrong (5xx by status, the last few errors, faults,
// restarts), how fast (median and 95th), and the state of the house's own keeping (vault, backups, fixity,
// conservation, mail, the governor), with what needs the house. And the alarm, at most once an hour: sent when the
// hour just past had faults or more than ALARM_5XX errors, the register fails to verify, the backup is stale, the
// vault lost a file, or mail is failing; it says only what is wrong. Both to HOUSE_EMAIL. Nothing names a person.
'use strict';

function mountDigest(app, { db, C, mail, ledger }) {
  const HOUR = +process.env.DIGEST_HOUR || 13, ALARM_5XX = +process.env.ALARM_5XX || 20;
  const TO = process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com';
  db.exec('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)');
  const get = k => { const r = db.prepare('SELECT v FROM settings WHERE k=?').get(k); return r ? r.v : null; };
  const set = (k, v) => db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));
  const money = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const n = x => (x == null ? '–' : Number(x).toLocaleString('en-US'));
  const when = s => (s ? String(s).replace('T', ' ').slice(0, 16) + ' UTC' : 'never');
  const t = f => { try { return f(); } catch (e) { return null; } };

  // The letter's body, as plain words a person reads in a minute.
  function compose({ span = '7d' } = {}) {
    const A = app.locals.analytics; const R = A ? A.report(span) : null; const H = R ? R.health : (A ? A.health() : {});
    const F = process.faults || { rejections: 0, exceptions: 0, last: null };
    const yesterday = R && R.byDay && R.byDay.length >= 2 ? R.byDay[R.byDay.length - 2] : null;
    const cur = R ? R.cur : {};
    const V = app.locals.vaultState || {};
    const G = app.locals.governor ? app.locals.governor.state() : null;
    const lines = [];
    lines.push(`Watermark, the morning digest · ${new Date().toUTCString().slice(0, 16)} · ${(process.env.RENDER_GIT_COMMIT || '').slice(0, 8) || 'dev'} · up ${Math.round(process.uptime() / 3600)} h`);
    lines.push('');
    const ST = app.locals.strangers ? app.locals.strangers() : null;
    lines.push('THE WEEK');
    if (ST) lines.push(`  THE NUMBER: ${n(ST.week)} collected by strangers this week · ${n(ST.last)} last week`);
    lines.push(`  ${n(cur.visitors)} visitors · ${n(cur.views)} pages · ${n(cur.stood)} stood · ${n(cur.hats)} hats · ${n(cur.bravos)} bravos`);
    lines.push(`  ${n(cur.collects)} collected for ${money(cur.cents || 0)} · ${n(cur.firstTimers)} first-time collectors · ${n(cur.signins)} sign-ins · ${n(cur.newMakers)} new makers · ${n(cur.asked)} asked`);
    if (yesterday) lines.push(`  yesterday: ${n(yesterday.visitors)} visitors, ${n(yesterday.views)} pages`);
    lines.push('');
    lines.push('WHAT WENT WRONG');
    const errs = (R && R.errs) || [];
    const five = errs.filter(e => e.status >= 500).reduce((a, e) => a + e.n, 0), four = errs.filter(e => e.status === 404).reduce((a, e) => a + e.n, 0);
    lines.push(`  ${n(five)} server errors · ${n(four)} not found · faults since start: ${F.exceptions} exceptions, ${F.rejections} rejections${F.last ? ` · last: ${F.last.kind} at ${when(F.last.at)}: ${String(F.last.message).slice(0, 120)}` : ''}`);
    for (const e of ((R && R.errors) || []).slice(0, 5)) lines.push(`  ${when(e.at)} ${e.status} ${e.path}${e.message ? ' · ' + String(e.message).slice(0, 100) : ''}`);
    lines.push('');
    lines.push('HOW FAST');
    if (R && R.speed) lines.push(`  pages: median ${n(R.speed.page.p50)} ms, 95th ${n(R.speed.page.p95)} ms · API: median ${n(R.speed.api.p50)} ms, 95th ${n(R.speed.api.p95)} ms`);
    for (const s of ((R && R.slow) || []).slice(0, 4)) lines.push(`  slow: ${s.path} · ${n(Math.round(s.avg))} ms over ${s.n}`);
    lines.push('');
    lines.push('THE KEEPING');
    lines.push(`  register ${H.register === false ? 'FAILS TO VERIFY' : 'sound'} · works held ${n(H.works)} · restoring ${n(H.restoring)}`);
    lines.push(`  vault: ${V.unvaulted != null ? `${n(V.unvaulted)} not yet in the vault` : 'n/a'} · ${V.lost && V.lost.length ? `${V.lost.length} LOST: ${V.lost.slice(0, 5).join(', ')}` : 'nothing lost'}${V.lastError ? ` · last error ${when(V.lastErrorAt)}: ${String(V.lastError).slice(0, 80)}` : ''} · cors ${app.locals.vaultCors || 'n/a'}`);
    const B = H.backup; lines.push(`  backups: ${B ? `${B.last ? `${B.last.ok ? 'good' : 'FAILED'} ${when(B.last.at)}` : 'NONE'}${B.stale ? ' · STALE' : ''} · drill ${B.drill ? `${B.drill.ok ? 'passed' : 'FAILED'} ${when(B.drill.at)}` : 'never'}` : 'off'}`);
    const X = H.fixity; lines.push(`  fixity: ${X ? `${n(X.checked)} of ${n(X.works)} checked · ${X.failing ? `${X.failing} FAILING` : 'none failing'} · last ${when(X.last)}` : 'off'}`);
    const K = H.conservation; lines.push(`  conservation: ${K ? `${n(K.checked)} of ${n(K.works)} checked · ${K.unsound ? `${K.unsound} UNSOUND` : 'all sound'} · mirror ${K.mirror && K.mirror.on ? `${n(K.mirror.done)} mirrored` : 'off'}` : 'off'}`);
    const M = H.mail; lines.push(`  mail: ${M ? `${n(M.sent)} sent, ${n(M.failed)} failed${M.last && M.last.error ? ` · last error: ${String(M.last.error).slice(0, 80)}` : ''}` : (mail.on() ? 'on' : 'off')} · stripe ${H.stripe} · voice ${H.speech || 'off'} · guide ${H.closer ? 'on' : 'off'} · signing ${H.signing ? 'on' : 'off'}`);
    if (G) lines.push(`  governor: rss ${n(G.rss)} MB of ${n(G.limit)} · load ${G.load != null ? G.load.toFixed(2) : '–'} · ${G.lane ? `lane: ${G.lane}` : 'lane free'}${G.booting ? ` · booting: ${G.booting}` : ''} · chores ${app.locals.governor.chores() ? 'on' : 'HELD'}`);
    if (H.disk) lines.push(`  disk: ${n(Math.round(H.disk.free / 1048576))} MB free of ${n(Math.round(H.disk.total / 1048576))} · db ${n(Math.round((H.db || 0) / 1048576))} MB`);
    lines.push('');
    lines.push('NEEDS THE HOUSE');
    const W = H.waiting || {};
    const needs = [];
    if (W.requests) needs.push(`${W.requests} licence request${W.requests === 1 ? '' : 's'} waiting`);
    if (W.unpaid) needs.push(`${W.unpaid} licence${W.unpaid === 1 ? '' : 's'} awaiting payment (three days)`);
    const asks = t(() => db.prepare("SELECT COUNT(*) n FROM house_asks WHERE answered_at IS NULL").get().n); if (asks) needs.push(`${asks} asking to hang`);
    const apps = t(() => db.prepare("SELECT COUNT(*) n FROM applications WHERE status='new'").get().n); if (apps) needs.push(`${apps} application${apps === 1 ? '' : 's'}`);
    const prints = t(() => db.prepare("SELECT COUNT(*) n FROM print_orders WHERE status='asked'").get().n); if (prints) needs.push(`${prints} print${prints === 1 ? '' : 's'} asked for`);
    const claims = t(() => db.prepare("SELECT COUNT(*) n FROM disputes WHERE status='open'").get().n); if (claims) needs.push(`${claims} claim${claims === 1 ? '' : 's'} open`);
    const fb = t(() => db.prepare("SELECT COUNT(*) n FROM feedback WHERE done=0").get().n); if (fb) needs.push(`${fb} note${fb === 1 ? '' : 's'} from visitors`);
    lines.push(needs.length ? needs.map(x => '  ' + x).join('\n') : '  All clear.');
    lines.push('');
    lines.push(`The numbers: ${C.base}/studio/analytics · Health: ${C.base}/healthz`);
    lines.push('');
    lines.push('Watermark, a Krafft company');
    return lines.join('\n');
  }

  // The alarm: only what is wrong, at most once an hour, only when something is.
  function wrongs() {
    const A = app.locals.analytics; const H = A ? A.health() : {}; const F = process.faults || {}; const V = app.locals.vaultState || {};
    const out = [];
    const five = t(() => db.prepare("SELECT COUNT(*) n FROM hits WHERE status>=500 AND at>=?").get(Date.now() - 3600e3).n) || 0;
    if (five > ALARM_5XX) out.push(`${five} server errors in the last hour`);
    const lastFault = F.last && F.last.at && Date.now() - new Date(F.last.at).getTime() < 3600e3 ? F.last : null;
    if (lastFault) out.push(`a ${lastFault.kind} at ${when(lastFault.at)}: ${String(lastFault.message).slice(0, 160)}`);
    if (H.register === false) out.push('the register fails to verify');
    if (H.backup && H.backup.stale) out.push(`the last good backup is stale (${H.backup.last ? when(H.backup.last.at) : 'none'})`);
    if (V.lost && V.lost.length) out.push(`${V.lost.length} original${V.lost.length === 1 ? '' : 's'} not on disk and not in the vault: ${V.lost.slice(0, 5).join(', ')}`);
    if (H.fixity && H.fixity.failing) out.push(`${H.fixity.failing} fixity failure${H.fixity.failing === 1 ? '' : 's'}`);
    if (H.mail && H.mail.failed && H.mail.last && H.mail.last.error && H.mail.last.at && Date.now() - new Date(H.mail.last.at).getTime() < 3600e3) out.push(`mail failing: ${String(H.mail.last.error).slice(0, 120)}`);
    return out;
  }
  async function alarm({ force } = {}) {
    const w = wrongs(); if (!w.length && !force) return null;
    const last = +get('alarm_at') || 0; if (!force && Date.now() - last < 3600e3) return null;
    set('alarm_at', Date.now());
    const text = `Something is wrong at the house:\n\n${w.map(x => '  · ' + x).join('\n') || '  (nothing, a test)'}\n\nHealth: ${C.base}/healthz\n\nWatermark`;
    ledger.append(db, 'house.alarm', 'house', { n: w.length });
    if (mail.on()) await mail.send({ to: TO, subject: `Watermark: ${w.length ? w[0] : 'the alarm, a test'}`, text }).catch(e => console.error('[digest] alarm', e.message));
    else console.log('[digest] alarm\n' + text);
    return w;
  }
  async function digest({ force } = {}) {
    const day = new Date().toISOString().slice(0, 10);
    if (!force) { if (new Date().getUTCHours() < HOUR) return null; if (get('digest_day') === day) return null; }
    set('digest_day', day);
    const text = compose();
    ledger.append(db, 'house.digest', 'house', {});
    if (mail.on()) await mail.send({ to: TO, subject: `Watermark, this morning: ${(text.split('\n').find(l => /THE NUMBER/.test(l)) || text.split('\n')[3]).trim().replace('THE NUMBER: ', '')}`, text }).catch(e => console.error('[digest]', e.message));
    else console.log('[digest]\n' + text);
    return text;
  }
  if (!app.locals.noTimers) {
    setInterval(() => digest().catch(() => {}), 10 * 60e3).unref();
    setInterval(() => alarm().catch(() => {}), 5 * 60e3).unref();
    setTimeout(() => digest().catch(() => {}), 120e3).unref();
  }
  app.locals.digest = { compose, digest, alarm, wrongs };
  return app.locals.digest;
}
module.exports = { mountDigest };
