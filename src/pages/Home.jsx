import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";

export default function Home() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="text-3xl font-display font-medium text-foreground mb-2">
        Welcome back{user?.full_name ? `, ${user.full_name}` : ""}
      </h1>
      <p className="text-muted-foreground">
        Here's what's happening at The Night Ventures today.
      </p>
    </div>
  );
}