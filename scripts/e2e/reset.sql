-- Fresh test players (any password works with mini-supabase) and no poker hand history.
delete from public.pk_hands;
delete from auth.users where email like '%@allin.test';
insert into auth.users (email, raw_user_meta_data) values
  ('ann@allin.test', '{"username":"Ann"}'),
  ('ben@allin.test', '{"username":"Ben"}'),
  ('cat@allin.test', '{"username":"Cat"}');
update public.profiles set onboarded_at = now();
