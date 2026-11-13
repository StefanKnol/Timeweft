# Timeweft

A workbench for building universes and writing stories in them. Private; nothing here is published.

## Running it

Node 22.18 or later, pnpm, and PostgreSQL.

1. Create the database, once. The server makes its tables itself when it starts.

   ```sh
   createdb timeweft
   ```

2. Set the environment variables. The database is named in parts; see the table further down.

   ```sh
   export TIMEWEFT_DATABASE_HOST=127.0.0.1
   export TIMEWEFT_DATABASE_USER=<user>
   export TIMEWEFT_DATABASE_PASSWORD=<password>
   export TIMEWEFT_ACCESS_TOKEN=<a long random string>   # every /api and /mcp request carries it
   export PORT=4400                                       # optional; 4400 when unset
   ```

3. Build the pages, then start the server. The server serves the built pages from `apps/web/dist`.

   ```sh
   pnpm install
   pnpm --filter @timeweft/web build
   pnpm --filter @timeweft/server start
   ```

4. Import a run a story kept by hand. On the pages, open Runs, choose Import a run, and pick its
   five files, `log.md`, `state.md`, `cast.md`, `items.md` and `places.md` (a file the run did not
   keep is left out). The answer counts what was read and lists every line that could not be
   placed.

   The command is the second way. Give the folder as an absolute path, since the command runs in
   `apps/server`. It prints counts only.

   ```sh
   pnpm --filter @timeweft/server import-run -- --folder /absolute/path/to/the/run --slug <slug>
   ```

5. Connect a chat over MCP (Streamable HTTP) at `http://<host>:<PORT>/mcp`, with the header
   `Authorization: Bearer <TIMEWEFT_STORY_TOKEN>`, or the access token where no story token is
   set. The chat is offered the story operations only. Set `TIMEWEFT_STORY_TOKEN`: the access
   token opens the author's web routes too, exporting and restoring whole runs among them, so a
   chat's connector should not hold it.

   From the connector's menu the chat can also attach a run's briefing, or one of a run's main
   characters (the main character and the ten people with the longest trails), and start from
   the prompt *Continue a run*, which asks for the run's slug. An attachment is a copy made when
   it was attached, of what `resume_run` or `look_up` answered; the tools give the present. See
   `docs/decisions/0002-resources-are-copies-of-story-answers.md`.

## Running it in a container

The image holds the app and nothing else. Everything the author writes lives in the PostgreSQL
database the container is pointed at, so that database is the one thing to back up. The server
can also write a backup file of every run on its own; see *Backups of runs*.

1. Build the image, or let the Docker workflow push it to your registry on every merge to `main`.

   ```sh
   docker build -t timeweft .
   ```

2. Start it beside a PostgreSQL. `compose.example.yml` does both; copy it, change the database
   password and the access token, then:

   ```sh
   docker compose -f compose.yml up -d
   ```

   On a server that runs containers one at a time, give the container port 4400 and these
   settings. The server makes and updates its own tables when it starts.

   | Setting | Needed | What it is |
   | --- | --- | --- |
   | `TIMEWEFT_DATABASE_HOST` | yes | The address of PostgreSQL as the container reaches it: a name or an IP address, nothing else. |
   | `TIMEWEFT_DATABASE_USER` | yes | The PostgreSQL user. |
   | `TIMEWEFT_DATABASE_PASSWORD` | yes | Its password, typed as it is. Any character is fine. |
   | `TIMEWEFT_DATABASE_PORT` | no | 5432 unless set. |
   | `TIMEWEFT_DATABASE_NAME` | no | `timeweft` unless set. |
   | `TIMEWEFT_ACCESS_TOKEN` | yes | Long and random. Every request to `/api` and `/mcp` carries it. |
   | `TIMEWEFT_STORY_TOKEN` | no | Long, random and different from the access token. Opens `/mcp` and nothing else, so a story chat's connector never holds the author's token. Unset, a chat connects with the access token. |
   | `PORT` | no | The port inside the container. 4400 unless set. |
   | `TIMEWEFT_BACKUP_FOLDER` | no | A folder to write a backup of every run into, automatically. Unset, nothing is backed up by itself. See *Backups of runs* below. |
   | `TIMEWEFT_BACKUP_EVERY_HOURS` | no | How often, in hours, from more than 0 up to 576 (24 days). 24 unless set. |
   | `TIMEWEFT_BACKUPS_TO_KEEP` | no | How many backups of each run the folder keeps; older ones are deleted. 14 unless set. |

   A whole address in `TIMEWEFT_DATABASE_URL` is still taken in place of the five database
   settings, but never beside them.

3. Open `http://<host>:4400/` for the pages, and connect a chat to `http://<host>:4400/mcp` with
   the header `Authorization: Bearer <TIMEWEFT_ACCESS_TOKEN>`.

4. Import a run a story kept by hand. On the pages, open Runs, choose Import a run, and pick its
   five files, `log.md`, `state.md`, `cast.md`, `items.md` and `places.md` (a file the run did not
   keep is left out). Nothing needs mounting that way.

   The command is the second way. Mount the folder holding the five files, read-only, and name it
   as the container sees it. The files must be readable by everyone, because the container does
   not run as root. It prints counts only.

   ```sh
   docker run --rm -v /path/to/the/run:/import:ro \
     -e TIMEWEFT_DATABASE_HOST=<host> -e TIMEWEFT_DATABASE_USER=<user> \
     -e TIMEWEFT_DATABASE_PASSWORD=<password> \
     <image> import-run --folder /import --slug <slug>
   ```

`http://<host>:4400/health` needs no token and says which build is running.

## Backups of runs

A backup of a run is one file holding everything the run holds: every scene with its struck
takes, every fact with its history, author-only material, rulings, threads, waypoints, journeys,
clocks, collisions and every change the author made, each exactly as the store keeps it. A run
restored from it is the same run, with the same ids, order and times. The file is the author's
canon, so keep it where the database is kept, never anywhere public.

**On the pages.** A run's page has *Download a backup of this run*. The Runs page has *Restore a
run from a backup file*, which puts a run back. A run with the backup's name or id already there
is refused, unless *Replace the run already here* is ticked: then that run, and everything it
holds, is removed and the backup is put in its place, in one step, so a refused or failed restore
leaves it as it was. A backup is sent without the spacing its file is written with, and what is
sent may be up to 200 MB, which is a file of about 250 MB or more; the page measures it before
sending, and the server refuses anything larger before reading it.

**By command.** A path is read from where the command is run. They print counts only.

```sh
pnpm export-run <slug> <file>         # one run, to the file named
pnpm export-all <folder>              # every run, each named by its slug and the time
pnpm restore-run <file> [--replace]   # put a run back from a backup file
```

In the container the same three are commands of the image, with the folder mounted:

```sh
docker run --rm -v /path/to/backups:/backups \
  -e TIMEWEFT_DATABASE_HOST=<host> -e TIMEWEFT_DATABASE_USER=<user> \
  -e TIMEWEFT_DATABASE_PASSWORD=<password> \
  <image> restore-run /backups/<file> --replace
```

**Automatically.** Where `TIMEWEFT_BACKUP_FOLDER` is set, the server writes a backup of every run
into that folder a minute after it starts and then every `TIMEWEFT_BACKUP_EVERY_HOURS` hours (24
unless set). Each file is named by the run's slug and the time it was taken, such as
`the-mill--20261113T093000Z.timeweft-run.json`, and is written under a temporary name first, so a
file with a backup's name is always whole. A run that has not changed since its newest backup is
not written again. The newest `TIMEWEFT_BACKUPS_TO_KEEP` files of each run are kept (14 unless set)
and older ones deleted. A backup that fails is written to the server's log, by run and kind of
failure only, and the server carries on. In a container, mount a folder there that the container's
user can write to; `compose.example.yml` shows one. Copy that folder somewhere else as well: a
backup on the same disk as the database is lost with it.

### Behind a hub or a proxy

The pages ask for the access token once and send it three ways with every request: as
`Authorization: Bearer`, in the header `x-timeweft-token`, and in a cookie kept to the folder the
pages are served from. The server takes any one of them. That is for a hub or proxy that serves
the pages on its own address and keeps the `Authorization` header for its own sign-in.

The Docker workflow pushes only where the repository has three secrets: `DOCKER_REPOSITORY`
(the registry host alone), `DOCKER_USERNAME` and `DOCKER_PASSWORD`. Without them it builds the
image and pushes nothing.
