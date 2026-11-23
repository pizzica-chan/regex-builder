/*
 * テスト文字列との一致を調べる処理。ワーカー（match-worker.js）と画面（app.js）の両方から使う。
 * 結果は構造化複製（ワーカーとの受け渡し）できる形にする。
 */
(function (global) {
  'use strict';

  // ranges は各グループの [開始, 終了]。一致しなかったグループは null。
  // groupMap を渡すと、元の正規表現のグループ番号（1 から）に並べ直す。
  // JavaScript 以外の言語を置き換えて動かすとき、グループが増えたり番号がずれたりするため（translate.js）
  function pack(m, groupMap) {
    const order = groupMap ? groupMap.slice(1) : null;
    const pick = (arr, fallback) => (order ? order.map((j) => (j == null ? fallback : arr[j])) : arr.slice(1));
    return {
      index: m.index,
      text: m[0],
      groups: pick(m, undefined),
      ranges: m.indices ? pick(m.indices, null).map((r) => r || null) : null,
    };
  }

  // d フラグを足して、グループの位置も取る。d フラグが使えない環境では位置なしで調べる
  function compile(source, flags) {
    if (!flags.includes('d')) {
      try { return new RegExp(source, flags + 'd'); } catch (_) { /* 下で作り直す */ }
    }
    return new RegExp(source, flags);
  }

  // 長さ 0 の一致のあとの探し方は、言語によって違う（emptyMode）。
  // '': JavaScript と同じく、1 文字進めて探す（Java、C#、サクラエディタも同じ）
  // 'retry': Python と PHP。同じ位置から長さ 1 以上の一致を探し、なければ 1 文字進める（a?? は a にも一致する）
  // 'skip': Go。前の一致のすぐあとの長さ 0 の一致は数えない（x* を axx に使うと、末尾の空の一致はない）
  function findAllEmptyAware(re, source, flags, text, max, groupMap, emptyMode) {
    const matches = [];
    const unicode = re.unicode || re.unicodeSets;
    let prevEnd = -1;
    let m;
    re.lastIndex = 0;
    while (matches.length < max && (m = re.exec(text))) {
      if (m[0] !== '') {
        matches.push(pack(m, groupMap));
        prevEnd = re.lastIndex;
        continue;
      }
      const at = m.index;
      if (!(emptyMode === 'skip' && at === prevEnd)) matches.push(pack(m, groupMap));
      prevEnd = at;
      if (emptyMode === 'retry' && matches.length < max) {
        // 終わりの位置が at より後ろであること（長さ 1 以上）を、後読みで確かめる。
        // u と v フラグでは [^] が絵文字などを 1 文字と数えるので、at までの文字数をコードポイントで数える
        const before = unicode ? [...text.slice(0, at)].length : at;
        const ne = compile(`(?:${source})(?<=[^]{${before + 1}})`, `${flags.replace(/[gy]/g, '')}y`);
        ne.lastIndex = at;
        const n = ne.exec(text);
        if (n && n[0] !== '') {
          matches.push(pack(n, groupMap));
          prevEnd = ne.lastIndex;
          re.lastIndex = ne.lastIndex;
          continue;
        }
      }
      const step = unicode && text.codePointAt(at) > 0xffff ? 2 : 1;
      re.lastIndex = at + step;
      if (re.lastIndex > text.length) break;
    }
    return matches;
  }

  // lines を渡すと、各行を別々の文字列として調べ、一致したかを lineHits に入れる
  function findAll(source, flags, text, max, lines, groupMap, emptyMode = '') {
    const re = compile(source, flags);
    let matches = [];
    if (re.global && emptyMode) {
      matches = findAllEmptyAware(re, source, flags, text, max, groupMap, emptyMode);
    } else if (re.global) {
      for (const m of text.matchAll(re)) {
        matches.push(pack(m, groupMap));
        if (matches.length >= max) break;
      }
    } else {
      const m = re.exec(text);
      if (m) matches.push(pack(m, groupMap));
    }
    let lineHits = null;
    if (lines) {
      const one = new RegExp(source, flags.replace(/[gy]/g, ''));
      lineHits = lines.map((line) => one.test(line));
    }
    return { matches, lineHits };
  }

  global.MatchCore = { findAll };
})(typeof window !== 'undefined' ? window : self);
