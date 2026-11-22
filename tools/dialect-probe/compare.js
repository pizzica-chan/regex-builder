// 各言語の結果（<言語>.json）を読み、試した正規表現ごとの表と、\d \w \s . の文字の集まりの違いを出す
// 使い方: node compare.js <結果のフォルダ>
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const langs = ['js', 'python', 'java', 'php', 'cs', 'go', 'sakura'].filter((l) => fs.existsSync(path.join(dir, `${l}.json`)));
const read = (l) => JSON.parse(fs.readFileSync(path.join(dir, `${l}.json`), 'utf8').replace(/^﻿/, ''));
const data = Object.fromEntries(langs.map((l) => [l, read(l)]));

for (const l of langs) console.log(`${l.padEnd(7)} ${data[l].engine}`);
console.log('');
console.log(`${'probe'.padEnd(22)} ${langs.map((l) => l.padEnd(6)).join(' ')}`);
for (const id of Object.keys(data.js.probes)) {
  console.log(`${id.padEnd(22)} ${langs.map((l) => (data[l].probes[id] || '-').padEnd(6)).join(' ')}`);
}

const count = (rs) => rs.reduce((n, [a, b]) => n + b - a + 1, 0);
const has = (rs, cp) => rs.some(([a, b]) => a <= cp && cp <= b);
const hex = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
console.log('');
for (const cls of Object.keys(data.js.classes)) {
  console.log(`== ${cls}`);
  for (const l of langs) {
    const rs = data[l].classes[cls];
    if (!rs) { console.log(`  ${l.padEnd(7)} -`); continue; }
    const head = rs.slice(0, 8).map(([a, b]) => (a === b ? hex(a) : `${hex(a)}-${hex(b)}`)).join(' ');
    console.log(`  ${l.padEnd(7)} ${String(count(rs)).padStart(6)}文字  ${head}${rs.length > 8 ? ' …' : ''}`);
  }
  // 代表的な文字が含まれるか
  const samples = { '０': 0xff10, 'あ': 0x3042, '漢': 0x6f22, '全角SP': 0x3000, 'VT': 0x0b, 'U+1C': 0x1c, 'NEL': 0x85, 'NBSP': 0xa0, 'BOM': 0xfeff, 'CR': 0x0d, 'LS': 0x2028, '‿': 0x203f, '◌̀': 0x0300, '²': 0xb2 };
  console.log(`  ${''.padEnd(7)} ${Object.keys(samples).map((k) => k.padEnd(5)).join('')}`);
  for (const l of langs) {
    const rs = data[l].classes[cls];
    if (!rs) continue;
    console.log(`  ${l.padEnd(7)} ${Object.values(samples).map((cp) => (has(rs, cp) ? '○' : '-').padEnd(5)).join('')}`);
  }
}
