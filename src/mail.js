// Email. Uses Resend's HTTP API when RESEND_API_KEY is set; otherwise logs to the console,
// so the app works fully without a mail provider.
async function send({ to, subject, text, from }) {
  const key = process.env.RESEND_API_KEY;
  const sender = from || process.env.MAIL_FROM || 'Watermark <license@krafftco.com>';
  if (!key || !to) { console.log(`[mail:off] to=${to} subject="${subject}"`); return { skipped: true }; }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: sender, to: [].concat(to), subject, text }),
    });
    if (!r.ok) console.error('[mail] failed', r.status, await r.text());
    return { ok: r.ok };
  } catch (e) { console.error('[mail] error', e.message); return { ok: false }; }
}

const templates = {
  requestToMaker: ({ ref, title, name, company, email, use, intended, base }) => ({
    subject: `License request ${ref}: ${title}`,
    text: `${name}${company ? ` (${company})` : ''} <${email}> asked to license "${title}" for ${use}.\n\n${intended ? `How they will use it: ${intended}\n\n` : ''}Quote, grant or decline: ${base}/studio/licenses/${ref}`,
  }),
  receivedToLicensee: ({ ref, title, name }) => ({
    subject: `Your request ${ref} for "${title}"`,
    text: `Dear ${name},\n\nThank you. Your request to license "${title}" is with the maker, who will confirm terms in writing, usually within a day.\n\nReference: ${ref}`,
  }),
  payToLicensee: ({ ref, title, name, fee, url }) => ({
    subject: `Terms for "${title}" (${ref})`,
    text: `Dear ${name},\n\nThe fee for your license of "${title}" is ${fee}. Pay securely here and the file and certificate arrive at once:\n\n${url}\n\nReference: ${ref}`,
  }),
  grantedToLicensee: ({ ref, title, name, certUrl, downloadUrl, ends }) => ({
    subject: `Licensed: "${title}" (${ref})`,
    text: `Dear ${name},\n\nYour license is active${ends ? ` until ${ends.slice(0, 10)}` : ''}.\n\nCertificate: ${certUrl}\n${downloadUrl ? `Full file (valid for the term): ${downloadUrl}\n` : ''}\nThe file carries its license reference, so the use can always be verified.`,
  }),
  renewalToLicensee: ({ ref, title, name, ends, url }) => ({
    subject: `Your license for "${title}" ends ${ends.slice(0, 10)}`,
    text: `Dear ${name},\n\nLicense ${ref} for "${title}" ends on ${ends.slice(0, 10)}. To keep using it, renew here:\n\n${url}`,
  }),
};

module.exports = { send, templates };
