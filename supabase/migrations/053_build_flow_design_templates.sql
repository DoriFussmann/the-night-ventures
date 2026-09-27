-- Retire the old Code Setup design step. pick-design is seeded by the app
-- from seedData.js the next time Build Blueprint loads.

delete from public.setup_flow_items
where item_key = 'generate-design-guide-and-abstract';
