import { WEB_SAFE_FONTS } from "./defaults";

const loadedFamilies = new Set();

function isWebSafe(family) {
  return WEB_SAFE_FONTS.has(String(family || "").trim().toLowerCase());
}

/**
 * Ensure a font family is available for canvas text. Loads Google Fonts when needed.
 */
export async function ensureFontLoaded(fontFamily) {
  const family = String(fontFamily || "").trim() || "Georgia";
  if (isWebSafe(family) || loadedFamilies.has(family)) {
    try {
      await document.fonts.load(`600 64px "${family}"`);
      await document.fonts.load(`400 32px "${family}"`);
    } catch {
      // ignore — canvas will fall back
    }
    return family;
  }

  const id = `cluster-image-font-${family.replace(/\s+/g, "-").toLowerCase()}`;
  if (!document.getElementById(id)) {
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
      family
    ).replace(/%20/g, "+")}:wght@400;600;700&display=swap`;
    document.head.appendChild(link);
  }

  try {
    await document.fonts.load(`600 64px "${family}"`);
    await document.fonts.load(`400 32px "${family}"`);
    loadedFamilies.add(family);
  } catch {
    // fall through — renderer still uses the family name
  }

  return family;
}
