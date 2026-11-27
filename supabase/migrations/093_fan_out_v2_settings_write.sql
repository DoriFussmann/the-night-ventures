-- 093: Fan-Out Engine v2: the admin screen saves the engine's settings.
-- Additive: one more policy on fo_settings. The app has no admin role: every signed-in user can open
-- Workspace Admin, as for the other admin tools.
--
-- Rollback:
--   drop policy if exists "Authenticated users can manage fo_settings" on public.fo_settings;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fo_settings' and policyname = 'Authenticated users can manage fo_settings') then
    create policy "Authenticated users can manage fo_settings" on public.fo_settings for all to authenticated using (true) with check (true);
  end if;
end $$;
