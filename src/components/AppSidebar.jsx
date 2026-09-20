import React, { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  Database,
  Palette,
  LayoutTemplate,
  PenLine,
  BookOpen,
  Image,
  Sparkles,
  MessageSquareText,
  Camera,
  Layers,
  LogOut,
  ArrowLeft,
  Construction,
  Map,
  GitBranch,
  ChevronDown,
} from "lucide-react";

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
    label: "Company Data",
    path: `/company/${activeCompanyId}/company-data`,
    icon: Database,
    status: "Done",
  };

  const generationItems = [
    { label: "Pillar", path: `/company/${activeCompanyId}/pillar-automation`, icon: Layers, status: "Done" },
    { label: "Cluster", path: `/company/${activeCompanyId}/article-generation`, icon: PenLine, status: "Done" },
  ];

  const buildNav = [
    { label: "Build Blueprint", path: `/company/${activeCompanyId}/site-build-flow`, icon: Construction, status: "Done" },
    { label: "Design Engine", path: `/company/${activeCompanyId}/design-guide-builder`, icon: Palette, status: "Done" },
    { label: "Narrative Composer", path: `/company/${activeCompanyId}/site-content-builder`, icon: LayoutTemplate, status: "Done" },
  ];

  const tbcNav = [
    { label: "Advisor", path: `/company/${activeCompanyId}/seo-ai-advisor`, icon: MessageSquareText, status: "Verify" },
    { label: "Image Generation", path: `/company/${activeCompanyId}/image-generator`, icon: Sparkles, status: "Verify" },
    { label: "Cluster Image..", path: `/company/${activeCompanyId}/cluster-image-generator`, icon: Image, status: "Verify" },
  ];

  const adminItems = [
    { label: "System Map", path: `/company/${activeCompanyId}/system-map`, icon: Map },
    { label: "Core Version", path: `/company/${activeCompanyId}/core-version`, icon: GitBranch },
  ];

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
              <NavDropdown label="Generation" icon={Layers} items={generationItems} />
              <NavItem
                item={{
                  label: "Analytics",
                  path: `/company/${activeCompanyId}/external-audit-snapshot`,
                  icon: Camera,
                  status: "Partial",
                }}
              />
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
