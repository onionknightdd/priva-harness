export const modelEn = {
  title: "3D preview", view: "View", fit: "Fit to view", front: "Front", top: "Top", right: "Right", tools: "Tools",
  select: "Select", distance: "Distance", angle: "Angle", clip: "Section", points: "Point cloud", screenshot: "Save screenshot", ask: "Add to chat",
  play: "Play animation", pause: "Pause animation", close: "Close settings", clear: "Clear selection", hide: "Hide part", isolate: "Isolate part", showAll: "Show all",
  unit: "Display unit", sourceUnit: "Source unit", unknown: "Unknown / model units", modelUnit: "model units", declareUnit: "Declare the source unit before using physical measurements.",
  clipEnabled: "Enable section", axis: "Axis", position: "Position", reverse: "Reverse", pointSize: "Point size", color: "Color", original: "Original colors", solid: "Single color", height: "Z coordinate", budget: "Point budget",
  download: "Download file", retry: "Retry", cancel: "Cancel", cancelled: "Loading cancelled", loading: "Loading model…", downloadPhase: "Downloading", parse: "Parsing geometry", convert: "Preparing point cloud", decode: "Decoding",
  ready: "Ready", selection: "Selection", noSelection: "Select a part or a point in the scene.", distanceHint: "Click two points; drag to rotate freely. Esc clears the selection.", angleHint: "Click three points; the middle point is the vertex.", navigateHint: "Drag to rotate freely; right-drag to pan; scroll to zoom. Touch: one finger rotates, two fingers pan or pinch. Home resets the view, + / − zoom.",
  approximate: "Measurements use rendered geometry. Sections do not create capped CAD geometry.", pointsApproximate: "Measurements use the selected displayed points.", stale: "The file or its dependencies changed. This saved selection cannot be restored.",
  sent: "Selection added to the chat draft", sendFailed: "The chat input is not available", askPlaceholder: "Question about this selection (optional)", askDefault: "Explain this 3D selection and its measurements.",
  objects: "triangles", pointCount: "points", noAngle: "Choose distinct points", webglLost: "The graphics context was lost. Retry to reopen the model.",
  sourceCoordinates: "Source coordinates", screenshotFailed: "Screenshot could not be saved", includeScreenshot: "Include screenshot",
}

export const modelZhCN: typeof modelEn = {
  title: "3D 预览", view: "视角", fit: "适应窗口", front: "正视", top: "俯视", right: "右视", tools: "工具",
  select: "选择", distance: "距离", angle: "角度", clip: "剖切", points: "点云", screenshot: "保存截图", ask: "加入提问",
  play: "播放动画", pause: "暂停动画", close: "关闭设置", clear: "清除选择", hide: "隐藏部件", isolate: "隔离部件", showAll: "显示全部",
  unit: "显示单位", sourceUnit: "原始单位", unknown: "未知 / 模型单位", modelUnit: "模型单位", declareUnit: "请先声明原始单位，再进行物理尺寸测量。",
  clipEnabled: "启用剖切", axis: "方向", position: "位置", reverse: "反向", pointSize: "点大小", color: "颜色", original: "原始颜色", solid: "单色", height: "Z 坐标", budget: "显示点数上限",
  download: "下载文件", retry: "重试", cancel: "取消", cancelled: "已取消加载", loading: "正在加载模型…", downloadPhase: "读取文件", parse: "解析几何", convert: "准备点云", decode: "解码",
  ready: "就绪", selection: "选中内容", noSelection: "在场景中选择部件或点。", distanceHint: "点击两个点测距；拖动自由旋转，Esc 清除选择。", angleHint: "依次点击三个点，中间点为角的顶点。", navigateHint: "拖动自由旋转，右键拖动平移，滚轮缩放；触屏单指旋转、双指平移或捏合；Home 重置视角，+ / − 缩放。",
  approximate: "测量基于显示的几何；剖切查看不会生成 CAD 封口几何。", pointsApproximate: "测量基于选中的显示点。", stale: "文件或附属资源已变化，无法恢复这条历史选区。",
  sent: "已加入聊天草稿", sendFailed: "聊天输入框暂不可用", askPlaceholder: "针对选中内容提问（可选）", askDefault: "解释这个 3D 选区及其测量结果。",
  objects: "三角面", pointCount: "点", noAngle: "请选择不同位置的点", webglLost: "图形上下文已丢失，请重试打开模型。",
  sourceCoordinates: "原始坐标", screenshotFailed: "无法保存截图", includeScreenshot: "附带截图",
}
