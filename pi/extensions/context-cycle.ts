/**
 * Context Cycle
 *
 * Keeps pi's useful footer information, but moves context usage beside the
 * current provider/model and renders it as a compact circular gauge.
 */

import {
  SettingsManager,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const FOOTER_GAP = 2;
const COMPACTION_WARNING_LEAD_PERCENT = 10;

export interface CompactionPolicy {
  enabled: boolean;
  reserveTokens: number;
}

interface Usage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
}

interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  latestCacheHitRate?: number;
}

function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

function addUsage(totals: UsageTotals, usage: Usage | undefined): void {
  if (!usage) return;
  totals.input += usage.input ?? 0;
  totals.output += usage.output ?? 0;
  totals.cacheRead += usage.cacheRead ?? 0;
  totals.cacheWrite += usage.cacheWrite ?? 0;
  totals.cost += usage.cost?.total ?? 0;
}

function getUsageTotals(entries: readonly any[]): UsageTotals {
  const totals: UsageTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
  };

  for (const entry of entries) {
    if (entry.type === "message" && entry.message?.role === "assistant") {
      const usage = entry.message.usage as Usage | undefined;
      addUsage(totals, usage);

      const promptTokens =
        (usage?.input ?? 0) +
        (usage?.cacheRead ?? 0) +
        (usage?.cacheWrite ?? 0);
      totals.latestCacheHitRate =
        promptTokens > 0 ? ((usage?.cacheRead ?? 0) / promptTokens) * 100 : undefined;
    } else if (
      entry.type === "message" &&
      entry.message?.role === "toolResult"
    ) {
      addUsage(totals, entry.message.usage as Usage | undefined);
    } else if (entry.type === "branch_summary" || entry.type === "compaction") {
      addUsage(totals, entry.usage as Usage | undefined);
    }
  }

  return totals;
}

/** Unicode fallback for a circular progress gauge: empty, 1/4, 1/2, 3/4, full. */
export function contextCycle(percent: number | null | undefined): string {
  if (percent == null) return "○";

  const clamped = Math.max(0, Math.min(100, percent));
  if (clamped === 0) return "○";
  if (clamped <= 25) return "◔";
  if (clamped <= 50) return "◑";
  if (clamped <= 75) return "◕";
  return "●";
}

export function contextColorThresholds(
  contextWindow: number,
  compaction: CompactionPolicy,
): { warning: number; error: number } {
  if (!compaction.enabled || contextWindow <= 0) {
    // Without auto-compaction, warn only as the model's hard limit approaches.
    return { warning: 85, error: 95 };
  }

  // Pi compacts when tokens > contextWindow - reserveTokens.
  const trigger = Math.max(
    0,
    Math.min(100, ((contextWindow - compaction.reserveTokens) / contextWindow) * 100),
  );
  return {
    warning: Math.max(0, trigger - COMPACTION_WARNING_LEAD_PERCENT),
    error: trigger,
  };
}

function compactCwd(cwd: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return cwd;
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`)) return `~${cwd.slice(home.length)}`;
  return cwd;
}

function sanitizeStatus(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export default function contextCycleExtension(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    const compaction = SettingsManager.create(ctx.cwd, undefined, {
      projectTrusted: ctx.isProjectTrusted(),
    }).getCompactionSettings();

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsubscribe,
        invalidate() {},
        render(width: number): string[] {
          const totals = getUsageTotals(ctx.sessionManager.getEntries());
          const leftParts: string[] = [];

          if (totals.input) leftParts.push(`↑${formatTokens(totals.input)}`);
          if (totals.output) leftParts.push(`↓${formatTokens(totals.output)}`);
          if (totals.cacheRead) leftParts.push(`R${formatTokens(totals.cacheRead)}`);
          if (totals.cacheWrite) leftParts.push(`W${formatTokens(totals.cacheWrite)}`);
          if (
            (totals.cacheRead || totals.cacheWrite) &&
            totals.latestCacheHitRate !== undefined
          ) {
            leftParts.push(`CH${totals.latestCacheHitRate.toFixed(1)}%`);
          }
          if (totals.cost) leftParts.push(`$${totals.cost.toFixed(3)}`);

          const usage = ctx.getContextUsage();
          const percent = usage?.percent;
          const percentText = percent == null ? "?" : `${percent.toFixed(0)}%`;
          const thresholds = contextColorThresholds(
            usage?.contextWindow ?? ctx.model?.contextWindow ?? 0,
            compaction,
          );
          const gaugeColor =
            percent != null && percent > thresholds.error
              ? "error"
              : percent != null && percent >= thresholds.warning
                ? "warning"
                : "dim";
          const gauge = `${theme.fg(gaugeColor, contextCycle(percent))} ${theme.fg(
            gaugeColor,
            percentText,
          )}`;

          const modelName = ctx.model?.id ?? "no-model";
          const thinking = ctx.model?.reasoning
            ? ` • ${ctx.thinkingLevel ?? "off"}`
            : "";
          const modelOnly = theme.fg("dim", `${modelName}${thinking}`);
          const providerAndModel = ctx.model
            ? theme.fg("dim", `(${ctx.model.provider}) ${modelName}${thinking}`)
            : modelOnly;

          const statsText = theme.fg("dim", leftParts.join(" "));
          const gaugeSeparator = leftParts.length > 0 ? " • " : "";
          let left = `${statsText}${gaugeSeparator}${gauge}`;
          let right = providerAndModel;

          // Prefer preserving the stats, gauge, and model on narrow terminals;
          // the provider name is the first detail to drop.
          if (
            visibleWidth(left) + FOOTER_GAP + visibleWidth(right) > width &&
            ctx.model
          ) {
            right = modelOnly;
          }

          const maxLeft = Math.max(0, width - visibleWidth(right) - FOOTER_GAP);
          if (visibleWidth(left) > maxLeft) {
            // Truncate cumulative stats first so the context gauge stays visible.
            const gaugeSpace = visibleWidth(gaugeSeparator) + visibleWidth(gauge);
            const maxStats = Math.max(0, maxLeft - gaugeSpace);
            const truncatedStats = truncateToWidth(
              statsText,
              maxStats,
              maxStats >= 3 ? "..." : "",
            );
            left =
              maxLeft >= visibleWidth(gauge)
                ? `${truncatedStats}${truncatedStats ? gaugeSeparator : ""}${gauge}`
                : truncateToWidth(gauge, maxLeft, "");
          }

          let statsLine: string;
          if (visibleWidth(left) + FOOTER_GAP + visibleWidth(right) <= width) {
            const padding = " ".repeat(
              Math.max(FOOTER_GAP, width - visibleWidth(left) - visibleWidth(right)),
            );
            statsLine = left + padding + right;
          } else {
            // Extremely narrow terminal: keep the gauge, then use remaining room for the model.
            const roomForModel = width - visibleWidth(gauge) - FOOTER_GAP;
            statsLine =
              roomForModel > 0
                ? `${gauge}${" ".repeat(FOOTER_GAP)}${truncateToWidth(modelOnly, roomForModel, "")}`
                : truncateToWidth(gauge, width, "");
          }

          let cwd = compactCwd(ctx.sessionManager.getCwd());
          const branch = footerData.getGitBranch();
          if (branch) cwd += ` (${branch})`;
          const sessionName = ctx.sessionManager.getSessionName();
          if (sessionName) cwd += ` • ${sessionName}`;

          const lines = [
            truncateToWidth(theme.fg("dim", cwd), width, theme.fg("dim", "...")),
            statsLine,
          ];

          const statuses = [...footerData.getExtensionStatuses().entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, text]) => sanitizeStatus(text));
          if (statuses.length > 0) {
            lines.push(
              truncateToWidth(statuses.join(" "), width, theme.fg("dim", "...")),
            );
          }

          return lines;
        },
      };
    });
  });
}
