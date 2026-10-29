export const ARTICLE_TYPES = [
  { value: "comprehensive", label: "Comprehensive" },
  { value: "howto", label: "How-to" },
  { value: "comparison", label: "Comparison" },
  { value: "faq", label: "FAQ" },
  { value: "flex", label: "Flex" },
];

export const initialComposeState = {
  stage: "input",
  pillarKeyword: "",
  clusterKeyword: "",
  targetKeyword: "",
  articleType: "flex",
  wordCount: 1500,
  ctaAngle: "",
  allowedBrandsText: "",
  ideaText: "",
  keyPoints: [""],
  sourceArticle: "",
  originalTitle: "",
  originalDescription: "",
  userLinks: [],
  imagesRemoved: 0,
  expandLength: false,
  sourceFileError: "",
  originalSource: "",
  generating: false,
  generationError: "",
  validationErrors: [],
  draftId: "",
  frontmatter: null,
  body: "",
  whereThingsStandSources: [],
  slugNote: "",
  coverageWarning: "",
  dirty: false,
  savedSlug: "",
  heroStoragePath: "",
  heroSource: null,
  status: "drafted",
  publishedUrl: "",
  publishError: "",
  publishProgress: "",
  slugConflict: "",
  focusSlug: 0,
  showOriginal: false,
  publishDone: false,
  wireFinished: false,
  resumeLoading: false,
  resumeError: "",
  suggestions: [],
  suggestError: "",
  suggesting: false,
  cannibalization: [],
  cannibalizationError: "",
  // Writer intake (article delivered as a document with a brief and images).
  writerImages: [],
  intake: null,
  intakeStatus: "idle",
  intakeError: "",
  sourceBeforeIntake: "",
  imageChoices: {},
  selectedOption: -1,
  missingImages: [],
};

/** Keyword choice from the writer intake: an analysed option, or "manual". */
export function intakeSelectionPatch(intake, selection) {
  if (selection === "manual") {
    return { selectedOption: "manual" };
  }
  const option = intake?.options?.[selection];
  if (!option) return { selectedOption: -1 };
  return {
    selectedOption: selection,
    pillarKeyword: option.pillarKeyword,
    clusterKeyword: option.supportingKeyword,
    targetKeyword: option.targetKeyword,
    articleType: option.articleType || "flex",
  };
}

/** With a writer intake, the user must pick the keyword before adjusting. */
export function intakeKeywordError(state) {
  if (!state.intake) return "";
  if (state.selectedOption === -1) return "Choose a keyword for this article.";
  const missing =
    !String(state.pillarKeyword || "").trim() ||
    !String(state.clusterKeyword || "").trim() ||
    !String(state.targetKeyword || "").trim();
  return missing ? "Pick a pillar, cluster and target keyword." : "";
}

export function composeReducer(state, action) {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.patch };
    case "hydrate":
      return { ...initialComposeState, ...action.patch };
    case "reset":
      return initialComposeState;
    case "setPillar":
      return {
        ...state,
        pillarKeyword: action.pillarKeyword,
        clusterKeyword: "",
      };
    default:
      return state;
  }
}

export function parseAllowedBrands(value) {
  const seen = new Set();
  const brands = [];
  for (const part of String(value || "").split(",")) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    brands.push(name);
  }
  return brands;
}

export function countWords(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function wordCountRequired(mode, state) {
  return !(mode === "modify" && !state.expandLength);
}

export function targetingErrors(state, mode = "idea") {
  const errors = {};
  if (!String(state.pillarKeyword || "").trim()) {
    errors.pillarKeyword = "Pillar keyword is required.";
  }
  if (!String(state.clusterKeyword || "").trim()) {
    errors.clusterKeyword = "Cluster keyword is required.";
  }
  if (!String(state.targetKeyword || "").trim()) {
    errors.targetKeyword = "Target keyword is required.";
  }
  if (wordCountRequired(mode, state)) {
    const wordCount = Number(state.wordCount);
    if (!Number.isFinite(wordCount) || wordCount < 600 || wordCount > 4000) {
      errors.wordCount = "Word count must be between 600 and 4000.";
    }
  }
  return errors;
}

export function isTargetingValid(state, mode = "idea") {
  return Object.keys(targetingErrors(state, mode)).length === 0;
}

/** Pillars that have at least one supporting keyword the modify prompt can choose. */
export function modifyKeywordOptions(pillars) {
  return (Array.isArray(pillars) ? pillars : [])
    .map((pillar) => ({
      keyword: String(pillar?.keyword || "").trim(),
      supporting: (Array.isArray(pillar?.supporting) ? pillar.supporting : [])
        .map((item) => String(item?.keyword || "").trim())
        .filter(Boolean),
    }))
    .filter((pillar) => pillar.keyword && pillar.supporting.length > 0);
}

export const IDEA_TEXT_MIN = 200;
export const IDEA_TEXT_MAX = 20000;
export const KEY_POINT_MAX = 200;
export const KEY_POINT_LIMIT = 5;

export function nonEmptyKeyPoints(keyPoints) {
  return (Array.isArray(keyPoints) ? keyPoints : [])
    .map((point) => String(point || "").trim())
    .filter(Boolean);
}

export function ideaInputErrors(state) {
  const errors = {};
  const text = String(state.ideaText || "");
  if (text.length < IDEA_TEXT_MIN) {
    errors.ideaText = `Write at least ${IDEA_TEXT_MIN} characters.`;
  } else if (text.length > IDEA_TEXT_MAX) {
    errors.ideaText = `Keep this under ${IDEA_TEXT_MAX.toLocaleString()} characters.`;
  }
  const points = Array.isArray(state.keyPoints) ? state.keyPoints : [];
  if (points.length < 1 || points.length > KEY_POINT_LIMIT) {
    errors.keyPoints = `Add 1 to ${KEY_POINT_LIMIT} key points.`;
  } else if (points.some((point) => String(point || "").length > KEY_POINT_MAX)) {
    errors.keyPoints = `Each key point must be ${KEY_POINT_MAX} characters or fewer.`;
  } else if (nonEmptyKeyPoints(points).length < 1) {
    errors.keyPoints = "Add at least one key point.";
  }
  return errors;
}

export function isIdeaInputValid(state) {
  return Object.keys(ideaInputErrors(state)).length === 0;
}

export const SOURCE_MIN_WORDS = 300;
export const SOURCE_MAX_CHARS = 40000;

export function modifyInputErrors(state) {
  const errors = {};
  const text = String(state.sourceArticle || "");
  const words = countWords(text);
  if (words < SOURCE_MIN_WORDS) {
    errors.sourceWords = `Source must be at least ${SOURCE_MIN_WORDS} words (currently ${words}).`;
  }
  if (text.length > SOURCE_MAX_CHARS) {
    errors.sourceLength = `Source must be ${SOURCE_MAX_CHARS.toLocaleString()} characters or fewer (currently ${text.length.toLocaleString()}).`;
  }
  return errors;
}

export function isModifyInputValid(state) {
  return Object.keys(modifyInputErrors(state)).length === 0;
}

export function suggestSourceText(mode, state) {
  const raw = mode === "idea" ? state.ideaText : state.sourceArticle;
  return String(raw || "").slice(0, 6000);
}
