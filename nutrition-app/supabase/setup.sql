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
grant update (username, display_name) on public.nutri_profiles to authenticated;

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
