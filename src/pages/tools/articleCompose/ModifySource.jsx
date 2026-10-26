import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  SOURCE_MAX_CHARS,
  countWords,
  modifyInputErrors,
} from "./composeState";
import { htmlToMarkdown, readSourceFile, sourceFileError } from "./sourceFile";
import { prepareSource } from "./sourceText";
import { uploadWriterImages } from "./writerIntake";
import { keepWriterImages } from "../../../../lib/writer-intake/markdown.js";

function FieldError({ message }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

export default function ModifySource({
  companyId,
  state,
  dispatch,
  disabled = false,
  onIngested,
}) {
  const locked = Boolean(disabled);
  const [domain, setDomain] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [reading, setReading] = useState(false);
  const [readingNote, setReadingNote] = useState("");
  const errors = modifyInputErrors(state);
  const words = countWords(state.sourceArticle);
  const chars = String(state.sourceArticle || "").length;

  useEffect(() => {
    let cancelled = false;
    if (!companyId) return undefined;
    supabase
      .from("company_profiles")
      .select("domain")
      .eq("company_id", companyId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setDomain(String(data?.domain || "").trim());
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  function applyPrepared(prepared, writerImages = []) {
    dispatch({
      type: "patch",
      patch: {
        sourceArticle: prepared.source,
        userLinks: prepared.userLinks,
        imagesRemoved: prepared.imagesRemoved,
        originalTitle: prepared.originalTitle || "",
        originalDescription: prepared.originalDescription || "",
        sourceFileError: "",
        // A new source starts a new writer intake.
        writerImages,
        intake: null,
        intakeStatus: "idle",
        intakeError: "",
        sourceBeforeIntake: "",
        imageChoices: {},
        selectedOption: -1,
        pillarKeyword: "",
        clusterKeyword: "",
        targetKeyword: "",
      },
    });
  }

  async function ingestFile(file) {
    const message = sourceFileError(file);
    if (message) {
      dispatch({ type: "patch", patch: { sourceFileError: message } });
      return;
    }
    setReading(true);
    setReadingNote("Reading the file…");
    try {
      const prepared = await readSourceFile(file, domain);
      let writerImages = [];
      if (prepared.images?.length) {
        setReadingNote(`Saving ${prepared.images.length} image${prepared.images.length === 1 ? "" : "s"} from the document…`);
        writerImages = await uploadWriterImages({ companyId, images: prepared.images });
      }
      // Images that could not be saved lose their placeholder.
      const source = keepWriterImages(prepared.source, writerImages.map((img) => img.n));
      applyPrepared({ ...prepared, source }, writerImages);
      onIngested?.({ source, writerImages });
    } catch (err) {
      dispatch({
        type: "patch",
        patch: { sourceFileError: err?.message || "Could not read that file." },
      });
    } finally {
      setReading(false);
      setReadingNote("");
    }
  }

  function requestFile(file) {
    if (!file || locked) return;
    if (String(state.sourceArticle || "").trim()) {
      setPendingFile(file);
      setConfirmOpen(true);
      return;
    }
    ingestFile(file);
  }

  async function onPaste(event) {
    if (locked) return;
    const html = event.clipboardData?.getData("text/html") || "";
    const plain = event.clipboardData?.getData("text/plain") || "";
    if (!html.trim() && !plain) return;
    event.preventDefault();
    const markdown = html.trim() ? await htmlToMarkdown(html) : plain;
    const prepared = {
      ...prepareSource(markdown, domain),
      originalTitle: "",
      originalDescription: "",
    };
    if (!String(state.sourceArticle || "").trim()) {
      applyPrepared(prepared);
      return;
    }
    const el = event.target;
    const start = el.selectionStart ?? state.sourceArticle.length;
    const end = el.selectionEnd ?? start;
    const next = `${state.sourceArticle.slice(0, start)}${prepared.source}${state.sourceArticle.slice(end)}`;
    dispatch({
      type: "patch",
      patch: {
        sourceArticle: next,
        userLinks: mergeLinks(state.userLinks, prepared.userLinks),
        imagesRemoved: Number(state.imagesRemoved || 0) + prepared.imagesRemoved,
      },
    });
  }

  return (
    <div className="space-y-4">
      <div
        data-dropzone
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          requestFile(event.dataTransfer?.files?.[0]);
        }}
        className="rounded-md border border-dashed border-border px-4 py-6 text-center"
      >
        <p className="text-sm text-muted-foreground">
          Drop a .md, .txt, or .docx file
        </p>
        <Label htmlFor="compose-source-file" className="mt-2 inline-block text-sm underline cursor-pointer">
          Choose file
        </Label>
        <input
          id="compose-source-file"
          type="file"
          accept=".md,.txt,.docx,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          disabled={locked || reading}
          onChange={(event) => {
            requestFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      <FieldError message={state.sourceFileError} />
      {reading && readingNote && <p className="text-xs text-muted-foreground">{readingNote}</p>}

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor="compose-source">Source</Label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {words.toLocaleString()} words · {chars.toLocaleString()} /{" "}
            {SOURCE_MAX_CHARS.toLocaleString()}
          </span>
        </div>
        <Textarea
          id="compose-source"
          value={state.sourceArticle}
          rows={12}
          disabled={locked || reading}
          onPaste={onPaste}
          onChange={(event) =>
            dispatch({
              type: "patch",
              patch: { sourceArticle: event.target.value },
            })
          }
          placeholder="Paste an article, or drop a file above."
        />
        <FieldError message={errors.sourceWords} />
        <FieldError message={errors.sourceLength} />
      </div>

      {state.originalTitle && (
        <p className="text-sm text-muted-foreground">
          Original title: {state.originalTitle}
        </p>
      )}
      {state.originalDescription && (
        <p className="text-sm text-muted-foreground">
          Original description: {state.originalDescription}
        </p>
      )}
      {state.writerImages?.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {state.writerImages.length} image{state.writerImages.length === 1 ? "" : "s"} kept from the document — choose
          how each is used in Writer brief below.
        </p>
      )}
      {state.imagesRemoved > 0 && (
        <p className="text-sm text-muted-foreground">
          {state.imagesRemoved} image{state.imagesRemoved === 1 ? "" : "s"} removed
          {state.writerImages?.length ? "." : " — a hero image will be generated."}
        </p>
      )}

      {state.userLinks.length > 0 && (
        <div className="space-y-2">
          <Label>External links</Label>
          <ul className="space-y-2">
            {state.userLinks.map((link) => (
              <li key={link.url} className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={link.checked !== false}
                  disabled={locked}
                  onCheckedChange={(checked) =>
                    dispatch({
                      type: "patch",
                      patch: {
                        userLinks: state.userLinks.map((item) =>
                          item.url === link.url
                            ? { ...item, checked: checked === true }
                            : item
                        ),
                      },
                    })
                  }
                  aria-label={link.anchor || link.url}
                />
                <span>
                  {link.anchor || link.url}
                  <span className="block text-xs text-muted-foreground break-all">
                    {link.url}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={state.expandLength ? "outline" : "default"}
          disabled={locked}
          onClick={() => dispatch({ type: "patch", patch: { expandLength: false } })}
        >
          Keep length
        </Button>
        <Button
          type="button"
          size="sm"
          variant={state.expandLength ? "default" : "outline"}
          disabled={locked}
          onClick={() => dispatch({ type: "patch", patch: { expandLength: true } })}
        >
          Expand to target word count
        </Button>
      </div>
      {!state.expandLength && words > 0 && words < 600 && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Short articles tend to rank poorly. Consider Expand.
        </p>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the current source?</AlertDialogTitle>
            <AlertDialogDescription>
              The file will replace the source article already in the editor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setPendingFile(null)}
            >
              Cancel
            </AlertDialogCancel>
            <Button
              type="button"
              onClick={() => {
                const file = pendingFile;
                setPendingFile(null);
                setConfirmOpen(false);
                if (file) ingestFile(file);
              }}
            >
              Replace
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function mergeLinks(current, incoming) {
  const seen = new Set((current || []).map((link) => link.url));
  const next = Array.isArray(current) ? [...current] : [];
  for (const link of incoming || []) {
    if (!link?.url || seen.has(link.url)) continue;
    seen.add(link.url);
    next.push(link);
  }
  return next;
}
