# Novel Canvas HTTP API

本地服务默认运行在 `http://127.0.0.1:8787`。所有接口返回 `application/json; charset=utf-8`。

## 通用约定

- 请求体使用 JSON（`Content-Type: application/json`）。
- 错误统一返回 HTTP 200 + `{ "error": "..." }`；调用方应同时判断 `data.error`。
- 项目参数 `project` 可省略，省略时使用 `defaultProjectName()` 选出的默认项目。
- 所有写操作都会先尝试生成 `.bak` 备份，再覆盖原 Markdown 文件。

## 节点对象

```json
{
  "id": "role:莫余",
  "file": "角色设定汇总.md",
  "type": "role",
  "label": "角色",
  "title": "莫余",
  "content": "## 莫余\n\n……",
  "startLine": 1,
  "endLine": 20,
  "desc": "莫余，主角……"
}
```

节点 `id` 由文件来源与标题 slug 组成；`type` 可能为 `role / faction / setting / foreshadow / volume`。

---

## GET /api/projects

获取小说项目列表与当前默认项目。

**响应**

```json
{
  "projects": ["从0开始的天灾生活", "列车求生"],
  "current": "从0开始的天灾生活"
}
```

---

## GET /api/data

获取某个项目的节点与画布布局。

**Query**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `project` | string | 项目名，可选 |

**响应**

```json
{
  "project": "从0开始的天灾生活",
  "nodes": [ { "id": "role:莫余", "file": "...", "type": "role", "label": "角色", "title": "莫余", "content": "……", "startLine": 1, "endLine": 20, "desc": "……" } ],
  "layout": {
    "nodes": { "role:莫余": { "x": 40, "y": 0 } },
    "customLinks": [["role:莫余", "setting:世界观"]]
  }
}
```

`layout.customLinks` 会从 `小说画布.json` 读取并返回，手动连线在刷新后可以恢复。

---

## 文件树与文件编辑

### GET /api/files

获取项目下全部 Markdown 文件的目录树。

**Query**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `project` | string | 项目名，可选 |

**响应**

```json
{
  "ok": true,
  "files": [
    {
      "name": "正文",
      "path": "正文",
      "type": "dir",
      "children": [
        { "name": "第01章_白球.md", "path": "正文/第01章_白球.md", "type": "file" }
      ]
    },
    { "name": "设定.md", "path": "设定.md", "type": "file" }
  ]
}
```

### GET /api/file

读取某个 Markdown 文件内容。

**Query**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `project` | string | 项目名，可选 |
| `path` | string | 相对项目根目录的 `.md` 路径 |

**响应**

```json
{
  "ok": true,
  "path": "正文/第01章_白球.md",
  "content": "# 第01章 白球\n\n……"
}
```

### POST /api/file/save

保存某个 Markdown 文件内容，先写 `.bak` 再覆盖。

**请求体**

```json
{
  "project": "从0开始的天灾生活",
  "path": "正文/第01章_白球.md",
  "content": "# 第01章 白球\n\n新内容……"
}
```

**响应**

```json
{ "ok": true, "path": "正文/第01章_白球.md" }
```

### POST /api/file/create

新建 Markdown 文件。`path` 可含子目录，父目录会自动创建。

**请求体**

```json
{
  "project": "从0开始的天灾生活",
  "path": "设定/新角色.md"
}
```

**响应**

```json
{ "ok": true, "path": "设定/新角色.md" }
```

### POST /api/file/delete

删除 Markdown 文件。删除前会尝试生成 `.bak`。

**请求体**

```json
{
  "project": "从0开始的天灾生活",
  "path": "设定/新角色.md"
}
```

**响应**

```json
{ "ok": true, "path": "设定/新角色.md" }
```

### POST /api/file/rename

重命名/移动 Markdown 文件。

**请求体**

```json
{
  "project": "从0开始的天灾生活",
  "path": "设定/旧名字.md",
  "newPath": "设定/新名字.md"
}
```

**响应**

```json
{ "ok": true, "path": "设定/新名字.md", "oldPath": "设定/旧名字.md" }
```

### POST /api/ai/edit

让 DeepSeek 改写或续写指定文件，并生成待审阅的 `file_edit` 提案。

**请求体**

```json
{
  "project": "从0开始的天灾生活",
  "path": "正文/第01章_白球.md",
  "content": "# 第01章 白球\n\n当前编辑器里的内容……",
  "instruction": "把开头改得更紧张一些",
  "mode": "edit"
}
```

- `mode`：`edit`（改写）或 `continue`（续写），默认 `edit`。
- `content` 可省略；省略时服务端读取磁盘文件内容。

**响应**

```json
{
  "ok": true,
  "reply": "修改后的完整文件内容……",
  "proposal": {
    "id": "p1",
    "kind": "file_edit",
    "file": "正文/第01章_白球.md",
    "title": "正文/第01章_白球.md",
    "oldContent": "旧内容",
    "newContent": "新内容"
  }
}
```

---

## POST /api/save

保存某个节点的完整 Markdown 内容，并写回原项目文件。

**请求体**

```json
{
  "id": "role:莫余",
  "content": "## 莫余\n\n新的完整内容……",
  "project": "从0开始的天灾生活"
}
```

**响应**

```json
{
  "ok": true,
  "node": { "id": "role:莫余", "file": "...", "type": "role", "label": "角色", "title": "莫余", "content": "……", "startLine": 1, "endLine": 20, "desc": "……" }
}
```

错误示例：`{ "error": "node not found" }`。

---

## POST /api/node

在项目中新建节点/章节内容，追加到对应 Markdown 文件。

**请求体**

```json
{
  "type": "role",
  "title": "新角色",
  "desc": "简介或内容，可空",
  "project": "从0开始的天灾生活"
}
```

`type` 支持：`role`、`faction`、`setting`、`foreshadow`、`volume`。

**响应**

```json
{
  "ok": true,
  "nodes": [ /* 重新扫描后的全部节点 */ ]
}
```

---

## POST /api/delete

删除画布中某个节点对应的 Markdown 片段。

**请求体**

```json
{
  "id": "role:莫余",
  "project": "从0开始的天灾生活"
}
```

**响应**

```json
{
  "ok": true,
  "nodes": [ /* 删除后的全部节点 */ ]
}
```

---

## POST /api/layout

保存画布布局（节点坐标与手动连线）。

**请求体**

```json
{
  "nodes": { "role:莫余": { "x": 40, "y": 0 } },
  "customLinks": [["role:莫余", "setting:世界观"]],
  "project": "从0开始的天灾生活"
}
```

**响应**

```json
{ "ok": true }
```

---

## POST /api/chapter

新建章节 Markdown 文件，并自动放入卷目录。

**请求体**

```json
{
  "title": "新的开始",
  "project": "从0开始的天灾生活"
}
```

**响应**

```json
{
  "ok": true,
  "node": {
    "id": "chapter:正文:第一卷:第01章_新的开始",
    "title": "第01章_新的开始",
    "file": "正文/第一卷/第01章_新的开始.md"
  }
}
```

---

## POST /api/rename

重命名节点/章节。当前实现会修改文件中的第一个 `# 标题`；如果没有标题则把标题插入文件开头。

**请求体**

```json
{
  "id": "chapter:正文:第一卷:第01章_新的开始",
  "title": "新的标题",
  "project": "从0开始的天灾生活"
}
```

**响应**

```json
{
  "ok": true,
  "node": { "id": "chapter:...", "title": "新的标题", "file": "正文/第一卷/第01章_新的开始.md" }
}
```

---

## GET /api/skills

读取项目可用的写作技能列表。

**Query**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `project` | string | 项目名，可选 |

**响应**

```json
{
  "skills": [
    { "name": "story-long-write", "desc": "长篇网文写作……" }
  ]
}
```

技能来源：

- `<项目根>/.agents/skills`
- `<小说根>/.agents/skills`

目录内 `SKILL.md`（或直接 `.md` 文件）会作为一项技能，`description:` 行作为简介。

---

## POST /api/chat

与 AI 对话。服务端会注入当前项目节点摘要和所选技能，并通过 DeepSeek Function Calling 支持节点修改提案。

**请求体**

```json
{
  "messages": [
    { "role": "user", "content": "帮我设计一个新角色" }
  ],
  "project": "从0开始的天灾生活",
  "skills": ["story-long-write"]
}
```

- `messages` 只保留最近 20 条。
- `skills` 可省略；省略时使用项目全部技能。

**响应**

```json
{
  "reply": "好的，这是新角色设计……",
  "proposals": [
    {
      "id": "p1",
      "kind": "create",
      "file": "角色设定汇总.md",
      "title": "新角色",
      "oldContent": "",
      "newContent": "\n## 新角色\n\n……"
    }
  ]
}
```

`proposals` 是待审阅提案，前端展示后由 `/api/apply_proposal` 接受或丢弃。

未配置 DeepSeek API Key 时返回：

```json
{
  "reply": "（AI 对话未配置）请在启动 server.js 前设置环境变量 DEEPSEEK_API_KEY……"
}
```

---

## POST /api/apply_proposal

接受 AI 生成的提案并写回文件。支持 `edit_node`、`create_node`、`delete_node` 以及编辑器产生的 `file_edit` 提案。

**请求体**

```json
{
  "id": "p1",
  "project": "从0开始的天灾生活"
}
```

`edit` 和 `file_edit` 支持可选的 `selectedHunks`，编号为 `review_diff.js` 按原文和提案重新计算的 **0 起始**变更区间。省略该字段沿用整份采纳；传入空数组、重复或越界编号会拒绝，不消耗提案。

```json
{
  "id": "p1",
  "project": "项目名",
  "selectedHunks": [{ "index": 0 }, { "index": 2, "content": "手动调整后的替换段\n" }]
}
```

`content` 可省略，默认使用该区间的提案文本；空字符串表示删除所选原文段。服务端只替换所选区间，保留未选原文，仍比较当前磁盘与提案原文并备份。成功后结束该提案（未选区间不保留为新提案），响应可包含 `selectedCount`。新建/删除节点提案不支持分段；跨项目应用会拒绝。

**响应**

```json
{
  "ok": true,
  "nodes": [ /* 应用后的全部节点 */ ]
}
```

---

## POST /api/continue

对某个章节节点执行 AI 续写。不会自动保存，返回续写文本由前端追加到编辑器。

**请求体**

```json
{
  "id": "chapter:正文:第一卷:第01章_新的开始",
  "project": "从0开始的天灾生活",
  "instruction": "请自然地续写下一段，保持当前文风和剧情节奏。"
}
```

`instruction` 可省略，有默认值。

**响应**

```json
{
  "reply": "续写后的正文内容……"
}
```

---

## 采纳历史与撤销

- `GET /api/proposals/applied?project=项目名`：返回 `applications`，每项包含 `id`、`proposalId`、`file`、`state`（applied/undone/prepared）、`time` 与 `partial`，不返回原文。
- `/api/apply_proposal` 成功响应增加 `application: { id, file, state, time, partial }`。提案 ID 是不透明字符串，新提案使用 UUID；旧 ID 仍有效。
- `POST /api/proposals/undo` 请求 `{project,id}`，`id` 为采纳记录 ID。校验项目与采纳后文件哈希后恢复整份原文件；原文件不存在时删除本次新文件。重复撤销、文件被删除或再次修改时拒绝，响应 `conflict:true` 表示后续修改冲突。任务中的已采纳状态随之改为已撤销，不自动恢复原提案。
- 采纳前原文与结果哈希保存在服务数据目录的 `applications/`；源码/目录版默认为应用 `.data/`，asar 桌面包使用 Electron 用户目录 `service-data/`，也可通过 `NOVEL_CANVAS_DATA_DIR` 指定。写入历史失败时不开始修改小说文件，撤销前沿用现有快照保护。

## 时间线同步

- `POST /api/timeline/preview`：`{project,path,chapter?}`，只读取已保存 Markdown，返回 `token`、`events`（解析事件数量）、`operations`。每项 `action` 为 add/update/delete，含 `next` 和/或 `before`。
- `POST /api/timeline/sync`：`{project,path,chapter?,token,selected:[0,1]}`。服务端重算预览并验证来源/画布未变，只应用所选操作；返回 `{ok:true,events:完整画布时间线,changed}`。空选择、重复/越界序号、越界路径和旧 token 会拒绝。
- 支持明确章号的分节列表、短事件段落，以及包含“事件/标题”列的表格。表格可包含章节、事件ID、时间、依据；同一源文件的事件 ID 必须唯一。稳定 ID 支持变更章号后更新同一节点；无 ID 时按章节内顺序匹配，预览 UI 明示这一限制。
- 同步节点增加 `sourceFile/sourceKey/sourceLine/sourceChapter`，`GET /api/data` 保留这些字段；手动节点与已有推进值保留。删除仅针对本来源的缺失事件，需显式选择；原文件撤销删除后仍可预览清理其关联节点。

## 静态文件路径

- `GET /`、`GET /index.html` → 主页面
- `GET /canvas_upgrade.js`、`GET /canvas_theme.css` 等应用内静态文件
- 路径必须位于 `novel-canvas` 应用目录内，越界返回 404。
