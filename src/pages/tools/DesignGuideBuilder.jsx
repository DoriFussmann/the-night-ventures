import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ChevronDown,
  Copy,
  Download,
  Eraser,
  FileUp,
  Loader2,
  Pencil,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CATEGORY_BY_FIELD_KEY,
  COLOR_ASSIGN_TARGETS,
  FIELD_BY_KEY,
  FIELD_SCHEMA,
  REQUIRED_KEYS,
  countFilledInCategory,
  emptyFields,
  getEmptyKeys,
  getFilledContext,
  getMissingRequired,
  mergeIntoEmpty,
  normalizeFields,
} from "./designGuide/schema";
import { downloadMarkdown, toDesignGuideMarkdown } from "./designGuide/markdown";
import { extractColorsFromImage } from "./designGuide/extractColors";

function snapshotFields(fields) {
  return JSON.stringify(fields);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

function normalizeHex(value) {
  const raw = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
  return raw;
}

function fieldsHaveContent(fields) {
  return Object.values(fields || {}).some((v) => String(v || "").trim());
}

const COMPANY_GUIDE_KEY = "__company__";

export default function DesignGuideBuilder() {
  const { companyId } = useParams();
  const fieldRefs = useRef({});

  const [companyName, setCompanyName] = useState("");
  const [fields, setFields] = useState(emptyFields);
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshotFields(emptyFields()));
  const [autoKeys, setAutoKeys] = useState(() => new Set());
  const [themes, setThemes] = useState([]);
  const [companyGuide, setCompanyGuide] = useState(null); // { fields, updated_at } | null
  const [selectedThemeId, setSelectedThemeId] = useState("");
  const [entryMode, setEntryMode] = useState(null); // "existing" | "new" | null
  const [openSections, setOpenSections] = useState([]);
  const [missingOpen, setMissingOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileJobs, setFileJobs] = useState([]);
  const [extractedSwatches, setExtractedSwatches] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [suggestions, setSuggestions] = useState(null);

  const dirty = snapshotFields(fields) !== savedSnapshot;

  const missingRequired = useMemo(() => getMissingRequired(fields), [fields]);
  const requiredFilled = REQUIRED_KEYS.length - missingRequired.length;
  const requiredPct = Math.round((requiredFilled / REQUIRED_KEYS.length) * 100);
  const emptyKeys = useMemo(() => getEmptyKeys(fields), [fields]);
  const hasEmptyFields = emptyKeys.length > 0;

  const refreshThemes = useCallback(async () => {
    const { data, error: themesError } = await supabase
      .from("design_guide_themes")
      .select("id, name, fields, created_at")
      .order("name", { ascending: true });

    if (themesError) {
      console.error("Failed to load themes:", themesError);
      setError(themesError.message || "Failed to load themes");
      return [];
    }

    const list = data || [];
    setThemes(list);
    return list;
  }, []);

  const loadData = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    setError("");
    setDeleteArmed(false);
    setSuggestions(null);
    setAiError("");
    setExtractedSwatches([]);
    setFileJobs([]);
    setSelectedThemeId("");
    setEntryMode(null);

    const [companyResult, guideResult, themesResult] = await Promise.all([
      supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      supabase
        .from("design_guides")
        .select("id, fields, updated_at")
        .eq("company_id", companyId)
        .maybeSingle(),
      supabase
        .from("design_guide_themes")
        .select("id, name, fields, created_at")
        .order("name", { ascending: true }),
    ]);

    if (companyResult.error) {
      console.error("Failed to load company:", companyResult.error);
      setError(companyResult.error.message || "Failed to load company");
    } else {
      setCompanyName(companyResult.data?.name || "");
    }

    if (themesResult.error) {
      console.error("Failed to load themes:", themesResult.error);
      setError(themesResult.error.message || "Failed to load themes");
      setThemes([]);
    } else {
      setThemes(themesResult.data || []);
    }

    if (guideResult.error) {
      console.error("Failed to load design guide:", guideResult.error);
      setError(guideResult.error.message || "Failed to load design guide");
      const blank = emptyFields();
      setFields(blank);
      setSavedSnapshot(snapshotFields(blank));
      setAutoKeys(new Set());
      setCompanyGuide(null);
    } else {
      const next = normalizeFields(guideResult.data?.fields);
      setFields(next);
      setSavedSnapshot(snapshotFields(next));
      setAutoKeys(new Set());

      if (fieldsHaveContent(next)) {
        setCompanyGuide({
          fields: next,
          updated_at: guideResult.data?.updated_at || null,
        });
        // Resume the company's last save so work isn't hidden behind entry mode
        setSelectedThemeId(COMPANY_GUIDE_KEY);
        setEntryMode("existing");
      } else {
        setCompanyGuide(null);
      }
    }

    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setDeleteArmed(false);
  }, [selectedThemeId]);

  const markManual = (key) => {
    setAutoKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const updateField = (key, value) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    markManual(key);
  };

  const focusField = (key) => {
    const categoryId = CATEGORY_BY_FIELD_KEY[key];
    if (categoryId) {
      setOpenSections((prev) =>
        prev.includes(categoryId) ? prev : [...prev, categoryId]
      );
    }

    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        const el = fieldRefs.current[key];
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        if (typeof el.focus === "function") {
          el.focus({ preventScroll: true });
        }
      }, 80);
    });
  };

  const handleSave = async () => {
    if (!companyId || saving) return;

    setSaving(true);
    setSavedMessage("");
    setError("");

    const payload = {
      company_id: companyId,
      fields,
      updated_at: new Date().toISOString(),
    };

    const { error: upsertError } = await supabase
      .from("design_guides")
      .upsert(payload, { onConflict: "company_id" })
      .select("id")
      .single();

    if (upsertError) {
      console.error("Failed to save design guide:", upsertError);
      setError(upsertError.message || "Failed to save");
      setSaving(false);
      return;
    }

    setSavedSnapshot(snapshotFields(fields));
    setCompanyGuide({ fields: { ...fields }, updated_at: payload.updated_at });
    setSaving(false);
    setSavedMessage("Saved to company");
    window.setTimeout(() => setSavedMessage(""), 2500);
  };

  const handleDownload = () => {
    downloadMarkdown("Design Guide.md", toDesignGuideMarkdown(fields));
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(toDesignGuideMarkdown(fields));
      setCopyMessage("Copied");
      window.setTimeout(() => setCopyMessage(""), 2000);
    } catch (err) {
      console.error("Clipboard copy failed:", err);
      setError("Failed to copy to clipboard");
    }
  };

  const applyLoadedFields = (nextFields) => {
    const next = normalizeFields(nextFields);
    setFields(next);
    setSavedSnapshot(snapshotFields(next));
    setAutoKeys(new Set());
    setSuggestions(null);
    setExtractedSwatches([]);
    setFileJobs([]);
    setAiError("");
    setError("");
  };

  const loadThemeById = (themeId, { confirmDirty = true } = {}) => {
    if (!themeId) return false;

    if (confirmDirty && dirty) {
      const ok = window.confirm(
        "You have unsaved changes. Load this and replace the current form?"
      );
      if (!ok) return false;
    }

    if (themeId === COMPANY_GUIDE_KEY) {
      if (!companyGuide) return false;
      applyLoadedFields(companyGuide.fields);
      setSelectedThemeId(COMPANY_GUIDE_KEY);
      setEntryMode("existing");
      setDeleteArmed(false);
      return true;
    }

    const theme = themes.find((t) => t.id === themeId);
    if (!theme) return false;

    applyLoadedFields(theme.fields);
    setSelectedThemeId(themeId);
    setEntryMode("existing");
    setDeleteArmed(false);
    return true;
  };

  const handleStartNewTheme = () => {
    if (dirty) {
      const ok = window.confirm(
        "You have unsaved changes. Start a new theme and clear the form?"
      );
      if (!ok) return;
    }

    const blank = emptyFields();
    setFields(blank);
    setSavedSnapshot(snapshotFields(blank));
    setAutoKeys(new Set());
    setSuggestions(null);
    setExtractedSwatches([]);
    setFileJobs([]);
    setAiError("");
    setError("");
    setSelectedThemeId("");
    setDeleteArmed(false);
    setEntryMode("new");
  };

  const handleOpenExisting = async () => {
    setDeleteArmed(false);
    setEntryMode("existing");
    const list = await refreshThemes();

    // If nothing selected yet, prefer company last-save, else sole theme
    if (!selectedThemeId) {
      if (companyGuide) {
        loadThemeById(COMPANY_GUIDE_KEY, { confirmDirty: false });
      } else if (list.length === 1) {
        loadThemeById(list[0].id, { confirmDirty: false });
      }
    }
  };

  const handleClearData = () => {
    const hasContent =
      dirty ||
      Object.values(fields).some((v) => String(v || "").trim()) ||
      fileJobs.length > 0 ||
      extractedSwatches.length > 0 ||
      suggestions;

    if (hasContent) {
      const ok = window.confirm("Clear all form data?");
      if (!ok) return;
    }

    const blank = emptyFields();
    setFields(blank);
    setAutoKeys(new Set());
    setSuggestions(null);
    setExtractedSwatches([]);
    setFileJobs([]);
    setAiError("");
    setError("");
  };

  const handleSaveAsTheme = async () => {
    const isNamedTheme =
      selectedThemeId && selectedThemeId !== COMPANY_GUIDE_KEY;
    const existing = themes.find((t) => t.id === selectedThemeId);
    const defaultName = existing?.name || companyName || "";
    const raw = window.prompt(
      isNamedTheme ? "Update theme name:" : "Theme name:",
      defaultName
    );
    if (raw == null) return;
    const name = raw.trim();
    if (!name) return;

    setError("");
    const payload = isNamedTheme
      ? { id: selectedThemeId, name, fields }
      : { name, fields };

    const { data, error: upsertError } = await supabase
      .from("design_guide_themes")
      .upsert(payload, isNamedTheme ? undefined : { onConflict: "name" })
      .select("id, name, fields, created_at")
      .single();

    if (upsertError) {
      console.error("Failed to save theme:", upsertError);
      setError(upsertError.message || "Failed to save theme");
      return;
    }

    setThemes((prev) => {
      const others = prev.filter((t) => t.id !== data.id && t.name !== data.name);
      return [...others, data].sort((a, b) => a.name.localeCompare(b.name));
    });
    setSelectedThemeId(data.id);
    setEntryMode("existing");
    setSavedMessage(isNamedTheme ? "Theme updated" : "Theme saved");
    window.setTimeout(() => setSavedMessage(""), 2500);
  };

  const handleDeleteTheme = async () => {
    if (!selectedThemeId || selectedThemeId === COMPANY_GUIDE_KEY) return;

    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }

    setError("");
    const { error: deleteError } = await supabase
      .from("design_guide_themes")
      .delete()
      .eq("id", selectedThemeId);

    if (deleteError) {
      console.error("Failed to delete theme:", deleteError);
      setError(deleteError.message || "Failed to delete theme");
      setDeleteArmed(false);
      return;
    }

    setThemes((prev) => prev.filter((t) => t.id !== selectedThemeId));
    setSelectedThemeId(companyGuide ? COMPANY_GUIDE_KEY : "");
    if (companyGuide) {
      applyLoadedFields(companyGuide.fields);
    }
    setDeleteArmed(false);
  };

  const updateFileJob = (id, patch) => {
    setFileJobs((prev) => prev.map((job) => (job.id === id ? { ...job, ...patch } : job)));
  };

  const processFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    for (const file of files) {
      const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const lower = file.name.toLowerCase();
      const isImage = file.type.startsWith("image/");
      const isPdf = file.type === "application/pdf" || lower.endsWith(".pdf");
      const isText =
        file.type.startsWith("text/") ||
        lower.endsWith(".md") ||
        lower.endsWith(".markdown") ||
        lower.endsWith(".txt");

      setFileJobs((prev) => [
        ...prev,
        { id, name: file.name, status: "scanning", summary: "" },
      ]);

      try {
        if (isImage) {
          const colors = await extractColorsFromImage(file);
          setExtractedSwatches(colors);

          const autoAssignKeys = ["colorPrimary", "colorSecondary", "colorAccent"];
          const incoming = {};
          autoAssignKeys.forEach((key, index) => {
            if (colors[index]) incoming[key] = colors[index];
          });

          let filledCount = 0;
          setFields((prev) => {
            const { fields: next, applied } = mergeIntoEmpty(prev, incoming);
            filledCount = applied.length;
            if (applied.length) {
              setAutoKeys((keys) => {
                const merged = new Set(keys);
                applied.forEach((k) => merged.add(k));
                return merged;
              });
            }
            return next;
          });

          updateFileJob(id, {
            status: "done",
            summary:
              colors.length === 0
                ? "No colors found"
                : `${colors.length} swatches${filledCount ? `, ${filledCount} fields filled` : ""}`,
          });
        } else if (isPdf) {
          const content = await fileToBase64(file);
          const res = await fetch("/api/design-guide-extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileType: "pdf", content }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data.error || `Extract failed (${res.status})`);
          }

          let filledCount = 0;
          setFields((prev) => {
            const { fields: next, applied } = mergeIntoEmpty(prev, data);
            filledCount = applied.length;
            if (applied.length) {
              setAutoKeys((keys) => {
                const merged = new Set(keys);
                applied.forEach((k) => merged.add(k));
                return merged;
              });
            }
            return next;
          });

          updateFileJob(id, {
            status: "done",
            summary: `${filledCount} field${filledCount === 1 ? "" : "s"} filled`,
          });
        } else if (isText) {
          const content = await readFileAsText(file);
          const res = await fetch("/api/design-guide-extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileType: "text", content }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data.error || `Extract failed (${res.status})`);
          }

          let filledCount = 0;
          setFields((prev) => {
            const { fields: next, applied } = mergeIntoEmpty(prev, data);
            filledCount = applied.length;
            if (applied.length) {
              setAutoKeys((keys) => {
                const merged = new Set(keys);
                applied.forEach((k) => merged.add(k));
                return merged;
              });
            }
            return next;
          });

          updateFileJob(id, {
            status: "done",
            summary: `${filledCount} field${filledCount === 1 ? "" : "s"} filled`,
          });
        } else {
          updateFileJob(id, {
            status: "error",
            summary: "Unsupported file type",
          });
        }
      } catch (err) {
        console.error("File scan failed:", err);
        updateFileJob(id, {
          status: "error",
          summary: err.message || "Scan failed",
        });
      }
    }
  };

  const assignSwatch = (hex, targetKey) => {
    if (!targetKey || !hex) return;
    setFields((prev) => ({ ...prev, [targetKey]: hex }));
    setAutoKeys((prev) => {
      const next = new Set(prev);
      next.add(targetKey);
      return next;
    });
  };

  const handleCompleteWithAi = async () => {
    const missing = getEmptyKeys(fields);
    if (!missing.length || aiLoading) return;

    setAiLoading(true);
    setAiError("");
    setSuggestions(null);

    try {
      const res = await fetch("/api/design-guide-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: getFilledContext(fields),
          missingKeys: missing,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `AI complete failed (${res.status})`);
      }

      const rows = Object.entries(data)
        .filter(([key, value]) => FIELD_BY_KEY[key] && value != null && String(value).trim())
        .map(([key, value]) => ({
          key,
          label: FIELD_BY_KEY[key].label,
          value: String(value),
          checked: true,
        }));

      if (!rows.length) {
        setAiError("No suggestions returned");
      } else {
        setSuggestions(rows);
      }
    } catch (err) {
      console.error("AI complete failed:", err);
      setAiError(err.message || "AI complete failed");
    } finally {
      setAiLoading(false);
    }
  };

  const applyCheckedSuggestions = () => {
    if (!suggestions) return;
    const incoming = {};
    for (const row of suggestions) {
      if (row.checked && String(row.value).trim()) {
        incoming[row.key] = String(row.value).trim();
      }
    }

    setFields((prev) => {
      const next = { ...prev };
      const applied = [];
      for (const [key, value] of Object.entries(incoming)) {
        next[key] = value;
        applied.push(key);
      }
      if (applied.length) {
        setAutoKeys((keys) => {
          const merged = new Set(keys);
          applied.forEach((k) => merged.add(k));
          return merged;
        });
      }
      return next;
    });
    setSuggestions(null);
  };

  const setFieldRef = (key, node) => {
    if (node) {
      fieldRefs.current[key] = node;
    } else {
      delete fieldRefs.current[key];
    }
  };

  const renderField = (field) => {
    const value = fields[field.key] ?? "";
    const showAuto = autoKeys.has(field.key);
    const id = `dg-${field.key}`;

    return (
      <div key={field.key} className="space-y-2" data-field-key={field.key}>
        <div className="flex items-center gap-2">
          <Label htmlFor={id}>
            {field.label}
            {field.required ? " *" : ""}
          </Label>
          {showAuto && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-medium">
              auto
            </Badge>
          )}
        </div>

        {field.type === "textarea" ? (
          <Textarea
            id={id}
            ref={(node) => setFieldRef(field.key, node)}
            value={value}
            placeholder={field.placeholder || undefined}
            className="min-h-[80px]"
            onChange={(e) => updateField(field.key, e.target.value)}
          />
        ) : field.type === "color" ? (
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={`${field.label} color picker`}
              className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-1"
              value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
              onChange={(e) => updateField(field.key, e.target.value.toUpperCase())}
            />
            <Input
              id={id}
              ref={(node) => setFieldRef(field.key, node)}
              value={value}
              placeholder="#000000"
              onChange={(e) => updateField(field.key, normalizeHex(e.target.value))}
            />
          </div>
        ) : field.type === "select" ? (
          <Select
            value={value || undefined}
            onValueChange={(next) => updateField(field.key, next)}
          >
            <SelectTrigger id={id} ref={(node) => setFieldRef(field.key, node)}>
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {(field.options || []).map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id={id}
            ref={(node) => setFieldRef(field.key, node)}
            value={value}
            placeholder={field.placeholder || undefined}
            onChange={(e) => updateField(field.key, e.target.value)}
          />
        )}
      </div>
    );
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading design guide...</p>;
  }

  const showWorkspace =
    entryMode === "new" || (entryMode === "existing" && Boolean(selectedThemeId));
  const hasNamedThemeSelected =
    Boolean(selectedThemeId) && selectedThemeId !== COMPANY_GUIDE_KEY;
  const openExistingEmpty = !companyGuide && themes.length === 0;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xs text-foreground">Design Guide Builder</h1>
        {companyName && (
          <span className="text-xs text-muted-foreground">{companyName}</span>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {/* Entry: open existing or start new */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={entryMode === "existing" ? "default" : "outline"}
          onClick={() => {
            void handleOpenExisting();
          }}
        >
          Open existing theme
        </Button>
        <Button
          type="button"
          size="sm"
          variant={entryMode === "new" ? "default" : "outline"}
          onClick={handleStartNewTheme}
        >
          Start new theme
        </Button>

        {entryMode === "existing" && (
          <>
            <Select
              value={selectedThemeId || undefined}
              onValueChange={(v) => {
                setDeleteArmed(false);
                loadThemeById(v);
              }}
            >
              <SelectTrigger id="theme-select" className="w-[260px]">
                <SelectValue placeholder="Select a theme…" />
              </SelectTrigger>
              <SelectContent>
                {companyGuide && (
                  <SelectItem value={COMPANY_GUIDE_KEY}>
                    Company guide (last save)
                  </SelectItem>
                )}
                {themes.map((theme) => (
                  <SelectItem key={theme.id} value={theme.id}>
                    {theme.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasNamedThemeSelected && (
              <Button
                type="button"
                variant={deleteArmed ? "destructive" : "ghost"}
                size="sm"
                onClick={handleDeleteTheme}
                onBlur={() => setDeleteArmed(false)}
              >
                {deleteArmed ? "Confirm delete" : "Delete"}
              </Button>
            )}
            {openExistingEmpty && (
              <span className="text-xs text-muted-foreground">
                No themes yet — use Save as theme after editing
              </span>
            )}
          </>
        )}
      </div>

      {showWorkspace && (
        <>

      {/* Dropzone */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label
          htmlFor="dg-file-input"
          className={`flex h-24 w-full max-w-xs cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed transition-colors ${
            dragOver
              ? "border-foreground bg-muted/40"
              : "border-border hover:border-foreground/40 hover:bg-muted/20"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            processFiles(e.dataTransfer.files);
          }}
          aria-label="Upload brand file"
          title="Upload image, PDF, or text"
        >
          {fileJobs.some((j) => j.status === "scanning") ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : (
            <FileUp className="h-8 w-8 text-muted-foreground" />
          )}
          <input
            id="dg-file-input"
            type="file"
            className="sr-only"
            multiple
            accept="image/*,.pdf,application/pdf,text/*,.md,.markdown,.txt"
            onChange={(e) => {
              processFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClearData}
            title="Clear form data"
          >
            <Eraser className="mr-2 h-3.5 w-3.5" />
            Clear
          </Button>
          {hasNamedThemeSelected ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSaveAsTheme}
              title="Save edits to this theme"
            >
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Save theme
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSaveAsTheme}
            >
              Save as theme…
            </Button>
          )}
        </div>
      </div>

      {fileJobs.length > 0 && (
        <ul className="mb-4 space-y-1 text-sm">
          {fileJobs.map((job) => (
            <li key={job.id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{job.name}</span>
              <span
                className={
                  job.status === "error"
                    ? "text-destructive"
                    : "text-muted-foreground"
                }
              >
                {job.status === "scanning" ? "generating…" : job.summary || job.status}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Progress */}
      <div className="mb-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span>
            {requiredFilled} / {REQUIRED_KEYS.length} required fields
          </span>
          <span className="text-muted-foreground">{requiredPct}%</span>
        </div>
        <Progress value={requiredPct} />
      </div>

      {/* Missing required */}
      <Collapsible open={missingOpen} onOpenChange={setMissingOpen} className="mb-6">
        <div
          className={
            missingRequired.length === 0
              ? "rounded-lg border border-border bg-muted/30 p-3"
              : "rounded-lg border border-border p-3"
          }
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between text-left text-sm font-medium"
            >
              <span>
                {missingRequired.length === 0
                  ? "All required fields present"
                  : `Missing required fields (${missingRequired.length})`}
              </span>
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform ${
                  missingOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            {missingRequired.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every required field has a value.
              </p>
            ) : (
              <ul className="space-y-1">
                {missingRequired.map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      className="text-sm text-foreground underline-offset-2 hover:underline"
                      onClick={() => focusField(item.key)}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CollapsibleContent>
        </div>
      </Collapsible>

      {extractedSwatches.length > 0 && (
        <div className="mb-6 space-y-3 rounded-lg border border-border p-4">
          <p className="text-sm font-medium">Extracted palette</p>
          <div className="space-y-2">
            {extractedSwatches.map((hex) => (
              <div key={hex} className="flex flex-wrap items-center gap-3">
                <span
                  className="h-8 w-8 shrink-0 rounded-md border border-border"
                  style={{ backgroundColor: hex }}
                  title={hex}
                />
                <span className="text-sm font-mono w-20">{hex}</span>
                <Select onValueChange={(target) => assignSwatch(hex, target)}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Assign to…" />
                  </SelectTrigger>
                  <SelectContent>
                    {COLOR_ASSIGN_TARGETS.map((t) => (
                      <SelectItem key={t.key} value={t.key}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Complete with AI */}
      {hasEmptyFields && (
        <div className="mb-6 space-y-3">
          <Button
            type="button"
            variant="secondary"
            disabled={aiLoading}
            onClick={handleCompleteWithAi}
          >
            {aiLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Completing…
              </>
            ) : (
              "Complete with AI"
            )}
          </Button>
          {aiError && <p className="text-sm text-destructive">{aiError}</p>}

          {suggestions && (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <p className="text-sm font-medium">Review AI suggestions</p>
              <div className="space-y-4">
                {suggestions.map((row, index) => (
                  <div key={row.key} className="flex gap-3">
                    <Checkbox
                      checked={row.checked}
                      onCheckedChange={(checked) => {
                        setSuggestions((prev) =>
                          prev.map((r, i) =>
                            i === index ? { ...r, checked: checked === true } : r
                          )
                        );
                      }}
                      className="mt-1"
                      aria-label={`Apply ${row.label}`}
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Label>{row.label}</Label>
                      <Textarea
                        value={row.value}
                        className="min-h-[60px]"
                        onChange={(e) => {
                          const value = e.target.value;
                          setSuggestions((prev) =>
                            prev.map((r, i) => (i === index ? { ...r, value } : r))
                          );
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={applyCheckedSuggestions}>
                  Apply Checked
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setSuggestions(null)}
                >
                  Discard
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save to company"}
        </Button>
        <Button type="button" variant="outline" onClick={handleDownload}>
          <Download className="mr-2 h-4 w-4" />
          Download
        </Button>
        <Button type="button" variant="outline" onClick={handleCopy}>
          <Copy className="mr-2 h-4 w-4" />
          Copy
        </Button>
        {savedMessage && (
          <span className="text-sm text-muted-foreground">{savedMessage}</span>
        )}
        {copyMessage && (
          <span className="text-sm text-muted-foreground">{copyMessage}</span>
        )}
        {dirty && !savedMessage && (
          <span className="text-sm text-muted-foreground">Unsaved changes</span>
        )}
      </div>

      {/* Categories */}
      <Accordion
        type="multiple"
        value={openSections}
        onValueChange={setOpenSections}
        className="space-y-0"
      >
        {FIELD_SCHEMA.map((category) => {
          const { filled, total } = countFilledInCategory(category, fields);
          return (
            <AccordionItem key={category.id} value={category.id}>
              <AccordionTrigger className="text-sm">
                <span className="flex flex-1 items-center justify-between gap-3 pr-2">
                  <span>{category.title}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {filled}/{total} fields filled
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-1">{category.fields.map(renderField)}</div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
        </>
      )}
    </div>
  );
}
