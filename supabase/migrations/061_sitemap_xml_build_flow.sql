-- seo-core 1.0.0 emits a single /sitemap.xml (it replaced @astrojs/sitemap's
-- /sitemap-index.xml). Point the Site Build Flow items already seeded for
-- existing companies at the new file. Items for new companies come from
-- src/pages/tools/siteBuildFlow/seedData.js, updated in the same release.

update public.setup_flow_items
set
  description = replace(description, 'sitemap-index.xml', 'sitemap.xml'),
  updated_at = now()
where item_key in (
    'submit-sitemap-google-search-console',
    'submit-sitemap-bing-webmaster-tools',
    'confirm-sitemap-inclusion'
  )
  and description like '%sitemap-index.xml%';
