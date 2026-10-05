// 同一套分段规则用于浏览器审阅和服务端写回，保留原始换行与未选中内容。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NovelReview = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function lines(text) { return String(text).match(/[^\n]*\n|[^\n]+$/g) || []; }
  function diff(before, after) {
    const a = lines(before), b = lines(after);
    let start = 0, ae = a.length, be = b.length;
    while (start < ae && start < be && a[start] === b[start]) start++;
    while (ae > start && be > start && a[ae - 1] === b[be - 1]) { ae--; be--; }
    if (start === ae && start === be) return { hunks: [], coarse: false };
    const n = ae - start, m = be - start, trace = [], v = new Map([[1, 0]]);
    let work = 0, ops = null;
    // ponytail: 差异过大时合并为一个明确标记的区间，避免审阅页面占满内存。
    outer: for (let d = 0; d <= n + m; d++) {
      work += v.size;
      if (work > 250000) break;
      trace.push(new Map(v));
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && (v.get(k - 1) ?? -Infinity) < (v.get(k + 1) ?? -Infinity))
          ? (v.get(k + 1) || 0) : (v.get(k - 1) || 0) + 1;
        let y = x - k;
        while (x < n && y < m && a[start + x] === b[start + y]) { x++; y++; }
        v.set(k, x);
        if (x >= n && y >= m) {
          ops = []; x = n; y = m;
          for (let depth = trace.length - 1; depth >= 0; depth--) {
            const prev = trace[depth], diagonal = x - y;
            const pk = diagonal === -depth || (diagonal !== depth && (prev.get(diagonal - 1) ?? -Infinity) < (prev.get(diagonal + 1) ?? -Infinity)) ? diagonal + 1 : diagonal - 1;
            const px = prev.get(pk) || 0, py = px - pk;
            while (x > px && y > py) { ops.push('equal'); x--; y--; }
            if (!depth) break;
            if (x === px) { ops.push('add'); y--; } else { ops.push('remove'); x--; }
          }
          ops.reverse(); break outer;
        }
      }
    }
    if (!ops) return { hunks: [{ oldStart:start, oldEnd:ae, newStart:start, newEnd:be, removed:a.slice(start,ae), added:b.slice(start,be) }], coarse:true };
    const hunks = [];
    let ai = start, bi = start, hunk = null;
    for (const op of ops) {
      if (op === 'equal') { hunk = null; ai++; bi++; continue; }
      if (!hunk) { hunk = { oldStart:ai, oldEnd:ai, newStart:bi, newEnd:bi, removed:[], added:[] }; hunks.push(hunk); }
      if (op === 'remove') { hunk.removed.push(a[ai++]); hunk.oldEnd = ai; }
      else { hunk.added.push(b[bi++]); hunk.newEnd = bi; }
    }
    return { hunks, coarse:false };
  }
  function apply(before, after, selected) {
    const { hunks } = diff(before, after);
    if (!Array.isArray(selected) || !selected.length) throw new Error('请至少选择一段改动');
    const choices = new Map();
    for (const item of selected) {
      if (!item || !Number.isInteger(item.index) || item.index < 0 || item.index >= hunks.length || choices.has(item.index)) throw new Error('无效或重复的改动段');
      if (item.content !== undefined && typeof item.content !== 'string') throw new Error('改动内容必须是文本');
      choices.set(item.index, item.content);
    }
    const result = lines(before);
    for (let i = hunks.length - 1; i >= 0; i--) {
      if (!choices.has(i)) continue;
      const h = hunks[i];
      result.splice(h.oldStart, h.oldEnd - h.oldStart, choices.get(i) ?? h.added.join(''));
    }
    return { content:result.join(''), selectedCount:choices.size, hunkCount:hunks.length };
  }
  return { diff, apply };
});
