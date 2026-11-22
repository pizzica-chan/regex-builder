// cases.json の各正規表現について、各言語の処理系の結果（results/match-<言語>.json）と、
// このツールで JavaScript に置き換えて動かした結果を比べる。位置はコードポイント単位にそろえて比べる。
// 使い方: node verify.js
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
const { RegexTranslate } = ctx;

const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));
const langs = ['python', 'java', 'php', 'cs', 'go', 'sakura'];

const toCp = (s, unit) => (pos) => {
  if (unit === 'cp') return pos;
  if (unit === 'utf16') return [...s.slice(0, pos)].length;
  return [...Buffer.from(s, 'utf8').subarray(0, pos).toString('utf8')].length;
};

function ours(c, lang) {
  let t;
  try {
    t = RegexTranslate.translate(c.p, `${c.f}g`, lang);
  } catch (e) {
    return e instanceof ctx.RegexTranslate.Untranslatable ? `試せない: ${e.message}` : 'E';
  }
  const re = new RegExp(t.source, t.flags);
  const conv = toCp(c.s, 'utf16');
  return [...c.s.matchAll(re)].slice(0, 100).map((m) => [conv(m.index), conv(m.index + m[0].length)]);
}

// わかっている違い。JavaScript の正規表現では再現できないため、画面で注意を出している
const KNOWN = {
  '(a)?\\1b': '一致しなかったグループの参照は、この言語では失敗するが、JavaScript では空文字列として一致する（試す欄で注意を出す）',
  '[[:alpha:]]+': 'Java では入れ子の文字クラスとして読まれる。このツールは入れ子に対応していないので、書き方の誤りにしている',
  '[[:digit:]]+': '同上',
  '😀+': 'C# は絵文字などを 2 文字として数える（試す文字列に絵文字があると、試す欄で注意を出す）',
  '^.$': '同上',
};
const KNOWN_LANGS = { '[[:alpha:]]+': ['java'], '[[:digit:]]+': ['java'], '😀+': ['cs'], '^.$': ['cs'] };
const known = [];

let total = 0;
let bad = 0;
const untestable = [];
for (const lang of langs) {
  const file = path.join(__dirname, 'results', `match-${lang}.json`);
  if (!fs.existsSync(file)) { console.log(`${lang}: 結果のファイルがありません`); continue; }
  const engine = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  cases.forEach((c, k) => {
    total++;
    const raw = engine.results[k];
    const want = raw === 'E' ? 'E' : raw.map(([a, b]) => [toCp(c.s, engine.unit)(a), toCp(c.s, engine.unit)(b)]);
    const got = ours(c, lang);
    if (typeof got === 'string' && got.startsWith('試せない')) { untestable.push(`${lang} /${c.p}/${c.f}: ${got}`); return; }
    if (JSON.stringify(want) !== JSON.stringify(got)) {
      if (KNOWN[c.p] && (!KNOWN_LANGS[c.p] || KNOWN_LANGS[c.p].includes(lang))) {
        known.push(`${lang} /${c.p}/${c.f}: ${KNOWN[c.p]}`);
        return;
      }
      bad++;
      console.log(`違う ${lang.padEnd(6)} /${c.p}/${c.f}  ${JSON.stringify(c.s)}\n    処理系: ${JSON.stringify(want)}\n    ツール: ${JSON.stringify(got)}`);
    }
  });
}
for (const u of untestable) console.log(`試せない ${u}`);
for (const k of known) console.log(`わかっている違い ${k}`);
console.log(`${total} 通りのうち、違う結果 ${bad}、わかっている違い ${known.length}、試せない ${untestable.length}`);
process.exitCode = bad ? 1 : 0;
