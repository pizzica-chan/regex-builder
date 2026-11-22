// 「ほかの言語で使うと」の結果を、いくつかの正規表現で表示する（目で確かめる用）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const ctx = { console };
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['dialects.js', 'regex-explain.js', 'translate.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx);
const R = String.raw;
for (const [d, p, f] of [
  ['js', R`(?<year>\d{4})-(?<month>0[1-9]|1[0-2])`, 'g'],
  ['js', R`^\d{3}-\d{4}$`, 'gm'],
  ['python', R`(?P<w>\w+)\s+(?P=w)\Z`, 'i'],
  ['java', R`(?>a+)\h*+.`, ''],
]) {
  console.log(`[${d}] /${p}/${f}`);
  for (const r of ctx.RegexTranslate.portability(p, f, d)) console.log(`  ${r.dialect.padEnd(7)} ${r.status.padEnd(8)} ${r.reasons.join(' / ')}`);
}
