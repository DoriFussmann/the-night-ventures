/**
 * The original Site Build Flow checklist. It fills the editable template tables
 * (migration 062_setup_flow_template.sql) and is used as-is until they exist.
 * To change the checklist, use "Edit checklist" on the Site Build Flow page.
 */


export const STATUSES = ["open", "done"];

export const STATUS_META = {
  open: {
    label: "Open",
    className:
      "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900",
  },
  done: {
    label: "Done",
    className:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  },
};

/** Any value outside STATUSES (e.g. the retired "wip") counts as open. */
export function normalizeStatus(status) {
  return STATUSES.includes(status) ? status : "open";
}

export function nextStatus(current) {
  return normalizeStatus(current) === "done" ? "open" : "done";
}

export const STAGES = [
  { stage_key: "code-setup", name: "Site Setup", order_index: 0 },
  { stage_key: "deployment", name: "Deployment", order_index: 1 },
  { stage_key: "aeo-playbook", name: "AEO Playbook", order_index: 2 },
  { stage_key: "seed-articles-content", name: "Seed Articles Content", order_index: 3 },
  { stage_key: "connection-layer", name: "Connection Layer", order_index: 4 },
];

/** The default checklist: the same steps as the live template (setup_flow_template_*). */
export const PREDEFINED_ITEMS = {
  "code-setup": [
    {
      item_key: "add-new-company",
      title: "Add a new company",
      description: "In The Night Ventures, add the new company.",
      prompts: [],
      linkTo: "/",
      linkLabel: "Open Companies →",
    },
    {
      item_key: "create-github-repo-from-template",
      title: "Create an empty GitHub repo",
      description: "On GitHub, create a new, empty repository for the site (no README, no template). Claude asks for it in the next step.",
      prompts: [],
    },
    {
      item_key: "clone-repo-and-add-design-guide",
      title: "Clone the newest site into the new repo",
      description: "Open Claude and ask it to clone the most recent, most complete site — pick by design and completeness; every site gets core updates from seo-core. When Claude asks for the repo, give it the new one.\n\nThen have Claude replace the previous company's content with the new company's: articles, pages, team and author, logo, social share image, SAME_AS profiles and site config. Build, commit and push.",
      prompts: [],
    },
    {
      item_key: "replace-brand-assets",
      title: "Run the readiness report and fill every gap",
      description: "Ask Claude, in the site repo, to run the readiness report below. Then fill every gap with it: company facts come from the AEO Playbook (Company tab and Brand Facts), never invented; the assets only you have are listed under Owner inputs needed.\n\nGoal: list everything on this site that is still a placeholder, missing, broken or unfinished, so the owner can fill it in. Check the source AND the built/rendered site.\n\n1. Build the site and run the dev server. Crawl every route the site generates (sitemap, routes, content collections, dynamic pages), including 404 and legal pages.\n\n2. Find, per page and per component:\n   - Placeholder text: [PLACEHOLDER…], TODO, TBD, FIXME, lorem ipsum, \"Primary positioning phrase\", [YOUR …], [00], example@, 555 numbers, template or demo strings, duplicated filler copy, and anything still about the company this site was cloned from.\n   - Images: slots with no src, missing files, broken paths, image briefs or alt text describing an image that doesn't exist yet, empty or generic alt text (\"image\", \"photo\"), wrong aspect for its frame, oversized files (>500 KB).\n   - Brand: missing logo, favicon set, apple-touch icon, OG/social share image, wordmark.\n   - People: team members, authors, testimonials or quotes with missing name, role, photo, bio or source.\n   - Links: href=\"#\", empty hrefs, links to routes that 404, broken external links (check status codes), placeholder social or profile URLs, mailto/tel with dummy values, buttons that go nowhere.\n   - Clients / logos / partners: sections expecting logos with none supplied.\n   - SEO & metadata: missing or duplicate page titles and meta descriptions, missing canonical, OG/Twitter tags, empty JSON-LD fields (e.g. sameAs, address, logo), missing sitemap entries, robots issues.\n   - Contact & legal: missing contact email/phone/address, privacy policy, terms, cookie notice, copyright year/name.\n   - Forms: forms with no endpoint or handler, missing success/error messages.\n   - Articles/content: missing cover image, author, date, excerpt, category, fewer than the expected number of items in any listing.\n   - Config & env: required environment variables or site settings that are empty or still defaults (site URL, analytics IDs, form keys).\n   - Anything the design guide's \"Not implemented\" or placeholder table depends on.\n\n3. Write the report to CONTENT_TODO.md at the repository root:\n   - A summary table: category | count | priority (Blocker = visible broken or placeholder on a live page; Important = missing but not visible, e.g. SEO, alt text; Nice to have).\n   - Then one checklist item per issue: [ ] page URL — component/section — what is missing — exact file and line where it is filled in — what the owner needs to provide (e.g. \"4:5 photo, ≥1600px wide\", \"client logo SVG\", \"LinkedIn URL\").\n   - Group by page, Blockers first.\n   - A final section \"Owner inputs needed\" listing every asset and fact to collect in one place (images, logos, names, URLs, copy).\n\n4. Do not guess or fill anything in. If unsure whether something is a placeholder, list it under \"Needs confirmation\".",
      prompts: [],
      linkTo: "/company/:companyId/aeo-playbook?tab=brand",
      linkLabel: "Open Brand Facts →",
    },
    {
      item_key: "set-publish-destination",
      title: "Set Publish Destination",
      description: "On GitHub, open the tnv-publish fine-grained token → Edit → Repository access → add the new repo → Update. The token value does not change, so nothing changes in Vercel.\n\nIn TNV, open AEO Playbook → Company → Publish Destination, enter the GitHub owner and repo, and click Check Connection. Save when every line is green.",
      prompts: [],
      linkTo: "/company/:companyId/aeo-playbook?tab=company",
      linkLabel: "Open AEO Playbook → Company →",
    },
    {
      item_key: "update-core-version",
      title: "Check Core Version",
      description: "Once the site is live: Admin → Core Version. A clone of the newest site is usually current already; update if a newer minor version shows. A major version (for example 0.x → 1.0) shows as 'Migration required' and needs a patch for this site first.",
      prompts: [],
      linkTo: "/company/:companyId/core-version",
      linkLabel: "Open Core Version →",
    },
  ],
  "deployment": [
    {
      item_key: "create-vercel-project",
      title: "Create Vercel project",
      description: "In Vercel, Add New → Project and pick the new repo. Set the Node.js version in the project's Settings to match the site's package.json.",
      prompts: [],
    },
    {
      item_key: "add-custom-domain-in-vercel",
      title: "Add the custom domain and DNS",
      description: "In the Vercel project, add the custom domain and set the DNS records it asks for. Confirm the site loads on the domain.",
      prompts: [],
    },
  ],
  "aeo-playbook": [
    {
      item_key: "playbook-company",
      title: "Fill the Company tab",
      description: "Name, domain, product name (only if it differs from the company name), search market, language and AI training crawler policy. Then Commercial and sales (deal size, sales motion, customer evidence & proof, where to find them, operating constraints) and the image style for article images.",
      prompts: [],
      linkTo: "/company/:companyId/aeo-playbook?tab=company",
      linkLabel: "Open Company →",
    },
    {
      item_key: "playbook-brand-facts",
      title: "Fill Brand Facts",
      description: "Offer, customer qualification & fit, customer problem & impact, buying triggers & timing, observable signals, difference, conversion (with the call to action and the conversion page URL every article links to), voice & tone, approved and never claims, out-of-scope topics and competitors. The writer and the Audit read only what is here.",
      prompts: [],
      linkTo: "/company/:companyId/aeo-playbook?tab=brand",
      linkLabel: "Open Brand Facts →",
    },
    {
      item_key: "playbook-audience-prompts",
      title: "Add ICP, personas, prompts and the content map",
      description: "Fill the ICP and personas, the prompt universe and the content map (pillars and prompt groups), or import a playbook JSON file with Import playbook file.",
      prompts: [],
      linkTo: "/company/:companyId/aeo-playbook?tab=personas",
      linkLabel: "Open ICP & Personas →",
    },
  ],
  "seed-articles-content": [
    {
      item_key: "aeo-generate-and-schedule",
      title: "Generate and schedule articles in AEO Generation",
      description: "Pick the next prompt groups, create briefs, draft the articles with their hero images and schedule them. The daily publisher commits each article to the site and wires internal links automatically.",
      prompts: [],
      linkTo: "/company/:companyId/aeo-generation",
      linkLabel: "Open AEO Generation →",
    },
  ],
  "connection-layer": [
    {
      item_key: "verify-google-search-console",
      title: "Verify Google Search Console",
      description: "Add and verify a Domain property in Google Search Console for your live domain (verified through DNS). If you use a URL-prefix property with the HTML tag method instead, put the tag's token in Vercel → Settings → Environment Variables as PUBLIC_SEARCH_CONSOLE_VERIFICATION (Production), redeploy, then click Verify.",
      prompts: [],
    },
    {
      item_key: "submit-sitemap-google-search-console",
      title: "Submit sitemap to Google Search Console",
      description: "In Search Console, go to Sitemaps, submit sitemap.xml (e.g. https://yourdomain.com/sitemap.xml). Confirm it shows 'Success' status and a discovered URL count roughly matching your published page count.",
      prompts: [],
    },
    {
      item_key: "verify-bing-webmaster-tools",
      title: "Verify Bing Webmaster Tools",
      description: "Add your site to Bing Webmaster Tools — can import directly from Search Console.",
      prompts: [],
    },
    {
      item_key: "submit-sitemap-bing-webmaster-tools",
      title: "Submit sitemap to Bing Webmaster Tools",
      description: "In Bing Webmaster Tools, submit the same sitemap.xml URL. If you imported from Search Console, check whether the sitemap carried over automatically — if not, add it manually.",
      prompts: [],
    },
    {
      item_key: "install-analytics",
      title: "Install Analytics",
      description: "For Google Analytics 4: create a web data stream for the live domain, copy its measurement ID (G-…), add it in Vercel → Settings → Environment Variables as PUBLIC_ANALYTICS_ID (Production) and redeploy. The template adds the tag to every page. Confirm visits appear in GA4 Realtime. For another tool, install it and confirm it receives real traffic.",
      prompts: [],
    },
    {
      item_key: "share-properties-with-tnv",
      title: "Connect Search Console, GA4 and Bing to TNV",
      description: "Add TNV's service account as a user on the Search Console property and as a Viewer on the GA4 property (the address is shown in Integrations). Bing works through the workspace API key once the site is verified in the same Bing account. Then check the company in Integrations and Analytics.",
      prompts: [],
      linkTo: "/company/:companyId/integrations",
      linkLabel: "Open Integrations →",
    },
  ],
};
