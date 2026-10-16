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
