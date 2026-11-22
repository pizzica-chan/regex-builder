/*
 * 試す文字列との一致を調べる処理。ワーカー（match-worker.js）と画面（app.js）の両方から使う。
 * 結果は構造化複製（ワーカーとの受け渡し）できる形にする。
 */
(function (global) {
  'use strict';

  // ranges は各グループの [開始, 終了]。一致しなかったグループは null
  function pack(m) {
    return {
      index: m.index,
      text: m[0],
      groups: m.slice(1),
      ranges: m.indices ? m.indices.slice(1).map((r) => r || null) : null,
    };
  }

  // d フラグを足して、グループの位置も取る。d フラグが使えない環境では位置なしで調べる
  function compile(source, flags) {
    if (!flags.includes('d')) {
      try { return new RegExp(source, flags + 'd'); } catch (_) { /* 下で作り直す */ }
    }
    return new RegExp(source, flags);
  }

  // lines を渡すと、各行を別々の文字列として調べ、一致したかを lineHits に入れる
  function findAll(source, flags, text, max, lines) {
    const re = compile(source, flags);
    const matches = [];
    if (re.global) {
      for (const m of text.matchAll(re)) {
        matches.push(pack(m));
        if (matches.length >= max) break;
      }
    } else {
      const m = re.exec(text);
      if (m) matches.push(pack(m));
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
