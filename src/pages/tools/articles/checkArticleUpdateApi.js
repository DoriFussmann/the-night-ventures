/** Same POST as Articles Update — WTS freshness check. Do not change the endpoint. */

export async function checkArticleUpdate(article) {
  const res = await fetch("/api/check-article-update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publishedUrl: article.publishedUrl,
      targetKeyword: article.targetKeyword,
      pillarKeyword: article.pillarKeyword,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Check failed (${res.status})`);
  }
  return data;
}
