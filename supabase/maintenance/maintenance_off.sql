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

select case when maintenance then 'STILL ON: something is wrong' else 'Maintenance is OFF. The site is open.' end as result,
       updated_at
  from public.site_status;
