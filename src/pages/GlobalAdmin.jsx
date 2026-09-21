import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, Map, GitBranch, PlugZap } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Same key the sidebar uses to remember the last-opened company.
const LAST_COMPANY_ID_KEY = "lastCompanyId";
function lastCompanyId() {
  try {
    return sessionStorage.getItem(LAST_COMPANY_ID_KEY) || "";
  } catch {
    return "";
  }
}

function taskErrorMessage(err, fallback) {
  const message = err?.message || fallback;
  if (/workspace_tasks|schema cache|does not exist/i.test(message)) {
    return "Tasks are not set up in the database yet. Run supabase/migrations/046_workspace_tasks.sql in Supabase, then reload.";
  }
  return message;
}

function WorkspaceTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("workspace_tasks")
      .select("id, body, created_at")
      .order("created_at", { ascending: false });

    if (fetchError) {
      console.error("Failed to load workspace tasks:", fetchError);
      setError(taskErrorMessage(fetchError, "Failed to load tasks"));
      setTasks([]);
    } else {
      setTasks(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleAddTask = async (e) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    setError("");
    const { error: insertError } = await supabase
      .from("workspace_tasks")
      .insert({ body: trimmed });

    if (insertError) {
      console.error("Failed to add workspace task:", insertError);
      setError(taskErrorMessage(insertError, "Failed to save task"));
      setSaving(false);
      return;
    }

    setBody("");
    setShowForm(false);
    setSaving(false);
    await loadTasks();
  };

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium text-foreground">Tasks</h2>
        <Button
          type="button"
          variant={showForm ? "outline" : "default"}
          size="sm"
          onClick={() => setShowForm((open) => !open)}
        >
          {showForm ? "Cancel" : "Add New"}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleAddTask}
          className="mb-4 space-y-3 rounded-lg border border-border p-4"
        >
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a task…"
            rows={4}
            autoFocus
            required
          />
          <Button type="submit" disabled={saving || !body.trim()}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </form>
      )}

      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading tasks…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks yet.</p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="whitespace-pre-wrap rounded-lg border border-border bg-card/40 px-4 py-3 text-sm text-foreground"
            >
              {task.body}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CoreVersionCompanyMenu() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadCompanies() {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name")
        .order("name", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error("Failed to load companies for Core Version:", error);
        setCompanies([]);
      } else {
        setCompanies(data || []);
      }
      setLoading(false);
    }

    loadCompanies();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="w-full rounded-lg border border-border bg-card/40 p-4 text-left transition-colors hover:bg-accent/40"
        >
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              Core Version
            </span>
            <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground" />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Choose a company to manage its seo-core version.
          </p>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-64 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
      >
        {loading ? (
          <DropdownMenuItem disabled>Loading companies…</DropdownMenuItem>
        ) : companies.length === 0 ? (
          <DropdownMenuItem disabled>No companies yet</DropdownMenuItem>
        ) : (
          companies.map((company) => (
            <DropdownMenuItem
              key={company.id}
              onSelect={() =>
                navigate(`/company/${company.id}/core-version`)
              }
            >
              {company.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function GlobalAdmin() {
  const cid = lastCompanyId();

  // System Map is fully global. Core Version is a company picker. Integrations
  // still opens the last-used company until it moves fully global.
  const integrations = {
    label: "Integrations",
    desc: cid
      ? "API keys and connection status."
      : "Open a company first to view integrations.",
    to: cid ? `/company/${cid}/integrations` : null,
  };

  return (
    <div className="mx-auto max-w-4xl px-1 pb-16 pt-2">
      <header className="mb-6">
        <h1 className="text-xs text-foreground">Workspace Admin</h1>
      </header>

      <WorkspaceTasks />

      <div className="grid grid-cols-3 gap-3">
        <Link
          to="/admin/system-map"
          className="rounded-lg border border-border bg-card/40 p-4 transition-colors hover:bg-accent/40"
        >
          <div className="flex items-center gap-2">
            <Map className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              System Map
            </span>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Live map of pages, APIs, and destination-site wiring.
          </p>
        </Link>

        <CoreVersionCompanyMenu />

        {integrations.to ? (
          <Link
            to={integrations.to}
            className="rounded-lg border border-border bg-card/40 p-4 transition-colors hover:bg-accent/40"
          >
            <div className="flex items-center gap-2">
              <PlugZap className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {integrations.label}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {integrations.desc}
            </p>
          </Link>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-card/20 p-4 opacity-60">
            <div className="flex items-center gap-2">
              <PlugZap className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {integrations.label}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {integrations.desc}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
