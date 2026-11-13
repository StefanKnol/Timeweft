# Timeweft

A workbench for building universes and writing stories in them. Private; nothing here is published.

## Running it

Node 22.18 or later, pnpm, and PostgreSQL.

1. Create the database, once. The server makes its tables itself when it starts.

   ```sh
   createdb timeweft
   ```

2. Set the three environment variables.

   ```sh
   export TIMEWEFT_DATABASE_URL=postgres://<user>:<password>@127.0.0.1:5432/timeweft
   export TIMEWEFT_ACCESS_TOKEN=<a long random string>   # every /api and /mcp request carries it
   export PORT=4400                                       # optional; 4400 when unset
   ```

3. Build the pages, then start the server. The server serves the built pages from `apps/web/dist`.

   ```sh
   pnpm install
   pnpm --filter @timeweft/web build
   pnpm --filter @timeweft/server start
   ```

4. Import a run a story kept by hand. The folder holds its five files, `log.md`, `state.md`,
   `cast.md`, `items.md` and `places.md`; give it as an absolute path, since the command runs in
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

   On a server that runs containers one at a time, give the container three things: the
   variable `TIMEWEFT_DATABASE_URL` (the PostgreSQL address as the container reaches it), the
   variable `TIMEWEFT_ACCESS_TOKEN` (long and random), and port 4400. The server makes and
   updates its own tables when it starts.

3. Open `http://<host>:4400/` for the pages, and connect a chat to `http://<host>:4400/mcp` with
   the header `Authorization: Bearer <TIMEWEFT_ACCESS_TOKEN>`.

4. Import a run a story kept by hand. Mount the folder holding its five files, read-only, and
   name it as the container sees it. The files must be readable by everyone, because the
   container does not run as root. It prints counts only.

   ```sh
   docker run --rm -v /path/to/the/run:/import:ro \
     -e TIMEWEFT_DATABASE_URL=<the same address> \
     <image> import-run --folder /import --slug <slug>
   ```

`http://<host>:4400/health` needs no token and says which build is running.

The Docker workflow pushes only where the repository has three secrets: `DOCKER_REPOSITORY`
(the registry host alone), `DOCKER_USERNAME` and `DOCKER_PASSWORD`. Without them it builds the
image and pushes nothing.
