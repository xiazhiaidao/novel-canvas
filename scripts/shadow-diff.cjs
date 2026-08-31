// 影子模式验证：新 buildNodes vs 旧逻辑，节点 id 集合必须一致（未被规则覆盖的新文件除外）
// 用法：node scripts/shadow-diff.cjs [项目名]
const path = require('path');
const fs = require('fs');
const root = process.argv[2] ? path.join('D:/小说', process.argv[2]) : 'D:/小说/从0开始的天灾生活';

const vm = require('vm');
const code = fs.readFileSync('D:/小说/novel-canvas/server.js', 'utf8')
  + '\n;globalThis.__dsh_test = { FILE_DEFS, parseHeadingSegments, parseTableSegments, scanDirAsNodes, scanChapters, buildNodes, loadProjectConfig };\n';
const sandbox = { console, require, process, __dirname: 'D:/小说/novel-canvas', Buffer, setTimeout, clearTimeout, setInterval, clearInterval, URL };
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'server.js' });
const sb = sandbox.__dsh_test;

function legacyBuildNodes(root) {
  const nodes = [];
  for (const def of sb.FILE_DEFS) {
    try {
      const segs = def.table
        ? sb.parseTableSegments(def.key, def.file, def.type, def.label, root)
        : sb.parseHeadingSegments(def.key, def.file, def.type, def.label, def.heading, root);
      for (const s of segs) {
        const firstLine = s.content.split('\n').find(l => l.trim() && !l.trim().startsWith('#')) || '';
        nodes.push({ ...s, desc: firstLine.trim().slice(0, 100) });
      }
    } catch (e) { /* 文件不存在，跳过 */ }
  }
  nodes.push(...sb.scanDirAsNodes('role', path.join('设定', '角色'), 'role', '角色', root));
  nodes.push(...sb.scanDirAsNodes('faction', path.join('设定', '势力'), 'faction', '势力', root));
  nodes.push(...sb.scanDirAsNodes('setting', path.join('设定', '世界观'), 'setting', '设定', root));
  nodes.push(...sb.scanChapters(root));
  return nodes;
}

const legacy = legacyBuildNodes(root);
const neu = sb.buildNodes(root);

const legacySet = new Set(legacy.map(n => n.id));
const neuSet = new Set(neu.map(n => n.id));
const missing = legacy.map(n => n.id).filter(id => !neuSet.has(id));
const added = neu.map(n => n.id).filter(id => !legacySet.has(id));
const badAdded = added.filter(id => !id.startsWith('unrec:'));

console.log('项目:', root);
console.log('旧节点数:', legacy.length, '新节点数:', neu.length);
console.log('旧 id 缺失(应=0):', missing.length, missing.slice(0, 10));
console.log('新增 id:', added.length, '| 新增非 unrec id(应=0):', badAdded.length, badAdded.slice(0, 10));
const unrec = neu.filter(n => n.unrecognized);
console.log('未识别节点数:', unrec.length);
unrec.slice(0, 12).forEach(n => console.log('  unrec:', n.id, '|', n.title, '|', n.file));

const legMap = new Map(legacy.map(n => [n.id, n]));
const neuMap = new Map(neu.map(n => [n.id, n]));
let mismatch = 0;
for (const id of legacySet) {
  const a = legMap.get(id), b = neuMap.get(id);
  if (!b) continue;
  for (const k of ['title', 'type', 'label', 'file', 'startLine', 'endLine']) {
    if (String(a[k] ?? '') !== String(b[k] ?? '')) {
      mismatch++;
      if (mismatch <= 8) console.log('  字段不一致', id, k, JSON.stringify(a[k]), '=>', JSON.stringify(b[k]));
    }
  }
}
console.log('旧节点字段不一致数(应=0):', mismatch);
console.log(missing.length === 0 && badAdded.length === 0 && mismatch === 0 ? 'PASS 影子模式 id/内容稳定' : 'FAIL');
process.exit(0);
