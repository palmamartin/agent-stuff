.PHONY: pi codex amp claude all

CURRENT_DIR := $(shell pwd)

pi:
	@mkdir -p ~/.pi/agent/skills
	@ln -sf "$(CURRENT_DIR)" ~/.pi/agent/skills/agent-skills
	@echo "Linked to ~/.pi/agent/skills/agent-skills"

codex:
	@mkdir -p ~/.codex/skills
	@ln -sf "$(CURRENT_DIR)" ~/.codex/skills/agent-skills
	@echo "Linked to ~/.codex/skills/agent-skills"

amp:
	@mkdir -p ~/.config/amp/tools
	@ln -sf "$(CURRENT_DIR)" ~/.config/amp/tools/agent-skills
	@echo "Linked to ~/.config/amp/tools/agent-skills"

claude:
	@mkdir -p ~/.claude/skills
	@for dir in $(CURRENT_DIR)/*/; do \
		name=$$(basename "$$dir"); \
		ln -sf "$$dir" ~/.claude/skills/"$$name"; \
		echo "Linked $$name to ~/.claude/skills/$$name"; \
	done

all: pi codex amp claude
