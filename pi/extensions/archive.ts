import { SessionManager, type ExtensionAPI, type ExtensionCommandContext, type SessionEntry } from "@earendil-works/pi-coding-agent";

const CUSTOM_TYPE = "der-computer-metadata";
const HOUR_MS = 60 * 60 * 1000;
const ARCHIVE_AGE_HOURS = 72;

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

function archiveCurrentSession(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
  if (isArchived(ctx.sessionManager.getBranch())) return false;
  pi.appendEntry(CUSTOM_TYPE, { archived: true });
  return true;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("archive-quit", {
    description: "Archive the current session and quit pi",
    handler: async (_args, ctx) => {
      const archived = archiveCurrentSession(pi, ctx);
      ctx.ui.notify(archived ? "Session archived. Quitting pi." : "Session already archived. Quitting pi.", "info");
      ctx.shutdown();
    },
  });

  pi.registerCommand("archive-new", {
    description: "Archive the current session and start a new session",
    handler: async (_args, ctx) => {
      archiveCurrentSession(pi, ctx);

      const result = await ctx.newSession({
        parentSession: ctx.sessionManager.getSessionFile(),
        withSession: async (ctx) => {
          ctx.ui.notify("Session archived. Started a new session.", "info");
        },
      });

      if (result.cancelled) {
        ctx.ui.notify("New session was cancelled", "warning");
      }
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

  pi.registerCommand("archive-older-than-72h", {
    description: "Archive all sessions across all projects older than 72 hours",
    handler: async (_args, ctx) => {
      const cutoff = Date.now() - ARCHIVE_AGE_HOURS * HOUR_MS;
      const sessions = await SessionManager.listAll();
      const oldSessions = sessions.filter((session) => session.modified.getTime() < cutoff);

      if (oldSessions.length === 0) {
        ctx.ui.notify("No sessions older than 72 hours", "info");
        return;
      }

      const confirmed = await ctx.ui.confirm(
        "Archive old sessions?",
        `Archive ${oldSessions.length} session${oldSessions.length === 1 ? "" : "s"} older than 72 hours?`,
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
