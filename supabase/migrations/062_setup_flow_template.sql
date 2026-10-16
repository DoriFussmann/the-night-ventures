-- Editable Site Build Flow checklist.
-- The phases and items every company's checklist is synced from now live in
-- these two tables and are edited on the Site Build Flow page ("Edit checklist").
-- Phases become data, so the fixed list of allowed phase keys is removed.
-- Safe to run more than once: the original checklist is copied in only while
-- the template is empty, so later edits are never overwritten.

alter table public.setup_flow_stages drop constraint if exists setup_flow_stages_stage_key_check;
alter table public.setup_flow_items drop constraint if exists setup_flow_items_stage_key_check;

create table if not exists public.setup_flow_template_stages (
  stage_key text primary key,
  name text not null,
  order_index int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.setup_flow_template_items (
  id uuid primary key default gen_random_uuid(),
  stage_key text not null references public.setup_flow_template_stages (stage_key) on delete cascade,
  item_key text not null,
  title text not null,
  description text not null default '',
  prompts jsonb not null default '[]'::jsonb,
  link_to text,
  link_label text,
  sort_order int not null default 0,
  updated_at timestamptz not null default now(),
  unique (stage_key, item_key)
);

comment on table public.setup_flow_template_stages is
  'Site Build Flow phases shared by every company. Edited in the app; companies sync on load.';
comment on table public.setup_flow_template_items is
  'Site Build Flow checklist items shared by every company. prompts = [{ label, text }]; link_to may contain :companyId.';

alter table public.setup_flow_template_stages enable row level security;
alter table public.setup_flow_template_items enable row level security;

drop policy if exists "Authenticated users can manage setup_flow_template_stages" on public.setup_flow_template_stages;
create policy "Authenticated users can manage setup_flow_template_stages"
  on public.setup_flow_template_stages for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can manage setup_flow_template_items" on public.setup_flow_template_items;
create policy "Authenticated users can manage setup_flow_template_items"
  on public.setup_flow_template_items for all
  to authenticated
  using (true)
  with check (true);

-- Replace the whole template in one transaction. p_stages is an ordered array:
-- [{ stage_key, name, items: [{ item_key, title, description, prompts, link_to, link_label }] }]
create or replace function public.save_setup_flow_template(p_stages jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if jsonb_typeof(p_stages) <> 'array' or jsonb_array_length(p_stages) = 0 then
    raise exception 'The checklist needs at least one phase';
  end if;

  delete from public.setup_flow_template_items where true;
  delete from public.setup_flow_template_stages where true;

  insert into public.setup_flow_template_stages (stage_key, name, order_index)
  select s.value ->> 'stage_key', btrim(s.value ->> 'name'), (s.ordinality - 1)::int
  from jsonb_array_elements(p_stages) with ordinality as s(value, ordinality);

  insert into public.setup_flow_template_items
    (stage_key, item_key, title, description, prompts, link_to, link_label, sort_order)
  select
    s.value ->> 'stage_key',
    i.value ->> 'item_key',
    btrim(i.value ->> 'title'),
    coalesce(i.value ->> 'description', ''),
    coalesce(i.value -> 'prompts', '[]'::jsonb),
    nullif(i.value ->> 'link_to', ''),
    nullif(i.value ->> 'link_label', ''),
    (i.ordinality - 1)::int
  from jsonb_array_elements(p_stages) as s(value)
  cross join lateral jsonb_array_elements(coalesce(s.value -> 'items', '[]'::jsonb)) with ordinality as i(value, ordinality);
end;
$$;

grant execute on function public.save_setup_flow_template(jsonb) to authenticated;

-- Copy in the current checklist (7 phases, 76 items) while the template is empty.
do $do$
begin
  if exists (select 1 from public.setup_flow_template_stages) then
    return;
  end if;

  insert into public.setup_flow_template_stages (stage_key, name, order_index) values
    ($seed$code-setup$seed$, $seed$Code Setup$seed$, 0),
    ($seed$seed-articles-content$seed$, $seed$Seed Articles Content$seed$, 1),
    ($seed$deployment$seed$, $seed$Deployment$seed$, 2),
    ($seed$site-activation$seed$, $seed$Site Activation$seed$, 3),
    ($seed$connection-layer$seed$, $seed$Connection Layer$seed$, 4),
    ($seed$links-wiring$seed$, $seed$Links Wiring$seed$, 5),
    ($seed$seed-qa$seed$, $seed$Initial Seed Content QA$seed$, 6);

  insert into public.setup_flow_template_items
    (stage_key, item_key, title, description, prompts, link_to, link_label, sort_order) values
    ($seed$code-setup$seed$, $seed$add-new-company$seed$, $seed$Add a new company and the details you have$seed$, $seed$In The Night Ventures, add a new company and enter the basic details you already have.$seed$, $seed$[]$seed$::jsonb, $seed$/$seed$, $seed$Open Companies →$seed$, 0),
    ($seed$code-setup$seed$, $seed$download-company-intelligence$seed$, $seed$Download Company Intelligence as Markdown$seed$, $seed$In Company Intelligence, once you have added all the details you have, click Download as Markdown.$seed$, $seed$[]$seed$::jsonb, $seed$/company/:companyId/company-data$seed$, $seed$Open Company Intelligence →$seed$, 1),
    ($seed$code-setup$seed$, $seed$fill-missing-fields-in-chatgpt$seed$, $seed$Fill the missing fields in ChatGPT$seed$, $seed$Upload the Company Intelligence markdown to ChatGPT and run the prompt. ChatGPT asks the questions it needs to complete the fields. The output is a markdown file you download.$seed$, $seed$[{"label":"LLM prompt to help fill fields","text":"Help me fill the missing fields for the new company, based on what I have provided you with - ask me all the questions you need to complete the fields. Give me in each turn a summary % completion, how many done and how many we have left. Be thorough, precise and super professional. Available to download as .md file"}]$seed$::jsonb, null, null, 2),
    ($seed$code-setup$seed$, $seed$upload-completed-company-intelligence$seed$, $seed$Upload the completed Company Intelligence file$seed$, $seed$Drag and drop the completed ChatGPT Company Intelligence .md file onto Company Intelligence and let it fill the missing fields.$seed$, $seed$[]$seed$::jsonb, $seed$/company/:companyId/company-data$seed$, $seed$Open Company Intelligence →$seed$, 3),
    ($seed$code-setup$seed$, $seed$create-github-repo-from-template$seed$, $seed$Create a GitHub repo from the SEO Blueprint template$seed$, $seed$On GitHub, create a new repository from the SEO Blueprint template.$seed$, $seed$[]$seed$::jsonb, null, null, 4),
    ($seed$code-setup$seed$, $seed$create-local-project-folder$seed$, $seed$Create a local project folder$seed$, $seed$On your desktop, create a new folder under your development Cursor zone.$seed$, $seed$[]$seed$::jsonb, null, null, 5),
    ($seed$code-setup$seed$, $seed$clone-repo-and-add-design-guide$seed$, $seed$Clone the repo$seed$, $seed$Open a new Cursor project for that folder. Tell the agent to git clone the GitHub URL into the folder root (not a subfolder). Leave site/Design Guide.md as it is for now — the design is applied after the content. Run npm run build to confirm it passes, then commit and push.$seed$, $seed$[]$seed$::jsonb, null, null, 6),
    ($seed$code-setup$seed$, $seed$follow-narrative-composer$seed$, $seed$Write the site content in ChatGPT$seed$, $seed$Open Narrative Composer, copy the ChatGPT prompt, attach company-data.md and send. Save the full response.$seed$, $seed$[]$seed$::jsonb, $seed$/company/:companyId/site-content-builder$seed$, $seed$Open Narrative Composer →$seed$, 7),
    ($seed$code-setup$seed$, $seed$paste-site-content-into-cursor$seed$, $seed$Implement the content in Cursor$seed$, $seed$Open Implement content, copy the Cursor prompt, paste it into Cursor with ChatGPT's full response below it. Wait for a clean build and the report.$seed$, $seed$[]$seed$::jsonb, $seed$/company/:companyId/site-content-build$seed$, $seed$Open Implement content →$seed$, 8),
    ($seed$code-setup$seed$, $seed$pick-design$seed$, $seed$Pick your design and generate the guide$seed$, $seed$Open Design. Pick one of the 6 directions, optionally tick Force Inter and/or Force no bold, set the brand accent and wordmark if needed, and check the preview. Click Generate design guide. Download DESIGN_GUIDE.md and copy the Cursor prompt.$seed$, $seed$[]$seed$::jsonb, $seed$/company/:companyId/design-guide-builder$seed$, $seed$Open Design →$seed$, 9),
    ($seed$code-setup$seed$, $seed$apply-design-in-cursor$seed$, $seed$Apply the design in Cursor$seed$, $seed$Drag DESIGN_GUIDE.md into the repository root (next to the site/ folder, not inside it). Paste the Cursor prompt from Design into Cursor and send. Wait for a clean npm run build and the report, check the site at mobile and desktop width, then commit and push.$seed$, $seed$[]$seed$::jsonb, $seed$/company/:companyId/design-guide-builder$seed$, $seed$Open Design →$seed$, 10),
    ($seed$code-setup$seed$, $seed$review-and-remove-pages$seed$, $seed$Review pages and clean up$seed$, $seed$Run the site locally and read every page. Delete pages you don't want: remove site/src/content/pages/<page>.yaml and its link from NAV or the footer in site/src/config/site.ts. Never remove Articles, Privacy or Terms. Replace testimonial placeholders with real quotes or delete the Testimonials page. Have Privacy and Terms reviewed. Resolve every [GAP] line. For each image brief, generate or source the image, save it in site/src/assets/, and add its path as src next to the brief in the page YAML. Build, commit and push.$seed$, $seed$[]$seed$::jsonb, null, null, 11),
    ($seed$code-setup$seed$, $seed$replace-brand-assets$seed$, $seed$Replace the logo, social image and brand profiles$seed$, $seed$Replace three template placeholders. (1) site/public/logo.png: the brand logo as PNG, JPEG or WebP, square, at least 112×112px. Search engines show it for the brand, and the build fails on an SVG, a favicon or anything smaller. (2) site/public/og-default.png: a 1200×675 branded image, shown when a page is shared and has no image of its own. (3) SAME_AS in site/src/config/site.ts: the brand's official profiles (LinkedIn company page, Crunchbase, X). The build warns while it is empty. Run npm run build, then commit and push.$seed$, $seed$[]$seed$::jsonb, null, null, 12),
    ($seed$code-setup$seed$, $seed$set-publish-destination$seed$, $seed$Set Publish Destination$seed$, $seed$In Company Intelligence, open Publish Destination and add the 3 fields: GitHub owner, GitHub repo, and GitHub token key.

Create the token on GitHub: avatar (top-right) → Settings → Developer settings (bottom of left sidebar) → Personal access tokens → Fine-grained tokens → Generate new token.

Set:

- Name: anything memorable (e.g. perfect-ai-publish) — this GitHub label is cosmetic; it does not have to match anything in the app.
- Expiration: longest allowed. Record the date — publishing silently 401s when it lapses.
- Resource owner: your personal account (the one that owns the destination repo).
- Repository access: Only select repositories → the single destination repo.
- Permissions → Repository permissions: Contents = Read and write AND Pull requests = Read and write. Everything else: No access.

Generate, then COPY the github_pat_… value immediately — GitHub shows it only once.

Then put the token where the app reads it — Vercel, not the app UI:

Vercel → the-night-ventures project → Settings → Environment Variables → Add:

- Name: GITHUB_TOKEN_<KEY> — pick a KEY in CAPS with underscores only (e.g. GITHUB_TOKEN_PERFECT_AI_WEBSITES).
- Value: the github_pat_… string.
- Environments: Production (and Preview if used). Save.

Redeploy TNV (env vars only load on a new deploy).

Then point the app at it:

Company Data → the project → Publish Destination → tokenKey field: enter just the KEY (e.g. PERFECT_AI_WEBSITES) — not the github_pat_… value. It must match the part after GITHUB_TOKEN_ in the Vercel variable.

Secret hygiene: the github_pat_… value goes only into the Vercel Environment Variable. Never paste it into a screenshot, a chat, or the Company Data field — that field takes the KEY (a pointer), never the token itself.$seed$, $seed$[]$seed$::jsonb, $seed$/company/:companyId/company-data$seed$, $seed$Open Company Intelligence →$seed$, 13),
    ($seed$code-setup$seed$, $seed$update-core-version$seed$, $seed$Update Core Version$seed$, $seed$Go to Admin → Core Version, wait for the scan on the live deployed site, and update the version. One-click updates cover minor versions only. A major version (for example 0.x → 1.0) shows as 'Migration required' and needs a Cursor patch for this site first.$seed$, $seed$[]$seed$::jsonb, $seed$/company/:companyId/core-version$seed$, $seed$Open Core Version →$seed$, 14),
    ($seed$code-setup$seed$, $seed$website-ready$seed$, $seed$You have a website$seed$, $seed$That's it. You now have a website locally, with content and design based on your input, and the ability to publish and update from TNV.$seed$, $seed$[]$seed$::jsonb, null, null, 15),
    ($seed$seed-articles-content$seed$, $seed$advisor-general-seo-research$seed$, $seed$Run general SEO research and the approach$seed$, $seed$Use the Advisor tool to conduct general SEO research about the site, and the SEO approach.$seed$, $seed$[]$seed$::jsonb, $seed$/company/:companyId/seo-ai-advisor$seed$, $seed$Open Advisor →$seed$, 0),
    ($seed$seed-articles-content$seed$, $seed$advisor-pillar-research$seed$, $seed$Research, confirm, and save pillars$seed$, $seed$Use the Advisor tool to conduct research on the Pillar Articles. Confirm and save each pillar.$seed$, $seed$[]$seed$::jsonb, $seed$/company/:companyId/seo-ai-advisor$seed$, $seed$Open Advisor →$seed$, 1),
    ($seed$seed-articles-content$seed$, $seed$advisor-cluster-research$seed$, $seed$Research, confirm, and save clusters$seed$, $seed$Use the Advisor tool to conduct research on the Clusters and Supporting Keywords. Do them one by one. Confirm and save one by one.$seed$, $seed$[]$seed$::jsonb, $seed$/company/:companyId/seo-ai-advisor$seed$, $seed$Open Advisor →$seed$, 2),
    ($seed$seed-articles-content$seed$, $seed$generate-publish-all-pillars$seed$, $seed$Generate and publish all pillar articles$seed$, $seed$Go to Generation in Build → Pillar, and click Generate & publish all. One click plans, generates, and publishes a pillar article for every pillar that doesn’t have one yet.$seed$, $seed$[]$seed$::jsonb, $seed$/company/:companyId/pillar-automation$seed$, $seed$Open Pillar Generation →$seed$, 3),
    ($seed$seed-articles-content$seed$, $seed$generate-publish-all-clusters$seed$, $seed$Generate and publish all cluster articles$seed$, $seed$Go to Generation in Build → Cluster, and click Generate & publish all. One click plans, generates, and publishes one supporting cluster for each published pillar that doesn’t have one yet.$seed$, $seed$[]$seed$::jsonb, $seed$/company/:companyId/article-generation$seed$, $seed$Open Cluster Generation →$seed$, 4),
    ($seed$seed-articles-content$seed$, $seed$review-articles-locally$seed$, $seed$Review the articles locally$seed$, $seed$Run npm run dev on the new site, navigate to articles, and check them out. Confirm everything looks legit.$seed$, $seed$[]$seed$::jsonb, null, null, 5),
    ($seed$deployment$seed$, $seed$push-to-github$seed$, $seed$Push to GitHub$seed$, $seed$The remote already exists from the template clone. In Cursor, commit remaining local changes and push to that repo.$seed$, $seed$[{"label":"Push command (edit URL if needed)","text":"Push to GitHub, https://github.com/[your-username]/[your-repo-name]"}]$seed$::jsonb, null, null, 0),
    ($seed$deployment$seed$, $seed$create-vercel-project$seed$, $seed$Create Vercel project$seed$, $seed$Go to Vercel, Add New > Project. It should auto-detect the pushed repo. In the project's Settings, set Node.js Version to 24.x (the template requires Node 24).$seed$, $seed$[]$seed$::jsonb, null, null, 1),
    ($seed$deployment$seed$, $seed$create-supabase-database$seed$, $seed$Create Supabase database$seed$, $seed$Once deployed, go to Vercel Storage, Create Database > Supabase.$seed$, $seed$[]$seed$::jsonb, null, null, 2),
    ($seed$deployment$seed$, $seed$copy-supabase-env-variables$seed$, $seed$Copy Supabase env variables$seed$, $seed$From Vercel Storage, go to Getting Started, copy the .env variables for Supabase.$seed$, $seed$[]$seed$::jsonb, null, null, 3),
    ($seed$deployment$seed$, $seed$scaffold-env-local$seed$, $seed$Scaffold .env.local with Cursor$seed$, $seed$Have Cursor scan the site's codebase and pre-create .env.local with every environment variable the project actually reads, so you only fill in values.$seed$, $seed$[{"label":"Scaffold .env.local prompt","text":"Scaffold my .env.local for this site. Scan the codebase for every environment variable this project actually reads (Vite client vars, server/serverless vars, build scripts, and the CMS). For each one, add a line to .env.local with the variable name and an empty or placeholder value, grouped with a short comment saying what it's for and whether it's public (VITE_-prefixed, browser-exposed) or server-only. I know this site uses Supabase, and it may use Anthropic and/or OpenAI for API calls — include those if the code references them, but do not invent variables the code doesn't use. Also confirm .env.local is gitignored. List the variables you found and where each is used."}]$seed$::jsonb, null, null, 4),
    ($seed$deployment$seed$, $seed$add-env-local-confirm-cursor$seed$, $seed$Add .env.local and confirm with Cursor$seed$, $seed$Create a .env.local file in your project root, paste the variables in.$seed$, $seed$[{"label":"Confirm setup prompt","text":"Can you check .env.local? I deployed to GitHub, Vercel and connected Supabase."}]$seed$::jsonb, null, null, 5),
    ($seed$deployment$seed$, $seed$check-run-sql-migrations$seed$, $seed$Check for and run SQL migrations$seed$, $seed$Ask Cursor whether a migration needs running. Most template sites do: the migration creates the empty tables (e.g. team_members, articles, services) with RLS that the code already expects. It runs before any content exists because schema always precedes data. If Cursor says there's no migration, skip the next step.$seed$, $seed$[{"label":"Migration check prompt","text":"OK, now we have a database — is there an SQL Editor migration I need to run in Supabase? If so, can it be a file in the root I can copy and paste the content from?"}]$seed$::jsonb, null, null, 6),
    ($seed$deployment$seed$, $seed$run-migration-in-supabase$seed$, $seed$Run migration in Supabase$seed$, $seed$Open the migration file at the repo root (e.g. supabase-migration.sql), copy the whole file, paste into Supabase → SQL Editor → New query, and Run. Success looks like 'Success. No rows returned.' Confirm the tables appear under Table Editor.$seed$, $seed$[]$seed$::jsonb, null, null, 7),
    ($seed$deployment$seed$, $seed$add-custom-domain-in-vercel$seed$, $seed$Add custom domain in Vercel$seed$, $seed$Go to Vercel, add your custom domain.$seed$, $seed$[]$seed$::jsonb, null, null, 8),
    ($seed$deployment$seed$, $seed$update-dns-records$seed$, $seed$Update DNS records$seed$, $seed$Paste the DNS records Vercel gives you into your domain host's settings.$seed$, $seed$[]$seed$::jsonb, null, null, 9),
    ($seed$deployment$seed$, $seed$commit-and-push$seed$, $seed$Commit and push$seed$, $seed$Commit any remaining changes and push.$seed$, $seed$[]$seed$::jsonb, null, null, 10),
    ($seed$deployment$seed$, $seed$verify-live-deployment$seed$, $seed$Verify live deployment$seed$, $seed$Confirm the site loads on your custom domain with SSL active.$seed$, $seed$[]$seed$::jsonb, null, null, 11),
    ($seed$site-activation$seed$, $seed$build-site-content-from-chatgpt$seed$, $seed$Write and implement the site content$seed$, $seed$Open Narrative Composer, copy the ChatGPT prompt, attach company-data.md and send. Save the full response. Then open Implement content, copy the Cursor prompt, and paste it into Cursor with ChatGPT's full response below it. Wait for a clean build and the report.$seed$, $seed$[]$seed$::jsonb, $seed$/company/:companyId/site-content-builder$seed$, $seed$Open Narrative Composer →$seed$, 0),
    ($seed$site-activation$seed$, $seed$set-publish-destination$seed$, $seed$Set Publish Destination in Company Data$seed$, $seed$In TNV → Company Data → Publish Destination, fill three fields. (1) GitHub owner = your GitHub username. (2) GitHub repo = the destination site repo name (e.g. perfect-ai-websites). (3) Token key = a SHORT UPPERCASE LABEL you invent, e.g. PERFECTAI. This is NOT the token — it is only a name. TNV will look for an environment variable named GITHUB_TOKEN_<label> (e.g. GITHUB_TOKEN_PERFECTAI). Do NOT paste the actual github_pat_... token into this field — that is the most common mistake and produces a 'GITHUB_TOKEN_github_pat_... is not set' error. Save.$seed$, $seed$[]$seed$::jsonb, $seed$/company/:companyId/company-data$seed$, $seed$Open Company Data →$seed$, 1),
    ($seed$site-activation$seed$, $seed$create-publish-pat$seed$, $seed$Create the GitHub publish token$seed$, $seed$Create the token on GitHub: avatar (top-right) → Settings → Developer settings (bottom of left sidebar) → Personal access tokens → Fine-grained tokens → Generate new token. Set: name (e.g. perfect-ai-publish); expiration = longest allowed (record the date — publish silently 401s when it lapses); resource owner = your personal account; Repository access = Only select repositories → the single destination repo; Permissions → Repository permissions → Contents = Read and write, AND Pull requests = Read and write, everything else No access. Generate, then COPY the github_pat_ value immediately — GitHub shows it only once. Treat it as a secret: never paste it into a screenshot, chat, or the Company Data field.$seed$, $seed$[]$seed$::jsonb, null, null, 2),
    ($seed$site-activation$seed$, $seed$add-publish-pat-to-tnv-env$seed$, $seed$Add the token to TNV's environment$seed$, $seed$Put the token where the publish function actually reads it. IMPORTANT: publishing must be done from the DEPLOYED/LIVE TNV (the Vercel URL), not from a local `npm run dev` — plain local dev does NOT run the /api publish function, so publish only works on the deployed site. The token therefore lives in TNV's Vercel environment, NOT in a local .env file. In TNV's Vercel project → Settings → Environment Variables, add a variable named GITHUB_TOKEN_<LABEL> (matching the Company Data label exactly, e.g. GITHUB_TOKEN_PERFECTAI) with the github_pat_ value as its content. Enable it for the Production environment. Then REDEPLOY TNV — Vercel only loads env vars at deploy time, so a newly added variable is invisible until you redeploy. After redeploy, run the pillar/cluster publish from the live TNV URL.$seed$, $seed$[]$seed$::jsonb, null, null, 3),
    ($seed$site-activation$seed$, $seed$confirm-default-author-on-site$seed$, $seed$Confirm the default author exists on the site$seed$, $seed$Publishing stamps every article with author id 'dori-fussmann' (the current universal default). The Astro template FAILS the build if that author id doesn't exist in the site's team/author data. Confirm the destination site has a team member resolving to 'dori-fussmann' before publishing; if not, add it and rebuild.$seed$, $seed$[]$seed$::jsonb, null, null, 4),
    ($seed$site-activation$seed$, $seed$plan-topics-in-topic-generator$seed$, $seed$Plan clusters in Cluster Generation$seed$, $seed$In TNV → Cluster Generation, pillar and supporting keywords from Company Data appear as the pillar→cluster tree. Plan the clusters you want to seed; coverage is the input for generation.$seed$, $seed$[]$seed$::jsonb, $seed$/company/:companyId/article-generation$seed$, $seed$Open Cluster Generation →$seed$, 5),
    ($seed$site-activation$seed$, $seed$generate-and-publish-articles$seed$, $seed$Generate articles (with images) and publish$seed$, $seed$In TNV → Cluster Generation, select a supporting cluster and click Generate (pillar article must already be published). Images are on by default. When generation completes, the run commits to the site automatically, then offers to wire internal links.$seed$, $seed$[]$seed$::jsonb, $seed$/company/:companyId/article-generation$seed$, $seed$Open Cluster Generation →$seed$, 6),
    ($seed$site-activation$seed$, $seed$verify-articles-live$seed$, $seed$Verify articles are live$seed$, $seed$After the merge and rebuild, confirm: the articles appear on the live site, each has its hero image, the author resolves (no broken author link), and the articles are present in the sitemap and RSS. Check the publish result for any 'skipped' entries (missing hero or body) and re-run those if needed.$seed$, $seed$[]$seed$::jsonb, null, null, 7),
    ($seed$site-activation$seed$, $seed$commit-and-push$seed$, $seed$Commit and push$seed$, $seed$Commit and push the changes.$seed$, $seed$[]$seed$::jsonb, null, null, 8),
    ($seed$site-activation$seed$, $seed$review-the-live-site$seed$, $seed$Review the live site$seed$, $seed$Visit your live custom domain and do a quick visual review.$seed$, $seed$[]$seed$::jsonb, null, null, 9),
    ($seed$site-activation$seed$, $seed$determine-supporting-keywords$seed$, $seed$Determine supporting keywords$seed$, $seed$For each pillar, work out supporting keywords (currently a manual process via Claude) and add them under the relevant pillar in Company Data.$seed$, $seed$[]$seed$::jsonb, null, null, 10),
    ($seed$site-activation$seed$, $seed$plan-both-clusters$seed$, $seed$Plan both clusters$seed$, $seed$In Cluster Generation, choose one supporting-keyword cluster per pillar and click Plan for both, pasting the matching Keyword Slip results into 'Keyword data (optional)' for each.$seed$, $seed$[]$seed$::jsonb, null, null, 11),
    ($seed$site-activation$seed$, $seed$save-and-download-both-clusters$seed$, $seed$Save and download both clusters$seed$, $seed$Confirm each cluster, Save it, and also use the Save option in the top-right of the page. Download the .md for both clusters.$seed$, $seed$[]$seed$::jsonb, null, null, 12),
    ($seed$site-activation$seed$, $seed$plan-and-save-both-pillar-articles$seed$, $seed$Plan and save both pillar articles$seed$, $seed$Do the same Plan → Save → Download flow for both Pillar Articles (no keyword data needed for these).$seed$, $seed$[]$seed$::jsonb, null, null, 13),
    ($seed$site-activation$seed$, $seed$generate-all-articles$seed$, $seed$Generate all articles$seed$, $seed$In Cluster Generation, generate each supporting cluster and both pillar articles via Pillar Generation — expect roughly 10 total files (2 pillar articles + supporting cluster articles).$seed$, $seed$[]$seed$::jsonb, null, null, 14),
    ($seed$site-activation$seed$, $seed$generate-hero-images$seed$, $seed$Generate hero images$seed$, $seed$Use the image generation tool to create hero image(s) for both pillar articles and for each cluster (one image can cover all articles within a single cluster).$seed$, $seed$[]$seed$::jsonb, null, null, 15),
    ($seed$site-activation$seed$, $seed$add-real-team-member-in-cms$seed$, $seed$Add a real team member in the CMS$seed$, $seed$Run npm run cms in the site's terminal. Go to Team first and add a real team member before publishing any articles.$seed$, $seed$[]$seed$::jsonb, null, null, 16),
    ($seed$site-activation$seed$, $seed$publish-all-articles-through-cms$seed$, $seed$Publish all articles through the CMS$seed$, $seed$For all ~10 articles: drag & drop the .md, choose the real author, upload the hero image, generate, and publish.$seed$, $seed$[]$seed$::jsonb, null, null, 17),
    ($seed$site-activation$seed$, $seed$commit-and-push-seed$seed$, $seed$Commit and push$seed$, $seed$Commit and push all changes.$seed$, $seed$[]$seed$::jsonb, null, null, 18),
    ($seed$connection-layer$seed$, $seed$verify-google-search-console$seed$, $seed$Verify Google Search Console$seed$, $seed$Add and verify a Domain property in Google Search Console for your live domain (verified through DNS). If you use a URL-prefix property with the HTML tag method instead, put the tag's token in Vercel → Settings → Environment Variables as PUBLIC_SEARCH_CONSOLE_VERIFICATION (Production), redeploy, then click Verify.$seed$, $seed$[]$seed$::jsonb, null, null, 0),
    ($seed$connection-layer$seed$, $seed$submit-sitemap-google-search-console$seed$, $seed$Submit sitemap to Google Search Console$seed$, $seed$In Search Console, go to Sitemaps, submit sitemap.xml (e.g. https://yourdomain.com/sitemap.xml). Confirm it shows 'Success' status and a discovered URL count roughly matching your published page count.$seed$, $seed$[]$seed$::jsonb, null, null, 1),
    ($seed$connection-layer$seed$, $seed$verify-bing-webmaster-tools$seed$, $seed$Verify Bing Webmaster Tools$seed$, $seed$Add your site to Bing Webmaster Tools — can import directly from Search Console.$seed$, $seed$[]$seed$::jsonb, null, null, 2),
    ($seed$connection-layer$seed$, $seed$submit-sitemap-bing-webmaster-tools$seed$, $seed$Submit sitemap to Bing Webmaster Tools$seed$, $seed$In Bing Webmaster Tools, submit the same sitemap.xml URL. If you imported from Search Console, check whether the sitemap carried over automatically — if not, add it manually.$seed$, $seed$[]$seed$::jsonb, null, null, 3),
    ($seed$connection-layer$seed$, $seed$install-analytics$seed$, $seed$Install Analytics$seed$, $seed$For Google Analytics 4: create a web data stream for the live domain, copy its measurement ID (G-…), add it in Vercel → Settings → Environment Variables as PUBLIC_ANALYTICS_ID (Production) and redeploy. The template adds the tag to every page. Confirm visits appear in GA4 Realtime. For another tool, install it and confirm it receives real traffic.$seed$, $seed$[]$seed$::jsonb, null, null, 4),
    ($seed$connection-layer$seed$, $seed$run-pagespeed-baseline$seed$, $seed$Run a Google PageSpeed Insights baseline$seed$, $seed$Run your live homepage and one article through pagespeed.web.dev and record the scores as a baseline.$seed$, $seed$[]$seed$::jsonb, null, null, 5),
    ($seed$connection-layer$seed$, $seed$install-microsoft-clarity$seed$, $seed$Install Microsoft Clarity (optional)$seed$, $seed$If you want session recording/heatmaps, install the Clarity tracking snippet.$seed$, $seed$[]$seed$::jsonb, null, null, 6),
    ($seed$connection-layer$seed$, $seed$run-gtmetrix-baseline$seed$, $seed$Run a GTmetrix baseline$seed$, $seed$Run your live site through GTmetrix and record the baseline scores.$seed$, $seed$[]$seed$::jsonb, null, null, 7),
    ($seed$links-wiring$seed$, $seed$go-to-seo-destination-site$seed$, $seed$Go to SEO Destination Site$seed$, $seed$Open the destination SEO site project (local repo) that you are wiring links for.$seed$, $seed$[]$seed$::jsonb, null, null, 0),
    ($seed$links-wiring$seed$, $seed$run-npm-run-cms$seed$, $seed$Run npm run cms$seed$, $seed$In the destination site terminal, run npm run cms and open the CMS URL it gives you.$seed$, $seed$[]$seed$::jsonb, null, null, 1),
    ($seed$links-wiring$seed$, $seed$go-to-articles-health-tools$seed$, $seed$Go to Articles Health Tools$seed$, $seed$In the CMS, open Articles Health Tools.$seed$, $seed$[]$seed$::jsonb, null, null, 2),
    ($seed$links-wiring$seed$, $seed$scan-and-wire-links$seed$, $seed$Scan articles and wire all Internal Links and External Links$seed$, $seed$Scan articles and wire all Internal Links and External Links so every article is fully linked.$seed$, $seed$[]$seed$::jsonb, null, null, 3),
    ($seed$links-wiring$seed$, $seed$publish$seed$, $seed$Publish$seed$, $seed$Publish all articles after links have been wired.$seed$, $seed$[]$seed$::jsonb, null, null, 4),
    ($seed$links-wiring$seed$, $seed$commit-and-push$seed$, $seed$Commit and Push$seed$, $seed$Commit the link wiring changes and push to the remote repo.$seed$, $seed$[]$seed$::jsonb, null, null, 5),
    ($seed$links-wiring$seed$, $seed$deploy$seed$, $seed$Deploy$seed$, $seed$Deploy so the wired links go live (or confirm the push triggered a deploy).$seed$, $seed$[]$seed$::jsonb, null, null, 6),
    ($seed$links-wiring$seed$, $seed$quick-check-live-site$seed$, $seed$Quick Check on live site$seed$, $seed$Spot-check the live site: open a few articles and confirm internal and external links work as expected.$seed$, $seed$[]$seed$::jsonb, null, null, 7),
    ($seed$seed-qa$seed$, $seed$check-title-h1-hero$seed$, $seed$Check title, H1, and hero on every article$seed$, $seed$For each published article: confirm the browser tab title, the on-page H1, and the hero image all render correctly and match the article.$seed$, $seed$[]$seed$::jsonb, null, null, 0),
    ($seed$seed-qa$seed$, $seed$check-meta-tags$seed$, $seed$Check meta tags on every article$seed$, $seed$View-source each article: confirm meta description, canonical URL, OG tags, and robots tag are all present and correct.$seed$, $seed$[]$seed$::jsonb, null, null, 1),
    ($seed$seed-qa$seed$, $seed$run-rich-results-test$seed$, $seed$Run the Rich Results Test$seed$, $seed$Paste at least one live article URL into search.google.com/test/rich-results and confirm it passes with zero errors.$seed$, $seed$[]$seed$::jsonb, null, null, 2),
    ($seed$seed-qa$seed$, $seed$click-through-internal-links$seed$, $seed$Click through every internal link$seed$, $seed$On each article, click every internal link and confirm it resolves (200), not a 404.$seed$, $seed$[]$seed$::jsonb, null, null, 3),
    ($seed$seed-qa$seed$, $seed$click-through-external-links$seed$, $seed$Click through every external link$seed$, $seed$On each article, click every external source link and confirm it opens correctly.$seed$, $seed$[]$seed$::jsonb, null, null, 4),
    ($seed$seed-qa$seed$, $seed$confirm-sitemap-inclusion$seed$, $seed$Confirm sitemap inclusion$seed$, $seed$Check that every published article appears in sitemap.xml with a sensible lastmod date.$seed$, $seed$[]$seed$::jsonb, null, null, 5),
    ($seed$seed-qa$seed$, $seed$confirm-articles-listing$seed$, $seed$Confirm articles listing$seed$, $seed$Confirm every published article appears correctly on the site's /articles/ listing page.$seed$, $seed$[]$seed$::jsonb, null, null, 6);
end
$do$;
