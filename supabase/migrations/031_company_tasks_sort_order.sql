-- Add sort_order if 030 was applied before it included the column.

alter table public.company_tasks
  add column if not exists sort_order integer not null default 0;

create index if not exists company_tasks_company_sort_idx
  on public.company_tasks (company_id, sort_order);

update public.company_tasks t
set sort_order = o.rn
from (
  select
    id,
    row_number() over (partition by company_id order by created_at, id) - 1 as rn
  from public.company_tasks
) o
where t.id = o.id
  and not exists (
    select 1
    from public.company_tasks x
    where x.company_id = t.company_id
      and x.sort_order <> 0
  );
