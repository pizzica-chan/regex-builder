// テストの欄の「コード例」（dialects.js の sampleProgram）を、各言語の処理系で実際に動かし、
// 出力した一致が「テスト」の欄の一致と同じになるかを確かめる。サクラエディタは手順なので、動かさない。
// 使い方: node tools/test/sample-programs.js [言語の id ...]
// 要るもの: node、python、java（21 以降）、php、dotnet（.NET 7 の SDK）、pwsh、go、WSL の GNU grep と ja_JP.UTF-8 のロケール
// （tools/dialect-probe/run-all.ps1 と同じ）
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '../..');
const ctx = { console };
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['dialects.js', 'regex-explain.js', 'translate.js', 'match-core.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx);
}
const D = ctx.RegexDialects;

// 正規表現、フラグ、テスト文字列。by は言語ごとの書き方（POSIX には \d がない）
const CASES = [
  { p: String.raw`(\d+)円`, by: { posix: '([0-9]+)円' }, f: 'g', s: '合計 100円\n"送料" 50円 $x `y\' \\ end\tタブ' },
  { p: String.raw`^\w+$`, by: { posix: '^[[:alnum:]_]+$' }, f: 'gm', s: 'abc\nDEF\n日本語\nx y' },
  { p: 'b', f: 'i', s: 'aBcb' },
  { p: 'a.c', f: 's', s: 'a\nc abc' },
  { p: 'zz', f: '', s: 'abc' },
  { p: 'x', f: 'g', s: 'x\u0085x\u2028x\ufeffx\u0001x\u001bx' },
  { p: 'it\'s “q”', f: 'g', s: 'it\'s “q” ‘a’ „b‟' },
  { p: '文字', f: 'g', s: '' },
  { p: String.raw`\\`, f: 'g', s: 'a\\b\\c' },
  { p: '`', f: 'g', s: 'a`b' },
  { p: String.raw`\$[0-9]+`, f: 'g', s: '$5 and $10, ${x}' },
  { p: '/x/', f: 'g', s: 'a/x/b' },
  { p: String.raw`(a)(?<n>b)`, by: { posix: '(a)(b)' }, f: 'g', s: 'ab ab' },
  // 長さ 0 の一致。一致のあとの探し方は言語で違う（dialects.js の EMPTY_MODE）
  { p: 'x*', f: 'g', s: 'axx b' },
  { p: String.raw`\b`, f: 'g', s: 'ab cd' },
  { p: 'a|', f: 'g', s: 'bab' },
  { p: 'x*', f: '', s: 'axx' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-programs-'));
const wslPath = (p) => `/mnt/${p[0].toLowerCase()}${p.slice(2).replace(/\\/g, '/')}`;
const decode = (buf) => {
  const utf8 = buf.toString('utf8');
  return utf8.includes('\ufffd') ? new TextDecoder('shift_jis').decode(buf) : utf8;
};

function run(dialect, code, k) {
  const dir = path.join(tmp, `${dialect}-${k}`);
  fs.mkdirSync(dir, { recursive: true });
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' };
  const exec = (cmd, args, file, cwd = dir) => {
    if (file) fs.writeFileSync(path.join(dir, file), code);
    const r = spawnSync(cmd, args, { cwd, env, timeout: 120000 });
    if (r.error) throw r.error;
    const err = r.stderr ? r.stderr.toString('utf8').trim() : '';
    if (r.status !== 0) return { error: `終了コード ${r.status}: ${err.slice(0, 500)}` };
    return { out: decode(r.stdout) };
  };
  switch (dialect) {
    case 'js': return exec('node', ['main.js'], 'main.js');
    case 'python': return exec('python', ['-I', 'main.py'], 'main.py');
    case 'java': return exec('java', ['-Dstdout.encoding=UTF-8', 'Main.java'], 'Main.java');
    case 'php': return exec('php', ['main.php'], 'main.php');
    case 'cs':
      fs.writeFileSync(path.join(dir, 'sample.csproj'),
        '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net7.0</TargetFramework></PropertyGroup></Project>');
      // 出力を UTF-8 にする行は、using の並びのあとに入れる
      fs.writeFileSync(path.join(dir, 'Program.cs'), code.replace(/^(?=var )/m, 'Console.OutputEncoding = new System.Text.UTF8Encoding(false);\n'));
      return exec('dotnet', ['run']);
    case 'ps':
      fs.writeFileSync(path.join(dir, 'main.ps1'), `\ufeff[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n${code}`);
      return exec('pwsh', ['-NoProfile', '-File', 'main.ps1']);
    case 'go': return exec('go', ['run', 'main.go'], 'main.go');
    case 'ere': case 'bre': {
      // ロケールと WSL のディストリビューションは、tools/dialect-probe/match-grep.js と同じく GREP_LOCALE、GREP_LOCPATH、GREP_WSL で変えられる。
      // grep は一致がないと終了コード 1 を返すので、そのときも出力を比べる
      const locpath = process.env.GREP_LOCPATH ? `export LOCPATH=${process.env.GREP_LOCPATH}\n` : '';
      fs.writeFileSync(path.join(dir, 'main.sh'), `${locpath}export LC_ALL=${process.env.GREP_LOCALE || 'ja_JP.UTF-8'}\n${code} || [ $? -eq 1 ]\n`);
      const distro = process.env.GREP_WSL ? ['-d', process.env.GREP_WSL] : [];
      return exec('wsl.exe', [...distro, '--', 'bash', `${wslPath(dir)}/main.sh`]);
    }
    default: return null;
  }
}

// テストの欄と同じ処理で、一致した部分を集める
function expected(c, src, dialect, text) {
  let source;
  let flags;
  let program = null;
  if (dialect === 'js') {
    source = src;
    flags = c.f.includes('g') ? c.f : `${c.f}g`;
  } else {
    const t = ctx.RegexTranslate.translate(src, `${c.f}g`, dialect);
    source = t.source;
    flags = t.flags;
    program = t.program;
  }
  let found = ctx.MatchCore.findAll(source, flags, text, 100, undefined, null, D.emptyMode(dialect), program).matches.map((m) => m.text);
  // grep -o は長さ 0 の一致を出さない
  if (D.isPosix(dialect)) found = found.filter((m) => m !== '');
  if (!c.f.includes('g') && !D.isPosix(dialect)) found = found.length ? [found[0]] : ['一致なし'];
  return found;
}

const only = process.argv.slice(2);
const dialects = D.ids.filter((d) => d !== 'sakura' && (!only.length || only.includes(d)));
let total = 0;
let bad = 0;
for (const dialect of dialects) {
  CASES.forEach((c, k) => {
    const src = (D.isPosix(dialect) && c.by && c.by.posix) || c.p;
    let groups;
    try {
      groups = ctx.RegexExplain.parse(src, c.f, dialect).groupCount;
    } catch (_) {
      return; // この言語では書けない正規表現
    }
    const text = c.s || '調べる文字列';
    const sample = D.sampleProgram(src, c.f, text, dialect, groups);
    let want;
    try {
      want = expected(c, src, dialect, text);
    } catch (e) {
      return; // テストの欄で動かせない正規表現
    }
    total++;
    const r = run(dialect, sample.code, k);
    // 一致は 1 行に 1 つずつ出るが、一致の中に改行があることもあるので、出力全体を文字列のまま比べる。
    // pwsh と dotnet は、改行を CRLF で出す
    const got = r.error ? null : r.out.replace(/\r\n/g, '\n').replace(/\n$/, '');
    const ok = got !== null && got === want.join('\n');
    if (!ok) {
      bad++;
      console.log(`違う ${dialect} /${src}/${c.f} ${JSON.stringify(text)}\n  テストの欄: ${JSON.stringify(want)}\n  コード例: ${r.error || JSON.stringify(got)}\n${sample.code.replace(/^/gm, '    | ')}`);
    }
  });
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${total} 通りのうち、違う結果 ${bad}`);
process.exitCode = bad ? 1 : 0;
