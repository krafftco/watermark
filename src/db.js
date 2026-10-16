// Watermark data layer. SQLite, one file, no server to run.
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
  CREATE TABLE IF NOT EXISTS makers (
    id INTEGER PRIMARY KEY,
    handle TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    house TEXT,               -- the studio or company the maker works under
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS works (
    id INTEGER PRIMARY KEY,
    maker_id INTEGER NOT NULL REFERENCES makers(id),
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    caption TEXT,
    place TEXT,
    taken_at TEXT,
    camera TEXT,
    lens TEXT,
    width INTEGER, height INTEGER,
    original_file TEXT NOT NULL,   -- never served publicly
    sha256 TEXT NOT NULL,          -- fingerprint of the original, written to the ledger
    source_url TEXT,               -- where the work is published (e.g. a Krafft Studios piece)
    status TEXT NOT NULL DEFAULT 'held',  -- held | hidden
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS uses (
    id INTEGER PRIMARY KEY,
    maker_id INTEGER NOT NULL REFERENCES makers(id),
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    term_months INTEGER,           -- null = perpetual (prints)
    price_cents INTEGER,           -- null = terms on request
    kind TEXT NOT NULL DEFAULT 'license', -- license | print
    sort INTEGER NOT NULL DEFAULT 0,
    UNIQUE(maker_id, key)
  );
  CREATE TABLE IF NOT EXISTS licenses (
    id INTEGER PRIMARY KEY,
    ref TEXT UNIQUE NOT NULL,      -- WM-2026-000001
    work_id INTEGER NOT NULL REFERENCES works(id),
    use_id INTEGER NOT NULL REFERENCES uses(id),
    licensee_name TEXT NOT NULL,
    licensee_email TEXT NOT NULL,
    licensee_company TEXT,
    intended_use TEXT,
    price_cents INTEGER,
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL DEFAULT 'requested', -- requested | awaiting_payment | active | declined | expired
    stripe_session TEXT,
    download_token TEXT,
    starts_at TEXT, ends_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS ledger (
    seq INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    type TEXT NOT NULL,            -- work.registered | license.requested | license.granted | license.declined | ...
    subject TEXT NOT NULL,         -- work slug or license ref
    data TEXT NOT NULL,            -- JSON, public-safe (no emails)
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    note TEXT,                     -- the curator's wall text
    public INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS collection_works (
    collection_id INTEGER NOT NULL REFERENCES collections(id),
    work_id INTEGER NOT NULL REFERENCES works(id),
    sort INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (collection_id, work_id)
  );
  CREATE TABLE IF NOT EXISTS sightings (
    id INTEGER PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id),
    url TEXT NOT NULL,             -- where the work was seen
    note TEXT,
    reporter_email TEXT,           -- optional; never published
    status TEXT NOT NULL DEFAULT 'new', -- new | licensed | offered | resolved
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS seals (
    id TEXT PRIMARY KEY,           -- printed in the file's header
    work_id INTEGER NOT NULL REFERENCES works(id),
    label TEXT,                    -- who or what it was sealed for; private
    size TEXT NOT NULL,            -- large | original
    access TEXT NOT NULL,          -- access code carried in the file
    wrapped_key TEXT NOT NULL,     -- the data key, wrapped; never stored in the clear
    expires_at TEXT,
    status TEXT NOT NULL DEFAULT 'open', -- open | closed
    opens INTEGER NOT NULL DEFAULT 0,
    last_opened_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS seal_opens (
    seal_id TEXT NOT NULL REFERENCES seals(id),
    day TEXT NOT NULL,
    host TEXT,
    count INTEGER NOT NULL DEFAULT 1,
    UNIQUE(seal_id, day, host)
  );
  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    portfolio TEXT,
    practice TEXT,                 -- what they make
    note TEXT,
    status TEXT NOT NULL DEFAULT 'new', -- new | invited | declined
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS views (
    id INTEGER PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id),
    host TEXT,                     -- where it was seen: watermark itself or an embedding site
    kind TEXT NOT NULL DEFAULT 'view', -- view | embed | open
    day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    UNIQUE(work_id, host, kind, day)
  );
  `);
  return db;
}

module.exports = { open };
