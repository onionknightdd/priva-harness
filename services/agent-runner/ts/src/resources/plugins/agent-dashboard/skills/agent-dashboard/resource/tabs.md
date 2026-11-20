# Tabbed views

Use `Tabs(tabs=[{title:"Overview",child:overview}, ...])` to group related views in one conversation-width container. Supply 1–8 tabs with short, nonblank literal titles of at most 80 characters. Each `child` is a component reference, not quoted content; use a Column when a tab needs several components. The first tab is initially selected. The host supplies the rounded frame, selected-tab styling and directional slide transition; do not supply CSS, animation properties or a separate tab button row.

Switching tabs is local and sends no message or model request. Bound form values survive switching away and back while the visual remains mounted. A reload starts again from the first tab and the initial data values in the source. Only an explicit Button action submits form values as a new user message. All tabs remain within the conversation width; keep titles short for narrow screens.

The sales figures below are illustrative.

![Sales views](a2ui:sales-views)

```a2ui id=sales-views
$/title = "Q3 plan"
$/region = "Europe"
root = Tabs(tabs=[{title:"Overview",child:overview},{title:"Regions",child:regions},{title:"Report",child:report}])
overview = Column(children=[heading, metrics, trend])
heading = Heading(text="Q3 sales performance", subtitle="Illustrative sales data across regional teams", eyebrow="Commercial operations")
metrics = Grid(children=[revenue, growth], columns=2)
revenue = Stat(label="Total revenue", value="$14.8M", delta="+8.2%", caption="vs $13.7M target", trend="up")
growth = Stat(label="YoY growth", value="14.2%", delta="+2.1%", caption="vs Q3 prior year", trend="up")
trend = LineChart(title="Quarterly revenue", labels=["Q1","Q2","Q3","Q4"], series=[{name:"Revenue",values:[10.2,12.1,14.8,16.3]}], format="currency", unit="M")
regions = Table(columns=["Region","Revenue","Target attainment"], rows=[["North America","$6.1M","109%"],["Europe","$4.3M","102%"],["Asia Pacific","$3.2M","114%"],["Latin America","$1.2M","109%"]], title="Regional detail")
report = Column(children=[reportHeading, title, region, submit])
reportHeading = Heading(text="Regional report", subtitle="Choose the next report to request")
title = TextField(label="Report title", value=$/title, placeholder="Enter a title")
region = Select(label="Region", value=$/region, options=[{label:"North America",value:"North America"},{label:"Europe",value:"Europe"},{label:"Asia Pacific",value:"Asia Pacific"},{label:"Latin America",value:"Latin America"}])
submit = Button(label="Update report", action={event:{name:"update_report",context:{title:{"@path":"/title"},region:{"@path":"/region"}},userMessage:"Update the regional report"}})
```
