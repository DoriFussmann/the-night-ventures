import { BOT_UA_REGEX_SOURCE } from "../../../../lib/analytics/aiSources.js";

/**
 * Vercel Routing Middleware for a destination site (root `middleware.js`).
 * Reports known crawler hits to TNV after the response is sent; human visitors
 * are untouched. The token is read from the site's TNV_BOT_TOKEN env var.
 * @param {string} origin TNV app origin, e.g. https://app.example.com
 */
export function buildBotMiddleware(origin) {
  const endpoint = `${String(origin || "").replace(/\/+$/, "")}/api/audit-snapshot?action=analytics.ingest`;
  return `// TNV AI-crawler tracking (Vercel Routing Middleware). Place at the repo root.
// Requires env var TNV_BOT_TOKEN on this Vercel project.
const BOTS = /${BOT_UA_REGEX_SOURCE}/i;
const ENDPOINT = ${JSON.stringify(endpoint)};

export const config = {
  matcher: ['/((?!_astro/|_vercel/|favicon).*)'],
};

export default function middleware(request, context) {
  const ua = request.headers.get('user-agent') || '';
  const token = process.env.TNV_BOT_TOKEN;
  if (!token || !BOTS.test(ua)) return;
  const { pathname } = new URL(request.url);
  const report = fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, ua: ua.slice(0, 500), path: pathname.slice(0, 300) }),
  }).catch(() => {});
  if (context && typeof context.waitUntil === 'function') context.waitUntil(report);
}
`;
}
