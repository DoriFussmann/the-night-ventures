/**
 * Prompt for an external LLM to generate a Company Data .md import file.
 * Keep labels in sync with parseCompanyMarkdown.js / handleDownloadMarkdown.
 */
export function buildLlmUploadPrompt({
  companyName = "",
  customFieldNames = [],
  industryNames = [],
} = {}) {
  const name = String(companyName || "").trim() || "{Company Name}";
  const custom = (customFieldNames || []).map((item) => String(item || "").trim()).filter(Boolean);
  const industries = (industryNames || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  const customSection =
    custom.length > 0
      ? `
CUSTOM FIELDS (this company)
Also populate these extra fields using the same **Label:** format, with the exact names:
${custom.map((item) => `- **${item}:**`).join("\n")}
`
      : "";

  const categorySection =
    industries.length > 0
      ? `Pick 1–3 names from this exact list (copy spelling as-is):
${industries.map((item) => `   - ${item}`).join("\n")}`
      : `Pick 1–3 names that already exist in the app’s Category picker. Do not invent categories.`;

  return `You are writing a Company Data import file for a web app. I will upload the .md you produce; a parser will map labeled sections onto profile fields. Follow the format rules exactly. Do not invent a different structure.

GOAL
Research/understand this business from the context I provide, then output ONE markdown document with every field below populated. Use real facts from the context. If something is unknown, make a clearly reasonable best-effort draft from public positioning — do not leave a field blank, and do not write placeholders like "(unnamed)", "(untitled)", "TBD", or "N/A".

OUTPUT
- Return a single .md file body only (no preamble, no code fences unless a field value itself needs them).
- First line: \`# ${name}\`
- Then the fields below, in this order, using these exact labels.
- Every field label MUST be bold, with a colon inside the asterisks, and MUST start at column 0 (beginning of the line):
  **Label:**
- Do not start any other line with \`**SomeLabel:**\` — the parser treats those as new fields. Especially do not put \`**Abstract:**\`, \`**Domain:**\`, etc. inside Design Guide body text.
- Inline fields (short values) go on the same line as the label.
- Block fields (lists / long copy) go on the following lines.

FIELDS AND SHAPES

1. **Domain:** example.com
   Host only or full site URL. No commentary.

2. **Product Name:** Primary product or brand name people search for.

3. **Category:**
   A markdown list of 1–3 industry names. ${categorySection}

4. **Target Description:**
   Who you serve: ICP, persona, job/life context, buying trigger. 1–3 short paragraphs. Specific, not "anyone who wants success".

5. **Pillar Keywords:**
   SEO content architecture. 5 pillars (or 7 if the brand is clearly a large content site). Each pillar has 3–5 supporting keywords. Nested list with TWO SPACES before supporting bullets:
   - pillar keyword
     - supporting keyword
     - supporting keyword
   Pillars are topics this company should own. Supporting keywords are more specific queries under that pillar. No quotes.

6. **Competitors:**
   Content/SEO competitors (who they compete with in search and positioning), not random companies in an adjacent industry. Name + URL. URLs MUST start with https://
   - Competitor Name: https://example.com
   Include 3–6.

7. **Social & Shops:**
   Real or clearly labeled public profiles. Group under ### headings that are exactly one of: Social Media | Digital Store | Other
   ### Social Media
   - Account Name
     - Type: Social Media
     - Status: Done
     - URL: https://...
     - Username: @handle
   Optional nested keys: Access Details, Comments. Status should be Done, Under Review, or Not started.

8. **Products & Services:**
   One block per offering, separated by a blank line. Use these keys (Title required; others if relevant):
   Title: ...
   Summary: one or two sentences
   Detail: longer description
   Do not use bullet lists for this section.

9. **Team Members:**
   - Full Name: Role · Credentials
     One-line or short bio.
     - https://linkedin.com/in/...
   Credentials after the middle dot are optional. sameAs URLs must be https://

10. **Contact Email:** hello@example.com

11. **Social Links:**
    Public site links (can overlap Social & Shops). Label + URL:
    - Instagram: https://instagram.com/...
    - LinkedIn: https://linkedin.com/company/...

12. **Abstract:**
    Positioning in ~2–4 sentences. What you do, for whom, why it is different. This is reused in prompts and site copy.

13. **Short Description:** ~1 sentence. Homepage-style.

14. **Medium Description:** ~1 short paragraph.

15. **Long Description:** 2–4 paragraphs. Origin, offer, proof, who it is for. No fluff adjectives stacked together.

16. **Business Model:**
    How the company makes money and delivers value (product, services, marketplace, membership, licensing, etc.). Be concrete: who pays, for what, and how often.

17. **Core Value Proposition:**
    The primary reason customers choose this company over alternatives. One clear promise, not a feature list.

18. **Scope / Boundaries:**
    What is in scope for this business — and what it explicitly does not do. Name the adjacent work you turn down so later prompts do not invent it.

19. **Design Guide:**
    Optional. Only include if you can write a usable brand/design-system doc (type, color, voice, layout). If you do not have enough signal, OMIT this entire field rather than inventing a generic SaaS theme. If you include it, never begin a line with \`**Abstract:**\` or any other field label from this list.

20. **Design Abstract:**
    1–2 paragraphs of visual/brand direction: tone, typography vibe, color temperature, do/don’t. Always include this even if Design Guide is omitted.
${customSection}
QUALITY BAR
- Write as if this will be pasted into SEO, article, and site-build prompts. Specific > generic.
- Keep product names, people, URLs, and claims consistent across fields.
- Do not add extra top-level sections besides the fields listed above.

COMPANY CONTEXT
Paste website copy, about text, offers, audience notes, competitors you know, social URLs, and anything else below this line.
`;
}
