/*
 * 試す文字列と正規表現の一致を、画面とは別のスレッドで調べる。
 * 計算が終わらない正規表現でも、画面側（app.js）がこのワーカーを止めれば画面は固まらない。
 */
'use strict';

importScripts('match-core.js');

self.onmessage = (e) => {
  const { id, source, flags, text, max, lines } = e.data;
  try {
    const { matches, lineHits } = self.MatchCore.findAll(source, flags, text, max, lines);
    self.postMessage({ id, matches, lineHits });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message) });
  }
};
