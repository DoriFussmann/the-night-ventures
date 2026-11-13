// The page's code lives inside HTML and browser scripts. These helpers cut out the pure functions so Node can run them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const fixture = (name) => fs.readFileSync(path.join(ROOT, "tests/fixtures", name), "utf8");
const lines = (f) => fs.readFileSync(path.join(ROOT, "src", f), "utf8").split("\n");
const at = (L, start) => { const i = L.findIndex((l) => l.startsWith(start)); if (i < 0) throw new Error("marker not found: " + start); return i; };

/** The ICP tool's import code with a fresh, empty state. */
export function icpImport() {
  const L = lines("icp-builder.html");
  const src = L.slice(at(L, "const SECTIONS = ["), at(L, "const esc =") + 1).join("\n") + "\n" + L[at(L, "const cell")] + "\n" +
    L.slice(at(L, "const LOOKUP"), at(L, "function readFile")).join("\n") +
    "\nfunction renderForm(){} function renderUpload(){} function save(){}\nreturn {importMarkdown,state,SECTIONS};";
  const el = () => ({ textContent: "", style: {}, className: "", hidden: false });
  const m = new Function("document", "localStorage", src)({ getElementById: () => el() }, { setItem() {}, getItem() { return null; } });
  m.field = (label) => { for (const s of m.SECTIONS) { const i = s.f.findIndex((f) => f[0] === label); if (i >= 0) return m.state.vals[s.n + "." + (i + 1)] || ""; } throw new Error("no field " + label); };
  return m;
}

/** The Prompt Builder's parsing, clean-up, brand merge, mix and trim code. `icps` stands in for the saved ICPs. */
export function prompts(icps = []) {
  const L = lines("prompts.js");
  const src = "let S={}; const ICPStore={list:()=>icps};\n" + L[at(L, "const STAGES")] + "\n" +
    L.slice(at(L, "const splitRow"), at(L, "function parsePersona")).join("\n") + "\n" +
    L[at(L, "const hasTerm")] + "\n" + L[at(L, "const listOf")] + "\n" +
    L.slice(at(L, "const dom="), at(L, '$("push").onclick')).join("\n") + "\n" +
    L.slice(at(L, "/* ---------- Persona mix"), at(L, "const rot=")).join("\n") + "\n" +
    L[at(L, "const words=")] + "\n" + L.slice(at(L, "const STYLE_MAX"), at(L, "function existingAll")).join("\n") +
    "\nreturn {parseIcp,splitNames,splitValues,cleanNames,cleanVariables,mergeBrands,ensureMix,applyMix,trimPlan,ensureStyles,styleList,styleBlock,styleNote,cellTargets,haveMap,live,set:x=>{S=x},get:()=>S};";
  return new Function("icps", src)(icps);
}
