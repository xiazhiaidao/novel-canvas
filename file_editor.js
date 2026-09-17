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
let dragTabPath = null;
let autosaveTimer = null;
const FILE_AUTOSAVE_DELAY = 3000; // 停止输入 3 秒后自动保存

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
  document.getElementById('activityCanvas').classList.toggle('on', !fileMode);
  document.getElementById('activityFiles').classList.toggle('on', fileMode);
  document.getElementById('sidebarTitle').textContent = fileMode ? '文件' : '画布';
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
  const canvasTab = document.getElementById('canvasTab');
  const canvasWrap = document.getElementById('canvasWrap');
  const fileEditor = document.getElementById('fileEditor');
  canvasTab.classList.toggle('on', kind === 'canvas');
  canvasWrap.classList.toggle('hidden', kind !== 'canvas');
  fileEditor.classList.toggle('active', kind === 'file');
  if (kind === 'file') {
    collapseDetailForFileEditor();
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
  if (!activeFilePath) {
    body.innerHTML = '<div class="fileEditorEmpty">从左侧文件树选择 .md 文件<br>可多标签编辑，支持 AI 改写 / 续写</div>';
    return;
  }
  const f = openFiles.find(x => x.path === activeFilePath);
  if (!f) return;
  body.innerHTML =
    '<div class="fileToolbar">' +
      '<span class="filePath" title="' + escapeHtml(f.path) + '">' + escapeHtml(f.path) + '</span>' +
      '<div class="fileActions">' +
        '<button id="filePreviewBtn">预览</button>' +
        '<button id="fileSelChatBtn" class="fileChatBtn" title="选中文字加入对话；未选中则加入整个文件">选中加入对话</button>' +
        '<button id="fileEditAiBtn" title="AI 续写 / AI 改写">AI 修改</button>' +
        '<button id="fileSaveBtn">保存</button>' +
        '<button id="fileDeleteBtn" class="danger">删除</button>' +
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
    '<div id="fileProposalBox"></div>';
  const ta = document.getElementById('fileContent');
  ta.addEventListener('input', () => {
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
  initFileFindReplace(ta, f);
  document.getElementById('filePreviewBtn').addEventListener('click', toggleFilePreview);
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
  if (!f) return;
  if (!openFiles.includes(f)) return; // 已关闭/已丢弃的文件不写盘
  const st = document.getElementById('fileStatus');
  if (st && f.path === activeFilePath) st.textContent = '保存中...';
  try {
    const res = await fetch('/api/file/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: currentProject, path: f.path, content: f.content })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    f.savedContent = f.content;
    f.dirty = false;
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
    if (st && f.path === activeFilePath) st.textContent = '已保存';
    renderFileTabs();
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

function createFile(dirPath) {
  const prefix = dirPath ? String(dirPath).replace(/\/+$/, '') + '/' : '';
  const name = prompt('新建 Markdown 文件（相对项目根目录，可含子目录）：', prefix + '新文件.md');
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

function renameFile(path) {
  const newPath = prompt('新路径（相对项目根目录，以 .md 结尾）：', path);
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
  const instruction = prompt(mode === 'continue' ? 'AI 续写要求（可空）：' : 'AI 改写要求：');
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

function renderFileProposal(proposal) {
  const box = document.getElementById('fileProposalBox');
  if (!box || !proposal) return;
  currentFileProposal = proposal;
  box.innerHTML =
    '<div class="fileDiffBox">' +
      '<h4>AI 修改「' + escapeHtml(proposal.title || proposal.file) + '」</h4>' +
      '<div class="fileDiffCols">' +
        '<div><div class="fileDiffLabel old">旧内容</div><pre class="old">' + escapeHtml(proposal.oldContent || '（空）') + '</pre></div>' +
        '<div><div class="fileDiffLabel new">新内容</div><pre class="new">' + escapeHtml(proposal.newContent || '（空）') + '</pre></div>' +
      '</div>' +
      '<div class="fileDiffActions">' +
        '<button class="accept">接受</button>' +
        '<button class="reject">拒绝</button>' +
      '</div>' +
    '</div>';
  box.querySelector('.accept').addEventListener('click', () => acceptFileProposal(proposal.id));
  box.querySelector('.reject').addEventListener('click', async () => {
    try {
      await fetch('/api/proposals/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: proposal.id })
      });
    } catch (e) { /* 忽略网络错误，仍关闭面板 */ }
    currentFileProposal = null;
    box.innerHTML = '';
  });
}

async function acceptFileProposal(id) {
  const p = currentFileProposal;
  if (!p || p.id !== id) return;
  try {
    const res = await fetch('/api/apply_proposal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, project: currentProject })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const f = openFiles.find(x => x.path === p.file);
    if (f) {
      const readRes = await fetch('/api/file?project=' + encodeURIComponent(currentProject) + '&path=' + encodeURIComponent(p.file));
      const rd = await readRes.json();
      if (!rd.error) {
        f.content = rd.content;
        f.savedContent = rd.content;
        f.dirty = false;
      }
    }
    const box = document.getElementById('fileProposalBox');
    if (box) box.innerHTML = '';
    currentFileProposal = null;
    renderFileTabs();
    renderFileEditor();
    await loadData().catch(() => {});
    const chapterNode = Object.values(nodeMap).find(n => isChapterNode(n) && n.file === p.file);
    if (chapterNode) runAdvance(chapterNode.id);
    showToast('已接受修改并写回文件', 'success');
  } catch (e) {
    showToast('接受失败：' + e.message, 'error');
  }
}

initFileEditor();
