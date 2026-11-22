'use strict';
// The indexes (9 Nov 2026; Scale 4/5). The house grew from 400 works to 62,000 with one index on `works` beyond its
// slug: every "this maker's works", "what is held", "this work's licences" read the whole table. Each is made if it is
// not there; one that cannot be made (a column a fresh house does not have yet) is skipped and said in the log. Made by
// the process that runs the chores (the worker, or a house that is one process), never by the website or a scribe, so
// the first build on a large house never holds a visitor.
const ROLE = require('./role');
const LIST = [
  ['works_maker_best', 'works (maker_id, status, curated, stars, id)'],
  ['works_place_best', 'works (status, place, curated, stars, id)'],
  ['works_artist_best', 'works (artist_id, status, curated, stars, id)'],
  ['works_taken_status', 'works (status, taken_at)'],
  ['works_status_created', 'works (status, created_at DESC, id DESC)'], // the Latest row: the newest on view
  ['works_status_best', 'works (status, curated, stars, id)'],
  ['works_sha256', 'works (sha256)'],
  ['works_source', 'works (source_url)'],
  ['works_copies', 'works (status, copies_at)'],
  ['works_place', 'works (place)'],
  ['works_taken', 'works (maker_id, taken_at)'],
  ['licenses_work', 'licenses (work_id, status)'],
  ['delivery_guest_works_work', 'delivery_guest_works (work_id, state)'], // (#203) asked by the picture's gate for any work not on view
  ['delivery_guest_works_guest', 'delivery_guest_works (guest_id, state)'],
  ['delivery_guests_maker', 'delivery_guests (maker_id)'],
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
  ['collection_works_work', 'collection_works (work_id)'], // (#8) "works in no room" on /studio: 1.3 s at 100,000 works without it
  ['downloads_license', 'downloads (license_id)'],
  ['downloads_sha', 'downloads (sha256)'],
  ['buyers_email', 'buyers (email)'],
  ['buyers_code', 'buyers (code)'],
  ['makers_email', 'makers (email)'],
  ['texts_maker', 'texts (maker_id)'],
  ['reading_list_buyer', 'reading_list (buyer_id)'],
  ['work_releases_work', 'work_releases (work_id)'],
  ['print_orders_status', 'print_orders (status)'],
  ['print_orders_work', 'print_orders (work_id, by_maker)'], // (#193) a work's prints the maker makes, on the maker's desk
  ['print_orders_waiting', 'print_orders (by_maker, status)'], // (#193) the prints waiting with makers, on each studio's front
  ['tips_post', 'tips (post_slug)'],
  // the agents' door (#28): each of its lists reads only its window, by the day
  ['feedback_at', 'feedback (at)'],
  ['sightings_created', 'sightings (created_at)'],
  ['disputes_at', 'disputes (at)'],
  ['makers_created', 'makers (created_at)'],
  ['works_created', 'works (created_at)'],
  ['ledger_type_at', 'ledger (type, at)'],
  ['licenses_starts', 'licenses (starts_at)'],
  // (16 Nov, #70–#77) the visitors' rooms at scale, each read by its index and a LIMIT
  ['works_guided', "works (status, stars DESC, id) WHERE closer IS NOT NULL"], // the hour's guided works (clock.js): only works with a guide, best first
  ['works_open', "works (maker_id, status) WHERE open IS NOT NULL"], // a museum's page counts its open works (institutions.js): 57 ms over 60,000 works without it
  // ---- the desks at scale (#78–#93, w/78-scale-desks): a desk lists a page of a maker's works, newest first by id,
  // and pages by id (deskpage.js); counts and sums are grouped by maker. Each line names the desk that asks it.
  ['works_maker_id', 'works (maker_id, id)'], // /account, /account/table, /account/copyright: the newest page of one maker
  ['works_maker_stars', 'works (maker_id, stars, id)'], // /account?stars=n: one grade's page
  ['sightings_work', 'sightings (work_id)'], // /account: a row's sightings, asked for the rows shown
  ['prepared_pages_at', 'prepared_pages (at, k)'], // (#139) the website's poll: what changed since its mark
  ['works_status_id', 'works (status, id)'], // /studio/masters: the newest page of what is held, stopping at the page
  ['works_maker_place', 'works (maker_id, place)'], // /account/table: the places the maker uses, counted from the index
  ['works_maker_al', 'works (maker_id) WHERE al_grade IS NOT NULL'], // /account/table: how many Al has read (aledit.state), counted from a partial index
  ['licenses_use', 'licenses (use_id, status)'], // /studio: what was collected and licensed (licences by their use), without a scan per use
  ['works_maker_keep', 'works (maker_id, status, open, bytes)'], // /account: the open-access count and Keeping's weighed sum, read from the index alone
  // (#114) the health, made by the worker: each work's latest fixity check in one pass, and the unsound works counted from an index
  ['fixity_last', 'fixity (work_id, id)'],
  ['works_condition', 'works (condition) WHERE condition IS NOT NULL'],
  ['works_accession', 'works (accession)'], // (#179) Find: an accession number typed exactly is one row, not a walk
  ['works_title_lower', 'works (lower(title))'], // (#179) Find: the works whose title is exactly what was typed, when a common word meets the ceiling
];
// On Postgres (16 Nov, #28's review) every index is built CONCURRENTLY: the build takes no lock that holds a write, so the
// website's writes to works, makers, the register and licences never wait on the worker's first build on a large house.
// It runs as a statement of its own, never inside a transaction (pgsync's exec of one statement is a simple query). A
// concurrent build that dies half-way (a restart, a deploy, a duplicate) leaves the index INVALID, and IF NOT EXISTS
// would then skip it for ever: so each pass first asks pg_index for any of these names not `indisvalid`, says so in the
// log, drops it (DROP INDEX CONCURRENTLY) and builds it again. The pass runs at every boot of the chores process. SQLite
// keeps the plain form (it has no concurrent build and no invalid state).
function ensure(db, { log = console.log } = {}) {
  let made = 0; const skipped = []; const pg = db.kind === 'postgres';
  const names = new Set(LIST.map(([n]) => n).concat('works_find'));
  if (pg) {
    let bad = []; try { bad = db.prepare("SELECT c.relname AS name FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = current_schema() AND NOT i.indisvalid LIMIT 500").all().map(r => r.name).filter(n => names.has(n)); } catch (e) { log(`[indexes] could not ask for invalid indexes: ${String(e.message).slice(0, 120)}`); }
    for (const n of bad) { log(`[indexes] ${n} was left half-built (invalid): dropping it to build again`); try { db.exec(`DROP INDEX CONCURRENTLY IF EXISTS ${n}`); } catch (e) { skipped.push(`${n} (invalid, not dropped): ${String(e.message).slice(0, 80)}`); } }
  }
  const create = pg ? 'CREATE INDEX CONCURRENTLY IF NOT EXISTS' : 'CREATE INDEX IF NOT EXISTS';
  for (const [name, on] of LIST) {
    try { db.exec(`${create} ${name} ON ${on}`); made++; } catch (e) { skipped.push(`${name}: ${String(e.message).slice(0, 80)}`); }
  }
  // Search at scale (find.js): the words of a work under a trigram index, so a word anywhere is found without a scan.
  if (pg) {
    try { db.exec('CREATE EXTENSION IF NOT EXISTS pg_trgm'); db.exec(`${create} works_find ON works USING gin ((lower(coalesce(title,'') || ' ' || coalesce(place,'') || ' ' || coalesce(keywords,'') || ' ' || coalesce(accession,'') || ' ' || coalesce(substr(taken_at,1,4),''))) gin_trgm_ops)`); made++; } catch (e) { skipped.push(`works_find: ${String(e.message).slice(0, 120)}`); }
  }
  if (skipped.length) log(`[indexes] ${made} in place; skipped ${skipped.length}: ${skipped.join(' · ')}`);
  return { made, skipped };
}
function mount(app, { db }) {
  app.locals.indexes = { ensure: () => ensure(db), LIST };
  if (ROLE.chores) ensure(db);
}
module.exports = { mount, ensure, LIST };
