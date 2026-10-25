-- Retire the in-between statuses.
-- Workspace tasks: Do / Done / Archive ("doing" → "do").
-- Site Build Flow phases and steps: Open / Done ("wip" → "open").
-- Run AFTER the app version without Doing/WIP is live: the old screen can
-- still set WIP, and that click fails once these constraints are in place.

begin;

-- Workspace tasks
update public.workspace_tasks set status = 'do' where status = 'doing';

alter table public.workspace_tasks
  drop constraint if exists workspace_tasks_status_check;

alter table public.workspace_tasks
  add constraint workspace_tasks_status_check
  check (status in ('do', 'done', 'archived'));

comment on column public.workspace_tasks.status is
  'Board column: do, done, or archived.';

-- Site Build Flow: drop every status check on both tables, whatever its name
-- (022 created them inline, so Postgres generated the names).
do $$
declare
  c record;
begin
  for c in
    select con.conrelid::regclass as tbl, con.conname
    from pg_constraint con
    where con.contype = 'c'
      and con.conrelid in ('public.setup_flow_stages'::regclass, 'public.setup_flow_items'::regclass)
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end
$$;

update public.setup_flow_stages set status = 'open' where status = 'wip';
update public.setup_flow_items set status = 'open' where status = 'wip';

alter table public.setup_flow_stages
  add constraint setup_flow_stages_status_check
  check (status in ('open', 'done'));

alter table public.setup_flow_items
  add constraint setup_flow_items_status_check
  check (status in ('open', 'done'));

commit;
