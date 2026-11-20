import React, { useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteLogin, listLogins, revealPassword, saveLogin } from "./loginsApi";

const EMPTY = { id: null, title: "", username: "", comments: "", hasPassword: false };

function CopyButton({ label, getText, disabled }) {
  const [state, setState] = useState("idle"); // idle | busy | done | error
  const onClick = async () => {
    setState("busy");
    try {
      const text = await getText();
      await navigator.clipboard.writeText(text ?? "");
      setState("done");
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 1500);
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || state === "busy"}
      title={state === "error" ? "Copy failed. Click again." : `Copy ${label}`}
      aria-label={`Copy ${label}`}
      onClick={onClick}
    >
      {state === "busy" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : state === "done" ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

function LoginForm({ companyId, login, onSaved, onDeleted, onClose }) {
  const isNew = !login.id;
  const [draft, setDraft] = useState(login);
  const [password, setPassword] = useState(""); // plain text, only once loaded or typed
  const [pwLoaded, setPwLoaded] = useState(isNew);
  const [pwTouched, setPwTouched] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => setDraft(login), [login]);

  const dirty =
    isNew ||
    pwTouched ||
    draft.title !== login.title ||
    draft.username !== login.username ||
    draft.comments !== login.comments;

  const loadPassword = async () => {
    if (pwLoaded) return password;
    const pw = login.hasPassword ? await revealPassword(companyId, login.id) : "";
    setPassword(pw);
    setPwLoaded(true);
    return pw;
  };

  const toggleShow = async () => {
    if (show) return setShow(false);
    setNote("");
    try {
      setBusy("reveal");
      await loadPassword();
      setShow(true);
    } catch (err) {
      setNote(err?.message || "Could not load the password");
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    if (!draft.title.trim()) return setNote("Title is required");
    setBusy("save");
    setNote("");
    try {
      const payload = { id: login.id, title: draft.title, username: draft.username, comments: draft.comments };
      if (pwTouched) payload.password = password;
      const saved = await saveLogin(companyId, payload);
      setPwTouched(false);
      onSaved(saved, login.id);
    } catch (err) {
      setNote(err?.message || "Save failed");
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    if (isNew) return onClose();
    if (!window.confirm(`Delete the login "${login.title}"? This cannot be undone.`)) return;
    setBusy("delete");
    try {
      await deleteLogin(companyId, login.id);
      onDeleted(login.id);
    } catch (err) {
      setNote(err?.message || "Delete failed");
      setBusy("");
    }
  };

  const pwPlaceholder = !pwLoaded && login.hasPassword ? "••••••••  (saved)" : "Password";

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Input
          className="font-medium"
          value={draft.title}
          placeholder="Title, e.g. Etsy"
          autoFocus={isNew}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <Button type="button" variant="ghost" size="sm" aria-label="Delete login" disabled={Boolean(busy)} onClick={remove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground">Username</span>
          <div className="flex gap-2">
            <Input
              value={draft.username}
              autoComplete="off"
              onChange={(e) => setDraft({ ...draft, username: e.target.value })}
            />
            <CopyButton label="username" disabled={!draft.username} getText={() => draft.username} />
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground">Password</span>
          <div className="flex gap-2">
            <Input
              type={show ? "text" : "password"}
              value={password}
              placeholder={pwPlaceholder}
              autoComplete="new-password"
              onChange={(e) => {
                setPassword(e.target.value);
                setPwLoaded(true);
                setPwTouched(true);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={show ? "Hide password" : "Show password"}
              title={show ? "Hide" : "Show"}
              disabled={busy === "reveal" || (!login.hasPassword && !pwLoaded)}
              onClick={toggleShow}
            >
              {busy === "reveal" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : show ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </Button>
            <CopyButton
              label="password"
              disabled={pwLoaded ? !password : !login.hasPassword}
              getText={loadPassword}
            />
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground">Comments</span>
          <Textarea rows={2} value={draft.comments} onChange={(e) => setDraft({ ...draft, comments: e.target.value })} />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="button" size="sm" onClick={save} disabled={!dirty || Boolean(busy)}>
          {busy === "save" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          {isNew ? "Save login" : "Save changes"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {dirty && !isNew ? "Cancel" : "Close"}
        </Button>
        {note ? <span className="text-xs text-destructive">{note}</span> : null}
      </div>
    </div>
  );
}

export default function LoginsTab({ companyId }) {
  const [logins, setLogins] = useState(null);
  const [open, setOpen] = useState(null); // null | "new" | login id
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setLogins(null);
    setOpen(null);
    setError("");
    listLogins(companyId)
      .then((rows) => live && setLogins(rows))
      .catch((err) => {
        if (!live) return;
        setLogins([]);
        setError(
          /company_logins/.test(err?.message || "")
            ? `${err.message}. Run migration 085_company_logins.sql in Supabase first.`
            : err?.message || "Failed to load logins"
        );
      });
    return () => {
      live = false;
    };
  }, [companyId]);

  const current = open === "new" ? EMPTY : logins?.find((l) => l.id === open) || null;
  const close = () => setOpen(null);

  const onSaved = (saved, prevId) => {
    setLogins((rows) => (prevId ? rows.map((r) => (r.id === saved.id ? saved : r)) : [...rows, saved]));
    close();
  };

  return (
    <div className="space-y-4 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Logins for this company&apos;s accounts. Click one to see, copy or edit it. Passwords are stored encrypted
          and are not included in any download or export.
        </p>
        <Button type="button" size="sm" disabled={logins === null} onClick={() => setOpen("new")}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add login
        </Button>
      </div>
      {error ? (
        <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}
      {logins === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : logins.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">No logins yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {logins.map((login) => (
            <button
              key={login.id}
              type="button"
              onClick={() => setOpen(login.id)}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{login.title}</span>
            </button>
          ))}
        </div>
      )}
      <Dialog open={Boolean(current)} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{open === "new" ? "New login" : current?.title}</DialogTitle>
            <DialogDescription className="sr-only">Login details</DialogDescription>
          </DialogHeader>
          {current ? (
            <LoginForm
              key={open}
              companyId={companyId}
              login={current}
              onSaved={onSaved}
              onDeleted={(id) => {
                setLogins((rows) => rows.filter((r) => r.id !== id));
                close();
              }}
              onClose={close}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
