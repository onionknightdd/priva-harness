# 前端组件与设计规范

本文件是前端规范、组件查找入口和开发验证命令的统一维护位置，由根目录
[AGENTS.md](../AGENTS.md) 强制引用。文件名沿用项目约定的 `front-end-desgin.md`。

盘点日期：2026-09-08。范围为当前工作区的 `agent-ui/src/`，包含尚未提交的
Resources / 上传相关实现。结论来自组件源码、业务调用点、主入口的导入关系、
依赖和 registry 配置；没有进行逐屏浏览器视觉验收。

“现行规范”保留从 `AGENTS.md` 迁入的要求；“现状”描述代码；“建议”是后续
收敛方向。已经实施的选型单列记录，优先于初次盘点时的建议。

- [现行前端规范](#frontend-implementation)
- [布局沟通与审批](#layout-approval)
- [现有风格与组件来源](#current-baseline)
- [按组件类型查找](#component-catalog)
- [统一选型建议](#recommendations)
- [开发与验证命令](#development-and-verification)

## Frontend implementation

以下条款从根目录 `AGENTS.md` 原样迁入，继续生效。

- All frontend work must use a consistent `shadcn/ui` visual language and
  component style across every screen and feature.
- Reuse and compose `shadcn/ui` components and primitives before creating
  custom equivalents. Extend them only when the product requirement cannot be
  met through composition.
- Define colors, typography, spacing, radii, and other visual decisions through
  shared theme tokens. Do not introduce isolated styles that diverge from the
  established design system.
- Use shadcn/ui for foundational UI components and visual structure.
- Prefer Animate UI for ready-made animated components that satisfy the product
  requirement.
- Use Motion for custom React interactions, gestures, and component-level state
  transitions.
- Reserve GSAP for the small number of complex scroll-driven or timeline-based
  animations that Motion does not express clearly.
- Every user-facing frontend implementation must include purposeful motion.
  Motion should clarify hierarchy, state changes, or user feedback rather than
  serve as decoration alone.
- Keep animation behavior consistent and reusable. Scope animation timelines
  and contexts to component lifecycles and clean them up when components
  unmount.
- Respect `prefers-reduced-motion` and provide a usable reduced-motion or
  no-motion experience without removing access to content or functionality.
- Preserve responsive behavior, keyboard navigation, visible focus states, and
  semantic accessibility while styling and animating interfaces.

### 已实施的组件选型

2026-09-08：按用户指定，所有现有布尔开关统一为
`@animate-ui/components-radix-switch`。默认入口是
[Animate UI Switch](../agent-ui/src/components/animate-ui/components/radix/switch.tsx)，
使用 Radix UI + Motion；这是通用 Base UI 基线之外的明确选型。

```text
Agent 输入建议 / 模型默认项 / Skill 启停
                    |
                    v
components/animate-ui/components/radix/switch.tsx
                    |
                    v
primitives/radix/switch.tsx -> Radix UI + Motion
```

默认使用 32 × 20px 轨道、16px 滑块与按压伸展；Skill 启停使用 `size="sm"` 的
24 × 15px 轨道和 11px 滑块。激活轨道读取共享
`toggle-active` token，浅色 / 深色均为 `rgb(78, 130, 239)`（`#4E82EF`）；其余颜色
继续读取项目 `input`、`background` 等 token。减少动态效果时立即切换状态，并关闭滑块
位移与按压伸展动画。受控开关以调用方的 `checked` 为准，包括等待服务端保存的状态。
旧 `ui/switch.tsx` 已移除，不建立兼容转发入口。

文件预览的 ToggleGroup 表达多项模式选择，主题、语言和工作区按钮也有各自用途；
它们不属于本次统一的三个布尔开关调用点。新建同类布尔开关使用上述入口。

安装命令（在 `agent-ui/`）：

```sh
npx shadcn@latest add @animate-ui/components-radix-switch
```

上游说明见 [Animate UI Radix Switch](https://animate-ui.com/docs/components/radix/switch)。
当前 shadcn CLI 在 `base-vega` 项目中会将上游 `asChild` 自动转换为 `render`，
但该 Radix 组件需要 `asChild`。本地原语已恢复 Radix 组合 API，并补充 reduced-motion
及受控状态处理；再次安装或升级时须审阅差异并运行下面的 Switch 浏览器检查。

### Tab 与侧栏底色

2026-09-09：按用户确认，以下背景色仅用于浅色主题。Tab 修改整组标签栏的底色；
通用 Tabs 的所有变体和 Skill 预览 Tabs 共用 `tabs-background`。
主侧栏和工作区侧栏统一底色，选中项使用 `sidebar-active`，悬浮使用 `sidebar-accent`。
深色主题保留各组件原有配色。

2026-09-10：Workspace 标签栏在浅色和深色主题下均使用透明背景。

```text
TabsList / Animate UI TabsList
  -> tabs-background: rgb(229, 229, 229)  #E5E5E5
Workspace tab bar
  -> transparent
Main sidebar / Workspace sidebar
  -> sidebar: rgb(245, 245, 245)          #F5F5F5
  -> sidebar-active: rgb(229, 229, 229)   #E5E5E5
  -> sidebar-accent: rgb(239, 240, 240)   #EFF0F0
```

### 焦点框与用户消息底色

2026-09-10：应用焦点框统一使用 `ring-inset`，包括共享 `focusRing`、基础组件、
组合输入框的 `focus-within` / `has-focus-visible` 容器，以及独立可聚焦区域。
焦点框不再叠加向外的 ring offset 或 outline；保留现有宽度、颜色和过渡。
可视化沙箱内置按钮用等效的 inset box-shadow 绘制焦点框。

用户消息气泡读取 `user-message` token：浅色为 `rgb(234, 243, 253)`（`#EAF3FD`），
深色为 `rgb(34, 61, 114)`（`#223D72`）。深色弹出菜单共用 `popover` token，
统一为 `rgb(53, 53, 53)`（`#353535`），覆盖下拉 / 右键 / 选择菜单、Popover、
附件菜单与 Slash 命令菜单。

```text
Keyboard focus -> ring-inset
User MessageContent -> user-message -> light: #EAF3FD
                                   -> dark: #223D72
Dark popup menus -> popover -> #353535
```

### Skills 搜索与预览 Tab

2026-09-10：按最新调整，Skills 移除项目范围筛选及对应的 Combobox / Command 组件。
标题右侧的搜索图标参照侧栏项目区，点击后在标题右侧展开输入框，标题、刷新和上传保持可见，占位文本为“搜索技能”
（英文为“Search skills”），支持自动聚焦和 Esc 清空收起。
搜索位于刷新、上传之前；与项目搜索共用 `header-search-motion.ts` 和
`SPRING_HEADER_SEARCH`，同步弹簧展开和搜索图标位移。键盘操作和减少动态效果时，
Skill 搜索立即切换。分组折叠图标位于标题文字右侧、分割线之前。
右栏模式使用 `@animate-ui/components-radix-tabs`，按用户指定采用 Radix + Motion。
这项选择作用于 Skill 预览和 MCP 详情，其他功能的 Tabs 沿用各自入口。
左栏“技能”标题使用 18px，右栏 Skill 名称使用 16px，描述使用 12px / 20px 行高。文件工具栏高 36px，Tab 组高
24px；高亮容器和按钮撑满内部高度，以 flex 垂直居中文字并保留原有指示器动效。
左栏标题和说明随应用语言切换：中文标题为“技能”，说明为“技能是用于扩展 Agent
能力的指令。”，说明使用 12px 二级文本并在搜索展开时保留。Skill、Workspace 与
“数据与用量 → 文件浏览器”的文件树统一采用上下内边距各 3px、行间距 1px、行高和
嵌套吸顶步长 26px；`compact` 属性仍只控制元数据列。Skill 条目之间另加 2px 间距，
不影响条目内部的文件树间距。Markdown 源文件保留原始内容、frontmatter 和行号，
并启用共享 Shiki 的 Markdown 语法高亮；其他源文件仍使用带行号的纯文本。
Skill 启停开关采用 `size="sm"`（24 × 15px 轨道、11px 滑块），保存期间保持透明度，
其他开关保留默认尺寸和动效。

```text
技能标题 | 搜索图标 / 展开的输入框 | 刷新 | 上传
                          └─ 本地过滤资源
工具栏左侧路径 / 右侧复制按钮
文件模式 -> Animate UI Radix Tabs -> 源文件 / 预览
                                    └─ 复用 files/preview 渲染器
```

安装命令（在 `agent-ui/`）：

```sh
npx shadcn@latest add @animate-ui/components-radix-tabs
```

保留已有共享组件，安装后的 Radix Tabs 原语须使用 `asChild`，不能使用 CLI 在
Base UI 工程中转换出的 `render`。文件正文不做高度布局动画或模糊过渡；仅 Tab 指示器
做短时状态切换，减少动态效果时立即更新。Skill 分组复用 `ui/collapsible` 与现有
`collapsePanel` 动效样式。

### Mermaid 模块加载失败

2026-09-11：Markdown 图表使用局部 `MermaidRenderBoundary`。异步模块加载或图表
渲染抛错时，仅该图表切换为带错误提示的源代码块，保留复制与换行操作；其他消息继续
显示并可交互。错误提示支持中英文，刷新页面后重新加载图表。

```text
Markdown Mermaid block -> MermaidRenderBoundary -> rendered diagram
                                  |
                             load/render error
                                  v
                         notice + original source
```

开发环境遇到 `504 Outdated Optimize Dep` 时，先重启 Vite 并使用 `npm run dev -- --force`
重建依赖缓存，再刷新浏览器。独立验证服务需使用单独的 `cacheDir`，避免覆盖正在运行的
开发服务缓存；优先复用已经运行的开发服务。

### 工作状态加载动效

2026-09-11：按用户截图指定，在消息列表 `WorkingStatusLine` 的“工作中……”左侧显示
[Beautiful UI Loading State](https://www.beautifului.dev/r/loading-state.json) 的
Drive 像素动效。共享入口为 `components/ui/loading-state.tsx`；采用 15 × 15px
的 3 × 3 方格、650ms 透明度循环和 90ms 波纹间隔。图案颜色读取共享 `loading-state`
token，浅色 / 深色均为 `rgb(77, 159, 240)`（`#4D9FF0`）。
文案复用现有工作状态与工具活动摘要，图案置于文字滚动动画之外；回复结束时随状态行
一同移除。系统或 MotionConfig 要求减少动态效果时，图案保持静态。
`ThinkingItem` 思考详情标题保持纯文字。

```text
[pixel grid] Working...
Thinking  2.3s  v
  Thinking content
```

通过以下命令安装后，提取 Drive 图案与对应 keyframes 并接入项目主题；
未使用的演示文案、计时器、视频及 foundation 样式不纳入应用。

```sh
npx shadcn add https://www.beautifului.dev/r/loading-state.json
```

浏览器验证入口为 `/tests/agent-preview.html`，工作状态预览可切换开始 / 结束、
减少动效及深色模式。

### Workspace Agent 详情标签

2026-09-10：Workspace 的“提示词 / 执行过程 / 输出”按用户指定，复用 sidebar
Agent / Code 切换的 `TabsList` default 变体；按最新尺寸调整使用 `size="sm"`：
32px 高圆角底座、选中块滑动，激活项显示对应图标。图标与文字的弹入由共享
`components/assistant-ui/tabs-trigger-content.tsx` 实现，两处沿用同一组弹簧参数。
标签文字统一为 12px，图标为 14px，宽栏左右内边距各 8px，窄栏各 4px，避免截断选项。
减少动态效果时，激活图标和文字直接显示；面板沿用原有内容与滚动逻辑。

```text
Agent information
  +---------------------------------------+
  | Prompt | [icon Execution] | Output    |
  +---------------------------------------+
  Current panel content
```

### 项目工作目录

2026-09-10：按用户确认的桌面 / 移动端布局，保留主侧栏、聊天区和 Workspace，
项目标题的加号与空白对话的目录标签共用
[DirectoryPickerDialog](../agent-ui/src/features/project-directory/directory-picker-dialog.tsx)。
弹窗使用现有 Dialog、Input、Button、FileBrowserTree 的 compact 变体与
CreateFolderDialog；目录行沿用共享文件树高度，仅显示文件夹。桌面工具栏单行，移动端新建
文件夹按钮换行，底部已选路径位于取消 / 使用按钮上方。弹窗与树沿用共享动效、
键盘操作和 reduced-motion。

目录滚动区直接沿用 FileTreePane 的 `card` 底色、底部留白、稳定滚动条槽、
inline-size 容器与 overscroll 设置；树外不加顶部或侧边留白，吸顶边界与文件浏览器一致。
吸附底色只用于有子项的展开目录实际停驻的区间；折叠目录、空目录经过遮挡区，或展开目录
被自身子树末端推离吸附位置时，保持普通底色。真实选中状态单独保留。

```text
Project [+] -----------+                    Existing project [+]
Empty chat cwd chip --+-> Working directory          |
                          | browse / type path       |
                          | create child -> select   |
                          v                          v
                       Use directory ----------> Local draft (cwd)
                                                   |
                                             First message
                                                   |
                             WS init(cwd, harness, model, text)
                                                   |
                                    sessionId -> Sidebar project group
```

目录读取与新建直接使用 `GET /api/sandbox/files/list`、
`POST /api/sandbox/files/mkdir`；使用前重新验证目录，关闭弹窗会取消读请求。
新建文件夹后自动选中，点击使用才进入草稿。目录本身不产生空项目分组，首条消息经
`/api/sandbox/agent/ws/run` 创建会话，收到 `sessionId` 后加入按 cwd 聚合的侧栏。
已有项目的加号直接以该 cwd 开新草稿。空白对话更改目录不重置输入文字或附件，
已完成与进行中的上传保留绝对路径；之后新增的附件上传到新 cwd。发出首条消息后，
目录标签只读。

默认目录由后端启动时的 `WORKSPACE_DIR` 决定；未设置时使用后端进程用户的
`homedir()`。会话列表接口返回 `active_cwd`，前端用它初始化默认项目和新对话。
项目标题加号从该目录打开选择器，空白对话的目录标签则从当前草稿的 cwd 打开。
选择目录只改变该草稿，不修改服务端默认目录。

### 文件浏览范围

2026-09-10：工作目录选择器、Workspace 文件浏览器和“数据与用量 → 文件浏览器”
固定以 `WORKSPACE_DIR` 为树根，沿用未配置时的 `homedir()` 默认值。目录列表接口
返回规范化的 `root`；根目录的 `parent` 为 `null`，前端据此截断树和面包屑。
跳转深层目录只补载根目录以内的祖先，子目录仍在展开时按需读取，不递归扫描整棵树。

```text
DirectoryPicker / Workspace / FileBrowserPage
                    |
                    v
             GET files/list
                    |
              root = WORKSPACE_DIR
              +-- project-a
              |     +-- src (load on expand)
              +-- project-b
```

后端解析真实路径后校验范围，拒绝上一级、其他绝对目录以及通向外部目录的符号链接；
列表不包含指向工作区外的文件或目录链接。手动输入越界路径会显示错误，保留当前树根。
选择器先读取工作区根目录，再定位草稿 cwd；旧草稿 cwd 越界时仍可从根目录重新选择。
消息中的外部文件仍可单独预览，但不会加载其父目录到树中。

此范围适用于 `files/list` 驱动的文件浏览；Skills 使用独立的资源接口，继续按技能
自身路径展示资源树。文件预览、上传、新建、删除及 Agent 执行的路径规则保持原有职责。

### 文件预览大小限制

2026-09-10：`GET /api/sandbox/files/preview` 的文本内容上限为 3 MiB
（3 × 1024 × 1024 字节），恰好等于上限时仍返回完整内容。已知文本类型和通过
内容检测识别的文本共用此限制，按 UTF-8 字节数判断。

超限时保留文件元数据，返回 HTTP 200、`content: null`、`is_binary: false` 和
`preview_error: "too-large"`；其他成功响应的 `preview_error` 为 `null`。
前端复用现有预览错误区域，显示“内容过大，无法预览”和 3 MiB 上限说明，保留下载
入口；超限文件链接仍按文件存在处理。图片 / PDF 的下载预览路径及其他二进制
渲染器沿用现有逻辑；该限制不改变独立的 Skill 资源接口。

```text
Text file -> preview size check
             +-- <= 3 MiB -> content -> source / renderer
             +-- >  3 MiB -> preview_error: too-large
                                      -> 内容过大，无法预览 / 下载
```

### MCP 页面精修

2026-09-10：MCP 按 Skills 已确认的视觉细节统一，用户确认移除项目选择器。
列表标题使用 18px，说明使用 12px / 20px 行高；中英文文案分别为 MCP 服务 / MCP servers。
Skills 与 MCP 共用 [ResourceListHeader](../agent-ui/src/features/resources/resource-list-header.tsx)，
搜索在标题右侧展开，搜索、刷新、新增依次排列，保留说明和动作按钮。
图标沿用 `ResourceIconButton` 的 14px 样式、共享 Tooltip、按压反馈和 inset 焦点框。

桌面初始分栏为 1:2；MCP 分组初始仅展开全局，项目标题使用 CSS 圆点分隔，
折叠箭头位于标题右侧。服务行高 26px，行间距 2px，禁用标签高 16px。
详情移除大图标与来源元信息，显示 16px 服务名、12px 服务地址 / 启动命令，
保留只读与禁用状态、编辑和删除动作。

```text
MCP 服务 | 搜索 | 刷新 | 新增  | 服务名称              编辑 删除
12px 说明                     | 服务地址 / 启动命令
全局 MCP v ------------------ | 协议 / 连接状态         测试连接
  服务名称 [已禁用]           |----------------------------------
项目 · 名称 > --------------- | 配置路径 复制 [工具 提示词 资源 配置]
                              | 所选内容 / 加载 / 空状态 / 错误

手机：列表 -> 服务详情 -> 返回列表
窄详情栏：配置路径独占一行，复制与 Tabs 在下一行。
```

MCP 工具栏采用同一 Animate UI Radix Tabs 入口：工具栏高 36px、Tab 组高 24px，
文字垂直居中；窄栏按上图换行。路径为二级文本，复制按钮复制当前 Tab 内容。
已访问的 Tab 保留 DOM 与滚动位置，未访问的 Tab 按需挂载。
两类资源最多保留三个最近详情；刷新或配置保存会使旧详情失效。
连接重测时保留上次结果和滚动，显示忙碌状态并阻止重复测试；失败显示明确错误。
项目 MCP 的编辑、连接与工具测试使用所选服务的 `source.cwd`，全局服务沿用默认范围。

## Layout approval

以下两条布局要求从 `AGENTS.md` 原样迁入，继续生效。

- Before implementing any frontend layout, present an ASCII wireframe to the
  user and obtain explicit approval. Do not begin layout implementation until
  the proposed layout has been confirmed.
- The ASCII wireframe must show the relevant page regions, content hierarchy,
  navigation, primary actions, and important states. Include separate desktop
  and mobile views when their layouts differ materially.

提案、系统/组件架构、用户/数据流的 ASCII 图示，设计不明确时的确认，以及已确认
方案发生实质变化时的再次确认，统一遵循
[AGENTS.md 的 Design Communication and Approval](../AGENTS.md#design-communication-and-approval)。
这些通用要求仍适用于整个仓库。

## Current baseline

### 已配置的视觉基线

| 维度 | 当前配置 / 实现 | 依据 |
| --- | --- | --- |
| 技术栈 | React 19、TypeScript、Vite 8、Tailwind CSS 4 | [package.json](../agent-ui/package.json) |
| 基础组件风格 | shadcn/ui `base-vega`；通用组件以 Base UI 为主，Switch 使用 Animate UI + Radix UI | [components.json](../agent-ui/components.json)、[Button](../agent-ui/src/components/ui/button.tsx)、[Switch](../agent-ui/src/components/animate-ui/components/radix/switch.tsx) |
| 颜色 | `neutral`，CSS variables；菜单 `menuColor: default`、`menuAccent: subtle` | [components.json](../agent-ui/components.json) |
| 主题 | 浅色 / 深色语义 token；`next-themes` 管理主题 | [index.css](../agent-ui/src/index.css)、[main.tsx](../agent-ui/src/main.tsx) |
| 字体 | `font-sans` 为 Inter Variable，`font-code` 为 JetBrains Mono Variable；仍有代码组件使用 `font-mono` | [index.css](../agent-ui/src/index.css)、[AgentCode](../agent-ui/src/components/agents/agent-code.tsx) |
| 字号与圆角 | 已定义 `text-ui: 0.9375rem`、`text-code: 12.25px`；`--radius: 0.625rem` 派生多级圆角 | [index.css](../agent-ui/src/index.css) |
| 基础图标 | Lucide；侧栏用 AnimateIcons 的 Lucide 动画图标；模型品牌和文件类型另有专用资源 | [sidebar-data.tsx](../agent-ui/src/features/sidebar/sidebar-data.tsx)、[ProviderIcon](../agent-ui/src/features/model-settings/provider-icon.tsx) |
| 动效与交互表面 | CSS transition、Animate UI、Motion、GSAP 并存；已有共享曲线、弹窗动效、focus ring | [ease.ts](../agent-ui/src/lib/ease.ts)、[popup-motion.ts](../agent-ui/src/lib/popup-motion.ts)、[surfaces.tsx](../agent-ui/src/lib/surfaces.tsx) |

`base-vega` 是生成配置，不代表每个历史组件仍与上游模板完全一致。多数组件已经
经过本地修改，应以本地源码为准。上游目前提供 Base UI 组件版本，并将 Vega
描述为经典 shadcn/ui 风格，继续使用当前基线有现成支持。
参见 [shadcn 风格说明](https://ui.shadcn.com/docs/changelog/2025-12-shadcn-create)。

### 来源库的实际职责

这里区分视觉组件源码、交互原语、动画工具和内容渲染器。配置一个 registry
不等于安装了整套组件库，目录存在也不代表其中每个导出都被页面使用。

| 来源 | 当前落地入口 | 实际用途与风格 |
| --- | --- | --- |
| shadcn/ui + Base UI | [components/ui](../agent-ui/src/components/ui) | 通用按钮、表单、弹层、导航等；Neutral + Vega 风格，使用项目主题 token。`file-upload` 等外部来源也放在此目录，不能仅按目录判断上游。 |
| Animate UI | [components/animate-ui](../agent-ui/src/components/animate-ui) | 全部布尔开关使用 Radix Switch + Motion；附件菜单使用 Base UI Menu + Motion 滑动高亮；主题按钮使用另一份按钮 variants 和 View Transition。 |
| assistant-ui 命名空间下的本地组件 | [tabs.tsx](../agent-ui/src/components/assistant-ui/tabs.tsx)、[file.tsx](../agent-ui/src/components/assistant-ui/file.tsx) | Tabs 已采用 Base UI + Motion，有 default / line / ghost / pills / outline；File 提供上传队列文件卡片。没有直接依赖 `@assistant-ui/react` 运行时。 |
| BE UI 衍生组件 | [expandable-tabs.tsx](../agent-ui/src/components/motion/expandable-tabs.tsx) | 文件注释指向 BE UI；工作区使用收起为图标、选中后展开文字的胶囊 Tabs，交互由本地代码 + Motion 实现。 |
| ReUI + Headless Tree | [tree.tsx](../agent-ui/src/components/reui/tree.tsx) | 文件树外观；Headless Tree 提供树状态与交互，业务层叠加选中高亮、展开动画和溢出文字滚动；文件浏览器与 Skill 资源树共享业务树组件。 |
| Dice UI + shadcnblocks | [file-upload.tsx](../agent-ui/src/components/ui/file-upload.tsx)、[file-upload-dropzone-1.tsx](../agent-ui/src/components/file-upload-dropzone-1.tsx) | Skill 压缩包上传；Dice UI 的 Base UI 适配实现 + shadcnblocks 上传布局 + Motion。来源有源码注释和[迁移记录](architecture/skills-mcp-migration.md)支持。 |
| AI Elements + Streamdown | [ai-elements/message.tsx](../agent-ui/src/components/ai-elements/message.tsx) | 消息容器、操作区、流式 Markdown、代码/数学/Mermaid；复用本地 Button、Tooltip，另有内容样式。 |
| Kibo UI 命名空间下的本地组件 | [status/index.tsx](../agent-ui/src/components/kibo-ui/status/index.tsx) | 会话状态点，已改为 `status-idle/running/warm` token 和 CSS ping。 |
| 本地领域组件 | [agents](../agent-ui/src/components/agents)、[elements](../agent-ui/src/components/elements)、[motion](../agent-ui/src/components/motion)、[heatmap](../agent-ui/src/components/heatmap)、[interior](../agent-ui/src/components/interior) | 工具结果、Diff、任务计划、状态交换、热力图、Lightbox；没有明确来源证据的组件按本地实现记录，不推断上游。 |
| 专业运行时库 | Recharts、Shiki、EmbedPDF、DocxEditor、PPTX Renderer、GrapesJS、SheetJS、TanStack Virtual | 分别负责图表、代码和文件内容；部分自带工具栏/视觉，见下表。 |

[components.json](../agent-ui/components.json) 配置了 7 个扩展 registry：
`@reui`、`@assistant-ui`、`@animate-ui`、`@ai-elements`、`@beui`、`@diceui`、
`@shadcnblocks`。上表能找到对应的本地使用或来源记录。Kibo 命名空间存在于源码中，
但不在当前 registry 配置中。`radix-ui` 是 Switch 的直接运行时依赖；其他通用组件
仍以 Base UI 为主，不能因为某个 registry 同时支持多个原语就将它们全记为实际使用。

## Component catalog

以下表格中的路径是当前可查找的入口；同一行的不同实现并不表示可以随意互换。
基础 `ui/` 目录共有 40 个 `.tsx` 文件，其中没有业务调用的导出另列于表后。

### 操作、选择与表单

| 组件类型 | 当前入口 / 来源 | 当前样式和反馈 | 代表场景 |
| --- | --- | --- | --- |
| Button / Icon button | [ui/button](../agent-ui/src/components/ui/button.tsx)，shadcn 风格 + Base UI | 6 种 variant；default 高 36px、sm 32px、xs 24px；颜色过渡、按压缩放 | 设置、资源页、工具栏、工作区按钮 |
| 特殊动作按钮 | [motion/action-swap](../agent-ui/src/components/motion/action-swap.tsx)、[action-swap-roll](../agent-ui/src/components/motion/action-swap-roll.tsx)，本地 Motion | 图标/文案交换；另有 `surfaces.tsx` 的圆形 ghost/ink 样式 | 发送/停止、工作状态、复制按钮 |
| Toggle | [ui/toggle](../agent-ui/src/components/ui/toggle.tsx)，Base UI Toggle | 两态按压按钮；default / outline，选中态 `bg-muted` | 当前仅 `toggleVariants` 被 ToggleGroup 复用，没有独立 `<Toggle>` 业务实例 |
| ToggleGroup | [ui/toggle-group](../agent-ui/src/components/ui/toggle-group.tsx)，Base UI ToggleGroup + Toggle | 文件工具栏采用 `outline`、`sm`、`spacing={0}` 的连接分段按钮 | 文件源码 / 预览 / 编辑模式 |
| Switch | [animate-ui/components/radix/switch](../agent-ui/src/components/animate-ui/components/radix/switch.tsx)，Radix UI + Motion | 默认轨道 32 × 20px / 滑块 16px；Skill 小号轨道 24 × 15px / 滑块 11px；按压伸展，spring `stiffness: 300 / damping: 25`；支持 reduced motion | Agent 输入建议、模型默认项、Skill 启停，共 3 处 |
| 主题 / 语言 / 工作区切换 | [ThemeToggle](../agent-ui/src/features/sidebar/footer/theme-toggle.tsx)、[LanguageToggle](../agent-ui/src/features/sidebar/footer/language-toggle.tsx)、[WorkspaceToggle](../agent-ui/src/features/workspace/workspace-toggle.tsx) | 分别是 Animate UI 主题按钮、shadcn Button + GSAP、Button + Motion；名称带 toggle，但并未使用通用 Toggle 或 Switch | 全局模式与面板开关 |
| Input / Textarea | [ui/input](../agent-ui/src/components/ui/input.tsx)、[ui/textarea](../agent-ui/src/components/ui/textarea.tsx) | Input 基于 Base UI，Textarea 是本地样式的原生 textarea；共享 input / ring / destructive token | 搜索、名称、配置文本 |
| Field / Label | [ui/field](../agent-ui/src/components/ui/field.tsx)、[ui/label](../agent-ui/src/components/ui/label.tsx) | 本地 shadcn 风格的标签、说明、错误与分组结构 | 设置和表单；资源表单还存在本地 FormField 组合 |
| InputGroup / ButtonGroup | [ui/input-group](../agent-ui/src/components/ui/input-group.tsx)、[ui/button-group](../agent-ui/src/components/ui/button-group.tsx) | 组合输入、前后缀、附属动作、按钮组，共享基础组件 | 聊天输入框、表格预览搜索；消息动作内组合按钮组 |
| Select | [ui/select](../agent-ui/src/components/ui/select.tsx)，Base UI Select | 有边框触发器，选项弹层复用 `popupMotion` | 设置选项、资源作用域、用量筛选 |
| Combobox | [ui/combobox](../agent-ui/src/components/ui/combobox.tsx)，Base UI Combobox | 可搜索选项、选中标记 / chips，复用输入组件和弹层动效 | 模型选择、会话标签筛选 |
| Tags input / 标签选择 | [session-tag-popover](../agent-ui/src/features/sidebar/content/session-tag-popover.tsx)、[session-tag-chip](../agent-ui/src/features/sidebar/content/session-tag-chip.tsx)，本地组合 | Popover + 原生 input + 标签 chip + Motion；输入和清除按钮有独立尺寸样式 | 会话标签编辑与搜索 |
| FileUpload / Dropzone | [ui/file-upload](../agent-ui/src/components/ui/file-upload.tsx)、[FileUploadDropzone1](../agent-ui/src/components/file-upload-dropzone-1.tsx) | Dice UI / shadcnblocks 来源；虚线投放区、文件列表、校验反馈 | Skill 上传；聊天和文件浏览器另用隐藏的原生 file input 接入上传逻辑 |

Toggle 用于保持按压状态的工具按钮，Switch 表达布尔开关；切换内容面板时使用
Tabs，选择预览操作模式时可使用 ToggleGroup。不要只根据组件名字包含“toggle”
就把这些交互当作同一种组件。语义可参照
[shadcn Toggle](https://ui.shadcn.com/docs/components/base/toggle) 和
[Switch](https://ui.shadcn.com/docs/components/base/switch)。

### 提示、弹层与反馈

| 组件类型 | 当前入口 / 来源 | 当前样式和反馈 | 代表场景 |
| --- | --- | --- | --- |
| Tooltip | [ui/tooltip](../agent-ui/src/components/ui/tooltip.tsx)，Base UI Tooltip | 首次悬浮等待 2000ms，连续切换立即显示；全部离开 400ms 后重置。125ms 进入 / 75ms 退出，连续切换跳过进入动效 | 聊天工具栏、文件工具栏、侧栏动作、上下文用量 |
| TooltipHint | 同一 [ui/tooltip](../agent-ui/src/components/ui/tooltip.tsx) 中的组合入口 | 替代浏览器原生 `title`，复用全局延迟组，不添加布局包裹元素，保留多行提示 | 图标按钮、路径、错误、状态、截断文字 |
| 富内容提示 | [composer-slash-chip](../agent-ui/src/features/agent-message/components/composer-slash-chip.tsx)，Base UI Tooltip | 沿用 popover token 的卡片样式，与其他提示共享计时 | Slash command chip 预览；旧 HoverCard 入口当前无业务调用 |
| Popover | [ui/popover](../agent-ui/src/components/ui/popover.tsx)，Base UI Popover | 浮层表单 / 信息面板，160ms 进入 / 100ms 退出 | 标签、上下文占用、任务计划、上传队列 |
| DropdownMenu | [ui/dropdown-menu](../agent-ui/src/components/ui/dropdown-menu.tsx)，Base UI Menu | `ring-1`、共享 CSS 弹层动画、焦点行背景 | 模型、会话、账户、路径、Harness 菜单 |
| 附件 Menu | [animate-ui/components/base/menu](../agent-ui/src/components/animate-ui/components/base/menu.tsx)，Base UI Menu + Animate UI | `border`、200ms 弹层、Motion 滑动高亮；与通用 DropdownMenu 的分组字号等不同 | 聊天附件菜单 |
| ContextMenu | [ui/context-menu](../agent-ui/src/components/ui/context-menu.tsx)，Base UI ContextMenu | shadcn 风格的右键菜单 | 文件树节点操作 |
| Slash / 选区动作菜单 | [composer-slash-menu](../agent-ui/src/features/agent-message/components/composer-slash-menu.tsx)、[assistant-quote-menu](../agent-ui/src/features/agent-message/components/assistant-quote-menu.tsx)，本地 Portal + Motion | 定位、键盘/焦点处理由业务实现；Slash 保留输入框焦点并提供 listbox | 输入 `/`、引用所选文本 |
| Dialog / AlertDialog | [ui/dialog](../agent-ui/src/components/ui/dialog.tsx)、[ui/alert-dialog](../agent-ui/src/components/ui/alert-dialog.tsx)，Base UI | 居中模态框 + 遮罩；200ms 进入 / 150ms 退出 | 设置、资源表单、重命名、删除确认 |
| Sheet | [ui/sheet](../agent-ui/src/components/ui/sheet.tsx)，Base UI Dialog | 边缘滑入；共享 `sheetMotion`，380ms 进入 / 220ms 退出 | 移动端侧栏、资源详情抽屉 |
| Badge / Status | [ui/badge](../agent-ui/src/components/ui/badge.tsx)、[kibo-ui/status](../agent-ui/src/components/kibo-ui/status/index.tsx)、[workflow-status](../agent-ui/src/features/agent-message/components/workflow-status.tsx) | 标签 pill、状态圆点、带图标状态组合；Kibo 状态点使用语义 token | 会话状态、资源类型、工作流状态 |
| Progress | [ui/progress](../agent-ui/src/components/ui/progress.tsx)，Base UI；[AgentPlan](../agent-ui/src/components/elements/agent-plan.tsx) 另有自绘条 | 通用进度轨道和计划中的细线进度条并存 | Profile 用量、Agent 任务进度 |
| Spinner / Skeleton / Shimmer | [ui/spinner](../agent-ui/src/components/ui/spinner.tsx)、[ui/skeleton](../agent-ui/src/components/ui/skeleton.tsx)、[ShimmerLabel](../agent-ui/src/lib/surfaces.tsx) | Lucide 旋转、占位 pulse、`tw-shimmer`；业务中也直接使用 Loader 图标 | 等待请求、文件加载、工具执行 |
| Empty / Error | [ui/empty](../agent-ui/src/components/ui/empty.tsx)、[resource-shared](../agent-ui/src/features/resources/resource-shared.tsx) 等本地组合 | 空状态图标和说明；错误使用 `role="alert"`、destructive 文本与重试按钮 | 空对话、空工作簿、资源失败 |

Tooltip 应用于悬浮/键盘聚焦时的说明提示，包括不含操作的富内容说明；交互面板使用 Popover。
应用根部只保留一个 TooltipProvider，业务组件不再创建独立延迟组或覆盖打开延迟。
键盘聚焦立即展示，Escape 可关闭。新增提示使用 TooltipHint 或 Tooltip 组合，
不再使用 HTML `title`；iframe 的无障碍标题、组件的正文标题不属于悬浮提示。

```text
App TooltipProvider -> 首次悬浮 2s -> 连续切换 0ms
                    -> 全部离开 400ms -> 重置
                    -> 键盘聚焦 -> 立即显示
```

本地封装的实际默认值以源码为准，不能直接套用上游示例的默认值。
参见 [shadcn Tooltip](https://ui.shadcn.com/docs/components/base/tooltip)。

### 导航、结构与数据展示

| 组件类型 | 当前入口 / 来源 | 当前样式和反馈 | 代表场景 |
| --- | --- | --- | --- |
| Tabs | [assistant-ui/tabs](../agent-ui/src/components/assistant-ui/tabs.tsx)，Base UI + Motion | 多种变体，共享选中/悬浮滑块；属于本地通用封装 | 侧栏模式、文件标签、工作表、工作流详情 |
| 资源 Tabs | [animate-ui/components/radix/tabs](../agent-ui/src/components/animate-ui/components/radix/tabs.tsx)，Radix + Motion | 24px 标签栏、共享底色和滑块；键盘及减少动态效果时立即切换 | Skill 文件预览、MCP 工具 / 提示词 / 资源 / 配置 |
| ExpandableTabs | [motion/expandable-tabs](../agent-ui/src/components/motion/expandable-tabs.tsx)，BE UI 衍生 | 胶囊图标展开标签；固定 26px 外框 / 18px 内容圆角、本地 tab 语义和动画 | Workspace 模块切换 |
| Sidebar | [ui/sidebar](../agent-ui/src/components/ui/sidebar.tsx)，shadcn 衍生组合 | `sidebar-*` token；Base UI Sheet 处理移动端，GSAP 调整桌面宽度，Motion 处理行高亮 | 主侧栏、工作区侧栏 |
| Breadcrumb | [ui/breadcrumb](../agent-ui/src/components/ui/breadcrumb.tsx) | shadcn 风格路径层级，Lucide 分隔图标 | 顶栏、设置导航、文件路径 |
| Collapsible / Disclosure | [ui/collapsible](../agent-ui/src/components/ui/collapsible.tsx)，Base UI；[AgentDisclosure](../agent-ui/src/components/agents/agent-disclosure.tsx)，本地 CSS | 普通折叠与对话内容向下展开分别实现；`collapsePanel` 是可复用样式 | 项目/文件夹、工作流、工具结果 |
| Resizable | [ui/resizable](../agent-ui/src/components/ui/resizable.tsx)，`react-resizable-panels` | 本地分隔手柄、伸缩面板 | 文件浏览器、资源列表/详情分栏 |
| Tree | [reui/tree](../agent-ui/src/components/reui/tree.tsx) + [file-browser-tree](../agent-ui/src/features/file-browser/components/file-browser-tree.tsx) | Headless Tree 的树模型 + ReUI 外观 + Motion 高亮 / 文字溢出反馈 | 文件浏览器；[SkillResourceTree](../agent-ui/src/features/resources/skill-resource-tree.tsx) 也复用 FileBrowserTree，使用 compact 变体 |
| Card / Item / Separator | [ui/card](../agent-ui/src/components/ui/card.tsx)、[ui/item](../agent-ui/src/components/ui/item.tsx)、[ui/separator](../agent-ui/src/components/ui/separator.tsx) | token 化卡片、列表项、分隔线；Separator 用 Base UI | 工具结果、模型列表、Profile |
| Avatar | [ui/avatar](../agent-ui/src/components/ui/avatar.tsx)，Base UI Avatar | 圆形头像及 fallback | 用户菜单、Profile |
| Chart | [ui/chart](../agent-ui/src/components/ui/chart.tsx) + Recharts | `chart-*` token 与本地图表 Tooltip；这里的 Tooltip 是图表数据提示 | 模型用量图表 |
| CalendarHeatmap | [heatmap/calendar-heatmap](../agent-ui/src/components/heatmap/calendar-heatmap.tsx)，本地 SVG + date-fns | 网格热力图；基础默认读 chart token，Profile 调用点传入固定蓝色 | Token 使用日历 |
| Table / 数据网格 | [spreadsheet-renderer](../agent-ui/src/features/files/preview/renderers/spreadsheet-renderer.tsx)，SheetJS + TanStack Virtual + 原生 table | 工作簿解析、虚拟行列、粘性表头、本地单元格样式 | 表格文件预览；尚无通用 `ui/table` 或 DataTable 入口 |
| ScrollArea / 消息滚动 | [agents/code-block](../agent-ui/src/components/agents/code-block.tsx) 直接使用 Base UI ScrollArea；[ui/message-scroller](../agent-ui/src/components/ui/message-scroller.tsx) 包装 `@shadcn/react/message-scroller` | 代码滚动区与聊天跟随滚动；其余区域多用原生 overflow | 代码块、聊天历史 |
| Direction | [ui/direction](../agent-ui/src/components/ui/direction.tsx)，Base UI DirectionProvider | 无独立视觉，仅方向上下文 | FileUpload 的内部依赖 |

### Agent 内容与文件预览

| 组件类型 | 当前入口 / 来源 | 当前样式 / 边界 |
| --- | --- | --- |
| Message / Markdown | [ai-elements/message](../agent-ui/src/components/ai-elements/message.tsx)，AI Elements + Streamdown | 用户气泡与助手正文；内容渲染插件处理代码、数学、Mermaid，操作复用本地 Button/Tooltip |
| 附件卡 / 文件卡 / 消息标记 | [ui/attachment](../agent-ui/src/components/ui/attachment.tsx)、[assistant-ui/file](../agent-ui/src/components/assistant-ui/file.tsx)、[ui/marker](../agent-ui/src/components/ui/marker.tsx) | 分别服务 composer 附件、上传队列、消息/压缩标记；尺寸、圆角与状态表现有不同变体 |
| ToolResult / FileRead / FileDiff / CodeBlock | [components/agents](../agent-ui/src/components/agents) | 本地领域封装 + Shiki + Motion/CSS；工具背景、状态图标、代码和 Diff 配色。CodeBlock 类型标题栏上下内边距各为 `4rem / 9`（约 7.11px），比原值减少 1/3 |
| Plan / Workflow | [elements/agent-plan](../agent-ui/src/components/elements/agent-plan.tsx)、[workflow-overview](../agent-ui/src/features/agent-message/components/workflow-overview.tsx)、[workflow-pipeline](../agent-ui/src/features/agent-message/components/workflow-pipeline.tsx) | 本地步骤/进度，组合 Card、Badge、Button 和 Disclosure |
| Image / Lightbox | [image-renderer](../agent-ui/src/features/files/preview/renderers/image-renderer.tsx)、[interior/lightbox](../agent-ui/src/components/interior/lightbox.tsx) | 图片预览；Lightbox 为本地 Motion 手势/缩放和覆盖层实现 |
| PDF | [pdf-renderer](../agent-ui/src/features/files/preview/renderers/pdf-renderer.tsx)，EmbedPDF | 库内查看器 UI，接入应用浅/深色与 Inter 配置；不是 shadcn 基础组件 |
| DOCX / PPTX | [document-renderer](../agent-ui/src/features/files/preview/renderers/document-renderer.tsx)、[presentation-renderer](../agent-ui/src/features/files/preview/renderers/presentation-renderer.tsx) | DocxEditor / PPTX Renderer 渲染文档内容，应用外框使用项目 token |
| HTML 编辑器 | [html-visual-editor](../agent-ui/src/features/files/preview/renderers/html-visual-editor.tsx)，GrapesJS | 编辑器自带 UI；全局 CSS 当前明确保留默认粉/紫色点缀，形成应用内可见的独立风格 |
| HTML / JSX 生成内容 | [html-renderer](../agent-ui/src/features/files/preview/renderers/html-renderer.tsx)、[visualize-sandbox](../agent-ui/src/features/agent-message/visualize-sandbox) | iframe 中的内容；JSX 沙箱另有 Button、Badge、Card、Progress、Separator 简化实现，传入主题颜色但不共享主应用全部字号、圆角与交互 |

CodeBlock 标题栏在复制按钮左侧提供自动换行按钮，默认关闭，各代码块独立切换，
流式追加和消息完成时保留选择。MessageResponse 一旦使用流式渲染器，完成时仍保留
同一渲染器，通过 `isAnimating` 结束流式状态，避免重建代码块；初始静态内容继续
使用静态渲染器。开启后长行和连续长字符串按可用宽度折行，行号仍对应原始
代码行，复制仍使用原始代码。按钮复用共享 Button 的按压反馈和 inset 焦点框，
开启使用折返箭头文本图标，关闭使用直线文本图标；通过 `aria-pressed` 表达状态，
并提供中英文启用 / 禁用提示。调用方需要控制状态时，
使用 `wrap` / `onWrapChange`。

消息中的 CodeBlock 沿用组件的内容内边距，默认首行距标题栏 18px，不再通过
`pt-0` 清除顶部留白。水平滚动条下移 8px，放在代码视口外的底部内边距中，
避免覆盖末行；垂直滚动条止于视口底部，转角跟随水平条下移。
Chat composer 单行上下内边距各为 7px，高度由 50px 减至 48px；多行顶部内边距
由 14px 减至 12px，同样缩小 2px，保留文字行高、按钮尺寸和原有过渡。

```text
类型标题                         状态 | 自动换行 | 复制
        18px 顶部留白
代码视口                         | 垂直滚动条
水平滚动条位于视口下方           + 转角
自动换行：关闭 -> 横向滚动；开启 -> 按代码区宽度折行
```

### 已有源码但未作为业务组件使用

- [ui/bubble.tsx](../agent-ui/src/components/ui/bubble.tsx)、[ui/message.tsx](../agent-ui/src/components/ui/message.tsx)：未发现生产源码调用。实际消息使用 `ai-elements/message.tsx`。
- [ai-elements/jsx-preview.tsx](../agent-ui/src/components/ai-elements/jsx-preview.tsx)：未发现调用；实际可视化内容使用 `visualize-sandbox`，不能将 `react-jsx-parser` 记为当前页面渲染路径。
- `Toggle` 组件没有独立业务实例，但 `toggleVariants` 正在被 ToggleGroup 使用，不能将整个文件当成未使用。
- Animate UI 的 `IconButton` / 粒子按钮没有业务实例；主题按钮只复用该文件的 `buttonVariants`，不能将粒子效果记为已展示。
- 尚无独立通用入口的类型包括 Checkbox、RadioGroup、Slider、Accordion、Command、Calendar/DatePicker、Toast、Table/DataTable。菜单中的 CheckboxItem / RadioItem 不等于已经建立了通用表单组件；当前错误反馈主要是页面内提示。需要时先核对 shadcn 的 Base UI 实现及本地依赖，不预装整套组件。

## Recommendations

### 推荐基线：shadcn/ui base-vega + Base UI

建议继续使用当前 `base-vega + neutral + CSS variables + Lucide` 作为唯一的
通用视觉基线。理由是 Button、Switch、ToggleGroup、Tooltip、Dialog、Select 等
大多采用这套基础；Switch 已按用户选择统一到 Animate UI Radix 版本。选型成本
主要来自多个本地入口及业务覆盖样式。统一入口和
变体能直接减少重复选择，也能保留已有功能。

建议的复用关系如下。图中的分工是目标约定；当前例外路径仍以组件清单为准。

```text
Feature / Page
  |
  +--> components/ui              [通用组件，shadcn base-vega]
  |      +--> Base UI             [通用交互原语]
  |      +--> shared tokens       [颜色、字号、圆角、focus、弹层反馈]
  |
  +--> Animate UI Radix Switch    [已确定的布尔开关入口]
  |
  +--> 本地领域组件               [消息、树、上传、代码、预览]
         +--> 复用通用组件与 tokens
         +--> 专业运行时           [Headless Tree / Streamdown / ...]

动画补充
  +--> 已有 CSS / popup-motion
  +--> Animate UI 成品 / Motion 自定义交互
  +--> GSAP：复杂 timeline / scroll 场景
```

| 选择对象 | 建议 | 原因 / 使用边界 |
| --- | --- | --- |
| 通用组件 | 选择本地固定入口；Switch 使用已确定的 Animate UI Radix 版本，其他以 shadcn 风格 + Base UI 为主 | 已覆盖绝大多数常用类型；新增调用先查本表，缺失才查上游 |
| Animate UI | 作为满足既定样式与行为的动画补充 | 已有组件能满足需求时直接复用；同类型普通组件已有标准入口时，优先增强该入口，避免再引入第二份视觉实现。其 Base UI Menu 的上游明确以 shadcn 风格为基础，见[官方说明](https://animate-ui.com/docs/components/base/menu) |
| ReUI / Dice UI / shadcnblocks | 保留树、上传等已落地的专业用途 | 固定到具体组件类型，使用本地实现；Button、Switch、Tooltip 等继续走本表各自的固定入口 |
| assistant-ui / BE UI / Kibo 命名空间 | 保留已有能力，按组件类型收敛公共入口 | 这些实现多已本地化且共用 token；继续按“来自哪个网站”组织通用组件会增加查找成本 |
| Recharts / 文档查看器 / 代码渲染器 | 保留专业运行时，统一应用外框 | 图表、文件格式与文档内容需要专业能力；外层工具栏、加载、错误、提示可以复用项目组件 |

### 最值得先统一的差异

下面是源码能定位的差异与改造建议，尚未实施。涉及布局或交互方案的实质变化，
实施前仍按上面的布局审批与仓库设计沟通规则确认。

| 优先级 | 当前差异与证据 | 建议结果 |
| --- | --- | --- |
| 1 | `ui/dropdown-menu` 与 Animate UI Menu 在边框、分组字号、入场时长和高亮方式上不同 | 通用菜单固定 `ui/dropdown-menu`；将需要的滑动高亮整合为该组件的统一能力，再更新附件菜单调用方 |
| 1 | 普通 Tabs 位于 `assistant-ui/tabs`，工作区 ExpandableTabs 自行实现交互 | 将通用 Tabs 的现有实现归到 `ui/tabs` 并更新所有调用；工作区展开标签作为组合组件复用通用 Tabs 语义。现有 `ui/tabs` 文件尚不存在 |
| 1 | Button 的 icon-xs 为 24px，而 Animate UI variants 的 xs 为 28px；业务还有独立圆形按钮和缩放值 | 集中 Button/IconButton 的尺寸、圆角、focus 与按压反馈；特殊状态交换只负责内容动画，避免继续复制按钮外观 |
| 2 | [AgentPlan](../agent-ui/src/components/elements/agent-plan.tsx) 的完成色使用 emerald；[Profile heatmap](../agent-ui/src/features/profile/profile-token-heatmap.tsx) 传固定蓝色；ExpandableTabs 写固定圆角 | 将应共享的状态、图表色和容器圆角提升为有语义的 token，保留有明确用途的组件变体 |
| 2 | GSAP 直接用于 15 个 `.tsx` 模块，包括 [LanguageToggle](../agent-ui/src/features/sidebar/footer/language-toggle.tsx) 这样简单的标签反馈；共享 `ease.ts` 与局部曲线并存 | 简单反馈收敛到已有 CSS / Motion 和共享参数，GSAP 保留给复杂时序；逐项替换后删除不再使用的实现 |
| 2 | 工具代码使用 GitHub high-contrast Shiki 主题，文件源码高亮加载普通 GitHub 主题 | 先明确代码阅读区是否需要两种对比度，再统一主题、字号与等宽字体 token；见 [agent-shiki](../agent-ui/src/components/agents/agent-shiki.tsx)、[shiki-highlighter](../agent-ui/src/features/files/preview/shiki-highlighter.ts) |
| 2 | 文件卡有 Attachment、File 和 FileUploadItem，分别定义卡片间距和状态表现 | 按“选择文件 / 显示附件 / 上传进度”明确职责，复用共同视觉；不同语义不必强行合成一个大型组件 |
| 3 | GrapesJS 内部 UI、文档内容、JSX 沙箱拥有独立渲染边界 | 先统一应用工具栏和状态反馈；沙箱通过主题快照对齐视觉，保持既有隔离边界；文档内容保留其自身格式 |

### 新组件的查找顺序

建议以后按组件语义查表，并给同一类型保留一个默认入口。不要因为某个网站的
示例更吸引人就再加入一套基础视觉。以下流程不要求新增页面或安装工具。

```text
确认语义：动作 / 开关 / 选择 / 导航 / 提示 / 内容
  |
  v
查本文组件清单 -> 已有合适入口？ --yes--> 复用组件及其 variants
                        |
                        no
                        v
                  用已有组件组合能满足？ --yes--> 本地组合
                        |
                        no
                        v
                  查 shadcn Base UI 对应组件
                        |
                  仍有明确能力缺口？
                        |
                        v
                  选一个匹配的专业实现
                        |
                        v
                  对齐 tokens / focus / motion -> 更新本表与调用示例
```

组件清单应随新增、替换、删除同步更新，记录类型、实际入口、原语/来源、默认变体、
业务使用点和例外用途。新增基础实现时一起检查 light/dark、hover/focus/pressed、
disabled/error、键盘、窄屏和 reduced motion；布局修改仍先提供已确认的 ASCII 图。

维护时可以从仓库根目录运行这些只读检索，不需要重新遍历每个 UI 网站：

```sh
rg --files agent-ui/src/components
rg -n '@/components/(ui|animate-ui|assistant-ui|reui|ai-elements|kibo-ui|motion)' agent-ui/src/features agent-ui/src/app agent-ui/src/App.tsx
rg -n '@base-ui/react|motion/react|gsap' agent-ui/src
```

## Development and verification

前端位于 `agent-ui/`，使用 npm。以下开发和测试入口从 `AGENTS.md` 迁入。
新增前端工具时在这里维护确切命令。

在 `agent-ui/` 目录运行：

- 安装依赖：`npm ci`
- 启动开发：`npm run dev`
- 静态分析：`npm run lint`
- 生产构建：`npm run build`
- 预览生产构建：`npm run preview`

Mermaid 浏览器回归：打开 `/tests/components/ai-elements/mermaid-browser.html` 并点击
**Run Mermaid checks**。覆盖真实图表加载、异步模块拒绝、局部源代码回退、复制入口、
周围消息保留和页面可交互；追加 `?zh&dark` 验证中文提示与深色主题。

目前没有前端全量自动化测试命令，也没有仓库级 formatter。
`lint` 对应 `oxlint .`，`build` 对应 `tsc -b && vite build`，以
[package.json](../agent-ui/package.json) 为准。下列测试均从仓库根目录运行；
引用 Runner 的 tsx/loader 的命令要求 `services/agent-runner/ts/` 已安装依赖。

Agent data / composer / attachments：

```sh
node --import ./services/agent-runner/ts/node_modules/tsx/dist/loader.mjs --test agent-ui/tests/features/agent-message/agent-tool-data.test.ts
node --test agent-ui/tests/features/agent-message/composer-attachments.test.ts agent-ui/tests/features/agent-message/composer-primary-action.test.ts agent-ui/tests/features/agent-message/slash-command-envelope.test.ts
./services/agent-runner/ts/node_modules/.bin/tsx --tsconfig agent-ui/tsconfig.app.json --test agent-ui/tests/features/agent-message/message-attachments.test.ts
```

项目目录浏览器回归：在 `agent-ui/` 运行 `npm run dev`，打开
`/tests/features/project-directory/project-directory-browser.html`，点击
**Run project directory checks**。使用真实 App 组件与隔离的目录 / 会话 / 上传 / WS
模拟，覆盖两个入口、懒加载与键盘展开、路径错误和重试、新建重名及自动选择、
草稿和上传保留、首条消息 cwd / 附件 / 分组、已有项目新对话、关闭后过期响应、
焦点恢复与弹窗溢出，以及选择器、主文件浏览器和 Workspace 的根目录范围、深层导航、
祖先目录补载、面包屑和越界输入；长目录滚动检查吸顶行贴合顶部、各层保持选中背景、缩进区域
不透明、滚动区与吸顶行底色一致、两侧无额外留白，以及返回顶部后恢复正常背景。
被吸附祖先遮挡的折叠目录不应出现吸附高亮。
追加 `?dark=1&zh=1` 检查深色与中文；追加 `&manual=1`
用于桌面 / 移动端视觉和真实 Tab、方向键、Enter、Esc 检查。模拟接口不访问真实
目录，不启动模型请求。视觉检查需将鼠标停留在吸顶目录行上滚动，确认悬浮时仍保持
选中底色，并在移出鼠标后保持一致。

文件树范围与宽度测量回归：

```sh
./services/agent-runner/ts/node_modules/.bin/tsx --tsconfig agent-ui/tsconfig.app.json --test agent-ui/tests/features/file-browser/file-browser-scope.test.ts
node --test agent-ui/tests/features/file-browser/file-tree-content-width.test.ts
```

文本预览响应映射、超限提示的中英文渲染，以及消息文件链接存在性回归：

```sh
./services/agent-runner/ts/node_modules/.bin/tsx --tsconfig agent-ui/tsconfig.app.json --test agent-ui/tests/features/file-browser/file-preview.test.tsx
```

后端文件系统与 HTTP 回归覆盖 1–3 MiB、3 MiB 边界、UTF-8 字节数、无扩展名文本、
二进制分类与超限后的下载，包含在 Runner 的 `npm test` 中。

CodeBlock 自动换行浏览器回归：在开发服务器打开
`/tests/components/agents/code-block-browser.html`，点击 **Run code block checks**。
覆盖顶部留白、短内容 / 双向滚动的末行与滚动条间距、状态图标、长行 / 连续长字符串、原始行号与复制内容、各代码块独立切换、流式追加与完成、
受控状态和窄栏；追加 `?dark=1&zh=1` 检查深色与中文。用 Tab 聚焦自动换行按钮，
按 Space / Enter 检查键盘切换和 inset 焦点框。

悬浮提示计时回归：打开 `/tests/components/ui/tooltip-browser.html`，点击
**Run tooltip checks**。使用真实计时检查首次 2s、跨组件连续切换、400ms 重置、
短暂悬浮取消、嵌套提示，以及按钮和 Popover 的组合行为；追加 `?dark=1` 检查深色主题。
使用真实 Tab 聚焦按钮，确认提示立即出现，再按 Escape 关闭；程序调用 `focus()`
不会在所有浏览器中切换键盘输入模式，因此这两项单独用真实按键验证。

文件树浏览器布局和交互检查：在 `agent-ui/` 运行 `npm run dev`，打开开发服务器上的
`/tests/features/file-browser/file-tree-browser.html`，点击 **Run file tree checks**。
细节见 [file-tree-performance.md](file-tree-performance.md)。

Skills / MCP 来源过滤及文件树辅助逻辑：

```sh
node --import ./services/agent-runner/ts/node_modules/tsx/dist/loader.mjs --test agent-ui/tests/features/resources/resource-api.test.ts agent-ui/tests/features/resources/skill-upload.test.ts
```

Skill 折叠树浏览器回归：在开发服务器打开
`/tests/features/resources/skill-tree-browser.html`，点击 **Run skill tree checks**。
覆盖按需加载、共享请求缓存、独立折叠、键盘操作、错误重试、窄栏和移动端文件选择。

Skill 页面性能与预览复用检查：打开
`/tests/features/resources/skill-page-performance.html`，点击 **Run skill page profile**。
默认使用固定的 8 个 Skill 样例，记录页面进入、首次预览、切换和缓存返回的
React 提交耗时 / 帧间隔；检查预览 DOM 复用、最多保留三个预览、代码块滚入视口后的
高亮，以及按需加载语言后的主题与 Diff。追加 `?live=1` 可用当前 Claude 的真实列表复测（至少需要两个 Skill，
仅调用读取接口）。时间用于前后对比，不使用依赖设备性能的固定通过阈值。

Skill 页面分组、预览模式与开关闪屏回归：打开
`/tests/features/resources/skill-browser.html`，点击 **Run skill browser checks**。
使用隔离的网络和剪贴板样例，覆盖搜索展开边界 / 标题保留 / Esc 与聚焦、Skill 外层间距、初始折叠和 1:2 分栏、分组状态保留、
启停成功 / 失败的 DOM 与滚动保留、紧凑标签的高度稳定、绝对路径与复制、文本模式 / 高亮、二进制读取路径，以及 390px
iframe 中的移动端列表 / 文件 / 返回操作，不修改真实 Skill。
附加 `?reduced-motion=1&dark=1` 检查深色和减少动态效果。检查会逐帧采样启停时
右栏按钮及图标的透明度，覆盖保存成功、失败与重复点击；临时保存仍阻止重复操作，
仅真正不可用的操作采用禁用淡化样式。

PDF 预览回归：打开 `/tests/features/resources/skill-pdf-browser.html`，点击
**Run PDF preview checks**。在内存生成有效单页 PDF，通过实际的 SkillContent 和
共享 PDF 查看器渲染，并检查二进制读取与源文件 Tab 禁用。

MCP 页面浏览器回归：打开 `/tests/features/resources/mcp-browser.html`，点击
**Run MCP browser checks**。使用隔离的服务、能力列表、网络及剪贴板样例，覆盖
搜索 / Esc 焦点、分组与范围选择器移除、分栏、紧凑工具栏、重测成功 / 失败时的
结果与滚动保留、防重复请求、Tab / 最近服务切换、复制配置、只读 / 禁用限制、
项目连接的 cwd、最近详情数量上限，以及 390px iframe 的搜索、Tab 和返回操作。
附加 `?reduced-motion=1&dark=1` 检查深色和减少动态效果；不会连接或修改真实服务。

Subagent 测试流客户端：

```sh
./services/agent-runner/ts/node_modules/.bin/tsx --test agent-ui/tests/features/resources/agent-resource-api.test.ts
```

测试继续放在 `agent-ui/tests/` 的对应目录中，遵守根 `AGENTS.md` 的测试组织要求。
只报告实际运行的检查；执行受阻时说明原因和未验证范围。后端测试及编译产物的
Pi MCP 生命周期探针仍由根 `AGENTS.md` 维护。

Switch 浏览器回归：在 `agent-ui/` 运行 `npm run dev`，打开
`/tests/components/animate-ui/radix/switch-browser.html`，点击 **Run switch checks**。
再分别带 `?reduced-motion=1`、`?dark=1` 验证减少动态效果和深色样式。检查覆盖
受控/非受控状态、label 激活、禁用、表单值、服务端等待、快速切换、按压和释放。
运行后可用 Tab 聚焦 **Controlled switch**，按 Space 验证真实键盘激活。
