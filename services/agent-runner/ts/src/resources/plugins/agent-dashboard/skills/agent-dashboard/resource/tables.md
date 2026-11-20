# Tables

`Table(columns: string[], rows: (string | number)[][], title?: string)` uses plain column labels and cell arrays. Column-definition objects, row objects, booleans, nulls and nested objects are not accepted. Each row has exactly as many cells as columns. Represent missing values with a readable string such as `"—"`. There may be up to 12 columns and 200 rows.

![Regional revenue detail](a2ui:regional-table)

```a2ui id=regional-table
root = Table(columns=["Region","Revenue","Target attainment"], rows=[["North America","$6.1M","109%"],["Europe","$4.3M","102%"],["Asia Pacific","$3.2M","114%"],["Latin America","$1.2M","109%"]], title="Illustrative regional detail")
```
