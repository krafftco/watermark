// Email. Uses Resend's HTTP API when RESEND_API_KEY is set; otherwise logs to the console,
// so the app works fully without a mail provider.
const on = () => !!process.env.RESEND_API_KEY;
// The house's letterhead. Every message is plain text first (text), and the same words set on paper (html):
// the wordmark and the wave at the top, Georgia for the body, one quiet rule, "A Krafft company" at the foot.
// Codes and references are picked out large. No images that must load; the wave is inline SVG with a text
// fallback, so the mail reads the same in every client.
const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const BASE = () => process.env.BASE_URL || 'https://watermark.krafftco.com';
function paper({ subject, text, feature = null, cta = null }) {
  // Paragraphs from the text; URLs become links; a line that is only a reference or a code is set apart.
  const paras = String(text).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => {
    if (feature && p === feature) return '';
    if (/^Watermark, a Krafft company\.?$/.test(p)) return '';
    if (feature && /\bis$/.test(p)) p = p.replace(/\s*is$/, ` is ${feature}.`);
    const h = esc(p).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0e0e0e">$1</a>').replace(/\n/g, '<br>');
    return `<p style="margin:0 0 16px;font:17px/1.55 Georgia,'Times New Roman',serif;color:#2f2d29">${h}</p>`;
  }).join('');
  const feat = feature ? `<p style="margin:8px 0 28px;font:40px/1.1 Georgia,serif;letter-spacing:.18em;color:#0e0e0e">${esc(feature)}</p>` : '';
  const btn = cta ? `<p style="margin:8px 0 28px"><a href="${esc(cta.url)}" style="display:inline-block;padding:16px 28px;background:#0e0e0e;color:#f7f6f3;text-decoration:none;font:600 13px/1 Helvetica,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase">${esc(cta.label)}</a></p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#f2f2f0;padding:32px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e2e2df">
<tr><td style="padding:34px 40px 10px"><a href="${BASE()}" style="text-decoration:none;color:#0e0e0e"><span style="font:24px/1 Georgia,serif;letter-spacing:-.01em">watermark</span></a><br><svg width="44" height="10" viewBox="1.5 14.2 41 11" aria-hidden="true" style="display:block;margin-top:4px"><path d="M2.5 20c3-6 6-6 9 0s6 6 9 0 6-6 9 0 6 6 9 0" fill="none" stroke="#0e0e0e" stroke-width="1.6" stroke-linecap="round"/></svg></td></tr>
<tr><td style="padding:22px 40px 8px"><p style="margin:0 0 18px;font:11px/1 Helvetica,Arial,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#5f5f5c">${esc(subject)}</p>${feat}${btn}${paras}</td></tr>
<tr><td style="padding:18px 40px 34px"><hr style="border:0;border-top:1px solid #e2e2df;margin:0 0 18px"><p style="margin:0;font:11px/1.6 Helvetica,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8f8a81">Watermark &middot; A Krafft company<br><a href="${BASE()}" style="color:#8f8a81;text-decoration:none">watermark.krafftco.com</a></p></td></tr>
</table></td></tr></table></body></html>`;
}
async function send({ to, subject, text, from, html, feature, cta }) {
  const key = process.env.RESEND_API_KEY;
  const sender = from || process.env.MAIL_FROM || 'Watermark <license@krafftco.com>';
  if (!key || !to) { console.log(`[mail:off] to=${to} subject="${subject}"`); return { skipped: true }; }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: sender, to: [].concat(to), subject, text, html: html || paper({ subject, text, feature, cta }) }),
    });
    if (!r.ok) console.error('[mail] failed', r.status, await r.text());
    return { ok: r.ok };
  } catch (e) { console.error('[mail] error', e.message); return { ok: false }; }
}

const templates = {
  requestToMaker: ({ ref, title, name, company, email, use, intended, base }) => ({
    subject: `License request ${ref}: ${title}`,
    text: `${name}${company ? ` (${company})` : ''} <${email}> asked to license "${title}" for ${use}.\n\n${intended ? `How they will use it: ${intended}\n\n` : ''}Accept, or decline with a word: ${base}/account/requests/${ref}`,
  }),
  receivedToLicensee: ({ ref, title, name }) => ({
    subject: `Your request ${ref} for "${title}"`,
    text: `Dear ${name},\n\nThank you. Your request to license "${title}" is with the maker, who will confirm terms in writing, usually within a day.\n\nReference: ${ref}`,
  }),
  declinedToLicensee: ({ ref, title, name, word, base, slug }) => ({
    subject: `About your request ${ref} for "${title}"`,
    text: `Dear ${name},\n\nThank you for asking. The maker is not able to license "${title}" for this use.${word ? `\n\nThey write: ${word}` : ''}\n\nThe photograph can still be collected, and other uses may be open: ${base}/w/${slug}\n\nReference: ${ref}`,
  }),
  payToLicensee: ({ ref, title, name, fee, url }) => ({
    subject: `Terms for "${title}" (${ref})`, cta: { label: `Pay ${fee} and take the file`, url },
    text: `Dear ${name},\n\nThe fee for your license of "${title}" is ${fee}. Pay securely here and the file and certificate arrive at once:\n\n${url}\n\nReference: ${ref}`,
  }),
  grantedToLicensee: ({ ref, title, name, certUrl, downloadUrl, ends }) => ({
    subject: `It's yours: "${title}" (${ref})`, cta: { label: 'Open your license', url: certUrl },
    text: `Dear ${name},\n\nThank you. Your license is active${ends ? ` until ${ends.slice(0, 10)}` : ''}.\n\nCertificate: ${certUrl}\n${downloadUrl ? `Full file (valid for the term): ${downloadUrl}\n` : ''}\nThe file carries its license reference, so the use can always be verified.`,
  }),
  soldToMaker: ({ ref, title, use, buyer, fee, base }) => ({
    subject: `Collected: "${title}", ${fee}`,
    text: `"${title}" was just collected.\n\n${use}, by ${buyer}. ${fee}, paid.\nThe file, the certificate and the receipt have been sent.\n\n${base}/studio/licenses/${ref}`,
  }),
  sightingToMaker: ({ title, url, base }) => ({
    subject: `"${title}" was seen at ${url.replace(/^https?:\/\//, '').split('/')[0]}`,
    text: `Someone reported "${title}" in use here:\n${url}\n\nCheck it against your licenses and decide what to do:\n${base}/studio/sightings`,
  }),
  applicationToMaker: ({ name, email, portfolio, practice, base }) => ({
    subject: `A maker applied: ${name}`,
    text: `${name} (${email}) applied to hold their work on Watermark.\n${practice ? `Practice: ${practice}\n` : ''}${portfolio ? `Work: ${portfolio}\n` : ''}\n${base}/studio/makers`,
  }),
  renewalToLicensee: ({ ref, title, name, ends, url }) => ({
    subject: `Your license for "${title}" ends ${ends.slice(0, 10)}`,
    text: `Dear ${name},\n\nLicense ${ref} for "${title}" ends on ${ends.slice(0, 10)}. To keep using it, renew here:\n\n${url}`,
  }),
};

module.exports = { on, send, templates, paper };
