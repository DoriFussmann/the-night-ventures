-- 090: Fan-Out Engine v2, steps 1 to 3: a structured Situation, a three-field Persona, several prompts per type.
-- Additive: new columns, one new table, a new default, and one unique constraint dropped (it allowed only
-- one prompt per type). No row is changed or removed. Existing situations keep version 1 and their free text.
--
-- Rollback:
--   drop table if exists public.fo_settings;
--   -- Archived prompts count as prompts again once archived_at is gone. Before dropping it, decide what to do with them
--   -- (deleting an archived prompt deletes its runs). The unique constraint can only come back while no situation has
--   -- two prompts of one type, archived ones included.
--   alter table public.fo_prompts drop column if exists angle, drop column if exists sort, drop column if exists origin, drop column if exists archived_at;
--   alter table public.fo_prompts add constraint fo_prompts_situation_id_form_key unique (situation_id, form);
--   alter table public.fo_situations alter column runs set default 5;
--   alter table public.fo_situations drop column if exists version, drop column if exists who, drop column if exists trigger_event,
--     drop column if exists goal, drop column if exists stage, drop column if exists comments, drop column if exists variant_of,
--     drop column if exists persona_confirmed_at, drop column if exists prompts_confirmed_at;

alter table public.fo_situations
  add column if not exists version integer not null default 1,      -- 1: free-text situation (before v2). 2: structured fields
  add column if not exists who text not null default '',            -- role and context
  add column if not exists trigger_event text not null default '',  -- what just happened, or what is forcing action now
  add column if not exists goal text not null default '',           -- what they are trying to get done
  add column if not exists stage text check (stage in ('exploring', 'comparing', 'ready_to_buy')),
  add column if not exists comments text not null default '',       -- optional extra context for the persona and the prompts
  add column if not exists variant_of uuid references public.fo_situations(id) on delete set null,  -- same goal, different trigger or stage
  add column if not exists persona_confirmed_at timestamptz,        -- set when the user approves the persona; it is then reused on every run
  add column if not exists prompts_confirmed_at timestamptz;        -- set when the user confirms the prompts; they are then frozen

alter table public.fo_situations alter column runs set default 7;

-- Three prompts per type, each with its own angle. A prompt that already has runs is archived instead of deleted,
-- so the raw runs are kept.
alter table public.fo_prompts drop constraint if exists fo_prompts_situation_id_form_key;
alter table public.fo_prompts
  add column if not exists angle text not null default '',
  add column if not exists sort integer not null default 0,
  add column if not exists origin text not null default 'ai' check (origin in ('ai', 'user')),
  add column if not exists archived_at timestamptz;

-- Admin settings of the engine, one row for all companies. `values` holds only what differs from the defaults in lib/fan-out/core.js.
create table if not exists public.fo_settings (
  id text primary key default 'global' check (id = 'global'),
  "values" jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.fo_settings enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fo_settings') then
    -- Read-only for signed-in users: these settings apply to every company. Writes go through the server.
    create policy "Authenticated users can read fo_settings" on public.fo_settings for select to authenticated using (true);
  end if;
end $$;
