export const mediaSource = `
$/image = "http://127.0.0.1:5188/a2ui-media-fixtures/portrait.svg"
$/description = "Illustrative portrait orientation image"
$/status = "Revenue is increasing"
root = Column(children=[heading, images, icons])
heading = Heading(text="Images and icons", subtitle="Illustrative media for the component catalog")
images = Grid(children=[localCard, remoteCard], columns=2)
localCard = Card(children=[localImage], title="Workspace image", description="Contained image at its natural aspect ratio")
localImage = Image(url="sandbox:/a2ui-media-fixtures/landscape.svg", description="Illustrative landscape orientation image")
remoteCard = Card(children=[remoteImage], title="Remote image", description="Bound image URL and alternative text")
remoteImage = Image(url=$/image, description=$/description, fit="cover")
icons = Row(children=[activity, growth, caption, alert, search])
activity = Icon(name="activity", size="small", tone="muted")
growth = Icon(name="trending-up", tone="positive", label=$/status)
caption = Text(text="Revenue increased by 8.2%")
alert = Icon(name="triangle-alert", size="large", tone="negative", label="Attention required")
search = Icon(name="search", label="Search")
`.trim()
