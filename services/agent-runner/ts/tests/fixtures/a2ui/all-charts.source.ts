export const allChartsSource = `
root = Column(children=[heading, line, area, donut, table])
heading = Heading(text="Sales analysis", subtitle="Illustrative fixtures for every chart and table component")
line = LineChart(title="Quarterly revenue", labels=["Q1","Q2","Q3","Q4"], series=[{name:"Revenue",values:[10.2,12.1,14.8,16.3]}], format="currency", unit="M")
area = AreaChart(title="Monthly pipeline", labels=["July","August","September"], series=[{name:"Enterprise",values:[5.1,6.2,7.3]},{name:"Growth",values:[2.8,3.4,4.1]}], format="currency", unit="M")
donut = DonutChart(title="Regional revenue share", labels=["North America","Europe","Asia Pacific","Latin America"], values=[6.1,4.3,3.2,1.2], format="currency", unit="M")
table = Table(columns=["Region","Revenue","Target attainment"], rows=[["North America","$6.1M","109%"],["Europe","$4.3M","102%"],["Asia Pacific","$3.2M","114%"],["Latin America","$1.2M","109%"]], title="Regional detail")
`.trim()
