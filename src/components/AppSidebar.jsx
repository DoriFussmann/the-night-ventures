import React from "react";
import { Link, useLocation } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import {
  LayoutDashboard,
  Users,
  Calendar,
  BookOpen,
  MessageSquare,
  Settings,
  LogOut,
  GraduationCap,
  UserCog,
  Eye,
} from "lucide-react";

const parentNav = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard },
  { label: "My Children", path: "/children", icon: Users },
  { label: "Events", path: "/events", icon: Calendar },
  { label: "Messages", path: "/messages", icon: MessageSquare },
];

const teacherNav = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard },
  { label: "My Classes", path: "/classes", icon: BookOpen },
  { label: "Students", path: "/students", icon: Users },
  { label: "Events", path: "/events", icon: Calendar },
  { label: "Messages", path: "/messages", icon: MessageSquare },
];

const adminNav = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard },
  { label: "Classes", path: "/classes", icon: BookOpen },
  { label: "Students", path: "/students", icon: Users },
  { label: "Events", path: "/events", icon: Calendar },
  { label: "Messages", path: "/messages", icon: MessageSquare },
];

const adminExtraNav = [
  { label: "User Management", path: "/users", icon: UserCog },
  { label: "Settings", path: "/settings", icon: Settings },
];

const adminImpersonateNav = [
  { label: "Impersonate User", path: "/impersonate", icon: Eye },
];

function NavItem({ item }) {
  const location = useLocation();
  const isActive = location.pathname === item.path;
  const Icon = item.icon;

  return (
    <Link
      to={item.path}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        isActive
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {item.label}
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
  const role = user?.role || "user";
  const isAdmin = role === "admin";
  const isTeacher = role === "teacher";

  const mainNav = isAdmin ? adminNav : isTeacher ? teacherNav : parentNav;

  const handleLogout = () => {
    base44.auth.logout("/login");
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-card border-r border-border flex flex-col z-40">
      {/* Logo */}
      <div className="px-5 py-6 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
          <span className="text-primary-foreground font-display font-medium text-sm">N</span>
        </div>
        <span className="font-display font-medium text-foreground text-lg">The Night Ventures</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="space-y-1">
          {mainNav.map((item) => (
            <NavItem key={item.path} item={item} />
          ))}
        </div>

        {isAdmin && (
          <>
            <SectionHeader label="Administration" />
            <div className="space-y-1">
              {adminExtraNav.map((item) => (
                <NavItem key={item.path} item={item} />
              ))}
            </div>

            <SectionHeader label="Impersonate" />
            <div className="space-y-1">
              {adminImpersonateNav.map((item) => (
                <NavItem key={item.path} item={item} />
              ))}
            </div>
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-border px-5 py-4">
        <p className="text-sm font-medium text-foreground truncate">{user?.full_name || "User"}</p>
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