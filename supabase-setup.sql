-- FAJT Hours — Supabase setup.
--
-- Run this ONCE, in the Supabase dashboard:
--   Left sidebar -> SQL Editor -> New query -> paste all of this -> Run.
--
-- What it builds:
--   * one table holding one row per passcode
--   * two functions the app is allowed to call
--   * a lock (row-level security) that blocks everything else
--
-- The important design point: the anonymous key shipped in the app CANNOT read
-- the table directly. It can only call fajt_load / fajt_save, and both demand
-- the exact room ID. There is no way to list rows or discover other people's
-- IDs, so the only way in is knowing the passcode.

-- ---------------------------------------------------------------- the table

create table if not exists public.app_state (
  id          text primary key,
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

alter table public.app_state enable row level security;

-- No policies are created on purpose. With RLS on and no policy, direct table
-- access through the API is denied for everyone. The functions below run as
-- their owner (security definer) and are the only way in.

revoke all on public.app_state from anon, authenticated;

-- ------------------------------------------------------------- read function

create or replace function public.fajt_load(room_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if room_id is null or length(room_id) < 16 then
    raise exception 'invalid room id';
  end if;

  select data into result from public.app_state where id = room_id;
  return result;  -- null when this passcode has never been used before
end;
$$;

-- ------------------------------------------------------------ write function

create or replace function public.fajt_save(room_id text, payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if room_id is null or length(room_id) < 16 then
    raise exception 'invalid room id';
  end if;

  -- Sanity guard so a bug or a bad actor cannot balloon your storage.
  if pg_column_size(payload) > 2000000 then
    raise exception 'payload too large';
  end if;

  insert into public.app_state (id, data, updated_at)
  values (room_id, payload, now())
  on conflict (id) do update
    set data = excluded.data,
        updated_at = now();
end;
$$;

-- ------------------------------------------------------------- permissions

revoke all on function public.fajt_load(text) from public;
revoke all on function public.fajt_save(text, jsonb) from public;

grant execute on function public.fajt_load(text) to anon, authenticated;
grant execute on function public.fajt_save(text, jsonb) to anon, authenticated;
