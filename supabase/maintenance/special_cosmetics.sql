-- Two one-of-a-kind cosmetics. With no unlock level and no achievement behind them,
-- nobody can earn them: only a row in player_cosmetics (added here) gives them out.
insert into public.cosmetics (key, kind, name, unlock_level, sort_order) values
  ('title_developer',  'title',  'Developer',          null, 1),
  ('avatar_developer', 'avatar', 'Developer''s Crown', null, 1)
on conflict (key) do update set name = excluded.name, sort_order = excluded.sort_order;

-- The level-15 avatar used to be a crown too. It is now a trophy, so the crown is yours alone.
update public.cosmetics set name = 'Champion' where key = 'avatar_crown';

-- Give Carter every cosmetic, including the two above (safe to run more than once).
-- Run it again after a file adds cosmetics: the reputation ones from 22_reputation_chat.sql are
-- otherwise held only while the reputation is high enough, and this row keeps them for good.
insert into public.player_cosmetics (user_id, cosmetic_key)
select p.id, c.key
  from public.profiles p
 cross join public.cosmetics c
 where lower(p.username) = 'carter'
on conflict do nothing;

-- Make sure nobody else has the two developer items.
delete from public.player_cosmetics pc
 using public.profiles p
 where p.id = pc.user_id and lower(p.username) <> 'carter'
   and pc.cosmetic_key in ('title_developer', 'avatar_developer');
