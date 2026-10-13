import { CFB } from "xlsx"

// Tiny real OOXML packages, built in memory using the existing SheetJS ZIP writer.
function zip(files: Record<string, string>) {
  const archive = CFB.utils.cfb_new()
  for (const [name, text] of Object.entries(files)) {
    CFB.utils.cfb_add(archive, name, new TextEncoder().encode(text))
  }
  return new Uint8Array(CFB.write(archive, { fileType: "zip", type: "array" })).buffer
}

const relationships = (entries: string) => '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + entries + "</Relationships>"
const relationship = (id: string, type: string, target: string) => '<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + type + '" Target="' + target + '"/>'
const types = (entries: string) => '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + entries + "</Types>"
const override = (part: string, type: string) => '<Override PartName="/' + part + '" ContentType="' + type + '"/>'

export function docxFixture() {
  const paragraph = (text: string) => '<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="28"/></w:rPr><w:t>' + text + '</w:t></w:r></w:p>'
  return zip({
    "[Content_Types].xml": types(override("word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")),
    "_rels/.rels": relationships(relationship("rId1", "officeDocument", "word/document.xml")),
    "word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      paragraph("Hello Word preview") +
      '<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr>' + paragraph("Table cell") + '</w:tc><w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr>' + paragraph("中文表格") + '</w:tc></w:tr></w:tbl>' +
      '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + paragraph("Second Word page") +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr></w:body></w:document>',
  })
}

export function xlsxFixture() {
  const sheetStart = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  return zip({
    "[Content_Types].xml": types(
      override("xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml") +
      override("xl/styles.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml") +
      [1, 2].map((i) => override("xl/worksheets/sheet" + i + ".xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")).join("")
    ),
    "_rels/.rels": relationships(relationship("rId1", "officeDocument", "xl/workbook.xml")),
    "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Main" sheetId="1" r:id="rId1"/><sheet name="第二页" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": relationships(relationship("rId1", "worksheet", "worksheets/sheet1.xml") + relationship("rId2", "worksheet", "worksheets/sheet2.xml") + relationship("rId3", "styles", "styles.xml")),
    "xl/styles.xml": '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="12"/><name val="Arial"/></font><font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/></cellXfs></styleSheet>',
    "xl/worksheets/sheet1.xml": sheetStart + '<dimension ref="A1:AO600"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="3" width="18" customWidth="1"/></cols><sheetData><row r="1" ht="30" customHeight="1"><c r="A1" t="inlineStr" s="1"><is><t>Name</t></is></c><c r="B1" t="inlineStr" s="1"><is><t>Value</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Alpha</t></is></c><c r="B2"><v>12</v></c><c r="C2"><f>SUM(B2,8)</f><v>20</v></c><c r="AO2" t="inlineStr"><is><t>Beyond 40 columns</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Beta 中文</t></is></c><c r="C3" t="inlineStr"><is><t>tail</t></is></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>Merged cells</t></is></c></row><row r="600"><c r="A600" t="inlineStr"><is><t>Beyond 500 rows</t></is></c></row></sheetData><mergeCells count="1"><mergeCell ref="A4:C4"/></mergeCells></worksheet>',
    "xl/worksheets/sheet2.xml": sheetStart + '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>第二页内容</t></is></c></row></sheetData></worksheet>',
  })
}

export function xlsxManySheetsFixture() {
  const names = Array.from({ length: 24 }, (_, index) =>
    "Sheet " + String(index + 1).padStart(2, "0") + " - Quarterly report"
  )
  const files: Record<string, string> = {
    "[Content_Types].xml": types(
      override("xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml") +
      override("xl/styles.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml") +
      names.map((_, index) => override("xl/worksheets/sheet" + (index + 1) + ".xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")).join("")
    ),
    "_rels/.rels": relationships(relationship("rId1", "officeDocument", "xl/workbook.xml")),
    "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      names.map((name, index) => '<sheet name="' + name + '" sheetId="' + (index + 1) + '" r:id="rId' + (index + 1) + '"/>').join("") + '</sheets></workbook>',
    "xl/_rels/workbook.xml.rels": relationships(names.map((_, index) => relationship("rId" + (index + 1), "worksheet", "worksheets/sheet" + (index + 1) + ".xml")).join("") + relationship("styles", "styles", "styles.xml")),
    "xl/styles.xml": '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="12"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>',
  }
  names.forEach((name, index) => {
    files["xl/worksheets/sheet" + (index + 1) + ".xml"] = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>' + name + '</t></is></c></row></sheetData></worksheet>'
  })
  return zip(files)
}

export function pptxFixture() {
  const slides = ["Hello Office preview", "Second slide 中文"]
  const files: Record<string, string> = {
    "[Content_Types].xml": types(
      override("ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml") +
      slides.map((_, i) => override("ppt/slides/slide" + (i + 1) + ".xml", "application/vnd.openxmlformats-officedocument.presentationml.slide+xml")).join("")
    ),
    "_rels/.rels": relationships(relationship("rId1", "officeDocument", "ppt/presentation.xml")),
    "ppt/presentation.xml": '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
    "ppt/_rels/presentation.xml.rels": relationships(slides.map((_, i) => relationship("rId" + (i + 1), "slide", "slides/slide" + (i + 1) + ".xml")).join("")),
  }
  slides.forEach((text, i) => {
    files["ppt/slides/slide" + (i + 1) + ".xml"] = '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="7315200" cy="1828800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2800"><a:solidFill><a:srgbClr val="111111"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>' + text + '</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
  })
  return zip(files)
}
