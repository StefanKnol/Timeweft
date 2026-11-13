# 0002: Resources are copies of story answers

Decided 2026-11-13.

**What was decided.** The MCP server offers resources a chat can attach from the connector's
menu: each run's briefing, and each run's main characters (the main character, then the ten
people with the longest trails). Every one is a copy of an answer an existing story operation
gives: the briefing is what `resume_run` answers, and a person is what `look_up` answers for them,
with one line in front saying it is a copy and which tool gives the present. One prompt,
`continue_run`, tells a chat to call `resume_run` first.

**Why.** Every action is written once, in the operation list, and nothing is reachable that is
not in it. A resource made by its own store read would be a second door, and the first place
author-only material could slip past the story audience. Made by the operations' own path with the
story audience, a resource can serve nothing the story audience could not see. No store method was
added. It is not the same as serving only what a tool call could: a person is reached by id where
look_up reaches by name, so two open people who share every name they go by are each readable as a
resource while look_up refuses that name. Such a copy says so in its first line.

A copy goes stale the moment the story moves on, and an attachment is read when the chat starts,
not when it needs the answer. So each copy says so, and the tools stay the present.

**What follows from it.**

- A person's uri carries the entry's id, never a name, since names are not keys.
- Any open person of the run can be read by uri, listed or not, so an attached pointer keeps
  working when the ten change. Anything else is refused in one sentence that names nothing.
- A person's copy is cut to about 60,000 bytes, the trail first, and says what was left out.
