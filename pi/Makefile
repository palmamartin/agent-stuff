EXTENSIONS_SRC := extensions
EXTENSIONS_DEST := $(HOME)/.pi/agent/extensions

.PHONY: extensions

extensions:
	@mkdir -p $(EXTENSIONS_DEST)
	@for item in $(EXTENSIONS_SRC)/*; do \
		name=$$(basename "$$item"); \
		ln -sf "$$(pwd)/$$item" "$(EXTENSIONS_DEST)/$$name"; \
		echo "Linked $$name -> $(EXTENSIONS_DEST)/$$name"; \
	done
