import { SessionManager, type ExtensionAPI, type ExtensionCommandContext, type SessionEntry } from "@earendil-works/pi-coding-agent";

const CUSTOM_TYPE = "der-computer-metadata";
const DAY_MS = 24 * 60 * 60 * 1000;

interface DerComputerMetadata {
  archived?: boolean;
}

function isMetadataEntry(entry: SessionEntry): entry is SessionEntry & { data?: DerComputerMetadata } {
  return entry.type === "custom" && entry.customType === CUSTOM_TYPE;
}

function getMetadata(entries: SessionEntry[]): DerComputerMetadata | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (isMetadataEntry(entry)) return entry.data;
  }
}

function isArchived(entries: SessionEntry[]) {
  return getMetadata(entries)?.archived === true;
}

function parseDays(value: string) {
  const days = Number(value.trim());
  return Number.isInteger(days) && days > 0 ? days : undefined;
}

async function getDays(args: string, ctx: ExtensionCommandContext) {
  const daysFromArgs = parseDays(args);
  if (daysFromArgs !== undefined) return daysFromArgs;

  const input = await ctx.ui.input("Archive old sessions", "Days");
  const daysFromInput = input ? parseDays(input) : undefined;
  if (daysFromInput !== undefined) return daysFromInput;

  ctx.ui.notify("Usage: /archive-all-older-than <days>", "warning");
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("archive", {
    description: "Mark the current session as archived",
    handler: async (_args, ctx) => {
      if (isArchived(ctx.sessionManager.getBranch())) {
        ctx.ui.notify("Session is already archived", "info");
        return;
      }

      pi.appendEntry(CUSTOM_TYPE, { archived: true });
      ctx.ui.notify("Session archived", "info");
    },
  });

  pi.registerCommand("unarchive", {
    description: "Mark the current session as not archived",
    handler: async (_args, ctx) => {
      if (!isArchived(ctx.sessionManager.getBranch())) {
        ctx.ui.notify("Session is not archived", "info");
        return;
      }

      pi.appendEntry(CUSTOM_TYPE, { archived: false });
      ctx.ui.notify("Session unarchived", "info");
    },
  });

  pi.registerCommand("archive-all-older-than", {
    description: "Archive all sessions across all projects older than <days>",
    handler: async (args, ctx) => {
      const days = await getDays(args, ctx);
      if (days === undefined) return;

      const cutoff = Date.now() - days * DAY_MS;
      const sessions = await SessionManager.listAll();
      const oldSessions = sessions.filter((session) => session.modified.getTime() < cutoff);

      if (oldSessions.length === 0) {
        ctx.ui.notify(`No sessions older than ${days} day${days === 1 ? "" : "s"}`, "info");
        return;
      }

      const confirmed = await ctx.ui.confirm(
        "Archive old sessions?",
        `Archive ${oldSessions.length} session${oldSessions.length === 1 ? "" : "s"} older than ${days} day${days === 1 ? "" : "s"}?`,
      );
      if (!confirmed) return;

      let archived = 0;
      let skipped = 0;
      let failed = 0;

      for (const session of oldSessions) {
        try {
          const manager = SessionManager.open(session.path);

          if (isArchived(manager.getBranch())) {
            skipped++;
            continue;
          }

          manager.appendCustomEntry(CUSTOM_TYPE, { archived: true });
          archived++;
        } catch {
          failed++;
        }
      }

      const message = `Archived ${archived}, skipped ${skipped}${failed > 0 ? `, failed ${failed}` : ""}`;
      ctx.ui.notify(message, failed > 0 ? "warning" : "info");
    },
  });
}
