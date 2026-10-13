-- =============================================================================
-- All In: EMERGENCY. Turns Site Maintenance off.
-- Paste into the Supabase SQL Editor and run. Safe to run at any time.
--
-- Use this if maintenance is on and you can't get to /admin to switch it off
-- (for example you were logged out, and nobody can log in during maintenance).
-- =============================================================================
update public.site_status
   set maintenance = false, message = null, updated_at = now()
 where id;

-- A scheduled closure that is under way ends now too (the table exists once 15_moderation.sql is current).
do $$
begin
  if to_regclass('public.site_schedule') is not null then
    execute 'update public.site_schedule set ends_at = now()
              where kind = ''maintenance'' and cancelled_at is null and starts_at <= now() and (ends_at is null or ends_at > now())';
  end if;
end $$;

select case when maintenance then 'STILL ON: something is wrong' else 'Maintenance is OFF. The site is open.' end as result,
       updated_at
  from public.site_status;
