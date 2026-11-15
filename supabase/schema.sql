-- Quorum shared crew data: accounts, roles, privacy and an audit trail.
-- Apply to a Supabase project (SQL editor or migration). Every rule here is enforced by the
-- database (row-level security), so it holds no matter what a client sends.

create table if not exists public.quorum_crews (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  join_code text not null unique,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.quorum_members (
  crew_id uuid not null references public.quorum_crews (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  role text not null check (role in ('commander', 'medical_officer', 'crew')),
  -- What this person lets crewmates see. Mood is private unless they turn it on.
  share jsonb not null default '{"vitals":true,"sleep":true,"mood":false,"symptoms":true}'::jsonb
    check (jsonb_typeof(share) = 'object' and pg_column_size(share) < 400),
  joined_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);
create index if not exists quorum_members_user on public.quorum_members (user_id);

create table if not exists public.quorum_records (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.quorum_crews (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('checkin', 'lab_draw', 'roster', 'event', 'med')),
  category text not null check (category in ('vitals', 'sleep', 'mood', 'symptoms', 'shared')),
  client_id text not null check (char_length(client_id) between 1 and 120),
  payload jsonb not null check (pg_column_size(payload) < 20000),
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (crew_id, kind, client_id),
  -- A check-in belongs to a privacy category; everything else is crew-wide.
  check ((kind = 'checkin') = (category <> 'shared'))
);
create index if not exists quorum_records_pull on public.quorum_records (crew_id, updated_at);
create index if not exists quorum_records_owner on public.quorum_records (owner_id);

create table if not exists public.quorum_audit (
  id bigint generated always as identity primary key,
  crew_id uuid not null references public.quorum_crews (id) on delete cascade,
  actor uuid,
  actor_name text,
  action text not null,
  kind text,
  client_id text,
  at timestamptz not null default now()
);
create index if not exists quorum_audit_crew on public.quorum_audit (crew_id, at desc);

-- Helpers. They run with the definer's rights so policies can look up membership without recursion.
create or replace function public.quorum_is_member(c uuid) returns boolean
  language sql stable security definer set search_path = '' as
  $$ select exists (select 1 from public.quorum_members m where m.crew_id = c and m.user_id = (select auth.uid())) $$;

create or replace function public.quorum_role(c uuid) returns text
  language sql stable security definer set search_path = '' as
  $$ select m.role from public.quorum_members m where m.crew_id = c and m.user_id = (select auth.uid()) $$;

create or replace function public.quorum_shares(c uuid, owner uuid, cat text) returns boolean
  language sql stable security definer set search_path = '' as
  $$ select coalesce((select (m.share ->> cat)::boolean from public.quorum_members m where m.crew_id = c and m.user_id = owner), false) $$;

alter table public.quorum_crews enable row level security;
alter table public.quorum_members enable row level security;
alter table public.quorum_records enable row level security;
alter table public.quorum_audit enable row level security;

drop policy if exists quorum_crews_read on public.quorum_crews;
create policy quorum_crews_read on public.quorum_crews for select to authenticated using (public.quorum_is_member(id));

drop policy if exists quorum_members_read on public.quorum_members;
create policy quorum_members_read on public.quorum_members for select to authenticated using (public.quorum_is_member(crew_id));
-- A member may change only their own name and sharing choices; the role column is not grantable (see grants).
drop policy if exists quorum_members_self on public.quorum_members;
create policy quorum_members_self on public.quorum_members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Reading: your own records, crew-wide records, and a crewmate's check-in only in categories they share.
drop policy if exists quorum_records_read on public.quorum_records;
create policy quorum_records_read on public.quorum_records for select to authenticated using (
  public.quorum_is_member(crew_id)
  and (owner_id = (select auth.uid()) or category = 'shared' or public.quorum_shares(crew_id, owner_id, category)));

-- Writing: check-ins are your own; blood draws and the crew roster need the medical officer role.
drop policy if exists quorum_records_insert on public.quorum_records;
create policy quorum_records_insert on public.quorum_records for insert to authenticated with check (
  public.quorum_is_member(crew_id) and owner_id = (select auth.uid())
  and (kind not in ('lab_draw', 'roster') or public.quorum_role(crew_id) = 'medical_officer'));

drop policy if exists quorum_records_update on public.quorum_records;
create policy quorum_records_update on public.quorum_records for update to authenticated
  using (public.quorum_is_member(crew_id) and (owner_id = (select auth.uid()) or category = 'shared'))
  with check (
    public.quorum_is_member(crew_id)
    and (kind <> 'checkin' or owner_id = (select auth.uid()))
    and (kind not in ('lab_draw', 'roster') or public.quorum_role(crew_id) = 'medical_officer'));
-- No delete policy: records are marked deleted, never removed, so the history survives.

drop policy if exists quorum_audit_read on public.quorum_audit;
create policy quorum_audit_read on public.quorum_audit for select to authenticated using (public.quorum_is_member(crew_id));
-- No insert, update or delete policy on the audit trail: only the triggers below can write to it.

-- Keep identity columns fixed, stamp the time, and write the audit line.
create or replace function public.quorum_records_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.crew_id <> old.crew_id or new.kind <> old.kind or new.client_id <> old.client_id or new.id <> old.id then
      raise exception 'A record cannot be moved or renamed';
    end if;
    if old.kind = 'checkin' then new.owner_id := old.owner_id; else new.owner_id := coalesce((select auth.uid()), old.owner_id); end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists quorum_records_guard on public.quorum_records;
create trigger quorum_records_guard before insert or update on public.quorum_records for each row execute function public.quorum_records_guard();

create or replace function public.quorum_records_audit() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare who text;
begin
  select m.display_name into who from public.quorum_members m where m.crew_id = new.crew_id and m.user_id = (select auth.uid());
  insert into public.quorum_audit (crew_id, actor, actor_name, action, kind, client_id)
  values (new.crew_id, (select auth.uid()), who,
    case when tg_op = 'INSERT' then 'added' when new.deleted and not old.deleted then 'removed' else 'changed' end,
    new.kind, case when new.kind = 'checkin' then new.category else new.client_id end);
  return null;
end $$;
drop trigger if exists quorum_records_audit on public.quorum_records;
create trigger quorum_records_audit after insert or update on public.quorum_records for each row execute function public.quorum_records_audit();

-- Crew management goes through these functions so roles cannot be self-assigned.
create or replace function public.quorum_create_crew(p_name text, p_display text, p_role text default 'commander') returns json
  language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); cid uuid; code text;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  if p_role not in ('commander', 'medical_officer') then raise exception 'The person who creates a crew is its commander or medical officer'; end if;
  if (select count(*) from public.quorum_members where user_id = uid) >= 5 then raise exception 'You are already in five crews'; end if;
  code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.quorum_crews (name, join_code, created_by) values (btrim(p_name), code, uid) returning id into cid;
  insert into public.quorum_members (crew_id, user_id, display_name, role) values (cid, uid, btrim(p_display), p_role);
  insert into public.quorum_audit (crew_id, actor, actor_name, action, kind, client_id) values (cid, uid, btrim(p_display), 'created the crew', 'crew', p_role);
  return json_build_object('crew_id', cid, 'join_code', code, 'name', btrim(p_name), 'role', p_role);
end $$;

create or replace function public.quorum_join_crew(p_code text, p_display text) returns json
  language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); c public.quorum_crews;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  select * into c from public.quorum_crews where join_code = upper(btrim(p_code));
  if c.id is null then raise exception 'No crew has that code'; end if;
  if exists (select 1 from public.quorum_members where crew_id = c.id and user_id = uid) then
    return json_build_object('crew_id', c.id, 'join_code', c.join_code, 'name', c.name, 'role', (select role from public.quorum_members where crew_id = c.id and user_id = uid));
  end if;
  if (select count(*) from public.quorum_members where crew_id = c.id) >= 12 then raise exception 'That crew is full'; end if;
  if (select count(*) from public.quorum_members where user_id = uid) >= 5 then raise exception 'You are already in five crews'; end if;
  insert into public.quorum_members (crew_id, user_id, display_name, role) values (c.id, uid, btrim(p_display), 'crew');
  insert into public.quorum_audit (crew_id, actor, actor_name, action, kind, client_id) values (c.id, uid, btrim(p_display), 'joined the crew', 'crew', 'crew');
  return json_build_object('crew_id', c.id, 'join_code', c.join_code, 'name', c.name, 'role', 'crew');
end $$;

create or replace function public.quorum_set_role(p_crew uuid, p_user uuid, p_role text) returns void
  language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); who text; target text;
begin
  if (select role from public.quorum_members where crew_id = p_crew and user_id = uid) is distinct from 'commander' then raise exception 'Only the commander can change roles'; end if;
  if p_role not in ('medical_officer', 'crew') then raise exception 'Roles are medical_officer or crew'; end if;
  if p_user = uid then raise exception 'The commander keeps the commander role'; end if;
  update public.quorum_members set role = p_role where crew_id = p_crew and user_id = p_user returning display_name into target;
  if target is null then raise exception 'That person is not in this crew'; end if;
  select display_name into who from public.quorum_members where crew_id = p_crew and user_id = uid;
  insert into public.quorum_audit (crew_id, actor, actor_name, action, kind, client_id) values (p_crew, uid, who, 'set role of ' || target || ' to', 'role', p_role);
end $$;

-- Grants: signed-in users only; nobody may write the role column or the audit trail directly.
revoke all on public.quorum_crews, public.quorum_members, public.quorum_records, public.quorum_audit from anon, authenticated;
grant select on public.quorum_crews, public.quorum_members, public.quorum_records, public.quorum_audit to authenticated;
grant insert, update on public.quorum_records to authenticated;
grant update (display_name, share) on public.quorum_members to authenticated;
revoke all on function public.quorum_is_member(uuid), public.quorum_role(uuid), public.quorum_shares(uuid, uuid, text),
  public.quorum_create_crew(text, text, text), public.quorum_join_crew(text, text), public.quorum_set_role(uuid, uuid, text),
  public.quorum_records_guard(), public.quorum_records_audit() from public, anon;
grant execute on function public.quorum_is_member(uuid), public.quorum_role(uuid), public.quorum_shares(uuid, uuid, text),
  public.quorum_create_crew(text, text, text), public.quorum_join_crew(text, text), public.quorum_set_role(uuid, uuid, text) to authenticated;
