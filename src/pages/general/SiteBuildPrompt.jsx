import React, { useCallback, useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const DOC_KEY = "site_build_prompt";
const DOC_TITLE = "Initial Site Build Prompt";
const DOC_SELECT = "id, key, title, content, updated_at";

export default function SiteBuildPrompt() {
  const [docId, setDocId] = useState(null);
  const [savedContent, setSavedContent] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [error, setError] = useState("");

  const loadDoc = useCallback(async () => {
    setLoading(true);
    setError("");

    const { data, error: fetchError } = await supabase
      .from("general_documents")
      .select(DOC_SELECT)
      .eq("key", DOC_KEY)
      .maybeSingle();

    if (fetchError) {
      console.error(fetchError);
      setError(fetchError.message || "Failed to load prompt");
      setLoading(false);
      return;
    }

    if (data) {
      const stored = data.content || "";
      setDocId(data.id);
      setSavedContent(stored);
      setContent(stored);
      setLoading(false);
      return;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("general_documents")
      .insert({ key: DOC_KEY, title: DOC_TITLE, content: "" })
      .select(DOC_SELECT)
      .maybeSingle();

    if (insertError) {
      console.error(insertError);
      setError(insertError.message || "Failed to create prompt");
      setDocId(null);
      setSavedContent("");
      setContent("");
      setLoading(false);
      return;
    }

    setDocId(inserted?.id || null);
    setSavedContent("");
    setContent("");
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDoc();
  }, [loadDoc]);

  const isDirty = content !== savedContent;

  const handleSave = async () => {
    if (saving || !docId) return;

    setSaving(true);
    setSavedMessage("");
    setError("");

    const { error: updateError } = await supabase
      .from("general_documents")
      .update({
        content,
        title: DOC_TITLE,
        updated_at: new Date().toISOString(),
      })
      .eq("id", docId);

    if (updateError) {
      console.error(updateError);
      setError(updateError.message || "Failed to save");
      setSaving(false);
      return;
    }

    setSavedContent(content);
    setSaving(false);
    setSavedMessage("Saved");
    window.setTimeout(() => setSavedMessage(""), 2500);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopyMessage("Copied");
      window.setTimeout(() => setCopyMessage(""), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
      setError("Failed to copy to clipboard");
    }
  };

  if (loading) {
    return (
      <div>
        <h1 className="text-xs text-foreground mb-1">{DOC_TITLE}</h1>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xs text-foreground mb-1">{DOC_TITLE}</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Paste the initial site build prompt here. Saved text persists across sessions
        and companies.
      </p>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Paste the initial site build prompt…"
        className="min-h-[70vh] font-body text-sm"
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={handleSave} disabled={saving || !docId || !isDirty}>
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button type="button" variant="outline" onClick={handleCopy} disabled={!content}>
          <Copy className="w-4 h-4" />
          {copyMessage || "Copy"}
        </Button>
        {savedMessage && (
          <span className="text-sm text-muted-foreground">{savedMessage}</span>
        )}
      </div>
    </div>
  );
}
