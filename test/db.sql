-- Local test of the database rules. Stubs the parts Supabase provides, loads the schema, then acts as four users.
\set ON_ERROR_STOP on
\set QUIET on
drop schema if exists auth cascade; create schema auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
drop table if exists public.quorum_audit, public.quorum_records, public.quorum_members, public.quorum_crews cascade;
\i supabase/schema.sql
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c'),('00000000-0000-0000-0000-00000000000d');
create table if not exists public.t_out (n serial, name text, ok boolean); truncate public.t_out; grant all on public.t_out to authenticated, anon; grant usage on sequence public.t_out_n_seq to authenticated, anon;
-- expect(name, sql, 'ok' | 'fail' | 'rows:N'): run sql as the current user and record whether it behaved as expected.
create or replace function public.expect(name text, q text, want text) returns void language plpgsql as $$
declare n bigint; got text;
begin
  begin execute q; get diagnostics n = row_count; got := 'ok'; exception when others then got := 'fail'; end;
  if want like 'rows:%' then insert into public.t_out (name, ok) values (name, got = 'ok' and n = substr(want, 6)::bigint);
  else insert into public.t_out (name, ok) values (name, got = want); end if;
end $$;
grant execute on function public.expect(text, text, text) to authenticated, anon;

-- A = commander, B = medical officer, C = crew, D = outsider
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.expect('commander creates a crew', $$ select public.quorum_create_crew('Ares', 'Park', 'commander') $$, 'ok');
select public.expect('creator cannot pick the plain crew role trick or junk role', $$ select public.quorum_create_crew('X', 'P', 'admin') $$, 'fail');
reset role; select set_config('t.code', (select join_code from public.quorum_crews limit 1), false), set_config('t.crew', (select id::text from public.quorum_crews limit 1), false) \gset
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.expect('B joins with the code', format($$ select public.quorum_join_crew(%L, 'Ilves') $$, current_setting('t.code')), 'ok');
select public.expect('wrong code is refused', $$ select public.quorum_join_crew('ZZZZZZZZ', 'Ilves') $$, 'fail');
select public.expect('B cannot promote herself by direct update', format($$ update public.quorum_members set role = 'medical_officer' where crew_id = %L $$, current_setting('t.crew')), 'fail');
select public.expect('B cannot call set_role', format($$ select public.quorum_set_role(%L, '00000000-0000-0000-0000-00000000000b', 'medical_officer') $$, current_setting('t.crew')), 'fail');
select public.expect('B (plain crew) cannot add a blood draw', format($$ insert into public.quorum_records (crew_id, kind, category, client_id, payload) values (%L, 'lab_draw', 'shared', 'R+230', '{"day":230}') $$, current_setting('t.crew')), 'fail');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select public.expect('C joins', format($$ select public.quorum_join_crew(%L, 'Haddad') $$, current_setting('t.code')), 'ok');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.expect('commander makes B the medical officer', format($$ select public.quorum_set_role(%L, '00000000-0000-0000-0000-00000000000b', 'medical_officer') $$, current_setting('t.crew')), 'ok');
select public.expect('commander cannot add a blood draw either', format($$ insert into public.quorum_records (crew_id, kind, category, client_id, payload) values (%L, 'lab_draw', 'shared', 'R+230', '{"day":230}') $$, current_setting('t.crew')), 'fail');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.expect('medical officer adds a blood draw', format($$ insert into public.quorum_records (crew_id, kind, category, client_id, payload) values (%L, 'lab_draw', 'shared', 'R+230', '{"day":230}') $$, current_setting('t.crew')), 'rows:1');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select public.expect('C sees the draw', $$ select 1 from public.quorum_records where kind = 'lab_draw' $$, 'rows:1');
select public.expect('C cannot change the draw', $$ update public.quorum_records set payload = '{"day":999}' where kind = 'lab_draw' $$, 'fail');
select public.expect('C cannot delete anything', $$ delete from public.quorum_records $$, 'fail');
select public.expect('C logs a mission event', format($$ insert into public.quorum_records (crew_id, kind, category, client_id, payload) values (%L, 'event', 'shared', 'e1', '{"day":227}') $$, current_setting('t.crew')), 'rows:1');
select public.expect('C logs own vitals and mood', format($$ insert into public.quorum_records (crew_id, kind, category, client_id, payload) values (%1$L, 'checkin', 'vitals', 'c:1:vitals', '{"hr":60}'), (%1$L, 'checkin', 'mood', 'c:1:mood', '{"mood":2}') $$, current_setting('t.crew')), 'rows:2');
select public.expect('C cannot file a check-in as someone else', format($$ insert into public.quorum_records (crew_id, owner_id, kind, category, client_id, payload) values (%L, '00000000-0000-0000-0000-00000000000a', 'checkin', 'vitals', 'x', '{}') $$, current_setting('t.crew')), 'fail');
select public.expect('a check-in cannot be filed as crew-wide', format($$ insert into public.quorum_records (crew_id, kind, category, client_id, payload) values (%L, 'checkin', 'shared', 'y', '{}') $$, current_setting('t.crew')), 'fail');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.expect('medical officer sees C''s vitals', $$ select 1 from public.quorum_records where client_id = 'c:1:vitals' $$, 'rows:1');
select public.expect('medical officer cannot see C''s private mood', $$ select 1 from public.quorum_records where client_id = 'c:1:mood' $$, 'rows:0');
select public.expect('nobody can edit C''s check-in', $$ update public.quorum_records set payload = '{"hr":1}' where client_id = 'c:1:vitals' $$, 'rows:0');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select public.expect('C turns mood sharing on', $$ update public.quorum_members set share = share || '{"mood":true}' where user_id = auth.uid() $$, 'rows:1');
select public.expect('C cannot change another member''s sharing', $$ update public.quorum_members set share = '{"mood":true}' where user_id <> auth.uid() $$, 'rows:0');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.expect('now the mood record is visible', $$ select 1 from public.quorum_records where client_id = 'c:1:mood' $$, 'rows:1');
select public.expect('audit trail is readable by the crew', $$ select 1 from public.quorum_audit $$, 'rows:8');
select public.expect('audit trail cannot be written', format($$ insert into public.quorum_audit (crew_id, action) values (%L, 'fake') $$, current_setting('t.crew')), 'fail');
select public.expect('audit trail cannot be edited', $$ update public.quorum_audit set action = 'x' $$, 'fail');
select public.expect('audit trail cannot be erased', $$ delete from public.quorum_audit $$, 'fail');
select public.expect('a record cannot be moved to another kind', $$ update public.quorum_records set kind = 'event' where kind = 'lab_draw' $$, 'fail');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select public.expect('outsider sees no crews', $$ select 1 from public.quorum_crews $$, 'rows:0');
select public.expect('outsider sees no members', $$ select 1 from public.quorum_members $$, 'rows:0');
select public.expect('outsider sees no records', $$ select 1 from public.quorum_records $$, 'rows:0');
select public.expect('outsider sees no audit lines', $$ select 1 from public.quorum_audit $$, 'rows:0');
select public.expect('outsider cannot write into the crew', format($$ insert into public.quorum_records (crew_id, kind, category, client_id, payload) values (%L, 'event', 'shared', 'e9', '{}') $$, current_setting('t.crew')), 'fail');
set role anon; set request.jwt.claim.sub = '';
select public.expect('signed-out visitor cannot read records', $$ select 1 from public.quorum_records $$, 'fail');
select public.expect('signed-out visitor cannot create a crew', $$ select public.quorum_create_crew('X', 'Y', 'commander') $$, 'fail');
reset role;
\set QUIET off
\pset tuples_only on
select case when ok then 'PASS ' else 'FAIL ' end || name from public.t_out order by n;
select 'audit: ' || string_agg(coalesce(actor_name, '?') || ' ' || action || ' ' || coalesce(kind, '') || ' ' || coalesce(client_id, ''), ' | ' order by id) from public.quorum_audit;
select (select count(*) filter (where ok) from public.t_out) || ' of ' || (select count(*) from public.t_out) || ' database rules hold';
