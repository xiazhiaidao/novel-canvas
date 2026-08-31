# Novel Canvas 架构说明

## 1. 目标与边界

小说画布是一个**本地优先**的小说创作画布应用。核心目标是：

- 把 Markdown 小说项目扫描成可视化节点，不复制小说内容。
- 让用户通过拖拽、连线和编辑，直观管理角色、设定、伏笔、大纲与章节。
- 在同一界面中接入 AI 对话，AI 只提出修改提案，用户确认后才写回真实 Markdown。
- 保持轻量：无前端框架、无数据库，依赖 Electron + Node HTTP + 原生 HTML/CSS/JS。

边界：

- 服务只监听 `127.0.0.1`，不面向公网开放。
- 应用不维护独立的小说数据副本；Markdown 文件是内容真源。
- 布局和连线是唯一的“画布状态”，按项目保存在 `小说画布.json`。

## 2. 运行拓扑与进程边界

```text
Electron Main (main.js)
    │ spawn / 复用端口
    ▼
Node HTTP Server (server.js, 127.0.0.1:8787)
    │
    ├── 静态页面  index.html / canvas_upgrade.js / canvas_theme.css
    ├── JSON API  /api/*
    └── DeepSeek  /api/chat /api/continue

BrowserWindow (index.html)
    │ window.novelAPI.changeFolder()
    ▼
Preload (preload.js)
    │ ipcMain.handle('change-folder')
    ▼
Electron Main
```

- **Electron Main**：管理窗口、选择项目根目录、拉起/复用本地服务、开发模式文件监听。
- **Preload**：只暴露 `novelAPI.changeFolder()`，保持 `contextIsolation: true`、`nodeIntegration: false`。
- **本地 HTTP Server**：真正的业务核心，负责项目扫描、API、AI 对话和文件写回。
- **Renderer**：负责画布交互、详情编辑、聊天 UI 和主题；所有文件操作都通过 HTTP API 完成。

浏览器模式（`node server.js`）去掉 Electron Main 和 Preload，其余链路不变；“更换文件夹”按钮在浏览器模式不可用，需要通过 `NOVEL_PROJECTS_ROOT` 配置。

## 3. 组件职责

| 文件 | 职责 |
| --- | --- |
| `main.js` | Electron 生命周期、窗口创建、`settings.json` 持久化、服务进程管理、`change-folder` IPC、开发热重载 |
| `preload.js` | contextBridge 暴露 `changeFolder` |
| `server.js` | HTTP 路由、项目识别、Markdown 扫描、布局读写、AI 对话与提案、静态文件服务 |
| `index.html` | 画布布局、节点渲染、拖拽/缩放/平移、自动/手动连线、详情编辑、聊天面板、主题设置 |
| `canvas_upgrade.js` | 补充 UI 能力：适应视图、小地图、新建节点弹窗、聊天历史、章节新建/重命名 |
| `file_editor.js` | 文件树 + 多标签 Markdown 编辑器 + AI 修改 Diff 审阅 |
| `canvas_theme.css` | 深色主题变量与组件样式覆盖 |
| `scripts/dev.js` | 开发编排：`node --watch server.js` + Electron |
| `scripts/smoke-test.js` | 冒烟测试：启动/复用服务，headless Edge CDP 检查关键 UI 与 JS 异常 |
| `scripts/build-portable.js` | 将开发文件同步到 `release/小说画布-win32-x64/resources/app` |

## 4. 核心数据模型

服务端扫描 Markdown 后生成统一节点结构：

```ts
interface CanvasNode {
  id: string;        // 例如 role:莫余、chapter:正文:第一卷:第01章
  file: string;      // 相对项目根目录的 Markdown 路径
  type: string;      // role | faction | setting | foreshadow | volume
  label: string;     // 角色 | 势力 | 设定 | 伏笔 | 章节 | 大纲 | 写作规范 ...
  title: string;
  content: string;   // 该节点对应的 Markdown 片段
  startLine: number; // 在文件中的起始行
  endLine: number;   // 在文件中的结束行
  desc: string;      // 首段非标题文本，前 100 字符
}
```

### 节点来源

- `FILE_DEFS`：按固定文件清单解析，`heading` 型按 `##` 分段，`table` 型按 Markdown 表格逐行解析。
- `scanDirAsNodes`：扫描 `设定/角色`、`设定/势力`、`设定/世界观` 下每个 `.md` 文件为一个节点。
- `scanChapters`：扫描根目录和 `正文/` 下的卷目录，把每个章节 Markdown 作为 `volume/章节` 节点。

### 布局持久化

每个项目根目录下的 `小说画布.json`：

```json
{
  "nodes": { "<nodeId>": { "x": 0, "y": 0 } },
  "customLinks": [["<idA>", "<idB>"]]
}
```

- `nodes` 保存拖拽后的坐标。
- `customLinks` 保存用户手动创建的连线。
- 自动连线由前端根据节点标题关键词实时计算，不持久化。

## 5. 主要数据流

### 5.1 加载画布

```text
Renderer /api/projects
  → 项目列表与当前项目
Renderer /api/data?project=<name>
  → server 扫描 buildNodes(root)
  → 合并/补齐 小说画布.json 中缺失节点位置
  → 返回 { project, nodes, layout }
Renderer buildLinks() 生成自动连线
Renderer renderNodes() / renderSidebar() / renderFilters()
```

### 5.2 编辑节点并保存

```text
用户点击节点 → showDetail(n)
用户修改 textarea → 点击“保存到项目文件”
POST /api/save { id, content, project }
  → server 定位节点行范围
  → 用新内容替换 startLine..endLine
  → 先复制 .bak，再写回原 Markdown
  → 重新 buildNodes 并返回新节点
```

### 5.3 AI 对话与提案

```text
POST /api/chat { messages, project, skills }
  → server 组装项目上下文（节点摘要，最多 12000 字符）
  → 组装系统提示词 + 最近 20 条消息
  → 调用 DeepSeek chat/completions（model: deepseek-chat, tools: AGENT_TOOLS）
  → 若模型请求工具：
       edit_node / create_node / delete_node
       server 不直接写盘，先生成 proposal 存内存
  → 返回 { reply, proposals }

用户在聊天面板看到提案卡片
POST /api/apply_proposal { id, project }
  → server 根据 proposal.kind 执行写回
  → 返回最新节点列表
```

AI 可用工具：

| 工具 | 行为 |
| --- | --- |
| `edit_node` | 生成整段替换提案 |
| `create_node` | 生成追加章节/节点提案 |
| `delete_node` | 生成删除行范围提案 |

除对话提案外，文件编辑器通过 `/api/ai/edit` 生成 `kind: "file_edit"` 的提案，旧内容/新内容均为整个 Markdown 文件。

### 5.4 文件树与多标签编辑

```text
用户切换到侧栏“文件”模式
  → GET /api/files 获取项目 .md 目录树
  → 点击文件 → GET /api/file 读取内容 → 打开编辑器标签
  → 编辑后 POST /api/file/save 写回原文件
  → 新建/重命名/删除 → /api/file/create | /api/file/rename | /api/file/delete
  → AI 改写/续写 → POST /api/ai/edit 生成 file_edit 提案
  → 用户接受 → POST /api/apply_proposal 写回文件
```

多标签状态（`openFiles`、`activeFilePath`、`dirty`）只存在于前端内存；文件内容是磁盘真源，保存时才写回。

## 6. 安全与本地约束

- **服务地址**：`server.listen(PORT, '127.0.0.1')`，不监听外部网卡。
- **路径校验**：`projectDir()` 拒绝越界项目名；`isSafePath()` 拒绝写越界文件。
- **Electron 安全**：`contextIsolation: true`、`nodeIntegration: false`，渲染层无法直接访问 Node。
- **外链处理**：`setWindowOpenHandler` 只放行 `http/https` 并交给系统浏览器。
- **密钥边界**：DeepSeek API Key 只存在于服务端进程/环境变量/InkPilot 配置，不通过 API 返回给渲染层。
- **写文件保护**：所有写回先复制 `.bak` 再覆盖；目前是“普通写保护”，不是严格多文件事务。

## 7. 当前限制与后续方向

- AI 提案保存在服务端内存，重启服务会丢失未审阅提案。
- 没有数据库和版本历史；`小说画布.json` 为唯一布局源，外部编辑冲突不检测。
- 没有前端构建链；代码为纯静态 JS，较难做类型检查与模块化。
- 自动连线基于标题关键词匹配，较简单，可能产生噪声。
- 测试依赖 Windows 本机 Edge 路径；跨平台需调整 `EDGE_CANDIDATES`。
- 后续可以考虑：布局版本化、AI 提案落盘恢复、更稳定的节点 ID 迁移、前端模块化与类型检查。
