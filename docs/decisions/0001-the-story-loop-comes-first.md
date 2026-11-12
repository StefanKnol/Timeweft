# 0001: The story loop comes first

Decided 2026-11-12, with the author.

**What was decided.** The first thing Timeweft does is keep a story's memory: scenes, the people,
places and things they name, the facts about them, the author's rulings, and what is left open.
A chat writes the story; the app remembers it. World-building pages, calendars, maps and a
timeline come after.

**Why.** The author's stories were kept as five Markdown files that a chat rewrote as it went.
Every field kept its whole history inside itself, so the files grew past what any chat can read,
and the memory meant to stop a story degrading became the reason it did. A store that keeps
history and serves only the newest value is the cure, and it is the same store the world needs.

**What follows from it.**

- A fact holds from one scene until another. Nothing is written over.
- Resuming is a briefing with a size, never a file read whole.
- What a story invents is canon at once. Only a clash with what the author stated stops to ask.
- A run is binding by default. A telling keeps its facts to itself.
- Dates are exact counts on a named clock. What the clock counts from may be dated later.

**What it leaves for later.** Facts are dated by scene, not yet by time in a universe. The world
store, with its own time and calendars, replaces `setting` and the clocks when it is built.
