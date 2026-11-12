# CLAUDE.md

Timeweft is a workbench for building universes and writing stories in them. Its first job is the
**story loop**: a chat asks what is so, writes a scene, saves the scene with what it established,
and any fresh chat can resume the story from a page of state.

Keep this file short. A reason longer than a paragraph goes in `docs/decisions/`, one file per
decision, read when it is needed. A lesson that can be a test is a test.

## The line that matters most

**This repository holds no canon.** No name from the author's worlds, no word of a made tongue,
no lore: not in code, tests, comments, documents, commit messages or branch names. The author's
canon lives in the database of the author's own installation and nowhere else.

- Tests and examples use a made-up demo world. Invent plain names for it (a baker, a mill, a ford).
- A session that works with the author's real files keeps them outside the repository, or under
  `private/`, which git ignores. Never quote from them in a commit, a comment or a pull request.
- `pnpm check-no-canon` checks it, against a list that is itself kept outside the repository.

## The rules the code keeps

1. **History is kept whole, and only the newest is served.** A fact is never changed in place; a
   newer one closes the older by naming the scene it stopped holding at.
2. **Cold, hard facts.** The store holds what is so. A mystery or a maybe is the telling's.
3. **What a story establishes is canon at once.** The one exception: a story may not replace what
   the author stated. That is kept as a collision, and the author decides.
4. **Author-only material never reaches a story.** An operation whose audience is `story` cannot
   return it. That is enforced where the store reads, not where a page draws.
5. **Every action is written once**, in `packages/contract/src/operations.ts`. The web route and
   the MCP tool are made from that list. Nothing is reachable that is not in it.
6. **A briefing has a size.** `resume_run` never answers larger than its budget, and says what it
   left out and how to fetch it.
7. **Names are not keys.** Everything has an id. Two things may share a name.

## The map

- `packages/contract` : the records, the operations and the interfaces between the parts.
- `packages/store` : PostgreSQL. Migrations and the doors every write goes through.
- `packages/briefing` : pure. A snapshot of a run and a budget in, a briefing out.
- `packages/weaver-files` : pure. Reads the five Markdown files a story kept by hand.
- `apps/server` : one process. The operations as web routes and as MCP tools, and the import.
- `apps/web` : the author's pages.

## Working here

- TypeScript, strict, run directly by Node 22 with `--experimental-strip-types`. No build step
  for the server. Tests are `node --test`.
- Full names for functions and variables, spelled out. The author reads this code.
- The store's tests need PostgreSQL, named by `TIMEWEFT_TEST_DATABASE_URL`.
- `pnpm typecheck`, `pnpm test`, `pnpm check-no-canon` before every push.
