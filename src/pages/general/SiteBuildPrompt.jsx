import React, { useCallback, useEffect, useState } from "react";
import { Copy, Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
// @ts-ignore Vite raw import
import SITE_BUILD_PROMPT from "./siteBuildPromptContent.txt?raw";

const DOC_KEY = "site_build_prompt";
const DOC_TITLE = "Site Build Prompt";

function downloadMarkdown(filename, content) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function DocumentSection({ doc }) {
  const [content, setContent] = useState(doc.content || "");
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setContent(doc.content || "");
  }, [doc.id, doc.content]);

  const handleSave = async () => {
    if (saving || !doc.id) return;

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
      .eq("id", doc.id);

    if (updateError) {
      console.error(updateError);
      setError(updateError.message || "Failed to save");
      setSaving(false);
      return;
    }

    setSaving(false);
    setSavedMessage("Saved");
    window.setTimeout(() => setSavedMessage(""), 2500);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch (err) {
      console.error("Copy failed:", err);
      setError("Failed to copy to clipboard");
    }
  };

  const handleDownload = () => {
    downloadMarkdown(`${doc.key}.md`, content);
  };

  return (
    <section className="space-y-3">
      <h2 className="text-xs text-foreground">{doc.title || DOC_TITLE}</h2>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="min-h-[70vh] font-body text-sm"
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button type="button" variant="outline" onClick={handleCopy}>
          <Copy className="w-4 h-4" />
          Copy
        </Button>
        <Button type="button" variant="secondary" onClick={handleDownload}>
          <Download className="w-4 h-4" />
          Download
        </Button>
        {savedMessage && (
          <span className="text-sm text-muted-foreground">{savedMessage}</span>
        )}
      </div>
    </section>
  );
}

export default function SiteBuildPrompt() {
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDoc = useCallback(async () => {
    setLoading(true);
    setError("");

    const { data, error: fetchError } = await supabase
      .from("general_documents")
      .select("id, key, title, content, updated_at")
      .eq("key", DOC_KEY)
      .maybeSingle();

    if (fetchError) {
      console.error(fetchError);
      setError(fetchError.message || "Failed to load document");
      setDoc(null);
      setLoading(false);
      return;
    }

    if (!data) {
      setDoc(null);
      setLoading(false);
      return;
    }

    const stored = (data.content || "").replace(/\r\n/g, "\n");
    const stalePriorDraft =
      !stored.includes("Date coercion, build this in from the start") ||
      !stored.includes("Initialize a local git repo");
    const needsCanonical =
      data.title !== DOC_TITLE || !stored.trim() || stalePriorDraft;

    if (!needsCanonical) {
      setDoc(data);
      setLoading(false);
      return;
    }

    const next = {
      title: DOC_TITLE,
      content: SITE_BUILD_PROMPT.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"),
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from("general_documents")
      .update(next)
      .eq("id", data.id);

    if (updateError) {
      console.error(updateError);
      setError(updateError.message || "Failed to update Site Build Prompt");
      setDoc({ ...data, ...next });
      setLoading(false);
      return;
    }

    setDoc({ ...data, ...next });
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDoc();
  }, [loadDoc]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading document...</p>;
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xs text-foreground mb-1">Site Build Prompt</h1>
        <p className="text-sm text-muted-foreground">
          Global reference prompt for site builds. Edits apply across all companies.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!doc ? (
        <p className="text-sm text-muted-foreground">
          No document found. Run the general_documents migration first.
        </p>
      ) : (
        <DocumentSection doc={doc} />
      )}
    </div>
  );
}
