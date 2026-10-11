#!/usr/bin/env bash
# Starts a throwaway local Postgres on port 55432 for the end-to-end tests:
# Supabase stub + every supabase/sql file + test helpers + three test players.
# Needs Postgres 15+ binaries (initdb, pg_ctl, psql). Prints how to stop it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
DIR="$(mktemp -d)"
if [ "$(id -u)" = "0" ]; then RUNAS=(su postgres -s /bin/bash -c); chown -R postgres "$DIR"; else RUNAS=(bash -c); fi
"${RUNAS[@]}" "'$PG_BIN/initdb' -D '$DIR/data' -U postgres -A trust >/dev/null"
"${RUNAS[@]}" "'$PG_BIN/pg_ctl' -D '$DIR/data' -o '-p 55432 -k $DIR -c listen_addresses=localhost -c wal_level=logical' -l '$DIR/log' start -w >/dev/null"
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -h localhost -p 55432 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$ROOT/supabase/tests/00_supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/sql/[0-9][0-9]_*.sql; do "${PSQL[@]}" -f "$f" >/dev/null; done
"${PSQL[@]}" -f "$ROOT/scripts/e2e/test-helpers.sql" -f "$ROOT/scripts/e2e/reset.sql" >/dev/null
echo "E2E Postgres running on localhost:55432 (data in $DIR)"
echo "Stop it with: ${RUNAS[*]} \"'$PG_BIN/pg_ctl' -D '$DIR/data' stop\""
