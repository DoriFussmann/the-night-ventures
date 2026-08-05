-- Industries lookup, company↔industry M2M, chat sessions/messages, insights.
-- Also adds target_audience on company_profiles.

-- 1) company_profiles.target_audience
alter table public.company_profiles
  add column if not exists target_audience text;

comment on column public.company_profiles.target_audience is
  'Freeform ICP / target audience description.';

-- 2) industries lookup
create table if not exists public.industries (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

comment on table public.industries is
  'Global industry lookup used for company tagging (many-to-many via company_industries).';

alter table public.industries enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'industries'
      and policyname = 'Authenticated users can manage industries'
  ) then
    create policy "Authenticated users can manage industries"
      on public.industries for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;

-- Seed industries (idempotent: safe if an earlier seed already ran).
-- "Car Insurance" omitted — covered by Auto Insurance.
-- "Home Security" listed once (also appears under Security & Safety).
insert into public.industries (name) values
  -- Insurance & Risk
  ('Property & Casualty Insurance'),
  ('Life Insurance'),
  ('Health Insurance'),
  ('Auto Insurance'),
  ('Home Insurance'),
  ('Renters Insurance'),
  ('Umbrella Insurance'),
  ('Pet Insurance'),
  ('Travel Insurance'),
  ('Business Insurance'),
  ('Disability Insurance'),
  ('Long-Term Care Insurance'),
  -- Personal Finance & Wealth
  ('Personal Finance'),
  ('Investing & Wealth Management'),
  ('Retirement Planning'),
  ('Credit Cards & Rewards'),
  ('Debt Relief & Credit Repair'),
  ('Banking & Checking'),
  ('Budgeting & Saving'),
  ('Cryptocurrency & Digital Assets'),
  ('Tax Preparation & Planning'),
  ('Student Loans'),
  ('Estate Planning'),
  -- Real Estate & Housing
  ('Real Estate (Buying/Selling)'),
  ('Real Estate Investing'),
  ('Mortgage & Lending'),
  ('Home Improvement & Renovation'),
  ('Moving & Relocation'),
  ('Home Security'),
  ('Interior Design'),
  ('Landscaping & Lawn Care'),
  ('Property Management'),
  ('Vacation Rentals & Short-Term Rental'),
  -- Legal & Professional Services
  ('Legal Services (General)'),
  ('Personal Injury Law'),
  ('Family Law & Divorce'),
  ('Immigration Law'),
  ('Bankruptcy Law'),
  ('Estate & Probate Law'),
  ('Business Law'),
  ('Accounting & Bookkeeping'),
  ('Consulting Services'),
  ('HR & Recruiting Services'),
  -- Healthcare & Wellness
  ('Healthcare & Wellness (General)'),
  ('Mental Health & Therapy'),
  ('Dental Care'),
  ('Vision Care'),
  ('Senior Care & Assisted Living'),
  ('Home Healthcare'),
  ('Physical Therapy & Rehab'),
  ('Alternative & Holistic Medicine'),
  ('Medical Devices & Equipment'),
  ('Telehealth'),
  -- Fitness, Beauty & Personal Care
  ('Fitness & Exercise'),
  ('Nutrition & Supplements'),
  ('Weight Loss'),
  ('Yoga & Mindfulness'),
  ('Beauty & Skincare'),
  ('Hair Care'),
  ('Cosmetic & Aesthetic Procedures'),
  ('Personal Hygiene'),
  -- Family, Parenting & Education
  ('Parenting & Family'),
  ('Pregnancy & Baby Care'),
  ('Childcare & Daycare'),
  ('K-12 Education'),
  ('Higher Education'),
  ('Online Learning & Courses'),
  ('Tutoring'),
  ('Homeschooling'),
  ('College Admissions & Test Prep'),
  -- Automotive & Transportation
  ('Automotive (Buying/Selling)'),
  ('Auto Repair & Maintenance'),
  ('Electric Vehicles'),
  ('Motorcycles & Powersports'),
  ('RVs & Camping Vehicles'),
  ('Ridesharing & Transportation Services'),
  -- Travel & Hospitality
  ('Travel & Tourism'),
  ('Hotels & Accommodation'),
  ('Cruises'),
  ('Airlines & Flights'),
  ('Adventure & Outdoor Travel'),
  ('Family Travel'),
  ('Luxury Travel'),
  ('Budget Travel'),
  -- Pets & Animals
  ('Pet Care (General)'),
  ('Dog Care & Training'),
  ('Cat Care'),
  ('Veterinary Services'),
  ('Pet Products & Supplies'),
  -- Home, Garden & Lifestyle
  ('Home Improvement & Renovation (DIY)'),
  ('Gardening'),
  ('Cleaning Services'),
  ('Moving Services'),
  ('Furniture & Home Decor'),
  ('Smart Home Technology'),
  -- Technology & Software
  ('B2B SaaS'),
  ('Consumer Software & Apps'),
  ('Technology & Gadgets'),
  ('Cybersecurity'),
  ('AI & Machine Learning Tools'),
  ('Web Hosting & Domains'),
  ('VPN & Privacy Tools'),
  ('Telecommunications & Mobile Plans'),
  -- E-commerce & Retail
  ('E-commerce & Retail (General)'),
  ('Fashion & Apparel'),
  ('Electronics Retail'),
  ('Subscription Boxes'),
  ('Marketplace Platforms'),
  -- Food & Beverage
  ('Food & Beverage (General)'),
  ('Restaurants & Dining'),
  ('Meal Kits & Delivery'),
  ('Coffee & Tea'),
  ('Alcohol & Spirits'),
  ('Specialty & Health Foods'),
  -- Career & Business
  ('Career & Recruiting'),
  ('Job Search & Resume Services'),
  ('Freelancing & Gig Economy'),
  ('Small Business Services'),
  ('Entrepreneurship & Startups'),
  ('Franchising'),
  ('Business Software & Tools'),
  -- Energy & Utilities
  ('Energy & Utilities (General)'),
  ('Solar Energy'),
  ('Home Energy Efficiency'),
  ('Internet & Broadband Providers'),
  -- Entertainment & Media
  ('Streaming & Media Services'),
  ('Gaming'),
  ('Sports & Recreation'),
  ('Hobbies & Crafts'),
  ('Photography'),
  -- Security & Safety
  ('Identity Theft Protection'),
  ('Personal Safety Products'),
  ('Cybersecurity (Consumer)'),
  -- Other
  ('Nonprofit & Charitable Giving'),
  ('Religious & Faith-Based'),
  ('Sustainability & Green Living'),
  ('Government & Public Services')
on conflict (name) do nothing;

-- 3) company_industries join table
create table if not exists public.company_industries (
  company_id uuid not null references public.companies (id) on delete cascade,
  industry_id uuid not null references public.industries (id) on delete cascade,
  primary key (company_id, industry_id)
);

comment on table public.company_industries is
  'Many-to-many link between companies and industries.';

create index if not exists company_industries_company_id_idx
  on public.company_industries (company_id);

create index if not exists company_industries_industry_id_idx
  on public.company_industries (industry_id);

alter table public.company_industries enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'company_industries'
      and policyname = 'Authenticated users can manage company_industries'
  ) then
    create policy "Authenticated users can manage company_industries"
      on public.company_industries for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;

-- 4) chat_sessions
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.chat_sessions is
  'Per-company chat sessions; title may be auto-generated later.';

create index if not exists chat_sessions_company_id_idx
  on public.chat_sessions (company_id);

alter table public.chat_sessions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'chat_sessions'
      and policyname = 'Authenticated users can manage chat_sessions'
  ) then
    create policy "Authenticated users can manage chat_sessions"
      on public.chat_sessions for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;

-- 5) chat_messages
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  role text not null
    check (role in ('user', 'assistant', 'tool')),
  content jsonb not null,
  created_at timestamptz not null default now()
);

comment on table public.chat_messages is
  'Messages within a chat session. content is jsonb so tool calls/results can be reconstructed.';

comment on column public.chat_messages.role is
  'Message role: user | assistant | tool.';

create index if not exists chat_messages_session_id_idx
  on public.chat_messages (session_id);

alter table public.chat_messages enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'chat_messages'
      and policyname = 'Authenticated users can manage chat_messages'
  ) then
    create policy "Authenticated users can manage chat_messages"
      on public.chat_messages for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;

-- 6) insights
create table if not exists public.insights (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  session_id uuid references public.chat_sessions (id) on delete set null,
  title text not null,
  body text not null,
  insight_type text not null,
  source_tool text,
  conflicts_with_profile boolean not null default false,
  status text not null default 'new'
    check (status in ('new', 'applied', 'dismissed')),
  created_at timestamptz not null default now()
);

comment on table public.insights is
  'Model- or tool-derived insights for a company, optionally linked to a chat session.';

comment on column public.insights.insight_type is
  'Free-text label generated by the model (no enum).';

comment on column public.insights.source_tool is
  'Tool that produced the insight (e.g. semrush, dataforseo, moz); null if not tool-derived.';

comment on column public.insights.conflicts_with_profile is
  'True when this insight contradicts existing company_profiles data.';

comment on column public.insights.status is
  'Lifecycle: new | applied | dismissed.';

create index if not exists insights_company_id_idx
  on public.insights (company_id);

create index if not exists insights_session_id_idx
  on public.insights (session_id);

alter table public.insights enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'insights'
      and policyname = 'Authenticated users can manage insights'
  ) then
    create policy "Authenticated users can manage insights"
      on public.insights for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;

-- Verification (useful when pasting into SQL Editor)
select count(*) as industry_count from public.industries;

select name, count(*) as dup_count
from public.industries
group by name
having count(*) > 1
order by name;
