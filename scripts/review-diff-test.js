const assert = require('node:assert/strict');
const review = require('../review_diff');

const before = '# 章节\r\n\r\n原句一。\r\n保持不变。\r\n原句二。\r\n尾句';
const after = before.replace('原句一。','新句一。').replace('原句二。','新句二。');
const { hunks } = review.diff(before,after);
assert.equal(hunks.length,2);
assert.equal(review.apply(before,after,[{index:1}]).content,before.replace('原句二。','新句二。'));
assert.equal(review.apply(before,after,[{index:0,content:'手动调整。\r\n'}]).content,before.replace('原句一。','手动调整。'));
for (const [a,b] of [['','新增\n'],['删除\n',''],['a\nb\na\n','a\na\n'],['尾句','尾句\n'],['a\n\nb\n','a\n插入\n\nb\n'],['a\nb\nc','z\nb\nc'],['a\r\nb','a\nb']]) {
  const d=review.diff(a,b);
  assert.equal(review.apply(a,b,d.hunks.map((_,index)=>({index}))).content,b);
}
for (const choice of [[],[{index:-1}],[{index:99}],[{index:0},{index:0}],[{index:0,content:null}]]) assert.throws(()=>review.apply(before,after,choice));
assert.deepEqual(review.diff(before,before),{hunks:[],coarse:false});

// 重复行、插入/删除/替换及无末尾换行的可复现组合，验证全部采纳精确还原建议。
let seed=17;
const rand=n=>{seed=(seed*16807)%2147483647;return seed%n;};
for(let i=0;i<400;i++) {
  const original=Array.from({length:1+rand(30)},()=>['甲\n','乙\n','\n','丙\r\n'][rand(4)]);
  const modified=original.slice();
  for(let j=0;j<1+rand(8);j++)modified.splice(rand(modified.length+1),rand(3),...Array.from({length:rand(3)},()=>['丁\n','乙\n','\n'][rand(3)]));
  const a=original.join(''),b=modified.join(''),d=review.diff(a,b);
  if(d.hunks.length)assert.equal(review.apply(a,b,d.hunks.map((_,index)=>({index}))).content,b);
  else assert.equal(a,b);
  if(d.hunks.length>1) {
    const h=d.hunks[0];
    assert.equal(review.apply(a,b,[{index:0}]).content,original.slice(0,h.oldStart).join('')+h.added.join('')+original.slice(h.oldEnd).join(''));
  }
}
const largeBefore=Array.from({length:1200},(_,i)=>'旧'+i+'\n').join(''),largeAfter=largeBefore.replace(/旧/g,'新');
const coarse=review.diff(largeBefore,largeAfter);
assert(coarse.coarse);
assert.equal(review.apply(largeBefore,largeAfter,[{index:0}]).content,largeAfter);
console.log('分段差异验证通过：CRLF、末尾换行、局部采纳、手动替换、无效选择、400 组重复行组合与大差异边界。');
