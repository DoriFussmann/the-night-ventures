/** Company Intelligence brief: 7 basic facts + 8 groups × 4 fields. */

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
  for (const [key, names] of Object.entries(CUSTOM_FALLBACKS)) {
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
    id: "legal_name",
    key: "legal_name",
    label: "Legal Name",
    kind: "text",
    rows: 1,
  },
  {
    id: "founded_date",
    key: "founded_date",
    label: "Founded / Incorporation Date",
    kind: "text",
    rows: 1,
  },
  {
    id: "location_markets",
    key: "location_markets",
    label: "Location / Markets Served",
    kind: "textarea",
    rows: 3,
  },
  {
    id: "contact_email",
    key: "contact_email",
    label: "Contact Email",
    kind: "text",
    rows: 1,
  },
  {
    id: "social_links",
    key: "social_links",
    label: "Social Links",
    kind: "social",
  },
];

export const INTELLIGENCE_GROUPS = [
  {
    id: "company",
    number: "01",
    title: "Company",
    fields: [
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
        id: "company_stage",
        key: "company_stage",
        label: "Company Stage & Context",
        rows: 4,
      },
    ],
  },
  {
    id: "customer",
    number: "02",
    title: "Customer",
    fields: [
      {
        id: "ideal_customer",
        key: "target_audience",
        label: "Ideal Customer",
        rows: 5,
      },
      {
        id: "customer_problem",
        key: "customer_problem",
        label: "Customer Problem",
        rows: 5,
      },
      {
        id: "trigger_moment",
        key: "trigger_moment",
        label: "Trigger / Moment of Need",
        rows: 4,
      },
      {
        id: "buying_criteria",
        key: "buying_criteria",
        label: "Buying Criteria",
        helper: "Include important objections where relevant.",
        rows: 5,
      },
    ],
  },
  {
    id: "offer",
    number: "03",
    title: "Products & Services",
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
      {
        id: "customer_outcome",
        key: "customer_outcome",
        label: "Customer Outcome",
        helper: "Outcomes and benefits, not just features.",
        rows: 4,
      },
      {
        id: "commercial_model",
        key: "commercial_model",
        label: "Commercial Model",
        helper: "Pricing, packaging, and how they buy.",
        rows: 4,
      },
    ],
  },
  {
    id: "positioning",
    number: "04",
    title: "Positioning",
    fields: [
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
        id: "messaging_hierarchy",
        key: "messaging_hierarchy",
        label: "Messaging Hierarchy",
        helper: "The three things someone should remember.",
        rows: 5,
      },
      {
        id: "scope_boundaries",
        key: "scope_boundaries",
        label: "What We Are / Are Not",
        rows: 5,
      },
    ],
  },
  {
    id: "market",
    number: "05",
    title: "Market & Competition",
    fields: [
      {
        id: "market_category",
        key: "market_category",
        label: "Market & Category",
        rows: 4,
      },
      {
        id: "competitors",
        key: "competitors",
        label: "Competitors & Alternatives",
        helper: "Include indirect alternatives, not only named competitors.",
        kind: "competitors",
      },
      {
        id: "competitive_position",
        key: "competitive_position",
        label: "Competitive Position",
        helper: "Advantages and important limitations.",
        rows: 5,
      },
      {
        id: "market_dynamics",
        key: "market_dynamics",
        label: "Market Dynamics",
        rows: 4,
      },
    ],
  },
  {
    id: "brand",
    number: "06",
    title: "Brand",
    fields: [
      {
        id: "brand_feel",
        key: "brand_feel",
        label: "Brand Personality",
        helper: "3–5 characteristics.",
        rows: 4,
      },
      {
        id: "brand_voice",
        key: "brand_voice",
        label: "Voice & Tone",
        rows: 4,
      },
      {
        id: "brand_references",
        key: "brand_references",
        label: "References",
        helper: "What to borrow from each — not just names.",
        rows: 5,
      },
      {
        id: "brand_boundaries",
        key: "brand_boundaries",
        label: "Brand Boundaries",
        rows: 4,
      },
    ],
  },
  {
    id: "proof",
    number: "07",
    title: "Proof & Trust",
    fields: [
      {
        id: "reasons_to_believe",
        key: "reasons_to_believe",
        label: "Reasons to Believe",
        rows: 4,
      },
      {
        id: "results_proof",
        key: "results_proof",
        label: "Results & Customer Proof",
        rows: 5,
      },
      {
        id: "team_members",
        key: "team_members",
        label: "Team & Founder Credibility",
        kind: "team",
      },
      {
        id: "trust_signals",
        key: "trust_signals",
        label: "Other Trust Signals",
        rows: 4,
      },
    ],
  },
  {
    id: "growth",
    number: "08",
    title: "Growth",
    fields: [
      {
        id: "marketing_objectives",
        key: "marketing_objectives",
        label: "Business & Marketing Objectives",
        rows: 4,
      },
      {
        id: "growth_priorities",
        key: "growth_priorities",
        label: "Priorities",
        rows: 4,
      },
      {
        id: "customer_acquisition",
        key: "customer_acquisition",
        label: "Customer Acquisition & Sales",
        rows: 5,
      },
      {
        id: "learnings_constraints",
        key: "learnings_constraints",
        label: "Learnings & Constraints",
        rows: 5,
      },
    ],
  },
];

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
      return textFilled(fields?.[field.key]);
  }
}

export function groupProgress(group, ctx) {
  const filled = group.fields.filter((field) => intelligenceFieldFilled(field, ctx)).length;
  return { filled, total: group.fields.length };
}

export function basicProgress(ctx) {
  const filled = BASIC_FIELDS.filter((field) => intelligenceFieldFilled(field, ctx)).length;
  return { filled, total: BASIC_FIELDS.length };
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
    ...BASIC_FIELDS.map((field) => ({
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
