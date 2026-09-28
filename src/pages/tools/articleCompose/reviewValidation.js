export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const WTS_START = "<!-- WHERE-THINGS-STAND:START -->";
export const WTS_END = "<!-- WHERE-THINGS-STAND:END -->";

function countOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  const source = String(text || "");
  while (from <= source.length) {
    const found = source.indexOf(needle, from);
    if (found === -1) break;
    count += 1;
    from = found + needle.length;
  }
  return count;
}

export function reviewFieldErrors(frontmatter, body) {
  const fm = frontmatter && typeof frontmatter === "object" ? frontmatter : {};
  const errors = {};
  const title = String(fm.title || "");
  const description = String(fm.description || "");
  const slug = String(fm.slug || "").trim();
  const imageAlt = String(fm.imageAlt || "");
  const tags = Array.isArray(fm.tags) ? fm.tags.map((tag) => String(tag || "").trim()).filter(Boolean) : [];
  const faqs = Array.isArray(fm.faqs) ? fm.faqs : [];
  const bodyText = String(body || "");

  if (title.length < 55 || title.length > 60) {
    errors.title = `Title must be 55–60 characters (currently ${title.length}).`;
  }
  if (description.length < 140 || description.length > 160) {
    errors.description = `Description must be 140–160 characters (currently ${description.length}).`;
  }
  if (!SLUG_RE.test(slug)) {
    errors.slug = "Slug must be lowercase letters, numbers, and single hyphens.";
  }
  if (tags.length < 4 || tags.length > 6) {
    errors.tags = `Tags must be 4–6 (currently ${tags.length}).`;
  }
  if (imageAlt.length < 10) {
    errors.imageAlt = `Image alt must be at least 10 characters (currently ${imageAlt.length}).`;
  }
  if (faqs.length < 2 || faqs.length > 4) {
    errors.faqs = `FAQs must be 2–4 (currently ${faqs.length}).`;
  } else if (
    faqs.some(
      (faq) => !String(faq?.question || "").trim() || !String(faq?.answer || "").trim()
    )
  ) {
    errors.faqs = "Each FAQ needs a question and an answer.";
  }

  const bodyErrors = [];
  const startCount = countOccurrences(bodyText, WTS_START);
  const endCount = countOccurrences(bodyText, WTS_END);
  if (startCount === 0) {
    bodyErrors.push("The Where Things Stand start marker is missing.");
  } else if (startCount !== 1) {
    bodyErrors.push("The Where Things Stand start marker must appear once.");
  }
  if (endCount === 0) {
    bodyErrors.push("The Where Things Stand end marker is missing.");
  } else if (endCount !== 1) {
    bodyErrors.push("The Where Things Stand end marker must appear once.");
  }
  const takeaways = bodyText.match(/(?:^|\n)##\s+Key Takeaways\s*(?:\n|$)/g) || [];
  if (takeaways.length === 0) {
    bodyErrors.push('The "## Key Takeaways" heading is missing.');
  } else if (takeaways.length !== 1) {
    bodyErrors.push('The "## Key Takeaways" heading must appear once.');
  }
  if (bodyErrors.length > 0) errors.body = bodyErrors;
  return errors;
}

export function isReviewValid(frontmatter, body) {
  return Object.keys(reviewFieldErrors(frontmatter, body)).length === 0;
}
