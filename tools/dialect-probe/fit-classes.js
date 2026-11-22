// 各言語の \d \w \s を、JavaScript の u フラグの書き方でどう書けば同じ文字の集まりになるかを確かめる。
// 候補の書き方ごとに、BMP（U+0000〜U+FFFF）で各言語の結果と食い違う文字を数える。
// 使い方: node fit-classes.js <結果のフォルダ>
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const read = (l) => JSON.parse(fs.readFileSync(path.join(dir, `${l}.json`), 'utf8').replace(/^﻿/, ''));
const langs = ['js', 'python', 'java', 'php', 'cs', 'go', 'sakura'];
const data = Object.fromEntries(langs.map((l) => [l, read(l)]));

const setOf = (rs) => {
  const s = new Uint8Array(0x10000);
  for (const [a, b] of rs) for (let c = a; c <= b; c++) s[c] = 1;
  return s;
};
const hex = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

function check(lang, cls, expr) {
  const want = setOf(data[lang].classes[cls]);
  const re = new RegExp(`^(?:${expr})$`, 'u');
  const extra = [];
  const missing = [];
  for (let cp = 0; cp <= 0xffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const got = re.test(String.fromCharCode(cp)) ? 1 : 0;
    if (got && !want[cp]) extra.push(cp);
    if (!got && want[cp]) missing.push(cp);
  }
  const show = (a) => a.slice(0, 12).map(hex).join(' ') + (a.length > 12 ? ' …' : '');
  console.log(`${lang.padEnd(7)} ${cls.padEnd(3)} ${expr}\n        多い ${extra.length}: ${show(extra)}\n        足りない ${missing.length}: ${show(missing)}`);
}

const candidates = JSON.parse(process.argv[3] || 'null') || [
  ['python', '\\d', '\\p{Nd}'],
  ['php', '\\d', '\\p{Nd}'],
  ['cs', '\\d', '\\p{Nd}'],
  ['sakura', '\\d', '\\p{Nd}'],
  ['python', '\\w', '[\\p{L}\\p{N}_]'],
  ['php', '\\w', '[\\p{L}\\p{N}_]'],
  ['cs', '\\w', '[\\p{L}\\p{Mn}\\p{Nd}\\p{Pc}]'],
  ['sakura', '\\w', '[\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}]'],
  ['python', '\\s', '[\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]'],
  ['php', '\\s', '[\\t-\\r\\x20\\x85\\xa0\\u1680\\u180e\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]'],
  ['cs', '\\s', '[\\t-\\r\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]'],
  ['sakura', '\\s', '[\\t-\\r\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]'],
  ['java', '\\s', '[\\t-\\r\\x20]'],
  ['go', '\\s', '[\\t\\n\\f\\r\\x20]'],
  ['js', '\\s', '\\s'],
];
for (const [l, c, e] of candidates) check(l, c, e);
