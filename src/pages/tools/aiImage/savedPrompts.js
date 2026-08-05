const STORAGE_PREFIX = "tnv-ai-image-prompts:";

function storageKey(companyId) {
  return `${STORAGE_PREFIX}${companyId}`;
}

export function loadSavedPrompts(companyId) {
  if (!companyId) return [];
  try {
    const raw = localStorage.getItem(storageKey(companyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object" && item.prompt)
      .map((item) => ({
        id: String(item.id || ""),
        prompt: String(item.prompt || ""),
        savedAt: Number(item.savedAt) || 0,
      }))
      .filter((item) => item.id && item.prompt.trim());
  } catch (err) {
    console.error("Failed to load saved image prompts:", err);
    return [];
  }
}

function writeSavedPrompts(companyId, prompts) {
  localStorage.setItem(storageKey(companyId), JSON.stringify(prompts));
}

export function savePrompt(companyId, prompt) {
  const trimmed = String(prompt || "").trim();
  if (!companyId || !trimmed) return null;

  const entry = {
    id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    prompt: trimmed,
    savedAt: Date.now(),
  };

  const existing = loadSavedPrompts(companyId);
  const next = [entry, ...existing];
  writeSavedPrompts(companyId, next);
  return entry;
}

export function deleteSavedPrompt(companyId, promptId) {
  if (!companyId || !promptId) return [];
  const next = loadSavedPrompts(companyId).filter((p) => p.id !== promptId);
  writeSavedPrompts(companyId, next);
  return next;
}
