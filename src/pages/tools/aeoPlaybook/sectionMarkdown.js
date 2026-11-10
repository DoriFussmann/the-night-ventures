import { supabase } from "@/lib/supabase";
import { downloadMarkdown } from "../siteBuildFlow/buildFlowMarkdown";
import { BRAND_FACTS_NOTE, BRAND_SECTIONS, COMMERCIAL_FIELDS, IMAGE_STYLE_FIELD } from "./api";
import { RETIRED_FIELDS, retiredWithContent } from "./retiredFields";

/** One downloadable .md per AEO Playbook tab. Everything is the saved data, not unsaved edits. */
export const SECTION_LABELS = {
  company: "Company",
  brand: "Brand Facts",
  personas: "ICP & Personas",
  prompts: "Prompts",
  map: "Content Map",
};

const FILE_SLUGS = {
  company: "company",
  brand: "brand-facts",
  personas: "icp-personas",
  prompts: "prompts",
  map: "content-map",
};

const PERSONA_FIELDS = [
  ["stage", "Stage"],
  ["trigger", "Trigger"],
  ["need", "Need"],
  ["pains", "Pains and objections"],
  ["decision_criteria", "Decision criteria"],
  ["alternatives", "Alternatives they weigh"],
  ["their_words", "Their words (real queries)"],
  ["where_they_listen", "Where they listen"],
  ["main_tiers", "Main intent tiers"],
];

const TRAINING_POLICY_LABELS = {
  allow: "Allow AI training crawlers",
  block: "Block AI training crawlers",
  any: "No preference",
};

const EMPTY = "_Empty_";
const text = (value) => String(value ?? "").trim();
const orEmpty = (value) => text(value) || EMPTY;
const bullets = (items) => {
  const list = (items || []).map(text).filter(Boolean);
  return list.length ? list.map((item) => `- ${item}`).join("\n") : EMPTY;
};
/** Table cell: one line, pipes escaped. */
const cell = (value) => (value === null || value === undefined ? "" : String(value)).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
const table = (headers, rows) =>
  [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");

const slugify = (value) =>
  text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function header(companyName, section) {
  const date = new Date().toISOString().slice(0, 10);
  return `# ${companyName ? `${companyName}: ` : ""}AEO Playbook, ${SECTION_LABELS[section]}\n\n_Exported ${date}_`;
}

async function companyMarkdown(companyId) {
  const [companyRes, profileRes] = await Promise.all([
    supabase.from("companies").select("name, github_owner, github_repo").eq("id", companyId).maybeSingle(),
    supabase
      .from("company_profiles")
      .select(
        `domain, product_name, seo_market, seo_language, ai_training_bot_policy, ${[...COMMERCIAL_FIELDS, IMAGE_STYLE_FIELD, ...RETIRED_FIELDS].map((f) => f.key).join(", ")}`
      )
      .eq("company_id", companyId)
      .maybeSingle(),
  ]);
  if (companyRes.error) throw new Error(companyRes.error.message);
  if (profileRes.error) throw new Error(profileRes.error.message);
  const c = companyRes.data || {};
  const p = profileRes.data || {};
  const parts = [
    "## Basics",
    [
      `- **Company name:** ${orEmpty(c.name)}`,
      `- **Domain:** ${orEmpty(p.domain)}`,
      `- **Product name:** ${orEmpty(p.product_name)}`,
      `- **Search market:** ${orEmpty(p.seo_market)}`,
      `- **Language:** ${orEmpty(p.seo_language)}`,
      `- **AI training crawlers:** ${TRAINING_POLICY_LABELS[p.ai_training_bot_policy || "allow"] || p.ai_training_bot_policy}`,
    ].join("\n"),
    "## Commercial and sales",
    ...COMMERCIAL_FIELDS.flatMap((f) => [`### ${f.label}`, orEmpty(p[f.key])]),
    "## Article images",
    `### ${IMAGE_STYLE_FIELD.label}`,
    orEmpty(p[IMAGE_STYLE_FIELD.key]),
    "## Publish Destination",
    [`- **GitHub owner:** ${orEmpty(c.github_owner)}`, `- **GitHub repo:** ${orEmpty(c.github_repo)}`].join("\n"),
  ];
  const retired = retiredWithContent(p);
  if (retired.length) {
    parts.push("## Retired fields (read only)", "Old Company Intelligence fields. Nothing reads them; they are kept so nothing is lost.");
    for (const f of retired) parts.push(`### ${f.label}`, f.text.replace(/^• /gm, "- "));
  }
  return parts;
}

function brandMarkdown({ playbook }) {
  const facts = playbook.brand_facts;
  const parts = [`_${BRAND_FACTS_NOTE}_`, "## Live wording (frozen)"];
  const live = (facts.live_wording || []).filter((r) => text(r?.where) || text(r?.text));
  parts.push(live.length ? live.map((r) => `- **${orEmpty(r.where)}:** ${orEmpty(r.text)}`).join("\n") : EMPTY);

  for (const s of BRAND_SECTIONS) {
    parts.push(`## ${s.label}`);
    if (s.key === "conversion") {
      parts.push(
        [`- **Call to action:** ${orEmpty(facts.conversion_action)}`, `- **Conversion page URL:** ${orEmpty(facts.conversion_url)}`].join("\n")
      );
    }
    parts.push(orEmpty(facts[s.key]));
  }

  parts.push(
    "## Claims and scope",
    "### Approved (use as written)",
    bullets(facts.approved_claims),
    "### Never claim",
    bullets(facts.never_claims),
    "### Out of scope topics",
    bullets(facts.out_of_scope),
    "## Competitors"
  );
  const competitors = (facts.competitors || []).filter((r) => Object.values(r || {}).some(text));
  if (!competitors.length) parts.push(EMPTY);
  for (const r of competitors) {
    parts.push(
      `### ${orEmpty(r.name)}`,
      [
        `- **URL:** ${orEmpty(r.url)}`,
        `- **What it is:** ${orEmpty(r.what)}`,
        `- **How it charges:** ${orEmpty(r.charges)}`,
        `- **Category vs us:** ${orEmpty(r.category)}`,
      ].join("\n")
    );
  }
  parts.push("## Open items", bullets(facts.open_items));
  return parts;
}

function personasMarkdown({ playbook, personas }) {
  const parts = ["## ICP", orEmpty(playbook.icp), "## Shared by all personas", bullets(playbook.shared_traits), `## Personas (${personas.length})`];
  if (!personas.length) parts.push(EMPTY);
  for (const p of personas) {
    parts.push(`### ${p.code} · ${orEmpty(p.name)}`);
    if (text(p.summary)) parts.push(text(p.summary));
    for (const [key, label] of PERSONA_FIELDS) parts.push(`**${label}**`, orEmpty(p[key]));
  }
  return parts;
}

function promptsMarkdown({ prompts, personas, groups, pillars }) {
  const personaById = new Map(personas.map((p) => [p.id, p]));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const pillarById = new Map(pillars.map((p) => [p.id, p]));
  const rows = prompts.map((p) => {
    const persona = personaById.get(p.persona_id);
    const group = groupById.get(p.group_id);
    return [
      p.code,
      p.prompt,
      p.keyword,
      persona ? `${persona.code} · ${persona.name}` : "",
      p.intent_tier,
      p.search_volume,
      p.keyword_difficulty,
      p.gsc_impressions,
      p.gsc_best_position,
      p.bing_impressions,
      p.cited_today,
      p.business_value,
      group ? `${group.code} · ${group.name}` : "Unassigned",
      pillarById.get(group?.pillar_id)?.name || "",
    ];
  });
  return [
    `## Prompts (${prompts.length})`,
    prompts.length
      ? table(
          ["ID", "Prompt", "Keyword", "Persona", "Tier", "Volume", "KD", "Google impr.", "Best pos.", "Bing impr.", "Cited today", "Value", "Prompt group", "Pillar"],
          rows
        )
      : EMPTY,
  ];
}

function mapMarkdown({ pillars, groups, prompts, personas }) {
  const personaById = new Map(personas.map((p) => [p.id, p]));
  const promptsByGroup = new Map();
  for (const p of prompts) {
    if (!promptsByGroup.has(p.group_id)) promptsByGroup.set(p.group_id, []);
    promptsByGroup.get(p.group_id).push(p);
  }
  const tiers = { Buy: 0, Problem: 0, Learn: 0 };
  for (const p of prompts) if (p.intent_tier in tiers) tiers[p.intent_tier] += 1;
  const statuses = {};
  for (const g of groups) statuses[g.status] = (statuses[g.status] || 0) + 1;

  const parts = [
    "## Summary",
    [
      `- **Personas:** ${personas.length}`,
      `- **Prompts:** ${prompts.length} (Buy ${tiers.Buy} · Problem ${tiers.Problem} · Learn ${tiers.Learn})`,
      `- **Prompt groups (articles):** ${groups.length}`,
      `- **Pillars:** ${pillars.length}`,
      `- **Groups by status:** ${Object.entries(statuses).map(([s, n]) => `${s} ${n}`).join(" · ") || "none"}`,
    ].join("\n"),
  ];

  const groupBlock = (g) => {
    const list = promptsByGroup.get(g.id) || [];
    const lines = [
      `- **Page type:** ${g.page_type}`,
      `- **Status:** ${g.status}`,
      `- **Live slug:** ${orEmpty(g.live_slug)}`,
      `- **Primary keyword:** ${orEmpty(g.primary_keyword)}`,
    ];
    if (text(g.notes)) lines.push(`- **Notes:** ${cell(g.notes)}`);
    const out = [`### ${g.code} · ${orEmpty(g.name)}`, lines.join("\n")];
    out.push(
      list.length
        ? table(
            ["ID", "Prompt", "Tier", "Persona", "Keyword"],
            list.map((p) => [p.code, p.prompt, p.intent_tier, personaById.get(p.persona_id)?.code || "", p.keyword])
          )
        : "_No prompts in this group._"
    );
    return out;
  };

  for (const pillar of pillars) {
    const list = groups.filter((g) => g.pillar_id === pillar.id);
    parts.push(
      `## ${pillar.code} · ${orEmpty(pillar.name)}${pillar.is_new ? " (new pillar)" : ""}`,
      [
        `- **Site topic name:** ${orEmpty(pillar.topic_name)}`,
        `- **Hub page:** ${orEmpty(pillar.hub_path)}`,
        `- **Pillar article:** ${orEmpty(pillar.pillar_article_slug)}`,
        `- **Groups:** ${list.length}`,
      ].join("\n")
    );
    for (const g of list) parts.push(...groupBlock(g));
  }

  const loose = groups.filter((g) => !g.pillar_id);
  if (loose.length) {
    parts.push("## Groups without a pillar");
    for (const g of loose) parts.push(...groupBlock(g));
  }
  const ungrouped = promptsByGroup.get(null) || [];
  if (ungrouped.length) {
    parts.push(
      `## Prompts without a group (${ungrouped.length})`,
      table(
        ["ID", "Prompt", "Tier", "Persona", "Keyword"],
        ungrouped.map((p) => [p.code, p.prompt, p.intent_tier, personaById.get(p.persona_id)?.code || "", p.keyword])
      )
    );
  }
  return parts;
}

const BUILDERS = { brand: brandMarkdown, personas: personasMarkdown, prompts: promptsMarkdown, map: mapMarkdown };

/** Build one section's markdown. `data` is the loaded playbook; Company reads its own tables. */
export async function buildSectionMarkdown(section, companyId, data) {
  const { data: company } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
  const companyName = text(company?.name);
  const parts = section === "company" ? await companyMarkdown(companyId) : BUILDERS[section](data);
  return {
    filename: `${[slugify(companyName), "aeo-playbook", FILE_SLUGS[section]].filter(Boolean).join("-")}.md`,
    content: `${[header(companyName, section), ...parts].join("\n\n")}\n`,
  };
}

export async function downloadSectionMarkdown(section, companyId, data) {
  const { filename, content } = await buildSectionMarkdown(section, companyId, data);
  downloadMarkdown(filename, content);
}
