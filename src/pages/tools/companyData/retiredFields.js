/**
 * Company Intelligence fields that nothing reads any more. Their content moved
 * to the AEO Playbook (Brand Facts, ICP) or had no reader at all. The columns
 * stay in company_profiles so no data is lost; the page shows them read-only.
 */
export const RETIRED_FIELDS = [
  { key: "abstract", label: "Abstract" },
  { key: "short_description", label: "What We Do" },
  { key: "long_description", label: "Story & Mission" },
  { key: "medium_description", label: "Medium Description" },
  { key: "business_model", label: "Business Model" },
  { key: "core_value_proposition", label: "Core Value Proposition" },
  { key: "differentiation", label: "Differentiation" },
  { key: "market_category", label: "Market & Category" },
  { key: "how_it_works", label: "How It Works" },
  { key: "brand_voice", label: "Voice & Tone" },
  { key: "brand_feel", label: "Brand Personality" },
  { key: "target_audience", label: "Target searcher" },
  { key: "seo_primary_offer", label: "Primary offer" },
  { key: "seo_buyer_problems", label: "Problems before buying" },
  { key: "seo_content_edge", label: "Content edge" },
  { key: "seo_conversion_action", label: "Conversion action" },
  { key: "seo_commercial_url", label: "Commercial page URL" },
  { key: "seo_search_competitors", label: "Search competitors" },
  { key: "scope_boundaries", label: "What We Are Not" },
  { key: "location_markets", label: "Markets Served" },
  { key: "contact_email", label: "Contact Email" },
  { key: "founded_date", label: "Founded Date" },
  { key: "legal_name", label: "Legal Name" },
  { key: "company_stage", label: "Company Stage & Context" },
  { key: "customer_problem", label: "Customer Problem" },
  { key: "buying_criteria", label: "Buying Criteria" },
  { key: "customer_outcome", label: "Customer Outcome" },
  { key: "commercial_model", label: "Commercial Model" },
  { key: "messaging_hierarchy", label: "Messaging Hierarchy" },
  { key: "competitive_position", label: "Competitive Position" },
  { key: "market_dynamics", label: "Market Dynamics" },
  { key: "brand_references", label: "References" },
  { key: "brand_boundaries", label: "Brand Boundaries" },
  { key: "reasons_to_believe", label: "Reasons to Believe" },
  { key: "results_proof", label: "Results & Customer Proof" },
  { key: "trust_signals", label: "Other Trust Signals" },
  { key: "marketing_objectives", label: "Business & Marketing Objectives" },
  { key: "growth_priorities", label: "Priorities" },
  { key: "customer_acquisition", label: "Customer Acquisition & Sales" },
  { key: "competitors", label: "Competitors", list: true },
  { key: "services", label: "Products & Services", list: true },
  { key: "team_members", label: "Team & Founder Credibility", list: true },
  { key: "social_links", label: "Social Links", list: true },
];

function listItemText(item) {
  if (item == null) return "";
  if (typeof item !== "object") return String(item).trim();
  return Object.values(item)
    .map((v) => (Array.isArray(v) ? v.join(", ") : String(v ?? "")).trim())
    .filter(Boolean)
    .join(" — ");
}

/** Retired fields that hold something, with their content as plain text. */
export function retiredWithContent(row) {
  const r = row || {};
  return RETIRED_FIELDS.map((f) => {
    const value = r[f.key];
    const text = f.list
      ? (Array.isArray(value) ? value : []).map(listItemText).filter(Boolean).map((t) => `• ${t}`).join("\n")
      : String(value ?? "").trim();
    return { ...f, text };
  }).filter((f) => f.text);
}
