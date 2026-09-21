import React from "react";
import { Link } from "react-router-dom";
import { Map, GitBranch, PlugZap } from "lucide-react";

// Same key the sidebar uses to remember the last-opened company.
const LAST_COMPANY_ID_KEY = "lastCompanyId";
function lastCompanyId() {
  try {
    return sessionStorage.getItem(LAST_COMPANY_ID_KEY) || "";
  } catch {
    return "";
  }
}

export default function GlobalAdmin() {
  const cid = lastCompanyId();

  // System Map is fully global now. Core Version and Integrations still need a
  // company (per-project data), so for now they open the last-used company —
  // they move fully global in the next steps.
  const tiles = [
    {
      label: "System Map",
      desc: "Live map of pages, APIs, and destination-site wiring.",
      to: "/admin/system-map",
      icon: Map,
    },
    {
      label: "Core Version",
      desc: cid
        ? "Manage each project's seo-core version."
        : "Open a company first to manage versions.",
      to: cid ? `/company/${cid}/core-version` : null,
      icon: GitBranch,
    },
    {
      label: "Integrations",
      desc: cid
        ? "API keys and connection status."
        : "Open a company first to view integrations.",
      to: cid ? `/company/${cid}/integrations` : null,
      icon: PlugZap,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl px-1 pb-16 pt-2">
      <header className="mb-6">
        <h1 className="mb-1 text-xs text-foreground">Workspace Admin</h1>
        <p className="text-sm text-muted-foreground">
          Universal tools that apply across every company.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => {
          const Icon = t.icon;
          const inner = (
            <>
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">
                  {t.label}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{t.desc}</p>
            </>
          );
          return t.to ? (
            <Link
              key={t.label}
              to={t.to}
              className="rounded-lg border border-border bg-card/40 p-4 transition-colors hover:bg-accent/40"
            >
              {inner}
            </Link>
          ) : (
            <div
              key={t.label}
              className="rounded-lg border border-dashed border-border bg-card/20 p-4 opacity-60"
            >
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
