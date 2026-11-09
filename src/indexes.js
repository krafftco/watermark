'use strict';
// The indexes (9 Nov 2026; Scale 4/5). The house grew from 400 works to 62,000 with one index on `works` beyond its
// slug: every "this maker's works", "what is held", "this work's licences" read the whole table. Each is made if it is
// not there; one that cannot be made (a column a fresh house does not have yet) is skipped and said in the log. Made by
// the process that runs the chores (the worker, or a house that is one process), never by the website or a scribe, so
// the first build on a large house never holds a visitor.
const ROLE = require('./role');
const LIST = [
  ['works_maker_status', 'works (maker_id, status)'],
  ['works_status_best', 'works (status, curated, stars, id)'],
  ['works_sha256', 'works (sha256)'],
  ['works_source', 'works (source_url)'],
  ['works_copies', 'works (status, copies_at)'],
  ['works_place', 'works (place)'],
  ['works_taken', 'works (maker_id, taken_at)'],
  ['licenses_work', 'licenses (work_id, status)'],
  ['licenses_buyer', 'licenses (buyer_id, status)'],
  ['licenses_status', 'licenses (status, id)'],
  ['licenses_token', 'licenses (download_token)'],
  ['licenses_set', 'licenses (set_ref)'],
  ['stood_work', 'stood (work_id)'],
  ['stood_viewer', 'stood (viewer)'],
  ['ledger_subject', 'ledger (subject)'],
  ['ledger_type', 'ledger (type, seq)'],
  ['notes_work', 'notes (work_id)'],
  ['hang_works_work', 'hang_works (work_id)'],
  ['downloads_license', 'downloads (license_id)'],
  ['downloads_sha', 'downloads (sha256)'],
  ['buyers_email', 'buyers (email)'],
  ['buyers_code', 'buyers (code)'],
  ['makers_email', 'makers (email)'],
  ['texts_maker', 'texts (maker_id)'],
  ['reading_list_buyer', 'reading_list (buyer_id)'],
  ['work_releases_work', 'work_releases (work_id)'],
  ['print_orders_status', 'print_orders (status)'],
  ['tips_post', 'tips (post_slug)'],
];
function ensure(db, { log = console.log } = {}) {
  let made = 0; const skipped = [];
  for (const [name, on] of LIST) {
    try { db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${on}`); made++; } catch (e) { skipped.push(`${name}: ${String(e.message).slice(0, 80)}`); }
  }
  if (skipped.length) log(`[indexes] ${made} in place; skipped ${skipped.length}: ${skipped.join(' · ')}`);
  return { made, skipped };
}
function mount(app, { db }) {
  app.locals.indexes = { ensure: () => ensure(db), LIST };
  if (ROLE.chores) ensure(db);
}
module.exports = { mount, ensure, LIST };
