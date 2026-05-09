EXTENSIONS_SRC := extensions
EXTENSIONS_DEST := $(HOME)/.pi/agent/extensions

THEMES_SRC := themes
THEMES_DEST := $(HOME)/.pi/agent/themes

.PHONY: extensions themes all

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
	@mkdir -p ~/.pi/agent/skills
	@for dir in "$(PI_SKILLS_DIR)"/*/; do \
		[ -d "$$dir" ] || continue; \
		name=$$(basename "$$dir"); \
		dest=~/.pi/agent/skills/"$$name"; \
		rm -f "$$dest"; \
		ln -s "$${dir%/}" "$$dest"; \
		echo "Linked $${dir%/} to $$dest"; \
	done
