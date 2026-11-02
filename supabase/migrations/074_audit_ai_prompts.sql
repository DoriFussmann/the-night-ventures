-- Audit · AI Visibility: the stored prompt set each run asks ChatGPT, Claude,
-- Gemini and Perplexity. Kept stable across runs so scores compare like with like.
-- Additive only; safe on production.

create table if not exists public.audit_ai_prompts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  prompt text not null check (char_length(prompt) between 8 and 500),
  intent text not null default 'recommendation'
    check (intent in ('recommendation', 'problem', 'comparison', 'brand')),
  position integer not null default 0,
  source text not null default 'generated' check (source in ('generated', 'manual')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.audit_ai_prompts is
  'Audit AI Visibility: buyer prompts (unbranded) + one brand prompt, asked on every run.';

create index if not exists audit_ai_prompts_company_idx
  on public.audit_ai_prompts (company_id, position);

alter table public.audit_ai_prompts enable row level security;
drop policy if exists "Authenticated users can manage audit_ai_prompts" on public.audit_ai_prompts;
create policy "Authenticated users can manage audit_ai_prompts"
  on public.audit_ai_prompts for all to authenticated using (true) with check (true);
