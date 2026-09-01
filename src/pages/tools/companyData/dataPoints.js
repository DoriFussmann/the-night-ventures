import { serviceHasContent } from "../templateToPrompt/customFieldKeys";

function textFilled(value) {
  return Boolean(String(value ?? "").trim());
}

function pillarsFilled(value) {
  const source = Array.isArray(value) ? value : [];
  return source.some((pillar) => {
    if (textFilled(pillar?.keyword)) return true;
    const supporting = Array.isArray(pillar?.supporting) ? pillar.supporting : [];
    return supporting.some((item) => textFilled(item));
  });
}

function competitorsFilled(value) {
  const source = Array.isArray(value) ? value : [];
  return source.some(
    (item) => textFilled(item?.name) || textFilled(item?.url)
  );
}

function servicesFilled(value) {
  const source = Array.isArray(value) ? value : [];
  return source.some(serviceHasContent);
}

function teamFilled(value) {
  const source = Array.isArray(value) ? value : [];
  return source.some(
    (item) =>
      textFilled(item?.name) ||
      textFilled(item?.role) ||
      textFilled(item?.bio) ||
      textFilled(item?.credentials) ||
      (Array.isArray(item?.same_as) && item.same_as.some(textFilled))
  );
}

function socialLinksFilled(value) {
  const source = Array.isArray(value) ? value : [];
  return source.some(
    (item) => textFilled(item?.label) || textFilled(item?.url)
  );
}

export const COMPANY_DATA_POINT_DEFS = [
  { id: "domain", label: "Domain", parsedKey: "domain" },
  { id: "product_name", label: "Product Name", parsedKey: "product_name" },
  { id: "category", label: "Category", parsedKey: "category" },
  { id: "target", label: "Target Description", parsedKey: "target_audience" },
  { id: "design-guide", label: "Design Abstract", parsedKey: "design-guide" },
  { id: "services", label: "Products & Services", parsedKey: "services" },
  { id: "abstract", label: "Abstract", parsedKey: "abstract" },
  { id: "short", label: "Short Description", parsedKey: "short_description" },
  { id: "medium", label: "Medium Description", parsedKey: "medium_description" },
  { id: "long", label: "Long Description", parsedKey: "long_description" },
  { id: "business_model", label: "Business Model", parsedKey: "business_model" },
  {
    id: "core_value_proposition",
    label: "Core Value Proposition",
    parsedKey: "core_value_proposition",
  },
  { id: "scope_boundaries", label: "Scope / Boundaries", parsedKey: "scope_boundaries", hidden: true },
  { id: "pillars", label: "Pillar Keywords", parsedKey: "core_keywords" },
  { id: "competitors", label: "Competitors", parsedKey: "competitors" },
  { id: "social-shops", label: "Social & Shops", parsedKey: "social_shops" },
  {
    id: "publish-destination",
    label: "Publish Destination",
    parsedKey: "publish_destination",
  },
];

export function getCompanyDataPoints({
  fields,
  selectedIndustryIds = [],
  socialShopsFilled = false,
  customFieldDefs = [],
  customValues = {},
  githubOwner = "",
  githubRepo = "",
  githubTokenKey = "",
}) {
  const hasDesignGuide =
    textFilled(fields?.design_guide_raw) ||
    textFilled(fields?.design_guide_abstract);

  const standard = COMPANY_DATA_POINT_DEFS.filter((def) => !def.hidden).map((def) => {
    let filled = false;
    switch (def.id) {
      case "domain":
        filled = textFilled(fields?.domain);
        break;
      case "product_name":
        filled = textFilled(fields?.product_name);
        break;
      case "category":
        filled = (selectedIndustryIds || []).length > 0;
        break;
      case "target":
        filled = textFilled(fields?.target_audience);
        break;
      case "design-guide":
        filled = hasDesignGuide;
        break;
      case "services":
        filled = servicesFilled(fields?.services);
        break;
      case "abstract":
        filled = textFilled(fields?.abstract);
        break;
      case "short":
        filled = textFilled(fields?.short_description);
        break;
      case "medium":
        filled = textFilled(fields?.medium_description);
        break;
      case "long":
        filled = textFilled(fields?.long_description);
        break;
      case "business_model":
        filled = textFilled(fields?.business_model);
        break;
      case "core_value_proposition":
        filled = textFilled(fields?.core_value_proposition);
        break;
      case "scope_boundaries":
        filled = textFilled(fields?.scope_boundaries);
        break;
      case "pillars":
        filled = pillarsFilled(fields?.core_keywords);
        break;
      case "competitors":
        filled = competitorsFilled(fields?.competitors);
        break;
      case "social-shops":
        filled = Boolean(socialShopsFilled);
        break;
      case "publish-destination":
        filled =
          textFilled(githubOwner) &&
          textFilled(githubRepo) &&
          textFilled(githubTokenKey);
        break;
      default:
        filled = false;
    }
    return { ...def, filled };
  });

  const custom = (customFieldDefs || []).map((def) => ({
    id: `custom:${def.id}`,
    label: def.name,
    parsedKey: `custom:${def.name}`,
    filled: textFilled(customValues?.[def.name]),
  }));

  return [...standard, ...custom];
}
