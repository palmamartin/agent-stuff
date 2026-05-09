.PHONY: all pi

MAKEFILE_DIR := $(patsubst %/,%,$(abspath $(dir $(lastword $(MAKEFILE_LIST)))))
PI_SKILLS_DIR := $(abspath $(MAKEFILE_DIR)/../pi/skills)

all:
	@mkdir -p ~/.agents/skills
	@for dir in "$(MAKEFILE_DIR)"/*/; do \
		[ -d "$$dir" ] || continue; \
		name=$$(basename "$$dir"); \
		dest=~/.agents/skills/"$$name"; \
		rm -f "$$dest"; \
		ln -s "$${dir%/}" "$$dest"; \
		echo "Linked $${dir%/} to $$dest"; \
	done

pi:
	@mkdir -p ~/.pi/agent/skills
	@for dir in "$(PI_SKILLS_DIR)"/*/; do \
		[ -d "$$dir" ] || continue; \
		name=$$(basename "$$dir"); \
		dest=~/.pi/agent/skills/"$$name"; \
		rm -f "$$dest"; \
		ln -s "$${dir%/}" "$$dest"; \
		echo "Linked $${dir%/} to $$dest"; \
	done
