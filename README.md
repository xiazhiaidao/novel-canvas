# Novel Canvas · 小说画布

> 本地小说创作画布：把 Markdown 小说项目扫描成可视化节点，以「进度轴」视图组织剧情、自动连线、AI 对话、章节按卷分组、深色主题。

小说画布是一个轻量级本地写作工作台。它不复制你的小说数据，而是直接扫描本地 Markdown 项目，在画布上生成角色、设定、伏笔、大纲和章节节点；以进度轴视图（X=章节，Y=剧情推进）展示全书结构，支持实体自动连线、手动维护剧情重要节点时间线、编辑 Markdown 原文，并在同一个窗口里和 AI 讨论剧情、续写章节。

## 功能

- **项目扫描**：自动读取 `设定.md`、`大纲.md`、`追踪/角色状态.md`、`追踪/伏笔.md`、`角色设定汇总.md`、`写作规范.md`、`设定/角色|势力|世界观/*.md` 以及章节文件。
- **进度轴视图（唯一视图）**：X 轴按章节横向展开（章节过多时自动按段聚合），Y 轴为剧情推进 0~100%，支持按卷/境界/剧情关键节点分段；节点上下拖动调整推进位置。
- **自动/手动连线（画在进度轴内）**：实体关联（角色/设定/大纲等名词出现在内容中自动连线）、标题匹配、章节聚焦三种算法自动生成连线；也可手动添加连线。拖动节点时连线实时跟随，点实线可删除。
- **时间线 · 重要节点**：按剧情重要节点手动维护时间线（填写节点名、选择所属章节、可选剧情推进%），不依赖正文里的「第几天」时间标记——长篇剧情跨越百年时依然准确；点击节点直接跳转到对应章节。**节点以 ⚑ 直接标注在进度轴上**（X=章节列，Y=剧情推进），可拖动调整位置。
- **详情编辑**：点击节点查看完整 Markdown，直接编辑并写回原文件，支持预览和字数统计。
- **章节管理**：按卷分组折叠、新建章节、重命名章节、AI 续写。
- **左侧筛选/搜索**：按分类（设定/大纲/角色/伏笔/上下文/章节/未识别）筛选画布显示内容，关键字搜索并逐条高亮定位——对进度轴节点同样生效，且高亮会自动平移视野到命中节点；支持 `↓/↑` 键盘切换命中。
- **左侧栏点击跳转**：点击左侧分类列表中的节点，进度轴自动平移居中并闪烁高亮该节点，右侧同步打开详情（自动清空搜索关键字避免被过滤）。
- **关系矩阵**：角色×章节 / 伏笔×章节 / 设定×角色 三种矩阵，✓ 格悬停显示命中别名与次数，点击直接跳转到对应章节、点表头查看节点。
- **空项目引导**：项目还没有可显示内容时，进度轴显示引导卡（检查正文目录 / 调整扫描规则 / 打开文件面板）。
- **AI 对话**：结合画布节点上下文与 DeepSeek 对话；AI 可以提出新增/修改/删除节点的提案，由你审阅后写回文件。
- **VSCode 风格布局**：左侧 Activity Bar + 可切换侧栏，中央画布/文件编辑器标签，右侧详情栏，底部 AI 对话面板，底部状态栏。
- **文件树 + 多标签编辑器**：左侧「文件」侧栏浏览项目下所有 Markdown，中央多标签编辑，支持预览、保存、新建、重命名、删除。
- **AI 文件修改 Diff 审阅**：在编辑器中让 DeepSeek 改写/续写，生成旧/新内容对比，接受后写回文件。
- **主题**：深色/浅色切换，自定义强调色。
- **多项目支持**：项目下拉切换，桌面端可随时更换小说项目根目录。

## 快速开始

### 方式一：桌面应用（推荐）

```bash
npm start
```

启动本地服务并打开独立桌面窗口，无需浏览器。

### 方式二：浏览器

```bash
node server.js
```

打开 <http://127.0.0.1:8787/>

### 开发模式（推荐开发时用）

```bash
npm run dev
```

- 服务端使用 `node --watch` 热重载
- 自动打开 Electron 开发窗口
- 修改 `index.html` / `canvas_upgrade.js` / `canvas_theme.css` 会自动刷新窗口

### 测试

```bash
npm test
```

一键冒烟测试（headless Edge）：项目加载、主题切换、进度轴、连线、时间线编辑器、轴内时间线 pin、分类筛选、关系矩阵、搜索导航、侧栏跳转等 79 项检查。

### 打包便携版

```bash
npm run build:portable
```

把源码同步到 `release/小说画布-win32-x64/resources/app`，用于更新已有 Electron 便携目录；完整打包用 `npm run build`（electron-builder 生成单文件 portable exe）。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `8787` |
| `NOVEL_PROJECTS_ROOT` | 小说项目根目录（存放各小说项目文件夹） | 本文件所在目录的上一级 |
| `DEFAULT_PROJECT` | 默认打开的小说项目名 | 小说根目录下第一个项目 |
| `DEEPSEEK_API_KEY` | AI 对话 API Key | 自动从项目内 InkPilot 配置读取 |
| `DEEPSEEK_API_BASE` | DeepSeek API 地址（可选） | `https://api.deepseek.com/v1` |
| `INKPILOT_CONFIG` | InkPilot data.json 的绝对路径（可选） | 自动扫描小说根目录 |

## 项目结构

```text
novel-canvas/
├── main.js              # Electron 桌面壳（自动拉起 server.js）
├── preload.js           # contextBridge 安全桥
├── server.js            # 本地 HTTP 服务 + API + Markdown 扫描 + AI 代理
├── index.html           # 主画布页面（UI + 结构）
├── app.js               # 主应用逻辑（画布/进度轴/连线/时间线）
├── canvas_upgrade.js    # 画布增强脚本
├── file_editor.js       # 文件树 + 多标签编辑器 + AI 修改审阅
├── canvas_theme.css     # 主题样式（深色/浅色）
├── electron-builder.yml # electron-builder 打包配置
├── CHANGELOG.md         # 版本变更记录
├── AGENTS.md            # 开发者/AI 协作规范
├── scripts/
│   ├── dev.js           # 开发模式编排（server 热重载 + Electron）
│   ├── smoke-test.js    # headless Edge CDP 冒烟测试
│   └── build-portable.js# 同步源码到便携版目录
└── docs/
    ├── ARCHITECTURE.md  # 架构说明
    ├── API.md           # HTTP API 参考
    └── DEVELOPMENT.md   # 开发指南
```

## 数据存放说明

- **节点内容**：直接扫描小说项目里的 Markdown 文件（设定、大纲、正文等），不复制数据。
- **布局/连线/时间线**：保存在每个小说项目根目录下的 `小说画布.json`（含节点坐标、进度轴分段、手动连线、时间线重要节点 `timelineNodes`、人工纠正 overrides）。
- **自动快照**：每次保存布局时自动在 `novel-canvas/.data/backups/` 生成快照，可回滚。
- **聊天记录**：浏览器 localStorage，按项目名隔离。
- **AI 提案**：运行期间保存在服务端内存中；接受/拒绝后才会写回 Markdown。

## 构建发布

```bash
npm test              # 冒烟测试（79 项）
npm run build         # electron-builder 完整打包（win-x64 portable）
npm run build:portable  # 仅把源码同步到已有便携目录（发布前的快速更新）
```

## 开发文档

- [架构说明](docs/ARCHITECTURE.md)
- [API 文档](docs/API.md)
- [开发指南](docs/DEVELOPMENT.md)
- [项目协作规范](AGENTS.md)
