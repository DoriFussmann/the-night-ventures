import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import PublishDestinationCheck from "../publishDestination/PublishDestinationCheck";
import { ownerRepoIssue } from "../../../../lib/publish-destination/tokenKey.js";
import { COMMERCIAL_FIELDS } from "./api";
import { RETIRED_FIELDS, retiredWithContent } from "./retiredFields";

/** Company settings on company_profiles. Everything articles say lives in the other tabs. */
const PROFILE_FIELDS = [
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

/** Text fields saved to company_profiles: the basics plus Commercial and sales. */
const SAVED_FIELDS = [...PROFILE_FIELDS, ...COMMERCIAL_FIELDS];

const TRAINING_POLICIES = [
  { value: "allow", label: "Allow AI training crawlers" },
  { value: "block", label: "Block AI training crawlers" },
  { value: "any", label: "No preference" },
];

const RETIRED_SELECT = RETIRED_FIELDS.map((f) => f.key).join(", ");

function Section({ title, description, children }) {
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

export default function CompanyTab({ companyId }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [profile, setProfile] = useState({});
  const [profileId, setProfileId] = useState(null);
  const [policy, setPolicy] = useState("allow");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [tokenKey, setTokenKey] = useState("");
  const [retired, setRetired] = useState({});
  const [retiredOpen, setRetiredOpen] = useState(false);

  const ownerIssue = ownerRepoIssue("owner", owner);
  const repoIssue = ownerRepoIssue("repo", repo);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    const [companyRes, profileRes, retiredRes] = await Promise.all([
      supabase.from("companies").select("name, github_owner, github_repo, github_token_key").eq("id", companyId).maybeSingle(),
      supabase
        .from("company_profiles")
        .select(`id, ai_training_bot_policy, ${SAVED_FIELDS.map((f) => f.key).join(", ")}`)
        .eq("company_id", companyId)
        .maybeSingle(),
      supabase.from("company_profiles").select(RETIRED_SELECT).eq("company_id", companyId).maybeSingle(),
    ]);
    if (companyRes.error || profileRes.error) {
      setError((companyRes.error || profileRes.error).message || "Failed to load company settings");
    }
    const c = companyRes.data || {};
    setName(c.name || "");
    setOwner(c.github_owner || "");
    setRepo(c.github_repo || "");
    setTokenKey(c.github_token_key || "");
    const p = profileRes.data || {};
    setProfileId(p.id || null);
    setProfile(Object.fromEntries(SAVED_FIELDS.map((f) => [f.key, p[f.key] || ""])));
    setPolicy(p.ai_training_bot_policy || "allow");
    setRetired(retiredRes.error ? {} : retiredRes.data || {});
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (event) => {
    event.preventDefault();
    if (ownerIssue || repoIssue) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = {
        ...Object.fromEntries(SAVED_FIELDS.map((f) => [f.key, String(profile[f.key] || "").trim() || null])),
        ai_training_bot_policy: policy,
      };
      const profileRes = profileId
        ? await supabase.from("company_profiles").update(payload).eq("id", profileId).select("id").single()
        : await supabase.from("company_profiles").insert({ company_id: companyId, ...payload }).select("id").single();
      if (profileRes.error) throw profileRes.error;
      setProfileId(profileRes.data?.id || profileId);

      const companyRes = await supabase
        .from("companies")
        .update({
          ...(name.trim() ? { name: name.trim() } : {}),
          github_owner: owner.trim() || null,
          github_repo: repo.trim() || null,
        })
        .eq("id", companyId);
      if (companyRes.error) throw companyRes.error;

      window.dispatchEvent(new Event("company-renamed"));
      setMessage("Saved.");
    } catch (err) {
      setError(err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }

  const retiredFilled = retiredWithContent(retired);

  return (
    <form onSubmit={save} className="mt-4 space-y-4">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Section title="Basics">
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="company_name" label="Company name" hint="Shown across TNV and used to spot brand mentions.">
            <Input id="company_name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {PROFILE_FIELDS.map((f) => (
            <Field key={f.key} id={f.key} label={f.label} hint={f.hint}>
              <Input
                id={f.key}
                value={profile[f.key] || ""}
                placeholder={f.placeholder}
                onChange={(e) => setProfile((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            </Field>
          ))}
          <Field
            id="ai_training_bot_policy"
            label="AI training crawlers"
            hint="What the site's robots.txt should do with GPTBot, ClaudeBot, CCBot and the like. The Audit flags a mismatch."
          >
            <select
              id="ai_training_bot_policy"
              value={policy}
              onChange={(e) => setPolicy(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {TRAINING_POLICIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section
        title="Commercial and sales"
        description="How the company sells and what limits it. Internal context for the ICP and personas; articles do not quote it."
      >
        <div className="grid gap-4 md:grid-cols-2">
          {COMMERCIAL_FIELDS.map((f) => (
            <div key={f.key} className={f.wide ? "md:col-span-2" : undefined}>
              <Field id={f.key} label={f.label} hint={f.hint}>
                <Textarea
                  id={f.key}
                  rows={f.rows}
                  value={profile[f.key] || ""}
                  onChange={(e) => setProfile((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
              </Field>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Publish Destination"
        description="The GitHub repo this company publishes to. Access comes from the workspace GitHub token (Workspace Admin → GitHub access)."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="github_owner" label="GitHub owner" hint="The name between github.com/ and the repo in the repo URL." error={ownerIssue}>
            <Input id="github_owner" value={owner} placeholder="DoriFussmann" aria-invalid={Boolean(ownerIssue)} onChange={(e) => setOwner(e.target.value)} />
          </Field>
          <Field id="github_repo" label="GitHub repo" hint="The repo name only." error={repoIssue}>
            <Input id="github_repo" value={repo} placeholder="hey-rupert" aria-invalid={Boolean(repoIssue)} onChange={(e) => setRepo(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4">
          <PublishDestinationCheck owner={owner} repo={repo} tokenKey={tokenKey} disabled={Boolean(ownerIssue || repoIssue)} />
        </div>
      </Section>

      {retiredFilled.length > 0 ? (
        <Collapsible open={retiredOpen} onOpenChange={setRetiredOpen} className="rounded-lg border border-dashed border-border p-4">
          <CollapsibleTrigger className="flex w-full items-center justify-between text-left text-sm text-muted-foreground hover:text-foreground">
            Retired fields with data ({retiredFilled.length}), read only
            <ChevronDown className={`h-4 w-4 transition-transform ${retiredOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="mt-2 text-xs text-muted-foreground">
              Old Company Intelligence fields. Nothing reads them; they are kept so nothing is lost.
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

      <div className="sticky bottom-0 flex items-center gap-3 border-t border-border bg-background py-3">
        <Button type="submit" disabled={saving || Boolean(ownerIssue || repoIssue)}>
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          Save company
        </Button>
        {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
      </div>
    </form>
  );
}
