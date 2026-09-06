// Novel Canvas 主应用脚本（原 index.html 内联脚本，拆分后此文件加载顺序：canvas_upgrade.js → app.js → file_editor.js）

let nodes = [];
let nodeMap = {};
let positions = {};
let links = [];
let activeCats = new Set();
let currentProject = '';
const renderedProposalIds = new Set();
let chatHistory = [];
let customLinks = [];
let timelineNodes = [];
let pendingRefs = [];
let selToolbarCtx = null;
let showAllCustomLinks = false;
let autoLinkEnabled = true;
let egoNodeId = null;
let matchIndices = [];
let currentMatch = -1;

// 大一统框架：视图模式与轴数据（默认进度轴视图，任何项目打开即见；用户切换后按项目布局持久化）
let viewMode = 'axis';            // 'free' | 'axis'
let axisDef = { name: '进度', levels: ['开端', '发展', '高潮', '结局'] };
let layoutAxis = {};              // layout.axis：nodeId -> {chapter, level, lane}
let axisProgress = {};            // layout.axisProgress：章号 -> 剧情推进 0~100（覆盖默认对角线 y=x）
let axisBandMode = '';            // layout.axisBandMode：'volume'(自动卷分段) | 'realm'(境界) | 'plot'(剧情关键节点)
let axisBands = [];               // layout.axisBands：分段名列表（Y 自下而上：第一卷/炼气/开端...）
let axisSegSize = 0;              // layout.axisSegSize：X 章段聚合密度 0=自动(≤20段) | 5/10/20=每段章数
let __axisBandAskShown = false;   // 会话内是否已询问过分段方式（避免每次进入都弹）
let layoutOverrides = {};         // layout.overrides：nodeId -> {type,label,...}
let unrecognizedFiles = new Set(); // 有未识别内容的文件（文件树标注）

const canvas = document.getElementById('canvas');
const world = document.getElementById('world');
const canvasWrap = document.getElementById('canvasWrap');
const edgesSvg = document.getElementById('edges');
const detail = document.getElementById('detail');
const detailBody = document.getElementById('detailBody');
const categoryList = document.getElementById('categoryList');
const filtersEl = document.getElementById('filters');
const search = document.getElementById('search');
const filterChips = {};

// 视图状态：translate + scale
let view = { x: 0, y: 0, scale: 1 };
function updateView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  if (document.getElementById('minimap').classList.contains('show')) drawMinimap();
}
function screenToWorld(clientX, clientY) {
  const rect = canvasWrap.getBoundingClientRect();
  return {
    x: (clientX - rect.left - view.x) / view.scale,
    y: (clientY - rect.top - view.y) / view.scale
  };
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const GROUP_TYPES = { 设定:'setting', 大纲:'volume', 角色:'role', 势力:'faction', 伏笔:'foreshadow', 上下文:'setting', 章节:'volume', 未识别:'unrecognized' };
// 组开合状态：默认内容分类展开、章节卷收起；用户手动开合后持久化到 localStorage。
// seenGroups 记录"已经出现过"的组——新出现的组套默认开合，老组尊重用户选择（修复每次加载全部被收起的问题）。
let collapsedGroups = new Set();
try {
  const savedGroups = localStorage.getItem('canvasCollapsedGroups');
  if (savedGroups) collapsedGroups = new Set(JSON.parse(savedGroups));
} catch (e) {}
function defaultCollapseFor(key) {
  // 章节卷内容多，默认收起为卡片；未识别池也默认收起；内容分类默认展开
  return key.indexOf('章节') === 0 || key === '未识别';
}
function markSeenGroups() {
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem('canvasSeenGroups') || '[]'); } catch (e) {}
  let changed = false;
  for (const key of Object.keys(boardGroups())) {
    if (!seen.includes(key)) {
      seen.push(key); changed = true;
      if (defaultCollapseFor(key)) collapsedGroups.add(key);
      else collapsedGroups.delete(key);
    }
  }
  if (changed) { try { localStorage.setItem('canvasSeenGroups', JSON.stringify(seen)); } catch (e) {} }
}
let autoLinkMode = 'entity';

function isGlobalBoardNode(n) {
  if (!n) return false;
  if (n.synthetic) return true;
  return /文件头|汇总|总纲/.test(n.title || '');
}

function volumeKeyOf(n) {
  if (!n || !n.file) return '未分卷';
  const parts = n.file.split(/[\\/]/);
  return parts.length > 1 ? parts[parts.length - 2] : '未分卷';
}

function chapterGroupKey(n) {
  return '章节·' + volumeKeyOf(n);
}

function boardGroups() {
  const groups = {};
  const order = [];
  for (const n of nodes) {
    const key = n.label === '章节' ? chapterGroupKey(n) : (n.label || '未分类');
    if (!groups[key]) { groups[key] = { base: key, board: null, children: [] }; order.push(key); }
    if (isGlobalBoardNode(n)) groups[key].board = n;
    else groups[key].children.push(n);
  }
  for (const key of order) {
    const g = groups[key];
    if (!g.board) {
      const isVolume = key.indexOf('章节·') === 0;
      g.board = {
        id: 'cat:' + key,
        label: isVolume ? '章节' : key,
        type: isVolume ? 'volume' : (GROUP_TYPES[key] || 'setting'),
        title: isVolume ? key.slice(3) : key,
        desc: isVolume ? (g.children.length + ' 章') : (g.children.length + ' 项'),
        content: '',
        file: '',
        startLine: 0,
        endLine: 0,
        synthetic: true
      };
    }
  }
  return groups;
}

function ensureGroupNodeMap() {
  const groups = boardGroups();
  for (const key in groups) nodeMap[groups[key].board.id] = groups[key].board;
}

function ensureBoardContained(g, forceReflow) {
  if (!g.board) return;
  const bp = positions[g.board.id] || { x: 60, y: 60 };
  const pad = 20;
  const headerH = 70;
  const colGap = 220;
  const rowGap = 145;
  const cols = boardCols(g.children.length);
  const needReflow = forceReflow || g.children.some(c => {
    const p = positions[c.id];
    if (!p) return true;
    const rx = p.x - bp.x;
    const ry = p.y - bp.y;
    return rx < 0 || ry < 0 || rx > 600 || ry > 400;
  });
  if (needReflow) {
    g.children.forEach((c, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions[c.id] = {
        x: bp.x + pad + col * colGap,
        y: bp.y + headerH + row * rowGap
      };
    });
  }
  let maxRx = 0;
  let maxRy = 0;
  for (const c of g.children) {
    const p = positions[c.id];
    if (!p) continue;
    maxRx = Math.max(maxRx, p.x - bp.x);
    maxRy = Math.max(maxRy, p.y - bp.y);
  }
  const rows = Math.ceil(Math.max(1, g.children.length) / cols);
  g.boardW = Math.max(420, pad + cols * colGap + 140, maxRx + 200);
  g.boardH = Math.max(180, headerH + rows * rowGap + 60, maxRy + 120);
  if (collapsedGroups.has(g.base)) {
    g.boardW = 240;
    g.boardH = 64;
  }
}

function fillNodeContent(el, n) {
  el.querySelector('.typeTag').textContent = n.label;
  el.querySelector('.ntitle').textContent = n.title;
  el.querySelector('.ndesc').textContent = n.desc || '';
  const nfile = el.querySelector('.nfile');
  nfile.textContent = (n.file || '').split(/[\\/]/).pop();
  nfile.title = n.file || '';
  el.querySelector('.nstats').textContent = ((n.content || '').replace(/\s+/g, '').length) + ' 字';
}

function cleanTitleKey(title) {
  return String(title || '')
    .replace(/^V\d+-\d+\s*/, '')
    .replace(/^[（(【\[].*?[）)】\]]\s*/, '')
    .replace(/^第[0-9一二三四五六七八九十百]+章\s*/, '')
    .replace(/^[\d一二三四五六七八九十]+(?:[.．:：·、][\d一二三四五六七八九十]+)*[.．:：·、]\s*/, '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/《|》/g, '')
    .trim();
}

function entityAliases(title) {
  const aliases = new Set();
  const cleaned = cleanTitleKey(title);
  if (cleaned.length >= 2) aliases.add(cleaned);
  cleaned.split(/[:：,，、/|·]/).map(s => s.trim()).filter(s => s.length >= 2).forEach(s => aliases.add(s));
  return [...aliases];
}

function isChapterNode(n) { return n && n.label === '章节'; }
function isEntityNode(n) { return n && ['角色','势力','设定','上下文','大纲'].includes(n.label); }

function buildLinks() {
  if (autoLinkMode === 'off') return [];
  const out = [];
  const seen = new Set();
  const add = (a, b) => {
    const k = a < b ? a + '|' + b : b + '|' + a;
    if (!seen.has(k)) { seen.add(k); out.push([a, b]); }
  };
  const entityNodes = nodes.filter(n => !isGlobalBoardNode(n) && isEntityNode(n));

  if (autoLinkMode === 'entity' || autoLinkMode === 'chapter') {
    for (const a of nodes) {
      if (isGlobalBoardNode(a)) continue;
      if (autoLinkMode === 'chapter' && !isChapterNode(a)) continue;
      const text = (a.content || '') + ' ' + (a.title || '');
      let count = 0;
      for (const b of entityNodes) {
        if (a.id === b.id) continue;
        const aliases = entityAliases(b.title);
        if (aliases.some(al => al.length >= 2 && text.includes(al))) {
          add(a.id, b.id);
          if (++count >= 8) break;
        }
      }
    }
  } else if (autoLinkMode === 'title') {
    for (const a of nodes) {
      if (isGlobalBoardNode(a)) continue;
      const key = cleanTitleKey(a.title);
      if (key.length < 2) continue;
      let count = 0;
      for (const b of nodes) {
        if (a.id === b.id || isGlobalBoardNode(b)) continue;
        if (isChapterNode(a) && isChapterNode(b)) continue;
        if (b.content && b.content.includes(key) && count < 4) {
          add(a.id, b.id);
          count++;
        }
      }
    }
  }
  return out;
}

function renderSidebar() {
  categoryList.innerHTML = '';
  const cats = [...new Set(nodes.map(n => n.label))];
  if (!cats.includes('章节')) cats.push('章节');
  for (const label of cats) {
    const div = document.createElement('div');
    div.className = 'cat';
    const title = document.createElement('div');
    title.className = 'catTitle';
    title.textContent = label;
    div.appendChild(title);
    const labelNodes = nodes.filter(x => x.label === label);
    if (label === '伏笔') {
      const open = labelNodes.filter(n => { const s = parseForeshadowStatus(n); return s === '已埋' || s === '计划回收'; }).length;
      if (open) {
        const span = document.createElement('span');
        span.className = 'fbCount';
        span.textContent = '未回收 ' + open;
        title.appendChild(span);
      }
    }
    if (label === '章节') {
      const addBtn = document.createElement('button');
      addBtn.className = 'chapterAddBtn';
      addBtn.textContent = '＋';
      addBtn.title = '新建章节';
      addBtn.addEventListener('click', (e) => { e.stopPropagation(); createChapter(); });
      title.appendChild(addBtn);
    }
    if ((label === '章节' && labelNodes.length > 1) || (labelNodes.length > 1 && shouldGroupByVolume(labelNodes))) {
      renderVolumeGroups(div, labelNodes);
    } else {
      for (const n of labelNodes) {
        const btn = document.createElement('button');
        btn.className = 'item';
        btn.textContent = n.title;
        btn.dataset.id = n.id;
        if (label === '伏笔') {
          const st = parseForeshadowStatus(n);
          if (st) {
            const badge = document.createElement('span');
            badge.className = 'fbBadge ' + (st === '已回收' || st === '断线' ? 'done' : 'open');
            badge.textContent = st;
            btn.appendChild(badge);
          }
        }
        btn.addEventListener('click', () => focusNode(n.id));
        btn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          showNodeMenu(e.clientX, e.clientY, n);
        });
        div.appendChild(btn);
      }
    }
    categoryList.appendChild(div);
  }
}

function volumeKeyOf(n) {
  const parts = (n.file || '').split(/[\\/]/);
  if (parts.length > 1) {
    const parent = parts[parts.length - 2];
    if (/卷/.test(parent)) return parent;
  }
  const text = (n.title || '') + ' ' + (n.file || '');
  const m = text.match(/(第\s*[0-9一二三四五六七八九十]+\s*卷|[\u4e00-\u9fa5A-Za-z0-9]{1,8}卷)/);
  if (m) return m[0].trim().replace(/^[-_ ]+|[-_ ]+$/g, '');
  return '全局';
}

function shouldGroupByVolume(list) {
  const keys = new Set(list.map(volumeKeyOf));
  return keys.size > 1 || (keys.size === 1 && !keys.has('全局'));
}

function renderVolumeGroups(div, list) {
  const groups = {};
  for (const n of list) {
    const vol = volumeKeyOf(n);
    (groups[vol] = groups[vol] || []).push(n);
  }
  const keys = Object.keys(groups).sort((a, b) => {
    if (a === '全局') return 1;
    if (b === '全局') return -1;
    return a.localeCompare(b, 'zh');
  });
  for (const vol of keys) {
    const g = document.createElement('div'); g.className = 'volGroup';
    const gt = document.createElement('div'); gt.className = 'volTitle'; gt.textContent = vol + ' (' + groups[vol].length + ')';
    gt.addEventListener('click', () => g.classList.toggle('collapsed')); g.appendChild(gt);
    const items = document.createElement('div'); items.className = 'volItems';
    for (const n of groups[vol]) {
      const btn = document.createElement('button'); btn.className = 'item'; btn.textContent = n.title; btn.dataset.id = n.id;
      btn.addEventListener('click', () => focusNode(n.id));
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showNodeMenu(e.clientX, e.clientY, n);
      });
      items.appendChild(btn);
    }
    g.appendChild(items); if (groups[vol].length > 6) g.classList.add('collapsed'); div.appendChild(g);
  }
}

function renderFilters() {
  filtersEl.innerHTML = '';
  activeCats = new Set(nodes.map(n => n.label));
  for (const label of activeCats) {
    const chip = document.createElement('span');
    chip.className = 'filterChip on';
    chip.textContent = label;
    chip.addEventListener('click', () => {
      if (activeCats.has(label)) activeCats.delete(label);
      else activeCats.add(label);
      chip.classList.toggle('on', activeCats.has(label));
      applyFilters();
    });
    filtersEl.appendChild(chip);
    filterChips[label] = chip;
  }
}

function applyFilters() {
  const q = (search.value || '').trim().toLowerCase();
  matchIndices = [];
  currentMatch = -1;
  world.querySelectorAll('.node').forEach(el => {
    const n = nodeMap[el.dataset.id];
    if (!n) return; // 切换项目时 #world 可能残留旧项目节点（渲染晚于轴视图），跳过而非崩溃
    const catOk = activeCats.has(n.label);
    const hit = !q || n.title.toLowerCase().includes(q) || (n.desc || '').toLowerCase().includes(q);
    el.classList.remove('hit');
    el.style.display = catOk && hit ? '' : 'none';
    if (hit && q) matchIndices.push(n.id);
  });
  // 轴视图节点同样受筛选/搜索控制（v1.11：唯一视图为进度轴）
  document.querySelectorAll('#axisNodes .node').forEach(el => {
    const n = nodeMap[el.dataset.id];
    if (!n) return;
    const catOk = activeCats.has(n.label);
    const hit = !q || n.title.toLowerCase().includes(q) || (n.desc || '').toLowerCase().includes(q);
    el.classList.remove('hit');
    el.style.display = catOk && hit ? '' : 'none';
    if (hit && q && !matchIndices.includes(n.id)) matchIndices.push(n.id);
  });
  redrawEdges();
  const cnt = document.getElementById('searchCount');
  if (q && matchIndices.length) {
    cnt.textContent = '🔍 ' + matchIndices.length + ' 处';
    cnt.classList.add('show');
  } else if (q) {
    cnt.textContent = '🔍 无结果';
    cnt.classList.add('show');
  } else {
    cnt.classList.remove('show');
  }
  if (matchIndices.length) highlightMatch(0);
  else clearHighlight();
}

function highlightMatch(idx) {
  clearHighlight();
  if (!matchIndices.length) return;
  currentMatch = ((idx % matchIndices.length) + matchIndices.length) % matchIndices.length;
  const id = matchIndices[currentMatch];
  // 优先可见视图（轴视图为唯一视图；自由视图隐藏时跳过不可见的命中）
  const axisViewEl = document.getElementById('axisView');
  const axisFirst = axisViewEl && axisViewEl.style.display !== 'none';
  const el = axisFirst
    ? (document.querySelector(`#axisNodes .node[data-id="${id}"]`) || world.querySelector(`.node[data-id="${id}"]`))
    : (world.querySelector(`.node[data-id="${id}"]`) || document.querySelector(`#axisNodes .node[data-id="${id}"]`));
  if (el) {
    el.classList.add('hit');
    // 轴视图：transform 平移缩放容器，scrollIntoView 移不动视野 → 手动平移到命中节点居中
    if (axisFirst && el.closest('#axisNodes')) axisPanToNode(el);
    else el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    document.getElementById('searchCount').textContent = '🔍 ' + (currentMatch + 1) + '/' + matchIndices.length;
  }
}
// 进度轴视图内：把视野平移到某个节点居中（搜索命中定位）
function axisPanToNode(el) {
  const g = axisGeom;
  const axisView = document.getElementById('axisView');
  if (!g || !axisView) return;
  const vw = axisView.offsetWidth || 1000;
  const vh = axisView.offsetHeight || 600;
  if (axisViewT.scale < 0.35) axisViewT.scale = 0.55; // 过小比例 → 放大到可读
  const cx = (parseFloat(el.style.left) || 0) + (el.offsetWidth || 60) / 2;
  const cy = (parseFloat(el.style.top) || 0) + (el.offsetHeight || 24) / 2;
  axisViewT.x = vw / 2 - cx * axisViewT.scale;
  axisViewT.y = vh / 2 - cy * axisViewT.scale;
  applyAxisTransform();
}
// 搜索框键盘导航：Enter/↓ 下一个命中，↑/Shift+Enter 上一个，Esc 清空
function searchNav(e) {
  if (!matchIndices.length) return;
  if (e.key === 'Enter' || e.key === 'ArrowDown') {
    e.preventDefault();
    highlightMatch(currentMatch + 1);
  } else if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) {
    e.preventDefault();
    highlightMatch(currentMatch - 1);
  } else if (e.key === 'Escape') {
    search.value = '';
    applyFilters();
  }
}
function clearHighlight() {
  world.querySelectorAll('.node.hit').forEach(el => el.classList.remove('hit'));
  document.querySelectorAll('#axisNodes .node.hit').forEach(el => el.classList.remove('hit'));
}


function renderNodes() {
  world.querySelectorAll('.node').forEach(el => el.remove());
  const groups = boardGroups();
  const boardIds = new Set();
  const childIds = new Set();
  for (const base in groups) {
    const g = groups[base];
    if (g.board) boardIds.add(g.board.id);
    g.children.forEach(c => childIds.add(c.id));
  }
  for (const base in groups) {
    const g = groups[base];
    if (!g.board) continue;
    ensureBoardContained(g);
  }

  // 渲染背景板容器 + 容器内部的节点（分类总括，默认收起，点击展开）
  for (const base in groups) {
    const g = groups[base];
    if (!g.board) continue;
    const bp = positions[g.board.id] || { x: 60, y: 60 };
    const collapsed = collapsedGroups.has(g.base);
    const boardEl = document.createElement('div');
    boardEl.className = 'node nodeBoard type-' + g.board.type + (collapsed ? ' collapsed' : '');
    boardEl.dataset.id = g.board.id;
    boardEl.style.left = bp.x + 'px';
    boardEl.style.top = bp.y + 'px';
    boardEl.style.width = (collapsed ? 240 : (g.boardW || 420)) + 'px';
    boardEl.style.height = (collapsed ? 64 : (g.boardH || 180)) + 'px';
    boardEl.innerHTML = '<span class="collapseIcon" title="展开/收起"></span><span class="typeTag"></span><div class="ntitle"></div><div class="ndesc"></div><div class="nmeta"><span class="nfile"></span><span class="nstats"></span></div><div class="boardChildren"></div>';
    fillNodeContent(boardEl, g.board);
    const iconEl = boardEl.querySelector('.collapseIcon');
    if (iconEl) iconEl.textContent = collapsed ? '展开 ▸' : '收起 ▾';
    boardEl.addEventListener('click', (e) => {
      if (e.target.closest('.node:not(.nodeBoard)')) return;
      // 刚发生过平移手势（按住拖动画布）→ 这次 click 不算，避免误展开/误开详情
      if (panGesture && panGesture.moved) { panGesture = null; return; }
      panGesture = null;
      if (boardEl._moved || boardEl.classList.contains('dragging')) { boardEl._moved = false; return; }
      if (collapsed || e.target.closest('.collapseIcon') || (g.board.synthetic && !collapsed)) {
        toggleGroup(g.base);
      } else {
        showDetail(g.board);
      }
    });
    boardEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('.node:not(.nodeBoard)')) return;
      // 标题区（收起图标/类型标签/标题/元信息）拖拽移动板块；
      // 其余区域（描述/内容区/空白）拖拽平移画布——修复放大后板块占满视口时无法平移的问题
      if (!e.target.closest('.collapseIcon, .typeTag, .ntitle, .nmeta')) { startCanvasPan(e); return; }
      e.preventDefault();
      e.stopPropagation();
      boardEl._moved = false;
      const startWorld = screenToWorld(e.clientX, e.clientY);
      const orig = { x: bp.x, y: bp.y };
      const childOrig = g.children.map(c => positions[c.id] || { x: 0, y: 0 });
      boardEl.classList.add('dragging');
      function move(ev) {
        const p = screenToWorld(ev.clientX, ev.clientY);
        const nx = Math.max(0, orig.x + (p.x - startWorld.x));
        const ny = Math.max(0, orig.y + (p.y - startWorld.y));
        if (Math.abs(nx - orig.x) > 3 || Math.abs(ny - orig.y) > 3) boardEl._moved = true;
        positions[g.board.id] = { x: nx, y: ny };
        boardEl.style.left = nx + 'px';
        boardEl.style.top = ny + 'px';
        g.children.forEach((c, i) => {
          const co = childOrig[i];
          positions[c.id] = { x: co.x + (nx - orig.x), y: co.y + (ny - orig.y) };
        });
        redrawEdges();
      }
      function up() {
        boardEl.classList.remove('dragging');
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        saveLayout();
      }
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    world.appendChild(boardEl);

    const boardChildrenEl = boardEl.querySelector('.boardChildren');
    for (const child of g.children) {
      const cp = positions[child.id] || { x: bp.x + 30, y: bp.y + 70 };
      const childEl = document.createElement('div');
      childEl.className = 'node type-' + child.type;
      childEl.dataset.id = child.id;
      childEl.style.left = (cp.x - bp.x) + 'px';
      childEl.style.top = (cp.y - bp.y) + 'px';
      childEl.innerHTML = '<span class="port in" title="输入"></span><span class="port out" title="输出"></span><span class="typeTag"></span><div class="ntitle"></div><div class="ndesc"></div><div class="nmeta"><span class="nfile"></span><span class="nstats"></span></div>';
      fillNodeContent(childEl, child);
      childEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!childEl.classList.contains('dragging')) {
          setEgoNode(child.id);
          showDetail(child);
        }
      });
      childEl.addEventListener('mousedown', (e) => {
        if (e.target.closest('.port')) return;
        e.preventDefault();
        e.stopPropagation();
        const startWorld = screenToWorld(e.clientX, e.clientY);
        const origX = positions[child.id]?.x ?? cp.x;
        const origY = positions[child.id]?.y ?? cp.y;
        childEl.classList.add('dragging');
        function move(ev) {
          const p = screenToWorld(ev.clientX, ev.clientY);
          const nx = Math.max(0, origX + (p.x - startWorld.x));
          const ny = Math.max(0, origY + (p.y - startWorld.y));
          positions[child.id] = { x: nx, y: ny };
          const bpos = positions[g.board.id] || { x: bp.x, y: bp.y };
          childEl.style.left = (nx - bpos.x) + 'px';
          childEl.style.top = (ny - bpos.y) + 'px';
          redrawEdges();
        }
        function up() {
          childEl.classList.remove('dragging');
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          saveLayout();
        }
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      });
      childEl.querySelector('.port.out').addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startConnect(child.id);
      });
      childEl.querySelector('.port.in').addEventListener('mouseup', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (connectFrom && connectFrom !== child.id) addCustomLink(connectFrom, child.id);
        endConnect();
      });
      if (boardChildrenEl) boardChildrenEl.appendChild(childEl);
      else boardEl.appendChild(childEl);
    }
  }

  // 渲染普通节点
  for (const n of nodes) {
    if (boardIds.has(n.id) || childIds.has(n.id)) continue;
    const x = positions[n.id]?.x ?? 60;
    const y = positions[n.id]?.y ?? nodes.indexOf(n) * 90;
    const el = document.createElement('div');
    el.className = 'node type-' + n.type;
    el.dataset.id = n.id;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.innerHTML = '<span class="port in" title="输入"></span><span class="port out" title="输出"></span><span class="typeTag"></span><div class="ntitle"></div><div class="ndesc"></div><div class="nmeta"><span class="nfile"></span><span class="nstats"></span></div>';
    fillNodeContent(el, n);
    el.addEventListener('click', (e) => { if (!el.classList.contains('dragging')) showDetail(n); });
    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('.port')) return;
      e.preventDefault();
      e.stopPropagation();
      const startWorld = screenToWorld(e.clientX, e.clientY);
      const origX = positions[n.id]?.x ?? x;
      const origY = positions[n.id]?.y ?? y;
      el.classList.add('dragging');
      function move(ev) {
        const p = screenToWorld(ev.clientX, ev.clientY);
        positions[n.id] = {
          x: Math.max(0, origX + (p.x - startWorld.x)),
          y: Math.max(0, origY + (p.y - startWorld.y))
        };
        el.style.left = positions[n.id].x + 'px';
        el.style.top = positions[n.id].y + 'px';
        redrawEdges();
      }
      function up() {
        el.classList.remove('dragging');
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        saveLayout();
      }
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    el.querySelector('.port.out').addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startConnect(n.id);
    });
    el.querySelector('.port.in').addEventListener('mouseup', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (connectFrom && connectFrom !== n.id) addCustomLink(connectFrom, n.id);
      endConnect();
    });
    world.appendChild(el);
  }
}

function toggleGroup(key) {
  if (collapsedGroups.has(key)) collapsedGroups.delete(key);
  else collapsedGroups.add(key);
  try { localStorage.setItem('canvasCollapsedGroups', JSON.stringify([...collapsedGroups])); } catch (e) {}
  renderNodes();
  redrawEdges();
  // 展开/收起会改变板块尺寸，可能挤压邻居 → 自动体检，有重叠/蔓延就地修复
  const { problems } = layoutHealth();
  if (problems.some(p => p.type === 'board-overlap' || p.type === 'sprawl')) {
    repairLayout();
    renderNodes();
    redrawEdges();
    saveLayout();
  }
}

function setEgoNode(id) {
  egoNodeId = id;
  redrawEdges();
  updateEgoHighlight();
}

function clearEgo() {
  if (!egoNodeId) return;
  egoNodeId = null;
  redrawEdges();
  updateEgoHighlight();
}

function updateEgoHighlight() {
  [world, document.getElementById('axisNodes')].forEach(container => {
    if (!container) return;
    container.querySelectorAll('.node').forEach(el => {
      const id = el.dataset.id;
      const isSelf = id === egoNodeId;
      const isNeighbor = egoNodeId && (
        links.some(([a, b]) => (a === egoNodeId && b === id) || (b === egoNodeId && a === id)) ||
        customLinks.some(([a, b]) => (a === egoNodeId && b === id) || (b === egoNodeId && a === id))
      );
      el.classList.toggle('egoSelf', isSelf);
      el.classList.toggle('egoNeighbor', isNeighbor);
    });
  });
}

// ── 关系矩阵（密集关系用表格看）─────────────────────────────
let matrixMode = 'roleChapter';

// 命中检测：返回匹配到的别名列表（含出现次数），如 ['莫余×3','阿余×1']；无命中返回 []
function matrixHits(rText, title) {
  const out = [];
  for (const al of entityAliases(title)) {
    if (al.length < 2) continue;
    let cnt = 0, idx = 0;
    while ((idx = rText.indexOf(al, idx)) !== -1) { cnt++; idx += al.length; }
    if (cnt) out.push(al + '×' + cnt);
  }
  return out;
}

function buildMatrixTable(rowTitle, colTitle, rowNodes, colNodes, matchFn) {
  let html = '<table class="matrixTable"><thead><tr><th>' + escapeHtml(rowTitle) + ' \\ ' + escapeHtml(colTitle) + '</th>';
  for (const c of colNodes) html += '<th class="mxColHead" data-id="' + escapeHtml(c.id) + '" title="点击查看：' + escapeHtml(c.title) + '">' + escapeHtml(c.title) + '</th>';
  html += '</tr></thead><tbody>';
  for (const r of rowNodes) {
    html += '<tr><th class="mxRowHead" data-id="' + escapeHtml(r.id) + '" title="点击查看：' + escapeHtml(r.title) + '">' + escapeHtml(r.title) + '</th>';
    const rText = (r.content || '') + ' ' + (r.title || '');
    for (const c of colNodes) {
      const hits = matchFn(r, c, rText);
      const hit = hits.length > 0;
      const tip = hit
        ? '命中：' + hits.join('、') + (matrixMode === 'roleChapter' || matrixMode === 'foreshadowChapter' ? '\n点击跳到' + escapeHtml(r.title) : '\n点击查看' + escapeHtml(r.title))
        : '';
      html += '<td class="center' + (hit ? ' hitCell' : '') + '" data-row="' + escapeHtml(r.id) + '" data-col="' + escapeHtml(c.id) + '" title="' + tip + '">' + (hit ? '✓' + (hits.length > 1 ? hits.length : '') : '') + '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

function renderMatrix() {
  const body = document.getElementById('matrixBody');
  if (!body) return;
  const real = n => n && !isGlobalBoardNode(n);
  const chapters = nodes.filter(n => real(n) && n.label === '章节');
  const roles = nodes.filter(n => real(n) && n.label === '角色');
  const foreshadows = nodes.filter(n => real(n) && n.label === '伏笔');
  const settings = nodes.filter(n => real(n) && n.label === '设定');
  let html = '';
  if (matrixMode === 'roleChapter') {
    html = chapters.length && roles.length
      ? buildMatrixTable('章节', '角色', chapters, roles, (r, c, rText) => matrixHits(rText, c.title))
      : '<div class="empty">还没有章节或角色数据</div>';
  } else if (matrixMode === 'foreshadowChapter') {
    html = chapters.length && foreshadows.length
      ? buildMatrixTable('章节', '伏笔', chapters, foreshadows, (r, c, rText) => matrixHits(rText, c.title))
      : '<div class="empty">还没有章节或伏笔数据</div>';
  } else if (matrixMode === 'settingRole') {
    html = settings.length && roles.length
      ? buildMatrixTable('设定', '角色', settings, roles, (r, c, rText) => {
          const cText = (c.content || '') + ' ' + (c.title || '');
          return [...matrixHits(rText, c.title), ...matrixHits(cText, r.title)];
        })
      : '<div class="empty">还没有设定或角色数据</div>';
  }
  body.innerHTML = html;
  // 提示行：✓=命中，数字=命中别名数；点格/表头可跳转或查看
  const tip = document.getElementById('matrixTip');
  if (tip) tip.style.display = 'block';
}

function openMatrix() {
  const m = document.getElementById('matrixModal');
  if (m) m.classList.add('show');
  renderMatrix();
}

function closeMatrix() {
  const m = document.getElementById('matrixModal');
  if (m) m.classList.remove('show');
}
// 矩阵点击：✓ 格 → 章节模式跳章 / 设定×角色看行节点；表头 → 查看节点
function wireMatrixClicks() {
  const body = document.getElementById('matrixBody');
  if (!body || body._mxWired) return;
  body._mxWired = true;
  body.addEventListener('click', (e) => {
    const cell = e.target.closest('td.hitCell');
    if (cell) {
      e.stopPropagation();
      const rn = nodeMap[cell.dataset.row], cn = nodeMap[cell.dataset.col];
      if (!rn) return;
      if (matrixMode === 'roleChapter' || matrixMode === 'foreshadowChapter') {
        closeMatrix();
        const ch = nodeAxisData(rn).chapter;
        if (ch != null) axisJumpTo(ch);
        showDetail(rn);
      } else {
        closeMatrix();
        showDetail(rn);
      }
      return;
    }
    const rowHead = e.target.closest('th.mxRowHead');
    if (rowHead) {
      e.stopPropagation();
      const n = nodeMap[rowHead.dataset.id];
      if (n) { closeMatrix(); showDetail(n); }
      return;
    }
    const colHead = e.target.closest('th.mxColHead');
    if (colHead) {
      e.stopPropagation();
      const n = nodeMap[colHead.dataset.id];
      if (n) { closeMatrix(); showDetail(n); }
      return;
    }
  });
}

// ── 状态看板（章节 / 伏笔）─────────────────────────────────
function renderBoard() {
  const summaryEl = document.getElementById('boardSummary');
  const bodyEl = document.getElementById('boardBody');
  if (!summaryEl || !bodyEl) return;
  const real = n => n && !isGlobalBoardNode(n);
  const chapters = nodes.filter(n => real(n) && n.label === '章节');
  const foreshadows = nodes.filter(n => real(n) && n.label === '伏笔');
  let done = 0, draft = 0, empty = 0, totalWords = 0;
  for (const c of chapters) {
    const len = (c.content || '').replace(/\s+/g, '').length;
    totalWords += len;
    if (len === 0) empty++;
    else if (len < 500) draft++;
    else done++;
  }
  const fbStatus = {};
  for (const f of foreshadows) {
    const st = parseForeshadowStatus(f) || '未标记';
    fbStatus[st] = (fbStatus[st] || 0) + 1;
  }
  const fbOpen = (fbStatus['已埋'] || 0) + (fbStatus['计划回收'] || 0);
  summaryEl.innerHTML =
    '<div class="boardCard"><div class="num">' + chapters.length + '</div><div class="lbl">章节总数</div></div>' +
    '<div class="boardCard"><div class="num">' + done + '</div><div class="lbl">已写</div></div>' +
    '<div class="boardCard"><div class="num">' + draft + '</div><div class="lbl">草稿</div></div>' +
    '<div class="boardCard"><div class="num">' + empty + '</div><div class="lbl">空</div></div>' +
    '<div class="boardCard"><div class="num">' + totalWords.toLocaleString() + '</div><div class="lbl">章节总字数</div></div>' +
    '<div class="boardCard"><div class="num">' + foreshadows.length + '</div><div class="lbl">伏笔总数</div></div>' +
    '<div class="boardCard"><div class="num">' + fbOpen + '</div><div class="lbl">未回收伏笔</div></div>';
  let html = '<h4 style="margin:6px 0 8px">章节状态</h4>';
  if (!chapters.length) html += '<div class="empty">暂无章节</div>';
  else {
    html += '<table class="boardTable"><thead><tr><th>卷</th><th>章节</th><th>字数</th><th>状态</th></tr></thead><tbody>';
    for (const c of chapters) {
      const vol = volumeKeyOf(c);
      const len = (c.content || '').replace(/\s+/g, '').length;
      const st = len === 0 ? { key: 'empty', label: '空' } : (len < 500 ? { key: 'draft', label: '草稿' } : { key: 'done', label: '已写' });
      html += '<tr class="clickable" data-id="' + c.id + '"><td>' + escapeHtml(vol) + '</td><td>' + escapeHtml(c.title) + '</td><td>' + len.toLocaleString() + '</td><td><span class="statusBadge ' + st.key + '">' + st.label + '</span></td></tr>';
    }
    html += '</tbody></table>';
  }
  html += '<h4 style="margin:16px 0 8px">伏笔状态</h4>';
  if (!foreshadows.length) html += '<div class="empty">暂无伏笔</div>';
  else {
    html += '<table class="boardTable"><thead><tr><th>伏笔</th><th>状态</th></tr></thead><tbody>';
    for (const f of foreshadows) {
      const st = parseForeshadowStatus(f) || '未标记';
      const cls = st === '已埋' ? 'open' : (st === '计划回收' ? 'plan' : 'empty');
      html += '<tr class="clickable" data-id="' + f.id + '"><td>' + escapeHtml(f.title) + '</td><td><span class="statusBadge ' + cls + '">' + escapeHtml(st) + '</span></td></tr>';
    }
    html += '</tbody></table>';
  }
  bodyEl.innerHTML = html;
  bodyEl.querySelectorAll('tr.clickable').forEach(tr => {
    tr.addEventListener('click', () => {
      closeBoard();
      focusNode(tr.dataset.id);
    });
  });
}

function openBoard() {
  const m = document.getElementById('boardModal');
  if (m) m.classList.add('show');
  renderBoard();
}

function closeBoard() {
  const m = document.getElementById('boardModal');
  if (m) m.classList.remove('show');
}

// ── Diff 确认覆盖（Agent 新内容 -> 提案 -> 写回）───────────────
let pendingDiff = null;
function openDiffModal(node, newContent) {
  if (!node) return;
  pendingDiff = { nodeId: node.id, title: node.title, file: node.file, oldContent: node.content || '', isChapter: isChapterNode(node) };
  document.getElementById('diffOld').textContent = pendingDiff.oldContent;
  document.getElementById('diffNew').textContent = String(newContent || '');
  document.getElementById('diffMeta').textContent = pendingDiff.file + ' · ' + pendingDiff.title;
  document.getElementById('diffModal').classList.add('show');
}
async function applyDiff() {
  if (!pendingDiff) return;
  const btn = document.getElementById('diffApply');
  const newContent = document.getElementById('diffNew').textContent;
  btn.disabled = true;
  btn.textContent = '写入中...';
  try {
    const res = await fetch('/api/propose_node_edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pendingDiff.nodeId, content: newContent, project: currentProject })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const applyRes = await fetch('/api/apply_proposal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: data.proposal.id, project: currentProject })
    });
    const applyData = await applyRes.json();
    if (applyData.error) throw new Error(applyData.error);
    const title = pendingDiff.title;
    const confirmedNodeId = pendingDiff.nodeId;
    const shouldAutoAdvance = pendingDiff.isChapter;
    closeDiffModal();
    await loadData();
    if (egoNodeId && nodeMap[egoNodeId]) focusNode(egoNodeId);
    addMsg('assistant', '已覆盖文件：' + title);
    if (shouldAutoAdvance) runAdvance(confirmedNodeId);
  } catch (e) {
    showToast('覆盖失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '覆盖文件';
  }
}
function closeDiffModal() {
  const m = document.getElementById('diffModal');
  if (m) m.classList.remove('show');
  pendingDiff = null;
}

// ── 手动连线管理 ──────────────────────────────────────────
function openLinkManager() {
  const m = document.getElementById('linkModal');
  if (m) m.classList.add('show');
  renderLinkManager();
}
function closeLinkManager() {
  const m = document.getElementById('linkModal');
  if (m) m.classList.remove('show');
}
function renderLinkManager() {
  const list = document.getElementById('linkList');
  const check = document.getElementById('showAllLinks');
  if (check) check.checked = showAllCustomLinks;
  // v1.11：自由布局移除（端口拖拽建线不再可用）→ 连线管理弹窗内提供 A→B 下拉创建
  const fromSel = document.getElementById('linkFromSel');
  const toSel = document.getElementById('linkToSel');
  if (fromSel && toSel && !fromSel.dataset.filled) {
    const opts = nodes
      .filter(n => !isGlobalBoardNode(n))
      .map(n => `<option value="${escapeHtml(n.id)}">${escapeHtml(n.title || n.label || n.id)}</option>`)
      .join('');
    fromSel.innerHTML = '<option value="">— 起点 —</option>' + opts;
    toSel.innerHTML = '<option value="">— 终点 —</option>' + opts;
    fromSel.dataset.filled = '1';
  }
  if (!list) return;
  if (!customLinks.length) {
    list.innerHTML = '<div class="linkEmpty">还没有手动连线。用上方下拉选择起点与终点即可创建</div>';
    return;
  }
  list.innerHTML = '';
  for (const [a, b] of customLinks) {
    const na = nodeMap[a], nb = nodeMap[b];
    const row = document.createElement('div');
    row.className = 'linkRow';
    const names = document.createElement('div');
    names.className = 'linkNames';
    names.innerHTML = '<span>' + escapeHtml(na ? na.title : a) + '</span><span class="linkArrow">→</span><span>' + escapeHtml(nb ? nb.title : b) + '</span>';
    const del = document.createElement('button');
    del.className = 'linkDelete';
    del.textContent = '删除';
    del.addEventListener('click', () => {
      customLinks = customLinks.filter(p => !((p[0] === a && p[1] === b) || (p[0] === b && p[1] === a)));
      saveLayout();
      redrawEdges();
      renderLinkManager();
    });
    row.appendChild(names);
    row.appendChild(del);
    list.appendChild(row);
  }
}

// ── ComfyUI 风格手动连线 ──────────────────────────────────
let connectFrom = null;
let tempLine = null;
function edgeD(x1, y1, x2, y2) {
  const dx = Math.max(40, Math.min(140, Math.abs(x2 - x1) * 0.55));
  return 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + dx) + ' ' + y1 + ', ' + (x2 - dx) + ' ' + y2 + ', ' + x2 + ' ' + y2;
}
function getPortWorldPos(nodeId, which) {
  const el = world.querySelector(`.node[data-id="${nodeId}"] .port.${which}`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
}
function startConnect(fromId) {
  connectFrom = fromId;
  if (!tempLine) {
    tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempLine.setAttribute('fill', 'none');
    tempLine.setAttribute('stroke', '#f5c56b');
    tempLine.setAttribute('stroke-width', '2');
    tempLine.setAttribute('stroke-dasharray', '4 4');
    tempLine.setAttribute('stroke-linecap', 'round');
    edgesSvg.appendChild(tempLine);
  }
  const p = getPortWorldPos(fromId, 'out') || { x: (positions[fromId] || { x: 0 }).x + 190, y: (positions[fromId] || { y: 0 }).y + 32 };
  tempLine.setAttribute('d', edgeD(p.x, p.y, p.x, p.y));
  document.querySelectorAll('#world .port.in').forEach(el => el.classList.add('connectable'));
  world.classList.add('connecting');
  window.addEventListener('mousemove', moveConnect);
}
function moveConnect(e) {
  if (!tempLine || !connectFrom) return;
  const p = screenToWorld(e.clientX, e.clientY);
  const from = getPortWorldPos(connectFrom, 'out') || { x: (positions[connectFrom] || { x: 0 }).x + 190, y: (positions[connectFrom] || { y: 0 }).y + 32 };
  tempLine.setAttribute('d', edgeD(from.x, from.y, p.x, p.y));
}
function endConnect() {
  window.removeEventListener('mousemove', moveConnect);
  if (tempLine) { tempLine.remove(); tempLine = null; }
  document.querySelectorAll('#world .port.connectable').forEach(el => el.classList.remove('connectable'));
  world.classList.remove('connecting');
  connectFrom = null;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && connectFrom) endConnect();
});
function addCustomLink(a, b) {
  const exists = customLinks.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  if (!exists) customLinks.push([a, b]);
  saveLayout();
  redrawEdges();
}
function redrawEdges() {
  let svg = '<path d="M0 0" style="display:none"/>';
  const isHidden = (el) => el && (el.style.display === 'none' || el.closest('.nodeBoard.collapsed'));
  if (autoLinkEnabled && egoNodeId) {
    for (const [a, b] of links) {
      if (a !== egoNodeId && b !== egoNodeId) continue;
      const na = nodeMap[a], nb = nodeMap[b];
      if (!na || !nb) continue;
      const pa = positions[na.id] || { x: 0, y: 0 };
      const pb = positions[nb.id] || { x: 0, y: 0 };
      const elA = world.querySelector(`.node[data-id="${a}"]`);
      const elB = world.querySelector(`.node[data-id="${b}"]`);
      if (isHidden(elA) || isHidden(elB)) continue;
      const left = pa.x <= pb.x ? [pa, pb] : [pb, pa];
      const d = edgeD(left[0].x + 190, left[0].y + 32, left[1].x, left[1].y + 32);
      svg += `<path class="autoEdge" d="${d}"></path>`;
    }
  }
  if (egoNodeId || showAllCustomLinks) {
    for (const [a, b] of customLinks) {
      if (!showAllCustomLinks && a !== egoNodeId && b !== egoNodeId) continue;
      const na = nodeMap[a], nb = nodeMap[b];
      if (!na || !nb || isGlobalBoardNode(na) || isGlobalBoardNode(nb)) continue;
      const pa = getPortWorldPos(a, 'out') || { x: (positions[na.id] || { x: 0 }).x + 190, y: (positions[na.id] || { y: 0 }).y + 32 };
      const pb = getPortWorldPos(b, 'in') || { x: (positions[nb.id] || { x: 0 }).x, y: (positions[nb.id] || { y: 0 }).y + 32 };
      const d = edgeD(pa.x, pa.y, pb.x, pb.y);
      svg += `<path class="customEdge" data-a="${a}" data-b="${b}" d="${d}"></path>`;
    }
  }
  edgesSvg.innerHTML = svg;
  edgesSvg.querySelectorAll('path.customEdge').forEach(l => {
    l.addEventListener('click', (e) => {
      e.stopPropagation();
      customLinks = customLinks.filter(p => !((p[0] === l.dataset.a && p[1] === l.dataset.b) || (p[0] === l.dataset.b && p[1] === l.dataset.a)));
      saveLayout();
      redrawEdges();
      const h = document.getElementById('edgeDeleteHint');
      h.classList.add('show');
      setTimeout(() => h.classList.remove('show'), 1400);
    });
  });
  updateEgoHighlight();
  redrawAxisEdges();
}

// ── 进度轴视图连线（v1.11：连线搬进进度轴，自由布局移除）────────
// 端点取自 #axisNodes 内实际卡片位置（axis 内容坐标），随 inner transform 一起平移缩放
function axisNodePos(id) {
  const el = document.querySelector(`#axisNodes .node[data-id="${id}"]`);
  if (!el) return null;
  return { x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0 };
}
function axisEdgeD(a, b) {
  const pa = axisNodePos(a), pb = axisNodePos(b);
  if (!pa || !pb) return null;
  const left = pa.x <= pb.x ? [pa, pb] : [pb, pa];
  return edgeD(left[0].x + axisCardW, left[0].y + 17, left[1].x, left[1].y + 17);
}
function redrawAxisEdges() {
  const svg = document.getElementById('axisEdges');
  if (!svg) return;
  const isHidden = (el) => el && (el.style.display === 'none' || el.closest('.nodeBoard.collapsed'));
  let out = '<path d="M0 0" style="display:none"/>';
  if (autoLinkEnabled && egoNodeId) {
    for (const [a, b] of links) {
      if (a !== egoNodeId && b !== egoNodeId) continue;
      const na = nodeMap[a], nb = nodeMap[b];
      if (!na || !nb) continue;
      const elA = document.querySelector(`#axisNodes .node[data-id="${a}"]`);
      const elB = document.querySelector(`#axisNodes .node[data-id="${b}"]`);
      if (isHidden(elA) || isHidden(elB)) continue;
      const d = axisEdgeD(a, b);
      if (d) out += `<path class="autoEdge" data-a="${a}" data-b="${b}" d="${d}"></path>`;
    }
  }
  if (egoNodeId || showAllCustomLinks) {
    for (const [a, b] of customLinks) {
      if (!showAllCustomLinks && a !== egoNodeId && b !== egoNodeId) continue;
      const na = nodeMap[a], nb = nodeMap[b];
      if (!na || !nb || isGlobalBoardNode(na) || isGlobalBoardNode(nb)) continue;
      const d = axisEdgeD(a, b);
      if (d) out += `<path class="customEdge" data-a="${a}" data-b="${b}" d="${d}"></path>`;
    }
  }
  svg.innerHTML = out;
  svg.querySelectorAll('path.customEdge').forEach(l => {
    l.addEventListener('click', (e) => {
      e.stopPropagation();
      customLinks = customLinks.filter(p => !((p[0] === l.dataset.a && p[1] === l.dataset.b) || (p[0] === l.dataset.b && p[1] === l.dataset.a)));
      saveLayout();
      redrawEdges();
      redrawAxisEdges();
      const h = document.getElementById('edgeDeleteHint');
      if (h) { h.classList.add('show'); setTimeout(() => h.classList.remove('show'), 1400); }
    });
  });
}
// 拖动中：只更新与该节点相连的连线（避免每次 mousemove 重建全部 path）
function updateAxisEdgesFor(id) {
  const svg = document.getElementById('axisEdges');
  if (!svg) return;
  svg.querySelectorAll(`path[data-a="${id}"], path[data-b="${id}"]`).forEach(p => {
    const a = p.dataset.a, b = p.dataset.b;
    const d = axisEdgeD(a, b);
    if (d) p.setAttribute('d', d);
  });
}
function renderMarkdown(text) {
  let s = String(text || '');
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = s.split('\n');
  let html = '', inList = false, inTable = false;
  for (const line of lines) {
    const t = line.trim();
    if (/^\|.*\|\s*$/.test(t) && t.split('|').length > 2) {
      if (!inTable) { html += '<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:12px">'; inTable = true; }
      html += '<tr>' + t.split('|').filter((_, i) => i > 0 && i < t.split('|').length - 1).map(c => '<td>' + c.trim() + '</td>').join('') + '</tr>';
      continue;
    }
    if (inTable) { html += '</table>'; inTable = false; }
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += '<li>' + line.replace(/^\s*[-*]\s+/, '') + '</li>';
      continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    if (/^#{1,4}\s/.test(line)) {
      const lvl = line.match(/^#+/)[0].length;
      html += '<h' + lvl + ' style="margin:8px 0 4px;color:var(--accent)">' + line.replace(/^#+\s*/, '') + '</h' + lvl + '>';
    } else if (/^(-----|\*\*\*|___)$/.test(t)) {
      html += '<hr style="border:none;border-top:1px solid var(--panel-border);margin:8px 0">';
    } else if (t === '') {
      html += '<br>';
    } else {
      let c = line;
      c = c.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      c = c.replace(/`([^`]+)`/g, '<code style="background:rgba(15,23,42,.07);padding:0 4px;border-radius:4px">$1</code>');
      html += '<div>' + c + '</div>';
    }
  }
  if (inList) html += '</ul>';
  if (inTable) html += '</table>';
  return html;
}

function showDetail(n) {
  const a = nodeAxisData(n);
  const levels = (axisDef && axisDef.levels) || [];
  const typeOptions = ['role', 'faction', 'setting', 'outline', 'volume', 'chapter', 'foreshadow', 'context', 'unrecognized'].map(t =>
    '<option value="' + t + '"' + (n.type === t ? ' selected' : '') + '>' + typeToLabel(t) + '</option>').join('');
  // 剧情推进：显式覆盖（axisProgress[章号]）> 空（默认 y=x 对角线）
  const progVal = (a.chapter != null && axisProgress[a.chapter] != null) ? axisProgress[a.chapter] : '';
  detailBody.innerHTML =
    '<h2>' + escapeHtml(n.title) + '</h2>' +
    '<div class="meta">' + n.label + ' · ' + escapeHtml(n.file) + ' · 行 ' + n.startLine + '-' + n.endLine + '</div>' +
    '<div class="nodeProps">' +
      '<div class="propRow"><label>类型</label><select id="propType">' + typeOptions + '</select></div>' +
      '<div class="propRow"><label>章号</label><input id="propChapter" type="number" min="0" value="' + (a.chapter || '') + '" placeholder="未分配"></div>' +
      '<div class="propRow"><label>剧情推进(0-100)</label><input id="propProgress" type="number" min="0" max="100" value="' + progVal + '" placeholder="自动(y=x)"></div>' +
      '<div class="propRow"><label>泳道</label><input id="propLane" value="' + escapeHtml(a.lane || '') + '" placeholder="（v2）"></div>' +
      '<div class="propRow"><button id="propSave" title="保存属性（类型/章号/剧情推进/泳道写入项目布局覆盖）">保存属性</button></div>' +
    '</div>' +
    '<div style="font-size:11px;color:var(--muted);margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button id="copyIdBtn" style="padding:4px 10px;border:1px solid var(--panel-border);border-radius:8px;background:transparent;cursor:pointer;color:var(--muted)">复制节点ID</button>' +
      '<button id="previewToggle" style="padding:4px 10px;border:1px solid var(--panel-border);border-radius:8px;background:transparent;cursor:pointer;color:var(--muted)">预览</button>' +
      '<button id="detailAddChatBtn" title="将整个节点内容加入对话（引用标签，不直接发送）">添加到对话</button>' +
    '</div>' +
    '<div id="preview" style="overflow:auto;max-height:300px"></div>' +
    '<label>完整 Markdown 内容（保存会写回原文件）</label>' +
    '<textarea id="editContent">' + escapeHtml(n.content || '') + '</textarea>' +
    '<div class="btnRow"><button id="saveBtn">保存到项目文件</button></div>' +
    '<div class="status" id="saveStatus"></div>';
  const propSaveBtn = document.getElementById('propSave');
  if (propSaveBtn) {
    propSaveBtn.addEventListener('click', async () => {
      const patch = {
        type: document.getElementById('propType').value,
        label: typeToLabel(document.getElementById('propType').value),
        chapter: document.getElementById('propChapter').value === '' ? '' : Number(document.getElementById('propChapter').value),
        lane: document.getElementById('propLane').value
      };
      const progIn = document.getElementById('propProgress');
      const progVal = progIn ? progIn.value : '';
      try {
        const res = await fetch('/api/override', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: currentProject, id: n.id, patch })
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        layoutAxis[n.id] = { chapter: patch.chapter || null, level: null, lane: patch.lane || null };
        // 剧情推进（章级）：数字 → 写入 axisProgress；空 → 回退默认 y=x 对角线
        const ch = patch.chapter || null;
        if (ch != null) {
          if (progVal === '' || progVal == null) delete axisProgress[ch];
          else axisProgress[ch] = Math.max(0, Math.min(100, Number(progVal)));
        }
        if (patch.type && patch.type !== n.type) {
          layoutOverrides[n.id] = { ...(layoutOverrides[n.id] || {}), type: patch.type, label: patch.label };
          // 先落盘（axis/axisProgress/overrides 一并写入），再重载——避免 loadData 用旧文件清掉内存里的剧情推进
          clearTimeout(layoutTimer);
          await postLayout();
          await loadData();
          if (nodeMap[n.id]) showDetail(nodeMap[n.id]);
        } else {
          n.type = patch.type; n.label = patch.label;
          showToast('属性已保存', 'success');
          saveLayout();
          if (viewMode === 'axis') renderAxisView();
          else { renderNodes(); redrawEdges(); }
        }
      } catch (e) {
        showToast('保存属性失败：' + e.message, 'error');
      }
    });
  }
  const editArea = document.getElementById('editContent');
  const previewEl = document.getElementById('preview');
  // 浮动选中工具条（Trae 风格）：编辑区/预览里选中文字 → 弹出「添加到对话」（整节点加入走右键菜单或「添加到对话」按钮）
  hookSelToolbar(editArea, true, (sel, start, end, full) => {
    const lineRange = computeLineRange(full, start, end);
    return {
      add: () => {
        addSelectionToChat(n.file, n.title, sel, lineRange, n.label || '节点');
        const status = document.getElementById('saveStatus');
        if (status) status.textContent = '已添加引用「' + (n.file || n.title) + (lineRange ? ' 行' + lineRange : '') + '」，可在输入框继续输入问题后发送';
      },
      edit: () => { editArea.style.display = ''; editArea.focus(); }
    };
  });
  if (previewEl) {
    hookSelToolbar(previewEl, false, (sel) => ({
      add: () => {
        addSelectionToChat(n.file, n.title, sel, '', n.label || '节点');
        const status = document.getElementById('saveStatus');
        if (status) status.textContent = '已添加引用「' + (n.file || n.title) + '」，可在输入框继续输入问题后发送';
      },
      edit: () => { editArea.style.display = ''; editArea.focus(); }
    }));
  }
  document.getElementById('copyIdBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(n.id).then(() => { const b = document.getElementById('copyIdBtn'); b.textContent = '已复制'; setTimeout(() => b.textContent = '复制节点ID', 1000); });
  });
  document.getElementById('previewToggle').addEventListener('click', () => {
    const btn = document.getElementById('previewToggle');
    if (btn.textContent.includes('预览') && !btn.dataset.on) {
      btn.dataset.on = '1';
      btn.textContent = '编辑';
      editArea.style.display = 'none';
      previewEl.style.display = 'block';
      previewEl.innerHTML = renderMarkdown(editArea.value);
    } else {
      btn.dataset.on = '';
      btn.textContent = '预览';
      editArea.style.display = 'block';
      previewEl.style.display = 'none';
    }
  });
  document.getElementById('detailAddChatBtn').addEventListener('click', () => {
    addSelectionToChat(n.file, n.title, n.content || n.desc || '', '', n.label || '节点', true);
    const status = document.getElementById('saveStatus');
    if (status) status.textContent = '已添加引用「' + (n.title || n.file) + '」，可在输入框继续输入问题后发送';
  });
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const content = editArea.value;
    const status = document.getElementById('saveStatus');
    status.textContent = '保存中...';
    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: n.id, content, project: currentProject })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      n.content = data.node.content || content;
      n.desc = (content.split('\n').find(l => l.trim() && !l.trim().startsWith('#')) || '').trim().slice(0, 100);
      const el = world.querySelector(`.node[data-id="${n.id}"]`);
      if (el) el.querySelector('.ndesc').textContent = n.desc;
      status.textContent = '已写回 ' + n.file;
      showToast('已写回 ' + n.file, 'success');
      await loadData();
      // loadData 会清空详情面板：保存后重新打开同一节点，写作流程不中断
      if (nodeMap[n.id]) showDetail(nodeMap[n.id]);
    } catch (e) {
      status.textContent = '保存失败: ' + e.message;
      showToast('保存失败: ' + e.message, 'error');
    }
  });
  const statusEl = document.getElementById('saveStatus');
  const counter = document.createElement('div');
  counter.style.cssText = 'font-size:11px;color:var(--muted);margin-top:4px';
  editArea.parentNode.insertBefore(counter, editArea.nextSibling);
  function updateCount() {
    const chars = editArea.value.replace(/\s/g, '').length;
    const lines = editArea.value.split('\n').length;
    counter.textContent = '字数（不含空白）：' + chars + ' · 行数：' + lines + ' · Ctrl+Z 撤销 · Ctrl+Shift+Z 重做 · Ctrl+S 保存';
  }
  editArea.addEventListener('input', updateCount);
  updateCount();
  // 撤销/重做：自维护历史栈（textarea 原生撤销在 showDetail / 刷新后被清空，这里保证 Ctrl+Z 始终可用）
  const undoStack = [];
  const redoStack = [];
  let undoLock = false;
  let lastValue = editArea.value;
  const doUndo = () => {
    if (!undoStack.length) return;
    undoLock = true;
    redoStack.push(editArea.value);
    editArea.value = undoStack.pop();
    lastValue = editArea.value;
    editArea.setSelectionRange(editArea.value.length, editArea.value.length);
    updateCount();
    undoLock = false;
  };
  const doRedo = () => {
    if (!redoStack.length) return;
    undoLock = true;
    undoStack.push(editArea.value);
    editArea.value = redoStack.pop();
    lastValue = editArea.value;
    editArea.setSelectionRange(editArea.value.length, editArea.value.length);
    updateCount();
    undoLock = false;
  };
  editArea.addEventListener('input', () => {
    if (undoLock) { lastValue = editArea.value; return; }
    if (lastValue !== editArea.value) {
      undoStack.push(lastValue);
      if (undoStack.length > 100) undoStack.shift();
      redoStack.length = 0;
      lastValue = editArea.value;
    }
    updateCount();
  });
  editArea.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) doRedo(); else doUndo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      doRedo();
    } else if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      const sb = document.getElementById('saveBtn');
      if (sb) sb.click();
    }
  });
  document.querySelectorAll('.item').forEach(b => b.classList.toggle('active', b.dataset.id === n.id));
}

function focusNode(id) {
  const n = nodeMap[id];
  if (!n) return;
  // 点侧栏节点 = "跳到这个节点"：清掉搜索关键字，避免该节点被搜索过滤隐藏
  if (search.value) {
    search.value = '';
    applyFilters();
  }
  if (!n.synthetic && collapsedGroups.has(n.label)) toggleGroup(n.label);
  if (!activeCats.has(n.label)) {
    activeCats.add(n.label);
    filterChips[n.label].classList.add('on');
    applyFilters();
  }
  showDetail(n);
  // 轴视图（唯一视图）：平移到该节点居中并短暂闪烁提示（对应"左侧栏点击跳转到画布位置"）
  const axisViewEl = document.getElementById('axisView');
  const axisFirst = axisViewEl && axisViewEl.style.display !== 'none';
  const axisEl = axisFirst ? document.querySelector(`#axisNodes .node[data-id="${id}"]`) : null;
  if (axisEl) {
    axisPanToNode(axisEl);
    axisEl.classList.add('flash');
    setTimeout(() => axisEl.classList.remove('flash'), 900);
    return;
  }
  const el = world.querySelector(`.node[data-id="${id}"]`);
  if (el) {
    el.style.transition = 'box-shadow .2s';
    el.style.boxShadow = '0 0 0 3px #ffd98a';
    setTimeout(() => { el.style.boxShadow = ''; }, 600);
  }
}

let layoutTimer = null;
const LAYOUT_VERSION = 3; // 布局文件版本：v3 为"确定性精确尺寸流式布局"（尺寸由孩子数量唯一决定，永不重叠）
// 立即写入布局（无防抖；返回 Promise，供"保存属性→重载"等需要先落盘再读的流程使用）
function postLayout() {
  return fetch('/api/layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nodes: positions,
      customLinks,
      version: LAYOUT_VERSION,
      mode: viewMode,
      axis: layoutAxis,
      axisProgress,
      axisBandMode,
      axisBands,
      axisSegSize,
      overrides: layoutOverrides,
      timelineNodes,
      project: currentProject
    })
  }).catch(() => {});
}
function saveLayout() {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(postLayout, 300);
}

// ── 布局工具 ──────────────────────────────────────────────
// 板块子网格列数：内容越多列数越多（3~4 列），避免单板过高
function boardCols(n) { return Math.min(4, Math.max(3, Math.ceil(Math.sqrt(Math.max(1, n))))); }
// 板块规范尺寸（由孩子数量唯一决定；与 ensureBoardContained 的网格算法一致，杜绝"估算≠实际"）
function boardGridSize(n, collapsed) {
  if (collapsed) return { w: 240, h: 64 };
  const pad = 20, headerH = 70, colGap = 220, rowGap = 145;
  const cols = boardCols(n);
  const rows = Math.ceil(Math.max(1, n) / cols);
  return { w: Math.max(420, pad + cols * colGap + 140), h: Math.max(180, headerH + rows * rowGap + 60) };
}
function cnNumToInt(s) {
  const cn = '零一二三四五六七八九';
  let num = 0, digit = 0;
  for (const ch of s) {
    const d = cn.indexOf(ch);
    if (d >= 1 && d <= 9) digit = d;
    else if (ch === '十') { num += (digit || 1) * 10; digit = 0; }
    else if (ch === '百') { num += (digit || 1) * 100; digit = 0; }
    else if (ch === '千') { num += (digit || 1) * 1000; digit = 0; }
    else if (ch === '零') digit = 0;
  }
  if (digit) num += digit;
  return num;
}
function volNum(key) {
  const s = key.replace('章节·', '');
  const m = s.match(/(\d+|[零一二三四五六七八九十百]+)/);
  if (!m) return 9999;
  const t = m[1];
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return cnNumToInt(t);
}

// ── 通用自适应布局算法 ────────────────────────────────────
// 任何项目、任何历史状态的布局，加载时都会做健康检查；发现几何问题就地修复，
// 问题严重则整体重排成干净网格。不依赖布局文件版本，天然适应各类项目。

// 板块规范顺序：章节卷（按阅读顺序）在前，内容分类固定顺序在后
function boardGroupOrder(groups) {
  const CAT_ORDER = ['设定', '大纲', '角色', '势力', '伏笔', '上下文', '未分类'];
  const volKeys = [], catKeys = [];
  for (const key in groups) {
    if (key.indexOf('章节') === 0) volKeys.push(key);
    else catKeys.push(key);
  }
  volKeys.sort((a, b) => volNum(a) - volNum(b));
  catKeys.sort((a, b) => {
    const ia = CAT_ORDER.indexOf(groups[a].board.label);
    const ib = CAT_ORDER.indexOf(groups[b].board.label);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return volKeys.concat(catKeys);
}

function rectOverlaps(a, b, tol) {
  const t = tol || 4;
  return a.x + a.w - t > b.x && b.x + b.w - t > a.x && a.y + a.h - t > b.y && b.y + b.h - t > a.y;
}

// 板块实际尺寸测量（纯函数，不写 positions）：
// 孩子若在网格范围内（含手动拖动），按真实位置算大小；孩子已逃逸则按规范尺寸（重排后即该尺寸）
function measureGroupSize(g) {
  const bp = positions[g.board.id] || { x: 0, y: 0 };
  const collapsed = collapsedGroups.has(g.base);
  if (collapsed) return { w: 240, h: 64 };
  let maxRx = 0, maxRy = 0, far = false;
  for (const c of g.children) {
    const p = positions[c.id];
    if (!p) { far = true; continue; }
    const rx = p.x - bp.x, ry = p.y - bp.y;
    maxRx = Math.max(maxRx, rx); maxRy = Math.max(maxRy, ry);
    if (rx < 0 || ry < 0 || rx > 600 || ry > 400) far = true;
  }
  if (far) return boardGridSize(g.children.length, collapsed);
  const pad = 20, headerH = 70, colGap = 220, rowGap = 145;
  const cols = boardCols(g.children.length);
  const rows = Math.ceil(Math.max(1, g.children.length) / cols);
  return {
    w: Math.max(420, pad + cols * colGap + 140, maxRx + 200),
    h: Math.max(180, headerH + rows * rowGap + 60, maxRy + 120)
  };
}

// 板块当前矩形（位置 + 实际尺寸）
function boardRectOf(g) {
  const bp = positions[g.board.id];
  const sz = measureGroupSize(g);
  return { x: bp ? bp.x : NaN, y: bp ? bp.y : NaN, w: sz.w, h: sz.h };
}

// 在已有占位下方找第一个不冲突的空位（从现有内容下方开始扫描，避免孤悬到远处）
function findFreeSlot(occupied, w, h) {
  const margin = 40, gap = 60;
  let startX = margin, startY = margin;
  if (occupied.length) {
    let minX = Infinity, maxY = -Infinity;
    for (const r of occupied) {
      minX = Math.min(minX, r.x);
      maxY = Math.max(maxY, r.y + r.h);
    }
    startX = minX; startY = maxY + gap;
  }
  let x = startX, y = startY;
  while (y < 100000) {
    let ok = true;
    for (const r of occupied) if (rectOverlaps({ x, y, w, h }, r)) { ok = false; break; }
    if (ok) return { x, y };
    x += w + gap;
    if (x > 8000) { x = startX; y += h + gap; }
  }
  return { x: startX, y: 100000 };
}

// 布局健康检查：返回全部问题（通用，不针对具体项目）
function layoutHealth() {
  const groups = boardGroups();
  const ordered = boardGroupOrder(groups);
  const problems = [];
  const occupied = [];
  const valid = new Set(nodes.map(n => n.id));
  for (const key in groups) valid.add(groups[key].board.id);

  for (const key of ordered) {
    const g = groups[key];
    const r = boardRectOf(g);
    if (!isFinite(r.x) || !isFinite(r.y) || r.x < -50 || r.y < -50) {
      problems.push({ type: 'board-missing', key });
    } else if (occupied.some(o => rectOverlaps(r, o))) {
      problems.push({ type: 'board-overlap', key });
    } else {
      occupied.push(r);
    }
    // 展开板的子节点逃逸检查（距板太远视为损坏）
    if (!collapsedGroups.has(g.base) && isFinite(r.x)) {
      for (const c of g.children) {
        const p = positions[c.id];
        if (!p) { problems.push({ type: 'child-escaped', key }); break; }
        if (p.x < r.x - 500 || p.x > r.x + r.w + 500 || p.y < r.y - 500 || p.y > r.y + r.h + 500) {
          problems.push({ type: 'child-escaped', key }); break;
        }
      }
    }
  }
  // 孤儿坐标（已删除/重命名节点残留）
  for (const id of Object.keys(positions)) {
    if (!valid.has(id)) { problems.push({ type: 'orphan' }); break; }
  }
  // 布局蔓延：内容区域 vs 板块面积和严重失衡 → 旧的纵向列布局特征
  if (occupied.length >= 2) {
    const sumArea = occupied.reduce((s, r) => s + r.w * r.h, 0);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id in positions) {
      const p = positions[id];
      if (!p || !isFinite(p.x)) continue;
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + 200); maxY = Math.max(maxY, p.y + 90);
    }
    if (isFinite(minX)) {
      const bboxArea = Math.max(1, (maxX - minX + 80) * (maxY - minY + 80));
      if (bboxArea > sumArea * 10) problems.push({ type: 'sprawl' });
    }
    // 板块孤悬：某板块离上方/左侧板块群超过 500px 空白带 → 布局散乱
    // 纵向：按顶部排序，若顶部远大于前面所有板块的底部最大值 → 孤悬
    const sortedV = occupied.slice().sort((a, b) => a.y - b.y);
    let maxBottom = -Infinity;
    for (const r of sortedV) {
      if (maxBottom > -Infinity && r.y > maxBottom + 500) { problems.push({ type: 'sprawl' }); break; }
      maxBottom = Math.max(maxBottom, r.y + r.h);
    }
    if (!problems.length || !problems.some(p => p.type === 'sprawl')) {
      // 横向：按左侧排序，若左侧远大于前面所有板块的右侧最大值 → 孤悬
      const sortedH = occupied.slice().sort((a, b) => a.x - b.x);
      let maxRight = -Infinity;
      for (const r of sortedH) {
        if (maxRight > -Infinity && r.x > maxRight + 500) { problems.push({ type: 'sprawl' }); break; }
        maxRight = Math.max(maxRight, r.x + r.w);
      }
    }
  }
  return { problems, ordered };
}

// 自适应修复：小问题就地修（保留健康板位置），大问题整体重排
function repairLayout() {
  const { problems, ordered } = layoutHealth();
  if (!problems.length) return false;
  const groups = boardGroups();
  let changed = false;

  const severe = problems.filter(p => p.type === 'board-missing' || p.type === 'board-overlap' || p.type === 'sprawl').length;
  // 蔓延是全局性问题，无法局部修复 → 只要检测到就必须整体重排
  const hasSprawl = problems.some(p => p.type === 'sprawl');
  if (hasSprawl || problems.length >= Math.max(2, ordered.length) || severe > ordered.length / 2) {
    // 严重损坏 → 整体重排成干净网格
    computeAutoLayout();
    return true;
  }

  // ── 手术式修复：只动坏的部分 ──
  // 1. 孤儿坐标删除
  const valid = new Set(nodes.map(n => n.id));
  for (const key in groups) valid.add(groups[key].board.id);
  for (const id of Object.keys(positions)) {
    if (!valid.has(id)) { delete positions[id]; changed = true; }
  }
  // 2. 先按现有位置算真实板大小 + 重排逃逸孩子
  for (const key of ordered) ensureBoardContained(groups[key]);
  // 3. 按序收集健康板占位，缺失/重叠的板放到现有内容下方的空位
  const occupied = [];
  for (const key of ordered) {
    const g = groups[key];
    const r = boardRectOf(g);
    const bad = !isFinite(r.x) || !isFinite(r.y) || r.x < -50 || r.y < -50 || occupied.some(o => rectOverlaps(r, o));
    if (bad) {
      const spot = findFreeSlot(occupied, r.w, r.h);
      positions[g.board.id] = { x: spot.x, y: spot.y };
      if (!collapsedGroups.has(g.base)) ensureBoardContained(g); // 孩子跟着板走 + 算出真实大小
      const r2 = boardRectOf(g);
      occupied.push({ x: spot.x, y: spot.y, w: r2.w, h: r2.h });
      changed = true;
    } else {
      occupied.push(r);
    }
  }
  return changed;
}

// 自动排列（v3 确定性精确尺寸流式布局）：板块顺序固定（章节卷→内容分类），
// 尺寸按孩子数量唯一确定（无估算误差），行内从左到右流式放置、超宽自动换行，
// 因此任何内容量下都不会重叠——同一内容永远得到同一份干净布局。
function computeAutoLayout() {
  const groups = boardGroups();
  const ordered = boardGroupOrder(groups);

  const margin = 40, gap = 40, maxRowW = 2800;
  let x = margin, y = margin, rowH = 0;
  for (const key of ordered) {
    const g = groups[key];
    const sz = boardGridSize(g.children.length, collapsedGroups.has(g.base));
    if (x > margin && x + sz.w > maxRowW) { x = margin; y += rowH + gap; rowH = 0; }
    positions[g.board.id] = { x, y };
    // 孩子按最终板块位置重排进网格，板块尺寸即规范值
    ensureBoardContained(g, true);
    x += sz.w + gap;
    rowH = Math.max(rowH, sz.h);
  }
  // 清理孤儿坐标（文件里残留的旧 id）
  const valid = new Set(nodes.map(n => n.id));
  for (const key in groups) valid.add(groups[key].board.id);
  for (const id of Object.keys(positions)) if (!valid.has(id)) delete positions[id];
}

function autoLayout() {
  computeAutoLayout();
  renderNodes();
  redrawEdges();
  saveLayout();
  fitView();
}

// 视野适配：把所有板（+内容）缩放到可视区域内
function fitView() {
  const rect = canvasWrap.getBoundingClientRect();
  const groups = boardGroups();
  const byId = {};
  for (const key in groups) byId[groups[key].board.id] = groups[key];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id in positions) {
    const g = byId[id];
    if (!g) continue;
    const p = positions[id];
    const sz = boardGridSize(g.children.length, collapsedGroups.has(g.base));
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + sz.w); maxY = Math.max(maxY, p.y + sz.h);
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = rect.width; maxY = rect.height; }
  const pad = 40;
  const bw = maxX - minX + pad * 2;
  const bh = maxY - minY + pad * 2;
  const scale = Math.max(0.2, Math.min(1, Math.min(rect.width / bw, rect.height / bh)));
  view.scale = scale;
  view.x = (rect.width - bw * scale) / 2 - minX * scale + pad * scale;
  view.y = (rect.height - bh * scale) / 2 - minY * scale + pad * scale;
  updateView();
}

// ── 大一统框架：进度轴视图（单轴，泳道 v3）──────────────────
// 渲染器不"认识"任何题材：X = 章号（每章一列，列宽随卡片数自适应），Y = 层级泳道。
// Y 轴方向：开端(第 0 层)在最底部，结局(最后一层)在最顶部，未分类带仅作兜底。
// 卡片在 (章, 层级) 格内横向 lane 展开（沿 X 轴铺开），不纵向深堆叠；
// 有章号的节点 → 对应章列泳道；无章号的节点（角色/大纲/设定/未识别）→ 顶部未分类带横向 lane，
// 不再 round-robin 塞进章列（避免无关卡片挤占章节轴的横向排布）。
const axisColW = 280;   // 每章最小列宽（v1.10 起仅兜底，实际按章段聚合）
const axisRowH = 100;   // 剧情推进轴高度单位（plotH = 6 行高，默认 600px）
const axisCardW = 130;  // 轴内紧凑卡片宽（index.html CSS 同步）
const axisLaneStep = 138; // 格内卡片横向步进 = 卡宽 + 8 间隙
const MAX_AXIS_SEGMENTS = 20; // X 轴最多聚合为多少列（章节太多时按段分组，避免横向爆炸）
const AXIS_SEG_MIN_W = 150;   // 每段最小列宽(px)
const axisPadL = 150;   // 左侧 Y 轴标签区
const axisPadT = 40;    // 顶部（未分类带之下）
const axisPadR = 40;
const axisPadB = 100;   // 底部：X 章号标签 + 底部导航条(38px)留白
// 轴视图的平移/缩放状态（与自由视图独立）：屏幕 = 内容 * scale + (x, y)
let axisViewT = { x: 0, y: 0, scale: 1 };
let axisPanning = false, axisPanStartX = 0, axisPanStartY = 0;
// 最近一次轴布局几何（渲染时计算，fit/拖动反算复用）
let axisGeom = null;

// ── v1.9 Y 轴分段（bands）──
// 从章节文件路径找所属卷目录（从父目录向上找第一个含"卷"的目录）
function volumeFromPath(n) {
  const parts = (n.file || '').split(/[\\/]/);
  for (let i = parts.length - 2; i >= 0; i--) {
    if (/卷/.test(parts[i])) return parts[i];
  }
  return null;
}
// 卷名排序键：第X卷 → 数字；其余按原文
function volumeSortKey(name) {
  const m = String(name).match(/第\s*([0-9一二三四五六七八九十百]+)\s*卷/);
  if (!m) return 'z' + name;
  const cn = m[1];
  const digits = { 一:1, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 十:10 };
  if (/^\d+$/.test(cn)) return String(parseInt(cn, 10)).padStart(3, '0') + name;
  let n = 0;
  if (digits[cn] != null) n = digits[cn];
  else if (/^十/.test(cn)) n = 10 + (digits[cn[1]] || 0);
  else if (/十$/.test(cn)) n = (digits[cn[0]] || 1) * 10;
  else {
    for (const ch of cn) {
      if (digits[ch] != null) { n = n * 10 + digits[ch]; }
      else if (ch === '十') { n = (n || 1) * 10; }
    }
  }
  return String(n).padStart(3, '0') + name;
}
// 检测项目的卷列表（来自章节文件所在目录）
function detectVolumeBands() {
  const set = new Set();
  for (const n of nodes) {
    if (n.label !== '章节') continue;
    const v = volumeFromPath(n);
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => volumeSortKey(a).localeCompare(volumeSortKey(b), 'zh'));
}
// 解析 Y 轴分段：显式选择（realm/plot/progress）> 卷自动检测 > null（需询问）
function resolveAxisBands() {
  if (axisBandMode === 'progress') return null;                 // 显式按进度 → 不分段
  if (axisBandMode === 'realm' || axisBandMode === 'plot') {
    if (axisBands && axisBands.length) return { mode: axisBandMode, bands: axisBands };
    return null;                                                // 选了模式但没名称 → 视为未设置
  }
  const vols = detectVolumeBands();
  if (vols.length) return { mode: 'volume', bands: vols, auto: true };
  if (axisBandMode && axisBands && axisBands.length) return { mode: axisBandMode, bands: axisBands };
  return null;
}
// 有无章节（询问分段方式的前提：空轴无需询问）
function axisHasChapters() {
  return nodes.some(n => n.label === '章节');
}
// 询问作者 Y 轴分段方式（无卷项目）：按境界 / 按剧情关键节点 / 按进度
function maybeAskAxisBands() {
  if (__axisBandAskShown) return;
  if (resolveAxisBands()) return;      // 已有分段（卷自动/已持久化）→ 不问
  if (!axisHasChapters()) return;      // 无章节 → 空轴，问分段无意义
  __axisBandAskShown = true;
  openAxisYModal();
}
function closeAxisBandAsk() {
  const m = document.getElementById('axisYModal');
  if (m) m.classList.remove('show');
}
// 打开 Y 轴划分方式弹窗（无卷询问 + 底部工具条手动打开共用）
// preferredMode：'realm'|'plot'|'progress'|''（'' = 沿用当前）；确定后才提交 axisBandMode/axisBands
function openAxisYModal(preferredMode) {
  const m = document.getElementById('axisYModal');
  if (!m) return;
  // 预选 radio：preferredMode > 当前 axisBandMode > 默认 nodes
  const mode = preferredMode || axisBandMode || 'plot';
  const radioVal = mode === 'realm' ? 'realm' : (mode === 'progress' ? 'progress' : 'nodes');
  const radio = m.querySelector('input[name="axisYRadio"][value="' + radioVal + '"]');
  if (radio) radio.checked = true;
  // 预填分段名：已有 bands → 当前值；否则按模式给默认示例
  const ta = document.getElementById('axisYBandsInput');
  if (ta) {
    if (axisBands && axisBands.length) ta.value = axisBands.join('\n');
    else ta.value = (mode === 'realm'
      ? ['练气', '筑基', '金丹', '元婴']
      : (axisDef && axisDef.levels) || ['开端', '发展', '高潮', '结局']).join('\n');
  }
  m.classList.add('show');
}

// 计算轴布局几何：章号分配 + 每章列宽（自适应）+ 卡片横向 lane 位置 + 剧情推进 y
// v1.8：Y 从"4 条离散泳道"升级为"连续剧情推进轴 0~100%"——章号越大 y 越高（默认对角线 y=x），
// 层级名称（开端/发展/高潮/结局）仅作参考网格线；拖节点上下可调该章剧情推进。
function computeAxisLayout() {
  const levels = (axisDef && axisDef.levels) || [];
  const items = [];
  let maxChapter = 1;
  for (const n of nodes) {
    if (isGlobalBoardNode(n)) continue;
    const a = nodeAxisData(n);
    if (a.chapter) maxChapter = Math.max(maxChapter, Number(a.chapter));
    items.push({ n, a });
  }
  maxChapter = Math.max(3, maxChapter); // 至少 3 列，避免过窄
  const all = items;
  // v1.9 Y 轴分段：卷/境界/剧情节点 bands（自下而上）
  const bandInfo = resolveAxisBands();
  let bands = bandInfo ? bandInfo.bands : null;
  const bandMode = bandInfo ? bandInfo.mode : '';
  const maxCh1 = Math.max(1, maxChapter);
  // 先统一计算章号（effCh），后续卷分组/推进都依赖它
  for (const p of all) {
    p.effCh = p.a.chapter ? Math.max(1, Math.min(maxChapter, Number(p.a.chapter))) : null; // null = 未分章
  }
  // 卷模式下：有章节不在任何卷目录 → 追加「未分卷」兜底带（渲染/分布/标签统一纳入；须在 effCh 计算后判定）
  if (bandMode === 'volume' && bands && bands.length && bands.indexOf('未分卷') < 0) {
    const hasUnvol = all.some(p => p.effCh != null && !volumeFromPath(p.n));
    if (hasUnvol) bands = bands.concat(['未分卷']);
  }
  const NB = bands ? bands.length : 0;
  // 卷模式下：每卷章节（按章号排序）→ 带内 rank
  const volChapters = {};
  if (bandMode === 'volume' && NB) {
    for (const b of bands) volChapters[b] = [];
    for (const p of all) {
      if (p.effCh == null) continue;
      const v = volumeFromPath(p.n);
      const key = (v && bands.indexOf(v) >= 0) ? v : (bands.indexOf('未分卷') >= 0 ? '未分卷' : null);
      if (key && volChapters[key]) volChapters[key].push(p);
    }
    for (const b of bands) volChapters[b].sort((x, y) => x.effCh - y.effCh);
  }
  for (const p of all) {
    // 剧情推进 0~100：显式覆盖（axisProgress[章号]）> 分段默认：
    //  · 卷模式：带内按章号均匀铺开（首章=带底，末章≈带顶，末卷末章也不到 100%）
    //  · 境界/剧情节点：按章号比例分布（默认对角线，作者可拖拽细化）
    //  · 无分段：统一公式 (章号-1)/最大章 —— 任何规模项目成立，无项目特调
    let prog = null;
    if (p.effCh != null) {
      if (axisProgress[p.effCh] != null) {
        prog = Math.max(0, Math.min(100, Number(axisProgress[p.effCh])));
      } else if (NB) {
        if (bandMode === 'volume') {
          const v = volumeFromPath(p.n);
          let vi = v != null ? bands.indexOf(v) : -1;
          if (vi < 0 && bands.indexOf('未分卷') >= 0) vi = bands.indexOf('未分卷'); // 未分卷章 → 兜底带
          if (vi >= 0) {
            const list = volChapters[bands[vi]] || [];
            const r = list.indexOf(p);            // 0-based rank
            const c = Math.max(1, list.length);
            prog = Math.round((vi + r / c) / NB * 100);
          } else {
            prog = Math.round((p.effCh - 1) / maxCh1 * 100);
          }
        } else {
          prog = Math.round((p.effCh - 1) / maxCh1 * 100);
        }
      } else {
        prog = Math.round((p.effCh - 1) / maxCh1 * 100);
      }
    }
    p.progress = prog;
  }

  // 每章卡片数 → 章段聚合（X）：章节太多时按段分组，最多 MAX_AXIS_SEGMENTS 列，避免横向爆炸
  const chCount = {};
  let unrecCount = 0;
  for (const p of all) {
    if (p.effCh == null) { unrecCount++; continue; }
    chCount[p.effCh] = (chCount[p.effCh] || 0) + 1;
  }
  const segSize = axisSegSize > 0 ? Math.max(1, axisSegSize) : Math.max(1, Math.ceil(maxChapter / MAX_AXIS_SEGMENTS));
  const nSegs = Math.ceil(maxChapter / segSize);
  const segOf = (ch) => Math.min(nSegs - 1, Math.max(0, Math.floor((Number(ch) - 1) / segSize)));
  const segW = {};    // 每段列宽(px)（段内单章最多卡片数决定）
  const segStart = {}; // 每段 X 起点
  let x = axisPadL;
  for (let s = 0; s < nSegs; s++) {
    const from = s * segSize + 1, to = Math.min(maxChapter, from + segSize - 1);
    let maxCells = 0;
    for (let ch = from; ch <= to; ch++) maxCells = Math.max(maxCells, chCount[ch] || 0);
    segW[s] = Math.max(AXIS_SEG_MIN_W, maxCells * axisLaneStep + 20);
    segStart[s] = x;
    x += segW[s] + 24; // 段间距
  }
  // 章切片（用于反查章号/跳转）：章在段内按比例细分，x 命中段内哪一格即哪章
  const chapterW = {};    // 章切片宽(px)
  const chapterStart = {}; // 章切片 X 起点
  for (let ch = 1; ch <= maxChapter; ch++) {
    const s = segOf(ch);
    const inner = Math.max(1, segW[s] - 20) / segSize;
    chapterStart[ch] = segStart[s] + (ch - (s * segSize + 1)) * inner;
    chapterW[ch] = inner;
  }

  // 未分类带高度：有无章号的节点时，横向 lane 展开一层
  const bandH = unrecCount ? 44 : 0;

  // Y：连续剧情推进轴。plotTop(顶=结局) → plotTop+plotH(底=开端)，未分类带在顶端之上
  // plotH 取 6 行高（600px）：长篇小说（80+ 章）对角线也清晰可见；层级仅作参考网格线
  const plotTop = axisPadT;
  const plotH = axisRowH * Math.max(6, levels.length || 4);
  const contentBottom = plotTop + plotH;
  // 层级参考网格线 y（level i：0=开端 底部 → n-1=结局 顶部）
  const levelY = {};
  const nLevels = Math.max(1, levels.length - 1);
  for (let i = 0; i < levels.length; i++) {
    levelY[i] = plotTop + (1 - i / nLevels) * plotH;
  }
  const bw = x - 24 + axisPadR;
  const bh = contentBottom + axisPadB - (axisPadT - bandH);

  // 分段几何：每个 band 等高切片（band 0=底部），band 间分界线 + 中心标签 y
  const bandLabelY = {}, bandBoundaryY = {};
  let bandHpx = 0;
  if (NB) {
    bandHpx = plotH / NB;
    for (let i = 0; i < NB; i++) {
      bandLabelY[i] = plotTop + (NB - 1 - i) * bandHpx + bandHpx / 2; // 带中心
      if (i > 0) bandBoundaryY[i] = plotTop + (NB - i) * bandHpx;     // 带 i 顶边（i>0）
    }
  }

  axisGeom = { levels, maxChapter, chapterW, chapterStart, bandH, plotTop, plotH, levelY, contentBottom, bw, bh, items: all, bands, bandMode, bandLabelY, bandBoundaryY, bandHpx, segSize, nSegs, segOf, segW, segStart };
  return axisGeom;
}

function axisBandTop() { return (axisGeom ? axisPadT - axisGeom.bandH : axisPadT - axisRowH); }

// 剧情推进 0~100 → 内容 y（0=底/开端，100=顶/结局）
function yForProgress(progress) {
  const g = axisGeom;
  const top = g ? g.plotTop : axisPadT;
  const h = g ? g.plotH : axisRowH * 6;
  return top + (1 - Math.max(0, Math.min(100, Number(progress) || 0)) / 100) * h;
}
// 内容 y → 剧情推进 0~100（拖拽反算）
function progressFromY(ny) {
  const g = axisGeom;
  const top = g ? g.plotTop : axisPadT;
  const h = g ? g.plotH : axisRowH * 6;
  return Math.max(0, Math.min(100, Math.round((1 - (ny - top) / h) * 100)));
}
// 内容 x → 章号（章段聚合下：段内按比例切片反查，拖拽/跳转共用）
function axisChapterFromX(nx) {
  const g = axisGeom;
  if (!g) return 1;
  let chapter = 1;
  for (let ch = 1; ch <= g.maxChapter; ch++) {
    const s = g.chapterStart[ch], w = g.chapterW[ch];
    if (nx >= s && nx < s + w) { chapter = ch; break; }
    if (nx < s) { chapter = ch; break; }
    chapter = ch;
  }
  return chapter;
}

// 时间线重要节点 → 进度轴 pins（X=章列中心，Y=剧情推进 0-100）
// 无显式 progress 时：优先用该章已设推进值，否则按章号比例默认（与节点 y=x 一致）
function timelineNodeProgress(tn, maxChapter) {
  if (tn.progress != null && !isNaN(Number(tn.progress))) return Math.max(0, Math.min(100, Number(tn.progress)));
  const ch = Number(tn.chapter) || 0;
  if (ch >= 1 && axisProgress[ch] != null) return Math.max(0, Math.min(100, Number(axisProgress[ch])));
  if (ch >= 1 && maxChapter > 1) return Math.round((ch - 1) / (maxChapter - 1) * 100);
  return 50;
}
function renderAxisTimelinePins() {
  const wrap = document.getElementById('axisTimeline');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!axisGeom) return;
  const g = axisGeom;
  const placed = []; // 已放置 pin 的占用区（用于同位置堆叠错位）
  const PIN_H = 22, PIN_W = 150, STACK_GAP = 4;
  for (const tn of timelineNodes) {
    const ch = Number(tn.chapter) || 0;
    if (ch < 1 || ch > g.maxChapter) continue; // 无章号/超范围：不在轴上画
    const prog = timelineNodeProgress(tn, g.maxChapter);
    const baseX = g.chapterStart[ch] + g.chapterW[ch] / 2;
    const baseY = yForProgress(prog) - PIN_H / 2;
    // 同章节/同位置堆叠：与已放置 pin 横向重叠（同一章列 ±60px 内）→ 向下错位
    let y = baseY;
    let guard = 0;
    while (guard < 20) {
      const clash = placed.some(p => Math.abs(p.x - baseX) < 60 && y < p.y + PIN_H + STACK_GAP && y + PIN_H + STACK_GAP > p.y);
      if (!clash) break;
      y += PIN_H + STACK_GAP;
      guard++;
    }
    const pin = document.createElement('div');
    pin.className = 'tlPin';
    pin.dataset.id = tn.id;
    pin.dataset.chapter = ch;
    pin.dataset.progress = prog;
    pin.innerHTML = '<span class="tlPinIcon">⚑</span><span class="tlPinTitle">' + escapeHtml(tn.title) + '</span>';
    pin.title = '第' + ch + '章 · ' + prog + '% · ' + tn.title + (tn.note ? '：' + tn.note : '') + '\n拖动调整位置（左右=章号，上下=剧情推进）';
    pin.style.left = baseX + 'px';
    pin.style.top = y + 'px';
    pin.style.transform = 'translateX(-50%)';
    wireTimelinePinDrag(pin, tn);
    wrap.appendChild(pin);
    placed.push({ x: baseX, y, w: PIN_W, h: PIN_H });
  }
}
// pin 拖动：水平→章号，垂直→剧情推进；释放后写回 timelineNodes 并持久化
function wireTimelinePinDrag(pin, tn) {
  let startX = 0, startY = 0, origL = 0, origT = 0, moved = false;
  const dragHint = document.createElement('div');
  dragHint.className = 'axisDragHint';
  dragHint.style.display = 'none';
  document.body.appendChild(dragHint);
  function move(ev) {
    if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) moved = true;
    pin.classList.add('dragging');
    const scale = axisViewT.scale;
    pin.style.left = (origL + (ev.clientX - startX) / scale) + 'px';
    pin.style.top = (origT + (ev.clientY - startY) / scale) + 'px';
    const g = axisGeom;
    const nx = parseFloat(pin.style.left), ny = parseFloat(pin.style.top);
    const ch = axisChapterFromX(nx);
    const prog = progressFromY(ny + 10);
    dragHint.textContent = '第' + ch + '章 · ' + prog + '%';
    dragHint.style.display = 'block';
    dragHint.style.left = (ev.clientX + 14) + 'px';
    dragHint.style.top = (ev.clientY + 14) + 'px';
  }
  function up() {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    if (dragHint.parentNode) dragHint.parentNode.removeChild(dragHint);
    pin.classList.remove('dragging');
    if (!moved) return;
    pin._dragged = true;
    const g = axisGeom;
    const nx = parseFloat(pin.style.left), ny = parseFloat(pin.style.top);
    const chapter = axisChapterFromX(nx);
    const progress = progressFromY(ny + 10);
    const i = timelineNodes.findIndex(t => t.id === tn.id);
    if (i >= 0) {
      timelineNodes[i].chapter = chapter;
      timelineNodes[i].progress = progress;
      saveLayout();
      renderAxisTimelinePins(); // 吸附回格位重画
    }
  }
  pin.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pin._dragged) { pin._dragged = false; return; }
    axisJumpTo(Number(pin.dataset.chapter) || 1);
  });
  pin.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX; startY = e.clientY;
    origL = parseFloat(pin.style.left); origT = parseFloat(pin.style.top);
    moved = false;
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

function applyAxisTransform() {
  // transform 施加在 #axisInner 上：#axisView 保持 inset:0 固定裁剪，inner 平移缩放
  const inner = document.getElementById('axisInner') || document.getElementById('axisView');
  if (!inner) return;
  inner.style.transform = `translate(${axisViewT.x}px, ${axisViewT.y}px) scale(${axisViewT.scale})`;
  updateAxisBar();
}

// 底部导航条：更新"当前视野内"的章刻度高亮
function updateAxisBar() {
  const g = axisGeom;
  const bar = document.getElementById('axisBar');
  if (!g || !bar) return;
  const ticks = bar.querySelectorAll('.tick');
  if (!ticks.length) return;
  const axisView = document.getElementById('axisView');
  const vw = (axisView && axisView.offsetWidth) || 1000;
  const x0 = -axisViewT.x / axisViewT.scale;
  const x1 = x0 + vw / axisViewT.scale;
  for (let c = 1; c <= g.maxChapter && c <= ticks.length; c++) {
    const s = g.chapterStart[c], w = g.chapterW[c];
    ticks[c - 1].classList.toggle('now', s < x1 && s + w > x0);
  }
}

// 跳转到指定章：该章列中心移到视口中心（若当前过小则先放大到可读比例）
function axisJumpTo(ch) {
  const g = axisGeom;
  if (!g) return;
  ch = Math.max(1, Math.min(g.maxChapter, Math.round(Number(ch) || 1)));
  const target = g.chapterStart[ch] + g.chapterW[ch] / 2;
  const axisView = document.getElementById('axisView');
  const vw = (axisView && axisView.offsetWidth) || 1000;
  if (axisViewT.scale < 0.35) axisViewT.scale = 0.55; // 从全图/过小比例跳转 → 放大到可读
  axisViewT.x = vw / 2 - target * axisViewT.scale;
  applyAxisTransform();
}

// 全图：缩放让所有章节可见（看整体分布）
function axisFitAll() {
  const axisView = document.getElementById('axisView');
  if (!axisView) return;
  const vw = axisView.offsetWidth || 1000, vh = axisView.offsetHeight || 600;
  const g = computeAxisLayout();
  const topCoord = axisBandTop();
  // 全图允许缩到很小（82 章全图 scale≈0.025，卡片成色块但能看到整体分布）
  let scale = Math.min(1.6, vh / g.bh, vw / g.bw);
  scale = Math.max(0.02, scale);
  axisViewT = {
    x: (vw - g.bw * scale) / 2,
    y: (vh - g.bh * scale) / 2 - topCoord * scale,
    scale
  };
  applyAxisTransform();
}

// 底部导航条事件（只绑定一次；renderAxisView 每次重渲染也会调用本函数，防重复绑定）
let __axisBarBound = false;
function initAxisBarEvents() {
  if (__axisBarBound) return;
  __axisBarBound = true;
  const jump = document.getElementById('axisJump');
  if (!jump) return;
  jump.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') axisJumpTo(Number(jump.value));
  });
  const go = document.getElementById('axisFitAllBtn');
  if (go) go.addEventListener('click', () => axisFitAll());
  // v1.9：Y 轴划分方式切换（按卷/按境界/按关键节点/按进度）
  const sel = document.getElementById('axisYModeSel');
  if (sel) sel.addEventListener('change', () => {
    const v = sel.value;
    if (v === 'volume') {
      if (detectVolumeBands().length) {
        // 回到卷分段：清除显式选择，交回自动检测
        axisBandMode = '';
        axisBands = [];
        saveLayout();
        renderAxisView();
        fitAxisView();
      } else {
        showToast('该项目没有卷目录，请选择其他划分方式', 'error');
        syncAxisYModeSel();
      }
    } else if (v === 'progress') {
      // 按剧情进度：不分段，保持 0-100% 连续轴
      axisBandMode = 'progress';
      axisBands = [];
      saveLayout();
      renderAxisView();
      fitAxisView();
    } else {
      // realm / plot：需要名称 → 打开分区编辑弹窗（确定后才保存+重渲染）
      openAxisYModal(v === 'realm' ? 'realm' : 'plot');
    }
  });
  const cfg = document.getElementById('axisYConfigBtn');
  if (cfg) cfg.addEventListener('click', () => openAxisYModal());
  // v1.10：X 轴章段聚合密度（自动 / 每5 / 每10 / 每20章一段）
  const segSel = document.getElementById('axisSegSel');
  if (segSel) segSel.addEventListener('change', () => {
    axisSegSize = parseInt(segSel.value, 10) || 0;
    saveLayout();
    renderAxisView();
    fitAxisView();
  });
}

// 底部工具条 Y 轴模式选择同步（渲染后调用）
function syncAxisYModeSel() {
  const sel = document.getElementById('axisYModeSel');
  if (!sel) return;
  const g = axisGeom;
  let mode = 'progress';
  if (g && g.bands && g.bands.length) mode = g.bandMode;
  else if (axisBandMode === 'realm' || axisBandMode === 'plot') mode = axisBandMode;
  sel.value = mode;
}

// 底部工具条 X 段聚合密度选择同步（渲染后调用）
function syncAxisSegSel() {
  const sel = document.getElementById('axisSegSel');
  if (!sel) return;
  sel.value = String(axisSegSize || 0);
}

// v1.8：Y 轴反算已改用 progressFromY（剧情推进）；旧泳道函数保留引用但不再用于定位
function axisYForLevel(levelIdx) {
  // levelIdx 0 = 开端 = 底部；最后一层 = 顶部；-1(未分类) = 顶部悬空带
  const g = axisGeom;
  if (levelIdx < 0) return axisBandTop();
  const levels = (axisDef && axisDef.levels) || [];
  if (levels.length < 2) return axisPadT;
  return yForProgress(levelIdx / (levels.length - 1) * 100);
}

function axisLevelFromY(ny) {
  // v1.8：已废弃（Y 为连续剧情推进轴），保留仅作兜底——映射到最近层级
  const g = axisGeom;
  if (!g || !g.levels || !g.levels.length) return 0;
  const p = progressFromY(ny);
  const i = Math.round(p / 100 * (g.levels.length - 1));
  return Math.max(0, Math.min(g.levels.length - 1, i));
}

function axisWheelZoom(e) {
  const rect = canvasWrap.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const cx = (mx - axisViewT.x) / axisViewT.scale;
  const cy = (my - axisViewT.y) / axisViewT.scale;
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const next = Math.min(2.5, Math.max(0.2, axisViewT.scale * factor));
  axisViewT.x = mx - cx * next;
  axisViewT.y = my - cy * next;
  axisViewT.scale = next;
  applyAxisTransform();
}

function nodeAxisData(n) {
  // 覆盖 > 节点自身字段 > 默认
  const ov = layoutAxis[n.id] || {};
  const chapter = ov.chapter != null ? Number(ov.chapter) : (n.chapter != null ? Number(n.chapter) : null);
  const level = ov.level != null && ov.level !== '' ? String(ov.level) : (n.level != null && n.level !== '' ? String(n.level) : null);
  const lane = ov.lane || n.lane || null;
  return { chapter, level, lane };
}

function axisLevelIndex(levelStr) {
  const levels = (axisDef && axisDef.levels) || [];
  if (levelStr == null || levelStr === '') return -1; // 未分类
  const i = levels.indexOf(levelStr);
  if (i >= 0) return i;
  const n = Number(levelStr);
  if (isFinite(n) && n >= 0 && n < levels.length) return n;
  return -1;
}

function renderAxisView() {
  const axisView = document.getElementById('axisView');
  if (!axisView) return;
  axisView.style.display = 'block';
  const nodesEl = document.getElementById('axisNodes');
  const yEl = document.getElementById('axisYLabels');
  const xEl = document.getElementById('axisXLabels');
  // 旧 hint 先移除（避免 innerHTML 覆盖重建导致节点事件丢失）
  const oldHint = axisView.querySelector('.axisHint');
  if (oldHint) oldHint.remove();
  nodesEl.innerHTML = '';
  yEl.innerHTML = '';
  xEl.innerHTML = '';
  const geom = computeAxisLayout();
  const levels = geom.levels;
  const { maxChapter, bandH, chapterW, chapterStart, plotTop, plotH, levelY, contentBottom, segSize, nSegs, segOf, segW, segStart } = geom;
  const bandTop = axisBandTop();
  const cardW = axisCardW;
  // 网格背景：垂直列线（每章一列）
  const grid = document.getElementById('axisGrid');
  if (grid) {
    grid.style.backgroundSize = axisColW + 'px 100%';
    // 清理旧的引导线
    grid.querySelectorAll('.axisLevelLine,.axisDiagLine,.axisPctLine,.axisBandLine,.axisFrameLine').forEach(el => el.remove());
  }

  // Y 轴：分段模式（卷/境界/剧情节点）或 细刻度+层级参考网格 模式
  const banded = geom.bands && geom.bands.length > 0;
  if (grid) {
    const plotLeft = axisPadL, plotRight = Math.max(plotLeft + 40, geom.bw - axisPadR);
    // 细网格：每 10% 一条淡点线（y 轴细化刻度，任何规模项目统一生效）
    for (let pp = 0; pp <= 100; pp += 10) {
      const line = document.createElement('div');
      line.className = 'axisPctLine';
      line.style.top = yForProgress(pp) + 'px';
      line.style.left = plotLeft + 'px';
      line.style.width = (plotRight - plotLeft) + 'px';
      grid.appendChild(line);
    }
    if (banded) {
      // 分段分界线：每卷/每境界/每节点一条强调虚线
      for (const k in geom.bandBoundaryY) {
        const line = document.createElement('div');
        line.className = 'axisBandLine';
        line.style.top = geom.bandBoundaryY[k] + 'px';
        line.style.left = plotLeft + 'px';
        line.style.width = (plotRight - plotLeft) + 'px';
        grid.appendChild(line);
      }
    } else {
      for (let i = 0; i < levels.length; i++) {
        const line = document.createElement('div');
        line.className = 'axisLevelLine';
        line.style.top = levelY[i] + 'px';
        line.style.left = plotLeft + 'px';
        line.style.width = (plotRight - plotLeft) + 'px';
        grid.appendChild(line);
      }
      // y=x 对角线：起点(第1章/开端) → 终点(第N章/结局)，呼应"剧情随章节推进而抬升"
      const diag = document.createElement('div');
      diag.className = 'axisDiagLine';
      const dx = plotRight - plotLeft, dy = plotTop - (plotTop + plotH);
      const len = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx) * 180 / Math.PI;
      diag.style.left = plotLeft + 'px';
      diag.style.top = (plotTop + plotH) + 'px';
      diag.style.width = len + 'px';
      diag.style.transform = 'rotate(' + ang + 'deg)';
      diag.style.transformOrigin = 'left center';
      grid.appendChild(diag);
    }
    // X/Y 轴线：黑色实线（X = 底部基线，Y = 左侧基线）
    const frameX = document.createElement('div');
    frameX.className = 'axisFrameLine h';
    frameX.style.top = (contentBottom - 1) + 'px';
    frameX.style.left = plotLeft + 'px';
    frameX.style.width = (plotRight - plotLeft) + 'px';
    grid.appendChild(frameX);
    const frameY = document.createElement('div');
    frameY.className = 'axisFrameLine v';
    frameY.style.left = (plotLeft - 1) + 'px';
    frameY.style.top = plotTop + 'px';
    frameY.style.height = (contentBottom - plotTop) + 'px';
    grid.appendChild(frameY);
  }

  if (banded) {
    // Y 轴分段标签：每段中心显示卷/境界/节点名 + 章范围
    for (let i = 0; i < geom.bands.length; i++) {
      const el = document.createElement('div');
      el.className = 'axisYLabel axisBandLabel';
      el.style.top = (geom.bandLabelY[i] - 9) + 'px';
      const name = geom.bands[i];
      const label = (geom.bandMode === 'volume' ? name : name) + ' ' + Math.round(i / geom.bands.length * 100) + '~' + Math.round((i + 1) / geom.bands.length * 100) + '%';
      el.textContent = label;
      yEl.appendChild(el);
    }
  } else {
    // Y 轴层级标签：开端(0%)在底部，结局(100%)在顶部，标签定位到各自网格线
    const nLevels = Math.max(1, levels.length - 1);
    // 层级所在百分比集合（细刻度标签跳过它们，避免重叠）
    const levelPct = {};
    for (let i = 0; i < levels.length; i++) levelPct[Math.round(i / nLevels * 100)] = true;
    for (let i = 0; i < levels.length; i++) {
      const el = document.createElement('div');
      el.className = 'axisYLabel';
      el.style.top = (levelY[i] - 9) + 'px';
      el.textContent = levels[i] + ' ' + Math.round(i / nLevels * 100) + '%';
      yEl.appendChild(el);
    }
    // 细化百分比刻度：每 10% 一个小标签（跳过层级位置避免重叠）
    for (let pp = 10; pp <= 100; pp += 10) {
      if (levelPct[pp]) continue;
      const el = document.createElement('div');
      el.className = 'axisPctLabel';
      el.style.top = (yForProgress(pp) - 8) + 'px';
      el.textContent = pp + '%';
      yEl.appendChild(el);
    }
  }
  // 未分类带标签
  if (bandH > 0) {
    const unrecEl = document.createElement('div');
    unrecEl.className = 'axisYLabel';
    unrecEl.style.top = (bandTop - 9) + 'px';
    unrecEl.style.background = '#6b7280';
    unrecEl.style.color = '#fff';
    unrecEl.textContent = '未分类';
    yEl.appendChild(unrecEl);
  }

  // 每章节点数/有内容标记（段标签 hover 信息 + 底部刻度复用）
  const chCntMap = {}, chHasMap = {};
  for (const p of geom.items) {
    if (p.effCh == null) continue;
    chCntMap[p.effCh] = (chCntMap[p.effCh] || 0) + 1;
    chHasMap[p.effCh] = true;
  }
  // X 轴章号标签：按段聚合显示（段内多章合并，避免每章一标签太密）；段内每章仍可用底部刻度跳转
  const xLabelTop = contentBottom + 6;
  xEl.style.top = xLabelTop + 'px';
  xEl.style.height = '28px';
  for (let s = 0; s < nSegs; s++) {
    const from = s * segSize + 1, to = Math.min(maxChapter, from + segSize - 1);
    const el = document.createElement('div');
    el.className = 'axisXLabel seg';
    el.style.left = (segStart[s] + segW[s] / 2) + 'px';
    el.textContent = segSize === 1 ? ('第' + from + '章') : ('第' + from + '~' + to + '章');
    // 段信息（hover）：段内章节数 / 有内容章数 / 节点数；点击跳转到段首章
    let hasCnt = 0, nodeCnt = 0;
    for (let ch = from; ch <= to; ch++) {
      if (chHasMap[ch]) hasCnt++;
      nodeCnt += chCntMap[ch] || 0;
    }
    el.title = (segSize === 1 ? ('第' + from + '章') : ('第' + from + '~' + to + '章'))
      + '：' + (to - from + 1) + '章（' + hasCnt + '章有内容）· ' + nodeCnt + '个节点\n点击跳转到第' + from + '章';
    el.addEventListener('click', () => axisJumpTo(from));
    xEl.appendChild(el);
  }

  // 节点卡片：有章号 → 章列内横向 lane 展开（沿 X 轴铺开），Y = 该章剧情推进（默认 y=x 对角线）；
  // 无章号 → 顶部未分类带横向 lane（全局连续，不按章）
  const chLaneCursor = {}; // 章号 -> 已放卡片数（lane）
  let bandLane = 0;        // 未分类带全局 lane
  for (const { n, a, effCh, progress } of geom.items) {
    const el = document.createElement('div');
    el.className = 'node type-' + n.type;
    el.dataset.id = n.id;
    let x, y;
    if (effCh != null) {
      const lane = chLaneCursor[effCh] || 0;
      chLaneCursor[effCh] = lane + 1;
      x = segStart[segOf(effCh)] + 10 + lane * axisLaneStep;
      y = yForProgress(progress) - 17; // 34px 高卡片居中于推进线
    } else {
      x = axisPadL + 10 + bandLane * axisLaneStep;
      bandLane++;
      y = bandTop + 4;
    }
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.innerHTML = '<span class="typeTag"></span><div class="ntitle"></div><div class="ndesc"></div><div class="nmeta"><span class="nfile"></span><span class="nstats"></span></div>';
    fillNodeContent(el, n);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el._dragged) { el._dragged = false; return; }
      setEgoNode(n.id);
      showDetail(n);
    });
    // 拖动 → 换算成章号/剧情推进并写入 layoutAxis / axisProgress（持久化）
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const scale = axisViewT.scale;
      const startX = e.clientX, startY = e.clientY;
      const origL = parseFloat(el.style.left), origT = parseFloat(el.style.top);
      let moved = false;
      // 拖动实时提示（章号/进度/分段）
      const dragHint = document.createElement('div');
      dragHint.className = 'axisDragHint';
      dragHint.style.display = 'none';
      document.body.appendChild(dragHint);
      function move(ev) {
        if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) moved = true;
        el.style.left = (origL + (ev.clientX - startX) / scale) + 'px';
        el.style.top = (origT + (ev.clientY - startY) / scale) + 'px';
        updateAxisEdgesFor(n.id); // 拖动中：相连连线跟随
        // 实时提示：当前落点对应的章号 / 推进 / 分段名
        const g2 = axisGeom;
        const nx2 = parseFloat(el.style.left), ny2 = parseFloat(el.style.top);
        const ch2 = axisChapterFromX(nx2);
        const prog2 = progressFromY(ny2 + 17);
        let txt = '第' + ch2 + '章 · ' + prog2 + '%';
        if (g2 && g2.bands && g2.bands.length) {
          const bi = Math.max(0, Math.min(g2.bands.length - 1, Math.floor(prog2 / 100 * g2.bands.length)));
          txt = (g2.bands[bi] || '') + ' · ' + txt;
        }
        dragHint.textContent = txt;
        dragHint.style.display = 'block';
        dragHint.style.left = (ev.clientX + 14) + 'px';
        dragHint.style.top = (ev.clientY + 14) + 'px';
      }
      function up() {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        if (dragHint.parentNode) dragHint.parentNode.removeChild(dragHint);
        if (!moved) return;
        el._dragged = true;
        // 反算格位（章 = X 区间反查；剧情推进 = Y 连续反算）
        const nx = parseFloat(el.style.left);
        const ny = parseFloat(el.style.top);
        const g = axisGeom;
        // 落在未分类带（顶部，y < 结局线 - 半带高）→ 清除章号与推进（未分章）
        if (ny < g.plotTop - g.bandH / 2) {
          const ov = nodeAxisData(n);
          layoutAxis[n.id] = { chapter: null, level: null, lane: ov.lane };
          el.style.left = (axisPadL + 10) + 'px';
          el.style.top = axisBandTop() + 4 + 'px';
          saveLayout();
          redrawAxisEdges();
          return;
        }
        const chapter = axisChapterFromX(nx);
        const progress = progressFromY(ny + 17); // 卡片中心对应推进值
        layoutAxis[n.id] = { chapter, level: null, lane: nodeAxisData(n).lane };
        axisProgress[chapter] = progress; // 整章推进（同章卡片共享该 y）
        // 卷模式下：拖出本卷带范围 → 提示（卷归属按文件路径，不会因拖动改变）
        if (g && g.bandMode === 'volume' && g.bands && g.bands.length) {
          const v = volumeFromPath(n);
          const vi = v != null ? g.bands.indexOf(v) : -1;
          const nb = g.bands.length;
          if (vi >= 0) {
            const lo = vi / nb * 100, hi = (vi + 1) / nb * 100;
            if (progress < lo || progress > hi) {
              showToast('该章仍属于「' + g.bands[vi] + '」（卷归属按文件路径，拖动只调整剧情推进）', 'info');
            }
          }
        }
        // 落回格位（该章所在段首 lane，推进线位置）
        el.style.left = (g.segStart[g.segOf(chapter)] + 10) + 'px';
        el.style.top = yForProgress(progress) - 17 + 'px';
        saveLayout();
        redrawAxisEdges();
      }
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    nodesEl.appendChild(el);
  }

  // 底部导航条：章节刻度（有内容高亮，点击跳转）+ 统计
  const ticksEl = document.getElementById('axisTicks');
  if (ticksEl) {
    ticksEl.innerHTML = '';
    for (let c = 1; c <= maxChapter; c++) {
      const t = document.createElement('div');
      t.className = 'tick' + (chHasMap[c] ? ' has' : '');
      t.title = '第' + c + '章' + (chHasMap[c] ? '（有内容，点击跳转）' : '（空）');
      t.addEventListener('click', () => axisJumpTo(c));
      ticksEl.appendChild(t);
    }
  }
  const statsEl = document.getElementById('axisStats');
  if (statsEl) {
    const unrecCount = geom.items.filter(p => p.effCh == null).length;
    const withCh = geom.items.length - unrecCount;
    const segText = geom.segSize > 1 ? ' · ' + geom.nSegs + '段' : '';
    statsEl.textContent = '共' + maxChapter + '章' + segText + ' · ' + withCh + '已识别 · ' + unrecCount + '未分类';
  }
  // 空项目/无已识别内容引导：一个节点都没有时给出明确指引（模板项目也是空轴）
  const isEmpty = geom.items.length === 0 || maxChapter === 0;
  const oldEmpty = axisView.querySelector('.axisEmpty');
  if (oldEmpty) oldEmpty.remove();
  if (isEmpty) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'axisEmpty';
    emptyEl.innerHTML =
      '<div class="axisEmptyIcon">🗂️</div>' +
      '<div class="axisEmptyTitle">这个项目还没有可显示的内容</div>' +
      '<div class="axisEmptyText">进度轴按「章节」展开：请确认项目里有正文章节文件（如 <code>正文/第1章 xxx.md</code>），' +
      '或在左侧「文件」面板打开项目文件。若章节文件是其它命名/目录，可在项目根目录的 <code>novel-canvas.config.json</code> 里调整扫描规则。</div>' +
      '<button class="axisEmptyBtn" id="axisEmptyFileBtn">打开文件面板</button>';
    const fileBtn = emptyEl.querySelector('#axisEmptyFileBtn');
    if (fileBtn) fileBtn.addEventListener('click', () => {
      const filesActivity = document.getElementById('activityFiles');
      if (filesActivity) filesActivity.click();
    });
    axisView.appendChild(emptyEl);
  }
  initAxisBarEvents();
  syncAxisYModeSel();
  syncAxisSegSel();
  redrawAxisEdges();
  renderAxisTimelinePins();
  applyFilters(); // 渲染后立即套用分类筛选/搜索（轴节点也要被过滤）

  const hint = document.createElement('div');
  hint.className = 'axisHint';
  const bandHint = geom.bands && geom.bands.length
    ? 'Y 按分段（' + geom.bands.join(' / ') + '）· 带内沿章号推进 · 拖节点上下可调该章所在位置'
    : 'Y=剧情推进(0-100%) 默认 y=x · 拖节点上下调推进';
  const segHint = geom.segSize > 1 ? ' · X 按段聚合（每段' + geom.segSize + '章，底部刻度仍可逐章跳转）' : '';
  hint.textContent = escapeHtml(axisDef.name || '进度轴') + ' · 章节沿 X 轴铺开，' + bandHint + segHint + ' · 灰色带=未分类/无章内容 · 拖空白平移 · 滚轮缩放 · 拖节点左右调章号 · 点节点看详情与关联连线（虚线=自动关联，实线=手动连线，点实线可删）' + (timelineNodes.length ? ' · ⚑=时间线重要节点（可拖动标在轴上）' : ' · 时间线弹窗可添加重要节点（⚑标在轴上）');
  axisView.appendChild(hint);
}

function enterAxisView(save) {
  viewMode = 'axis';
  const worldEl = document.getElementById('world');
  const axisView = document.getElementById('axisView');
  if (worldEl) worldEl.style.display = 'none';
  if (axisView) axisView.style.display = 'block';
  renderAxisView();
  const btn = document.getElementById('viewModeBtn');
  if (btn) { btn.textContent = '自由布局'; btn.classList.add('on'); }
  if (save) saveLayout();
  fitAxisView();
  // v1.9：无卷项目进入进度轴时询问作者分段方式（境界/剧情关键节点）
  maybeAskAxisBands();
}

function exitAxisView(save) {
  viewMode = 'free';
  const worldEl = document.getElementById('world');
  const axisView = document.getElementById('axisView');
  if (worldEl) worldEl.style.display = '';
  if (axisView) axisView.style.display = 'none';
  const btn = document.getElementById('viewModeBtn');
  if (btn) { btn.textContent = '进度轴'; btn.classList.remove('on'); }
  if (save) saveLayout();
}

function toggleViewMode() {
  if (viewMode === 'axis') exitAxisView(true);
  else enterAxisView(true);
}

function fitAxisView() {
  const axisView = document.getElementById('axisView');
  if (!axisView || viewMode !== 'axis') return;
  // 用 offsetWidth/Height（不含 transform，getBoundingClientRect 会被自身缩放污染）
  const vw = axisView.offsetWidth || 1000;
  const vh = axisView.offsetHeight || 600;
  const geom = computeAxisLayout();
  // 章节沿 X 轴铺开：高度优先（Y 全显），宽度不硬缩全图——
  // 章少时按宽度全图 fit（scale 更大），章多时保底 0.55（卡片可读），X 方向横向平移浏览
  let scale = Math.min(1.6, vh / geom.bh);
  const wFit = vw / geom.bw;
  scale = Math.min(scale, Math.max(wFit, 0.55));
  scale = Math.max(0.35, scale);
  // 内容坐标系原点不在 (0,0)：未分类带顶为负坐标，居中需减去 topCoord*scale
  const topCoord = axisBandTop();
  const showAllX = geom.bw * scale <= vw + 1;
  axisViewT = {
    x: showAllX ? (vw - geom.bw * scale) / 2 : 0,
    y: (vh - geom.bh * scale) / 2 - topCoord * scale,
    scale
  };
  applyAxisTransform();
}

// 轴视图交互：空白拖拽平移 + 滚轮缩放（挂在 canvasWrap 上，仅在 axis 模式生效）
function startAxisPan(e) {
  if (e.button !== 0) return;
  if (e.target.closest('.node')) return;
  if (egoNodeId) clearEgo(); // 点空白清除选中节点及其关联连线
  axisPanning = true;
  axisPanStartX = e.clientX;
  axisPanStartY = e.clientY;
  canvasWrap.classList.add('panning');
}

const TYPE_LABEL_MAP = { role: '角色', faction: '势力', setting: '设定', outline: '大纲', volume: '章节', chapter: '章节', foreshadow: '伏笔', context: '上下文', unrecognized: '未识别' };
function typeToLabel(type) { return TYPE_LABEL_MAP[type] || type || '未识别'; }

// 识别报告：统计 + 可疑项纠错 + 未识别提升（全部即时保存到布局文件 overrides）
const PROMOTE_TYPES = ['role', 'faction', 'setting', 'outline', 'foreshadow', 'context', 'unrecognized'];
function promoteTypeOptions(selected) {
  return PROMOTE_TYPES.map(t =>
    '<option value="' + t + '"' + (t === selected ? ' selected' : '') + '>' + typeToLabel(t) + '</option>').join('');
}

async function openRecognitionReport() {
  const modal = document.getElementById('recognitionModal');
  const body = document.getElementById('recognitionBody');
  modal.style.display = 'flex';
  body.innerHTML = '<div class="fileTreeHint">加载中...</div>';
  try {
    const res = await fetch('/api/recognition?project=' + encodeURIComponent(currentProject));
    const r = await res.json();
    if (r.error) throw new Error(r.error);
    const savedCount = Object.keys(layoutOverrides || {}).length;
    let html = '<div class="recModalStats">';
    html += '<div class="recModalStat"><b>' + r.totalMd + '</b><span>总 md 文件</span></div>';
    html += '<div class="recModalStat"><b>' + r.recognizedCount + '</b><span>已识别节点</span></div>';
    html += '<div class="recModalStat"><b>' + r.unrecognizedCount + '</b><span>未识别节点</span></div>';
    html += '<div class="recModalStat"><b>' + r.unrecognizedFileCount + '</b><span>含未识别文件</span></div>';
    html += '</div>';

    const byTypeHtml = Object.entries(r.byType || {}).map(([t, c]) => {
      const l = typeToLabel(t);
      return '<span class="recModalStat" style="min-width:80px"><b>' + c + '</b><span>' + l + '</span></span>';
    }).join('');
    if (byTypeHtml) html += '<div class="recModalStats">' + byTypeHtml + '</div>';

    // 可疑识别：每条可改类型并保存
    if (r.suspicious && r.suspicious.length) {
      html += '<div class="recSection"><h3>可疑识别（' + r.suspicious.length + '）—— 改类型后点保存，立即写入布局文件</h3>';
      for (const s of r.suspicious.slice(0, 50)) {
        const cur = nodes.find(n => n.id === s.id);
        html += '<div class="recSusp" data-id="' + escapeHtml(s.id) + '">' +
          '<span class="why">' + escapeHtml(s.reasons.join(' · ')) + '</span>' +
          '<span class="title">' + escapeHtml(s.title) + '</span>' +
          '<span class="file">' + escapeHtml(s.file || '') + '</span>' +
          '<select class="promoteType">' + promoteTypeOptions(cur ? cur.type : 'unrecognized') + '</select>' +
          '<button class="promoteBtn">保存</button>' +
          '</div>';
      }
      if (r.suspicious.length > 50) html += '<div class="fileTreeHint">… 其余 ' + (r.suspicious.length - 50) + ' 条省略</div>';
      html += '</div>';
    }

    // 未识别节点：一键提升
    const unrecNodes = nodes.filter(n => n.unrecognized);
    if (unrecNodes.length) {
      html += '<div class="recSection"><h3>未识别内容（' + unrecNodes.length + '）—— 选择类型后点提升，立即保存并生效</h3>';
      for (const n of unrecNodes.slice(0, 80)) {
        html += '<div class="recUnrec" data-id="' + escapeHtml(n.id) + '">' +
          '<span class="title">' + escapeHtml(n.title) + '</span>' +
          '<span class="file">' + escapeHtml(n.file || '') + ' 行' + n.startLine + '-' + n.endLine + '</span>' +
          '<select class="promoteType">' + promoteTypeOptions('unrecognized') + '</select>' +
          '<button class="promoteBtn">提升</button>' +
          '</div>';
      }
      if (unrecNodes.length > 80) html += '<div class="fileTreeHint">… 其余 ' + (unrecNodes.length - 80) + ' 个未识别节点，可展开未识别板块逐个处理</div>';
      html += '</div>';
    } else {
      html += '<div class="recSection"><h3>未识别内容</h3><div class="fileTreeHint">无 —— 所有内容均被规则覆盖 🎉</div></div>';
    }

    // 底部：已保存数量 + AI 分析入口
    html += '<div class="recFooter">' +
      '<span class="recSaved">已保存人工纠正：<b>' + savedCount + '</b> 项（写入 小说画布.json overrides）</span>' +
      '<button id="recAiBtn" class="toolBtn">🤖 让 AI 分析未识别内容</button>' +
      '</div>';

    body.innerHTML = html;

    // 保存/提升动作：POST override → 重载数据 → 刷新报告
    async function applyFix(btn) {
      const row = btn.closest('.recSusp, .recUnrec');
      const id = row.dataset.id;
      const type = row.querySelector('.promoteType').value;
      try {
        const res = await fetch('/api/override', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: currentProject, id, patch: { type, label: typeToLabel(type) } })
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        // 同步内存里的 overrides，避免后续 saveLayout 用旧值覆盖
        if (d.override && d.override.type && d.override.type !== 'unrecognized') layoutOverrides[id] = d.override;
        else delete layoutOverrides[id];
        await loadData();
        btn.textContent = '✓ 已保存';
        btn.classList.add('saved');
        btn.disabled = true;
        showToast('已保存：' + typeToLabel(type) + '（写入 小说画布.json）', 'success');
        // 刷新报告统计（延迟以让 loadData 完成）
        setTimeout(() => { if (modal.style.display === 'flex') openRecognitionReport(); }, 350);
      } catch (e) {
        showToast('保存失败：' + e.message, 'error');
      }
    }
    body.querySelectorAll('.recSusp .promoteBtn, .recUnrec .promoteBtn').forEach(btn => {
      btn.addEventListener('click', () => applyFix(btn));
    });

    // AI 分析：把未识别内容清单发进对话
    const aiBtn = document.getElementById('recAiBtn');
    if (aiBtn) {
      aiBtn.addEventListener('click', () => {
        const list = nodes.filter(n => n.unrecognized).slice(0, 60)
          .map(n => '- [' + n.file + ' 行' + n.startLine + '-' + n.endLine + '] ' + n.title).join('\n');
        const input = document.getElementById('chatInput');
        if (input) {
          input.value = '请帮我分析以下未识别内容分别应该归为哪一类（角色/势力/设定/大纲/伏笔/上下文），并说明理由：\n\n' + list;
          sendChat();
        }
        modal.style.display = 'none';
      });
    }
  } catch (e) {
    body.innerHTML = '<div class="fileTreeHint">加载失败：' + escapeHtml(e.message) + '</div>';
  }
}

function updateStatusBar() {
  const projectEl = document.getElementById('statusProject');
  const nodeEl = document.getElementById('statusNodeCount');
  const fileEl = document.getElementById('statusFile');
  const dirtyEl = document.getElementById('statusDirty');
  if (projectEl) projectEl.textContent = currentProject ? '项目：' + currentProject : '项目：未选择';
  if (nodeEl) nodeEl.textContent = '节点：' + (nodes ? nodes.length : 0);
  const wordsEl = document.getElementById('statusWords');
  if (wordsEl && nodes) {
    const chapters = nodes.filter(n => n.label === '章节');
    const words = chapters.reduce((s, n) => s + (n.content || '').length, 0);
    wordsEl.textContent = '正文：' + words.toLocaleString('zh-CN') + ' 字 · ' + chapters.length + ' 章';
  } else if (wordsEl) {
    wordsEl.textContent = '';
  }
  let f = null;
  if (typeof openFiles !== 'undefined' && typeof activeFilePath !== 'undefined') {
    f = openFiles.find(x => x.path === activeFilePath);
  }
  if (fileEl) fileEl.textContent = f ? '文件：' + f.name : '文件：未打开';
  if (dirtyEl) dirtyEl.textContent = f ? (f.dirty ? '● 未保存' : '已保存') : '';
}

async function loadData() {
  const q = currentProject ? '?project=' + encodeURIComponent(currentProject) : '';
  const res = await fetch('/api/data' + q);
  const data = await res.json();
  currentProject = data.project || currentProject;
  nodes = data.nodes;
  nodeMap = {};
  for (const n of nodes) nodeMap[n.id] = n;
  ensureGroupNodeMap();
  positions = data.layout.nodes || {};
    customLinks = data.layout.customLinks || [];
  const layoutVersion = Number(data.layout.version || 0);
  let changed = false;

  // 大一统框架：视图模式 / 轴定义 / 覆盖
  if (data.config && data.config.axis) axisDef = data.config.axis;
  viewMode = 'axis'; // v1.11：自由布局已移除，固定进度轴视图（不再读 layout.mode）
  layoutAxis = (data.layout && data.layout.axis) || {};
  axisProgress = (data.layout && data.layout.axisProgress) || {};
  axisBandMode = (data.layout && data.layout.axisBandMode) || '';
  axisBands = (data.layout && data.layout.axisBands) || [];
  axisSegSize = (data.layout && data.layout.axisSegSize) || 0;
  layoutOverrides = (data.layout && data.layout.overrides) || {};
  timelineNodes = (data.layout && Array.isArray(data.layout.timelineNodes)) ? data.layout.timelineNodes : [];
  unrecognizedFiles = new Set(nodes.filter(n => n.unrecognized).map(n => n.file));
  enterAxisView(false);

  // 新出现的组套默认开合（章节卷收起 / 内容分类展开），老组尊重用户手动开合
  markSeenGroups();

  // 通用自适应布局修复：任何项目/任何旧布局，加载即体检，有几何问题就地修复或整体重排
  if (repairLayout()) changed = true;
  if (layoutVersion < 3) { computeAutoLayout(); changed = true; } // v3：一次性升级为确定性精确尺寸布局
  if (changed) saveLayout();
  links = buildLinks();
  renderSidebar();
  renderFilters();
  renderNodes();
  applyFilters();
  redrawEdges();
  detailBody.innerHTML = '<div class="empty">点击节点查看完整内容</div>';
  clearPendingRefs();
  loadChatHistory(chatJustSwitched); chatJustSwitched = false;
  updateStatusBar();
}

// 空白拖拽平移
let panning = false;
let panStartX = 0, panStartY = 0;
// 记录当前平移手势（用于抑制平移后的 click 误触发）
let panGesture = null;
function startCanvasPan(e) {
  if (e.button !== 0) return;
  if (e.target.closest('#detail') || e.target.closest('#sidebar') || e.target.closest('#chatPanel') || e.target.closest('#toolbar')) return;
  if (connectFrom) endConnect();
  clearEgo();
  e.preventDefault();
  panning = true;
  panStartX = e.clientX;
  panStartY = e.clientY;
  panGesture = { moved: false };
  canvasWrap.classList.add('panning');
}
canvasWrap.addEventListener('mousedown', (e) => {
  if (e.target.closest('.node')) return; // 节点/板块有自己的拖拽逻辑
  if (viewMode === 'axis') { startAxisPan(e); return; }
  startCanvasPan(e);
});
window.addEventListener('mousemove', (e) => {
  if (viewMode === 'axis' && axisPanning) {
    axisViewT.x += e.clientX - axisPanStartX;
    axisViewT.y += e.clientY - axisPanStartY;
    axisPanStartX = e.clientX;
    axisPanStartY = e.clientY;
    applyAxisTransform();
    return;
  }
  if (!panning) return;
  const dx = e.clientX - panStartX;
  const dy = e.clientY - panStartY;
  if (panGesture && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) panGesture.moved = true;
  panStartX = e.clientX;
  panStartY = e.clientY;
  view.x += dx;
  view.y += dy;
  updateView();
});
window.addEventListener('mouseup', () => {
  if (viewMode === 'axis' && axisPanning) {
    axisPanning = false;
    canvasWrap.classList.remove('panning');
  }
  if (panning) {
    panning = false;
    canvasWrap.classList.remove('panning');
  }
});

// 滚轮缩放（以鼠标为中心）
canvasWrap.addEventListener('wheel', (e) => {
    if (e.target.closest('#chatPanel') || e.target.closest('#sidebar') || e.target.closest('#detail')) return;
    e.preventDefault();
  if (viewMode === 'axis') { axisWheelZoom(e); return; }
  const rect = canvasWrap.getBoundingClientRect();
  const before = screenToWorld(e.clientX, e.clientY);
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const next = Math.min(3, Math.max(0.2, view.scale * factor));
  const ratio = next / view.scale;
  view.x = (e.clientX - rect.left) - before.x * next;
  view.y = (e.clientY - rect.top) - before.y * next;
  view.scale = next;
  updateView();
}, { passive: false });

// ── 右键菜单 ──────────────────────────────────────────────
const contextMenu = document.getElementById('contextMenu');
function hideMenu() { contextMenu.style.display = 'none'; }
function showMenu(x, y, items) {
  contextMenu.innerHTML = '';
  for (const item of items) {
    if (item.sep) {
      const d = document.createElement('div');
      d.className = 'sep';
      contextMenu.appendChild(d);
      continue;
    }
    const b = document.createElement('button');
    b.textContent = item.label;
    b.addEventListener('click', () => { hideMenu(); item.action(); });
    contextMenu.appendChild(b);
  }
  contextMenu.style.display = 'block';
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
}
document.addEventListener('click', hideMenu);
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('#contextMenu')) hideMenu();
});

// 节点右键：编辑 / 重命名 / 删除 / 添加到对话（画布与左侧栏共用）
function showNodeMenu(x, y, n) {
  const menuItems = [
    { label: '打开', action: () => { focusNode(n.id); showDetail(n); } },
    { label: '重命名', action: () => renameChapter(n) },
    { label: '🗑️ 删除', action: async () => {
        if (!(await confirmDialog(`确定删除「${n.title}」？会写回项目文件。`))) return;
        await fetch('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: n.id, project: currentProject }) });
        await loadData();
      }
    },
    { label: '添加到对话', action: () => addRefToChat(n) },
  ];
  showMenu(x, y, menuItems);
}
world.addEventListener('contextmenu', (e) => {
  const nodeEl = e.target.closest('.node');
  if (!nodeEl) return;
  e.preventDefault();
  e.stopPropagation();
  const n = nodeMap[nodeEl.dataset.id];
  showNodeMenu(e.clientX, e.clientY, n);
});

// 空白右键：新建节点
const NEW_CATS = [
  { type: 'role', label: '角色' },
  { type: 'faction', label: '势力' },
  { type: 'setting', label: '设定' },
  { type: 'foreshadow', label: '伏笔' },
  { type: 'volume', label: '卷/大纲' },
];
canvasWrap.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.node')) return;
  if (e.target.closest('#chatPanel') || e.target.closest('#sidebar') || e.target.closest('#detail')) return;
  if (suppressNextContextMenu || marqueeActive) {
    e.preventDefault();
    e.stopPropagation();
    suppressNextContextMenu = false;
    return;
  }
  e.preventDefault();
      e.stopPropagation();
    showMenu(e.clientX, e.clientY, NEW_CATS.map(c => ({
    label: '新建' + c.label,
    action: () => createNode(c.type, c.label),
  })));
});

// ── 长按右键框选批量编辑 ─────────────────────────────────
const marqueeEl = document.getElementById('marquee');
let selectedNodeIds = new Set();
let rightTimer = null;
let marqueeActive = false;
let suppressNextContextMenu = false;
let marqueeStart = null;

function clearNodeSelection() {
  selectedNodeIds.clear();
  world.querySelectorAll('.node.selected').forEach(el => el.classList.remove('selected'));
  updateSelectedStatus();
}

function updateSelectedStatus() {
  const el = document.getElementById('statusSelected');
  if (el) el.textContent = selectedNodeIds.size ? '选中：' + selectedNodeIds.size : '';
}

function updateMarqueeStyle() {
  if (!marqueeActive || !marqueeStart) return;
  const left = Math.min(marqueeStart.wrapX, marqueeStart.curX);
  const top = Math.min(marqueeStart.wrapY, marqueeStart.curY);
  marqueeEl.style.display = 'block';
  marqueeEl.style.left = left + 'px';
  marqueeEl.style.top = top + 'px';
  marqueeEl.style.width = Math.abs(marqueeStart.curX - marqueeStart.wrapX) + 'px';
  marqueeEl.style.height = Math.abs(marqueeStart.curY - marqueeStart.wrapY) + 'px';
}

function selectNodesInRect() {
  clearNodeSelection();
  const wrapRect = canvasWrap.getBoundingClientRect();
  const mr = marqueeEl.getBoundingClientRect();
  const r = {
    left: mr.left - wrapRect.left,
    top: mr.top - wrapRect.top,
    right: mr.right - wrapRect.left,
    bottom: mr.bottom - wrapRect.top
  };
  for (const n of nodes) {
    const p = positions[n.id];
    if (!p) continue;
    const cx = (p.x + 100) * view.scale + view.x;
    const cy = (p.y + 32) * view.scale + view.y;
    if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
      selectedNodeIds.add(n.id);
      const el = world.querySelector(`.node[data-id="${n.id}"]`);
      if (el) el.classList.add('selected');
    }
  }
  updateSelectedStatus();
}

function buildBatchMenu() {
  const selectedNodes = [...selectedNodeIds].map(id => nodeMap[id]).filter(Boolean);
  const count = selectedNodes.length;
  return [
    {
      label: `批量标题加前缀（${count}）...`,
      action: async () => {
        const prefix = prompt('输入要添加到标题前面的文字：');
        if (!prefix) return;
        for (const n of selectedNodes) {
          await fetch('/api/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: n.id, title: prefix + n.title, project: currentProject })
          });
        }
        clearNodeSelection();
        await loadData();
      }
    },
    {
      label: `批量标题加后缀（${count}）...`,
      action: async () => {
        const suffix = prompt('输入要添加到标题后面的文字：');
        if (!suffix) return;
        for (const n of selectedNodes) {
          await fetch('/api/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: n.id, title: n.title + suffix, project: currentProject })
          });
        }
        clearNodeSelection();
        await loadData();
      }
    },
    {
      label: `批量添加到 AI 对话（${count}）`,
      action: () => {
        for (const n of selectedNodes) addRefToChat(n);
        clearNodeSelection();
      }
    },
    {
      label: `批量删除（${count}）`,
      action: async () => {
        if (!(await confirmDialog(`确定删除选中的 ${count} 个节点？会写回项目文件。`))) return;
        for (const n of selectedNodes) {
          await fetch('/api/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: n.id, project: currentProject })
          });
        }
        clearNodeSelection();
        await loadData();
      }
    },
    { label: '清除选中', action: () => clearNodeSelection() }
  ];
}

function startRightMarquee(e) {
  if (e.button !== 2 || e.target.closest('.node')) return;
  suppressNextContextMenu = false;
  const rect = canvasWrap.getBoundingClientRect();
  marqueeStart = {
    wrapX: e.clientX - rect.left,
    wrapY: e.clientY - rect.top,
    curX: e.clientX - rect.left,
    curY: e.clientY - rect.top
  };
  rightTimer = setTimeout(() => {
    marqueeActive = true;
    marqueeEl.style.display = 'block';
    marqueeEl.style.left = marqueeStart.wrapX + 'px';
    marqueeEl.style.top = marqueeStart.wrapY + 'px';
    marqueeEl.style.width = '0px';
    marqueeEl.style.height = '0px';
  }, 350);
}

function cancelRightMarquee() {
  clearTimeout(rightTimer);
  rightTimer = null;
  if (marqueeActive) {
    marqueeActive = false;
    marqueeEl.style.display = 'none';
  }
}

canvasWrap.addEventListener('mousedown', startRightMarquee);
canvasWrap.addEventListener('mousemove', (e) => {
  if (!marqueeActive || !marqueeStart) return;
  const rect = canvasWrap.getBoundingClientRect();
  marqueeStart.curX = e.clientX - rect.left;
  marqueeStart.curY = e.clientY - rect.top;
  updateMarqueeStyle();
});
window.addEventListener('mouseup', (e) => {
  if (e.button !== 2) return;
  if (marqueeActive) {
    marqueeActive = false;
    selectNodesInRect();
    marqueeEl.style.display = 'none';
    suppressNextContextMenu = true;
    if (selectedNodeIds.size) {
      showMenu(e.clientX, e.clientY, buildBatchMenu());
    }
  }
  cancelRightMarquee();
});

// 选中快捷键：Esc 清除选中，Delete/Backspace 批量删除
document.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    if (selectedNodeIds.size) clearNodeSelection();
    hideMenu();
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeIds.size) {
    const t = e.target;
    if (t && (t.closest('input') || t.closest('textarea') || t.closest('select') || t.isContentEditable)) return;
    e.preventDefault();
    const selectedNodes = [...selectedNodeIds].map(id => nodeMap[id]).filter(Boolean);
    if (!(await confirmDialog(`确定删除选中的 ${selectedNodes.length} 个节点？会写回项目文件。`))) return;
    (async () => {
      for (const n of selectedNodes) {
        await fetch('/api/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: n.id, project: currentProject })
        });
      }
      clearNodeSelection();
      await loadData();
    })();
  }
});



// ── 对话面板 ──────────────────────────────────────────────
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
const chatPanel = document.getElementById('chatPanel');
function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.textContent = text;
  div.addEventListener('dblclick', () => {
    div.contentEditable = 'true';
    div.classList.add('editing');
    div.focus();
  });
  div.addEventListener('blur', () => {
    div.contentEditable = 'false';
    div.classList.remove('editing');
  });
  div.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      div.blur();
    }
  });
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderProposals(list) {
  if (!Array.isArray(list) || list.length === 0) return;
  for (const p of list) {
    if (renderedProposalIds.has(p.id)) continue;
    renderedProposalIds.add(p.id);
    const box = document.createElement('div');
    box.className = 'proposal';
    const kindText = p.kind === 'edit' ? '修改' : p.kind === 'create' ? '新增' : p.kind === 'file_edit' ? '文件修改' : '删除';
    box.innerHTML =
      '<h4>待审阅：' + escapeHtml(kindText) + '「' + escapeHtml(p.title || '') + '」</h4>' +
      '<div class="meta">' + escapeHtml(p.file || '') + '</div>' +
      '<div class="diffBox">' +
        '<div><div style="font-size:11px;color:#b91c1c;margin-bottom:4px">旧内容</div><pre class="old">' + escapeHtml(p.oldContent || '（空）') + '</pre></div>' +
        '<div><div style="font-size:11px;color:#047857;margin-bottom:4px">新内容</div><pre class="new">' + escapeHtml(p.newContent || '（空）') + '</pre></div>' +
      '</div>' +
      '<div class="actions"><button class="accept">接受</button><button class="reject">拒绝</button></div>';
    box.querySelector('.accept').addEventListener('click', async () => {
      try {
        const res = await fetch('/api/apply_proposal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: p.id, project: currentProject })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        box.remove();
        await loadData();
        const acceptedNode = p.nodeId ? nodeMap[p.nodeId] : null;
        if (p.kind === 'edit' && acceptedNode && isChapterNode(acceptedNode)) {
          runAdvance(p.nodeId);
        }
      } catch (e) {
        showToast('接受失败：' + e.message, 'error');
      }
    });
    box.querySelector('.reject').addEventListener('click', async () => {
      try {
        await fetch('/api/proposals/reject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: p.id })
        });
      } catch (_) {}
      box.remove();
    });
    chatMessages.appendChild(box);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

// 渲染 AI 工具调用过程（读/搜/改/连线等步骤）
function renderAgentSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return;
  for (const s of steps) {
    const div = document.createElement('div');
    div.className = 'msg tool';
    div.textContent = '🔧 ' + (s.summary || (s.tool || 'tool'));
    chatMessages.appendChild(div);
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 聊天模型选择持久化
const CHAT_MODEL_MIGRATIONS = {
  'deepseek-v4-flash-0731': 'deepseek-v4-flash',
  'deepseek-chat': 'deepseek-v4-flash',
  'deepseek-reasoner': 'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-v4-flash'
};
function initChatModelSelect() {
  const sel = document.getElementById('chatModel');
  if (!sel) return;
  try {
    let saved = localStorage.getItem('novelCanvasChatModel');
    if (saved && CHAT_MODEL_MIGRATIONS[saved]) {
      saved = CHAT_MODEL_MIGRATIONS[saved];
      localStorage.setItem('novelCanvasChatModel', saved);
    }
    if (saved && [...sel.options].some(o => o.value === saved)) sel.value = saved;
  } catch (_) {}
  sel.addEventListener('change', () => {
    try { localStorage.setItem('novelCanvasChatModel', sel.value); } catch (_) {}
  });
}

async function loadPendingProposals() {
  if (!currentProject) return;
  try {
    const res = await fetch('/api/proposals?project=' + encodeURIComponent(currentProject));
    const data = await res.json();
    if (data.error) return;
    const list = data.proposals || [];
    if (list.length) {
      const pending = list.filter(p => !renderedProposalIds.has(p.id));
      if (pending.length) {
        addMsg('assistant', '有 ' + pending.length + ' 个待审阅提案（已持久化，重启不丢）。');
      }
      renderProposals(list);
    }
  } catch (_) {}
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  // 待发送的选中引用写入对话上下文（Trae 风格：引用标签在发送时生效）
  for (const ref of (pendingRefs || [])) {
    chatHistory.push({ role: 'ref', content: ref.chatContent || '【引用】' + (ref.title || ref.file || '') + ' 选中片段：\n' + ref.content });
  }
  clearPendingRefs();
  chatHistory.push({ role: 'user', content: text });
  addMsg('user', text);
  addMsg('assistant', '思考中...');
  try {
    const modelSel = document.getElementById('chatModel');
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatPayloadMessages(), project: currentProject, skills: selectedSkills(), role: currentRole(), model: modelSel ? modelSel.value : '' })
    });
    const data = await res.json();
    if (chatMessages.lastElementChild && chatMessages.lastElementChild.textContent === '思考中...') {
      chatMessages.lastElementChild.remove();
    }
    renderAgentSteps(data.steps);
    const reply = data.reply || data.error || '（无回复）';
    chatHistory.push({ role: 'assistant', content: reply });
    localStorage.setItem(chatStorageKey(), JSON.stringify(chatHistory));
    addMsg('assistant', reply);
    addUsageNote(data.usage);
    renderProposals(data.proposals);
  } catch (e) {
    if (chatMessages.lastElementChild && chatMessages.lastElementChild.textContent === '思考中...') {
      chatMessages.lastElementChild.remove();
    }
    addMsg('assistant', '请求失败: ' + e.message);
  }
}

async function runAgent(mode) {
  const labels = { plot: '剧情军师', deslop: '去AI味', foresight: '伏笔审计', audit: '防漂移', advance: '人物推进', write: '生成下一章', volumes: '卷管理', cores: '章节核心' };
  const label = labels[mode] || mode;
  if (mode === 'audit') return runAudit();
  if (mode === 'advance') return runAdvance();
  if (mode === 'write') return runWriteChapter();
  if (mode === 'volumes') return runVolumes();
  if (mode === 'cores') return runCores();
  let text = '';
  let deslopNode = null;
  if (mode === 'deslop') {
    const pasted = chatInput.value.trim();
    let node = null;
    if (egoNodeId && nodeMap[egoNodeId]) node = nodeMap[egoNodeId];
    else if (selectedNodeIds.size) node = nodeMap[[...selectedNodeIds][0]];
    if (pasted) {
      text = '请对以下正文做去AI味重写：\n\n' + pasted;
    } else if (node && (node.content || '').trim()) {
      deslopNode = node;
      text = '请对当前节点《' + node.title + '》的以下正文做去AI味重写：\n\n' + node.content;
    } else {
      addMsg('assistant', '去AI味需要先点击一个章节/节点，或在输入框粘贴要改的正文，再点“去AI味”。');
      return;
    }
  } else {
    text = {
      plot: '请为下一章生成 3-5 个冲突方案，结合当前大纲、伏笔、角色状态和最新章节进度。不要直接写完整正文。',
      foresight: '请审计当前项目所有伏笔：已埋、计划回收、该回收未回收、相互矛盾的点，并给出建议回收章节。'
    }[mode] || '';
  }
  chatInput.value = '';
  chatHistory.push({ role: 'user', content: '【' + label + '】' + text });
  addMsg('user', '【' + label + '】' + text.slice(0, 300));
  addMsg('assistant', '思考中...');
  try {
    const modelSel = document.getElementById('chatModel');
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatPayloadMessages(), project: currentProject, skills: selectedSkills(), agentMode: mode, role: currentRole(), model: modelSel ? modelSel.value : '' })
    });
    const data = await res.json();
    if (chatMessages.lastElementChild && chatMessages.lastElementChild.textContent === '思考中...') {
      chatMessages.lastElementChild.remove();
    }
    renderAgentSteps(data.steps);
    const reply = data.reply || data.error || '（无回复）';
    chatHistory.push({ role: 'assistant', content: reply });
    localStorage.setItem(chatStorageKey(), JSON.stringify(chatHistory));
    addMsg('assistant', reply);
    addUsageNote(data.usage);
    renderProposals(data.proposals);
    if (mode === 'deslop' && deslopNode && reply && reply.trim()) {
      openDiffModal(deslopNode, reply);
    }
  } catch (e) {
    if (chatMessages.lastElementChild && chatMessages.lastElementChild.textContent === '思考中...') {
      chatMessages.lastElementChild.remove();
    }
    addMsg('assistant', '请求失败: ' + e.message);
  }
}

// ── 防漂移一致性审查 ──────────────────────────────────────
let currentAudit = null;
function openAudit() {
  const m = document.getElementById('auditModal');
  if (m) m.classList.add('show');
  switchAuditTab('audit');
}
function closeAudit() {
  const m = document.getElementById('auditModal');
  if (m) m.classList.remove('show');
}
function switchAuditTab(tab) {
  const auditPane = document.getElementById('auditPane');
  const statsPane = document.getElementById('statsPane');
  const tabs = document.querySelectorAll('#auditModal .auditTab');
  const isAudit = tab === 'audit';
  if (auditPane) auditPane.style.display = isAudit ? '' : 'none';
  if (statsPane) statsPane.style.display = isAudit ? 'none' : '';
  tabs.forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
}
function renderAudit(data) {
  const summaryEl = document.getElementById('auditSummary');
  const bodyEl = document.getElementById('auditBody');
  if (!summaryEl || !bodyEl) return;
  const overall = Number(data.overall || 0);
  const overallCls = overall >= 95 ? 'pass' : overall >= 80 ? 'warn' : 'fail';
  const dims = data.dimensions || {};
  const hardRules = Array.isArray(data.hardRules) ? data.hardRules : [];
  const issues = Array.isArray(data.issues) ? data.issues : [];
  const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
  const hardFail = hardRules.some(r => r.pass === false);
  summaryEl.innerHTML =
    '<div class="auditScoreCard ' + overallCls + '"><div class="num">' + overall + '</div><div class="lbl">综合一致分</div></div>' +
    '<div class="auditScoreCard ' + (hardFail ? 'fail' : 'pass') + '"><div class="num">' + (hardFail ? '未通过' : '通过') + '</div><div class="lbl">硬性条件</div></div>' +
    '<div class="auditScoreCard ' + overallCls + '"><div class="num">' + (Object.keys(dims).length || 0) + '</div><div class="lbl">审查维度</div></div>' +
    '<div class="auditScoreCard ' + (issues.length ? 'warn' : 'pass') + '"><div class="num">' + issues.length + '</div><div class="lbl">发现的问题</div></div>';
  if (data.targetVolume || data.targetCore) {
    summaryEl.innerHTML += '<div class="auditMeta">' +
      (data.targetVolume ? '卷：' + escapeHtml(data.targetVolume) + '　' : '') +
      (data.targetCore ? '章节核心：' + escapeHtml(data.targetCore) : '') +
      '</div>';
  }
  let html = '<div class="auditSection"><h4>12 维一致性评分</h4><div class="auditDims">';
  for (const [name, score] of Object.entries(dims)) {
    const cls = score >= 95 ? 'pass' : score >= 80 ? 'warn' : 'fail';
    html += '<div class="auditDim ' + cls + '"><span>' + escapeHtml(name) + '</span><span class="score">' + Number(score).toFixed(0) + '</span></div>';
  }
  html += '</div></div>';
  if (hardRules.length) {
    html += '<div class="auditSection"><h4>硬性条件</h4>';
    for (const r of hardRules) {
      html += '<div class="auditRule ' + (r.pass === false ? 'fail' : 'pass') + '"><span>' + escapeHtml(r.name || '') + '</span><span class="ruleStatus">' + (r.pass === false ? '不通过' : '通过') + '</span></div>';
    }
    html += '</div>';
  }
  if (issues.length) {
    html += '<div class="auditSection"><h4>问题清单</h4><ul class="auditIssues">';
    for (const i of issues) html += '<li>' + escapeHtml(i) + '</li>';
    html += '</ul></div>';
  }
  if (suggestions.length) {
    html += '<div class="auditSection"><h4>修改建议</h4><ul class="auditIssues">';
    for (const i of suggestions) html += '<li>' + escapeHtml(i) + '</li>';
    html += '</ul></div>';
  }
  bodyEl.innerHTML = html;
}
async function runAudit() {
  const targetNode = (egoNodeId && nodeMap[egoNodeId]) ? nodeMap[egoNodeId] : null;
  const pasted = chatInput.value.trim();
  let nodeId = null;
  let content = undefined;
  if (targetNode) {
    nodeId = targetNode.id;
    content = targetNode.content;
  } else if (selectedNodeIds.size) {
    const n = nodeMap[[...selectedNodeIds][0]];
    if (n) { nodeId = n.id; content = n.content; }
  } else if (pasted) {
    content = pasted;
  } else {
    addMsg('assistant', '防漂移审查需要先点击一个章节/节点，或在输入框粘贴要审查的正文。');
    return;
  }
  chatInput.value = '';
  openAudit();
  const summaryEl = document.getElementById('auditSummary');
  const bodyEl = document.getElementById('auditBody');
  if (summaryEl) summaryEl.innerHTML = '<div class="auditLoading">正在构建人物卡/事件封包并审查...</div>';
  if (bodyEl) bodyEl.innerHTML = '';
  try {
    const res = await fetch('/api/consistency/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: currentProject, nodeId, content })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    currentAudit = { nodeId, content, issues: data.issues || [], suggestions: data.suggestions || [] };
    renderAudit(data);
  } catch (e) {
    if (summaryEl) summaryEl.innerHTML = '<div class="auditLoading">审查失败：' + escapeHtml(e.message) + '</div>';
  }
}

async function fixAudit() {
  if (!currentAudit) return;
  const btn = document.getElementById('auditFixBtn');
  btn.disabled = true;
  btn.textContent = '修正中...';
  try {
    const res = await fetch('/api/consistency/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: currentProject,
        nodeId: currentAudit.nodeId,
        content: currentAudit.content,
        issues: currentAudit.issues,
        suggestions: currentAudit.suggestions
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const node = currentAudit.nodeId ? nodeMap[currentAudit.nodeId] : null;
    if (node) {
      openDiffModal(node, data.content);
      closeAudit();
    } else {
      const bodyEl = document.getElementById('auditBody');
      if (bodyEl) bodyEl.innerHTML = '<div class="auditLoading">修正完成（未绑定节点，以下是新正文）：</div><pre class="diffPre new">' + escapeHtml(data.content) + '</pre>';
    }
  } catch (e) {
    showToast('修正失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'AI 自动修正';
  }
}

async function runAuditPolish() {
  if (!currentAudit) return;
  const btn = document.getElementById('auditPolishBtn');
  const fixBtn = document.getElementById('auditFixBtn');
  btn.disabled = true;
  if (fixBtn) fixBtn.disabled = true;
  btn.textContent = '精修中...';
  const bodyEl = document.getElementById('auditBody');
  if (bodyEl) bodyEl.innerHTML = '<div class="auditLoading">正在自动精修：审查 → 修正 → 复审，直到 ≥95 或达到次数上限...</div>';
  try {
    const res = await fetch('/api/consistency/polish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: currentProject,
        nodeId: currentAudit.nodeId,
        content: currentAudit.content,
        threshold: 95,
        maxAttempts: 3
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const lines = (data.attempts || []).map(a =>
      '第' + a.round + '次审查：' + a.overall + ' 分' + (a.hardPass ? '' : '（硬性未过）') + '，问题 ' + a.issues + ' 个'
    ).join('<br>');
    if (bodyEl) {
      bodyEl.innerHTML = '<div class="auditLoading">精修结果：<br>' + lines + '<br>最终 ' + data.finalOverall + ' 分' + (data.finalHardPass ? ' ✅ 硬性通过' : ' ❌ 硬性未过') + '</div>';
    }
    const node = currentAudit.nodeId ? nodeMap[currentAudit.nodeId] : null;
    if (node) {
      openDiffModal(node, data.content);
      closeAudit();
    } else if (bodyEl) {
      bodyEl.innerHTML += '<pre class="diffPre new">' + escapeHtml(data.content) + '</pre>';
    }
  } catch (e) {
    if (bodyEl) bodyEl.innerHTML = '<div class="auditLoading">精修失败：' + escapeHtml(e.message) + '</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = '自动精修至≥95';
    if (fixBtn) fixBtn.disabled = false;
  }
}

async function runWriteChapter() {
  const targetNode = (egoNodeId && nodeMap[egoNodeId] && isChapterNode(nodeMap[egoNodeId])) ? nodeMap[egoNodeId] : null;
  const pasted = chatInput.value.trim();
  let nodeId = null;
  let content = undefined;
  if (targetNode) {
    nodeId = targetNode.id;
    content = targetNode.content;
  } else if (selectedNodeIds.size) {
    const n = nodeMap[[...selectedNodeIds][0]];
    if (n && isChapterNode(n)) { nodeId = n.id; content = n.content; }
  } else if (pasted) {
    content = pasted;
  } else {
    addMsg('assistant', '生成下一章需要先点击上一章节点，或在输入框粘贴上一章结尾。');
    return;
  }
  chatInput.value = '';
  const thinkingText = '正在基于人物卡/卷纲/伏笔生成下一章...';
  addMsg('assistant', thinkingText);
  const thinking = chatMessages.lastElementChild;
  try {
    const res = await fetch('/api/chapter/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: currentProject, nodeId, content })
    });
    const data = await res.json();
    if (chatMessages.lastElementChild === thinking) thinking.remove();
    if (data.error) throw new Error(data.error);
    const createRes = await fetch('/api/chapter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: currentProject, title: data.title })
    });
    const createData = await createRes.json();
    if (createData.error) throw new Error(createData.error);
    await loadData();
    const newNode = nodeMap[createData.node.id];
    if (newNode) openDiffModal(newNode, data.content);
    addMsg('assistant', '已生成下一章《' + data.title + '》，请确认覆盖写入。');
  } catch (e) {
    if (chatMessages.lastElementChild === thinking) thinking.remove();
    addMsg('assistant', '请求失败: ' + e.message);
  }
}

function openStats() {
  const m = document.getElementById('auditModal');
  if (m) m.classList.add('show');
  switchAuditTab('stats');
}
function closeStats() {
  closeAudit();
}
function renderStats(data) {
  const summaryEl = document.getElementById('statsSummary');
  const bodyEl = document.getElementById('statsBody');
  if (!summaryEl || !bodyEl) return;
  const driftRate = Number(data.driftRate || 0);
  const rateCls = driftRate <= 5 ? 'pass' : driftRate <= 15 ? 'warn' : 'fail';
  summaryEl.innerHTML =
    '<div class="statsCard ' + rateCls + '"><div class="num">' + driftRate + '%</div><div class="lbl">漂移率（<95分占比）</div></div>' +
    '<div class="statsCard"><div class="num">' + Number(data.avgOverall || 0) + '</div><div class="lbl">平均一致分</div></div>' +
    '<div class="statsCard"><div class="num">' + data.totalAudits + '</div><div class="lbl">审查次数</div></div>' +
    '<div class="statsCard"><div class="num">' + data.hardFailCount + '</div><div class="lbl">硬性失败</div></div>' +
    '<div class="statsCard"><div class="num">' + data.chapterCount + '</div><div class="lbl">章节数</div></div>' +
    '<div class="statsCard"><div class="num">' + (data.totalWords || 0).toLocaleString() + '</div><div class="lbl">总字数</div></div>';
  let html = '';
  if (data.latest && data.latest.length) {
    const trend = data.latest.slice(0, 20).reverse();
    let bars = '';
    for (const a of trend) {
      const s = Number(a.overall || 0);
      const cls = s >= 95 ? 'pass' : s >= 80 ? 'warn' : 'fail';
      const label = (a.timestamp || '').replace('T', ' ').slice(5, 16);
      bars += '<div class="trendRow"><span class="trendLabel" title="' + escapeHtml(a.title || a.nodeId || '') + '">' + escapeHtml(label) + '</span>' +
        '<span class="trendBar"><span class="trendFill ' + cls + '" style="width:' + Math.max(2, Math.min(100, s)) + '%"></span></span>' +
        '<span class="trendVal ' + cls + '">' + s + '</span></div>';
    }
    html += '<div class="auditSection"><h4>分数趋势（最近 ' + trend.length + ' 次，95 分线为达标线）</h4><div class="trendChart">' + bars + '</div></div>';
  }
  html += '<div class="auditSection"><h4>按卷统计</h4>';
  if (data.byVolume && data.byVolume.length) {
    html += '<table class="statsTable"><thead><tr><th>卷</th><th>审查次数</th><th>平均分</th><th>漂移次数</th></tr></thead><tbody>';
    for (const v of data.byVolume) {
      html += '<tr><td>' + escapeHtml(v.volume) + '</td><td>' + v.count + '</td><td>' + v.avg + '</td><td>' + v.driftCount + '</td></tr>';
    }
    html += '</tbody></table>';
  } else {
    html += '<p style="color:var(--muted);font-size:13px">暂无审查记录。每次运行「防漂移审查」后会自动记录。</p>';
  }
  html += '</div><div class="auditSection"><h4>最近审查</h4>';
  if (data.latest && data.latest.length) {
    html += '<table class="statsTable"><thead><tr><th>时间</th><th>章节</th><th>卷</th><th>分数</th><th>硬性</th><th>问题</th></tr></thead><tbody>';
    for (const a of data.latest) {
      const time = (a.timestamp || '').replace('T', ' ').slice(5, 16);
      html += '<tr><td>' + escapeHtml(time) + '</td><td>' + escapeHtml(a.title || a.nodeId || '') + '</td><td>' + escapeHtml(a.volume || '') + '</td><td>' + Number(a.overall || 0) + '</td><td>' + (a.hardPass ? '通过' : '失败') + '</td><td>' + (a.issues || 0) + '</td></tr>';
    }
    html += '</tbody></table>';
  } else {
    html += '<p style="color:var(--muted);font-size:13px">暂无记录。</p>';
  }
  html += '</div>';
  bodyEl.innerHTML = html;
}
async function runStats() {
  openStats();
  const summaryEl = document.getElementById('statsSummary');
  const bodyEl = document.getElementById('statsBody');
  if (summaryEl) summaryEl.innerHTML = '<div class="auditLoading">加载统计中...</div>';
  if (bodyEl) bodyEl.innerHTML = '';
  try {
    const res = await fetch('/api/stats?project=' + encodeURIComponent(currentProject));
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderStats(data);
  } catch (e) {
    if (bodyEl) bodyEl.innerHTML = '<div class="auditLoading">加载失败：' + escapeHtml(e.message) + '</div>';
  }
}

function openVolumes() {
  const m = document.getElementById('volumeModal');
  if (m) m.classList.add('show');
}
function closeVolumes() {
  const m = document.getElementById('volumeModal');
  if (m) m.classList.remove('show');
}
async function runVolumes() {
  openVolumes();
  const bodyEl = document.getElementById('volumeBody');
  if (!bodyEl) return;
  bodyEl.innerHTML = '<div class="auditLoading">加载卷信息中...</div>';
  try {
    const res = await fetch('/api/volumes?project=' + encodeURIComponent(currentProject));
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const vols = data.volumes || [];
    let html = '<table class="statsTable"><thead><tr><th>卷名</th><th>章节数</th><th>字数</th><th>大纲文件</th><th>操作</th></tr></thead><tbody>';
    if (vols.length) {
      for (const v of vols) {
        html += '<tr>' +
          '<td>' + escapeHtml(v.name) + '<div style="font-size:11px;color:var(--muted)">' + escapeHtml(v.rel || '') + '</div></td>' +
          '<td>' + v.chapterCount + '</td>' +
          '<td>' + (v.totalWords || 0).toLocaleString() + '</td>' +
          '<td>' + escapeHtml(v.outlineFile || '（未创建）') + '</td>' +
          '<td><button class="volBtn volOpen" data-rel="' + escapeHtml(v.rel) + '" data-file="' + escapeHtml(v.outlineFile || '') + '">大纲</button> ' +
          '<button class="volBtn volRename" data-rel="' + escapeHtml(v.rel) + '" data-name="' + escapeHtml(v.name) + '">重命名</button> ' +
          '<button class="volBtn volDelete" data-rel="' + escapeHtml(v.rel) + '" data-name="' + escapeHtml(v.name) + '">删除</button></td>' +
          '</tr>';
      }
    } else {
      html += '<tr><td colspan="5" style="color:var(--muted)">暂无卷目录，可在上方创建。</td></tr>';
    }
    html += '</tbody></table>';
    bodyEl.innerHTML = html;
  } catch (e) {
    bodyEl.innerHTML = '<div class="auditLoading">加载失败：' + escapeHtml(e.message) + '</div>';
  }
}

async function volumeOpenOutline(rel, file) {
  try {
    let outlineFile = file;
    if (!outlineFile) {
      const res = await fetch('/api/volumes/outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: currentProject, rel })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      outlineFile = data.outlineFile;
    }
    if (typeof openFile === 'function') openFile(outlineFile);
    else showToast('大纲文件：' + outlineFile, 'info');
    closeVolumes();
  } catch (e) {
    showToast('打开大纲失败：' + e.message, 'error');
  }
}

async function volumeRename(rel, oldName) {
  const name = prompt('输入新的卷名：', oldName);
  if (name === null) return;
  const n = name.trim();
  if (!n) return;
  try {
    const res = await fetch('/api/volumes/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: currentProject, rel, name: n })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    await runVolumes();
  } catch (e) {
    showToast('重命名失败：' + e.message, 'error');
  }
}

async function volumeDelete(rel, name) {
  if (!(await confirmDialog('确定删除空卷「' + name + '」？只有空目录才能删除。'))) return;
  try {
    const res = await fetch('/api/volumes/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: currentProject, rel })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    await runVolumes();
  } catch (e) {
    showToast('删除失败：' + e.message, 'error');
  }
}

document.getElementById('volumeBody').addEventListener('click', (e) => {
  const btn = e.target.closest('button.volBtn');
  if (!btn) return;
  const rel = btn.dataset.rel;
  if (btn.classList.contains('volOpen')) volumeOpenOutline(rel, btn.dataset.file);
  else if (btn.classList.contains('volRename')) volumeRename(rel, btn.dataset.name);
  else if (btn.classList.contains('volDelete')) volumeDelete(rel, btn.dataset.name);
});

let coreRows = [];
function openCores() {
  const m = document.getElementById('coresModal');
  if (m) m.classList.add('show');
}
function closeCores() {
  const m = document.getElementById('coresModal');
  if (m) m.classList.remove('show');
}
function renderCores() {
  const bodyEl = document.getElementById('coresBody');
  const countEl = document.getElementById('coresCount');
  if (!bodyEl) return;
  const onlyMissing = document.getElementById('coresOnlyMissing') && document.getElementById('coresOnlyMissing').checked;
  const rows = onlyMissing ? coreRows.filter(r => !r.core) : coreRows;
  if (countEl) countEl.textContent = onlyMissing
    ? ('缺核心 ' + rows.length + ' / ' + coreRows.length + ' 章')
    : ('共 ' + rows.length + ' 章');
  if (!rows.length) {
    bodyEl.innerHTML = '<div class="auditLoading">' + (onlyMissing ? '所有章节都有核心 🎉' : '暂无章节') + '</div>';
    return;
  }
  let html = '';
  for (const r of rows) {
    html += '<div class="coresRow">' +
      '<div class="coresMeta"><strong>' + escapeHtml(r.title) + '</strong><br><span style="color:var(--muted)">' + escapeHtml(r.file || '') + '</span></div>' +
      '<input data-nodeid="' + escapeHtml(r.nodeId) + '" value="' + escapeHtml(r.core || '') + '" placeholder="填写本章核心（会写入 <!-- 章节核心：... -->）">' +
      '</div>';
  }
  bodyEl.innerHTML = html;
}
async function runCores() {
  openCores();
  const bodyEl = document.getElementById('coresBody');
  if (bodyEl) bodyEl.innerHTML = '<div class="auditLoading">加载章节中...</div>';
  try {
    const res = await fetch('/api/chapters/cores?project=' + encodeURIComponent(currentProject));
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    coreRows = data.chapters || [];
    renderCores();
  } catch (e) {
    if (bodyEl) bodyEl.innerHTML = '<div class="auditLoading">加载失败：' + escapeHtml(e.message) + '</div>';
  }
}
async function saveCores() {
  const inputs = document.querySelectorAll('#coresBody input[data-nodeid]');
  const items = [];
  for (const inp of inputs) {
    const nodeId = inp.dataset.nodeid;
    const core = inp.value.trim();
    const row = coreRows.find(r => r.nodeId === nodeId);
    if (core !== (row ? (row.core || '') : '')) items.push({ nodeId, core });
  }
  if (!items.length) { showToast('没有需要保存的修改。', 'info'); return; }
  const btn = document.getElementById('coresSaveBtn');
  btn.disabled = true;
  btn.textContent = '保存中...';
  try {
    const res = await fetch('/api/chapters/cores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: currentProject, items })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showToast('已更新 ' + (data.updated || []).length + ' 章' + ((data.skipped || []).length ? '，跳过 ' + data.skipped.length + ' 项' : ''), 'success');
    await loadData();
    const reload = await fetch('/api/chapters/cores?project=' + encodeURIComponent(currentProject)).then(r => r.json());
    if (reload.chapters) coreRows = reload.chapters;
    renderCores();
  } catch (e) {
    showToast('保存失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '保存全部修改';
  }
}
const coresClose = document.getElementById('coresClose');
if (coresClose) coresClose.addEventListener('click', closeCores);
const coresModalEl = document.getElementById('coresModal');
if (coresModalEl) coresModalEl.addEventListener('click', (e) => { if (e.target === coresModalEl) closeCores(); });
const coresOnlyMissing = document.getElementById('coresOnlyMissing');
if (coresOnlyMissing) coresOnlyMissing.addEventListener('change', renderCores);
const coresSaveBtn = document.getElementById('coresSaveBtn');
if (coresSaveBtn) coresSaveBtn.addEventListener('click', saveCores);

let advanceRunning = false;
async function runAdvance(nodeIdOverride, contentOverride) {
  if (advanceRunning) {
    addMsg('assistant', '已有推进分析正在进行，请稍候。');
    return;
  }
  const targetNode = (egoNodeId && nodeMap[egoNodeId]) ? nodeMap[egoNodeId] : null;
  const pasted = chatInput.value.trim();
  let nodeId = null;
  let content = undefined;
  if (nodeIdOverride) {
    nodeId = nodeIdOverride;
    const n = nodeMap[nodeIdOverride];
    if (n) content = n.content;
    if (contentOverride !== undefined) content = contentOverride;
  } else if (targetNode) {
    nodeId = targetNode.id;
    content = targetNode.content;
  } else if (selectedNodeIds.size) {
    const n = nodeMap[[...selectedNodeIds][0]];
    if (n) { nodeId = n.id; content = n.content; }
  } else if (pasted) {
    content = pasted;
  } else {
    addMsg('assistant', '人物推进需要先点击当前章节节点，或在输入框粘贴本章正文。');
    return;
  }
  if (!nodeIdOverride) chatInput.value = '';
  advanceRunning = true;
  const thinkingText = '正在分析本章人物/伏笔变化...';
  addMsg('assistant', thinkingText);
  const thinking = chatMessages.lastElementChild;
  try {
    const res = await fetch('/api/consistency/advance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: currentProject, nodeId, content })
    });
    const data = await res.json();
    if (chatMessages.lastElementChild === thinking) {
      thinking.remove();
    }
    if (data.error) throw new Error(data.error);
    addMsg('assistant', data.reply || '分析完成');
    renderProposals(data.proposals || []);
  } catch (e) {
    if (chatMessages.lastElementChild === thinking) {
      thinking.remove();
    }
    addMsg('assistant', '请求失败: ' + e.message);
  } finally {
    advanceRunning = false;
  }
}

chatSend.addEventListener('click', sendChat);
initChatModelSelect();
initChatPanelDock();
document.querySelectorAll('.agentCmd').forEach(btn => {
  btn.addEventListener('click', () => runAgent(btn.dataset.agent));
});
// 多智能体角色预设：切换角色时持久化 + 显示该角色欢迎语
const ROLE_WELCOME = {
  general: '你好，我可以结合画布上的角色/设定/伏笔帮你聊剧情。右键节点可“添加到对话”。',
  character: '我是人物设计师。告诉我想设计或深挖的角色，我会结合现有设定给出动机、矛盾、关系网与成长弧光方案。',
  outline: '我是大纲规划师。给我故事方向或现有大纲，我来规划章节结构、冲突节奏和钩子。',
  writer: '我是正文写手。告诉我要写哪个章节/场景，我直接产出流畅有画面感的正文。',
  polish: '我是润色编辑。把要改的正文发我，我来去AI味、压缩节奏、增强画面感。',
  reviewer: '我是审查员。告诉我审查范围（大纲/设定/伏笔/正文），我给出问题清单。'
};
document.querySelectorAll('.roleChip').forEach(chip => {
  chip.addEventListener('click', () => {
    const role = chip.dataset.role || 'general';
    const prev = currentRole();
    setCurrentRole(role);
    syncRoleBar(role);
    if (role !== prev) {
      const welcome = ROLE_WELCOME[role] || ROLE_WELCOME.general;
      addMsg('assistant', welcome);
      showToast('已切换到「' + chip.title + '」角色', 'info');
    }
  });
});
chatInput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    chatInput.select();
  }
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    const start = chatInput.selectionStart;
    const end = chatInput.selectionEnd;
    chatInput.value = chatInput.value.slice(0, start) + '\n' + chatInput.value.slice(end);
    chatInput.selectionStart = chatInput.selectionEnd = start + 1;
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    sendChat();
  }
});

chatMessages.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(chatMessages);
    sel.removeAllRanges();
    sel.addRange(range);
  }
});
// ── 对话框：拖拽调整大小 + 停靠位置（底部/右侧/左侧/悬浮） ──
function chatDockNow() { try { return localStorage.getItem('novelCanvasChatDock') || 'bottom'; } catch (_) { return 'bottom'; } }
function chatSizes() {
  let h = 300, w = 360, fr = null;
  try { h = parseInt(localStorage.getItem('novelCanvasChatHeight') || '300', 10) || 300; } catch (_) {}
  try { w = parseInt(localStorage.getItem('novelCanvasChatWidth') || '360', 10) || 360; } catch (_) {}
  try { fr = JSON.parse(localStorage.getItem('novelCanvasChatFloat') || 'null'); } catch (_) {}
  if (!fr || typeof fr.x !== 'number') fr = { x: Math.round(window.innerWidth * 0.55), y: 70, w: 420, h: 480 };
  return { bottom: h, side: w, float: fr };
}
function isChatCollapsed() { const m = document.getElementById('chatMessages'); return m ? m.style.display === 'none' : false; }
function syncChatPanel() {
  const panel = document.getElementById('chatPanel');
  if (!panel) return;
  const appMain = document.getElementById('appMain');
  const centerArea = document.getElementById('centerArea');
  const dock = chatDockNow();
  const collapsed = isChatCollapsed();
  const s = chatSizes();
  panel.classList.remove('dock-bottom', 'dock-right', 'dock-left', 'dock-float');
  panel.classList.add('dock-' + dock);
  if (dock === 'right') appMain.insertBefore(panel, document.getElementById('detail'));
  else if (dock === 'left') appMain.insertBefore(panel, document.getElementById('sidebar'));
  else if (dock === 'float') document.body.appendChild(panel);
  else centerArea.appendChild(panel);
  panel.style.left = '';
  panel.style.top = '';
  if (dock === 'float') {
    const r = s.float;
    panel.style.left = r.x + 'px';
    panel.style.top = r.y + 'px';
    panel.style.width = r.w + 'px';
    panel.style.height = (collapsed ? 36 : r.h) + 'px';
    panel.style.alignSelf = '';
  } else if (dock === 'right' || dock === 'left') {
    panel.style.width = s.side + 'px';
    panel.style.height = collapsed ? '36px' : 'auto';
    panel.style.alignSelf = collapsed ? 'flex-start' : 'stretch';
  } else {
    panel.style.width = '';
    panel.style.height = (collapsed ? 36 : s.bottom) + 'px';
    panel.style.alignSelf = '';
  }
  const sel = document.getElementById('chatDock');
  if (sel) sel.value = dock;
}
function toggleChat() {
  const msgs = document.getElementById('chatMessages');
  const row = document.getElementById('chatInputRow');
  const btn = document.getElementById('chatToggle');
  const skillBar = document.getElementById('skillBar');
  const agentBar = document.getElementById('agentBar');
  const roleBar = document.getElementById('roleBar');
  const activityChat = document.getElementById('activityChat');
  if (msgs.style.display === 'none') {
    msgs.style.display = 'flex';
    row.style.display = 'flex';
    if (skillBar && skillBar.children.length) skillBar.style.display = 'flex';
    if (agentBar && agentBar.children.length) agentBar.style.display = 'flex';
    if (roleBar) roleBar.style.display = 'flex';
    btn.textContent = '—';
    if (activityChat) activityChat.classList.add('on');
  } else {
    msgs.style.display = 'none';
    row.style.display = 'none';
    if (skillBar) skillBar.style.display = 'none';
    if (agentBar) agentBar.style.display = 'none';
    if (roleBar) roleBar.style.display = 'none';
    btn.textContent = '＋';
    if (activityChat) activityChat.classList.remove('on');
  }
  syncChatPanel();
}
// 拉伸调整大小
let chatResizing = null;
function initChatResize() {
  const handle = document.getElementById('chatResizeHandle');
  const panel = document.getElementById('chatPanel');
  if (!handle || !panel) return;
  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = panel.getBoundingClientRect();
    chatResizing = { dock: chatDockNow(), startX: e.clientX, startY: e.clientY, w: r.width, h: r.height };
    handle.classList.add('active');
  });
  window.addEventListener('mousemove', (e) => {
    if (!chatResizing) return;
    const dx = e.clientX - chatResizing.startX;
    const dy = e.clientY - chatResizing.startY;
    const dock = chatResizing.dock;
    if (dock === 'bottom') {
      const h = Math.max(60, Math.min(window.innerHeight * 0.85, chatResizing.h - dy));
      panel.style.height = h + 'px';
      try { localStorage.setItem('novelCanvasChatHeight', String(h)); } catch (_) {}
    } else if (dock === 'right') {
      const w = Math.max(200, Math.min(window.innerWidth * 0.55, chatResizing.w - dx));
      panel.style.width = w + 'px';
      try { localStorage.setItem('novelCanvasChatWidth', String(w)); } catch (_) {}
    } else if (dock === 'left') {
      const w = Math.max(200, Math.min(window.innerWidth * 0.55, chatResizing.w + dx));
      panel.style.width = w + 'px';
      try { localStorage.setItem('novelCanvasChatWidth', String(w)); } catch (_) {}
    } else if (dock === 'float') {
      const w = Math.max(240, Math.min(window.innerWidth * 0.8, chatResizing.w + dx));
      const h = Math.max(120, Math.min(window.innerHeight * 0.85, chatResizing.h + dy));
      panel.style.width = w + 'px';
      panel.style.height = h + 'px';
      const f = chatSizes().float;
      f.w = w; f.h = h;
      try { localStorage.setItem('novelCanvasChatFloat', JSON.stringify(f)); } catch (_) {}
    }
  });
  window.addEventListener('mouseup', () => {
    if (chatResizing) { chatResizing = null; handle.classList.remove('active'); }
  });
}
// 悬浮模式：拖标题移动
let chatFloating = null;
function initChatFloatDrag() {
  const header = document.getElementById('chatHeader');
  const panel = document.getElementById('chatPanel');
  if (!header || !panel) return;
  header.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (!panel.classList.contains('dock-float')) return;
    if (e.target.closest('select, button, input, textarea')) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    chatFloating = { startX: e.clientX, startY: e.clientY, left: r.left, top: r.top };
  });
  window.addEventListener('mousemove', (e) => {
    if (!chatFloating) return;
    const dx = e.clientX - chatFloating.startX;
    const dy = e.clientY - chatFloating.startY;
    const x = Math.max(0, Math.min(window.innerWidth - 60, chatFloating.left + dx));
    const y = Math.max(0, Math.min(window.innerHeight - 40, chatFloating.top + dy));
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (chatFloating) {
      const f = chatSizes().float;
      f.x = Math.round(parseFloat(panel.style.left) || f.x);
      f.y = Math.round(parseFloat(panel.style.top) || f.y);
      try { localStorage.setItem('novelCanvasChatFloat', JSON.stringify(f)); } catch (_) {}
      chatFloating = null;
    }
  });
}
function initChatPanelDock() {
  const sel = document.getElementById('chatDock');
  if (sel) sel.addEventListener('change', () => {
    try { localStorage.setItem('novelCanvasChatDock', sel.value); } catch (_) {}
    syncChatPanel();
  });
  syncChatPanel();
  initChatResize();
  initChatFloatDrag();
}
async function loadSkills() {
  const bar = document.getElementById('skillBar');
  if (!bar) return;
  bar.innerHTML = '';
  bar.style.display = 'none';
}
function selectedSkills() {
  return [...document.querySelectorAll('#skillBar .skillChip.active')].map(b => b.dataset.name);
}
async function newChat() {
  if (!(await confirmDialog('清空当前项目的对话记录？'))) return;
  chatHistory = [];
  clearPendingRefs();
  localStorage.removeItem(chatStorageKey());
  chatMessages.innerHTML = '<div class="msg assistant">你好，我可以结合画布上的角色/设定/伏笔帮你聊剧情。右键节点可“添加到对话”。</div>';
}
document.getElementById('newChatBtn').addEventListener('click', (e) => { e.stopPropagation(); newChat(); });
document.getElementById('chatToggle').addEventListener('click', toggleChat);
document.getElementById('chatHeader').addEventListener('click', (e) => {
  if (e.target.closest('#chatToggle, #chatModel, #newChatBtn, select, button')) return;
  if (document.getElementById('chatPanel').classList.contains('dock-float')) return; // 悬浮时标题只用于拖动
  toggleChat();
});

// 侧栏 / 详情折叠
const sidebarEl = document.getElementById('sidebar');
const sidebarShowBtn = document.getElementById('sidebarShow');
const sidebarCollapseBtn = document.getElementById('sidebarCollapse');
const detailEl = document.getElementById('detail');
const detailShowBtn = document.getElementById('detailShow');
const detailCollapseBtn = document.getElementById('detailCollapse');
sidebarCollapseBtn.addEventListener('click', () => {
  sidebarEl.classList.add('hidden');
  document.getElementById('sidebarResizer').classList.add('hidden');
  sidebarShowBtn.classList.add('show');
});
sidebarShowBtn.addEventListener('click', () => {
  sidebarEl.classList.remove('hidden');
  document.getElementById('sidebarResizer').classList.remove('hidden');
  sidebarShowBtn.classList.remove('show');
});
detailCollapseBtn.addEventListener('click', () => {
  detailEl.classList.add('hidden');
  document.getElementById('detailResizer').classList.add('hidden');
  detailShowBtn.classList.add('show');
});
detailShowBtn.addEventListener('click', () => {
  detailEl.classList.remove('hidden');
  document.getElementById('detailResizer').classList.remove('hidden');
  detailShowBtn.classList.remove('show');
});

// 左右侧栏拖拽调整宽度
function initResizer(handleId, targetId, mode) {
  const handle = document.getElementById(handleId);
  const target = document.getElementById(targetId);
  let startX = 0, startW = 0, dragging = false;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    startX = e.clientX;
    startW = target.offsetWidth;
    handle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    function move(ev) {
      if (!dragging) return;
      const delta = ev.clientX - startX;
      let w = mode === 'left' ? startW + delta : startW - delta;
      w = Math.max(mode === 'left' ? 180 : 240, Math.min(mode === 'left' ? 420 : 640, w));
      target.style.width = w + 'px';
    }
    function up() {
      dragging = false;
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}
initResizer('sidebarResizer', 'sidebar', 'left');
initResizer('detailResizer', 'detail', 'right');


const projectSelect = document.getElementById('projectSelect');
async function initProjects() {
  try {
    const res = await fetch('/api/projects');
    const data = await res.json();
    projectSelect.innerHTML = '';
    for (const name of data.projects || []) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      projectSelect.appendChild(opt);
    }
    currentProject = data.current || projectSelect.value;
    projectSelect.value = currentProject;
    loadPendingProposals();
    
  } catch (e) {}
}


projectSelect.onchange = () => {
  currentProject = projectSelect.value;
  chatJustSwitched = true;
  resetFileEditor();
  // loadData 内部已进入轴视图并 fitAxisView，无需再调用自由视图的 fitView（操作隐藏的 #world，无意义）
  loadData().catch(e => showToast('切换项目失败：' + e.message, 'error'));
  loadSkills();
  loadPendingProposals();
};
document.getElementById('autoLayoutBtn').addEventListener('click', autoLayout);
document.getElementById('fitBtn').addEventListener('click', fitView);

// 大一统框架：视图切换 / 识别报告
const viewModeBtn = document.getElementById('viewModeBtn');
if (viewModeBtn) viewModeBtn.addEventListener('click', toggleViewMode);
const recognitionBtn = document.getElementById('recognitionBtn');
if (recognitionBtn) recognitionBtn.addEventListener('click', openRecognitionReport);
const recognitionClose = document.getElementById('recognitionClose');
if (recognitionClose) recognitionClose.addEventListener('click', () => {
  document.getElementById('recognitionModal').style.display = 'none';
});

document.getElementById('mapToggleBtn').addEventListener('click', () => {
  const mm = document.getElementById('minimap');
  mm.classList.toggle('show');
  document.getElementById('mapToggleBtn').classList.toggle('on', mm.classList.contains('show'));
  if (mm.classList.contains('show')) drawMinimap();
});
document.getElementById('legendToggleBtn').addEventListener('click', toggleLegend);
// 专注模式：一键隐藏侧栏/顶栏/聊天（Ctrl+Shift+F 切换，右上角浮动按钮退出）
const focusBtn = document.getElementById('focusBtn');
const focusExitBtn = document.getElementById('focusExitBtn');
function toggleFocusMode(force) {
  const on = force !== undefined ? !!force : !document.body.classList.contains('focus-mode');
  document.body.classList.toggle('focus-mode', on);
  if (focusBtn) focusBtn.classList.toggle('on', on);
}
if (focusBtn) focusBtn.addEventListener('click', () => toggleFocusMode());
if (focusExitBtn) focusExitBtn.addEventListener('click', () => toggleFocusMode(false));
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
    e.preventDefault();
    toggleFocusMode();
  }
});
const linkModeSelect = document.getElementById('linkModeSelect');
if (linkModeSelect) {
  linkModeSelect.value = autoLinkMode;
  linkModeSelect.addEventListener('change', () => {
    autoLinkMode = linkModeSelect.value;
    autoLinkEnabled = autoLinkMode !== 'off';
    links = buildLinks();
    redrawEdges();
  });
}
const matrixBtn = document.getElementById('matrixBtn');
if (matrixBtn) matrixBtn.addEventListener('click', openMatrix);
const matrixClose = document.getElementById('matrixClose');
if (matrixClose) matrixClose.addEventListener('click', closeMatrix);
const matrixModalEl = document.getElementById('matrixModal');
if (matrixModalEl) matrixModalEl.addEventListener('click', (e) => { if (e.target === matrixModalEl) closeMatrix(); });
document.querySelectorAll('.matrixTab').forEach(tab => {
  tab.addEventListener('click', () => {
    matrixMode = tab.dataset.matrix;
    document.querySelectorAll('.matrixTab').forEach(t => t.classList.toggle('on', t === tab));
    renderMatrix();
  });
});
wireMatrixClicks();
const boardBtn = document.getElementById('boardBtn');
if (boardBtn) boardBtn.addEventListener('click', openBoard);
const boardClose = document.getElementById('boardClose');
if (boardClose) boardClose.addEventListener('click', closeBoard);
const boardModalEl = document.getElementById('boardModal');
if (boardModalEl) boardModalEl.addEventListener('click', (e) => { if (e.target === boardModalEl) closeBoard(); });
const diffClose = document.getElementById('diffClose');
if (diffClose) diffClose.addEventListener('click', closeDiffModal);
const diffCancel = document.getElementById('diffCancel');
if (diffCancel) diffCancel.addEventListener('click', closeDiffModal);
const diffApply = document.getElementById('diffApply');
if (diffApply) diffApply.addEventListener('click', applyDiff);
const diffModalEl = document.getElementById('diffModal');
if (diffModalEl) diffModalEl.addEventListener('click', (e) => { if (e.target === diffModalEl) closeDiffModal(); });
try { showAllCustomLinks = localStorage.getItem('canvasShowAllLinks') === '1'; } catch (e) {}
const linkManagerBtn = document.getElementById('linkManagerBtn');
if (linkManagerBtn) linkManagerBtn.addEventListener('click', openLinkManager);
const linkClose = document.getElementById('linkClose');
if (linkClose) linkClose.addEventListener('click', closeLinkManager);
const linkModalEl = document.getElementById('linkModal');
if (linkModalEl) linkModalEl.addEventListener('click', (e) => { if (e.target === linkModalEl) closeLinkManager(); });
const showAllLinks = document.getElementById('showAllLinks');
if (showAllLinks) showAllLinks.addEventListener('change', () => {
  showAllCustomLinks = showAllLinks.checked;
  try { localStorage.setItem('canvasShowAllLinks', showAllCustomLinks ? '1' : '0'); } catch (e) {}
  redrawEdges();
  renderLinkManager();
});
const clearLinksBtn = document.getElementById('clearLinksBtn');
if (clearLinksBtn) clearLinksBtn.addEventListener('click', async () => {
  if (!customLinks.length) return;
  if (!(await confirmDialog('确定删除全部手动连线？'))) return;
  customLinks = [];
  saveLayout();
  redrawEdges();
  renderLinkManager();
});
const linkAddBtn = document.getElementById('linkAddBtn');
if (linkAddBtn) linkAddBtn.addEventListener('click', () => {
  const a = document.getElementById('linkFromSel');
  const b = document.getElementById('linkToSel');
  if (!a || !b || !a.value || !b.value) { showToast('请先选择起点与终点', 'info'); return; }
  if (a.value === b.value) { showToast('不能连接同一节点', 'info'); return; }
  addCustomLink(a.value, b.value);
  renderLinkManager();
});
const auditClose = document.getElementById('auditClose');
if (auditClose) auditClose.addEventListener('click', closeAudit);
const auditModalEl = document.getElementById('auditModal');
if (auditModalEl) auditModalEl.addEventListener('click', (e) => { if (e.target === auditModalEl) closeAudit(); });
const auditFixBtn = document.getElementById('auditFixBtn');
if (auditFixBtn) auditFixBtn.addEventListener('click', fixAudit);
const auditPolishBtn = document.getElementById('auditPolishBtn');
if (auditPolishBtn) auditPolishBtn.addEventListener('click', runAuditPolish);
document.querySelectorAll('#auditModal .auditTab').forEach(btn => {
  btn.addEventListener('click', () => {
    switchAuditTab(btn.dataset.tab);
    if (btn.dataset.tab === 'stats') runStats();
  });
});
const statsClearBtn = document.getElementById('statsClearBtn');
if (statsClearBtn) statsClearBtn.addEventListener('click', async () => {
  if (!(await confirmDialog('确定清空当前项目的漂移统计历史？'))) return;
  try {
    await fetch('/api/stats/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: currentProject })
    });
    runStats();
  } catch (_) { runStats(); }
});
const volumeClose = document.getElementById('volumeClose');
if (volumeClose) volumeClose.addEventListener('click', closeVolumes);
const volumeModalEl = document.getElementById('volumeModal');
if (volumeModalEl) volumeModalEl.addEventListener('click', (e) => { if (e.target === volumeModalEl) closeVolumes(); });
const volumeCreateBtn = document.getElementById('volumeCreateBtn');
const volumeNameInput = document.getElementById('volumeNameInput');
if (volumeCreateBtn) volumeCreateBtn.addEventListener('click', async () => {
  const name = (volumeNameInput.value || '').trim();
  if (!name) return;
  const btn = volumeCreateBtn;
  btn.disabled = true;
  btn.textContent = '创建中...';
  try {
    const res = await fetch('/api/volumes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: currentProject, name })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    volumeNameInput.value = '';
    await runVolumes();
  } catch (e) {
    showToast('创建失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '创建卷';
  }
});
search.addEventListener('input', applyFilters);
search.addEventListener('keydown', searchNav);
window.addEventListener('resize', () => { if (document.getElementById('minimap').classList.contains('show')) drawMinimap(); });

// ── 主题设置 ──────────────────────────────────────────────
const THEME_KEY = 'novelTheme';
function defaultTheme() { return { mode: 'dark', accent: '#ffb454' }; }
function loadTheme() {
  try { return Object.assign(defaultTheme(), JSON.parse(localStorage.getItem(THEME_KEY)) || {}); }
  catch (_) { return defaultTheme(); }
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t.mode;
  document.documentElement.style.setProperty('--accent', t.accent);
}
function initTheme() {
  const t = loadTheme();
  applyTheme(t);
  document.getElementById('themeMode').value = t.mode;
  const ACCENTS = ['#ffb454', '#7aa2f7', '#a78bfa', '#34d399', '#f87171', '#f59e0b'];
  const wrap = document.getElementById('accentSwatches');
  wrap.innerHTML = '';
  for (const c of ACCENTS) {
    const b = document.createElement('button');
    b.className = 'accentSwatch' + (c === t.accent ? ' on' : '');
    b.style.background = c;
    b.dataset.color = c;
    b.title = c;
    b.addEventListener('click', () => {
      wrap.querySelectorAll('.accentSwatch').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
    });
    wrap.appendChild(b);
  }
}
document.getElementById('themeCancel').addEventListener('click', () => document.getElementById('themeModal').classList.remove('show'));
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', () => document.getElementById('themeModal').classList.remove('show'));
const themeModalEl = document.getElementById('themeModal');
if (themeModalEl) themeModalEl.addEventListener('click', (e) => { if (e.target === themeModalEl) themeModalEl.classList.remove('show'); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && themeModalEl && themeModalEl.classList.contains('show')) {
    themeModalEl.classList.remove('show');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
});
/* ---------- 全局反馈：toast + 应用内确认（全项目统一，替代 alert/confirm） ---------- */
function showToast(text, type = 'info') {
  const wrap = document.getElementById('toastWrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = text;
  wrap.appendChild(el);
  const rm = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  const t = setTimeout(rm, 2600);
  el.addEventListener('click', () => { clearTimeout(t); rm(); });
}
let __confirmResolve = null;
function confirmDialog(message, opts = {}) {
  return new Promise(resolve => {
    const txt = document.getElementById('confirmText');
    const ok = document.getElementById('confirmOkBtn');
    const cancel = document.getElementById('confirmCancelBtn');
    if (!txt || !ok || !cancel) { resolve(false); return; }
    txt.textContent = message;
    ok.textContent = opts.okText || '确定';
    cancel.textContent = opts.cancelText || '取消';
    __confirmResolve = resolve;
    document.getElementById('confirmModal').classList.add('show');
    ok.focus();
  });
}
function __resolveConfirm(val) {
  document.getElementById('confirmModal').classList.remove('show');
  const r = __confirmResolve; __confirmResolve = null;
  if (r) r(val);
}
document.getElementById('confirmOkBtn').addEventListener('click', () => __resolveConfirm(true));
document.getElementById('confirmCancelBtn').addEventListener('click', () => __resolveConfirm(false));
document.getElementById('confirmClose').addEventListener('click', () => __resolveConfirm(false));
document.getElementById('confirmModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) __resolveConfirm(false); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('confirmModal').classList.contains('show')) __resolveConfirm(false);
});

// ── v1.9 Y 轴划分方式弹窗（axisYModal：按境界/按关键节点/按进度）──
(function () {
  const modal = document.getElementById('axisYModal');
  if (!modal) return;
  const okBtn = document.getElementById('axisYOkBtn');
  const cancelBtn = document.getElementById('axisYCancelBtn');
  const closeBtn = document.getElementById('axisYClose');
  const ta = document.getElementById('axisYBandsInput');
  function currentRadio() {
    const el = modal.querySelector('input[name="axisYRadio"]:checked');
    return el ? el.value : 'nodes';
  }
  function readBands() {
    if (!ta) return [];
    return ta.value.split(/\n+/).map(s => s.trim()).filter(Boolean);
  }
  if (okBtn) okBtn.addEventListener('click', () => {
    const mode = currentRadio();
    if (mode === 'progress') {
      // 按剧情进度：不分段，保持 0-100% 连续轴
      axisBandMode = 'progress';
      axisBands = [];
    } else {
      const bands = readBands();
      if (!bands.length) { showToast('请填写至少一个分区名称', 'error'); return; }
      axisBandMode = mode === 'realm' ? 'realm' : 'plot';
      axisBands = bands;
    }
    closeAxisBandAsk();
    saveLayout();
    renderAxisView();
    fitAxisView();
  });
  if (cancelBtn) cancelBtn.addEventListener('click', closeAxisBandAsk);
  if (closeBtn) closeBtn.addEventListener('click', closeAxisBandAsk);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeAxisBandAsk(); });
})();
document.getElementById('themeOk').addEventListener('click', async () => {
  const aiTabActive = document.getElementById('settingsPaneAi').style.display !== 'none';
  if (aiTabActive) {
    if (await saveAiSettings()) document.getElementById('themeModal').classList.remove('show');
    return;
  }
  const mode = document.getElementById('themeMode').value;
  const swatch = document.querySelector('#accentSwatches .accentSwatch.on');
  const accent = swatch ? swatch.dataset.color : '#ffb454';
  const t = { mode, accent };
  localStorage.setItem(THEME_KEY, JSON.stringify(t));
  applyTheme(t);
  document.getElementById('themeModal').classList.remove('show');
});
initTheme();

// ── 设置弹窗（外观 / AI 模型）：模型地址 / 密钥 / 模型 ──
function aiSettingsStatus(msg) { const el = document.getElementById('aiSettingsStatus'); if (el) el.textContent = msg; }
async function loadAiSettings() {
  aiSettingsStatus('加载中...');
  document.getElementById('aiModelListWrap').style.display = 'none';
  try {
    const res = await fetch('/api/settings');
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    document.getElementById('aiBase').value = d.ai.base || '';
    document.getElementById('aiModel').value = d.ai.model || '';
    document.getElementById('aiKey').value = '';
    aiSettingsStatus(d.ai.hasKey
      ? '当前已配置密钥（来源：' + (d.ai.source === 'saved' ? '设置' : d.ai.source === 'env' ? '环境变量' : 'inkpilot') + '，尾号 ' + d.ai.keyHint + '）。密钥留空保存则保持不变。'
      : '当前未配置密钥。');
    // 用量统计：今日/累计 tokens（可选费用估算）
    try {
      const uRes = await fetch('/api/usage');
      const u = await uRes.json();
      const uEl = document.getElementById('aiUsageInfo');
      if (uEl) {
        if (u.ok) {
          const costText = (u.cost && u.cost.total != null && u.cost.total > 0) ? ' · 费用约 $' + u.cost.total : '';
          uEl.textContent = '今日 ' + (u.today.total || 0).toLocaleString('zh-CN') + ' tokens（' + (u.today.calls || 0) + ' 次）· 累计 ' + (u.total.total || 0).toLocaleString('zh-CN') + ' tokens' + costText;
        } else {
          uEl.textContent = '';
        }
      }
    } catch (_) {}
  } catch (e) {
    aiSettingsStatus('加载失败：' + e.message);
  }
}
function switchSettingsTab(tab) {
  document.getElementById('settingsTabTheme').classList.toggle('on', tab === 'theme');
  document.getElementById('settingsTabAi').classList.toggle('on', tab === 'ai');
  document.getElementById('settingsTabHistory').classList.toggle('on', tab === 'history');
  document.getElementById('settingsPaneTheme').style.display = tab === 'theme' ? '' : 'none';
  document.getElementById('settingsPaneAi').style.display = tab === 'ai' ? '' : 'none';
  document.getElementById('settingsPaneHistory').style.display = tab === 'history' ? '' : 'none';
  document.getElementById('themeOk').textContent = tab === 'theme' ? '应用' : '保存';
  if (tab === 'ai') loadAiSettings();
  if (tab === 'history') loadBackupList();
}
function renderAiModels(models) {
  const wrap = document.getElementById('aiModelListWrap');
  const list = document.getElementById('aiModelList');
  if (!Array.isArray(models) || models.length === 0) { wrap.style.display = 'none'; return; }
  list.innerHTML = '';
  for (const m of models.slice(0, 200)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.style.cssText = 'padding:4px 10px;border:1px solid var(--panel-border);border-radius:14px;background:transparent;color:var(--text);font-size:12px;cursor:pointer';
    chip.textContent = m;
    chip.addEventListener('click', () => { document.getElementById('aiModel').value = m; });
    list.appendChild(chip);
  }
  wrap.style.display = 'block';
}
async function testAiConnection() {
  const base = document.getElementById('aiBase').value.trim();
  const key = document.getElementById('aiKey').value.trim();
  if (!base) { aiSettingsStatus('请先填写 API 地址。'); return; }
  aiSettingsStatus('测试连接中...');
  try {
    const res = await fetch('/api/settings/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base, key })
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    aiSettingsStatus('连接成功，发现 ' + d.count + ' 个模型，点击下面模型名自动填入：');
    renderAiModels(d.models);
  } catch (e) {
    aiSettingsStatus('测试失败：' + e.message);
  }
}
async function saveAiSettings() {
  const base = document.getElementById('aiBase').value.trim();
  const key = document.getElementById('aiKey').value.trim();
  const model = document.getElementById('aiModel').value.trim();
  if (!base) { aiSettingsStatus('API 地址不能为空。'); return false; }
  aiSettingsStatus('保存中...');
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base, key, model })
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    aiSettingsStatus('已保存 ✓（' + d.ai.base + ' · ' + d.ai.model + (d.ai.hasKey ? ' · 密钥尾号 ' + d.ai.keyHint : ' · 未配置密钥') + '）');
    syncChatModelOption(d.ai.model);
    return true;
  } catch (e) {
    aiSettingsStatus('保存失败：' + e.message);
    return false;
  }
}
// 让聊天框的模型下拉与设置里的模型同步
function syncChatModelOption(model) {
  const sel = document.getElementById('chatModel');
  if (!sel || !model) return;
  if (![...sel.options].some(o => o.value === model)) {
    const opt = document.createElement('option');
    opt.value = model;
    opt.textContent = model;
    sel.insertBefore(opt, sel.firstChild);
  }
  sel.value = model;
}

// ── 历史 / 回滚（设置弹窗第三个 tab） ──
async function loadBackupList() {
  const wrap = document.getElementById('backupList');
  if (!wrap) return;
  wrap.innerHTML = '<div class="hint">加载中...</div>';
  try {
    const res = await fetch('/api/backups?project=' + encodeURIComponent(currentProject));
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const list = data.list || [];
    if (!list.length) {
      wrap.innerHTML = '<div class="hint">暂无备份记录。AI 修改 / 手动保存 / 删除文件前会自动生成快照。</div>';
      return;
    }
    wrap.innerHTML = '';
    for (const b of list) {
      const row = document.createElement('div');
      row.className = 'backupRow';
      const files = (b.files || []).map(f => f.rel).join('、') || '（空）';
      row.innerHTML =
        '<div class="meta">' + escapeHtml(b.time) + ' · ' + escapeHtml(b.reason || '修改') + ' · ' + b.n + ' 个文件</div>' +
        '<div class="hint" style="word-break:break-all">' + escapeHtml(files) + '</div>' +
        '<button class="restoreBtn">恢复</button>';
      row.querySelector('.restoreBtn').addEventListener('click', async () => {
        if (!(await confirmDialog('恢复该快照后，相关文件的当前内容将被覆盖（恢复前会自动再存一条保护快照）。确定？'))) return;
        try {
          const r = await fetch('/api/backups/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ts: b.ts, project: currentProject })
          });
          const d = await r.json();
          if (d.error) throw new Error(d.error);
          showToast('已恢复 ' + (d.restored || []).length + ' 个文件。', 'success');
          await loadData();
          loadBackupList();
        } catch (e) {
          showToast('恢复失败：' + e.message, 'error');
        }
      });
      wrap.appendChild(row);
    }
  } catch (e) {
    wrap.innerHTML = '<div class="hint">加载失败：' + escapeHtml(e.message) + '</div>';
  }
}

// ── 全书统计 ──
async function openBookStats() {
  const m = document.getElementById('bookStatsModal');
  if (m) m.classList.add('show');
  const body = document.getElementById('bookStatsBody');
  if (!body) return;
  body.innerHTML = '<div class="hint">加载中...</div>';
  try {
    const res = await fetch('/api/bookstats?project=' + encodeURIComponent(currentProject));
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    body.innerHTML = renderBookStats(d);
  } catch (e) {
    body.innerHTML = '<div class="hint">加载失败：' + escapeHtml(e.message) + '</div>';
  }
}
function closeBookStats() {
  const m = document.getElementById('bookStatsModal');
  if (m) m.classList.remove('show');
}
function fmtNum(n) { return Number(n || 0).toLocaleString('zh-CN'); }
function renderBookStats(d) {
  const vols = d.byVolume || [];
  const maxVolWords = Math.max(1, ...vols.map(v => v.words || 0));
  const volBars = vols.map(v =>
    '<div class="volRow"><span class="volName" title="' + escapeHtml(v.volume) + '">' + escapeHtml(v.volume) + '</span>' +
    '<span class="volBar"><span class="volBarFill" style="width:' + Math.round((v.words / maxVolWords) * 100) + '%"></span></span>' +
    '<span class="volMeta">' + v.chapters + '章 · ' + fmtNum(v.words) + '字</span></div>'
  ).join('');
  const cats = Object.entries(d.categories || {}).map(([k, v]) =>
    '<span class="catChip">' + escapeHtml(k) + ' ' + v + '</span>').join('');
  return '' +
    '<div class="statCards">' +
      '<div class="statCard"><div class="num">' + fmtNum(d.totalWords) + '</div><div class="lbl">总字数</div></div>' +
      '<div class="statCard"><div class="num">' + fmtNum(d.chapterCount) + '</div><div class="lbl">章节数</div></div>' +
      '<div class="statCard"><div class="num">' + fmtNum(d.avgWordsPerChapter) + '</div><div class="lbl">平均每章</div></div>' +
    '</div>' +
    '<div class="statsSection"><h4>各卷字数分布</h4>' + (volBars || '<div class="hint">暂无章节</div>') + '</div>' +
    '<div class="statsSection"><h4>大纲完成度</h4>' +
      '<div class="barRow"><span class="barLabel">' + d.outline.filled + '/' + d.outline.total + ' 项已填写</span>' +
      '<span class="barTrack"><span class="barFill accent" style="width:' + d.outline.rate + '%"></span></span>' +
      '<span class="barPct">' + d.outline.rate + '%</span></div></div>' +
    '<div class="statsSection"><h4>伏笔回收率</h4>' +
      '<div class="barRow"><span class="barLabel">已回收 ' + d.foreshadow.recovered + ' / 共 ' + d.foreshadow.total + ' 条</span>' +
      '<span class="barTrack"><span class="barFill green" style="width:' + d.foreshadow.rate + '%"></span></span>' +
      '<span class="barPct">' + d.foreshadow.rate + '%</span></div></div>' +
    '<div class="statsSection"><h4>分类统计</h4><div class="catChips">' + cats + '</div></div>';
}

// ── 时间线（作者手动维护的重要节点，按章节排序；不再自动抽取时间标记） ──
function timelineChapterOptions() {
  // 从章节节点取章号 + 标题；无章号的章节跳过（无法定位）
  const opts = nodes
    .filter(n => isChapterNode(n))
    .map(n => ({ ch: nodeAxisData(n).chapter, title: n.title }))
    .filter(o => o.ch != null)
    .sort((a, b) => Number(a.ch) - Number(b.ch));
  const seen = new Set();
  return opts.filter(o => { const k = String(o.ch); if (seen.has(k)) return false; seen.add(k); return true; });
}
function sortedTimelineNodes() {
  return [...timelineNodes].sort((a, b) => (Number(a.chapter) || 0) - (Number(b.chapter) || 0) || String(a.id).localeCompare(String(b.id)));
}
function renderTimelineList() {
  const body = document.getElementById('timelineBody');
  if (!body) return;
  // 刷新章节下拉（新增/识别章节后保持同步）
  const sel = document.getElementById('tlChapterSel');
  if (sel) {
    const opts = timelineChapterOptions();
    sel.innerHTML = opts.map(o => '<option value="' + o.ch + '">第' + o.ch + '章 ' + escapeHtml(o.title) + '</option>').join('');
  }
  const list = sortedTimelineNodes();
  if (!list.length) {
    body.innerHTML = '<div class="hint">还没有重要节点。在上方填写节点名、选择所属章节，点「添加」创建（如：主角觉醒 · 第5章）。添加后节点会以 ⚑ 标注在进度轴上，可直接拖动定位。</div>';
    return;
  }
  body.innerHTML = '<div class="tlList"></div>';
  const wrap = body.querySelector('.tlList');
  for (const ev of list) {
    const row = document.createElement('div');
    row.className = 'tlRow';
    row.dataset.id = ev.id;
    const progBadge = ev.progress != null ? '<span class="tlBadge tlProg">' + Math.round(Number(ev.progress)) + '%</span>' : '';
    row.innerHTML =
      '<span class="tlBadge">第' + escapeHtml(ev.chapter) + '章</span>' +
      progBadge +
      '<span class="tlTitle">' + escapeHtml(ev.title || '（未命名节点）') + '</span>' +
      '<span class="tlNote">' + escapeHtml(ev.note || '') + '</span>' +
      '<span class="tlActions">' +
        '<button class="tlEdit" title="编辑">编辑</button>' +
        '<button class="tlDel" title="删除">删除</button>' +
      '</span>';
    row.addEventListener('click', (e) => {
      if (e.target.closest('.tlEdit') || e.target.closest('.tlDel')) return;
      axisJumpTo(Number(ev.chapter) || 1);
      const node = nodes.find(n => isChapterNode(n) && Number(nodeAxisData(n).chapter) === Number(ev.chapter));
      if (node) showDetail(node);
      closeTimeline();
    });
    row.querySelector('.tlEdit').addEventListener('click', (e) => {
      e.stopPropagation();
      startEditTimelineNode(row, ev);
    });
    row.querySelector('.tlDel').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!(await confirmDialog('删除时间线节点「' + (ev.title || '') + '」？'))) return;
      timelineNodes = timelineNodes.filter(x => x.id !== ev.id);
      saveLayout();
      renderTimelineList();
      renderAxisTimelinePins(); // 删除后轴上的 pin 同步移除
    });
    wrap.appendChild(row);
  }
}
function startEditTimelineNode(row, ev) {
  row.innerHTML =
    '<input class="tlInput tlEditTitle" value="' + escapeHtml(ev.title || '') + '" maxlength="60">' +
    '<input class="tlInput tlEditNote" value="' + escapeHtml(ev.note || '') + '" placeholder="备注（可选）" maxlength="120">' +
    '<input class="tlInput tlEditProg" type="number" min="0" max="100" value="' + (ev.progress != null ? Math.round(Number(ev.progress)) : '') + '" placeholder="推进% (留空自动)" title="剧情推进 0-100%，留空则按章号默认">' +
    '<span class="tlActions">' +
      '<button class="tlSave">保存</button>' +
      '<button class="tlCancel">取消</button>' +
    '</span>';
  const titleIn = row.querySelector('.tlEditTitle');
  titleIn.focus();
  const save = () => {
    const t = titleIn.value.trim();
    if (!t) { showToast('节点名不能为空', 'warn'); return; }
    ev.title = t;
    ev.note = row.querySelector('.tlEditNote').value.trim();
    const p = row.querySelector('.tlEditProg').value;
    ev.progress = (p !== '' && !isNaN(Number(p))) ? Math.max(0, Math.min(100, Number(p))) : null;
    saveLayout();
    renderTimelineList();
    renderAxisTimelinePins(); // 编辑后轴上的 pin 同步更新
  };
  row.querySelector('.tlSave').addEventListener('click', (e) => { e.stopPropagation(); save(); });
  row.querySelector('.tlCancel').addEventListener('click', (e) => { e.stopPropagation(); renderTimelineList(); });
  titleIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') renderTimelineList(); });
}
function addTimelineNode() {
  const titleIn = document.getElementById('tlTitle');
  const sel = document.getElementById('tlChapterSel');
  const noteIn = document.getElementById('tlNote');
  const progIn = document.getElementById('tlProgress');
  const title = titleIn ? titleIn.value.trim() : '';
  const chapter = sel && sel.value ? Number(sel.value) : null;
  if (!title) { showToast('请填写重要节点名', 'warn'); return; }
  if (!chapter) { showToast('请选择所属章节', 'warn'); return; }
  const p = progIn && progIn.value !== '' ? Number(progIn.value) : null;
  timelineNodes.push({
    id: 'tl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    title,
    chapter,
    progress: (p != null && !isNaN(p)) ? Math.max(0, Math.min(100, p)) : null,
    note: noteIn ? noteIn.value.trim() : ''
  });
  if (titleIn) titleIn.value = '';
  if (noteIn) noteIn.value = '';
  if (progIn) progIn.value = '';
  saveLayout();
  renderTimelineList();
  renderAxisTimelinePins(); // 新节点立即标到进度轴上
}
function openTimeline() {
  const m = document.getElementById('timelineModal');
  if (m) m.classList.add('show');
  renderTimelineList();
}
function closeTimeline() {
  const m = document.getElementById('timelineModal');
  if (m) m.classList.remove('show');
}

// ── 聊天用量提示 ──
function addUsageNote(usage) {
  if (!usage) return;
  const total = Number(usage.total) || Number(usage.total_tokens) || 0;
  if (!total) return;
  const note = document.createElement('div');
  note.className = 'msg-usage';
  note.textContent = '本次 ~' + total.toLocaleString('zh-CN') + ' tokens';
  chatMessages.appendChild(note);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
document.getElementById('bookStatsBtn').addEventListener('click', openBookStats);
document.getElementById('bookStatsClose').addEventListener('click', closeBookStats);
document.getElementById('bookStatsModal').addEventListener('click', (e) => { if (e.target === document.getElementById('bookStatsModal')) closeBookStats(); });
document.getElementById('timelineBtn').addEventListener('click', openTimeline);
document.getElementById('timelineClose').addEventListener('click', closeTimeline);
document.getElementById('timelineModal').addEventListener('click', (e) => { if (e.target === document.getElementById('timelineModal')) closeTimeline(); });
document.getElementById('tlAddBtn').addEventListener('click', addTimelineNode);
document.getElementById('tlTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') addTimelineNode(); });
document.getElementById('settingsTabTheme').addEventListener('click', () => switchSettingsTab('theme'));
document.getElementById('settingsTabAi').addEventListener('click', () => switchSettingsTab('ai'));
document.getElementById('settingsTabHistory').addEventListener('click', () => switchSettingsTab('history'));
document.getElementById('aiTestBtn').addEventListener('click', testAiConnection);
// 启动时把设置里的模型同步进聊天模型下拉
fetch('/api/settings').then(r => r.json()).then(d => {
  if (d && d.ai && d.ai.model) syncChatModelOption(d.ai.model);
}).catch(() => {});

// ── 更换文件夹 ────────────────────────────────────────────
document.getElementById('changeFolderBtn').addEventListener('click', async () => {
  if (!window.novelAPI) {
    showToast('请在桌面版中使用「更换文件夹」功能；浏览器模式可通过 NOVEL_PROJECTS_ROOT 环境变量配置目录。', 'info');
    return;
  }
  try {
    const res = await window.novelAPI.changeFolder();
    if (res && res.ok) {
      showToast('已切换工作目录：' + res.projectsRoot, 'success');
      location.reload();
    } else if (res && res.error) {
      showToast('切换失败：' + res.error, 'error');
    }
  } catch (e) {
    showToast('切换失败：' + e.message, 'error');
  }
});

initProjects().then(() => { loadData().then(() => fitView()); loadSkills(); }).catch(e => {
});
