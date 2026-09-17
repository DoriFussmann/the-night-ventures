import React, { useState } from "react";
import { Link, useParams } from "react-router-dom";
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
        <h1 className="text-xs text-foreground mb-1">Site Content Builder</h1>
        <p className="text-xs text-muted-foreground">Select a company first.</p>
      </div>
    );
  }

  const companyDataPath = `/company/${companyId}/company-data`;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xs text-foreground mb-1">Site Content Builder</h1>
        <p className="text-sm text-muted-foreground">
          Generate the site-content spec in ChatGPT, then paste it into Cursor
          to build the pages.
        </p>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-xs text-foreground">How to</h2>
          <p className="text-sm text-muted-foreground">
            Do these in order. The prompt below is what you run in ChatGPT.
          </p>
        </div>

        <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground">
          <li>
            In{" "}
            <Link
              to={companyDataPath}
              className="text-primary font-medium underline underline-offset-2"
            >
              Company Data
            </Link>
            , download the company markdown.
          </li>
          <li>
            In ChatGPT, attach that file as{" "}
            <code className="font-mono text-xs">company-data.md</code> and run
            the site-content prompt.
          </li>
          <li>
            Review depth per page — each page should be substantive and
            complete, never thin filler.
          </li>
          <li>
            Paste the completed spec into Cursor to build all pages. Cursor
            uses <code className="font-mono text-xs">Design Guide.md</code> for
            visuals. Do not degrade SEO/GEO infra, and do not break the build.
          </li>
          <li>
            After the build, run{" "}
            <code className="font-mono text-xs">npm run build</code> locally and
            view-source the homepage to confirm a single H1.
          </li>
        </ol>

        <Button asChild variant="outline" size="sm">
          <Link to={companyDataPath}>Open Company Data →</Link>
        </Button>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-xs text-foreground">ChatGPT site-content prompt</h2>
          <p className="text-sm text-muted-foreground">
            Copy this into ChatGPT with company-data.md attached.
          </p>
        </div>
        <PromptBlock
          label="ChatGPT site-content prompt"
          text={CHATGPT_SITE_CONTENT_PROMPT}
        />
      </section>
    </div>
  );
}
