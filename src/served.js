// What leaves the house as script and style is stripped (19 Oct: harder to read the house's thinking off the wire).
// The sources in public/ keep their comments; the served copies are minified once at start (and when a file
// changes, by mtime) into a cache beside the renditions. The service worker is served the same way. If terser
// fails on a file, the source is served as it is: never a broken page over a quieter one.
const fs = require('fs'), path = require('path');
function mountServed(app, { publicDir, cacheDir, express }) {
  let terser = null; try { terser = require('terser'); } catch (e) { /* source served */ }
  const outDir = path.join(cacheDir, 'served'); fs.mkdirSync(outDir, { recursive: true });
  const minCss = css => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '\n').replace(/\n+/g, '\n').trim();
  const built = new Map(); // rel → { mtime, file }
  async function serve(rel) {
    const src = path.join(publicDir, rel); if (!fs.existsSync(src)) return null;
    const st = fs.statSync(src), hit = built.get(rel); if (hit && hit.mtime === st.mtimeMs && fs.existsSync(hit.file)) return hit.file;
    const out = path.join(outDir, rel.replace(/[\\/]/g, '__')); let code = fs.readFileSync(src, 'utf8');
    try {
      if (/\.js$/.test(rel) && terser) { const r = await terser.minify(code, { compress: { passes: 1 }, mangle: { toplevel: false }, format: { comments: false } }); if (r.code) code = r.code; }
      else if (/\.css$/.test(rel) && process.env.STRIP_CSS === '1') code = minCss(code); // CSS left as written unless asked (20 Oct: ruling it out while images are looked at)
    } catch (e) { console.error('[served]', rel, e.message); }
    fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(out, code); built.set(rel, { mtime: st.mtimeMs, file: out }); return out;
  }
  app.use('/static', async (req, res, next) => {
    const rel = decodeURIComponent(req.path.replace(/^\/+/, '')); if (!/\.(js|css)$/.test(rel) || rel.includes('..')) return next();
    try { const f = await serve(rel); if (!f) return next(); res.set('Cache-Control', 'public, max-age=3600'); res.type(rel.endsWith('.js') ? 'application/javascript' : 'text/css').sendFile(f); } catch (e) { next(); }
  });
  return { serve };
}
module.exports = { mountServed };
