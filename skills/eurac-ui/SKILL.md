---
name: eurac-ui
description: Apply Eurac's official color tokens when creating, implementing, styling, or revising user interfaces. Use for UI components, pages, web apps, prototypes, design systems, themes, CSS, Tailwind configurations, and other frontend or product-interface work intended for Eurac, including requests that do not explicitly repeat the palette.
---

# Eurac UI

Use the Eurac palette as the source of truth for interface colors. Preserve the project's existing framework, component patterns, and token conventions.

## Color tokens

Use these exact values; do not approximate or silently substitute them.

| Token | Hex |
| --- | --- |
| Red primary | `#DF1B12` |
| Grey primary | `#404649` |
| Grey 80% | `#666B6C` |
| Grey 60% | `#8C9091` |
| Grey 40% | `#B2B5B6` |
| Grey 20% | `#D8DADA` |
| Grey 15% | `#E2E3E4` |
| Grey 5% | `#F5F5F5` |

When introducing CSS custom properties, prefer:

```css
:root {
  --eurac-red-primary: #df1b12;
  --eurac-grey-primary: #404649;
  --eurac-grey-80: #666b6c;
  --eurac-grey-60: #8c9091;
  --eurac-grey-40: #b2b5b6;
  --eurac-grey-20: #d8dada;
  --eurac-grey-15: #e2e3e4;
  --eurac-grey-5: #f5f5f5;
}
```

Adapt these names to an established theme or design-token system instead of creating a parallel system.

## Apply the palette

- Use red primary for brand emphasis, primary actions, selected states, and focus accents with restraint.
- Use grey primary for primary text and strong neutral UI.
- Use the intermediate greys for secondary text, disabled states, icons, dividers, and borders only when the resulting contrast remains accessible.
- Use grey 5%, grey 15%, and grey 20% for subtle surfaces and structural separation.
- Prefer semantic aliases such as `color-action-primary`, `color-text-primary`, and `color-border-subtle` when the project already uses semantic tokens; map those aliases to the Eurac values.
- Reuse existing tokens when their values already match. Replace hard-coded near-matches when doing so is within the requested scope.
- Do not invent additional Eurac brand colors. Preserve an existing semantic color for a state the palette does not cover, such as success or warning, or call out that a separate approved token is needed.

## Verify the result

- Check text, controls, icons, borders, hover states, focus states, and disabled states—not only the default component appearance.
- Verify WCAG contrast for each foreground/background pairing. Do not assume every supplied brand color is suitable for text at every size.
- Keep color values centralized in the project's token or theme layer whenever practical.
- Report any required color that the supplied palette cannot represent accessibly or semantically.
