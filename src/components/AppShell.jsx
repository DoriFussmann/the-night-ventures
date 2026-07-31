import React from "react";
import { Outlet } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import AppSidebar from "@/components/AppSidebar";

export default function AppShell() {
  const { user } = useAuth();
  const isImpersonating = false; // placeholder for impersonation logic

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar user={user} />

      <main className="ml-52 scroll-thin">
        {isImpersonating && (
          <div className="bg-primary/10 border-b border-primary/20 px-6 py-2 text-sm text-primary flex items-center justify-between">
            <span>You are impersonating another user</span>
            <button className="text-primary underline text-xs">Stop Impersonating</button>
          </div>
        )}
        <div className="px-8 py-6 max-w-3xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
