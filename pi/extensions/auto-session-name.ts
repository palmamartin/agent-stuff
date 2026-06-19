/**
 * Auto Session Name Extension
 *
 * Names unnamed sessions in the background using a configured small LLM.
 *
 * Configure globally in ~/.pi/agent/settings.json:
 * {
 *   "autoSessionName": {
 *     "model": "anthropic/claude-haiku-4-5"
 *   }
 * }
 *
 * Or per project in .pi/settings.json:
 * {
 *   "autoSessionName": {
 *     "model": "openai/gpt-4o-mini"
 *   }
 * }
 */

import { complete } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

type AutoSessionNameSettings = {
  model?: string;
};

type RequestAuth = {
  apiKey?: string;
  headers?: Record<string, string>;
};

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type ResolvedNamingModel = {
  model: NonNullable<ReturnType<ExtensionContext["modelRegistry"]["find"]>>;
  thinkingLevel?: ThinkingLevel;
};

const SETTING_KEY = "autoSessionName";
const MAX_PROMPT_CHARS = 4000;
const MAX_TITLE_CHARS = 48;

let warnedMissingConfig = false;
let namingInFlight = false;
let active = true;
let currentController: AbortController | undefined;

export default function (pi: ExtensionAPI) {
  function startNamingInBackground(prompt: string | undefined, ctx: ExtensionContext) {
    if (!active) return;
    if (!prompt?.trim()) return;
    if (namingInFlight) return;
    if (pi.getSessionName()) return;

    namingInFlight = true;
    currentController?.abort();
    currentController = new AbortController();

    const controller = currentController;
    const removeAbortForwarder = forwardAbort(ctx.signal, controller);

    void maybeNameSession(pi, prompt, ctx, controller.signal)
      .catch((error) => {
        if (!active || controller.signal.aborted) return;
        notify(ctx, `Auto session naming failed: ${errorMessage(error)}`, "warning");
      })
      .finally(() => {
        removeAbortForwarder();
        if (currentController === controller) {
          currentController = undefined;
        }
        namingInFlight = false;
      });
  }

  // Handles resumed/reloaded sessions that already have messages but no name.
  pi.on("session_start", async (_event, ctx) => {
    active = true;
    startNamingInBackground(findFirstUserPrompt(ctx.sessionManager.getBranch()), ctx);
  });

  // Handles new sessions on first prompt, without delaying the actual user work.
  pi.on("before_agent_start", async (event, ctx) => {
    const existingPrompt = findFirstUserPrompt(ctx.sessionManager.getBranch());
    startNamingInBackground(existingPrompt ?? event.prompt, ctx);
  });

  pi.on("session_shutdown", async () => {
    active = false;
    currentController?.abort();
  });
}

async function maybeNameSession(
  pi: ExtensionAPI,
  prompt: string,
  ctx: ExtensionContext,
  signal: AbortSignal,
) {
  if (pi.getSessionName()) return;

  const settings = await loadAutoSessionNameSettings(ctx);
  if (signal.aborted) return;

  if (!settings.model) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      notify(
        ctx,
        "Auto session naming skipped: set autoSessionName.model in ~/.pi/agent/settings.json or .pi/settings.json",
        "warning",
      );
    }
    return;
  }

  const resolved = resolveConfiguredModel(settings.model, ctx);
  if (!resolved) {
    notify(ctx, `Auto session naming model not found: ${settings.model}`, "warning");
    return;
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(resolved.model);
  if (signal.aborted) return;

  if (!auth.ok) {
    notify(ctx, `Auto session naming auth failed: ${auth.error}`, "warning");
    return;
  }

  if (!auth.apiKey) {
    notify(ctx, `No API key available for auto session naming model: ${settings.model}`, "warning");
    return;
  }

  const name = await generateSessionName(prompt, resolved, auth, signal);
  if (signal.aborted) return;
  if (!name) return;

  // Important background safety check: user may have manually named it meanwhile.
  if (pi.getSessionName()) return;

  pi.setSessionName(name);
  notify(ctx, `Session named: ${name}`, "info");
}

async function loadAutoSessionNameSettings(ctx: ExtensionContext): Promise<AutoSessionNameSettings> {
  const globalPath = join(getAgentDir(), "settings.json");
  const projectPath = join(ctx.cwd, ".pi", "settings.json");

  const globalSettings = await readSettings(globalPath);
  const projectSettings = ctx.isProjectTrusted() ? await readSettings(projectPath) : undefined;

  return {
    ...readNestedSettings(globalSettings),
    ...readNestedSettings(projectSettings),
  };
}

function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

async function readSettings(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw new Error(`Could not read ${path}: ${errorMessage(error)}`);
  }
}

function readNestedSettings(settings: Record<string, unknown> | undefined): AutoSessionNameSettings {
  const value = settings?.[SETTING_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const model = (value as Record<string, unknown>).model;
  return typeof model === "string" && model.trim() ? { model: model.trim() } : {};
}

function resolveConfiguredModel(modelRef: string, ctx: ExtensionContext): ResolvedNamingModel | undefined {
  const parsed = parseModelRef(modelRef);
  if (!parsed) return undefined;

  const model = ctx.modelRegistry.find(parsed.provider, parsed.modelId);
  if (!model) return undefined;

  return { model, thinkingLevel: parsed.thinkingLevel };
}

function parseModelRef(
  modelRef: string,
): { provider: string; modelId: string; thinkingLevel?: ThinkingLevel } | undefined {
  const slash = modelRef.indexOf("/");
  if (slash <= 0 || slash === modelRef.length - 1) return undefined;

  const provider = modelRef.slice(0, slash);
  let modelId = modelRef.slice(slash + 1);
  let thinkingLevel: ThinkingLevel | undefined;

  // Support Pi-style thinking suffixes: provider/model-id:medium.
  // Only strip the suffix when it is a valid thinking level so model IDs that
  // legitimately contain colons, e.g. some Bedrock IDs ending in :0, still work.
  const colon = modelId.lastIndexOf(":");
  if (colon > 0 && colon < modelId.length - 1) {
    const suffix = modelId.slice(colon + 1);
    if (isThinkingLevel(suffix)) {
      thinkingLevel = suffix;
      modelId = modelId.slice(0, colon);
    }
  }

  return modelId ? { provider, modelId, thinkingLevel } : undefined;
}

function isThinkingLevel(value: string): value is ThinkingLevel {
  return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

async function generateSessionName(
  prompt: string,
  resolved: ResolvedNamingModel,
  auth: RequestAuth,
  signal: AbortSignal,
): Promise<string | undefined> {
  const response = await complete(
    resolved.model,
    {
      systemPrompt: "Create short coding-agent session titles. Return only the title. No quotes.",
      messages: [
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: `Create a concise session name.

Rules:
- 2 to 6 words
- max ${MAX_TITLE_CHARS} characters
- describe the task, not the conversation
- no trailing period
- return only the title

Prompt:
${prompt.slice(0, MAX_PROMPT_CHARS)}`,
            },
          ],
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      signal,
      ...(resolved.model.reasoning && resolved.thinkingLevel && resolved.thinkingLevel !== "off"
        ? { reasoning: resolved.thinkingLevel }
        : {}),
    },
  );

  if (response.stopReason === "aborted") return undefined;

  const text = response.content
    .filter((content): content is { type: "text"; text: string } => content.type === "text")
    .map((content) => content.text)
    .join(" ");

  return sanitizeTitle(text);
}

function sanitizeTitle(text: string): string | undefined {
  const title = text
    .replace(/^\s*["'`]+|["'`.]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE_CHARS)
    .replace(/\s+\S*$/, "")
    .trim();

  return title || undefined;
}

function findFirstUserPrompt(entries: readonly SessionEntry[]): string | undefined {
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    if (entry.message.role !== "user") continue;

    const text = textFromMessageContent(entry.message.content);
    if (text) return text;
  }

  return undefined;
}

function textFromMessageContent(content: unknown): string | undefined {
  if (typeof content === "string") return content.trim() || undefined;

  if (!Array.isArray(content)) return undefined;

  const text = content
    .filter((block): block is { type: "text"; text: string } => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text || undefined;
}

function forwardAbort(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) return () => {};

  if (source.aborted) {
    target.abort();
    return () => {};
  }

  const abort = () => target.abort();
  source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}

function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error") {
  if (ctx.hasUI) ctx.ui.notify(message, level);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
