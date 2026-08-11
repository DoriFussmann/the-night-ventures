-- Add books- and children-related industry categories for Company Data.
-- Idempotent: safe to re-run (on conflict do nothing).

insert into public.industries (name) values
  -- Books & Publishing
  ('Books'),
  ('Children''s Books'),
  ('Book Publishing'),
  ('Bookstores & Book Retail'),
  ('E-books & Digital Publishing'),
  ('Audiobooks'),
  ('Self-Publishing'),
  ('Educational Books & Textbooks'),
  ('Book Clubs & Reading Communities'),
  ('Literary Magazines & Journals'),
  -- Children & Kids
  ('Children''s Products & Toys'),
  ('Children''s Clothing & Apparel'),
  ('Children''s Entertainment'),
  ('Children''s Media & Content'),
  ('Kids Activities & Classes'),
  ('Baby Products'),
  ('Children''s Health & Wellness')
on conflict (name) do nothing;
