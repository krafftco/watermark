// Content Credentials (C2PA, the open standard behind Adobe's Content Credentials).
// Two jobs. Read: when a photograph arrives, see whether it already carries credentials (a camera that
// signs at capture, Lightroom or Photoshop on export) and keep a summary, so the Shield can show it.
// Write: every file that leaves Watermark is signed with Watermark's credentials: who made it, who holds
// the copyright, the license it travels under, and that it is not for AI training. The original is
// kept as the parent ingredient, so a camera's or Lightroom's credentials stay in the chain.
// Signing needs a certificate: C2PA_CERT (PEM chain) and C2PA_KEY (PKCS#8 PEM), each as PEM or base64,
// set in the host's environment. Without them, files go out unsigned and nothing else changes.
const fs = require('fs');

let lib = null;
const load = () => { if (lib === null) { try { lib = require('@contentauth/c2pa-node'); } catch (e) { console.error('[credentials] library unavailable:', e.message); lib = false; } } return lib; };
const mimeOf = f => (/\.png$/i.test(f) ? 'image/png' : /\.tiff?$/i.test(f) ? 'image/tiff' : 'image/jpeg');
const pem = v => { if (!v) return null; const s = String(v).trim(); return Buffer.from(s.includes('-----BEGIN') ? s : Buffer.from(s, 'base64').toString('utf8')); };

let signer;
function getSigner() {
  if (signer !== undefined) return signer;
  const L = load(); const cert = pem(process.env.C2PA_CERT), key = pem(process.env.C2PA_KEY);
  signer = null;
  if (L && cert && key) {
    try { signer = L.LocalSigner.newSigner(cert, key, process.env.C2PA_ALG || 'es256', process.env.C2PA_TSA || undefined); }
    catch (e) { console.error('[credentials] signer:', e.message); }
  }
  return signer;
}
const enabled = () => !!getSigner();

// What a file already says about itself. Never throws; null when it carries nothing.
async function inspect(file) {
  const L = load(); if (!L) return null;
  try {
    const r = await L.Reader.fromAsset({ path: file, mimeType: mimeOf(file) });
    if (!r) return null;
    const st = r.json(), a = r.getActive() || {};
    const sig = a.signature_info || {};
    const actions = (a.assertions || []).filter(x => /^c2pa\.actions/.test(x.label)).flatMap(x => (x.data && x.data.actions) || []);
    const captured = actions.some(x => x.action === 'c2pa.created' && /digitalCapture/.test(x.digitalSourceType || x.digital_source_type || ''));
    const gen = (a.claim_generator_info && a.claim_generator_info[0]) || {};
    const cw = (a.assertions || []).find(x => /CreativeWork/.test(x.label));
    const author = cw && cw.data && cw.data.author ? [].concat(cw.data.author).map(p => p.name).filter(Boolean).join(', ') : null;
    // Earlier links in the chain (a camera's own manifest under a Lightroom export, say).
    const chain = Object.values(st.manifests || {}).map(m => ({ by: (m.signature_info || {}).issuer || null, app: ((m.claim_generator_info || [])[0] || {}).name || m.claim_generator || null }));
    // The camera that signed at capture (29 Oct, Will: "build in the Leica content credentials"): the active manifest's
    // own capture, else the first link in the chain signed by a camera maker (Leica, Sony, Nikon, Canon, Fujifilm…).
    const CAM = /leica|sony|nikon|canon|fujifilm|fuji|hasselblad|panasonic|ricoh|pentax|olympus|om digital|google|samsung|apple/i;
    const cam = captured && CAM.test(sig.issuer || '') ? sig.issuer : (chain.find(c => CAM.test(c.by || '')) || {}).by || null;
    return { state: st.validation_state || null, issuer: sig.issuer || null, signer: sig.common_name || null, time: sig.time || null,
      app: gen.name || a.claim_generator || null, captured: captured || !!cam, camera_signer: cam, author, chain, read_at: new Date().toISOString() };
  } catch (e) { return null; }
}

// Sign a file on its way out. `parent` is the original it was made from.
async function seal({ input, output, parent, title, maker, holder, year, accession, url, license, licensee, use, ref, ends, fingerprint, noAI = true, resized = false }) {
  const s = getSigner(); const L = load(); if (!s || !L) return false;
  try {
    const assertions = [
      { label: 'stds.schema-org.CreativeWork', data: { '@context': 'https://schema.org', '@type': 'Photograph', name: title, author: [{ '@type': 'Person', name: maker }],
        copyrightHolder: { '@type': 'Person', name: holder || maker }, copyrightNotice: `© ${year || new Date().getFullYear()} ${holder || maker}. All rights reserved.`,
        ...(license ? { license } : {}), ...(url ? { url } : {}), ...(accession ? { identifier: accession } : {}), creditText: `Photograph by ${maker}` } },
      { label: 'c2pa.actions', data: { actions: [{ action: 'c2pa.edited.metadata', description: ref ? `License ${ref} written into the file by Watermark` : 'Registered on Watermark' },
        ...(resized ? [{ action: 'c2pa.resized', description: 'Sized for sharing' }] : [])] } },
      { label: 'com.krafftco.watermark', data: { registry: 'Watermark', accession: accession || null, fingerprint: fingerprint ? 'sha256:' + fingerprint : null,
        license: ref ? { ref, licensee: licensee || null, use: use || null, ends: ends || null, verify: url ? url.replace(/\/w\/.*$/, '') + '/verify?ref=' + ref : null } : null } },
    ];
    if (noAI) assertions.push({ label: 'c2pa.training-mining', data: { entries: { 'c2pa.ai_generative_training': { use: 'notAllowed' }, 'c2pa.ai_inference': { use: 'notAllowed' }, 'c2pa.ai_training': { use: 'notAllowed' }, 'c2pa.data_mining': { use: 'notAllowed' } } } });
    const b = await L.Builder.withJsonAsync({ claim_generator_info: [{ name: 'Watermark', version: '1' }], title, assertions });
    b.setIntent('edit'); // the first action is opening the original; ours follow
    if (parent) await b.addIngredient(JSON.stringify({ title: `${title} (original)`, format: mimeOf(parent), relationship: 'parentOf' }), { path: parent, mimeType: mimeOf(parent) });
    try { fs.unlinkSync(output); } catch (e) { /* none yet */ }
    b.sign(s, { path: input, mimeType: mimeOf(input) }, { path: output });
    return true;
  } catch (e) { console.error('[credentials] seal:', e.message); try { fs.unlinkSync(output); } catch (x) { /* none */ } return false; }
}

module.exports = { inspect, seal, enabled };
