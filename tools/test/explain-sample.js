// 言語ごとの説明の出方を、いくつかの正規表現で表示する（目で確かめる用）
// 使い方: node tools/test/explain-sample.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const ctx = { console };
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['dialects.js', 'regex-explain.js', 'translate.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx);
const { RegexExplain } = ctx;
const strip = (h) => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const R = String.raw;

const samples = [
  ['python', R`^\d{3}-\d{4}$`, ''],
  ['python', R`(?P<year>\d{4})-(?P=year)`, ''],
  ['python', R`(?i)\w+\Z`, ''],
  ['java', R`\b\w+\b.`, 'i'],
  ['java', R`(?>a+)b*+`, ''],
  ['php', R`\h+\R`, ''],
  ['cs', R`(?<n>a)(b)\1`, ''],
  ['go', R`^\s.$`, ''],
  ['sakura', R`^\x{3042}.$`, 's'],
];
for (const [d, p, f] of samples) {
  try {
    const r = RegexExplain.explain(p, f, d);
    console.log(`[${d}] /${p}/${f}\n  ${strip(r.summary.scope)}`);
    for (const s of r.summary.steps) console.log(`   ・${strip(s.html)}`);
    const walk = (ns, depth) => ns.forEach((n) => { console.log(`    ${'  '.repeat(depth)}${strip(n.html)}`); if (n.children) walk(n.children, depth + 1); });
    walk(r.tree, 0);
    for (const fl of r.flags) console.log(`  フラグ ${fl.flag}: ${fl.text}`);
  } catch (e) {
    console.log(`[${d}] /${p}/${f}  誤り: ${e.message}`);
  }
}
