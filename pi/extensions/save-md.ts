import { mkdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";

type TextBlock = { type?: string; text?: string };
type AssistantEntry = SessionEntry & {
  type: "message";
  message: {
    role: "assistant";
    content?: unknown;
    timestamp?: number;
  };
};

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter((part): part is TextBlock => {
      if (!part || typeof part !== "object") return false;
      const block = part as TextBlock;
      return block.type === "text" && typeof block.text === "string";
    })
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

function getLastAssistantText(branch: SessionEntry[]): { text: string; timestamp?: number } | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "message") continue;

    const message = entry.message;
    if (message.role !== "assistant") continue;

    const assistant = entry as AssistantEntry;
    const text = extractText(assistant.message.content);
    if (text) {
      return { text, timestamp: assistant.message.timestamp };
    }
  }
}

function stripMatchingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith(`~${path.sep}`)) return path.join(os.homedir(), value.slice(2));
  return value;
}

function defaultFilename(timestamp?: number): string {
  const date = new Date(timestamp ?? Date.now());
  const stamp = date.toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
  return `agent-message-${stamp}.md`;
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

async function resolveTargetPath(rawArgs: string, cwd: string, timestamp?: number): Promise<string> {
  const fallbackName = defaultFilename(timestamp);
  let target = stripMatchingQuotes(rawArgs);

  if (!target) {
    target = fallbackName;
  } else if (target.startsWith("@")) {
    target = target.slice(1);
  }

  target = expandHome(target);

  const endsWithSeparator = target.endsWith("/") || target.endsWith(path.sep);
  let absolutePath = path.isAbsolute(target) ? target : path.resolve(cwd, target);

  if (endsWithSeparator || (await isDirectory(absolutePath))) {
    absolutePath = path.join(absolutePath, fallbackName);
  } else if (!path.extname(absolutePath)) {
    absolutePath += ".md";
  }

  return absolutePath;
}

function formatDisplayPath(filePath: string, cwd: string): string {
  const relativePath = path.relative(cwd, filePath);
  if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return filePath;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("save-md", {
    description: "Save the last assistant message to a Markdown file. Usage: /save-md [filename.md]",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      const lastAssistant = getLastAssistantText(ctx.sessionManager.getBranch());
      if (!lastAssistant) {
        ctx.ui.notify("No assistant text message found on the current branch", "warning");
        return;
      }

      const targetPath = await resolveTargetPath(args, ctx.cwd, lastAssistant.timestamp);
      await mkdir(path.dirname(targetPath), { recursive: true });

      const markdown = lastAssistant.text.endsWith("\n") ? lastAssistant.text : `${lastAssistant.text}\n`;
      await writeFile(targetPath, markdown, "utf8");

      ctx.ui.notify(`Saved last assistant message to ${formatDisplayPath(targetPath, ctx.cwd)}`, "info");
    },
  });
}
