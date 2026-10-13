-- =============================================================================
-- All In: EMERGENCY. Switches two-step verification off for one account.
-- Paste into the Supabase SQL Editor, put the username in, and run.
--
-- Use this if you (the admin) switched two-step verification on and can no
-- longer get the emailed codes, so you can't reach /admin. For any other
-- player, use the button on their page in /admin instead.
-- =============================================================================
update public.player_security
   set two_step = false, two_step_at = null, updated_at = now()
 where user_id = (select id from public.profiles where lower(username) = lower('Carter'));
