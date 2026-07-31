import React, { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  LayoutDashboard,
  LogOut,
} from "lucide-react";

function NavItem({ item }) {
  const location = useLocation();
  const isActive = location.pathname === item.path;
  const Icon = item.icon;

  return (
    <Link
      to={item.path}
      className={`w-full flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
        isActive
          ? "border-border bg-accent text-foreground"
          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {item.label}
    </Link>
  );
}

export default function AppSidebar({ user }) {
  const { logout } = useAuth();
  const { companyId } = useParams();
  const [companyName, setCompanyName] = useState("");

  const nav = [
    { label: "Dashboard", path: `/company/${companyId}/dashboard`, icon: LayoutDashboard },
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
          <p className="mt-3 text-sm text-muted-foreground truncate" title={companyName || companyId}>
            {companyName || "Loading company..."}
          </p>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="space-y-3">
          {companyId &&
            nav.map((item) => (
              <NavItem key={item.path} item={item} />
            ))}
        </div>
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
