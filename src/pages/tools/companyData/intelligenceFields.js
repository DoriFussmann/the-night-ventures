/**
 * Company Intelligence: Basics, Business Overview, Offer and SEO Controls.
 * Retired fields are listed in ARCHIVED_FIELDS (hidden, data kept).
 */
import {
  SEO_CONTROL_FIELDS,
  SEO_NEW_TEXT_COLUMNS,
  seoFieldComplete,
} from "../../../../lib/seo-advisor/seoControls.js";

export function textFilled(value) {
  return Boolean(String(value ?? "").trim());
}

export function listFilled(value, predicate) {
  const source = Array.isArray(value) ? value : [];
  return source.some(predicate);
}

export const INTELLIGENCE_TEXT_KEYS = [
  "legal_name",
  "founded_date",
  "location_markets",
  "company_stage",
  "customer_problem",
  "trigger_moment",
  "buying_criteria",
  "how_it_works",
  "customer_outcome",
  "commercial_model",
  "differentiation",
  "messaging_hierarchy",
  "market_category",
  "competitive_position",
  "market_dynamics",
  "brand_references",
  "brand_boundaries",
  "reasons_to_believe",
  "results_proof",
  "trust_signals",
  "marketing_objectives",
  "growth_priorities",
  "customer_acquisition",
  "learnings_constraints",
  ...SEO_NEW_TEXT_COLUMNS,
];

export const EMPTY_INTELLIGENCE_TEXT = Object.fromEntries(
  INTELLIGENCE_TEXT_KEYS.map((key) => [key, ""])
);

const CUSTOM_FALLBACKS = {
  legal_name: ["legal name", "legal_name"],
  founded_date: [
    "founded year",
    "founded",
    "founded / incorporation date",
    "incorporation date",
  ],
  location_markets: [
    "official address",
    "location",
    "location / markets served",
    "address",
  ],
};

function customValueByNames(customValues, names) {
  const wanted = new Set(names.map((name) => String(name).trim().toLowerCase()));
  for (const [key, value] of Object.entries(customValues || {})) {
    if (!wanted.has(String(key).trim().toLowerCase())) continue;
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

/** Fill brief fields from leftover custom_fields when the column is still empty. */
export function applyCustomFieldFallbacks(fields, customValues) {
  const next = { ...fields };
  const fallbacks = { ...CUSTOM_FALLBACKS };
  for (const key of INTELLIGENCE_TEXT_KEYS) {
    const names = fallbacks[key] || [];
    fallbacks[key] = names.includes(key) ? names : [key, ...names];
  }
  for (const [key, names] of Object.entries(fallbacks)) {
    if (!textFilled(next[key])) {
      next[key] = customValueByNames(customValues, names);
    }
  }
  return next;
}

export const BASIC_FIELDS = [
  {
    id: "company_name",
    key: "company_name",
    label: "Company Name",
    kind: "name",
    rows: 1,
  },
  {
    id: "domain",
    key: "domain",
    label: "Domain",
    kind: "text",
    rows: 1,
  },
  {
    id: "contact_email",
    key: "contact_email",
    label: "Contact Email",
    kind: "text",
    rows: 1,
  },
  {
    id: "founded_date",
    key: "founded_date",
    label: "Founded Date",
    kind: "text",
    rows: 1,
  },
  {
    id: "location_markets",
    key: "location_markets",
    label: "Markets Served",
    kind: "textarea",
    rows: 2,
  },
  {
    id: "social_links",
    key: "social_links",
    label: "Social Links",
    kind: "social",
  },
  {
    id: "team_members",
    key: "team_members",
    label: "Team & Founder Credibility",
    helper: "Used for author bios and expertise signals in articles.",
    kind: "team",
  },
];

export const VISIBLE_BASIC_FIELDS = BASIC_FIELDS.filter((field) => !field.hidden);

export const SEO_GROUP_ID = "seo";

export const INTELLIGENCE_GROUPS = [
  {
    id: "business",
    number: "01",
    title: "Business Overview",
    fields: [
      {
        id: "abstract",
        key: "abstract",
        label: "Abstract",
        helper: "One or two sentences. Article generation reads this.",
        rows: 3,
      },
      {
        id: "what_we_do",
        key: "short_description",
        label: "What We Do",
        rows: 5,
      },
      {
        id: "story_mission",
        key: "long_description",
        label: "Story & Mission",
        rows: 6,
      },
      {
        id: "business_model",
        key: "business_model",
        label: "Business Model",
        rows: 4,
      },
      {
        id: "core_value_proposition",
        key: "core_value_proposition",
        label: "Core Value Proposition",
        rows: 4,
      },
      {
        id: "differentiation",
        key: "differentiation",
        label: "Differentiation",
        rows: 5,
      },
      {
        id: "market_category",
        key: "market_category",
        label: "Market & Category",
        rows: 4,
      },
      {
        id: "competitors",
        key: "competitors",
        label: "Competitors",
        kind: "competitors",
      },
      {
        id: "brand_voice",
        key: "brand_voice",
        label: "Voice & Tone",
        rows: 4,
      },
    ],
  },
  {
    id: "offer",
    number: "02",
    title: "Offer",
    fields: [
      {
        id: "services",
        key: "services",
        label: "Products & Services",
        kind: "services",
      },
      {
        id: "how_it_works",
        key: "how_it_works",
        label: "How It Works",
        helper: "From the customer's point of view.",
        rows: 5,
      },
    ],
  },
  {
    id: SEO_GROUP_ID,
    number: "03",
    title: "SEO Controls",
    fields: SEO_CONTROL_FIELDS.map((field) => ({
      id: field.key,
      key: field.key,
      label: field.label,
      helper: field.hint,
      rows: field.rows,
      required: field.required,
      seo: true,
    })),
  },
];

/**
 * Fields no longer shown or used. Their data stays in the database and can be
 * viewed under "Show archived fields".
 */
export const ARCHIVED_FIELDS = [
  { key: "legal_name", label: "Legal Name" },
  { key: "medium_description", label: "Medium Description" },
  { key: "company_stage", label: "Company Stage & Context" },
  { key: "customer_problem", label: "Customer Problem" },
  { key: "trigger_moment", label: "Trigger / Moment of Need" },
  { key: "buying_criteria", label: "Buying Criteria" },
  { key: "customer_outcome", label: "Customer Outcome" },
  { key: "commercial_model", label: "Commercial Model" },
  { key: "messaging_hierarchy", label: "Messaging Hierarchy" },
  { key: "competitive_position", label: "Competitive Position" },
  { key: "market_dynamics", label: "Market Dynamics" },
  { key: "brand_feel", label: "Brand Personality" },
  { key: "brand_references", label: "References" },
  { key: "brand_boundaries", label: "Brand Boundaries" },
  { key: "reasons_to_believe", label: "Reasons to Believe" },
  { key: "results_proof", label: "Results & Customer Proof" },
  { key: "trust_signals", label: "Other Trust Signals" },
  { key: "marketing_objectives", label: "Business & Marketing Objectives" },
  { key: "growth_priorities", label: "Priorities" },
  { key: "customer_acquisition", label: "Customer Acquisition & Sales" },
  { key: "learnings_constraints", label: "Learnings & Constraints" },
];

export function archivedWithContent(fields) {
  return ARCHIVED_FIELDS.filter((field) => textFilled(fields?.[field.key]));
}

export function intelligenceFieldFilled(field, { fields, companyName } = {}) {
  switch (field.kind || field.id) {
    case "name":
      return textFilled(companyName);
    case "social":
    case "social_links":
      return listFilled(fields?.social_links, (item) =>
        textFilled(item?.label) || textFilled(item?.url)
      );
    case "services":
      return listFilled(fields?.services, (item) =>
        textFilled(item?.title) || textFilled(item?.summary) || textFilled(item?.detail)
      );
    case "competitors":
      return listFilled(fields?.competitors, (item) =>
        textFilled(item?.name) || textFilled(item?.url)
      );
    case "team":
    case "team_members":
      return listFilled(fields?.team_members, (item) =>
        textFilled(item?.name) ||
        textFilled(item?.role) ||
        textFilled(item?.bio) ||
        textFilled(item?.credentials)
      );
    default:
      if (field.seo) {
        const def = SEO_CONTROL_FIELDS.find((item) => item.key === field.key);
        return def ? seoFieldComplete(def, fields) : textFilled(fields?.[field.key]);
      }
      return textFilled(fields?.[field.key]);
  }
}

export function groupProgress(group, ctx) {
  const filled = group.fields.filter((field) => intelligenceFieldFilled(field, ctx)).length;
  return { filled, total: group.fields.length };
}

export function basicProgress(ctx) {
  const filled = VISIBLE_BASIC_FIELDS.filter((field) =>
    intelligenceFieldFilled(field, ctx)
  ).length;
  return { filled, total: VISIBLE_BASIC_FIELDS.length };
}

export function briefProgress(ctx) {
  const basic = basicProgress(ctx);
  const groups = INTELLIGENCE_GROUPS.reduce(
    (acc, group) => {
      const next = groupProgress(group, ctx);
      acc.filled += next.filled;
      acc.total += next.total;
      return acc;
    },
    { filled: 0, total: 0 }
  );
  return {
    filled: basic.filled + groups.filled,
    total: basic.total + groups.total,
  };
}

export function allBriefPoints(ctx) {
  return [
    ...VISIBLE_BASIC_FIELDS.map((field) => ({
      id: field.id,
      label: field.label,
      key: field.key,
      filled: intelligenceFieldFilled(field, ctx),
      section: "basic",
    })),
    ...INTELLIGENCE_GROUPS.flatMap((group) =>
      group.fields.map((field) => ({
        id: field.id,
        label: field.label,
        key: field.key,
        filled: intelligenceFieldFilled(field, ctx),
        section: group.id,
        panelId: field.kind ? field.kind : null,
      }))
    ),
  ];
}
