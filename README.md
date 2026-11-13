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
   `Authorization: Bearer <TIMEWEFT_ACCESS_TOKEN>`. The chat is offered the story operations only.

## Running it in a container

The image holds the app and nothing else. Everything the author writes lives in the PostgreSQL
database the container is pointed at, so that database is the one thing to back up.

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
   | `PORT` | no | The port inside the container. 4400 unless set. |

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

### Behind a hub or a proxy

The pages ask for the access token once and send it three ways with every request: as
`Authorization: Bearer`, in the header `x-timeweft-token`, and in a cookie kept to the folder the
pages are served from. The server takes any one of them. That is for a hub or proxy that serves
the pages on its own address and keeps the `Authorization` header for its own sign-in.

The Docker workflow pushes only where the repository has three secrets: `DOCKER_REPOSITORY`
(the registry host alone), `DOCKER_USERNAME` and `DOCKER_PASSWORD`. Without them it builds the
image and pushes nothing.
