# Charts

BarChart, LineChart and AreaChart accept `labels: string[]` and `series: {name: string, values: number[]}[]`. Each series must have exactly one value per label. DonutChart accepts `labels` and one non-negative `values` array of equal length with a positive total. Choose `format="currency"` for dollar-prefixed values and `unit="M"` when the underlying numbers are in millions. Percent format displays the supplied number as a percentage (supply `14.2` for 14.2%).

These are illustrative datasets. Keep full category names; the renderer manages truncation and tooltips.

![Revenue trends and regional mix](a2ui:revenue-charts)

```a2ui id=revenue-charts
root = Column(children=[bar, line, area, donut])
bar = BarChart(title="Regional performance vs target", description="Q3 revenue in millions", labels=["North America","Europe","Asia Pacific","Latin America"], series=[{name:"Actual",values:[6.1,4.3,3.2,1.2]},{name:"Target",values:[5.6,4.2,2.8,1.1]}], format="currency", unit="M")
line = LineChart(title="Quarterly revenue", labels=["Q1","Q2","Q3","Q4"], series=[{name:"Revenue",values:[10.2,12.1,14.8,16.3]}], format="currency", unit="M")
area = AreaChart(title="Monthly pipeline", labels=["July","August","September"], series=[{name:"Enterprise",values:[5.1,6.2,7.3]},{name:"Growth",values:[2.8,3.4,4.1]}], format="currency", unit="M")
donut = DonutChart(title="Regional revenue share", labels=["North America","Europe","Asia Pacific","Latin America"], values=[6.1,4.3,3.2,1.2], format="currency", unit="M")
```
