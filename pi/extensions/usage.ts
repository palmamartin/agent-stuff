/**
 * Usage Extension
 *
 * Shows provider usage stats in the footer status area.
 *
 * Supported:
 * - GitHub Copilot: Premium interactions quota
 * - OpenAI Codex: primary + secondary rate limit windows
 *
 * Modified https://github.com/hjanuschka/shitty-extensions/blob/f05612d595b16f6b93f114041eca6d56f6ce3724/extensions/usage-bar.ts to my needs.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface RateWindow {
  label: string;
  usedPercent: number;
  resetDescription?: string;

  // For Copilot premium interactions
  remaining?: number;
  entitlement?: number;
}

interface UsageSnapshot {
  windows: RateWindow[];
  error?: string;
}

// ============================================================================
// Copilot Usage
// ============================================================================

function loadCopilotRefreshToken(): string | undefined {
  // The copilot_internal/user endpoint needs the GitHub OAuth token (ghu_*).
  const authPath = path.join(os.homedir(), ".pi", "agent", "auth.json");
  try {
    if (fs.existsSync(authPath)) {
      const data = JSON.parse(fs.readFileSync(authPath, "utf-8"));
      return data["github-copilot"]?.refresh;
    }
  } catch {}

  return undefined;
}

async function fetchCopilotUsage(): Promise<UsageSnapshot> {
  const token = loadCopilotRefreshToken();
  if (!token) return { windows: [], error: "No token" };

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5000);

  try {
    // GitHub OAuth token (ghu_*) requires "token" prefix, not Bearer.
    const res = await fetch("https://api.github.com/copilot_internal/user", {
      headers: {
        "Editor-Version": "vscode/1.96.2",
        "User-Agent": "GitHubCopilotChat/0.26.7",
        "X-Github-Api-Version": "2025-04-01",
        Accept: "application/json",
        Authorization: `token ${token}`,
      },
      signal: controller.signal,
    });

    if (!res.ok) return { windows: [], error: `HTTP ${res.status}` };

    const data = (await res.json()) as any;
    const windows: RateWindow[] = [];

    const resetDate = data.quota_reset_date_utc
      ? new Date(data.quota_reset_date_utc)
      : undefined;
    const resetDesc = resetDate ? formatReset(resetDate) : undefined;

    // Premium interactions - has a cap.
    if (data.quota_snapshots?.premium_interactions) {
      const pi = data.quota_snapshots.premium_interactions;
      const remaining = pi.remaining ?? 0;
      const entitlement = pi.entitlement ?? 0;
      const usedPercent = Math.max(0, 100 - (pi.percent_remaining || 0));
      windows.push({
        label: "Premium",
        usedPercent,
        resetDescription: resetDesc,
        remaining,
        entitlement,
      });
    }

    return { windows };
  } catch (e) {
    return { windows: [], error: String(e) };
  }
}

// ============================================================================
// Codex (OpenAI) Usage
// ============================================================================

async function fetchCodexUsage(modelRegistry: any): Promise<UsageSnapshot> {
  // Try to get token from pi's auth storage first.
  let accessToken: string | undefined;
  let accountId: string | undefined;

  try {
    accessToken = await modelRegistry?.authStorage?.getApiKey?.("openai-codex");

    const cred = modelRegistry?.authStorage?.get?.("openai-codex");
    if (cred?.type === "oauth") {
      accountId = (cred as any).accountId;
    }
  } catch {}

  // Fallback to ~/.codex/auth.json if not in pi's auth.
  if (!accessToken) {
    const codexHome =
      process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    const authPath = path.join(codexHome, "auth.json");

    try {
      if (fs.existsSync(authPath)) {
        const data = JSON.parse(fs.readFileSync(authPath, "utf-8"));

        if (data.OPENAI_API_KEY) {
          accessToken = data.OPENAI_API_KEY;
        } else if (data.tokens?.access_token) {
          accessToken = data.tokens.access_token;
          accountId = data.tokens.account_id;
        }
      }
    } catch {}
  }

  if (!accessToken) return { windows: [], error: "No credentials" };

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "CodexBar",
      Accept: "application/json",
    };

    if (accountId) headers["ChatGPT-Account-Id"] = accountId;

    const res = await fetch("https://chatgpt.com/backend-api/wham/usage", {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      return { windows: [], error: "Token expired" };
    }

    if (!res.ok) return { windows: [], error: `HTTP ${res.status}` };

    const data = (await res.json()) as any;
    const windows: RateWindow[] = [];

    // Primary window (often hourly/3-hour)
    if (data.rate_limit?.primary_window) {
      const pw = data.rate_limit.primary_window;
      const resetDate = pw.reset_at ? new Date(pw.reset_at * 1000) : undefined;
      const windowHours = Math.round((pw.limit_window_seconds || 10800) / 3600);
      windows.push({
        label: `${windowHours}h`,
        usedPercent: pw.used_percent || 0,
        resetDescription: resetDate ? formatReset(resetDate) : undefined,
      });
    }

    // Secondary window (daily/weekly/etc.)
    if (data.rate_limit?.secondary_window) {
      const sw = data.rate_limit.secondary_window;
      const resetDate = sw.reset_at ? new Date(sw.reset_at * 1000) : undefined;

      const windowSeconds = sw.limit_window_seconds || 86400;
      const windowHours = Math.round(windowSeconds / 3600);
      const windowDays = Math.round(windowSeconds / 86400);

      let label: string;
      if (windowDays >= 7) label = "Week";
      else if (windowDays >= 1)
        label = windowDays === 1 ? "Day" : `${windowDays}d`;
      else label = `${windowHours}h`;

      windows.push({
        label,
        usedPercent: sw.used_percent || 0,
        resetDescription: resetDate ? formatReset(resetDate) : undefined,
      });
    }

    return { windows };
  } catch (e) {
    return { windows: [], error: String(e) };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function formatReset(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  if (diffMs < 0) return "now";

  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ${hours % 24}h`;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

// ============================================================================
// Footer Status
// ============================================================================

const FOOTER_STATUS_ID = "usage";
const FOOTER_STATUS_SECONDARY_ID = "usage-secondary";

const FOOTER_BAR_W = 12;
const FOOTER_REFRESH_MS = 30_000;

let lastCopilotFooterUpdate = 0;
let copilotFooterInFlight = false;

let lastCodexFooterUpdate = 0;
let codexFooterInFlight = false;

function isCopilotProvider(provider: unknown): boolean {
  return (
    typeof provider === "string" && provider.toLowerCase().includes("copilot")
  );
}

function isCodexProvider(provider: unknown): boolean {
  if (typeof provider !== "string") return false;
  const p = provider.toLowerCase();
  return p === "codex" || p.includes("openai-codex") || p.includes("codex");
}

function renderPlainBar(
  usedPercent: number,
  barW: number = FOOTER_BAR_W,
): { used: string; remaining: string } {
  const filled = Math.min(
    barW,
    Math.max(0, Math.round((usedPercent / 100) * barW)),
  );
  const empty = barW - filled;
  return { used: "━".repeat(filled), remaining: "┉".repeat(empty) };
}

function renderCodexFooterText(
  ctx: any,
  label: string,
  usedPercent: number,
  resetDescription?: string,
  { pipeAfterLabel = false }: { pipeAfterLabel?: boolean } = {},
): string {
  // Bar + percentage show USED.
  const used = Math.max(0, Math.min(100, usedPercent));
  const bar = renderPlainBar(used);
  const usedText = `${used.toFixed(0)}% used`;

  const theme = ctx.ui?.theme;
  let color = "dim";
  if (used >= 60) color = "warning";
  if (used >= 85) color = "error";

  const resetCompact = resetDescription
    ? resetDescription.replace(/\s+/g, "")
    : undefined;

  const left = pipeAfterLabel ? `${label} |` : label;
  const leftWithReset = resetCompact ? `${left} ${resetCompact}` : left;

  // Two spaces between reset and bar to match the desired footer output.
  return `${theme.fg("dim", leftWithReset)}  ${theme.fg(color, bar.used)}${theme.fg("dim", bar.remaining)}  ${theme.fg(color, usedText)}`;
}

function renderCopilotFooterText(
  ctx: any,
  usedPercent: number,
  remaining: number,
  entitlement: number,
  resetDescription?: string,
): string {
  const used = Math.max(0, Math.min(100, usedPercent));
  const bar = renderPlainBar(used);
  const usedText = `${used.toFixed(0).padStart(3)}% used`;

  const theme = ctx.ui?.theme;
  let color = "dim";
  if (used >= 60) color = "warning";
  if (used >= 85) color = "error";

  const quotaText = `(${remaining}/${entitlement})`;
  const resetCompact = resetDescription
    ? resetDescription.replace(/\s+/g, "")
    : undefined;
  const resetText = resetCompact ? ` | reset ${resetCompact}` : "";

  return `${theme.fg("dim", "Github Copilot |")} ${theme.fg(color, bar.used)}${theme.fg("dim", bar.remaining)} ${theme.fg(color, usedText)} ${theme.fg("dim", `${quotaText}${resetText}`)}`;
}

async function updateFooterStatus(
  ctx: any,
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  if (!ctx?.hasUI) return;

  const provider = ctx.model?.provider;

  if (!isCopilotProvider(provider) && !isCodexProvider(provider)) {
    ctx.ui.setStatus(FOOTER_STATUS_ID, undefined);
    ctx.ui.setStatus(FOOTER_STATUS_SECONDARY_ID, undefined);
    return;
  }

  const timeout = <T>(p: Promise<T>, ms: number, fallback: T) =>
    Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

  if (isCopilotProvider(provider)) {
    const now = Date.now();
    if (!force && now - lastCopilotFooterUpdate < FOOTER_REFRESH_MS) return;
    if (copilotFooterInFlight) return;
    copilotFooterInFlight = true;

    try {
      const usage = await timeout(fetchCopilotUsage(), 5000, {
        windows: [],
        error: "Timeout",
      } as UsageSnapshot);

      const premium = usage.windows.find(
        (w) => w.label.toLowerCase() === "premium",
      );

      if (!premium) {
        ctx.ui.setStatus(FOOTER_STATUS_ID, undefined);
        ctx.ui.setStatus(FOOTER_STATUS_SECONDARY_ID, undefined);
        lastCopilotFooterUpdate = now;
        return;
      }

      ctx.ui.setStatus(
        FOOTER_STATUS_ID,
        renderCopilotFooterText(
          ctx,
          premium.usedPercent,
          premium.remaining ?? 0,
          premium.entitlement ?? 0,
          premium.resetDescription,
        ),
      );
      ctx.ui.setStatus(FOOTER_STATUS_SECONDARY_ID, undefined);

      lastCopilotFooterUpdate = now;
    } finally {
      copilotFooterInFlight = false;
    }

    return;
  }

  if (isCodexProvider(provider)) {
    const now = Date.now();
    if (!force && now - lastCodexFooterUpdate < FOOTER_REFRESH_MS) return;
    if (codexFooterInFlight) return;
    codexFooterInFlight = true;

    try {
      const usage = await timeout(fetchCodexUsage(ctx.modelRegistry), 5000, {
        windows: [],
        error: "Timeout",
      } as UsageSnapshot);

      const primary = usage.windows[0];
      if (!primary) {
        ctx.ui.setStatus(FOOTER_STATUS_ID, undefined);
        ctx.ui.setStatus(FOOTER_STATUS_SECONDARY_ID, undefined);
        lastCodexFooterUpdate = now;
        return;
      }

      ctx.ui.setStatus(
        FOOTER_STATUS_ID,
        renderCodexFooterText(
          ctx,
          "Codex",
          primary.usedPercent,
          primary.resetDescription,
          { pipeAfterLabel: true },
        ),
      );

      const secondary = usage.windows[1];
      if (secondary) {
        const secondaryLabel = `║ ${secondary.label}`.trim();
        ctx.ui.setStatus(
          FOOTER_STATUS_SECONDARY_ID,
          renderCodexFooterText(
            ctx,
            secondaryLabel,
            secondary.usedPercent,
            secondary.resetDescription,
          ),
        );
      } else {
        ctx.ui.setStatus(FOOTER_STATUS_SECONDARY_ID, undefined);
      }

      lastCodexFooterUpdate = now;
    } finally {
      codexFooterInFlight = false;
    }
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    await updateFooterStatus(ctx, { force: true });
  });

  pi.on("model_select", async (_event, ctx) => {
    await updateFooterStatus(ctx, { force: true });
  });

  pi.on("turn_end", async (_event, ctx) => {
    await updateFooterStatus(ctx);
  });
}
