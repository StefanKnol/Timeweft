# 0004: Export and restore a run

Decided 2026-11-13.

**What was decided.** The author continues runs in Timeweft and must never lose one. `export_run`
carries a whole run out as one JSON document, and `restore_run` puts it back exactly as it was.
Both are author operations, so they are web routes and never MCP tools: an export holds
author-only material. The types are in `packages/contract/src/run-export.ts`.

## Rows as the store keeps them, not records

The document holds one list per table a run's rows live in (`tables.<table name>`), and each row
holds every column under its own name, the store's private columns included (`write_mark`,
`written_order`, `established_by_scene_id`, `closed_by_scene_id`, `reached_by_scene_id`,
`written_by_scene_id`, `by_author`, the run's `imported_through`). A record leaves those out, and a
restore through records would quietly change what a later redo takes back and whether an earlier
import may be replaced. A restore writes the rows straight into the tables. It never goes through
the five-file reader or any door that would re-interpret them.

Values: uuid and text as strings, text arrays as arrays, integers as numbers, booleans as booleans,
bigints as decimal strings, json columns as their JSON value, null as null. A timestamp is text in
UTC with all six digits of microseconds (`2026-11-13T09:30:00.123456Z`), read and written in SQL as
text and never through a JavaScript Date, which would lose the last three digits.

Lists are in a fixed order (written order, or number, or position), so two exports of an unchanged
run are equal except for `exportedAt`.

## Order written and write marks after a restore

`written_order` is an identity column generated always, so a restore inserts with `overriding
system value`. After the rows are written, in the same transaction, each table's identity sequence
and the shared `timeweft_write_marks` sequence are set to the greater of where they stand and the
highest value just written (`imported_through` counts towards the write marks). A later write then
sorts after every restored row, and the restored run's own marks keep their order against each other,
so its import still reads as it did.

## What replace removes

Without `replace`, a run with the document's id or slug in the store is a refusal. With it, that run
is deleted whole, its row and every row that cascades from it, inside the same transaction as the
writing, so a refused or failed restore leaves it as it was. Refused even with `replace`: the id and
the slug belong to two different runs (one checkbox should never remove two runs); or
another run continues from the run removed and the document is a different run (another id), which
would leave that run continuing from nothing. Where the document is the same run, the continuing
runs point at it again once it is written; this needs the key on `runs.continues_run_id` to be
deferrable, which a migration makes so. A document continuing from a run the store lacks is refused,
naming that run's slug: restore it first.

## Versions

`formatVersion` is 2. A migration that adds, drops or changes a column of a run table raises it and
adds a reader for the version before, so an old backup always restores. A version the server does
not read is refused, naming the versions it reads.

- Version 1 is the first.
- Version 2 adds `scene_edits` (the author's changes to a saved scene, 0005). A version 1 backup
  holds no such list and is read as holding none; one that holds rows of it is refused as edited.

## How the completeness test finds the tables

It asks the database catalogue (`pg_constraint`, foreign keys) for every table in the schema that
points at `runs`, then, again and again, every table that points at one of those, until nothing new
is found. Each must have a list in an export, named after it, and each row must hold exactly that
table's columns. A new table or column a run writes fails the test by name until export carries it.

## Backups

Where `TIMEWEFT_BACKUP_FOLDER` is set, the server exports every run there shortly after it starts and
then every `TIMEWEFT_BACKUP_EVERY_HOURS` (24). A file is named `<slug>--<UTC time>.timeweft-run.json`,
written under a temporary name and renamed, and the newest `TIMEWEFT_BACKUPS_TO_KEEP` (14) of each
run are kept. A run is not written again where the SHA-256 of its `tables`, as JSON, equals that of
its newest file: a write mark alone does not move on every change (a collision settled, a touch).
A failure is logged and never stops the server.

## What a restore will not take

Every value is checked before anything is written, so a damaged or edited backup is refused by row
and column rather than reaching the database: a moment on a day the calendar lacks; text holding
the character of code zero, which PostgreSQL cannot store; and an order written or write mark below
1 or above 2 to the 62nd. That last bound is what keeps a restore from moving the shared write-mark
sequence near the top of what a bigint holds, which would make every later write on the server
fail. It is far above anything a real store reaches, and a backup from another server, whose marks
may be far ahead of this one's, is still taken. A value PostgreSQL refuses anyway is said as a
refusal, never as a fault.

A run's slug is held to the same shape `begin_run` holds it to, and must be the slug the document
names on its outside, because a backup file is named by the slug: a slug such as `../x` would
otherwise write a backup outside its folder. `backupFileName` refuses such a slug as well.

A backup file is written readable by its owner only, and a folder the server makes is open to its
owner only.

## Who can call them

The web routes are the author's, and they open with the access token. A story chat's connector
holds a token too, and where it holds the access token it could call `export_run` and `restore_run`
over the web routes. `TIMEWEFT_STORY_TOKEN`, where set, is a second token that opens `/mcp` and
nothing else, so the chat need never hold the author's.
