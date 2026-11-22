// JavaScript（Node）で probes.json の各正規表現を試し、結果を JSON で出す。u フラグなしで試す
const fs = require('fs');
const path = require('path');

const probes = JSON.parse(fs.readFileSync(path.join(__dirname, 'probes.json'), 'utf8'));
const CLASSES = ['\\d', '\\w', '\\s', '.', '(?s).'];

function run(p, s, op) {
  let re;
  try {
    re = new RegExp(op === 'full' ? `^(?:${p})$` : p);
    new RegExp(p); // 包まない形でも通るか
  } catch (_) {
    return 'E';
  }
  return re.test(s) ? 'T' : 'F';
}

function ranges(cls) {
  // JavaScript には (?s) がないので、s フラグで代える
  const re = cls === '(?s).' ? /^.$/s : new RegExp(`^(?:${cls})$`);
  const out = [];
  let start = null;
  for (let cp = 0; cp <= 0xffff; cp++) {
    const ok = !(cp >= 0xd800 && cp <= 0xdfff) && re.test(String.fromCharCode(cp));
    if (ok && start === null) start = cp;
    if (!ok && start !== null) { out.push([start, cp - 1]); start = null; }
  }
  if (start !== null) out.push([start, 0xffff]);
  return out;
}

const result = {
  engine: `JavaScript (Node ${process.version})`,
  probes: Object.fromEntries(probes.map((pr) => [pr.id, run(pr.p, pr.s, pr.op)])),
  classes: Object.fromEntries(CLASSES.map((c) => [c, ranges(c)])),
};
process.stdout.write(JSON.stringify(result));
