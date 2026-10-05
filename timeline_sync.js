// 从明确的章节标题、列表或表格读取事件，不推断剧情时间。
const { createHash } = require('node:crypto');
function extract(content, chapterOf) {
  const events=[], counts=new Map(), keys=new Set();
  let chapter=null, chapterLevel=0, headers=null, fenced=false;
  function add(title,note,ch,line,explicitId) {
    if (!Number.isInteger(ch) || ch<=0 || !title.trim()) return;
    const ordinal=(counts.get(ch)||0)+1; counts.set(ch,ordinal);
    const key=explicitId ? 'id:'+explicitId : ch+':row:'+ordinal;
    if (keys.has(key)) throw new Error('时间线事件 ID 重复：'+explicitId);
    keys.add(key);
    events.push({sourceKey:key,chapter:ch,title:title.trim(),note:note.trim(),sourceLine:line});
  }
  const lines=String(content).split(/\r?\n/);
  lines.forEach((raw,i)=>{
    const s=raw.trim();
    if (/^(?:```|~~~)/.test(s)) { fenced=!fenced; return; }
    if (fenced || !s || /^<!--/.test(s)) return;
    const heading=/^(#{1,6})\s+(.+)$/.exec(s);
    if (heading) {
      const next=/第\s*[0-9一二三四五六七八九十百千]+\s*[章回]|chapter\s*\d+/i.test(heading[2]) ? chapterOf(heading[2],'') : null;
      if(next) {chapter=next;chapterLevel=heading[1].length;}
      else if(heading[1].length<=chapterLevel) {chapter=null;chapterLevel=0;}
      headers=null;return;
    }
    if (s.startsWith('|') && s.endsWith('|')) {
      const cells=s.slice(1,-1).split(/(?<!\\)\|/).map(x=>x.trim().replace(/\\\|/g,'|'));
      if (cells.every(x=>/^:?-+:?$/.test(x))) return;
      const titleIndex=cells.findIndex(x=>/^(事件|事件名|重要事件|节点|标题)$/.test(x));
      if (titleIndex>=0) { headers=cells; return; }
      if (!headers) return;
      const get=regex=>cells[headers.findIndex(x=>regex.test(x))] || '';
      const chapterCell=get(/^(章节|章号|所属章节)$/);
      const ch=chapterCell ? (chapterOf(chapterCell,'') || (/^\d+$/.test(chapterCell)?Number(chapterCell):null)) : chapter;
      const note=headers.flatMap((h,j)=>/^(时间|日期|时间\/依据|备注|依据|说明)$/.test(h)&&cells[j]?[h+'：'+cells[j]]:[]).join(' · ');
      add(get(/^(事件|事件名|重要事件|节点|标题)$/),note,ch,i+1,get(/^(事件ID|事件 ID|ID|编号)$/i));
      return;
    }
    headers=null;
    const bullet=/^(?:[-*+]\s+|\d+[.、)]\s*)(.+)$/.exec(s);
    if (bullet) { const text=bullet[1].replace(/^\[[ xX]\]\s*/, ''); add(text,'',chapter,i+1); }
    // 兼容章节分节下的一段简短事件记录；多行长叙述请先整理成列表。
    else if (chapter && s.length<=240 && !s.startsWith('>')) add(s,'',chapter,i+1);
  });
  return events;
}
function plan(events,pins,file,scope) {
  const desired=events.filter(e=>scope==null || e.chapter===scope), operations=[];
  const allManaged=pins.filter(p=>p.sourceFile===file);
  const managed=allManaged.filter(p=>scope==null || p.sourceChapter===scope || (p.sourceChapter==null && p.chapter===scope));
  const keys=new Set(events.map(e=>e.sourceKey));
  for(const event of desired) {
    const previous=allManaged.find(p=>p.sourceKey===event.sourceKey);
    const next={...event,sourceFile:file,sourceChapter:event.chapter};
    if (previous) {
      if (previous.title!==event.title || previous.note!==event.note || previous.chapter!==event.chapter || previous.sourceLine!==event.sourceLine)
        operations.push({action:'update',id:previous.id,before:previous,next});
    } else if (!pins.some(p=>!p.sourceFile && p.chapter===event.chapter && p.title===event.title)) operations.push({action:'add',next});
  }
  for (const previous of managed) if(!keys.has(previous.sourceKey)) operations.push({action:'delete',id:previous.id,before:previous});
  return operations;
}
function hash(value) {
  const text=typeof value==='string' ? value : JSON.stringify(value,(_,v)=>v && typeof v==='object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
  return createHash('sha256').update(text).digest('hex');
}
module.exports={extract,plan,hash};
