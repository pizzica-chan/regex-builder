/*
 * 試す文字列と正規表現の一致を、画面とは別のスレッドで調べる。
 * 計算が終わらない正規表現でも、画面側（app.js）がこのワーカーを止めれば画面は固まらない。
 */
'use strict';

function pack(m) {
  return { index: m.index, text: m[0], groups: m.slice(1) };
}

self.onmessage = (e) => {
  const { id, source, flags, text, max } = e.data;
  try {
    const re = new RegExp(source, flags);
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
    self.postMessage({ id, matches });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message) });
  }
};
