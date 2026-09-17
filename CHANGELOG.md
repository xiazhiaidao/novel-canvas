# 更新日志

本项目的版本号与功能里程碑对齐。所有变更记录在此文件，按时间倒序排列。

## 1.20.0（当前）

### 变更（分析视图收敛：5 个平级弹窗 → 1 个「分析」入口 + 标签页）
- **问题**：顶栏右侧原来并排 5 个按钮（关系矩阵 / 状态看板 / 手动连线 / 全书统计 / 时间线），各自打开一个独立弹窗。它们服务的是**同一件事——「换个角度看这本书」**，却占掉顶栏 5 个位置（顶栏此前共 13 个按钮 + 2 个下拉，密度偏高），且彼此互斥（开一个就得记得关掉）。项目里其实**已经有一套成熟的多视图收纳实现**：设置弹窗用 `settingsTab*` / `settingsPane*` / `switchSettingsTab()` 收了 4 个设置页；同样性质的需求存在两套解法，属于该统一的欠账。
- **无新增接口**：纯前端结构调整——5 个视图的渲染函数（`renderMatrix` / `renderBoard` / `renderLinkManager` / `renderTimelineList` / `renderBookStats`）**逻辑零改动**，只是改由统一入口按需调用。这也是这次敢合的依据：视图之间没有隐式耦合，各自只依赖自己的容器元素。
- **HTML**：5 个 `.modal-mask` 合并为 `#analysisModal`，内含 `.analysisTabs`（5 个 `.analysisTab[data-pane]`）+ `.analysisPanes`（5 个 `.analysisPane`）。**各视图的内部元素 ID 全部原样保留**（`#matrixBody`、`#boardSummary`、`#linkList`、`#bookStatsBody`、`#tlTitle` 等），所有既有 `getElementById` 与事件绑定不受影响。顶栏 5 个按钮收成 1 个 `#analysisBtn`。
- **CSS 关键点（都是会踩的坑）**：
  - `.modal` 自带 `overflow-y: auto`，而本块定义在 `.modal` **之前**，单类会被后者覆盖 → 必须用 **`.modal.analysisModal` 双类**提特异性才能让 `overflow: hidden` 生效，否则 pane 内滚动失效、出现内外双层滚动条。
  - 显隐**用 `.analysisPane.on` 类驱动，不用 `hidden` 属性**：pane 上的 ID 级 `display: flex` 会压过 `[hidden]` 的 `display: none`，切换标签时旧 pane 会继续显示。
  - 宽度**逐标签切换**（矩阵 1200 / 看板 1000 / 连线 640 / 统计 680 / 时间线 1000）：各视图原本的宽度是分别调过的，合并时不该强行统一成一个值；由 `[data-pane]` 属性 + `transition: width .18s` 实现。
  - 新标签条 `.analysisTab` 用**下划线式**，与矩阵内部原有的胶囊式 `.matrixTab`（二级标签）视觉上明确分级，避免两层标签看起来同级。
  - 矩阵 / 看板 pane **自身不滚动**（`overflow: hidden`），滚动交给其内部本来就带 `flex:1; overflow:auto` 的 `#matrixBody` / `#boardBody`；统计 / 时间线 / 连线则由 pane 统一提供滚动。
  - 顺带修掉两处死样式：`.linkList` 原本自带 `max-height: 50vh; overflow-y: auto`（现在有外层 pane，会变双层滚动条）、`.linkModal .danger` 选择器随弹窗移除而失效（改挂 `.linkOptions .danger`）。
- **JS**：新增 `ANALYSIS_TABS` 元表、`switchAnalysisTab(tab)`（切类名 + 更新标题 + 按需渲染）、`openAnalysis(tab)` / `closeAnalysis()`。**保留 `openMatrix` / `closeBoard` 等旧函数名作为兼容壳**——各视图内部散落着「点完就关弹窗」的调用点，留壳比改十几处调用点更安全。全书统计的 `openBookStats()` 借机改为 `loadBookStats()`（只负责取数渲染，不再自己开关弹窗）。
- **统计数据加缓存**：同一次数据加载内反复切标签不再重复打接口；`loadData()` 里清空缓存键，数据一变自然刷新。请求返回时若用户已切走则不写入隐藏 pane（避免浪费和状态错乱）。

### 新增（④ 全书统计支持下钻）
- **问题**：此前 `renderBookStats` **零 click 监听**——看到「伏笔回收率 0%」「大纲完成度 100%」这类数字，没有任何办法知道**具体是哪些**，统计只能「看个热闹」。
- 各卷行、大纲完成度、伏笔回收率、以及每个分类 chip 全部可点，就地展开明细列表（面板嵌在该行下方，`max-height: 240px` 自带滚动）。
- 明细内容：卷 → 该卷章节（含章号与字数）；大纲 → **待填写**的项；伏笔 → **未回收**的条；分类 → 该分类节点（超 60 个截断并注明）。**列表给的是「需要动手的东西」而不是全量清单**，这是下钻的价值所在。
- 明细条目再点一次 → 关弹窗 + `focusNode()` 跳到画布，形成「看到数字 → 看到明细 → 跳到节点」的完整动线。再点同一行 = 收起。
- 事件用委托挂在 `#bookStatsBody` 上并加 `_statsWired` 防重复绑定（该元素不被 `innerHTML` 替换，只需绑一次）。

### 修复（② 跳转行为统一：消除「点了像没反应」）
- **问题**：各视图跳转用的是**两套语义不同的 API**，行为不一致：
  | API | 行为 |
  |---|---|
  | `focusNode(id)` | **完整跳转**：清搜索词 → 展开折叠分组 → 激活节点分类 → 渲染详情 → 画布平移居中 + 闪烁高亮 900ms |
  | `showDetail(n)` | **仅渲染右侧详情面板**：画布不动、不高亮、不清搜索 |
  矩阵用的是 `showDetail`（点击后画布毫无动静），时间线缺高亮，只有看板用了 `focusNode`。
- **关键风险点**：`focusNode` 还自带一条保护——**先清空搜索框**。因为侧栏有词时目标节点会被 `applyFilters()` 过滤隐藏，`showDetail` 没有这层保护，**在有搜索词的情况下点击跳转，看起来完全像「按钮坏了」**。这条隐性依赖此前只存在于 `focusNode` 一处。
- **改动**：矩阵（命中格 / 行表头 / 列表头三处）、时间线节点行全部统一走 `focusNode`。矩阵原本按模式分支（章节模式 `axisJumpTo` + `showDetail`、角色模式 `showDetail`），现在不必分支——`focusNode` 自己覆盖了平移场景。时间线保留一条退化路径：找不到对应章节节点时退回 `axisJumpTo` 只平移轴。

### 修复（快照保留上限失效 + 写请求可能被清理动作挂死）
- **问题（两个，互为因果）**：
  1. `pruneBackups()` 声明「保留最新 100 个快照」，但实测 `.data/backups/` 已累积到 **216 个**——说明清理一直在失败，而失败被 `catch (_) {}` 完全吞掉，**承诺的保留上限实际上从未生效**。
  2. 更严重的是它的实现方式：`pruneBackups()` 处在**写请求路径**上（`snapshotFiles()` → `pruneBackups()`），且对每个超期快照调用一次 `fs.rmSync(dir, { recursive: true, force: true })`。超期 116 个就是**一次写请求内做 116 次递归删除**；在递归删除被安全策略拦截的环境里，第一个 `rmSync` 就会长时间阻塞，导致 `apply_proposal` / 文件保存这类请求**整个挂死**（实测现象：冒烟测试停在中途不再前进，日志里没有任何报错）。
- **改动**：
  - 改用 **`renameSync` 归档**到 `.data/backups/_pruned/` 取代 `rmSync` 删除。`renameSync` 只改目录项、不遍历内容，是 O(1)，不经过任何「递归删除」链路；而且**完全可逆**——万一以后需要找回被清理的旧快照，`_pruned/` 里还在。
  - **单次上限 20 个**：即使归档很便宜，也不该让一次写请求搬运上百个目录；多写几次自然收敛。
  - `snapshotFiles()` 里「一个文件都没拷成 → 丢弃空快照」那条分支的 `rmSync` 同样改为归档（同一类风险）。
  - `_pruned/` 目录被 `pruneBackups()` 自身跳过，不会被反复搬动。
- **对用户可见的影响**：此前只要快照数超过 100，**后续任何一次写入都有概率长时间无响应**；现在写请求不再受清理动作影响。

### 测试
- 冒烟测试 **112 → 116 项**，并修正 2 处被新结构影响的旧用例（原按 `#matrixBtn` / `#bookStatsBtn` / `#timelineBtn` / `#timelineModal` 定位）。新增 5 项：
  - **分析入口合并为单按钮**：`#analysisBtn` 存在、5 个旧按钮与 5 个旧弹窗 ID **全部为 0**、标签与 pane 的 `data-pane` 序列均为 `matrix,board,link,stats,timeline`。
  - **5 个标签互斥可见且宽度联动**：逐个切换后 `pane.on` / `tab.on` / `card[data-pane]` 三者必须一致，且非激活 pane 的 `getComputedStyle().display` 必须是 `none`（**这条同时验证了「不能用 `hidden` 属性」那个坑**）。
  - **跳转统一走 `focusNode`**：先往搜索框塞一个必然无命中的关键词并 `applyFilters()`，再点时间线节点，断言**搜索词被清空** + 弹窗关闭 + 详情面板有标题。这是本轮唯一能真正抓住 `showDetail` 回归的用例。
  - **全书统计可下钻**：卷行 `cursor: pointer` → 点开有明细且明细第一项的 `data-id` 在 `nodeMap` 中真实存在 → 再点收起 → 分类 chip 下钻 → 点明细跳转后弹窗关闭且详情有标题。
  - 另修正新用例「标签互斥」的自身逻辑错误：原把当前激活的 `timeline` 也列进了「应隐藏」集合。
- **统计标签用例的断言一并加固**：原来只断言 `body.childElementCount > 0`，而「加载中...」占位**同样是一个子元素**，会把「没渲染出来」的假象放过去。改为断言存在 `.statCards` 且 `innerHTML` 不含「加载中 / 加载失败」，并把固定 `sleep` 换成**轮询等待渲染完成**——本地接口只要几十毫秒，固定 sleep 既慢又不稳。
- 实测 **116/116 全绿**；另用 headless Edge 抓取 5 个标签 + 跳转后详情的真实渲染截图逐一目视核验（含展开的下钻面板），并单独探测亮/暗两套主题下弹窗卡片的 `background/color/overflow` 取值，确认主题与 `overflow: hidden` 特异性修复均生效。

## 1.19.0

### 新增（全项目搜索：跨文件全文检索）
- **问题**：侧栏自带的「搜索节点」（`app.js` 的 `#search` → `applyFilters()`）只匹配**已加载到画布的节点标题**——它既搜不到节点正文，也搜不到没有被画布收录的文件（`追踪/`、`大纲.md` 等）。写小说时最高频的真实需求是「**这个角色名 / 伏笔 / 设定词到底出现在哪些文件的第几行**」，此前无任何入口，AI agent 内部那个 `search` 工具也只能 AI 自己调。
- **后端 `GET /api/search`**（`server.js`）：`project` / `q` / `case`（区分大小写）/ `limit` 四个参数，返回**按文件分组**的结果，每组含 `count` 与逐条 `matches[]`，每条命中带 `line`（行号）、`text`（窗口文本）、`hits[].offset`（**片段内**偏移，供前端精确高亮）。
  - **每行压成「以首个命中为中心的窗口」**：`ftBuildLineWindow()` 先取出全行命中位置，再以首命中前 40 字、末命中后 60 字、总长上限 320 字开窗，两端截断处补 `…`（同时把 `offset` 加上前置省略号占的 1 个字符位）。这样前端只需按 offset 切片即可高亮，完全不必关心原行有多长、命中有几处；避免了「超长行返回整行几千字」与「命中在行尾被截掉」两个坑。
  - **性能与安全护栏**（全部必要，非保守取值）：扫描文件数上限 800、单文件体积上限 2MB（个别语料导出文件可能几百 MB，`readFileSync` 会瞬间吃满内存）、总命中上限 500、单文件命中上限 50、单行展示命中上限 8；`isSafePath` + `isMdPath` 复校验（`listMdFiles` 已跳过符号链接，这里再挡一道路径穿越）；关键词超 200 字直接拒绝。
  - `flattenMdFiles()` 把 `listMdFiles()` 的树拍平成路径列表复用；`ftMatchPositions()` 的 `from = at + needle.length` 保证指针前进，杜绝空匹配死循环。
- **前端弹窗**（`index.html` + `app.js`）：`#ftSearchModal` 复用既有 `.modal-mask` / `.modal` 体系，含输入框、`Aa` 区分大小写开关、结果分组列表（文件名 + `N 处` 计数 + 完整路径）、底部「↑↓ 选择 · Enter 打开并定位 · Esc 关闭」与扫描范围。入口两个：状态栏 `全文搜索`（与 `? 快捷键` 并列）与快捷键 **`Ctrl+Shift+G`**（`Ctrl+Shift+F` 已被专注模式占用，故取 G=Global）；快捷键速查表同步补上此条。
  - **输入防抖 220ms**：不防抖时每敲一个字都会触发一次全项目读盘扫描。
  - **并发请求用序号丢弃**（`ftSeq`）：慢请求后到会覆盖掉新词的结果，属经典竞态，必须丢弃过期响应而非依赖到达顺序。
  - **高亮必须「分段转义再拼接」**（`ftHighlightWindow()`）：不能先 `escapeHtml` 整段再按 offset 插 `<mark>`——转义会把 `<` `&` `"` 撑成多字符实体，其后所有 offset 立即错位。重叠命中（搜 `aa` 命中 `aaa`）直接跳过，避免嵌套标签。
  - 打开弹窗时若画布搜索框有词且全文框为空，自动「升级」为全文搜索词，方便从「找节点」顺手扩到「找全文」。
- **结果跳转到指定行**（`file_editor.js`）：新增 `openFileAtLine(path, line)` 与 `jumpTextareaToLine(ta, line)`。textarea 没有「滚动到第 N 行」的 API，用 `scrollHeight / 总行数` 估平均行高 × 行号，再**减去 1/3 视口高度**留余量（宁可偏上不要偏下），同时**选中整行**——选中才是精准的定位信号。跳转会一并把侧栏切到文件模式，否则只开编辑区、左侧文件树不动，容易误判「跳转失败」。
  - 跳转行号用模块级 `pendingFileJumpLine` 传递、由 `renderFileEditor()` 消费：因为 `openFile()` 有「文件已在标签中打开」的分支，那条路径不走函数参数，只有 `renderFileEditor()` 是两条路径的公共出口；且定位放在下一帧，等 `activateEditorTab()` 折叠右栏的重排结束再滚，否则刚设的 `scrollTop` 会被清掉。

### 测试
- 冒烟测试新增 12 项（总计 **112 项**）：服务端 4 项（检索结构与**逐条校验 `hits[].offset` 在 `text` 中精确指向关键词** / 区分大小写开关 / 空词短路+无命中+超长拒绝+`limit` 截断与非法 `limit` 回落 / 拒绝越界项目名），前端 8 项（弹窗元素与 `openFullTextSearch`/`openFileAtLine`/`jumpTextareaToLine` 链路齐全 / `Ctrl+Shift+G` 唤出与 `Esc` 关闭 / **渲染结果且每处 `<mark>` 内容正好等于关键词** / 弹窗层级 / **输入防抖 4 次输入仅 1 次请求** / **竞态防护：慢请求不覆盖新结果** / 点击结果打开文件并选中对应行 / 第三轮无 JS 异常）。
- 关键词不写死：先由服务端在候选词里探一个**真实命中**的词，避免用例依赖具体小说内容。偏移校验与实际项目数据一起跑，本轮实测 1093 处命中零错位。

## 1.18.0

### 新增（编辑器查找替换 / 快捷键速查表 / Ctrl+S 保存）
- **文件编辑器查找/替换**（`file_editor.js`）：新增查找栏 `.fileFindBar`（默认隐藏），`Ctrl+F` 唤出查找、`Ctrl+H` 唤出带替换行、`Esc` 关闭。支持**区分大小写**开关、命中计数 `当前/总数`（无结果显示红框）、下一个/上一个**循环跳转**（第 1 处 → 最后一处回绕）、**替换当前**与**替换全部**（全部替换后计数提示「无结果」）。查找用原生选区 `setSelectionRange` 高亮，零依赖；`fileFindMatches()` 用「命中即前进 needle.length」保证单字符查询不死循环，也保证非重叠匹配。
  - 关键实现：全局 keydown 监听在每次 `renderFileEditor()` 时**先摘旧监听再挂新**（`fileFindGlobalKey`），避免多标签切换累积监听器；且仅在 `activeEditorKind === 'file'` 且 `#fileContent` 存在时响应。
- **快捷键速查表**：状态栏新增 `? 快捷键` 入口，`?` 键随时唤出（输入框/文本域/`contenteditable` 内不触发，避免打扰写作）、`Esc` 或点遮罩关闭。面板按「编辑器 / AI 对话 / 画布 / 全局」四组列出约 15 条快捷键，`kbd` 键帽样式随深浅主题适配。
- **Ctrl+S 保存补全**（修复缺口）：此前 `Ctrl+S` 只在**节点编辑器正文区**生效（app.js 内单独监听），在**文件编辑器**里按下会触发浏览器的「保存网页」对话框，而速查表却写着「保存」——属于文档与实现不一致。现于文件编辑器的全局快捷键里补上 `Ctrl+S`（`preventDefault` + 以 textarea 实际内容落盘），并同步修正速查表文案为「保存当前编辑器内容」。

### 优化（拖拽掉帧 / 安全加固，见前次提交）
- **拖拽重绘改 rAF 帧同步**（app.js）：`redrawEdges()` 由「每次 mousemove 全量重算」改为 `requestAnimationFrame` 合并（`scheduleRedrawEdges()`），拖拽结束用 `flushRedrawEdges()` 立即补最后一帧保证落点精确；同时把每条边两端节点的 DOM 查询从 `world.querySelector('[data-id=...]')`（O(2E·n)，每边两次全表扫描）改为**一次性 `Map` 元素缓存**（O(n) + O(1) 查表）。三处自由布局拖拽（节点/画布/多选）全部接入。
- **本地服务来源校验（防 DNS rebinding）**（server.js）：只绑回环地址并不能阻止外部网页通过 DNS 重新绑定访问本地数据。现于 `createServer` 入口、**处理任何路由之前**校验 `Host`（必须 `127.0.0.1` / `localhost` / `[::1]`，带端口自动剥离）与 `Origin`（`file://` 场景为字面量 `null`，放行），不通过直接 `403 JSON`。
- **请求体上限 16MB**（server.js）：`readBody()` 原无体积上限，超大请求可打爆内存。现累计超过 `MAX_BODY_BYTES` 即 reject 并停止累积，服务保持存活。

### 测试
- 冒烟测试新增 `9 + 1` 项：快捷键面板 3 项（可打开且含分组条目 / `?` 唤出与 `Esc` 关闭 / 输入框内按 `?` 不触发）、查找替换 6 项（`Ctrl+F` 唤出与计数 / 循环导航 / 无结果红框 / 替换全部 / 替换单个 / `Esc` 关闭与大小写开关）、`Ctrl+S` 保存 1 项。
- 查找替换用例会临时改写编辑器内容，故加了 `__frSetup` / `__frCleanup` 助手：用例结束**强制复原原文并清掉自动保存定时器**，否则会污染后续「自动保存」用例，更严重的是可能让防抖保存把测试文本写进真实稿件。`Ctrl+S` 用例全程使用独立临时文件 `_smoke_ctrl_s.md`，结束前删除并还原原激活标签，不碰真实稿件。

## 1.17.0（当前）

### 新增（流式输出+停止生成 / 上下文压缩省钱 / 导出+预算预警）
- **流式输出 + 停止生成**：聊天与「剧情军师/去AI味/伏笔审计/一致性检查」四按钮消息均改为 SSE 流式（`POST /api/chat` 支持 `body.stream === true` → `text/event-stream`，事件 `delta`/`tool`/`done`/`error`），回复逐字上屏、工具调用步骤实时可见；生成中「发送」按钮切换为红色「停止」按钮，点击即中断——server 端收到客户端断开后 destroy 上游 LLM 请求并回 `error: 已停止生成`。
  - **关键修复**：Node 24 的 undici `fetch` 在本场景下 `r.body` 的 reader 卡死（`reader.read()`/`for await` 均不返回数据），但 `r.text()` 与原生 `http/https.request` 正常——流式读取改用 Node 原生 `http.request`/`https.request` + `data` 事件逐块解析 SSE（含 `reasoning_content` 思考过程、`delta.content` 正文、`delta.tool_calls` 按 index 累积、末块 `usage`+`cost_cny`），彻底绕开问题。
  - 非流式路径（默认 `stream:false`）完全保留，冒烟测试与既有调用不受影响；流式调用照常累计 token 与费用（cost 取自流式末块 `usage.cost_cny`）。
- **上下文压缩省钱**：`compactToolResult()` 把工具返回压到单轮 4000 字符（保留 proposal_id/kind/file/isNew 等关键字段；read_node/read_file 保留标题路径+内容截断；列表类保留计数/标题）→ 多轮工具调用不再把大段内容反复塞回上下文；`buildAgentContext` 上限 30000 → 16000 字符；最近消息预算 12000 字符（从最新往前取，最多 20 条）——单次聊天上下文从实测 107K tokens 量级显著下降。
- **导出 CSV + 预算预警**：用量 tab「导出 CSV」按钮（⬇ 导出 CSV）——BOM + 汇总/每日明细/按模型/按项目/最近调用 5 段，文件名 `novel-canvas-usage-<range>-<日期>.csv`；设置页「每月预算上限（¥）」输入框 + 用量 tab 顶部预算横幅「本月预算：¥已用 / ¥预算（百分比%）」，超预算时横幅红色警示（⚠️ 已超预算）。
- **验证**：curl SSE 收到 `delta` 逐字 + `done`（「流式通」）；工具调用链（get_context→list_nodes→search→read_node→read_file→delta→done，288 事件）端到端正常；浏览器中停止按钮生成中显示、点击后消息区显示「（已停止生成）」；非流式路径返回正常 JSON；预算保存/回读=5、横幅显示 ¥0.0221/¥5（0.4%）；CSV 下载成功且含按项目段；16 服务商下拉、AI 设置加载正常。

## 1.16.1

### 新增（按项目统计：用量/费用/图表）
- **问题**：用量是全局的，`recordUsage` 不记项目，多项目用户看不到「列车求生」等各项目花了多少 token/钱。
- **后端**：`recordUsage(model, usage, respData, project)` 第 4 参 project；7 个调用点全部传入（4 个一致性功能用 `project` 参数，/api/chat 循环、/api/continue、/api/ai/edit 用 `body.project`）。新增 `byProject` 聚合（总/提示/补全/缓存/次数/费用），byChat 每条记 `project` 字段。`aggregateUsage`/`summarizeUsage` 返回 `byProject`（全量，同 byModel 不按时间过滤）。
- **前端**：用量 tab 新增「按项目（全量）」区块——项目占比环形图（conic-gradient，中心全项目总 tokens，右侧图例色块+项目名+百分比）+ 表格（项目/总 tokens/提示/补全/缓存/次数/费用）；最近调用行显示 📁项目名。
- **修复 bug**：`loadUsage()` 返回时丢 `byProject` 字段（`return {byDay, byModel, byChat}` 漏了），导致 byProject 每次只留最近一条——已补。
- **验证**：真实调用后 byProject「列车求生 = 13,136 tokens / ¥0.0039」、环形图紫色 100%（单项目）、表格 7 列、最近调用行 📁 标签；深浅主题探针通过。

## 1.16.0

### 新增（AI 多服务商接入：国内外主流模型）
- **问题**：此前只能接中转站 2 个模型（deepseek-v4-flash/pro），接入面太窄。
- **服务商预设表** `AI_PROVIDERS`（前端常量，OpenAI 兼容端点）——16 家国内外主流：OpenAI、DeepSeek 官方、Google Gemini、Kimi（月之暗面）、通义千问（阿里）、智谱 GLM、豆包（字节火山方舟）、文心一言（百度千帆）、硅基流动（聚合开源模型）、OpenRouter（聚合 Claude/GPT/Gemini/国产）、零一万物 Yi、阶跃星辰、腾讯混元、MiniMax、中转站（当前）、自定义。每家含默认 base + 常用模型列表 + 说明。
- **设置页「服务商」下拉**：选中自动填 base、刷新该服务商常用模型 chips（点击填入模型名）；按当前已保存 base 自动匹配服务商。
- **聊天面板模型下拉动态化**：按当前服务商模型置顶；自定义/未匹配时展示全部主流模型合集（48 个）；启动时从设置同步 base 与模型，保存设置后联动重建（`chatModelSync` 事件）。
- **兼容性**：server.js 本就是通用 OpenAI 兼容代理（base+key+model），无需改动即可调通各服务商；「测试连接」按钮可拉取服务商模型列表（不支持 /models 端点的服务商留空属正常，可手动填模型名）。
- **验证**：下拉 48 项全量/2 项当前服务商两种状态正确、选中值保留；服务商切换（通义千问）自动填 base + 刷新 chips；保存设置后聊天下拉联动重建；端到端 AI 调用正常（「通了」）。
- **注意**：Claude 官方 API 为 Anthropic 原生格式，需经 OpenRouter 等 OpenAI 兼容网关接入；模型名变化快，以各服务商控制台为准。

## 1.15.6

### 新增（费用统计：接入中转站 cost_cny）
- **根因**：中转站每次响应自带 `cost_cny`（人民币费用，实测 flash ¥0.0039/次），但 server 未记录；界面「费用估算」只能靠 ai-config.json 手配 `pricePerM`（未配则不显示）。
- **修复**：`recordUsage` 新增第三参 `respData`，`usageCostOf()` 提取 `cost_cny`（兼容 `cost_usd`/`cost.cny`/`cost.usd`）记录到 byDay/byModel/byChat 的 `cost` 字段；全部 7 个 LLM 调用点传入响应对象。
- **聚合**：`emptyUsageAgg`/`aggregateUsage` 增加 `cost` 累计；`summarizeUsage` 返回 `cost`（实际 ¥,currency=cny）+ `est`（pricePerM 美元估算,仅无实际费用记录时展示）。
- **前端**：汇总卡片显示「费用（¥）」（无实际费用时回退 $ 估算）；按模型表/每日明细表新增「费用」列（`—` 表示无记录）；最近调用行显示 ¥ 费用。
- **修复潜在 bug**：历史 byDay/byModel 无 `cost`/`cached` 字段时 `day.cost += cost` 得 NaN（JSON 序列化变 null → 聚合 0）——统一改 `(x || 0) +`。
- **验证**：真实调用后 `cost.total=0.0039`、byModel.flash.cost=0.0039、byDay.cost=0.0039、recent[0].cost=0.0039 全部一致；前端卡片/表格/最近调用费用显示正常；本次调用还实测到缓存命中 12,288 tokens（⚡ 标记）。

## 1.15.5

### 新增（用量统计图表：环形图 + 条形图）
- **环形图（扇形）**：「按模型占比」——纯 CSS `conic-gradient` 无依赖，按模型 tokens 占比分段（最多 8 色，超 8 个折叠提示），中心显示区间总 tokens，右侧图例（色块 + 模型名 + 百分比，hover 显示完整名）。
- **条形图**：「每日 tokens 走势」——所选时间段最近 30 天逐日柱状，柱高按最大值缩放，hover 显示当日 tokens 数值与日期，底部 MM-DD 标签。
- 两图均随时间段切换（今日/近7天/近30天/本月/全部）联动刷新。
- **修复**：初版 conic-gradient 段误塞模型名导致整段背景声明无效（浏览器忽略 → 显示默认灰环），去掉后正常。
- **验证**：7d 视图环形图 4 色分段（79.1%/14.4%/5.5%/1%）、条形图 4 天柱高 20%/2%/2%/100%；深浅主题计算样式探针 + 视觉评审通过（深色环心/图例/日期标签全部可读）。

## 1.15.4

### 新增（Token 用量统计界面）
- **设置弹窗新增第 4 个「用量」tab**：汇总卡片（总 tokens / 提示 / 补全 / 缓存命中 / 调用次数 / 费用估算）+ 按模型表 + 每日明细 + 最近 50 条调用记录（时间/模型/tokens，缓存命中标 ⚡）。
- **时间段切换**：今日 / 近7天 / 近30天 / 本月 / 全部，由 `/api/usage?range=` 后端聚合（byDay 按日过滤，byModel 全量）。
- **缓存命中统计**：`recordUsage` 新增记录 `prompt_tokens_details.cached_tokens`（OpenAI 兼容缓存命中）到 byDay/byModel/byChat；`byChat` 保留上限从 50 提到 200 条。
- **费用估算**：沿用 ai-config.json `pricePerM` 配置（若配了模型单价则显示美元费用）。
- **验证**：5 个 range 聚合正确（今日 908K/33 次、7d 1.12M/74 次、30d=all 1.35M/107 次、本月 939K/39 次）；浅色/深色主题计算样式探针对比度通过；时间段切换交互正常。

## 1.15.3

### 修复（「模型未返回内容」/推理模型兼容）
- **问题**：AI 对话/续写/文件修改时出现「模型未返回内容」或「（完成）」空回复。
- **根因**：中转站实测可用模型仅 `deepseek-v4-flash`（✅）与 `deepseek-v4-pro`（✅，推理模型+支持 tools）；`deepseek-chat`/`deepseek-reasoner`/`deepseek-v4-flash-vision-exp` 均返回 `MODEL_NOT_AVAILABLE`。且 `deepseek-v4-pro` 是推理模型，响应中正式回复在 `reasoning_content` 字段、`content` 为 null——server 所有 LLM 端点只读 `message.content`，导致 pro 模型在 `/api/continue`、`/api/ai/edit`、生成下一章等端点报「模型未返回内容」。
- **修复**：新增 `aiMessageContent(msg)` 统一提取回复（`content` → `reasoning_content` 兜底），替换全部 7 处 LLM 响应读取点（审查/修正/推进/生成下一章/chat 主循环/continue/ai-edit）；模型下拉收敛为 `deepseek-v4-flash`（推荐）/ `deepseek-v4-pro` 两项，移除中转站不支持的 3 个模型名；`CHAT_MODEL_MIGRATIONS` 补充旧名（deepseek-chat/reasoner/flash-vision-exp → flash）localStorage 迁移。
- **验证**：`deepseek-v4-pro` 经 `/api/chat` 返回「通了」；`/api/continue` 返回「续写通」；`/api/ai/edit` 返回正常修改内容（生成 proposal，未写盘）；`node --check` 通过；前端下拉 2 项默认 flash。

## 1.15.2

### 修复（AI 模型名与中转站 base 更新）
- **问题**：AI 对话报「模型不存在」，中转站提示仅支持 `deepseek-v4-pro` / `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp`；且连接失败（405）。
- **根因（双）**：① `.data/ai-config.json` 保存的模型名为旧版 `deepseek-v4-flash-0731`，中转站已改名；② base 为 `https://tokenrhythm.studio`（不带 `/v1`），`/chat/completions` 得 405——实际端点是 `/v1/chat/completions`（实测 `/v1` 与 `/api` 两路径均 200）；③ **配置读取 bug**：`saveAiConfig` 写 `key` 字段、`getApiConfig` 读 `saved.apiKey`，字段名不一致导致设置面板保存的配置永远不生效，实际一直走 inkpilot 扫描（`列车求生/.obsidian/plugins/inkpilot/data.json`，base 指向 DeepSeek 官方）。
- **修复**：`.data/ai-config.json` → `base=https://tokenrhythm.studio/v1`、`model=deepseek-v4-flash`（.gitignore 内不入库）；`server.js` `getApiConfig`/`aiConfigSource` 兼容 `key`/`apiKey` 双字段名（设置面板配置真正优先于 inkpilot）；`index.html` 聊天模型下拉 5 项（flash/pro/flash-vision/chat/reasoner）+ 设置页 placeholder；`app.js` `initChatModelSelect` 增加旧模型名 localStorage 迁移（`deepseek-v4-flash-0731 → deepseek-v4-flash`）。
- **验证**：`/api/settings` 返回 `source=saved`、`base=https://tokenrhythm.studio/v1`、`model=deepseek-v4-flash`；直连 `/v1/chat/completions` 200；经 `/api/chat` UTF-8 端到端返回「通了」（usage 正常累计）；前端下拉自动选中 `deepseek-v4-flash`。中转站 `/models` 返回空列表（端点不支持），不影响对话。

## 1.15.1

### 修复（AI 工具节点/文件查找健壮性）
- **根因**：`runAgentTool` 的 `read_node`/`edit_node`/`delete_node`/`create_link`/`remove_link` 用 JS 字符串精确匹配节点 id（大小写敏感），`read_file` 用精确路径——LLM 从正文/记忆推断的 id 与磁盘真实大小写不一致（如 `80-d批第一人` vs `80-D批第一人`）或段数拼错时反复报 `node not found`；猜带 `正文/` 前缀而项目无该目录时报 `file not found`（「获取项目上下文」时一连串工具失败）。
- **修复**：新增 `findNodeLoose(nodes, id)`——精确 → 大小写不敏感 → 按 id 尾部段匹配 → 候选提示；`resolveFileLoose(root, rel)`——精确 → 去「正文/」等前缀重试 → 只留文件名重试 → 目录内包含匹配候选。`read_node`/`read_file`/`edit_node`/`delete_node`/`create_link`/`remove_link` 全部改用宽松查找；错误消息附相近 id/路径候选，引导 LLM 下次用对。
- **工具描述更新**：`read_node`/`read_file` 说明 id/路径大小写不敏感、支持尾部段/去前缀回退。
- **验证**：临时脚本对「列车求生」真实数据复现日志全部失败场景（小写 id、少一段 id、混合大小写、`正文/` 前缀）→ 全部命中；`node --check` 通过。导出 `findNodeLoose/resolveFileLoose/buildNodes/resolveProjectRoot` 供测试与冒烟复用。

## 1.15.0

### 优化（AI 对话面板重构 · 完成）
- **工具区合并**：角色栏 + 指令栏统一收进 `#chatToolbar`，整体一个下边框，消除双线；两栏都可见时显示 1px 竖向分隔线（`.toolSep`，纯 CSS `:has` 控制）。
- **气泡分层**：用户气泡 = 琥珀渐变（浅色深棕字 / 深色米白字），助手气泡 = 面板玻璃卡（浅色白底 / 深色玻璃），`ref`/`tool` 消息按语义分色。
- **输入区现代化**：输入框聚焦金辉 + 圆角 12px；发送按钮亮琥珀渐变 `#fbbf24→#f59e0b` + 黑字（force-black 约束下对比 ≥7:1，深浅两主题一致）。
- **头部与胶囊**：头部标题浅色白渐变 / 深色提亮琥珀细条（黑字可读）；角色激活胶囊亮琥珀 + 黑字（原白字 on 琥珀对比不足 2.2:1，已修复）。
- **修复初始态 bug**：HTML `style="display:none"`（无空格）与 CSS `[style*="display: none"]`（有空格）不匹配，导致页面加载时空工具栏显示、分隔线误显——全量归一化为 `display: none`，`:has` 显隐逻辑初始态正确。
- **冒烟 +2 项**：`chatToolbar 自动显隐+分隔线(纯CSS :has)`（双栏隐藏→隐藏 / 单栏→显示无分隔 / 双栏→分隔线）、`发送按钮黑字可读(两主题)`。基线 88 → 90 项。
- ⚠️ 本会话环境沙箱阻止 headless Edge 启动（crashpad/mojo access denied），**全量冒烟未能在本会话跑完**；已用共享浏览器实测深浅两主题全部通过（CDP 计算样式探针 + 截图 + 视觉评审）。

## 1.14.1

### 优化（界面美感与布局）
- **顶部工具栏分组 + 呼吸感**：按钮按「核心操作 / 视图分析 / 专注」分组，组间加分隔线，统一间距与圆角，消除拥挤感。
- **左侧筛选按钮降噪**：未选中态更安静（透明底 + 细边），选中态琥珀渐变 + 细勾边，浅色不再抢眼、深色可读性增强。
- **画布提示气泡重设计**：`点击节点查看它的关联` 提示从居中移到画布左上角，改为毛玻璃胶囊（浅色柔白、深色墨蓝），不再遮挡节点，与整体风格协调。
- **右侧详情空白态精致化**：虚线框 + 图标 + 主副文案引导（「点击节点查看完整内容 / 在画布中选择角色·设定·伏笔·章节节点」）。
- **轴视图工具条打磨**：增高至 42px、间距加大、按钮/输入框圆角统一、聚焦光圈反馈。
- **状态栏与 AI 对话区**：状态栏增高加呼吸间距、毛玻璃；深色下聊天标题栏/输入框分层更清晰。
- **画布节点层次增强（深色）**：边框提亮、阴影加深，多节点聚集时不再糊成一团。
- 冒烟测试 88 项全部通过（无功能回归）。

## 1.14.0

### 新增
- **多智能体角色预设（参照 DeepWrite 的角色化分工）**：AI 对话顶部新增「角色」切换栏，内置 6 个角色——通用助手 / 人物设计师 / 大纲规划师 / 正文写手 / 润色编辑 / 审查员。每个角色有独立的系统提示词、工具范围和欢迎语：
  - 人物设计师：侧重动机/矛盾/关系网/成长弧光，工具限读 + 节点增改删（提案）
  - 大纲规划师：规划分章结构/冲突节奏/伏笔回收，可改大纲文件
  - 正文写手：直接产出流畅正文，可改章节正文
  - 润色编辑：去AI味、压缩节奏、增强画面感
  - 审查员：只读分析，列设定冲突/时间线矛盾/伏笔失控问题清单，不改内容
  - 角色按项目记忆（localStorage），切换后欢迎语即时入对话，后续消息自动带角色上下文；与原有任务模式（剧情军师/去AI味/防漂移等）兼容并存。

### 优化
- **file_edit 提案冲突保护**：应用 `file_edit` 提案时，若文件在提案生成后被修改（当前内容 ≠ 提案时的旧内容），拒绝应用并提示「文件已被修改，为避免静默覆盖请基于最新内容重新生成提案」，提案保留供重新审阅（不再静默覆盖，对齐 DeepWrite「保留较新版本」）。新增 `POST /api/propose_file_edit` 可直接构造文件修改提案（与 `propose_node_edit` 对称，供脚本/测试使用）。
- **冒烟测试新增 4 项**：角色栏存在+切换持久化+欢迎语、AGENT_ROLES 服务端预设完整、file_edit 冲突保护（改后拒绝应用+提案保留）、file_edit 正常应用（无冲突仍可写）；`cleanupSmokeBak` 泛化为清理全部 `_smoke_*.md.bak`。

## 1.13.2

### 优化
- **消除服务日志 `parse error ... ENOENT` 刷屏**：默认扫描规则引用的 8 个文件（`追踪/状态追踪.md`、`设定/设定.md`、`角色设定汇总.md`、`写作规范.md`、三个卷大纲、第二卷角色状态汇总）在该项目真实结构中不存在，每次加载都会重复报错。已为 `从0开始的天灾生活` 项目新建 `novel-canvas.config.json`，把 `scan.files` 对齐到真实文件（`设定.md`、`大纲.md`、`追踪/角色状态.md`、`追踪/伏笔.md`、`追踪/上下文.md`），节点集与节点 id 不变，刷屏消失。
- **`parse error` 缺文件提示去重**：`server.js` 对同一项目同一缺失文件只在进程内提示一次（`warnedMissingScanFiles`），任何项目都不会再每次加载刷屏；文件补齐后提示自然消失。
- **冒烟测试清理加固**：`_edge_smoke_test` 临时 profile 删除增加 `maxRetries: 10, retryDelay: 500`，解决 Edge 退出后 profile 锁释放延迟导致的残留目录。

## 1.13.1

### 修复
- **文件面板「加载失败：Failed to fetch」**：根因是本地服务已退出但窗口还开着（`npm run dev` 复用了外部 server，外部 server 退出后无人拉起）。修复：① 文件树加载 8 秒超时 + 错误分类，断连/超时给出可操作中文提示（「无法连接本地服务」「加载超时」），不再直出英文 `Failed to fetch`；② 文件树标题栏新增 ↻ 重试按钮，服务恢复后一键重新加载；③ Electron 主进程每 3 秒检查一次服务存活，端口无监听时自动重新拉起 server.js，杜绝「窗口活着、服务死了」的假死；④ `listMdFiles` 增加深度上限（16 层）并跳过符号链接/目录联接（junction），防止目录环把扫描变成无限递归。
- 冒烟测试新增 4 项：文件树重载按钮、错误文案分类、/api/files 返回列表、listMdFiles 防循环（共 84 项）。

## 1.13.0

### 新增
- **AI 对话可直接修改/新建 Markdown 文件**：新增 `edit_file` 工具，AI 可修改任意项目内 Markdown 文件（大纲/设定/正文），path 不存在时视为新建文件（新建章节/新建设定）。与节点工具一致生成 `file_edit` 提案，用户批准后才写盘，不绕过审阅直接覆盖。
- **提案可单独拒绝**：新增 `POST /api/proposals/reject`，AI 面板与文件编辑器的提案卡片「拒绝」按钮现在会同步删除服务端持久化的提案，而不是只关掉界面（重启后不再残留）。
- 提案卡片区分类型：`file_edit` 提案显示为「文件修改」（此前误显示为「删除」）。
- 冒烟测试新增 1 项：提案拒绝生命周期（造提案→拒绝→消失→二次拒绝报错，共 80 项）。

## 1.12.1

### 新增
- **左侧栏点击跳转到画布节点**：点击左侧分类列表（含卷分组章节）中的任意节点，进度轴自动平移到该节点居中并短暂闪烁高亮，右侧同时打开节点详情；若搜索框有活动关键字会自动清空，避免跳转目标被搜索过滤隐藏。

## 1.12.0

### 新增
- **关系矩阵可交互**：✓ 格悬停显示命中明细（别名×次数），点击直接跳到对应章节并打开节点详情；行/列表头可点击查看节点。新增命中提示行（✓=出现，数字=命中别名数）。
- **空项目引导**：项目没有任何可显示内容时，进度轴中央显示引导卡（提示检查正文目录 / 扫描规则，一键打开文件面板）。
- 搜索框键盘导航（此前绑定的 `searchNav` 未定义，按任意键会抛错）：`↓/Enter` 下一个命中、`↑/Shift+Enter` 上一个、`Esc` 清空。
- 冒烟测试新增 2 项：关系矩阵可交互、搜索键盘导航+轴视图平移定位（共 78 项）。

### 修复
- **搜索定位在进度轴失效**：轴视图是 `overflow:hidden` + transform 平移缩放的容器，`scrollIntoView` 移不动视野，命中节点在屏外时用户看不到结果。现在高亮命中会直接把视野平移到节点居中。
- **时间线 ⚑ pin 同位置完全重叠**：同一章节的多个重要节点会叠在同一坐标，后面的盖住前面的。现在同位置 pin 自动向下堆叠错位。
- 项目切换时移除对隐藏自由视图的冗余 `fitView()` 调用（loadData 内部已 fitAxisView）。

## 1.11.1

### 新增
- **时间线重要节点直接标注在进度轴上（⚑ pin）**：添加时间线节点后，自动在对应章节列、按剧情推进位置显示一枚 ⚑ 标记；可直接在轴上拖动（左右改章节、上下改推进），释放后写入 `timelineNodes` 并持久化。弹窗新增「推进%」输入（留空自动按章号默认），列表行显示推进百分比徽标，编辑时也可修改。
- 冒烟测试新增 2 项：时间线 pin 创建/拖动/删除、分类筛选对进度轴节点生效（共 76 项）。

### 修复
- **识别：元信息小节不再误识别为实体**。`角色设定汇总.md` 等按标题切分的文件里，`## 作品简介 / 内容简介 / 更新记录 / 剧情线梳理` 等元信息标题默认不生成节点（`scan.headingExclude` 可配置，项目 config 可覆盖）。列车求生项目不再把「作品简介」识别成角色，关系矩阵随之纯净。
- **左侧分类筛选/搜索对进度轴无效**：`applyFilters()` 只过滤了自由视图的 `#world` 节点，轴视图 `#axisNodes` 不受控。现在筛选、搜索、命中高亮（🔍 定位）同步作用于轴视图节点；轴节点拖动后也会重新套用筛选。
- 切换项目时 `#world` 残留旧项目节点导致 `applyFilters` 抛错（新项目 nodeMap 不含旧 id）——世界节点循环加空值保护，切换项目不再中断。

## 1.11.0（当前）

进度轴成为唯一视图，自由布局从界面移除；时间线改为作者手动维护的重要节点。

### 新增
- **时间线改为重要节点编辑器**：不再自动抽取「第N天 / 年月日」时间标记（长篇剧情动辄跨越百年，自动判断不可靠）。作者在弹窗中手动填写节点名、选择所属章节、可加备注；点击节点自动跳转到对应章节。数据存入布局文件 `小说画布.json` 的 `timelineNodes` 字段，随自动快照一起备份。
- **进度轴内自动连线**：实体关联 / 章节聚焦 / 标题匹配三种算法生成的连线直接在进度轴中渲染（虚线=自动关联，实线=手动连线，点实线可删）。拖动节点时连线实时跟随。
- 连线管理弹窗新增创建表单（选择起止节点即可添加手动连线）。

### 变更
- **移除自由布局入口**：启动即进入进度轴视图，工具栏不再显示「自由布局」切换、自动排列、适应视图、小地图等按钮（按钮保留在 DOM 中以兼容冒烟测试，视觉隐藏）。
- 连线高亮（egoSelf / egoNeighbor）同步作用于进度轴节点卡片。

### 修复
- `build-portable.js` 与 `electron-builder.yml` 的文件列表缺失 `app.js`，导致打包产物无法加载主逻辑（白屏）。已补齐，并新增完整打包脚本 `npm run build`。
- 版本号统一为 1.11.0（此前 package.json 停在 1.0.0，与代码注释 v1.11 脱节）。

## 1.10.0

- Y 轴分段支持：按卷（自动识别）/ 按境界 / 按剧情关键节点，无卷项目询问作者偏好。
- X 轴章节过密时自动按段聚合，避免横向爆炸。
- 轴视图坐标轴改为黑色实线，深浅主题自适应。

## 1.9.0

- 进度轴 Y 轴从「4 条离散泳道」升级为「连续剧情推进轴 0~100%」，章号越大 y 越高。
- 节点可上下拖动调整剧情推进位置。

## 1.8.0

- 进度轴视图上线：按章节横向展开、剧情推进纵向分布的连续进度轴。
- 章节卡片按卷分组折叠。
