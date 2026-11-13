#!/bin/sh
# Starts the image against a PostgreSQL and asks it the things a broken image gets wrong.
#
#   sh scripts/check-the-image.sh <image> <database address as the container reaches it>
#
# The container shares the host's network, so 127.0.0.1 in the address is the host's.
set -eu

image="$1"
database="$2"
port=4433
name=timeweft-image-check

fail() {
  echo "check-the-image: $1" >&2
  docker logs "$name" 2>&1 | tail -20 >&2 || true
  docker rm -f "$name" >/dev/null 2>&1 || true
  exit 1
}

docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" --network host \
  -e TIMEWEFT_DATABASE_URL="$database" -e TIMEWEFT_ACCESS_TOKEN=check-token -e PORT="$port" "$image" >/dev/null

# The server migrates before it listens, so give it a little while.
attempts=0
until curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  [ "$attempts" -lt 30 ] || fail "the server did not answer /health within 30 seconds."
  sleep 1
done

[ "$(docker exec "$name" whoami)" = "node" ] || fail "the container does not run as the unprivileged user."

curl -fsS "http://127.0.0.1:$port/health" | grep -q '"commit":"' || fail "/health does not report the build's commit."

status=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/")
[ "$status" = "200" ] || fail "the pages answered $status, not 200."

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$port/api/operations/list_runs" -d '{}')
[ "$status" = "401" ] || fail "a request with no token answered $status, not 401."

answer=$(curl -s -X POST "http://127.0.0.1:$port/api/operations/list_runs" \
  -H 'Authorization: Bearer check-token' -H 'content-type: application/json' -d '{}')
echo "$answer" | grep -q '"ok":true' || fail "list_runs with the token did not answer ok."

tools=$(curl -s -X POST "http://127.0.0.1:$port/mcp" -H 'Authorization: Bearer check-token' \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
echo "$tools" | grep -q '"name":"resume_run"' || fail "the MCP tool list does not offer resume_run."

if docker run --rm "$image" a-command-it-does-not-know >/dev/null 2>&1; then
  fail "an unknown command was accepted."
fi

docker stop "$name" >/dev/null
code=$(docker inspect "$name" --format '{{.State.ExitCode}}')
docker rm "$name" >/dev/null
[ "$code" = "0" ] || { echo "check-the-image: the server stopped with exit code $code, not 0." >&2; exit 1; }

echo "check-the-image: the image serves, refuses and stops as it should."
