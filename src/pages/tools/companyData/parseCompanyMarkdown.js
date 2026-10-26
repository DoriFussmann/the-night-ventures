/** Parse a Company Data markdown export (and close variants) into structured fields. */

const SOCIAL_TYPES = ["Social Media", "Digital Store", "Other"];

const LABEL_TO_KEY = {
  domain: "domain",
  "product name": "product_name",
  product: "product_name",
  category: "category",
  categories: "category",
  industries: "category",
  "target description": "target_audience",
  "target audience": "target_audience",
  target: "target_audience",
  "ideal customer": "target_audience",
  abstract: "abstract",
  "short description": "short_description",
  "what we do": "short_description",
  "medium description": "medium_description",
  "long description": "long_description",
  "story & mission": "long_description",
  "story and mission": "long_description",
  "business model": "business_model",
  "company stage & context": "company_stage",
  "company stage and context": "company_stage",
  "company stage": "company_stage",
  "legal name": "legal_name",
  "founded / incorporation date": "founded_date",
  "founded/incorporation date": "founded_date",
  founded: "founded_date",
  "founded year": "founded_date",
  "location / markets served": "location_markets",
  "location/markets served": "location_markets",
  location: "location_markets",
  "customer problem": "customer_problem",
  "trigger / moment of need": "trigger_moment",
  "trigger/moment of need": "trigger_moment",
  trigger: "trigger_moment",
  "buying criteria": "buying_criteria",
  "how it works": "how_it_works",
  "customer outcome": "customer_outcome",
  "commercial model": "commercial_model",
  "core value proposition": "core_value_proposition",
  "value proposition": "core_value_proposition",
  differentiation: "differentiation",
  "messaging hierarchy": "messaging_hierarchy",
  "scope / boundaries": "scope_boundaries",
  "scope/boundaries": "scope_boundaries",
  "scope and boundaries": "scope_boundaries",
  "scope boundaries": "scope_boundaries",
  "what we are / are not": "scope_boundaries",
  "what we are/are not": "scope_boundaries",
  "market & category": "market_category",
  "market and category": "market_category",
  "competitive position": "competitive_position",
  "market dynamics": "market_dynamics",
  "brand personality": "brand_feel",
  "voice & tone": "brand_voice",
  "voice and tone": "brand_voice",
  references: "brand_references",
  "brand references": "brand_references",
  "brand boundaries": "brand_boundaries",
  "reasons to believe": "reasons_to_believe",
  "results & customer proof": "results_proof",
  "results and customer proof": "results_proof",
  "other trust signals": "trust_signals",
  "business & marketing objectives": "marketing_objectives",
  "business and marketing objectives": "marketing_objectives",
  priorities: "growth_priorities",
  "customer acquisition & sales": "customer_acquisition",
  "customer acquisition and sales": "customer_acquisition",
  "learnings & constraints": "learnings_constraints",
  "learnings and constraints": "learnings_constraints",
  "pillar keywords": "core_keywords",
  pillars: "core_keywords",
  competitors: "competitors",
  "competitors & alternatives": "competitors",
  "competitors and alternatives": "competitors",
  "products & services": "services",
  "products and services": "services",
  services: "services",
  products: "services",
  "social & shops": "social_shops",
  "social and shops": "social_shops",
  "design guide": "design_guide_raw",
  "design guidelines": "design_guide_raw",
  "brand tokens": "brand_tokens",
  "team members": "team_members",
  "team & founder credibility": "team_members",
  "team and founder credibility": "team_members",
  team: "team_members",
  "contact email": "contact_email",
  email: "contact_email",
  "social links": "social_links",
  "markets served": "location_markets",
  "founded date": "founded_date",
  "target searcher": "target_audience",
  "out-of-scope topics": "scope_boundaries",
  "out of scope topics": "scope_boundaries",
  "seo primary offer": "seo_primary_offer",
  "primary offer": "seo_primary_offer",
  "seo conversion action": "seo_conversion_action",
  "conversion action": "seo_conversion_action",
  "seo commercial page url": "seo_commercial_url",
  "commercial page url": "seo_commercial_url",
  "seo problems before buying": "seo_buyer_problems",
  "seo commercial url": "seo_commercial_url",
  "problems before buying": "seo_buyer_problems",
  "seo content edge": "seo_content_edge",
  "content edge": "seo_content_edge",
  "seo search market": "seo_market",
  "search market": "seo_market",
  "seo language": "seo_language",
  "seo search competitors": "seo_search_competitors",
  "search competitors": "seo_search_competitors",
};

const PLACEHOLDER_RE = /^\((?:unnamed|untitled|label|none)\)$/i;

/** Old brief headings. Recognized so they stay section boundaries, then dropped. */
const IGNORED_LABELS = new Set(["design abstract"]);

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeLabel(value) {
  return asText(value)
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/&amp;/g, "&");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPlaceholder(value) {
  return PLACEHOLDER_RE.test(asText(value));
}

function coerceHttpUrl(value) {
  const url = asText(value);
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (/^(www\.)?[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(url)) {
    return `https://${url}`;
  }
  return url;
}

function knownLabels(extraLabels = []) {
  const labels = new Set([
    ...Object.keys(LABEL_TO_KEY),
    ...IGNORED_LABELS,
    ...extraLabels.map(normalizeLabel).filter(Boolean),
  ]);
  return [...labels].sort((a, b) => b.length - a.length);
}

function resolveKey(rawLabel, extraLabels = []) {
  const normalized = normalizeLabel(rawLabel);
  if (!normalized) return null;
  if (IGNORED_LABELS.has(normalized)) return { type: "ignored" };
  if (LABEL_TO_KEY[normalized]) {
    return { type: "known", key: LABEL_TO_KEY[normalized] };
  }
  const extra = extraLabels.find(
    (name) => normalizeLabel(name) === normalized
  );
  if (extra) return { type: "custom", key: extra };
  return { type: "custom", key: asText(rawLabel) };
}

function assignSection(sections, custom, resolved, content) {
  const value = asText(content);
  if (!resolved || resolved.type === "ignored" || !value) return;
  if (resolved.type === "known") {
    if (sections[resolved.key] == null) sections[resolved.key] = value;
    return;
  }
  if (custom[resolved.key] == null) custom[resolved.key] = value;
}

function collectLineStartLabeledSections(text, extraLabels, sections, custom) {
  const labels = knownLabels(extraLabels);
  if (labels.length === 0) return;
  const pattern = labels.map(escapeRegExp).join("|");
  const re = new RegExp(`^\\*\\*(${pattern}):\\*\\*\\s*`, "gim");
  const matches = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    matches.push({
      rawLabel: match[1],
      start: match.index + match[0].length,
      markerStart: match.index,
    });
  }
  for (let i = 0; i < matches.length; i += 1) {
    const end = i + 1 < matches.length ? matches[i + 1].markerStart : text.length;
    const resolved = resolveKey(matches[i].rawLabel, extraLabels);
    assignSection(sections, custom, resolved, text.slice(matches[i].start, end));
  }
}

function collectHeadingSections(text, extraLabels, sections, custom) {
  const lines = text.split("\n");
  let current = null;

  const flush = () => {
    if (!current) return;
    assignSection(sections, custom, current.resolved, current.lines.join("\n"));
    current = null;
  };

  for (const line of lines) {
    const heading = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (heading) {
      const resolved = resolveKey(heading[1], extraLabels);
      const isKnown =
        resolved?.type === "known" ||
        resolved?.type === "ignored" ||
        (resolved?.type === "custom" &&
          extraLabels.some((name) => normalizeLabel(name) === normalizeLabel(heading[1])));
      if (isKnown) {
        flush();
        current = { resolved, lines: [] };
        continue;
      }
    }
    if (current) current.lines.push(line);
  }
  flush();
}

function collectBareLabelLines(text, extraLabels, sections, custom) {
  const labels = knownLabels(extraLabels);
  const pattern = labels.map(escapeRegExp).join("|");
  const re = new RegExp(`^(${pattern}):\\s+(\\S.*)$`, "gim");
  let match;
  while ((match = re.exec(text)) !== null) {
    const resolved = resolveKey(match[1], extraLabels);
    if (
      resolved?.key === "design_guide_raw" ||
      resolved?.key === "social_shops" ||
      resolved?.key === "brand_tokens"
    ) {
      continue;
    }
    assignSection(sections, custom, resolved, match[2]);
  }
}

function parseBulletLines(text) {
  return asText(text)
    .split("\n")
    .map((line) => line.match(/^\s*[-*]\s+(.*)$/))
    .filter(Boolean)
    .map((match) => asText(match[1]))
    .filter((line) => line && !isPlaceholder(line));
}

function parseTextField(value) {
  const text = asText(value);
  return text || null;
}

function parseCategory(value) {
  if (!asText(value)) return [];
  const bullets = parseBulletLines(value);
  if (bullets.length > 0) {
    return bullets.map((line) => line.replace(/:$/, "").trim()).filter(Boolean);
  }
  return asText(value)
    .split(/[,;\n]/)
    .map((item) => asText(item).replace(/^[-*]\s+/, ""))
    .filter(Boolean);
}

function parsePillars(value) {
  const lines = String(value || "").split("\n");
  const pillars = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    if (current.keyword || current.supporting.length > 0) pillars.push(current);
    current = null;
  };

  for (const line of lines) {
    const nested = line.match(/^\s{2,}[-*]\s+(.*)$/);
    if (nested && current) {
      const kw = asText(nested[1]);
      if (kw && !isPlaceholder(kw)) current.supporting.push(kw);
      continue;
    }
    const top = line.match(/^\s*[-*]\s+(.*)$/);
    if (top) {
      flush();
      const keyword = asText(top[1]);
      current = {
        keyword: isPlaceholder(keyword) ? "" : keyword,
        supporting: [],
      };
    }
  }
  flush();
  return pillars;
}

function parseCompetitors(value) {
  return parseBulletLines(value)
    .map((line) => {
      const split = line.match(/^(.+?):\s+(\S.*)$/);
      if (split) {
        const name = asText(split[1]);
        const url = coerceHttpUrl(split[2]);
        return {
          name: isPlaceholder(name) ? "" : name,
          url,
        };
      }
      if (/^https?:\/\//i.test(line) || /^(www\.)?[\w.-]+\.[a-z]{2,}/i.test(line)) {
        return { name: "", url: coerceHttpUrl(line) };
      }
      return { name: line, url: "" };
    })
    .filter((item) => item.name || item.url);
}

function parseServiceBlock(block) {
  const lines = String(block || "").split("\n");
  const entry = {
    title: "",
    summary: "",
    detail: "",
  };
  const fieldMap = {
    title: "title",
    summary: "summary",
    detail: "detail",
  };
  let pendingKey = null;

  for (const line of lines) {
    const labeled = line.match(/^([A-Za-z][A-Za-z ]*):\s*(.*)$/);
    if (labeled) {
      const key = fieldMap[normalizeLabel(labeled[1])];
      if (key) {
        entry[key] = asText(labeled[2]);
        pendingKey = key;
        continue;
      }
    }
    if (pendingKey && asText(line)) {
      entry[pendingKey] = `${entry[pendingKey]}\n${asText(line)}`.trim();
    }
  }

  if (isPlaceholder(entry.title)) entry.title = "";
  const hasContent = Object.values(entry).some((item) => asText(item));
  return hasContent ? entry : null;
}

function parseServices(value) {
  const text = asText(value);
  if (!text) return [];
  if (/^title:/im.test(text)) {
    const blocks = text.split(/\n(?=Title:\s*)/i);
    return blocks.map(parseServiceBlock).filter(Boolean);
  }
  return parseBulletLines(text).map((title) => ({
    title,
    summary: "",
    detail: "",
  }));
}

function parseTeamMembers(value) {
  const lines = String(value || "").split("\n");
  const members = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    if (
      current.name ||
      current.role ||
      current.bio ||
      current.credentials ||
      current.same_as.length > 0
    ) {
      members.push(current);
    }
    current = null;
  };

  for (const line of lines) {
    const urlLine = line.match(/^\s{2,}[-*]\s+(https?:\/\/\S+)/i);
    if (urlLine && current) {
      current.same_as.push(coerceHttpUrl(urlLine[1]));
      continue;
    }
    const top = line.match(/^\s*[-*]\s+(.*)$/);
    if (top && !/^\s{2,}/.test(line)) {
      flush();
      const rest = asText(top[1]);
      const [namePart, metaPart] = rest.split(/:\s+/, 2);
      const name = asText(namePart);
      const meta = asText(metaPart || "");
      const [role, credentials] = meta
        ? meta.split(/\s·\s/).map(asText)
        : ["", ""];
      current = {
        name: isPlaceholder(name) ? "" : name,
        role: role || "",
        credentials: credentials || "",
        bio: "",
        same_as: [],
      };
      continue;
    }
    if (current && asText(line)) {
      current.bio = current.bio ? `${current.bio}\n${asText(line)}` : asText(line);
    }
  }
  flush();
  return members;
}

function parseSocialLinks(value) {
  return parseBulletLines(value)
    .map((line) => {
      const split = line.match(/^(.+?):\s+(\S.*)$/);
      if (split) {
        const label = asText(split[1]);
        return {
          label: isPlaceholder(label) ? "" : label,
          url: coerceHttpUrl(split[2]),
        };
      }
      if (/^https?:\/\//i.test(line)) return { label: "", url: coerceHttpUrl(line) };
      return { label: line, url: "" };
    })
    .filter((item) => item.label || item.url);
}

function parseAccountDetailLines(lines) {
  const account = {
    name: "",
    type: "",
    status: "",
    url: "",
    username: "",
    access_details: "",
    comments: "",
  };
  const map = {
    type: "type",
    status: "status",
    url: "url",
    username: "username",
    "access details": "access_details",
    comments: "comments",
  };
  for (const line of lines) {
    const detail = line.match(/^\s{2,}[-*]\s+([^:]+):\s*(.*)$/);
    if (!detail) continue;
    const key = map[normalizeLabel(detail[1])];
    if (!key) continue;
    account[key] = asText(detail[2]);
  }
  if (account.url) account.url = coerceHttpUrl(account.url);
  if (account.type && !SOCIAL_TYPES.includes(account.type)) {
    const match = SOCIAL_TYPES.find(
      (type) => type.toLowerCase() === account.type.toLowerCase()
    );
    account.type = match || "Other";
  }
  return account;
}

function parseSocialShops(value) {
  const text = asText(value);
  if (!text) return { accounts: [], notes: [] };

  const accounts = [];
  const notes = [];
  const lines = text.split("\n");
  let section = "accounts";
  let sectionType = "";
  let currentName = null;
  let currentLines = [];

  const flushAccount = () => {
    if (!currentName) return;
    const account = parseAccountDetailLines(currentLines);
    account.name = isPlaceholder(currentName) ? "" : currentName;
    if (!account.type) account.type = sectionType || "Other";
    if (account.name) accounts.push(account);
    currentName = null;
    currentLines = [];
  };

  for (const line of lines) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) {
      flushAccount();
      const title = asText(heading[1]);
      if (normalizeLabel(title) === "notes") {
        section = "notes";
        sectionType = "";
      } else {
        section = "accounts";
        sectionType = SOCIAL_TYPES.includes(title) ? title : "Other";
      }
      continue;
    }

    if (section === "notes") {
      const note = line.match(/^\s*[-*]\s+(.*)$/);
      if (note && asText(note[1])) notes.push(asText(note[1]));
      continue;
    }

    const nested = line.match(/^\s{2,}[-*]\s+/);
    if (nested && currentName) {
      currentLines.push(line);
      continue;
    }

    const top = line.match(/^\s*[-*]\s+(.*)$/);
    if (top) {
      flushAccount();
      currentName = asText(top[1]);
      currentLines = [];
    }
  }
  flushAccount();
  return { accounts, notes };
}

/**
 * @param {string} markdown
 * @param {{ extraLabels?: string[] }} [options]
 */
export function parseCompanyMarkdown(markdown, options = {}) {
  const extraLabels = Array.isArray(options.extraLabels) ? options.extraLabels : [];
  const text = String(markdown ?? "").replace(/\r\n/g, "\n");
  const sections = {};
  const custom = {};

  collectLineStartLabeledSections(text, extraLabels, sections, custom);
  collectHeadingSections(text, extraLabels, sections, custom);
  collectBareLabelLines(text, extraLabels, sections, custom);

  const socialShops = sections.social_shops
    ? parseSocialShops(sections.social_shops)
    : { accounts: [], notes: [] };

  return {
    domain: parseTextField(sections.domain),
    product_name: parseTextField(sections.product_name),
    category: parseCategory(sections.category),
    target_audience: parseTextField(sections.target_audience),
    abstract: parseTextField(sections.abstract),
    short_description: parseTextField(sections.short_description),
    medium_description: parseTextField(sections.medium_description),
    long_description: parseTextField(sections.long_description),
    business_model: parseTextField(sections.business_model),
    core_value_proposition: parseTextField(sections.core_value_proposition),
    scope_boundaries: parseTextField(sections.scope_boundaries),
    core_keywords: parsePillars(sections.core_keywords),
    competitors: parseCompetitors(sections.competitors),
    services: parseServices(sections.services),
    team_members: parseTeamMembers(sections.team_members),
    contact_email: parseTextField(sections.contact_email),
    social_links: parseSocialLinks(sections.social_links),
    social_shops: socialShops,
    legal_name: parseTextField(sections.legal_name),
    founded_date: parseTextField(sections.founded_date),
    location_markets: parseTextField(sections.location_markets),
    company_stage: parseTextField(sections.company_stage),
    customer_problem: parseTextField(sections.customer_problem),
    trigger_moment: parseTextField(sections.trigger_moment),
    buying_criteria: parseTextField(sections.buying_criteria),
    how_it_works: parseTextField(sections.how_it_works),
    customer_outcome: parseTextField(sections.customer_outcome),
    commercial_model: parseTextField(sections.commercial_model),
    differentiation: parseTextField(sections.differentiation),
    messaging_hierarchy: parseTextField(sections.messaging_hierarchy),
    market_category: parseTextField(sections.market_category),
    competitive_position: parseTextField(sections.competitive_position),
    market_dynamics: parseTextField(sections.market_dynamics),
    brand_feel: parseTextField(sections.brand_feel),
    brand_voice: parseTextField(sections.brand_voice),
    brand_references: parseTextField(sections.brand_references),
    brand_boundaries: parseTextField(sections.brand_boundaries),
    reasons_to_believe: parseTextField(sections.reasons_to_believe),
    results_proof: parseTextField(sections.results_proof),
    trust_signals: parseTextField(sections.trust_signals),
    marketing_objectives: parseTextField(sections.marketing_objectives),
    growth_priorities: parseTextField(sections.growth_priorities),
    customer_acquisition: parseTextField(sections.customer_acquisition),
    learnings_constraints: parseTextField(sections.learnings_constraints),
    seo_primary_offer: parseTextField(sections.seo_primary_offer),
    seo_conversion_action: parseTextField(sections.seo_conversion_action),
    seo_commercial_url: parseTextField(sections.seo_commercial_url),
    seo_buyer_problems: parseTextField(sections.seo_buyer_problems),
    seo_content_edge: parseTextField(sections.seo_content_edge),
    seo_market: parseTextField(sections.seo_market),
    seo_language: parseTextField(sections.seo_language),
    seo_search_competitors: parseTextField(sections.seo_search_competitors),
    custom,
  };
}

export function parsedFieldPresent(parsed, key) {
  if (!parsed) return false;
  if (key === "category") return (parsed.category || []).length > 0;
  if (key === "core_keywords") return (parsed.core_keywords || []).length > 0;
  if (key === "competitors") return (parsed.competitors || []).length > 0;
  if (key === "services") return (parsed.services || []).length > 0;
  if (key === "team_members") return (parsed.team_members || []).length > 0;
  if (key === "social_links") return (parsed.social_links || []).length > 0;
  if (key === "social_shops") {
    return (parsed.social_shops?.accounts || []).length > 0;
  }
  return Boolean(asText(parsed[key]));
}
