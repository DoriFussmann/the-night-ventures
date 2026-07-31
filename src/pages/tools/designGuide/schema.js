export const FIELD_SCHEMA = [
  {
    id: "brandIdentity",
    title: "Brand Identity",
    fields: [
      { key: "brandName", label: "Brand Name", type: "text", required: true },
      { key: "brandFeel", label: "Brand Feel", type: "text", required: true },
      { key: "mission", label: "Mission", type: "textarea", required: false },
      { key: "brandValues", label: "Brand Values", type: "textarea", required: false },
      { key: "emotionalGoal", label: "Emotional Goal", type: "textarea", required: false },
      { key: "brandRefs", label: "Brand References", type: "textarea", required: false },
    ],
  },
  {
    id: "colorPalette",
    title: "Color Palette",
    fields: [
      { key: "namedPalette", label: "Named Palette", type: "textarea", required: false },
      { key: "colorPrimary", label: "Primary", type: "color", required: true },
      { key: "colorSecondary", label: "Secondary", type: "color", required: true },
      { key: "colorAccent", label: "Accent", type: "color", required: true },
      { key: "colorBg", label: "Background", type: "color", required: true },
      { key: "colorSurface", label: "Surface", type: "color", required: false },
      { key: "colorBorder", label: "Border", type: "color", required: false },
      { key: "colorTextMuted", label: "Muted Text", type: "color", required: false },
      { key: "colorHeading", label: "Heading", type: "color", required: true },
      { key: "colorBody", label: "Body", type: "color", required: true },
      { key: "colorSuccess", label: "Success", type: "color", required: false },
      { key: "colorWarning", label: "Warning", type: "color", required: false },
      { key: "colorError", label: "Error", type: "color", required: false },
      {
        key: "darkMode",
        label: "Dark Mode",
        type: "select",
        required: true,
        options: ["No", "Yes"],
      },
      {
        key: "minContrast",
        label: "Minimum Contrast",
        type: "select",
        required: true,
        options: [
          "WCAG AA (4.5:1 body / 3:1 large)",
          "WCAG AAA (7:1 body / 4.5:1 large)",
        ],
      },
    ],
  },
  {
    id: "typography",
    title: "Typography",
    fields: [
      { key: "fontHeading", label: "Heading Font", type: "text", required: true },
      { key: "fontBody", label: "Body Font", type: "text", required: true },
      { key: "fontMono", label: "Mono Font", type: "text", required: false },
      { key: "typeFeel", label: "Type Feel", type: "text", required: false },
      { key: "typeScale", label: "Type Scale", type: "text", required: true },
      { key: "lineHeight", label: "Line Height", type: "text", required: false },
      { key: "fontWeights", label: "Font Weights", type: "text", required: false },
    ],
  },
  {
    id: "spacingLayout",
    title: "Spacing & Layout",
    fields: [
      { key: "baseUnit", label: "Base Unit", type: "text", required: true },
      { key: "maxArticleWidth", label: "Max Article Width", type: "text", required: true },
      { key: "maxContainerWidth", label: "Max Container Width", type: "text", required: false },
      { key: "breakpoints", label: "Breakpoints", type: "text", required: true },
      { key: "gridSystem", label: "Grid System", type: "text", required: false },
    ],
  },
  {
    id: "componentStyling",
    title: "Component Styling Direction",
    fields: [
      { key: "compButtons", label: "Buttons", type: "textarea", required: false },
      { key: "compCards", label: "Cards", type: "textarea", required: false },
      { key: "compForms", label: "Forms", type: "textarea", required: false },
      { key: "compNav", label: "Navigation", type: "textarea", required: false },
      { key: "compFooter", label: "Footer", type: "textarea", required: false },
      { key: "compLinks", label: "Links", type: "text", required: false },
    ],
  },
  {
    id: "imagery",
    title: "Imagery & Photography",
    fields: [
      { key: "photoStyle", label: "Photo Style", type: "text", required: false },
      { key: "photoSubjects", label: "Photo Subjects", type: "textarea", required: false },
      { key: "photoUse", label: "Photo Use", type: "text", required: false },
      { key: "photoAvoid", label: "Photo Avoid", type: "text", required: false },
      { key: "iconSet", label: "Icon Set", type: "text", required: false },
      { key: "imageTreatment", label: "Image Treatment", type: "text", required: false },
    ],
  },
  {
    id: "illustration",
    title: "Illustration Style",
    fields: [
      {
        key: "illustrationStyle",
        label: "Illustration Style",
        type: "textarea",
        required: false,
      },
      {
        key: "illustrationThemes",
        label: "Illustration Themes",
        type: "text",
        required: false,
      },
    ],
  },
  {
    id: "toneMotion",
    title: "Tone & Motion",
    fields: [
      { key: "toneAdjectives", label: "Tone Adjectives", type: "text", required: true },
      {
        key: "motionLevel",
        label: "Motion Level",
        type: "select",
        required: true,
        options: ["None", "Subtle", "Expressive"],
      },
      { key: "motionIdeas", label: "Motion Ideas", type: "textarea", required: false },
      { key: "toneAvoid", label: "Tone Avoid", type: "textarea", required: false },
    ],
  },
  {
    id: "brandVoice",
    title: "Brand Voice & Copywriting",
    fields: [
      { key: "voiceTone", label: "Voice Tone", type: "text", required: false },
      { key: "voiceAvoidWords", label: "Words to Avoid", type: "text", required: false },
      {
        key: "voicePreferredPhrases",
        label: "Preferred Phrases",
        type: "textarea",
        required: false,
      },
    ],
  },
  {
    id: "pageStructure",
    title: "Page Structure & Hero Copy",
    fields: [
      {
        key: "homepageSections",
        label: "Homepage Sections",
        type: "textarea",
        required: false,
      },
      { key: "heroHeadline", label: "Hero Headline", type: "text", required: false },
      {
        key: "heroSubheadline",
        label: "Hero Subheadline",
        type: "textarea",
        required: false,
      },
      { key: "heroCTA", label: "Hero CTA", type: "text", required: false },
    ],
  },
  {
    id: "accessibility",
    title: "Accessibility Baseline",
    fields: [
      {
        key: "a11yFocus",
        label: "Focus State",
        type: "text",
        required: false,
        placeholder: "All interactive elements must have a visible focus state",
      },
      {
        key: "a11yTap",
        label: "Tap Target Size",
        type: "text",
        required: false,
        placeholder: "44×44px",
      },
      {
        key: "a11yZoom",
        label: "Zoom / Reflow",
        type: "text",
        required: false,
        placeholder: "Readable at 200% zoom, no horizontal scroll",
      },
    ],
  },
  {
    id: "antiPatterns",
    title: "Explicit Anti-Patterns",
    fields: [
      { key: "antiPatterns", label: "Anti-Patterns", type: "textarea", required: true },
    ],
  },
];

export const ALL_FIELDS = FIELD_SCHEMA.flatMap((cat) => cat.fields);

export const ALL_FIELD_KEYS = ALL_FIELDS.map((f) => f.key);

export const REQUIRED_KEYS = ALL_FIELDS.filter((f) => f.required).map((f) => f.key);

export const FIELD_BY_KEY = Object.fromEntries(ALL_FIELDS.map((f) => [f.key, f]));

export const CATEGORY_BY_FIELD_KEY = Object.fromEntries(
  FIELD_SCHEMA.flatMap((cat) => cat.fields.map((f) => [f.key, cat.id]))
);

export const COLOR_ASSIGN_TARGETS = [
  { key: "colorPrimary", label: "Primary" },
  { key: "colorSecondary", label: "Secondary" },
  { key: "colorAccent", label: "Accent" },
  { key: "colorBg", label: "Background" },
  { key: "colorSurface", label: "Surface" },
  { key: "colorBorder", label: "Border" },
];

export function emptyFields() {
  const fields = {};
  for (const key of ALL_FIELD_KEYS) {
    fields[key] = "";
  }
  return fields;
}

export function isFilled(value) {
  return String(value ?? "").trim().length > 0;
}

export function normalizeFields(stored) {
  const base = emptyFields();
  if (!stored || typeof stored !== "object") return base;
  for (const key of ALL_FIELD_KEYS) {
    if (stored[key] != null) {
      base[key] = String(stored[key]);
    }
  }
  return base;
}

export function countFilledInCategory(category, fields) {
  const total = category.fields.length;
  const filled = category.fields.filter((f) => isFilled(fields[f.key])).length;
  return { filled, total };
}

export function getFilledContext(fields) {
  const context = {};
  for (const key of ALL_FIELD_KEYS) {
    if (isFilled(fields[key])) {
      context[key] = String(fields[key]).trim();
    }
  }
  return context;
}

export function getEmptyKeys(fields) {
  return ALL_FIELD_KEYS.filter((key) => !isFilled(fields[key]));
}

export function getMissingRequired(fields) {
  return REQUIRED_KEYS.filter((key) => !isFilled(fields[key])).map((key) => ({
    key,
    label: FIELD_BY_KEY[key]?.label || key,
    categoryId: CATEGORY_BY_FIELD_KEY[key],
  }));
}

export function mergeIntoEmpty(current, incoming) {
  const next = { ...current };
  const applied = [];
  if (!incoming || typeof incoming !== "object") {
    return { fields: next, applied };
  }
  for (const key of ALL_FIELD_KEYS) {
    if (!(key in incoming)) continue;
    const value = incoming[key];
    if (value == null || String(value).trim() === "") continue;
    if (isFilled(next[key])) continue;
    next[key] = String(value).trim();
    applied.push(key);
  }
  return { fields: next, applied };
}
