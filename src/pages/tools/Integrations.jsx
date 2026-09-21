import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  listIntegrations,
  testIntegration,
} from "./integrations/api";

function StatusBadge({ item, result }) {
  if (item.notWired) {
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground">
        Not wired
      </Badge>
    );
  }
  if (result) {
    return result.ok ? (
      <Badge className="border-transparent bg-emerald-500/15 text-emerald-800 hover:bg-emerald-500/15">
        OK
      </Badge>
    ) : (
      <Badge variant="destructive">Failed</Badge>
    );
  }
  if (item.configured) {
    return (
      <Badge className="border-transparent bg-emerald-500/15 text-emerald-800 hover:bg-emerald-500/15">
        Configured
      </Badge>
    );
  }
  return (
    <Badge className="border-transparent bg-amber-500/15 text-amber-800 hover:bg-amber-500/15">
      Missing
    </Badge>
  );
}

export default function Integrations() {
  const { companyId } = useParams();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [results, setResults] = useState({});
  const [testing, setTesting] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listIntegrations(companyId);
      setRows(Array.isArray(data.integrations) ? data.integrations : []);
    } catch (err) {
      setError(err?.message || "Failed to load integrations");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const onTest = async (id) => {
    setTesting(id);
    try {
      const data = await testIntegration(companyId, id);
      setResults((prev) => ({ ...prev, [id]: data }));
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [id]: { ok: false, detail: err?.message || "Test failed" },
      }));
    } finally {
      setTesting("");
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          External services TNV talks to. Status is whether the env key is
          present. Test runs a cheap ping — it does not generate content or
          publish anything.
        </p>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <ul className="divide-y divide-border">
            {rows.map((item) => {
              const result = results[item.id];
              const busy = testing === item.id;
              return (
                <li
                  key={item.id}
                  className="flex flex-wrap items-start gap-3 bg-card/40 px-4 py-3"
                >
                  <PlugZap className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{item.name}</p>
                      <StatusBadge item={item} result={result} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {item.operates}
                    </p>
                    {item.detail && !result ? (
                      <p className="text-[11px] text-muted-foreground/80">
                        {item.detail}
                      </p>
                    ) : null}
                    {result?.detail ? (
                      <p
                        className={`text-[11px] ${
                          result.ok ? "text-emerald-800" : "text-destructive"
                        }`}
                      >
                        {result.detail}
                        {result.ms != null ? ` · ${result.ms}ms` : ""}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || item.notWired || !item.testable}
                    onClick={() => onTest(item.id)}
                  >
                    {busy ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Testing…
                      </>
                    ) : (
                      "Test"
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
