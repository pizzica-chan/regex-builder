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
const langs = ['python', 'java', 'php', 'cs', 'go', 'sakura', 'ere', 'bre'];

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
    found = ctx.MatchCore.findAll(t.source, t.flags, c.s, 100, undefined, null, ctx.RegexDialects.emptyMode(lang), t.program).matches;
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
};
KNOWN['\\pN'] = 'サクラエディタは \\pN を誤りにしないが、Unicode の性質としては読まない。このツールは \\p{N} と書くよう知らせる';
KNOWN['\\PL'] = '同上';
// Python・Java・C# の、大文字と小文字を区別しない後方参照は、言語ごとの決まりで比べる。テストの欄は JavaScript の i フラグで比べる（注意を出す）
KNOWN['(В)\\1'] = 'この言語の大文字と小文字を区別しない後方参照は ᲀ と В を別とみなすが、テストの欄は JavaScript の i フラグで比べる（テストの欄で注意を出す）';
// GNU grep -i の後方参照は、ȿ（2 バイト）のように大文字（Ȿ、3 バイト）にするとバイト数が増える 18 文字で、行によって結果が変わる。
// (ȿ)\1 は「ȿȿ」だけの行には一致しないが、「aȿȿ」の中の ȿȿ には一致する。(.).\1 は「ⱾⱾȿ」に一致しないが、決して一致しない |q を足した
// (.).\1|q は一致する。結果が正規表現の意味ではなく glibc の内部の大きさで変わるので、glibc の欠陥。ツールは、意味どおりにどれにも一致させる
KNOWN['(ȿ)\\1'] = 'GNU grep -i の後方参照は、大文字にするとバイト数が増える 18 文字（ȿ など）で、正規表現の意味と関係なく結果が変わる（glibc の欠陥。docs/dialects/posix.md）';
// Java は、英字だけに効く指定なので Ȿ と ȿ を別とみなすが、テストの欄は後方参照があるので英字以外も区別しない（注意を出す）
const JAVA_REF = 'Java の大文字と小文字を区別しない指定は英字だけに効くが、後方参照があるので、テストの欄では英字以外も区別しない（テストの欄で注意を出す）';
KNOWN['(.).\\1'] = `POSIX: ${KNOWN['(ȿ)\\1']}。${JAVA_REF}`;
KNOWN['(.).\\1|q'] = JAVA_REF;
KNOWN['\\x{1F600}??'] = 'Java は長さ 0 の一致のあと UTF-16 の 1 単位だけ進むので、絵文字の途中にも長さ 0 の一致が出る';
// サクラエディタの調べる道具（probe-sakura.ps1）は、文字列の末尾から探せないので、前の一致が末尾で終わったあとの、末尾の長さ 0 の一致を調べられない。
// ツールの結果の最後がその一致で、それを除くと同じときだけ、わかっている違いとする（その直前の長さ 0 の一致は、末尾に U+0001 を足した事例で確かめている）
const SAKURA_END = 'サクラエディタの調べる道具は、文字列の末尾の長さ 0 の一致を調べられない（probe-sakura.ps1 のコメント）。それを除くと同じ';
const KNOWN_LANGS = { '(ȿ)\\1': ['ere', 'bre'], '(.).\\1': ['ere', 'bre', 'java'], '(.).\\1|q': ['java'], '(В)\\1': ['python', 'java', 'cs'], '\\x{1F600}??': ['java'], '😀+': ['cs'], '^.$': ['cs'], '\\pN': ['sakura'], '\\PL': ['sakura'] };
// C# の文字クラスの引き算（[a-z-[aeiou]]）は、Java とサクラエディタでは入れ子の文字クラスとして読まれる
for (const p of ['[a-z-[aeiou]]+', '[^a-[b]]+', '[\\w-[\\d]]+', '[[=e=][.-.]]']) {
  KNOWN[p] = 'Java とサクラエディタでは入れ子の文字クラスとして読まれる。このツールは入れ子に対応していないので、書き方の誤りにしている';
  KNOWN_LANGS[p] = ['java', 'sakura'];
}
for (const p of ['(?i:[[:lower:]])', '(?i:[[:^lower:]])', '(?i:[\\p{L}-[\\p{Lu}]])', '[[:upper:]]']) {
  KNOWN[p] = 'Java では入れ子の文字クラスとして読まれる。このツールは入れ子に対応していないので、書き方の誤りにしている';
  KNOWN_LANGS[p] = ['java'];
}
// [[:upper:]] なども、[[:alpha:]] と同じ
for (const name of ['alpha', 'digit', 'upper', 'lower', 'alnum', 'word', 'punct', 'space', 'blank', 'cntrl', 'xdigit', 'graph', 'print']) {
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
      const len = [...c.s].length;
      const last = Array.isArray(got) && got[got.length - 1];
      if (lang === 'sakura' && Array.isArray(want) && last && last[0] === len && last[1] === len && JSON.stringify(want) === JSON.stringify(got.slice(0, -1))) {
        known.push(`${lang} /${c.p}/${c.f} ${JSON.stringify(c.s)}: ${SAKURA_END}`);
        return;
      }
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
