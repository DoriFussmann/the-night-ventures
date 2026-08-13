import React, { useCallback, useEffect, useState } from "react";
import { Copy, Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const DOC_KEYS = [
  "site_build_prompt",
  "design_system_prompt",
  "second_design_prompt",
  "second_functionality_prompt",
];

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
      <h2 className="text-xs text-foreground">{doc.title}</h2>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="min-h-[280px] font-body text-sm"
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
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDocs = useCallback(async () => {
    setLoading(true);
    setError("");

    const { data, error: fetchError } = await supabase
      .from("general_documents")
      .select("id, key, title, content, updated_at")
      .in("key", DOC_KEYS);

    if (fetchError) {
      console.error(fetchError);
      setError(fetchError.message || "Failed to load documents");
      setDocs([]);
      setLoading(false);
      return;
    }

    const byKey = Object.fromEntries((data || []).map((row) => [row.key, row]));
    setDocs(DOC_KEYS.map((key) => byKey[key]).filter(Boolean));
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading documents...</p>;
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xs text-foreground mb-1">Site Build Documents</h1>
        <p className="text-sm text-muted-foreground">
          Global reference documents for site builds. Edits apply across all companies.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No documents found. Run the general_documents migration first.
        </p>
      ) : (
        docs.map((doc) => <DocumentSection key={doc.id} doc={doc} />)
      )}
    </div>
  );
}
