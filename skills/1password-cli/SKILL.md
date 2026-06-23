---
name: 1password-cli
description: Use 1Password Environments with the local `op` CLI for project commands, especially when running local servers/dev servers. Reads non-secret `.1p.config` config for environment/account, loads via `op run --environment`, and never reads mounted `.env` files.
---

# 1Password Environments + local `op` CLI

Use this skill whenever a task involves 1Password Environments, local 1Password-mounted `.env` files, the `op` CLI, or starting/running a local server, dev server, test server, worker, REPL, or app command that may need project secrets.

## Non-negotiable safety rules

- **Never read a local `.env` file to verify it exists or inspect its contents.** Do not run `cat .env`, `head .env`, `tail .env`, `grep .env`, `rg ... .env`, `sed`, `awk`, `less`, editor opens, dotenv parsers, Node/Python/Ruby file reads, or any equivalent command against `.env` / `.env.*` files.
- **Do not use `op run --env-file=.env` with a mounted 1Password `.env` file.** That explicitly opens the file; use `op run --environment <environment-id>` instead.
- **Do not run `op environment read` for verification.** It outputs environment variable key/value pairs. Use it only if the user explicitly asks to read an Environment and understands secrets may be revealed.
- **Never print secrets or full process environments.** Avoid `printenv`, `env`, framework debug dumps, or `--no-masking` unless the user explicitly requests it and the risk is clear.
- **Never pass `--no-masking`** for normal server/dev commands. Let 1Password conceal hidden variables in stdout/stderr.
- Treat local `.env` mounts as sensitive named pipes/FIFOs. Do not probe them. Let 1Password and the user-authorized process handle access.

## Preferred way to run project commands

Run commands through the local 1Password CLI with the corresponding Environment ID:

```sh
op run --environment <environment-id> -- <command>
```

If a project has a `.1p.config` configuration file and it contains `account=...`, include the account selection flag too. Use the correct flag spelling: `--account`.

```sh
op run --account=<account> --environment <environment-id> -- <command>
```

Examples:

```sh
op run --environment "$OP_ENVIRONMENT_ID" -- npm run dev
op run --account="$OP_ACCOUNT" --environment "$OP_ENVIRONMENT_ID" -- pnpm dev
op run --environment "$OP_ENVIRONMENT_ID" -- yarn dev
op run --environment "$OP_ENVIRONMENT_ID" -- bun dev
op run --environment "$OP_ENVIRONMENT_ID" -- make dev
```

If multiple 1Password Environments are needed, pass them in order from lowest to highest priority. When the same variable exists in more than one Environment, the last Environment specified wins:

```sh
op run --environment <shared-env-id> --environment <local-env-id> -- npm run dev
```

If multiple 1Password accounts are configured and the account is known, always select it with `--account` or `OP_ACCOUNT`.

## Project configuration file: `.1p.config`

Agents may read `.1p.config`. It is a non-secret project configuration file used only to choose the correct 1Password Environment and account. It must not contain secret values.

Expected format:

```
environment=<environment-id>
account=<account-shorthand-or-signin-address-or-account-id>
```

Rules:

- Look for `.1p.config` in the project root before asking the user for an Environment ID.
- Read only the exact `.1p.config` file. Do not read `.env`, `.env.local`, `.env.*`, or any mounted dotenv file.
- Parse simple `key=value` lines. Ignore blank lines and `#` comments.
- `environment` is the 1Password Environment ID to pass to `--environment`.
- `account` is optional. If present, include `--account=<account>` in the `op run` command.
- If `account` is absent, omit `--account` and let the local CLI/account selection handle it.

Command construction from `.1p.config`:

```sh
# account present
op run --account=<account> --environment <environment> -- <command>

# account absent
op run --environment <environment> -- <command>
```

## Finding the corresponding Environment safely

1. Use `.1p.config` if present.
2. Use an Environment ID supplied by the user or by other non-secret project documentation/configuration.
3. Safe places to inspect include `README*`, `AGENTS.md`, package/task scripts, Makefiles, Justfiles, and explicit non-secret 1Password config files.
4. If an ID is already exported, use it without printing secrets, for example `OP_ENVIRONMENT_ID`.
5. If no Environment ID is discoverable, ask the user for it. They can copy it in the 1Password desktop app: **Developer** → **View Environments** → select the Environment → **Manage environment** → **Copy environment ID**.
6. Do not try to discover the ID by reading `.env` files or by dumping Environment contents.

## Before running a server

- Check that `op` is available with safe commands only, such as `command -v op` and `op --version`.
- For Environment support, local `op` must support `op run --environment` / 1Password Environments. If the flag is unavailable, tell the user to install/update to a 1Password CLI beta/release that includes Environments support; do **not** fall back to reading `.env`.
- If authentication is needed, let `op` trigger the 1Password desktop app/system auth prompt. Ask the user to unlock/approve it if the command waits or fails for auth.

## Mounted local `.env` files

1Password-mounted `.env` files expose Environment variables on demand without storing plaintext on disk. They are useful for dotenv-compatible tools, but the agent must not read or validate them directly.

If a project is already configured to use a mounted `.env` file and the user explicitly wants that path used, start the normal project command and let the application/dotenv library read it. Do not preflight with `cat`, dotenv parsing, or `op run --env-file`.

Be aware of limitations:

- Local `.env` mounts are supported on Mac and Linux.
- Concurrent reads can conflict. If a dev server cannot read the mounted file, ask the user to close IDE/editor sessions or other processes that may be holding it open.
- Watch-heavy tools such as Vite may restart repeatedly when mounted `.env` FIFOs emit filesystem events. If this happens, suggest ignoring the mounted env path in the dev server watcher, e.g. Vite `server.watch.ignored: ['**/.env']`.

## Failure handling

- `unknown flag: --environment`: the local CLI is too old or lacks Environments support. Ask the user to update `op`; do not read `.env` as a workaround.
- Auth/permission errors: ask the user to unlock 1Password, approve the desktop prompt, select the right account, or grant access to the Environment.
- Missing Environment ID: ask the user for the Environment ID; do not inspect `.env`.
- Server logs appear to contain secrets: stop or redact output. Keep 1Password masking enabled.

## Documentation sources

Based on the 1Password developer documentation index (`https://www.1password.dev/llms.txt`) and these pages:

- 1Password Environments overview
- Access secrets through local `.env` files
- Programmatically read 1Password Environments
- 1Password CLI get started/reference
- `op run` and `op environment` command references
