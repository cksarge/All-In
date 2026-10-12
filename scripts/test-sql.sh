#!/usr/bin/env bash
# Runs supabase/sql/*.sql (twice, to prove re-runnability) against a throwaway
# local Postgres with a Supabase stub, then runs supabase/tests/*_test.sql.
# Requires Postgres 15+ binaries (initdb, pg_ctl, psql) on PATH or in PG_BIN.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb /Applications/Postgres.app/Contents/Versions/latest/bin/initdb 2>/dev/null | tail -1)")}"
export PATH="$PG_BIN:$PATH"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
cleanup() { "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

if [ "$(id -u)" = "0" ]; then
  RUNAS=(su postgres -s /bin/bash -c); chown -R postgres "$WORK"
else
  RUNAS=(bash -c)
fi
"${RUNAS[@]}" "'$PG_BIN/initdb' -D '$WORK/data' -U postgres -A trust >/dev/null"
"${RUNAS[@]}" "'$PG_BIN/pg_ctl' -D '$WORK/data' -o '-p $PORT -k $WORK -c listen_addresses= -c wal_level=logical' -l '$WORK/log' start -w >/dev/null"

export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$ROOT/supabase/tests/00_supabase_stub.sql" >/dev/null

for pass in 1 2; do
  for f in "$ROOT"/supabase/sql/[0-9][0-9]_*.sql; do
    "${PSQL[@]}" -f "$f" >/dev/null || { echo "FAILED (pass $pass): $f"; exit 1; }
  done
  echo "pass $pass: all migration files applied"
done

# The hand-run "is the database up to date?" check must agree with the files (before the tests replace functions).
"${PSQL[@]}" -At -f "$ROOT/supabase/maintenance/check_database.sql" >"$WORK/check.txt"
if grep -qE '^(MISSING|OUT OF DATE|NOT UP TO DATE)' "$WORK/check.txt"; then
  echo "FAIL supabase/maintenance/check_database.sql is stale: run bash scripts/gen-db-check.sh"; head -20 "$WORK/check.txt"; exit 1
fi
echo "ok   check_database.sql ($(head -1 "$WORK/check.txt" | cut -d'|' -f3))"

status=0
for t in "$ROOT"/supabase/tests/*_test.sql; do
  if "${PSQL[@]}" -f "$t" >"$WORK/out.txt"; then echo "ok   $(basename "$t")"; else echo "FAIL $(basename "$t")"; tail -40 "$WORK/out.txt"; status=1; fi
done
exit $status
