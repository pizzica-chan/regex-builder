// cases.json の各正規表現を GNU grep で動かし、一致した位置（UTF-8 のバイト単位）を JSON で出す。
// POSIX ERE は grep -E、POSIX BRE は grep で調べる。grep は 1 行ずつ調べ、長さ 0 の一致は出さない。
// 使い方: node match-grep.js ere > results/match-ere.json（bre も同じ）
//
// 照らし合わせの基準は、Linux（glibc）の GNU grep で、ロケールは ja_JP.UTF-8 にしている（結果は Ubuntu 24.04 の grep 3.11）。
// Windows では WSL の Linux で grep を動かす（WSL に Node.js は要らない）。WSL のディストリビューションは GREP_WSL で選べる（既定は既定のもの）。
// ロケールは GREP_LOCALE で変えられる。ja_JP.UTF-8 がない Linux では、sudo なしで次のように作り、GREP_LOCPATH=~/loc を付けて動かす:
//   mkdir -p ~/loc && localedef -i ja_JP -f UTF-8 ~/loc/ja_JP.UTF-8
// Git for Windows の grep は、文字の分類（[:alpha:] など）が glibc と違い、絵文字の繰り返しにも一致しないので、基準にしない（docs/dialects/posix.md）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const dialect = process.argv[2];
if (dialect !== 'ere' && dialect !== 'bre') throw new Error('使い方: node match-grep.js ere|bre [cases.json]');
const file = process.argv[3] || path.join(__dirname, 'cases.json');
const cases = JSON.parse(fs.readFileSync(file, 'utf8'));
const locale = process.env.GREP_LOCALE || 'ja_JP.UTF-8';
const locpath = process.env.GREP_LOCPATH || '';
const wsl = process.platform === 'win32';

// 事例ごとに、正規表現・文字列・grep の引数をファイルに書き、bash の繰り返しで grep をまとめて動かす。
// 正規表現をファイル（-f）で渡すのは、Windows から WSL に引数を渡すと、日本語や \ が書き換わることがあるため
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-grep-'));
cases.forEach((c, k) => {
  fs.writeFileSync(path.join(dir, `${k}.p`), `${c.p}\n`);
  fs.writeFileSync(path.join(dir, `${k}.s`), `${c.s}\n`);
  fs.writeFileSync(path.join(dir, `${k}.f`), `-o -b${dialect === 'ere' ? ' -E' : ''}${c.f.includes('i') ? ' -i' : ''}`);
});
// WSL から見た場所（C:\Users\… → /mnt/c/Users/…）
const posixDir = wsl ? `/mnt/${dir[0].toLowerCase()}${dir.slice(2).replace(/\\/g, '/')}` : dir;
const env = `${locpath ? `LOCPATH=${locpath} ` : ''}LC_ALL=${locale}`;
fs.writeFileSync(path.join(dir, 'run.sh'), [
  'set -u',
  `cd '${posixDir}'`,
  // 指定したロケールがないと、grep は黙って C ロケールで動くので、先に確かめる
  `[ "$(${env} locale charmap 2>/dev/null)" = UTF-8 ] || { echo "ロケール ${locale} がありません" >&2; exit 3; }`,
  `for ((k=0;k<${cases.length};k++)); do ${env} grep $(cat $k.f) -f $k.p < $k.s > $k.o 2>/dev/null; echo $? > $k.r; done`,
  '',
].join('\n'));
const cmd = wsl ? ['wsl.exe', [...(process.env.GREP_WSL ? ['-d', process.env.GREP_WSL] : []), '--', 'bash', `${posixDir}/run.sh`]] : ['bash', [`${dir}/run.sh`]];
const r = spawnSync(cmd[0], cmd[1]);
if (r.error) throw r.error;
if (r.status !== 0) throw new Error(`grep を動かせませんでした（${r.status}）: ${r.stderr.toString('utf8')}`);
const results = cases.map((c, k) => {
  if (fs.readFileSync(path.join(dir, `${k}.r`), 'utf8').trim() === '2') return 'E';
  const out = fs.readFileSync(path.join(dir, `${k}.o`)).toString('utf8');
  const list = [];
  // 「バイトの位置:一致した文字列」が 1 行ずつ出る
  for (const line of out.split('\n')) {
    const m = /^(\d+):(.*)$/s.exec(line);
    if (!m) continue;
    const start = Number(m[1]);
    list.push([start, start + Buffer.byteLength(m[2], 'utf8')]);
  }
  return list.slice(0, 100);
});
fs.rmSync(dir, { recursive: true, force: true });
process.stdout.write(JSON.stringify({ unit: 'utf8', results }));
