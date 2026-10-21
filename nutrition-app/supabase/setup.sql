-- Nutri cloud accounts: run once in Supabase → SQL Editor → New query → Run.
-- Safe to run again (everything is "if not exists" / "or replace").
--
-- What it creates:
--   * nutri_state  — one row per user holding their whole app state (JSON).
--   * bucket nutri — private files: <user id>/profile/avatar.jpg and
--                    <user id>/photos/<photo id>.jpg (only with photo backup on).
--   * delete_my_account() — lets a signed-in user erase their own account.
-- Row-level security means a user can only ever touch their own row and folder;
-- the public anon key in the app grants nothing by itself.

create table if not exists public.nutri_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.nutri_state enable row level security;

drop policy if exists "nutri_state own select" on public.nutri_state;
drop policy if exists "nutri_state own insert" on public.nutri_state;
drop policy if exists "nutri_state own update" on public.nutri_state;
drop policy if exists "nutri_state own delete" on public.nutri_state;
create policy "nutri_state own select" on public.nutri_state for select to authenticated using (user_id = (select auth.uid()));
create policy "nutri_state own insert" on public.nutri_state for insert to authenticated with check (user_id = (select auth.uid()));
create policy "nutri_state own update" on public.nutri_state for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "nutri_state own delete" on public.nutri_state for delete to authenticated using (user_id = (select auth.uid()));

-- Private bucket, images only, 5 MB per file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nutri', 'nutri', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "nutri files own select" on storage.objects;
drop policy if exists "nutri files own insert" on storage.objects;
drop policy if exists "nutri files own update" on storage.objects;
drop policy if exists "nutri files own delete" on storage.objects;
create policy "nutri files own select" on storage.objects for select to authenticated
  using (bucket_id = 'nutri' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "nutri files own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'nutri' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "nutri files own update" on storage.objects for update to authenticated
  using (bucket_id = 'nutri' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'nutri' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "nutri files own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'nutri' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- "Delete all my data" in the app: the app deletes the files first, then calls
-- this, which removes the account (and with it the nutri_state row).
create or replace function public.delete_my_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = (select auth.uid());
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- Friends (v1.17): public profiles, friend requests.
-- Re-run this file to add them; everything is "if not exists" / "or replace".
-- ---------------------------------------------------------------------------

-- A public profile: only what other people are meant to see. The username is
-- the handle people search for and put in invite links. wins / losses count
-- finished challenges and can be changed only by the server, never by the app.
create table if not exists public.nutri_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null default '' check (char_length(display_name) <= 40),
  wins integer not null default 0,
  losses integer not null default 0,
  created_at timestamptz not null default now()
);

-- The emblem (1-6, 0 = none) shown above the picture. Each phone reports its own, like the challenge days.
alter table public.nutri_profiles add column if not exists level smallint not null default 0;
alter table public.nutri_profiles drop constraint if exists nutri_profiles_level_check;
alter table public.nutri_profiles add constraint nutri_profiles_level_check check (level between 0 and 20);

alter table public.nutri_profiles enable row level security;
drop policy if exists "nutri_profiles read" on public.nutri_profiles;
drop policy if exists "nutri_profiles own insert" on public.nutri_profiles;
drop policy if exists "nutri_profiles own update" on public.nutri_profiles;
drop policy if exists "nutri_profiles own delete" on public.nutri_profiles;
create policy "nutri_profiles read" on public.nutri_profiles for select to authenticated using (true);
create policy "nutri_profiles own insert" on public.nutri_profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy "nutri_profiles own update" on public.nutri_profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "nutri_profiles own delete" on public.nutri_profiles for delete to authenticated using (user_id = (select auth.uid()));
-- The app may write the handle and the name — not the score.
revoke insert, update on public.nutri_profiles from authenticated;
grant insert (user_id, username, display_name) on public.nutri_profiles to authenticated;
grant update (username, display_name, level) on public.nutri_profiles to authenticated;

-- A friend request from one user to another. accepted = they are friends.
create table if not exists public.nutri_friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (from_user, to_user),
  check (from_user <> to_user)
);
create index if not exists nutri_friend_requests_to on public.nutri_friend_requests (to_user, status);

alter table public.nutri_friend_requests enable row level security;
drop policy if exists "nutri_requests parties select" on public.nutri_friend_requests;
drop policy if exists "nutri_requests sender insert" on public.nutri_friend_requests;
drop policy if exists "nutri_requests recipient update" on public.nutri_friend_requests;
drop policy if exists "nutri_requests parties delete" on public.nutri_friend_requests;
create policy "nutri_requests parties select" on public.nutri_friend_requests for select to authenticated
  using (from_user = (select auth.uid()) or to_user = (select auth.uid()));
create policy "nutri_requests sender insert" on public.nutri_friend_requests for insert to authenticated
  with check (from_user = (select auth.uid()) and status = 'pending');
create policy "nutri_requests recipient update" on public.nutri_friend_requests for update to authenticated
  using (to_user = (select auth.uid())) with check (to_user = (select auth.uid()));
create policy "nutri_requests parties delete" on public.nutri_friend_requests for delete to authenticated
  using (from_user = (select auth.uid()) or to_user = (select auth.uid()));
revoke insert, update on public.nutri_friend_requests from authenticated;
grant insert (from_user, to_user) on public.nutri_friend_requests to authenticated;
grant update (status, updated_at) on public.nutri_friend_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Challenges (v1.18): two friends, a period, and a number of misses allowed.
-- A "miss" is a planned meal that was not marked as eaten before its day ended.
--   * Whoever goes over the allowed misses first loses at once.
--   * If nobody does, whoever missed more when the period ends loses (equal = draw).
--   * A day nobody reported counts as missed — someone who stops using the app loses.
-- Each phone reports its own days (planned / logged meals); like any score kept
-- by the players' own devices, it relies on honesty between friends. The app
-- cannot write the tables or the scores: everything goes through the functions
-- below, which check who is asking.
-- ---------------------------------------------------------------------------

create table if not exists public.nutri_challenges (
  id uuid primary key default gen_random_uuid(),
  creator uuid not null references auth.users (id) on delete cascade,
  opponent uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'active', 'declined', 'cancelled', 'finished')),
  days integer not null check (days between 3 and 30),
  max_misses integer not null check (max_misses between 0 and 30),
  start_date date,
  end_date date,
  loser uuid references auth.users (id) on delete set null,
  result text check (result in ('loss', 'draw')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  check (creator <> opponent)
);

-- The day (as the settling phone saw it) the counting stopped at, so every screen shows the same scoreboard.
alter table public.nutri_challenges add column if not exists final_day date;
create index if not exists nutri_challenges_creator on public.nutri_challenges (creator, status);
create index if not exists nutri_challenges_opponent on public.nutri_challenges (opponent, status);

create table if not exists public.nutri_challenge_days (
  challenge_id uuid not null references public.nutri_challenges (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  planned integer not null check (planned between 3 and 6),
  logged integer not null check (logged between 0 and 6),
  updated_at timestamptz not null default now(),
  primary key (challenge_id, user_id, day)
);

alter table public.nutri_challenges enable row level security;
alter table public.nutri_challenge_days enable row level security;
drop policy if exists "nutri_challenges parties select" on public.nutri_challenges;
drop policy if exists "nutri_challenge_days parties select" on public.nutri_challenge_days;
create policy "nutri_challenges parties select" on public.nutri_challenges for select to authenticated
  using ((select auth.uid()) in (creator, opponent));
create policy "nutri_challenge_days parties select" on public.nutri_challenge_days for select to authenticated
  using (exists (select 1 from public.nutri_challenges c where c.id = challenge_id and (select auth.uid()) in (c.creator, c.opponent)));
revoke all on public.nutri_challenges, public.nutri_challenge_days from anon, authenticated;
grant select on public.nutri_challenges, public.nutri_challenge_days to authenticated;

-- Dates come from the phones (their local day); the server only accepts days
-- within one day of its own, so a clock cannot be wound far.
create or replace function public.nutri_check_today(p_today date)
returns void language plpgsql set search_path = '' as $$
begin
  if p_today is null or abs(p_today - current_date) > 1 then
    raise exception 'bad_date' using errcode = '22007';
  end if;
end $$;

-- Misses of one player from day p_from to p_to: planned minus logged on the
-- days reported, and a whole day (their usual number of meals, at least 3) for
-- a day not reported.
create or replace function public.nutri_misses(p_challenge uuid, p_user uuid, p_from date, p_to date)
returns integer language sql stable set search_path = '' as $$
  select coalesce(sum(case when d.day is null then f.fallback else greatest(d.planned - d.logged, 0) end), 0)::integer
  from generate_series(p_from, p_to, interval '1 day') as g(day)
  left join public.nutri_challenge_days d
    on d.challenge_id = p_challenge and d.user_id = p_user and d.day = g.day::date
  cross join (
    select coalesce(max(x.planned), 3) as fallback
    from public.nutri_challenge_days x where x.challenge_id = p_challenge and x.user_id = p_user
  ) f
$$;

-- Ends a challenge: who lost (null = a draw), and the scores on the profiles.
create or replace function public.nutri_finish(p_id uuid, p_loser uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.nutri_challenges;
begin
  select * into c from public.nutri_challenges where id = p_id for update;
  if not found or c.status <> 'active' then return; end if;
  update public.nutri_challenges
     set status = 'finished', loser = p_loser, result = case when p_loser is null then 'draw' else 'loss' end,
         finished_at = now(), updated_at = now()
   where id = p_id;
  if p_loser is not null then
    update public.nutri_profiles set losses = losses + 1 where user_id = p_loser;
    update public.nutri_profiles set wins = wins + 1 where user_id = (case when p_loser = c.creator then c.opponent else c.creator end);
  end if;
end $$;

-- Looks at the days reported so far and ends the challenge if it is decided.
create or replace function public.nutri_evaluate(p_id uuid, p_today date)
returns text language plpgsql security definer set search_path = '' as $$
declare
  c public.nutri_challenges;
  mc integer; mo integer; closed_end date; over boolean;
begin
  select * into c from public.nutri_challenges where id = p_id for update;
  if not found then return 'none'; end if;
  if c.status <> 'active' then return c.status; end if;
  -- A day is counted only once the day after it has begun: the other player may be
  -- hours behind (a time zone, a phone that was offline) and can still report yesterday.
  closed_end := least(c.end_date, p_today - 2);
  mc := public.nutri_misses(c.id, c.creator, c.start_date, closed_end);
  mo := public.nutri_misses(c.id, c.opponent, c.start_date, closed_end);
  over := mc > c.max_misses or mo > c.max_misses or p_today > c.end_date + 1;
  if not over then return 'active'; end if;
  update public.nutri_challenges set final_day = p_today where id = c.id;
  perform public.nutri_finish(c.id, case when mc > mo then c.creator when mo > mc then c.opponent else null end);
  return 'finished';
end $$;

-- A friend challenges a friend. Returns the new challenge's id.
create or replace function public.create_challenge(p_opponent uuid, p_days integer, p_max_misses integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); cid uuid;
begin
  if me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if p_opponent is null or p_opponent = me then raise exception 'bad_opponent' using errcode = '22023'; end if;
  if p_days is null or p_days < 3 or p_days > 30 or p_max_misses is null or p_max_misses < 0 or p_max_misses > 30 then
    raise exception 'bad_rules' using errcode = '22023';
  end if;
  if not exists (select 1 from public.nutri_friend_requests r where r.status = 'accepted'
                 and ((r.from_user = me and r.to_user = p_opponent) or (r.from_user = p_opponent and r.to_user = me))) then
    raise exception 'not_friends' using errcode = '42501';
  end if;
  if not exists (select 1 from public.nutri_profiles where user_id = me)
     or not exists (select 1 from public.nutri_profiles where user_id = p_opponent) then
    raise exception 'no_profile' using errcode = '42501';
  end if;
  if exists (select 1 from public.nutri_challenges c where c.status in ('pending', 'active')
             and ((c.creator = me and c.opponent = p_opponent) or (c.creator = p_opponent and c.opponent = me))) then
    raise exception 'already_challenged' using errcode = '23505';
  end if;
  if (select count(*) from public.nutri_challenges c where c.status in ('pending', 'active') and me in (c.creator, c.opponent)) >= 5 then
    raise exception 'too_many' using errcode = '54000';
  end if;
  insert into public.nutri_challenges (creator, opponent, days, max_misses) values (me, p_opponent, p_days, p_max_misses)
    returning id into cid;
  return cid;
end $$;

-- The challenged friend says yes (it starts tomorrow, their date) or no.
create or replace function public.respond_challenge(p_id uuid, p_accept boolean, p_today date)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.nutri_challenges;
begin
  perform public.nutri_check_today(p_today);
  select * into c from public.nutri_challenges where id = p_id for update;
  if not found or c.opponent <> me or c.status <> 'pending' then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_accept then
    update public.nutri_challenges
       set status = 'active', start_date = p_today + 1, end_date = p_today + c.days, updated_at = now()
     where id = p_id;
    return 'active';
  end if;
  update public.nutri_challenges set status = 'declined', updated_at = now() where id = p_id;
  return 'declined';
end $$;

-- The one who asked takes the challenge back before it was answered.
create or replace function public.cancel_challenge(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  update public.nutri_challenges set status = 'cancelled', updated_at = now()
   where id = p_id and creator = me and status = 'pending';
  if not found then raise exception 'not_allowed' using errcode = '42501'; end if;
end $$;

-- Giving up: counts as a loss.
create or replace function public.forfeit_challenge(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.nutri_challenges;
begin
  select * into c from public.nutri_challenges where id = p_id;
  if not found or c.status <> 'active' or me not in (c.creator, c.opponent) then raise exception 'not_allowed' using errcode = '42501'; end if;
  perform public.nutri_finish(p_id, me);
end $$;

-- A phone reports one of its days: meals planned and meals marked as eaten.
-- Only today and yesterday can still be changed.
create or replace function public.report_challenge_day(p_id uuid, p_day date, p_planned integer, p_logged integer, p_today date)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.nutri_challenges;
begin
  perform public.nutri_check_today(p_today);
  select * into c from public.nutri_challenges where id = p_id;
  if not found or c.status <> 'active' or me not in (c.creator, c.opponent) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_day < c.start_date or p_day > c.end_date or p_day > p_today or p_day < p_today - 1 then
    return public.nutri_evaluate(p_id, p_today);
  end if;
  insert into public.nutri_challenge_days (challenge_id, user_id, day, planned, logged)
  values (p_id, me, p_day, p_planned, least(p_logged, p_planned))
  on conflict (challenge_id, user_id, day)
  do update set planned = excluded.planned, logged = excluded.logged, updated_at = now();
  return public.nutri_evaluate(p_id, p_today);
end $$;

-- Anyone in the challenge can ask it to check itself (e.g. after the period ended).
create or replace function public.evaluate_challenge(p_id uuid, p_today date)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.nutri_challenges;
begin
  perform public.nutri_check_today(p_today);
  select * into c from public.nutri_challenges where id = p_id;
  if not found or me not in (c.creator, c.opponent) then raise exception 'not_allowed' using errcode = '42501'; end if;
  return public.nutri_evaluate(p_id, p_today);
end $$;

revoke all on function public.nutri_check_today(date) from public, anon, authenticated;
revoke all on function public.nutri_misses(uuid, uuid, date, date) from public, anon, authenticated;
revoke all on function public.nutri_finish(uuid, uuid) from public, anon, authenticated;
revoke all on function public.nutri_evaluate(uuid, date) from public, anon, authenticated;
revoke all on function public.create_challenge(uuid, integer, integer) from public, anon;
revoke all on function public.respond_challenge(uuid, boolean, date) from public, anon;
revoke all on function public.cancel_challenge(uuid) from public, anon;
revoke all on function public.forfeit_challenge(uuid) from public, anon;
revoke all on function public.report_challenge_day(uuid, date, integer, integer, date) from public, anon;
revoke all on function public.evaluate_challenge(uuid, date) from public, anon;
grant execute on function public.create_challenge(uuid, integer, integer) to authenticated;
grant execute on function public.respond_challenge(uuid, boolean, date) to authenticated;
grant execute on function public.cancel_challenge(uuid) to authenticated;
grant execute on function public.forfeit_challenge(uuid) to authenticated;
grant execute on function public.report_challenge_day(uuid, date, integer, integer, date) to authenticated;
grant execute on function public.evaluate_challenge(uuid, date) to authenticated;

-- Make the API see the new tables right away (otherwise it can take a while).
notify pgrst, 'reload schema';
