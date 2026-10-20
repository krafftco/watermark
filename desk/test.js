const assert = require('assert'); const http = require('http');
process.env.DESK_EMAIL = 'will@example.com'; process.env.DESK_SECRET = 'x';
const { app } = require('./server');
const s = app.listen(0, async () => {
  const port = s.address().port;
  const req = (path, opt = {}) => new Promise((res, rej) => { const r = http.request({ port, path, method: opt.method || 'GET', headers: opt.headers || {} }, x => { let b = ''; x.on('data', c => b += c); x.on('end', () => res({ status: x.statusCode, headers: x.headers, body: b })); }); r.on('error', rej); if (opt.body) r.write(opt.body); r.end(); });
  let r = await req('/'); assert.ok(r.status === 302 && r.headers.location === '/door', 'a stranger is sent to the door');
  r = await req('/door'); assert.ok(r.status === 200 && /The desk\./.test(r.body) && /<svg/.test(r.body), 'the door, with the figure');
  r = await req('/door', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=nobody%40example.com' }); assert.ok(/no=1/.test(r.headers.location), 'unknown address refused');
  let logged = ''; const log = console.log; console.log = (...a) => { logged += a.join(' ') + '\n'; };
  r = await req('/door', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=will%40example.com' }); console.log = log; assert.ok(/sent=/.test(r.headers.location));
  const code = (logged.match(/code for will@example.com: (\d{6})/) || [])[1]; assert.ok(code, 'the code is logged with no mail');
  r = await req('/door/code', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `email=will%40example.com&code=${code}` }); assert.equal(r.headers.location, '/'); const ck = r.headers['set-cookie'][0].split(';')[0];
  r = await req('/', { headers: { cookie: ck } }); assert.ok(r.status === 200 && /The Desk/.test(r.body) && /not connected/.test(r.body), 'the front, sources not connected said quietly');
  r = await req('/healthz'); assert.equal(JSON.parse(r.body).who, 1);
  s.close(); console.log('ok: the desk');
});
