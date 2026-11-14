# 0005: The pages, for a run of hundreds of scenes

Decided 2026-11-14.

**What was decided.** The pages stay one run page with its sections, one hash router and one read
of the run, and are fixed where a large run breaks them: the newest first, reading in order,
finding things, a short header, one way of saying what an act did, and the author editing a saved
scene. Nothing is rebuilt. The build plan is in slices, each shippable alone.

## What was turned down

- **A list beside the open item on a desktop, and a bar of tabs at the foot of a phone.** Both
  rebuild every section at once. A section's tabs that stay in view (one row, scrolling sideways on
  a phone) answer the real fault, tabs lost 20,000 pixels up. An opened entry becomes a page of its
  own, as a scene already is, so no card stretches the list.
- **Undo for marking a waypoint reached, withdrawing one, closing a thread, settling a collision.**
  Each needs its own rule about history. They ask once more before acting instead, naming what
  they will do. Editing a scene and its star are the only acts that offer Undo, because an undo
  there is simply another edit.
- **A picker that matches typed text to a name.** Names are not keys and two entries may share
  one, so a text box with suggestions cannot say which was meant. One picker component chooses an
  entry by its id and shows its kind and when it was first named beside the name.
- **Taking the waypoint ids out of the briefing text.** A chat names a reached waypoint by its id
  in `save_scene`, so the briefing must carry it. The page shows a waypoint by its words.
- **Asking whether a value changed since the editor opened.** No other author door asks it, and an
  edit keeps the earlier value whole, so a second tab writing over the first loses nothing.

## The order of a list

Scenes, rulings and journeys are drawn newest first, with **Show older** at the foot. A switch
beside the count turns a list oldest first. The choice is kept per section in the browser's own
storage, so the phone and the desktop remember separately, and it is never in the address.
Threads keep their own orders: recently moved, quiet longest, newest opened.

## Addresses

A scene is reached by its number: `#/runs/<slug>/scenes/420` is the standing take at 420. A struck
take has no number of its own and keeps its id. An opened entry, ruling or thread puts its id in
the address, so Back, a reload and a shared link come back to it. What a section shows (its filter,
order, how far back it is opened, where it was scrolled) is kept for the tab in session storage
and put back when the author returns.

## The run page reads the run without the scenes' text

`read_run` answers the run with each scene's record (its prose) left out and its length in words
given instead, under a type of its own so nothing reads an empty record as a scene with none. The
text is about two thirds of a run, it is read one scene at a time, and the whole answer is read
again after every act the author makes. Two author reads go with it: `read_scene_text` for one
take's record, struck takes included, and `search_scenes`, which searches the scenes' words in the
store. The story's `read_scene` and `find` are not reused: they read the story's view of a run,
which leaves out struck takes and author-only material. The server compresses its answers where
the browser accepts it.

## Editing a saved scene

`edit_scene` is an author operation: a web route, never an MCP tool. It changes a standing take's
title, summary, when, place, record, steer, what stood after it, or its star, and keeps the scene's
id, because a chat, a fact and a journey leg may hold it. It is kept as 0003 keeps an entry's
edits: the scene holds the newest values, and each field changed is a row in `scene_edits` with
both values, dated after the newest standing scene and with the time it was written.

- A story reads only the newest wording, as it reads a reworded waypoint. The earlier wordings are
  the author's.
- It never changes a fact, a note, a ruling, a thread or a journey leg. Those keep their own forms.
- It refuses a struck take, an edit that changes nothing, an empty title, and a place entry a redo
  took back.
- A redo of the newest scene leaves that take's edits with it, on the struck take, and moves their
  dates onto the new take, as every author act's date moves. The redo's answer says how many edits
  the struck take carried.
- Starring is an edit like the rest: a star can be set or taken off later, with history.

The new table is a run table, so the export's `formatVersion` becomes 2, with a reader for version
1 that brings an empty list, and an import that has edits after it is no longer replaceable.

## After an act

One notice area per page, at the foot of the screen, shows only the latest result. A plain success
goes after a few seconds or at the next act; one that holds a link (to where the item went) or an
Undo stays until it is dismissed or replaced. A refusal is shown beside the form it came from and
goes as soon as that form is edited. Forms are not drawn afresh after an act, so focus stays where
it was, or moves to the notice where the item left the list.
