# Images and icons

Use `Image` when the user supplied an image or a tool returned a verified image source. It displays that image; it does not generate or search for images. Use `Icon` for a compact visual cue beside text or with an accessible label. Both compose with existing Row, Grid, Card, Column and Tabs components.

```text
Known image source -> Image(url, description) -> responsive image
Catalog icon name  -> Icon(name, tone, label) -> static Lucide icon
```

## Images

`Image(url=..., description=..., fit=...)` requires both `url` and `description`. Both support initialized string bindings. Describe the image's useful content in `description`; it becomes alternative text for assistive technology.

- For a workspace image, use `sandbox:/absolute/path/to/image.png`. Windows absolute paths can use `sandbox:C:/workspace/image.png`. The host reads it through its existing file endpoint.
- For a remote image, use the exact HTTP(S) URL supplied by the user or verified in a tool result. Preserve signed query parameters. The browser loads it directly, so it must be accessible to the user and remain available when history is reopened.
- Do not use relative or bare filesystem paths, `file:`, `data:`, `blob:`, image bytes or another URL scheme. Do not invent a placeholder URL or path to complete a dashboard.
- The default `fit="contain"` shows the entire image within the conversation width and a 24rem maximum image height, preserving its aspect ratio. `fit="cover"` fills a 16:9 frame, also capped at 24rem high; use it only when cropping is acceptable. The renderer controls dimensions, loading feedback and error/retry feedback; do not add CSS, width or height properties.
- The image source is saved with the message, not copied into it. The referenced file or remote image must still exist for later viewing.

The following example assumes a tool has already confirmed that `/workspace/reports/quarterly-sales.png` exists. Replace that path with a known image from the current task; otherwise omit the Image.

![Quarterly sales image](a2ui:sales-image)

```a2ui id=sales-image
$/image = "sandbox:/workspace/reports/quarterly-sales.png"
root = Card(children=[report], title="Quarterly sales", description="Chart image from the workspace report")
report = Image(url=$/image, description="Quarterly sales chart comparing actual revenue with the target", fit="contain")
```

## Icons

Use a literal `name` from the Icon enum in [catalog.md](catalog.md). The available names are:

```text
activity, arrow-down, arrow-left, arrow-right, arrow-up,
bell, calendar, chart-column, chart-line, chart-pie,
check, circle-check, circle-help, circle-x, clock,
credit-card, dollar-sign, download, file-text, folder,
globe, heart, house, image, info, mail, map-pin,
package, percent, search, settings, shopping-cart,
star, target, trending-down, trending-up, triangle-alert,
upload, user, users, x
```

`size` is `small` (16px), `medium` (20px, default) or `large` (32px). `tone` is `default`, `muted`, `positive` or `negative`. Do not provide colors, custom SVG paths or a URL.

Omit `label` for a decorative icon beside text that already describes its meaning. Set `label` when the icon communicates meaning on its own; it supports an initialized string binding. Icons have no click action. Do not add an `icon` property to Button; use a Row to place an icon beside supported components when appropriate.

![Sales status icons](a2ui:sales-status)

```a2ui id=sales-status
$/status = "Report is ready"
root = Column(children=[growth, ready])
growth = Row(children=[trend, summary])
trend = Icon(name="trending-up", size="medium", tone="positive")
summary = Text(text="Revenue increased by 8.2%")
ready = Icon(name="circle-check", size="large", tone="positive", label=$/status)
```
