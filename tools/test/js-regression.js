// JavaScript のモードの解析と説明が、基準の regex-explain.js と同じ結果になるかを確かめる。
// 使い方: node tools/test/js-regression.js <基準の regex-explain.js> [<比べる regex-explain.js>]
// 基準には、たとえば git show HEAD:regex-explain.js で取り出した変更前のファイルを渡す
const path = require('path');
const vm = require('vm');
const fs = require('fs');

function load(file, withDialects) {
  const ctx = { console };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  if (withDialects) vm.runInContext(fs.readFileSync(path.join(__dirname, '../../dialects.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
  return ctx.RegexExplain;
}

const base = load(process.argv[2], false);
const next = load(process.argv[3] || path.join(__dirname, '../../regex-explain.js'), true);
const R = String.raw;
const patterns = [
  R`^\d{3}-\d{4}$`, R`(?<year>\d{4})-(?<month>0[1-9]|1[0-2])`, R`\b(\w+)\s+\1\b`, R`(?<!\d)\d{1,3}(?:,\d{3})*(?=円)`,
  R`https?://[\w.-]+(?:/[\w\-./?%&=#~]*)?`, R`<.+?>`, R`[^]`, R`[]`, R`a{,3}`, R`a{`, R`\c`, R`\c1`, R`[\c]`, R`\00`, R`\012`,
  R`(a)\10`, R`(a)\18`, R`\8`, R`\k<a>`, R`(?<a>x)\k<a>`, R`(?i:a)b`, R`(?s:.)`, R`(?m:^a)`, R`😀+`, R`[a-\d]`, R`\p{L}+`,
  R`(?=a)*`, R`x|`, R`|`, R`()`, R`(?:)`, R`[\b]`, R`\/`, R`\-`, R`a**`, R`(ab`, R`ab)`, R`[ab`, R`(?<a>x)\k<b>`,
  R`^[ぁ-んー]+$`, R`[一-龯]`, R`\u{1F600}`, R`(?<=a|bc)d`, R`(?<=a+)b`, R`a{2,}?`, R`\$`, R`.`, R`\s\S\w\W\d\D`,
];
let diff = 0;
for (const f of ['', 'u', 'gims']) {
  for (const p of patterns) {
    const run = (lib) => {
      try {
        // 方言に対応するときに足した項目（possessive: false、dialect、名前付きの参照の index）は、比べる対象から外す
        const drop = function (k, v) {
          if ((k === 'possessive' && v === false) || k === 'dialect') return undefined;
          if (k === 'index' && this.type === 'backref' && this.name != null) return undefined;
          return v;
        };
        return JSON.stringify({ parse: lib.parse(p, f).ast, explain: lib.explain(p, f) }, drop);
      } catch (e) {
        return `ERR ${e.message} @${e.pos}`;
      }
    };
    const a = run(base);
    const b = run(next);
    if (a !== b) {
      diff++;
      console.log(`違う: /${p}/${f}\n  基準: ${a.slice(0, 300)}\n  今  : ${b.slice(0, 300)}`);
    }
  }
}
console.log(`${patterns.length * 3} 通りのうち、違う結果: ${diff}`);
process.exitCode = diff ? 1 : 0;
