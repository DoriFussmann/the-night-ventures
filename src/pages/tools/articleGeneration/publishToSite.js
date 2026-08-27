import { supabase } from "@/lib/supabase";
import {
  articleFilename,
  serializeArticleMarkdown,
} from "./serializeArticleMarkdown";

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

/**
 * Serialize successful jobs for publish and POST to /api/publish-to-site.
 * Articles without a hero image are skipped (template schema requires image()).
 *
 * @param {Array<{ frontmatter: object, body?: string, markdown?: string, image?: { b64_json?: string } | { status?: string, result?: { b64_json?: string } } | null }>} articles
 * @param {{ companyId: string, owner: string, repo: string, tokenKey: string, branch?: string }} destination
 */
export async function publishArticlesToSite(articles, destination) {
  const skipped = [];
  const payload = [];
  const list = Array.isArray(articles) ? articles : [];

  for (const item of list) {
    const filename = articleFilename(item.frontmatter);
    const slug = filename.replace(/\.md$/i, "");
    const b64 = stripDataUrl(
      item?.image?.b64_json || item?.image?.result?.b64_json || ""
    );

    if (!b64) {
      skipped.push({
        filename,
        reason: "missing_hero",
        message: "No hero image — skipped (schema requires image)",
      });
      continue;
    }

    const body = item.body != null ? item.body : "";
    if (!String(body).trim() && !String(item.markdown || "").trim()) {
      skipped.push({
        filename,
        reason: "missing_body",
        message: "No article body — skipped",
      });
      continue;
    }

    const fm = {
      ...(item.frontmatter && typeof item.frontmatter === "object"
        ? item.frontmatter
        : {}),
      author: DEFAULT_AUTHOR,
      image: heroImagePath(slug),
    };

    payload.push({
      filename,
      content: serializeArticleMarkdown(fm, body, { draft: false }),
      image: {
        filename: `${slug}.png`,
        contentBase64: b64,
      },
    });
  }

  if (payload.length === 0) {
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

  const res = await fetch("/api/publish-to-site", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      companyId,
      owner,
      repo,
      github_token_key: tokenKey,
      branch,
      articles: payload,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error || `Publish failed (${res.status})`;
    const err = new Error(message);
    err.result = data;
    throw err;
  }

  return {
    ...data,
    skipped: [...skipped, ...(Array.isArray(data.skipped) ? data.skipped : [])],
  };
}
