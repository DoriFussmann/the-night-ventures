import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CheckSquare,
  ChevronDown,
  GitBranch,
  Lightbulb,
  Map,
  Pencil,
  PlugZap,
  Trash2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const LAST_COMPANY_ID_KEY = "lastCompanyId";
const CARD_CLASS =
  "w-full rounded-lg border border-border bg-card/40 p-4 text-left transition-colors hover:bg-accent/40";

function lastCompanyId() {
  try {
    return sessionStorage.getItem(LAST_COMPANY_ID_KEY) || "";
  } catch {
    return "";
  }
}

function tableSetupError(err, fallback, table, migration) {
  const message = err?.message || fallback;
  if (new RegExp(`${table}|schema cache|does not exist`, "i").test(message)) {
    return `This list is not set up in the database yet. Run supabase/migrations/${migration} in Supabase, then reload.`;
  }
  return message;
}

function ToolCard({ icon: Icon, title, desc, as: Comp = "button", extra, ...props }) {
  return (
    <Comp className={CARD_CLASS} {...props}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{title}</span>
        {extra}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{desc}</p>
    </Comp>
  );
}

function WorkspaceTasksCard() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <ToolCard
        type="button"
        icon={CheckSquare}
        title="Tasks"
        desc="View, add, edit, and remove workspace tasks."
        onClick={() => setOpen(true)}
      />
      <WorkspaceTasksModal open={open} onOpenChange={setOpen} />
    </>
  );
}

function WorkspaceFutureProjectsCard() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <ToolCard
        type="button"
        icon={Lightbulb}
        title="Future Projects"
        desc="Named notes for upcoming work."
        onClick={() => setOpen(true)}
      />
      <WorkspaceFutureProjectsModal open={open} onOpenChange={setOpen} />
    </>
  );
}

function WorkspaceTasksModal({ open, onOpenChange }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editBody, setEditBody] = useState("");
  const [busyId, setBusyId] = useState(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("workspace_tasks")
      .select("id, body, created_at")
      .order("created_at", { ascending: false });

    if (fetchError) {
      console.error("Failed to load workspace tasks:", fetchError);
      setError(
        tableSetupError(
          fetchError,
          "Failed to load tasks",
          "workspace_tasks",
          "046_workspace_tasks.sql"
        )
      );
      setTasks([]);
    } else {
      setTasks(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    setShowForm(false);
    setBody("");
    setEditingId(null);
    setEditBody("");
    loadTasks();
  }, [open, loadTasks]);

  const handleAdd = async (e) => {
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
      setError(
        tableSetupError(
          insertError,
          "Failed to save task",
          "workspace_tasks",
          "046_workspace_tasks.sql"
        )
      );
      setSaving(false);
      return;
    }

    setBody("");
    setShowForm(false);
    setSaving(false);
    await loadTasks();
  };

  const handleSaveEdit = async (id) => {
    const trimmed = editBody.trim();
    if (!trimmed || busyId) return;

    setBusyId(id);
    setError("");
    const { error: updateError } = await supabase
      .from("workspace_tasks")
      .update({ body: trimmed })
      .eq("id", id);

    if (updateError) {
      console.error("Failed to update workspace task:", updateError);
      setError(
        tableSetupError(
          updateError,
          "Failed to update task",
          "workspace_tasks",
          "046_workspace_tasks.sql"
        )
      );
      setBusyId(null);
      return;
    }

    setEditingId(null);
    setEditBody("");
    setBusyId(null);
    await loadTasks();
  };

  const handleRemove = async (id) => {
    if (busyId) return;
    setBusyId(id);
    setError("");
    const { error: deleteError } = await supabase
      .from("workspace_tasks")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("Failed to delete workspace task:", deleteError);
      setError(
        tableSetupError(
          deleteError,
          "Failed to remove task",
          "workspace_tasks",
          "046_workspace_tasks.sql"
        )
      );
      setBusyId(null);
      return;
    }

    if (editingId === id) {
      setEditingId(null);
      setEditBody("");
    }
    setBusyId(null);
    await loadTasks();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tasks</DialogTitle>
          <DialogDescription>
            Workspace-wide notes. Add, edit, or remove anytime.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant={showForm ? "outline" : "default"}
            size="sm"
            onClick={() => setShowForm((openForm) => !openForm)}
          >
            {showForm ? "Cancel" : "Add New"}
          </Button>
        </div>

        {showForm && (
          <form onSubmit={handleAdd} className="space-y-3 rounded-lg border border-border p-3">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write a task…"
              rows={4}
              autoFocus
              required
            />
            <Button type="submit" size="sm" disabled={saving || !body.trim()}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </form>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading tasks…</p>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks yet.</p>
          ) : (
            <ul className="space-y-2">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className="rounded-lg border border-border bg-card/40 px-3 py-2.5"
                >
                  {editingId === task.id ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={4}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={busyId === task.id || !editBody.trim()}
                          onClick={() => handleSaveEdit(task.id)}
                        >
                          {busyId === task.id ? "Saving..." : "Save"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyId === task.id}
                          onClick={() => {
                            setEditingId(null);
                            setEditBody("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm text-foreground">
                        {task.body}
                      </p>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          disabled={busyId === task.id}
                          onClick={() => {
                            setEditingId(task.id);
                            setEditBody(task.body);
                            setShowForm(false);
                          }}
                          aria-label="Edit task"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          disabled={busyId === task.id}
                          onClick={() => handleRemove(task.id)}
                          aria-label="Remove task"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WorkspaceFutureProjectsModal({ open, onOpenChange }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editBody, setEditBody] = useState("");
  const [busyId, setBusyId] = useState(null);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("workspace_future_projects")
      .select("id, name, body, created_at")
      .order("created_at", { ascending: false });

    if (fetchError) {
      console.error("Failed to load future projects:", fetchError);
      setError(
        tableSetupError(
          fetchError,
          "Failed to load future projects",
          "workspace_future_projects",
          "048_workspace_future_projects.sql"
        )
      );
      setProjects([]);
    } else {
      setProjects(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    setShowForm(false);
    setName("");
    setBody("");
    setEditingId(null);
    loadProjects();
  }, [open, loadProjects]);

  const handleAdd = async (e) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedBody = body.trim();
    if (!trimmedName || !trimmedBody || saving) return;

    setSaving(true);
    setError("");
    const { error: insertError } = await supabase
      .from("workspace_future_projects")
      .insert({ name: trimmedName, body: trimmedBody });

    if (insertError) {
      console.error("Failed to add future project:", insertError);
      setError(
        tableSetupError(
          insertError,
          "Failed to save future project",
          "workspace_future_projects",
          "048_workspace_future_projects.sql"
        )
      );
      setSaving(false);
      return;
    }

    setName("");
    setBody("");
    setShowForm(false);
    setSaving(false);
    await loadProjects();
  };

  const handleSaveEdit = async (id) => {
    const trimmedName = editName.trim();
    const trimmedBody = editBody.trim();
    if (!trimmedName || !trimmedBody || busyId) return;

    setBusyId(id);
    setError("");
    const { error: updateError } = await supabase
      .from("workspace_future_projects")
      .update({ name: trimmedName, body: trimmedBody })
      .eq("id", id);

    if (updateError) {
      console.error("Failed to update future project:", updateError);
      setError(
        tableSetupError(
          updateError,
          "Failed to update future project",
          "workspace_future_projects",
          "048_workspace_future_projects.sql"
        )
      );
      setBusyId(null);
      return;
    }

    setEditingId(null);
    setBusyId(null);
    await loadProjects();
  };

  const handleRemove = async (id) => {
    if (busyId) return;
    setBusyId(id);
    setError("");
    const { error: deleteError } = await supabase
      .from("workspace_future_projects")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("Failed to delete future project:", deleteError);
      setError(
        tableSetupError(
          deleteError,
          "Failed to remove future project",
          "workspace_future_projects",
          "048_workspace_future_projects.sql"
        )
      );
      setBusyId(null);
      return;
    }

    if (editingId === id) setEditingId(null);
    setBusyId(null);
    await loadProjects();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Future Projects</DialogTitle>
          <DialogDescription>
            Add notes to a future project by name.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant={showForm ? "outline" : "default"}
            size="sm"
            onClick={() => setShowForm((openForm) => !openForm)}
          >
            {showForm ? "Cancel" : "Add New"}
          </Button>
        </div>

        {showForm && (
          <form onSubmit={handleAdd} className="space-y-3 rounded-lg border border-border p-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              autoFocus
              required
            />
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write notes for this future project…"
              rows={4}
              required
            />
            <Button
              type="submit"
              size="sm"
              disabled={saving || !name.trim() || !body.trim()}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </form>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading future projects…</p>
          ) : projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No future projects yet.</p>
          ) : (
            <ul className="space-y-2">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="rounded-lg border border-border bg-card/40 px-3 py-2.5"
                >
                  {editingId === project.id ? (
                    <div className="space-y-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Project name"
                        autoFocus
                      />
                      <Textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={4}
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={
                            busyId === project.id ||
                            !editName.trim() ||
                            !editBody.trim()
                          }
                          onClick={() => handleSaveEdit(project.id)}
                        >
                          {busyId === project.id ? "Saving..." : "Save"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyId === project.id}
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {project.name}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                          {project.body}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          disabled={busyId === project.id}
                          onClick={() => {
                            setEditingId(project.id);
                            setEditName(project.name);
                            setEditBody(project.body);
                            setShowForm(false);
                          }}
                          aria-label="Edit future project"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          disabled={busyId === project.id}
                          onClick={() => handleRemove(project.id)}
                          aria-label="Remove future project"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
        <button type="button" className={CARD_CLASS}>
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
              onSelect={() => navigate(`/company/${company.id}/core-version`)}
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <WorkspaceTasksCard />
        <WorkspaceFutureProjectsCard />

        <ToolCard
          as={Link}
          to="/admin/system-map"
          icon={Map}
          title="System Map"
          desc="Live map of pages, APIs, and destination-site wiring."
        />

        <CoreVersionCompanyMenu />

        {integrations.to ? (
          <ToolCard
            as={Link}
            to={integrations.to}
            icon={PlugZap}
            title={integrations.label}
            desc={integrations.desc}
          />
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
