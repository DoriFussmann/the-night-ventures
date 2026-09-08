import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
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
import {
  Database,
  BarChart3,
  ListTodo,
  FileText,
  Palette,
  Wand2,
  LayoutTemplate,
  Lightbulb,
  PenLine,
  BookOpen,
  RefreshCw,
  Image,
  Sparkles,
  MessageSquareText,
  Camera,
  Workflow,
  Layers,
  LogOut,
  ArrowLeft,
  Construction,
  ChevronUp,
  Moon,
  Loader2,
  Trash2,
} from "lucide-react";

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
      <span className="leading-tight">{item.label}</span>
    </Link>
  );
}

function SectionHeader({ label }) {
  return (
    <p className="px-2.5 pt-3 pb-0.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">
      {label}
    </p>
  );
}

const LAST_COMPANY_ID_KEY = "lastCompanyId";

function namesMatch(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function clearCompanyLocalState(companyId) {
  try {
    sessionStorage.removeItem(LAST_COMPANY_ID_KEY);
  } catch {
    // ignore
  }
  if (!companyId) return;
  try {
    localStorage.removeItem(`tnv-ai-image-prompts:${companyId}`);
    localStorage.removeItem(`cluster-image-spec:${companyId}`);
  } catch {
    // ignore
  }
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
  const navigate = useNavigate();
  const { companyId: routeCompanyId } = useParams();
  const [companyName, setCompanyName] = useState("");
  const [dangerOpen, setDangerOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

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
  const siteBuildFlowPath = activeCompanyId
    ? `/company/${activeCompanyId}/site-build-flow`
    : "";
  const isSiteBuildFlowActive = location.pathname === siteBuildFlowPath;

  const companyNav = [
    { label: "Company Data", path: `/company/${activeCompanyId}/company-data`, icon: Database },
    { label: "Analytics", path: `/company/${activeCompanyId}/analytics`, icon: BarChart3 },
    { label: "Tasks", path: `/company/${activeCompanyId}/tasks`, icon: ListTodo },
  ];

  const seoNav = [
    { label: "The Nightwatch", path: `/company/${activeCompanyId}/nightwatch`, icon: Moon },
    { type: "separator" },
    { label: "SEO AI Advisor", path: `/company/${activeCompanyId}/seo-ai-advisor`, icon: MessageSquareText },
    { label: "Technical Audit", path: `/company/${activeCompanyId}/external-audit-snapshot`, icon: Camera },
  ];

  const manualTools = [
    { label: "Topic Generator", path: `/company/${activeCompanyId}/article-topic-suggestion`, icon: Lightbulb },
    { label: "Article Generator", path: `/company/${activeCompanyId}/article-generation`, icon: PenLine },
    { label: "Pillar Automation", path: `/company/${activeCompanyId}/pillar-automation`, icon: Layers },
    { label: "Articles Automation", path: `/company/${activeCompanyId}/articles-automation`, icon: Workflow },
    { label: "Articles", path: `/company/${activeCompanyId}/articles`, icon: BookOpen },
    { label: "Articles Update", path: `/company/${activeCompanyId}/articles-update`, icon: RefreshCw },
  ];
  const isManualToolActive = manualTools.some((item) => location.pathname === item.path);

  const designTools = [
    { label: "Design Builder", path: `/company/${activeCompanyId}/design-guide-builder`, icon: Palette },
    { label: "Image Generator", path: `/company/${activeCompanyId}/image-generator`, icon: Sparkles },
  ];
  const isDesignToolActive = designTools.some((item) => location.pathname === item.path);

  const additionalTools = [
    { label: "Initial Site Build Prompt", path: `/company/${activeCompanyId}/initial-site-build-prompt`, icon: FileText },
    { label: "Specific Prompt", path: `/company/${activeCompanyId}/template-to-prompt`, icon: Wand2 },
    { label: "Cluster Images", path: `/company/${activeCompanyId}/cluster-image-generator`, icon: Image },
    { label: "Site Content Build", path: `/company/${activeCompanyId}/site-content-build`, icon: LayoutTemplate },
  ];
  const isAdditionalToolActive = additionalTools.some((item) => location.pathname === item.path);
  useEffect(() => {
    let cancelled = false;

    async function loadCompany() {
      if (!activeCompanyId) {
        setCompanyName("");
        return;
      }

      const { data, error } = await supabase
        .from("companies")
        .select("name")
        .eq("id", activeCompanyId)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error("Failed to load company:", error);
        setCompanyName("");
        return;
      }

      setCompanyName(data?.name || "");
    }

    loadCompany();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId]);

  const handleLogout = () => {
    logout("/login");
  };

  const canConfirmDelete = namesMatch(confirmText, companyName) && Boolean(companyName.trim());

  const handleDangerOpenChange = (open) => {
    if (deleting) return;
    setDangerOpen(open);
    if (!open) {
      setConfirmText("");
      setDeleteError("");
    }
  };

  const handleDeleteCompany = async () => {
    if (!activeCompanyId || !canConfirmDelete || deleting) return;

    setDeleting(true);
    setDeleteError("");

    const { error } = await supabase
      .from("companies")
      .delete()
      .eq("id", activeCompanyId);

    if (error) {
      console.error("Failed to delete company:", error);
      setDeleteError(error.message || "Failed to delete company");
      setDeleting(false);
      return;
    }

    clearCompanyLocalState(activeCompanyId);
    setDeleting(false);
    setDangerOpen(false);
    setConfirmText("");
    navigate("/");
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
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2.5 pb-3">
        {activeCompanyId && (
          <>
            <SectionHeader label="Company" />
            <div className="space-y-1.5">
              {companyNav.map((item) => (
                <NavItem key={item.path} item={item} />
              ))}
            </div>

            <SectionHeader label="SEO Tools" />
            <div className="space-y-1.5">
              {seoNav.map((item, index) =>
                item.type === "separator" ? (
                  <div key={`seo-sep-${index}`} className="my-1 border-t border-border" />
                ) : (
                  <NavItem key={item.path} item={item} />
                )
              )}
            </div>
          </>
        )}
      </nav>

      {activeCompanyId && (
        <div className="border-t border-border px-2.5 py-2 space-y-1.5">
          <Link
            to={siteBuildFlowPath}
            className={`w-full flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${
              isSiteBuildFlowActive
                ? "border-border bg-accent text-foreground"
                : "border-border text-foreground/80 hover:bg-accent hover:text-foreground"
            }`}
          >
            <Construction className="w-3.5 h-3.5 shrink-0" />
            <span className="leading-tight">Site Build Flow</span>
          </Link>

          <div className="group relative">
            <button
              type="button"
              className={`w-full flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${
                isManualToolActive
                  ? "border-border bg-accent text-foreground"
                  : "border-border text-foreground/80 group-hover:bg-accent group-hover:text-foreground"
              }`}
            >
              <ChevronUp className="w-3.5 h-3.5 shrink-0 transition-transform group-hover:rotate-180" />
              <span className="leading-tight">Manual Tools</span>
            </button>
            <div className="pointer-events-none absolute bottom-full left-0 right-0 z-50 pb-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
              <div className="rounded-md border border-border bg-card p-1 shadow-md">
                {manualTools.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                        isActive
                          ? "bg-accent text-foreground"
                          : "text-foreground/80 hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="leading-tight">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="group relative">
            <button
              type="button"
              className={`w-full flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${
                isDesignToolActive
                  ? "border-border bg-accent text-foreground"
                  : "border-border text-foreground/80 group-hover:bg-accent group-hover:text-foreground"
              }`}
            >
              <ChevronUp className="w-3.5 h-3.5 shrink-0 transition-transform group-hover:rotate-180" />
              <span className="leading-tight">Design Tools</span>
            </button>
            <div className="pointer-events-none absolute bottom-full left-0 right-0 z-50 pb-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
              <div className="rounded-md border border-border bg-card p-1 shadow-md">
                {designTools.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                        isActive
                          ? "bg-accent text-foreground"
                          : "text-foreground/80 hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="leading-tight">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="group relative">
            <button
              type="button"
              className={`w-full flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${
                isAdditionalToolActive
                  ? "border-border bg-accent text-foreground"
                  : "border-border text-foreground/80 group-hover:bg-accent group-hover:text-foreground"
              }`}
            >
              <ChevronUp className="w-3.5 h-3.5 shrink-0 transition-transform group-hover:rotate-180" />
              <span className="leading-tight">Additional Tools</span>
            </button>
            <div className="pointer-events-none absolute bottom-full left-0 right-0 z-50 pb-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
              <div className="rounded-md border border-border bg-card p-1 shadow-md">
                {additionalTools.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                        isActive
                          ? "bg-accent text-foreground"
                          : "text-foreground/80 hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="leading-tight">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeCompanyId && (
        <div className="border-t border-border px-2.5 py-2">
          <p className="px-2.5 pb-1.5 text-[9px] font-semibold uppercase tracking-widest text-destructive/70">
            Danger Zone
          </p>
          <button
            type="button"
            onClick={() => handleDangerOpenChange(true)}
            disabled={!companyName.trim()}
            className="w-full flex items-center gap-2 rounded-md border border-destructive/30 px-2.5 py-1.5 text-left text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0" />
            <span className="leading-tight">Remove company</span>
          </button>
        </div>
      )}

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

      <Dialog open={dangerOpen} onOpenChange={handleDangerOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this company?</DialogTitle>
            <DialogDescription>
              This permanently deletes {companyName || "this company"} and all of
              its data. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirm-company-delete">
              Type <span className="font-medium text-foreground">{companyName}</span>{" "}
              to confirm
            </Label>
            <Input
              id="confirm-company-delete"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={companyName}
              autoComplete="off"
              disabled={deleting}
            />
          </div>
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleDangerOpenChange(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteCompany}
              disabled={!canConfirmDelete || deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Removing…
                </>
              ) : (
                "Remove company"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
