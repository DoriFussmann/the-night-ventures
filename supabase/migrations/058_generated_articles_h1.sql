-- Article H1 (seo-core v0.9.0+).
-- The on-page headline, distinct from the <title>. Optional: when empty,
-- seo-core derives one from the title at build time. Stored so that library
-- edits and republishes write it back to the site instead of dropping it.
alter table public.generated_articles
  add column if not exists h1 text;

comment on column public.generated_articles.h1 is
  'Optional on-page H1 (20-70 chars, different from title). Empty = derived from title by seo-core.';

-- Backfill Hey Rupert: the 23 articles whose titles have no derivable
-- headline got an explicit h1 in the site repo. Mirror them here so a
-- republish from TNV keeps them. Rows already holding an h1 are left alone.
update public.generated_articles ga
set h1 = v.h1
from (values
    ('angel-groups-in-your-city-for-a-first-check-2', 'Finding a Local Angel Group for Your First Check'),
    ('famous-venture-capital-firms', 'Famous Venture Capital Firms: A Founder FAQ'),
    ('first-check-from-local-operators', 'Landing Your First Check from Local Operators'),
    ('investor-crm', 'How to Run Your Raise with an Investor CRM'),
    ('investor-database', 'Choosing and Using an Investor Database'),
    ('investor-list', 'How to Build an Investor List That Works'),
    ('investor-update-template', 'Investor Update Template for Seed and Series A'),
    ('investors-looking-for-projects-to-fund', 'What Investors Look for in Projects to Fund'),
    ('investors-near-me', 'How to Find Investors Near You'),
    ('largest-venture-capital-firms-by-aum', 'The Largest VC Firms by AUM, and How to Target Them'),
    ('list-of-private-investors', 'Investor Lists, Angel Databases, and Paid Contact Files Compared'),
    ('local-angel-investors-for-first-time-founders-2', 'Local Angel Investors for First-Time Founders'),
    ('operators-who-write-the-first-check', 'Operators Who Write the First Check'),
    ('pitch-deck', 'How to Build a Pitch Deck That Raises Capital'),
    ('quarterly-update-email-template', 'Investor Updates: Common Founder Questions Answered'),
    ('seed-funding-pitch-deck-faq', 'Seed Pitch Deck Questions, Answered'),
    ('seed-pitch-deck', 'How to Build a Seed Pitch Deck'),
    ('seed-vs-series-a', 'Seed vs Series A: How the Two Rounds Differ'),
    ('series-a', 'How Series A Funding Works'),
    ('startup-funding-stages-explained', 'Which Startup Funding Stage Are You In?'),
    ('startup-funding', 'How Startup Funding Works, Round by Round'),
    ('top-vc-firms', 'Top VC Firms: Mega-Funds vs. Specialists'),
    ('venture-capital', 'How Venture Capital Works for Founders')
) as v(slug, h1)
where ga.slug = v.slug
  and (ga.h1 is null or ga.h1 = '')
  and ga.company_id in (
    select id from public.companies where github_repo = 'hey-rupert'
  );
