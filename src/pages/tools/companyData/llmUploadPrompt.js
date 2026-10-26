/**
 * Prompt for allocating a dropped markdown file onto Company Intelligence fields.
 * Keep labels in sync with parseCompanyMarkdown.js / handleDownloadMarkdown.
 */
export function buildCompanyDataAllocatePrompt({
  companyName = "",
  customFieldNames = [],
  industryNames = [],
  emptyFieldLabels = [],
} = {}) {
  const name = String(companyName || "").trim() || "{Company Name}";
  const custom = (customFieldNames || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const industries = (industryNames || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const empty = (emptyFieldLabels || [])
    .map((item) => String(item || "").trim())
    .filter((item) => {
      const key = item.toLowerCase();
      return item && key !== "design abstract" && key !== "design guide";
    });

  const customSection =
    custom.length > 0
      ? `
CUSTOM / LEFTOVER FIELDS
Also populate these extra fields using the same **Label:** format, with the exact names:
${custom.map((item) => `- **${item}:**`).join("\n")}
`
      : "";

  const categorySection =
    industries.length > 0
      ? `Pick 1–3 names from this exact list (copy spelling as-is):
${industries.map((item) => `   - ${item}`).join("\n")}`
      : `Pick 1–3 names that already exist in the app’s Category picker. Do not invent categories.`;

  const emptySection =
    empty.length > 0
      ? `EMPTY FIELDS TO FILL (priority)
Only emit a field if the source supports it. Prefer these empty slots:
${empty.map((item) => `- ${item}`).join("\n")}
`
      : "";

  return `You map a source markdown file onto Company Intelligence fields for "${name}". Read the source, allocate facts to the matching fields, and output ONE labeled markdown document the app can parse.

GOAL
Extract and allocate across the FULL brief, including the newer Company Intelligence fields. Use only facts present in or clearly implied by the source. Do not research the web. Do not invent names, URLs, people, or offers. If a field is not supported by the source, omit that field entirely — do not write placeholders like "(unnamed)", "(untitled)", "TBD", or "N/A".
Never emit **Design Abstract:**, **Design Guide:**, or **Brand Tokens:** — design comes from the Design page, not this import.
Prefer the new brief labels below. Do not dump everything into Abstract, What We Do, or Story & Mission if a more specific field fits.

${emptySection}OUTPUT
- Return a single markdown body only (no preamble, no code fences unless a field value itself needs them).
- First line: \`# ${name}\`
- Then only the fields you can populate, using these exact labels.
- Every field label MUST be bold, with a colon inside the asterisks, and MUST start at column 0:
  **Label:**
- Do not start any other line with \`**SomeLabel:**\` — the parser treats those as new fields.
- Inline fields (short values) go on the same line as the label.
- Block fields (lists / long copy) go on the following lines.

FIELDS AND SHAPES

Basics
1. **Domain:** example.com
2. **Contact Email:** hello@example.com
3. **Founded Date:** Year or full date
4. **Markets Served:** HQ, regions, or markets served
5. **Social Links:**
   - Instagram: https://instagram.com/...
6. **Team & Founder Credibility:**
    - Full Name: Role · Credentials
      Short bio.
      - https://linkedin.com/in/...

01 Business Overview
7. **Abstract:** One or two sentences on the business
8. **What We Do:** What the company does and the business it is in
9. **Story & Mission:** Origin, mission, or why it exists
10. **Business Model:** How the company makes money
11. **Core Value Proposition:** Clearest statement of value
12. **Differentiation:** What is meaningfully different
13. **Market & Category:** Market / category context
14. **Competitors:**
    Name + URL. URLs MUST start with https://
    - Competitor Name: https://example.com
15. **Voice & Tone:** How the company should sound

02 Offer
16. **Products & Services:**
    One block per offering, separated by a blank line:
    Title: ...
    Summary: ...
    Detail: ...
17. **How It Works:** From the customer's point of view

03 SEO Controls
18. **SEO Primary Offer:** The one offer the content exists to sell
19. **Target Searcher:** Who types the searches: role, stage, situation
20. **SEO Problems Before Buying:**
    4–7 problems, one per line, in the buyer's words
    - problem
21. **SEO Conversion Action:** What a reader should do next (book a call, buy)
22. **SEO Commercial Page URL:** https://... page every article links to
23. **SEO Content Edge:** First-hand experience, data or cases competitors lack
24. **SEO Search Market:** Country or region
25. **SEO Language:** Language of the articles
26. **SEO Search Competitors:**
    - domain.com
27. **Out-of-scope Topics:** Topics the company will not write about
28. **SEO Publishing Pace:** Articles per month

Specialized / leftover (only if the source has this and it does not belong above)
29. **Product Name:** Primary product or brand name people search for
30. **Category:**
    A markdown list of 1–3 industry names. ${categorySection}
31. **Pillar Keywords:**
    Nested list with TWO SPACES before supporting bullets:
    - pillar keyword
      - supporting keyword
32. **Social & Shops:**
    Group under ### headings that are exactly one of: Social Media | Digital Store | Other
    ### Social Media
    - Account Name
      - Type: Social Media
      - Status: Done
      - URL: https://...
      - Username: @handle

Accepted aliases if you already used the old names: Short Description → What We Do; Long Description → Story & Mission; Target Description / Ideal Customer → Target Searcher; Scope / Boundaries / What We Are / Are Not → Out-of-scope Topics; Competitors & Alternatives → Competitors; Team Members → Team & Founder Credibility.
${customSection}
QUALITY BAR
- Allocate each fact to the most specific brief field. Do not dump the whole file into What We Do, Story & Mission, or Abstract. Never invent facts for SEO Controls; leave a field out if the source does not support it.
- Keep product names, people, URLs, and claims consistent across fields.
- Do not add extra top-level sections besides the fields listed above.
`;
}
