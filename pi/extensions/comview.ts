import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const commentsPath = ".comview/comments.json";

type ComviewComment = {
  path?: string;
  body?: string;
  start_line?: number;
  line?: number;
  side?: string;
};

type ComviewCommentFile = {
  comments?: ComviewComment[];
};

type RunResult = {
  status: number | null;
  error?: string;
};

export default function (pi: ExtensionAPI) {
  pi.registerCommand("cv", {
    description: "Review a git command with comview. Use `/cv all` to include untracked files.",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      const command = parseCommand(args);
      if (!command) {
        ctx.ui.notify("Usage: /cv [all|<git args...>]", "error");
        return;
      }

      const file = join(ctx.cwd, commentsPath);
      if (!(await removeCommentsFile(file, ctx))) {
        return;
      }

      if (!ctx.hasUI) {
        ctx.ui.notify("/cv requires the interactive TUI.", "error");
        return;
      }

      ctx.ui.notify(`Opening comview for \`${command.display}\`...`, "info");
      const result = await runComview(ctx, command);
      if (result.error) {
        ctx.ui.notify(`Failed to run comview: ${result.error}`, "error");
      } else if (result.status && result.status !== 0) {
        ctx.ui.notify(commandFailureMessage(result.status, command), "error");
      }

      const comments = await readComments(file, ctx);
      if (!comments) {
        return;
      }
      if (comments.length === 0) {
        const message =
          result.status && result.status !== 0
            ? `comview exited with code ${result.status}; no saved comments found at ${commentsPath}.`
            : `comview exited with no saved comments at ${commentsPath}.`;
        ctx.ui.notify(message, "info");
        return;
      }

      ctx.ui.setEditorText(formatPrompt(comments, command.sourceLabel));
      await removeCommentsFile(file, ctx);
      ctx.ui.notify(
        `Loaded ${comments.length} comview comment${comments.length === 1 ? "" : "s"}.`,
        "info",
      );
    },
  });
}

type ReviewCommand = {
  display: string;
  shell: string;
  args: string[];
  sourceLabel: string;
};

function parseCommand(args: unknown): ReviewCommand | null {
  const values = Array.isArray(args)
    ? args.map(String).filter(Boolean)
    : typeof args === "string"
      ? args.trim().split(/\s+/).filter(Boolean)
      : [];
  if (values.length === 0) {
    return {
      display: "git diff | comview",
      shell: "git diff | comview",
      args: [],
      sourceLabel: "git diff",
    };
  }
  if (values.length === 1 && values[0] === "all") {
    return {
      display: "git add -N . && git diff | comview",
      shell: "git add -N . && git diff | comview",
      args: [],
      sourceLabel: "git diff",
    };
  }
  if (values[0] === "all") {
    return null;
  }
  const gitCommand = `git ${values.map(shellQuote).join(" ")}`;
  return {
    display: `${gitCommand} | comview`,
    shell: 'git "$@" | comview',
    args: ["git", ...values],
    sourceLabel: gitCommand,
  };
}

async function removeCommentsFile(
  file: string,
  ctx: { ui: { notify(message: string, kind?: string): void } },
) {
  try {
    await fs.rm(file, { force: true });
    return true;
  } catch (error) {
    ctx.ui.notify(
      `Could not delete ${commentsPath}: ${errorMessage(error)}`,
      "error",
    );
    return false;
  }
}

async function runComview(
  ctx: {
    cwd: string;
    ui: { custom<T>(callback: (...args: any[]) => any): Promise<T> };
  },
  command: ReviewCommand,
) {
  return ctx.ui.custom<RunResult>((tui, _theme, _kb, done) => {
    let result: RunResult = { status: null };
    tui.stop();
    try {
      process.stdout.write("\x1b[2J\x1b[H");
      const env = shellEnv();
      const spawned = spawnSync(
        "bash",
        ["-o", "pipefail", "-c", command.shell, ...command.args],
        {
          cwd: ctx.cwd,
          stdio: "inherit",
          env,
        },
      );
      result = {
        status: spawned.status,
        error: spawned.error ? errorMessage(spawned.error) : undefined,
      };
    } catch (error) {
      result = { status: null, error: errorMessage(error) };
    } finally {
      tui.start();
      tui.requestRender(true);
      done(result);
    }

    return { render: () => [], invalidate: () => {} };
  });
}

async function readComments(
  file: string,
  ctx: { ui: { notify(message: string, kind?: string): void } },
) {
  let data: string;
  try {
    data = await fs.readFile(file, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    ctx.ui.notify(
      `Could not read ${commentsPath}: ${errorMessage(error)}`,
      "error",
    );
    return null;
  }

  try {
    const parsed = JSON.parse(data) as ComviewCommentFile;
    return Array.isArray(parsed.comments) ? parsed.comments : [];
  } catch (error) {
    ctx.ui.notify(`Invalid ${commentsPath}: ${errorMessage(error)}`, "error");
    return null;
  }
}

function shellEnv() {
  const env = { ...process.env };
  const shell = process.env.SHELL || "/bin/sh";
  const loginPath = spawnSync(shell, ["-lc", 'printf %s "$PATH"'], {
    encoding: "utf8",
    env: process.env,
  });
  if (loginPath.status === 0 && loginPath.stdout) {
    env.PATH = mergePaths(process.env.PATH, loginPath.stdout);
  }
  return env;
}

function mergePaths(...paths: Array<string | undefined>) {
  const entries = paths
    .flatMap((path) => path?.split(":") ?? [])
    .filter(Boolean);
  return [...new Set(entries)].join(":");
}

function commandFailureMessage(status: number, command: ReviewCommand) {
  if (status === 127) {
    return `Could not find git or comview while running \`${command.display}\`.`;
  }
  return `Review command exited with code ${status}.`;
}

function formatPrompt(comments: ComviewComment[], sourceLabel: string) {
  const lines = ["Please address the following feedback", ""];
  comments.forEach((comment, index) => {
    lines.push(
      `${index + 1}. [${sourceLabel}] ${comment.path ?? "unknown"}:${formatRange(comment)} ${formatSide(comment.side)}`,
    );
    lines.push(formatBody(comment.body ?? ""));
  });
  return lines.join("\n");
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatRange(comment: ComviewComment) {
  const line = comment.line ?? 0;
  if (comment.start_line && comment.start_line !== line) {
    return `${comment.start_line}-${line}`;
  }
  return `${line}`;
}

function formatSide(side: string | undefined) {
  return side === "LEFT" ? "(old)" : "(new)";
}

function formatBody(body: string) {
  return body
    .trim()
    .split(/\r?\n/)
    .map((line) => `   ${line}`)
    .join("\n");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
