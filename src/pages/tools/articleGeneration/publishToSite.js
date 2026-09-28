import { supabase } from "@/lib/supabase";
import {
  articleFilename,
  serializeArticleMarkdown,
} from "./serializeArticleMarkdown";
import { heroStoragePath } from "./heroImageStorage";

export const DEFAULT_PUBLISH_BRANCH = "main";

/** Template schema requires a non-empty author id. */
export const DEFAULT_AUTHOR = "dori-fussmann";

export function isPublishDestinationMapped(destination) {
  return Boolean(
    destination?.owner && destination?.repo && destination?.tokenKey
  );
}

/**
 * Load the company's GitHub publish mapping from `companies`.
 * @returns {Promise<{ owner: string, repo: string, tokenKey: string }>}
 */
export async function loadCompanyPublishDestination(companyId) {
  const { data, error } = await supabase
    .from("companies")
    .select("github_owner, github_repo, github_token_key")
    .eq("id", companyId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load company destination");
  }

  return {
    owner: String(data?.github_owner || "").trim(),
    repo: String(data?.github_repo || "").trim(),
    tokenKey: String(data?.github_token_key || "").trim().toUpperCase(),
  };
}

function heroImagePath(slug) {
  return `../../assets/articles/${slug}.png`;
}

function stripDataUrl(b64) {
  const raw = String(b64 || "").trim();
  const comma = raw.indexOf(",");
  if (raw.startsWith("data:") && comma !== -1) return raw.slice(comma + 1);
  return raw;
}

function buildArticlePayload(item, { companyId } = {}) {
  const filename = articleFilename(item.frontmatter);
  const slug = filename.replace(/\.md$/i, "");
  const b64 = stripDataUrl(
    item?.image?.b64_json || item?.image?.result?.b64_json || ""
  );
  const knownPath = String(
    item?.heroStoragePath || item?.image?.storagePath || ""
  ).trim();
  const storagePath = knownPath || (!b64 ? heroStoragePath(companyId, slug) : "");

  const body = item.body != null ? item.body : "";
  if (!String(body).trim() && !String(item.markdown || "").trim()) {
    return {
      skipped: {
        filename,
        reason: "missing_body",
        message: "No article body — skipped",
      },
    };
  }

  if (!b64 && !storagePath) {
    return {
      skipped: {
        filename,
        reason: "missing_hero",
        message: "No hero image — skipped (schema requires image)",
      },
    };
  }

  const fm = {
    ...(item.frontmatter && typeof item.frontmatter === "object"
      ? item.frontmatter
      : {}),
    author: DEFAULT_AUTHOR,
    image: heroImagePath(slug),
  };

  const article = {
    filename,
    content: serializeArticleMarkdown(fm, body, {
      draft: item.publishAsDraft === true,
    }),
  };
  if (storagePath) {
    article.storagePath = storagePath;
  } else {
    article.image = {
      filename: `${slug}.png`,
      contentBase64: b64,
    };
  }

  return { article };
}

export function generatedArticleToPublishItem(row, options = {}) {
  return {
    frontmatter: {
      title: row?.title,
      description: row?.description,
      slug: row?.slug,
      date: row?.date,
      updatedDate: row?.updated_date,
      author: row?.author,
      category: row?.category,
      tags: row?.tags,
      imageAlt: row?.image_alt,
      keywords: row?.keywords,
      faqs: row?.faqs,
      pillarKeyword: row?.pillar_keyword,
      supportingKeyword: row?.supporting_keyword,
      articleType: row?.type,
      targetKeyword: row?.target_keyword,
      externalLinks: Array.isArray(row?.external_links) ? row.external_links : [],
    },
    body: row?.body,
    heroStoragePath: row?.hero_storage_path || null,
    image: null,
    publishAsDraft: options.asDraft === true,
  };
}

export function formatPublishProgress(progress) {
  if (!progress) return "Publishing…";
  if (progress.phase === "merge") return "Merging…";
  const current = Number(progress.current) || 0;
  const total = Number(progress.total) || 0;
  return `Committing ${current}/${total}`;
}

async function postPublish(token, body) {
  const res = await fetch("/api/publish-to-site", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error || `Publish failed (${res.status})`;
    const err = new Error(message);
    err.result = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

function pushAll(target, items) {
  if (!Array.isArray(items) || items.length === 0) return;
  target.push(...items);
}

/**
 * Serialize successful jobs and publish one article per request.
 * First commit creates `publish/<yyyy-mm-dd-hhmm>`; later commits reuse it;
 * a final request merges that branch into the target (main).
 *
 * @param {Array<{ frontmatter: object, body?: string, markdown?: string, image?: { b64_json?: string } | { status?: string, result?: { b64_json?: string } } | null }>} articles
 * @param {{ companyId: string, owner: string, repo: string, tokenKey: string, branch?: string }} destination
 * @param {{ onProgress?: (progress: { phase: "commit" | "merge", current: number, total: number, filename?: string | null }) => void }} [options]
 */
export async function publishArticlesToSite(articles, destination, options = {}) {
  const onProgress =
    typeof options.onProgress === "function" ? options.onProgress : () => {};
  const skipped = [];
  const committed = [];
  const errors = [];
  const list = Array.isArray(articles) ? articles : [];

  if (list.length === 0) {
    return {
      ok: false,
      branch: null,
      mergeCommitSha: null,
      committed: [],
      skipped,
      errors: [
        {
          message:
            "No articles ready to publish (all missing hero images or body).",
        },
      ],
    };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    throw new Error("Not signed in");
  }

  const companyId = String(destination?.companyId || "").trim();
  const owner = String(destination?.owner || "").trim();
  const repo = String(destination?.repo || "").trim();
  const tokenKey = String(destination?.tokenKey || "").trim().toUpperCase();
  const branch =
    String(destination?.branch || DEFAULT_PUBLISH_BRANCH).trim() ||
    DEFAULT_PUBLISH_BRANCH;

  if (!companyId) {
    throw new Error("companyId is required to publish");
  }
  if (!isPublishDestinationMapped({ owner, repo, tokenKey })) {
    throw new Error("No destination repo set for this company.");
  }

  const destBody = {
    companyId,
    owner,
    repo,
    github_token_key: tokenKey,
    branch,
  };

  const total = list.length;
  let publishBranch = null;

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const prepared = buildArticlePayload(item, { companyId });
    const filename =
      prepared.article?.filename || prepared.skipped?.filename || "";
    onProgress({
      phase: "commit",
      current: i + 1,
      total,
      filename,
    });

    if (prepared.skipped) {
      skipped.push(prepared.skipped);
      continue;
    }

    try {
      const data = await postPublish(token, {
        ...destBody,
        step: "commit",
        ...(publishBranch ? { publishBranch } : {}),
        article: prepared.article,
      });
      if (data.branch) publishBranch = data.branch;
      pushAll(committed, data.committed);
      pushAll(skipped, data.skipped);
      pushAll(errors, data.errors);
    } catch (err) {
      if (err?.status === 401) throw err;
      errors.push({
        filename: prepared.article.filename,
        message: err?.message || "Publish failed",
      });
    }
  }

  if (committed.length === 0) {
    return {
      ok: false,
      branch: publishBranch,
      mergeCommitSha: null,
      committed,
      skipped,
      errors: errors.length
        ? errors
        : skipped.length
          ? []
          : [
              {
                message:
                  "No articles ready to publish (all missing hero images or body).",
              },
            ],
    };
  }

  onProgress({
    phase: "merge",
    current: total,
    total,
    filename: null,
  });

  try {
    const data = await postPublish(token, {
      ...destBody,
      step: "merge",
      publishBranch,
    });
    return {
      ok: data.ok !== false,
      branch: data.branch || publishBranch,
      mergeCommitSha: data.mergeCommitSha || null,
      mergeStrategy: data.mergeStrategy || null,
      pullRequestUrl: data.pullRequestUrl || null,
      committed,
      skipped,
      errors,
    };
  } catch (err) {
    if (err?.status === 401) throw err;
    errors.push({
      message: `Merge failed: ${err?.message || "unknown error"}`,
    });
    return {
      ok: false,
      branch: publishBranch,
      mergeCommitSha: err?.result?.mergeCommitSha || null,
      mergeStrategy: err?.result?.mergeStrategy || null,
      pullRequestUrl: err?.result?.pullRequestUrl || null,
      committed,
      skipped,
      errors,
    };
  }
}
