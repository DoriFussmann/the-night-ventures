# The Night Ventures

Vite + React app with **Supabase** auth/data and **Resend** email, deployed on **Vercel**.

## Local setup

1. Clone and install:

```bash
npm install
```

2. Copy env and fill in values from Supabase + Resend:

```bash
cp .env.example .env.local
```

3. In the [Supabase SQL editor](https://supabase.com/dashboard), run [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql).

4. Supabase Auth settings:

   - **Authentication → URL configuration**
     - Site URL: `http://localhost:5173` (and your production URL later)
     - Redirect URLs: `http://localhost:5173/**`, `https://YOUR_VERCEL_DOMAIN/**`
   - Enable **Email** provider
   - Enable **Google** provider (optional) and add the same redirect URLs

5. Run the app:

```bash
npm run dev
```

For the contact form API locally, use Vercel’s local runner (loads `/api` + env):

```bash
npx vercel dev
```

## Deploy to Vercel (GitHub + custom domain)

1. Push this repo to GitHub (`DoriFussmann/the-night-ventures` or your fork).
2. In [Vercel](https://vercel.com) → **Add New Project** → Import the GitHub repo.
3. Set environment variables (Production + Preview as needed):

   | Name | Notes |
   |------|--------|
   | `VITE_SUPABASE_URL` | Supabase project URL |
   | `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key |
   | `SUPABASE_URL` | Same as project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Service role (server only) |
   | `ANTHROPIC_API_KEY` | Anthropic API (plan-cluster, generate-article, design-guide routes) |
   | `OPENAI_API_KEY` | OpenAI API (Site Content Build image generation via gpt-image-2). Final fallback after stock search |
   | `UNSPLASH_ACCESS_KEY` | Unsplash Access Key (Client-ID). Article hero and Image Generator stock search |
   | `SHUTTERSTOCK_API_TOKEN` | Shutterstock OAuth bearer token with licensing scope |
   | `SHUTTERSTOCK_SUBSCRIPTION_ID` | Shutterstock subscription used to license the chosen image |
   | `IMAGE_STOCK_ORDER` | Stock provider order, default `unsplash,shutterstock`. OpenAI is always the final fallback |
   | `IMAGE_STOCK_MIN_SCORE` | Judge acceptance threshold 0–10, default `7` |
   | `GOOGLE_PAGESPEED_API_KEY` | Google PageSpeed Insights API (External Audit Snapshot) |
   | `RESEND_API_KEY` | From Resend dashboard |
   | `RESEND_FROM_EMAIL` | Verified sender (or Resend onboarding address for tests) |
   | `INQUIRY_TO_EMAIL` | Default `dori@thenightventures.com` |

4. Deploy. Confirm the site loads and `/api/submit-inquiry` accepts POSTs.
5. **Custom domain:** Project → **Settings → Domains** → add your domain → set the DNS records Vercel shows (A/CNAME) at your registrar.
6. Update Supabase Site URL + redirect URLs to the custom domain.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview production build |
| `npx vercel dev` | Dev with API routes |

## Stack

- Frontend: React, Vite, React Router, Tailwind
- Auth + DB: Supabase (`profiles`, `inquiries`)
- Email: Resend via `api/submit-inquiry.js`
- Hosting: Vercel
