/** Predefined Site Build Flow stages and items (seeded per company on first load). */

export const STATUSES = ["open", "wip", "done"];

export const STATUS_META = {
  open: {
    label: "Open",
    className:
      "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900",
  },
  wip: {
    label: "WIP",
    className:
      "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900",
  },
  done: {
    label: "Done",
    className:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  },
};

export function nextStatus(current) {
  const index = STATUSES.indexOf(current);
  return STATUSES[(index + 1) % STATUSES.length];
}

export const STAGES = [
  { stage_key: "code-setup", name: "Code Setup", order_index: 0 },
  { stage_key: "seed-articles-content", name: "Seed Articles Content", order_index: 1 },
  { stage_key: "deployment", name: "Deployment", order_index: 2 },
  { stage_key: "site-activation", name: "Site Activation", order_index: 3 },
  { stage_key: "connection-layer", name: "Connection Layer", order_index: 4 },
  { stage_key: "links-wiring", name: "Links Wiring", order_index: 5 },
  { stage_key: "seed-qa", name: "Initial Seed Content QA", order_index: 6 },
];

const FILL_FIELDS_PROMPT =
  "Help me fill the missing fields for the new company, based on what I have provided you with - ask me all the questions you need to complete the fields. Give me in each turn a summary % completion, how many done and how many we have left. Be thorough, precise and super professional. Available to download as .md file";

const PUBLISH_DESTINATION_INSTRUCTIONS = `In Company Intelligence, open Publish Destination and add the 3 fields: GitHub owner, GitHub repo, and GitHub token key.

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

Secret hygiene: the github_pat_… value goes only into the Vercel Environment Variable. Never paste it into a screenshot, a chat, or the Company Data field — that field takes the KEY (a pointer), never the token itself.`;

export const PREDEFINED_ITEMS = {
  "code-setup": [
    {
      item_key: "add-new-company",
      title: "Add a new company and the details you have",
      description:
        "In The Night Ventures, add a new company and enter the basic details you already have.",
      prompts: [],
      linkTo: "/",
      linkLabel: "Open Companies →",
    },
    {
      item_key: "download-company-intelligence",
      title: "Download Company Intelligence as Markdown",
      description:
        "In Company Intelligence, once you have added all the details you have, click Download as Markdown.",
      prompts: [],
      linkTo: "/company/:companyId/company-data",
      linkLabel: "Open Company Intelligence →",
    },
    {
      item_key: "fill-missing-fields-in-chatgpt",
      title: "Fill the missing fields in ChatGPT",
      description:
        "Upload the Company Intelligence markdown to ChatGPT and run the prompt. ChatGPT asks the questions it needs to complete the fields. The output is a markdown file you download.",
      prompts: [
        {
          label: "LLM prompt to help fill fields",
          text: FILL_FIELDS_PROMPT,
        },
      ],
    },
    {
      item_key: "upload-completed-company-intelligence",
      title: "Upload the completed Company Intelligence file",
      description:
        "Drag and drop the completed ChatGPT Company Intelligence .md file onto Company Intelligence and let it fill the missing fields.",
      prompts: [],
      linkTo: "/company/:companyId/company-data",
      linkLabel: "Open Company Intelligence →",
    },
    {
      item_key: "create-github-repo-from-template",
      title: "Create a GitHub repo from the SEO Blueprint template",
      description:
        "On GitHub, create a new repository from the SEO Blueprint template.",
      prompts: [],
    },
    {
      item_key: "create-local-project-folder",
      title: "Create a local project folder",
      description:
        "On your desktop, create a new folder under your development Cursor zone.",
      prompts: [],
    },
    {
      item_key: "clone-repo-and-add-design-guide",
      title: "Clone the repo",
      description:
        "Open a new Cursor project for that folder. Tell the agent to git clone the GitHub URL into the folder root (not a subfolder). Leave site/Design Guide.md as it is for now — the design is applied after the content. Run npm run build to confirm it passes, then commit and push.",
      prompts: [],
    },
    {
      item_key: "follow-narrative-composer",
      title: "Write the site content in ChatGPT",
      description:
        "Open Narrative Composer, copy the ChatGPT prompt, attach company-data.md and send. Save the full response.",
      prompts: [],
      linkTo: "/company/:companyId/site-content-builder",
      linkLabel: "Open Narrative Composer →",
    },
    {
      item_key: "paste-site-content-into-cursor",
      title: "Implement the content in Cursor",
      description:
        "Open Implement content, copy the Cursor prompt, paste it into Cursor with ChatGPT's full response below it. Wait for a clean build and the report.",
      prompts: [],
      linkTo: "/company/:companyId/site-content-build",
      linkLabel: "Open Implement content →",
    },
    {
      item_key: "pick-design",
      title: "Pick your design and generate the guide",
      description:
        "Open Design. Pick one of the 6 directions, optionally tick Force Inter and/or Force no bold, set the brand accent and wordmark if needed, and check the preview. Click Generate design guide. Download DESIGN_GUIDE.md and copy the Cursor prompt.",
      prompts: [],
      linkTo: "/company/:companyId/design-guide-builder",
      linkLabel: "Open Design →",
    },
    {
      item_key: "apply-design-in-cursor",
      title: "Apply the design in Cursor",
      description:
        "Drag DESIGN_GUIDE.md into the repository root (next to the site/ folder, not inside it). Paste the Cursor prompt from Design into Cursor and send. Wait for a clean npm run build and the report, check the site at mobile and desktop width, then commit and push.",
      prompts: [],
      linkTo: "/company/:companyId/design-guide-builder",
      linkLabel: "Open Design →",
    },
    {
      item_key: "review-and-remove-pages",
      title: "Review pages and clean up",
      description:
        "Run the site locally and read every page. Delete pages you don't want: remove site/src/content/pages/<page>.yaml and its link from NAV or the footer in site/src/config/site.ts. Never remove Articles, Privacy or Terms. Replace testimonial placeholders with real quotes or delete the Testimonials page. Have Privacy and Terms reviewed. Resolve every [GAP] line. For each image brief, generate or source the image, save it in site/src/assets/, and add its path as src next to the brief in the page YAML. Build, commit and push.",
      prompts: [],
    },
    {
      item_key: "set-publish-destination",
      title: "Set Publish Destination",
      description: PUBLISH_DESTINATION_INSTRUCTIONS,
      prompts: [],
      linkTo: "/company/:companyId/company-data",
      linkLabel: "Open Company Intelligence →",
    },
    {
      item_key: "update-core-version",
      title: "Update Core Version",
      description:
        "Go to Admin → Core Version, wait for the scan on the live deployed site, and update the version.",
      prompts: [],
      linkTo: "/company/:companyId/core-version",
      linkLabel: "Open Core Version →",
    },
    {
      item_key: "website-ready",
      title: "You have a website",
      description:
        "That's it. You now have a website locally, with content and design based on your input, and the ability to publish and update from TNV.",
      prompts: [],
    },
  ],
  "seed-articles-content": [
    {
      item_key: "advisor-general-seo-research",
      title: "Run general SEO research and the approach",
      description:
        "Use the Advisor tool to conduct general SEO research about the site, and the SEO approach.",
      prompts: [],
      linkTo: "/company/:companyId/seo-ai-advisor",
      linkLabel: "Open Advisor →",
    },
    {
      item_key: "advisor-pillar-research",
      title: "Research, confirm, and save pillars",
      description:
        "Use the Advisor tool to conduct research on the Pillar Articles. Confirm and save each pillar.",
      prompts: [],
      linkTo: "/company/:companyId/seo-ai-advisor",
      linkLabel: "Open Advisor →",
    },
    {
      item_key: "advisor-cluster-research",
      title: "Research, confirm, and save clusters",
      description:
        "Use the Advisor tool to conduct research on the Clusters and Supporting Keywords. Do them one by one. Confirm and save one by one.",
      prompts: [],
      linkTo: "/company/:companyId/seo-ai-advisor",
      linkLabel: "Open Advisor →",
    },
    {
      item_key: "generate-publish-all-pillars",
      title: "Generate and publish all pillar articles",
      description:
        "Go to Generation in Build → Pillar, and click Generate & publish all. One click plans, generates, and publishes a pillar article for every pillar that doesn’t have one yet.",
      prompts: [],
      linkTo: "/company/:companyId/pillar-automation",
      linkLabel: "Open Pillar Generation →",
    },
    {
      item_key: "generate-publish-all-clusters",
      title: "Generate and publish all cluster articles",
      description:
        "Go to Generation in Build → Cluster, and click Generate & publish all. One click plans, generates, and publishes one supporting cluster for each published pillar that doesn’t have one yet.",
      prompts: [],
      linkTo: "/company/:companyId/article-generation",
      linkLabel: "Open Cluster Generation →",
    },
    {
      item_key: "review-articles-locally",
      title: "Review the articles locally",
      description:
        "Run npm run dev on the new site, navigate to articles, and check them out. Confirm everything looks legit.",
      prompts: [],
    },
  ],
  deployment: [
    {
      item_key: "push-to-github",
      title: "Push to GitHub",
      description:
        "The remote already exists from the template clone. In Cursor, commit remaining local changes and push to that repo.",
      prompts: [
        {
          label: "Push command (edit URL if needed)",
          text: "Push to GitHub, https://github.com/[your-username]/[your-repo-name]",
        },
      ],
    },
    {
      item_key: "create-vercel-project",
      title: "Create Vercel project",
      description:
        "Go to Vercel, Add New > Project. It should auto-detect the pushed repo.",
      prompts: [],
    },
    {
      item_key: "create-supabase-database",
      title: "Create Supabase database",
      description:
        "Once deployed, go to Vercel Storage, Create Database > Supabase.",
      prompts: [],
    },
    {
      item_key: "copy-supabase-env-variables",
      title: "Copy Supabase env variables",
      description:
        "From Vercel Storage, go to Getting Started, copy the .env variables for Supabase.",
      prompts: [],
    },
    {
      item_key: "scaffold-env-local",
      title: "Scaffold .env.local with Cursor",
      description:
        "Have Cursor scan the site's codebase and pre-create .env.local with every environment variable the project actually reads, so you only fill in values.",
      prompts: [
        {
          label: "Scaffold .env.local prompt",
          text: "Scaffold my .env.local for this site. Scan the codebase for every environment variable this project actually reads (Vite client vars, server/serverless vars, build scripts, and the CMS). For each one, add a line to .env.local with the variable name and an empty or placeholder value, grouped with a short comment saying what it's for and whether it's public (VITE_-prefixed, browser-exposed) or server-only. I know this site uses Supabase, and it may use Anthropic and/or OpenAI for API calls — include those if the code references them, but do not invent variables the code doesn't use. Also confirm .env.local is gitignored. List the variables you found and where each is used.",
        },
      ],
    },
    {
      item_key: "add-env-local-confirm-cursor",
      title: "Add .env.local and confirm with Cursor",
      description:
        "Create a .env.local file in your project root, paste the variables in.",
      prompts: [
        {
          label: "Confirm setup prompt",
          text: "Can you check .env.local? I deployed to GitHub, Vercel and connected Supabase.",
        },
      ],
    },
    {
      item_key: "check-run-sql-migrations",
      title: "Check for and run SQL migrations",
      description:
        "Ask Cursor whether a migration needs running. Most template sites do: the migration creates the empty tables (e.g. team_members, articles, services) with RLS that the code already expects. It runs before any content exists because schema always precedes data. If Cursor says there's no migration, skip the next step.",
      prompts: [
        {
          label: "Migration check prompt",
          text: "OK, now we have a database — is there an SQL Editor migration I need to run in Supabase? If so, can it be a file in the root I can copy and paste the content from?",
        },
      ],
    },
    {
      item_key: "run-migration-in-supabase",
      title: "Run migration in Supabase",
      description:
        "Open the migration file at the repo root (e.g. supabase-migration.sql), copy the whole file, paste into Supabase → SQL Editor → New query, and Run. Success looks like 'Success. No rows returned.' Confirm the tables appear under Table Editor.",
      prompts: [],
    },
    {
      item_key: "add-custom-domain-in-vercel",
      title: "Add custom domain in Vercel",
      description: "Go to Vercel, add your custom domain.",
      prompts: [],
    },
    {
      item_key: "update-dns-records",
      title: "Update DNS records",
      description:
        "Paste the DNS records Vercel gives you into your domain host's settings.",
      prompts: [],
    },
    {
      item_key: "commit-and-push",
      title: "Commit and push",
      description: "Commit any remaining changes and push.",
      prompts: [],
    },
    {
      item_key: "verify-live-deployment",
      title: "Verify live deployment",
      description:
        "Confirm the site loads on your custom domain with SSL active.",
      prompts: [],
    },
  ],
  "site-activation": [
    {
      item_key: "build-site-content-from-chatgpt",
      title: "Write and implement the site content",
      description:
        "Open Narrative Composer, copy the ChatGPT prompt, attach company-data.md and send. Save the full response. Then open Implement content, copy the Cursor prompt, and paste it into Cursor with ChatGPT's full response below it. Wait for a clean build and the report.",
      prompts: [],
      linkTo: "/company/:companyId/site-content-builder",
      linkLabel: "Open Narrative Composer →",
    },
    {
      item_key: "set-publish-destination",
      title: "Set Publish Destination in Company Data",
      description:
        "In TNV → Company Data → Publish Destination, fill three fields. (1) GitHub owner = your GitHub username. (2) GitHub repo = the destination site repo name (e.g. perfect-ai-websites). (3) Token key = a SHORT UPPERCASE LABEL you invent, e.g. PERFECTAI. This is NOT the token — it is only a name. TNV will look for an environment variable named GITHUB_TOKEN_<label> (e.g. GITHUB_TOKEN_PERFECTAI). Do NOT paste the actual github_pat_... token into this field — that is the most common mistake and produces a 'GITHUB_TOKEN_github_pat_... is not set' error. Save.",
      prompts: [],
      linkTo: "/company/:companyId/company-data",
      linkLabel: "Open Company Data →",
    },
    {
      item_key: "create-publish-pat",
      title: "Create the GitHub publish token",
      description:
        "Create the token on GitHub: avatar (top-right) → Settings → Developer settings (bottom of left sidebar) → Personal access tokens → Fine-grained tokens → Generate new token. Set: name (e.g. perfect-ai-publish); expiration = longest allowed (record the date — publish silently 401s when it lapses); resource owner = your personal account; Repository access = Only select repositories → the single destination repo; Permissions → Repository permissions → Contents = Read and write, AND Pull requests = Read and write, everything else No access. Generate, then COPY the github_pat_ value immediately — GitHub shows it only once. Treat it as a secret: never paste it into a screenshot, chat, or the Company Data field.",
      prompts: [],
    },
    {
      item_key: "add-publish-pat-to-tnv-env",
      title: "Add the token to TNV's environment",
      description:
        "Put the token where the publish function actually reads it. IMPORTANT: publishing must be done from the DEPLOYED/LIVE TNV (the Vercel URL), not from a local `npm run dev` — plain local dev does NOT run the /api publish function, so publish only works on the deployed site. The token therefore lives in TNV's Vercel environment, NOT in a local .env file. In TNV's Vercel project → Settings → Environment Variables, add a variable named GITHUB_TOKEN_<LABEL> (matching the Company Data label exactly, e.g. GITHUB_TOKEN_PERFECTAI) with the github_pat_ value as its content. Enable it for the Production environment. Then REDEPLOY TNV — Vercel only loads env vars at deploy time, so a newly added variable is invisible until you redeploy. After redeploy, run the pillar/cluster publish from the live TNV URL.",
      prompts: [],
    },
    {
      item_key: "confirm-default-author-on-site",
      title: "Confirm the default author exists on the site",
      description:
        "Publishing stamps every article with author id 'dori-fussmann' (the current universal default). The Astro template FAILS the build if that author id doesn't exist in the site's team/author data. Confirm the destination site has a team member resolving to 'dori-fussmann' before publishing; if not, add it and rebuild.",
      prompts: [],
    },
    {
      item_key: "plan-topics-in-topic-generator",
      title: "Plan clusters in Cluster Generation",
      description:
        "In TNV → Cluster Generation, pillar and supporting keywords from Company Data appear as the pillar→cluster tree. Plan the clusters you want to seed; coverage is the input for generation.",
      prompts: [],
      linkTo: "/company/:companyId/article-generation",
      linkLabel: "Open Cluster Generation →",
    },
    {
      item_key: "generate-and-publish-articles",
      title: "Generate articles (with images) and publish",
      description:
        "In TNV → Cluster Generation, select a supporting cluster and click Generate (pillar article must already be published). Images are on by default. When generation completes, the run commits to the site automatically, then offers to wire internal links.",
      prompts: [],
      linkTo: "/company/:companyId/article-generation",
      linkLabel: "Open Cluster Generation →",
    },
    {
      item_key: "verify-articles-live",
      title: "Verify articles are live",
      description:
        "After the merge and rebuild, confirm: the articles appear on the live site, each has its hero image, the author resolves (no broken author link), and the articles are present in the sitemap and RSS. Check the publish result for any 'skipped' entries (missing hero or body) and re-run those if needed.",
      prompts: [],
    },
    {
      item_key: "commit-and-push",
      title: "Commit and push",
      description: "Commit and push the changes.",
      prompts: [],
    },
    {
      item_key: "review-the-live-site",
      title: "Review the live site",
      description:
        "Visit your live custom domain and do a quick visual review.",
      prompts: [],
    },
    {
      item_key: "determine-supporting-keywords",
      title: "Determine supporting keywords",
      description:
        "For each pillar, work out supporting keywords (currently a manual process via Claude) and add them under the relevant pillar in Company Data.",
      prompts: [],
    },
    {
      item_key: "plan-both-clusters",
      title: "Plan both clusters",
      description:
        "In Cluster Generation, choose one supporting-keyword cluster per pillar and click Plan for both, pasting the matching Keyword Slip results into 'Keyword data (optional)' for each.",
      prompts: [],
    },
    {
      item_key: "save-and-download-both-clusters",
      title: "Save and download both clusters",
      description:
        "Confirm each cluster, Save it, and also use the Save option in the top-right of the page. Download the .md for both clusters.",
      prompts: [],
    },
    {
      item_key: "plan-and-save-both-pillar-articles",
      title: "Plan and save both pillar articles",
      description:
        "Do the same Plan → Save → Download flow for both Pillar Articles (no keyword data needed for these).",
      prompts: [],
    },
    {
      item_key: "generate-all-articles",
      title: "Generate all articles",
      description:
        "In Cluster Generation, generate each supporting cluster and both pillar articles via Pillar Generation — expect roughly 10 total files (2 pillar articles + supporting cluster articles).",
      prompts: [],
    },
    {
      item_key: "generate-hero-images",
      title: "Generate hero images",
      description:
        "Use the image generation tool to create hero image(s) for both pillar articles and for each cluster (one image can cover all articles within a single cluster).",
      prompts: [],
    },
    {
      item_key: "add-real-team-member-in-cms",
      title: "Add a real team member in the CMS",
      description:
        "Run npm run cms in the site's terminal. Go to Team first and add a real team member before publishing any articles.",
      prompts: [],
    },
    {
      item_key: "publish-all-articles-through-cms",
      title: "Publish all articles through the CMS",
      description:
        "For all ~10 articles: drag & drop the .md, choose the real author, upload the hero image, generate, and publish.",
      prompts: [],
    },
    {
      item_key: "commit-and-push-seed",
      title: "Commit and push",
      description: "Commit and push all changes.",
      prompts: [],
    },
  ],
  "connection-layer": [
    {
      item_key: "verify-google-search-console",
      title: "Verify Google Search Console",
      description:
        "Add and verify a Domain property in Google Search Console for your live domain.",
      prompts: [],
    },
    {
      item_key: "submit-sitemap-google-search-console",
      title: "Submit sitemap to Google Search Console",
      description:
        "In Search Console, go to Sitemaps, submit sitemap.xml (e.g. https://yourdomain.com/sitemap.xml). Confirm it shows 'Success' status and a discovered URL count roughly matching your published page count.",
      prompts: [],
    },
    {
      item_key: "verify-bing-webmaster-tools",
      title: "Verify Bing Webmaster Tools",
      description:
        "Add your site to Bing Webmaster Tools — can import directly from Search Console.",
      prompts: [],
    },
    {
      item_key: "submit-sitemap-bing-webmaster-tools",
      title: "Submit sitemap to Bing Webmaster Tools",
      description:
        "In Bing Webmaster Tools, submit the same sitemap.xml URL. If you imported from Search Console, check whether the sitemap carried over automatically — if not, add it manually.",
      prompts: [],
    },
    {
      item_key: "install-analytics",
      title: "Install Analytics",
      description:
        "Install your analytics tool of choice and confirm it's receiving real traffic data.",
      prompts: [],
    },
    {
      item_key: "run-pagespeed-baseline",
      title: "Run a Google PageSpeed Insights baseline",
      description:
        "Run your live homepage and one article through pagespeed.web.dev and record the scores as a baseline.",
      prompts: [],
    },
    {
      item_key: "install-microsoft-clarity",
      title: "Install Microsoft Clarity (optional)",
      description:
        "If you want session recording/heatmaps, install the Clarity tracking snippet.",
      prompts: [],
    },
    {
      item_key: "run-gtmetrix-baseline",
      title: "Run a GTmetrix baseline",
      description:
        "Run your live site through GTmetrix and record the baseline scores.",
      prompts: [],
    },
  ],
  "links-wiring": [
    {
      item_key: "go-to-seo-destination-site",
      title: "Go to SEO Destination Site",
      description:
        "Open the destination SEO site project (local repo) that you are wiring links for.",
      prompts: [],
    },
    {
      item_key: "run-npm-run-cms",
      title: "Run npm run cms",
      description:
        "In the destination site terminal, run npm run cms and open the CMS URL it gives you.",
      prompts: [],
    },
    {
      item_key: "go-to-articles-health-tools",
      title: "Go to Articles Health Tools",
      description: "In the CMS, open Articles Health Tools.",
      prompts: [],
    },
    {
      item_key: "scan-and-wire-links",
      title: "Scan articles and wire all Internal Links and External Links",
      description:
        "Scan articles and wire all Internal Links and External Links so every article is fully linked.",
      prompts: [],
    },
    {
      item_key: "publish",
      title: "Publish",
      description: "Publish all articles after links have been wired.",
      prompts: [],
    },
    {
      item_key: "commit-and-push",
      title: "Commit and Push",
      description: "Commit the link wiring changes and push to the remote repo.",
      prompts: [],
    },
    {
      item_key: "deploy",
      title: "Deploy",
      description: "Deploy so the wired links go live (or confirm the push triggered a deploy).",
      prompts: [],
    },
    {
      item_key: "quick-check-live-site",
      title: "Quick Check on live site",
      description:
        "Spot-check the live site: open a few articles and confirm internal and external links work as expected.",
      prompts: [],
    },
  ],
  "seed-qa": [
    {
      item_key: "check-title-h1-hero",
      title: "Check title, H1, and hero on every article",
      description:
        "For each published article: confirm the browser tab title, the on-page H1, and the hero image all render correctly and match the article.",
      prompts: [],
    },
    {
      item_key: "check-meta-tags",
      title: "Check meta tags on every article",
      description:
        "View-source each article: confirm meta description, canonical URL, OG tags, and robots tag are all present and correct.",
      prompts: [],
    },
    {
      item_key: "run-rich-results-test",
      title: "Run the Rich Results Test",
      description:
        "Paste at least one live article URL into search.google.com/test/rich-results and confirm it passes with zero errors.",
      prompts: [],
    },
    {
      item_key: "click-through-internal-links",
      title: "Click through every internal link",
      description:
        "On each article, click every internal link and confirm it resolves (200), not a 404.",
      prompts: [],
    },
    {
      item_key: "click-through-external-links",
      title: "Click through every external link",
      description:
        "On each article, click every external source link and confirm it opens correctly.",
      prompts: [],
    },
    {
      item_key: "confirm-sitemap-inclusion",
      title: "Confirm sitemap inclusion",
      description:
        "Check that every published article appears in sitemap.xml with a sensible lastmod date.",
      prompts: [],
    },
    {
      item_key: "confirm-articles-listing",
      title: "Confirm articles listing",
      description:
        "Confirm every published article appears correctly on the site's /articles/ listing page.",
      prompts: [],
    },
  ],
};

export function resolveItemLink(stageKey, itemKey, companyId) {
  if (!stageKey || !itemKey || !companyId) return null;
  const entry = (PREDEFINED_ITEMS[stageKey] || []).find(
    (item) => item.item_key === itemKey
  );
  if (!entry?.linkTo) return null;
  return {
    to: entry.linkTo.replaceAll(":companyId", companyId),
    label: entry.linkLabel || "Open →",
  };
}
