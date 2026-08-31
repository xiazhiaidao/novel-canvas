# Novel Canvas 交接文件 —— 四项功能构建任务

> 本文件供新对话快速接手。目标：在 novel-canvas 应用内完成 **4 项功能**，全部通过冒烟测试（当前基线 **52 项全绿**，完成后应 60 项左右）。
> 生成时间：当前会话（布局 v3 确定性精确尺寸流式布局已完成、AI 设置已并入左下角设置弹窗、AI 对话框可停靠/拉伸已完成、52 项冒烟全绿）。

> **✅ 已完成（2026-08-29 会话）**：四项功能全部落地，冒烟 **60/60 全绿**（52 基线 + 8 新增）。新增代码位置见下，后续新会话无需重做，可直接在其上继续开发：
> - 功能① 回滚+备份：server.js `backupDir/snapshotFiles/snapshotLayoutThrottled/listBackups/pruneBackups/restoreBackup`（L1105 起，`getApiConfig` 之后）；挂载点 `/api/apply_proposal` 4 分支 + `/api/file/save|delete` + `/api/layout`（节流 60s）；路由 `GET /api/backups`（L1708）、`POST /api/backups/restore`（L1716）；前端设置弹窗第三 tab「历史」`settingsTabHistory/settingsPaneHistory/backupList` + `loadBackupList()`（index.html L4587 起）。
> - 功能③ 用量统计：`usageFile/loadUsage/saveUsage/recordUsage/summarizeUsage`（L1223 起）；**7 个 LLM 调用点全部挂载**（L788/824/858/959/2176/2241/2285）；`/api/chat` 响应附带 `usage`；路由 `GET /api/usage`（L1727）；前端聊天消息末尾 `addUsageNote()`（L4726）+ AI tab 内 `#aiUsageInfo` 今日/累计行。
> - 功能⑤ 全书看板：`buildBookStats()`（L1293）；路由 `GET /api/bookstats`（L1732）；前端 topBar「统计」`#bookStatsBtn` + `#bookStatsModal` + `openBookStats/renderBookStats`（L4634）。
> - 功能④ 时间线：`buildTimelineEvents()`（L1336）；路由 `GET /api/timeline`（L1743）；前端 topBar「时间线」`#timelineBtn` + `#timelineModal` + `openTimeline`（L4683，卡片点击 `showDetail(nodeMap[chapterId])` 打开章节）。
> - smoke-test.js 新增 8 项（备份读/往返、用量可访问/已累计、统计 API/弹窗、时间线 API/弹窗），插入在「人物推进 API 可访问」之后。
> - 数据落盘：`.data/backups/{ts}-{seq}/{project}/…` + manifest（保留 100 份）、`.data/usage.json`（byDay/byModel/byChat50/cost 可选）。

> **🎨 布局美化（同日二次会话）**：设置从居中弹窗改为**左侧滑出抽屉**（`#themeModal` 加 `settingsDrawer` 类，仍保留 `.modal-mask` + `.show`，冒烟不受影响）——header（齿轮+「设置/SETTINGS」+ 关闭按钮 `#settingsCloseBtn`）、纵向图标导航 `.settingsNav`（呼应活动栏）、内容区 `.settingsBody`、底部 `.settingsDrawerFoot`（取消/应用）。设计语言对齐活动栏与全局「强调文字统一黑色」偏好：激活 tab 用琥珀渐变背景+边框、文字 `var(--text)`（深浅主题各自可读）；齿轮图标 muted。配套：活动栏 hover/active 增强（琥珀描边+内发光+按下缩放）、topBar 标题加渐变菱形品牌标记 `.appLogo`、抽屉新增 Esc/遮罩点击关闭（在 themeCancel 监听附近）。深色覆盖在 canvas_theme.css `html[data-theme="dark"]` 段。冒烟仍 **60/60 全绿**。

> **🎨 弹窗统一 + Toast 系统（同日三会话）**：① 全部 10 个弹窗（新建节点/矩阵/看板/统计/时间线/确认覆盖/手动连线/一致性/卷管理/章节核心）header 从 `<h3>标题 <button style="float:right">关闭</button></h3>` 统一为 `.modalHead`（`.modalTitleMain` 中文标题 + `.modalTitleSub` 英文眉题 + `.modalClose` ✕ 关闭按钮，id 全部保留）；② tab 统一（`.matrixTab`/`.auditTab` 共用新样式：琥珀渐变激活 + `var(--text)` 文字，深色 hover 覆盖）；③ 底部操作条统一（`.diffActions`/`.auditActions`/`.statsActions` 共用上边框分隔样式）；④ **toast 系统**：`#toastWrap` + `showToast(text, type)`（info/success/error，右下角滑入、2.6s 自动消失、点击即关）；⑤ **应用内确认框**：`#confirmModal` + `confirmDialog(msg, {okText, cancelText})` → Promise<boolean>（Esc/遮罩/✕/取消 → false）；⑥ index.html 26 处 `alert/confirm` 与 file_editor.js 10 处全部替换（`newChat`/`closeFile`/`deleteFile`/选中删除 keydown 监听器等 4 处函数补 `async`）。深色覆盖同步更新（`.modalTitleMain`/`.modalClose:hover`/`.matrixTab`/`.auditTab`）。冒烟仍 **60/60 全绿**，`无 JS 异常` 双轮通过。

> **📊 状态栏字数 + 详情编辑增强（同日四会话）**：① 状态栏新增 `#statusWords`：`正文：X 字 · Y 章`（客户端从 `nodes` 里 `label==='章节'` 的 content 长度求和，与 server `buildBookStats` 同口径；`updateStatusBar()` 内计算）；② 详情编辑 `showDetail` 内新增**撤销/重做历史栈**（自维护 `undoStack/redoStack`，textarea 原生撤销在重渲染后会失效）：Ctrl+Z 撤销、Ctrl+Shift+Z / Ctrl+Y 重做，栈上限 100，光标回末尾；③ **Ctrl+S 快捷保存**（防浏览器默认）；④ 保存成功/失败加 toast（复用 showToast）；⑤ **保存后保持详情面板打开**（原行为 loadData 会清空面板——`detailBody.innerHTML='<div class="empty">…'`，现在保存后 `if (nodeMap[n.id]) showDetail(nodeMap[n.id])` 重新打开同一节点，写作流程不中断）；⑥ 字数/快捷键提示并入原计数行（`Ctrl+Z 撤销 · Ctrl+Shift+Z 重做 · Ctrl+S 保存`）。⚠️ **测试教训**：验证脚本曾触发真实 Ctrl+S 写盘污染 `第01章_白球.md`（追加 2 行 `【测试行】`），已从 `.bak` 精确还原（2418 字符，全书回到 7512 字/3 章）；**此后任何涉及真实写盘的验证必须改为内存内模拟或临时项目**。新增冒烟 2 项：状态栏字数格式、详情撤销/重做（纯内存不写盘）。

> **🧹 去重：文件编辑器「加入AI对话」按钮（同日修复）**：文件编辑器工具栏原有两个相邻按钮 `#fileSelChatBtn`「选中加入对话」（有选中→加选中，无选中→`addWholeFileToChat(f)` 加整个文件）与 `#fileToChatBtn`「加入AI对话」（永远加整个文件）——无选中时二者功能完全重叠。已删除 `#fileToChatBtn` 及其点击监听（file_editor.js），`addWholeFileToChat` 保留供 `fileSelChatBtn` 兜底。冒烟检查同步更新（不再要求 `fileToChatBtn` 存在，并断言其已消失）。

> **🧹 去重（续）：详情面板「选中加到对话」按钮已移除（同日，用户确认"精简"）**：详情面板原静态按钮 `#selToChatBtn`「选中加到对话」与选中文字时弹出的浮动工具条「＋ 添加到对话」重复。已删除按钮及其全部关联代码（`cachedDetailSel`/`captureDetailSel`/`selectedDetailText` 死代码一并清理），选中加对话统一走浮动工具条（`hookSelToolbar` 在 editArea/previewEl 上），整节点加入走节点右键菜单「添加到对话」（既有入口，canvas 与左侧栏共用）。冒烟：原 2 项 selToChatBtn 检查合并为 1 项「详情面板 选中加对话(浮动工具条)」（选中→工具条→引用，断言不粘贴输入框），「详情面板已简化」改为断言 selToChatBtn 已消失；总检查数 62 → 61。

> **⛶ 专注模式 + 💾 自动保存（同日五会话）**：
> **专注模式**：顶栏新增 `#focusBtn`「⛶ 专注」（`.toolBtn.on` 琥珀态）+ 快捷键 **Ctrl+Shift+F** 切换。`body.focus-mode` 隐藏顶栏/侧栏/详情/状态栏/聊天面板/边缘展开钮（`display:none !important`），保留活动栏 + 画布/编辑器全宽；右上角浮动「✕ 退出专注」胶囊 `#focusExitBtn`（琥珀渐变底 + `var(--text)`，深浅色均可用，非 `.edgeToggle` 类避免被隐藏）。不持久化。
> **自动保存**：文件编辑器防抖自动保存——停止输入 3 秒后自动写盘（`FILE_AUTOSAVE_DELAY = 3000`）。`saveActiveFile` 重构为 `saveFile(f)`（显式文件 + `openFiles.includes(f)` 守卫，已关闭/丢弃的文件不写盘；状态栏只在 `f.path === activeFilePath` 时更新，避免误标非活动文件）。状态栏提示「未保存 · 将自动保存」；手动保存/自动保存成功后清定时器；切文件后旧文件的待保存定时器仍会正确落盘。冒烟 +2：专注模式切换（隐藏/退出/恢复）、自动保存布防→还原解除（断言不写盘，纯内存操作）。总检查数 61 → 63。

> **🧹 技术债 7+8（同日六会话）**：
> **7. 内联脚本拆分**：index.html 内联 `<script>`（3475 行 / 138K 字符）整体抽出为独立 **`app.js`**（保留 BOM 处理、逐字提取），index.html 缩至 1658 行。加载顺序不变：`canvas_upgrade.js → app.js → file_editor.js`；server.js 静态服务自动覆盖（通用扩展名 MIME）。改动前备份 `_bk_index.html`。
> **8. force-black token 化**：用户硬约束「强调文字一律黑色」的颜色值从硬编码 `#000` 改为 **`var(--text-strong)`**（`:root` 新增 `--text-strong: #000` 单一控制点），选择器列表原样保留（避免漏元素导致橙色回潮）。冒烟 +1：「强调文字保持黑色(两主题)」——浅/深两主题下 `.toolBtn` 计算色均断言 `rgb(0,0,0)`。总检查数 63 → 64。

> **🔗 连线颜色主题化（同日修复）**：用户反馈「连线改成黑色的灰色看不清」。原因：`.autoEdge`（自动连线虚线）硬编码 `rgba(148,163,184,.8)` 石板灰——浅色下太淡、深色下中灰；`.customEdge`（手动连线实线）硬编码 `rgba(180,83,9,.85)` 深琥珀——深色背景下近乎黑色。修复：连线颜色改为主题感知 CSS 变量 `--edge-auto` / `--edge-manual`（`:root` 浅色：深石板灰 `rgba(100,116,139,.95)` + 琥珀 `rgba(180,83,9,.95)`；`canvas_theme.css` 深色块：亮灰蓝 `rgba(163,178,200,.95)` + 亮琥珀 `#ffb454`），线宽加粗（auto 1.6→2，manual 1.8→2.2，hover 2.6 + brightness）。**坑**：canvas_theme.css 里还有两组更高优先级的深色覆盖（L83 遗留 + L230-234：`html[data-theme="dark"] #edges .autoEdge{ stroke: rgba(148,163,184,.75) }` 等）会遮蔽变量——已同步改为 `var(--edge-auto)` / `var(--edge-manual)`。CDP 实测：深色 auto `rgba(163,178,200,.95)`/manual `rgb(255,180,84)`，浅色 auto `rgba(100,116,139,.95)`/manual `rgba(180,83,9,.95)` ✓。冒烟 +1：「连线颜色主题自适应」（深浅主题下两变量非空且不同）。总检查数 64 → 65。注：小地图（`drawMinimap`）背景仍硬编码浅色 `#f4f6fb`、视口框 `#b45309`，深色主题下未适配——用户未反馈，留作可选后续。

> **💬 添加到对话 四处统一为 Trae 引用标签（同日修复）**：用户反馈——画布/左侧栏右键菜单有「添加到对话」，但①文件树右键菜单没有；②详情面板没有；③画布节点右键的「添加到对话」不是 Trae 那种引用标签格式，而是像已发送的聊天内容一样直接显示在对话记录里。修复：
> - **格式统一**：`canvas_upgrade.js` `addRefToChat()` 从「push 进 chatHistory + `addMsg('ref')` 双条渲染 + localStorage」重写为委托 `addSelectionToChat()`（整节点 → `whole=true`），即只生成 `#refBar` 里的引用标签（chip），不写聊天记录、不粘贴输入框；发送时才随消息进入 chatHistory。批量添加到 AI 对话（`app.js` 框选菜单）也随之变为多 chip。
> - **chip 标签改进**：`addSelectionToChat()` 新增 `whole` 参数（整节点/整文件措辞为「引用」，选中文字仍为「选中片段」），chip 标签更信息（文件 → `📄 文件名`、节点 → `角色 · 标题`，选中带 `· 行N`）。
> - **文件树右键**：`file_editor.js` 文件项菜单新增「添加到对话」→ `addFileToChatByPath()`（已打开用内存 content，未打开经 `GET /api/file` 只读读盘，不落盘）。
> - **详情面板**：`showDetail()` 动作行新增 `#detailAddChatBtn`「添加到对话」（整节点引用）；选中文字仍走浮动工具条（不重复）。
> - **冒烟**：更新「详情面板已简化」断言新增按钮存在；新增 3 项：详情面板整节点添加到对话（chip、输入框空）、画布节点右键添加到对话 → 引用标签（chip 出现且聊天记录 `.msg.ref` 无新增）、文件树右键菜单添加到对话（chip、输入框空）。总检查数 65 → 68。
> - ⚠️ 过程事故：插入详情按钮监听时误删了 saveBtn 监听前 3 行（`const content`/`const status`/`status.textContent`）——已当场修复并验证（会 ReferenceError 的隐患已消除）。

> **🔄 热重载盲区修复（同日，根因排查）**：用户再次反馈「文件树右键还是没有添加到对话、详情面板还是没有按钮」——但冒烟 68/68 证明功能确实在 8787 服务上。排查：用户 Electron 窗口（`node_modules\electron\dist\electron.exe`，标题「小说画布」）加载的正是 `http://127.0.0.1:8787/`（main.js `URL`），**根因是 `main.js setupDevReload()` 只 watch `index.html/canvas_upgrade.js/canvas_theme.css`，漏了 `app.js` 与 `file_editor.js`**。上一轮编辑顺序：先改 canvas_upgrade.js（触发窗口 reload）→ 后改 app.js/file_editor.js（无 watch，不再 reload）→ 窗口停留在「新 canvas_upgrade + 旧 app/file_editor」混合态——恰好解释用户只复述缺文件树菜单和详情按钮、不再抱怨 chip 格式（canvas_upgrade.js 的新行为已生效）。修复：watchFiles 补 `app.js`、`file_editor.js`（含注释警示勿再漏）；对正在运行的窗口用「touch canvas_theme.css（watched 文件追加空行触发 fs.watch → `webContents.reload()`）」立即刷新，无需重启。server.js 静态服务本就不发 Cache-Control/ETag（L2495-2509），无陈旧缓存问题。教训：**以后改任何前端文件后，若窗口未自动刷新，先确认该文件在 setupDevReload 的 watch 列表里**。

> **🎨 「墨金」高级感设计层（同日，UI 重塑）**：用户反馈「还是觉得好拉跨界面，没有 zcode/qorder/traework 那种高级感」。方案：**纯 CSS 追加覆盖层，不动 DOM/JS/几何**（68 项冒烟依赖布局，只做视觉）。分两部分：
> - **index.html 微调 1 处**：图例 `#legend .l-auto/.l-manual` 硬编码颜色 → `var(--edge-auto)/var(--edge-manual)`（主题自适应）。
> - **canvas_theme.css 插入「墨金」polish 块**（在 force-black 块之前，约 L300 起 ~290 行）：
>   - **共享**：`body` 字号 13.5px + 抗锯齿；`::selection` 琥珀；全量 8px 细滚动条（`::-webkit-scrollbar` 2px 透明内边距 + 圆角 thumb）；按钮/输入统一切换动效（.15s）；`.item` 行高 1.5 + padding 10px 12px（侧栏呼吸感）；`.catTitle` 字距。
>   - **浅色**：topBar/activityBar 白渐变；`.node` 加发丝边框 + 柔和阴影 + hover 上浮 2px；画布点阵降噪（26px/130px 双尺度）；`.msg.user` 蓝气泡/`.msg.assistant` 灰气泡（底角 3px 收口）；`.msg.ref` 奶油金底。
>   - **深色**：body 双 radial 渐变（蓝紫+琥珀氛围光）；topBar 墨蓝渐变；**金箔按钮**——`#topBar button/.toolBtn/#topBar select/#chatSend/.agentCmd/#fileEditorBody button` 实心浅金 `linear-gradient(135deg,#f0d3a0,#e2b078)` + 深金边 + 顶部高光内阴影（黑字对比 ~10:1，可读）；`.toolBtn.on` 深一档金 `#e9c180→#daa45e`；hover 提亮 + 上浮；节点卡片玻璃渐变 + 悬浮金辉（`0 0 0 1px rgba(255,180,84,.10)` + 大阴影）；`.node.selected/.egoSelf/.egoNeighbor/.hit` 金环；侧栏 `.item.active` 浅金渐变 + 2px 金左边线；`.filterChip.on` 浅金；聊天气泡 user=深蓝紫/assistant=玻璃灰/ref=实心浅金/tool=淡蓝；VSCode 式标签激活顶部 2px 金条；右键菜单/弹窗毛玻璃深色；输入框聚焦金辉 + 金焦点环；`#chatHeader/#detailHead/.modal h3/#detail h2` 浅金渐变条（black 文字可读，均 ≥4.5:1）；`.refChip` 金箔胶囊；状态栏/边缘开关/小地图/图例/`#egoHint`/`#focusExitBtn` 深色玻璃 + 金边；prefers-reduced-motion 全量禁用过渡。
> - **force-black 块扩展 2 个选择器**：`#topBar select`、`.refChip`（二者原为琥珀文字，忠实于「强调文字一律黑色」规则；配套金箔底保证可读）。
> - **验证**：CDP 计算样式探针（`.toolBtn`/`#topBar button`/`#topBar select`/`.filterChip.on`/`#chatSend`/`.agentCmd`/`#chatHeader` 黑字 ✓，金底非透明 ✓）；前后截图对比 + 视觉模型评审（深色 7.5→高对比可读金箔；浅色无问题）；**冒烟仍 68/68 全绿**。
> - ⚠️ 注意：force-black 列表元素（黑字）必须坐落在够亮的底上（金箔/浅金渐变），新增「黑字强调元素」时同理；`_ui_shot.js`/`_style_probe.js`/`_shots/`/`_edge_shot` 为临时产物，测试完删除。

> **🔧 浅色主题金箔补齐 + 窗口未刷新根因（同日修复）**：用户反馈「刷新应用没变化」。排查发现**用户一直在浅色主题下工作**（抓窗口主色 `#f0f0f8`），而上一轮「墨金」金箔按钮**只做了深色版**（`html[data-theme="dark"]` 前缀），浅色下顶栏按钮仍是旧灰底 → 用户看着毫无变化。同时旧 Electron 窗口（13:19 启动、7 小时未重启）渲染进程停留在旧页面，热重载也未生效。修复：
> - **浅色金箔**：canvas_theme.css 浅色段（深色段之前）新增与深色对称的金箔规则——`#topBar button/.toolBtn/#topBar select/#chatSend/.agentCmd/#fileEditorBody button` 奶油金渐变 `linear-gradient(135deg,#fdf3dd,#f9e2b8)` + 深金边框 + 顶部高光 + hover 上浮；`.toolBtn.on` 深一档金 `#f5d9a0→#eec27e`；`.filterChip.on`/`.item.active`/`#chatHeader`/`#detailHead`/`.modal h3`/`#detail h2` 浅金渐变条；`#chatMessages .msg.ref`/`.refChip` 奶油金；`#canvasTab.on`/`.fileTab.active` 顶部 2px 金条；`#egoHint`/`#focusExitBtn` 金底黑字；金焦点环/选中金环（`.node.selected/.egoSelf/.egoNeighbor/.hit` 浅色版）。均黑字（force-black 保证），浅底保证对比度。
> - **窗口重启**：旧 Electron 窗口最小化 + 渲染进程陈旧，dev.js 链已整个退出（8787 服务一度停掉）→ 用后台任务重新 `npm run dev` 拉起全新 Electron（PID 25048），确认加载新 CSS（CDP 探针：浅色 topBar button bgImg = 奶油金渐变 ✓）。
> - **教训**：① 截图验证必须**同时覆盖浅色+深色**（用户实际主题可能不是我以为的）；② 用户窗口若长时间不刷新，直接检查进程启动时间 + 抓真实窗口（PrintWindow）确认渲染内容，别只信 headless 测试；③ Electron 窗口最小化时 PrintWindow 抓不到内容，先 `ShowWindow(hwnd, 9)` 还原再抓。
> - 冒烟仍 68/68 全绿（浅色金箔不影响布局/检查项）。

---

## 0. 必读约束（违反会破坏项目）

- **开发边界**：只开发 `novel-canvas` 应用本身；**不得修改 `D:\小说` 下各小说项目内容**。一切小说文件读写必须走 server.js 受控 API。
- **AI 写回必须走提案**：`/api/apply_proposal`，禁止直接写盘绕过。
- **API 风格**：统一返回 `{ ok: true, ... }` 或 `{ error: "..." }`。
- **写文件**：一律用 `writeText()`（内部先写 `.bak` 再覆盖）；路径必须过 `isSafePath()` / `isMdPath()`。
- **前端**：无框架原生 JS/CSS；新增 UI 必须兼容浅色+深色（深色覆盖在 `canvas_theme.css` 的 `html[data-theme="dark"]`）；动态插值用户内容必须 `escapeHtml()` 或 `textContent`。
- **测试**：新增 API 至少手动 curl 验证；新增 UI 建议在 `scripts/smoke-test.js` 加 `check(...)`；冒烟测试必须**非破坏性**（不得污染用户项目、不得覆盖 `.data/ai-config.json`）。
- **服务**：当前开发服务由后台任务 `pwsh-9` 跑 `npm run dev`（8787 端口，带 tokenrhythm 环境变量），**不要 kill**。改 server.js 后 `node --watch` 自动重启。
- **release/ 目录是陈旧拷贝**，不要改它（`npm run build:portable` 会同步）。

---

## 1. 代码地图（已核实的精确位置）

### server.js（`D:\小说\novel-canvas\server.js`，约 2148 行）
| 位置 | 内容 |
|---|---|
| L10-14 | `ROOT`（应用目录）、`PROJECTS_ROOT`（= `D:\小说`）、`PORT` |
| L16-48 | proposals 持久化：`proposalsFile()` = `.data/proposals.json`，`loadProposals/persistProposals/proposalSet/proposalDelete`（**已落盘**，AGENTS.md 里"内存中会丢"的说明已过时，不要重复加） |
| L108-122 | `FILE_DEFS`：设定.md / 大纲.md / 追踪·角色状态.md / **追踪·伏笔.md（table:true）** / 追踪·上下文.md / 设定/设定.md / 角色设定汇总.md / 写作规范.md 等 |
| L124-133 | `readText(file, root)` / `writeText(file, text, root)`（先 `.bak` 再覆盖）——**回滚功能的核心写入口** |
| L139-155 | `appendSection(type, title, desc, root)`（create 提案用；伏笔表插行格式：`\| NEW-xxx \| 标题 \| 待定 \| 待定 \| 已埋 \| 说明 \|`） |
| L157-163 | `deleteSegment(node, root)`（delete 提案用，内部走 writeText） |
| L682 | `buildConsistencyPackage(root, targetId, fullEntities)`（一致性封包） |
| L760-950 | AI 助手函数：`auditConsistency`(L763)/`polish`(≈L813)/`advance`(≈L846)/`generateNext`(≈L946)，各有 `fetch(api.base + '/chat/completions')` |
| L993-1046 | `recordAudit` / `summarizeAuditStats`（已含 totalWords、chapterCount、byVolume —— **全书统计可复用此模式**） |
| L1048-1075 | `aiConfigFile()` = `.data/ai-config.json`；`loadAiConfig/saveAiConfig/maskApiKey/aiConfigSource`；`getApiConfig()` 优先级：**保存的配置 → env → inkpilot** |
| L1331 | `/api/agent/tools` GET |
| L1335-1400 | `/api/settings` GET/POST + `/api/settings/test`（测试连接拉模型列表） |
| L1574-1613 | `/api/apply_proposal`：4 种写入分支 —— `edit`→writeText(node.file)；`create`→appendSection；`delete`→deleteSegment；`file_edit`→writeText(prop.file)（**回滚快照的 4 个挂载点**） |
| L1765-1844 | `/api/chat`：10 轮 agent 循环，LLM 调用在 L1810，响应 `data.usage` 含 prompt/completion/total_tokens（**用量统计挂载点**） |
| L1846-1883 | `/api/continue`（续写，LLM 调用 L1865） |
| L1884- | `/api/ai/edit`（LLM 调用 L1908） |
| L2055-2100 | `/api/file/save`（L2063 writeText）、`/api/file/create`、`/api/file/delete`（L2095 先 .bak 再 unlink） |

**全部 7 个 LLM 调用点（用量统计要全覆盖）**：L778、L813、L846、L946、L1810、L1865、L1908。

### index.html（`D:\小说\novel-canvas\index.html`，约 4536 行）
| 位置 | 内容 |
|---|---|
| L29 | `* { box-sizing: border-box }` |
| L243-345 | `.node`（宽 200 固定）、`.node.nodeBoard`、`.nodeBoard > .ndesc`（8 行截断，仅限板自身）、`.nodeBoard .boardChildren .node`（**固定高 128px、2 行截断**——布局 v3 的关键修复） |
| L799-827 | `.modal-mask` / `.modal` 样式（设置弹窗复用） |
| L1059-1080 | `#topBar`（`.topBarRight` 有 自动排列/适应视图/小地图/图例/连线方式/矩阵/看板/连线 按钮 —— **新按钮「统计」「时间线」加在这里**） |
| L1189-1230 | `#themeModal`（左下角设置弹窗，含 `.settingsTabs`：外观 `#settingsTabTheme` / AI 模型 `#settingsTabAi` + `#settingsPaneTheme`/`#settingsPaneAi`）—— **「历史」tab 加在这里** |
| L1385-1448 | `defaultCollapseFor` / `markSeenGroups` / `volumeKeyOf` / `chapterGroupKey` / `boardGroups()` |
| L1455-1496 | `ensureBoardContained(g, forceReflow)`（子节点网格：colGap 220、rowGap 145、列数 `boardCols(n)` 3~4） |
| L2474-2506 | `LAYOUT_VERSION = 3`、`saveLayout()`（POST /api/layout）、`boardCols/boardGridSize` |
| L2573-2690 | `layoutHealth()`（精确尺寸体检）/ `repairLayout()` |
| L2690-2720 | `computeAutoLayout()`（v3 确定性流式布局）/ `autoLayout()` |
| L2760-2800 | `loadData()`（加载即体检；`layoutVersion < 3` 自动重排） |
| L3231 | `renderAgentSteps(steps)`（聊天工具步骤渲染） |
| L3272-3360 | `sendChat()` / `runAgent`（fetch `/api/chat`，渲染消息；**用量显示加在消息末尾**） |
| L3913-4000 | 聊天面板：`chatDockNow/chatSizes/syncChatPanel/toggleChat/initChatResize/initChatFloatDrag/initChatPanelDock` |
| L4317-4460 | 主题设置 JS + AI 设置 JS：`loadAiSettings/switchSettingsTab(tab)/renderAiModels/testAiConnection/saveAiSettings/syncChatModelOption`（L4432 `switchSettingsTab` 目前处理 theme/ai 两个 tab，**扩展第三个 tab 在这里**） |

### 其它文件
- `canvas_upgrade.js`：画布增强（addRef/expandChatPanel 等，内含 `syncChatPanel` 调用）
- `file_editor.js`：文件树/多标签编辑器；L17 `activityTheme` 点击 → 打开 themeModal
- `canvas_theme.css`：深色主题覆盖（.settingsTab/.modal 等已适配，新 UI 需补深色规则）
- `scripts/smoke-test.js`：**52 项全绿**；结构：`check(name, async fn)`，`evalExpr(js)` 在页面执行返回 byValue，AI 检查有重试循环；CDP 9224、headless Edge `_edge_smoke_test` profile、复用 8787

---

## 2. 功能 ①：回滚 + 自动备份（最高优先级，先做）

**目标**：AI 写盘前自动快照，用户可一键回滚任意一次 AI/手动修改。

### Server 设计
1. **快照目录**：`ROOT/.data/backups/{ts}-{seq}/{project}/…`，每个快照一个目录，内含被改文件的拷贝（保留相对项目根的路径）+ `manifest.json`（`{ ts, seq, reason, project, files: [{rel, size}] }`）。`ts` = `Date.now()`，`seq` 避免同毫秒冲突。
2. **助手函数**：
   ```js
   function backupDir() { return path.join(ROOT, '.data', 'backups'); }
   function snapshotFiles(root, project, rels, reason) // 复制 rels 里存在文件进新快照目录 + 写 manifest
   function listBackups(project) // 扫 backupDir，读 manifest，按 ts 倒序
   function pruneBackups() // 保留最新 100 个，删更老的（含目录）
   function restoreBackup(ts, project) // 读 manifest，逐文件用 writeText 语义拷回（先 .bak 再覆盖）
   ```
   注意 `rels` 是相对 `root` 的路径（如 `第一卷/第1章.md`、`追踪/伏笔.md`）；快照里保持同相对路径，恢复时拼回 `path.resolve(root, rel)` 并校验 `isSafePath`。
3. **挂载点**（每处写盘前调用 `snapshotFiles`，reason 取中文标签）：
   - `/api/apply_proposal`（L1574）：`edit`→`[node.file]`、`create`→`[对应 def.file]`、`delete`→`[node.file]`、`file_edit`→`[prop.file]`，reason='AI 修改'
   - `/api/file/save`（L2055）：`[rel]`，reason='手动保存'
   - `/api/file/delete`（L2087）：`[rel]`（unlink 前），reason='删除文件'
   - `/api/layout` POST（L525 附近）：`['小说画布.json']`，reason='布局'（可选，频率低）
4. **新 API**：
   - `GET /api/backups?project=` → `{ ok, list: [{ts, time, reason, project, files:[{rel,size}], n}] }`
   - `POST /api/backups/restore` body `{ ts, project }` → `{ ok, restored: [rel...] }`；恢复后 `pruneBackups()` 并可选给被恢复文件再存一条快照（防误恢复）
   - 恢复时若文件当前内容与快照相同则跳过（幂等）。

### Frontend 设计
- `#themeModal` 加第三个 tab **「历史」**：`#settingsTabHistory` + `#settingsPaneHistory`（参照 `settingsTabAi/settingsPaneAi` 的写法，L1204/1224 区域）。
- 扩展 `switchSettingsTab`（L4432）支持 `'history'`；切到 history 时 fetch `/api/backups` 渲染列表：每行 `时间 | reason | N 个文件` + `[恢复]` 按钮；恢复前 `confirm('恢复后该文件的当前内容将被覆盖，确定？')`，成功后 `loadData()` 并刷新列表。
- reason → 中文标签映射：AI 修改/AI 提案/手动保存/删除文件/布局。
- 深色主题补 `.settingsPaneHistory` 相关样式（如需）。

### Smoke 检查（非破坏性）
- `'备份 API 可访问(读)'`：GET /api/backups → ok + Array。
- `'备份快照+恢复往返'`：用 `/api/file/create` 建临时文件 `_smoke_test.md` → `/api/file/save` 写入 'v1' → 再 save 'v2'（触发快照）→ GET /api/backups 取最近一条 → POST restore 该 ts → GET `/api/file` 验证内容回到 'v1' → `/api/file/delete` 删临时文件（收尾）。断言每步 ok。

---

## 3. 功能 ③：用量统计

**目标**：所有 LLM 调用的 tokens 累计，聊天底部显示本次用量，设置页显示当日/累计。

### Server 设计
1. **数据文件**：`ROOT/.data/usage.json`：
   ```json
   { "byDay": { "2025-06-01": { "prompt": 0, "completion": 0, "total": 0, "calls": 0 } },
     "byModel": { "deepseek-v4-flash-0731": { "total": 0, "calls": 0 } },
     "byChat": [ { "ts": 0, "model": "", "prompt": 0, "completion": 0, "total": 0 } ] }
   ```
   `byChat` 只留最近 50 条（滚动）。
2. **助手**：`recordUsage(model, usage)`（usage 取 `data.usage` 的 prompt_tokens/completion_tokens/total_tokens，容错缺失值=0；写文件失败静默）。
3. **挂载**：**7 个 LLM 调用点**（L778/813/846/946/1810/1865/1908）在 `const data = await r.json();` 后调用 `recordUsage(model, data.usage)`。注意 `/api/chat` 的 10 轮循环里每轮都记（累计 = 各轮之和）。
4. **新 API**：`GET /api/usage` → `{ ok, today: {...}, total: {...}, byModel: {...}, byDay: [近30天数组], recent: [最近调用] }`。
5. **可选费用估算**：`ai-config.json` 支持 `pricePerM: { "模型名": { "in": x, "out": y } }`（每百万 token 美元）；有则 `cost = in*price.in/1e6 + out*price.out/1e6`，无则费用为 null（只显示 tokens，不编造价格）。

### Frontend 设计
- **聊天消息末尾**：`sendChat`/`runAgent` 拿到响应后，若响应带 `usage`（后端可在 `/api/chat` 返回里附带 `{ usage: {prompt, completion, total} }`——**推荐让后端直接回传本次总计**，前端不用自己算），在最后一条消息下渲染小字 `本次 ~1,234 tokens`。
- **设置弹窗 AI tab**：`loadAiSettings()` 时一并 fetch `/api/usage`，在 `#settingsPaneAi` 底部加一行 `今日 X tokens（N 次）· 累计 Y tokens`。

### Smoke 检查
- `'用量 API 可访问'`：GET /api/usage → ok + today 结构正确。
- `'用量已累计(人物推进后)'`：**放在「人物推进 API 可访问」检查之后**（该检查真实调 LLM），断言 `/api/usage` 的 today.calls >= 1。若担心顺序耦合，改为只断言 today.total >= 0 的弱检查。

---

## 4. 功能 ⑤：全书健康度看板

**目标**：一屏总览：总字数/章节数/各卷分布/大纲完成度/伏笔回收率/分类统计。

### Server 设计
- **新 API**：`GET /api/bookstats?project=` → `{ ok, ... }`，从 `buildNodes(root)` 计算：
  - `totalWords`（章节 content 长度和）、`chapterCount`、`avgWordsPerChapter`
  - `byVolume`：按文件路径取卷名（参照前端 `volumeKeyOf`：`n.file.split(/[\\/]/)` 倒数第二段；server 侧同样从 `node.file` 推断），每卷 `{ volume, chapters, words, avg }`
  - `outline`：大纲类节点（label '大纲' 或 type 'volume' 且 file 含 '大纲'）中 desc 非空的比例 → `{ total, filled, rate }`
  - `foreshadow`：解析 `追踪/伏笔.md`（FILE_DEFS `table: true`）的表格行，统计状态列：`{ total, planted, recovered, rate }`（状态含"已回收"计 recovered；"已埋"计 planted；具体列序以 appendSection 插入格式 `| 编号 | 标题 | 待定 | 待定 | 已埋 | 说明 |` 为准，实现前先读该文件确认）
  - `categories`：各 label 的节点数 `{ 设定: n, 角色: n, 伏笔: n, 上下文: n, 大纲: n, 章节: n }`
  - 实现前先 `curl http://127.0.0.1:8787/api/data` 看真实节点结构（当前项目：59 节点，设定18/伏笔13/大纲12/角色6/上下文6/章节·第一卷3）。
- 可复用 `summarizeAuditStats`（L1014）里的 totalWords/avgWords 计算思路。

### Frontend 设计
- `#topBar` 加按钮 `<button id="bookStatsBtn" class="toolBtn">统计</button>`。
- 新弹窗 `#bookStatsModal`（modal-mask 模式，参照 `#themeModal`）：标题「全书统计」，内容：统计卡片（总字数/章节数/平均每章）+ 各卷字数条形 + 大纲完成度进度条 + 伏笔回收率 + 分类 chips。打开时 fetch `/api/bookstats` 渲染；`escapeHtml` 所有动态文本。
- 关闭按钮 + 点击遮罩关闭（参照现有弹窗惯例）。

### Smoke 检查
- `'全书统计 API 可访问'`：GET /api/bookstats → ok、totalWords>0、chapterCount>0。
- `'统计弹窗可打开'`：点 `#bookStatsBtn` → modal 有 `.show` → 关闭。

---

## 5. 功能 ④：时间线视图

**目标**：从章节正文抽取时间标记，渲染时间轴，点击事件跳到对应章节。

### Server 设计
- **新 API**：`GET /api/timeline?project=` → `{ ok, events: [...] }`。
- **抽取逻辑（本地启发式，不调 LLM，零成本）**：
  - 遍历章节节点（label '章节'），对每个 `node.content` 扫描时间标记正则：
    - `(\d{4})年(\d{1,2})月(\d{1,2})日`、`(\d{1,2})月(\d{1,2})日`、`第(\d+)天`、`第([一二三四五六七八九十百]+)天`
    - 相对时间词：`次日|翌日|第二天|三天后|一周后|半个月后|一个月后|半年后|一年后|当天|当日|今天|明天|后天|昨天|前天|此时|与此同时`
  - 每个命中生成事件：`{ id, chapterId, chapterTitle, text（命中片段前后 20 字）, marker（规范化时间描述）, pos（在文中的 index） }`
  - 每章最多取前 8 个事件；全项目上限 500 条。
  - 排序：尽力按数值时间（解析出数字则排序键 = 日期序号或天数；解析不出则按章节顺序排在末尾）。
- 返回数组即可，前端渲染。

### Frontend 设计
- `#topBar` 加按钮 `<button id="timelineBtn" class="toolBtn">时间线</button>`。
- 新弹窗 `#timelineModal`：横向时间轴（`display:flex` 容器 + 滚动），每个事件一个节点卡片：`章节名 · 标记文本`；点击卡片 → 用 `showDetail(node)` 打开该章节详情（或定位画布节点 `fitToNode`，若存在则优先用；否则 `showDetail`）。`escapeHtml` 文本。
- 时间轴视觉：左侧时间刻度 + 卡片流，或按卷分组。简单优先：按事件顺序一行滚动卡片。

### Smoke 检查
- `'时间线 API 可访问'`：GET /api/timeline → ok + events 为数组（当前项目应有章节事件）。
- `'时间线弹窗可打开'`：点 `#timelineBtn` → modal `.show` → 关闭。

---

## 6. 实施顺序与验证清单

**顺序**：① 回滚+备份 → ③ 用量 → ⑤ 看板 → ④ 时间线。每个功能完成即：
1. `node --check server.js` + index.html 内联脚本抽取语法检查（参考本会话做法：正则抽取 `<script>` 无 src 的内联块 → 临时 js → `node --check`）。
2. curl 验证新 API（`http://127.0.0.1:8787/api/...`）。
3. `node scripts/smoke-test.js`（或 `npm test`）全量跑，预期从 52 项增至约 60 项，**全绿**。
4. 每项新 UI 用 CDP（端口 9226+ 临时 Edge profile）做几何/DOM 验证 + 截图（可选）。

**最终验收**：4 项功能齐备 + 冒烟全绿（52 + ~8 新增）。

**已知注意**：
- 冒烟测试会真实调用 LLM（人物推进等），成本低（flash0731 便宜），但用量统计功能上线后这些调用会累计进 usage.json——正常现象。
- 快照/用量数据都在 `ROOT/.data/`，属应用数据，不污染小说项目。
- `_smoke_test.md` 之类的临时文件测试完必须删除；快照目录里的测试快照会被 `pruneBackups()` 自动清理（保留 100）。
- 若 `getApiConfig()` 因用户保存过 `.data/ai-config.json` 而优先于 env，不影响任何本任务（只读使用 api.base/api.model/api.apiKey）。
- 不要在 `release/` 里同步任何改动；任务完成可选跑 `npm run build:portable`（同步源码），但**不算发布验证**。
