/** Predefined Site Build Flow stages and items (seeded per company on first load). */

import { PHASE_1_AUDIT_PROMPT } from "../templateToPrompt/phase1AuditPrompt";

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
  { stage_key: "design", name: "Design", order_index: 2 },
  { stage_key: "deployment", name: "Deployment", order_index: 3 },
  { stage_key: "site-activation", name: "Site Activation", order_index: 4 },
  { stage_key: "connection-layer", name: "Connection Layer", order_index: 5 },
  { stage_key: "post-activation-prompts", name: "Post Activation Prompts", order_index: 6 },
  { stage_key: "links-wiring", name: "Links Wiring", order_index: 7 },
  { stage_key: "seed-qa", name: "Initial Seed Content QA", order_index: 8 },
];

export const PREDEFINED_ITEMS = {
  setup: [
    {
      item_key: "create-local-project-folder",
      title: "Create local project folder",
      description:
        "On your local machine, create a new folder named identically to the future project's domain — lowercase, using hyphens to connect words (e.g. closing-day-ready).",
      prompts: [],
    },
    {
      item_key: "open-new-cursor-project",
      title: "Open new Cursor project",
      description:
        "Open a new project in Cursor, pointed at the folder you just created.",
      prompts: [],
    },
    {
      item_key: "add-new-company-in-tnv",
      title: "Add new company in TNV",
      description:
        "In The Night Ventures, add a new company. Name can use uppercase letters and spaces here — this naming rule only applies to the local folder.",
      prompts: [],
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
    },
    {
      item_key: "save-company-data",
      title: "Save Company Data",
      description: "Save once all fields are filled.",
      prompts: [],
    },
    {
      item_key: "copy-build-prompt-into-cursor",
      title: "Copy Build Prompt into Cursor",
      description:
        "Copy the 'Build Prompt' from Site Build Prompt in TNV, and paste it into Cursor to scaffold the infrastructure.",
      prompts: [],
    },
    {
      item_key: "copy-infra-addendum-prompt",
      title: "Infra Addendum Prompt",
      description:
        "Copy the prompt below and paste it into Cursor after the infrastructure scaffold, before applying the design system.",
      prompts: [
        {
          label: "Infra Addendum Prompt",
          text: `Add a batch upload mode to the "Add Article" screen, alongside the existing single-file flow — reuse all existing validation/write logic, do not duplicate it.

1. Change the .md drop zone to accept multiple files at once (drag-and-drop or click-to-browse, multi-select).
2. On drop, parse each file individually using the exact same parsing/validation logic already used for single-file upload. Render as a list — one row per file: filename/slug, a compact status (using the existing Missing Fields logic — collapsed panel per row, same pattern already built, showing only what's actually missing).
3. BATCH-LEVEL CONTROLS (apply to all rows at once, with per-row override still available):
   - One Author dropdown (same team-collection source as the single-file form) — selecting it fills every row's author field; any row can still be changed individually.
   - One hero image drop zone — dropping an image here applies it as the hero for every row in the batch; any row can still get its own individual image dropped to override.
4. Each row still shows its own remaining missing/invalid fields (if any) after batch-apply — e.g. if a specific file's title is out of the 55-60 char range, that's still flagged per-row, batch controls only cover author/image.
5. "Generate All" button: enabled once every row has zero missing required fields. Runs the existing single-file Generate logic sequentially, one file at a time (not parallel — consistent with every other batch action across this project), with a progress indicator ("Generating 4 of 10: {slug}"). Per-row status updates live (pending → done ✓ / failed ✗ with reason) — a failure on one file does not stop the rest.
6. Trigger generateLlmsTxt once after the full batch completes, not once per file — avoids redundant rebuilds.
7. Keep the existing single-file flow fully intact and working — this is an additional mode, not a replacement.

Verify: drop 5-10 real .md files at once, set author + hero image once via the batch controls, confirm per-row overrides still work, Generate All writes every file correctly with the same validation guarantees as the single-file flow, llms.txt rebuilds once at the end.`,
        },
      ],
    },
  ],
  "infra-qa": [
    {
      item_key: "run-npm-run-build",
      title: "Run npm run build",
      description:
        "Open a terminal and run npm run build. Confirm 'build complete' with no errors.",
      prompts: [],
    },
    {
      item_key: "run-dev-visit-article",
      title: "Run npm run dev and visit an article",
      description:
        "Run npm run dev, get the local URL, visit an article page. Check: browser tab shows the article's slug/title, hero image renders, author name and image show, title and date look correct, an external link works, FAQ section exists (if the article has one).",
      prompts: [],
    },
    {
      item_key: "view-page-source-check",
      title: "View Page Source check",
      description:
        "Right-click the article page, View Page Source. Confirm: <title> tag present, meta name=description reads well, canonical link starts with https://, og:title matches page title, og:description matches meta description, exactly one <h1> present and matching.",
      prompts: [],
    },
    {
      item_key: "validate-json-ld-via-cursor",
      title: "Validate JSON-LD via Cursor",
      description:
        "Copy the local article URL and ask Cursor to check its structured data.",
      prompts: [
        {
          label: "JSON-LD validation prompt",
          text: "http://localhost:4321/articles/[your-article-slug]/ — Run this article's page through a JSON-LD structured data validator and tell me if it passes with zero errors.",
        },
      ],
    },
    {
      item_key: "check-generated-site-wide-files",
      title: "Check generated site-wide files",
      description:
        "In a new terminal, run npm run build, then ask Cursor to show the generated files.",
      prompts: [
        {
          label: "Show generated files prompt",
          text: "Show me the contents of dist/llms.txt, dist/sitemap-index.xml, dist/robots.txt, and dist/rss.xml",
        },
      ],
    },
    {
      item_key: "verify-site-wide-files",
      title: "Verify site-wide files look correct",
      description:
        "llms.txt: starts with site name as a header, followed by published articles (title, short description, link). sitemap-index.xml: short snippet linking to a file like sitemap-0.xml, containing your real domain, not example.com. robots.txt: a few lines allowing indexing, ending with a Sitemap: link to your real domain. rss.xml: an RSS feed listing all published articles.",
      prompts: [],
    },
    {
      item_key: "confirm-drafts-excluded",
      title: "Confirm draft articles are fully excluded",
      description: "Ask Cursor to create and verify a draft test article.",
      prompts: [
        {
          label: "Draft exclusion test prompt",
          text: "Create a test article and mark it as a draft, then confirm no page exists for it after building, and that it's absent from the sitemap, RSS, and llms.txt.",
        },
      ],
    },
    {
      item_key: "test-local-cms",
      title: "Test the local CMS",
      description:
        "Run npm run cms, open the URL it gives you. Try adding an article with missing/invalid fields and confirm the checklist responds correctly (shows what's missing, blocks Generate with a visible reason).",
      prompts: [],
    },
    {
      item_key: "grep-for-template-leftovers",
      title: "Grep for template leftovers",
      description:
        "Ask Cursor to search for leftover placeholder identity strings outside the config file.",
      prompts: [
        {
          label: "Leftover check prompt",
          text: "Search the whole project for the literal text example.com and Site Name outside of the main settings file, and tell me what you find. Also confirm the social links list is still empty.",
        },
        {
          label: "Follow-up if leftovers found",
          text: "I ran step 7 of the checklist and found leftover example.com and Site Name references in [list the files Cursor reported]. Please remove or update these hardcoded fallbacks so they strictly pull from site/src/config/site.ts, and then re-run npm run build to update the dist folder.",
        },
      ],
    },
  ],
  design: [
    {
      item_key: "create-new-theme-in-design-builder",
      title: "Open Design Builder",
      description:
        "Go to Design Builder in TNV. Confirm Company Data is loaded; fill optional brand-vibe fields if you have a preference.",
      prompts: [],
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
      title: "Add Design Guide.md to project root",
      description:
        "Place the downloaded file at the root of your local project folder.",
      prompts: [],
    },
    {
      item_key: "copy-apply-design-system-prompt",
      title: "Copy Apply Design System Prompt into Cursor",
      description:
        "Go to Site Build Prompt in TNV, copy the 'Apply Design System Prompt', paste into Cursor (confirm Design Guide.md is present in the root first).",
      prompts: [],
    },
    {
      item_key: "generate-design-guidelines-abstract",
      title: "Confirm Design Guidelines abstract",
      description:
        "Saving in Design Builder already writes the Design Guide and generates the abstract in Company Data. Open Company Data → Design Guidelines to confirm the abstract looks right.",
      prompts: [],
    },
  ],
  deployment: [
    {
      item_key: "create-github-repo",
      title: "Create GitHub repo",
      description:
        "Create a new repo on GitHub with the same name as your local folder. Copy its URL.",
      prompts: [],
    },
    {
      item_key: "push-to-github",
      title: "Push to GitHub",
      description: "In Cursor, push the local project to the new repo.",
      prompts: [
        {
          label: "Push command (edit URL)",
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
      description: "Ask Cursor whether a migration needs running.",
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
        "Copy the migration file's content and paste it into Supabase's SQL Editor, run it.",
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
      item_key: "run-the-audit-prompt",
      title: "Run the audit prompt",
      description:
        "Go to Specific Prompt in TNV, copy the Audit Prompt (Tab 1), paste into Cursor and run it.",
      prompts: [
        {
          label: "Phase 1 audit prompt",
          text: PHASE_1_AUDIT_PROMPT,
        },
      ],
    },
    {
      item_key: "generate-the-personalize-prompt",
      title: "Generate the Personalize Prompt",
      description:
        "Paste Cursor's audit response into Specific Prompt's Personalize Prompt tab (Tab 2).",
      prompts: [],
      linkTo: "/company/:companyId/template-to-prompt?tab=personalize",
      linkLabel: "Open Specific Prompt →",
    },
    {
      item_key: "resolve-remaining-input-fields",
      title: "Resolve any remaining input fields",
      description:
        "Fill in any fields still needing input, then let Cursor run the generated fill prompt.",
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
      item_key: "add-pillar-keywords",
      title: "Add pillar keywords to Company Data",
      description:
        "Choose 2 pillar keywords for your initial content seed and add them under Pillar Keywords in Company Data.",
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
        "In Topic Generator, choose one supporting-keyword cluster per pillar and click Plan for both, pasting the matching Keyword Slip results into 'Keyword data (optional)' for each.",
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
        "In Article Generator, drag & drop each cluster .md and each pillar .md, generate, and save/download every resulting article file — expect roughly 10 total files (2 pillar articles + supporting cluster articles).",
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
  "post-activation-prompts": [
    {
      item_key: "run-second-design-prompt",
      title: "Run Second Design Prompt",
      description:
        "Go to Site Build Prompt in TNV, copy the 'Second Design Prompt', paste into Cursor and run it.",
      prompts: [],
    },
    {
      item_key: "run-second-functionality-prompt",
      title: "Run Second Functionality Prompt",
      description:
        "Go to Site Build Prompt in TNV, copy the 'Second Functionality Prompt', paste into Cursor and run it.",
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
