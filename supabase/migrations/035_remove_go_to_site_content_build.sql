delete from public.setup_flow_items
where stage_key = 'site-activation'
  and item_key in (
    'go-to-site-content-build',
    'run-audit-prompt-in-cursor',
    'wait-complete-and-review',
    'paste-audit-into-build-prompt',
    'generate-site-content-prompt',
    'paste-generated-prompt-into-cursor',
    'pull-keyword-data-via-keyword-slip',
    'check-image-aspect-ratios',
    'check-layout-with-real-copy-length',
    'check-color-contrast-against-real-photography',
    'check-density-with-real-content-volume'
  );
