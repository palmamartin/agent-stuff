EXTENSIONS_SRC := extensions
EXTENSIONS_DEST := $(HOME)/.pi/agent/extensions

THEMES_SRC := themes
THEMES_DEST := $(HOME)/.pi/agent/themes

SKILLS_SRC := skills
SKILLS_DEST := $(HOME)/.pi/agent/skills

.PHONY: extensions themes skills all

all: extensions themes skills

extensions:
	@mkdir -p $(EXTENSIONS_DEST)
	@for item in $(EXTENSIONS_SRC)/*; do \
		name=$$(basename "$$item"); \
		ln -sf "$$(pwd)/$$item" "$(EXTENSIONS_DEST)/$$name"; \
		echo "Linked $$name -> $(EXTENSIONS_DEST)/$$name"; \
	done

themes:
	@mkdir -p $(THEMES_DEST)
	@for item in $(THEMES_SRC)/*; do \
		name=$$(basename "$$item"); \
		ln -sf "$$(pwd)/$$item" "$(THEMES_DEST)/$$name"; \
		echo "Linked $$name -> $(THEMES_DEST)/$$name"; \
	done

skills:
	@mkdir -p $(SKILLS_DEST)
	@for item in $(SKILLS_SRC)/*; do \
		name=$$(basename "$$item"); \
		ln -sf "$$(pwd)/$$item" "$(SKILLS_DEST)/$$name"; \
		echo "Linked $$name -> $(SKILLS_DEST)/$$name"; \
	done
