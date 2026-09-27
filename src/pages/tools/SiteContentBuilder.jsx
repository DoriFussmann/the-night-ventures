import React, { useState } from "react";
import { useParams } from "react-router-dom";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CHATGPT_SITE_CONTENT_PROMPT } from "./siteContentBuilder/chatgptSiteContentPrompt";

function PromptBlock({ label, text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
          <Copy className="h-3.5 w-3.5" />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="max-h-[70vh] overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words text-foreground/90">
        {text}
      </pre>
    </div>
  );
}

export default function SiteContentBuilder() {
  const { companyId } = useParams();

  if (!companyId) {
    return (
      <div>
        <h1 className="text-xs text-foreground mb-1">Narrative Composer</h1>
        <p className="text-xs text-muted-foreground">Select a company first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xs text-foreground mb-1">Narrative Composer</h1>
        <p className="text-sm text-muted-foreground">
          Copy this prompt into ChatGPT, attach company-data.md, and send. Save
          the full response — you&apos;ll paste it into Cursor next.
        </p>
      </div>

      <PromptBlock label="ChatGPT prompt" text={CHATGPT_SITE_CONTENT_PROMPT} />
    </div>
  );
}
