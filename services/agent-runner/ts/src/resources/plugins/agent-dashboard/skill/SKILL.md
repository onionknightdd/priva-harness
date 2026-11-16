---
name: agent-dashboard
description: Show interactive dashboards, charts, cards, tables and forms inside conversation replies using the registered A2UI components.
---

# Agent dashboard

Create a readable visual answer from the user's data. Use a chart for trends or comparisons, cards for a few key metrics, tables for exact values, and forms or buttons when a choice helps the next conversation turn. Label illustrative data clearly. The renderer supplies the visual styling; write A2UI Express, not HTML, JavaScript, JSX, CSS or protocol JSON.

## Embed in an assistant reply

Put an image-style reference in its own paragraph, and a matching complete A2UI code block anywhere in the **same assistant message**. The reference's alt text is the readable title. Each id has exactly one reference and one definition per message; use different ids for multiple visuals. Ids match `[a-z][a-z0-9-]{0,63}`.

````markdown
![Regional sales](a2ui:regional-sales)

```a2ui id=regional-sales
root = Table(columns=["Region", "Sales"], rows=[["Europe", 4200000]], title="Regional sales")
```
````

Write the source directly over multiple lines. Do not URL-encode or Base64-encode it. Close the fence before continuing your reply. The display is compiled after the complete block arrives and its source is saved with the reply. This is not a tool call, and compilation errors are not automatically returned to the model for retries. If the user reports an error, correct the source and publish a complete replacement in a new reply.

## Express rules

- Define components with `id = Component(property=value, ...)` and assign exactly one `root`. References can appear before their definitions. Use `children=[first, second]` for containers.
- The host creates a fresh `main` surface for each embed. Do not issue `surface(...)` or delete operations, select another surface, or refer to components in another embed.
- Use only the components and properties in [resource/catalog.md](resource/catalog.md). Unknown properties are rejected. Read the relevant example before composing an unfamiliar component.
- Initialize bindings with `$/path = value`, then bind string properties with `text=$/path`. Only absolute initialized bindings and explicit children lists are supported. TextField and Select values must bind to initialized strings.
- Keep each source under 64,000 characters and 200 components. Repeated subtrees are limited to 1,000 rendered nodes. Split larger results into independent embeds.

## Examples

- [resource/cards.md](resource/cards.md): metric cards and supporting text.
- [resource/charts.md](resource/charts.md): bar, line, area and donut charts with consistent units.
- [resource/tables.md](resource/tables.md): string column labels and arrays of string/number cells.
- [resource/interactions.md](resource/interactions.md): editable fields, choices and structured button events.
- [resource/dashboard.md](resource/dashboard.md): sales dashboard with heading, metrics and chart.

Buttons send a new user message with resolved form values; they do not execute code or call external APIs. For incoming `<priva-a2ui-action>` JSON, use `action.context` as the user's submitted choice. Its `pluginId`, `messageId` and `embedId` identify the originating visual. Answer normally or publish a complete new embed; earlier replies remain in history.
