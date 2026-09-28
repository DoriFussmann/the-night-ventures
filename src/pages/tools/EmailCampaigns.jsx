import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Mail, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { smartlead } from "./emailCampaigns/smartleadApi";
import { ErrorLine, Loading } from "./emailCampaigns/ui";
import Overview from "./emailCampaigns/Overview";
import Analytics from "./emailCampaigns/Analytics";
import Replies from "./emailCampaigns/Replies";
import SequenceCopy from "./emailCampaigns/SequenceCopy";
import LeadImport from "./emailCampaigns/LeadImport";
import ImportHistory from "./emailCampaigns/ImportHistory";
import Leads from "./emailCampaigns/Leads";
import DoNotContact from "./emailCampaigns/DoNotContact";
import Mailboxes from "./emailCampaigns/Mailboxes";

function Notice({ children }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 px-4 py-6 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export default function EmailCampaigns() {
  const { companyId } = useParams();
  const [company, setCompany] = useState(null);
  const [companyErr, setCompanyErr] = useState("");
  const [overview, setOverview] = useState(null);
  const [overviewErr, setOverviewErr] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setCompany(null);
    setCompanyErr("");
    supabase
      .from("companies")
      .select("name, email_campaigns_enabled, email_campaigns_provider, email_campaigns_campaign_id")
      .eq("id", companyId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setCompanyErr(error.message || "Failed to load company");
        else setCompany(data || {});
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const ready =
    company?.email_campaigns_enabled &&
    company?.email_campaigns_provider === "smartlead" &&
    String(company?.email_campaigns_campaign_id || "").trim();

  const loadOverview = useCallback(async () => {
    setOverviewErr("");
    try {
      setOverview(await smartlead("overview", companyId));
    } catch (e) {
      setOverviewErr(e.message);
    }
  }, [companyId]);

  useEffect(() => {
    if (ready) loadOverview();
  }, [ready, loadOverview]);

  const refreshAll = async () => {
    await loadOverview();
    setRefreshKey((k) => k + 1);
  };

  let body;
  if (companyErr) body = <ErrorLine>{companyErr}</ErrorLine>;
  else if (!company) body = <Loading />;
  else if (!company.email_campaigns_enabled)
    body = <Notice>Email campaigns are off for this company. Turn them on in Company Intelligence → Email Campaigns.</Notice>;
  else if (company.email_campaigns_provider !== "smartlead")
    body = <Notice>Only SmartLead is supported right now. Switch the provider in Company Intelligence → Email Campaigns.</Notice>;
  else if (!ready)
    body = <Notice>No Campaign ID set. Add it in Company Intelligence → Email Campaigns.</Notice>;
  else if (overviewErr) body = <ErrorLine>{overviewErr}</ErrorLine>;
  else if (!overview) body = <Loading label="Loading campaign…" />;
  else
    body = (
      <div className="space-y-5">
        <Overview companyId={companyId} overview={overview} onChanged={loadOverview} />
        <Analytics companyId={companyId} allTime={overview.analytics} />
        <Replies companyId={companyId} />
        <SequenceCopy companyId={companyId} sequences={overview.sequences} />
        <LeadImport
          companyId={companyId}
          sequences={overview.sequences}
          currentLeadCount={overview.leadCount}
          onDone={refreshAll}
        />
        <ImportHistory companyId={companyId} refreshKey={refreshKey} />
        <Leads companyId={companyId} refreshKey={refreshKey} />
        <DoNotContact companyId={companyId} refreshKey={refreshKey} />
        <Mailboxes companyId={companyId} />
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-6 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Mail className="h-5 w-5" />
          {company?.name ? `${company.name} — ` : ""}Email Campaigns
        </h1>
        {overview && (
          <Button size="sm" variant="outline" onClick={refreshAll}>
            <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh
          </Button>
        )}
      </div>
      {body}
    </div>
  );
}
