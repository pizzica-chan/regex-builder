// 無作為に作った正規表現と文字列を各言語の処理系で動かし、「テスト」の欄（translate.js と match-core.js）と比べる。
// 人が選んだ事例（cases.json）では見落としやすい組み合わせを探すための道具。作ったものと結果は fuzz/ に置く（Git の対象外）。
//
// 使い方（このフォルダで）:
//   1. 事例を作る:       node fuzz.js gen <種> <件数> [--wide] [--ext] [--case] [--plain]
//      POSIX の事例を作る: node fuzz.js posix <種> <件数>
//   2. 処理系で動かす:   pwsh -File run-all.ps1 -CasesPath fuzz/cases.json -ResultsDir fuzz/results -NoVerify
//      POSIX の事例:      node match-grep.js ere fuzz/cases-ere.json > fuzz/results/posix-ere.json（bre も同じ）
//   3. 比べる:           node fuzz.js diff
// 種を決めているので、同じ事例を作り直せる。
// --wide: 大文字と小文字や空白、絵文字などの、言語で扱いの違う文字を多く使う
// --ext:  一部の言語だけの書き方（アトミックグループ、強欲な繰り返し、\A \Z \z、(?i)、(?i:…)、\h、\R、\x{…}、名前付きグループ）も使う
// --case: 大文字と小文字の扱いが言語で違う文字（ς σ、ß と ss、ı İ、ſ、ケルビン記号など）を多く使い、i フラグを多めに付ける
// --plain: --ext と一緒に使うときに、一部の言語だけの書き方を使わない
// 比べるときは、ツールが「テスト」の欄に注意を出した事例を、注意で知らせている違いとして分けて数える。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const dir = path.join(__dirname, 'fuzz');
const [cmd, ...args] = process.argv.slice(2);
const opt = (name) => args.includes(`--${name}`);

// ---------- 作る ----------

function rng(seed) {
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  return { rand, pick: (xs) => xs[Math.floor(rand() * xs.length)] };
}

const CASE_CHARS = ['ς', 'σ', 'Σ', 'ß', 'ẞ', 'ı', 'İ', 'i', 'I', 'µ', 'μ', 'ﬀ', 'ſ', 'K', 'k', 'ǅ', 'Ǆ', 'ǆ', 'é', 'É'];

function genCases(seed, count) {
  const { rand, pick } = rng(seed);
  const ext = opt('ext') && !opt('plain');
  let lits = opt('wide') ? ['a', 'é', 'É', 's', 'K', 'ǅ', 'ǆ', '😀', 'あ', '１', '\\.'] : ['a', 'b', 'A', '1', 'あ', ' ', '-', '\\.'];
  let chars = opt('wide')
    ? ['a', 'A', 'é', 'É', 's', 'S', 'ſ', 'k', 'K', 'K', 'ǅ', 'Ǆ', 'ǆ', ' ', '　', ' ', '\u0085', '😀', 'あ', '１', '1', ' ', '\n', '\r', '.']
    : ['a', 'b', 'A', 'B', '1', 'あ', ' ', '\n', '-', '.', '\r'];
  if (opt('case')) {
    lits = [...CASE_CHARS, 'a', '\\.'];
    chars = [...CASE_CHARS, 'a', 'ss', 'SS', 'ff', ' ', '\n'];
  }
  const classes = ['\\d', '\\w', '\\s', '\\D', '\\W', '\\S', '.', '[ab]', '[^a]', '[a-z]', '[0-9A]', '[^\\s]', ...(ext ? ['\\h', '\\R', '\\x{3042}', '\\x{41}'] : [])];
  const anchors = ['^', '$', '\\b', '\\B', ...(ext ? ['\\A', '\\Z', '\\z'] : [])];
  const quants = ['', '', '', '*', '+', '?', '{1,2}', '{2}', '{0,1}', ...(ext ? ['*+', '++', '?+', '{1,2}+'] : [])];
  function gen() {
    let groups = 0;
    const closed = [];
    function atom(depth) {
      const r = rand();
      if (r < 0.3) return { s: pick(lits), q: true };
      if (r < 0.55) return { s: pick(classes), q: true };
      if (r < 0.65) return { s: pick(anchors), q: false };
      if (r < 0.8 && depth < 2) {
        const kind = ext ? pick(['cap', 'cap', 'named', 'non', 'atomic', 'flag']) : pick(['cap', 'cap', 'non']);
        const n = kind === 'cap' || kind === 'named' ? ++groups : 0;
        const body = alt(depth + 1);
        if (n) closed.push(n);
        const open = { cap: '(', named: `(?<g${n}>`, non: '(?:', atomic: '(?>', flag: `(?${pick(['i', 's', 'm', '-i', 'i-s'])}:` }[kind];
        return { s: `${open}${body})`, q: true };
      }
      if (r < 0.86 && depth < 2) return { s: `(?${pick(['=', '!'])}${seq(depth + 1)})`, q: false };
      if (r < 0.9) return { s: `(?<${pick(['=', '!'])}${pick(['a', '[ab]', '\\d', 'a ', '\\s'])})`, q: false };
      if (r < 0.95 && closed.length) return { s: ext && rand() < 0.5 ? `\\k<g${pick(closed)}>` : `\\${pick(closed)}`, q: true };
      return { s: pick(lits), q: true };
    }
    function seq(depth) {
      let out = '';
      const n = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const a = atom(depth);
        let q = a.q ? pick(quants) : '';
        if (q && !q.endsWith('+') && rand() < 0.25) q += '?';
        out += a.s + q;
      }
      return out;
    }
    function alt(depth) {
      return rand() < 0.25 ? `${seq(depth)}|${seq(depth)}` : seq(depth);
    }
    const body = alt(0);
    return ext && rand() < 0.15 ? `(?${pick(['i', 'm', 's', 'im'])})${body}` : body;
  }
  const out = [];
  for (let k = 0; k < count; k++) {
    const p = gen();
    const f = opt('case') ? pick(['i', 'i', 'i', '', 'im', 'is']) : pick(['', '', 'i', 'm', 's', 'im', 'is']);
    let s = '';
    const len = Math.floor(rand() * 12);
    for (let j = 0; j < len; j++) s += pick(chars);
    out.push({ p, f, s });
  }
  return out;
}

// POSIX の ERE の書き方で作る。BRE は、同じ正規表現の ( ) { } + ? | に \ を付けたもの（GNU の書き方）
function genPosix(seed, count) {
  const { rand, pick } = rng(seed);
  const lits = ['a', 'b', 'A', 'B', '1', 'あ', 'é', ' ', '-', '\\.'];
  const classes = ['.', '[ab]', '[^a]', '[a-z]', '[[:alpha:]]', '[[:digit:]]', '[[:upper:]]', '[[:space:]]', '[^[:alnum:]]', '[]a]', '[a-]', '\\w', '\\W', '\\s', '\\S'];
  const anchors = ['^', '$', '\\b', '\\B', '\\<', '\\>'];
  const quants = ['', '', '', '*', '+', '?', '{1,2}', '{2}', '{0,1}', '{,2}', '{1,}'];
  function gen() {
    let groups = 0;
    const closed = [];
    function atom(depth) {
      const r = rand();
      if (r < 0.3) return { s: pick(lits), q: true };
      if (r < 0.58) return { s: pick(classes), q: true };
      if (r < 0.68) return { s: pick(anchors), q: false };
      if (r < 0.88 && depth < 2) {
        const n = ++groups;
        const body = alt(depth + 1);
        closed.push(n);
        return { s: `(${body})`, q: true };
      }
      if (r < 0.95 && closed.some((x) => x < 10)) return { s: `\\${pick(closed.filter((x) => x < 10))}`, q: true };
      return { s: pick(lits), q: true };
    }
    function seq(depth) {
      let out = '';
      const n = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const a = atom(depth);
        out += a.s + (a.q ? pick(quants) : '');
      }
      return out;
    }
    function alt(depth) {
      return rand() < 0.3 ? `${seq(depth)}|${seq(depth)}` : seq(depth);
    }
    return alt(0);
  }
  const chars = ['a', 'b', 'A', 'B', '1', 'あ', 'é', 'É', ' ', '-', '.', '_', '\t', '\n'];
  const out = [];
  for (let k = 0; k < count; k++) {
    const p = gen();
    const f = pick(['', '', '', 'i']);
    let s = '';
    const len = Math.floor(rand() * 12);
    for (let j = 0; j < len; j++) s += pick(chars);
    out.push({ p, f, s });
  }
  return out;
}

function toBre(p) {
  let out = '';
  for (let k = 0; k < p.length;) {
    const c = p[k];
    if (c === '\\') { out += p.slice(k, k + 2); k += 2; continue; }
    if (c === '[') {
      let e = k + 1;
      if (p[e] === '^') e++;
      if (p[e] === ']') e++;
      while (e < p.length && p[e] !== ']') e = p.startsWith('[:', e) ? p.indexOf(':]', e) + 2 : e + 1;
      out += p.slice(k, e + 1);
      k = e + 1;
      continue;
    }
    out += '(){}+?|'.includes(c) ? `\\${c}` : c;
    k++;
  }
  return out;
}

// Match.java の簡単な読み取りに合わせて、1 行に 1 つずつ { "p": …, "f": …, "s": … } の形で書く
function writeCases(file, cases) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = cases.map((c) => `  { "p": ${JSON.stringify(c.p)}, "f": ${JSON.stringify(c.f)}, "s": ${JSON.stringify(c.s)} }`);
  fs.writeFileSync(path.join(dir, file), `[\n${lines.join(',\n')}\n]\n`);
}

// ---------- 比べる ----------

function loadTool() {
  const ctx = { console };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['dialects.js', 'regex-explain.js', 'translate.js', 'match-core.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx);
  return ctx;
}

const toCp = (s, unit) => (pos) => {
  if (unit === 'cp') return pos;
  if (unit === 'utf16') return [...s.slice(0, pos)].length;
  return [...Buffer.from(s, 'utf8').subarray(0, pos).toString('utf8')].length;
};

// 一致の位置（コードポイント単位）と、ツールが出す注意。書けないなら 'E'
function ours(c, lang, cs) {
  try {
    const t = c.RegexTranslate.translate(cs.p, `${cs.f}g`, lang);
    const notes = [...t.notes, ...c.RegexTranslate.textNotes(cs.s, lang, t.canBeEmpty)].filter((n) => !n.startsWith('グループの位置は'));
    const cp = (u) => [...cs.s.slice(0, u)].length;
    let found = c.MatchCore.findAll(t.source, t.flags, cs.s, 100, undefined, null, c.RegexDialects.emptyMode(lang), t.program).matches;
    // grep -o は長さ 0 の一致を出さない
    if (c.RegexDialects.isPosix(lang)) found = found.filter((m) => m.text.length);
    return { got: found.map((m) => [cp(m.index), cp(m.index + m.text.length)]), notes };
  } catch (e) {
    return { got: e instanceof c.RegexTranslate.Untranslatable ? `試せない: ${e.message}` : 'E', notes: [] };
  }
}

function compare(c, lang, cases, eng, stat) {
  cases.forEach((cs, k) => {
    const raw = eng.results[k];
    const want = raw === 'E' ? 'E' : raw.map(([a, b]) => [toCp(cs.s, eng.unit)(a), toCp(cs.s, eng.unit)(b)]);
    const { got, notes } = ours(c, lang, cs);
    stat.total++;
    if (JSON.stringify(want) === JSON.stringify(got)) return;
    // サクラエディタの調べる道具は、文字列の末尾の長さ 0 の一致を調べられない（probe-sakura.ps1 のコメント）
    if (lang === 'sakura' && Array.isArray(want) && Array.isArray(got)) {
      const len = [...cs.s].length;
      const last = got[got.length - 1];
      if (last && last[0] === len && last[1] === len && JSON.stringify(got.slice(0, -1)) === JSON.stringify(want)) return;
    }
    if (notes.length) { stat.noted++; return; }
    stat.bad++;
    console.log(`違う ${lang.padEnd(6)} #${k} /${cs.p}/${cs.f} ${JSON.stringify(cs.s)}\n    処理系: ${JSON.stringify(want)}\n    ツール: ${JSON.stringify(got)}`);
  });
}

function diff() {
  const c = loadTool();
  const stat = { total: 0, noted: 0, bad: 0 };
  const res = path.join(dir, 'results');
  const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
  const casesFile = path.join(dir, 'cases.json');
  if (fs.existsSync(casesFile)) {
    const cases = read(casesFile);
    for (const lang of ['python', 'java', 'php', 'cs', 'ps', 'go', 'sakura', 'ere', 'bre']) {
      const f = path.join(res, `match-${lang}.json`);
      if (fs.existsSync(f)) compare(c, lang, cases, read(f), stat);
    }
  }
  for (const lang of ['ere', 'bre']) {
    const f = path.join(res, `posix-${lang}.json`);
    const cf = path.join(dir, `cases-${lang}.json`);
    if (fs.existsSync(f) && fs.existsSync(cf)) compare(c, lang, read(cf), read(f), stat);
  }
  console.log(`${stat.total} 通りのうち、注意を出していない違い ${stat.bad}、注意を出した違い ${stat.noted}`);
  process.exitCode = stat.bad ? 1 : 0;
}

if (cmd === 'gen') {
  writeCases('cases.json', genCases(Number(args[0] || 1), Number(args[1] || 300)));
  console.log(`fuzz/cases.json に ${args[1] || 300} 件を書いた`);
} else if (cmd === 'posix') {
  const cases = genPosix(Number(args[0] || 1), Number(args[1] || 400));
  writeCases('cases-ere.json', cases);
  writeCases('cases-bre.json', cases.map((x) => ({ ...x, p: toBre(x.p) })));
  console.log(`fuzz/cases-ere.json と fuzz/cases-bre.json に ${cases.length} 件ずつ書いた`);
} else if (cmd === 'diff') {
  diff();
} else {
  console.log('使い方: node fuzz.js gen <種> <件数> [--wide] [--ext] [--case] [--plain] / node fuzz.js posix <種> <件数> / node fuzz.js diff');
  process.exitCode = 1;
}
