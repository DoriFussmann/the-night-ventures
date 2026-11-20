import { supabase } from "@/lib/supabase";

const ENDPOINT = "/api/company-logins";

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function call(method, action, companyId, body = {}) {
  const url =
    method === "GET"
      ? `${ENDPOINT}?${new URLSearchParams({ action, companyId })}`
      : `${ENDPOINT}?action=${encodeURIComponent(action)}`;
  const res = await fetch(url, {
    method,
    headers: await authHeaders(),
    ...(method === "POST" ? { body: JSON.stringify({ action, companyId, ...body }) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const listLogins = (companyId) => call("GET", "list", companyId).then((d) => d.logins);
export const revealPassword = (companyId, id) => call("POST", "reveal", companyId, { id }).then((d) => d.password);
export const saveLogin = (companyId, login) => call("POST", "save", companyId, { login }).then((d) => d.login);
export const deleteLogin = (companyId, id) => call("POST", "delete", companyId, { id });
