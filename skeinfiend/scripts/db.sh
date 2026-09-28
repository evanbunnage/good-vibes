#!/bin/sh
# The local Postgres, ready to use: made the first time (in .pgdata/), started if it isn't running,
# with a `skeinfiend` database. Runs before `npm run dev`, inside the Nix shell (which sets PGDATA).
set -e
[ -f .env ] || cp .env.example .env
[ -d "$PGDATA" ] || initdb --username=postgres --auth=trust --no-instructions >/dev/null
pg_ctl status >/dev/null 2>&1 || pg_ctl start --silent --log="$PGDATA/postgres.log" -o "-k '$PGDATA' -c listen_addresses=localhost"
createdb --host=localhost --username=postgres skeinfiend 2>/dev/null || true
