let chatJustSwitched = false;
let selectedNewNodeType = 'role';
function openNewNodeModal(type) {
  selectedNewNodeType = type || 'role';
  var t = document.getElementById('newNodeType');
  if (t) t.value = selectedNewNodeType;
  document.getElementById('newNodeModal').classList.add('show');
}
// novel canvas upgrade helper
function fitView() {
  const ids = nodes.map(n => n.id);
  if (!ids.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of ids) {
    const p = positions[id] || { x: 0, y: 0 };
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  const rect = canvasWrap.getBoundingClientRect();
  const w = (maxX - minX + 240) || 600;
  const h = (maxY - minY + 200) || 400;
  const scale = Math.min(1.5, Math.max(0.2, Math.min(rect.width / w, rect.height / h)));
  view.scale = scale;
  view.x = rect.width / 2 - (minX + (maxX - minX) / 2) * scale;
  view.y = rect.height / 2 - (minY + (maxY - minY) / 2) * scale;
  updateView();
}function toggleLegend() {
  var lg = document.getElementById('legend');
  lg.classList.toggle('show');
}
function toggleAutoLink() {
  autoLinkEnabled = !autoLinkEnabled;
  redrawEdges();
}
function searchNav(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) highlightMatch(currentMatch - 1);
    else highlightMatch(currentMatch + 1);
  }
  if (e.key === 'Escape') { search.value = ''; search.blur(); applyFilters(); }
}
function drawMinimap() {
  var c = document.getElementById('mapCanvas');
  if (!c) return;
  var ctx = c.getContext('2d');
  c.width = 380; c.height = 300;
  ctx.fillStyle = '#f4f6fb'; ctx.fillRect(0,0,380,300);
var ids=nodes.map(function(n){return n.id;});
  var isHidden=function(id){var el=document.querySelector('.node[data-id="'+id+'"]');return el && el.closest('.nodeBoard.collapsed');};
  var minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  ids.forEach(function(id){if(isHidden(id))return;var p=positions[id]||{x:0,y:0};if(p.x<minX)minX=p.x;if(p.y<minY)minY=p.y;if(p.x>maxX)maxX=p.x;if(p.y>maxY)maxY=p.y;});
  if(minX===1e9){minX=0;minY=0;maxX=600;maxY=400;}
  
  var pad=30,w=maxX-minX+pad*2,h=maxY-minY+pad*2;
  var s=Math.min(360/w,280/h);
  var ox=10-minX*s, oy=10-minY*s;
  var color={role:'#7c5cff',faction:'#2f9e8f',setting:'#d97706',foreshadow:'#dc2626',volume:'#2563eb'};
  ids.forEach(function(id){if(isHidden(id))return;var n=nodeMap[id];if(!n)return;
    var p=positions[id],x=ox+p.x*s,y=oy+p.y*s;
    ctx.fillStyle=color[n.type]||'#667085';ctx.beginPath();ctx.arc(x,y,4,0,6.283);ctx.fill();});
  ctx.strokeStyle='#b45309';ctx.lineWidth=1.5;
  if(view.scale){var r=canvasWrap.getBoundingClientRect();
    var vx=ox+(-view.x/view.scale)*s,vy=oy+(-view.y/view.scale)*s;
    ctx.strokeRect(vx,vy,(r.width/view.scale)*s,(r.height/view.scale)*s);}
  c.onclick=function(ev){var r=c.getBoundingClientRect();
    var mx=(ev.clientX-r.left)*(c.width/r.width), my=(ev.clientY-r.top)*(c.height/r.height);
    var wx=(mx-ox)/s, wy=(my-oy)/s;
    var scale = view.scale || 1;
    view.x = -wx*scale + canvasWrap.getBoundingClientRect().width/2;
    view.y = -wy*scale + canvasWrap.getBoundingClientRect().height/2;updateView();};
}
function createNode(type,label){openNewNodeModal(type);}
function closeModal(){(document.getElementById('newNodeModal')||{}).classList?document.getElementById('newNodeModal').classList.remove('show'):null;}
document.getElementById('newNodeCancel').addEventListener('click',closeModal);
document.getElementById('newNodeOk').addEventListener('click',async function(){
  var type=document.getElementById('newNodeType').value;
  var titles=document.getElementById('newNodeTitle').value.split(String.fromCharCode(10)).map(function(s){return s.trim();}).filter(Boolean);
  var desc=document.getElementById('newNodeDesc').value.trim();
  for(var i=0;i<titles.length;i++){
    await fetch('/api/node',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({type:type,title:titles[i],desc:desc,project:currentProject})});}
  closeModal();await loadData();});
document.getElementById('newNodeType').addEventListener('change',function(){selectedNewNodeType=this.value;});
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal();});
document.getElementById('newNodeModal').addEventListener('click',function(e){if(e.target===this)closeModal();});

function chatStorageKey() { return "novelChatHistory_" + encodeURIComponent(currentProject || "default"); }
function roleStorageKey() { return "novelChatRole_" + encodeURIComponent(currentProject || "default"); }
function currentRole() {
  try { var r = localStorage.getItem(roleStorageKey()); return r && r !== 'general' ? r : 'general'; } catch (e) { return 'general'; }
}
function setCurrentRole(role) {
  try { localStorage.setItem(roleStorageKey(), role || 'general'); } catch (e) {}
}
function syncRoleBar(role) {
  var bar = document.getElementById('roleBar');
  if (!bar) return;
  var target = role || currentRole();
  Array.prototype.forEach.call(bar.querySelectorAll('.roleChip'), function (chip) {
    chip.classList.toggle('active', chip.dataset.role === target);
  });
}
function loadChatHistory(showHint) {
  var key = chatStorageKey();
  try { var saved = JSON.parse(localStorage.getItem(key) || "[]"); chatHistory = Array.isArray(saved) ? saved.slice(-20) : []; } catch(e) { chatHistory = []; }
  chatMessages.innerHTML = "";
  if (chatHistory.length) { for (var i=0;i<chatHistory.length;i++) addMsg(chatHistory[i].role, chatHistory[i].content); }
  else if (showHint) { addMsg("ref", "已切换到《" + currentProject + "》，聊天上下文已按项目隔离"); addMsg("assistant", "你好，我可以结合画布上的角色/设定/伏笔帮你聊剧情。"); }
  else { addMsg("assistant", "你好，我可以结合画布上的角色/设定/伏笔帮你聊剧情。"); }
  syncRoleBar();
}
function addRefToChat(n, selectedText) {
  if (!n) return;
  var sel = (selectedText || "").trim();
  if (sel) {
    addSelectionToChat(n.file, n.title, sel, '', n.label || '节点');
  } else {
    addSelectionToChat(n.file, n.title, n.content || n.desc || '', '', n.label || '节点', true);
  }
}
function chatPayloadMessages() {
  return chatHistory.slice(-20).map(function(m) {
    if (m.role === "ref") { return { role: "user", content: "（我引用了画布节点）" + m.content }; }
    return { role: m.role, content: m.content };
  });
}

// ── 选中文字 → 对话引用（Trae 风格：引用标签，不粘贴进输入框） ──
function expandChatPanel() {
  var msgs = document.getElementById("chatMessages");
  var row = document.getElementById("chatInputRow");
  var btn = document.getElementById("chatToggle");
  if (msgs && msgs.style.display === "none") {
    msgs.style.display = "flex"; if (row) row.style.display = "flex";
    if (typeof syncChatPanel === "function") syncChatPanel();
    if (btn) btn.textContent = "—";
    var sb = document.getElementById("skillBar"); if (sb && sb.children.length) sb.style.display = "flex";
    var ab = document.getElementById("agentBar"); if (ab && ab.children.length) ab.style.display = "flex";
    var rb = document.getElementById("roleBar"); if (rb) rb.style.display = "flex";
    var ac = document.getElementById("activityChat"); if (ac) ac.classList.add("on");
  }
  var bar = document.getElementById("refBar");
  if (bar) bar.style.display = pendingRefs && pendingRefs.length ? "flex" : "none";
}
function renderRefBar() {
  var bar = document.getElementById("refBar");
  if (!bar) return;
  bar.innerHTML = "";
  (pendingRefs || []).forEach(function (r, i) {
    var chip = document.createElement("span");
    chip.className = "refChip";
    var lab = document.createElement("span");
    lab.className = "refChipLabel";
    lab.textContent = r.label;
    lab.title = (r.content || "").slice(0, 300);
    var x = document.createElement("button");
    x.className = "refChipX";
    x.textContent = "×";
    x.title = "移除引用";
    x.addEventListener("click", function () { removePendingRef(i); });
    chip.appendChild(lab);
    chip.appendChild(x);
    bar.appendChild(chip);
  });
  bar.style.display = (pendingRefs && pendingRefs.length) ? "flex" : "none";
}
function removePendingRef(idx) {
  if (!Array.isArray(pendingRefs)) pendingRefs = [];
  pendingRefs.splice(idx, 1);
  renderRefBar();
}
function clearPendingRefs() {
  pendingRefs = [];
  renderRefBar();
}
function addSelectionToChat(file, title, content, lineRange, label, whole) {
  var c = String(content || "").trim();
  if (!c) return;
  if (!Array.isArray(pendingRefs)) pendingRefs = [];
  var kind = label || "引用";
  var name = (title || file || "").trim();
  var isFile = kind === "文件";
  var short = isFile ? String(name).split('/').pop() : name;
  var chipLabel = (isFile ? "📄 " + (short || "文件") : (kind + " · " + (short || kind))) + (lineRange ? " · 行" + lineRange : "");
  var head = whole ? "引用" : "选中片段";
  var chatContent = "【" + kind + "】" + (name || "") + " " + head + "：\n" + c.slice(0, 2000);
  pendingRefs.push({ file: file, title: title, content: c.slice(0, 2000), label: chipLabel, chatContent: chatContent });
  renderRefBar();
  expandChatPanel();
}
function computeLineRange(fullText, start, end) {
  if (!fullText || start == null || end == null) return "";
  var s = Math.max(0, start), e = Math.min(fullText.length, end);
  var a = fullText.slice(0, s).split("\n").length;
  var b = fullText.slice(0, e).split("\n").length;
  return a === b ? String(a) : a + "-" + b;
}

// ── 浮动选中工具条 ──
var selCtxRegistry = new WeakMap();
function showSelToolbar(x, y, ctx) {
  var tb = document.getElementById("selToolbar");
  if (!tb) return;
  selToolbarCtx = ctx;
  var w = tb.offsetWidth || 170;
  var h = tb.offsetHeight || 36;
  tb.style.left = Math.max(8, Math.min(x + 6, window.innerWidth - w - 8)) + "px";
  tb.style.top = Math.max(8, y - h - 12) + "px";
  tb.style.display = "flex";
}
function hideSelToolbar() {
  var tb = document.getElementById("selToolbar");
  if (tb) tb.style.display = "none";
  selToolbarCtx = null;
}
function hookSelToolbar(el, isTextarea, makeCtx) {
  if (!el) return;
  selCtxRegistry.set(el, makeCtx);
  function onSel(e) {
    var selText = "", start = 0, end = 0, full = "";
    if (isTextarea) {
      start = el.selectionStart || 0; end = el.selectionEnd || 0;
      full = el.value || "";
      selText = full.slice(start, end);
    } else {
      var s = window.getSelection();
      selText = s ? s.toString() : "";
    }
    if (!selText || !selText.trim()) return;
    var ctx = makeCtx(selText, start, end, full);
    var x = e.clientX, y = e.clientY;
    if ((!x && !y) || e.type === "select") {
      var r = el.getBoundingClientRect();
      x = r.left + 60; y = r.top + 10;
    }
    showSelToolbar(x, y, ctx);
  }
  el.addEventListener("mouseup", onSel);
  el.addEventListener("keyup", onSel);
  if (isTextarea) el.addEventListener("select", onSel);
}
(function wireSelToolbar() {
  var chatBtn = document.getElementById("selToolbarChat");
  if (chatBtn) chatBtn.addEventListener("click", function () {
    if (selToolbarCtx && selToolbarCtx.add) { try { selToolbarCtx.add(); } catch (_e) {} }
    hideSelToolbar();
  });
  var editBtn = document.getElementById("selToolbarEdit");
  if (editBtn) editBtn.addEventListener("click", function () {
    if (selToolbarCtx && selToolbarCtx.edit) { try { selToolbarCtx.edit(); } catch (_e) {} }
    hideSelToolbar();
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest("#selToolbar")) hideSelToolbar();
  });
  document.addEventListener("scroll", hideSelToolbar, true);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") hideSelToolbar();
    if ((e.ctrlKey || e.metaKey) && (e.key === "u" || e.key === "U")) {
      var t = document.activeElement;
      if (t && t.tagName === "TEXTAREA" && t.selectionStart !== t.selectionEnd) {
        var mk = selCtxRegistry.get(t);
        if (mk) {
          e.preventDefault();
          var full = t.value || "";
          var st = t.selectionStart, en = t.selectionEnd;
          var c = full.slice(st, en);
          if (c && c.trim()) { try { mk(c, st, en, full).add(); } catch (_e) {} }
        }
      }
    }
  });
})();
function parseForeshadowStatus(n) {
  var cells = String(n.content || "").split("|").map(function(s){ return s.trim(); }).filter(Boolean);
  if (cells.length >= 5) { var st = cells[4]; if (st) return st; }
  return "";
}
async function createChapter() {
  const title = prompt('新章节标题（如：新的开始）');
  if (!title || !title.trim()) return;
  const res = await fetch('/api/chapter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: currentProject, title: title.trim() }) });
  const data = await res.json();
  if (data.error) return alert(data.error);
  await loadData();
  if (data.node && data.node.id) focusNode(data.node.id);
}
async function renameChapter(n) {
  const title = prompt('章节新标题：', n.title);
  if (!title || !title.trim() || title.trim() === n.title) return;
  const res = await fetch('/api/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: n.id, project: currentProject, title: title.trim() }) });
  const data = await res.json();
  if (data.error) return alert(data.error);
  await loadData();
  if (data.node && data.node.id) focusNode(data.node.id);
}
