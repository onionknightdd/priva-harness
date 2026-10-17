# Skills / MCP 迁移方案

状态：Skills / MCP 资源管理已实施；2026-10-13 将 Pi MCP 切换为 Pi 1.2.0 原生扩展。
核对日期：2026-10-17。

## 范围

- 迁移全局和项目 Skills、MCP 的来源分组、详情和核心管理功能。
- 不迁移 Slash commands、Skill Hub，以及旧项目 CP proxy。
- 参考 `priva-cloud/web/user` 的列表 / 详情布局，沿用当前项目的
  shadcn/ui、主题 token、Animate UI / Motion 和 reduced-motion 行为。
- Pi MCP 使用原生 MCP、Codemode 和 Tool Search 扩展；旧 adapter 不再加载。

## 当前版本和运行目录

| 依赖 | 当前核对版本 |
| --- | --- |
| Claude Agent SDK | 0.3.301（当前项目安装版本，Claude CLI 2.1.301） |
| Pi coding agent / AI | 1.2.0 |
| pi-subagents | 0.21.0 |
| pi-dynamic-workflows | 3.14.0 |
| pi-code（只加载 Memory） | 1.5.2 |

Runner 使用各 harness 的原生目录，运行、会话存储与资源管理解析到相同路径。
未设置原生目录环境变量时：

```text
~/
+-- .claude/           Claude 全局目录
+-- .claude.json       Claude 全局 MCP / 本地项目配置
+-- .pi/agent/         Pi 全局目录
+-- .bambuddy/         产品设置与数据（RUNTIME_HOME_DIR 可覆盖）
```

Runner 不设置或覆盖 `CLAUDE_CONFIG_DIR`、`PI_CODING_AGENT_DIR`，也不再创建
产品根下的 `harness/` 目录。外部已设置的原生变量由各 harness 自身规则解析。
在相同用户和环境下，普通终端的 `pi install` 与 Runner 使用同一个 Pi 目录。
更改产品 `RUNTIME_HOME_DIR` 不影响 harness 目录；已有产品根下的 harness 文件不自动迁移。
Runner 将 Pi 原生 MCP、Codemode 和 Tool Search 作为 SDK extension factories 显式注册。
SDK 不会自动加载这些内建扩展。`pi-mcp-adapter` 依赖和它提供的 `mcp-scripting`
skill 已移除；若用户 Pi settings 仍配置 adapter，启动会给出移除提示，避免它接管
原生 `/mcp`。Runner 不自动修改用户配置、不继续读取旧 adapter 来源。

## 发现与执行分开

```text
当前项目 + SDK 会话目录中已知的项目
                 |
                 v
       Skills / MCP 来源目录
       |                  |
       v                  v
  来源分组、详情      指定 cwd 的有效配置
                          |
              +-----------+-----------+
              v                       v
         Claude SDK              Pi SDK 原生扩展
                         MCP / Codemode / Tool Search
                                      |
                          session_start / shutdown
```

“所有项目”是当前目录和已知会话的项目目录，不代表遍历整台机器。项目目录应
规范化和去重；列表不需要模型 profile，也不创建模型会话或连接 MCP。

### Skills

- Claude 的 `supportedCommands()`、`reloadSkills()` 都不是完整的来源目录接口。
  两者对 `user-invocable` / `disable-model-invocation` 的收录也不同。
  `resolveSettings()` 可以复用设置及其来源，但不直接枚举 skill 文件。
  因此使用来源文件发现；本页展示配置目录，不把它标成已有会话的实时加载状态。
  启停使用当前 SDK 原生 `skillOverrides[name] = on/off`，不修改权限 deny 列表；
  已有 deny 规则仍被尊重。该设置按名字作用于当前范围内的同名 Skill。
- Pi 使用 `DefaultPackageManager.resolve(async () => 'skip')` 获得资源路径、
  enabled 和 metadata。随后复用 SDK 的 skill 解析，保留每个声明的来源。
  不用一次 `DefaultResourceLoader.reload()` 代替管理目录扫描：它可能安装
  缺失 package、执行扩展，而且最终 skill 列表已经过滤禁用项和同名冲突。
- 来源至少保留 `harness`、`scope`、`cwd`、`origin`、真实路径，以及 package
  source。`source: auto` 本身不足以区分全局与项目。
- 包内 skill 展示为 package 来源。修改能力由来源决定，不能把每条记录都
  当成可直接删除或可独立启停的本地目录。

### Pi MCP：原生配置目录

只读取 `<Pi agentDir>/mcp.json` 和 `<cwd>/.pi/mcp.json`。原生 JSON 不支持 JSONC。
项目配置是否生效由 Pi `ProjectTrustStore` 与全局 `defaultProjectTrust` 决定；
未知项目的 `ask` 不能当作已经信任。目录可展示尚未信任的项目声明，但不会把它
标记为已启用，也不自动探测它。可信决定变化后要重载会话。

```text
<Pi agentDir>/mcp.json -----------+
                                +--> 原生 MCP 有效配置 --> 会话连接
<cwd>/.pi/mcp.json -- 信任检查 --+
       |                         |
       +--> 原始配置目录 / CRUD --+
```

项目完整连接定义替换同名全局定义，不合并 env、headers 或 args。没有 command、url、
type 的项目声明只能覆盖全局服务器的 enabled、exposure、toolExposure；它必须有全局
服务器作为基础。服务器名只允许字母、数字、下划线和连字符，不能存在只因 `-` / `_`
不同的两个名称。`auth.provider` 只允许在全局文件使用。

`src/pi-config.ts` 提供共享的配置预览校验、信任查询和旧字段检查。资源目录仅预览
原生两层语义；真实连接始终由 `createMcpExtension()` 的默认原生加载器解析。
不深层导入 Pi 包私有 config 模块。目录扫描不运行扩展、不调用模型、不连接 MCP，
也不执行环境变量值中的凭据命令。

原生配置使用 `enabled: false` 停用服务，`exposure` 控制工具默认暴露模式：
`codemode`（默认）、`deferred`、`direct`、`hidden`。工具级 `toolExposure` 支持
精确名称和 `*` 模式；精确名称优先，模式按顺序匹配。工具开关写入精确 hidden；
重新开启后恢复继承，若继承仍为 hidden，则设置为 codemode。

旧 adapter 的 `disabled`、`includeTools`、`excludeTools`、`httpTransport`、socket
等字段会产生明确诊断，运行会话在扩展加载时拒绝这些字段，防止原生 Pi 忽略旧字段后
意外启用工具。文件保持原样，用户需要重新配置为原生格式。原来的共享 `.mcp.json`、
`~/.agents` MCP、host imports、package `pi.mcp` 和 Agent Plugin MCP 来源不再作为
Pi 运行配置发现；不提供自动迁移、兼容读取或回退到 adapter。

### Pi MCP 运行时

```text
createPiResourceLoader
  +--> createProductCodemodeExtension（mode:on，默认启用）
  +--> createToolSearchExtension（按 deferred MCP 需求启用）
  +--> createMcpExtension（原生默认配置加载器）
            |
       session_start --> 后台连接 / 原生 mcp__server__tool
            |
       Codemode --> 子工具 --> parentToolCallId / 原生工具事件
            |
       session_shutdown --> 关闭连接与子进程 --> dispose
```

资源页和原生 `/mcp` 编辑相同两份文件。外部修改后需要原生 `/reload`；目录刷新
重新读取文件。配置状态、独立探测结果与实际会话连接状态不能混用。

原生支持 stdio 和 Streamable HTTP，不支持 legacy SSE、Unix socket 或 WebSocket。
OAuth 登录、登出、动态凭据及连接状态由原生 `/mcp` 管理，凭据使用 Pi 的
`mcp-auth.json`。资源页独立短连接探测不复用该凭据存储，返回需原生认证的明确错误。
Claude 的 SSE 探测保持其自身语义。

原生 MCP 工具默认通过 Codemode 查找和调用；完整工具结果交给脚本处理，模型只看到
脚本输出。每个子调用仍经过 Pi 的工具校验与权限钩子，并携带 `parentToolCallId`。
原生资源工具包括 list/read/template；MCP Apps 的 ui:// / HTML 资源不在本轮范围。

## 已实现接口

统一前缀 `/api/sandbox/resource`。请求明确指定 `harness`；`cwd` 用于选择
项目上下文。稳定 ID 包含来源身份，不能只使用 skill / server 名称。
列表返回来源分组、记录、来源支持的操作和诊断。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/skills` | 按来源分组的目录 |
| GET | `/skills/{id}` | skill 元数据、SKILL.md 内容、文件树 |
| GET | `/skills/{id}/file` | 读取 skill 内文本文件，`path` 为相对路径 |
| GET | `/skills/{id}/asset` | 读取 skill 内图片 / PDF 原始数据，`path` 为相对路径 |
| GET | `/skills/{id}/download` | 下载归档 |
| POST | `/skills/upload` | 上传到明确的全局或项目来源 |
| PATCH | `/skills/{id}` | 修改该来源实际支持的启用策略 |
| DELETE | `/skills/{id}` | 删除可写的本地 skill |
| GET | `/mcp` | 按来源分组的配置目录 |
| GET | `/mcp/{id}` | 原始定义及有效配置解释 |
| POST | `/mcp` | 在指定来源新增配置 |
| PATCH | `/mcp/{id}` | 修改指定来源的定义 |
| DELETE | `/mcp/{id}` | 删除指定来源的声明 |
| GET | `/mcp/{id}/capabilities` | 连接已保存配置，获取能力与服务端版本 |
| POST | `/mcp/validate` | 测试草稿连接与能力 |
| POST | `/mcp/validate/tool` | 显式调用测试工具 |

两个能力检测接口均返回 `tools`、`resources`、`prompts`、`testedAt` 和
`serverVersion`。版本是 MCP 握手中的服务端版本，类型为 `string | null`，缺失时返回 null。
详情可见时立即检测，每次完成 30 秒后再测；文档或缓存详情隐藏时暂停，恢复可见后立即检测。
检测不重叠，旧请求不覆盖当前服务，失败保留上次能力清单。工具调用只由用户提交参数表单触发。

```text
可见详情 -> 连接 + 握手 -> 能力 / serverVersion -> 状态点 + pill
    ^                       |
    +----- 30 秒后重测 ------+
隐藏详情 -> 暂停，恢复可见 -> 立即检测
工具 inputSchema -> 参数表单 -> 用户执行 -> /mcp/validate/tool
```

Streamable HTTP 的能力探测和工具测试通过自定义 `fetch` 跳过 GET：在本地返回空的
`405 GET stream disabled` 响应，避免为短时探测建立独立事件流；GET 事件恢复也会被拦截。
其他方法正常发送并保留请求头，POST 返回的 JSON 和 SSE 响应均可处理。
此策略仅作用于资源 probe；显式配置 `type=sse` 或 `httpTransport=sse` 的旧 SSE
transport 仍发起 GET，provider 的运行时连接不受影响。

```text
Streamable HTTP probe -> GET      -> 本地 405
                     -> 其他方法 -> fetch -> JSON / SSE 响应
显式 SSE probe        -> GET      -> 服务器 SSE 连接
```

源级原始配置与指定 cwd 的有效配置需区分；被覆盖记录不可误报为生效。
启停必须映射到 provider 真正支持的语义，不能只保存一个与运行时无关的布尔值。

## 已确认并实现的 UI 布局

```text
Desktop
+------------+------------------------+----------------------------------+
| App sidebar| Skills / MCP           | Selected resource                |
| Provider   | Search   Refresh   Add | Name / source / primary actions  |
|            |                        |                                  |
| Agent Skill| v Global ------------  | Skills: Source / Preview tabs    |
| MCP        |   > [Skill] name       | MCP: tools / prompts / resources |
|            | > Project * repo ----  | Markdown / image / PDF / code    |
|            |   v [Skill] name       | Tool selection -> test drawer    |
|            |       SKILL.md         | /absolute/path     Copy [Tabs]   |
+------------+------------------------+----------------------------------+

Mobile
+------------------------+       +------------------------+
| Skills / MCP     Add   |       | < Back      Name       |
| Search / Refresh       | ----> | Source / actions       |
| Grouped source list    |       | Resource details       |
+------------------------+       +------------------------+
```

Global 与各项目直接作为分组，使用 14px 二级文本标题与分割线，无背景。
Skill 页中文分组标题显示为「全局skill」和「项目」加项目名；项目标签与名称之间
使用 CSS 圆点标记分隔，标记对辅助技术隐藏，不使用文本分隔符。
项目名显示目录末级名称，完整路径保留在悬停提示中。同名项目按完整路径区分。
组内直接显示资源，不再展示 Project 或来源的中间层级；条目悬停提示和详情
保留来源信息，同名资源仍按来源 ID 区分。上传按钮为无边框、无背景的图标按钮。
列表行首（Skill 展开箭头）、分组标题与空状态提示统一使用 16px 左边距，
与顶部标题和筛选控件对齐。

Skills 复用文件浏览器的 `FileBrowserTree` compact 样式，仅将根节点图标换为
Skill 图标；保留相同的树行、缩进线、文件类型图标、大小列、选中 / 悬浮反馈及
200ms 展开动效和 reduced-motion 行为。Skill 根行隐藏折叠箭头，点击和键盘展开行为
保持可用，内部目录仍显示箭头。每个 Skill 默认折叠，可独立展开。
首次展开（包括方向键展开）才加载文件列表，与右侧详情共享请求缓存；切换 Skill
或再次展开复用已加载结果，刷新 / 上传 / 删除 / 切换项目时失效。加载中手动收起
不会在请求完成后被重新展开。Skill 树不接入文件浏览器的文件系统修改菜单。
桌面点击 Skill 查看默认 SKILL.md，点击内部文件查看对应内容；移动端先展开树，
点击文件再进入详情。MCP 工具测试使用抽屉。

2026-09-09 分组与预览调整：Skills 已移除项目范围筛选。标题右侧的搜索图标参照
侧栏项目区，点击后在同一行展开输入框；搜索在本地过滤资源，Esc 清空、收起并归还焦点。
所有一级分组可折叠，初次仅展开全局 Skill 组。
项目组首次展开才挂载条目，收起后保留已展开 Skill 的树状态。
桌面左右栏默认占内容区域的 1/3 和 2/3，仍可拖动调整；移动端保持列表 / 详情切换。

右栏仅显示 16px Skill 名称与描述，移除大图标、来源标签、来源路径和权限说明。
启停标签为 16px 高的紧凑 pill，与名称同行，状态变化不增加头部高度。两栏的操作按钮
统一为 20px 按钮 / 14px 图标。文件工具栏左侧以二级文本显示绝对路径，右侧为复制按钮
及 28px 高的 `@animate-ui/components-radix-tabs`「源文件 / 预览」Tab，默认预览。
移除文件下拉菜单，文件选择统一由左侧树完成；复制的是完整原始文本，含 frontmatter，
尚未加载文本及二进制文件禁用复制，成功 / 失败提供图标和可访问反馈。
源文件只显示文本与行号，不运行语法高亮；预览复用文件浏览器的 Markdown、图片、PDF
渲染器，其他文本按扩展名使用带行号的 Shiki 高亮，未知语言保持带行号的纯文本。
SKILL.md 的预览省略 frontmatter，源文件保留完整内容。图片和 PDF 按需读取 asset 接口，
不经过文本接口；二进制文件禁用源文件模式，SVG 仍支持源码。暂不支持的二进制类型
显示不可预览状态。PDF 渲染模块仍为按需加载。

```text
Skill 组：全局（默认展开） / 项目（默认折叠）
  -> Skill 树（首次展开加载，收起保留状态）
  -> 当前文件
       源文件 -> 文本接口 / 已有 SKILL.md -> 纯文本 + 行号
       预览   -> Markdown / 图片 / PDF / 按扩展名高亮 + 行号
启停开关 -> PATCH 返回详情 -> 原位更新缓存 -> 后台同步列表状态
                                └─ 保留文件、Tab、预览 DOM 与滚动位置
```

启用 / 停用不再触发整页刷新和详情重挂载。保存成功后同步同名 Skill 可能受原生权限
影响的列表状态；失败时显示错误，保留当前预览。项目上下文变化和重叠的状态同步请求
不会用旧响应覆盖当前缓存。

2026-09-09 性能调整：详情与上传表单按需加载，首次进入列表不等待预览模块。
详情缓存保存已完成的数据，命中时直接使用，不先清空或显示旧资源。
最近三个 Skill 预览通过 React Activity 保留 DOM，隐藏时停用 effects；切换回去
复用 Markdown / 代码渲染结果，刷新或项目 / Harness 变化时失效。
Skill 树通过 memo 限制无关条目的重复渲染，资源响应和代码高亮结果使用 React transition
提交，允许浏览器在内容渲染期间响应输入。完整 Markdown 不执行流式补全解析。
代码高亮沿用现有 Shiki 语言加载方法，初始化不再预加载几十种语言，仅加载文档使用的语言。
多个代码块的着色计算之间让出主线程；文件 Markdown 的屏幕外代码块先显示完整纯文本，
进入可见区域后再高亮，避免初次打开长文档时同时创建所有着色 token 的 DOM。

```text
进入 Skill 页 -> 列表与折叠树
点击 Skill   -> 即时选中反馈
             +-> 已缓存预览 -> 显示保留的 DOM
             +-> 首次预览   -> 按需读取 / 加载模块 -> 可中断渲染
```

本机 Vite 开发服务器、同两个真实 Skill 的新标签页测量快照（单位 ms）：

| 操作 | 内容出现：修改前 → 修改后 | 最大帧间隔：修改前 → 修改后 |
| --- | --- | --- |
| 进入列表 | 243 → 126 | 25 → 17 |
| 首次预览 | 209 → 260 | 217 → 33 |
| 切换另一个 Skill | 244 → 137 | 167 → 33 |
| 切回已打开的 Skill | 108 → 41 | 58 → 33 |

这些是各一次测量的快照，包含开发模式、模块加载和设备状态的影响。
首个预览仍需要加载模块与解析内容；修复优先消除长时间阻塞界面的任务。
接口测量约 4–23ms，当前样本的瓶颈在前端，因此保留后端实时发现与外部修改检测行为。

上传 / 新建 / 编辑使用现有 Dialog 和表单组件。覆盖 loading、空列表、
搜索无结果、错误重试、只读来源与保存中状态。

Skill 上传使用 `@shadcnblocks/file-upload/file-upload-dropzone-1`，依赖采用 Dice UI
官方 `base-vega` 版本。支持拖放或键盘选择单个归档、文件名 / 大小展示、移除与
提交前的格式 / 3 MB 大小校验；提交使用原上传接口，错误保留在弹窗内。
文件列表使用 Motion 淡入并尊重 reduced-motion；不模拟上传进度。

2026-09-08 Skill 折叠树验证：`skill-tree-browser.html` 的 21 项交互检查、原文件浏览器的
52 项检查、资源 / 上传的 6 项测试和宽度测量的 9 项测试均通过；前端 build / lint
通过，相关修改无新增 lint 警告。实际 Pi 资源页验证了默认折叠、展开文件列表和
SKILL.md 预览。浏览器检查入口见 [前端验证命令](../front-end-desgin.md#development-and-verification)。

2026-09-09 性能修复验证：23 项 Skill 交互检查、9 项预览复用 / 滚动高亮 / 语言与
Diff 检查、6 项资源 / 上传测试通过；前端 build / lint 通过，修改处无新增 lint 警告。

## 2026-09 历史 adapter 接入验证（已被原生实现替代）

验证在临时目录运行，没有安装到用户或 Runner 的正式 Pi 目录，没有调用模型。

- 使用当前 SDK 的 `installAndPersist()` 安装 `pi-mcp-adapter@2.32.1`，
  `resolve()` 正确返回 package 来源的扩展及 `mcp-scripting` skill。
- 使用当前 SDK 的 `DefaultResourceLoader` 加载插件，无扩展加载错误；
  运行时注册 `mcp` 和 `mcpScript`。
- 绑定扩展前没有启动状态事件；绑定后收到服务器状态，关闭事件后收到空快照。
- 用本地临时 stdio MCP 服务器，通过已注册的 `mcp` 工具完成 echo 调用。
- 隔离的六层配置 fixture 验证来源顺序、同名覆盖、provenance 写入位置，
  以及只改变 URL 不改变 discovery fingerprint 的边界。
- 第一次工具测试中“lazy 在启动时绝不连接”的断言失败；源码及冷缓存行为
  解释为 bootstrap，修正预期后真实工具调用和关闭验证通过。

## 2026-09 资源管理实施记录

- 来源、覆盖、CRUD、路径规范化、JSONC 并发写入、外部同数量配置编辑、归档限制、
  文件路径越界、符号链接、Claude 原生 skillOverrides 和 Pi exclusions 均有回归测试。
- 15 个路由通过真实 HTTP 注入验证。MCP 使用本地 stdio fixture 完成分页能力发现、
  环境变量展开及实际工具调用；不依赖模型 profile 或模型请求。
- 两个 Pi 会话分别加载不同 cwd，实际调用 MCP；配置已安装 adapter 时仍只注册一次；
  显式 shutdown 后测试子进程正常退出。源码和编译后的生产 loader 均已运行验证。
- 浏览器验证桌面双栏、Skill 内联文件树、移动端详情 / 返回、MCP 表单和 JSON 互转、
  能力列表、工具测试抽屉与结果。自定义淡入使用 Motion 并尊重 reduced-motion。
- 写入后使空闲会话失效；正在执行的轮次保留当前快照，完成后释放，下一轮重新加载。
  外部文件修改在下次目录请求中重读；已有运行时不会因仅浏览页面而被重启。

连接测试使用独立的短期 MCP client，支持 stdio、HTTP、SSE 与显式凭据。保存后的
测试使用所选项目的有效定义；草稿按提交内容测试。完整配置中的 OAuth、动态凭据、
Unix socket / WebSocket 等高级选项交给 provider 运行时，本页不实现其认证流程。
生产网络中的 HTTP / SSE、OAuth 未做在线验证。

包和导入来源只读；无法从公开 API 确定文件来源的条目以只读来源和诊断呈现。
归档上传限制为 3 MB、单 Skill 目录，支持 ZIP / .skill / TAR / TGZ；预览文本上限 1 MB，图片 / PDF 上限 20 MB。asset 接口复用 Skill 目录的真实路径及
符号链接边界校验，并发送 nosniff 和 sandbox CSP。
上传时忽略 macOS 压缩元数据（`__MACOSX`、`.DS_Store`、`._*`），这些条目仍需通过
路径和解压限额校验，不会写入 Skill 目录。其他目录外文件会在错误中指出具体路径。
配置写入只修改所选来源，保留其他 JSON 字段；JSONC 注释在保存时规范化为 JSON。

2026-09-08 验证快照：后端 82 个测试文件、412 项测试通过；前端资源辅助函数
3 项测试通过；后端 typecheck / build 与前端 build 通过。Skills/MCP 相关文件的
定向 ESLint 通过，前端 lint 无本功能警告。全量后端 lint 的 13 项错误位于同时
编辑中的 Memory / SubAgent 文件，本次未修改这些实现。浏览器使用临时目录和
独立服务端口验证，测试进程、页面与临时目录已清理。

测试入口：`tests/unit/infrastructure/resources/resource-catalog.test.ts`、
`tests/integration/transport/http/resources.test.ts`、
`tests/unit/provider/pi/pi-resource-loader.test.ts` 和
`agent-ui/tests/features/resources/resource-api.test.ts`。

参考：[npm 发布包](https://www.npmjs.com/package/pi-mcp-adapter/v/2.32.1)、
[项目说明](https://github.com/nicobailon/pi-mcp-adapter)、
[配置源码](https://github.com/nicobailon/pi-mcp-adapter/blob/main/config.ts)。
上述版本结论以 2.32.1 tarball 为准，main 分支可能已包含后续功能。

2026-09-09 分组 / 预览 / 开关验证：22 项页面检查（其中包含 4 项移动端子检查）、
3 项 PDF 实际渲染检查、9 项预览性能回归检查、6 项资源辅助逻辑测试和 17 项后端
资源测试通过。前后端构建、后端 typecheck / lint、前端 lint 通过；前端仍有现存的
Fast Refresh 等 lint 警告及大型依赖分块构建警告。

2026-09-09 最新 UI 微调验证：32 项 Skill 页面检查通过，包含搜索聚焦与 Esc、
复制完整文本、绝对路径、图标尺寸、16px 禁用标签的高度稳定及移动端子检查。
23 项 Skill 树、52 项文件浏览器树、9 项预览缓存 / 高亮浏览器回归，以及
9 项文件树测量测试通过。前端 build / lint 通过，仍保留原有 lint 与大包警告。

## 2026-10-13 原生 MCP 切换验证

原生 `tests/fixtures/resources/pi-mcp-probe.ts` 使用隔离 HOME/agentDir、两个项目 cwd 和
本地 stdio fixture，不调用模型。它验证 Codemode 实际调用 echo、cwd 隔离、hidden 工具
不可达、带 parentToolCallId 的嵌套事件，以及 session_shutdown 连接清理。生产探针继续
使用 AGENTS.md 中的命令，在 build 后传入编译后的 pi-resource-loader.js。

资源测试覆盖同名完整替换、三字段 override、信任拒绝、旧 adapter 字段明确诊断、
原生工具开关与保留配置文件内容。Memory 回归测试使用 pi-code 1.5.2 的 .ts 配置导入，
确保仍只读取 Pi 配置并保持项目内存隔离。真实 OAuth 与生产网络服务器需部署后验证。

参考：[Pi 1.2 MCP](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/mcp.md)、
[Pi 1.2 SDK](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/sdk.md#codemode-mcp)。
