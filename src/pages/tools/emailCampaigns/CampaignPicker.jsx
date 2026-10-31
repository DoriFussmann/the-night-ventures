import React, { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CAMPAIGN_STATUS } from "../../../../lib/instantly/mapping.js";
import { instantly } from "./instantlyApi";

// Pick the Instantly campaign from the workspace's list (needs
// INSTANTLY_API_KEY). Falls back to pasting the ID if the list can't load.
export default function CampaignPicker({ companyId, value, onChange, id }) {
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      setList(await instantly("list-campaigns", companyId));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const known = list?.some((c) => c.id === value);

  return (
    <div className="space-y-1.5">
      {list?.length ? (
        <div className="flex items-center gap-2">
          <Select value={known ? value : ""} onValueChange={onChange}>
            <SelectTrigger id={id}>
              <SelectValue placeholder={value && !known ? `Not in this workspace: ${value}` : "Choose a campaign"} />
            </SelectTrigger>
            <SelectContent>
              {list.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name || c.id} · {CAMPAIGN_STATUS[c.status] || c.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="icon" variant="outline" onClick={load} disabled={loading} aria-label="Reload campaigns">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      ) : (
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Instantly campaign ID (UUID)" />
      )}
      <p className="text-xs text-muted-foreground">
        {loading && !list
          ? "Loading campaigns from Instantly…"
          : err
            ? `Couldn't list campaigns (${err}). Paste the ID from the campaign's URL in Instantly.`
            : list && !list.length
              ? "No campaigns in this Instantly workspace yet. Create one in Instantly (no steps needed; TNV writes the email)."
              : value
                ? <>ID <span className="font-mono">{value}</span></>
                : "Create the campaign in Instantly with its sending accounts and schedule; TNV writes the email."}
      </p>
    </div>
  );
}
