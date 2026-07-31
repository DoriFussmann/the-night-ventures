import React from "react";
import { useAuth } from "@/lib/AuthContext";

export default function Home() {
  const { user } = useAuth();

  return (
    <div>
      <h1 className="text-[15px] text-foreground mb-2">
        Welcome back{user?.full_name ? `, ${user.full_name}` : ""}
      </h1>
      <p className="text-muted-foreground">
        Here's what's happening at The Night Ventures today.
      </p>
    </div>
  );
}
