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
// 一致の探し方（長さ 0 の一致のあとの扱い）は、画面と同じ match-core.js で調べる
for (const f of ['dialects.js', 'regex-explain.js', 'translate.js', 'match-core.js']) {
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
  let found;
  try {
    found = ctx.MatchCore.findAll(t.source, t.flags, c.s, 100, undefined, null, ctx.RegexDialects.emptyMode(lang)).matches;
  } catch (e) {
    return `置き換えた正規表現を JavaScript が受け付けない: ${e.message}`;
  }
  const conv = toCp(c.s, 'utf16');
  return found.map((m) => [conv(m.index), conv(m.index + m.text.length)]);
}

// わかっている違い。JavaScript の正規表現では再現できないため、画面で注意を出している
const KNOWN = {
  '(a)?\\1b': '一致しなかったグループの参照は、この言語では失敗するが、JavaScript では空文字列として一致する（テストの欄で注意を出す）',
  '[[:alpha:]]+': 'Java では入れ子の文字クラスとして読まれる。このツールは入れ子に対応していないので、書き方の誤りにしている',
  '😀+': 'C# は絵文字などを 2 文字として数える（テスト文字列に絵文字があると、テストの欄で注意を出す）',
  '^.$': '同上',
  'x(?i:k)|(?i:s)y': 'C# の大文字と小文字を区別しない指定は、ſ（U+017F）を s と同じとみなさない。テストの欄（JavaScript）は同じとみなす',
};
KNOWN['(?i)ı'] = 'Python の大文字と小文字を区別しない指定は、ı（U+0131）を i と同じとみなす。テストの欄（JavaScript）は同じとみなさない';
KNOWN['\\pN'] = 'サクラエディタは \\pN を誤りにしないが、Unicode の性質としては読まない。このツールは \\p{N} と書くよう知らせる';
KNOWN['\\PL'] = '同上';
// サクラエディタの調べる道具（probe-sakura.ps1）は、文字列の末尾の長さ 0 の一致を調べられない
for (const p of ['a??', 'x*', '|x', 'a*|b']) KNOWN[p] = 'サクラエディタの調べる道具は、文字列の末尾の長さ 0 の一致を調べられない（probe-sakura.ps1 のコメント）';
KNOWN['\\x{1F600}??'] = 'Java は長さ 0 の一致のあと UTF-16 の 1 単位だけ進むので、絵文字の途中にも長さ 0 の一致が出る。サクラエディタは上と同じ（末尾の長さ 0 の一致）';
const KNOWN_LANGS = { 'a??': ['sakura'], 'x*': ['sakura'], '|x': ['sakura'], 'a*|b': ['sakura'], '\\x{1F600}??': ['java', 'sakura'], '😀+': ['cs'], '^.$': ['cs'], 'x(?i:k)|(?i:s)y': ['cs'], '(?i)ı': ['python'], '\\pN': ['sakura'], '\\PL': ['sakura'] };
// [[:upper:]] なども、[[:alpha:]] と同じ
for (const name of ['alpha', 'digit', 'upper', 'lower', 'alnum', 'word', 'punct', 'space', 'blank', 'cntrl', 'xdigit']) {
  KNOWN[`[[:${name}:]]+`] = name === 'alpha'
    ? 'Java では入れ子の文字クラスとして読まれる。このツールは入れ子に対応していないので、書き方の誤りにしている'
    : '同上';
  KNOWN_LANGS[`[[:${name}:]]+`] = ['java'];
}
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
