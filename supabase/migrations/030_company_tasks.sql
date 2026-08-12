-- Unified company tasks tracker.
-- Replaces the split website_build_tasks / business_dev_initiatives UI
-- with a single table and richer fields (item type, sub type, details, links).

create table public.company_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  item text not null,
  item_type text not null default 'site'
    check (item_type in (
      'product',
      'site',
      'digital_stores',
      'social_accounts',
      'business_development'
    )),
  sub_type text,
  task_details text,
  owner text,
  status text not null default 'open'
    check (status in ('open', 'wip', 'done', 'rejected')),
  additional_comments text,
  links text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index company_tasks_company_id_idx on public.company_tasks (company_id);
create index company_tasks_company_sort_idx on public.company_tasks (company_id, sort_order);

alter table public.company_tasks enable row level security;

create policy "Authenticated users can manage company_tasks"
  on public.company_tasks for all
  to authenticated
  using (true)
  with check (true);

-- Copy existing tracker rows, mapping legacy statuses into the new enum.
insert into public.company_tasks (
  id,
  company_id,
  item,
  item_type,
  owner,
  status,
  additional_comments,
  created_at
)
select
  id,
  company_id,
  item,
  'site',
  owner,
  case
    when lower(trim(coalesce(status, ''))) in ('done', 'complete', 'completed') then 'done'
    when lower(trim(coalesce(status, ''))) in ('wip', 'in progress', 'in-progress', 'working') then 'wip'
    when lower(trim(coalesce(status, ''))) in ('rejected', 'reject', 'cancelled', 'canceled') then 'rejected'
    else 'open'
  end,
  comments,
  created_at
from public.website_build_tasks;

insert into public.company_tasks (
  id,
  company_id,
  item,
  item_type,
  owner,
  status,
  additional_comments,
  created_at
)
select
  id,
  company_id,
  item,
  'business_development',
  owner,
  case
    when lower(trim(coalesce(status, ''))) in ('done', 'complete', 'completed') then 'done'
    when lower(trim(coalesce(status, ''))) in ('wip', 'in progress', 'in-progress', 'working') then 'wip'
    when lower(trim(coalesce(status, ''))) in ('rejected', 'reject', 'cancelled', 'canceled') then 'rejected'
    else 'open'
  end,
  comments,
  created_at
from public.business_dev_initiatives;

-- Preserve chronological order as the initial sort order per company.
update public.company_tasks t
set sort_order = o.rn
from (
  select
    id,
    row_number() over (partition by company_id order by created_at, id) - 1 as rn
  from public.company_tasks
) o
where t.id = o.id;
