# 更新日志

本项目的版本号与功能里程碑对齐。所有变更记录在此文件，按时间倒序排列。

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
