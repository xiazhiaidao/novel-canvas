# Novel Canvas 项目协作规范

本文件面向在 `novel-canvas` 中工作的开发者与 AI Agent。它描述代码风格、安全边界、测试和打包约定，避免破坏本地小说数据。

## 1. 项目边界

- 本仓库只开发 `novel-canvas` 应用本身，不修改 `D:\小说` 下各小说项目内容。
- Markdown 小说文件是用户数据真源；代码只应通过 `server.js` 的受控 API 读写。
- 不要为了测试或演示直接修改真实小说项目，除非用户明确要求。

## 2. 常用命令

```bash
npm install
npm run dev        # 开发：server 热重载 + Electron
npm test           # 冒烟测试
npm run build:portable
node server.js     # 浏览器模式
```

- 修改 `index.html` / `canvas_upgrade.js` / `canvas_theme.css` 后，桌面开发模式会自动刷新。
- 修改 `server.js` 后，`npm run dev` 的 `node --watch` 会自动重启。

## 3. 代码结构约定

| 目录/文件 | 责任 |
| --- | --- |
| `main.js` | Electron 主进程；不要放业务扫描逻辑 |
| `preload.js` | 只暴露最小 API 给 Renderer |
| `server.js` | HTTP API、Markdown 扫描、AI 代理、文件写入 |
| `index.html` | 前端结构、样式、交互 |
| `canvas_upgrade.js` | 前端增强函数；保持与 `index.html` 内脚本一致的全局函数风格 |
| `file_editor.js` | 文件树、多标签编辑器、AI 文件修改审阅 |
| `canvas_theme.css` | 主题样式；不要在其中引入与主题无关的布局 |
| `scripts/` | 开发/测试/构建脚本 |

## 4. 后端约定

- **API 风格**：统一返回 `{ ok: true, ... }` 或 `{ error: "..." }`；错误不要抛未处理异常。
- **路径安全**：任何读写用户文件的操作都必须通过 `projectDir()` / `resolveProjectRoot()` / `isSafePath()` 校验，禁止拼接用户可控路径后直接读写。
- **写文件**：先写 `.bak` 再覆盖；新增写操作沿用 `writeText()`。
- **节点扫描（大一统框架）**：默认规则来自 `server.js` 的 `DEFAULT_CONFIG`（可被项目根 `novel-canvas.config.json` 覆盖）。识别管线为 层1 约定规则（config.scan.files/dirs/chapters）→ 未识别池（未被任何规则覆盖的 md 深切分为 `unrec:` 节点）→ 层2 front matter（type/label/chapter/level/lane）→ 层4 人工 overrides（布局文件）。节点结构保持 `{ id, file, type, label, title, content, startLine, endLine, desc }`，新增字段（chapter/level/lane/recognizedBy/unrecognized/parentLevel）为可选。未识别节点 type='unrecognized'、label='未识别'，灰色渲染。新加扫描规则优先写入项目 `novel-canvas.config.json`，不要往代码里加个人文件名硬编码。
- **AI 提案**：AI 写回必须先生成 proposal，不能绕过 `/api/apply_proposal` 直接写盘。
- **文件操作**：文件树/编辑器统一走 `/api/files`、`/api/file`、`/api/file/save|create|delete|rename`；文件写操作必须校验 `.md` 后缀与路径安全。
- **AI 文件修改**：编辑器使用 `/api/ai/edit` 生成 `file_edit` 提案，统一由 `/api/apply_proposal` 应用，不能直接覆盖编辑器文件。
- **布局文件**：`小说画布.json` 只保存视图状态（坐标、手动连线、`mode: 'free'|'axis'`、`axis` 轴位、`overrides` 人工纠正），不保存 Markdown 正文。保持 `version: 3`。

## 5. 前端约定

- 保持“无框架、原生 JS/CSS”的现状；不要为了小功能引入 React/Vue/打包器。
- 新增 UI 必须同时兼容浅色和深色主题：
  - 浅色基础变量在 `index.html` 的 `:root`。
  - 深色覆盖在 `canvas_theme.css` 的 `html[data-theme="dark"]`。
  - 主题强调色通过 `--accent` 动态变化，不要硬编码橙色替代。
- 不要使用会改变布局的临时错误/警告块。当前项目使用 `alert/confirm/prompt` 和 `status` 文本；若引入 toast 式反馈，必须全项目统一实现。
- 所有动态 HTML 插入用户内容时必须使用 `escapeHtml()` 或 `textContent`，防止 XSS。
- 节点拖拽、缩放、连线逻辑集中在 `index.html` 和 `canvas_upgrade.js`，保持函数命名清晰。
- 多标签编辑器状态统一维护在 `file_editor.js`（`openFiles`、`activeFilePath`、`dirty`、`currentFileProposal`），不要散落到 `index.html` 内联脚本。

## 6. 测试约定

- 运行 `npm test` 前确保 8787 端口未被无关服务占用；测试会复用已启动的服务。
- 新增 API 后至少补充手动 curl 验证；新增 UI 后建议在 `scripts/smoke-test.js` 增加 `check(...)`。
- 冒烟测试使用 `_edge_smoke_test` 临时 profile，结束后会清理；不要手动保留该目录。

## 7. 打包约定

- `npm run build:portable` 只同步源码到 `release/小说画布-win32-x64/resources/app`，不重新生成 Electron 骨架。
- 生成新安装包/便携包优先使用 `electron-builder.yml`；不要在 `scripts/build-portable.js` 里硬编码平台相关命令。
- 打包产物应明确报告“已构建”还是“已运行验证”，不能把目录同步当成完整发布验证。

## 8. 已知限制（开发时勿“修好又改回去”）

- AI proposal 存在服务端内存中，重启服务会丢失。
- 浏览器模式没有“更换文件夹”能力，只能通过 `NOVEL_PROJECTS_ROOT` 配置。
