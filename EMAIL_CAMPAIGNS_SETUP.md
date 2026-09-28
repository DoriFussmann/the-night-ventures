# Email Campaigns — setup (one time)

1. Supabase → SQL Editor → New query → paste the full contents of
   `supabase/migrations/055_email_campaigns.sql` → Run.
2. Vercel → Project → Settings → Environment Variables → add:
   - SMARTLEAD_API_KEY — from SmartLead → Settings → API
   - SMARTLEAD_WEBHOOK_SECRET — any long random string
   - EMAIL_CAMPAIGN_NOTIFY_TO — email(s) that get reply alerts, comma-separated
   Then Deployments → Redeploy.
3. Open a company's Email Campaigns page → click "Connect reply notifications" once.
