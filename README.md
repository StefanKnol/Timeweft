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
