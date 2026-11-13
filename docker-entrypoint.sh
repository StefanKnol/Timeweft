#!/bin/sh
# What the container runs.
#
#   serve                  the server (the default)
#   import-run <options>   read a run's five Markdown files into the database, then exit
#
# An import reads a folder, so mount it first, read-only, and name it as the container sees it:
#
#   docker run --rm -v /path/to/the/run:/import:ro -e TIMEWEFT_DATABASE_HOST=... \
#     -e TIMEWEFT_DATABASE_USER=... -e TIMEWEFT_DATABASE_PASSWORD=... <image> \
#     import-run --folder /import --slug <slug>
#
# Add --replace-earlier-import to import the files again over the run an earlier import of that
# slug made. It is refused where the run holds anything a story or the author wrote after it.
set -eu

run_node() {
  exec node --experimental-strip-types --no-warnings "$@"
}

command="${1:-serve}"
if [ "$#" -gt 0 ]; then shift; fi

case "$command" in
  serve)
    run_node /app/apps/server/src/main.ts
    ;;
  import-run)
    run_node /app/apps/server/src/import-run-command.ts "$@"
    ;;
  *)
    echo "Timeweft does not know the command \"$command\". It knows: serve, import-run." >&2
    exit 64
    ;;
esac
