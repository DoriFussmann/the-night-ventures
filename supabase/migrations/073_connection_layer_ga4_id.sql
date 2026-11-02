-- Site Build Flow → Connection Layer → Install Analytics: add the site.ts
-- GA4_MEASUREMENT_ID option (moved here from the Placeholders stage).
-- Idempotent. Skips a description that no longer has the "(3) Check:" step.

update public.setup_flow_template_items
set
  description = replace(
    description,
    'Redeploy. (3) Check:',
    'Redeploy. Alternative to (2), for sites whose site/src/config/site.ts has GA4_MEASUREMENT_ID: set it there to the G-… ID, commit and push. (3) Check:'
  ),
  updated_at = now()
where stage_key = 'connection-layer'
  and item_key = 'install-analytics'
  and description like '%Redeploy. (3) Check:%'
  and description not like '%GA4_MEASUREMENT_ID%';
