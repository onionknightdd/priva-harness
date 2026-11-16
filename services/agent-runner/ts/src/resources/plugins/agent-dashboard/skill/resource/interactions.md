# Interactions

Initialize string data before binding TextField or Select values. A Select's initial value must match an option. Buttons require an explicit `action={event:{name,context,userMessage}}` map with a concise, readable `userMessage`. Do not use the `Event(...)` shorthand: the installed compiler drops its `userMessage`.

Within the explicit event map, use `{"@path":"/region"}` to capture the current input value. The `$/region` shorthand works on input properties, but not inside the explicit event map. Event context is data, not executable code. The example emits the current title and selected region as a new user request.

![Regional report options](a2ui:report-options)

```a2ui id=report-options
$/title = "Q3 plan"
$/region = "Europe"
root = Column(children=[heading, title, region, submit])
heading = Heading(text="Regional report")
title = TextField(label="Report title", value=$/title, placeholder="Enter a title")
region = Select(label="Region", value=$/region, options=[{label:"North America",value:"North America"},{label:"Europe",value:"Europe"},{label:"Asia Pacific",value:"Asia Pacific"}])
submit = Button(label="Update report", action={event:{name:"update_report",context:{title:{"@path":"/title"},region:{"@path":"/region"}},userMessage:"Update the regional report"}})
```

The next user message contains its readable request followed by `<priva-a2ui-action>` JSON with `version:1`, `pluginId:"agent-dashboard"`, `messageId`, `embedId` and `action`. `action` includes `name`, `surfaceId`, `sourceComponentId`, `timestamp`, resolved `context` and `userMessage`. Use that submitted context when answering. A subsequent visual uses a complete new definition; it does not mutate the old reply.
