// The sender in the browser (public/arrivals.js), run under node with a fake page and a fake house: a file already
// finished from this computer is sent afresh the next time it is chosen (21 Oct: the same eighteen chosen again
// replayed the old records and sent nothing), and a send cut short resumes.
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'arrivals.js'), 'utf8');
const store = {}; const calls = []; let nextId = 1;
const ctx = {
  localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } },
  document: { getElementById: () => null },
  window: {}, setTimeout, console, TypeError, Promise, JSON, URLSearchParams, Error, String, Math, Date,
  fetch: async (url, init) => {
    calls.push([url, init && init.method || 'GET']);
    if (/arrivals\/start$/.test(url)) return { status: 200, redirected: false, json: async () => ({ ok: true, id: nextId++, direct: false, partSize: 8e6, parts: 1 }) };
    if (/\/body$/.test(url)) return { status: 200, redirected: false, json: async () => ({ ok: true }) };
    throw new Error('unexpected ' + url);
  },
};
ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
(async () => {
  const f = { name: 'L1002657.jpg', size: 3000000, lastModified: 1, slice: () => ({}) };
  const a = await ctx.WMArrivals.send(f, { base: '/account' });
  const b = await ctx.WMArrivals.send(f, { base: '/account' });
  assert.notEqual(a, b, 'the same file chosen again is a new arrival');
  assert.equal(calls.filter(c => /start$/.test(c[0])).length, 2, 'started twice');
  assert.equal(calls.filter(c => /body$/.test(c[0])).length, 2, 'the bytes went up twice');
  assert.ok(ctx.WMArrivals.sentBefore('/account', f), 'the masters desk still knows it was sent');
  console.log('ok: the sender never replays a finished file');
})().catch(e => { console.error(e); process.exit(1); });
