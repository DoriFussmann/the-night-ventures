import React, { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ChevronDown, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import SocialShopsPanel from "./SocialShopsPanel";
import ConnectionsPanel from "./ConnectionsPanel";
import AeoPlaybookBox from "./companyData/AeoPlaybookBox";
import PublishDestinationCheck from "./companyData/PublishDestinationCheck";
import { ownerRepoIssue } from "../../../lib/publish-destination/tokenKey.js";
import { RETIRED_FIELDS, retiredWithContent } from "./companyData/retiredFields";

/** Settings Company Intelligence still owns. Content facts live in the AEO Playbook. */
const BASIC_FIELDS = [
  { key: "domain", label: "Domain", placeholder: "www.example.com", hint: "The live site. Audits, analytics and links use it." },
  {
    key: "product_name",
    label: "Product name",
    placeholder: "Only if it differs from the company name",
    hint: "Another name the brand goes by. Used to spot brand mentions in audits and AI answers.",
  },
  { key: "seo_market", label: "Search market", placeholder: "United States", hint: "Country or region the content targets. Sets spelling and data lookups." },
  { key: "seo_language", label: "Language", placeholder: "English", hint: "Language the articles are written in." },
];

const PANEL_DIALOG_CLASS =
  "flex h-[min(90vh,calc(min(96vw,1400px)*9/16))] w-[min(96vw,1400px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:rounded-lg";

const EMPTY_BASICS = Object.fromEntries(BASIC_FIELDS.map((f) => [f.key, ""]));
const RETIRED_SELECT = RETIRED_FIELDS.map((f) => f.key).join(", ");

function Card({ title, description, children }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Field({ id, label, hint, error, children }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      <p className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{error || hint}</p>
    </div>
  );
}

export default function CompanyData() {
  const { companyId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [basics, setBasics] = useState(EMPTY_BASICS);
  const [profileId, setProfileId] = useState(null);
  const [githubOwner, setGithubOwner] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubTokenKey, setGithubTokenKey] = useState("");
  const [retired, setRetired] = useState({});
  const [retiredOpen, setRetiredOpen] = useState(false);
  const [openPanel, setOpenPanel] = useState(null);

  const ownerIssue = ownerRepoIssue("owner", githubOwner);
  const repoIssue = ownerRepoIssue("repo", githubRepo);

  const loadData = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    const [companyRes, profileRes, retiredRes] = await Promise.all([
      supabase.from("companies").select("name, github_owner, github_repo, github_token_key").eq("id", companyId).maybeSingle(),
      supabase
        .from("company_profiles")
        .select(`id, ${BASIC_FIELDS.map((f) => f.key).join(", ")}`)
        .eq("company_id", companyId)
        .maybeSingle(),
      supabase.from("company_profiles").select(RETIRED_SELECT).eq("company_id", companyId).maybeSingle(),
    ]);
    if (companyRes.error || profileRes.error) {
      setError((companyRes.error || profileRes.error).message || "Failed to load Company Intelligence");
    }
    const c = companyRes.data || {};
    setCompanyName(c.name || "");
    setGithubOwner(c.github_owner || "");
    setGithubRepo(c.github_repo || "");
    setGithubTokenKey(c.github_token_key || "");
    const p = profileRes.data || {};
    setProfileId(p.id || null);
    setBasics(Object.fromEntries(BASIC_FIELDS.map((f) => [f.key, p[f.key] || ""])));
    // Retired fields are read-only history; a failure here never blocks the page.
    setRetired(retiredRes.error ? {} : retiredRes.data || {});
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Deep links: ?panel=social-shops | connections
  useEffect(() => {
    const panel = searchParams.get("panel");
    if (panel === "social-shops" || panel === "connections") {
      setOpenPanel(panel);
      const next = new URLSearchParams(searchParams);
      next.delete("panel");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const save = async (event) => {
    event?.preventDefault();
    if (ownerIssue || repoIssue) return;
    setSaving(true);
    setError("");
    setSavedMessage("");
    try {
      const profilePayload = Object.fromEntries(
        BASIC_FIELDS.map((f) => [f.key, String(basics[f.key] || "").trim() || null])
      );
      const profileRes = profileId
        ? await supabase.from("company_profiles").update(profilePayload).eq("id", profileId).select("id").single()
        : await supabase
            .from("company_profiles")
            .insert({ company_id: companyId, ...profilePayload })
            .select("id")
            .single();
      if (profileRes.error) throw profileRes.error;
      setProfileId(profileRes.data?.id || profileId);

      const companyRes = await supabase
        .from("companies")
        .update({
          ...(companyName.trim() ? { name: companyName.trim() } : {}),
          github_owner: githubOwner.trim() || null,
          github_repo: githubRepo.trim() || null,
        })
        .eq("id", companyId);
      if (companyRes.error) throw companyRes.error;

      window.dispatchEvent(new Event("company-renamed"));
      setSavedMessage("Saved");
      window.setTimeout(() => setSavedMessage(""), 2500);
    } catch (err) {
      setError(err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const retiredFilled = retiredWithContent(retired);

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-medium text-foreground">{companyName || "Company Intelligence"}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Company settings. What articles say about the company lives in the AEO Playbook.
        </p>
      </div>

      {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}

      <AeoPlaybookBox companyId={companyId} />

      <form onSubmit={save} className="space-y-4">
        <Card title="Basics">
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="company_name" label="Company name" hint="Shown across TNV and used to spot brand mentions.">
              <Input id="company_name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </Field>
            {BASIC_FIELDS.map((f) => (
              <Field key={f.key} id={f.key} label={f.label} hint={f.hint}>
                <Input
                  id={f.key}
                  value={basics[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => setBasics((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
        </Card>

        <Card
          title="Publish Destination"
          description="The GitHub repo this company publishes to. Access comes from the workspace GitHub token (Workspace Admin → GitHub access)."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              id="github_owner"
              label="GitHub owner"
              hint="The name between github.com/ and the repo in the repo URL."
              error={ownerIssue}
            >
              <Input
                id="github_owner"
                value={githubOwner}
                placeholder="DoriFussmann"
                aria-invalid={Boolean(ownerIssue)}
                onChange={(e) => setGithubOwner(e.target.value)}
              />
            </Field>
            <Field id="github_repo" label="GitHub repo" hint="The repo name only." error={repoIssue}>
              <Input
                id="github_repo"
                value={githubRepo}
                placeholder="hey-rupert"
                aria-invalid={Boolean(repoIssue)}
                onChange={(e) => setGithubRepo(e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-4">
            <PublishDestinationCheck
              owner={githubOwner}
              repo={githubRepo}
              tokenKey={githubTokenKey}
              disabled={Boolean(ownerIssue || repoIssue)}
            />
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={saving || Boolean(ownerIssue || repoIssue)}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="outline" onClick={() => setOpenPanel("social-shops")}>
            Social &amp; Shops
          </Button>
          <Button type="button" variant="outline" onClick={() => setOpenPanel("connections")}>
            Connections
          </Button>
          {savedMessage ? <span className="text-sm text-muted-foreground">{savedMessage}</span> : null}
        </div>
      </form>

      {retiredFilled.length > 0 ? (
        <Collapsible open={retiredOpen} onOpenChange={setRetiredOpen} className="mt-8 border-t border-border pt-4">
          <CollapsibleTrigger className="flex w-full items-center justify-between text-left text-sm text-muted-foreground hover:text-foreground">
            Retired fields with data ({retiredFilled.length}) — read only
            <ChevronDown className={`h-4 w-4 transition-transform ${retiredOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="mt-2 text-xs text-muted-foreground">
              No longer used anywhere. Kept so nothing is lost; copy anything still true into the AEO Playbook.
            </p>
            <dl className="mt-3 space-y-3">
              {retiredFilled.map((f) => (
                <div key={f.key}>
                  <dt className="text-xs font-medium text-foreground">{f.label}</dt>
                  <dd className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{f.text}</dd>
                </div>
              ))}
            </dl>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <Dialog open={openPanel === "social-shops"} onOpenChange={(open) => setOpenPanel(open ? "social-shops" : null)}>
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Social &amp; Shops</DialogTitle>
            <DialogDescription>Social media, digital stores, credentials, and notes.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {openPanel === "social-shops" && companyId ? <SocialShopsPanel companyId={companyId} /> : null}
          </div>
          <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
            <Button type="button" variant="outline" onClick={() => setOpenPanel(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openPanel === "connections"} onOpenChange={(open) => setOpenPanel(open ? "connections" : null)}>
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Connections</DialogTitle>
            <DialogDescription>Analytics, SEO, and tracking tools, credentials, and notes.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {openPanel === "connections" && companyId ? <ConnectionsPanel companyId={companyId} /> : null}
          </div>
          <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
            <Button type="button" variant="outline" onClick={() => setOpenPanel(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
