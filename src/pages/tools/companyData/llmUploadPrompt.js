/**
 * Prompt for allocating a dropped markdown file onto Company Data fields.
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

  const emptySection =
    empty.length > 0
      ? `EMPTY FIELDS TO FILL (priority)
Only emit a field if the source supports it. Prefer these empty slots:
${empty.map((item) => `- ${item}`).join("\n")}
`
      : "";

  return `You map a source markdown file onto Company Data fields for "${name}". Read the source, allocate facts to the matching fields, and output ONE labeled markdown document the app can parse.

GOAL
Extract and allocate. Use only facts present in or clearly implied by the source. Do not research the web. Do not invent names, URLs, people, or offers. If a field is not supported by the source, omit that field entirely — do not write placeholders like "(unnamed)", "(untitled)", "TBD", or "N/A".
Never emit **Design Abstract:** or **Design Guide:** — those come from Design Builder, not this import.

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

1. **Domain:** example.com
   Host only or full site URL. No commentary.

2. **Product Name:** Primary product or brand name people search for.

3. **Category:**
   A markdown list of 1–3 industry names. ${categorySection}

4. **Target Description:**
   Who you serve: ICP, persona, job/life context, buying trigger.

5. **Pillar Keywords:**
   Nested list with TWO SPACES before supporting bullets:
   - pillar keyword
     - supporting keyword
     - supporting keyword

6. **Competitors:**
   Name + URL. URLs MUST start with https://
   - Competitor Name: https://example.com

7. **Social & Shops:**
   Group under ### headings that are exactly one of: Social Media | Digital Store | Other
   ### Social Media
   - Account Name
     - Type: Social Media
     - Status: Done
     - URL: https://...
     - Username: @handle
   Optional nested keys: Access Details, Comments. Status should be Done, Under Review, or Not started.

8. **Products & Services:**
   One block per offering, separated by a blank line. Use these keys (Title required):
   Title: ...
   Summary: ...
   Detail: ...

9. **Team Members:**
   - Full Name: Role · Credentials
     Short bio.
     - https://linkedin.com/in/...

10. **Contact Email:** hello@example.com

11. **Social Links:**
    - Instagram: https://instagram.com/...

12. **Abstract:**
    Positioning in ~2–4 sentences.

13. **Short Description:** ~1 sentence.

14. **Medium Description:** ~1 short paragraph.

15. **Long Description:** 2–4 paragraphs if the source supports it.

16. **Business Model:**
    How the company makes money.

17. **Core Value Proposition:**
    The primary reason customers choose this company.

18. **Brand Tokens:**
    Include only if the source has brand tokens (feel, accent, band, positive, wordmark, voice).
${customSection}
QUALITY BAR
- Allocate source content to the correct field. Do not dump the whole file into Abstract.
- Keep product names, people, URLs, and claims consistent across fields.
- Do not add extra top-level sections besides the fields listed above.
`;
}
