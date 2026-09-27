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

Identity
1. **Domain:** example.com
2. **Legal Name:** Registered / legal company name
3. **Founded / Incorporation Date:** Year or full date
4. **Location / Markets Served:** HQ, regions, or markets served
5. **Contact Email:** hello@example.com
6. **Social Links:**
   - Instagram: https://instagram.com/...

01 Company
7. **What We Do:** What the company does and the business it is in
8. **Story & Mission:** Origin, mission, or why it exists
9. **Business Model:** How the company makes money
10. **Company Stage & Context:** Stage, size, maturity, launch status

02 Customer
11. **Ideal Customer:** Who the business is designed for
12. **Customer Problem:** Problems or unmet needs
13. **Trigger / Moment of Need:** What causes them to start looking
14. **Buying Criteria:** What matters when choosing, including objections

03 Products & Services
15. **Products & Services:**
    One block per offering, separated by a blank line:
    Title: ...
    Summary: ...
    Detail: ...
16. **How It Works:** From the customer's point of view
17. **Customer Outcome:** Outcomes and benefits, not just features
18. **Commercial Model:** Pricing, packaging, and how they buy

04 Positioning
19. **Core Value Proposition:** Clearest statement of value
20. **Differentiation:** What is meaningfully different
21. **Messaging Hierarchy:** The three things someone should remember
22. **What We Are / Are Not:** Positioning boundaries

05 Market & Competition
23. **Market & Category:** Market / category context
24. **Competitors & Alternatives:**
    Name + URL. URLs MUST start with https://
    Include indirect alternatives as extra rows if needed.
    - Competitor Name: https://example.com
25. **Competitive Position:** Advantages and important limitations
26. **Market Dynamics:** Relevant trends or market forces

06 Brand
27. **Brand Personality:** 3–5 characteristics
28. **Voice & Tone:** How the company should sound
29. **References:** What to borrow from each reference, not just names
30. **Brand Boundaries:** What to avoid

07 Proof & Trust
31. **Reasons to Believe:** Why claims are credible
32. **Results & Customer Proof:** Results, testimonials, case studies
33. **Team & Founder Credibility:**
    - Full Name: Role · Credentials
      Short bio.
      - https://linkedin.com/in/...
34. **Other Trust Signals:** Customers, partners, press, awards, affiliations

08 Growth
35. **Business & Marketing Objectives:**
36. **Priorities:**
37. **Customer Acquisition & Sales:**
38. **Learnings & Constraints:**

Specialized / leftover (only if the source has this and it does not belong above)
39. **Product Name:** Primary product or brand name people search for
40. **Category:**
    A markdown list of 1–3 industry names. ${categorySection}
41. **Pillar Keywords:**
    Nested list with TWO SPACES before supporting bullets:
    - pillar keyword
      - supporting keyword
42. **Social & Shops:**
    Group under ### headings that are exactly one of: Social Media | Digital Store | Other
    ### Social Media
    - Account Name
      - Type: Social Media
      - Status: Done
      - URL: https://...
      - Username: @handle
43. **Abstract:** leftover positioning only
44. **Medium Description:** leftover copy only

Accepted aliases if you already used the old names: Short Description → What We Do; Long Description → Story & Mission; Target Description → Ideal Customer; Scope / Boundaries → What We Are / Are Not; Competitors → Competitors & Alternatives; Team Members → Team & Founder Credibility.
${customSection}
QUALITY BAR
- Allocate each fact to the most specific brief field. Do not dump the whole file into What We Do, Story & Mission, or Abstract.
- Keep product names, people, URLs, and claims consistent across fields.
- Do not add extra top-level sections besides the fields listed above.
`;
}
