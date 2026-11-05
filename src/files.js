// The house's files without a disk (5 Nov: the website's disk comes off so a deploy is zero-downtime; from then the
// box's folders are a cache that a deploy empties). Every room that keeps a file writes it here (the disk) and in the
// vault; every room that serves one asks `local(file, key)` first, which fetches the vault's copy when the disk has
// none. The vault key is the room's folder and the file's name, as the rooms already put them.
//   keep(file, key, body, type)  write the local copy and the vault's; body a Buffer or a path (else the file itself)
//   local(file, key)             the local path, fetched from the vault when missing; null when nowhere
//   exists(file, key)            true when the file is on the disk or in the vault
// A local vault (the test house, the tests) puts under DATA_DIR/vault, so the two copies are both on the disk; harmless.
const fs = require('fs'); const path = require('path');

function mountFiles(app, { store }) {
  const fetching = new Map();
  async function local(file, key) {
    if (!file) return null;
    if (fs.existsSync(file)) return file;
    if (!key || !store) return null;
    if (fetching.has(file)) return fetching.get(file);
    const p = (async () => {
      try {
        const buf = await store.get(key); if (!buf || !buf.length) return null;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(tmp, buf);
        try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* there */ } }
        return file;
      } catch (e) { return fs.existsSync(file) ? file : null; } finally { fetching.delete(file); }
    })();
    fetching.set(file, p); return p;
  }
  async function keep(file, key, body, type) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (body == null) { /* the file is already on the disk */ } else if (Buffer.isBuffer(body)) fs.writeFileSync(file, body); else if (body !== file) fs.copyFileSync(body, file);
    if (store && key) { try { await store.put(key, file, type); } catch (e) { console.error('[files] the vault refused', key, e.message); throw e; } }
    return file;
  }
  async function exists(file, key) { if (fs.existsSync(file)) return true; if (!store || !key) return false; try { return !!(await store.size(key)); } catch (e) { return false; } }
  // A route helper: serve a kept file, fetching it first.
  async function send(res, file, key, opts = {}) { const f = await local(file, key); if (!f) { res.sendStatus(404); return false; } res.sendFile(f, opts); return true; }
  app.locals.files = { local, keep, exists, send };
  return app.locals.files;
}
module.exports = { mountFiles };
