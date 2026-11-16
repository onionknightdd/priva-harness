import type { Board, BoardColor, BoardElement, ShapeKind } from "../../../src/features/whiteboard/whiteboard-model"

type Point = [number, number]
/** Sample the approved SVG curves as pointer-like input to the production stroke renderer. */
function sampledCurves(start: Point, curves: [Point, Point, Point][]): Point[] {
  const points: Point[] = [start]
  let previous = start
  for (const [a, b, end] of curves) {
    for (let step = 1; step <= 12; step++) {
      const t = step / 12, inverse = 1 - t
      points.push([0, 1].map(axis => Math.round((inverse ** 3 * previous[axis] + 3 * inverse ** 2 * t * a[axis] + 3 * inverse * t ** 2 * b[axis] + t ** 3 * end[axis]) * 100) / 100) as Point)
    }
    previous = end
  }
  return points
}

const elements: Record<string, BoardElement> = {
  title: { type: "text", x: 36, y: 22, w: 250, h: 40, text: "白板是怎么更新的" },
  underline: { type: "stroke", x: 36, y: 56, w: 236, h: 16, color: "amber", width: 5, points: sampledCurves([2, 8], [[[54, 4], [114, 12], [169, 7]], [[224, 2], [226, 4], [232, 9]]]) },
  subtitle: { type: "text", x: 296, y: 34, w: 436, h: 30, text: "Agent 只提交改动的元素，页面沿路径把它画出来" },
  flow: { type: "container", x: 32, y: 104, w: 700, h: 272, text: "数据流" },
  browser: { type: "shape", kind: "rounded", x: 24, y: 72, w: 150, h: 88, parentId: "flow", color: "blue", text: "浏览器\n白板页面" },
  agent: { type: "shape", kind: "hexagon", x: 275, y: 72, w: 150, h: 88, parentId: "flow", color: "amber", text: "Agent" },
  file: { type: "shape", kind: "database", x: 526, y: 66, w: 150, h: 100, parentId: "flow", color: "green", text: "白板文件\n.board.json" },
  select: { type: "arrow", from: "browser", to: "agent", label: "选区" },
  write: { type: "arrow", from: "agent", to: "file", label: "增量写入" },
  return: { type: "arrow", from: "file", to: "browser", fromSide: "bottom", toSide: "bottom", label: "实时推送" },
  "return-circle": { type: "stroke", x: 330, y: 300, w: 110, h: 52, color: "amber", width: 3, points: sampledCurves([4, 27], [[[2, 6], [98, 3], [102, 25]], [[105, 46], [8, 49], [3, 30]]]) },
  vote: { type: "html", x: 772, y: 104, w: 396, h: 272, text: "元素投票", state: { votes: 3 }, html: `<style>body{margin:16px;font:14px system-ui}button{background:#e3ecff;border:0;border-radius:6px;padding:12px 20px;cursor:pointer}p{color:#666}</style><h3>白板里最常用哪种元素？</h3><button id="vote">块和箭头 · <span id="count">0</span> 票</button><p>点一下选项试试，它是真的在运行。</p><script>whiteboard.subscribe(s=>{document.getElementById('count').textContent=s?.votes||0});document.getElementById('vote').onclick=()=>whiteboard.setState({votes:(whiteboard.state?.votes||0)+1});</script>` },
  table: { type: "table", x: 772, y: 420, w: 396, h: 180, columns: ["元素", "进场方式", "层级"], rows: [["块", "轮廓画出后填色", "sm"], ["箭头", "沿路径画出", "—"], ["表格", "逐行出现", "sm"], ["内嵌应用", "放大并浮起", "md"]] },
  gallery: { type: "container", x: 32, y: 420, w: 700, h: 296, text: "12 种形状" },
}
const gallery: [ShapeKind, string, BoardColor][] = [
  ["rect", "矩形", "blue"], ["rounded", "圆角", "green"], ["ellipse", "椭圆", "amber"], ["diamond", "菱形", "rose"], ["pill", "胶囊", "violet"], ["hexagon", "六边形", "plain"],
  ["parallelogram", "平行四边形", "violet"], ["database", "数据库", "blue"], ["queue", "队列", "green"], ["document", "文档", "amber"], ["cloud", "云", "rose"], ["person", "角色", "plain"],
]
gallery.forEach(([kind, text, color], index) => {
  elements[kind] = { type: "shape", kind, x: 34 + index % 6 * 108, y: index < 6 ? 42 : 160, parentId: "gallery", w: 92, h: 62, color }
  elements[`${kind}-label`] = { type: "text", x: 34 + index % 6 * 108, y: (index < 6 ? 42 : 160) + 72, parentId: "gallery", w: 92, h: 25, text }
})
elements["stroke-caption"] = { type: "text", x: 772, y: 632, w: 396, h: 30, text: "笔迹和手绘图" }
elements.stroke = { type: "stroke", x: 772, y: 640, w: 396, h: 96, color: "violet", width: 4, points: sampledCurves([4, 52], [[[40, 10], [74, 90], [112, 50]], [[150, 10], [182, 10], [220, 50]], [[258, 90], [290, 90], [328, 50]], [[366, 10], [378, 22], [390, 36]]]) }
export const fixtureBoard: Board = { v: 1, title: "白板视觉样张", revision: 1, order: Object.keys(elements), elements }
