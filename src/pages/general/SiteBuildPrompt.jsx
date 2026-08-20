import React, { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import LAYER1_PROMPT from "./siteBuildPromptContent.txt?raw";

const DOC_TITLE = "Initial Site Build Prompt";
const FOLDER_NAME = "blueprint-seo-template";
const FOLDER_PATH = `C:\\Dev\\${FOLDER_NAME}`;
const ENV_STUB = `DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
GOOGLE_PAGESPEED_API_KEY=
`;
const PHOTO_RELATIVE_PATH = "site\\src\\assets\\team\\dori-fussmann.jpg";
const ENV_RELATIVE_PATH = "cms\\.env";

function CopyButton({ text, label = "Copy" }) {
  const [message, setMessage] = useState("");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Copied");
      window.setTimeout(() => setMessage(""), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
      <Copy className="h-3.5 w-3.5" />
      {message || label}
    </Button>
  );
}

function Step({ n, title, children }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h2 className="text-sm font-medium text-foreground">
        {n}. {title}
      </h2>
      <div className="space-y-3 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

export default function SiteBuildPrompt() {
  return (
    <div className="space-y-6 pb-24">
      <div>
        <h1 className="text-xs text-foreground mb-1">{DOC_TITLE}</h1>
        <p className="text-sm text-muted-foreground">
          Operator steps to build the Layer 1 template repo. Do these in order.
        </p>
      </div>

      <Step n={1} title={`Create a new folder locally, called "${FOLDER_NAME}"`}>
        <p>
          On this machine, create{" "}
          <code className="font-mono text-foreground">{FOLDER_PATH}</code>. It
          should be empty.
        </p>
        <CopyButton text={FOLDER_PATH} label="Copy path" />
      </Step>

      <Step n={2} title={`Add ${ENV_RELATIVE_PATH} with the three key names`}>
        <p>
          Inside the new folder, create a <code className="font-mono text-foreground">cms</code>{" "}
          directory, then create{" "}
          <code className="font-mono text-foreground">{ENV_RELATIVE_PATH}</code>{" "}
          with these three names (values stay empty for now):
        </p>
        <pre className="rounded-md border border-border bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap text-foreground">
          {ENV_STUB}
        </pre>
        <CopyButton text={ENV_STUB} label="Copy .env stub" />
      </Step>

      <Step n={3} title="Add site\\src\\assets\\team\\ and drop in Dori's photo">
        <p>
          Create{" "}
          <code className="font-mono text-foreground">
            {FOLDER_NAME}\site\src\assets\team\
          </code>{" "}
          and drag &amp; drop the Dori Fussmann headshot into it, named{" "}
          <code className="font-mono text-foreground">dori-fussmann.jpg</code>{" "}
          (1200×1200).
        </p>
        <p>
          Final file:{" "}
          <code className="font-mono text-foreground">
            {FOLDER_PATH}\{PHOTO_RELATIVE_PATH}
          </code>
        </p>
        <CopyButton text={PHOTO_RELATIVE_PATH} label="Copy relative path" />
      </Step>

      <Step
        n={4}
        title={`Open a new Cursor project on "${FOLDER_NAME}", then paste the prompt`}
      >
        <p>
          File → Open Folder on{" "}
          <code className="font-mono text-foreground">{FOLDER_PATH}</code>. Paste
          the Layer 1 prompt below into the agent and run it.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <CopyButton text={LAYER1_PROMPT} label="Copy prompt" />
        </div>
        <pre className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-muted/30 p-4 text-xs font-mono whitespace-pre-wrap text-foreground">
          {LAYER1_PROMPT}
        </pre>
      </Step>

      <Step n={5} title="Add the credentials to cms\\.env">
        <p>
          After the Cursor build finishes, paste the real values for{" "}
          <code className="font-mono text-foreground">DATAFORSEO_LOGIN</code>,{" "}
          <code className="font-mono text-foreground">DATAFORSEO_PASSWORD</code>
          , and{" "}
          <code className="font-mono text-foreground">
            GOOGLE_PAGESPEED_API_KEY
          </code>{" "}
          from this repo&apos;s{" "}
          <code className="font-mono text-foreground">.env.local</code> into{" "}
          <code className="font-mono text-foreground">
            {FOLDER_PATH}\{ENV_RELATIVE_PATH}
          </code>
          . Do not commit that file.
        </p>
      </Step>

      <Step
        n={6}
        title={`Add to GitHub as "${FOLDER_NAME}" and save as a Template Repo`}
      >
        <p>
          Create a GitHub repository named{" "}
          <code className="font-mono text-foreground">{FOLDER_NAME}</code>, push
          the local repo, then in GitHub: Settings → General → check{" "}
          <strong className="text-foreground font-medium">
            Template repository
          </strong>
          .
        </p>
      </Step>
    </div>
  );
}
