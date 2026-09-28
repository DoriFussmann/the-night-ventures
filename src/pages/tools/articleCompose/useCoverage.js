import { useEffect, useState } from "react";
import { loadAutomationContext } from "../articlesAutomation/planCluster";

export function useCoverage(companyId) {
  const [pillars, setPillars] = useState([]);
  const [loading, setLoading] = useState(Boolean(companyId));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!companyId) {
      setPillars([]);
      setLoading(false);
      setError("");
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    loadAutomationContext(companyId)
      .then((ctx) => {
        if (cancelled) return;
        setPillars(Array.isArray(ctx.pillars) ? ctx.pillars : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setPillars([]);
        setError(err?.message || "Failed to load content coverage");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  return { pillars, loading, error };
}
