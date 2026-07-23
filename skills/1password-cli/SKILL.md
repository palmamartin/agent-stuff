---
name: 1password-cli
description: Use 1Password Environments with the local `op` CLI for project commands, especially local servers/dev servers. Reads non-secret `.1p.config` only; never reads mounted `.env` files.
---

# 1Password CLI / Environments

Use this skill for tasks involving 1Password Environments, `op`, 1Password-mounted `.env` files, or running project commands that may need secrets (dev servers, test servers, workers, REPLs, app commands).

## Hard safety rules

- **Never read `.env` / `.env.*` file contents.** Do not use `cat`, `head`, `tail`, `grep`, `rg`, `sed`, `awk`, `less`, editors, dotenv parsers, scripts, or any equivalent file read against them. Do not inspect values, keys, comments, or structure.
- **Never use `op run --env-file=.env`** for mounted 1Password dotenv files. Use `op run --environment <id>`.
- **Never run `op environment read` for verification.** It prints key/value pairs. Only use it when the user explicitly requests reading an Environment and accepts secret exposure risk.
- **Never dump environments or secrets.** Avoid `env`, `printenv`, framework debug env dumps, and `--no-masking` unless explicitly requested with risk acknowledged.
- Keep 1Password masking enabled for normal commands.

## Preferred command pattern

Run secret-dependent commands through 1Password Environments:

```sh
op run --environment <environment-id> -- <command>
```

If an account is configured/known, select it explicitly:

```sh
op run --account=<account> --environment <environment-id> -- <command>
```

Multiple Environments are allowed; later entries override earlier ones:

```sh
op run --environment <shared-env-id> --environment <local-env-id> -- <command>
```

Explicit non-secret dotenv overlays are also allowed when the user or a safe config explicitly requests a specific path, such as `.env.local`. Do not read the file contents. 1Password CLI precedence is:

1. 1Password Environments (`--environment`) override everything else.
2. Environment files (`--env-file`) override shell environment variables.
3. Shell environment variables are lowest precedence.

If multiple `--env-file` flags are used, the last file wins among environment files. If multiple `--environment` flags are used, the last Environment wins among Environments.

```sh
op run --environment <environment-id> --env-file .env.local -- <command>
op run --environment <shared-env-id> --environment <local-env-id> --env-file .env.local -- <command>
```

Examples:

```sh
op run --environment "$OP_ENVIRONMENT_ID" -- npm run dev
op run --account="$OP_ACCOUNT" --environment "$OP_ENVIRONMENT_ID" -- pnpm dev
op run --environment "$OP_ENVIRONMENT_ID" -- yarn dev
op run --environment "$OP_ENVIRONMENT_ID" -- bun dev
op run --environment "$OP_ENVIRONMENT_ID" -- make dev
```

## `.1p.config` project config

Agents may read `.1p.config`; it is non-secret and should contain only selectors:

```ini
environment=<environment-id>
account=<account-shorthand-or-signin-address-or-account-id>
```

Rules:

- Look for `.1p.config` in the project root before asking for an Environment ID.
- Read only `.1p.config`; never read `.env`, `.env.local`, or `.env.*`.
- Optional `env_file=<path>` entries may name explicit non-secret dotenv overlays to pass to `op run --env-file`. Treat these paths as selectors only; do not read their contents.
- Parse simple `key=value` lines; ignore blanks and `#` comments.
- `environment` is required to build `--environment <id>`.
- `account` is optional; when present, add `--account=<account>`.

Command construction:

```sh
# account present
op run --account=<account> --environment <environment> -- <command>

# account absent
op run --environment <environment> -- <command>
```

## Safe Environment ID discovery order

1. Read project-root `.1p.config`, if present.
2. Use an Environment ID supplied by the user or explicit non-secret docs/config.
3. Inspect only safe non-secret sources: `README*`, `AGENTS.md`, package/task scripts, Makefiles, Justfiles, and explicit 1Password config files.
4. If `OP_ENVIRONMENT_ID` is already exported/known, use it without printing environment contents.
5. If no ID is discoverable, ask the user for it. They can copy it in 1Password: **Developer → View Environments → select Environment → Manage environment → Copy environment ID**.
6. Do not discover IDs by reading `.env` files or dumping Environment contents.

## Before running a server/command

- Check CLI availability with safe commands only: `command -v op`, `op --version`.
- Ensure `op run --environment` is supported. If not, ask the user to update/install a 1Password CLI release with Environments support; do not fall back to `.env`.
- Let `op` trigger 1Password auth. If it waits/fails, ask the user to unlock/approve/select the right account/grant Environment access.

## Local `.env` files

### Explicit non-secret dotenv overlays

When the user explicitly states that a dotenv file contains non-secrets, or a safe config such as `.1p.config` lists it as `env_file=<path>`, it may be merged into `op run` with `--env-file`:

```sh
op run --environment <environment-id> --env-file .env.local -- <command>
```

Rules:

- Do not read or parse the file yourself.
- Do not dump the resulting environment.
- Use `--env-file` only for explicit paths supplied by the user or safe config.
- Prefer 1Password Environments for secrets; dotenv overlays should be for non-secret local defaults.
- Remember precedence: `--environment` values override `--env-file` values.

### Mounted local `.env` files

Treat 1Password-mounted `.env` files as sensitive FIFOs. Do not open, parse, preflight, or validate them.

If the project already uses a mounted dotenv path and the user explicitly wants that path used, run the normal project command and let the application/dotenv library read it. Do not use `op run --env-file` for the mount.

Known limitations:

- Mounted dotenv files are supported on macOS and Linux.
- Concurrent reads can conflict; ask the user to close IDE/editor/processes holding the file open.
- Watch-heavy tools (for example Vite) may restart on FIFO events. Suggest ignoring the mounted path, e.g. `server.watch.ignored: ['**/.env']`.

## Failure handling

- `unknown flag: --environment`: CLI is too old/lacks Environments support. Ask the user to update `op`; do not read `.env`.
- Auth/permission errors: ask the user to unlock 1Password, approve prompts, choose the right account, or grant Environment access.
- Missing Environment ID: ask the user for the ID; do not inspect `.env`.
- Logs contain secrets: stop or redact output; keep 1Password masking enabled.

## Source basis

Based on 1Password developer docs for Environments, mounted local `.env` files, programmatic Environment reads, CLI setup/reference, `op run`, and `op environment`.
