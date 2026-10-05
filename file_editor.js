// Novel Canvas 文件树 + 多标签 Markdown 编辑器 + AI 修改审阅
let fileMode = false;
let activeEditorKind = 'canvas';
let detailCollapsedByFile = false;
let fileTree = [];
let openFiles = [];
let activeFilePath = null;
let fileTreeLoaded = false;
let fileSelectedDirPath = '';
let currentFileProposal = null;
const fileReviewDrafts = new Map();
function filePathKey(file) { return String(file || '').replace(/\\/g,'/'); }
function fileReviewStorageKey(key) { return 'novelFileReview_'+encodeURIComponent(key); }
function saveFileReviewDraft(key,draft) {
  try { localStorage.setItem(fileReviewStorageKey(key),JSON.stringify({before:draft.before,after:draft.after,selected:[...draft.selected],replacements:[...draft.replacements]})); }
  catch(_) { showToast('审阅草稿保存失败，请保留当前窗口','error'); }
}
function removeFileReviewDraft(key) { fileReviewDrafts.delete(key); localStorage.removeItem(fileReviewStorageKey(key)); }
let fileReviewApplying = false;
let dragTabPath = null;
let autosaveTimer = null;
const FILE_AUTOSAVE_DELAY = 3000; // 停止输入 3 秒后自动保存
// 由「全项目搜索」写入、renderFileEditor 消费：打开文件后需要滚动/选中到第几行。
// 用模块级变量而不是函数参数，是因为 openFile 可能命中「已在标签里打开」的分支，
// 那条路径不会重新走 openFile 的参数，只有 renderFileEditor 是两条路径的公共出口。
let pendingFileJumpLine = 0;

function initFileEditor() {
  document.getElementById('activityCanvas').addEventListener('click', () => switchSidebarMode('canvas'));
  document.getElementById('activityFiles').addEventListener('click', () => switchSidebarMode('files'));
  document.getElementById('activityChat').addEventListener('click', () => toggleChat());
  document.getElementById('activityTheme').addEventListener('click', () => document.getElementById('themeModal').classList.add('show'));
  document.getElementById('canvasTab').addEventListener('click', () => activateEditorTab('canvas'));
  document.getElementById('newFileBtn').addEventListener('click', () => createFile(fileSelectedDirPath));
  document.getElementById('fileTreeReloadBtn').addEventListener('click', () => loadFileTree());
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#fileTree') && !e.target.closest('#contextMenu')) {
      fileSelectedDirPath = '';
      refreshFileTreeSelection();
    }
  });
}

function switchSidebarMode(mode) {
  const sidebarEl = document.getElementById('sidebar');
  if (sidebarEl.classList.contains('hidden')) {
    sidebarEl.classList.remove('hidden');
    document.getElementById('sidebarResizer').classList.remove('hidden');
    document.getElementById('sidebarShow').classList.remove('show');
  }
  fileMode = mode === 'files';
  sidebarEl.classList.toggle('responsive-open', window.innerWidth <= 1180 && fileMode);
  document.getElementById('activityCanvas').classList.toggle('on', !fileMode);
  document.getElementById('activityFiles').classList.toggle('on', fileMode);
  document.getElementById('sidebarTitle').textContent = fileMode ? '正文与资料' : '内容导航';
  document.getElementById('canvasPanel').style.display = fileMode ? 'none' : 'flex';
  document.getElementById('filePanel').style.display = fileMode ? 'flex' : 'none';
  if (fileMode) {
    if (!fileTreeLoaded) loadFileTree();
  } else {
    activateEditorTab('canvas');
    // 切回画布侧栏时刷新节点，保证文件编辑后画布同步
    loadData().catch(() => {});
  }
}

function activateEditorTab(kind) {
  activeEditorKind = kind;
  document.body.classList.toggle('editing-file', kind === 'file');
  document.getElementById('activityCanvas').classList.toggle('on', kind === 'canvas');
  document.getElementById('activityFiles').classList.toggle('on', kind === 'file' || fileMode);
  const canvasTab = document.getElementById('canvasTab');
  const canvasWrap = document.getElementById('canvasWrap');
  const fileEditor = document.getElementById('fileEditor');
  canvasTab.classList.toggle('on', kind === 'canvas');
  canvasWrap.classList.toggle('hidden', kind !== 'canvas');
  fileEditor.classList.toggle('active', kind === 'file');
  if (kind === 'file') {
    if (window.innerWidth <= 1180) document.getElementById('sidebar').classList.remove('responsive-open');
    collapseDetailForFileEditor();
    document.dispatchEvent(new Event('activeFileChanged'));
  } else {
    expandDetailAfterFileEditor();
    if (typeof updateView === 'function') updateView();
  }
}

function collapseDetailForFileEditor() {
  const detailEl = document.getElementById('detail');
  if (!detailEl || detailEl.classList.contains('hidden')) return;
  detailCollapsedByFile = true;
  detailEl.classList.add('hidden');
  document.getElementById('detailResizer').classList.add('hidden');
  document.getElementById('detailShow').classList.add('show');
}

function expandDetailAfterFileEditor() {
  if (!detailCollapsedByFile) return;
  detailCollapsedByFile = false;
  document.getElementById('detail').classList.remove('hidden');
  document.getElementById('detailResizer').classList.remove('hidden');
  document.getElementById('detailShow').classList.remove('show');
}

function resetFileEditor() {
  openFiles = [];
  activeFilePath = null;
  fileTreeLoaded = false;
  fileTree = [];
  currentFileProposal = null;
  const tabsEl = document.getElementById('fileTabs');
  if (tabsEl) { tabsEl.innerHTML = ''; tabsEl.style.display = 'none'; }
  const bodyEl = document.getElementById('fileEditorBody');
  if (bodyEl) bodyEl.innerHTML = '';
  if (activeEditorKind === 'file') activateEditorTab('canvas');
  if (fileMode) loadFileTree();
}

// 把文件树加载错误翻译成可操作的中文提示（网络层错误 ≠ 服务端返回的业务错误）
function describeFileTreeError(e) {
  if (e && e.name === 'AbortError') return '加载超时：本地服务无响应，请确认服务已启动（npm run dev），再点击 ↻ 重试';
  const msg = (e && e.message) || '';
  if (e instanceof TypeError || msg === 'Failed to fetch' || /failed to fetch/i.test(msg)) {
    return '无法连接本地服务：服务未运行或已退出，请重新运行 npm run dev，再点击 ↻ 重试';
  }
  return msg || '加载失败';
}

async function loadFileTree() {
  const container = document.getElementById('fileTree');
  container.innerHTML = '<div class="fileTreeHint">加载中...</div>';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000); // 8 秒超时，避免服务无响应时一直转圈
  try {
    const res = await fetch('/api/files?project=' + encodeURIComponent(currentProject), { signal: controller.signal });
    let data;
    try {
      data = await res.json();
    } catch (_) {
      throw new Error('服务响应异常（HTTP ' + res.status + '），请确认 npm run dev 仍在运行');
    }
    if (data.error) throw new Error(data.error);
    fileTree = data.files || [];
    fileTreeLoaded = true;
    renderFileTree(fileTree, container);
  } catch (e) {
    container.innerHTML = '<div class="fileTreeHint">加载失败：' + escapeHtml(describeFileTreeError(e)) + '</div>';
  } finally {
    clearTimeout(timer);
  }
}

function renderFileTree(children, container) {
  container.innerHTML = '';
  if (!children || !children.length) {
    container.innerHTML = '<div class="fileTreeHint">暂无 .md 文件</div>';
    return;
  }
  for (const item of children) {
    if (item.type === 'dir') {
      const dir = document.createElement('div');
      dir.className = 'fileTreeDir';
      dir.dataset.path = item.path;
      const label = document.createElement('div');
      label.className = 'fileTreeDirLabel';
      label.innerHTML = '<span class="caret">▾</span> <span class="name">' + escapeHtml(item.name) + '</span>';
      const sub = document.createElement('div');
      sub.className = 'fileTreeChildren';
      renderFileTree(item.children, sub);
      label.addEventListener('click', (e) => {
        e.stopPropagation();
        dir.classList.toggle('collapsed');
        label.querySelector('.caret').textContent = dir.classList.contains('collapsed') ? '▸' : '▾';
      });
      label.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileSelectedDirPath = item.path;
        refreshFileTreeSelection();
        showMenu(e.clientX, e.clientY, [
          { label: '在此目录新建文件', action: () => createFile(item.path) }
        ]);
      });
      dir.appendChild(label);
      dir.appendChild(sub);
      container.appendChild(dir);
    } else {
      const fileEl = document.createElement('div');
      fileEl.className = 'fileTreeItem';
      fileEl.dataset.path = item.path;
      fileEl.textContent = item.name;
      fileEl.title = item.path;
      // 大一统框架：含未识别内容的文件打灰标（数据来自 loadData 的 unrecognizedFiles）
      if (typeof unrecognizedFiles !== 'undefined' && unrecognizedFiles.has(item.path)) {
        const badge = document.createElement('span');
        badge.className = 'recFileBadge';
        badge.textContent = '未识别';
        badge.title = '此文件有内容未被任何识别规则覆盖，点击右侧「识别」查看';
        fileEl.appendChild(badge);
      }
      if (item.path === activeFilePath) fileEl.classList.add('active');
      fileEl.addEventListener('click', (e) => {
        e.stopPropagation();
        openFile(item.path);
      });
      fileEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileSelectedDirPath = item.path.split('/').slice(0, -1).join('/');
        refreshFileTreeSelection();
        showMenu(e.clientX, e.clientY, [
          { label: '打开', action: () => openFile(item.path) },
          { label: '添加到对话', action: () => addFileToChatByPath(item.path) },
          { label: '重命名', action: () => renameFile(item.path) },
          { label: '删除', action: () => deleteFile(item.path) }
        ]);
      });
      container.appendChild(fileEl);
    }
  }
}

function refreshFileTreeSelection() {
  document.querySelectorAll('#fileTree .fileTreeDirLabel').forEach(el => {
    const path = el.parentElement.dataset.path || '';
    el.classList.toggle('selected', !!fileSelectedDirPath && path === fileSelectedDirPath);
  });
}

async function openFile(path) {
  let f = openFiles.find(x => x.path === path);
  if (!f) {
    try {
      const res = await fetch('/api/file?project=' + encodeURIComponent(currentProject) + '&path=' + encodeURIComponent(path));
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      f = { path, name: path.split('/').pop(), content: data.content, savedContent: data.content, dirty: false, pinned: false };
      openFiles.push(f);
    } catch (e) {
      showToast('打开文件失败：' + e.message, 'error');
      return;
    }
  }
  activeFilePath = path;
  renderFileTabs();
  renderFileEditor();
  refreshFileTreeActive();
  activateEditorTab('file');
}

async function openFileProposal(proposal) {
  const existing = await fetch('/api/file?project=' + encodeURIComponent(currentProject) + '&path=' + encodeURIComponent(proposal.file)).then(r => r.json());
  if (existing.error && proposal.oldContent !== '') throw new Error(existing.error);
  if (existing.error && !openFiles.some(f => f.path === proposal.file)) {
    openFiles.push({ path: proposal.file, name: proposal.file.split('/').pop(), content: '', savedContent: '', dirty: false, pendingCreate: true });
    activeFilePath = proposal.file;
    renderFileTabs();
    renderFileEditor();
    activateEditorTab('file');
  } else await openFile(proposal.file);
  renderFileProposal(proposal);
}

// 从「全项目搜索」结果跳转：打开文件并定位到指定行。
// 需要同时把侧栏切到文件模式，否则用户只看到编辑区打开、左侧文件树却没出现，
// 容易误以为跳转失败。
async function openFileAtLine(path, line) {
  pendingFileJumpLine = Math.max(1, parseInt(line, 10) || 1);
  if (typeof switchSidebarMode === 'function' && typeof fileMode !== 'undefined' && !fileMode) {
    switchSidebarMode('files');
  }
  await openFile(path);
}

// 把 textarea 滚动到目标行并选中整行。
// textarea 没有「滚动到第 N 行」的 API，只能用行高估算：scrollHeight / 总行数 得到
// 平均行高，再乘行号。文件里长行换行会让估算偏移，所以只减 1/3 视口高度做余量，
// 保证目标行一定落在可视区域内（宁可偏上，不要偏下）。选中整行才是精准的定位信号。
function jumpTextareaToLine(ta, lineNo) {
  if (!ta) return;
  const lines = ta.value.split('\n');
  const idx = Math.min(Math.max(lineNo, 1), Math.max(lines.length, 1)) - 1;
  let start = 0;
  for (let i = 0; i < idx; i++) start += lines[i].length + 1;
  const end = start + lines[idx].length;
  try { ta.focus(); ta.setSelectionRange(start, end); } catch (_) { /* 忽略选区异常 */ }
  const avgLineHeight = ta.scrollHeight / Math.max(lines.length, 1);
  const top = Math.max(0, idx * avgLineHeight - ta.clientHeight / 3);
  ta.scrollTop = top;
  // 浏览器可能因聚焦/选区再次调整滚动位置，下一帧再校正一次
  requestAnimationFrame(() => { ta.scrollTop = top; });
}

function renderFileTabs() {
  const tabsEl = document.getElementById('fileTabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = '';
  if (!openFiles.length) {
    tabsEl.style.display = 'none';
    return;
  }
  tabsEl.style.display = 'flex';
  const ordered = [...openFiles].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  for (const f of ordered) {
    const tab = document.createElement('div');
    tab.className = 'fileTab' + (f.path === activeFilePath ? ' active' : '') + (f.pinned ? ' pinned' : '');
    tab.title = f.path + (f.pinned ? '（已固定）' : '');
    tab.draggable = true;
    tab.innerHTML =
      '<span class="fileTabPin" title="固定/取消固定">固定</span>' +
      '<span class="fileTabName">' + escapeHtml(f.name) + '</span>' +
      (f.dirty ? '<span class="fileTabDirty">●</span>' : '') +
      '<span class="fileTabClose">×</span>';
    tab.addEventListener('click', (e) => {
      if (e.target.classList.contains('fileTabClose')) {
        e.stopPropagation();
        closeFile(f.path);
        return;
      }
      if (e.target.classList.contains('fileTabPin')) {
        e.stopPropagation();
        f.pinned = !f.pinned;
        renderFileTabs();
        renderFileEditor();
        return;
      }
      activeFilePath = f.path;
      renderFileTabs();
      renderFileEditor();
      refreshFileTreeActive();
      activateEditorTab('file');
    });
    tab.addEventListener('dragstart', (e) => {
      dragTabPath = f.path;
      e.dataTransfer.effectAllowed = 'move';
    });
    tab.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    tab.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!dragTabPath || dragTabPath === f.path) return;
      const from = openFiles.findIndex(x => x.path === dragTabPath);
      const target = openFiles.findIndex(x => x.path === f.path);
      if (from < 0 || target < 0) return;
      const [moved] = openFiles.splice(from, 1);
      const targetAfter = openFiles.findIndex(x => x.path === f.path);
      openFiles.splice(targetAfter, 0, moved);
      dragTabPath = null;
      renderFileTabs();
      renderFileEditor();
      refreshFileTreeActive();
    });
    tab.addEventListener('dragend', () => { dragTabPath = null; });
    tabsEl.appendChild(tab);
  }
  if (typeof updateStatusBar === 'function') updateStatusBar();
}

// ── 查找 / 替换（Ctrl+F 查找，Ctrl+H 替换）────────────────────
// 说明：编辑器是纯 textarea，高亮用原生选区实现（选中并滚动到匹配处），
// 不引入叠加层，保持零依赖与滚动性能。
const fileFindState = { open: false, caseSensitive: false };
let fileFindGlobalKey = null;

// 返回所有非重叠匹配区间；非正则、纯字面量查找
function fileFindMatches(text, query, caseSensitive) {
  const out = [];
  if (!query) return out;
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) break;
    out.push({ start: at, end: at + needle.length });
    from = at + needle.length; // 保证前进，杜绝空匹配死循环
  }
  return out;
}

function initFileFindReplace(ta, f) {
  const bar = document.getElementById('fileFindBar');
  const findInput = document.getElementById('fileFindInput');
  const replaceInput = document.getElementById('fileReplaceInput');
  const countEl = document.getElementById('fileFindCount');
  const replaceRow = document.getElementById('fileReplaceRow');
  if (!bar || !findInput || !replaceInput || !countEl || !replaceRow) return;

  let matches = [];
  let index = 0;
  let navigated = false; // 是否已跳到过匹配（决定首次回车是「跳第一处」还是「跳下一处」）

  // 程序化改写后同步 f.content / dirty / 字数 / 自动保存（复用 textarea 自身的 input 逻辑）
  function commit() {
    f.content = ta.value;
    f.dirty = f.content !== f.savedContent;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function renderCount() {
    const q = findInput.value;
    if (!q) { countEl.textContent = '0/0'; countEl.title = ''; findInput.classList.remove('noMatch'); return; }
    if (!matches.length) {
      countEl.textContent = '无结果';
      countEl.title = '未找到匹配项';
      findInput.classList.add('noMatch');
      return;
    }
    countEl.textContent = (index + 1) + '/' + matches.length;
    countEl.title = '共 ' + matches.length + ' 处匹配';
    findInput.classList.remove('noMatch');
  }

  function recompute(reset) {
    matches = fileFindMatches(ta.value, findInput.value, fileFindState.caseSensitive);
    if (reset) { index = 0; navigated = false; }
    if (index >= matches.length) index = Math.max(0, matches.length - 1);
    renderCount();
  }

  // 选中并滚动到当前匹配
  function focusMatch() {
    if (!matches.length) return;
    const m = matches[index];
    ta.focus();
    ta.setSelectionRange(m.start, m.end);
    const line = ta.value.slice(0, m.start).split('\n').length - 1;
    const lineHeight = 22; // 与 #fileContent 的 13px × 1.7 行高一致
    ta.scrollTop = Math.max(0, line * lineHeight - ta.clientHeight / 2);
  }

  function step(delta) {
    if (!matches.length) return;
    if (!navigated) { navigated = true; }
    else { index = (index + delta + matches.length) % matches.length; }
    renderCount();
    focusMatch();
  }

  function open(withReplace) {
    fileFindState.open = true;
    bar.classList.add('show');
    replaceRow.style.display = withReplace ? 'flex' : 'none';
    // 选中了单行文本则带入查找框（编辑器通用习惯）
    const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
    if (sel && !sel.includes('\n') && sel.length <= 100) findInput.value = sel;
    recompute(true);
    if (withReplace) replaceInput.focus(); else findInput.focus();
    findInput.select();
  }

  function close() {
    fileFindState.open = false;
    bar.classList.remove('show');
    ta.focus();
  }

  function replaceOne() {
    if (!matches.length) return;
    const m = matches[index];
    ta.value = ta.value.slice(0, m.start) + replaceInput.value + ta.value.slice(m.end);
    commit();
    recompute(false);
    renderCount();
    if (matches.length) focusMatch();
  }

  function replaceAll() {
    if (!matches.length) return;
    const rep = replaceInput.value;
    let out = '', last = 0;
    for (const m of matches) { out += ta.value.slice(last, m.start) + rep; last = m.end; }
    out += ta.value.slice(last);
    const n = matches.length;
    ta.value = out;
    commit();
    recompute(true);
    renderCount();
    if (typeof showToast === 'function') showToast('已替换 ' + n + ' 处', 'success');
  }

  findInput.addEventListener('input', () => recompute(true));
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (matches.length) step(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  document.getElementById('fileFindNext').addEventListener('click', () => step(1));
  document.getElementById('fileFindPrev').addEventListener('click', () => step(-1));
  document.getElementById('fileFindClose').addEventListener('click', close);
  document.getElementById('fileReplaceOne').addEventListener('click', replaceOne);
  document.getElementById('fileReplaceAll').addEventListener('click', replaceAll);
  const caseBtn = document.getElementById('fileFindCase');
  caseBtn.classList.toggle('on', fileFindState.caseSensitive);
  caseBtn.addEventListener('click', () => {
    fileFindState.caseSensitive = !fileFindState.caseSensitive;
    caseBtn.classList.toggle('on', fileFindState.caseSensitive);
    recompute(true);
  });

  // 全局快捷键：仅文件编辑器处于激活状态时响应（重复 render 时先摘掉旧监听，避免泄漏）
  if (fileFindGlobalKey) document.removeEventListener('keydown', fileFindGlobalKey);
  fileFindGlobalKey = (e) => {
    if (activeEditorKind !== 'file') return;
    if (!document.getElementById('fileContent')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); open(false); }
    else if (mod && !e.shiftKey && e.key.toLowerCase() === 'h') { e.preventDefault(); open(true); }
    else if (mod && !e.shiftKey && e.key.toLowerCase() === 's') {
      // Ctrl+S 保存当前标签文件（原本只有节点编辑器正文区支持，文件编辑器按下去会触发浏览器「保存网页」）
      e.preventDefault();
      const f = openFiles.find(x => x.path === activeFilePath);
      if (f) {
        const taSync = document.getElementById('fileContent');
        if (taSync) f.content = taSync.value; // 以编辑器实际内容为准，避免 f.content 滞后
        saveFile(f);
      }
    }
    else if (e.key === 'Escape' && fileFindState.open) { e.preventDefault(); close(); }
  };
  document.addEventListener('keydown', fileFindGlobalKey);
}

function renderFileEditor() {
  const body = document.getElementById('fileEditorBody');
  if (!body) return;
  body.classList.remove('reviewing-proposal');
  if (!activeFilePath) {
    body.innerHTML = '<div class="fileEditorEmpty">从左侧文件树选择 .md 文件<br>可多标签编辑，支持 AI 改写 / 续写</div>';
    return;
  }
  const f = openFiles.find(x => x.path === activeFilePath);
  if (!f) return;
  body.innerHTML =
    '<div class="fileToolbar">' +
      '<span class="filePath" title="' + escapeHtml(f.path) + '">' + escapeHtml(f.name.replace(/\.md$/i,'')) + '</span>' +
      '<div class="fileActions">' +
        (nodes.some(n=>n.file===f.path && n.label==='章节') ? '<button id="fileWrapUpBtn">本章收尾</button>' : '') +
        '<button id="filePreviewBtn">预览</button>' +
        '<button id="fileSaveBtn">保存</button>' +
        '<details class="fileTools"><summary>写作工具</summary><div>' +
        '<button id="fileDeslopBtn" title="离线检测 AI 味（纯本地规则，不调用大模型；判定权始终在你）">AI 味检测</button>' +
        '<button id="fileSelChatBtn" class="fileChatBtn" title="选中文字加入对话；未选中则加入整个文件">选中加入对话</button>' +
        '<button id="fileEditAiBtn" title="AI 续写 / AI 改写">AI 修改</button>' +
        '<button id="fileUndoProposalBtn" hidden>撤销最近采纳</button>' +
        '<button id="fileTimelineSyncBtn">同步到时间线</button>' +
        '<button id="fileDeleteBtn" class="danger">删除</button>' +
        '</div></details>' +
      '</div>' +
    '</div>' +
    '<div id="filePreviewBox" style="display:none"></div>' +
    '<div class="fileFindBar" id="fileFindBar">' +
      '<div class="fileFindRow">' +
        '<input type="text" id="fileFindInput" placeholder="查找…" spellcheck="false">' +
        '<span class="fileFindCount" id="fileFindCount">0/0</span>' +
        '<button id="fileFindPrev" title="上一个 (Shift+Enter)">↑</button>' +
        '<button id="fileFindNext" title="下一个 (Enter)">↓</button>' +
        '<button id="fileFindCase" class="fileFindToggle" title="区分大小写">Aa</button>' +
        '<button id="fileFindClose" title="关闭 (Esc)">✕</button>' +
      '</div>' +
      '<div class="fileFindRow" id="fileReplaceRow" style="display:none">' +
        '<input type="text" id="fileReplaceInput" placeholder="替换为…" spellcheck="false">' +
        '<button id="fileReplaceOne" title="替换当前匹配">替换</button>' +
        '<button id="fileReplaceAll" title="替换全部匹配">全部替换</button>' +
      '</div>' +
    '</div>' +
    '<textarea id="fileContent" spellcheck="false">' + escapeHtml(f.content) + '</textarea>' +
    '<div class="fileStatus" id="fileStatus">' + (f.dirty ? '未保存' : '已保存') + ' · ' + f.content.replace(/\s/g, '').length + ' 字</div>' +
    '<div id="fileDeslopBox"></div>' +
    '<div id="fileProposalBox"></div>';
  const ta = document.getElementById('fileContent');
  if (f.pendingCreate) {
    ta.readOnly = true;
    ['fileSaveBtn', 'fileDeleteBtn', 'fileEditAiBtn'].forEach(id => { document.getElementById(id).disabled = true; });
    document.getElementById('fileStatus').textContent = '新文件提案 · 接受后才会创建文件';
  }
  ta.addEventListener('input', () => {
    if (f.pendingCreate) return;
    f.content = ta.value;
    f.dirty = f.content !== f.savedContent;
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
    if (f.dirty) {
      // 防抖自动保存：停止输入 3 秒后自动写盘，防丢稿
      autosaveTimer = setTimeout(() => { autosaveTimer = null; saveFile(f); }, FILE_AUTOSAVE_DELAY);
    }
    const st = document.getElementById('fileStatus');
    if (st) st.textContent = (f.dirty ? '未保存 · 将自动保存' : '已保存') + ' · ' + f.content.replace(/\s/g, '').length + ' 字';
    renderFileTabs();
  });
  document.getElementById('fileSaveBtn').addEventListener('click', saveActiveFile);
  document.getElementById('fileWrapUpBtn')?.addEventListener('click', () => openChapterWrapUp(nodes.find(n=>n.file===f.path && n.label==='章节')?.id));
  document.getElementById('fileTimelineSyncBtn').onclick=()=>openTimelineSync(f.path);
  loadFileUndoAction(f);
  initFileFindReplace(ta, f);
  if (pendingFileJumpLine > 0) {
    const targetLine = pendingFileJumpLine;
    pendingFileJumpLine = 0;
    // 放到下一帧再定位：openFile 里 renderFileEditor 之后还会调 activateEditorTab（会折叠右栏），
    // 那一步触发重排并可能清掉刚设好的滚动位置，所以等布局稳定后再滚。
    requestAnimationFrame(() => {
      if (document.body.contains(ta)) jumpTextareaToLine(ta, targetLine);
    });
  }
  document.getElementById('filePreviewBtn').addEventListener('click', toggleFilePreview);
  document.getElementById('fileDeslopBtn').addEventListener('click', runFileDeslopScan);
  document.getElementById('fileEditAiBtn').addEventListener('click', (e) => {
    // 「AI 修改」合并了 续写/改写 两个动作：点击弹出菜单
    const btn = document.getElementById('fileEditAiBtn');
    const r = btn.getBoundingClientRect();
    if (typeof showMenu === 'function') {
      showMenu(r.left, r.bottom + 4, [
        { label: 'AI 续写', action: () => aiEditFile('continue') },
        { label: 'AI 改写', action: () => aiEditFile('edit') }
      ]);
    } else {
      aiEditFile('continue');
    }
  });
  document.getElementById('fileDeleteBtn').addEventListener('click', () => deleteFile(f.path));
  const selChatBtn = document.getElementById('fileSelChatBtn');
  const previewBox = document.getElementById('filePreviewBox');
  let cachedFileSel = '';
  function selectedFileText() {
    const area = document.getElementById('fileContent');
    if (area && area.style.display !== 'none') {
      return area.value.substring(area.selectionStart, area.selectionEnd) || '';
    }
    try { return (window.getSelection() || {}).toString() || ''; } catch (_) { return ''; }
  }
  function captureFileSel() { cachedFileSel = selectedFileText().trim(); }
  // 预览模式点击按钮会清空文档选区，mousedown 时先缓存
  selChatBtn.addEventListener('mousedown', captureFileSel);
  ta.addEventListener('mouseup', captureFileSel);
  ta.addEventListener('keyup', captureFileSel);
  ta.addEventListener('select', captureFileSel);
  // 浮动选中工具条（Trae 风格）：编辑区/预览里选中文字 → 弹出「添加到对话」
  hookSelToolbar(ta, true, (sel, start, end, full) => {
    const lineRange = computeLineRange(full, start, end);
    return {
      add: () => {
        addSelectionToChat(f.path, f.path, sel, lineRange, '文件');
        const st = document.getElementById('fileStatus');
        if (st) st.textContent = '已添加引用「' + f.path + (lineRange ? ' 行' + lineRange : '') + '」，可在输入框继续输入问题后发送';
      },
      edit: () => { ta.style.display = ''; ta.focus(); }
    };
  });
  if (previewBox) {
    hookSelToolbar(previewBox, false, (sel) => ({
      add: () => {
        addSelectionToChat(f.path, f.path, sel, '', '文件');
        const st = document.getElementById('fileStatus');
        if (st) st.textContent = '已添加引用「' + f.path + '」，可在输入框继续输入问题后发送';
      },
      edit: () => { ta.style.display = ''; ta.focus(); }
    }));
  }
  selChatBtn.addEventListener('click', () => {
    const sel = (cachedFileSel || selectedFileText()).trim();
    const st = document.getElementById('fileStatus');
    if (sel) {
      addSelectionToChat(f.path, f.path, sel, '', '文件');
      if (st) st.textContent = '已添加选中片段引用「' + f.path + '」，可在输入框继续输入问题后发送';
    } else {
      addWholeFileToChat(f);
    }
  });
  if (currentFileProposal && currentFileProposal.file === f.path) renderFileProposal(currentFileProposal);
  if (typeof updateStatusBar === 'function') updateStatusBar();
}

function addWholeFileToChat(f) {
  if (!f) return;
  addSelectionToChat(f.path, f.path, f.content || '', '', '文件', true);
  const st = document.getElementById('fileStatus');
  if (st) st.textContent = '已添加整个文件引用「' + f.path + '」，可在输入框继续输入问题后发送';
}

// 文件树右键「添加到对话」：整文件引用（未打开时经 /api/file 读盘，只读不写）
async function addFileToChatByPath(relPath) {
  const f = openFiles.find(x => x.path === relPath);
  if (f) {
    addSelectionToChat(f.path, f.path, f.content || '', '', '文件', true);
    return;
  }
  try {
    const res = await fetch('/api/file?project=' + encodeURIComponent(currentProject) + '&path=' + encodeURIComponent(relPath));
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    addSelectionToChat(relPath, relPath, data.content || '', '', '文件', true);
  } catch (e) {
    showToast('读取文件失败：' + e.message, 'error');
  }
}

// ── AI 味检测（文件编辑器入口）────────────────────────────
// 与画布详情栏（app.js runDeslopScan）共用服务端 /api/deslop/scan 与 renderDeslop 渲染，
// 差别只有两点：① 文本源是 #fileContent 而非 #editContent；
//            ② 渲染后的「定位 / 重建基线 / 改写」三个回调要指向本编辑器。
// 之所以不直接调 app.js 的 wireDeslopHits()：它内部硬编码 #editContent，
// 在文件编辑器里点「定位」不会高亮到本编辑器。
async function runFileDeslopScan() {
  const box = document.getElementById('fileDeslopBox');
  const ta = document.getElementById('fileContent');
  if (!box || !ta) return;
  const btn = document.getElementById('fileDeslopBtn');
  if (btn) btn.disabled = true;
  box.innerHTML = '<div class="hint">检测中...</div>';
  try {
    const res = await fetch('/api/deslop/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: currentProject, content: ta.value })
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    box.innerHTML = renderDeslop(d);
    wireFileDeslopHits();
    // 结果在编辑器下方，检测完自动滚过去（否则用户以为「点了没反应」）
    try { box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {}
  } catch (e) {
    box.innerHTML = '<div class="hint">检测失败：' + escapeHtml(e.message) + '</div>';
  } finally {
    if (btn) btn.disabled = false;
  }
}

function wireFileDeslopHits() {
  const box = document.getElementById('fileDeslopBox');
  const ta = document.getElementById('fileContent');
  if (!box || !ta) return;

  // 重建文风基线 → 用新基线重算
  const rebuild = box.querySelector('.dsRebuild');
  if (rebuild) rebuild.addEventListener('click', async () => {
    rebuild.disabled = true; rebuild.textContent = '提取中...';
    try {
      const res = await fetch('/api/deslop/voiceprint', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: currentProject })
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      showToast('已从 ' + (d.voiceprint.chapters || 0) + ' 章提取文风基线', 'success');
      runFileDeslopScan();
    } catch (e) {
      showToast('提取失败：' + e.message, 'error');
      rebuild.disabled = false; rebuild.textContent = '提取文风基线';
    }
  });

  // 改写命中句：服务端按「命中句」生成 file_edit 提案，交既有审阅 UI（不直接写盘）
  // 注意：/api/deslop/rewrite 要求传 nodeId（改写要落到画布上的一个具体节点），
  // 传 path 会被拒（"需要从画布上的节点发起"）。所以这里按当前文件反查 nodeId。
  const rewrite = box.querySelector('.dsRewrite');
  if (rewrite) rewrite.addEventListener('click', async () => {
    const old = rewrite.textContent;
    const f = openFiles.find(x => x.path === activeFilePath);
    const filePath = f ? f.path : activeFilePath;
    const node = Object.values(nodeMap || {}).find(n => n && n.file === filePath);
    if (!node) {
      showToast('这个文件不在画布节点里，无法生成改写提案（可先把它纳入扫描）', 'error');
      return;
    }
    rewrite.disabled = true; rewrite.textContent = '改写中...';
    try {
      const res = await fetch('/api/deslop/rewrite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: currentProject, nodeId: node.id, content: ta.value })
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      showToast('已生成改写提案（' + d.applied + '/' + d.requested + ' 句），请审阅后接受', 'success');
      if (d.proposal && typeof renderFileProposal === 'function') renderFileProposal(d.proposal);
    } catch (e) {
      showToast('改写失败：' + e.message, 'error');
      rewrite.disabled = false; rewrite.textContent = old;
    }
  });

  // 定位：选中命中的原文片段并滚动过去（textarea 没有 scrollToLine，按行数估算）
  box.querySelectorAll('.dsLocate').forEach(btn => {
    btn.addEventListener('click', () => {
      const cur = document.getElementById('fileContent');
      if (!cur) return;
      const s = Number(btn.dataset.dsStart), e = Number(btn.dataset.dsEnd);
      try {
        cur.focus();
        cur.setSelectionRange(s, e);
        const lines = cur.value.slice(0, s).split('\n').length;
        const avgLineH = cur.scrollHeight / Math.max(lines, 1);
        cur.scrollTop = Math.max(0, lines * avgLineH - cur.clientHeight / 3);
      } catch (_) {}
    });
  });
}

function toggleFilePreview() {
  const box = document.getElementById('filePreviewBox');
  const ta = document.getElementById('fileContent');
  const btn = document.getElementById('filePreviewBtn');
  if (!box || !ta) return;
  if (box.style.display === 'none') {
    box.style.display = 'block';
    box.innerHTML = renderMarkdown(ta.value);
    ta.style.display = 'none';
    btn.textContent = '编辑';
  } else {
    box.style.display = 'none';
    ta.style.display = '';
    btn.textContent = '预览';
  }
}

async function saveFile(f) {
  if (!f || f.pendingCreate) return;
  if (!openFiles.includes(f)) return; // 已关闭/已丢弃的文件不写盘
  const project = currentProject, submittedContent = f.content;
  const st = document.getElementById('fileStatus');
  if (st && f.path === activeFilePath) st.textContent = '保存中...';
  try {
    const res = await fetch('/api/file/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, path: f.path, content: submittedContent })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    f.savedContent = submittedContent;
    f.dirty = f.content !== submittedContent;
    if (st && f.path === activeFilePath) st.textContent = f.dirty ? '未保存 · 将自动保存' : '已保存';
    renderFileTabs();
    await refreshProjectMonitor(project).catch(() => {});
  } catch (e) {
    if (st && f.path === activeFilePath) st.textContent = '保存失败：' + e.message;
  }
}

async function saveActiveFile() {
  const f = openFiles.find(x => x.path === activeFilePath);
  if (f) await saveFile(f);
}

async function closeFile(path) {
  const idx = openFiles.findIndex(x => x.path === path);
  if (idx < 0) return;
  const f = openFiles[idx];
  if (f.dirty && !(await confirmDialog('文件有未保存修改，确定关闭？'))) return;
  openFiles.splice(idx, 1);
  if (activeFilePath === path) {
    activeFilePath = openFiles.length ? openFiles[Math.max(0, idx - 1)].path : null;
  }
  renderFileTabs();
  if (!openFiles.length) {
    activateEditorTab('canvas');
    return;
  }
  renderFileEditor();
  refreshFileTreeActive();
}

function refreshFileTreeActive() {
  document.querySelectorAll('#fileTree .fileTreeItem').forEach(el => {
    el.classList.toggle('active', el.dataset.path === activeFilePath);
  });
}

async function createFile(dirPath) {
  const prefix = dirPath ? String(dirPath).replace(/\/+$/, '') + '/' : '';
  const name = await promptDialog('新建 Markdown 文件（相对项目根目录，可含子目录）：', { value: prefix + '新文件.md' });
  if (!name || !name.trim()) return;
  const rel = name.trim();
  if (!rel.toLowerCase().endsWith('.md')) {
    showToast('文件名必须以 .md 结尾', 'error');
    return;
  }
  fetch('/api/file/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: currentProject, path: rel })
  })
    .then(r => r.json())
    .then(data => {
      if (data.error) throw new Error(data.error);
      fileTreeLoaded = false;
      loadFileTree();
      openFile(rel);
    })
    .catch(e => showToast('新建失败：' + e.message, 'error'));
}

async function deleteFile(path) {
  if (!(await confirmDialog('确定删除文件？\n' + path))) return;
  fetch('/api/file/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: currentProject, path })
  })
    .then(r => r.json())
    .then(data => {
      if (data.error) throw new Error(data.error);
      closeFile(path);
      fileTreeLoaded = false;
      loadFileTree();
    })
    .catch(e => showToast('删除失败：' + e.message, 'error'));
}

async function renameFile(path) {
  const newPath = await promptDialog('新路径（相对项目根目录，以 .md 结尾）：', { value: path });
  if (!newPath || !newPath.trim() || newPath.trim() === path) return;
  const rel = newPath.trim();
  if (!rel.toLowerCase().endsWith('.md')) {
    showToast('文件名必须以 .md 结尾', 'error');
    return;
  }
  fetch('/api/file/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: currentProject, path, newPath: rel })
  })
    .then(r => r.json())
    .then(data => {
      if (data.error) throw new Error(data.error);
      openFiles.forEach(f => {
        if (f.path === path) {
          f.path = rel;
          f.name = rel.split('/').pop();
        }
      });
      if (activeFilePath === path) activeFilePath = rel;
      fileTreeLoaded = false;
      loadFileTree();
      renderFileTabs();
      renderFileEditor();
    })
    .catch(e => showToast('重命名失败：' + e.message, 'error'));
}

async function aiEditFile(mode) {
  const f = openFiles.find(x => x.path === activeFilePath);
  if (!f) return;
  const instruction = await promptDialog(mode === 'continue' ? 'AI 续写要求（可空）：' : 'AI 改写要求：');
  if (instruction === null) return;
  const ta = document.getElementById('fileContent');
  if (ta && ta.value !== f.content) f.content = ta.value;
  const st = document.getElementById('fileStatus');
  if (st) st.textContent = 'AI 生成中...';
  try {
    const res = await fetch('/api/ai/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: currentProject,
        path: f.path,
        content: f.content,
        instruction: instruction || '',
        mode
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderFileProposal(data.proposal);
    if (st) st.textContent = 'AI 已生成修改，请审阅后接受/拒绝';
  } catch (e) {
    if (st) st.textContent = 'AI 生成失败：' + e.message;
  }
}

function fileProposalChange(proposal) {
  const before = String(proposal.oldContent || '').split('\n'), after = String(proposal.newContent || '').split('\n');
  let start = 0, oldEnd = before.length, newEnd = after.length;
  while (start < oldEnd && start < newEnd && before[start] === after[start]) start++;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  return { line: start + 1, removed: before.slice(start, oldEnd), added: after.slice(start, newEnd) };
}

async function dismissFileProposal(proposal) {
  if (currentFileProposal?.id === proposal.id) currentFileProposal = null;
  const box = document.getElementById('fileProposalBox');
  if (box) box.innerHTML = '';
  document.getElementById('fileEditorBody')?.classList.remove('reviewing-proposal');
  const pending = openFiles.find(f => f.path === proposal.file && f.pendingCreate);
  if (pending) await closeFile(pending.path);
}

function renderFileProposal(proposal) {
  const box = document.getElementById('fileProposalBox');
  if (!box || !proposal) return;
  currentFileProposal = proposal;
  document.getElementById('fileEditorBody').classList.add('reviewing-proposal');
  const change = fileProposalChange(proposal);
  const sourceNode = proposal.nodeId ? nodeMap[proposal.nodeId] : nodes.find(n => n.file === proposal.file && n.content === proposal.oldContent);
  const baseLine = ['edit', 'delete'].includes(proposal.kind) ? (sourceNode?.startLine || 1) : 1;
  const selectable = ['edit','file_edit'].includes(proposal.kind);
  const review = selectable ? NovelReview.diff(proposal.oldContent || '',proposal.newContent || '') : null;
  const key = (proposal.root || currentProject) + ':' + proposal.id;
  let draft = fileReviewDrafts.get(key);
  if(selectable && !draft) {
    try {
      const saved=JSON.parse(localStorage.getItem(fileReviewStorageKey(key)) || 'null');
      if(saved && saved.before===proposal.oldContent && saved.after===proposal.newContent && Array.isArray(saved.selected) && Array.isArray(saved.replacements) && saved.selected.every(i=>Number.isInteger(i)&&i>=0&&i<review.hunks.length) && saved.replacements.every(x=>Array.isArray(x)&&Number.isInteger(x[0])&&x[0]>=0&&x[0]<review.hunks.length&&typeof x[1]==='string')) {
        draft={...saved,selected:new Set(saved.selected),replacements:new Map(saved.replacements)};fileReviewDrafts.set(key,draft);
      }
    } catch(_) {}
  }
  if (selectable && (!draft || draft.before !== proposal.oldContent || draft.after !== proposal.newContent)) {
    draft = { before:proposal.oldContent, after:proposal.newContent, selected:new Set(review.hunks.map((_,i)=>i)), replacements:new Map() };
    fileReviewDrafts.set(key,draft);
  }
  box.innerHTML =
    '<div class="fileDiffBox">' +
      '<h4>AI 修改「' + escapeHtml(proposal.title || proposal.file) + '」</h4>' +
      (selectable ? '<div class="fileReviewToolbar"><button class="selectAll">全选</button><button class="selectNone">全不选</button><span class="fileReviewCount" role="status"></span></div><p class="fileReviewHint">未勾选的改动保留原文；采纳所选后结束本次提案。</p><div class="fileReviewHunks"></div>' : '<div class="fileReviewChanges"><section><div class="fileReviewLabel">原文变更区间（区间内可能含未修改行）</div>' +
      change.removed.map((line, i) => '<div class="fileReviewLine removed">− ' + (baseLine + change.line - 1 + i) + '  ' + escapeHtml(line) + '</div>').join('') +
      '</section><section><div class="fileReviewLabel">建议替换为</div>' + change.added.map(line => '<div class="fileReviewLine added">＋ ' + escapeHtml(line) + '</div>').join('') + '</section></div>') +
      '<button class="locateOriginal">定位原文</button><details><summary>查看完整修改前后内容</summary><div class="fileDiffCols">' +
        '<div><div class="fileDiffLabel old">旧内容</div><pre class="old">' + escapeHtml(proposal.oldContent || '（空）') + '</pre></div>' +
        '<div><div class="fileDiffLabel new">新内容</div><pre class="new">' + escapeHtml(proposal.newContent || '（空）') + '</pre></div>' +
      '</div></details>' + (selectable ? '<details class="fileReviewMerged"><summary>预览所选改动合并后的内容</summary><pre></pre></details>' : '') +
      '<div class="fileDiffActions">' +
        '<button class="reject">拒绝修改</button><button class="adjust">继续调整</button><button class="return">返回正文</button>' +
        '<button class="accept">接受修改</button>' +
      '</div>' +
    '</div>';
  if (selectable) {
    const host = box.querySelector('.fileReviewHunks');
    if (review.coarse) { const note=document.createElement('p'); note.className='fileReviewHint'; note.textContent='差异较大，合并为一个改动区间。请编辑建议或查看完整内容后采纳。'; host.appendChild(note); }
    if (!review.hunks.length) { const note=document.createElement('p'); note.textContent='建议与原文一致，没有可采纳的改动。'; host.appendChild(note); }
    const updateSelection = () => {
      saveFileReviewDraft(key,draft);
      box.querySelector('.fileReviewCount').textContent = '已选 '+draft.selected.size+' / '+review.hunks.length+' 段';
      const accept=box.querySelector('.accept'); accept.disabled=!draft.selected.size || fileReviewApplying;
      accept.textContent='采纳所选（'+draft.selected.size+'）';
      const selected = [...draft.selected].map(index=>({index,content:draft.replacements.get(index)}));
      box.querySelector('.fileReviewMerged pre').textContent = selected.length ? NovelReview.apply(proposal.oldContent || '',proposal.newContent || '',selected).content : proposal.oldContent || '（空）';
      host.querySelectorAll('.fileReviewHunk').forEach(row=>{ const index=Number(row.dataset.index); row.classList.toggle('unselected',!draft.selected.has(index)); row.querySelector('input').checked=draft.selected.has(index); });
    };
    review.hunks.forEach((h,i)=>{
      const row=document.createElement('section'); row.className='fileReviewHunk'; row.dataset.index=i;
      row.innerHTML='<div class="fileReviewHunkHead"><label><input type="checkbox">采纳第 '+(i+1)+' 段</label><span>原文第 '+(baseLine+h.oldStart)+' 行'+(h.removed.length>1?'–'+(baseLine+h.oldEnd-1)+' 行':'')+'</span><button class="editSuggestion">编辑建议</button><button class="locateHunk">定位</button></div><div class="fileReviewChanges"><section><div class="fileReviewLabel">原文</div><pre class="removed"></pre></section><section><div class="fileReviewLabel">建议</div><pre class="added"></pre></section></div><label class="fileReviewEdit" hidden>采纳此段时写入的内容<textarea spellcheck="false" aria-label="编辑第 '+(i+1)+' 段建议"></textarea><small>直接编辑替换文本；删除段保留空文本，插入或替换段请保留需要的换行。</small></label>';
      row.querySelector('.removed').textContent=h.removed.join('') || '（此处插入）';
      row.querySelector('.added').textContent=draft.replacements.get(i) ?? (h.added.join('') || '（删除此段）');
      const ta=row.querySelector('textarea'); ta.value=draft.replacements.get(i) ?? h.added.join('');
      const editor=row.querySelector('.fileReviewEdit'); editor.hidden=!draft.replacements.has(i);
      row.querySelector('input').onchange=e=>{ if(e.target.checked)draft.selected.add(i);else draft.selected.delete(i);updateSelection(); };
      ta.oninput=()=>{ const eol=(h.added.join('') || h.removed.join('')).includes('\r\n')?'\r\n':'\n'; draft.replacements.set(i,ta.value.replace(/\n/g,eol)); row.querySelector('.added').textContent=ta.value || '（删除此段）'; updateSelection(); };
      row.querySelector('.editSuggestion').onclick=()=>{ editor.hidden=!editor.hidden; if(!editor.hidden)ta.focus(); };
      row.querySelector('.locateHunk').onclick=()=>{ document.getElementById('fileEditorBody').classList.remove('reviewing-proposal'); jumpTextareaToLine(document.getElementById('fileContent'),baseLine+h.oldStart); };
      host.appendChild(row);
    });
    box.querySelector('.selectAll').onclick=()=>{review.hunks.forEach((_,i)=>draft.selected.add(i));updateSelection();};
    box.querySelector('.selectNone').onclick=()=>{draft.selected.clear();updateSelection();};
    updateSelection();
  }
  box.querySelector('.accept').addEventListener('click', () => acceptFileProposal(proposal.id));
  box.querySelector('.locateOriginal').onclick = () => {
    document.getElementById('fileEditorBody').classList.remove('reviewing-proposal');
    jumpTextareaToLine(document.getElementById('fileContent'), baseLine + change.line - 1);
  };
  box.querySelector('.return').onclick = () => document.getElementById('fileEditorBody').classList.remove('reviewing-proposal');
  box.querySelector('.adjust').onclick = () => {
    addSelectionToChat(proposal.file, (proposal.title || proposal.file) + '（待审阅方案）', proposal.newContent || proposal.oldContent, '', '提案', true);
    document.getElementById('chatAllowProposals').checked = true;
    document.getElementById('chatMode').value = 'agent';
    chatInput.value = '请继续调整「' + (proposal.title || proposal.file) + '」的修改方案：\n';
    chatInput.focus();
    if (typeof writingTaskChanged === 'function') writingTaskChanged();
  };
  box.querySelector('.reject').addEventListener('click', async () => {
    try {
      const d = await fetch('/api/proposals/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: proposal.id })
      }).then(r => r.json());
      if (d.error) throw new Error(d.error);
      if (typeof markChatProposal === 'function') markChatProposal(proposal.id, 'rejected');
      removeFileReviewDraft((proposal.root || currentProject)+':'+proposal.id);
      await dismissFileProposal(proposal);
    } catch (e) { showToast('拒绝失败：' + e.message, 'error'); }
  });
}

async function acceptFileProposal(id) {
  const p = currentFileProposal;
  if (!p || p.id !== id) return;
  if (fileReviewApplying) return;
  const project = currentProject;
  const draftKey=(p.root || project)+':'+id;
  const draft = fileReviewDrafts.get(draftKey);
  const selectedHunks = ['edit','file_edit'].includes(p.kind) && draft ? [...draft.selected].map(index=>({index,content:draft.replacements.get(index)})) : undefined;
  if (selectedHunks && !selectedHunks.length) { showToast('请至少选择一段改动','info'); return; }
  const opened = openFiles.find(f => f.path === p.file);
  const reviewBuffer = opened?.content;
  if (opened && opened.dirty) {
    showToast('文件有未保存修改，请先保存或处理草稿，再接受提案', 'error');
    return;
  }
  fileReviewApplying = true;
  const reviewBox = document.getElementById('fileProposalBox');
  reviewBox?.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);
  try {
    const res = await fetch('/api/apply_proposal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, project, selectedHunks })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    removeFileReviewDraft(draftKey);
    if (project !== currentProject) return;
    if (typeof markChatProposal === 'function') markChatProposal(id, 'applied', data.application);
    const f = openFiles.find(x => x.path === p.file);
    if (f) {
      const readRes = await fetch('/api/file?project=' + encodeURIComponent(project) + '&path=' + encodeURIComponent(p.file));
      const rd = await readRes.json();
      if (!rd.error) {
        if (f.content === reviewBuffer) f.content = rd.content;
        f.savedContent = rd.content;
        f.dirty = f.content !== rd.content;
        f.pendingCreate = false;
      }
    }
    const reviewingSame = currentFileProposal?.id === id;
    if (reviewingSame) {
      const box = document.getElementById('fileProposalBox');
      if (box) box.innerHTML = '';
      currentFileProposal = null;
    }
    renderFileTabs();
    if (reviewingSame && activeFilePath === p.file) renderFileEditor();
    plotDevices = []; // 写盘成功后，下次打开剧情页重新读取已采纳记录
    await refreshProjectMonitor().catch(() => {});
    if (fileMode) await loadFileTree();
    showToast(selectedHunks ? '已采纳 '+selectedHunks.length+' 段并写回文件' : '已接受修改并写回文件', 'success');
  } catch (e) {
    showToast('接受失败：' + e.message, 'error');
  } finally {
    fileReviewApplying = false;
    if (project === currentProject && currentFileProposal?.id === id) renderFileProposal(currentFileProposal);
  }
}

async function loadFileUndoAction(f) {
  const project=currentProject, button=document.getElementById('fileUndoProposalBtn');
  if(!button || f.pendingCreate) return;
  try {
    const data=await fetch('/api/proposals/applied?project='+encodeURIComponent(project)).then(r=>r.json());
    if(project!==currentProject || button!==document.getElementById('fileUndoProposalBtn') || activeFilePath!==f.path) return;
    const entry=data.applications?.find(a=>filePathKey(a.file)===filePathKey(f.path) && a.state==='applied');
    button.hidden=!entry;
    if(entry) button.onclick=()=>undoFileApplication(entry.id,f.path);
  } catch(_) {}
}
const undoingApplications=new Set();
async function undoFileApplication(id,file) {
  const project=currentProject;
  if(undoingApplications.has(id)) return;
  const opened=openFiles.find(f=>f.path===file);
  if(opened?.dirty) {showToast('请先保存或处理未保存草稿，再撤销采纳','info');return;}
  if(!await confirmDialog('撤销对「'+file+'」的这次采纳？将恢复采纳前的内容；采纳后有其他修改时会停止撤销。')) return;
  if(project!==currentProject || openFiles.some(f=>f.path===file&&f.dirty)) return;
  undoingApplications.add(id);
  const before=opened?.content;
  try {
    const data=await fetch('/api/proposals/undo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project,id})}).then(r=>r.json());
    if(data.error) throw new Error(data.error);
    // 即使等待期间切换小说，也更新原任务的持久记录。
    markChatProposal(data.proposalId,'undone');
    if(project!==currentProject) return;
    const f=openFiles.find(f=>f.path===file);
    if(f) {
      if(data.removed) {
        if(f.content===before) {openFiles=openFiles.filter(x=>x!==f);if(activeFilePath===file)activeFilePath=openFiles[0]?.path || null;}
        else {f.pendingCreate=true;f.savedContent='';f.dirty=true;}
      } else {
        const rd=await fetch('/api/file?project='+encodeURIComponent(project)+'&path='+encodeURIComponent(file)).then(r=>r.json());
        if(rd.error) throw new Error(rd.error);
        if(project!==currentProject) return;
        if(f.content===before) f.content=rd.content;
        f.savedContent=rd.content;f.dirty=f.content!==rd.content;
      }
    }
    if(currentFileProposal?.file===file) {currentFileProposal=null;document.getElementById('fileProposalBox')?.replaceChildren();}
    plotDevices=[];renderFileTabs();renderFileEditor();await refreshProjectMonitor();if(fileMode)await loadFileTree();
    showToast('已撤销本次采纳。若已同步画布，可重新预览时间线以核对节点。','success');
  } catch(e) {showToast('撤销失败：'+e.message,'error');}
  finally {undoingApplications.delete(id);}
}

let timelineSyncPreview=null, timelineSyncOpener=null, timelineSyncRequest=0, timelineSyncBusy=false;
const timelineSyncModal=document.createElement('div'); timelineSyncModal.id='timelineSyncModal';timelineSyncModal.className='modal-mask';
timelineSyncModal.innerHTML='<div class="modal timelineSyncCard" role="dialog" aria-modal="true" aria-labelledby="timelineSyncTitle"><div class="modalHead"><div class="modalTitleMain" id="timelineSyncTitle">同步到画布时间线</div><button class="modalClose" aria-label="关闭时间线同步">✕</button></div><p class="timelineSyncSource"></p><p class="timelineSyncHint">读取已保存的 Markdown。请核对事件、章号和来源；删除默认不勾选。没有事件 ID 的记录按章节与顺序匹配。</p><div class="timelineSyncRows"></div><div class="timelineSyncActions"><button class="syncRefresh">重新预览</button><button class="syncApply primary" disabled>同步所选</button></div></div>';
document.body.appendChild(timelineSyncModal);
function closeTimelineSync() {if(timelineSyncBusy)return;timelineSyncRequest++;timelineSyncModal.classList.remove('show');timelineSyncOpener?.focus();}
timelineSyncModal.querySelector('.modalClose').onclick=closeTimelineSync;
timelineSyncModal.onclick=e=>{if(e.target===timelineSyncModal)closeTimelineSync();};
timelineSyncModal.addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeTimelineSync();}
  if(e.key==='Tab'){const items=[...timelineSyncModal.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(el=>el.getClientRects().length);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
});
async function openTimelineSync(file,chapter) {
  if(timelineSyncBusy) return;
  if(openFiles.some(f=>f.path===file && f.dirty)) {showToast('请先保存时间线记录，再预览同步','info');return;}
  const project=currentProject, seq=++timelineSyncRequest;
  if(!timelineSyncModal.classList.contains('show')) timelineSyncOpener=document.activeElement;
  timelineSyncPreview={project,file,chapter};timelineSyncModal.classList.add('show');
  timelineSyncModal.querySelector('.timelineSyncSource').textContent=file+(chapter?' · 第'+chapter+'章':'');
  const host=timelineSyncModal.querySelector('.timelineSyncRows'), apply=timelineSyncModal.querySelector('.syncApply');
  host.textContent='正在读取事件…';apply.disabled=true;timelineSyncModal.querySelector('.modalClose').focus();
  try {
    // 仅冲刷作者已安排的布局保存；打开预览本身不写画布。
    if(layoutTimer!=null) await postLayout(); else await layoutSavePromise;
    if(project!==currentProject || seq!==timelineSyncRequest) return;
    const data=await fetch('/api/timeline/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project,path:file,chapter})}).then(r=>r.json());
    if(project!==currentProject || seq!==timelineSyncRequest) return;
    if(data.error) throw new Error(data.error);
    timelineSyncPreview={project,file,chapter,...data,pinSnapshot:JSON.stringify(timelineNodes)};host.replaceChildren();
    if(!data.operations.length) host.textContent=data.events ? '画布与记录已一致，没有需要同步的改动。' : '没有找到带明确章号的事件。请使用“## 第N章”加事件列表，或“章节／事件／时间”表格。';
    data.operations.forEach((op,i)=>{
      const row=document.createElement('label');row.className='timelineSyncRow';
      const input=document.createElement('input');input.type='checkbox';input.value=i;input.checked=op.action!=='delete';
      const text=document.createElement('span'), title=document.createElement('strong'), note=document.createElement('small');
      const event=op.next || op.before;title.textContent=({add:'新增',update:'更新',delete:'删除'}[op.action])+' · 第'+event.chapter+'章 · '+event.title;
      note.textContent='来源：'+file+' 第'+event.sourceLine+'行'+(op.action==='update'?' · 原记录：'+op.before.title+' / '+op.before.note:'')+(event.note?' · '+event.note:'');
      text.append(title,note);row.append(input,text);host.appendChild(row);
      input.onchange=()=>{apply.disabled=!host.querySelector('input:checked');};
    });
    apply.disabled=!host.querySelector('input:checked');
  } catch(e) {if(seq===timelineSyncRequest)host.textContent='预览失败：'+e.message;}
}
timelineSyncModal.querySelector('.syncRefresh').onclick=()=>{const p=timelineSyncPreview;if(p)openTimelineSync(p.file,p.chapter);};
timelineSyncModal.querySelector('.syncApply').onclick=async()=>{
  const p=timelineSyncPreview;if(!p?.token || p.project!==currentProject || timelineSyncBusy)return;
  const selected=[...timelineSyncModal.querySelectorAll('.timelineSyncRows input:checked')].map(el=>Number(el.value));
  if(!selected.length)return;
  timelineSyncBusy=true;timelineSyncModal.querySelectorAll('button,input').forEach(el=>el.disabled=true);
  try {
    if(p.pinSnapshot!==JSON.stringify(timelineNodes))throw new Error('画布时间线已变化');
    clearTimeout(layoutTimer);await layoutSavePromise;
    if(p.project!==currentProject)return;
    const data=await fetch('/api/timeline/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:p.project,path:p.file,chapter:p.chapter,token:p.token,selected})}).then(r=>r.json());
    if(data.error)throw new Error(data.error);
    if(p.project!==currentProject)return;
    timelineNodes=data.events;renderAxisView();applyAxisTransform();renderTimelineList();saveLayout();
    timelineSyncBusy=false;closeTimelineSync();showToast('已同步 '+data.changed+' 项时间线改动','success');
  } catch(e) {showToast('同步失败：'+e.message+'；请重新预览','error');}
  finally {timelineSyncBusy=false;timelineSyncModal.querySelectorAll('button,input').forEach(el=>el.disabled=false);if(timelineSyncModal.classList.contains('show'))timelineSyncModal.querySelector('.syncApply').disabled=true;}
};

initFileEditor();
