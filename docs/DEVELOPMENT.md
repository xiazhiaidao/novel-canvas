# Novel Canvas 开发指南

本文面向要在 `novel-canvas` 中开发、调试、测试和发布的人。

## 1. 环境要求

- Node.js 18+（项目使用 `node --watch`，建议 Node 20+）
- npm
- 桌面模式：Electron 会在 `npm install` 时安装
- 冒烟测试：Windows 本机 Microsoft Edge（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` 等路径）
- 小说项目根目录：默认是 `D:\小说`（即 `novel-canvas` 的上一级）

## 2. 安装与启动

```bash
cd D:\小说\novel-canvas
npm install

# 桌面应用
npm start

# 浏览器模式
node server.js

# 开发模式（服务端热重载 + Electron 自动刷新）
npm run dev
```

启动后访问：

- 桌面窗口自动打开
- 浏览器模式：<http://127.0.0.1:8787/>

## 3. 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm start` | 启动 Electron 桌面应用 |
| `node server.js` | 仅启动本地 HTTP 服务（浏览器模式） |
| `npm run dev` | 开发模式：`node --watch server.js` + Electron |
| `npm test` | 冒烟测试（headless Edge + CDP） |
| `npm run build:portable` | 同步源码到已有便携版 `release/小说画布-win32-x64/resources/app` |
| `npx electron-builder --win portable` | 使用 `electron-builder.yml` 生成便携包（需要先准备好资源） |

## 4. 代码结构速览

```text
main.js              Electron 主进程
preload.js           安全桥
server.js            服务端 + API + Markdown 扫描
index.html           前端页面与交互
canvas_upgrade.js    前端增强函数
file_editor.js       文件树 + 多标签编辑器 + AI 修改审阅
canvas_theme.css     主题样式
scripts/dev.js       开发编排
scripts/smoke-test.js 冒烟测试
scripts/build-portable.js 便携版同步
docs/                API / 架构 / 开发指南
```

## 5. 前后端状态对应关系

| 前端变量 | 含义 | 来源 |
| --- | --- | --- |
| `nodes` | 全部画布节点 | `GET /api/data` |
| `nodeMap` | `id -> node` 索引 | 由 `nodes` 构建 |
| `positions` | 节点坐标 | `GET /api/data` 的 `layout.nodes` |
| `customLinks` | 手动连线 | 保存时发送到 `/api/layout` |
| `links` | 自动连线 | 前端 `buildLinks()` 实时计算 |
| `view` | 画布平移/缩放 | 前端内存状态，不持久化 |
| `chatHistory` | 当前项目聊天 | localStorage，按项目隔离 |

### 手动连线持久化

`/api/layout` 会把 `customLinks` 写入 `小说画布.json`；`GET /api/data` 会返回 `layout.customLinks`，刷新页面后手动连线可以恢复。

## 6. 如何新增一种节点来源

节点扫描集中在 `server.js`。

### 方案 A：固定文件清单

在 `FILE_DEFS` 中增加一项：

```js
{ key: 'my-file', file: '我的文件.md', type: 'setting', label: '设定', heading: /^##\s/ }
```

- `heading`：按 `##` 分段，每段一个节点。
- `table: true`：按 Markdown 表格逐行解析，第一列为 ID，第二列为标题。
- 文件不存在时会被 `try/catch` 跳过，不会影响启动。

### 方案 B：扫描目录

在 `buildNodes()` 中调用：

```js
nodes.push(...scanDirAsNodes('mykey', path.join('设定', '新目录'), 'setting', '设定', root));
```

### 方案 C：新增章节扫描规则

在 `scanChapters()` 中调整 `isChapterFileName()` 和 `EXCLUDE_DIR` / `EXCLUDE_FILE`。

## 7. 如何新增一个 API

在 `server.js` 的 `http.createServer` 回调中增加分支，例如：

```js
if (pathname === '/api/example' && req.method === 'POST') {
  try {
    const body = await readBody(req);
    // ...业务逻辑
    return sendJson(res, { ok: true });
  } catch (e) {
    return sendJson(res, { error: e.message });
  }
}
```

约定：

- 写操作前必须校验路径安全：`isSafePath(file, root)`。
- 返回结构统一 `{ ok: true, ... }` 或 `{ error: "..." }`。
- 涉及项目路径时通过 `resolveProjectRoot(project)` 获取 root。

### 7.1 文件编辑器开发

- 前端状态：`fileMode`、`fileTree`、`openFiles`、`activeFilePath`、`currentFileProposal`。
- 文件 API 清单见 `docs/API.md`，包含 `/api/files`、`/api/file`、`/api/file/save|create|delete|rename`、`/api/ai/edit`。
- 新增文件操作时必须校验 `isSafePath()` 且路径以 `.md` 结尾。
- AI 文件修改走 `/api/ai/edit` 生成 `file_edit` 提案；`/api/apply_proposal` 已支持应用这种提案。
- 文件编辑器只在前端内存保存多标签状态；写盘统一通过 `/api/file/save`。
- 从文件模式切回画布模式时会调用 `loadData()`，让画布节点同步文件改动。

## 8. 调试建议

- 服务端日志直接输出到启动终端；`console.error` 用于解析错误。
- 前端调试：桌面窗口可按 F12/Ctrl+Shift+I 打开 DevTools（若菜单被隐藏，可通过代码临时打开或浏览器模式调试）。
- 浏览器模式修改页面后手动刷新即可；开发模式会自动刷新。
- 检查 `小说画布.json` 可确认布局是否落盘。
- 检查 `.bak` 文件可确认写入是否发生过。

## 9. 测试

`npm test` 会：

1. 如果 8787 端口没有服务，则启动 `node server.js`。
2. 启动 headless Edge（CDP 端口 9224）。
3. 验证：
   - 项目列表已加载
   - 更换文件夹按钮存在
   - 主题按钮存在
   - 主题弹窗可打开
   - 可切换浅色并保存
   - 可切回深色
   - 无 JS 异常
4. 清理临时 Edge profile 和测试服务。

新增前端功能后，建议在 `scripts/smoke-test.js` 中追加对应的 `check(...)`。

## 10. 打包与发布

当前有两种打包路径：

### 10.1 同步便携版（最常用）

```bash
npm run build:portable
```

要求已经存在 `release/小说画布-win32-x64/resources/app` 目录（例如先用 electron-builder/electron-packager 生成一次）。脚本会把以下文件同步进去：

```text
main.js
preload.js
server.js
index.html
canvas_upgrade.js
file_editor.js
canvas_theme.css
package.json
```

### 10.2 electron-builder

`electron-builder.yml` 已配置：

- appId：`com.novelcanvas.app`
- productName：`小说画布`
- Windows x64 portable：`小说画布-<version>-win-x64-portable.exe`
- NSIS setup：`小说画布-<version>-win-x64-setup.exe`
- electronVersion：`42.5.0`

首次打包前需要补齐图标等 `build/` 资源；当前仓库没有明确图标资源时，先使用便携目录流程。

## 11. 开发约定

- **中文优先**：UI 文案、注释、文档使用中文。
- **路径安全**：任何涉及用户文件路径的服务端代码必须做 containment 校验。
- **写文件备份**：写 Markdown 前先 `copyFileSync` 到 `.bak`。
- **不复制数据**：节点始终从 Markdown 扫描，不要把 Markdown 内容复制到 `小说画布.json`。
- **保持零依赖**：当前应用刻意保持无前端框架、无数据库；新增功能优先使用原生 JS/CSS，避免引入不必要的构建链。
- **兼容浅色/深色**：新增 UI 使用 `index.html` 中 `:root` 变量或 `canvas_theme.css` 的 `[data-theme="dark"]` 覆盖。
- **测试不破坏数据**：冒烟测试使用临时 Edge profile，不修改真实小说项目。
