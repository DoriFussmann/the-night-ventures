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

function matchIndustryIds(names, industries) {
  const byName = new Map(
    (industries || []).map((industry) => [
      String(industry.name || "")
        .trim()
        .toLowerCase(),
      industry.id,
    ])
  );
  const ids = [];
  for (const name of names || []) {
    const id = byName.get(String(name || "").trim().toLowerCase());
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function customNameFromParsed(parsed, defName) {
  if (!parsed?.custom) return null;
  if (textFilled(parsed.custom[defName])) return parsed.custom[defName];
  const match = Object.entries(parsed.custom).find(
    ([name, value]) =>
      name.trim().toLowerCase() === String(defName || "").trim().toLowerCase() &&
      textFilled(value)
  );
  return match ? match[1] : null;
}

/**
 * Fill only currently empty company fields from a parsed markdown file.
 */
export function mergeParsedCompanyFields({
  parsed,
  fields,
  customValues,
  customFieldDefs = [],
  selectedIndustryIds = [],
  industries = [],
  socialShopsFilled = false,
}) {
  const nextFields = { ...fields };
  const nextCustom = { ...customValues };
  let nextIndustryIds = [...selectedIndustryIds];
  let nextSocialAccounts = null;
  let nextSocialNotes = null;
  const filled = [];
  const skipped = [];
  const notInFile = [];

  const points = getCompanyDataPoints({
    fields,
    selectedIndustryIds,
    socialShopsFilled,
    customFieldDefs,
    customValues,
  });

  for (const point of points) {
    if (point.id === "publish-destination" || point.id === "design-guide") continue;

    const inFile =
      point.id.startsWith("custom:")
        ? Boolean(customNameFromParsed(parsed, point.label))
        : parsedFieldPresent(parsed, point.parsedKey);

    if (!inFile) {
      notInFile.push(point.label);
      continue;
    }
    if (point.filled) {
      skipped.push(point.label);
      continue;
    }

    switch (point.id) {
      case "domain":
        nextFields.domain = parsed.domain;
        break;
      case "product_name":
        nextFields.product_name = parsed.product_name;
        break;
      case "category": {
        const ids = matchIndustryIds(parsed.category, industries);
        if (ids.length === 0) {
          notInFile.push(point.label);
          continue;
        }
        nextIndustryIds = ids;
        break;
      }
      case "target":
        nextFields.target_audience = parsed.target_audience;
        break;
      case "services":
        nextFields.services = parsed.services;
        break;
      case "abstract":
        nextFields.abstract = parsed.abstract;
        break;
      case "short":
        nextFields.short_description = parsed.short_description;
        break;
      case "medium":
        nextFields.medium_description = parsed.medium_description;
        break;
      case "long":
        nextFields.long_description = parsed.long_description;
        break;
      case "business_model":
        nextFields.business_model = parsed.business_model;
        break;
      case "core_value_proposition":
        nextFields.core_value_proposition = parsed.core_value_proposition;
        break;
      case "pillars":
        nextFields.core_keywords = parsed.core_keywords;
        break;
      case "competitors":
        nextFields.competitors = parsed.competitors;
        break;
      case "social-shops":
        nextSocialAccounts = parsed.social_shops?.accounts || [];
        nextSocialNotes = parsed.social_shops?.notes || [];
        break;
      default: {
        if (point.id.startsWith("custom:")) {
          const value = customNameFromParsed(parsed, point.label);
          if (value) nextCustom[point.label] = value;
        }
        break;
      }
    }

    filled.push(point.label);
  }

  if ((parsed.team_members || []).length > 0) {
    if (!teamFilled(fields.team_members)) {
      nextFields.team_members = parsed.team_members;
      filled.push("Team Members");
    } else {
      skipped.push("Team Members");
    }
  }
  if (parsed.contact_email) {
    if (!textFilled(fields.contact_email)) {
      nextFields.contact_email = parsed.contact_email;
      filled.push("Contact Email");
    } else {
      skipped.push("Contact Email");
    }
  }
  if ((parsed.social_links || []).length > 0) {
    if (!socialLinksFilled(fields.social_links)) {
      nextFields.social_links = parsed.social_links;
      filled.push("Social Links");
    } else {
      skipped.push("Social Links");
    }
  }

  const brandTokenKeys = [
    "brand_feel",
    "brand_accent",
    "brand_band",
    "brand_positive",
    "wordmark_primary",
    "wordmark_accent",
    "brand_voice",
  ];
  let brandFilledAny = false;
  for (const key of brandTokenKeys) {
    if (!textFilled(fields[key]) && textFilled(parsed[key])) {
      nextFields[key] = parsed[key];
      brandFilledAny = true;
    }
  }
  if (brandFilledAny) {
    filled.push("Brand Tokens");
  }

  return {
    nextFields,
    nextCustom,
    nextIndustryIds,
    socialAccounts: nextSocialAccounts,
    socialNotes: nextSocialNotes,
    filled,
    skipped,
    notInFile,
  };
}
