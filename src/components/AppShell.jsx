import React from "react";
import { Outlet } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import AppSidebar from "@/components/AppSidebar";

export default function AppShell() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar user={user} />

      <main className="ml-52 scroll-thin">
        <div className="px-8 py-6 max-w-3xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
