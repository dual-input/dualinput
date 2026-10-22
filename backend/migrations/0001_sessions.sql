-- The backend's three tables (record/areas/network/02-units.md, "Its framework and storage").
-- Each write counts one more row against D1's free 100,000 a day for each index its columns
-- are in, so each table has its primary key and no other index.

-- A session, by its invite code, with the relay list its host started it with, and the
-- host's version and message hash, which a lookup compares with the joiner's.
CREATE TABLE sessions (
  code TEXT PRIMARY KEY,
  session TEXT NOT NULL,
  relays TEXT NOT NULL,
  version TEXT NOT NULL,
  hash TEXT NOT NULL,
  created INTEGER NOT NULL
) STRICT;

-- A member's entry, as the member wrote it, and when it last renewed, in ms since 1970.
CREATE TABLE members (
  code TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  entry TEXT NOT NULL,
  renewed INTEGER NOT NULL,
  PRIMARY KEY (code, endpoint)
) STRICT;

-- Each address's count of wrong codes in an hour, by hours since 1970.
CREATE TABLE wrong_codes (
  address TEXT NOT NULL,
  hour INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (address, hour)
) STRICT;
