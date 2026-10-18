// The Watermark number (Will, 18 Oct: readable, but tracked "like a FedEx tracking number"). Every license ref
// WM-YYYY-NNNNNN becomes twelve digits in three groups: WM 2026 0000 8231 — the year, the license, and two check
// digits (ISO 7064 mod 97-10, as on an IBAN), so a mistyped number is caught rather than finding the wrong license.
function check(digits10) { const n = BigInt(digits10) * 100n; return String(98n - (n % 97n)).padStart(2, '0'); }
function track(ref) {
  const m = /^WM-(\d{4})-(\d{6})$/.exec(String(ref || '')); if (!m) return null;
  const d = m[1] + m[2] + check(m[1] + m[2]);
  return `WM ${d.slice(0, 4)} ${d.slice(4, 8)} ${d.slice(8, 12)}`;
}
const compact = ref => { const t = track(ref); return t ? t.replace(/\s+/g, '').slice(2) : null; }; // 202600008231
// Back from what someone typed or read off a caption: "WM 2026 0000 8231", "202600008231", "wm-2026-0000-8231".
function ref(input) {
  const d = String(input || '').replace(/[^0-9]/g, '');
  if (d.length !== 12) return null;
  const body = d.slice(0, 10); if (check(body) !== d.slice(10)) return null;
  return `WM-${body.slice(0, 4)}-${body.slice(4)}`;
}
module.exports = { track, ref, compact, check };
