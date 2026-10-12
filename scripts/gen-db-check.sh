#!/usr/bin/env bash
# Writes supabase/maintenance/check_database.sql: a list of everything the numbered SQL files create
# (tables, columns, row level security, policies, triggers, functions and their bodies, realtime tables,
# and the catalogue rows), plus the query that compares a live database with that list.
#
# It applies supabase/sql/*.sql one by one to a throwaway Postgres and notes which file made or last
# changed each thing, so the check can say which file to re-run.
#
# Run it after changing any SQL file:  bash scripts/gen-db-check.sh
# (`npm run test:sql` fails when the check file is stale.)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/supabase/maintenance/check_database.sql"
PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb /Applications/Postgres.app/Contents/Versions/latest/bin/initdb 2>/dev/null | tail -1)")}"
export PATH="$PG_BIN:$PATH"
WORK="$(mktemp -d)"
PORT="${PGPORT_GEN:-54331}"
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

# The same "what is there now" query runs here (after every file) and in the check itself.
ACTUAL="$(cat <<'SQL'
select 'table'::text as kind, c.relname::text as name,
       case when c.relrowsecurity then 'rls on' else 'rls off' end as extra
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
union all
select 'column', c.relname || '.' || a.attname, ''
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
union all
select 'policy', c.relname || ': ' || p.polname, ''
  from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
union all
select 'trigger', n.nspname || '.' || c.relname || ': ' || t.tgname, ''
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where not t.tgisinternal and n.nspname in ('public', 'auth')
union all
select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       md5(regexp_replace(coalesce(p.prosrc, ''), '\s+', '', 'g'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'private')
   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
union all
select 'realtime', tablename::text, ''
  from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
SQL
)"
# Catalogue rows. These tables are old, but the generator starts from an empty database, so they are
# read through to_regclass-guarded dynamic SQL there; the check reads them directly.
ROWS="$(cat <<'SQL'
select 'game'::text as kind, g.key::text as name, case when g.released then 'released' else 'not released' end as extra
  from public.games g
union all
select 'stake level', t.game_key || ' / ' || t.tier, '' from public.stake_tiers t
union all
select 'achievement', a.key::text, '' from public.achievements a
union all
select 'cosmetic', c.key::text, '' from public.cosmetics c where (to_jsonb(c) ->> 'season') is null
SQL
)"

"${PSQL[@]}" >/dev/null <<SQL
create schema gen;
create table gen.obj (kind text, name text, extra text, file text, primary key (kind, name));
create function gen.snap(p_file text) returns void language plpgsql as \$gen\$
declare q text := \$q\$ $ACTUAL \$q\$;
begin
  if to_regclass('public.games') is not null and to_regclass('public.stake_tiers') is not null
     and to_regclass('public.achievements') is not null and to_regclass('public.cosmetics') is not null then
    q := q || ' union all ' || \$q\$ $ROWS \$q\$;
  elsif to_regclass('public.games') is not null and to_regclass('public.stake_tiers') is not null then
    q := q || \$q\$ union all select 'game'::text, g.key::text, case when g.released then 'released' else 'not released' end from public.games g
                   union all select 'stake level', t.game_key || ' / ' || t.tier, '' from public.stake_tiers t \$q\$;
  end if;
  execute 'insert into gen.obj (kind, name, extra, file) select kind, name, extra, \$1 from (' || q || ') x
           on conflict (kind, name) do update set extra = excluded.extra, file = excluded.file
           where gen.obj.extra is distinct from excluded.extra' using p_file;
end \$gen\$;
select gen.snap('stub');
SQL

for f in "$ROOT"/supabase/sql/[0-9][0-9]_*.sql; do
  "${PSQL[@]}" -f "$f" >/dev/null || { echo "FAILED: $f"; exit 1; }
  "${PSQL[@]}" -c "select gen.snap('$(basename "$f")')" >/dev/null
done

COUNT="$("${PSQL[@]}" -At -c "select count(*) from gen.obj where file <> 'stub'")"
FILES="$(ls "$ROOT"/supabase/sql/[0-9][0-9]_*.sql | wc -l | tr -d ' ')"
LAST="$(basename "$(ls "$ROOT"/supabase/sql/[0-9][0-9]_*.sql | tail -1)")"

{
cat <<SQL
-- =============================================================================
-- All In: is the database up to date?
-- Run this by hand in the Supabase SQL Editor. It only reads; it changes nothing.
--
-- It compares the database with what the $FILES numbered files (01 to $LAST) create:
-- every table, column, row level security switch, policy, trigger, function (and whether its
-- body is the newest one), realtime table, game, stake level, achievement and cosmetic.
--
-- The answer is one table:
--   OK           everything matches
--   MISSING      something a file creates is not there: re-run the file named in "fix"
--   OUT OF DATE  it is there but is an older version: re-run the file named in "fix"
--   NOTE         something extra that no numbered file creates (often fine: see the text)
--
-- When several files are named, re-run them in number order.
--
-- GENERATED by scripts/gen-db-check.sh: do not edit by hand. $COUNT things are checked.
-- =============================================================================

drop table if exists pg_temp.db_expected;
create temp table db_expected (kind text, name text, extra text, file text);
insert into db_expected (kind, name, extra, file) values
SQL
"${PSQL[@]}" -At -c "select string_agg(format('(%L, %L, %L, %L)', kind, name, extra, file), E',\n' order by file, kind, name) || ';'
                       from gen.obj where file <> 'stub'"
cat <<SQL

drop table if exists pg_temp.db_actual;
create temp table db_actual as
$ACTUAL
union all
$ROWS;

with problems as (
  -- Not there at all. (A missing table's columns and policies are not listed one by one.)
  select 1 as ord, 'MISSING' as status, e.kind, e.name, 'Re-run ' || e.file as fix
    from db_expected e
   where not exists (select 1 from db_actual a where a.kind = e.kind and a.name = e.name)
     and not (e.kind = 'column' and not exists
              (select 1 from db_actual t where t.kind = 'table' and t.name = split_part(e.name, '.', 1)))
     and not (e.kind = 'policy' and not exists
              (select 1 from db_actual t where t.kind = 'table' and t.name = split_part(e.name, ': ', 1)))
  union all
  -- There, but not the newest version.
  select 2, 'OUT OF DATE', e.kind, e.name,
         'Re-run ' || e.file || case e.kind
           when 'function' then ' (the function is an older version)'
           when 'table' then ' (expected ' || e.extra || ', found ' || a.extra || ')'
           else ' (expected ' || e.extra || ', found ' || a.extra || ')' end
    from db_expected e join db_actual a on a.kind = e.kind and a.name = e.name
   where a.extra is distinct from e.extra
  union all
  -- There, but no numbered file creates it.
  select 3, 'NOTE', a.kind, a.name,
         case
           when a.kind = 'table' and a.name = 'season_gifts'
             then 'From maintenance/season_bonus_2026_10.sql. Expected.'
           when a.kind = 'table' and a.extra = 'rls off'
             then 'No numbered file creates this table, and row level security is OFF on it. Look at it.'
           when a.kind = 'table' then 'No numbered file creates this table. Fine if you made it on purpose.'
           when a.kind = 'realtime' then 'In realtime, but no numbered file puts it there.'
           when a.kind = 'function' and a.name like 'private.season_gift%'
             then 'From maintenance/season_bonus_2026_10.sql. Expected.'
           else 'No numbered file creates this function: a maintenance script made it, or it is left over from an older version. Harmless.'
         end
    from db_actual a
   where a.kind in ('table', 'function', 'realtime')
     and not exists (select 1 from db_expected e where e.kind = a.kind and e.name = a.name)
),
summary as (
  select 0 as ord,
         case when exists (select 1 from problems where ord < 3) then 'NOT UP TO DATE' else 'OK' end as status,
         'summary' as kind,
         (select count(*) from db_expected)::text || ' things checked' as name,
         case when exists (select 1 from problems where ord < 3)
              then 'Re-run, in number order: ' || (select string_agg(distinct substr(fix, 8, 2), ', ' order by substr(fix, 8, 2))
                                                     from problems where ord < 3)
              else 'Everything the numbered files create is here and current.' end as fix
)
select status, kind, name, fix
  from (select * from summary union all select * from problems) r
 order by ord, fix, kind, name;
SQL
} > "$OUT"

echo "wrote $OUT ($COUNT things from $FILES files)"
