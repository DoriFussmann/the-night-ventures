import Anthropic from "@anthropic-ai/sdk";
import { buildCompanyDataAllocatePrompt } from "../src/pages/tools/companyData/llmUploadPrompt.js";

export const config = {
  maxDuration: 120,
};

const MODEL = "claude-sonnet-4-6";
const MAX_SOURCE_CHARS = 120000;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
}

function asStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function unwrapMarkdown(text) {
  let cleaned = String(text || "").trim();
  cleaned = cleaned.replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return cleaned;
}

function textFromMessage(message) {
  const textBlock = Array.isArray(message?.content)
    ? message.content.find((block) => block?.type === "text")
    : null;
  return String(textBlock?.text || "").trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = parseBody(req);
  } catch {
    return json(res, 400, { error: "Invalid JSON body" });
  }

  const source = String(body.markdown || "").replace(/\r\n/g, "\n").trim();
  if (!source) {
    return json(res, 400, { error: "markdown is required" });
  }
  if (source.length > MAX_SOURCE_CHARS) {
    return json(res, 400, {
      error: `Markdown is too large (max ${MAX_SOURCE_CHARS.toLocaleString()} characters)`,
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Missing ANTHROPIC_API_KEY");
    return json(res, 500, { error: "Server is missing ANTHROPIC_API_KEY" });
  }

  const companyName = String(body.companyName || "").trim();
  const customFieldNames = asStringList(body.customFieldNames);
  const industryNames = asStringList(body.industryNames);
  const emptyFieldLabels = asStringList(body.emptyFieldLabels);
  const prompt = buildCompanyDataAllocatePrompt({
    companyName,
    customFieldNames,
    industryNames,
    emptyFieldLabels,
  });

  try {
    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      temperature: 0.2,
      system: prompt,
      messages: [
        {
          role: "user",
          content: `SOURCE MARKDOWN\n\n${source}`,
        },
      ],
    });

    if (message?.stop_reason === "max_tokens") {
      console.error("company-data-import truncated at max_tokens");
      return json(res, 502, {
        error: "Model response was truncated. Try a shorter markdown file.",
      });
    }

    const markdown = unwrapMarkdown(textFromMessage(message));
    if (!markdown) {
      return json(res, 502, { error: "No markdown returned from the model" });
    }

    return json(res, 200, { markdown });
  } catch (err) {
    console.error("company-data-import failed:", err);
    return json(res, 502, {
      error: err?.message || "Failed to allocate company fields",
    });
  }
}
