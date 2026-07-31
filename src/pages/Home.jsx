import React from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

export default function Home() {
  const { user } = useAuth();
  const { companyId } = useParams();

  return (
    <div>
      <h1 className="text-[15px] text-foreground mb-2">
        Welcome back{user?.full_name ? `, ${user.full_name}` : ""}
      </h1>
      <p className="text-muted-foreground">
        Here's what's happening at The Night Ventures today.
      </p>
      {companyId && (
        <p className="mt-4 text-sm text-muted-foreground">
          Active company id:{" "}
          <span className="font-mono text-foreground">{companyId}</span>
        </p>
      )}
    </div>
  );
}
