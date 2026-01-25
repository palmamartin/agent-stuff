# Agent skills

A collection of skills for coding agents, probably compatible with Pi, Codex CLI, Amp, Claude Code.

## Installation

```bash
# Install for a specific agent
make pi       # Pi
make amp      # Amp
make claude   # Claude Code
make codex    # Codex CLI

# Install for all agents
make all
```

## Available Skills

| Skill | Description |
|-------|-------------|
| [agent-browser](./agent-browser) | Automates browser interactions for web testing, form filling, screenshots, and data extraction |

## Requirements

Some skills require additional setup.

- **agent-browser**: Requires Node.js. Install globally with `npm install -g agent-browser`
