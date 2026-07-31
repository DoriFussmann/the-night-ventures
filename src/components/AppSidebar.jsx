import React, { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  Database,
  Share2,
  ListTodo,
  TrendingUp,
  Search,
  Palette,
  Layers,
  Wand2,
  Lightbulb,
  PenLine,
  LogOut,
  ArrowLeft,
} from "lucide-react";

function NavItem({ item }) {
  const location = useLocation();
  const isActive = location.pathname === item.path;
  const Icon = item.icon;

  return (
    <Link
      to={item.path}
      className={`w-full flex items-start gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
        isActive
          ? "border-border bg-accent text-foreground"
          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      <Icon className="w-4 h-4 shrink-0 mt-0.5" />
      <span className="leading-snug">{item.label}</span>
    </Link>
  );
}

function SectionHeader({ label }) {
  return (
    <p className="px-3 pt-5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
      {label}
    </p>
  );
}

export default function AppSidebar({ user }) {
  const { logout } = useAuth();
  const { companyId } = useParams();
  const [companyName, setCompanyName] = useState("");

  const companyNav = [
    { label: "Company Data", path: `/company/${companyId}/company-data`, icon: Database },
    { label: "Social Media & Shop Tracker", path: `/company/${companyId}/social-media-tracker`, icon: Share2 },
    { label: "Website Build Tasks Tracker", path: `/company/${companyId}/website-build-tracker`, icon: ListTodo },
    { label: "Business Development Initiatives Tracker", path: `/company/${companyId}/business-dev-tracker`, icon: TrendingUp },
  ];

  const seoNav = [
    { label: "Prompt: SEO/AI-Search-First Site + CMS Template + Test Checklist", path: `/company/${companyId}/seo-site-prompt`, icon: Search },
    { label: "Design Guide Builder", path: `/company/${companyId}/design-guide-builder`, icon: Palette },
    { label: "Design Layer Prompt", path: `/company/${companyId}/design-layer-prompt`, icon: Layers },
    { label: "Template to Specific Prompt", path: `/company/${companyId}/template-to-prompt`, icon: Wand2 },
    { label: "Article Topic Suggestion Tool", path: `/company/${companyId}/article-topic-suggestion`, icon: Lightbulb },
    { label: "SEO Optimized Article Generation Tool", path: `/company/${companyId}/article-generation`, icon: PenLine },
  ];

  useEffect(() => {
    let cancelled = false;

    async function loadCompany() {
      if (!companyId) {
        setCompanyName("");
        return;
      }

      const { data, error } = await supabase
        .from("companies")
        .select("name")
        .eq("id", companyId)
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
  }, [companyId]);

  const handleLogout = () => {
    logout("/login");
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-52 bg-card border-r border-border flex flex-col z-40">
      {/* Logo */}
      <div className="px-5 py-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-display text-sm">N</span>
          </div>
          <span className="font-display text-foreground text-lg">The Night Ventures</span>
        </div>
        {companyId && (
          <Link
            to="/"
            title="Back to companies"
            className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground truncate transition-colors hover:text-foreground"
          >
            <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{companyName || "Loading company..."}</span>
          </Link>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {companyId && (
          <>
            <SectionHeader label="Company" />
            <div className="space-y-3">
              {companyNav.map((item) => (
                <NavItem key={item.path} item={item} />
              ))}
            </div>

            <SectionHeader label="SEO Tools" />
            <div className="space-y-3">
              {seoNav.map((item) => (
                <NavItem key={item.path} item={item} />
              ))}
            </div>
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-border px-5 py-4">
        <p className="text-sm text-foreground truncate">{user?.full_name || "User"}</p>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 mt-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Log Out
        </button>
      </div>
    </aside>
  );
}
