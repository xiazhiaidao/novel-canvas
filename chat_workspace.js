// AI 写作面板：任务与本次资料在发送前确定，文件修改仍走既有提案审阅。
let writingBusy = false, writingPreparing = null;
let sourcePreviewSeq = 0, sourcePreviewTimer = null, sourceProject = '';
let chatExcludedIds = new Set(), chatSourcePacket = null;
let detailHiddenByChat = false;
const writingDrafts = new Map();
const writingTaskStores = new Map(), writingProposalCache = new Map();
const writingChangesPanel = document.getElementById('chatChanges');
let activeWritingTask = null, writingTaskProject = '', writingTaskSaveTimer = null;
const writingStateLabels = { idle:'未开始', running:'执行中', completed:'已完成', review:'待审阅', stopped:'已停止', failed:'执行失败', interrupted:'已中断', limited:'待继续' };
const writingStages = {
  general: { heading:'想推进哪一段故事？', hint:'讨论冲突、节奏或下一步剧情', examples:[['检查设定与动机','检查当前章节的设定与人物动机'],['加强本章冲突','加强这一章的冲突，保留原有人物动机'],['查找未回收伏笔','查找尚未回收的伏笔，给出后续安排']] },
  character: { heading:'先把人物想清楚', hint:'描述人物的目标、动机或关系', examples:[['梳理目标与阻力','梳理当前人物的目标、动机与阻力，指出需要补足的地方'],['检查人物关系','检查已有角色关系，找出能推动剧情的矛盾'],['设计人物转变','根据已有情节设计人物转变，保留现有设定']] },
  outline: { heading:'把故事推进到下一步', hint:'描述想规划的故事段落', examples:[['规划接下来三章','根据已有剧情规划接下来三章的冲突、转折与章末悬念'],['安排伏笔回收','整理未回收伏笔，安排合适的回收节点'],['检查节奏','检查大纲节奏，指出重复情节与缺少转折的段落']] },
  writer: { heading:'准备写哪一个场景？', hint:'说明目标章节、场景及必须保留的信息', examples:[['续写当前章节','根据当前章节续写下一个场景，保持人物动机与叙事视角'],['扩写关键场景','扩写当前章节的关键场景，加强动作与人物互动'],['写出章末悬念','为当前章节设计并写出章末悬念，不引入与设定冲突的信息']] },
  polish: { heading:'让这一段更有力', hint:'说明要改的范围、节奏和文风', examples:[['精简重复表达','精简当前文本的重复表达，保留事件与信息'],['打磨人物对话','打磨当前章节的人物对话，让语气符合各自身份与动机'],['加强场景张力','润色当前场景，加强张力，保留原有情节与叙事视角']] },
  reviewer: { heading:'检查故事是否前后一致', hint:'说明要检查的设定、时间线或人物状态', examples:[['核对设定','核对当前章节与项目设定，逐条列出冲突及依据'],['检查时间线','检查已有章节的事件顺序与时间线，标明矛盾所在'],['核对人物状态','核对人物的位置、知识与持有物，找出前后不一致的地方']] }
};

function syncWritingStage() {
  const stage = writingStages[document.getElementById('chatTask').value] || writingStages.general;
  chatInput.placeholder = stage.hint + '…（Shift+Enter 换行）';
  const empty = chatMessages.querySelector('.agentWelcome');
  if (!empty) return;
  empty.querySelector('h3').textContent = stage.heading;
  const examples = empty.querySelector('.agentExamples'); examples.replaceChildren();
  for (const [label,prompt] of stage.examples) {
    const button = document.createElement('button'); button.textContent = label; button.title = prompt;
    button.onclick = () => { chatInput.value = prompt; chatInput.focus(); writingTaskChanged(); };
    examples.appendChild(button);
  }
}

function writingTasksKey(project) { return 'novelAgentTasks_' + encodeURIComponent(project); }
function writingStore(project = currentProject) { return writingTaskStores.get(project); }
function saveWritingTasks(project = currentProject) {
  const store = writingStore(project);
  if (!store) return;
  try { localStorage.setItem(writingTasksKey(project), JSON.stringify(store)); }
  catch (_) { showToast('任务记录保存失败：浏览器存储空间不足，请保留当前窗口并导出重要内容', 'error'); }
}
function captureWritingTask() {
  if (!activeWritingTask || writingTaskProject !== currentProject) return;
  activeWritingTask.draft = chatInput.value;
  activeWritingTask.refs = pendingRefs.map(r => ({ ...r }));
  activeWritingTask.target = document.getElementById('chatTarget').value;
  activeWritingTask.excluded = [...chatExcludedIds];
  activeWritingTask.mode = document.getElementById('chatAllowProposals').checked ? 'agent' : 'discuss';
  activeWritingTask.role = document.getElementById('chatTask').value;
  activeWritingTask.messages = chatHistory;
}
function writingTaskChanged() {
  captureWritingTask();
  clearTimeout(writingTaskSaveTimer);
  const project = currentProject;
  writingTaskSaveTimer = setTimeout(() => saveWritingTasks(project), 180);
}
function flushWritingTask() { clearTimeout(writingTaskSaveTimer); captureWritingTask(); saveWritingTasks(writingTaskProject); }
window.addEventListener('pagehide', flushWritingTask);
window.addEventListener('beforeunload', flushWritingTask);
function makeWritingTask(messages = []) {
  return { id:crypto.randomUUID(), title:messages.find(m => m.role === 'user')?.content.slice(0,32) || '新任务', created:Date.now(), updated:Date.now(), state:'idle', messages, turns:[], proposals:[], draft:'', refs:[], excluded:[], target:'', mode:'agent', role:'general' };
}
function loadWritingTasks() {
  const project = currentProject;
  if (!project) return;
  if (writingTaskProject === project && activeWritingTask) return;
  let store = writingStore(project);
  if (!store) {
    try { store = JSON.parse(localStorage.getItem(writingTasksKey(project)) || 'null'); } catch (_) {}
    if (!store || !Array.isArray(store.tasks)) {
      let messages = [];
      try { const old = JSON.parse(localStorage.getItem('novelChatHistory_' + encodeURIComponent(project)) || '[]'); if (Array.isArray(old)) messages = old.filter(m => m && ['user','assistant','ref'].includes(m.role) && typeof m.content === 'string'); } catch (_) {}
      const task = makeWritingTask(messages); if (messages.length) task.title = '历史对话';
      store = { activeId:task.id, tasks:[task] };
    }
    store.tasks = store.tasks.filter(t => t && typeof t.id === 'string' && Array.isArray(t.messages));
    for (const task of store.tasks) {
      task.turns = Array.isArray(task.turns) ? task.turns : []; task.proposals = Array.isArray(task.proposals) ? task.proposals : [];
      if (task.state === 'running') task.state = 'interrupted';
      for (const turn of task.turns) if (turn.status === 'running') { turn.status = 'interrupted'; for (const step of turn.steps || []) if (step.status === 'running') step.status = 'interrupted'; if (turn.partial) { task.messages.push({role:'assistant',content:turn.partial + '\n\n（执行已中断，可继续补充要求）'}); delete turn.partial; } }
    }
    if (!store.tasks.length) { const task = makeWritingTask(); store.tasks.push(task); store.activeId = task.id; }
    writingTaskStores.set(project, store);
  }
  writingTaskProject = project;
  activateWritingTask(store.activeId || store.tasks[0].id, true);
  reconcileWritingApplications(project);
}
async function reconcileWritingApplications(project) {
  try {
    const data=await fetch('/api/proposals/applied?project='+encodeURIComponent(project)).then(r=>r.json()), store=writingStore(project);
    if(!store || data.error) return;
    for(const task of store.tasks) for(const p of task.proposals) {
      const entry=data.applications.find(a=>a.proposalId===p.id && ['applied','undone'].includes(a.state));
      if(!entry) continue;
      p.applicationId=entry.id;p.partial=entry.partial;p.state=entry.state==='undone'?'undone':'applied';
    }
    saveWritingTasks(project);
    if(project===currentProject){renderWritingChanges();updateWritingTaskHeader();}
  } catch(_) {}
}
function activateWritingTask(id, loading = false) {
  if (writingBusy && !loading) { showToast('先停止当前执行，再切换任务', 'info'); return; }
  const store = writingStore(), task = store?.tasks.find(t => t.id === id) || store?.tasks[0];
  if (!task) return;
  if (!loading) { captureWritingTask(); saveWritingTasks(); }
  activeWritingTask = task; store.activeId = task.id;
  chatHistory = task.messages; pendingRefs = (task.refs || []).map(r => ({ ...r })); chatExcludedIds = new Set(task.excluded || []);
  chatInput.value = task.draft || ''; chatInput.style.height = '';
  document.getElementById('chatTask').value = task.role || 'general'; setCurrentRole(task.role || 'general');
  document.getElementById('chatAllowProposals').checked = task.mode !== 'discuss';
  document.getElementById('chatMode').value = task.mode === 'discuss' ? 'discuss' : 'agent';
  refreshChatTargets(task.target || '');
  document.getElementById('chatTarget').value = task.target || '';
  document.getElementById('chatTaskHistory').hidden = true;
  renderWritingTask(); if(task.wrapUp) writingChangesPanel.open=true; saveWritingTasks(); requestChatSourcePreview();
}
function newWritingTask() {
  if (!currentProject) { showToast('项目尚未加载，请稍候', 'info'); return; }
  if (writingBusy) { showToast('先停止当前执行，再新建任务', 'info'); return; }
  loadWritingTasks(); captureWritingTask();
  const task = makeWritingTask(); writingStore().tasks.unshift(task);
  activateWritingTask(task.id); expandChatPanel(); chatInput.focus();
}

let chapterWrapUpProject = '', chapterWrapUpOpener = null;
const wrapUpLabels={characters:'人物',foreshadows:'伏笔',summary:'摘要',timeline:'时间线'};
function wrapUpStale(task) {
  const n=nodes.find(n=>n.id===task.wrapUp?.nodeId || n.file===task.wrapUp?.file);
  return !n || task.wrapUp.sourceContent==null || chapterWrapUpSource(n).content!==task.wrapUp.sourceContent;
}
function wrapUpItemState(task,key) {
  const ps=task.proposals.filter(p=>(p.wrapUpChecks || []).includes(key));
  if(ps.some(p=>p.state==='pending')) return '待审阅';
  if(task.wrapUp.confirmed?.[key]) return '已核对';
  if(ps.length && ps.every(p=>p.state==='applied' && !p.partial)) return '已采纳';
  if(ps.some(p=>p.state==='applied')) return '部分采纳';
  return '待处理';
}
function writingTaskStateLabel(task) {
  if(!task?.wrapUp || task.state==='running') return writingStateLabels[task?.state] || '未开始';
  if(wrapUpStale(task)) return '正文变化 · 需重新核对';
  return task.wrapUp.checks.every(k=>['已采纳','已核对'].includes(wrapUpItemState(task,k))) ? '收尾完成' : '收尾待核对';
}
function renderWrapUpProgress(host,task) {
  if(!task?.wrapUp) return;
  const box=document.createElement('section'); box.className='wrapUpProgress';
  const title=document.createElement('strong'); title.textContent='本章收尾 · '+writingTaskStateLabel(task); box.appendChild(title);
  const stale=wrapUpStale(task);
  if(stale) {
    const hint=document.createElement('p'); hint.textContent='正文与本次收尾依据不同，以下记录属于旧版本。';
    const again=document.createElement('button'); again.textContent='重新收尾'; again.disabled=writingBusy; again.onclick=()=>openChapterWrapUp(task.wrapUp.nodeId); box.append(hint,again);
  }
  for(const key of task.wrapUp.checks) {
    const row=document.createElement('div'); row.className='wrapUpProgressRow';
    const label=document.createElement('span'); label.textContent=wrapUpLabels[key]+' · '+wrapUpItemState(task,key);
    const confirm=document.createElement('button'); confirm.textContent=task.wrapUp.confirmed?.[key]?'取消核对':'确认已核对';
    confirm.disabled=stale || writingBusy || task.proposals.some(p=>p.state==='pending' && p.wrapUpChecks?.includes(key));
    confirm.onclick=async()=>{
      if(task.wrapUp.confirmed?.[key]) delete task.wrapUp.confirmed[key];
      else {
        const note=await promptDialog('确认「'+wrapUpLabels[key]+'」已完成核对。请记录依据或无需修改的原因：',{value:''});
        if(!note?.trim() || task!==activeWritingTask || writingBusy || wrapUpStale(task)) return;
        (task.wrapUp.confirmed ||= {})[key]=note.trim();
      }
      saveWritingTasks(); renderWritingChanges(); updateWritingTaskHeader();
    };
    row.append(label,confirm); box.appendChild(row);
    if(task.wrapUp.confirmed?.[key]) { const note=document.createElement('small'); note.textContent=task.wrapUp.confirmed[key]; box.appendChild(note); }
  }
  host.appendChild(box);
}
function guessWrapUpChecks(p,task) {
  const labels=nodes.filter(n=>n.id===p.nodeId || filePathKey(n.file)===filePathKey(p.file)).map(n=>n.label);
  return task.wrapUp.checks.filter(k=>k==='characters'?labels.includes('角色'):k==='foreshadows'?labels.includes('伏笔'):k==='summary'?/摘要/.test(p.file):/时间线/.test(p.file));
}
function closeChapterWrapUp() {
  document.getElementById('chapterWrapUpModal').classList.remove('show');
  chapterWrapUpOpener?.focus();
}
function chapterWrapUpSource(n) {
  captureDetailDraft();
  const f = openFiles.find(f => f.path === n.file && !f.pendingCreate);
  const draft = detailDrafts.get(currentProject + ':' + n.id)?.content;
  // 仅当前正文缓冲区或此节点草稿优先，磁盘节点提供兜底。
  return { content:f?.dirty ? f.content : (draft ?? n.content ?? ''), dirty:!!f?.dirty || draft != null };
}
function openChapterWrapUp(id) {
  if (writingBusy) { showToast('先停止当前执行，再创建收尾任务', 'info'); return; }
  const chapters = nodes.filter(n => n.label === '章节' && !isGlobalBoardNode(n)).sort((a,b) => (nodeAxisData(a).chapter || 0) - (nodeAxisData(b).chapter || 0));
  if (!chapters.length) { showToast('先创建或扫描正文章节', 'info'); return; }
  const current = id || (activeEditorKind === 'file' ? chapters.find(n=>n.file===activeFilePath)?.id : currentDetailNodeId);
  chapterWrapUpProject = currentProject; chapterWrapUpOpener = document.activeElement;
  const select = document.getElementById('chapterWrapUpSelect');
  select.replaceChildren(new Option('选择收尾章节', ''), ...chapters.map(n=>new Option(n.title,n.id)));
  select.value = chapters.some(n=>n.id===current) ? current : '';
  document.querySelectorAll('#chapterWrapUpChecks input').forEach(el=>el.checked=true);
  updateChapterWrapUpSource();
  document.getElementById('chapterWrapUpModal').classList.add('show'); select.focus();
}
function updateChapterWrapUpSource() {
  const n = nodeMap[document.getElementById('chapterWrapUpSelect').value];
  const source = document.getElementById('chapterWrapUpSource');
  source.textContent = n ? n.file + ' · ' + (chapterWrapUpSource(n).dirty ? '引用未保存草稿，发送前请确认定稿' : '引用已保存正文') : '请选择需要收尾的章节。';
  document.getElementById('chapterWrapUpCreate').disabled = !n;
}
function createChapterWrapUpTask() {
  if (chapterWrapUpProject !== currentProject) { closeChapterWrapUp(); showToast('项目已切换，请重新选择章节','info'); return; }
  if (writingBusy) { showToast('先停止当前执行，再创建收尾任务','info'); return; }
  const n = nodeMap[document.getElementById('chapterWrapUpSelect').value];
  const checks = [...document.querySelectorAll('#chapterWrapUpChecks input:checked')].map(el=>el.value);
  if (!n || n.label !== '章节' || !checks.length) { showToast('请选择章节和至少一项收尾内容','info'); return; }
  const source = chapterWrapUpSource(n), chapter = nodeAxisData(n).chapter;
  const instructions = {
    characters:'人物状态：核对本章实际发生的变化，更新相关人物的状态、位置、实力、伤势、目标、关系与持有物，并标明状态截至章号。卡片已记录更晚章节时，保留当前状态，只补本章历史，不能倒退覆盖。',
    foreshadows:'伏笔记录：区分新埋设、强化、实际回收和未来计划，附章号与原文依据；名字出现不能直接判定回收。更新已有记录，无充分证据的列为待核对。',
    summary:'章节摘要：提炼本章已发生的事件、人物选择、转折和章末悬念。优先更新项目已有摘要文件；没有时新建「追踪/章节摘要.md」，按章节分节，保留其他章节记录。',
    timeline:'时间线记录：整理本章事件顺序，区分剧情发生时间与写作时间，只记录正文明确的日期或相对时间。优先更新项目已有时间线 Markdown 文件；没有时新建「追踪/时间线.md」，按章节分节。事件列表使用明确的“第N章”标题；新建表格使用“事件ID、章节、事件、时间、依据”列，同一事件保留原 ID，便于与画布同步。不要把未知时间补成事实。'
  };
  const index = nodes.filter(x=>['角色','伏笔','上下文','大纲'].includes(x.label)&&!isGlobalBoardNode(x)).map(x=>'- '+x.label+' | '+x.title+' | '+x.file+' | 节点 '+x.id);
  const nearby = nodes.filter(x=>x.label==='章节' && x.id!==n.id && nodeAxisData(x).chapter < chapter).sort((a,b)=>(nodeAxisData(b).chapter||0)-(nodeAxisData(a).chapter||0)).slice(0,2).map(x=>'- 前章：'+x.title+' | '+x.file+' | 节点 '+x.id);
  let guide = [...nearby,...index].join('\n');
  if (guide.length > 8000) guide = guide.slice(0,8000) + '\n索引已截断，请通过 list_nodes/search/read_file 补查其余资料。';
  newWritingTask();
  activeWritingTask.title = '本章收尾 · '+n.title;
  activeWritingTask.structureNodeId = n.id;
  activeWritingTask.wrapUp = { nodeId:n.id, file:n.file, chapter, checks, sourceContent:source.content, confirmed:{} };
  document.getElementById('chatTask').value = 'outline'; document.getElementById('chatTask').dispatchEvent(new Event('change'));
  document.getElementById('chatAllowProposals').checked = true; document.getElementById('chatMode').value = 'agent';
  document.getElementById('chatTarget').value = n.file;
  addSelectionToChat(n.file,n.title+'（收尾正文）','来源：'+n.file+'\n节点 ID：'+n.id+'\n'+(source.dirty?'未保存草稿，作为暂定依据。\n':'')+source.content,'','章节',false);
  pendingRefs[pendingRefs.length-1].draft = source.dirty;
  if (guide) addSelectionToChat('','收尾资料索引',guide,'','索引',false);
  chatInput.value = '请完成「'+n.title+'」的本章收尾（'+(chapter ? '第'+chapter+'章' : '章号未明确')+'）。\n\n'+checks.map(k=>'- '+instructions[k]).join('\n')+'\n\n先读取本章、必要前文和待更新的资料全文。以本章为截止范围，不把后文、回忆、他人提及或计划当成本章新发生的事实。引用中如有草稿，明确标为暂定。只处理上面选中的项目，不修改正文；不要新建重复的人物或伏笔总表。每项结论给出章节、文件位置和依据；不能确认的保留原值。\n每个文件合并成一个待审提案，保留其他章节与其他人物内容，避免同文件提案互相冲突。修改必须通过 edit_node/edit_file 提案，审阅后才写盘。最后列出已核对、待审修改、待核对三类结果。';
  writingTaskChanged(); saveWritingTasks(); updateWritingTaskHeader(); renderWritingChanges(); renderWritingContext(); requestChatSourcePreview();
  writingChangesPanel.open=true;
  closeChapterWrapUp(); chatInput.focus();
}

function startForeshadowTask(id, mode) {
  if (writingBusy) { showToast('先停止当前执行，再检查另一条伏笔', 'info'); return; }
  const n = nodeMap[id];
  if (!n || n.label !== '伏笔') return;
  captureDetailDraft();
  const content = detailDrafts.get(currentProject + ':' + id)?.content ?? n.content ?? '';
  const { plan, rows } = foreshadowEvidence(n);
  const lines = ['伏笔节点：' + n.id, '当前引用状态：' + (parseForeshadowStatus(content === n.content ? n : { ...n,content,foreshadowStatus:'' }) || '未标记'), '已保存的埋设记录：' + (plan.planted || '未记录'), '已保存的回收计划：' + (plan.expected || '未记录'), '匹配依据仅是章节记录和字面关键词，不是剧情结论。相关章节共 ' + rows.length + ' 个：'];
  let chars = lines.join('\n').length, included = 0;
  for (const row of rows) {
    const line = '- ' + row.node.title + ' | ' + row.node.file + ' | 节点 ' + row.node.id + (row.line ? ' | 行 ' + row.line : '') + ' | ' + row.reasons.join('、') + (row.dirty ? '（未保存草稿）' : '') + '\n  ' + (row.excerpt || '记录关联，尚无关键词命中。');
    if (chars + line.length > 8000) break;
    lines.push(line); chars += line.length + 1; included++;
  }
  if (included < rows.length) lines.push('索引容量限制，另有 ' + (rows.length-included) + ' 个章节未列出，请使用 search/read_node/read_file 补查。');
  if (!rows.length) lines.push('未找到字面匹配。请检索别称与间接铺垫，不能据此断言正文没有埋设。');
  newWritingTask();
  activeWritingTask.structureNodeId = n.id;
  activeWritingTask.title = (mode === 'plan' ? '规划回收 · ' : '检查伏笔 · ') + n.title;
  document.getElementById('chatTask').value = mode === 'plan' ? 'outline' : 'reviewer';
  document.getElementById('chatTask').dispatchEvent(new Event('change'));
  // 单条伏笔及证据优先进入资料包，避免整份追踪文件挤掉相关章节。
  document.getElementById('chatTarget').value = '__project__';
  addSelectionToChat(n.file,n.title,'来源：' + n.file + ' · 行 ' + n.startLine + '–' + n.endLine + '\n节点 ID：' + n.id + '\n' + content,String(n.startLine) + '-' + n.endLine,'伏笔',false);
  if (content !== n.content) pendingRefs[pendingRefs.length-1].draft = true;
  addSelectionToChat('','伏笔关联章节索引',lines.join('\n'),'','章节证据',false);
  chatInput.value = mode === 'plan'
    ? '请围绕「' + n.title + '」规划回收。先核对伏笔记录、关联章节原文和大纲，区分已埋设、已强化、实际已回收与仅有关键词提及。给出建议章节、需要补足的铺垫与改稿理由；有必要时生成正文或伏笔记录的待审提案。记录中是回收计划的，不能直接当成实际回收；核对不足时说明缺少什么证据。'
    : '请检查「' + n.title + '」的埋设、强化和回收脉络。先读取相关章节原文，逐条给出章节、文件位置和依据，核对伏笔记录与正文是否一致。关键词命中只作线索；无法确认的明确列出待核对项。本次只分析，不生成修改提案。';
  writingTaskChanged(); updateWritingTaskHeader(); saveWritingTasks(); requestChatSourcePreview(); chatInput.focus();
}
async function startCharacterTask(id) {
  if (writingBusy) { showToast('先停止当前执行，再核对角色','info'); return; }
  const project = currentProject;
  captureDetailDraft();
  try {
    const d = await fetchHealth(project);
    if (project !== currentProject || writingBusy) return;
    publishHealth(d,project);
    const c = d.characters.find(c=>c.id===id), n = nodeMap[id];
    if (!c || !n) { showToast('此节点未识别为人物卡，请在角色追踪页检查','info'); return; }
    const file = openFiles.find(f=>f.path===n.file&&f.dirty);
    const draft = detailDrafts.get(project+':'+id)?.content;
    const content = file?.content ?? draft ?? n.content ?? '';
    const lines = ['角色：'+c.title+'；节点 ID：'+id,'已保存状态截至：'+(c.updatedChapter != null?'第 '+c.updatedChapter+' 章':'未记录'),'待核对：'+c.issues.join('、'),'下列是字面匹配线索，不能据此判定实际出场或状态变化。'];
    let chars = lines.join('\n').length, included = 0;
    const rows = [];
    for (const chapter of nodes.filter(x=>x.label==='章节'&&!isGlobalBoardNode(x))) {
      const f = openFiles.find(f=>f.path===chapter.file&&f.dirty), draft = detailDrafts.get(project+':'+chapter.id)?.content;
      const text = f?.content ?? draft ?? chapter.content ?? '';
      const hits = c.aliases.filter(a=>text.includes(a));
      if (!hits.length) continue;
      const offset = Math.min(...hits.map(a=>text.indexOf(a)));
      rows.push({ chapter,number:nodeAxisData(chapter).chapter,hits,line:(chapter.startLine || 1)+text.slice(0,offset).split('\n').length-1,
        excerpt:text.slice(Math.max(0,offset-40),offset+150).replace(/\s+/g,' ').trim(),dirty:!!f||draft!=null });
    }
    // 先给最近章节，避免长篇索引容量用完时只剩早期状态。
    rows.sort((a,b)=>(b.number ?? -1)-(a.number ?? -1)||a.chapter.file.localeCompare(b.chapter.file,'zh'));
    for (const row of rows) {
      const line = '- '+row.chapter.title+' | '+row.chapter.file+' | 节点 '+row.chapter.id+' | 行 '+row.line+' | '+row.hits.join('、')+(row.dirty?'（未保存草稿）':'')+'\n  '+row.excerpt;
      if (chars+line.length>8000) break;
      lines.push(line); chars+=line.length+1; included++;
    }
    if (included<rows.length) lines.push('索引未列出另外 '+(rows.length-included)+' 章，请通过 search/read_node/read_file 补查。');
    if (!rows.length) lines.push('没有字面匹配，请检查别称和间接叙述，不可断言角色没有出场。');
    newWritingTask(); closeAnalysis();
    activeWritingTask.structureNodeId = id; activeWritingTask.title = '核对角色 · '+c.title;
    document.getElementById('chatTask').value = 'character'; document.getElementById('chatTask').dispatchEvent(new Event('change'));
    document.getElementById('chatAllowProposals').checked = true; document.getElementById('chatMode').value = 'agent';
    document.getElementById('chatTarget').value = '__project__';
    addSelectionToChat(n.file,c.title,'来源：'+n.file+' · '+(file?'整份未保存文件草稿':'行 '+n.startLine+'–'+n.endLine)+'\n人物节点 ID：'+id+'\n'+content,'','角色卡',false);
    if (file || draft!=null) pendingRefs[pendingRefs.length-1].draft = true;
    addSelectionToChat('','角色章节线索索引',lines.join('\n'),'','章节证据',false);
    chatInput.value = '请核对并更新「'+c.title+'」的角色状态。先读取最近相关章节及必要前文，逐项核对当前状态、位置、境界/实力、伤势、目标、关系和持有物。每项变化给出章节、文件位置和原文依据；区分实际发生、回忆、他人提及与计划。核对卡片的截至章节，并保留原有格式与其他人物内容。有充分证据时生成角色卡的待审修改提案，补上状态更新章；未确认的保留原值并列为待核对，不能编造。引用若含草稿，只能作为暂定线索，明确提示作者。本次通过审阅后才写盘，不要直接覆盖小说文件。';
    writingTaskChanged(); updateWritingTaskHeader(); saveWritingTasks(); renderWritingContext(); requestChatSourcePreview(); chatInput.focus();
  } catch(e) { showToast('角色核对任务创建失败：'+e.message,'error'); }
}
function updateWritingTaskHeader() {
  const title = document.getElementById('agentTaskTitle');
  title.textContent = activeWritingTask?.title || '新任务'; title.title = title.textContent;
  document.getElementById('chatTitle').textContent = '写作 Agent';
  const state = document.getElementById('agentTaskState');
  state.textContent = writingTaskStateLabel(activeWritingTask);
  state.dataset.state = activeWritingTask?.state || 'idle';
  renderWritingTaskHistory();
}
function renderWritingTaskHistory() {
  const host = document.getElementById('chatTaskList'), query = document.getElementById('chatTaskSearch').value.trim().toLowerCase();
  host.replaceChildren();
  for (const task of [...(writingStore()?.tasks || [])].sort((a,b) => b.updated - a.updated)) {
    const role = document.querySelector('#chatTask option[value="' + (Object.hasOwn(writingStages, task.role) ? task.role : 'general') + '"]').textContent;
    const target = task.target && task.target !== '__project__' ? task.target.split(/[\\/]/).pop() : task.target === '__project__' ? '项目资料' : '跟随正在查看';
    if (query && ![task.title,role,target,...task.messages.map(m => m.content)].join(' ').toLowerCase().includes(query)) continue;
    const button = document.createElement('button'); button.className = 'agentTaskItem'; button.classList.toggle('active', task.id === activeWritingTask?.id);
    button.setAttribute('aria-current', String(task.id === activeWritingTask?.id)); button.disabled = writingBusy;
    const name = document.createElement('strong'); name.textContent = task.title;
    const meta = document.createElement('span'); meta.textContent = writingTaskStateLabel(task) + ' · ' + new Date(task.updated).toLocaleDateString('zh-CN');
    const context = document.createElement('span'); const pending = (task.proposals || []).filter(p => p.state === 'pending').length;
    context.textContent = role + ' · ' + target + (pending ? ' · ' + pending + ' 项待审' : '');
    button.append(name,context,meta); button.onclick = () => activateWritingTask(task.id); host.appendChild(button);
  }
  if (!host.childElementCount) host.textContent = '没有匹配的任务';
}
function renderWritingTurn(turn) {
  const box = document.createElement('details'); box.className = 'agentRun'; box.dataset.turn = turn.id; box.open = ['running','failed','interrupted','limited'].includes(turn.status);
  const summary = document.createElement('summary'); summary.className = 'agentRunSummary';
  summary.textContent = (writingStateLabels[turn.status] || '已完成') + ' · ' + (turn.phase || '查阅与处理') + (turn.steps?.length ? ' · ' + turn.steps.length + ' 项操作' : '');
  const list = document.createElement('div'); list.className = 'agentRunSteps';
  for (const step of turn.steps || []) {
    const line = document.createElement('div'); line.className = 'agentStep'; line.dataset.status = step.status;
    const icon = document.createElement('span'); icon.className = 'agentStepMark'; icon.textContent = step.status === 'running' ? '●' : step.status === 'completed' ? '✓' : step.status === 'failed' ? '!' : '○';
    const text = document.createElement('span'); text.textContent = step.summary; line.append(icon,text);
    if (step.path && /\.md$/i.test(step.path)) { const open = document.createElement('button'); open.textContent = '查看'; open.onclick = () => { if (!writingBusy) { switchSidebarMode('files'); openFile(step.path).catch(e => showToast(e.message,'error')); } }; line.appendChild(open); }
    list.appendChild(line);
  }
  if (!list.childElementCount) { const hint = document.createElement('div'); hint.textContent = turn.status === 'running' ? '等待 Agent 查阅与处理…' : '本轮没有调用项目工具'; list.appendChild(hint); }
  box.append(summary,list); return box;
}
function renderWritingTask() {
  chatMessages.replaceChildren(); updateWritingTaskHeader();
  const task = activeWritingTask;
  if (!task) return;
  if (!task.messages.length) {
    const empty = document.createElement('div'); empty.className = 'agentWelcome';
    empty.innerHTML = '<h3>想推进哪一段故事？</h3><p>添加节点或片段，交给 Agent 查阅与处理。文件修改会先交给你审阅。</p><div class="agentExamples"></div>';
    chatMessages.appendChild(empty);
  }
  syncWritingStage();
  for (const [i,m] of task.messages.entries()) {
    addWritingMessage(m.role,m.content);
    const turn = task.turns.find(t => t.messageIndex === i);
    if (turn) chatMessages.appendChild(renderWritingTurn(turn));
  }
  renderWritingChanges();
  if (task.messages.length) chatScrollEnd(true); else chatMessages.scrollTop = 0;
}
function renderWritingContext() {
  const host = document.getElementById('chatContextTags'); host.replaceChildren();
  const origin = nodeMap[activeWritingTask?.structureNodeId];
  if (origin) {
    const tag = document.createElement('button'); tag.className = 'agentContextTag agentContextFile'; tag.textContent = origin.label === '角色' ? '返回角色' : origin.label === '章节' ? '返回章节' : '返回伏笔'; tag.title = '返回画布：' + origin.title; tag.disabled = writingBusy;
    tag.onclick = () => { switchSidebarMode('canvas'); focusNode(origin.id); document.getElementById('chatDetailTab').click(); };
    host.appendChild(tag);
  }
  const target = writingTargetFile();
  if (target) {
    const tag = document.createElement('button'); tag.className = 'agentContextTag agentContextFile';
    tag.title = '打开 ' + target; tag.disabled = writingBusy;
    tag.textContent = (document.getElementById('chatTarget').value ? '重点：' : '跟随：') + target.split(/[\\/]/).pop();
    tag.onclick = () => { switchSidebarMode('files'); openFile(target).catch(e => showToast(e.message,'error')); };
    host.appendChild(tag);
  }
  for (const ref of pendingRefs) {
    const tag = document.createElement('span'); tag.className = 'agentContextTag'; tag.title = ref.title || ref.file;
    const label = document.createElement('span'); label.textContent = ref.title || ref.file || '选中片段';
    const remove = document.createElement('button'); remove.textContent = '×'; remove.title = '移除该参考'; remove.disabled = writingBusy;
    remove.onclick = () => { pendingRefs = pendingRefs.filter(r => r.id !== ref.id); writingTaskChanged(); requestChatSourcePreview(); };
    tag.append(label,remove); host.appendChild(tag);
  }
  if (!host.childElementCount) { const label = document.createElement('span'); label.className = 'agentContextHint'; label.textContent = '使用当前小说的项目资料'; host.appendChild(label); }
}

function syncWritingDetail(dock, collapsed) {
  const detail = document.getElementById('detail');
  const resize = document.getElementById('detailResizer');
  if (dock === 'right' && !collapsed) {
    if (!detail.classList.contains('hidden')) detailHiddenByChat = true;
    detail.classList.add('hidden');
    resize.classList.add('hidden');
    document.getElementById('detailShow').classList.remove('show');
  } else if (detailHiddenByChat) {
    detailHiddenByChat = false;
    detail.classList.remove('hidden');
    resize.classList.remove('hidden');
  }
}

function refreshChatTargets(preferred) {
  const sel = document.getElementById('chatTarget');
  const previous = preferred ?? sel.value;
  const files = [...new Set(nodes.filter(n => n.file && !n.synthetic).map(n => n.file))];
  sel.replaceChildren(new Option('跟随正在查看的内容', ''), new Option('仅项目资料', '__project__'));
  for (const file of files) sel.add(new Option(file.split(/[\\/]/).pop(), file));
  sel.value = files.includes(previous) || previous === '__project__' ? previous : '';
  if (sourceProject !== currentProject) {
    sourceProject = currentProject;
    chatSourcePacket = null;
    document.getElementById('chatAllowProposals').checked = activeWritingTask?.mode !== 'discuss';
  }
  syncRoleBar();
  document.getElementById('chatTitle').textContent = '写作 Agent';
  document.getElementById('chatTitle').title = currentProject;
  document.getElementById('sidebarBookTitle').textContent = currentProject || '小说画布';
  document.getElementById('workspaceProjectTitle').textContent = currentProject || '情节画布';
  document.getElementById('sidebarBookMeta').textContent = nodes.filter(n => n.label === '章节').length + ' 章 · ' + nodes.length + ' 个节点';
  requestChatSourcePreview();
}

function writingTargetFile() {
  const chosen = document.getElementById('chatTarget').value;
  if (chosen === '__project__') return '';
  if (chosen) return chosen;
  const current = activeEditorKind === 'file' && openFiles.find(f => f.path === activeFilePath && !f.pendingCreate);
  const node = nodeMap[currentDetailNodeId];
  return current ? current.path : node && !node.synthetic ? node.file || '' : '';
}
function chatSourceSpec() {
  const targetFile = writingTargetFile();
  const references = pendingRefs.map(r => ({ ...r }));
  const f = openFiles.find(f => f.path === targetFile);
  if (f && f.dirty) references.unshift({ id: 'draft:' + f.path, title: f.path, file: f.path, content: f.content, draft: true, whole: true });
  return { project: currentProject, targetFile, references, excludedIds: [...chatExcludedIds], messages: chatHistory.filter(m => m.role !== 'ref').slice(-20) };
}

async function fetchChatSources(spec, signal) {
  const r = await fetch('/api/chat/context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec), signal });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d;
}

function requestChatSourcePreview() {
  renderWritingContext();
  if (!writingBusy) writingTaskChanged();
  clearTimeout(sourcePreviewTimer);
  const seq = ++sourcePreviewSeq, project = currentProject;
  if (!project || writingBusy) return;
  sourcePreviewTimer = setTimeout(async () => {
    try {
      const packet = await fetchChatSources(chatSourceSpec());
      if (seq !== sourcePreviewSeq || project !== currentProject) return;
      chatSourcePacket = packet;
      renderChatSources(packet);
    } catch (e) {
      if (seq !== sourcePreviewSeq || project !== currentProject) return;
      document.getElementById('chatSourceSummary').textContent = '资料加载失败 · 发送时会重试';
      document.getElementById('refBar').textContent = e.message;
    }
  }, 0);
}

function renderChatSources(packet, sent = false) {
  const host = document.getElementById('refBar');
  host.style.display = 'block';
  host.replaceChildren();
  const shortened = packet.items.filter(i => i.truncated).length;
  document.getElementById('chatSourceSummary').textContent = (sent ? '本轮已发送' : '本次资料') + ' · ' + packet.items.length + ' 项 · ' + packet.chars.toLocaleString() + ' 字符' + (shortened ? ' · ' + shortened + ' 项截断' : '');
  for (const item of packet.items) {
    const row = document.createElement('details');
    row.className = 'chatSourceItem' + (item.kind === '手动引用' ? ' refChip' : '');
    row.innerHTML = '<summary><span class="chatSourceTitle">' + escapeHtml(item.title) + '</span><span class="chatSourceMeta">' + escapeHtml(item.kind) + ' · ' + escapeHtml(item.truncated ? '截断 ' + item.content.length + '/' + item.originalChars : item.mode) + '</span><button title="从后续请求中移除">移除</button></summary><pre></pre>';
    row.querySelector('pre').textContent = item.content;
    row.querySelector('button').disabled = writingBusy;
    row.querySelector('button').onclick = e => { e.preventDefault(); chatExcludedIds.add(item.id); requestChatSourcePreview(); };
    const ref = pendingRefs.find(r => r.id === item.id);
    if (ref) {
      const pin = document.createElement('button'); pin.textContent = ref.pinned ? '已固定' : '固定'; pin.disabled = writingBusy;
      pin.onclick = e => { e.preventDefault(); ref.pinned = !ref.pinned; requestChatSourcePreview(); };
      row.querySelector('summary').appendChild(pin);
    }
    host.appendChild(row);
  }
  for (const item of packet.omitted || []) {
    const note = document.createElement('div');
    note.className = 'chatSourceWarning';
    note.textContent = item.title + ' · ' + item.reason;
    host.appendChild(note);
  }
  const historyNote = document.createElement('div'); historyNote.className = 'chatSourceWarning';
  historyNote.textContent = '另附最近对话 ' + (packet.historyCount || 0) + ' 条（最多 20 条 / 12000 字符）' + (packet.historyOmitted ? ' · 本轮省略 ' + packet.historyOmitted + ' 条早期消息' : '');
  host.appendChild(historyNote);
}

function chatScrollEnd(force = false) {
  if (force || chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 100) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
    document.getElementById('chatNewReply').hidden = true;
  } else document.getElementById('chatNewReply').hidden = false;
}

function addWritingMessage(role, text) {
  const atEnd = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 100;
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  if (role === 'assistant') {
    const body = document.createElement('div'); body.className = 'chatMessageBody'; body.innerHTML = renderMarkdown(text); div.appendChild(body);
    const actions = document.createElement('div'); actions.className = 'chatMessageActions';
    const copy = document.createElement('button'); copy.textContent = '复制'; copy.onclick = () => navigator.clipboard.writeText(text).catch(() => showToast('复制失败，请选中文字复制', 'error'));
    const quote = document.createElement('button'); quote.textContent = '引用回复'; quote.onclick = () => addSelectionToChat('', 'AI 回复', text, '', '讨论');
    actions.append(copy, quote); div.appendChild(actions);
  } else div.textContent = text;
  chatMessages.appendChild(div);
  chatScrollEnd(atEnd);
  return div;
}

function renderWritingProposals(list) {
  if (!Array.isArray(list)) return;
  if (!activeWritingTask) loadWritingTasks();
  for (const p of list || []) {
    if (!p || !p.id) continue;
    if (p.project && p.project !== currentProject) continue;
    writingProposalCache.set(p.id, p);
    const store = writingStore();
    let owner = store.tasks.find(t => t.proposals.some(x => x.id === p.id)) || store.tasks.find(t => t.id === p.taskId);
    if (!owner && p.taskId) { owner = makeWritingTask(); owner.id = p.taskId; owner.title = p.title || '恢复的修改任务'; store.tasks.unshift(owner); }
    owner ||= activeWritingTask;
    if (!owner.proposals.some(x => x.id === p.id)) owner.proposals.push({ id:p.id, file:p.file, title:p.title, kind:p.kind, project:currentProject, state:'pending' });
    const item=owner.proposals.find(x=>x.id===p.id);
    if(owner.wrapUp && !item.wrapUpChecks) item.wrapUpChecks=guessWrapUpChecks(p,owner);
    if(owner.wrapUp) for(const key of item.wrapUpChecks || []) delete owner.wrapUp.confirmed?.[key];
    if (owner.state !== 'running') owner.state = 'review';
    renderedProposalIds.add(p.id);
  }
  saveWritingTasks(); renderWritingChanges(); updateWritingTaskHeader();
}

async function getWritingProposal(id) {
  // 审阅前读取服务端当前待审清单，避免把已应用或已拒绝的缓存再次展示为待审。
  const project = currentProject;
  const data = await fetch('/api/proposals?project=' + encodeURIComponent(project)).then(r => r.json());
  if (data.error) throw new Error(data.error);
  if (project !== currentProject) throw new Error('当前小说已切换');
  const p = data.proposals.find(p => p.id === id);
  if (!p) { markChatProposal(id,'unavailable'); throw new Error('这项修改已不在待审清单中，请检查文件的当前内容'); }
  writingProposalCache.set(id,p); return p;
}

function renderWritingChanges() {
  const panel = writingChangesPanel, host = panel.querySelector('#chatChangesBody');
  const changes = activeWritingTask?.proposals || [], pending = changes.filter(p => p.state === 'pending').length;
  panel.hidden = !changes.length && !activeWritingTask?.wrapUp;
  panel.querySelector('#chatChangesSummary').textContent = changes.length ? '修改清单 · ' + changes.length + ' 项' + (pending ? ' · ' + pending + ' 待审阅' : ' · 已处理') : '本章收尾进度';
  host.replaceChildren();
  renderWrapUpProgress(host,activeWritingTask);
  for (const p of changes) {
    const card = document.createElement('div');
    card.className = 'chatProposal'; card.id = 'chat-proposal-' + p.id; card.dataset.state = p.state;
    card.innerHTML = '<div class="chatProposalInfo"><div class="chatProposalTitle"></div><div class="chatProposalMeta"></div></div><div class="chatProposalActions"><button class="review">查看差异</button><details class="chatProposalMore"><summary aria-label="更多修改操作">•••</summary><div><button class="adjust">继续调整</button><button class="reject">拒绝</button></div></details></div>';
    card.querySelector('.chatProposalTitle').textContent = p.title === p.file ? p.file.split(/[\\/]/).pop() : p.title || p.file || '文件修改';
    card.title = p.file;
    card.querySelector('.chatProposalMeta').textContent = ({pending:'待审阅', applied:p.partial?'部分采纳':'已写入', rejected:'已拒绝', undone:'已撤销', unavailable:'已不在待审清单'}[p.state] || '待审阅') + ' · ' + (p.kind === 'create' ? '新增内容' : p.kind === 'delete' ? '删除内容' : '修改内容');
    if(activeWritingTask?.wrapUp) {
      const assignment=document.createElement('details'); assignment.className='wrapUpAssignment';
      const summary=document.createElement('summary'); summary.textContent='收尾归属：'+((p.wrapUpChecks || []).map(k=>wrapUpLabels[k]).join('、') || '请选择'); assignment.appendChild(summary);
      for(const key of activeWritingTask.wrapUp.checks) {
        const label=document.createElement('label'), input=document.createElement('input'); input.type='checkbox'; input.checked=p.wrapUpChecks?.includes(key); input.disabled=writingBusy;
        input.onchange=()=>{const task=activeWritingTask;p.wrapUpChecks=[...assignment.querySelectorAll('input:checked')].map(el=>el.value);task.wrapUp.confirmed={};saveWritingTasks();renderWritingChanges();updateWritingTaskHeader();}; input.value=key;
        label.append(input,document.createTextNode(wrapUpLabels[key])); assignment.appendChild(label);
      }
      card.querySelector('.chatProposalInfo').appendChild(assignment);
    }
    card.querySelector('.review').onclick = async () => {
      if (p.project && p.project !== currentProject) return;
      try {
        const proposal = await getWritingProposal(p.id);
        chatPanel.classList.remove('chat-wide');
        switchSidebarMode('files');
        await openFileProposal(proposal);
      } catch (e) { showToast('无法打开审阅：' + e.message, 'error'); }
    };
    card.querySelector('.adjust').onclick = async () => {
      try {
        const proposal = writingProposalCache.get(p.id) || await getWritingProposal(p.id);
        addSelectionToChat(p.file, (p.title || p.file) + '（待审阅方案）', proposal.newContent || proposal.oldContent, '', '提案', true);
        document.getElementById('chatAllowProposals').checked = true;
        document.getElementById('chatMode').value = 'agent';
        chatInput.value = '请继续调整「' + (p.title || p.file) + '」的修改方案：\n'; chatInput.focus(); writingTaskChanged();
      } catch (e) { showToast(e.message,'error'); }
    };
    card.querySelector('.reject').onclick = async () => {
      try {
        const d = await fetch('/api/proposals/reject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id }) }).then(r => r.json());
        if (d.error) throw new Error(d.error);
        markChatProposal(p.id, 'rejected');
        removeFileReviewDraft((writingProposalCache.get(p.id)?.root || currentProject)+':'+p.id);
        if (currentFileProposal?.id === p.id) await dismissFileProposal(p);
      } catch (e) { showToast('拒绝失败：' + e.message, 'error'); }
    };
    if (p.state !== 'pending') {
      const actions=card.querySelector('.chatProposalActions'); actions.replaceChildren();
      if(p.state==='applied' && p.applicationId) {const undo=document.createElement('button');undo.textContent='撤销采纳';undo.disabled=writingBusy;undo.onclick=()=>undoFileApplication(p.applicationId,p.file);actions.appendChild(undo);}
      if(['applied','undone'].includes(p.state) && p.wrapUpChecks?.includes('timeline')) {const sync=document.createElement('button');sync.textContent='同步时间线';sync.disabled=writingBusy;sync.onclick=()=>openTimelineSync(p.file,activeWritingTask.wrapUp.chapter);actions.appendChild(sync);}
    }
    else card.querySelectorAll('button').forEach(b => b.disabled = writingBusy);
    host.appendChild(card);
  }
  if (pending && !writingBusy) panel.open = true;
  chatMessages.appendChild(panel);
}

function markChatProposal(id, state, application) {
  for (const [project, store] of writingTaskStores) {
    const task = store.tasks.find(t => t.proposals.some(p => p.id === id));
    if (!task) continue;
    const p=task.proposals.find(p=>p.id===id); p.state=state;
    if(application) {p.applicationId=application.id;p.partial=application.partial;}
    if(task.wrapUp) for(const key of p.wrapUpChecks || []) delete task.wrapUp.confirmed?.[key];
    if (task.state === 'review' && task.proposals.every(p => p.state !== 'pending')) task.state = 'completed';
    saveWritingTasks(project);
  }
  renderWritingChanges();
  updateWritingTaskHeader();
}

function renderWritingSteps(steps) {
  if (!steps?.length) return;
  const group = document.createElement('details'); group.className = 'chatSteps';
  const summary = document.createElement('summary'); summary.textContent = '本轮查阅与操作 · ' + steps.length + ' 项'; group.appendChild(summary);
  for (const s of steps) { const line = document.createElement('div'); line.textContent = s.summary || s.tool; group.appendChild(line); }
  chatMessages.appendChild(group); chatScrollEnd();
}

function setWritingControls(disabled) {
  ['chatTask', 'chatModel', 'chatTarget', 'chatAllowProposals', 'chatMode', 'newChatBtn', 'chatTaskHistoryBtn', 'chatAttachActive', 'chatRestoreSources'].forEach(id => { document.getElementById(id).disabled = disabled; });
  renderWritingContext();
}

async function sendWritingChat() {
  const text = chatInput.value.trim();
  if (!text || writingBusy || chatAbort) return;
  if (text.length > 12000) { showToast('单次要求超过 12000 字符，请将正文作为参考资料添加', 'error'); return; }
  loadWritingTasks(); captureWritingTask();
  const task = activeWritingTask;
  const project = currentProject, storageKey = chatStorageKey(), history = chatHistory;
  task.messages = history;
  const refs = pendingRefs.map(r => ({ ...r }));
  const spec = chatSourceSpec();
  spec.messages = history.filter(m => m.role !== 'ref').concat({ role: 'user', content: text }).slice(-20);
  const role = document.getElementById('chatTask').value;
  const allowProposals = document.getElementById('chatAllowProposals').checked;
  const model = document.getElementById('chatModel').value;
  const turn = { id:crypto.randomUUID(), messageIndex:history.length, request:text, status:'running', phase:'正在准备项目资料', steps:[], started:Date.now() };
  task.turns.push(turn); task.state = 'running'; task.updated = Date.now();
  if (task.title === '新任务') task.title = text.split('\n')[0].slice(0,32);
  history.push({ role:'user', content:text });
  const welcome = chatMessages.querySelector('.agentWelcome'); if (welcome) welcome.remove();
  addMsg('user',text); chatMessages.appendChild(renderWritingTurn(turn)); updateWritingTaskHeader(); saveWritingTasks(project);
  ++sourcePreviewSeq; clearTimeout(sourcePreviewTimer);
  writingBusy = true; writingPreparing = new AbortController(); setChatBusy(true); setWritingControls(true);
  let live = null, persistTimer = null;
  function updateRun() {
    if (project === currentProject && task.id === activeWritingTask?.id) {
      const old = chatMessages.querySelector('[data-turn="' + turn.id + '"]'); if (old) old.replaceWith(renderWritingTurn(turn));
    }
    clearTimeout(persistTimer); persistTimer = setTimeout(() => saveWritingTasks(project),180);
  }
  function executionEvent(event, data) {
    if (event === 'phase') turn.phase = data.summary;
    if (event === 'tool_start' || event === 'tool') {
      const step = { ...data, tool:data.name || data.tool, status:event === 'tool_start' ? 'running' : data.status || 'completed' };
      const index = turn.steps.findIndex(s => s.stepId === data.stepId);
      if (index >= 0) turn.steps[index] = step; else turn.steps.push(step);
      turn.phase = event === 'tool_start' ? data.summary : '正在继续处理任务';
    }
    if (event === 'proposal' && data.proposal) {
      const p = data.proposal; writingProposalCache.set(p.id,p);
      if (!task.proposals.some(x => x.id === p.id)) task.proposals.push({ id:p.id, file:p.file, title:p.title, kind:p.kind, project, state:'pending' });
      if (project === currentProject) renderWritingChanges();
    }
    if (event !== 'delta') updateRun();
  }
  try {
    const packet = await fetchChatSources(spec, writingPreparing.signal);
    if (project !== currentProject) { const e = new Error('stopped'); e.stopped = true; throw e; }
    writingPreparing = null;
    chatSourcePacket = packet;
    renderChatSources(packet, true);
    chatInput.value = '';
    turn.sources = packet.items.map(i => ({ title:i.title,kind:i.kind,truncated:i.truncated }));
    turn.phase = '资料已准备，正在执行任务'; updateRun();
    live = document.createElement('div'); live.className = 'msg assistant'; chatMessages.appendChild(live); chatScrollEnd(true);
    const result = await chatFetchStream({ project, role, model, workspaceMode:allowProposals ? 'agent' : 'discuss', taskId:task.id, turnId:turn.id, messages: history.filter(m => m.role !== 'ref').slice(-20), contextPacket: packet, allowProposals }, delta => {
      turn.partial = delta;
      clearTimeout(persistTimer); persistTimer = setTimeout(() => saveWritingTasks(project),180);
      if (project !== currentProject || !live.isConnected) return;
      const atEnd = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 100;
      live.textContent = delta; live.dataset.partial = delta; chatScrollEnd(atEnd);
    }, executionEvent);
    const reply = result.reply || '（无回复）';
    history.push({ role: 'assistant', content: reply });
    turn.status = result.outcome === 'limited' ? 'limited' : 'completed'; turn.phase = result.outcome === 'limited' ? '达到本轮执行上限，可继续补充要求' : '本轮处理结束'; delete turn.partial;
    task.state = turn.status === 'limited' ? 'limited' : task.proposals.some(p => p.state === 'pending') || result.proposals?.length ? 'review' : 'completed';
    updateRun();
    try { localStorage.setItem(storageKey, JSON.stringify(history)); } catch (_) {}
    if (project !== currentProject) return;
    live.remove(); addMsg('assistant', reply); renderProposals(result.proposals); addUsageNote(result.usage);
    pendingRefs = pendingRefs.filter(r => !refs.some(sent => sent.id === r.id) || r.pinned);
  } catch (e) {
    const partial = live?.dataset.partial || '';
    const stopped = e.stopped || e.name === 'AbortError';
    turn.status = stopped ? 'stopped' : 'failed'; task.state = turn.status; turn.phase = stopped ? '已停止，已有结果保留' : e.message;
    for (const step of turn.steps) if (step.status === 'running') step.status = stopped ? 'stopped' : 'failed';
    updateRun();
    if (live || project === currentProject) {
      const message = partial + (stopped ? '\n\n（已停止生成）' : '\n\n请求失败：' + e.message);
      history.push({ role: 'assistant', content: message });
      try { localStorage.setItem(storageKey, JSON.stringify(history)); } catch (_) {}
      if (project === currentProject) { live?.remove(); addMsg('assistant', message); }
    }
    if (project === currentProject) {
      if (!chatInput.value) chatInput.value = text;
      showToast(stopped ? '已停止，要求和引用已保留' : '发送失败：' + e.message, stopped ? 'info' : 'error');
    }
  } finally {
    clearTimeout(persistTimer);
    writingBusy = false; writingPreparing = null; setChatBusy(false); setWritingControls(false);
    if (project === currentProject) { captureWritingTask(); renderWritingChanges(); renderWritingContext(); updateWritingTaskHeader(); if (chatSourcePacket) renderChatSources(chatSourcePacket, !!live); }
    saveWritingTasks(project);
  }
}

document.getElementById('chatTask').onchange = e => {
  setCurrentRole(e.target.value);
  document.getElementById('chatAllowProposals').checked = ['outline', 'writer', 'polish'].includes(e.target.value);
  document.getElementById('chatMode').value = document.getElementById('chatAllowProposals').checked ? 'agent' : 'discuss';
  syncWritingStage();
  writingTaskChanged();
};
document.getElementById('chatMode').onchange = e => { document.getElementById('chatAllowProposals').checked = e.target.value === 'agent'; writingTaskChanged(); };
document.getElementById('chatTarget').onchange = () => { document.getElementById('chatScope').open = false; requestChatSourcePreview(); };
document.getElementById('chatTaskHistoryBtn').onclick = () => { captureWritingTask(); saveWritingTasks(); renderWritingTaskHistory(); document.getElementById('chatTaskHistory').hidden = false; document.getElementById('chatTaskSearch').focus(); };
document.getElementById('chatTaskHistoryClose').onclick = () => document.getElementById('chatTaskHistory').hidden = true;
document.getElementById('chatTaskSearch').oninput = renderWritingTaskHistory;
document.getElementById('writingToolsBtn').onclick = e => {
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, [
    { label: '本章收尾', action: () => openChapterWrapUp() },
    { label: '生成下一章', action: runWriteChapter },
    { label: '人物推进', action: () => runAdvance() },
    { label: '章节核心', action: runCores },
    { label: '卷管理', action: runVolumes }
  ]);
};
document.getElementById('chapterWrapUpClose').onclick = closeChapterWrapUp;
document.getElementById('chapterWrapUpSelect').onchange = updateChapterWrapUpSource;
document.getElementById('chapterWrapUpCreate').onclick = createChapterWrapUpTask;
document.getElementById('chapterWrapUpModal').onclick = e => { if (e.target.id === 'chapterWrapUpModal') closeChapterWrapUp(); };
document.addEventListener('keydown', e => {
  const modal=document.getElementById('chapterWrapUpModal');
  if (!modal.classList.contains('show')) return;
  if (e.key === 'Escape') { e.preventDefault(); closeChapterWrapUp(); }
  if (e.key === 'Tab') {
    const focusable=[...modal.querySelectorAll('button:not(:disabled),select,input')],first=focusable[0],last=focusable[focusable.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
});
document.getElementById('chatAttachActive').onclick = () => {
  const f = openFiles.find(f => f.path === activeFilePath);
  const n = nodeMap[currentDetailNodeId];
  if (activeEditorKind === 'file' && f) addSelectionToChat(f.path, f.path, f.content, '', '文件', true);
  else if (n) addRefToChat(n);
  else showToast('先打开文件或选中画布节点，再添加资料', 'info');
};
document.getElementById('chatRestoreSources').onclick = () => { chatExcludedIds.clear(); requestChatSourcePreview(); };
document.getElementById('chatNewReply').onclick = () => chatScrollEnd(true);
document.getElementById('chatWideBtn').onclick = () => { chatPanel.classList.toggle('chat-wide'); document.getElementById('chatWideBtn').textContent = chatPanel.classList.contains('chat-wide') ? '还原' : '⛶'; };
document.getElementById('detailAiTab').onclick = () => expandChatPanel();
document.getElementById('chatDetailTab').onclick = () => {
  if (chatDockNow() === 'right' && !isChatCollapsed()) toggleChat();
  document.getElementById('detail').classList.remove('hidden');
  document.getElementById('detail').classList.add('responsive-open');
  document.getElementById('detailResizer').classList.remove('hidden');
};
document.getElementById('detailShow').addEventListener('click', () => { if (chatDockNow() === 'right' && !isChatCollapsed()) toggleChat(); });
document.getElementById('chatStop').addEventListener('click', () => writingPreparing?.abort());
chatInput.addEventListener('input', () => { chatInput.style.height = 'auto'; chatInput.style.height = Math.min(160, chatInput.scrollHeight) + 'px'; writingTaskChanged(); });
document.addEventListener('projectDataUpdated', () => { refreshChatTargets(); renderWritingChanges(); updateWritingTaskHeader(); });
let wrapUpRefreshTimer=null;
document.addEventListener('input',e=>{
  if(!activeWritingTask?.wrapUp || !['fileContent','editContent'].includes(e.target.id)) return;
  clearTimeout(wrapUpRefreshTimer);wrapUpRefreshTimer=setTimeout(()=>{renderWritingChanges();updateWritingTaskHeader();},180);
});
document.addEventListener('detailNodeChanged', () => { if (!writingBusy) refreshChatTargets(); });
document.addEventListener('activeFileChanged', () => { if (!writingBusy) requestChatSourcePreview(); });
document.getElementById('projectSelect').addEventListener('change', () => {
  if (activeWritingTask) { activeWritingTask.draft = chatInput.value; activeWritingTask.refs = pendingRefs.map(r => ({...r})); saveWritingTasks(writingTaskProject); }
  writingDrafts.set(sourceProject, chatInput.value);
  writingPreparing?.abort(); chatAbort?.abort(); ++sourcePreviewSeq;
  chatExcludedIds.clear(); chatSourcePacket = null; pendingRefs = []; chatHistory = [];
  chatMessages.replaceChildren();
  chatInput.value = writingDrafts.get(currentProject) || '';
  document.getElementById('chatTarget').value = '';
  document.getElementById('refBar').replaceChildren();
  document.getElementById('chatSourceSummary').textContent = '正在加载当前项目资料…';
  activeWritingTask = null; writingTaskProject = ''; document.getElementById('chatTaskHistory').hidden = true; writingChangesPanel.hidden = true; document.getElementById('chatContextTags').replaceChildren();
});
refreshChatTargets();
document.getElementById('chatComposer').prepend(document.getElementById('chatContext'));
syncChatPanel();
if (innerWidth > 980) expandChatPanel();

document.getElementById('workspaceNewNode').onclick = () => openNewNodeModal('role');
document.getElementById('axisHelpBtn').onclick = e => {
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  showMenu(r.left,r.bottom + 4,[
    { label:'拖空白平移 · 滚轮缩放', action:() => showToast('拖动画布空白区域平移；在绘图区滚动鼠标滚轮缩放', 'info') },
    { label:'拖节点调整章号与推进', action:() => showToast('节点横向位置对应章号，纵向位置对应推进；泳道视图按剧情线排列', 'info') },
    { label:'定位当前节点（恢复可读大小）', action:() => { const n = nodeMap[currentDetailNodeId]; if (n) focusNode(n.id); else showToast('先选中节点', 'info'); } },
    { label:'查看全图', action:axisFitAll }
  ]);
};
document.querySelectorAll('.workspaceMenu').forEach(menu => {
  menu.addEventListener('toggle', () => { if (menu.open) document.querySelectorAll('.workspaceMenu').forEach(other => { if (other !== menu) other.open = false; }); });
  menu.addEventListener('click', e => { if (e.target.closest('button')) menu.open = false; });
});
document.addEventListener('click', e => {
  if (!e.target.closest('.workspaceMenu')) document.querySelectorAll('.workspaceMenu').forEach(menu => menu.open = false);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { document.getElementById('chatTaskHistory').hidden = true; document.querySelectorAll('.workspaceMenu,.fileTools,.chatMore,#chatScope,.detailMore,.detailSource,.chatProposalMore').forEach(menu => menu.open = false); } });
new ResizeObserver(() => updateAxisRulers()).observe(document.getElementById('canvasWrap'));
