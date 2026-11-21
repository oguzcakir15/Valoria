-- VALORIA MILESTONE 1. Run once against a dedicated test Supabase project.
-- Security: browser clients have SELECT access only to their room; mutations use validated RPCs.
-- Anonymous Auth provider MUST be enabled in Supabase Auth settings.

create table if not exists public.valoria_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9A-F]{10}$'),
  host_id uuid not null references auth.users(id),
  phase text not null default 'lobby' check (phase in ('lobby','in_game','results')),
  game_days integer not null check (game_days in (10,15,30)),
  created_at timestamptz not null default now()
);
create table if not exists public.valoria_members (
  room_id uuid not null references public.valoria_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  nickname text not null check (char_length(nickname) between 2 and 24),
  joined_at timestamptz not null default now(),
  primary key(room_id,user_id)
);
create unique index if not exists valoria_nickname_room_unique
  on public.valoria_members(room_id,lower(nickname));
create table if not exists public.valoria_messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.valoria_rooms(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  body text not null check (char_length(body) between 1 and 500),
  client_nonce uuid not null,
  created_at timestamptz not null default now(),
  unique(sender_id,client_nonce)
);
create index if not exists valoria_messages_history on public.valoria_messages(room_id,id desc);

alter table public.valoria_rooms enable row level security;
alter table public.valoria_members enable row level security;
alter table public.valoria_messages enable row level security;

-- Avoid recursive membership RLS policies; function runs as a trusted definer and exposes only boolean.
create or replace function public.valoria_is_member(p_room uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.valoria_members m
    where m.room_id = p_room and m.user_id = auth.uid()
  );
$$;
revoke all on function public.valoria_is_member(uuid) from public, anon;
grant execute on function public.valoria_is_member(uuid) to authenticated;

create policy "valoria room visible only to members" on public.valoria_rooms
  for select to authenticated using (public.valoria_is_member(id));
create policy "valoria member list only visible to members" on public.valoria_members
  for select to authenticated using (public.valoria_is_member(room_id));
create policy "valoria chat history only visible to members" on public.valoria_messages
  for select to authenticated using (public.valoria_is_member(room_id));

revoke all on public.valoria_rooms, public.valoria_members, public.valoria_messages from anon, authenticated;
grant select on public.valoria_rooms, public.valoria_members, public.valoria_messages to authenticated;

-- Create a room with one privileged, atomic transaction. 40-bit random code, collision-safe retry.
create or replace function public.valoria_create_room(p_nickname text, p_days integer default 10)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_room uuid; v_code text; v_attempt int;
begin
  if auth.uid() is null then raise exception 'Sign in as a guest first'; end if;
  p_nickname := btrim(p_nickname);
  if char_length(p_nickname) < 2 or char_length(p_nickname) > 24 or
     p_nickname !~ '^[[:alnum:]_ .''-]+$' then
    raise exception 'Nickname must be 2–24 letters, numbers, or simple punctuation';
  end if;
  if p_days not in (10,15,30) then raise exception 'Invalid match length'; end if;
  for v_attempt in 1..8 loop
    v_code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 10));
    begin
      insert into public.valoria_rooms(code,host_id,game_days)
      values(v_code,auth.uid(),p_days) returning id into v_room;
      exit;
    exception when unique_violation then
      if v_attempt = 8 then raise exception 'Could not generate a room code. Try again'; end if;
    end;
  end loop;
  insert into public.valoria_members(room_id,user_id,nickname)
  values(v_room,auth.uid(),p_nickname);
  return v_room;
end;
$$;

-- Join room with exclusive lock to enforce room capacity against concurrent joins.
create or replace function public.valoria_join_room(p_code text,p_nickname text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_room public.valoria_rooms%rowtype; v_existing text;
begin
  if auth.uid() is null then raise exception 'Sign in as a guest first'; end if;
  p_code := upper(btrim(p_code));
  p_nickname := btrim(p_nickname);
  if char_length(p_code) <> 10 or p_code !~ '^[0-9A-F]{10}$' then
    raise exception 'Invalid room code';
  end if;
  if char_length(p_nickname) < 2 or char_length(p_nickname) > 24 or
     p_nickname !~ '^[[:alnum:]_ .''-]+$' then
    raise exception 'Nickname must be 2–24 letters, numbers, or simple punctuation';
  end if;
  select * into v_room from public.valoria_rooms where code=p_code for update;
  if not found then raise exception 'Room not found'; end if;
  select nickname into v_existing from public.valoria_members
    where room_id=v_room.id and user_id=auth.uid();
  if found then return v_room.id; end if; -- safe reconnection with original name
  if v_room.phase <> 'lobby' then raise exception 'This match has already started'; end if;
  if (select count(*) from public.valoria_members where room_id=v_room.id)>=4 then
    raise exception 'The room is full';
  end if;
  if exists(select 1 from public.valoria_members where room_id=v_room.id and lower(nickname)=lower(p_nickname)) then
    raise exception 'Nickname already used in this room';
  end if;
  insert into public.valoria_members(room_id,user_id,nickname)
    values(v_room.id,auth.uid(),p_nickname);
  return v_room.id;
end;
$$;

-- Joining/reading a room never requires public disclosure of codes.
create or replace function public.valoria_start_room(p_room uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_room public.valoria_rooms%rowtype;
begin
  select * into v_room from public.valoria_rooms where id=p_room for update;
  if not found or v_room.host_id <> auth.uid() then raise exception 'Only the host may start'; end if;
  if v_room.phase <> 'lobby' then raise exception 'This room has already started'; end if;
  if (select count(*) from public.valoria_members where room_id=p_room) < 2 then
    raise exception 'At least two players are required';
  end if;
  update public.valoria_rooms set phase='in_game' where id=p_room;
end;
$$;

-- Leaving is permitted in the lobby only. Transfer host to next seated player.
create or replace function public.valoria_leave_room(p_room uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_room public.valoria_rooms%rowtype; v_next uuid;
begin
  select * into v_room from public.valoria_rooms where id=p_room for update;
  if not found or not public.valoria_is_member(p_room) then raise exception 'Not a room member'; end if;
  if v_room.phase <> 'lobby' then raise exception 'Cannot leave an active game; reconnect instead'; end if;
  if v_room.host_id = auth.uid() then
    select user_id into v_next from public.valoria_members
      where room_id=p_room and user_id <> auth.uid() order by joined_at,user_id limit 1;
    if v_next is null then
      delete from public.valoria_rooms where id=p_room;
      return;
    end if;
    update public.valoria_rooms set host_id=v_next where id=p_room;
  end if;
  delete from public.valoria_members where room_id=p_room and user_id=auth.uid();
end;
$$;

-- All chat inserts go through this controlled RPC. Serializes same-user sends, rate-limits,
-- validates room membership, message length, and makes retries idempotent.
create or replace function public.valoria_send_message(p_room uuid,p_body text,p_nonce uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_body text; v_count int;
begin
  if auth.uid() is null or not public.valoria_is_member(p_room) then
    raise exception 'Not authorised for this room';
  end if;
  if p_nonce is null then raise exception 'Missing message id'; end if;
  v_body := btrim(p_body);
  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    raise exception 'Message must contain 1–500 characters';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,72026));
  select id into v_id from public.valoria_messages where sender_id=auth.uid() and client_nonce=p_nonce;
  if found then return v_id; end if;
  select count(*) into v_count from public.valoria_messages
    where sender_id=auth.uid() and created_at > now()-interval '10 seconds';
  if v_count >= 5 then raise exception 'Too many messages. Try again shortly'; end if;
  insert into public.valoria_messages(room_id,sender_id,body,client_nonce)
    values(p_room,auth.uid(),v_body,p_nonce) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.valoria_create_room(text,integer), public.valoria_join_room(text,text),
  public.valoria_start_room(uuid),public.valoria_leave_room(uuid),
  public.valoria_send_message(uuid,text,uuid) from public,anon;
grant execute on function public.valoria_create_room(text,integer),public.valoria_join_room(text,text),
  public.valoria_start_room(uuid),public.valoria_leave_room(uuid),
  public.valoria_send_message(uuid,text,uuid) to authenticated;

-- Authorise ONLY room members to subscribe to private Realtime channels.
-- The client reads Postgres Changes; it never trusts arbitrary client broadcasts.
create or replace function public.valoria_can_subscribe(p_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_id text;
begin
  if p_topic !~ '^valoria-room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_id := substring(p_topic from 14);
  return public.valoria_is_member(v_id::uuid);
end;
$$;
revoke all on function public.valoria_can_subscribe(text) from public,anon;
grant execute on function public.valoria_can_subscribe(text) to authenticated;
create policy "valoria members subscribe to their room channels" on realtime.messages
  for select to authenticated using (public.valoria_can_subscribe(realtime.topic()));

-- Enable realtime DB change publication (if not already added by an earlier setup).
do $$ begin
  alter publication supabase_realtime add table public.valoria_rooms,public.valoria_members,public.valoria_messages;
exception when duplicate_object then null;
end $$;
