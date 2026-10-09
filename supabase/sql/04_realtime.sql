-- =============================================================================
-- All In · 04_realtime.sql
-- Adds tables that need live updates to the `supabase_realtime` publication.
-- Realtime respects RLS: each player only receives changes to rows they can
-- SELECT (their own wallet and ledger rows).
--
-- Later phases append more tables here (tables, seats, rounds, ...).
-- Safe to re-run.
-- =============================================================================

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array array['wallets', 'chip_ledger']
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
