import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Mail, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";

export default function EmailCampaigns() {
  const { companyId } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [company, setCompany] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!companyId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      const { data, error: loadError } = await supabase
        .from("companies")
        .select(
          "name, email_campaigns_enabled, email_campaigns_provider, email_campaigns_campaign_id"
        )
        .eq("id", companyId)
        .maybeSingle();
      if (cancelled) return;
      if (loadError) {
        setError(loadError.message || "Failed to load company");
      } else {
        setCompany(data || null);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const enabled = Boolean(company?.email_campaigns_enabled);
  const provider = company?.email_campaigns_provider || "";
  const campaignId = company?.email_campaigns_campaign_id || "";
  const providerLabel =
    provider === "smartlead"
      ? "SmartLead"
      : provider === "instantly"
        ? "Instantly"
        : "—";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Mail className="h-5 w-5" />
          {company?.name ? `${company.name} — ` : ""}Email Campaigns
        </h1>
        <p className="text-sm text-muted-foreground">
          Outreach for this company (EPIC). The campaign engine is coming next —
          this page confirms the wiring is in place.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      ) : !enabled ? (
        <div className="rounded-lg border border-border bg-card/40 px-4 py-6 text-sm text-muted-foreground">
          Email campaigns are turned off for this company. Turn them on in{" "}
          <span className="font-medium text-foreground">
            Company Data → Email Campaigns
          </span>
          .
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Status</span>
            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">
              Enabled
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                Provider
              </p>
              <p className="text-foreground">{providerLabel}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                Campaign ID
              </p>
              <p className="text-foreground break-all font-mono">
                {campaignId || "—"}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            The provider API key is set in Vercel
            ({provider === "smartlead" ? "SMARTLEAD_API_KEY" : "INSTANTLY_API_KEY"}).
            Its live status is shown on the Integrations tab.
          </p>
        </div>
      )}
    </div>
  );
}
