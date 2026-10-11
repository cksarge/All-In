-- Test-only helpers for the local end-to-end database (NEVER run on Supabase).
-- Lets a test stack the next poker deck and queue craps dice.
create schema if not exists tests;

-- Poker: 'As' -> 0, 'Kh' -> 25 (rank = c % 13 with A = 0, suit = c / 13 in s h d c order).
create or replace function tests.k(c text) returns smallint language sql immutable as $$
  select ((position(right(c, 1) in 'shdc') - 1) * 13 + position(left(c, length(c) - 1) in 'A23456789TJQK') - 1)::smallint
$$;
create or replace function tests.cards(p text) returns smallint[] language sql immutable as $$
  select array_agg(tests.k(x) order by o) from unnest(string_to_array(p, ' ')) with ordinality u(x, o)
$$;
create table if not exists tests.decks (id serial primary key, cards smallint[]);
-- select tests.deck('As Ah Kc Kd ...'): the next poker hand deals these cards first.
create or replace function tests.deck(p text) returns void language plpgsql security definer as $$
declare v smallint[] := tests.cards(p);
begin
  v := v || array(select g::smallint from generate_series(0, 51) g where not (g::smallint = any (v)) order by g);
  insert into tests.decks (cards) values (v);
end $$;
create or replace function private.shuffled_shoe(p_decks integer) returns smallint[] language plpgsql volatile set search_path = '' as $$
declare
  r record;
  v smallint[];
  n integer;
  j integer;
  t smallint;
begin
  if p_decks = 1 then
    select id, cards into r from tests.decks order by id limit 1;
    if found then
      delete from tests.decks where id = r.id;
      return r.cards;
    end if;
  end if;
  select array_agg((g % 52)::smallint) into v from generate_series(0, p_decks * 52 - 1) g;
  n := cardinality(v);
  for i in reverse n..2 loop
    j := private.random_int(i) + 1;
    t := v[i]; v[i] := v[j]; v[j] := t;
  end loop;
  return v;
end $$;

-- Craps: insert into tests.dice (v) values (2), (3) -> the next roll is 3 + 4.
create table if not exists tests.dice (id serial primary key, v integer);
create or replace function private.random_int(p_n integer) returns integer language plpgsql volatile set search_path = '' as $$
declare r record;
begin
  select id, v into r from tests.dice order by id limit 1;
  if found then delete from tests.dice where id = r.id; return r.v; end if;
  return floor(random() * p_n)::int;
end $$;
