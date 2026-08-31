// Novel Canvas —— 通用本地小说画布服务
// 用法:
//   node server.js                                  -> http://127.0.0.1:8787
//   NOVEL_PROJECTS_ROOT=D:\小说 PORT=8788 node server.js
//   DEFAULT_PROJECT=从0开始的天灾生活 node server.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname; // 应用目录：存放页面/静态资源
const PROJECTS_ROOT = process.env.NOVEL_PROJECTS_ROOT || path.dirname(ROOT); // 小说项目根目录
const PORT = process.env.PORT || 8787;
const proposals = new Map();
let proposalSeq = 1;

function proposalsFile() {
  return path.join(ROOT, '.data', 'proposals.json');
}
function loadProposals() {
  try {
    const arr = JSON.parse(fs.readFileSync(proposalsFile(), 'utf8'));
    if (!Array.isArray(arr)) return;
    let max = 0;
    for (const p of arr) {
      if (!p || !p.id) continue;
      proposals.set(p.id, p);
      const m = /^p(\d+)$/.exec(String(p.id));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    if (max >= proposalSeq) proposalSeq = max + 1;
  } catch (_) {}
}
function persistProposals() {
  try {
    const arr = [...proposals.values()];
    fs.mkdirSync(path.dirname(proposalsFile()), { recursive: true });
    fs.writeFileSync(proposalsFile(), JSON.stringify(arr, null, 2), 'utf8');
  } catch (_) {}
}
function proposalSet(p) {
  proposals.set(p.id, p);
  persistProposals();
  return p;
}
function proposalDelete(id) {
  proposals.delete(id);
  persistProposals();
}
function projectNameOfRoot(root) {
  try {
    const rel = path.relative(PROJECTS_ROOT, root);
    const top = rel.split(path.sep)[0];
    if (top && top !== '..' && top !== '') return top;
  } catch (_) {}
  return path.basename(root);
}

function defaultProjectName() {
  if (process.env.DEFAULT_PROJECT) return process.env.DEFAULT_PROJECT;
  try {
    const names = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .filter(name => ['设定.md','大纲.md','角色设定汇总.md','写作规范.md'].some(f => fs.existsSync(path.join(PROJECTS_ROOT, name, f))))
      .sort();
    if (names.length) return names[0];
  } catch (_) {}
  return path.basename(ROOT);
}

function projectDir(name) {
  const p = path.resolve(PROJECTS_ROOT, name || defaultProjectName());
  if (p !== PROJECTS_ROOT && !p.startsWith(PROJECTS_ROOT + path.sep)) {
    throw new Error('bad project path');
  }
  return p;
}

function resolveProjectRoot(name) {
  const base = projectDir(name || defaultProjectName());
  if (fs.existsSync(path.join(base, '设定.md'))
    || fs.existsSync(path.join(base, '大纲.md'))
    || fs.existsSync(path.join(base, '追踪'))
    || fs.existsSync(path.join(base, '角色设定汇总.md'))) {
    return base;
  }
  const found = [];
  function walk(dir, depth) {
    if (depth > 5) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      if (fs.existsSync(path.join(p, '设定.md'))
        || fs.existsSync(path.join(p, '大纲.md'))
        || fs.existsSync(path.join(p, '角色设定汇总.md'))
        || fs.existsSync(path.join(p, '第一卷'))) {
        found.push(p);
      }
      walk(p, depth + 1);
    }
  }
  walk(base, 0);
  return found[0] || base;
}

const FILE_DEFS = [
  { key: 'setting', file: '设定.md', type: 'setting', label: '设定', heading: /^##\s/ },
  { key: 'outline', file: '大纲.md', type: 'volume', label: '大纲', heading: /^##\s/ },
  { key: 'roles', file: path.join('追踪', '角色状态.md'), type: 'role', label: '角色', heading: /^##\s/ },
  { key: 'foreshadow', file: path.join('追踪', '伏笔.md'), type: 'foreshadow', label: '伏笔', table: true },
  { key: 'context', file: path.join('追踪', '上下文.md'), type: 'setting', label: '上下文', heading: /^##\s/ },
  { key: 'roles-status', file: path.join('追踪', '状态追踪.md'), type: 'role', label: '角色', heading: /^##\s/ },
  { key: 'settings-file', file: path.join('设定', '设定.md'), type: 'setting', label: '设定', heading: /^##\s/ },
  { key: 'roles-summary', file: '角色设定汇总.md', type: 'role', label: '角色', heading: /^##\s/ },
  { key: 'writing-rule', file: '写作规范.md', type: 'setting', label: '写作规范', heading: /^##\s/ },
  { key: 'vol1-outline', file: '新手域大纲与第五站设计.md', type: 'volume', label: '卷大纲', heading: /^##\s/ },
  { key: 'vol2-outline', file: '第二卷-锈蚀轨道带设定与大纲.md', type: 'volume', label: '卷大纲', heading: /^##\s/ },
  { key: 'vol3-outline', file: '第三卷-源能回廊设定与大纲.md', type: 'volume', label: '卷大纲', heading: /^##\s/ },
  { key: 'vol2-role', file: '第二卷角色状态汇总.md', type: 'role', label: '角色', heading: /^##\s/ },
];

// ── 大一统框架：项目配置（novel-canvas.config.json）─────────────────
// 默认配置 = 现有行为（FILE_DEFS + 三个目录 + 章节扫描），保证旧项目节点 id 零变化。
// 项目里放 novel-canvas.config.json 即可覆盖（结构见 docs/大一统框架设计稿.md §3.1）。

const DEFAULT_AXIS = {
  name: '进度',
  levels: ['开端', '发展', '高潮', '结局'],
  unknownLevel: '未分类',
};

const DEFAULT_CONFIG = {
  schema: 1,
  scan: {
    files: FILE_DEFS.map(d => ({
      key: d.key,
      match: d.file,
      type: d.type,
      label: d.label,
      heading: d.heading ? d.heading.source : null,
      table: !!d.table,
    })),
    dirs: [
      { match: '设定/角色', type: 'role', label: '角色' },
      { match: '设定/势力', type: 'faction', label: '势力' },
      { match: '设定/世界观', type: 'setting', label: '设定' },
      { match: '设定', type: 'setting', label: '设定' },
      { match: '角色', type: 'role', label: '角色' },
      { match: '势力', type: 'faction', label: '势力' },
      { match: '世界观', type: 'setting', label: '设定' },
      { match: '大纲', type: 'outline', label: '大纲' },
      { match: '伏笔', type: 'foreshadow', label: '伏笔' },
      { match: '上下文', type: 'context', label: '上下文' },
    ],
    chapters: {
      dirs: ['正文'],
      titlePatterns: ['^第\\s*[0-9一二三四五六七八九十百千]+\\s*[章回节卷]', '^序章', '^楔子', '^终章', '^番外', '^尾声', '^引子', '^chapter'],
      excludeDirs: ['设定', '大纲', '追踪', '正文', '白球降临', '拆文库', 'novel', 'node_modules', '写作参考资料', '参考', '素材', '模板', '资料', '.git', '.claude', '.agents', '.obsidian', 'release', '.data', '.trash', '.tmp', '.trae', 'references'],
      excludeFiles: ['示例', '模板', '说明', 'readme', 'index', '_meta', '设定与大纲', '汇总', '记录', '规范', '指南', '教程', '参考', '状态', '前传', '原稿', 'agent-prompt', 'agent_prompt', '额度'],
    },
  },
  axis: DEFAULT_AXIS,
  junkDirs: ['node_modules', '.git', '.claude', '.agents', '.obsidian', 'release', '.data', '.trash', '.tmp', '拆文库', '参考', '素材', '模板', '资料', '写作参考资料', 'novel', '.trae', 'references'],
  // 不进未识别池的工具/说明类文件（匹配 rel 路径，大小写不敏感）
  ignoreUnrecognized: ['CLAUDE.md', 'AGENTS.md', 'README', '安装', '使用指南', '效果', '技能清单', '更新日志', 'CHANGELOG', '.novel-agent-prompt', 'agent_prompt', '额度变化记录', '写作规范', '角色状态汇总', '真人作者写作共性', '原稿', 'SKILL', '.trae', '实时汇总', '设定与大纲', '速览', '总表', '成长表', '前传'],
};

function configPath(root) {
  return path.join(root, 'novel-canvas.config.json');
}

function deepMerge(base, over) {
  if (Array.isArray(over)) return over;
  if (over && typeof over === 'object' && base && typeof base === 'object') {
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
    return out;
  }
  return over === undefined ? base : over;
}

function loadProjectConfig(root) {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(configPath(root), 'utf8')); } catch (_) {}
  if (!raw || typeof raw !== 'object') return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  return deepMerge(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), raw);
}

// ── 大一统框架：front matter 解析（层2 元数据）────────────────────
// 支持 md 头部 YAML front matter：type / label / chapter / level / lane / title
function typeToLabel(type) {
  const m = { role: '角色', faction: '势力', setting: '设定', outline: '大纲', volume: '章节', foreshadow: '伏笔', context: '上下文', unrecognized: '未识别' };
  return m[type] || type || '未识别';
}

function parseFrontMatter(text) {
  const lines = String(text || '').split('\n');
  if (!lines.length || lines[0].trim() !== '---') return { fm: {}, body: text };
  let end = -1;
  for (let i = 1; i < Math.min(lines.length, 60); i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end < 0) return { fm: {}, body: text };
  const fm = {};
  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^([\w-]+):\s*(.*)$/);
    if (m) fm[m[1].trim()] = m[2].trim();
  }
  return { fm, body: lines.slice(end + 1).join('\n') };
}

// ── 大一统框架：未识别文件深切分（替代"整文件一个节点"）───────────
// 只用于未被任何规则覆盖的文件。id 用 unrec: 前缀 + 行号锚点，永不与旧 id 冲突。
function deepSplitFile(relFile, text) {
  const lines = String(text || '').split('\n');
  const { fm, body } = parseFrontMatter(text);
  const bodyLines = body.split('\n');
  const key = relFile.replace(/\.md$/i, '').replace(/[\\/]+/g, ':');
  const blocks = [];
  const headings = [];
  for (let i = 0; i < bodyLines.length; i++) {
    const m = bodyLines[i].match(/^(#{1,4})\s+(.+)$/);
    if (m) headings.push({ line: i, level: m[1].length, title: m[2].trim() });
  }
  const base = (fm.type ? 'unrec:' + key : 'unrec:' + key);
  if (!headings.length) {
    if (body.trim()) {
      blocks.push({
        id: base + ':1',
        title: fm.title || path.basename(relFile, '.md').replace(/[_-]+/g, ' '),
        startLine: 1, endLine: lines.length, level: 0, heading: null,
      });
    }
  } else {
    if (headings[0].line > 0 && bodyLines.slice(0, headings[0].line).join('\n').trim()) {
      blocks.push({
        id: base + ':1',
        title: (fm.title || '文件头'),
        startLine: 1, endLine: headings[0].line, level: 0, heading: null,
      });
    }
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const end = i + 1 < headings.length ? headings[i + 1].line : bodyLines.length;
      blocks.push({
        id: base + ':' + (h.line + 1),
        title: h.title,
        startLine: h.line + 1, endLine: end, level: h.level, heading: h.title,
      });
    }
  }
  return { fm, blocks };
}

function chapterNumberFromTitle(title, file) {
  const s = String(title || '') + ' ' + String(file || '');
  const m = s.match(/第\s*([0-9一二三四五六七八九十百千]+)\s*[章回节卷]/) || s.match(/^0*(\d+)\s*[-_]/) || s.match(/\bchapter\s*(\d+)/i);
  if (!m) return null;
  const t = m[1];
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  const cn = '零一二三四五六七八九';
  let num = 0, digit = 0;
  for (const ch of t) {
    const d = cn.indexOf(ch);
    if (d >= 1 && d <= 9) digit = d;
    else if (ch === '十') { num += (digit || 1) * 10; digit = 0; }
    else if (ch === '百') { num += (digit || 1) * 100; digit = 0; }
    else if (ch === '千') { num += (digit || 1) * 1000; digit = 0; }
  }
  if (digit) num += digit;
  return num || null;
}

function readText(file, root) {
  return fs.readFileSync(path.join(root || ROOT, file), 'utf8');
}

function writeText(file, text, root) {
  const full = path.join(root || ROOT, file);
  const bak = full + '.bak';
  try { fs.copyFileSync(full, bak); } catch (_) {}
  fs.writeFileSync(full, text, 'utf8');
}

function findDefByType(type) {
  return FILE_DEFS.find(d => d.type === type) || FILE_DEFS[0];
}

function appendSection(type, title, desc, root) {
  const def = findDefByType(type);
  const file = def.file;
  const text = readText(file, root);
  if (def.table) {
    // 在 “## 未埋待埋” 前插入一行，没有则追加到末尾
    const lines = text.split('\n');
    const insertAt = lines.findIndex(l => l.startsWith('## 未埋待埋'));
    const row = `| NEW-${Date.now().toString().slice(-6)} | ${title} | 待定 | 待定 | 已埋 | ${desc || ''} |`;
    if (insertAt >= 0) lines.splice(insertAt, 0, row);
    else lines.push(row);
    writeText(file, lines.join('\n'), root);
  } else {
    const block = `\n## ${title}\n\n${desc || ''}\n`;
    writeText(file, text.replace(/\s*$/, '\n') + block, root);
  }
}

function deleteSegment(node, root) {
  const file = node.file;
  if (!isSafePath(file, root)) throw new Error('unsafe path');
  const lines = readText(file, root).split('\n');
  lines.splice(node.startLine - 1, node.endLine - node.startLine + 1);
  writeText(file, lines.join('\n'), root);
}

function slug(s) {
  return s.trim().toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

function parseHeadingSegments(fileKey, file, type, label, headingRe, root) {
  const text = readText(file, root);
  const lines = text.split('\n');
  const segs = [];
  const headingIndices = [];
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) headingIndices.push(i);
  }
  if (headingIndices.length === 0) {
    if (lines.join('\n').trim()) {
      const title = path.basename(file, '.md');
      const id = `${fileKey}:${slug(title)}`;
      const content = lines.join('\n');
      const firstLine = lines.find(l => l.trim() && !l.trim().startsWith('#')) || '';
      segs.push({ id, file, type, label, title, content, startLine: 1, endLine: lines.length, desc: firstLine.trim().slice(0, 100) });
    }
    return segs;
  }
  const first = headingIndices[0];
  if (first > 0) {
    const content = lines.slice(0, first).join('\n');
    if (content.trim()) {
      const title = `${label}·文件头`;
      const id = `${fileKey}:${slug(title)}`;
      const firstLine = lines.find(l => l.trim() && !l.trim().startsWith('#')) || '';
      segs.push({ id, file, type, label, title, content, startLine: 1, endLine: first, desc: firstLine.trim().slice(0, 100) });
    }
  }
  for (let idx = 0; idx < headingIndices.length; idx++) {
    const start = headingIndices[idx];
    const end = idx + 1 < headingIndices.length ? headingIndices[idx + 1] : lines.length;
    const title = lines[start].replace(headingRe, '').replace(/[#\s]+$/, '').trim();
    const content = lines.slice(start, end).join('\n');
    const id = `${fileKey}:${slug(title)}`;
    const firstLine = content.split('\n').find(l => l.trim() && !l.trim().startsWith('#')) || '';
    segs.push({ id, file, type, label, title, content, startLine: start + 1, endLine: end, desc: firstLine.trim().slice(0, 100) });
  }
  return segs;
}

function parseTableSegments(fileKey, file, type, label, root) {
  const text = readText(file, root);
  const lines = text.split('\n');
  const segs = [];
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('|') && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return segs;
  const headerCells = lines[headerIdx].split('|').map(s => s.trim()).filter(Boolean);
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|') || !line.trim().endsWith('|')) continue;
    const cells = line.split('|').map(s => s.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const idCell = cells[0] || `row-${i}`;
    const titleCell = cells[1] || idCell;
    const id = `${fileKey}:${slug(idCell)}`;
    segs.push({ id, file, type, label, title: `${idCell} ${titleCell}`.trim(), content: line, startLine: i + 1, endLine: i + 1 });
  }
  return segs;
}

function parseFileAsNode(fileKey, file, type, label, root) {
  const text = readText(file, root);
  const lines = text.split('\n');
  const titleLine = lines.find(l => /^#\s/.test(l));
  const title = titleLine ? titleLine.replace(/^#\s*/, '').trim() : path.basename(file, '.md');
  const firstLine = lines.find(l => l.trim() && !l.trim().startsWith('#')) || '';
  return {
    id: `${fileKey}:${slug(title)}`,
    file,
    type,
    label,
    title,
    content: text,
    startLine: 1,
    endLine: lines.length,
    desc: firstLine.trim().slice(0, 100),
  };
}

function scanDirAsNodes(fileKeyPrefix, dir, type, label, root) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  const out = [];
  for (const e of fs.readdirSync(full, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const rel = path.join(dir, e.name);
    try {
      out.push(parseFileAsNode(fileKeyPrefix + ':' + e.name.replace(/\.md$/, ''), rel, type, label, root));
    } catch (_) {}
  }
  return out;
}


// 收集章节候选文件（相对路径，/ 分隔）。扫描逻辑：
// 1) 项目根下所有非排除目录（递归）——兼容 root/第一卷/…、root/正文/… 结构；
// 2) config.scan.chapters.dirs 显式指定的章节目录（可嵌套，如 novel/projects/1）。
// 章节文件名判定：匹配 config.scan.chapters.titlePatterns，或数字开头的编号章节（01-xxx.md / 17-xxx.md）。
function collectChapterFiles(root) {
  const config = loadProjectConfig(root);
  const files = [];
  const exDirs = new Set(config.scan.chapters.excludeDirs || []);
  const exFiles = new Set(config.scan.chapters.excludeFiles || []);
  const titlePats = (config.scan.chapters.titlePatterns || []).map(p => {
    try { return new RegExp(p, 'i'); } catch (_) { return null; }
  }).filter(Boolean);
  const dirs = (config.scan.chapters.dirs && config.scan.chapters.dirs.length) ? config.scan.chapters.dirs : ['正文'];
  // 辅助文件前置排除：无论文件名像不像章节，只要含这些词就一律不是章节
  // （如 "第二卷-锈蚀轨道带设定与大纲.md" 匹配"第X卷"但它是设定文件）
  const AUX_FILE = /(设定|大纲|汇总|记录|规范|指南|教程|参考|模板|示例|状态|前传|原稿|速览|总表|guide|\.bak|\.claude)/i;
  function isChapterFileName(name) {
    if (AUX_FILE.test(name)) return false;
    if (titlePats.some(r => r && r.test(name))) return true;
    // 数字开头的编号章节文件（01-xxx.md / 17-xxx.md / 30-5-xxx.md / 14.md）
    if (/^\d+([-_ ][^/]*)?\.md$/i.test(name)) return true;
    return false;
  }
  function walk(baseDir, relBase) {
    let entries;
    try { entries = fs.readdirSync(baseDir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (!e.isFile() || !e.name.toLowerCase().endsWith('.md')) continue;
      if ([...exFiles].some(x => e.name.includes(x))) continue;
      if (isChapterFileName(e.name)) files.push(relBase ? relBase + '/' + e.name : e.name);
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (exDirs.has(e.name)) continue;
      walk(path.join(baseDir, e.name), relBase ? relBase + '/' + e.name : e.name);
    }
  }
  walk(root, '');
  for (const d of dirs) {
    const full = path.join(root, d);
    if (fs.existsSync(full)) walk(full, normalizeRel(d));
  }
  return files;
}

function scanChapters(root) {
  const out = [];
  const seen = new Set();
  for (const relFile of collectChapterFiles(root)) {
    try {
      const n = parseFileAsNode('chapter:' + relFile.replace(/\.md$/, '').replace(/[\\/]+/g, ':'), relFile, 'volume', '章节', root);
      n.title = String(n.title).replace(/_/g, ' ');
      // 章号从文件名(basename)解析：避免目录名"第一卷"等卷号污染章号
      const bn = path.basename(relFile);
      let ch = chapterNumberFromTitle(bn, bn);
      if (ch == null) {
        const m = String(bn).match(/^0*(\d+)/);
        if (m) ch = parseInt(m[1], 10);
      }
      n.chapter = ch;
      if (!seen.has(n.id)) { seen.add(n.id); out.push(n); }
    } catch (_) {}
  }
  return out;
}

function findChapterVolumeDir(root) {
  const candidates = [];
  const body = path.join(root, '正文');
  if (fs.existsSync(body)) {
    try {
      for (const e of fs.readdirSync(body, { withFileTypes: true })) {
        if (e.isDirectory() && !/^(\.|拆文库|node_modules|参考|素材|模板|资料)/.test(e.name)) candidates.push(path.join(body, e.name));
      }
    } catch (_) {}
  }
  try {
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (e.isDirectory() && /卷/.test(e.name) && !/^(\.)/.test(e.name)) candidates.push(path.join(root, e.name));
    }
  } catch (_) {}
  if (candidates.length) return candidates[0];
  const fallbackDir = body || path.join(root, '正文');
  fs.mkdirSync(fallbackDir, { recursive: true });
  const fallback = path.join(fallbackDir, '第一卷');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

function nextChapterNumber(dir) {
  let max = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const m = f.match(/第\s*(\d+)\s*章/) || f.match(/^0*(\d+)\s*[-_]/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  } catch (_) {}
  return max + 1;
}

function makeChapterFileName(dir, title) {
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch (_) {}
  const num = nextChapterNumber(dir);
  const dashed = files.filter(f => /^\d+[-_]/.test(f));
  if (dashed.length) {
    const width = Math.max(2, ...dashed.map(f => (f.match(/^(\d+)/) || [])[1].length));
    return String(num).padStart(width, '0') + '-' + title + '.md';
  }
  return '第' + String(num).padStart(2, '0') + '章_' + title + '.md';
}
function findVolumeOutline(root, volumeName) {
  const clean = String(volumeName || '').replace(/^第\s*[0-9一二三四五六七八九十百]+\s*卷\s*[·\-\s]*/, '');
  const candidates = [
    volumeName + '.md',
    volumeName + '大纲.md',
    volumeName + '-设定与大纲.md',
    volumeName + '设定与大纲.md',
    clean + '大纲.md',
    clean + '设定与大纲.md'
  ];
  try {
    for (const f of fs.readdirSync(root)) {
      if (!f.endsWith('.md')) continue;
      if (candidates.includes(f)) return f;
    }
    if (clean.length >= 2) {
      for (const f of fs.readdirSync(root)) {
        if (!f.endsWith('.md')) continue;
        if (f.includes(clean)) return f;
      }
    }
  } catch (_) {}
  return null;
}

function listVolumes(root) {
  const out = [];
  const seen = new Set();
  const EXCLUDE = /^(\.|设定|大纲|追踪|正文|白球降临|拆文库|novel|node_modules|写作参考资料|参考|素材|模板|资料)/;
  const bases = [];
  const body = path.join(root, '正文');
  if (fs.existsSync(body)) bases.push(body);
  bases.push(root);
  for (const base of bases) {
    let entries;
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || EXCLUDE.test(e.name)) continue;
      if (base === root && !/卷/.test(e.name)) continue;
      const dirPath = path.join(base, e.name);
      const rel = path.relative(root, dirPath).split(path.sep).join('/');
      if (seen.has(rel)) continue;
      seen.add(rel);
      let files = [];
      try {
        files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md') && !/(示例|模板|说明|readme|index|_meta|\.bak$)/i.test(f));
      } catch (_) {}
      const totalWords = files.reduce((s, f) => {
        try { return s + fs.readFileSync(path.join(dirPath, f), 'utf8').length; } catch (_) { return s; }
      }, 0);
      out.push({
        name: e.name,
        rel,
        chapterCount: files.length,
        totalWords,
        latestChapter: files.sort().pop() || null,
        outlineFile: findVolumeOutline(root, e.name)
      });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return out;
}

function createVolume(root, name) {
  const safe = String(name || '').trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\.+$/, '');
  if (!safe) throw new Error('卷名不能为空');
  const body = path.join(root, '正文');
  const base = fs.existsSync(body) ? body : root;
  const dir = path.join(base, safe);
  if (fs.existsSync(dir)) throw new Error('卷目录已存在');
  fs.mkdirSync(dir, { recursive: true });
  return { ok: true, name: safe, rel: path.relative(root, dir).split(path.sep).join('/') };
}

function resolveVolumeDir(root, rel) {
  if (typeof rel !== 'string' || !rel.trim()) throw new Error('缺少卷相对路径');
  const dir = path.resolve(root, rel);
  if (!isSafePath(dir, root)) throw new Error('非法卷路径');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('卷目录不存在');
  return dir;
}

function renameVolume(root, rel, newName) {
  const dir = resolveVolumeDir(root, rel);
  const safe = String(newName || '').trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\.+$/, '');
  if (!safe) throw new Error('卷名不能为空');
  const parent = path.dirname(dir);
  const newDir = path.join(parent, safe);
  if (fs.existsSync(newDir)) throw new Error('同名卷目录已存在');
  fs.renameSync(dir, newDir);
  return { ok: true, name: safe, rel: path.relative(root, newDir).split(path.sep).join('/') };
}

function deleteVolume(root, rel) {
  const dir = resolveVolumeDir(root, rel);
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch (_) {}
  if (entries.length) throw new Error('卷目录不为空，无法删除（请先移走或删除章节文件）');
  fs.rmdirSync(dir);
  return { ok: true };
}

function volumeOutlineName(volumeName) {
  const safe = String(volumeName || '').trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\.+$/, '') || '卷';
  return safe + '大纲.md';
}

function openVolumeOutline(root, rel) {
  const dir = resolveVolumeDir(root, rel);
  const name = path.basename(dir);
  const outlineFile = findVolumeOutline(root, name);
  if (!outlineFile) return { ok: true, outlineFile: null, content: null };
  const full = path.resolve(root, outlineFile);
  if (!isSafePath(full, root) || !fs.existsSync(full)) return { ok: true, outlineFile: null, content: null };
  return { ok: true, outlineFile, content: fs.readFileSync(full, 'utf8') };
}

function createVolumeOutline(root, rel) {
  const dir = resolveVolumeDir(root, rel);
  const name = path.basename(dir);
  const outlineFile = findVolumeOutline(root, name) || volumeOutlineName(name);
  const full = path.resolve(root, outlineFile);
  if (!isSafePath(full, root)) throw new Error('非法大纲路径');
  if (!fs.existsSync(full)) {
    const template = '# ' + name + '大纲\n\n## 卷目标\n\n- \n\n## 剧情主线\n\n- \n\n## 关键节点\n\n1. \n\n## 卷末悬念\n\n- \n';
    fs.writeFileSync(full, template, 'utf8');
  }
  return { ok: true, outlineFile };
}

function normalizeRel(p) {
  return String(p || '').split(path.sep).join('/').replace(/^\.\//, '');
}

// 哪些文件已被规则覆盖（约定层吃掉的文件，未识别池跳过它们）
function collectCoveredFiles(config, root) {
  const covered = new Set();
  for (const def of config.scan.files || []) covered.add(normalizeRel(def.match));
  for (const d of config.scan.dirs || []) {
    const full = path.join(root, d.match);
    try {
      for (const e of fs.readdirSync(full, { withFileTypes: true })) {
        if (e.isFile() && e.name.toLowerCase().endsWith('.md')) covered.add(normalizeRel(path.join(d.match, e.name)));
      }
    } catch (_) {}
  }
  // chapters 扫描候选（与 scanChapters 相同的候选逻辑）
  for (const f of collectChapterFiles(root)) covered.add(normalizeRel(f));
  return covered;
}

// 递归收集项目内所有 md（排除 junk 目录）
function walkMdFiles(root, junkDirs) {
  const out = [];
  const junk = new Set(junkDirs || []);
  (function walk(dir, rel) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const relPath = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (junk.has(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(dir, e.name), relPath);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        out.push(relPath);
      }
    }
  })(root, '');
  return out;
}

// 读取文件的 front matter 缓存（避免反复读盘）
const fmCache = new Map();
function fileFrontMatter(file, root) {
  const key = root + '|' + file;
  if (fmCache.has(key)) return fmCache.get(key);
  let fm = {};
  try { fm = parseFrontMatter(fs.readFileSync(path.join(root, file), 'utf8')).fm; } catch (_) {}
  fmCache.set(key, fm);
  return fm;
}
function invalidateFmCache(root) { for (const k of fmCache.keys()) if (k.startsWith(root + '|')) fmCache.delete(k); }

function buildNodes(root) {
  const config = loadProjectConfig(root);
  const nodes = [];

  // 层1 约定规则：files（保持旧 id 生成逻辑）
  for (const def of config.scan.files) {
    try {
      const segs = def.table
        ? parseTableSegments(def.key || def.match, def.match, def.type, def.label, root)
        : parseHeadingSegments(def.key || def.match, def.match, def.type, def.label, new RegExp(def.heading || '^##\\s'), root);
      for (const s of segs) {
        const firstLine = s.content.split('\n').find(l => l.trim() && !l.trim().startsWith('#')) || '';
        nodes.push({
          ...s,
          desc: firstLine.trim().slice(0, 100),
          recognizedBy: 'rule:' + (def.key || def.match),
          // 只有真正的章节节点(label=章节)才提取章号；大纲/设定等标题含"第X卷"字样会被误判，不提取
          chapter: def.label === '章节' ? chapterNumberFromTitle(s.title, s.file) : null,
        });
      }
    } catch (e) {
      console.error('parse error', def.match, e.message);
    }
  }

  // 层1 约定规则：dirs（保持旧 id；同一文件被更具体规则覆盖时跳过，避免重复）
  const dirCovered = new Set();
  const sortedDirs = (config.scan.dirs || []).slice()
    .sort((a, b) => String(b.match || '').split('/').length - String(a.match || '').split('/').length);
  for (const d of sortedDirs) {
    try {
      const arr = scanDirAsNodes(d.type, d.match, d.type, d.label, root);
      for (const n of arr) {
        const rel = normalizeRel(n.file);
        if (dirCovered.has(rel)) continue;
        dirCovered.add(rel);
        n.recognizedBy = 'rule:dir:' + d.match;
        nodes.push(n);
      }
    } catch (_) {}
  }

  // 层1 约定规则：chapters（保持旧 id）
  for (const n of scanChapters(root)) { n.recognizedBy = 'rule:chapters'; nodes.push(n); }

  // 层1 未识别池：未被任何规则覆盖的 md → 深切分（unrec: id，永不冲突）
  const covered = collectCoveredFiles(config, root);
  const all = walkMdFiles(root, config.junkDirs);
  // 未识别池忽略规则 = 默认规则 + 项目规则（追加合并，项目 config 可补充但不会丢掉默认防护）
  const ignoreList = [...(DEFAULT_CONFIG.ignoreUnrecognized || []), ...(config.ignoreUnrecognized || [])]
    .map(x => String(x).toLowerCase());
  for (const f of all) {
    if (covered.has(normalizeRel(f))) continue;
    if (/(示例|模板|说明|readme|index|_meta|\.bak$)/i.test(f)) continue;
    const lf = f.toLowerCase();
    if (ignoreList.some(x => x && lf.includes(x))) continue;
    try {
      const text = fs.readFileSync(path.join(root, f), 'utf8');
      const { fm, blocks } = deepSplitFile(f, text);
      const lines = text.split('\n');
      for (const b of blocks) {
        const content = lines.slice(b.startLine - 1, b.endLine).join('\n');
        const firstLine = content.split('\n').find(l => l.trim() && !l.trim().startsWith('#')) || '';
        nodes.push({
          id: b.id,
          file: normalizeRel(f),
          type: fm.type || 'unrecognized',
          label: fm.label || '未识别',
          title: b.title,
          content,
          startLine: b.startLine,
          endLine: b.endLine,
          desc: firstLine.trim().slice(0, 100),
          unrecognized: true,
          recognizedBy: 'unrecognized',
          parentLevel: b.level,
          chapter: fm.chapter ? chapterNumberFromTitle(String(fm.chapter), f) : chapterNumberFromTitle(b.title, f),
          level: fm.level !== undefined && fm.level !== '' ? String(fm.level) : null,
          lane: fm.lane || null,
        });
      }
    } catch (_) {}
  }

  // 层2 front matter：对已识别节点也可覆盖 type/label/chapter/level/lane
  const fmByFile = new Map();
  for (const n of nodes) {
    if (n.unrecognized) continue;
    if (!fmByFile.has(n.file)) fmByFile.set(n.file, fileFrontMatter(n.file, root));
    const fm = fmByFile.get(n.file);
    if (!fm || !Object.keys(fm).length) continue;
    if (fm.type && fm.label === undefined) fm.label = typeToLabel(fm.type);
    if (fm.type) n.type = fm.type;
    if (fm.label) n.label = fm.label;
    if (fm.chapter !== undefined && fm.chapter !== '') n.chapter = chapterNumberFromTitle(String(fm.chapter), n.file);
    if (fm.level !== undefined && fm.level !== '') n.level = String(fm.level);
    if (fm.lane) n.lane = fm.lane;
    if (fm.title) n.title = fm.title;
    n.recognizedBy = 'frontmatter';
  }

  // 层4 人工纠正 overrides（从布局文件读取，最终生效）
  const layout = loadLayout(root);
  const overrides = layout.overrides || {};
  for (const n of nodes) {
    const ov = overrides[n.id];
    if (!ov) continue;
    if (ov.type) n.type = ov.type;
    if (ov.label) n.label = ov.label;
    if (ov.title) n.title = ov.title;
    if (ov.chapter !== undefined && ov.chapter !== null && ov.chapter !== '') n.chapter = Number(ov.chapter);
    if (ov.level !== undefined && ov.level !== null && ov.level !== '') n.level = String(ov.level);
    if (ov.lane) n.lane = ov.lane;
    n.recognizedBy = 'manual';
    // 人工指定为非未识别类型 → 脱离未识别池（灰色移除）
    if (ov.type && ov.type !== 'unrecognized') n.unrecognized = false;
  }

  return nodes;
}

function loadLayout(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root || ROOT, '小说画布.json'), 'utf8'));
  } catch (_) {
    return { nodes: {} };
  }
}

function saveLayout(layout, root) {
  fs.writeFileSync(path.join(root || ROOT, '小说画布.json'), JSON.stringify(layout, null, 2), 'utf8');
}

function defaultPositions(nodes) {
  const catIndex = {};
  const pos = {};
  const colFor = { role: 40, faction: 340, setting: 650, foreshadow: 960, volume: 1280 };
  for (const n of nodes) {
    const i = catIndex[n.type] || 0;
    catIndex[n.type] = i + 1;
    const col = colFor[n.type] ?? 40;
    const row = i * 180;
    pos[n.id] = { x: col, y: row };
  }
  return pos;
}

function sendJson(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function isSafePath(p, root) {
  const base = path.resolve(root || ROOT);
  const full = path.resolve(base, p);
  return full.startsWith(base + path.sep);
}

function isMdPath(p) {
  return typeof p === 'string' && p.toLowerCase().endsWith('.md');
}

function listMdFiles(root) {
  const EXCLUDE_DIR = /^(\.|\.git|\.obsidian|node_modules|release|_edge_smoke_test|\.trash|\.tmp)$/;
  function walk(dir, rel) {
    const children = [];
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return children;
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
    for (const e of entries) {
      if (e.name.startsWith('.') && !rel) continue;
      if (e.isDirectory() && EXCLUDE_DIR.test(e.name)) continue;
      const full = path.join(dir, e.name);
      const relPath = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        const sub = walk(full, relPath);
        if (sub.length) children.push({ name: e.name, path: relPath, type: 'dir', children: sub });
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        children.push({ name: e.name, path: relPath, type: 'file' });
      }
    }
    return children;
  }
  return walk(root, '');
}

function readFileText(root, relPath) {
  const full = path.resolve(root, relPath);
  if (!isSafePath(relPath, root) || !isMdPath(relPath) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw new Error('unsafe or invalid file path');
  }
  return fs.readFileSync(full, 'utf8');
}

// ── 一致性防漂移引擎（人物卡封包 + 多维审查）────────────────
const CONSISTENCY_DIMENSIONS = [
  '人物性格一致', '时间线一致', '伏笔状态一致', '设定事实一致', '称谓一致',
  '因果逻辑一致', '角色弧光一致', '地点场景一致', '能力物品一致', '大纲章节一致',
  '情绪氛围一致', '语言风格一致'
];
const CONSISTENCY_HARD_RULES = [
  '不违背已明确的设定事实',
  '不改变人物已确立的关系与性格',
  '不提前或遗忘伏笔状态',
  '不产生前后矛盾的时间线',
  '不丢失上一章的钩子与因果'
];

function parseJsonFromAI(text) {
  let s = String(text || '').trim();
  s = s.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

function extractChapterCore(content) {
  const text = String(content || '');
  const patterns = [
    /<!--\s*(?:章节核心|本章核心|章节目标|本章目标)\s*[:：]\s*([\s\S]*?)-->/i,
    /^>\s*[【\[]?(?:本章|章节)?(?:核心|目标)[】\]]?\s*[:：]\s*(.+)$/im,
    /^[【\[]?(?:本章|章节)?(?:核心|目标)[】\]]?\s*[:：]\s*(.+)$/im,
    /^##\s*(?:本章|章节)?(?:核心|目标)\s*\n\s*([^\n#]+)/im
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1] && m[1].trim()) return m[1].trim().replace(/\s+/g, ' ').slice(0, 500);
  }
  return '';
}

function applyChapterCore(content, core) {
  const text = String(content || '');
  const coreText = String(core || '').trim();
  const re = /<!--\s*(?:章节核心|本章核心|章节目标|本章目标)\s*[:：]\s*[\s\S]*?-->\s*/i;
  if (coreText) {
    const comment = '<!-- 章节核心：' + coreText + ' -->';
    if (re.test(text)) return text.replace(re, comment + '\n\n');
    const nl = text.indexOf('\n');
    const insertAt = nl >= 0 ? nl + 1 : 0;
    return text.slice(0, insertAt) + '\n' + comment + '\n' + text.slice(insertAt);
  }
  return text.replace(re, '');
}

function chapterCoreList(root) {
  return buildNodes(root)
    .filter(n => n.label === '章节')
    .map(n => ({
      nodeId: n.id,
      title: n.title,
      file: n.file,
      volume: volumeKeyOfNode(n),
      core: extractChapterCore(n.content)
    }));
}

function foreshadowStatusOf(node) {
  if (!node || node.label !== '伏笔') return '';
  const cells = String(node.content || '').split('|').map(s => s.trim()).filter(Boolean);
  return cells.length >= 5 ? cells[4] : '';
}

function volumeKeyOfNode(node) {
  if (!node || !node.file) return '';
  return path.posix.dirname(node.file);
}

function buildConsistencyPackage(root, targetId, fullEntities) {
  const nodes = buildNodes(root);
  const target = targetId ? nodes.find(n => n.id === targetId) : null;
  const targetText = ((target ? target.content || '' : '') + ' ' + (target ? target.title || '' : '')).toLowerCase();
  const targetVolumeKey = target ? volumeKeyOfNode(target) : '';
  const targetCore = target ? extractChapterCore(target.content) : '';
  const targetCoreLower = targetCore.toLowerCase();
  const volumeName = targetVolumeKey ? path.posix.basename(targetVolumeKey) : '';
  const weightFor = (n) => {
    let w = 0.3;
    if (n.label === '角色') w = 1.0;
    if (n.label === '设定') w = 0.85;
    if (n.label === '伏笔') w = 0.9;
    if (n.label === '大纲' || n.label === '卷' || n.type === 'volume') w = 1.0;
    if (n.label === '章节' && n.id !== targetId) w = 0.5;
    const title = (n.title || '').toLowerCase();
    const content = (n.content || '').toLowerCase();
    if (targetText && (targetText.includes(title) || (title && content && targetText.includes(title)))) w += 0.6;
    // 卷感知：同一卷内的角色/设定/伏笔/上下文优先参与
    if (targetVolumeKey) {
      const nVol = volumeKeyOfNode(n);
      if (nVol === targetVolumeKey) w += 0.5;
      else if (nVol && (nVol.startsWith(targetVolumeKey + '/') || targetVolumeKey.startsWith(nVol + '/'))) w += 0.3;
      if (volumeName && (n.title || '').includes(volumeName)) w += 0.4;
    }
    // 章节核心命中：核心词直接命中时加权
    if (targetCoreLower && (title.includes(targetCoreLower) || content.includes(targetCoreLower))) w += 0.3;
    // 伏笔状态动态权重：未回收的活跃伏笔更重要
    if (n.label === '伏笔') {
      const st = foreshadowStatusOf(n);
      if (st === '已埋' || st === '计划回收' || st === '待回收') w += 0.3;
      if (st === '已回收') w -= 0.2;
    }
    return Math.min(Math.max(w, 0.1), 2.0);
  };
  const weighted = nodes
    .filter(n => n.id !== targetId)
    .map(n => ({ n, w: weightFor(n) }))
    .sort((a, b) => b.w - a.w);
  const maxChars = fullEntities ? 24000 : 12000;
  const parts = [];
  if (target) {
    const header = `【当前审查对象】${target.label}：${target.title}（id: ${target.id}）\n【所属卷】${targetVolumeKey || '（未分组）'}\n`
      + (targetCore ? `【章节核心】${targetCore}\n` : '')
      + String(target.content || '').slice(0, 6000);
    parts.push(header);
  }
  const pushGroup = (title, arr, full) => {
    if (!arr.length) return;
    let buf = `\n【${title}】\n`;
    for (const { n, w } of arr) {
      const text = (full ? (n.content || n.desc || '') : (n.desc || n.content || ''))
        .replace(/\s+/g, ' ').trim().slice(0, full ? 6000 : (w > 1 ? 600 : 300));
      buf += `- [权重${w.toFixed(2)}] ${n.title}（id: ${n.id}）：${text}\n`;
      if (parts.join('').length + buf.length > maxChars) break;
    }
    parts.push(buf);
  };
  pushGroup(fullEntities ? '角色卡（完整内容）' : '角色卡', weighted.filter(x => x.n.label === '角色'), fullEntities);
  pushGroup(fullEntities ? '伏笔状态（完整内容）' : '伏笔状态', weighted.filter(x => x.n.label === '伏笔'), fullEntities);
  pushGroup('设定', weighted.filter(x => x.n.label === '设定'), false);
  pushGroup('大纲与卷', weighted.filter(x => x.n.label === '大纲' || x.n.label === '卷' || x.n.type === 'volume'), false);
  pushGroup('近期章节', weighted.filter(x => x.n.label === '章节').slice(0, 3), false);
  const packageText = parts.join('\n').slice(0, maxChars);
  return {
    targetId: target ? target.id : null,
    targetTitle: target ? target.title : '',
    targetVolume: targetVolumeKey,
    targetCore,
    packageText,
    stats: {
      totalNodes: nodes.length,
      roles: nodes.filter(n => n.label === '角色').length,
      foreshadows: nodes.filter(n => n.label === '伏笔').length,
      settings: nodes.filter(n => n.label === '设定').length,
      chapters: nodes.filter(n => n.label === '章节').length
    },
    weights: weighted.slice(0, 20).map(x => ({ id: x.n.id, title: x.n.title, label: x.n.label, weight: Math.round(x.w * 100) }))
  };
}

async function auditConsistency(root, project, targetId, content) {
  const nodes = buildNodes(root);
  const targetNode = targetId ? nodes.find(n => n.id === targetId) : null;
  const chapterText = typeof content === 'string' && content.trim()
    ? content.trim()
    : (targetNode ? (targetNode.content || '').trim() : '');
  if (!chapterText) throw new Error('没有可审查的正文，请先选择一个章节节点或粘贴内容');
  const pkg = buildConsistencyPackage(root, targetId);
  const api = getApiConfig();
  if (!api) throw new Error('AI 对话未配置：请设置 DEEPSEEK_API_KEY 后重启服务');
  const sys = '你是长篇网文一致性审查引擎。你会收到项目资料封包和一章待审查正文。请严格对照封包检查这一章是否与既有设定、人物、伏笔、时间线、因果、风格一致。必须只输出 JSON，不要 Markdown 围栏，不要解释。JSON 结构：{"overall":0-100,"dimensions":{"' + CONSISTENCY_DIMENSIONS.join('":0-100,"') + '":0-100},"hardRules":[{"name":"...","pass":true/false}],"issues":["..."],"suggestions":["..."]}。hardRules 必须覆盖这些硬条件：' + CONSISTENCY_HARD_RULES.join('；') + '。';
  const userMsg = '【项目资料封包】\n' + pkg.packageText + '\n\n【待审查章节】\n' + chapterText.slice(0, 8000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const r = await fetch(api.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.apiKey },
      body: JSON.stringify({ model: api.model, messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userMsg }
      ], stream: false }),
      signal: controller.signal
    });
    const data = await r.json();
    recordUsage(api.model, data.usage);
    const reply = data?.choices?.[0]?.message?.content || '';
    const parsed = parseJsonFromAI(reply);
    if (!parsed) throw new Error('AI 审查返回格式无法解析：' + String(reply).slice(0, 200));
    return { ok: true, ...parsed, packageStats: pkg.stats, weights: pkg.weights, targetTitle: targetNode ? targetNode.title : '', targetVolume: pkg.targetVolume, targetCore: pkg.targetCore };
  } finally {
    clearTimeout(timer);
  }
}

async function fixConsistency(root, project, targetId, content, issues, suggestions) {
  const nodes = buildNodes(root);
  const targetNode = targetId ? nodes.find(n => n.id === targetId) : null;
  const original = typeof content === 'string' && content.trim()
    ? content.trim()
    : (targetNode ? (targetNode.content || '').trim() : '');
  if (!original) throw new Error('没有可修正的正文');
  const pkg = buildConsistencyPackage(root, targetId);
  const api = getApiConfig();
  if (!api) throw new Error('AI 对话未配置：请设置 DEEPSEEK_API_KEY 后重启服务');
  const sys = '你是长篇网文一致性修正编辑。你会收到项目资料封包、待修正原文和审查问题清单。请只输出修正后的完整章节正文：保留所有没问题的内容，只修改问题点，不解释、不输出 Markdown 围栏、不改变文风、叙事视角和人称，不新增与封包冲突的设定。';
  const issueText = [].concat(Array.isArray(issues) ? issues : [], Array.isArray(suggestions) ? suggestions : []).join('\n');
  const userMsg = '【项目资料封包】\n' + pkg.packageText + '\n\n【待修正原文】\n' + original.slice(0, 8000) + '\n\n【需要修正的问题】\n' + (issueText || '（未提供具体问题，请自行对照封包检查并修正）');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const r = await fetch(api.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.apiKey },
      body: JSON.stringify({ model: api.model, messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userMsg }
      ], stream: false }),
      signal: controller.signal
    });
    const data = await r.json();
    recordUsage(api.model, data.usage);
    const reply = data?.choices?.[0]?.message?.content || '';
    if (!reply.trim()) throw new Error('AI 修正未返回内容');
    return { ok: true, content: reply.trim() };
  } finally {
    clearTimeout(timer);
  }
}

async function advanceConsistency(root, project, targetId, content) {
  const nodes = buildNodes(root);
  const targetNode = targetId ? nodes.find(n => n.id === targetId) : null;
  const chapterText = typeof content === 'string' && content.trim()
    ? content.trim()
    : (targetNode ? (targetNode.content || '').trim() : '');
  if (!chapterText) throw new Error('没有可分析推进的章节正文');
  const pkg = buildConsistencyPackage(root, targetId, true);
  const api = getApiConfig();
  if (!api) throw new Error('AI 对话未配置：请设置 DEEPSEEK_API_KEY 后重启服务');
  const sys = '你是长篇网文的人物卡/伏笔状态推进引擎。你会收到项目资料封包和本章正文。请根据本章实际发生的事，识别哪些人物卡、伏笔状态需要推进（新增信息、关系变化、状态从已埋变为待回收/已回收等）。只输出 JSON，不要 Markdown 围栏，不要解释。JSON 结构：{"summary":"一句话总结","cardUpdates":[{"id":"节点id","title":"人物卡标题","newContent":"更新后的完整人物卡内容"}],"foreshadowUpdates":[{"id":"节点id","title":"伏笔标题","newContent":"更新后的完整伏笔内容"}]}。id 必须从封包中已有节点里找（封包每行有 id: xxx）；newContent 必须是该卡片的完整新内容，不能只给改动片段；如果某张卡不需要更新就完全不要出现在数组里。';
  const userMsg = '【项目资料封包】\n' + pkg.packageText + '\n\n【本章正文】\n' + chapterText.slice(0, 8000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const r = await fetch(api.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.apiKey },
      body: JSON.stringify({ model: api.model, messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userMsg }
      ], stream: false }),
      signal: controller.signal
    });
    const data = await r.json();
    recordUsage(api.model, data.usage);
    const reply = data?.choices?.[0]?.message?.content || '';
    const parsed = parseJsonFromAI(reply);
    if (!parsed) throw new Error('AI 推进结果无法解析：' + String(reply).slice(0, 200));
    const created = [];
    const allUpdates = []
      .concat(Array.isArray(parsed.cardUpdates) ? parsed.cardUpdates : [])
      .concat(Array.isArray(parsed.foreshadowUpdates) ? parsed.foreshadowUpdates : []);
    for (const u of allUpdates) {
      let node = typeof u.id === 'string' ? nodes.find(n => n.id === u.id) : null;
      if (!node && typeof u.title === 'string') node = nodes.find(n => n.title === u.title);
      if (!node || (node.label !== '角色' && node.label !== '伏笔')) continue;
      if (typeof u.newContent !== 'string' || !u.newContent.trim()) continue;
      if (String(node.content || '') === u.newContent) continue;
      const proposalId = 'p' + (proposalSeq++);
      created.push(proposalSet({
        id: proposalId,
        kind: 'edit',
        nodeId: node.id,
        file: node.file,
        title: node.title,
        oldContent: node.content || '',
        newContent: u.newContent.trim(),
        root,
        project: projectNameOfRoot(root)
      }));
    }
    const summary = parsed.summary || (created.length ? '已生成人物卡/伏笔状态更新提案。' : '本章没有检测到需要推进的人物卡或伏笔状态。');
    return { ok: true, reply: summary, proposals: created };
  } finally {
    clearTimeout(timer);
  }
}

async function polishConsistency(root, project, targetId, content, threshold, maxAttempts) {
  const thresholdNum = Number.isFinite(Number(threshold)) ? Math.max(0, Math.min(100, Number(threshold))) : 95;
  const attemptsNum = Number.isFinite(Number(maxAttempts)) ? Math.max(1, Math.min(3, Math.floor(Number(maxAttempts)))) : 2;
  const nodes = buildNodes(root);
  const targetNode = targetId ? nodes.find(n => n.id === targetId) : null;
  let current = typeof content === 'string' && content.trim() ? content.trim() : '';
  if (!current && targetNode) current = (targetNode.content || '').trim();
  if (!current) throw new Error('没有可精修的正文');
  const attempts = [];
  let finalOverall = 0;
  let finalHardPass = false;
  for (let i = 0; i < attemptsNum; i++) {
    const audit = await auditConsistency(root, project, targetId, current);
    const overall = Number(audit.overall || 0);
    const hardRules = Array.isArray(audit.hardRules) ? audit.hardRules : [];
    const hardPass = !hardRules.some(r => r.pass === false);
    attempts.push({
      round: i + 1,
      overall,
      hardPass,
      issues: Array.isArray(audit.issues) ? audit.issues.length : 0,
      targetVolume: audit.targetVolume || '',
      targetCore: audit.targetCore || ''
    });
    finalOverall = overall;
    finalHardPass = hardPass;
    if (overall >= thresholdNum && hardPass) break;
    if (i === attemptsNum - 1) break;
    const fix = await fixConsistency(root, project, targetId, current, audit.issues, audit.suggestions);
    current = fix.content;
  }
  return {
    ok: true,
    content: current,
    threshold: thresholdNum,
    attempts,
    finalOverall,
    finalHardPass,
    reached: finalOverall >= thresholdNum && finalHardPass
  };
}

async function writeNextChapter(root, project, targetId, content, instruction) {
  const nodes = buildNodes(root);
  const targetNode = targetId ? nodes.find(n => n.id === targetId) : null;
  const currentText = typeof content === 'string' && content.trim()
    ? content.trim()
    : (targetNode ? targetNode.content || '' : '');
  if (!currentText) throw new Error('生成下一章需要先点击上一章节点，或在输入框粘贴上一章结尾');
  const pkg = buildConsistencyPackage(root, targetId, true);
  const api = getApiConfig();
  if (!api) throw new Error('AI 对话未配置：请设置 DEEPSEEK_API_KEY 后重启服务');
  const sys = '你是长篇网文作者，负责在长篇连载中生成下一章。你会收到项目资料封包和上一章正文。要求：严格遵守封包中的设定、人物、伏笔、时间线；优先服从当前卷大纲和章节核心；延续上一章结尾的剧情；新章节 2500-3000 字；结尾必须留钩子；不解释、不输出 Markdown 代码围栏；直接输出完整新章节 Markdown，首行用 "# 章节标题"。';
  const userMsg = '【项目资料封包】\n' + pkg.packageText + '\n\n【上一章正文】\n' + currentText.slice(-6000) + '\n\n【额外要求】\n' + (instruction ? String(instruction).trim() : '无');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  try {
    const r = await fetch(api.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.apiKey },
      body: JSON.stringify({ model: api.model, messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userMsg }
      ], max_tokens: 5000, stream: false }),
      signal: controller.signal
    });
    const data = await r.json();
    recordUsage(api.model, data.usage);
    let reply = (data?.choices?.[0]?.message?.content || data?.error?.message || '').trim();
    if (!reply) throw new Error('模型未返回内容');
    const fence = reply.match(/^```[\w-]*\n([\s\S]*?)\n```$/);
    if (fence) reply = fence[1].trim();
    let title = '';
    const m = reply.match(/^#\s+(.+)$/m);
    if (m) title = m[1].trim();
    if (!title) {
      title = '第' + nextChapterNumber(findChapterVolumeDir(root)) + '章';
      reply = '# ' + title + '\n\n' + reply;
    }
    return { ok: true, title, content: reply.trim() };
  } finally {
    clearTimeout(timer);
  }
}

function auditStatsDir() {
  return path.join(ROOT, '.data', 'audit-history');
}
function auditStatsFile(project) {
  const safe = String(project || 'default').replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
  return path.join(auditStatsDir(), safe + '.json');
}
function loadAuditStats(project) {
  try {
    return JSON.parse(fs.readFileSync(auditStatsFile(project), 'utf8'));
  } catch (_) {
    return { audits: [] };
  }
}
function saveAuditStats(project, stats) {
  try {
    fs.mkdirSync(auditStatsDir(), { recursive: true });
    fs.writeFileSync(auditStatsFile(project), JSON.stringify(stats, null, 2), 'utf8');
  } catch (_) {}
}
function recordAudit(root, project, result, nodeId) {
  try {
    const stats = loadAuditStats(project);
    const nodes = buildNodes(root);
    const node = nodeId ? nodes.find(n => n.id === nodeId) : null;
    const record = {
      id: Date.now() + '-' + stats.audits.length,
      timestamp: new Date().toISOString(),
      nodeId: nodeId || '',
      title: node ? node.title : (result.targetTitle || ''),
      volume: result.targetVolume || (node ? volumeKeyOfNode(node) : ''),
      core: result.targetCore || '',
      overall: Number(result.overall || 0),
      hardPass: !(Array.isArray(result.hardRules) && result.hardRules.some(r => r.pass === false)),
      issues: Array.isArray(result.issues) ? result.issues.length : 0
    };
    stats.audits.push(record);
    if (stats.audits.length > 200) stats.audits = stats.audits.slice(-200);
    saveAuditStats(project, stats);
  } catch (_) {}
}
function summarizeAuditStats(root, project) {
  const stats = loadAuditStats(project);
  const audits = stats.audits || [];
  const chapters = buildNodes(root).filter(n => n.label === '章节');
  const totalWords = chapters.reduce((s, n) => s + (n.content || '').length, 0);
  const volMap = {};
  for (const a of audits) {
    const vol = a.volume || '未分卷';
    if (!volMap[vol]) volMap[vol] = { count: 0, sum: 0, driftCount: 0 };
    volMap[vol].count++;
    volMap[vol].sum += Number(a.overall || 0);
    if (Number(a.overall || 0) < 95) volMap[vol].driftCount++;
  }
  const byVolume = Object.entries(volMap).map(([volume, v]) => ({
    volume,
    count: v.count,
    avg: v.count ? Math.round((v.sum / v.count) * 10) / 10 : 0,
    driftCount: v.driftCount
  }));
  const driftAudits = audits.filter(a => Number(a.overall || 0) < 95);
  return {
    totalAudits: audits.length,
    avgOverall: audits.length ? Math.round((audits.reduce((s, a) => s + Number(a.overall || 0), 0) / audits.length) * 10) / 10 : 0,
    hardFailCount: audits.filter(a => !a.hardPass).length,
    driftCount: driftAudits.length,
    driftRate: audits.length ? Math.round((driftAudits.length / audits.length) * 10000) / 100 : 0,
    chapterCount: chapters.length,
    totalWords,
    avgWordsPerChapter: chapters.length ? Math.round(totalWords / chapters.length) : 0,
    latest: audits.slice(-20).reverse(),
    byVolume
  };
}

// ── AI 配置（设置面板可编辑，存 .data/ai-config.json） ──
function aiConfigFile() {
  return path.join(ROOT, '.data', 'ai-config.json');
}
function loadAiConfig() {
  try { return JSON.parse(fs.readFileSync(aiConfigFile(), 'utf8')); } catch (_) { return null; }
}
function saveAiConfig(cfg) {
  fs.mkdirSync(path.dirname(aiConfigFile()), { recursive: true });
  fs.writeFileSync(aiConfigFile(), JSON.stringify(cfg, null, 2), 'utf8');
}
function maskApiKey(k) {
  if (!k) return '';
  if (k.length <= 8) return k.slice(0, 2) + '***';
  return k.slice(0, 6) + '…' + k.slice(-4);
}
function aiConfigSource() {
  const saved = loadAiConfig();
  if (saved && saved.apiKey && saved.base) return 'saved';
  if (process.env.DEEPSEEK_API_KEY) return 'env';
  return 'inkpilot';
}

function getApiConfig() {
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  // 优先：设置面板保存的配置（用户可随时在 UI 改）
  const saved = loadAiConfig();
  if (saved && saved.apiKey && saved.base) {
    return { apiKey: saved.apiKey, base: saved.base, model: saved.model || model };
  }
  if (process.env.DEEPSEEK_API_KEY) {
    return { apiKey: process.env.DEEPSEEK_API_KEY, base: process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com/v1', model };
  }
  const candidates = [];
  if (process.env.INKPILOT_CONFIG) candidates.push(process.env.INKPILOT_CONFIG);
  try {
    for (const name of fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const p = path.join(PROJECTS_ROOT, name.name, '.obsidian', 'plugins', 'inkpilot', 'data.json');
      if (fs.existsSync(p)) candidates.push(p);
    }
  } catch (_) {}
  for (const inkPath of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(inkPath, 'utf8'));
      if (data.apiKey) {
        return {
          apiKey: data.apiKey,
          base: (data.customApiBase || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
          model: data.model || model
        };
      }
    } catch (_) {}
  }
  return null;
}

// ── 自动备份 / 回滚（快照目录 .data/backups/{ts}-{seq}/{project}/…） ──
function backupDir() { return path.join(ROOT, '.data', 'backups'); }
function safeProjectName(project) {
  return String(project || 'default').replace(/[^\w\u4e00-\u9fa5-]+/g, '_') || 'default';
}
function snapshotFiles(root, project, rels, reason) {
  try {
    if (!Array.isArray(rels) || rels.length === 0) return null;
    const ts = Date.now();
    const seq = Math.floor(Math.random() * 100000); // 同毫秒防冲突
    const proj = safeProjectName(project || projectNameOfRoot(root));
    const snapRoot = path.join(backupDir(), ts + '-' + seq);
    const snapDir = path.join(snapRoot, proj);
    const files = [];
    for (const rel of rels) {
      const full = path.resolve(root, rel);
      if (!isSafePath(rel, root) || !fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
      const dest = path.join(snapDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(full, dest);
      files.push({ rel, size: fs.statSync(full).size });
    }
    if (!files.length) { try { fs.rmSync(snapRoot, { recursive: true, force: true }); } catch (_) {} return null; }
    const manifest = { ts, seq, reason: String(reason || '修改'), project: project || projectNameOfRoot(root), files };
    fs.writeFileSync(path.join(snapRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    pruneBackups();
    return manifest;
  } catch (_) { return null; }
}
const lastLayoutSnapshot = {};
function snapshotLayoutThrottled(root, project) {
  // 布局保存频繁，快照节流到每分钟一次，避免刷屏
  const key = String(project || projectNameOfRoot(root));
  const now = Date.now();
  if (lastLayoutSnapshot[key] && now - lastLayoutSnapshot[key] < 60000) return null;
  lastLayoutSnapshot[key] = now;
  return snapshotFiles(root, project, ['小说画布.json'], '布局');
}
function listBackups(project) {
  const out = [];
  const base = backupDir();
  let entries = [];
  try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(base, e.name);
    let m = null;
    try { m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch (_) { continue; }
    if (!m || typeof m.ts !== 'number') continue;
    if (project && m.project && m.project !== project) continue;
    const files = Array.isArray(m.files) ? m.files : [];
    out.push({
      ts: m.ts,
      time: new Date(m.ts).toLocaleString('zh-CN', { hour12: false }),
      reason: m.reason || '',
      project: m.project || '',
      n: files.length,
      files: files.map(f => ({ rel: f.rel, size: Number(f.size) || 0 }))
    });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}
function pruneBackups() {
  try {
    const list = listBackups();
    if (list.length <= 100) return; // 保留最新 100 个
    const keep = new Set(list.slice(0, 100).map(b => String(b.ts)));
    const base = backupDir();
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const dir = path.join(base, e.name);
      try {
        const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
        if (m && typeof m.ts === 'number' && !keep.has(String(m.ts))) fs.rmSync(dir, { recursive: true, force: true });
      } catch (_) {}
    }
  } catch (_) {}
}
function restoreBackup(ts, project) {
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) throw new Error('无效的快照时间戳');
  const base = backupDir();
  let found = null;
  try {
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const dir = path.join(base, e.name);
      let m = null;
      try { m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch (_) { continue; }
      if (m && Number(m.ts) === tsNum && (!project || !m.project || m.project === project)) { found = { dir, m }; break; }
    }
  } catch (_) {}
  if (!found) throw new Error('快照不存在：' + ts);
  const root = resolveProjectRoot(found.m.project || project || defaultProjectName());
  const proj = safeProjectName(found.m.project || projectNameOfRoot(root));
  const restored = [];
  for (const f of (Array.isArray(found.m.files) ? found.m.files : [])) {
    const rel = f.rel;
    if (!isSafePath(rel, root)) continue;
    const src = path.join(found.dir, proj, rel);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    const current = fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : null;
    const snap = fs.readFileSync(src, 'utf8');
    if (current === snap) continue; // 幂等：内容相同跳过
    snapshotFiles(root, found.m.project || projectNameOfRoot(root), [rel], '恢复前保护'); // 防误恢复
    writeText(rel, snap, root);
    restored.push(rel);
  }
  pruneBackups();
  return restored;
}

// ── 用量统计（.data/usage.json） ──
function usageFile() { return path.join(ROOT, '.data', 'usage.json'); }
function loadUsage() {
  try {
    const u = JSON.parse(fs.readFileSync(usageFile(), 'utf8'));
    return { byDay: u.byDay || {}, byModel: u.byModel || {}, byChat: Array.isArray(u.byChat) ? u.byChat : [] };
  } catch (_) {
    return { byDay: {}, byModel: {}, byChat: [] };
  }
}
function saveUsage(u) {
  try {
    fs.mkdirSync(path.dirname(usageFile()), { recursive: true });
    fs.writeFileSync(usageFile(), JSON.stringify(u, null, 2), 'utf8');
  } catch (_) {}
}
function usageDayKey(ts) {
  const d = new Date(ts || Date.now());
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function recordUsage(model, usage) {
  try {
    if (!usage) return;
    const prompt = Number(usage.prompt_tokens != null ? usage.prompt_tokens : usage.prompt) || 0;
    const completion = Number(usage.completion_tokens != null ? usage.completion_tokens : usage.completion) || 0;
    const total = Number(usage.total_tokens != null ? usage.total_tokens : usage.total) || (prompt + completion);
    const u = loadUsage();
    const key = usageDayKey(Date.now());
    const day = u.byDay[key] = u.byDay[key] || { prompt: 0, completion: 0, total: 0, calls: 0 };
    day.prompt += prompt; day.completion += completion; day.total += total; day.calls++;
    const mkey = String(model || 'unknown');
    const m = u.byModel[mkey] = u.byModel[mkey] || { prompt: 0, completion: 0, total: 0, calls: 0 };
    m.prompt += prompt; m.completion += completion; m.total += total; m.calls++;
    u.byChat.push({ ts: Date.now(), model: mkey, prompt, completion, total });
    if (u.byChat.length > 50) u.byChat = u.byChat.slice(-50); // byChat 只留最近 50 条
    saveUsage(u);
  } catch (_) {}
}
function summarizeUsage() {
  const u = loadUsage();
  const today = u.byDay[usageDayKey(Date.now())] || { prompt: 0, completion: 0, total: 0, calls: 0 };
  const total = { prompt: 0, completion: 0, total: 0, calls: 0 };
  for (const k of Object.keys(u.byDay)) {
    const d = u.byDay[k];
    total.prompt += d.prompt || 0; total.completion += d.completion || 0; total.total += d.total || 0; total.calls += d.calls || 0;
  }
  const byDay = [];
  for (let i = 29; i >= 0; i--) {
    const d = u.byDay[usageDayKey(Date.now() - i * 86400000)] || { prompt: 0, completion: 0, total: 0, calls: 0 };
    byDay.push({ day: usageDayKey(Date.now() - i * 86400000), ...d });
  }
  // 可选费用估算：ai-config.json 支持 pricePerM { "模型名": { "in": x, "out": y } }（每百万 token 美元）
  let cost = null;
  try {
    const cfg = loadAiConfig();
    if (cfg && cfg.pricePerM && typeof cfg.pricePerM === 'object') {
      cost = { total: 0, byModel: {} };
      for (const [model, price] of Object.entries(cfg.pricePerM)) {
        const m = u.byModel[model];
        if (!m) continue;
        const c = (Number(price.in) || 0) * (m.prompt || 0) / 1e6 + (Number(price.out) || 0) * (m.completion || 0) / 1e6;
        cost.byModel[model] = Math.round(c * 10000) / 10000;
        cost.total += c;
      }
      cost.total = Math.round(cost.total * 10000) / 10000;
    }
  } catch (_) {}
  return { ok: true, today, total, byModel: u.byModel, byDay, recent: u.byChat.slice(-50).reverse(), cost };
}

// ── 全书健康度统计 ──
function buildBookStats(root) {
  const nodes = buildNodes(root);
  const chapters = nodes.filter(n => n.label === '章节');
  const totalWords = chapters.reduce((s, n) => s + (n.content || '').length, 0);
  const chapterCount = chapters.length;
  const avgWordsPerChapter = chapterCount ? Math.round(totalWords / chapterCount) : 0;
  // 按文件路径倒数第二段取卷名（与前端 volumeKeyOf 一致）
  const volMap = {};
  for (const c of chapters) {
    const parts = String(c.file || '').split(/[\\/]/);
    const vol = parts.length > 1 ? parts[parts.length - 2] : '未分卷';
    if (!volMap[vol]) volMap[vol] = { volume: vol, chapters: 0, words: 0 };
    volMap[vol].chapters++;
    volMap[vol].words += (c.content || '').length;
  }
  const byVolume = Object.values(volMap)
    .map(v => ({ ...v, avg: v.chapters ? Math.round(v.words / v.chapters) : 0 }))
    .sort((a, b) => a.volume.localeCompare(b.volume, 'zh'));
  // 大纲完成度：大纲类节点中 desc/内容非空的比例
  const outlineNodes = nodes.filter(n => n.label === '大纲' || (n.type === 'volume' && /大纲/.test(String(n.file || ''))));
  const outlineFilled = outlineNodes.filter(n => String(n.desc || '').trim() || String(n.content || '').trim()).length;
  const outline = {
    total: outlineNodes.length,
    filled: outlineFilled,
    rate: outlineNodes.length ? Math.round((outlineFilled / outlineNodes.length) * 100) : 0
  };
  // 伏笔回收率：状态列含"已回收"计 recovered，其余计 planted
  const foreshadowNodes = nodes.filter(n => n.label === '伏笔');
  let fsRecovered = 0;
  for (const n of foreshadowNodes) if (foreshadowStatusOf(n) === '已回收') fsRecovered++;
  const foreshadow = {
    total: foreshadowNodes.length,
    planted: foreshadowNodes.length - fsRecovered,
    recovered: fsRecovered,
    rate: foreshadowNodes.length ? Math.round((fsRecovered / foreshadowNodes.length) * 100) : 0
  };
  // 分类统计
  const categories = {};
  for (const n of nodes) categories[n.label] = (categories[n.label] || 0) + 1;
  return { totalWords, chapterCount, avgWordsPerChapter, byVolume, outline, foreshadow, categories };
}

// ── 时间线 ───────────────────────────────────────────────
// 时间线改为作者手动维护的重要节点（存于布局文件 timelineNodes，见 /api/timeline）。
// 旧版自动抽取「第N天 / 年月日」已移除：长篇剧情动辄跨越百年，按时间标记无法准确表达。

function listSkills(root) {
  const BLOCKED_SKILLS = new Set(['oh-we-need']);
  const roots = [
    path.join(root || ROOT, '.agents', 'skills'),
    path.join(PROJECTS_ROOT, '.agents', 'skills')
  ];
  const out = [];
  for (const dir of roots) {
    if (!fs.existsSync(dir)) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      const isDir = e.isDirectory();
      const skillFile = isDir
        ? path.join(dir, e.name, 'SKILL.md')
        : (e.name.endsWith('.md') ? path.join(dir, e.name) : null);
      if (!skillFile || !fs.existsSync(skillFile)) continue;
      const name = isDir ? e.name : e.name.replace(/\.md$/, '');
      if (BLOCKED_SKILLS.has(name)) continue;
      let desc = '';
      try {
        const text = fs.readFileSync(skillFile, 'utf8');
        const m = text.match(/^description:\s*(.+)$/m);
        desc = m ? m[1].trim().slice(0, 200) : '';
      } catch (_) {}
      out.push({ name, desc });
    }
  }
  return out;
}

// ── 结构化项目上下文（给 agent 的系统提示注入） ──────────────────────
function buildAgentContext(root) {
  const nodes = buildNodes(root);
  const parts = [];
  const push = (tag, text) => { if (text && text.trim()) parts.push('【' + tag + '】\n' + text.trim()); };
  const flat = n => (n.content || '').replace(/\s+/g, ' ').trim();

  const outlines = nodes.filter(n => n.label === '大纲');
  push('全书大纲', outlines.map(n => '- ' + n.title + '：' + flat(n).slice(0, 800)).join('\n'));

  const rules = nodes.filter(n => n.label === '写作规范');
  push('写作规范', rules.map(n => '- ' + n.title + '：' + flat(n).slice(0, 600)).join('\n'));

  const roles = nodes.filter(n => n.label === '角色');
  push('角色档案', roles.map(n => '- ' + n.title + '：' + flat(n).slice(0, 500)).join('\n'));

  const factions = nodes.filter(n => n.label === '势力');
  push('势力', factions.map(n => '- ' + n.title + '：' + flat(n).slice(0, 300)).join('\n'));

  const settings = nodes.filter(n => n.label === '设定');
  push('设定', settings.map(n => '- ' + n.title + '：' + flat(n).slice(0, 200)).join('\n'));

  const foreshadows = nodes.filter(n => n.label === '伏笔');
  push('伏笔清单', foreshadows.map(n => '- ' + n.title + '：' + flat(n).slice(0, 200)).join('\n'));

  const ctxNodes = nodes.filter(n => n.label === '上下文');
  push('上下文/进度', ctxNodes.map(n => '- ' + n.title + '：' + flat(n).slice(0, 300)).join('\n'));

  // 章节总览（按卷分组）
  const chapters = nodes.filter(n => n.label === '章节');
  const volMap = {};
  for (const c of chapters) {
    const vol = c.id.split(':')[1] || '未分卷';
    (volMap[vol] = volMap[vol] || []).push(c);
  }
  const chapterList = Object.keys(volMap).map(vol =>
    '『' + vol + '』(' + volMap[vol].length + '章)\n' + volMap[vol].map(c => '- ' + c.title).join('\n')
  ).join('\n');
  push('章节总览', chapterList);

  // 最近 3 章全文（按文件名排序取最后 3 个，供续写参考）
  const sortedChapters = chapters.slice().sort((a, b) => (a.file || '').localeCompare(b.file || ''));
  const recent = sortedChapters.slice(-3);
  push('最近章节（全文，供续写参考）', recent.map(c => '──《' + c.title + '》──\n' + (c.content || '').slice(0, 4000)).join('\n\n'));

  // 画布连线
  try {
    const layout = loadLayout(root);
    const links = layout.customLinks || [];
    if (links.length) push('画布节点连线', links.map(l => Array.isArray(l) ? l.join(' ↔ ') : String(l)).join('\n'));
  } catch (_) {}

  // 未识别内容（agent 感知：这些内容未被任何规则覆盖，可帮助用户归类）
  const unrec = nodes.filter(n => n.unrecognized);
  if (unrec.length) {
    const byFile = {};
    for (const n of unrec) (byFile[n.file] = byFile[n.file] || []).push(n.title);
    push('未识别内容（未覆盖，可建议归类；用 edit_node 改类型前先询问用户）',
      Object.keys(byFile).map(f => '- ' + f + '（' + byFile[f].length + ' 段）：' + byFile[f].slice(0, 6).join(' / ')).join('\n'));
  }

  let text = parts.join('\n\n');
  if (text.length > 30000) text = text.slice(0, 30000) + '\n\n（上下文过长，已截断。需要完整内容请用 read_node / read_file 工具读取。）';
  return text;
}

// 汇总一次工具调用的结果（供前端展示“AI 做了什么”）
function summarizeAgentResult(tool, args, result) {
  if (!result || result.error) return '失败: ' + (result.error || '未知错误');
  if (tool === 'read_node') return '读取节点《' + (result.title || args.id || '') + '》(' + (result.chars || 0) + '字)';
  if (tool === 'read_file') return '读取文件 ' + (args.path || '');
  if (tool === 'search') return '搜索「' + (args.query || '') + '」找到 ' + (result.count || 0) + ' 处';
  if (tool === 'list_nodes') return '列出节点 ' + (result.count || 0) + ' 个';
  if (tool === 'get_context') return '获取项目上下文';
  if (tool === 'move_node') return '移动节点到 (' + (args.x ?? '') + ',' + (args.y ?? '') + ')';
  if (tool === 'create_link') return '建立连线 ' + (args.a || '') + ' ↔ ' + (args.b || '');
  if (tool === 'remove_link') return '移除连线 ' + (args.a || '') + ' ↔ ' + (args.b || '');
  if (tool === 'edit_node') return '提案: 修改《' + (result.title || args.id || '') + '》';
  if (tool === 'create_node') return '提案: 新建《' + (result.title || args.title || '') + '》';
  if (tool === 'delete_node') return '提案: 删除《' + (result.title || args.id || '') + '》';
  return tool + ' 完成';
}

const AGENT_TOOLS = [
  { type: 'function', function: { name: 'read_node', description: '读取画布中某个节点的完整内容（章节/角色/设定/伏笔等）。查证任何节点内容都应先用它，不要凭上下文里的摘要编造。', parameters: { type: 'object', properties: { id: { type: 'string', description: '节点 id，如 chapter:正文:第一卷:第01章:第1章-xxx 或 role:莫余' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'read_file', description: '读取项目内任意 Markdown/文本文件的完整内容（相对项目根路径）。', parameters: { type: 'object', properties: { path: { type: 'string', description: '相对路径，如 设定/角色/莫余.md 或 大纲/第一卷大纲.md' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'search', description: '在项目全部节点（标题+内容）和 Markdown 文件中搜索关键词，返回匹配位置与片段。用于查证某角色/伏笔/设定出现在哪里。', parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词（一个词或短句）' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'list_nodes', description: '列出项目全部节点清单（按类型分组），含每节点 id、标题、字数。想了解项目全貌时用。type 可选过滤：角色/势力/设定/伏笔/章节/大纲/上下文/未识别（未识别=未被规则覆盖的内容）。', parameters: { type: 'object', properties: { type: { type: 'string', description: '可选过滤：角色/势力/设定/伏笔/章节/大纲/上下文/未识别' } } } } },
  { type: 'function', function: { name: 'get_context', description: '重新获取项目结构化上下文（大纲/角色/设定/伏笔/最近章节等）。当你需要确认项目全局状态时调用。', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'edit_node', description: '修改画布中某个节点的完整 Markdown 内容。生成提案，用户批准后才写盘。', parameters: { type: 'object', properties: { id: { type: 'string', description: '节点 id' }, content: { type: 'string', description: '该节点新的完整 Markdown 内容' } }, required: ['id', 'content'] } } },
  { type: 'function', function: { name: 'create_node', description: '在项目中新建一个节点（角色/势力/设定/伏笔/卷），生成提案，用户批准后写盘。', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['role', 'faction', 'setting', 'foreshadow', 'volume'], description: '节点类型' }, title: { type: 'string', description: '标题' }, desc: { type: 'string', description: '简介/内容，可空' } }, required: ['type', 'title'] } } },
  { type: 'function', function: { name: 'delete_node', description: '删除画布中的某个节点。生成提案，用户批准后写盘。', parameters: { type: 'object', properties: { id: { type: 'string', description: '节点 id' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'move_node', description: '移动画布中某个节点/板块到指定坐标（画布世界坐标）。立即生效并保存到布局文件。', parameters: { type: 'object', properties: { id: { type: 'string', description: '节点 id' }, x: { type: 'number', description: '目标 x' }, y: { type: 'number', description: '目标 y' } }, required: ['id', 'x', 'y'] } } },
  { type: 'function', function: { name: 'create_link', description: '在画布上为两个节点建立手动连线。立即生效并保存。', parameters: { type: 'object', properties: { a: { type: 'string', description: '节点 id A' }, b: { type: 'string', description: '节点 id B' } }, required: ['a', 'b'] } } },
  { type: 'function', function: { name: 'remove_link', description: '移除画布上两个节点之间的手动连线。立即生效并保存。', parameters: { type: 'object', properties: { a: { type: 'string', description: '节点 id A' }, b: { type: 'string', description: '节点 id B' } }, required: ['a', 'b'] } } }
];

async function runAgentTool(name, args, root) {
  try {
    const id = 'p' + (proposalSeq++);
    if (name === 'read_node') {
      const nodes = buildNodes(root);
      const node = nodes.find(n => n.id === args.id);
      if (!node) return { error: 'node not found: ' + args.id + '（可用 list_nodes 查看全部节点 id）' };
      return { title: node.title, label: node.label, file: node.file, chars: (node.content || '').length, content: node.content || '' };
    }
    if (name === 'read_file') {
      const rel = String(args.path || '');
      if (!isSafePath(rel, root) || !/\.(md|txt)$/i.test(rel)) return { error: 'unsafe or invalid file path: ' + rel };
      const full = path.resolve(root, rel);
      if (!fs.existsSync(full)) return { error: 'file not found: ' + rel };
      const content = fs.readFileSync(full, 'utf8');
      return { path: rel, chars: content.length, content: content.slice(0, 20000) };
    }
    if (name === 'search') {
      const q = String(args.query || '').trim();
      if (!q) return { error: 'empty query' };
      const nodes = buildNodes(root);
      const hits = [];
      for (const n of nodes) {
        const hay = ((n.title || '') + '\n' + (n.content || '')).replace(/\s+/g, ' ');
        let idx = -1, found = 0;
        while ((idx = hay.indexOf(q, idx + 1)) !== -1 && found < 5) {
          const start = Math.max(0, idx - 60);
          hits.push({ where: '节点《' + n.title + '》(' + n.label + ')', id: n.id, snippet: hay.slice(start, idx + q.length + 60) });
          found++;
        }
        if (hits.length >= 60) break;
      }
      return { count: hits.length, hits };
    }
    if (name === 'list_nodes') {
      const nodes = buildNodes(root);
      const filter = args.type ? String(args.type) : null;
      const list = nodes
        .filter(n => !filter || n.label === filter || (filter === '未识别' && n.unrecognized))
        .map(n => ({ id: n.id, title: n.title, label: n.label, chars: (n.content || '').length, unrecognized: !!n.unrecognized }));
      const byLabel = {};
      for (const n of list) (byLabel[n.label] = byLabel[n.label] || []).push(n);
      return { count: list.length, groups: byLabel, unrecognizedCount: nodes.filter(n => n.unrecognized).length };
    }
    if (name === 'get_context') {
      return { context: buildAgentContext(root) };
    }
    if (name === 'edit_node') {
      const nodes = buildNodes(root);
      const node = nodes.find(n => n.id === args.id);
      if (!node) return { error: 'node not found: ' + args.id };
      const oldContent = node.content || '';
      const newContent = String(args.content || '');
      proposalSet({ id, kind: 'edit', nodeId: node.id, file: node.file, title: node.title, oldContent, newContent, root, project: projectNameOfRoot(root) });
      return { proposal_id: id, action: 'edit', file: node.file, title: node.title };
    }
    if (name === 'create_node') {
      const def = findDefByType(args.type);
      const block = def.table
        ? `| NEW-${Date.now().toString().slice(-6)} | ${args.title} | 待定 | 待定 | 已埋 | ${args.desc || ''} |\n`
        : `\n## ${args.title}\n\n${args.desc || ''}\n`;
      proposalSet({ id, kind: 'create', file: def.file, title: args.title, oldContent: '', newContent: block, type: args.type, desc: args.desc || '', root, project: projectNameOfRoot(root) });
      return { proposal_id: id, action: 'create', file: def.file, title: args.title };
    }
    if (name === 'delete_node') {
      const nodes = buildNodes(root);
      const node = nodes.find(n => n.id === args.id);
      if (!node) return { error: 'node not found: ' + args.id };
      proposalSet({ id, kind: 'delete', file: node.file, title: node.title, oldContent: node.content || '', newContent: '', root, project: projectNameOfRoot(root) });
      return { proposal_id: id, action: 'delete', file: node.file, title: node.title };
    }
    if (name === 'move_node') {
      const layout = loadLayout(root);
      const pos = layout.nodes || (layout.positions || {});
      if (typeof args.x !== 'number' || typeof args.y !== 'number') return { error: 'x/y must be numbers' };
      pos[args.id] = { x: args.x, y: args.y };
      layout.nodes = pos;
      saveLayout(layout, root);
      return { moved: args.id, x: args.x, y: args.y };
    }
    if (name === 'create_link' || name === 'remove_link') {
      const layout = loadLayout(root);
      const links = Array.isArray(layout.customLinks) ? layout.customLinks : [];
      const nodes = buildNodes(root);
      const a = String(args.a || ''), b = String(args.b || '');
      if (!nodes.some(n => n.id === a) || !nodes.some(n => n.id === b)) return { error: 'node not found (a/b)' };
      const key = (x, y) => (x < y ? x + '\u0000' + y : y + '\u0000' + x);
      if (name === 'create_link') {
        if (!links.some(l => Array.isArray(l) && key(l[0], l[1]) === key(a, b))) links.push([a, b]);
      } else {
        const i = links.findIndex(l => Array.isArray(l) && key(l[0], l[1]) === key(a, b));
        if (i !== -1) links.splice(i, 1);
      }
      layout.customLinks = links;
      saveLayout(layout, root);
      return { ok: true, a, b };
    }
    return { error: 'unknown tool ' + name };
  } catch (e) {
    return { error: e.message };
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/agent/tools' && req.method === 'GET') {
    return sendJson(res, { ok: true, tools: AGENT_TOOLS.map(t => t.function.name) });
  }

  // ── AI 设置：读取/保存/测试 ──
  if (pathname === '/api/settings' && req.method === 'GET') {
    const saved = loadAiConfig();
    const api = getApiConfig();
    const source = api ? aiConfigSource() : 'none';
    return sendJson(res, {
      ok: true,
      ai: {
        base: api ? api.base : (saved && saved.base) || '',
        model: api ? api.model : (saved && saved.model) || '',
        hasKey: !!(api && api.apiKey),
        keyHint: api && api.apiKey ? maskApiKey(api.apiKey) : '',
        source
      }
    });
  }
  if (pathname === '/api/settings' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const base = String(body.base || '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(base)) return sendJson(res, { error: 'API 地址必须以 http:// 或 https:// 开头' });
      const saved = loadAiConfig() || {};
      const key = String(body.key || '').trim();
      const model = String(body.model || '').trim();
      saveAiConfig({
        base,
        key: key || saved.key || '',
        model: model || saved.model || 'deepseek-chat'
      });
      const effectiveKey = key || saved.key || '';
      return sendJson(res, {
        ok: true,
        ai: { base, model: model || saved.model || 'deepseek-chat', hasKey: !!effectiveKey, keyHint: maskApiKey(effectiveKey), source: 'saved' }
      });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/settings/test' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const base = String(body.base || '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(base)) return sendJson(res, { error: 'API 地址必须以 http:// 或 https:// 开头' });
      const key = String(body.key || '').trim() || (loadAiConfig() || {}).key || process.env.DEEPSEEK_API_KEY || '';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const r = await fetch(base + '/models', { headers: { Authorization: 'Bearer ' + key }, signal: controller.signal });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          const msg = (data.error && (data.error.message || data.error)) || ('HTTP ' + r.status + ' ' + r.statusText);
          return sendJson(res, { error: 'HTTP ' + r.status + ': ' + String(msg).slice(0, 200) });
        }
        const ids = (data.data || []).map(m => m && m.id).filter(Boolean);
        return sendJson(res, { ok: true, models: ids, count: ids.length });
      } catch (e) {
        return sendJson(res, { error: e.message });
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  // ── 回滚 / 备份 ──
  if (pathname === '/api/backups' && req.method === 'GET') {
    try {
      const project = url.searchParams.get('project') || '';
      return sendJson(res, { ok: true, list: listBackups(project) });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/backups/restore' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const restored = restoreBackup(body.ts, body.project || '');
      return sendJson(res, { ok: true, restored });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  // ── 用量统计 ──
  if (pathname === '/api/usage' && req.method === 'GET') {
    return sendJson(res, summarizeUsage());
  }

  // ── 全书健康度看板 ──
  if (pathname === '/api/bookstats' && req.method === 'GET') {
    try {
      const project = url.searchParams.get('project') || defaultProjectName();
      const root = resolveProjectRoot(project);
      return sendJson(res, { ok: true, ...buildBookStats(root) });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  // ── 时间线（作者手动维护的重要节点，按章节排序） ──
  if (pathname === '/api/timeline' && req.method === 'GET') {
    try {
      const project = url.searchParams.get('project') || defaultProjectName();
      const root = resolveProjectRoot(project);
      const layout = loadLayout(root);
      const nodes = Array.isArray(layout.timelineNodes) ? layout.timelineNodes : [];
      const sorted = [...nodes].sort((a, b) => (Number(a.chapter) || 0) - (Number(b.chapter) || 0) || String(a.id).localeCompare(String(b.id)));
      return sendJson(res, { ok: true, events: sorted });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  if (pathname === '/api/projects' && req.method === 'GET') {
    const projects = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .filter(name => {
        const dir = path.join(PROJECTS_ROOT, name);
        return fs.existsSync(path.join(dir, '设定.md'))
            || fs.existsSync(path.join(dir, '大纲.md'))
            || fs.existsSync(path.join(dir, '追踪'))
            || fs.existsSync(path.join(dir, 'CLAUDE.md'))
            || fs.existsSync(path.join(dir, 'novel'))
            || fs.existsSync(path.join(dir, '第一卷'))
            || fs.existsSync(path.join(dir, '写作规范.md'));
      })
      .sort();
    return sendJson(res, { projects, current: defaultProjectName() });
  }

  if (pathname === '/api/data' && req.method === 'GET') {
    const project = url.searchParams.get('project') || defaultProjectName();
    const root = resolveProjectRoot(project);
    const nodes = buildNodes(root);
    const layout = loadLayout(root);
    const positions = layout.nodes || {};
    const missing = {};
    for (const n of nodes) if (!positions[n.id]) missing[n.id] = true;
    if (Object.keys(missing).length) {
      Object.assign(positions, defaultPositions(nodes));
      saveLayout({ ...layout, nodes: positions }, root);
    }
    const config = loadProjectConfig(root);
    return sendJson(res, {
      project,
      nodes,
      config: {
        axis: config.axis || DEFAULT_CONFIG.axis,
        mode: layout.mode || 'axis',
      },
      layout: {
        nodes: positions,
        customLinks: layout.customLinks || [],
        version: layout.version || 0,
        mode: layout.mode || 'axis',
        axis: layout.axis || {},
        axisProgress: layout.axisProgress || {},
        axisBandMode: layout.axisBandMode || '',
        axisBands: layout.axisBands || [],
        axisSegSize: layout.axisSegSize || 0,
        axisY: layout.axisY || null,
        overrides: layout.overrides || {},
        timelineNodes: (layout.timelineNodes || []).map(n => ({ id: String(n.id), title: String(n.title || ''), chapter: n.chapter != null ? Number(n.chapter) : null, note: String(n.note || '') })),
        unrecognized: (layout.unrecognized || []).map(String),
      },
    });
  }

  if (pathname === '/api/save' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const { id, content, project } = body;
      if (typeof id !== 'string' || typeof content !== 'string') {
        return sendJson(res, { error: 'bad request' });
      }
      const root = resolveProjectRoot(project || defaultProjectName());
      const nodes = buildNodes(root);
      const node = nodes.find(n => n.id === id);
      if (!node) return sendJson(res, { error: 'node not found' });
      const file = node.file;
      if (!isSafePath(file, root)) return sendJson(res, { error: 'unsafe path' });
      const lines = readText(file, root).split('\n');
      const newLines = content.split('\n');
      lines.splice(node.startLine - 1, node.endLine - node.startLine + 1, ...newLines);
      writeText(file, lines.join('\n'), root);
      const rebuilt = buildNodes(root).find(n => n.id === id) || { ...node, content };
      return sendJson(res, { ok: true, node: rebuilt });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  if (pathname === '/api/chapters/cores' && req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const project = url.searchParams.get('project') || defaultProjectName();
      const root = resolveProjectRoot(project);
      return sendJson(res, { ok: true, chapters: chapterCoreList(root) });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/chapters/cores' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const project = body.project || defaultProjectName();
      const root = resolveProjectRoot(project);
      const items = Array.isArray(body.items) ? body.items : [];
      const nodes = buildNodes(root);
      const updated = [];
      const skipped = [];
      for (const it of items) {
        if (!it || typeof it.nodeId !== 'string') continue;
        const node = nodes.find(n => n.id === it.nodeId);
        if (!node || node.label !== '章节') {
          skipped.push({ nodeId: it.nodeId, reason: 'not found or not a chapter' });
          continue;
        }
        if (!isSafePath(node.file, root)) {
          skipped.push({ nodeId: it.nodeId, reason: 'unsafe path' });
          continue;
        }
        const newContent = applyChapterCore(node.content, it.core);
        if (newContent === String(node.content || '')) {
          skipped.push({ nodeId: it.nodeId, reason: 'unchanged' });
          continue;
        }
        const lines = readText(node.file, root).split('\n');
        lines.splice(node.startLine - 1, node.endLine - node.startLine + 1, ...newContent.split('\n'));
        writeText(node.file, lines.join('\n'), root);
        updated.push({ nodeId: it.nodeId, title: node.title, core: extractChapterCore(newContent) });
      }
      return sendJson(res, { ok: true, updated, skipped, total: items.length });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  if (pathname === '/api/proposals' && req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const project = url.searchParams.get('project') || defaultProjectName();
      const list = [...proposals.values()].filter(p => !p.project || p.project === project);
      return sendJson(res, { ok: true, proposals: list });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  if (pathname === '/api/propose_node_edit' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const { id, content, project } = body;
      if (typeof id !== 'string' || typeof content !== 'string') {
        return sendJson(res, { error: 'bad request' });
      }
      const root = resolveProjectRoot(project || defaultProjectName());
      const nodes = buildNodes(root);
      const node = nodes.find(n => n.id === id);
      if (!node) return sendJson(res, { error: 'node not found' });
      const proposalId = 'p' + (proposalSeq++);
      const proposal = proposalSet({
        id: proposalId,
        kind: 'edit',
        nodeId: node.id,
        file: node.file,
        title: node.title,
        oldContent: node.content || '',
        newContent: String(content || ''),
        root,
        project: projectNameOfRoot(root)
      });
      return sendJson(res, { ok: true, proposal });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  if (pathname === '/api/node' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const { type, title, desc, project } = body;
      if (typeof type !== 'string' || typeof title !== 'string' || !title.trim()) {
        return sendJson(res, { error: 'bad request' });
      }
      const root = resolveProjectRoot(project || defaultProjectName());
      appendSection(type, title.trim(), typeof desc === 'string' ? desc.trim() : '', root);
      const rebuilt = buildNodes(root);
      return sendJson(res, { ok: true, nodes: rebuilt });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  if (pathname === '/api/delete' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const { id, project } = body;
      if (typeof id !== 'string') return sendJson(res, { error: 'bad request' });
      const root = resolveProjectRoot(project || defaultProjectName());
      const node = buildNodes(root).find(n => n.id === id);
      if (!node) return sendJson(res, { error: 'node not found' });
      deleteSegment(node, root);
      return sendJson(res, { ok: true, nodes: buildNodes(root) });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  if (pathname === '/api/apply_proposal' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const prop = proposals.get(body.id);
      if (!prop) return sendJson(res, { error: 'proposal not found' });
      const root = prop.root || resolveProjectRoot(body.project || defaultProjectName());
      if (prop.kind === 'edit') {
        const nodes = buildNodes(root);
        const node = nodes.find(n => n.id === prop.nodeId);
        if (!node) return sendJson(res, { error: 'node not found for edit' });
        const lines = readText(node.file, root).split('\n');
        lines.splice(node.startLine - 1, node.endLine - node.startLine + 1, ...String(prop.newContent || '').split('\n'));
        snapshotFiles(root, prop.project || projectNameOfRoot(root), [node.file], 'AI 修改');
        writeText(node.file, lines.join('\n'), root);
        proposalDelete(body.id);
        return sendJson(res, { ok: true, nodes: buildNodes(root) });
      }
      if (prop.kind === 'create') {
        const def = findDefByType(prop.type);
        snapshotFiles(root, prop.project || projectNameOfRoot(root), [def.file], 'AI 修改');
        appendSection(prop.type, prop.title, prop.desc, root);
        proposalDelete(body.id);
        return sendJson(res, { ok: true, nodes: buildNodes(root) });
      }
      if (prop.kind === 'delete') {
        const nodes = buildNodes(root);
        const node = nodes.find(n => n.content === prop.oldContent && n.file === prop.file);
        if (!node) return sendJson(res, { error: 'node not found for delete' });
        snapshotFiles(root, prop.project || projectNameOfRoot(root), [node.file], 'AI 修改');
        deleteSegment(node, root);
        proposalDelete(body.id);
        return sendJson(res, { ok: true, nodes: buildNodes(root) });
      }
      if (prop.kind === 'file_edit') {
        if (!isSafePath(prop.file, root) || !isMdPath(prop.file)) return sendJson(res, { error: 'unsafe file path' });
        snapshotFiles(root, prop.project || projectNameOfRoot(root), [prop.file], 'AI 修改');
        writeText(prop.file, String(prop.newContent || ''), root);
        proposalDelete(body.id);
        return sendJson(res, { ok: true });
      }
      return sendJson(res, { error: 'unknown proposal kind' });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  if (pathname === '/api/skills' && req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const project = url.searchParams.get('project') || undefined;
      const root = resolveProjectRoot(project);
      return sendJson(res, { skills: listSkills(root) });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/consistency/package' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const pkg = buildConsistencyPackage(root, typeof body.nodeId === 'string' ? body.nodeId : null);
      return sendJson(res, { ok: true, ...pkg });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/consistency/audit' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const result = await auditConsistency(root, body.project || defaultProjectName(), typeof body.nodeId === 'string' ? body.nodeId : null, body.content);
      recordAudit(root, body.project || defaultProjectName(), result, typeof body.nodeId === 'string' ? body.nodeId : null);
      return sendJson(res, result);
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/stats' && req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const project = url.searchParams.get('project') || defaultProjectName();
      const root = resolveProjectRoot(project);
      return sendJson(res, summarizeAuditStats(root, project));
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/stats/clear' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const project = body.project || defaultProjectName();
      saveAuditStats(project, { audits: [] });
      return sendJson(res, { ok: true });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/volumes' && req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const project = url.searchParams.get('project') || defaultProjectName();
      const root = resolveProjectRoot(project);
      return sendJson(res, { ok: true, volumes: listVolumes(root) });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/volumes' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const result = createVolume(root, body.name);
      return sendJson(res, result);
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/volumes/rename' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const result = renameVolume(root, body.rel, body.name);
      return sendJson(res, result);
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/volumes/delete' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const result = deleteVolume(root, body.rel);
      return sendJson(res, result);
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/volumes/outline' && req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const project = url.searchParams.get('project') || defaultProjectName();
      const rel = url.searchParams.get('rel') || '';
      const root = resolveProjectRoot(project);
      const result = openVolumeOutline(root, rel);
      return sendJson(res, result);
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/volumes/outline' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const result = createVolumeOutline(root, body.rel);
      return sendJson(res, result);
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/consistency/fix' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const result = await fixConsistency(root, body.project || defaultProjectName(), typeof body.nodeId === 'string' ? body.nodeId : null, body.content, body.issues, body.suggestions);
      return sendJson(res, result);
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/consistency/advance' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const result = await advanceConsistency(root, body.project || defaultProjectName(), typeof body.nodeId === 'string' ? body.nodeId : null, body.content);
      return sendJson(res, result);
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/consistency/polish' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const result = await polishConsistency(
        root,
        body.project || defaultProjectName(),
        typeof body.nodeId === 'string' ? body.nodeId : null,
        body.content,
        body.threshold,
        body.maxAttempts
      );
      return sendJson(res, result);
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/chat' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const messages = Array.isArray(body.messages) ? body.messages : [];
        // 滑动窗口：服务端强制只保留最近 20 条消息，避免历史无限累积
        const recentMessages = messages.slice(-20);
      const root = resolveProjectRoot(body.project || defaultProjectName());
        const contextText = buildAgentContext(root);
          const requestedSkills = Array.isArray(body.skills) ? body.skills : null;
          const allSkills = listSkills(root);
          const skillList = requestedSkills && requestedSkills.length
            ? allSkills.filter(s => requestedSkills.includes(s.name))
            : allSkills;
          const skills = skillList.map(s => '- ' + s.name + (s.desc ? '：' + s.desc : '')).join('\n');
        const agentMode = String(body.agentMode || '');
        const agentInstructions = {
          plot: '你现在是剧情军师。不要直接写完整正文。请基于项目资料给出 3-5 个下一章冲突方案，每个方案必须包含：可见伤害或麻烦、主角被迫的具体动作、结尾钩子。用简短分条输出。',
          deslop: '你现在是去AI味编辑。用户会提供需要修改的正文（可能来自当前选中的章节或粘贴内容）。请直接输出去AI味后的正文，不要解释、不要 Markdown 围栏。规则：删解释总结、删光滑排比和“不是…是…”套路、把“告诉情绪”改成动作短句，保留剧情信息和原有人名地名。',
          foresight: '你现在是伏笔审计员。请检查项目里所有伏笔：列出已埋、计划回收、可能已经该回收但没回收、以及相互矛盾的伏笔条目，并给出建议回收章节。简洁分条。',
          consistency: '你现在是设定一致性检查员。请结合大纲、设定、角色、上下文，列出设定冲突、时间线矛盾、角色状态不一致的问题。每条给出位置和修改建议。简洁分条。'
        };
        const agentSuffix = agentInstructions[agentMode] ? '\n\n【本次任务】\n' + agentInstructions[agentMode] : '';
        const toolHint = '\n\n你有工具可用：read_node / read_file / search / list_nodes / get_context 用于查证项目内容（不要凭摘要编造）；move_node / create_link / remove_link 直接操作画布；edit_node / create_node / delete_node 会生成提案（需要用户批准后才生效）。当用户要求查证、修改、分析具体内容时，先调用相应工具再回答。';
        const payloadMessages = [
          { role: 'system', content: `你是小说创作助手，正在协助创作《${body.project || path.basename(root)}》。请结合下面的项目资料和可用技能回答或写作。\n\n项目资料：\n${contextText}\n\n可用技能：\n${skills || '（无）'}${agentSuffix}${toolHint}` },
          ...recentMessages
        ];
const api = getApiConfig();
      if (!api) {
        return sendJson(res, {
          reply: '（AI 对话未配置）请在启动 server.js 前设置环境变量 DEEPSEEK_API_KEY，我才能真正和你对话。当前已收到你的消息和节点引用。'
        });
      }
      const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120000);
        const model = (typeof body.model === 'string' && body.model.trim()) ? body.model : api.model;
        // deepseek-reasoner 不支持函数调用：切纯文本推理
        const useTools = model !== 'deepseek-reasoner';
        let currentMessages = payloadMessages;
        const createdProposals = [];
        const steps = [];
        const chatUsage = { prompt: 0, completion: 0, total: 0 };
        try {
          for (let round = 0; round < 10; round++) {
            const payload = { model, messages: currentMessages, stream: false };
            if (useTools) { payload.tools = AGENT_TOOLS; payload.tool_choice = 'auto'; }
            const r = await fetch(api.base + '/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.apiKey },
              body: JSON.stringify(payload),
              signal: controller.signal
            });
            const data = await r.json();
            recordUsage(model, data.usage);
            if (data.usage) {
              const u = data.usage;
              chatUsage.prompt += Number(u.prompt_tokens != null ? u.prompt_tokens : u.prompt) || 0;
              chatUsage.completion += Number(u.completion_tokens != null ? u.completion_tokens : u.completion) || 0;
              chatUsage.total += Number(u.total_tokens != null ? u.total_tokens : u.total) || 0;
            }
            const msg = data?.choices?.[0]?.message;
            if (!msg) {
              return sendJson(res, { reply: data?.error?.message || '（模型未返回内容）', usage: chatUsage });
            }
            if (useTools && msg.tool_calls && msg.tool_calls.length) {
              currentMessages.push(msg);
              for (const tc of msg.tool_calls) {
                let args = {};
                try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
                const result = await runAgentTool(tc.function.name, args, root);
                  steps.push({ tool: tc.function.name, args, summary: summarizeAgentResult(tc.function.name, args, result) });
                  if (result && result.proposal_id && proposals.has(result.proposal_id)) {
                    createdProposals.push(proposals.get(result.proposal_id));
                  }
                currentMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
              }
              continue;
            }
            return sendJson(res, { reply: msg.content || '（完成）', proposals: createdProposals, steps, usage: chatUsage });
          }
          return sendJson(res, { reply: '（工具调用次数过多，已停止）', proposals: createdProposals, steps, usage: chatUsage });
        } finally {
          clearTimeout(timer);
        }
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  if (pathname === '/api/continue' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const { id, project, instruction } = body;
      if (typeof id !== 'string') return sendJson(res, { error: 'bad request' });
      const root = resolveProjectRoot(project || defaultProjectName());
      const node = buildNodes(root).find(n => n.id === id);
      if (!node) return sendJson(res, { error: 'node not found' });
      const api = getApiConfig();
      if (!api) {
        return sendJson(res, { error: 'AI 对话未配置：请设置 DEEPSEEK_API_KEY 环境变量后重启服务。' });
      }
      const content = String(node.content || '').trim();
      const instructionText = String(instruction || '请自然地续写下一段，保持文风和当前剧情节奏。');
      const sys = '你是长篇网文作者，正在续写小说《' + (body.project || path.basename(root)) + '》的章节。请直接输出续写的正文内容，不要解释、不要复述原文、不要输出 Markdown 标题，保持与原文一致的叙事视角、人称、语气和节奏。';
      const userMsg = '【当前章节内容】\n' + content + '\n\n【续写要求】\n' + instructionText;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90000);
      try {
        const r = await fetch(api.base + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.apiKey },
          body: JSON.stringify({ model: api.model, messages: [
            { role: 'system', content: sys },
            { role: 'user', content: userMsg }
          ], stream: false }),
          signal: controller.signal
        });
        const data = await r.json();
        recordUsage(api.model, data.usage);
        const reply = data?.choices?.[0]?.message?.content || data?.error?.message || '（模型未返回内容）';
        return sendJson(res, { reply: reply.trim() });
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/ai/edit' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const rel = String(body.path || '');
      if (!isSafePath(rel, root) || !isMdPath(rel)) return sendJson(res, { error: 'unsafe or invalid file path' });
      const full = path.resolve(root, rel);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return sendJson(res, { error: 'file not found' });
      const api = getApiConfig();
      if (!api) {
        return sendJson(res, { error: 'AI 对话未配置：请设置 DEEPSEEK_API_KEY 环境变量后重启服务。' });
      }
      const current = typeof body.content === 'string' ? body.content : fs.readFileSync(full, 'utf8');
      const mode = body.mode === 'continue' ? 'continue' : 'edit';
      const instruction = String(body.instruction || (mode === 'continue'
        ? '请自然地续写下一段，保持文风和当前剧情节奏。'
        : '请根据要求修改这个文件。'));
      const sys = mode === 'continue'
        ? '你是长篇网文作者。用户会给你一个 Markdown 文件。请直接输出续写后的完整文件内容：保留原有内容，并在末尾自然续写。不要解释、不要复述原文、不要输出 Markdown 代码围栏。'
        : '你是小说创作助手。用户会给你一个 Markdown 文件和修改要求。请直接输出修改后的完整文件内容：保留未修改部分，只改动需要改的地方。不要解释、不要输出 Markdown 代码围栏。';
      const userMsg = '【文件路径】' + rel + '\n\n【当前文件内容】\n' + current + '\n\n【修改要求】\n' + instruction;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120000);
      try {
        const r = await fetch(api.base + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.apiKey },
          body: JSON.stringify({ model: api.model, messages: [
            { role: 'system', content: sys },
            { role: 'user', content: userMsg }
          ], stream: false }),
          signal: controller.signal
        });
        const data = await r.json();
        recordUsage(api.model, data.usage);
        const reply = (data?.choices?.[0]?.message?.content || data?.error?.message || '').trim();
        if (!reply) return sendJson(res, { error: '模型未返回内容' });
        let newContent = reply;
        const fence = newContent.match(/^```[\w-]*\n([\s\S]*?)\n```$/);
        if (fence) newContent = fence[1].trim();
        const id = 'p' + (proposalSeq++);
        const proposal = proposalSet({ id, kind: 'file_edit', file: rel, title: rel, oldContent: current, newContent, root, project: projectNameOfRoot(root) });
        return sendJson(res, {
          ok: true,
          reply,
          proposal: { id, kind: 'file_edit', file: rel, title: rel, oldContent: current, newContent }
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  if (pathname === '/api/chapter/write' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const result = await writeNextChapter(
        root,
        body.project || defaultProjectName(),
        typeof body.nodeId === 'string' ? body.nodeId : null,
        body.content,
        body.instruction
      );
      return sendJson(res, result);
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/chapter' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const title = String(body.title || '').trim();
      if (!title) return sendJson(res, { error: '章节标题不能为空' });
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const volumeDir = findChapterVolumeDir(root);
      const fileName = makeChapterFileName(volumeDir, title);
      const file = path.join(volumeDir, fileName);
      if (fs.existsSync(file)) return sendJson(res, { error: '同名章节已存在' });
      fs.writeFileSync(file, '# ' + title + '\n\n', 'utf8');
      const relFile = path.relative(root, file).split(path.sep).join('/');
      const node = parseFileAsNode('chapter:' + relFile.replace(/\.md$/, '').replace(/[\\/]+/g, ':'), relFile, 'volume', '章节', root);
      return sendJson(res, { ok: true, node: { id: node.id, title: node.title.replace(/_/g, ' '), file: node.file } });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  if (pathname === '/api/rename' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const title = String(body.title || '').trim();
      if (!title) return sendJson(res, { error: '标题不能为空' });
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const node = buildNodes(root).find(n => n.id === body.id);
      if (!node) return sendJson(res, { error: '节点不存在' });
      const text = fs.readFileSync(path.join(root, node.file), 'utf8');
      const lines = text.split('\n');
      let changed = false;
      // 节点标题行 = 节点自身的 startLine（1 基），直接改那一行的标题
      const lineIdx = (node.startLine || 1) - 1;
      if (lineIdx >= 0 && lineIdx < lines.length && /^#{1,6}\s/.test(lines[lineIdx])) {
        const hashes = (lines[lineIdx].match(/^#+/) || [''])[0];
        lines[lineIdx] = hashes + ' ' + title;
        changed = true;
      } else {
        // 兜底：找第一个 `# `，再找第一个 `## `
        let idx = -1;
        for (let i = 0; i < lines.length; i++) {
          if (/^#\s/.test(lines[i])) { idx = i; break; }
        }
        if (idx < 0) {
          for (let i = 0; i < lines.length; i++) {
            if (/^##\s/.test(lines[i])) { idx = i; break; }
          }
        }
        if (idx >= 0) {
          const hashes = (lines[idx].match(/^#+/) || [''])[0];
          lines[idx] = hashes + ' ' + title;
          changed = true;
        }
      }
      const newText = changed ? lines.join('\n') : '# ' + title + '\n\n' + text;
      writeText(node.file, newText, root);
      const rebuilt = buildNodes(root);
      // 优先返回重命名行所在的新节点（标题匹配），其次原文件第一个节点
      const newNode = rebuilt.find(x => x.file === node.file && x.title === title)
        || rebuilt.find(x => x.file === node.file && x.startLine === node.startLine)
        || rebuilt.find(x => x.file === node.file)
        || node;
      return sendJson(res, { ok: true, node: { id: newNode.id, title: newNode.title, file: newNode.file } });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/layout' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const positions = body.nodes || {};
      const customLinks = Array.isArray(body.customLinks) ? body.customLinks : [];
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const prev = loadLayout(root);
      snapshotLayoutThrottled(root, body.project || defaultProjectName());
      saveLayout({
        nodes: positions,
        customLinks,
        version: body.version || prev.version || 2,
        mode: body.mode || prev.mode || 'axis',
        axis: body.axis || prev.axis || {},
        axisProgress: body.axisProgress || prev.axisProgress || {},
        axisBandMode: body.axisBandMode !== undefined ? body.axisBandMode : (prev.axisBandMode || ''),
        axisBands: body.axisBands !== undefined ? body.axisBands : (prev.axisBands || []),
        axisSegSize: body.axisSegSize !== undefined ? body.axisSegSize : (prev.axisSegSize || 0),
        axisY: body.axisY || prev.axisY || null,
        overrides: body.overrides || prev.overrides || {},
        timelineNodes: body.timelineNodes !== undefined ? body.timelineNodes : (prev.timelineNodes || []),
        unrecognized: body.unrecognized || prev.unrecognized || [],
      }, root);
      return sendJson(res, { ok: true });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  // ── 大一统框架：配置读取/保存 ──
  if (pathname === '/api/config' && req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const root = resolveProjectRoot(url.searchParams.get('project') || defaultProjectName());
      const config = loadProjectConfig(root);
      const hasFile = fs.existsSync(configPath(root));
      return sendJson(res, { ok: true, hasFile, config, configPath: path.basename(configPath(root)) });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }
  if (pathname === '/api/config' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const config = body.config;
      if (!config || typeof config !== 'object') return sendJson(res, { error: 'config 必须是对象' });
      // 浅校验关键结构，防止写坏
      if (config.scan && config.scan.files !== undefined && !Array.isArray(config.scan.files)) return sendJson(res, { error: 'scan.files 必须是数组' });
      if (config.scan && config.scan.dirs !== undefined && !Array.isArray(config.scan.dirs)) return sendJson(res, { error: 'scan.dirs 必须是数组' });
      if (config.axis && (!Array.isArray(config.axis.levels) || !config.axis.levels.length)) return sendJson(res, { error: 'axis.levels 必须是非空数组' });
      const merged = deepMerge(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), config);
      fs.writeFileSync(configPath(root), JSON.stringify(merged, null, 2), 'utf8');
      fmCache.clear();
      return sendJson(res, { ok: true, config: merged, configPath: path.basename(configPath(root)) });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  // ── 大一统框架：识别报告 ──
  if (pathname === '/api/recognition' && req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const root = resolveProjectRoot(url.searchParams.get('project') || defaultProjectName());
      const config = loadProjectConfig(root);
      const nodes = buildNodes(root);
      const covered = collectCoveredFiles(config, root);
      const all = walkMdFiles(root, config.junkDirs);
      const unrecFiles = new Set(nodes.filter(n => n.unrecognized).map(n => n.file));
      const coveredFiles = all.filter(f => covered.has(normalizeRel(f))).sort();
      // 与 buildNodes 的未识别池同源（含 ignoreUnrecognized 过滤），保证列表与节点一致
      const unFiles = [...unrecFiles].sort();
      const byType = {};
      for (const n of nodes) {
        if (n.unrecognized) continue;
        byType[n.type] = (byType[n.type] || 0) + 1;
      }
      // 可疑项：整文件单节点（可能是多章节/多小节被吞）、表格存在但未解析、模板词标题
      const suspicious = [];
      for (const n of nodes) {
        if (n.unrecognized) continue;
        const reasons = [];
        const content = n.content || '';
        const rawLines = content.split('\n').length;
        if (n.type !== 'volume' && rawLines > 60 && !content.includes('\n## ')) reasons.push('整文件单节点');
        if (/^\s*\|.*\|/.test(content) && !/(^|\n)##\s/.test(content)) reasons.push('含表格但未解析');
        if (/^(模板|示例|说明|readme|index|_meta)/i.test(n.title || '')) reasons.push('模板词标题');
        if (reasons.length) suspicious.push({ id: n.id, title: n.title, file: n.file, reasons });
      }
      return sendJson(res, {
        ok: true,
        project: path.basename(root),
        totalMd: all.length,
        coveredFiles: coveredFiles.length,
        unrecognizedFiles: unFiles,
        nodeCount: nodes.length,
        recognizedCount: nodes.filter(n => !n.unrecognized).length,
        unrecognizedCount: nodes.filter(n => n.unrecognized).length,
        unrecognizedFileCount: unrecFiles.size,
        byType,
        suspicious: suspicious.slice(0, 200),
        axis: config.axis || DEFAULT_CONFIG.axis,
      });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  // ── 大一统框架：人工纠正 override（标记类型/轴位，写入布局文件）──
  if (pathname === '/api/override' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const nodeId = String(body.id || '');
      if (!nodeId) return sendJson(res, { error: '缺少 id' });
      const patch = body.patch;
      if (!patch || typeof patch !== 'object') return sendJson(res, { error: '缺少 patch' });
      const layout = loadLayout(root);
      const overrides = layout.overrides || {};
      const prev = overrides[nodeId] || {};
      const next = { ...prev };
      for (const k of ['type', 'label', 'title', 'chapter', 'level', 'lane']) {
        if (patch[k] !== undefined && patch[k] !== null && patch[k] !== '') next[k] = patch[k];
        else if (patch[k] === null || patch[k] === '') delete next[k];
      }
      if (Object.keys(next).length) overrides[nodeId] = next;
      else delete overrides[nodeId];
      saveLayout({ ...layout, overrides }, root);
      return sendJson(res, { ok: true, id: nodeId, override: overrides[nodeId] || null });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }


  if (pathname === '/api/files' && req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const root = resolveProjectRoot(url.searchParams.get('project') || defaultProjectName());
      return sendJson(res, { ok: true, files: listMdFiles(root) });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  if (pathname === '/api/file' && req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const root = resolveProjectRoot(url.searchParams.get('project') || defaultProjectName());
      const rel = url.searchParams.get('path') || '';
      const content = readFileText(root, rel);
      return sendJson(res, { ok: true, path: rel, content });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  if (pathname === '/api/file/save' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const rel = String(body.path || '');
      if (!isSafePath(rel, root) || !isMdPath(rel)) return sendJson(res, { error: 'unsafe or invalid file path' });
      const full = path.resolve(root, rel);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return sendJson(res, { error: 'file not found' });
      snapshotFiles(root, body.project || projectNameOfRoot(root), [rel], '手动保存');
      writeText(rel, String(body.content ?? ''), root);
      return sendJson(res, { ok: true, path: rel });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  if (pathname === '/api/file/create' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const rel = String(body.path || '');
      if (!isSafePath(rel, root) || !isMdPath(rel)) return sendJson(res, { error: 'unsafe or invalid file path' });
      const full = path.resolve(root, rel);
      if (fs.existsSync(full)) return sendJson(res, { error: 'file already exists' });
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const title = path.basename(rel, '.md').replace(/[_-]+/g, ' ');
      fs.writeFileSync(full, '# ' + title + '\n\n', 'utf8');
      return sendJson(res, { ok: true, path: rel });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  if (pathname === '/api/file/delete' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const rel = String(body.path || '');
      const full = path.resolve(root, rel);
      if (!isSafePath(rel, root) || !isMdPath(rel)) return sendJson(res, { error: 'unsafe or invalid file path' });
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return sendJson(res, { error: 'file not found' });
      snapshotFiles(root, body.project || projectNameOfRoot(root), [rel], '删除文件');
      try { fs.copyFileSync(full, full + '.bak'); } catch (_) {}
      fs.unlinkSync(full);
      return sendJson(res, { ok: true, path: rel });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  if (pathname === '/api/file/rename' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const root = resolveProjectRoot(body.project || defaultProjectName());
      const oldRel = String(body.path || '');
      const newRel = String(body.newPath || '');
      if (!isSafePath(oldRel, root) || !isSafePath(newRel, root) || !isMdPath(oldRel) || !isMdPath(newRel)) {
        return sendJson(res, { error: 'unsafe or invalid file path' });
      }
      const oldFull = path.resolve(root, oldRel);
      const newFull = path.resolve(root, newRel);
      if (!fs.existsSync(oldFull) || !fs.statSync(oldFull).isFile()) return sendJson(res, { error: 'file not found' });
      if (fs.existsSync(newFull)) return sendJson(res, { error: 'target file already exists' });
      fs.mkdirSync(path.dirname(newFull), { recursive: true });
      fs.renameSync(oldFull, newFull);
      return sendJson(res, { ok: true, path: newRel, oldPath: oldRel });
    } catch (e) {
      return sendJson(res, { error: e.message });
    }
  }

  // 静态文件
  if (pathname === '/' || pathname === '/index.html') {
    const html = path.join(ROOT, 'index.html');
    if (fs.existsSync(html)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(html));
    }
  }
  const filePath = path.join(ROOT, pathname.replace(/^\/+/, ''));
  if (isSafePath(filePath, ROOT) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    return res.end(fs.readFileSync(filePath));
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

loadProposals();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`小说画布已启动: http://127.0.0.1:${PORT}`);
});
