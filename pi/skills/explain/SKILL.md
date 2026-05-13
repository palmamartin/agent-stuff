---
name: explain
description: "Use diagrams when explain concecpts, codepaths piplines workflows and more"
---

Use this skill when the user ask for explaination of a concept,h codepath, pipline, workflow...
 
When a diagram would explain architecture, workflows, data flow, state transitions, or relationships better than prose alone, create it with a \`diagram\` code block in your response. Use plain text or box-drawing characters, preferably rounded-corner boxes (\`╭\`, \`╮\`, \`╰\`, \`╯\`), inside \`diagram\` blocks. There is no Mermaid tool or renderer: do not write Mermaid syntax such as \`graph TD\` or \`sequenceDiagram\`, and do not use \`mermaid\` code fences. Keep diagrams readable in monospaced text.

Example:
\`\`\`diagram
╭────────╮     ╭─────╮     ╭──────────╮
│ Client │────▶│ API │────▶│ Database │
╰────┬───╯     ╰──┬──╯     ╰──────────╯
     │            │
     │            ▼
     │        ╭────────╮
     ╰───────▶│ Worker │
              ╰────────╯
\`\`\`
