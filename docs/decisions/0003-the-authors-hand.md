# 0003: The author's hand

Decided 2026-11-13.

**What was decided.** The author's pages can steer a run directly, not only through a chat:
waypoints, the run's title, setting, register and status, facts, rulings, threads and entries.
Each is an operation whose audience is `author`, so it is a web route and never an MCP tool.

## One rule for an act made outside a scene

An author's act is not part of a scene. It is **dated to the newest standing scene of its run at
the moment it is made**, and no scene's save is recorded as having done it (the store's
`established_by_scene_id`, `closed_by_scene_id` and `reached_by_scene_id` stay null).

- What starts (a fact stated, a thread opened, a ruling given) starts at that scene.
- What stops (a fact replaced or ended, a thread closed, a ruling or waypoint withdrawn) stops at
  that scene. A touch is a touch at that scene. An edit is dated after it.
- A waypoint is marked reached at the scene the author names, not at the newest.
- Where the run has no standing scene yet, what starts is dated to no scene, and what has to stop at
  a scene is refused, as `state_fact` already refused it. Rewording a waypoint and editing the run
  or an entry need no scene and are never refused for want of one.
- A redo of the newest scene moves every such date onto the new take and takes none of them back.
  This is what `state_fact` already did; it is now the rule for every author act. In particular:
  - An entry the redone take introduced and the author then edited (renamed, its pronoun, other
    names, kind or visibility changed) stays. Where the new take names it again, by its name or the
    name or kind it had before the author changed it, the take finds that same entry, and the take's
    input fills only the fields the author did not edit. Where the new take does not name it, it
    stays, introduced by no scene. An author-only entry is never taken up by a take, since a story
    cannot name it.
  - The author's touch on a thread is never written over. Where the new take touches the same
    thread, the author's note is kept, the take's is left out, and the answer says so.
  - A thread the redone take opened is taken back with it. Where the author had already closed it,
    it keeps the author's closing and resolution word for word, on the struck take, and the
    author's touches on it stay there too.
- An entry a redo took back (introduced by a struck take and named by nothing outside it) is not
  edited, renamed or turned: the doors refuse it.

## How each kind keeps its history

Nothing is deleted and nothing is written over without keeping what it held.

| What | How the earlier is kept |
| --- | --- |
| A fact replaced or ended | Closed at a scene, as facts always were. An ended fact simply has no fact after it. |
| A ruling withdrawn | `withdrawnInSceneId` set; kept word for word, shown to the author, not to a story. |
| A thread touched or closed | A touch row; the closing scene and resolution on the thread, as a scene's save writes them. |
| A waypoint reworded | Same id; the earlier and later words kept as a rewording row. |
| A waypoint withdrawn | `withdrawnInSceneId` set; kept, shown to the author, never served to a story. |
| The run's title, setting, register, status | The run holds the newest; each change is a row with both values and its date. |
| An entry's name, other names, pronoun, kind, visibility | The same, one row per field changed. A rename also adds the old name to the other names. |

A waypoint and an entry keep their ids through every change, because a chat may hold the id. That
is why their earlier values are history rows rather than superseded rows, which would take a new id.

## Turning an entry author-only

Only the entry's visibility changes, and a row keeps the change. Every story read already filters
by the entry: its facts, facts pointing at it, its trail, a scene set at it and the ids in rulings
and threads all leave every story answer at once, and come back at once when it is turned open
again. A journey leg names its places by text, not by id, so a leg whose start or end is a name of
an author-only entry (and of no entry a story is served) leaves every story answer too. A save's
own answer names no author-only entry either. Nothing is closed or moved, so turning it back loses
nothing.

While it is author-only a story cannot name it. A story that names the same name makes a new entry;
when the author turns the first open again, the answer says that two entries now share a name.

A thread, like a ruling, is told to a story, so the author may open one about open entries only. An
entry turned author-only after the thread was opened leaves the thread's about list in every story
answer, and the thread itself stays.

## Rulings reuse `record_ruling`

The author's page adds a ruling with `record_ruling`, the operation a chat calls to keep an
author's instruction word for word. It is one act, so it is written once: the author may run any
operation, the ruling is dated by the rule above already, and `statedByAuthor` is true by default.
It names the entries a ruling is about by name, and only entries a story can see, since a ruling is
told to a story and naming an author-only entry in it would tell the story it exists. Withdrawing
one is new and the author's alone: `withdraw_ruling`.

## Other names are typed one per line

A name may hold a comma ("Odo, the miller"), so the page's box for other names takes one name per
line and never splits on a comma.

## `state_fact` takes an id

Names are not keys, so `state_fact` now takes `entryId` and `aboutEntryId` beside the names it took.
One way of naming the entry must be given, not both. Existing callers that pass names are unchanged.
The author's own later fact replaces their earlier one in the same lane with no collision, as before.
A value is trimmed, and a value of only spaces is refused, as every other author door refuses empty
words.
