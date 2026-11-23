// 「ほかの言語で使うと」（translate.js の portability）の「同じ意味」の判定を、処理系の実際の結果で確かめる。
// cases.json の各正規表現について、言語 A から見た言語 B の判定が「同じ意味」なのに、A と B の処理系の一致が違うものを出す。
// 処理系の結果は results/match-<言語>.json（run-all.ps1 で作る）。JavaScript は、この道具を動かす Node.js で調べる。
// 使い方: node verify-portability.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const ctx = { console };
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['dialects.js', 'regex-explain.js', 'translate.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx);
}

const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));
const langs = ['js', 'python', 'java', 'php', 'cs', 'ps', 'go', 'sakura', 'ere', 'bre'];
const toCp = (s, unit) => (pos) => {
  if (unit === 'cp') return pos;
  if (unit === 'utf16') return [...s.slice(0, pos)].length;
  return [...Buffer.from(s, 'utf8').subarray(0, pos).toString('utf8')].length;
};
const engine = {};
for (const l of langs.filter((x) => x !== 'js')) {
  engine[l] = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', `match-${l}.json`), 'utf8').replace(/^﻿/, ''));
}

// 一致の位置（コードポイント単位）。書き方の誤りなら 'E'
function result(l, k) {
  const c = cases[k];
  if (l === 'js') {
    try {
      const re = new RegExp(c.p, `${c.f}g`);
      const cp = (u) => [...c.s.slice(0, u)].length;
      return [...c.s.matchAll(re)].slice(0, 100).map((m) => [cp(m.index), cp(m.index + m[0].length)]);
    } catch (_) {
      return 'E';
    }
  }
  const raw = engine[l].results[k];
  return raw === 'E' ? 'E' : raw.map(([a, b]) => [toCp(c.s, engine[l].unit)(a), toCp(c.s, engine[l].unit)(b)]);
}

// サクラエディタの調べる道具は、文字列の末尾の長さ 0 の一致を調べられない（probe-sakura.ps1 のコメント）。
// 一方の最後がその一致で、それを除くと同じなら、違いとしない
const sakuraEnd = (a, b, len) => {
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  const last = long[long.length - 1];
  return long.length === short.length + 1 && last[0] === len && last[1] === len && JSON.stringify(long.slice(0, -1)) === JSON.stringify(short);
};

let checked = 0;
let bad = 0;
cases.forEach((c, k) => {
  for (const from of langs) {
    let list;
    try {
      list = ctx.RegexTranslate.portability(c.p, `${c.f}g`, from);
    } catch (_) {
      continue; // この言語では書けない正規表現
    }
    const a = result(from, k);
    if (a === 'E') continue;
    for (const r of list) {
      if (r.status !== 'same') continue;
      checked++;
      const b = result(r.dialect, k);
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      if ((from === 'sakura' || r.dialect === 'sakura') && b !== 'E' && sakuraEnd(a, b, [...c.s].length)) continue;
      bad++;
      console.log(`違う /${c.p}/${c.f} ${JSON.stringify(c.s)}: ${from} から見た ${r.dialect} は「同じ意味」だが、処理系の一致が違う\n    ${from}: ${JSON.stringify(a)}\n    ${r.dialect}: ${JSON.stringify(b)}`);
    }
  }
});
console.log(`「同じ意味」の ${checked} 組のうち、処理系の一致が違う組 ${bad}`);
process.exitCode = bad ? 1 : 0;
