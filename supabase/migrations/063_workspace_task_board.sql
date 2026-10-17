-- Workspace tasks: title, description, and a Do / Doing / Done / Archive board.
-- body stays the description. Existing notes become a title (first line) plus
-- the remaining text as the description.

alter table public.workspace_tasks
  add column if not exists name text,
  add column if not exists status text not null default 'do';

alter table public.workspace_tasks
  drop constraint if exists workspace_tasks_status_check;

alter table public.workspace_tasks
  add constraint workspace_tasks_status_check
  check (status in ('do', 'doing', 'done', 'archived'));

update public.workspace_tasks
set
  name = nullif(btrim(split_part(replace(body, E'\r\n', E'\n'), E'\n', 1)), ''),
  body = case
    when position(E'\n' in replace(body, E'\r\n', E'\n')) > 0
      then btrim(substr(
        replace(body, E'\r\n', E'\n'),
        position(E'\n' in replace(body, E'\r\n', E'\n')) + 1
      ))
    else ''
  end
where coalesce(btrim(name), '') = '';

comment on column public.workspace_tasks.name is
  'Task title shown on the board.';
comment on column public.workspace_tasks.body is
  'Task description.';
comment on column public.workspace_tasks.status is
  'Board column: do, doing, done, or archived.';
