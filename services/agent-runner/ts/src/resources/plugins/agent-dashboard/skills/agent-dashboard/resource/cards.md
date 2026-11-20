# Cards

Use `Heading` for a title, `Grid` for related metrics, and `Stat` for each metric. The renderer adjusts the columns to available width. `value`, `delta` and `caption` are display strings; supply units explicitly. The following values are illustrative.

![Sales overview](a2ui:sales-overview)

```a2ui id=sales-overview
root = Column(children=[heading, metrics, note])
heading = Heading(text="Sales overview", eyebrow="Commercial operations", subtitle="Illustrative quarterly metrics")
metrics = Grid(children=[revenue, attainment, growth, top], columns=4)
revenue = Stat(label="Total revenue", value="$14.8M", delta="+8.2%", caption="vs $13.7M target", trend="up")
attainment = Stat(label="Target attainment", value="108%", delta="+4.5%", caption="100% baseline", trend="up")
growth = Stat(label="YoY growth", value="14.2%", delta="+2.1%", caption="vs prior year", trend="up")
top = Stat(label="Top region", value="North America", caption="41% of quarterly total")
note = Card(children=[status, explanation], title="Quarterly review")
status = Badge(text="Ahead of target", tone="positive")
explanation = Text(text="Revenue is above the quarterly plan.", tone="muted")
```
