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
