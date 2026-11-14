# Build plan: the pages, for a run of hundreds of scenes

The decisions are in `docs/decisions/0005-the-pages.md`. This file is the order of work.

Spine: the "smallest change" proposal (keep the run page, the sections, the hash router and one read
of the run; fix each fault where it lives). Grafted from the other two: the run read without the
scenes' prose, with `read_scene_text` and `search_scenes` (measured 3,556,179 to about 1,470,000
bytes; 447 KB to about 251 KB gzipped, and it is re-read after every act); an eighth section for the
run's details instead of a fold above every section; an entry picker that chooses by id; the
scene editor's draft kept in session storage; the side column for "what it established" on wide
screens; serif for the story, system sans for the tool.

## Every slice ends with

- `pnpm typecheck`, `pnpm test` (PostgreSQL running, `TIMEWEFT_TEST_DATABASE_URL` set),
  `pnpm check-no-canon`, `pnpm --filter @timeweft/web build`.
- A Playwright drive against `timeweft_demo` / `the-long-valley` (recipe in `HOW-TO-RUN.md` beside
  this file) at 1280x900 and 390x844, no page errors, screenshots in this folder under the slice's
  name. Assert positions and element counts; report timings, with generous limits only.
- Every name in tests and examples is made up (a miller, a ford). No canon.
- Test-only names never touch `timeweft_test` for demo data; demo data lives in `timeweft_demo`.

## Which slices can be built side by side

| Group | Slices | Why they do not collide |
| --- | --- | --- |
| Server, any time | 3 (compression) | Only `apps/server/src/http-server.ts`, `static-files.ts` and a test. |
| Server first, then web | 4 | Contract, store and server; its one page change is in `ScenesSection.tsx`, so it lands before 5. |
| Store half of 9 | 9a | Contract, store, export, server. Can run beside 5 to 8, which touch only `apps/web`. |
| Web, one at a time | 1, then 2 | Both touch `RunPage.tsx` and every section's forms. |
| Web, then side by side | 7 and 8, after 5 | 7 owns `EntriesSection.tsx`, 8 owns `RulingsSection.tsx`, `ThreadsSection.tsx`, `JourneysSection.tsx`, `CollisionsSection.tsx`. Each puts its helpers in a new module (`entry-shaping.ts`, `list-shaping.ts`) and only adds exports; `EntryPicker.tsx` is made in 5 and only used by them. |
| Last | 10 | Touches `styles.css` broadly; after the layout slices. |

Order of value: 1 and 5 give what the author asked first. Suggested order: 1, 3, 2, 4, 5, 6, 7 and 8
together, 9a (any time after 4) then 9b, 10.

---

## Slice 1. The shell: a short header, tabs that stay in view

**Goal.** A section's own content starts within the first phone screen, and the tabs can be
reached from anywhere on the page.

- The run header is one line: the title, then a quiet mark for binding or a telling.
- A new eighth section, `run` ("About this run"), holds the setting, clocks, narration, the run's
  details editor, the run's history and the backup download. `RUN_SECTIONS` gains `'run'`.
- The tabs are one sticky row under the masthead (`position: sticky; top: 0`), scrolling sideways
  on a phone, never wrapping. The current tab has an underline besides its fill. The collisions
  badge stays.
- Changing tab scrolls to the section's heading (the browser's own Back keeps its scroll).
- `document.title` follows the route: "420. <title> · Scenes · <run title>".
- A "Skip to the section" link is the first thing a keyboard reaches.
- Masthead: the version note goes; "Forget token" moves to the page foot.
- Lists, tables and forms get a wider frame (a class on the section, up to 60rem); prose keeps 42rem.

**Operations.** None. **Migrations.** None.

**Files.** `apps/web/src/RunPage.tsx`, `App.tsx`, new `RunSection.tsx`, `shaping.ts`
(`RUN_SECTIONS`, `titleOfRoute(route, snapshot)`), `styles.css`.

**Tests.** shaping: the `run` route round trips; `titleOfRoute` for the runs page, each section, a
scene by number, a struck take, an entry.

**Done in the browser.** On a phone the section heading is above 250 px from the top on every
section; after scrolling 8,000 px the tabs are on screen; the tab title names the scene; no page
scrolls sideways at 390; the run details, history and backup work from "About this run".

---

## Slice 2. One way of saying what an act did

**Goal.** The author sees the result of every act where they are looking, only the latest, and
focus never drops to the top of the page.

- A `NoticeArea` fixed at the foot of the run page (`role="status"`, polite). `useAct` reports
  successes there. A notice replaces the one before; a plain one goes after 6 seconds, at the next
  act or on a route change; one holding a link ("Marked reached at scene 45 · Show it", "Kind
  changed · Show it") or an Undo stays until dismissed (×) or replaced; kept while hovered or focused.
- A refusal stays beside its form (`role="alert"`) and clears on the first input in that form.
- Forms are no longer remounted by `key` after `readAgain`; where the key only reset values, the
  form resets its own state. A form that disappears (thread closed, waypoint reached) moves focus to
  the notice; one that stays keeps focus on its button.
- Edit forms (reword, rename, run details) close when they save and show the new value.
- `ConfirmingButton` (already in `authoring.tsx`) on: settling a collision (the question names both
  values: "Keep "sixty" and drop the story's "about forty"?") and marking a waypoint reached (names
  the scene).
- An entry that changes kind is left open and scrolled to after the redraw.
- Wording: no full stop after quoted text that ends in punctuation; the duplicate-name caution in
  words with names, no ids; history lines show the time of day (records already carry `createdAt`).

**Operations.** None. **Migrations.** None.

**Files.** `apps/web/src/authoring.tsx`, new `NoticeArea.tsx`, `RunPage.tsx` (provider), every
section with forms (`EntriesSection`, `ThreadsSection`, `RulingsSection`, `JourneysSection`,
`CollisionsSection`, `RunDetailsEditor`), `shaping.ts` (`noticeAfter(state, event)` reducer,
`quotedSentence`, the caution wording).

**Tests.** shaping: a success replaces a success; a refusal clears on edit; a notice with a link
stays; the caution has no id in it; a quoted question gets no extra full stop.

**Done in the browser.** Two acts in a row show only the second notice; a refusal goes on typing;
`document.activeElement` is not `BODY` after any act; a collision needs two presses; a reworded
waypoint's form closes.

---

## Slice 3. Compressed answers

**Goal.** Fewer bytes over a phone's data.

- JSON answers and static files are compressed with `node:zlib` (brotli where `Accept-Encoding`
  allows it, else gzip, else plain), with `Vary: Accept-Encoding`. No dependency.

**Operations.** None. **Files.** `apps/server/src/http-server.ts`, `static-files.ts`, a test.

**Tests.** Over HTTP: gzip when asked and the body round trips; plain when not asked; `HEAD` sends
no body.

**Done in the browser.** `read_run` arrives with `content-encoding`.

---

## Slice 4. The run read without the scenes' text, and two author reads

**Goal.** The run page reads about 40 percent of today's bytes, and every scene's text is still
one request away and searchable.

**Operations changed and added** (all in `packages/contract/src/operations.ts`, so the routes are
made from them; all audience `author`, effect `reads`, so none is an MCP tool):

- `read_run` (input unchanged: `{ run }`): its answer becomes `RunOutline`, the snapshot with
  `scenes: SceneOutline[]`, where `SceneOutline` is `SceneRecord` without `record` plus
  `recordWords: number`. Description says the text is left out and `read_scene_text` fetches it.
  `snapshotOf` is unchanged for its other callers (resume, restore answers).
- `read_scene_text`, input `{ run: runHandle, sceneId: string }`. Answer
  `{ sceneId, number, status, record }`. Any take, struck ones included. Refused where the run holds
  no scene with that id.
- `search_scenes`, input `{ run: runHandle, text: string (min 2), includeStruck: boolean (default
  false), limit: number int 1..200 (default 50) }`. Searches title, summary, record, steer and
  situation after with `ILIKE` (the `%`, `_` and `\` in the text escaped). Answer: `{ matches:
  [{ sceneId, number, status, title, field, excerpt, matchStart, matchLength }], total }`, newest
  first, an excerpt of about 160 characters cut on word boundaries. Case-blind; not accent-blind
  (said in the description).

**Migrations.** None. (An index only if measured slow; at 420 scenes ILIKE takes milliseconds.)

**Files.** `packages/contract/src/operations.ts`, `records.ts` (`SceneOutline`, `RunOutline`),
`answers.ts` (Store methods `outlineOf`, `sceneTextOf`, `searchScenes`), `packages/store/src/
store.ts` and `snapshot.ts`, `apps/server/src/operations.ts`, `apps/web/src/RunPage.tsx` (types),
`ScenesSection.tsx` (fetch the text when a scene opens, "Loading the scene…", keep fetched texts for
the visit).

**Tests.** Store: the outline holds no record and the right word counts; `sceneTextOf` returns a
struck take's text; `searchScenes` finds a phrase only in a record, leaves struck takes out unless
asked, honours the limit, treats `%` literally. Server: both reads are refused for a story caller
and are not MCP tools (the existing accounting and every-parameter-described tests cover them once
listed). A test seeding the demo plan (`apps/server/src/demo-run.ts`, a small scene count) asserts
the outline is under half the full snapshot's size.

**Done in the browser.** A scene opens with its text; `read_run` is well under 2 MB raw.

---

## Slice 5. The scene list

**Goal.** The newest scene is the first row; any scene can be found by number, word, star or person.

- Newest first by default; "Newest first / Oldest first" beside the count, kept in local storage
  (`timeweft.order.scenes`; read and write wrapped in try/catch, falling back to newest first).
  "Show older (50 more of N)" at the foot in newest-first order, at the top in oldest-first.
- Compact rows: number, title, ★, struck mark and date on one line; summary in quiet text clamped
  to two lines; the whole row is the link.
- `#/runs/<slug>/scenes/420` opens the standing take at 420; the pages link standing takes by
  number and struck takes by id. A number with no standing take says so ("Every take of scene 31 was
  struck" / "This run has no scene 900").
- A "Go to scene" number box. "Newest: 420" and "Continue reading: scene 388" (last scene opened in
  this run, local storage) at the top.
- Search box: as typed (150 ms pause), filters every scene in memory over number, title, summary,
  when, steer, situation after, case- and accent-blind; "Search the scenes' text too" (or Enter)
  calls `search_scenes` and adds prose matches with their excerpt, the match drawn as React spans
  (never HTML). Count: "12 of 420 scenes match". An empty result offers to clear the search.
- Chips: "Starred" (with count), "Has struck takes", "With…" (the new `EntryPicker`): scenes set at
  the entry, that first named it, or whose notes or facts are about it. One index built per run.
- Section state (search, chips, order, shown count, open struck boxes, scroll) kept per run and
  section in session storage; coming back from a scene scrolls its row into view and marks it.

**Operations.** Uses `search_scenes`. **Migrations.** None.

**Files.** `ScenesSection.tsx` split into `SceneList.tsx` and `SceneReader.tsx`; new
`EntryPicker.tsx` (WAI-ARIA combobox, no dependency: filters by name and other names, shows kind
and "first named at scene N", picks by id, one or many as removable chips, says how many
author-only entries it leaves out where it leaves them out); new `useSectionState.ts` and
`useRememberedOrder.ts`; `shaping.ts` (`orderedForDrawing`, `scenesMatching`, `scenesInvolvingEntry`,
`normaliseForMatching`, `sceneFromItemId`); `styles.css` (`.list-controls`, compact rows).

**Tests.** shaping: both orders and the Show older counts at 0, 50 and 420; number and id lookup,
an all-struck number; matching ignores case and accents; "With" by place, introduction, note and
fact; chip counts. EntryPicker: two entries sharing a name are offered apart.

**Done in the browser.** Scene 420 is the first row within the first screen on both sizes; the
order switch survives a reload; `/scenes/420` opens it; a phrase found only in a scene's text
finds it; "Starred" shows 17; returning from a scene leaves its row in view.

---

## Slice 6. Reading a scene

**Goal.** Read a stretch in order without going back to the list; see at a glance what a scene
changed.

- Previous and next ("‹ 419. <title>", "421. <title> ›") at the top and the foot, standing takes
  only. Left and right arrows (and j, k) on a desktop, ignored when focus is in a field or a
  modifier is held. Escape returns to the list in place. Neighbours' text is fetched ahead.
- A struck take links to "the standing take of scene 331"; a standing take says "1 earlier take
  struck" and links to it.
- Order of the page: title row (number, title, ★ toggle once slice 9 lands, Edit once slice 9
  lands); one quiet line (when · where as a link · clock readings); a tally ("Established: 3 facts,
  2 rulings, 1 thread opened · see below"); the summary as a quiet lead paragraph; the text under
  "The scene" (the code calls it `record`); Steer and "Where things stood after" only when not empty;
  "What it established", its groups folded past five items.
- From 80rem wide, "What it established" sits in a column beside the text.
- Every entry name and scene number on the page is a link.

**Operations.** Uses `read_scene_text`. **Files.** `SceneReader.tsx`, new `links.tsx` (`SceneLink`,
`EntryLink`), `shaping.ts` (`neighboursOfScene`, `establishedTallyInWords`), `styles.css`.

**Tests.** shaping: neighbours at both ends and around a struck number; the tally's words (none,
one, many).

**Done in the browser.** → on 419 opens 420; an arrow in a text box does nothing; on a phone the
title is under 150 px from the top; the column is beside the text at 1440 and below it at 390; the
tally jumps to "What it established".

---

## Slice 7. People, places and things

**Goal.** The tab opens in under half a second at 300 entries; one entry is found by typing; an
entry shows everything about it.

- A card's body is drawn only when opened, and each form inside only when its own fold opens.
- Counts per entry (facts, notes, edits, threads, rulings, scenes) made once per run.
- An opened entry is a page of its own at `#/runs/<slug>/entries/<id>`, with a back link that
  returns to the list in place (the scene pattern).
- Search over name and other names (accent-blind) and kind chips with counts, "Author only" among
  them; a count of matches.
- The entry page: "First named in scene 135: <title>" as a link; facts now holding (history behind
  "Show history"); "Threads about them" (open, then closed) and "Rulings about them", with counts;
  the trail, last ten first, "Show all"; every scene number a link; the edit forms behind one Edit.
- "Another entry it points at" in State a fact becomes the `EntryPicker`.
- Adding an entry, or renaming one, onto a name already in use asks first: "There is already a
  person called X, first named at scene 12. Add another anyway / Open that one."
- The author-only tag gets more colour difference.

**Operations.** None (`state_fact` already takes ids). **Files.** `EntriesSection.tsx` (split into
`EntryList.tsx` and `EntryPage.tsx`), new `entry-shaping.ts` (`entryIndexOf`, `entriesMatching`,
`threadsAboutEntry`, `rulingsAboutEntry`, `firstNamedScene`, `entriesSharingTheName`).

**Tests.** The index counts equal the old per-card scans on a hand-built snapshot; matching by
other names; kind counts with author-only counted apart; the duplicate-name check.

**Done in the browser.** The tab opens with fewer than 10,000 elements in the page; under 500 ms on
a desktop and under 2 s at a 4x processor slowdown (reported); typing a person's name leaves their
row; their page lists their threads and rulings and links to the scene that first named them; a
duplicate add asks first.

---

## Slice 8. Rulings, threads, journeys, collisions

**Goal.** The newest ruling and the quietest thread are one step away; forms fit a phone.

- Rulings: newest first with the same switch; Show older at the foot; the filter also matches the
  names and other names of the entries a ruling is about; topic chips with counts (a select with
  counts if the run has more than about 12 topics); compact rows; "Withdraw it" inside an opened
  ruling; "Given at scene N" a link; a ruling just added is at the top, marked.
- Threads: Open (default) / Closed / All with counts; orders Recently moved / Quiet longest / Newest
  opened, remembered; a filter box over the words and an EntryPicker for "about"; each row says
  "quiet for N scenes" (from the last touch to the newest standing scene); "Say it moved on" and
  "Close it" inside an opened thread; 50 at a time, Show more at the foot; an opened thread's id in
  the address.
- "Open a thread" and "Add a ruling" use the `EntryPicker` for who it is about, not 300 tick boxes.
- Journeys: a compact table (from, to, how long, scene link), newest first with the switch, a filter
  by place; place names linked where they name an entry.
- Collisions: the entry name and the scene are links; a short piece of the scene's summary.

**Operations.** None. **Files.** `RulingsSection.tsx`, `ThreadsSection.tsx`, `JourneysSection.tsx`,
`CollisionsSection.tsx`, new `list-shaping.ts` (`rulingsMatching` with about-names, `rulingsToDraw`,
`threadsToDraw`, `quietForScenes`, `journeysToDraw`).

**Tests.** A ruling about a person is found by their other name; quiet longest puts the stalest
open thread first; quiet-for counts against the newest standing scene, not the newest take.

**Done in the browser.** The first ruling is 750; an added ruling appears at the top under the form;
"Quiet longest" puts the stalest thread first; each form is under 1,500 px tall on a phone.

---

## Slice 9. Editing a saved scene, and its star

Built in two halves. 9a can run beside slices 5 to 8; 9b needs 6.

### 9a. Store, contract, export

**Operation added.** `edit_scene`, audience `author`, effect `writes`. Input:
`{ run: runHandle, sceneId: string, title?: string, summary?: string, whenTyped?: string,
placeEntryId?: string | null, record?: string, steer?: string, situationAfter?: string,
starred?: boolean }`. Every parameter described. A field left out keeps its value; `placeEntryId:
null` clears the place. Answer: the scene as it now stands and the fields changed.

Refused: no scene with that id in the run; a struck take ("A struck take is kept as it was; edit the
standing take of scene N"); nothing different; an empty or blank title; a place entry not in the
run or one a redo took back.

**Operation changed.** `redo_scene`'s answer says how many author edits the struck take carried
("The struck take carried 2 edits by the author; they stay with it."), where it carried any.

**Migration 8, "the author edits a scene".** Table `scene_edits`: `id` (own id), `run_id` →
runs on delete cascade, `scene_id` → scenes on delete cascade, `field` text check in
(`title`, `summary`, `whenTyped`, `placeEntryId`, `record`, `steer`, `situationAfter`, `starred`),
`earlier_value` text not null, `later_value` text not null (a place as its id or `''`, a star as
`true`/`false`), `after_scene_id` → scenes, `created_at`, `written_order`, `write_mark`, as
`entry_edits` has. Index on `(run_id, written_order)`.

**Also:**
- `TABLES_THE_AUTHORS_HAND_WRITES` gains `scene_edits` (so an import with edits after it is not
  replaceable) and `replace-imported-run.ts` gets its words.
- The redo date move (`store.ts`, the loop over `run_edits`, `entry_edits`, `waypoint_rewordings`)
  includes `scene_edits`.
- `run-tables.ts` lists the table; `RUN_EXPORT_FORMAT_VERSION` 2, `RUN_EXPORT_FORMAT_VERSIONS_READ`
  `[1, 2]`, with a version 1 reader that brings an empty `scene_edits` list.
- `RunSnapshot` and `RunOutline` gain `sceneEdits: SceneEditRecord[]`, empty for a story.

**Files.** `packages/store/src/migrations.ts`, `database.ts`, `store.ts`, `snapshot.ts`,
`run-tables.ts`, `export-run.ts`, `restore-run.ts`, `replace-imported-run.ts`;
`packages/contract/src/operations.ts`, `records.ts`, `answers.ts`, `run-export.ts`;
`apps/server/src/operations.ts`; `docs/decisions/0005-the-pages.md` already says the rules.

**Tests (PostgreSQL).** An edit keeps the earlier value as a row and the scene its id; every refusal
above; a story's `read_scene`, `list_scenes` and `resume_run` serve the new wording and no edits;
facts, notes and legs untouched; a star alone writes one row; a redo of the edited newest scene
leaves the edits on the struck take, moves their `after_scene_id` to the new take and says so;
export and restore round trip with edits; a version 1 document restores; the completeness test
passes; an import with an edit after it is refused for replace.

### 9b. The page

- A ★ toggle on each scene row and on the scene page: one press, no confirm; the notice says "Starred
  · Undo".
- "Edit" on the scene page opens edit mode in place: title, when, place (EntryPicker, one pick, or
  none), summary, the text as a tall auto-growing textarea in the reading serif and measure, steer
  and what stood after in a "More" fold. Save and Cancel pinned at the foot. Only changed fields are
  sent. The draft is kept in session storage under the scene id until saved or discarded, and
  offered back after a reload. Leaving with unsaved changes asks once. One line under the editor:
  "This changes the scene's words only. What it established is changed under People, places and
  things." On the newest scene, under what stood after: "A resume reads this as where things stand."
- After saving: the editor closes; the notice says "Saved · Undo" (Undo is a second `edit_scene`
  back to the earlier values, itself kept in history).
- Under the title: "Edited after scene 412, 14 Nov 11:20 (title, the scene) · Show earlier
  wordings": each field's earlier value whole, newest first, a long text folded with its first lines.
- An "edited" mark on the row.

**Files.** `SceneReader.tsx`, `SceneList.tsx`, new `SceneEditor.tsx`, `shaping.ts`
(`sceneEditToSend`, `sceneEditsInWords`).

**Tests.** shaping: only changed fields are sent; clearing the place sends null; the history words.

**Done in the browser.** Edit a title and the text of scene 200, reload, see "edited" and the
earlier wording, press Undo; star a scene from the list and see it under "Starred"; a draft survives
a reload. The author checks the editor on a real phone afterwards.

---

## Slice 10. Look, touch and the smaller pages

**Goal.** Controls a thumb can hit, fields that can be seen, and the last rough pages.

- `--control-edge` token, at least 3:1 (about `#8a8478` light, `#6b7078` dark) for inputs, selects,
  chips and unselected tabs; `--line` stays for dividers. `--highlight` for search matches and a
  just-changed row, light and dark.
- System sans (`system-ui`) for chrome, rows, chips, counts and forms; the serif stays for the story,
  scene titles and the run title. A spacing scale of five steps.
- `@media (pointer: coarse)`: buttons, summaries, tabs, chips and rows at least 44 px tall.
- Briefing: on a phone the parts table becomes one block per part ("Rulings that bear: 154 served,
  596 left out"); the briefing's parts fold under headings with a "Copy all" button; the budget as
  named sizes (small, normal, large) with bytes in small print; the largest part named ("Rulings
  take 68% of the budget"). The briefing text itself is unchanged (see below on waypoint ids).
- Restore with replace asks a second time, naming the run and both dates, offers a backup download
  first, and says the result as a short difference with the full counts folded away.

**Files.** `styles.css`, `marks.tsx`, `BriefingSection.tsx`, `RestoreRunSection.tsx`, `shaping.ts`
(`contrastRatio` of the tokens, the briefing part words, the restore difference).

**Tests.** shaping: the tokens meet 3:1 and 4.5:1 where used for text; the restore difference words.

**Done in the browser.** At 390 on a coarse pointer no interactive element in Scenes or Threads is
under 44 px tall; the briefing table does not break words; restore with replace needs two presses.

---

## Every audit finding, and what answers it

### Reading the scenes

| Finding | Answered by |
| --- | --- |
| The newest scene is at the bottom of a very long list | 5 |
| A scene page has no previous or next | 6 |
| No way to find a scene by a word, a name, or a star | 5 (search, `search_scenes` from 4, chips) |
| A person's page does not say where they were first named; scene numbers not links | 7 (entry page), 6 (links on the scene page) |
| Coming back to the list loses your place; a reload loses how far back | 5 (section state, return to the row) |
| Every page sits under a long run header | 1 |
| The scene page puts structure words first and what it established far down | 6 |
| Struck takes are hidden in collapsed boxes | 5 (chip, box kept open), 6 (links both ways) |
| Scene addresses use a long id | 5 |
| The cards are tall | 5 (compact rows), 10 (touch sizes) |
| The whole run is fetched before the first scene shows | 3 (compression), 4 (no prose in the run read) |

### The long lists

| Finding | Answered by |
| --- | --- |
| People, places and things takes seconds to tens of seconds | 7 |
| No way to find one entry | 7 |
| A person's threads and rulings not reachable; ruling filter ignores who it is about | 7, 8 |
| Rulings run oldest first | 8 |
| Threads: nothing shows the long-quiet ones | 8 (quiet longest, quiet for N). A colour past a threshold is left: the sort already brings them up (open question 7). |
| Opening an item or switching tabs loses your place | 7, 8 (item in the address), 5 (section state, reused by every list) |
| Picking who a thread or ruling is about means 300 tick boxes | 5 (EntryPicker), 7, 8 |
| The briefing is hard to read on a phone and shows internal codes | 10 for the table, folds, named sizes and the largest part. **The waypoint ids stay in the briefing text on purpose**: a chat names a reached waypoint by its id in `save_scene`. Links from the briefing back to its items are left. |
| Collisions: one tap settles; nothing links | 2 (confirm), 8 (links) |
| Author-only cannot be filtered | 7 (chip, colour), 5 (picker says how many it leaves out) |
| Journeys cannot be filtered by place | 8 |

### The author's acts

| Finding | Answered by |
| --- | --- |
| Newest items at the bottom (scenes, rulings) | 5, 8 |
| The success message is out of view and the item moves away | 2 |
| An accidental duplicate entry cannot be removed and blocks stories | 7 (asks before a duplicate). **Removing or merging an entry is left** (open question 3). |
| Lasting acts with no way back | 2 (asks first). **Undo operations are left** (open question 4). |
| Messages stay after they stop being true | 2 |
| Switching tabs keeps the scroll; the phone's first screen is all header | 1 |
| Focus is lost after every act | 2 |
| Open edit forms stay open; run details push the page down | 2 (close on save), 1 (run details move), 7 (forms drawn only when opened) |
| No search for entries, threads or waypoints | 7, 8. Waypoints are few; no search for them. |
| Restore with replace removes a run after one tick and one press | 10 |
| Missing acts: write, edit, redo or star a scene; begin or delete a run | 9 (edit and star). **Writing and redoing a scene stay a chat's** (open question 5); **beginning and deleting a run are left** (open question 6). |
| Small wording faults | 2 |

### The phone and the look

| Finding | Answered by |
| --- | --- |
| The section tabs come after the whole title block | 1 |
| No way to change section without scrolling to the top | 1 (sticky row). A phone bottom bar is turned down for now (open question 1). |
| Scenes oldest first; no previous or next; tall rows | 5, 6 |
| People draws 117,862 elements | 7 |
| Writing tools crowd out reading | 7, 8 (actions inside the opened item) |
| Desktop uses a single 640 px column | 1 (wider frame for lists), 6 (side column). A list beside the open item is turned down (0005). |
| The browser tab always says "Timeweft" | 1 |
| Every control is under 44 px | 10 |
| Field, card and tab borders too faint | 10 |
| No skip link | 1 |
| Masthead's version note and Forget token take the best spot | 1 |

## What is deliberately not built

- A list beside the open item and a phone bottom bar (0005).
- Undo of reached, withdrawn, closed or settled; deleting or merging entries; beginning or deleting a
  run; writing or redoing a scene from the pages.
- Server paging or per-section reads; a virtual-scrolling list; a full-text index or accent folding
  in the store's search. Revisit past about 2,000 scenes or a 1 MB compressed run read.
- Telling a chat that the author reworded a scene (open question 2).
- New dependencies of any kind, web fonts, reading themes beyond the existing light and dark.
- Editing a struck take, a scene's number or its clock readings.
