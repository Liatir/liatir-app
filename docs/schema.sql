-- D1 schema for the Liatir mailing list.
-- Apply with:
--   npx wrangler d1 execute liatir-mailing-list --file=./schema.sql            (local)
--   npx wrangler d1 execute liatir-mailing-list --remote --file=./schema.sql   (production)

CREATE TABLE IF NOT EXISTS subscribers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  source     TEXT,
  country    TEXT
);

CREATE INDEX IF NOT EXISTS idx_subscribers_created_at ON subscribers (created_at);
