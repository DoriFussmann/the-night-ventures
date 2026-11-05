import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { importPlaybook, loadPlaybook } from "./aeoPlaybook/api";
import BrandFactsTab from "./aeoPlaybook/BrandFactsTab";
import PersonasTab from "./aeoPlaybook/PersonasTab";
import PromptsTab from "./aeoPlaybook/PromptsTab";
import ContentMapTab from "./aeoPlaybook/ContentMapTab";

const TAB_IDS = ["brand", "personas", "prompts", "map"];

export default function AeoPlaybook() {
  const { companyId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TAB_IDS.includes(searchParams.get("tab")) ? searchParams.get("tab") : "brand";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState("");
  const [importNote, setImportNote] = useState("");
  const fileRef = useRef(null);

  const reload = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    try {
      setData(await loadPlaybook(companyId));
    } catch (err) {
      setError(
        /aeo_/.test(err?.message || "")
          ? `${err.message}. Run migration 075_aeo_playbook.sql in Supabase first.`
          : err?.message || "Failed to load the AEO Playbook"
      );
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const onImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportNote("");
    setError("");
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setError("That file is not valid JSON.");
      return;
    }
    const ok = window.confirm(
      `Import "${file.name}" into this company's AEO Playbook?\n\nBrand Facts and ICP are replaced. Personas, pillars, groups and prompts with the same code are updated; others are added. Nothing else is deleted.`
    );
    if (!ok) return;
    try {
      const counts = await importPlaybook(companyId, parsed, setImporting);
      setImportNote(
        `Imported ${counts.personas} personas, ${counts.pillars} pillars, ${counts.groups} prompt groups and ${counts.prompts} prompts.`
      );
      await reload();
    } catch (err) {
      setError(err?.message || "Import failed");
    } finally {
      setImporting("");
    }
  };

  const setTab = (next) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            to={`/company/${companyId}/company-data`}
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Company Intelligence
          </Link>
          <h1 className="flex items-center gap-2 text-lg font-medium text-foreground">
            AEO Playbook
            <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800">
              New
            </span>
          </h1>
          <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
            Brand Facts, ICP and personas, the prompt universe and the content map. Kept separate from the older
            Company Intelligence fields so they can be compared and retired one by one.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onImportFile} />
          <Button type="button" variant="outline" size="sm" disabled={!companyId || Boolean(importing)} onClick={() => fileRef.current?.click()}>
            {importing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
            {importing ? `Importing ${importing}…` : "Import playbook file"}
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
      {importNote && <p className="text-sm text-muted-foreground">{importNote}</p>}

      {loading && !data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : data ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="brand">Brand Facts</TabsTrigger>
            <TabsTrigger value="personas">ICP &amp; Personas ({data.personas.length})</TabsTrigger>
            <TabsTrigger value="prompts">Prompts ({data.prompts.length})</TabsTrigger>
            <TabsTrigger value="map">Content Map ({data.groups.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="brand">
            <BrandFactsTab companyId={companyId} playbook={data.playbook} onSaved={reload} />
          </TabsContent>
          <TabsContent value="personas">
            <PersonasTab companyId={companyId} playbook={data.playbook} personas={data.personas} onChanged={reload} />
          </TabsContent>
          <TabsContent value="prompts">
            <PromptsTab companyId={companyId} data={data} onChanged={reload} />
          </TabsContent>
          <TabsContent value="map">
            <ContentMapTab companyId={companyId} data={data} onChanged={reload} />
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  );
}
