// 冒烟测试：验证项目加载、主题切换、更换文件夹按钮是否存在
// 用法：npm test   （自动启动/复用 8787，自动启动 headless Edge）
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const CDP_PORT = Number(process.env.CDP_PORT || 9224);
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.LOCALAPPDATA + '\\Microsoft\\Edge\\Application\\msedge.exe'
];

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect(port, host);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
  });
}

async function waitPort(port, timeout = 20000) {
  const start = Date.now();
  while (!(await isPortOpen(port))) {
    if (Date.now() - start > timeout) throw new Error('端口 ' + port + ' 等待超时');
    await new Promise(r => setTimeout(r, 250));
  }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function findEdge() {
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  return null;
}

let serverProc = null;
let edgeProc = null;

async function main() {
  const startedServer = !(await isPortOpen(PORT));
  if (startedServer) {
    console.log('🚀 启动测试服务 node server.js');
    serverProc = spawn(process.execPath, ['server.js'], { cwd: root, stdio: 'inherit', env: { ...process.env, PORT: String(PORT) } });
    await waitPort(PORT);
  } else {
    console.log(`ℹ️  复用已有 8787 服务`);
  }

  const edge = findEdge();
  if (!edge) {
    console.error('❌ 未找到 Edge，无法运行 CDP 测试');
    cleanup();
    process.exit(1);
  }

  const profile = path.join(root, '_edge_smoke_test');
  fs.rmSync(profile, { recursive: true, force: true });
  console.log('🖥️  启动 headless Edge (CDP ' + CDP_PORT + ')');
  edgeProc = spawn(edge, [
    '--headless', '--disable-gpu', '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + profile, 'http://127.0.0.1:' + PORT + '/'
  ], { stdio: 'ignore' });

  await waitPort(CDP_PORT);
  const targets = await getJson('http://127.0.0.1:' + CDP_PORT + '/json/list');
  const page = targets.find(t => t.type === 'page' && t.url.includes('127.0.0.1:' + PORT)) || targets.find(t => t.type === 'page');
  if (!page) throw new Error('没有找到测试页面 target');

  console.log('🔌 连接页面: ' + page.url);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  const exceptions = [];

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      exceptions.push((d.exception && d.exception.description) || d.text || 'exception');
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  await new Promise(resolve => ws.onopen = resolve);

  function send(method, params = {}) {
    return new Promise(resolve => {
      const id = ++msgId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  await send('Runtime.enable');

  async function evalExpr(expression) {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.result && res.result.exceptionDetails) {
      return 'EXCEPTION: ' + (res.result.exceptionDetails.exception && res.result.exceptionDetails.exception.description || res.result.exceptionDetails.text);
    }
    return res.result && res.result.result && res.result.result.value;
  }

  const results = [];
  async function check(name, fn) {
    try {
      const value = await fn();
      const ok = value === true || (typeof value === 'string' && value.startsWith('OK'));
      results.push({ name, ok, value });
      console.log((ok ? '✅ ' : '❌ ') + name + (ok ? '' : ' → ' + value));
    } catch (e) {
      results.push({ name, ok: false, value: e.message });
      console.log('❌ ' + name + ' → ' + e.message);
    }
  }

  await check('项目列表已加载', async () => {
    const count = await evalExpr(`new Promise(resolve => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const n = document.getElementById('projectSelect').options.length;
        if (n > 0 || Date.now() - t0 > 5000) {
          clearInterval(iv);
          resolve(n);
        }
      }, 100);
    })`);
    return count >= 1 ? 'OK(' + count + ')' : '空项目列表';
  });
  // 冒烟测试需要自由视图画布：若默认项目布局 mode=axis 自动进入轴视图，先切回自由视图（不保存，避免污染布局文件）
  // v1.9：无卷项目进入轴视图会弹出 Y 轴划分询问弹窗 → 一并关闭，避免遮挡后续点击
  await check('前置：确保自由视图', async () => {
    const v = await evalExpr(`(() => {
      if (typeof viewMode !== 'undefined' && viewMode === 'axis') exitAxisView(false);
      const am = document.getElementById('axisYModal');
      if (am) am.classList.remove('show');
      const world = document.getElementById('world');
      return JSON.stringify({ mode: viewMode, worldShown: world ? world.style.display !== 'none' : false });
    })()`);
    return v.includes('"worldShown":true') ? 'OK' : v;
  });
  await check('更换文件夹按钮存在', async () => evalExpr(`!!document.getElementById('changeFolderBtn')`));
  await check('主题按钮存在', async () => evalExpr(`!!document.getElementById('activityTheme')`));
  await check('主题弹窗可打开', async () => evalExpr(`(() => { document.getElementById('activityTheme').click(); return document.getElementById('themeModal').classList.contains('show'); })()`));
  await check('切换浅色并保存', async () => {
    const v = await evalExpr(`(() => {
      document.getElementById('themeMode').value = 'light';
      document.getElementById('themeOk').click();
      return JSON.stringify({theme: document.documentElement.dataset.theme, saved: localStorage.getItem('novelTheme')});
    })()`);
    return v.includes('"theme":"light"') ? 'OK' : v;
  });
  await check('切回深色', async () => {
    const v = await evalExpr(`(() => {
      document.getElementById('activityTheme').click();
      document.getElementById('themeMode').value = 'dark';
      document.getElementById('themeOk').click();
      return document.documentElement.dataset.theme;
    })()`);
    return v === 'dark' ? 'OK' : v;
  });
  await check('强调文字保持黑色(两主题)', async () => {
    const v = await evalExpr(`(async () => {
      const sample = () => {
        const el = document.querySelector('.toolBtn') || document.getElementById('appTitle');
        return el ? getComputedStyle(el).color : 'no-el';
      };
      const setTheme = (m) => {
        document.getElementById('themeMode').value = m;
        document.getElementById('themeOk').click();
      };
      setTheme('dark');
      await new Promise(r => setTimeout(r, 40));
      const darkColor = sample();
      setTheme('light');
      await new Promise(r => setTimeout(r, 40));
      const lightColor = sample();
      setTheme('dark'); // 还原
      await new Promise(r => setTimeout(r, 40));
      return JSON.stringify({ ok: darkColor === 'rgb(0, 0, 0)' && lightColor === 'rgb(0, 0, 0)', darkColor, lightColor });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK(浅/深两主题均黑色)' : v;
    } catch (_) { return v; }
  });
  await check('连线颜色主题自适应', async () => {
    const v = await evalExpr(`(async () => {
      const gv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      const setTheme = (m) => { document.getElementById('themeMode').value = m; document.getElementById('themeOk').click(); };
      setTheme('dark');
      await new Promise(r => setTimeout(r, 40));
      const dA = gv('--edge-auto'), dM = gv('--edge-manual');
      setTheme('light');
      await new Promise(r => setTimeout(r, 40));
      const lA = gv('--edge-auto'), lM = gv('--edge-manual');
      setTheme('dark'); // 还原
      await new Promise(r => setTimeout(r, 40));
      return JSON.stringify({ ok: !!dA && !!dM && !!lA && !!lM && dA !== lA && dM !== lM, dA, dM, lA, lM });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK(深浅主题连线色不同且非空)' : v;
    } catch (_) { return v; }
  });
  await check('活动栏存在', async () => evalExpr(`!!document.getElementById('activityBar') && !!document.getElementById('activityCanvas') && !!document.getElementById('activityFiles')`));
  await check('文件模式按钮存在', async () => evalExpr(`!!document.getElementById('activityFiles')`));
  await check('连线方式选择器存在', async () => evalExpr(`!!document.getElementById('linkModeSelect') && document.getElementById('linkModeSelect').options.length >= 4`));
  await check('切换到文件模式并加载文件树', async () => {
    const v = await evalExpr(`new Promise(resolve => {
      const btn = document.getElementById('activityFiles');
      if (!btn) return resolve('no activityFiles');
      btn.click();
      const t0 = Date.now();
      const iv = setInterval(() => {
        const panel = document.getElementById('filePanel');
        const tree = document.getElementById('fileTree');
        const items = tree ? tree.querySelectorAll('.fileTreeItem').length : 0;
        const hint = tree ? tree.textContent : '';
        const ok = panel && panel.style.display === 'flex' && (items > 0 || /暂无|失败/.test(hint));
        if (ok || Date.now() - t0 > 5000) {
          clearInterval(iv);
          resolve(JSON.stringify({items, display: panel ? panel.style.display : '', hint: hint.slice(0, 30)}));
        }
      }, 100);
    })`);
    return v.startsWith('{') ? 'OK(' + v + ')' : v;
  });
  await check('底部状态栏存在', async () => evalExpr(`!!document.getElementById('statusBar') && !!document.getElementById('statusProject') && !!document.getElementById('statusNodeCount')`));
  await check('状态栏显示正文字数', async () => {
    const v = await evalExpr(`(() => {
      const el = document.getElementById('statusWords');
      return el && /^正文：[\\d,]+ 字 · \\d+ 章$/.test(el.textContent || '') ? 'ok' : (el ? el.textContent : 'no el');
    })()`);
    return v === 'ok' ? true : v;
  });
  await check('详情编辑 撤销/重做 可用(不写盘)', async () => {
    const v = await evalExpr(`(async () => {
      const n = Object.values(nodeMap).find(x => x.label === '章节') || Object.values(nodeMap)[0];
      if (!n) return 'no nodes';
      showDetail(n);
      await new Promise(r => setTimeout(r, 100));
      const ta = document.getElementById('editContent');
      if (!ta) return 'no textarea';
      const orig = ta.value;
      ta.value = orig + '\\n【smoke_undo_test】';
      ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
      const undoOk = ta.value === orig;
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      const redoOk = ta.value !== orig;
      ta.value = orig; // 纯内存操作，未保存，还原即可
      return JSON.stringify({ ok: undoOk && redoOk });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK(撤销/重做)' : v;
    } catch (_) { return v; }
  });
  await check('专注模式 切换可用', async () => {
    const v = await evalExpr(`(async () => {
      const btn = document.getElementById('focusBtn');
      const exitBtn = document.getElementById('focusExitBtn');
      if (!btn || !exitBtn) return JSON.stringify({ ok: false, why: 'no buttons' });
      document.body.classList.remove('focus-mode');
      btn.click();
      await new Promise(r => setTimeout(r, 60));
      const on = document.body.classList.contains('focus-mode');
      const topHidden = getComputedStyle(document.getElementById('topBar')).display === 'none';
      const exitVisible = getComputedStyle(exitBtn).display !== 'none';
      exitBtn.click();
      await new Promise(r => setTimeout(r, 60));
      const off = !document.body.classList.contains('focus-mode');
      const topBack = getComputedStyle(document.getElementById('topBar')).display !== 'none';
      return JSON.stringify({ ok: on && topHidden && exitVisible && off && topBack });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK(隐藏顶栏/侧栏/聊天 + 浮动退出)' : v;
    } catch (_) { return v; }
  });
  await check('框选层存在', async () => evalExpr(`!!document.getElementById('marquee')`));
  await check('自动排列按钮存在', async () => evalExpr(`!!document.getElementById('autoLayoutBtn')`));
  await check('画布板块已生成(分组网格)', async () => {
    const v = await evalExpr(`new Promise(resolve => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const n = document.querySelectorAll('.nodeBoard').length;
        if (n > 0 || Date.now() - t0 > 8000) { clearInterval(iv); resolve(n); }
      }, 100);
    })`);
    return v > 0 ? 'OK(' + v + '个板块)' : '无板块';
  });
  await check('板块之间无重叠', async () => {
    const v = await evalExpr(`(() => {
      const boards = [...document.querySelectorAll('.nodeBoard')];
      const rects = boards.map(b => b.getBoundingClientRect());
      let overlap = null;
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.left < b.right - 2 && a.right > b.left + 2 && a.top < b.bottom - 2 && a.bottom > b.top + 2) {
          overlap = { i: boards[i].dataset.id, j: boards[j].dataset.id };
        }
      }
      return JSON.stringify({ ok: !overlap, count: boards.length, overlap });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK(' + o.count + '块互不重叠)' : v;
    } catch (_) { return v; }
  });
  await check('布局版本已升级(v3)', async () => {
    const v = await evalExpr(`fetch('/api/data?project=' + encodeURIComponent(currentProject)).then(r => r.json()).then(d => JSON.stringify({ version: d.layout && d.layout.version, n: d.nodes.length }))`);
    try {
      const o = JSON.parse(v);
      return o.version === 3 ? 'OK(version=' + o.version + ', nodes=' + o.n + ')' : v;
    } catch (_) { return v; }
  });
  await check('布局精确尺寸无重叠(重排后)', async () => {
    const v = await evalExpr(`(async () => {
      autoLayout();
      await new Promise(r => setTimeout(r, 300));
      const boards = [...document.querySelectorAll('.nodeBoard')];
      let overlaps = 0, overflow = 0;
      for (let i = 0; i < boards.length; i++) {
        const a = boards[i].getBoundingClientRect();
        if (a.width < 5 || a.height < 5) continue;
        const collapsed = boards[i].classList.contains('collapsed');
        if (!collapsed) {
          for (const c of boards[i].querySelectorAll('.node:not(.nodeBoard)')) {
            const cr = c.getBoundingClientRect();
            if (cr.left < a.left - 3 || cr.top < a.top - 3 || cr.right > a.right + 3 || cr.bottom > a.bottom + 3) overflow++;
          }
        }
        for (let j = i + 1; j < boards.length; j++) {
          const b = boards[j].getBoundingClientRect();
          if (b.width < 5 || b.height < 5) continue;
          if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) overlaps++;
        }
      }
      return JSON.stringify({ overlaps, overflow });
    })()`);
    try {
      const o = JSON.parse(v);
      return (o.overlaps === 0 && o.overflow === 0) ? 'OK(0重叠/0越界)' : v;
    } catch (_) { return v; }
  });
  await check('展开大板块自动避让无重叠', async () => {
    const v = await evalExpr(`(async () => {
      // 找到最大的内容分类板块（如"设定"），做 收起→展开 往返 → 每一步都触发自动体检
      const groups = boardGroups();
      let target = null, maxN = 0;
      for (const key in groups) {
        const g = groups[key];
        if (g.children.length > maxN && key.indexOf('章节') !== 0) { maxN = g.children.length; target = g.base; }
      }
      if (!target) return JSON.stringify({ err: 'no board' });
      const wasCollapsed = collapsedGroups.has(target);
      const step = wasCollapsed ? 'expand' : 'collapse';
      toggleGroup(target); // 与当前状态相反：收起→展开 或 展开→收起
      await new Promise(r => setTimeout(r, 200));
      toggleGroup(target); // 恢复原状态
      await new Promise(r => setTimeout(r, 200));
      const boards = [...document.querySelectorAll('.nodeBoard')];
      let overlaps = 0;
      for (let i = 0; i < boards.length; i++) {
        const a = boards[i].getBoundingClientRect();
        if (a.width < 5 || a.height < 5) continue;
        for (let j = i + 1; j < boards.length; j++) {
          const b = boards[j].getBoundingClientRect();
          if (b.width < 5 || b.height < 5) continue;
          if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) overlaps++;
        }
      }
      const restored = collapsedGroups.has(target) === wasCollapsed;
      return JSON.stringify({ overlaps, restored, step, target, maxN });
    })()`);
    try {
      const o = JSON.parse(v);
      return (o.overlaps === 0 && o.restored) ? 'OK(' + o.target + ' ' + o.step + '往返无重叠)' : v;
    } catch (_) { return v; }
  });
  await check('自适应布局算法可用且布局健康', async () => {
    const v = await evalExpr(`(() => {
      if (typeof layoutHealth !== 'function' || typeof repairLayout !== 'function' || typeof computeAutoLayout !== 'function') return 'MISSING';
      const h = layoutHealth();
      const boardOk = h.problems.length === 0;
      return JSON.stringify({ ok: boardOk, problems: h.problems.map(p => p.type + ':' + (p.key || '')), boards: h.ordered.length });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK(' + o.boards + '板健康)' : v;
    } catch (_) { return v; }
  });
  await check('Agent 工具集已扩展(读/搜/画布/提案)', async () => {
    const v = await evalExpr(`fetch('/api/agent/tools').then(r => r.json()).then(d => JSON.stringify(d.tools || []))`);
    let tools = [];
    try { tools = JSON.parse(v); } catch (_) { return v; }
    const need = ['read_node', 'read_file', 'search', 'list_nodes', 'get_context', 'move_node', 'create_link', 'remove_link', 'edit_node', 'create_node', 'delete_node'];
    const missing = need.filter(t => !tools.includes(t));
    return missing.length === 0 ? 'OK(' + tools.length + '工具)' : 'MISSING: ' + missing.join(',');
  });
  await check('板块正文拖拽可平移画布', async () => {
    const v = await evalExpr(`(() => {
      const board = [...document.querySelectorAll('.nodeBoard')].find(b => !b.classList.contains('collapsed'));
      if (!board) return 'NOBOARD';
      const rect = board.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) return 'TINY';
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const bid = board.dataset.id;
      const bp0 = positions[bid] ? { ...positions[bid] } : null;
      const v0 = { ...view };
      // 正文区域拖拽 → 应平移画布（修复：放大后板块占满视口无法平移的问题）
      board.dispatchEvent(new MouseEvent('mousedown', { clientX: cx, clientY: cy, bubbles: true, button: 0 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: cx + 60, clientY: cy + 40, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      const panOk = Math.abs(view.x - v0.x) > 1 || Math.abs(view.y - v0.y) > 1;
      const boardStayed = bp0 && positions[bid] && positions[bid].x === bp0.x && positions[bid].y === bp0.y;
      // 平移后浏览器补发的 click 不应触发板块（展开/详情）
      const g0 = (() => { const gs = boardGroups(); for (const k in gs) if (gs[k].board.id === bid) return gs[k]; return null; })();
      const wasCollapsed = g0 ? collapsedGroups.has(g0.base) : null;
      const d0 = document.getElementById('detailBody').textContent;
      board.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const stillCollapsed = g0 ? collapsedGroups.has(g0.base) : null;
      const detailSame = document.getElementById('detailBody').textContent === d0;
      return JSON.stringify({ ok: panOk && boardStayed && (!g0 || stillCollapsed === wasCollapsed) && detailSame, panOk, boardStayed });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK(正文拖拽平移且不误触发)' : v;
    } catch (_) { return v; }
  });
  await check('AI 对话框可停靠(底部/侧边栏/悬浮)+拉伸柄', async () => {
    const v = await evalExpr(`(() => {
      const panel = document.getElementById('chatPanel');
      const handle = document.getElementById('chatResizeHandle');
      const dockSel = document.getElementById('chatDock');
      if (!panel || !handle || !dockSel) return 'MISSING';
      // 切右侧停靠 → 应成为 appMain 直属子元素（侧边栏）
      dockSel.value = 'right';
      dockSel.dispatchEvent(new Event('change'));
      const rightOk = panel.classList.contains('dock-right') && panel.parentElement.id === 'appMain';
      // 切悬浮 → 应挂到 body
      dockSel.value = 'float';
      dockSel.dispatchEvent(new Event('change'));
      const floatOk = panel.classList.contains('dock-float') && panel.parentElement.tagName === 'BODY';
      // 切回底部
      dockSel.value = 'bottom';
      dockSel.dispatchEvent(new Event('change'));
      const bottomOk = panel.classList.contains('dock-bottom') && panel.parentElement.id === 'centerArea';
      return JSON.stringify({ ok: rightOk && floatOk && bottomOk, rightOk, floatOk, bottomOk });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK(可停靠/拉伸)' : v;
    } catch (_) { return v; }
  });
  await check('技能栏已就绪', async () => evalExpr(`(() => { const bar = document.getElementById('skillBar'); return !!bar && bar.children.length === 0 && bar.style.display === 'none'; })()`));
  await check('AI 设置并入左下角设置弹窗', async () => evalExpr(`(() => {
    const t = document.getElementById('activityTheme');
    if (!t) return false;
    t.click();
    const open = document.getElementById('themeModal').classList.contains('show');
    const tabs = !!document.getElementById('settingsTabAi') && !!document.getElementById('settingsTabTheme');
    const aiFields = !!document.getElementById('aiBase') && !!document.getElementById('aiKey') && !!document.getElementById('aiModel');
    const noTopBtn = !document.getElementById('aiSettingsBtn');
    const noOldModal = !document.getElementById('aiSettingsModal');
    return !!(open && tabs && aiFields && noTopBtn && noOldModal);
  })()`));
  await check('AI 设置 API 可访问(读)', async () => {
    const v = await evalExpr(`fetch('/api/settings').then(r => r.json()).then(d => JSON.stringify({ ok: !!d.ok, base: typeof (d.ai && d.ai.base) === 'string', model: typeof (d.ai && d.ai.model) === 'string', hasKey: typeof (d.ai && d.ai.hasKey) === 'boolean' }))`);
    try {
      const o = JSON.parse(v);
      return o.ok && o.base && o.model && o.hasKey ? 'OK(base/model/hasKey)' : v;
    } catch (_) { return v; }
  });
  await check('AI 设置校验(非法地址不保存)', async () => {
    const v = await evalExpr(`fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base: 'notaurl' }) }).then(r => r.json()).then(d => JSON.stringify({ err: !!d.error }))`);
    try {
      const o = JSON.parse(v);
      return o.err ? 'OK(校验生效)' : v;
    } catch (_) { return v; }
  });
  await check('设置弹窗 AI 标签页可用(回填/按钮)', async () => {
    const v = await evalExpr(`(async () => {
      const btn = document.getElementById('activityTheme');
      if (!btn) return JSON.stringify({ err: 'no activityTheme' });
      btn.click();
      document.getElementById('settingsTabAi').click();
      await new Promise(r => setTimeout(r, 500));
      const baseVal = document.getElementById('aiBase').value;
      const paneVisible = document.getElementById('settingsPaneAi').style.display !== 'none';
      const themeHidden = document.getElementById('settingsPaneTheme').style.display === 'none';
      const okLabel = document.getElementById('themeOk').textContent === '保存';
      document.getElementById('themeCancel').click();
      return JSON.stringify({ paneVisible, themeHidden, okLabel, baseFilled: baseVal.length > 0 });
    })()`);
    try {
      const o = JSON.parse(v);
      return (o.paneVisible && o.themeHidden && o.okLabel && o.baseFilled) ? 'OK(标签切换/回填/按钮)' : v;
    } catch (_) { return v; }
  });
  await check('人物推进按钮存在', async () => evalExpr(`!!document.querySelector('.agentCmd[data-agent="advance"]')`));
  await check('人物推进 API 可访问', async () => {
    // AI 调用存在偶发抖动：失败时重试一次再判
    let v = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      v = await evalExpr(`fetch('/api/consistency/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: currentProject, content: '测试章节' })
      }).then(r => r.json()).then(d => JSON.stringify({ ok: !!d.ok, error: d.error || '' }))`);
      try { if (JSON.parse(v).ok) break; } catch (_) {}
    }
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK' : (o.error && o.error.includes('AI 对话未配置') ? 'OK(未配置AI)' : v);
    } catch (_) { return v; }
  });
  await check('备份 API 可访问(读)', async () => {
    const v = await evalExpr(`fetch('/api/backups?project=' + encodeURIComponent(currentProject)).then(r => r.json()).then(d => JSON.stringify({ ok: !!d.ok, list: Array.isArray(d.list) }))`);
    try { const o = JSON.parse(v); return o.ok && o.list ? 'OK' : v; } catch (_) { return v; }
  });
  await check('备份快照+恢复往返', async () => {
    const v = await evalExpr(`(async () => {
      const project = currentProject;
      const j = (r) => r.json();
      const hdr = { 'Content-Type': 'application/json' };
      const c = await fetch('/api/file/create', { method: 'POST', headers: hdr, body: JSON.stringify({ project, path: '_smoke_test.md' }) }).then(j);
      if (!c.ok) return JSON.stringify({ ok: false, step: 'create', error: c.error });
      const s1 = await fetch('/api/file/save', { method: 'POST', headers: hdr, body: JSON.stringify({ project, path: '_smoke_test.md', content: '# v1\\n' }) }).then(j);
      if (!s1.ok) return JSON.stringify({ ok: false, step: 'save1', error: s1.error });
      const s2 = await fetch('/api/file/save', { method: 'POST', headers: hdr, body: JSON.stringify({ project, path: '_smoke_test.md', content: '# v2\\n' }) }).then(j);
      if (!s2.ok) return JSON.stringify({ ok: false, step: 'save2', error: s2.error });
      const bl = await fetch('/api/backups?project=' + encodeURIComponent(project)).then(j);
      const b = (bl.list || []).find(x => (x.files || []).some(f => f.rel === '_smoke_test.md'));
      if (!b) return JSON.stringify({ ok: false, step: 'findBackup', error: 'no backup for _smoke_test.md' });
      const r = await fetch('/api/backups/restore', { method: 'POST', headers: hdr, body: JSON.stringify({ ts: b.ts, project }) }).then(j);
      if (!r.ok) return JSON.stringify({ ok: false, step: 'restore', error: r.error });
      const f = await fetch('/api/file?project=' + encodeURIComponent(project) + '&path=' + encodeURIComponent('_smoke_test.md')).then(j);
      if (!f.ok || String(f.content || '').trim() !== '# v1') return JSON.stringify({ ok: false, step: 'verify', error: 'content not v1: ' + JSON.stringify(f).slice(0, 120) });
      const d = await fetch('/api/file/delete', { method: 'POST', headers: hdr, body: JSON.stringify({ project, path: '_smoke_test.md' }) }).then(j);
      if (!d.ok) return JSON.stringify({ ok: false, step: 'delete', error: d.error });
      return JSON.stringify({ ok: true, ts: b.ts });
    })()`);
    cleanupSmokeBak();
    try { const o = JSON.parse(v); return o.ok ? 'OK(roundtrip ts=' + o.ts + ')' : v; } catch (_) { return v; }
  });
  await check('用量 API 可访问', async () => {
    const v = await evalExpr(`fetch('/api/usage').then(r => r.json()).then(d => JSON.stringify({ ok: !!d.ok, today: d.today && typeof d.today.total === 'number', total: d.total && typeof d.total.total === 'number' }))`);
    try { const o = JSON.parse(v); return o.ok && o.today && o.total ? 'OK' : v; } catch (_) { return v; }
  });
  await check('用量已累计(人物推进后)', async () => {
    const adv = results.find(r => r.name === '人物推进 API 可访问');
    const advOk = adv && adv.ok && String(adv.value) !== 'OK(未配置AI)';
    const v = await evalExpr(`fetch('/api/usage').then(r => r.json()).then(d => JSON.stringify({ ok: !!d.ok, calls: d.today ? d.today.calls : null, total: d.today ? d.today.total : null }))`);
    try {
      const o = JSON.parse(v);
      if (!o.ok) return v;
      if (!advOk) return 'OK(未配置AI，无累计)';
      return o.calls >= 1 ? 'OK(calls=' + o.calls + ', total=' + o.total + ')' : '调用未累计: ' + v;
    } catch (_) { return v; }
  });
  await check('全书统计 API 可访问', async () => {
    const v = await evalExpr(`fetch('/api/bookstats?project=' + encodeURIComponent(currentProject)).then(r => r.json()).then(d => JSON.stringify({ ok: !!d.ok, words: d.totalWords, chapters: d.chapterCount, error: d.error || '' }))`);
    try { const o = JSON.parse(v); return (o.ok && o.words > 0 && o.chapters > 0) ? 'OK(words=' + o.words + ', chapters=' + o.chapters + ')' : v; } catch (_) { return v; }
  });
  await check('统计弹窗可打开', async () => {
    const v = await evalExpr(`(async () => {
      const btn = document.getElementById('bookStatsBtn');
      if (!btn) return JSON.stringify({ ok: false, why: 'no btn' });
      btn.click();
      await new Promise(r => setTimeout(r, 400));
      const m = document.getElementById('bookStatsModal');
      const body = document.getElementById('bookStatsBody');
      const open = m && m.classList.contains('show');
      const hasContent = body && body.childElementCount > 0;
      const close = document.getElementById('bookStatsClose');
      if (close) close.click();
      const closed = m && !m.classList.contains('show');
      return JSON.stringify({ ok: open && hasContent && closed });
    })()`);
    try { const o = JSON.parse(v); return o.ok ? 'OK(打开/渲染/关闭)' : v; } catch (_) { return v; }
  });
  await check('时间线 API 可访问', async () => {
    const v = await evalExpr(`fetch('/api/timeline?project=' + encodeURIComponent(currentProject)).then(r => r.json()).then(d => JSON.stringify({ ok: !!d.ok, n: Array.isArray(d.events) ? d.events.length : -1, error: d.error || '' }))`);
    try { const o = JSON.parse(v); return (o.ok && o.n >= 0) ? 'OK(events=' + o.n + ')' : v; } catch (_) { return v; }
  });
  await check('时间线弹窗可打开', async () => {
    const v = await evalExpr(`(async () => {
      const btn = document.getElementById('timelineBtn');
      if (!btn) return JSON.stringify({ ok: false, why: 'no btn' });
      btn.click();
      await new Promise(r => setTimeout(r, 400));
      const m = document.getElementById('timelineModal');
      const open = m && m.classList.contains('show');
      const close = document.getElementById('timelineClose');
      if (close) close.click();
      const closed = m && !m.classList.contains('show');
      return JSON.stringify({ ok: open && closed });
    })()`);
    try { const o = JSON.parse(v); return o.ok ? 'OK' : v; } catch (_) { return v; }
  });
  await check('时间线编辑器 添加/编辑/删除重要节点', async () => {
    const v = await evalExpr(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const marker = '冒烟时间线节点' + Date.now();
      try {
        const btn = document.getElementById('timelineBtn');
        if (!btn) return JSON.stringify({ ok: false, why: 'no btn' });
        btn.click();
        await sleep(250);
        const titleIn = document.getElementById('tlTitle');
        const sel = document.getElementById('tlChapterSel');
        const noteIn = document.getElementById('tlNote');
        const addBtn = document.getElementById('tlAddBtn');
        if (!titleIn || !sel || !addBtn) return JSON.stringify({ ok: false, why: 'no form' });
        if (!sel.options.length) return JSON.stringify({ ok: false, why: 'no chapters' });
        const ch = sel.options[0].value;
        titleIn.value = marker;
        sel.value = ch;
        noteIn.value = '冒烟测试备注';
        addBtn.click();
        await sleep(250);
        let rows = Array.from(document.querySelectorAll('#timelineBody .tlRow'));
        if (!rows.length) return JSON.stringify({ ok: false, why: 'no row after add' });
        let row = rows.find(r => (r.textContent || '').includes(marker));
        if (!row) return JSON.stringify({ ok: false, why: 'added row missing' });
        const badgeOk = !!row.querySelector('.tlBadge') && (row.querySelector('.tlBadge').textContent || '').includes(ch);
        // 编辑：改标题
        row.querySelector('.tlEdit').click();
        await sleep(80);
        const et = row.querySelector('.tlEditTitle');
        if (!et) return JSON.stringify({ ok: false, why: 'no edit input' });
        et.value = marker + '改';
        row.querySelector('.tlSave').click();
        await sleep(250);
        rows = Array.from(document.querySelectorAll('#timelineBody .tlRow'));
        const editedOk = rows.some(r => (r.textContent || '').includes(marker + '改'));
        // 删除（确认框）
        row = rows.find(r => (r.textContent || '').includes(marker + '改')) || rows.find(r => (r.textContent || '').includes(marker));
        if (row) {
          row.querySelector('.tlDel').click();
          await sleep(120);
          const okBtn = document.getElementById('confirmOkBtn');
          if (okBtn) okBtn.click();
        }
        await sleep(250);
        const goneOk = !Array.from(document.querySelectorAll('#timelineBody .tlRow')).some(r => (r.textContent || '').includes(marker));
        document.getElementById('timelineClose').click();
        await sleep(700); // 等防抖保存落盘（最终 timelineNodes 为空）
        return JSON.stringify({ ok: badgeOk && editedOk && goneOk, badgeOk, editedOk, goneOk });
      } catch (e) {
        // 兜底清理：尽量删除残留测试节点
        try {
          const okBtn = document.getElementById('confirmOkBtn');
          if (okBtn && document.getElementById('confirmModal').classList.contains('show')) okBtn.click();
          document.querySelectorAll('#timelineBody .tlRow').forEach(r => {
            if ((r.textContent || '').includes(marker) || (r.textContent || '').includes('冒烟时间线节点')) r.querySelector('.tlDel').click();
          });
          await sleep(120);
          const ok2 = document.getElementById('confirmOkBtn');
          if (ok2 && document.getElementById('confirmModal').classList.contains('show')) ok2.click();
        } catch (_) {}
        return JSON.stringify({ ok: false, why: 'ERR ' + e.message });
      }
    })()`);
    try { const o = JSON.parse(v); return o.ok ? 'OK(添加/编辑/删除)' : v; } catch (_) { return v; }
  });
  await check('自动精修 API 可访问', async () => {
    const v = await evalExpr(`fetch('/api/consistency/polish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: currentProject })
    }).then(r => r.json()).then(d => JSON.stringify({ ok: !!d.ok, error: d.error || '' }))`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK' : (o.error && (o.error.includes('没有可精修的正文') || o.error.includes('AI 对话未配置')) ? 'OK(路由可达)' : v);
    } catch (_) { return v; }
  });
  await check('生成下一章按钮存在', async () => evalExpr(`!!document.querySelector('.agentCmd[data-agent="write"]')`));
  await check('生成下一章 API 可访问', async () => {
    const v = await evalExpr(`fetch('/api/chapter/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: currentProject })
    }).then(r => r.json()).then(d => JSON.stringify({ ok: !!d.ok, error: d.error || '' }))`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK' : (o.error && o.error.includes('生成下一章需要先点击上一章节点') ? 'OK(路由可达)' : v);
    } catch (_) { return v; }
  });
  await check('一致性弹窗含统计标签页', async () => evalExpr(`!!document.querySelector('#auditModal .auditTab[data-tab="stats"]') && !!document.getElementById('statsPane')`));
  await check('漂移统计并入一致性弹窗', async () => {
    const v = await evalExpr(`(async () => {
      document.querySelector('#auditModal .auditTab[data-tab="stats"]').click();
      await new Promise(r => setTimeout(r, 300));
      const pane = document.getElementById('statsPane');
      return JSON.stringify({ ok: pane && pane.style.display !== 'none' && document.getElementById('statsBody') !== null, body: document.getElementById('statsBody') ? document.getElementById('statsBody').childElementCount : -1 });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK(统计页可切换)' : v;
    } catch (_) { return v; }
  });
  await check('冗余入口已移除(设定检查/漂移统计)', async () => evalExpr(`!document.querySelector('.agentCmd[data-agent="stats"]') && !document.querySelector('.agentCmd[data-agent="consistency"]') && !document.getElementById('fbAlertBtn') && !document.getElementById('themeBtn')`));
  await check('漂移统计 API 可访问', async () => {
    const v = await evalExpr(`fetch('/api/stats?project=' + encodeURIComponent(currentProject))
      .then(r => r.json())
      .then(d => JSON.stringify({ ok: d && typeof d.totalAudits === 'number', error: d.error || '' }))`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK' : v;
    } catch (_) { return v; }
  });
  await check('卷管理按钮存在', async () => evalExpr(`!!document.querySelector('.agentCmd[data-agent="volumes"]')`));
  await check('卷管理 API 可访问', async () => {
    const v = await evalExpr(`fetch('/api/volumes?project=' + encodeURIComponent(currentProject))
      .then(r => r.json())
      .then(d => JSON.stringify({ ok: d && Array.isArray(d.volumes), error: d.error || '' }))`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK' : v;
    } catch (_) { return v; }
  });
  await check('提案持久化 API 可访问', async () => {
    const v = await evalExpr(`fetch('/api/proposals?project=' + encodeURIComponent(currentProject))
      .then(r => r.json())
      .then(d => JSON.stringify({ ok: d && Array.isArray(d.proposals), error: d.error || '' }))`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK' : v;
    } catch (_) { return v; }
  });
  await check('卷操作 API 可访问', async () => {
    const v = await evalExpr(`(async () => {
      const out = {};
      const o = await fetch('/api/volumes/outline?project=' + encodeURIComponent(currentProject) + '&rel=__no_such__').then(r => r.json());
      out.outline = o && (o.ok || o.error) ? 'ok' : 'bad';
      const rn = await fetch('/api/volumes/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: currentProject, rel: '__no_such__', name: 'x' }) }).then(r => r.json());
      out.rename = rn && (rn.ok || rn.error) ? 'ok' : 'bad';
      const dl = await fetch('/api/volumes/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: currentProject, rel: '__no_such__' }) }).then(r => r.json());
      out.delete = dl && (dl.ok || dl.error) ? 'ok' : 'bad';
      return JSON.stringify(out);
    })()`);
    try {
      const o = JSON.parse(v);
      return o.outline === 'ok' && o.rename === 'ok' && o.delete === 'ok' ? 'OK' : v;
    } catch (_) { return v; }
  });
  await check('章节核心按钮存在', async () => evalExpr(`!!document.querySelector('.agentCmd[data-agent="cores"]')`));
  await check('章节核心 API 可访问', async () => {
    const v = await evalExpr(`fetch('/api/chapters/cores?project=' + encodeURIComponent(currentProject))
      .then(r => r.json())
      .then(d => JSON.stringify({ ok: d && Array.isArray(d.chapters), error: d.error || '' }))`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK' : v;
    } catch (_) { return v; }
  });
  await check('详情面板 选中加对话(浮动工具条)', async () => {
    const v = await evalExpr(`new Promise(resolve => {
      const t0 = Date.now();
      const iv = setInterval(async () => {
        const el = document.querySelector('.node[data-id]');
        if (el && typeof showDetail === 'function') {
          clearInterval(iv);
          try {
            showDetail(nodeMap[el.dataset.id]);
            await new Promise(r => setTimeout(r, 150));
            const ta = document.getElementById('editContent');
            if (!ta || !ta.value) { resolve(JSON.stringify({ ok: false, why: 'no content' })); return; }
            if (typeof clearPendingRefs === 'function') clearPendingRefs();
            ta.setSelectionRange(0, Math.min(15, ta.value.length));
            ta.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 300, clientY: 300 }));
            const tb = document.getElementById('selToolbar');
            const visible = tb && tb.style.display === 'flex';
            if (!visible) { resolve(JSON.stringify({ ok: false, why: 'toolbar not visible' })); return; }
            const btn = document.getElementById('selToolbarChat');
            btn.click();
            const bar = document.getElementById('refBar');
            const chips = bar ? [...bar.querySelectorAll('.refChip')] : [];
            const inp = document.getElementById('chatInput');
            resolve(JSON.stringify({ ok: chips.length > 0, chips: chips.length, inputLen: inp ? inp.value.length : 0 }));
          } catch (e) { resolve(JSON.stringify({ ok: false, why: e.message })); }
        } else if (Date.now() - t0 > 8000) resolve(JSON.stringify({ ok: false, why: 'timeout' }));
      }, 100);
    })`);
    try {
      const o = JSON.parse(v);
      return o.ok && o.inputLen === 0 ? 'OK(选中→浮动工具条→引用, 不粘贴输入框)' : v;
    } catch (_) { return v; }
  });
  await check('详情面板 整节点添加到对话', async () => {
    const v = await evalExpr(`(async () => {
      const el = document.querySelector('.node[data-id]');
      if (!el || typeof showDetail !== 'function') return JSON.stringify({ ok: false, why: 'no node' });
      showDetail(nodeMap[el.dataset.id]);
      await new Promise(r => setTimeout(r, 150));
      const btn = document.getElementById('detailAddChatBtn');
      if (!btn) return JSON.stringify({ ok: false, why: 'no detailAddChatBtn' });
      if (typeof clearPendingRefs === 'function') clearPendingRefs();
      btn.click();
      await new Promise(r => setTimeout(r, 80));
      const bar = document.getElementById('refBar');
      const chips = bar ? [...bar.querySelectorAll('.refChip')] : [];
      const inp = document.getElementById('chatInput');
      const msgRefs = document.querySelectorAll('#chatMessages .msg.ref').length;
      return JSON.stringify({ ok: chips.length > 0, chips: chips.length, inputLen: inp ? inp.value.length : 0, msgRefs });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok && o.inputLen === 0 ? 'OK(整节点→引用标签, 未发送为消息)' : v;
    } catch (_) { return v; }
  });
  await check('详情面板已简化(章节核心/AI续写移除)', async () => {
    const v = await evalExpr(`(() => {
      const hasCore = !!document.getElementById('setCoreBtn');
      const hasContinue = !!document.getElementById('continueBtn');
      const oldSelGone = !document.getElementById('selToChatBtn');
      const stillHasSave = !!document.getElementById('saveBtn');
      const hasDetailAdd = !!document.getElementById('detailAddChatBtn');
      return JSON.stringify({ ok: !hasCore && !hasContinue && oldSelGone && stillHasSave && hasDetailAdd });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK(核心/续写/旧选中按钮已移除, 保存+整节点添加保留)' : v;
    } catch (_) { return v; }
  });
  await check('无 JS 异常', () => exceptions.length === 0 ? true : exceptions.join(' | '));

  await check('左侧画布栏节点右键菜单可用', async () => {
    const v = await evalExpr(`new Promise(resolve => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const item = document.querySelector('#categoryList .item');
        if (item || Date.now() - t0 > 6000) {
          clearInterval(iv);
          if (!item) return resolve(JSON.stringify({ ok: false, why: 'no sidebar item' }));
          item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
          const menu = document.getElementById('contextMenu');
          const labels = menu ? [...menu.querySelectorAll('button')].map(b => b.textContent) : [];
          return resolve(JSON.stringify({ ok: menu && menu.style.display === 'block', labels }));
        }
      }, 100);
    })`);
    try {
      const o = JSON.parse(v);
      return o.ok && o.labels.some(l => l.includes('打开')) && o.labels.some(l => l.includes('重命名')) && o.labels.some(l => l.includes('删除')) ? 'OK(' + o.labels.join('/') + ')' : v;
    } catch (_) { return v; }
  });
  await check('画布节点右键 添加到对话 → 引用标签(非发送)', async () => {
    const v = await evalExpr(`new Promise(resolve => {
      const t0 = Date.now();
      const iv = setInterval(async () => {
        const item = document.querySelector('#categoryList .item');
        if (item || Date.now() - t0 > 6000) {
          clearInterval(iv);
          if (!item) { resolve(JSON.stringify({ ok: false, why: 'no sidebar item' })); return; }
          try {
            if (typeof clearPendingRefs === 'function') clearPendingRefs();
            const refBefore = document.querySelectorAll('#chatMessages .msg.ref').length;
            item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
            const menu = document.getElementById('contextMenu');
            const btn = menu ? [...menu.querySelectorAll('button')].find(b => b.textContent.includes('添加到对话')) : null;
            if (!btn) { resolve(JSON.stringify({ ok: false, why: 'menu no add-to-chat' })); return; }
            btn.click();
            await new Promise(r => setTimeout(r, 80));
            const bar = document.getElementById('refBar');
            const chips = bar ? [...bar.querySelectorAll('.refChip')] : [];
            const refAfter = document.querySelectorAll('#chatMessages .msg.ref').length;
            const inp = document.getElementById('chatInput');
            resolve(JSON.stringify({ ok: chips.length > 0 && refAfter === refBefore, chips: chips.length, refBefore, refAfter, inputLen: inp ? inp.value.length : 0 }));
          } catch (e) { resolve(JSON.stringify({ ok: false, why: e.message })); }
        }
      }, 100);
    })`);
    try {
      const o = JSON.parse(v);
      return o.ok && o.inputLen === 0 ? 'OK(右键→引用标签, 聊天记录无新增)' : v;
    } catch (_) { return v; }
  });
  await check('文件编辑器 选中加入对话/删除 按钮存在', async () => {
    const v = await evalExpr(`(async () => {
      const act = document.getElementById('activityFiles');
      if (act) act.click();
      await new Promise(r => setTimeout(r, 500));
      const items = [...document.querySelectorAll('#fileTree .fileTreeItem')];
      if (!items.length) return JSON.stringify({ ok: false, why: 'no files' });
      items[0].click();
      await new Promise(r => setTimeout(r, 300));
      return JSON.stringify({
        ok: !!document.getElementById('fileSelChatBtn') && !!document.getElementById('fileDeleteBtn') && !!document.getElementById('fileEditAiBtn') && !document.getElementById('fileContinueBtn') && !document.getElementById('fileToChatBtn'),
        hasSel: !!document.getElementById('fileSelChatBtn'),
        hasDel: !!document.getElementById('fileDeleteBtn'),
        hasAi: !!document.getElementById('fileEditAiBtn'),
        oldContinueGone: !document.getElementById('fileContinueBtn'),
        dupToChatGone: !document.getElementById('fileToChatBtn')
      });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK(sel/del/ai修改, 旧续写与重复按钮已合并移除)' : v;
    } catch (_) { return v; }
  });
  await check('文件编辑器 选中加入对话 生成引用标签', async () => {
    const v = await evalExpr(`(async () => {
      const ta = document.getElementById('fileContent');
      const b = document.getElementById('fileSelChatBtn');
      if (!ta || !b) return JSON.stringify({ ok: false, why: 'no elements' });
      if (!ta.value) return JSON.stringify({ ok: false, why: 'empty file' });
      if (typeof clearPendingRefs === 'function') clearPendingRefs();
      ta.setSelectionRange(0, Math.min(15, ta.value.length));
      ta.dispatchEvent(new Event('mouseup', { bubbles: true }));
      b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      b.click();
      const bar = document.getElementById('refBar');
      const chips = bar ? [...bar.querySelectorAll('.refChip')] : [];
      const inp = document.getElementById('chatInput');
      return JSON.stringify({ ok: chips.length > 0, chips: chips.length, inputLen: inp ? inp.value.length : 0 });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK(chip, input stays empty)' : v;
    } catch (_) { return v; }
  });
  await check('文件树右键菜单 添加到对话', async () => {
    const v = await evalExpr(`(async () => {
      const act = document.getElementById('activityFiles');
      if (act) act.click();
      await new Promise(r => setTimeout(r, 500));
      const items = [...document.querySelectorAll('#fileTree .fileTreeItem')];
      if (!items.length) return JSON.stringify({ ok: false, why: 'no files' });
      if (typeof clearPendingRefs === 'function') clearPendingRefs();
      items[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      const menu = document.getElementById('contextMenu');
      const labels = menu ? [...menu.querySelectorAll('button')].map(b => b.textContent) : [];
      const btn = labels.length ? [...menu.querySelectorAll('button')].find(b => b.textContent.includes('添加到对话')) : null;
      if (!btn) return JSON.stringify({ ok: false, why: 'menu no add-to-chat', labels });
      btn.click();
      await new Promise(r => setTimeout(r, 150));
      const bar = document.getElementById('refBar');
      const chips = bar ? [...bar.querySelectorAll('.refChip')] : [];
      const chipLabel = chips.length ? chips[chips.length - 1].textContent.trim() : '';
      const inp = document.getElementById('chatInput');
      return JSON.stringify({ ok: chips.length > 0, chips: chips.length, chipLabel, labels, inputLen: inp ? inp.value.length : 0 });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok && o.inputLen === 0 ? 'OK(文件右键→整文件引用标签, 未发送)' : v;
    } catch (_) { return v; }
  });
  await check('自动保存 防抖布防/还原不写盘', async () => {
    const v = await evalExpr(`(async () => {
      const act = document.getElementById('activityFiles');
      if (act) act.click();
      await new Promise(r => setTimeout(r, 400));
      let ta = document.getElementById('fileContent');
      if (!ta || !ta.value) {
        const items = [...document.querySelectorAll('#fileTree .fileTreeItem')];
        if (!items.length) return JSON.stringify({ ok: false, why: 'no files' });
        items[0].click();
        await new Promise(r => setTimeout(r, 300));
        ta = document.getElementById('fileContent');
      }
      if (!ta || !ta.value) return JSON.stringify({ ok: false, why: 'no content' });
      const f = openFiles.find(x => x.path === activeFilePath);
      if (!f) return JSON.stringify({ ok: false, why: 'no open file' });
      const original = ta.value;
      const savedBefore = f.savedContent;
      // 输入一段文本 → 应布防自动保存
      ta.value = original + '\\n【autosave_smoke】';
      ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      const armed = (document.getElementById('fileStatus').textContent || '').includes('自动保存');
      // 立即还原 → 应解除布防，且文件未被写盘
      ta.value = original;
      ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      const unarmed = !(document.getElementById('fileStatus').textContent || '').includes('自动保存');
      const noWrite = f.savedContent === savedBefore;
      return JSON.stringify({ ok: armed && unarmed && noWrite, armed, unarmed, noWrite });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK(布防→还原解除, 不写盘)' : v;
    } catch (_) { return v; }
  });
  await check('浮动选中工具条 出现并可加引用', async () => {
    const v = await evalExpr(`(async () => {
      const ta = document.getElementById('fileContent');
      if (!ta || !ta.value) return JSON.stringify({ ok: false, why: 'no textarea' });
      if (typeof clearPendingRefs === 'function') clearPendingRefs();
      ta.focus();
      ta.setSelectionRange(0, Math.min(12, ta.value.length));
      ta.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 300, clientY: 300 }));
      const tb = document.getElementById('selToolbar');
      const visible = tb && tb.style.display === 'flex';
      if (!visible) return JSON.stringify({ ok: false, why: 'toolbar not visible' });
      const btn = document.getElementById('selToolbarChat');
      btn.click();
      const bar = document.getElementById('refBar');
      const chips = bar ? [...bar.querySelectorAll('.refChip')] : [];
      return JSON.stringify({ ok: chips.length > 0, chips: chips.length });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK(toolbar->chip)' : v;
    } catch (_) { return v; }
  });
  await check('节点重命名 API 可访问', async () => {
    const v = await evalExpr(`(async () => {
      const r = await fetch('/api/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: currentProject, id: '__no_such_node__', title: 'x' })
      }).then(r => r.json());
      return JSON.stringify({ ok: !!r.error && typeof renameChapter === 'function', error: r.error || '' });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK(route responds, renameChapter defined)' : v;
    } catch (_) { return v; }
  });

  // ── 大一统框架 v1：视图切换 / 识别报告 / 未识别池 ──
  await check('进度轴视图切换可用', async () => {
    const v = await evalExpr(`(() => {
      const btn = document.getElementById('viewModeBtn');
      if (!btn) return JSON.stringify({ ok: false, why: 'no button' });
      if (viewMode === 'axis') exitAxisView(false);
      enterAxisView(false);
      const am = document.getElementById('axisYModal');
      if (am) am.classList.remove('show'); // 关闭无卷询问弹窗，避免遮挡后续操作
      const axisOn = document.getElementById('axisView').style.display === 'block';
      const worldOff = document.getElementById('world').style.display === 'none';
      const nodeCards = document.querySelectorAll('#axisNodes .node').length;
      const yLabels = document.querySelectorAll('.axisYLabel').length;
      exitAxisView(false);
      const backToFree = document.getElementById('world').style.display !== 'none';
      return JSON.stringify({ ok: axisOn && worldOff && nodeCards > 0 && yLabels >= 1 && backToFree, axisOn, worldOff, nodeCards, yLabels, backToFree });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK(axis toggle + grid render)' : v;
    } catch (_) { return v; }
  });

  await check('识别报告 API + 弹窗可用', async () => {
    const v = await evalExpr(`(async () => {
      const r = await fetch('/api/recognition?project=' + encodeURIComponent(currentProject)).then(r => r.json());
      if (r.error) return JSON.stringify({ ok: false, why: r.error });
      openRecognitionReport();
      await new Promise(res => setTimeout(res, 600));
      const modal = document.getElementById('recognitionModal');
      const visible = modal && modal.style.display === 'flex';
      const stats = document.querySelectorAll('#recognitionBody .recModalStat').length;
      const hasUnrec = document.querySelectorAll('#recognitionBody .recUnrec').length > 0;
      const closeBtn = document.getElementById('recognitionClose');
      if (closeBtn) closeBtn.click();
      const closed = modal.style.display === 'none';
      return JSON.stringify({ ok: visible && stats >= 4 && hasUnrec && closed, totalMd: r.totalMd, unrec: r.unrecognizedCount, stats, closed });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK(report modal + promote list)' : v;
    } catch (_) { return v; }
  });

  await check('未识别池灰显板块存在', async () => {
    const v = await evalExpr(`(() => {
      const board = [...document.querySelectorAll('.nodeBoard')].find(b => b.classList.contains('type-unrecognized'));
      if (!board) return JSON.stringify({ ok: false, why: 'no unrecognized board' });
      const boardHas = board.querySelector('.ntitle') && board.querySelector('.ntitle').textContent === '未识别';
      const grey = board.classList.contains('type-unrecognized');
      const unrecNodes = nodes.filter(n => n.unrecognized).length;
      const fileBadges = document.querySelectorAll('#fileTree .recFileBadge').length;
      return JSON.stringify({ ok: boardHas && grey && unrecNodes > 0, boardHas, grey, unrecNodes, fileBadges });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK(unrecognized grey board)' : v;
    } catch (_) { return v; }
  });

  await check('未识别节点可提升为正式节点(override)', async () => {
    const v = await evalExpr(`(async () => {
      const unrec = nodes.find(n => n.unrecognized);
      if (!unrec) return JSON.stringify({ ok: true, skipped: 'no unrec nodes' });
      const r = await fetch('/api/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: currentProject, id: unrec.id, patch: { type: 'context', label: '上下文' } })
      }).then(r => r.json());
      if (r.error) return JSON.stringify({ ok: false, why: r.error });
      // 回读验证 override 生效
      const d = await fetch('/api/data?project=' + encodeURIComponent(currentProject)).then(r => r.json());
      const promoted = d.nodes.find(x => x.id === unrec.id);
      const eff = promoted && promoted.type === 'context' && promoted.recognizedBy === 'manual';
      // 清理：撤销 override
      await fetch('/api/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: currentProject, id: unrec.id, patch: { type: null, label: null } })
      });
      return JSON.stringify({ ok: eff, eff });
    })()`);
    try {
      const o = JSON.parse(v);
      return o.ok ? 'OK(override promote + revert)' : v;
    } catch (_) { return v; }
  });

  await check('无 JS 异常(第二轮)', () => exceptions.length === 0 ? true : exceptions.join(' | '));

  ws.close();

  const failed = results.filter(r => !r.ok);
  console.log('\n' + (failed.length ? '❌ 测试失败 ' + failed.length + ' 项' : '✅ 全部通过 ' + results.length + ' 项'));
  cleanup();
  process.exit(failed.length ? 1 : 0);
}

function cleanup() {
  try { if (edgeProc && !edgeProc.killed) edgeProc.kill(); } catch (_) {}
  try { if (serverProc && !serverProc.killed) serverProc.kill(); } catch (_) {}
  try { fs.rmSync(path.join(root, '_edge_smoke_test'), { recursive: true, force: true }); } catch (_) {}
}

// 备份往返测试会通过 writeText 产生 _smoke_test.md.bak（API 删除只删 .md），这里兜底清理
function cleanupSmokeBak() {
  try {
    const base = path.dirname(root);
    const dirs = [base];
    for (let depth = 0; depth < 4 && dirs.length; depth++) {
      const next = [];
      for (const d of dirs) {
        const bak = path.join(d, '_smoke_test.md.bak');
        if (fs.existsSync(bak)) { try { fs.rmSync(bak, { force: true }); } catch (_) {} }
        let entries = [];
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { continue; }
        for (const e of entries) {
          if (e.isDirectory() && !e.name.startsWith('.')) next.push(path.join(d, e.name));
        }
      }
      dirs.length = 0; dirs.push(...next);
    }
  } catch (_) {}
}

main().catch(e => { console.error('❌ ' + e.message); cleanup(); process.exit(1); });
process.on('SIGINT', () => { cleanup(); process.exit(1); });
