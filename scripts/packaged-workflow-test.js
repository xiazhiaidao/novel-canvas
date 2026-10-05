// node scripts/packaged-workflow-test.js <win-unpacked/小说画布.exe>
// 实际使用包内服务；数据与小说均写入系统临时目录。
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), os=require('node:os'), http=require('node:http');
const {spawn}=require('node:child_process');
const exe=path.resolve(process.argv[2] || ''), serverFile=path.join(path.dirname(exe),'resources','app.asar','server.js');
assert(fs.existsSync(exe),'请提供构建后的 Electron 可执行文件');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nc-packaged-workflow-')), project='PackedWorkflow', projects=path.join(temp,'projects'), book=path.join(projects,project), dataDir=path.join(temp,'service-data');
fs.mkdirSync(book,{recursive:true});fs.writeFileSync(path.join(book,'设定.md'),'# 测试设定\n');fs.writeFileSync(path.join(book,'记录.md'),'# 旧记录\r\n');
let child;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function stop(){if(child && child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}child=null;}
(async()=>{
  const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const base='http://127.0.0.1:'+port;
  const env={...process.env,ELECTRON_RUN_AS_NODE:'1',PORT:String(port),NOVEL_PROJECTS_ROOT:projects,DEFAULT_PROJECT:project,NOVEL_CANVAS_DATA_DIR:dataDir,NOVEL_CANVAS_TRACKING_DIR:path.join(temp,'character-history'),DEEPSEEK_API_KEY:'',INKPILOT_CONFIG:path.join(temp,'absent.json')};
  async function start(){child=spawn(exe,[serverFile],{env,windowsHide:true,stdio:'ignore'});for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error('包内服务启动失败');try{if((await fetch(base+'/api/projects')).ok)return;}catch(_){}await pause(100);}throw new Error('包内服务未就绪');}
  const get=route=>fetch(base+route).then(r=>r.json());
  const post=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project,...body})}).then(r=>r.json());
  await start();
  for(const asset of ['/review_diff.js','/file_editor.js','/chat_workspace.js','/app.js','/canvas_theme.css','/server.js','/main.js','/timeline_sync.js']) {
    const response=await fetch(base+asset);assert(response.ok,asset);
    assert.equal(await response.text(),fs.readFileSync(path.join(__dirname,'..',asset.slice(1)),'utf8'),'包内文件与源码不同：'+asset);
  }
  const proposal=(await post('/api/propose_file_edit',{path:'记录.md',content:'# 新记录\r\n'})).proposal;
  const applied=await post('/api/apply_proposal',{id:proposal.id,selectedHunks:[{index:0}]});assert(applied.ok,applied.error);
  const pending=(await post('/api/propose_file_edit',{path:'记录.md',content:'# 下一次修改\r\n'})).proposal;
  assert.notEqual(proposal.id,pending.id);await stop();await start();
  assert((await get('/api/proposals?project='+project)).proposals.some(p=>p.id===pending.id));
  assert((await get('/api/proposals/applied?project='+project)).applications.some(a=>a.id===applied.application.id));
  const undo=await post('/api/proposals/undo',{id:applied.application.id});assert(undo.ok,undo.error);assert.equal(fs.readFileSync(path.join(book,'记录.md'),'utf8'),'# 旧记录\r\n');
  fs.writeFileSync(path.join(book,'时间线.md'),'# 时间线\n## 第1章\n- 守住木门\n');
  const preview=await post('/api/timeline/preview',{path:'时间线.md'});assert.equal(preview.operations.length,1);
  const synced=await post('/api/timeline/sync',{path:'时间线.md',token:preview.token,selected:[0]});assert(synced.ok,synced.error);
  assert.equal((await get('/api/data?project='+project)).layout.timelineNodes[0].sourceFile,'时间线.md');
  assert(fs.existsSync(path.join(dataDir,'applications',applied.application.id+'.json')));
  console.log('包内服务验证通过：资源加载、逐段采纳、提案与采纳历史重启恢复、撤销原文、时间线同步及可写数据目录。');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await stop();console.log('隔离目录：'+temp);});
