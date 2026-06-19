import React, { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import AppSidebar from "@/components/AppSidebar";

export default function AppShell() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const isImpersonating = false; // placeholder for impersonation logic

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar user={user} />

      <main className="ml-64">
        {isImpersonating && (
          <div className="bg-primary/10 border-b border-primary/20 px-6 py-2 text-sm text-primary font-medium flex items-center justify-between">
            <span>You are impersonating another user</span>
            <button className="text-primary underline text-xs">Stop Impersonating</button>
          </div>
        )}
        <div className="p-6 lg:p-8 max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}