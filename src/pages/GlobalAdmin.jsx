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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const TASK_STATUSES = [
  { id: "do", label: "Do" },
  { id: "doing", label: "Doing" },
  { id: "done", label: "Done" },
  { id: "archived", label: "Archive" },
];

const TASKS_MIGRATION = "063_workspace_task_board.sql";

function taskTitle(task) {
  const name = String(task?.name || "").trim();
  if (name) return name;
  const first = String(task?.body || "").split(/\r?\n/, 1)[0].trim();
  return first || "Untitled";
}

function taskDetails(task) {
  const name = String(task?.name || "").trim();
  const body = String(task?.body || "");
  if (name) return body;
  return body.split(/\r?\n/).slice(1).join("\n").trim();
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
        desc="Do, Doing, Done, and Archive."
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
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editBody, setEditBody] = useState("");
  const [busyId, setBusyId] = useState(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("workspace_tasks")
      .select("id, name, body, status, created_at")
      .order("created_at", { ascending: false });

    if (fetchError) {
      console.error("Failed to load workspace tasks:", fetchError);
      setError(
        tableSetupError(
          fetchError,
          "Failed to load tasks",
          "workspace_tasks",
          TASKS_MIGRATION
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
    setName("");
    setBody("");
    setSelectedId(null);
    loadTasks();
  }, [open, loadTasks]);

  const selected = tasks.find((task) => task.id === selectedId) || null;

  const openTask = (task) => {
    setSelectedId(task.id);
    setEditName(taskTitle(task) === "Untitled" && !String(task.name || "").trim() ? "" : taskTitle(task));
    setEditBody(taskDetails(task));
    setShowForm(false);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || saving) return;

    setSaving(true);
    setError("");
    const { error: insertError } = await supabase
      .from("workspace_tasks")
      .insert({ name: trimmedName, body: body.trim(), status: "do" });

    if (insertError) {
      console.error("Failed to add workspace task:", insertError);
      setError(
        tableSetupError(
          insertError,
          "Failed to save task",
          "workspace_tasks",
          TASKS_MIGRATION
        )
      );
      setSaving(false);
      return;
    }

    setName("");
    setBody("");
    setShowForm(false);
    setSaving(false);
    await loadTasks();
  };

  const handleSaveEdit = async () => {
    const trimmedName = editName.trim();
    if (!selected || !trimmedName || busyId) return;

    setBusyId(selected.id);
    setError("");
    const { error: updateError } = await supabase
      .from("workspace_tasks")
      .update({ name: trimmedName, body: editBody.trim() })
      .eq("id", selected.id);

    if (updateError) {
      console.error("Failed to update workspace task:", updateError);
      setError(
        tableSetupError(
          updateError,
          "Failed to update task",
          "workspace_tasks",
          TASKS_MIGRATION
        )
      );
      setBusyId(null);
      return;
    }

    setBusyId(null);
    await loadTasks();
  };

  const handleStatus = async (task, status) => {
    if (!task || busyId) return;
    setBusyId(task.id);
    setError("");
    setTasks((prev) => prev.map((item) => (item.id === task.id ? { ...item, status } : item)));
    const { error: updateError } = await supabase
      .from("workspace_tasks")
      .update({ status })
      .eq("id", task.id);

    if (updateError) {
      console.error("Failed to update workspace task status:", updateError);
      setError(
        tableSetupError(
          updateError,
          "Failed to update task",
          "workspace_tasks",
          TASKS_MIGRATION
        )
      );
      setBusyId(null);
      await loadTasks();
      return;
    }

    setBusyId(null);
  };

  const handleRemove = async (task) => {
    if (!task || busyId) return;
    if (!window.confirm(`Delete "${taskTitle(task)}"? This cannot be undone.`)) return;
    setBusyId(task.id);
    setError("");
    const { error: deleteError } = await supabase
      .from("workspace_tasks")
      .delete()
      .eq("id", task.id);

    if (deleteError) {
      console.error("Failed to delete workspace task:", deleteError);
      setError(
        tableSetupError(
          deleteError,
          "Failed to remove task",
          "workspace_tasks",
          TASKS_MIGRATION
        )
      );
      setBusyId(null);
      return;
    }

    if (selectedId === task.id) setSelectedId(null);
    setBusyId(null);
    await loadTasks();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[88vh] max-h-[88vh] w-[calc(100%-2rem)] max-w-6xl flex-col gap-4 overflow-hidden">
          <DialogHeader>
            <DialogTitle>Tasks</DialogTitle>
            <DialogDescription>
              Move a task across Do, Doing, Done, and Archive.
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
            <form onSubmit={handleAdd} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,16rem)_1fr_auto] sm:items-start">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Task name"
                autoFocus
                required
              />
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Description"
                rows={2}
              />
              <Button type="submit" size="sm" disabled={saving || !name.trim()}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </form>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="min-h-0 flex-1 overflow-x-auto">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading tasks…</p>
            ) : (
              <div className="grid h-full min-w-[720px] grid-cols-4 gap-3">
                {TASK_STATUSES.map((column) => {
                  const columnTasks = tasks.filter(
                    (task) => (task.status || "do") === column.id
                  );
                  return (
                    <section
                      key={column.id}
                      className="flex min-h-0 flex-col rounded-lg bg-muted/50"
                    >
                      <h3 className="px-3 py-2 text-xs font-medium text-foreground">
                        {column.label}
                        <span className="ml-2 text-muted-foreground">{columnTasks.length}</span>
                      </h3>
                      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                        {columnTasks.length === 0 ? (
                          <li className="px-1 text-xs text-muted-foreground">Nothing here.</li>
                        ) : (
                          columnTasks.map((task) => {
                            const details = taskDetails(task);
                            return (
                              <li key={task.id}>
                                <div className="flex items-start gap-2 rounded-md border border-border bg-card px-2.5 py-2">
                                  <Checkbox
                                    checked={(task.status || "do") === "done"}
                                    disabled={busyId === task.id}
                                    onCheckedChange={(checked) =>
                                      handleStatus(task, checked ? "done" : "do")
                                    }
                                    aria-label={
                                      (task.status || "do") === "done"
                                        ? "Mark not done"
                                        : "Mark done"
                                    }
                                    className="mt-0.5"
                                  />
                                  <button
                                    type="button"
                                    className="min-w-0 flex-1 text-left"
                                    onClick={() => openTask(task)}
                                  >
                                    <p className="text-sm font-medium text-foreground">
                                      {taskTitle(task)}
                                    </p>
                                    {details ? (
                                      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
                                        {details}
                                      </p>
                                    ) : null}
                                  </button>
                                </div>
                              </li>
                            );
                          })
                        )}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(next) => {
          if (!next) setSelectedId(null);
        }}
      >
        <DialogContent className="flex max-h-[90vh] w-[calc(100%-2rem)] max-w-4xl flex-col gap-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Task</DialogTitle>
            <DialogDescription>
              Name, description, and where it sits on the board.
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={(selected.status || "do") === "done"}
                  disabled={busyId === selected.id}
                  onCheckedChange={(checked) =>
                    handleStatus(selected, checked ? "done" : "do")
                  }
                  aria-label="Completed"
                />
                <Label className="text-sm">Completed</Label>
              </div>

              <div className="flex flex-wrap gap-2">
                {TASK_STATUSES.map((column) => (
                  <Button
                    key={column.id}
                    type="button"
                    size="sm"
                    variant={(selected.status || "do") === column.id ? "default" : "outline"}
                    disabled={busyId === selected.id}
                    onClick={() => handleStatus(selected, column.id)}
                  >
                    {column.label}
                  </Button>
                ))}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="task-name">Name</Label>
                <Input
                  id="task-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-description">Description</Label>
                <Textarea
                  id="task-description"
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={12}
                  className="min-h-48"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busyId === selected.id}
                  onClick={() => handleRemove(selected)}
                >
                  Delete
                </Button>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedId(null)}
                  >
                    Close
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busyId === selected.id || !editName.trim()}
                    onClick={handleSaveEdit}
                  >
                    {busyId === selected.id ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
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
