/** Predefined Site Build Flow stages and items (seeded per company on first load). */

export const STATUSES = ["open", "wip", "done"];

export const STATUS_META = {
  open: {
    label: "Open",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
  wip: {
    label: "WIP",
    className: "bg-orange-50 text-orange-700 border-orange-200",
  },
  done: {
    label: "Done",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
};

export function nextStatus(current) {
  const index = STATUSES.indexOf(current);
  return STATUSES[(index + 1) % STATUSES.length];
}

export const STAGES = [
  { stage_key: "setup", name: "Setup", order_index: 0 },
  { stage_key: "infra-qa", name: "Initial Infrastructure Build QA", order_index: 1 },
  { stage_key: "deployment", name: "Deployment", order_index: 2 },
  { stage_key: "site-activation", name: "Site Activation", order_index: 3 },
  { stage_key: "connection-layer", name: "Connection Layer", order_index: 4 },
  { stage_key: "links-wiring", name: "Links Wiring", order_index: 5 },
  { stage_key: "seed-qa", name: "Initial Seed Content QA", order_index: 6 },
];

export const PREDEFINED_ITEMS = {
  setup: [
    {
      item_key: "add-new-company-in-tnv",
      title: "Add new company in TNV",
      description:
        "In The Night Ventures, add a new company. Name can use uppercase letters and spaces here — the hyphenated lowercase name is for the GitHub repo and local folder.",
      prompts: [],
      linkTo: "/",
      linkLabel: "Open Companies →",
    },
    {
      item_key: "fill-company-data",
      title: "Fill Company Data",
      description:
        "Enter Company Data and complete every field to the best of your ability — product name, competitors, services, abstract, short/medium/long descriptions, ICP/target persona.",
      prompts: [
        {
          label: "LLM prompt to help fill fields",
          text: "I have a list of fields I am trying to fill for a new company which will provide content on an SEO site. The website is called [...], and it is aimed at providing information for [...]. I want to provide information about [...]. What I need is product name, competitors, services description, abstract, short description, medium description, long description, ICP / description of target persona.",
        },
      ],
      linkTo: "/company/:companyId/company-data",
      linkLabel: "Open Company Data →",
    },
    {
      item_key: "save-company-data",
      title: "Save Company Data",
      description: "Save once all fields are filled.",
      prompts: [],
    },
    {
      item_key: "create-github-repo-from-template",
      title: "Create GitHub repo from template",
      description:
        "On GitHub, create a new repository from the `blueprint-seo-template` template. Name it after the destination site — lowercase, hyphens between words (e.g. closing-day-ready).",
      prompts: [],
    },
    {
      item_key: "create-local-project-folder",
      title: "Create local project folder",
      description:
        "On your local machine, create a new folder with the same name as the destination site / GitHub repo — lowercase, using hyphens to connect words (e.g. closing-day-ready).",
      prompts: [],
    },
    {
      item_key: "open-new-cursor-project",
      title: "Open new Cursor project",
      description:
        "Open a new project in Cursor, pointed at the folder you just created. The project name should match the destination site.",
      prompts: [],
    },
    {
      item_key: "clone-github-repo",
      title: "Clone the GitHub repo",
      description:
        "Clone the new GitHub repo (the one created from `blueprint-seo-template`) into the project folder. Clone into the folder itself, e.g. `git clone <repo-url> .` from inside it — do not clone into a subfolder, or you'll end up with a nested duplicate-named directory.",
      prompts: [],
    },
    {
      item_key: "create-new-theme-in-design-builder",
      title: "Open Design Builder",
      description:
        "Go to Design Builder in TNV. Confirm Company Data is loaded; fill optional brand-vibe fields if you have a preference.",
      prompts: [],
      linkTo: "/company/:companyId/design-guide-builder",
      linkLabel: "Open Design Builder →",
    },
    {
      item_key: "generate-or-provide-design-guide",
      title: "Generate Design Guide.md",
      description:
        "Click Generate Design Guide. Review the markdown, edit if needed, then Save (this also writes Company Data Design Guidelines and generates the abstract).",
      prompts: [],
    },
    {
      item_key: "download-design-guide",
      title: "Download Design Guide.md",
      description: "Download the generated file.",
      prompts: [],
    },
    {
      item_key: "add-design-guide-to-project-root",
      title: "Copy Design Guide.md to site/Design Guide.md",
      description:
        "Copy the downloaded file to `site/Design Guide.md` in the cloned project (replace the Layer 1 placeholder). Do not put it at the repo root. Site Activation's Design Activation prompt reads this path.",
      prompts: [],
    },
    {
      item_key: "push-design-abstract-to-company-data",
      title: "Push Design Abstract to Company Data",
      description:
        "In Design Builder, click 'Push Design Abstract to Company Data'. This fills the missing Design Guidelines abstract field in Company Data. Open Company Data → Design Guidelines to confirm it populated.",
      prompts: [],
      linkTo: "/company/:companyId/design-guide-builder",
      linkLabel: "Open Design Builder →",
    },
  ],
  "infra-qa": [
    {
      item_key: "run-npm-install",
      title: "Run npm install",
      description:
        "In the cloned project, run npm install. Confirm it completes with no errors.",
      prompts: [],
    },
    {
      item_key: "run-npm-run-build",
      title: "Run npm run build",
      description:
        "Run npm run build. Confirm 'build complete' with no errors.",
      prompts: [],
    },
    {
      item_key: "run-dev-sanity-check",
      title: "Run npm run dev and sanity-check",
      description:
        "Run npm run dev, get the local URL, and load the site. Confirm the homepage renders, there are no console errors, and the /articles/ listing page loads. An empty articles list is expected at this stage — no seed content exists yet.",
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
      title: "Open Site Content Builder",
      description:
        "Go to Site Content Builder in TNV. Download company markdown, run the ChatGPT site-content prompt, then paste the spec into Cursor to build the pages.",
      prompts: [],
      linkTo: "/company/:companyId/site-content-builder",
      linkLabel: "Open Site Content Builder →",
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
        "In TNV → Cluster Generation, generate each available supporting cluster (pillar article must already be published). Images are on by default. When generation completes, publish to the site — this commits each article to a publish/<timestamp> branch and merges to main, triggering a site rebuild.",
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
        "In Cluster Generation, generate each supporting cluster and both pillar articles via Pillar Automation — expect roughly 10 total files (2 pillar articles + supporting cluster articles).",
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
        "In Search Console, go to Sitemaps, submit sitemap-index.xml (e.g. https://yourdomain.com/sitemap-index.xml). Confirm it shows 'Success' status and a discovered URL count roughly matching your published page count.",
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
        "In Bing Webmaster Tools, submit the same sitemap-index.xml URL. If you imported from Search Console, check whether the sitemap carried over automatically — if not, add it manually.",
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
        "Check that every published article appears in sitemap-index.xml with a sensible lastmod date.",
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
