import React, { useCallback, useEffect, useState } from "react";
import { Copy, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import LAYER1_PROMPT from "./siteBuildPromptContent.txt?raw";

const DOC_TITLE = "Initial Site Build Prompt";
const ADDITIONS_KEY = "site_build_prompt_additions";
const ADDITIONS_TITLE = "Additions to Update Version";
const FOLDER_NAME = "blueprint-seo-template";
const FOLDER_PATH = `C:\\Dev\\${FOLDER_NAME}`;
const ENV_STUB = `DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
GOOGLE_PAGESPEED_API_KEY=
`;
const PHOTO_RELATIVE_PATH = "site\\src\\assets\\team\\dori-fussmann.jpg";
const ENV_RELATIVE_PATH = "cms\\.env";

function parseAdditions(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: String(item.id || crypto.randomUUID()),
        content: String(item.content ?? ""),
        created_at: item.created_at || null,
      }))
      .filter((item) => item.content.trim());
  } catch {
    return [];
  }
}

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

function AdditionsPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError("");

    const { data, error: loadError } = await supabase
      .from("general_documents")
      .select("content")
      .eq("key", ADDITIONS_KEY)
      .maybeSingle();

    if (loadError) {
      console.error(loadError);
      setError(loadError.message || "Failed to load additions");
      setItems([]);
    } else {
      setItems(parseAdditions(data?.content));
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const persistItems = async (next) => {
    setSaving(true);
    setError("");

    const { error: saveError } = await supabase.from("general_documents").upsert(
      {
        key: ADDITIONS_KEY,
        title: ADDITIONS_TITLE,
        content: JSON.stringify(next),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );

    if (saveError) {
      console.error(saveError);
      setError(saveError.message || "Failed to save");
      setSaving(false);
      return false;
    }

    setItems(next);
    setSaving(false);
    setSavedMessage("Saved");
    window.setTimeout(() => setSavedMessage(""), 2000);
    return true;
  };

  const handleAdd = async () => {
    const content = draft.trim();
    if (!content || saving) return;

    const next = [
      {
        id: crypto.randomUUID(),
        content,
        created_at: new Date().toISOString(),
      },
      ...items,
    ];

    const ok = await persistItems(next);
    if (ok) {
      setDraft("");
      setAdding(false);
    }
  };

  const handleDelete = async (id) => {
    if (saving) return;
    const ok = await persistItems(items.filter((item) => item.id !== id));
    if (!ok) return;
  };

  return (
    <aside className="rounded-lg border border-border bg-card p-4 space-y-3 lg:sticky lg:top-6">
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-foreground leading-snug">
          {ADDITIONS_TITLE}
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            setAdding(true);
            setError("");
          }}
          disabled={saving || adding}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Change
        </Button>
      </div>

      {savedMessage ? (
        <p className="text-xs text-emerald-600">{savedMessage}</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {adding ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Describe the change…"
            className="min-h-[96px] text-sm"
            autoFocus
            disabled={saving}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setAdding(false);
                setDraft("");
              }}
              disabled={saving}
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleAdd}
              disabled={saving || !draft.trim()}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : items.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground">
          No additions yet. Use + to add a change.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-md border border-border bg-muted/30 p-3 space-y-2"
            >
              <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                {item.content}
              </p>
              <div className="flex items-center justify-between gap-2">
                {item.created_at ? (
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(item.created_at).toLocaleString()}
                  </p>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(item.id)}
                  disabled={saving}
                  className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-accent disabled:opacity-40"
                  title="Delete"
                  aria-label="Delete change"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

export default function SiteBuildPrompt() {
  return (
    <div className="grid grid-cols-1 gap-6 pb-24 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] lg:items-start">
      <div className="min-w-0 space-y-6">
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
            Inside the new folder, create a{" "}
            <code className="font-mono text-foreground">cms</code> directory, then
            create{" "}
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

      <AdditionsPanel />
    </div>
  );
}
