import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  Database,
  Palette,
  LayoutTemplate,
  PenLine,
  FileEdit,
  Lightbulb,
  BookOpen,
  Mail,
  Image,
  Sparkles,
  MessageSquareText,
  ClipboardCheck,
  Layers,
  LogOut,
  ArrowLeft,
  Construction,
  Map,
  GitBranch,
  ChevronDown,
  PlugZap,
  Settings,
  TriangleAlert,
  ChartLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STATUS_STYLES = {
  Done: "text-emerald-700/80 bg-emerald-500/10",
  Partial: "text-amber-700/80 bg-amber-500/10",
  Verify: "text-slate-500 bg-slate-500/10",
  "To Build": "text-violet-700/70 bg-violet-500/10",
};

function StatusTag({ status }) {
  return (
    <span
      className={`ml-auto shrink-0 rounded px-1 py-px text-[8px] font-medium uppercase tracking-wide ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

function NavItem({ item }) {
  const location = useLocation();
  const isActive = location.pathname === item.path;
  const Icon = item.icon;

  return (
    <Link
      to={item.path}
      className={`w-full flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${
        isActive
          ? "border-border bg-accent text-foreground"
          : "border-border text-foreground/80 hover:bg-accent hover:text-foreground"
      }`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate leading-tight">{item.label}</span>
      {item.status ? <StatusTag status={item.status} /> : null}
      {item.count ? (
        <span
          className="shrink-0 rounded-full bg-sky-600 px-1.5 text-[10px] font-semibold leading-4 text-white tabular-nums"
          title={`${item.count} unread repl${item.count === 1 ? "y" : "ies"}`}
        >
          {item.count}
        </span>
      ) : null}
    </Link>
  );
}

function SectionHeader({ label }) {
  return (
    <p className="px-2.5 pt-2 pb-0.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">
      {label}
    </p>
  );
}

function SectionRule() {
  return <div className="mx-1 mt-3 border-t border-border" role="separator" />;
}

function NavDropdown({ label, icon: Icon, items }) {
  const location = useLocation();
  const childActive = items.some((item) => location.pathname === item.path);
  const [open, setOpen] = useState(childActive);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={`w-full flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${
          childActive
            ? "border-border bg-accent text-foreground"
            : "border-border text-foreground/80 hover:bg-accent hover:text-foreground"
        }`}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate leading-tight">{label}</span>
        <ChevronDown
          className={`w-3 h-3 shrink-0 text-muted-foreground transition-transform duration-200 ease-out ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="mt-1.5 ml-2 space-y-1.5 border-l border-border pl-2">
            {items.map((item) => (
              <NavItem key={item.path} item={item} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const LAST_COMPANY_ID_KEY = "lastCompanyId";

function DangerZone({ companyId, companyName }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState("confirm");
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const expectedName = companyName.trim();
  const nameMatches = expectedName.length > 0 && typed.trim() === expectedName;

  const resetDialog = () => {
    setStep("confirm");
    setTyped("");
    setError("");
    setDeleting(false);
  };

  const handleDialogOpenChange = (next) => {
    if (deleting) return;
    setDialogOpen(next);
    if (!next) resetDialog();
  };

  const handleDelete = async () => {
    if (!nameMatches || deleting) return;
    setDeleting(true);
    setError("");

    const { data, error: deleteError } = await supabase
      .from("companies")
      .delete()
      .eq("id", companyId)
      .select("id");

    if (deleteError || !data?.length) {
      console.error("Failed to delete company:", deleteError);
      setError(deleteError?.message || "Failed to delete company");
      setDeleting(false);
      return;
    }

    try {
      sessionStorage.removeItem(LAST_COMPANY_ID_KEY);
    } catch (err) {
      console.error("Failed to clear lastCompanyId:", err);
    }

    setDialogOpen(false);
    resetDialog();
    navigate("/");
  };

  return (
    <div className="border-t border-border px-2.5 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md border border-destructive/30 px-2.5 py-1.5 text-left text-xs text-destructive transition-colors hover:bg-destructive/10"
      >
        <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate leading-tight">Danger Zone</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform duration-200 ease-out ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="mt-1.5 ml-2 border-l border-destructive/30 pl-2">
            <button
              type="button"
              onClick={() => {
                resetDialog();
                setDialogOpen(true);
              }}
              disabled={!expectedName}
              className="flex w-full items-center rounded-md border border-destructive/30 px-2.5 py-1.5 text-left text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              Delete Company
            </button>
          </div>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent>
          {step === "confirm" ? (
            <>
              <DialogHeader>
                <DialogTitle>Delete this company?</DialogTitle>
                <DialogDescription>
                  {expectedName || "This company"} and everything stored for it
                  will be permanently deleted. This cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleDialogOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setStep("type")}
                  disabled={!expectedName}
                >
                  Continue
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Type the company name to confirm</DialogTitle>
                <DialogDescription>
                  Type{" "}
                  <span className="font-medium text-foreground">{expectedName}</span>{" "}
                  to delete this company.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="delete-company-confirm">Company name</Label>
                <Input
                  id="delete-company-confirm"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleDelete();
                    }
                  }}
                  autoComplete="off"
                  autoFocus
                  placeholder={expectedName}
                  disabled={deleting}
                />
                {error ? (
                  <p className="text-sm text-destructive">{error}</p>
                ) : null}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleDialogOpenChange(false)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={!nameMatches || deleting}
                >
                  {deleting ? "Deleting…" : "Delete Company"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function readLastCompanyId() {
  try {
    return sessionStorage.getItem(LAST_COMPANY_ID_KEY) || "";
  } catch {
    return "";
  }
}

export default function AppSidebar({ user }) {
  const { logout } = useAuth();
  const location = useLocation();
  const { companyId: routeCompanyId } = useParams();
  const [companyName, setCompanyName] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [unreadReplies, setUnreadReplies] = useState(0);

  useEffect(() => {
    if (routeCompanyId) {
      try {
        sessionStorage.setItem(LAST_COMPANY_ID_KEY, routeCompanyId);
      } catch (err) {
        console.error("Failed to persist lastCompanyId:", err);
      }
    }
  }, [routeCompanyId]);

  // On the company picker, ignore the remembered company so leftover chrome
  // (e.g. "← Rupert") does not appear before a selection is made.
  const isCompanyPicker = location.pathname === "/";
  const activeCompanyId = routeCompanyId || (isCompanyPicker ? "" : readLastCompanyId());

  const companyDataItem = {
    label: "Company Intelligence",
    path: `/company/${activeCompanyId}/company-data`,
    icon: Database,
    status: "Done",
  };

  const generationItems = [
    { label: "Pillar", path: `/company/${activeCompanyId}/pillar-automation`, icon: Layers, status: "Done" },
    { label: "Cluster", path: `/company/${activeCompanyId}/article-generation`, icon: PenLine, status: "Done" },
    { label: "Article Modify", path: `/company/${activeCompanyId}/article-modify`, icon: FileEdit, status: "Done" },
    { label: "Article Idea", path: `/company/${activeCompanyId}/article-idea`, icon: Lightbulb, status: "Done" },
  ];

  const buildNav = [
    { label: "Build Blueprint", path: `/company/${activeCompanyId}/site-build-flow`, icon: Construction, status: "Done" },
    { label: "Design", path: `/company/${activeCompanyId}/design-guide-builder`, icon: Palette, status: "Done" },
    { label: "Narrative Composer", path: `/company/${activeCompanyId}/site-content-builder`, icon: LayoutTemplate, status: "Done" },
  ];

  const tbcNav = [
    { label: "Advisor", path: `/company/${activeCompanyId}/seo-ai-advisor`, icon: MessageSquareText, status: "Done" },
    { label: "Image Generation", path: `/company/${activeCompanyId}/image-generator`, icon: Sparkles, status: "Done" },
    { label: "Cluster Image..", path: `/company/${activeCompanyId}/cluster-image-generator`, icon: Image, status: "Done" },
  ];

  const adminItems = [
    { label: "System Map", path: `/admin/system-map`, icon: Map },
    { label: "Core Version", path: `/company/${activeCompanyId}/core-version`, icon: GitBranch },
    { label: "Integrations", path: `/company/${activeCompanyId}/integrations`, icon: PlugZap },
  ];

  useEffect(() => {
    let cancelled = false;

    async function loadCompany() {
      if (!activeCompanyId) {
        setCompanyName("");
        setEmailEnabled(false);
        return;
      }

      const { data, error } = await supabase
        .from("companies")
        .select("name, email_campaigns_enabled")
        .eq("id", activeCompanyId)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error("Failed to load company:", error);
        setCompanyName("");
        setEmailEnabled(false);
        return;
      }

      setCompanyName(data?.name || "");
      setEmailEnabled(Boolean(data?.email_campaigns_enabled));
    }

    loadCompany();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId]);

  // Unread campaign replies → badge on the Email Campaigns nav item.
  useEffect(() => {
    if (!activeCompanyId || !emailEnabled) {
      setUnreadReplies(0);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const { count, error } = await supabase
        .from("email_replies")
        .select("id", { count: "exact", head: true })
        .eq("company_id", activeCompanyId)
        .is("read_at", null);
      if (!cancelled && !error) setUnreadReplies(count || 0);
    };
    load();
    const timer = setInterval(load, 60000);
    window.addEventListener("email-replies-read", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("email-replies-read", load);
    };
  }, [activeCompanyId, emailEnabled]);

  const handleLogout = () => {
    logout("/login");
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-52 bg-card border-r border-border flex flex-col z-40">
      {/* Logo + company return */}
      <div className="flex items-center gap-2 px-2.5 pt-3 pb-2">
        <Link
          to="/"
          title="The Night Ventures"
          className="h-7 w-7 shrink-0 rounded-md bg-primary flex items-center justify-center"
        >
          <span className="text-primary-foreground font-display text-xs">N</span>
        </Link>
        {activeCompanyId && (
          <Link
            to="/"
            title="Back to companies"
            className="h-7 min-w-0 flex-1 flex items-center gap-1.5 rounded-md border border-border px-2 text-xs text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="w-3 h-3 shrink-0" />
            <span className="truncate">{companyName || "Loading…"}</span>
          </Link>
        )}
        <Link
          to="/admin"
          title="Workspace Admin"
          className="ml-auto h-7 w-7 shrink-0 rounded-md border border-border flex items-center justify-center text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        >
          <Settings className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2.5 pb-3">
        {activeCompanyId && (
          <>
            <div className="space-y-1.5 pt-1">
              <NavItem item={companyDataItem} />
            </div>

            <SectionRule />
            <SectionHeader label="Build" />
            <div className="space-y-1.5">
              {buildNav.map((item) => (
                <NavItem key={item.path} item={item} />
              ))}
              <NavDropdown label="Generation" icon={Layers} items={generationItems} />
            </div>

            <SectionRule />
            <SectionHeader label="Ongoing" />
            <div className="space-y-1.5">
              <NavItem
                item={{
                  label: "Articles",
                  path: `/company/${activeCompanyId}/articles`,
                  icon: BookOpen,
                  status: "Done",
                }}
              />
              <NavItem
                item={{
                  label: "Analytics",
                  path: `/company/${activeCompanyId}/analytics`,
                  icon: ChartLine,
                }}
              />
              <NavDropdown label="Generation" icon={Layers} items={generationItems} />
              <NavItem
                item={{
                  label: "Audit",
                  path: `/company/${activeCompanyId}/audit`,
                  icon: ClipboardCheck,
                  status: "Partial",
                }}
              />
              {emailEnabled && (
                <NavItem
                  item={{
                    label: "Email Campaigns",
                    path: `/company/${activeCompanyId}/email-campaigns`,
                    icon: Mail,
                    count: unreadReplies,
                  }}
                />
              )}
            </div>

            <SectionRule />
            <SectionHeader label="TBC" />
            <div className="space-y-1.5">
              {tbcNav.map((item) => (
                <NavItem key={item.path} item={item} />
              ))}
            </div>

            <SectionRule />
            <SectionHeader label="Admin" />
            <div className="space-y-1.5">
              <NavDropdown label="Admin" icon={Map} items={adminItems} />
            </div>
          </>
        )}
      </nav>

      {activeCompanyId ? (
        <DangerZone companyId={activeCompanyId} companyName={companyName} />
      ) : null}

      {/* Footer */}
      <div className="border-t border-border px-3 py-2.5">
        <p className="text-xs text-foreground truncate">{user?.full_name || "User"}</p>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 mt-1 text-xs text-foreground/80 hover:text-foreground transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          Log Out
        </button>
      </div>
    </aside>
  );
}
