export const formActionSource = `
$/title = "Q3 plan"
$/region = "Europe"
root = Column(children=[heading, title, region, submit])
heading = Heading(text="Regional report")
title = TextField(label="Report title", value=$/title)
region = Select(label="Region", value=$/region, options=[{label:"North America",value:"North America"},{label:"Europe",value:"Europe"},{label:"Asia Pacific",value:"Asia Pacific"}])
submit = Button(label="Update report", action={event:{name:"update_report",context:{title:{"@path":"/title"},region:{"@path":"/region"}},userMessage:"Update the regional report"}})
`.trim()
