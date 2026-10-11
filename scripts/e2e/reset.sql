-- Fresh test players (any password works with mini-supabase), no poker hand history, jackpot at its seed.
delete from public.pk_hands;
delete from auth.users where email like '%@allin.test';
insert into auth.users (email, raw_user_meta_data) values
  ('ann@allin.test', '{"username":"Ann"}'),
  ('ben@allin.test', '{"username":"Ben"}'),
  ('cat@allin.test', '{"username":"Cat"}');
update public.profiles set onboarded_at = now();
update public.jackpots set pool_hundredths = seed * 100, last_winner = null, last_amount = null, last_won_at = null;
delete from tests.dice;
