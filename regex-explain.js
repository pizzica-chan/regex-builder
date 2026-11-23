/*
 * 正規表現を言語ごとの書き方（dialects.js）で構文木に分解し、日本語の説明を作る。
 * 外部ライブラリは使わない。v フラグの集合演算には対応しない。
 */
(function (global) {
  'use strict';

  class RegexParseError extends Error {
    constructor(message, pos) {
      super(message);
      this.pos = pos;
    }
  }

  // ---------- 構文解析 ----------

  // u フラグがないときの古い 8進数の書き方を読む。0〜3 で始まれば 3 桁まで、4〜7 なら 2 桁まで
  function readLegacyOctal(digits) {
    const max = /[0-3]/.test(digits[0]) ? 3 : 2;
    let len = 0;
    while (len < max && /[0-7]/.test(digits[len] || '')) len++;
    return { ch: String.fromCharCode(parseInt(digits.slice(0, len), 8)), len };
  }

  // グループの数を超える \N（u フラグなし）を、JavaScript と同じく文字として読む。\8 \9 は数字そのもの
  function legacyBackrefText(raw) {
    if (/^[89]/.test(raw)) return raw;
    const { ch, len } = readLegacyOctal(raw);
    return ch + raw.slice(len);
  }

  // dialect は dialects.js の言語の id（js、python、java、php、cs、go、sakura）。言語ごとに受け付ける書き方を変える
  // opts.scan が true のときは、グループの数を数えるためだけに読む（C# の \12 を後方参照か8進数か決めるのに使う）
  function parse(src, flags, dialect = 'js', opts = {}) {
    const D = global.RegexDialects;
    if (!D || !D.ids.includes(dialect)) dialect = 'js';
    const isJs = dialect === 'js';
    const can = (feature) => !isJs && D.can(dialect, feature);
    const dsub = D ? D.subject(dialect) : 'JavaScript ';

    let i = 0;
    let groupCount = 0;
    const unicode = isJs && (flags.includes('u') || flags.includes('v'));
    // 絵文字などを 2 つの単位（UTF-16）に分けて読む言語。JavaScript は u フラグがないとき
    const codeUnits = isJs ? !unicode : D.codeUnits(dialect);
    // u フラグがなく、名前付きグループが 1 つもないとき、JavaScript は \k を文字の k として扱う
    const hasNamedGroups = /\(\?<(?![=!])/.test(src);
    const groupNames = [];
    const namedRefs = [];
    const numRefs = [];
    const lookbehinds = [];
    const groups = [];

    const err = (msg, pos = i) => { throw new RegexParseError(msg, pos); };

    // 正規表現全体のグループの数。C# は、\12 のような 2 桁以上の数字を、その番号のグループがあるときだけ後方参照にする
    let total = null;
    const totalGroups = () => {
      if (total == null) total = opts.scan ? Infinity : parse(src, flags, dialect, { scan: true }).groupCount;
      return total;
    };

    function readChar() {
      const ch = codeUnits ? src[i] : String.fromCodePoint(src.codePointAt(i));
      i += ch.length;
      return ch;
    }

    // {n}、{n,}、{n,m}。Python は {,m}（0〜m 回）も量指定子として読む
    function readBraceQuant() {
      const re = dialect === 'python' ? /^\{(\d*)(?:(,)(\d*))?\}/ : /^\{(\d+)(?:(,)(\d*))?\}/;
      const m = re.exec(src.slice(i));
      if (!m || (m[1] === '' && !m[2])) return null;
      const min = m[1] === '' ? 0 : Number(m[1]);
      const max = m[2] ? (m[3] === '' ? Infinity : Number(m[3])) : min;
      return { min, max, len: m[0].length };
    }

    function parseAlt() {
      const start = i;
      const alts = [parseSeq()];
      while (src[i] === '|') {
        i++;
        alts.push(parseSeq());
      }
      if (alts.length === 1) return alts[0];
      // (?i) のようにフラグだけを書くと、グループの終わりまで効くので、あとの「または」の候補にも効く。
      // 2 つ目からの候補に、前の候補までに付け外ししたフラグを flagsIn として持たせる
      let on = '';
      let off = '';
      for (const a of alts) {
        if (on || off) a.flagsIn = { on, off };
        for (const it of a.items) {
          if (it.type !== 'flags') continue;
          for (const f of it.off) { on = on.replace(f, ''); if (!off.includes(f)) off += f; }
          for (const f of it.on) { off = off.replace(f, ''); if (!on.includes(f)) on += f; }
        }
      }
      return { type: 'alt', alts, start, end: i };
    }

    function parseSeq() {
      const start = i;
      const items = [];
      while (i < src.length && src[i] !== '|' && src[i] !== ')') {
        const atom = parseQuant(parseAtom());
        // サクラエディタ（Onigmo）は、(?i) からグループの終わりまでを 1 つのまとまりとして読む。
        // そのため a(?i)b|c は a(?i:b|c) と同じになる（ほかの言語では (?:ab|(?i)c) に近い）。
        // (?i) の前にコメントとフラグしかなければ、どちらの読み方でも意味は同じなので、まとめない
        if (atom.type === 'flags' && dialect === 'sakura' && items.some((it) => it.type !== 'comment' && it.type !== 'flags')) {
          const rest = parseAlt();
          if (rest.type === 'alt') {
            items.push({ type: 'group', kind: 'modifier', isolated: true, name: null, index: null, modOn: atom.on, modOff: atom.off, body: rest, start: atom.start, end: i });
          } else {
            items.push(atom, ...rest.items);
          }
          break;
        }
        items.push(atom);
      }
      return { type: 'seq', items: mergeLiterals(items), start, end: i };
    }

    // 量指定子の付いていない文字が続くところを、1つの文字列にまとめる
    function mergeLiterals(items) {
      const out = [];
      for (const it of items) {
        const prev = out[out.length - 1];
        if (it.type === 'char' && prev && (prev.type === 'char' || prev.type === 'literal')) {
          // parts は、まとめる前の 1 文字ずつの範囲（入力欄の色分けで、エスケープを見分けるのに使う）
          out[out.length - 1] = {
            type: 'literal',
            value: prev.value + it.value,
            parts: [...(prev.parts || [{ start: prev.start, end: prev.end }]), { start: it.start, end: it.end }],
            start: prev.start,
            end: it.end,
          };
        } else {
          out.push(it);
        }
      }
      return out;
    }

    function parseAtom() {
      const start = i;
      const c = src[i];
      if (c === '^') { i++; return { type: 'anchor', kind: 'start', start, end: i }; }
      if (c === '$') { i++; return { type: 'anchor', kind: 'end', start, end: i }; }
      if (c === '.') { i++; return { type: 'dot', start, end: i }; }
      if (c === '(') return parseGroup();
      if (c === '[') return parseClass();
      if (c === '\\') return parseAtomEscape();
      if (c === '*' || c === '+' || c === '?') {
        err(`「${c}」の前に、繰り返す対象がありません`);
      }
      if (c === '{') {
        if (readBraceQuant()) err('「{…}」の前に、繰り返す対象がありません');
        if (dialect === 'java') err('Java では、{ を文字として使うときは \\{ と書きます');
      }
      return { type: 'char', value: readChar(), start, end: i };
    }

    function parseQuant(atom) {
      const qStart = i;
      let min;
      let max;
      const c = src[i];
      if (c === '*') { min = 0; max = Infinity; i++; }
      else if (c === '+') { min = 1; max = Infinity; i++; }
      else if (c === '?') { min = 0; max = 1; i++; }
      else if (c === '{') {
        const q = readBraceQuant();
        if (!q) return atom;
        ({ min, max } = q);
        if (max < min) err('回数の指定 {n,m} で、m が n より小さくなっています', qStart);
        const limit = isJs ? Infinity : D.repeatMax(dialect);
        if (min > limit || (max !== Infinity && max > limit)) err(`${dsub}では、繰り返しの回数は ${limit} までです`, qStart);
        i += q.len;
      } else {
        return atom;
      }
      if (atom.type === 'anchor' && !isJs && dialect !== 'sakura') err('位置を表す部品（^ や \\b など）は繰り返せません', qStart);
      let lazy = false;
      let possessive = false;
      if (src[i] === '?') { lazy = true; i++; }
      else if (src[i] === '+' && !isJs) {
        if (can('possessive')) { possessive = true; i++; }
        else if (dialect === 'cs') err('C# では *+ のような、戻って試し直さない繰り返し（強欲な繰り返し）は使えません');
        else err(`${dsub}では、繰り返しの記号を重ねられません`);
      }
      const node = { type: 'quant', min, max, lazy, possessive, target: atom, start: atom.start, qStart, end: i };
      // サクラエディタ（Onigmo）は a** のように繰り返しを重ねられる
      if (can('nestedQuant') && /[*+?]/.test(src[i] || '')) return parseQuant(node);
      if (can('nestedQuant') && src[i] === '{' && readBraceQuant()) return parseQuant(node);
      return node;
    }

    // グループ名に使える文字（tools/dialect-probe で実際に動かして調べた）。Java は英字で始まる英数字だけ（_ も使えない）、
    // Go は英数字と _ で数字から始めてもよい。ほかは、ひらがなや漢字も使え、数字からは始められない
    const NAME = dialect === 'java' ? '[A-Za-z][A-Za-z0-9]*'
      : dialect === 'go' ? '[A-Za-z0-9_]+'
        : '[\\p{L}\\p{Nl}_][\\p{L}\\p{Nl}\\p{Mn}\\p{Mc}\\p{Nd}\\p{Pc}]*';
    const nameRe = (open, close) => new RegExp(`^${open}(${NAME})${close}`, 'u');
    const NAME_DESC = dialect === 'java' ? '英字と数字だけです（1 文字目は英字。_ は使えません）'
      : dialect === 'go' ? '英数字と _ だけです' : '文字・数字と _ です（1 文字目に数字は使えません）';

    function readGroupName(re, what) {
      const m = re.exec(src.slice(i));
      if (!m) {
        // 名前の区切りはあるのに読めないときは、名前に使えない文字がある
        if (/^[<'{]?[^<>'{}()\s]+[>'})]/.test(src.slice(i))) err(`${dsub}では、グループ名に使えるのは${NAME_DESC}`);
        err(`${what}の書き方が正しくありません`);
      }
      i += m[0].length;
      return m[1];
    }

    function addNamed(name, start) {
      if (groupNames.includes(name) && !isJs && !can('dupNames')) {
        err(`「${name}」という名前のグループが2つあります`, start);
      }
      groupNames.push(name);
    }

    function parseGroup() {
      const start = i;
      i++; // (
      let kind = 'capture';
      let name = null;
      let modOn = '';
      let modOff = '';
      const rest = src.slice(i);
      if (isJs) {
        if (rest.startsWith('?:')) { kind = 'noncapture'; i += 2; }
        else if (rest.startsWith('?=')) { kind = 'lookahead'; i += 2; }
        else if (rest.startsWith('?!')) { kind = 'neglookahead'; i += 2; }
        else if (rest.startsWith('?<=')) { kind = 'lookbehind'; i += 3; }
        else if (rest.startsWith('?<!')) { kind = 'neglookbehind'; i += 3; }
        else if (rest.startsWith('?<')) {
          const m = /^\?<([^>]+)>/.exec(rest);
          if (!m) err('グループ名の書き方が正しくありません');
          kind = 'named';
          name = m[1];
          groupNames.push(name);
          i += m[0].length;
        } else if (rest.startsWith('?')) {
          const m = /^\?([ims]*)(?:-([ims]+))?:/.exec(rest);
          if (!m) err('「(?」のあとの書き方が正しくありません');
          kind = 'modifier';
          modOn = m[1];
          modOff = m[2] || '';
          i += m[0].length;
        }
      } else if (rest.startsWith('?')) {
        const look = /^\?(?:[=!]|<[=!])/.exec(rest);
        if (look) {
          if (!can('lookahead')) err(`${dsub}では、先読みと後読み（(?=…) など）は使えません`, start);
          kind = { '?=': 'lookahead', '?!': 'neglookahead', '?<=': 'lookbehind', '?<!': 'neglookbehind' }[look[0]];
          i += look[0].length;
        } else if (rest.startsWith('?P<')) {
          if (!can('namedP')) err(`${dsub}では (?P<name>…) は使えません。(?<name>…) と書きます`, start);
          i += 2;
          name = readGroupName(nameRe('<', '>'), 'グループ名');
          kind = 'named';
          addNamed(name, start);
        } else if (rest.startsWith('?P=')) {
          if (!can('prefP')) err(`${dsub}では (?P=name) は使えません`, start);
          i += 3;
          const refName = readGroupName(nameRe('', '\\)'), '(?P=name)');
          const ref = { type: 'backref', name: refName, start, end: i };
          namedRefs.push(ref);
          return ref;
        } else if (rest.startsWith("?'")) {
          if (!can('namedQuote')) err(`${dsub}では (?'name'…) は使えません`, start);
          i += 1;
          name = readGroupName(nameRe("'", "'"), 'グループ名');
          kind = 'named';
          addNamed(name, start);
        } else if (rest.startsWith('?<')) {
          if (!can('namedAngle')) err('Python では、名前付きグループを (?P<name>…) と書きます', start);
          i += 1;
          name = readGroupName(nameRe('<', '>'), 'グループ名');
          kind = 'named';
          addNamed(name, start);
        } else if (rest.startsWith('?(') && D.can(dialect, 'conditional')) {
          err('このツールは、(?(1)…|…) のような条件分岐には対応していません', start);
        } else if (rest.startsWith('?>')) {
          if (!can('atomic')) err(`${dsub}では (?>…)（アトミックグループ）は使えません`, start);
          kind = 'atomic';
          i += 2;
        } else if (rest.startsWith('?#')) {
          if (!can('comment')) err(`${dsub}では (?#…)（コメント）は使えません`, start);
          const close = src.indexOf(')', i);
          if (close < 0) err('「(」に対応する「)」がありません', start);
          i = close + 1;
          return { type: 'comment', start, end: i };
        } else {
          const m = /^\?([a-zA-Z]*)(?:-([a-zA-Z]*))?([:)])/.exec(rest);
          if (!m) err('「(?」のあとの書き方が正しくありません');
          const letters = m[1] + (m[2] || '');
          const bad = [...letters].find((f) => !'ims'.includes(f));
          if (bad === 'x') err('このツールは、x フラグ（空白を無視する書き方）には対応していません');
          if (bad) err(`このツールは、(?${bad}) のフラグには対応していません（使えるのは i、m、s）`);
          if (m[3] === ':') {
            kind = 'modifier';
            modOn = m[1];
            modOff = m[2] || '';
            i += m[0].length;
          } else {
            // (?i) のように範囲を区切らない書き方。書いた位置から、グループの終わりまで効く
            if (!can('inlineFlags')) err(`${dsub}では (?i) のようなフラグの書き方は使えません`, start);
            // Python は、正規表現の先頭に (?i)(?m) のように並べたり、コメントのあとに書いたりするのは受け付ける（実際の結果）
            const onlyFlagsBefore = /^(?:\(\?[a-zA-Z-]*\)|\(\?#[^)]*\))*$/.test(src.slice(0, start));
            if (!can('inlineFlagsMiddle') && !onlyFlagsBefore) err(`${dsub}では、(?i) のようなフラグは正規表現の先頭にしか書けません`, start);
            if (dialect === 'python' && m[2] !== undefined) err('Python では、先頭の (?i) の書き方でフラグを外す（-）ことはできません', start);
            i += m[0].length;
            return { type: 'flags', on: m[1], off: m[2] || '', start, end: i };
          }
        }
      }
      const index = kind === 'capture' || kind === 'named' ? ++groupCount : null;
      const body = parseAlt();
      if (src[i] !== ')') err('「(」に対応する「)」がありません', start);
      i++;
      const node = { type: 'group', kind, name, index, modOn, modOff, body, start, end: i };
      if (index) groups.push(node);
      if (kind === 'lookbehind' || kind === 'neglookbehind') lookbehinds.push(node);
      return node;
    }

    function parseAtomEscape() {
      const start = i;
      i++; // バックスラッシュ
      if (i >= src.length) err('最後の「\\」のあとに文字がありません', start);
      const c = src[i];
      if (c === 'b' || c === 'B') {
        i++;
        return { type: 'anchor', kind: c === 'b' ? 'wordb' : 'nonwordb', start, end: i };
      }
      if (isJs) {
        if (/[1-9]/.test(c)) {
          const m = /^\d+/.exec(src.slice(i));
          i += m[0].length;
          return { type: 'backref', index: Number(m[0]), raw: m[0], start, end: i };
        }
        if (c === 'k' && (unicode || hasNamedGroups)) {
          const m = /^k<([^>]+)>/.exec(src.slice(i));
          if (m) {
            i += m[0].length;
            const ref = { type: 'backref', name: m[1], start, end: i };
            namedRefs.push(ref);
            return ref;
          }
        }
        return parseCommonEscape(start, false);
      }
      // ここから JavaScript 以外
      const anchors = { A: ['anchorA', 'strStart'], z: ['anchorz', 'strEnd'], Z: ['anchorZ', 'strEndNl'] };
      if (anchors[c]) {
        const [feature, kind] = anchors[c];
        if (!can(feature)) {
          if (c === 'z' && dialect === 'python') err('Python 3.13 では \\z は使えません。文字列の末尾は \\Z と書きます', start);
          err(`${dsub}では \\${c} は使えません`, start);
        }
        i++;
        // Python の \Z は文字列の末尾だけ（ほかの言語の \z と同じ）
        return { type: 'anchor', kind: c === 'Z' && dialect === 'python' ? 'strEnd' : kind, start, end: i };
      }
      if (c === 'G') err('このツールは \\G（探し始めた位置）には対応していません', start);
      if (/[1-9]/.test(c)) {
        const digits = /^\d+/.exec(src.slice(i))[0];
        const num = Number(digits);
        const octLen = /^[0-7]{0,3}/.exec(digits)[0].length;
        // 後方参照ではなく8進数の文字コードとして読む。C# は 255 を超える値の上の桁を捨てる
        const octalChar = (len) => {
          const cp = parseInt(digits.slice(0, len), 8);
          i += len;
          return { type: 'char', value: String.fromCodePoint(dialect === 'cs' ? cp & 0xff : cp), start, end: i };
        };
        // 8進数として読むかどうかは、言語ごとに違う（docs/dialects/ の各言語の資料）
        if (dialect === 'python' && octLen === 3) {
          if (parseInt(digits.slice(0, 3), 8) > 0o377) err('Python では、8進数の文字コードは \\377 までです', start);
          return octalChar(3); // Python は 3 桁の8進数なら文字コード
        }
        if (dialect === 'go' && octLen >= 2) return octalChar(octLen); // Go は 1 桁だけなら誤り、2 桁以上なら8進数
        // PHP はその位置までのグループの数、C# は全体のグループの数を超える 2 桁以上の数字を、8進数として読む
        if (dialect === 'php' && num >= 10 && octLen && num > groupCount) return octalChar(octLen);
        if (dialect === 'cs' && num >= 10 && octLen && num > totalGroups()) return octalChar(octLen);
        if (!can('backref')) err(`${dsub}では、\\1 のような後方参照は使えません`, start);
        let len = dialect === 'python' ? Math.min(2, digits.length) : digits.length;
        if (dialect === 'java') {
          // Java は、その位置までにあるグループの数を超えない桁まで読み、残りの数字は文字として読む
          len = 1;
          while (len < digits.length && Number(digits.slice(0, len + 1)) <= groupCount) len++;
        }
        i += len;
        const ref = { type: 'backref', index: Number(digits.slice(0, len)), raw: digits.slice(0, len), start, end: i };
        numRefs.push(ref);
        return ref;
      }
      if (c === 'k' && src[i + 1] === '<') {
        if (!can('krefAngle')) {
          err(`${dsub}では \\k<name> は使えません${dialect === 'python' ? '。(?P=name) と書きます' : ''}`, start);
        }
        i++;
        const refName = readGroupName(nameRe('<', '>'), '\\k<name>');
        const ref = { type: 'backref', name: refName, start, end: i };
        namedRefs.push(ref);
        return ref;
      }
      // \k'name'（PHP、C#、サクラエディタ）と \k{name}（PHP）
      if (c === 'k' && ((src[i + 1] === "'" && can('krefQuote')) || (src[i + 1] === '{' && can('krefBrace')))) {
        const quote = src[i + 1] === "'";
        i++;
        const refName = readGroupName(quote ? nameRe("'", "'") : nameRe('\\{', '\\}'), quote ? "\\k'name'" : '\\k{name}');
        const ref = { type: 'backref', name: refName, start, end: i };
        namedRefs.push(ref);
        return ref;
      }
      // \g{1}、\g{-1}（相対）、\g{name}（PHP、サクラエディタ）と \g1（PHP）
      if (c === 'g' && can('gref')) {
        const tail = src.slice(i);
        let m;
        if ((m = /^g\{(-?\d+)\}/.exec(tail)) || (can('grefBare') && (m = /^g(-?\d+)/.exec(tail)))) {
          const n = Number(m[1]);
          // -1 は、ここより前で最後に始まったグループ
          const index = n < 0 ? groupCount + 1 + n : n;
          if (n === 0 || index < 1) err(`${m[0]} が指すグループはありません`, start);
          i += m[0].length;
          const ref = { type: 'backref', index, raw: String(index), start, end: i };
          numRefs.push(ref);
          return ref;
        }
        if ((m = nameRe('g\\{', '\\}').exec(tail))) {
          i += m[0].length;
          const ref = { type: 'backref', name: m[1], start, end: i };
          namedRefs.push(ref);
          return ref;
        }
        if (/^g[<']/.test(tail)) err('このツールは、\\g<name> のような部分式の呼び出しには対応していません', start);
      }
      // PHP の \N は、改行（LF）以外の 1 文字（s フラグにかかわらない）
      if (c === 'N' && can('notNewline') && src[i + 1] !== '{') {
        i++;
        return { type: 'class', negate: true, items: [{ type: 'char', value: '\n', start, end: i }], start, end: i };
      }
      if (c === 'X' && can('grapheme')) err('このツールは、\\X（見た目の 1 文字にまとまる文字の並び）には対応していません', start);
      if (c === 'K' && can('keepOut')) err('このツールは、\\K（一致した文字列の始まりを、その位置に決め直す書き方）には対応していません', start);
      if (c === 'Q') {
        if (!can('quoteQE')) err(`${dsub}では \\Q…\\E は使えません`, start);
        const close = src.indexOf('\\E', i + 1);
        const end = close < 0 ? src.length : close;
        const value = src.slice(i + 1, end);
        i = close < 0 ? src.length : close + 2;
        if (!value) return { type: 'comment', start, end: i };
        return { type: 'literal', value, start, end: i, quoted: true, parts: [] };
      }
      if (c === 'R') {
        if (!can('linebreakR')) err(`${dsub}では \\R は使えません`, start);
        i++;
        return { type: 'linebreak', start, end: i };
      }
      return parseCommonEscape(start, false);
    }

    // 文字クラスの中でも外でも、ほぼ同じ意味になるエスケープ。違うところは inClass で分ける
    function parseCommonEscape(start, inClass) {
      const c = src[i];
      const rest = src.slice(i);
      const sets = { d: 'digit', D: 'nondigit', w: 'word', W: 'nonword', s: 'space', S: 'nonspace' };
      if (sets[c]) { i++; return { type: 'set', kind: sets[c], start, end: i }; }
      if (!isJs && (c === 'h' || c === 'H') && can('hSpace')) {
        i++;
        return { type: 'set', kind: c === 'h' ? 'hspace' : 'nonhspace', start, end: i };
      }
      if (!isJs && (c === 'v' || c === 'V') && can('vSpace')) {
        i++;
        return { type: 'set', kind: c === 'v' ? 'vspace' : 'nonvspace', start, end: i };
      }
      const ctrl = { n: '\n', r: '\r', t: '\t', f: '\f', v: '\v' };
      if (!isJs) {
        if (can('bell')) ctrl.a = '\x07';
        if (can('escChar')) ctrl.e = '\x1b';
        if (dialect === 'sakura') delete ctrl.v; // サクラエディタの \v は垂直タブではなく文字の v（実際の結果）
      }
      if (ctrl[c]) { i++; return { type: 'char', value: ctrl[c], start, end: i }; }
      let m;
      if (isJs) {
        if (unicode && c === '0' && !/[0-9]/.test(src[i + 1] || '')) {
          i++;
          return { type: 'char', value: '\0', start, end: i };
        }
        if (!unicode && (c === '0' || (inClass && /[1-7]/.test(c)))) {
          const { ch, len } = readLegacyOctal(src.slice(i));
          i += len;
          return { type: 'char', value: ch, start, end: i };
        }
        if (c === 'x' && (m = /^x([0-9a-fA-F]{2})/.exec(rest))) {
          i += m[0].length;
          return { type: 'char', value: String.fromCharCode(parseInt(m[1], 16)), start, end: i };
        }
        if (c === 'u') {
          if (unicode && (m = /^u\{([0-9a-fA-F]+)\}/.exec(rest))) {
            i += m[0].length;
            return { type: 'char', value: String.fromCodePoint(parseInt(m[1], 16)), start, end: i };
          }
          if ((m = /^u([0-9a-fA-F]{4})/.exec(rest))) {
            i += m[0].length;
            return { type: 'char', value: String.fromCharCode(parseInt(m[1], 16)), start, end: i };
          }
        }
        if (c === 'c' && (m = /^c([A-Za-z])/.exec(rest))) {
          i += m[0].length;
          return { type: 'char', value: String.fromCharCode(m[1].charCodeAt(0) % 32), start, end: i };
        }
        if (c === 'c' && !unicode) {
          if (inClass && (m = /^c([0-9_])/.exec(rest))) {
            i += m[0].length;
            return { type: 'char', value: String.fromCharCode(m[1].charCodeAt(0) % 32), start, end: i };
          }
          return { type: 'char', value: '\\', start, end: i }; // i は c の位置のまま
        }
        if ((c === 'p' || c === 'P') && unicode && (m = /^[pP]\{([^}]+)\}/.exec(rest))) {
          i += m[0].length;
          return { type: 'uprop', negate: c === 'P', value: m[1], start, end: i };
        }
        return { type: 'char', value: readChar(), start, end: i };
      }

      // ここから JavaScript 以外
      const charAt = (cp, len) => {
        i += len;
        if (cp > 0x10ffff) err('文字コードが大きすぎます', start);
        return { type: 'char', value: String.fromCodePoint(cp), start, end: i };
      };
      if (c === '0' || (inClass && /[1-7]/.test(c))) {
        if (!can('octal')) err(`${dsub}では \\0 や \\012 のような8進数の書き方は使えません。\\x{0} のように書きます`, start);
        if (inClass && c !== '0' && dialect === 'java') err('Java では、文字クラスの中に \\1 のような書き方は使えません', start);
        if (dialect === 'java') {
          // Java は \0 のあとに 1〜3 桁の8進数が要る（3 桁のときは先頭が 0〜3）
          if (!(m = /^0(?:[0-3][0-7]{2}|[0-7]{1,2})/.exec(rest))) err('Java では、\\0 のあとに8進数の数字が要ります（例: \\0101）', start);
          return charAt(parseInt(m[0].slice(1), 8), m[0].length);
        }
        m = c === '0' ? /^0[0-7]{0,2}/.exec(rest) : /^[1-7][0-7]{0,2}/.exec(rest);
        return charAt(parseInt(m[0], 8), m[0].length);
      }
      if (c === 'x') {
        if (rest[1] === '{') {
          if (!can('xBrace') || !(m = /^x\{([0-9a-fA-F]+)\}/.exec(rest))) err(`${dsub}では \\x{…} は使えません`, start);
          return charAt(parseInt(m[1], 16), m[0].length);
        }
        if ((m = /^x([0-9a-fA-F]{2})/.exec(rest))) {
          if (!can('xHex2')) err(`${dsub}では \\x41 のような書き方は使えません。\\x{41} と書きます`, start);
          return charAt(parseInt(m[1], 16), m[0].length);
        }
        // PHP は \x のあとの 0〜1 桁の16進数も読む（\x だけなら NUL 文字）
        if (dialect === 'php') {
          m = /^x([0-9a-fA-F]?)/.exec(rest);
          return charAt(parseInt(m[1] || '0', 16), m[0].length);
        }
        err('\\x のあとに16進数の数字が要ります', start);
      }
      if (c === 'u' && (m = /^u([0-9a-fA-F]{4})/.exec(rest)) && can('uHex4')) return charAt(parseInt(m[1], 16), m[0].length);
      if (c === 'u' && dialect !== 'sakura') err(`${dsub}では \\u0041 のような書き方は使えません${can('xBrace') ? '。\\x{41} と書きます' : ''}`, start);
      if (c === 'U' && dialect === 'python') {
        if (!(m = /^U([0-9a-fA-F]{8})/.exec(rest))) err('Python の \\U のあとには、16進数の数字が 8 桁要ります', start);
        return charAt(parseInt(m[1], 16), m[0].length);
      }
      if (c === 'N' && rest[1] === '{' && can('namedChar')) err('このツールは、\\N{…}（文字の名前で書く書き方）には対応していません', start);
      if (c === 'c') {
        // Java は \c のあとの文字をそのまま使い（\cj は *）、ほかの言語は英字を大文字にしてから使う（\cj は LF）
        if (dialect === 'java' && rest.length > 1) return charAt(rest.codePointAt(1) ^ 0x40, 1 + String.fromCodePoint(rest.codePointAt(1)).length);
        // PHP とサクラエディタは、英字のほかに ASCII の記号も受け付ける（\c? は DEL）
        const ctrlRe = ['php', 'sakura'].includes(dialect) ? /^c([\x20-\x7e])/ : /^c([A-Za-z])/;
        if (!can('ctrlLetter') || !(m = ctrlRe.exec(rest))) err(`${dsub}では \\cA のような書き方は使えません`, start);
        return charAt(m[1].toUpperCase().charCodeAt(0) ^ 0x40, m[0].length);
      }
      if (c === 'o' && rest[1] === '{') {
        if (!can('oBrace') || !(m = /^o\{([0-7]+)\}/.exec(rest))) err(`${dsub}では \\o{…} は使えません`, start);
        return charAt(parseInt(m[1], 8), m[0].length);
      }
      if (c === 'p' || c === 'P') {
        if (!can('uprop')) err(`${dsub}では \\p{…} は使えません`, start);
        if ((m = /^[pP]\{(\^?)([^}]+)\}/.exec(rest)) || (m = /^[pP]()([A-Za-z])/.exec(rest))) {
          if (m[1] === '^' && !can('upropCaret')) err(`${dsub}では \\p{^…} は使えません。\\P{…} と書きます`, start);
          if (m[0][1] !== '{' && !can('upropBare')) err(`${dsub}では、\\p のあとを {…} で囲みます（例: \\p{L}）`, start);
          if (D.bareScriptInvalid(m[2], dialect)) {
            err(dialect === 'java'
              ? `Java では \\p{${m[2]}} は使えません。\\p{Is${m[2]}} と書きます`
              : `C# では \\p{${m[2]}} は使えません。\\p{IsHiragana} のようなブロックの名前を使います`, start);
          }
          if (!D.propToJs(m[2], dialect)) {
            err(`${dsub}では \\p{${m[2]}} という名前が使えないか、このツールが対応していない名前です`, start);
          }
          i += m[0].length;
          // \p{lu} のような書き方も、説明や比較では \p{Lu} として扱う
          return { type: 'uprop', negate: (c === 'P') !== (m[1] === '^'), value: D.canonicalProp(m[2], dialect), start, end: i };
        }
        err('\\p のあとの書き方が正しくありません', start);
      }
      if (inClass && c === 'b' && (dialect === 'java' || dialect === 'go')) err(`${dsub}では、文字クラスの中に \\b は使えません`, start);
      const ch = readChar();
      if (/[A-Za-z0-9]/.test(ch) && !can('unknownLetterEscape')) err(`${dsub}では \\${ch} という書き方はありません`, start);
      return { type: 'char', value: ch, start, end: i };
    }

    function parseClass() {
      const start = i;
      i++; // [
      let negate = false;
      if (src[i] === '^') { negate = true; i++; }
      const items = [];
      // JavaScript 以外では、[ や [^ のすぐあとの ] は文字として読む
      let first = !isJs;
      while (i < src.length && (src[i] !== ']' || first)) {
        first = false;
        if (!isJs && src[i] === '[' && src[i + 1] === ':' && can('posix')) {
          const m = /^\[:(\^?)([a-z]+):\]/.exec(src.slice(i));
          if (!m) err('POSIX の文字クラス（[:alpha:] など）の書き方が正しくありません');
          const pstart = i;
          i += m[0].length;
          items.push({ type: 'posix', name: m[2], negate: m[1] === '^', start: pstart, end: i });
          continue;
        }
        if (!isJs && can('classNested') && (src[i] === '[' || src.startsWith('&&', i))) {
          err('このツールは、文字クラスの入れ子（[a[b]]）と && には対応していません');
        }
        const a = parseClassAtom();
        if (src[i] === '-' && i + 1 < src.length && src[i + 1] !== ']') {
          if (a.type === 'char') {
            const dash = i;
            i++;
            const b = parseClassAtom();
            if (b.type === 'char') {
              if (!isJs && a.value.codePointAt(0) > b.value.codePointAt(0)) err('文字クラスの範囲の順番が逆です', a.start);
              items.push({ type: 'range', from: a.value, to: b.value, start: a.start, end: b.end });
            } else {
              if (!isJs) err('文字クラスの範囲（a-z）の端に、\\d のような文字の集まりは使えません', b.start);
              items.push(a, { type: 'char', value: '-', start: dash, end: dash + 1 }, b);
            }
            continue;
          }
          // [\d-z] は、Java・C#・Go では - を文字として読み、Python・PHP・サクラエディタでは誤りになる（実際の結果）
          if (!isJs && !can('classSetDash')) {
            err('文字クラスの範囲（a-z）の端に、\\d のような文字の集まりは使えません', a.start);
          }
        }
        items.push(a);
      }
      if (src[i] !== ']') err('「[」に対応する「]」がありません', start);
      i++;
      return { type: 'class', negate, items, start, end: i };
    }

    function parseClassAtom() {
      const start = i;
      if (src[i] === '\\') {
        i++;
        if (i >= src.length) err('最後の「\\」のあとに文字がありません', start);
        if (src[i] === 'b' && !(dialect === 'java' || dialect === 'go')) { i++; return { type: 'char', value: '\b', start, end: i }; }
        if (!isJs && src[i] === 'Q' && can('quoteQE')) {
          err('このツールは、文字クラスの中の \\Q…\\E には対応していません', start);
        }
        return parseCommonEscape(start, true);
      }
      return { type: 'char', value: readChar(), start, end: i };
    }

    const ast = parseAlt();
    if (i < src.length) err('「)」に対応する「(」がありません');
    for (const ref of namedRefs) {
      if (!groupNames.includes(ref.name)) err(`「${ref.name}」という名前のグループがありません`, ref.start);
    }

    // C# は、名前なしのグループに先に番号を付け、名前付きのグループはそのあとの番号にする。同じ名前のグループは同じ番号
    if (dialect === 'cs') {
      let n = 0;
      for (const g of groups) if (g.kind === 'capture') g.index = ++n;
      const byName = {};
      for (const g of groups) {
        if (g.kind !== 'named') continue;
        if (!(g.name in byName)) byName[g.name] = ++n;
        g.index = byName[g.name];
      }
      groupCount = n;
    }
    for (const ref of namedRefs) {
      const g = groups.find((x) => x.name === ref.name);
      if (g) ref.index = g.index;
    }
    if (opts.scan) return { ast, groupCount, dialect };
    for (const ref of numRefs) {
      if (ref.index <= groupCount) continue;
      // Java は、ないグループへの参照を誤りにしない（一致しないだけ）
      if (dialect === 'java') { ref.missing = true; continue; }
      err(`グループ${ref.index}はありません`, ref.start);
    }

    // 後読みの中身の長さを確かめる
    const rule = isJs ? 'any' : D.lookbehind(dialect);
    for (const lb of lookbehinds) checkLookbehind(lb, rule, dsub, err);
    if (dialect === 'sakura') for (const lb of lookbehinds) checkSakuraLookbehind(lb, err);

    return { ast, groupCount, dialect };
  }

  // サクラエディタ（Onigmo）の後読みの中に書けないもの（tools/dialect-probe で実際に動かして調べた）
  function checkSakuraLookbehind(lb, err) {
    const negative = lb.kind === 'neglookbehind';
    (function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'backref') err('サクラエディタでは、後読みの中に後方参照（\\1 など）は書けません', n.start);
      if (n.type === 'quant' && n.possessive) err('サクラエディタでは、後読みの中に強欲な繰り返し（*+ など）は書けません', n.qStart);
      if (n.type === 'group') {
        if (n.kind === 'atomic') err('サクラエディタでは、後読みの中に (?>…) は書けません', n.start);
        if (n.kind === 'lookahead' || n.kind === 'neglookahead') err('サクラエディタでは、後読みの中に先読み（(?=…) など）は書けません', n.start);
        if (negative && (n.kind === 'capture' || n.kind === 'named')) {
          err('サクラエディタでは、否定の後読み (?<!…) の中にグループ ( ) は書けません。(?:…) を使います', n.start);
        }
      }
      for (const k of ['items', 'alts', 'body', 'target']) {
        const v = n[k];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v) walk(v);
      }
    })(lb.body);
  }

  // 部品が一致する長さの [最小, 最大]。最大が決まらないときは Infinity
  function widthOf(n) {
    switch (n.type) {
      case 'char': case 'set': case 'class': case 'dot': case 'uprop': return [1, 1];
      case 'literal': return [[...n.value].length, [...n.value].length];
      case 'linebreak': return [1, 2];
      case 'anchor': case 'comment': case 'flags': return [0, 0];
      case 'backref': return [0, Infinity];
      case 'seq': return n.items.map(widthOf).reduce(([a, b], [c, d]) => [a + c, b + d], [0, 0]);
      case 'alt': {
        const ws = n.alts.map(widthOf);
        return [Math.min(...ws.map((w) => w[0])), Math.max(...ws.map((w) => w[1]))];
      }
      case 'group':
        return /look/.test(n.kind) ? [0, 0] : widthOf(n.body);
      case 'quant': {
        const [a, b] = widthOf(n.target);
        return [a * n.min, n.max === 0 ? 0 : b * n.max];
      }
      default: return [0, Infinity];
    }
  }

  function checkLookbehind(lb, rule, dsub, err) {
    if (rule === 'any') return;
    const body = lb.body;
    const top = body.type === 'alt' ? body.alts : [body];
    if (rule === 'bounded') {
      // Java 21 は (?<=a+) を受け付けるが、(?<=a+b+)c が aabbc に一致しないなど、正しく一致しないことがある（実際の結果）
      if (widthOf(body)[1] === Infinity) {
        err(`${dsub}の後読みの中の * や + のような上限のない繰り返しは、正しく一致しないことがあるので、誤りとして扱います。{1,10} のように上限を決めて書きます`, lb.start);
      }
      return;
    }
    if (rule === 'fixed') {
      const ws = top.map(widthOf);
      const fixed = ws.every(([a, b]) => a === b) && ws.every(([a]) => a === ws[0][0]);
      if (!fixed) err(`${dsub}では、後読みの中身を決まった長さにする必要があります（* や {1,3}、長さの違う「または」は使えません）`, lb.start);
      return;
    }
    // fixed-alt: 「または」の候補ごとに長さが決まっていればよい
    if (!top.every((a) => { const [x, y] = widthOf(a); return x === y; })) {
      err(`${dsub}では、後読みの中身を「または」の候補ごとに決まった長さにする必要があります`, lb.start);
    }
  }

  // ---------- 説明文の生成 ----------
  //
  // 1 文字に当たる部品（\d、[a-z]、. など）は「何の文字か」を名詞で表し、
  // 量指定子が付いたら「数字が3文字」のように文字数で言う。
  // 位置だけを表す部品（^、$、\b）は、文字と区別できるよう枠で囲んで表示する。

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const CHAR_NAMES = {
    ' ': '半角スペース',
    '　': '全角スペース',
    '\n': '改行（LF）',
    '\r': '復帰（CR）',
    '\t': 'タブ',
    '\f': '改ページ',
    '\v': '垂直タブ',
    '\0': 'NUL文字',
    '\b': 'バックスペース',
  };

  function charName(ch) {
    if (CHAR_NAMES[ch]) return CHAR_NAMES[ch];
    const cp = ch.codePointAt(0);
    const hex = cp.toString(16).toUpperCase().padStart(4, '0');
    if (cp < 0x20 || cp === 0x7f) return `制御文字 U+${hex}`;
    if (ch.length === 1 && cp >= 0xd800 && cp <= 0xdfff) {
      return `絵文字などの片割れ U+${hex}（u フラグがないと、1文字が2つに分かれる）`;
    }
    return null;
  }

  function charHtml(ch) {
    const name = charName(ch);
    return name ? `<span class="x-name">${name}</span>` : `<code class="x-lit">${esc(ch)}</code>`;
  }

  // 文字列のうち、名前で示す文字（スペースや改行）だけを分けて表示する
  function stringHtml(s) {
    let html = '';
    let buf = '';
    for (const ch of s) {
      if (charName(ch)) {
        if (buf) { html += `<code class="x-lit">${esc(buf)}</code>`; buf = ''; }
        html += charHtml(ch);
      } else {
        buf += ch;
      }
    }
    if (buf) html += `<code class="x-lit">${esc(buf)}</code>`;
    return html;
  }

  const pos = (text) => `<span class="x-pos">${text}</span>`;
  const UNDERSCORE = '<code class="x-lit">_</code>';

  // \d などを単独で使ったときの名詞
  const SET_NOUN = {
    digit: '数字（0〜9）',
    nondigit: '数字以外の文字',
    word: `英数字か ${UNDERSCORE}`,
    nonword: `英数字と ${UNDERSCORE} 以外の文字`,
    space: '空白（スペース・タブ・改行など）',
    nonspace: '空白以外の文字',
  };

  // [...] の中で並べるときの名詞
  const SET_ITEM = {
    digit: '数字（0〜9）',
    nondigit: '数字以外',
    word: `英数字と ${UNDERSCORE}`,
    nonword: `英数字と ${UNDERSCORE} 以外`,
    space: '空白',
    nonspace: '空白以外',
  };

  const RANGE_NAMES = {
    'a-z': '英小文字',
    'A-Z': '英大文字',
    '0-9': '数字',
    'a-f': '16進数の英小文字',
    'A-F': '16進数の英大文字',
    'ぁ-ん': 'ひらがな',
    'ぁ-ゖ': 'ひらがな',
    'ァ-ン': 'カタカナ',
    'ァ-ヶ': 'カタカナ',
    'ァ-ヴ': 'カタカナ',
    '一-龠': '漢字（よく使う範囲）',
    '一-龯': '漢字（よく使う範囲）',
    '一-鿿': '漢字（CJK統合漢字）',
    '０-９': '全角数字',
    'Ａ-Ｚ': '全角英大文字',
    'ａ-ｚ': '全角英小文字',
  };

  const UPROP_NAMES = {
    L: 'あらゆる言語の文字',
    Letter: 'あらゆる言語の文字',
    Lu: '大文字',
    Ll: '小文字',
    N: '数字（全角や他の言語の数字を含む）',
    Nd: '10進数の数字',
    P: '句読点',
    S: '記号',
    Emoji: '絵文字',
    'Script=Hiragana': 'ひらがな',
    'Script=Katakana': 'カタカナ',
    'Script=Han': '漢字',
    'Script=Latin': 'ラテン文字',
  };

  const isJsCtx = (ctx) => !ctx || !ctx.dialect || ctx.dialect === 'js';
  const DL = () => global.RegexDialects;

  // \d などの名詞。JavaScript は SET_NOUN のまま、ほかの言語は意味の違いを言葉にする
  function setNoun(kind, ctx) {
    if (isJsCtx(ctx)) return SET_NOUN[kind];
    const d = ctx.dialect;
    const uniDigit = DL().unicodeDigit(d);
    const uniWord = DL().unicodeWord(d);
    switch (kind) {
      case 'digit': return uniDigit ? '数字（全角数字やほかの言語の数字も含む）' : SET_NOUN.digit;
      case 'nondigit': return uniDigit ? '数字以外の文字（全角数字なども数字として除く）' : SET_NOUN.nondigit;
      case 'word': return uniWord ? `文字・数字か ${UNDERSCORE}（ひらがなや漢字も含む）` : SET_NOUN.word;
      case 'nonword': return uniWord ? `文字・数字と ${UNDERSCORE} 以外の文字` : SET_NOUN.nonword;
      case 'space':
        if (d === 'java') return '空白（半角スペース・タブ・改行など。全角スペースは含まない）';
        if (d === 'go') return '空白（半角スペース・タブ・改行など。全角スペースと垂直タブは含まない）';
        return '空白（スペース・タブ・改行・全角スペースなど）';
      case 'nonspace': return SET_NOUN.nonspace;
      case 'hspace': return '横方向の空白（スペース・タブ・全角スペースなど）';
      case 'nonhspace': return '横方向の空白以外の文字';
      case 'vspace': return '縦方向の空白（改行など）';
      case 'nonvspace': return '縦方向の空白以外の文字';
      default: return esc(kind);
    }
  }

  // [...] の中で並べるときの名詞
  function setItem(kind, ctx) {
    if (isJsCtx(ctx)) return SET_ITEM[kind];
    const d = ctx.dialect;
    const uniDigit = DL().unicodeDigit(d);
    const uniWord = DL().unicodeWord(d);
    switch (kind) {
      case 'digit': return uniDigit ? '数字（全角数字なども含む）' : SET_ITEM.digit;
      case 'nondigit': return SET_ITEM.nondigit;
      case 'word': return uniWord ? `文字・数字と ${UNDERSCORE}` : SET_ITEM.word;
      case 'nonword': return uniWord ? `文字・数字と ${UNDERSCORE} 以外` : SET_ITEM.nonword;
      case 'hspace': return '横方向の空白';
      case 'nonhspace': return '横方向の空白以外';
      case 'vspace': return '縦方向の空白';
      case 'nonvspace': return '縦方向の空白以外';
      default: return SET_ITEM[kind] || esc(kind);
    }
  }

  const POSIX_NAMES = {
    alpha: '英字', digit: '数字', alnum: '英数字', upper: '大文字', lower: '小文字', space: '空白', punct: '記号',
    xdigit: '16進数の数字', word: '単語の文字', blank: 'スペースとタブ', cntrl: '制御文字', print: '表示できる文字', graph: '空白以外の表示できる文字',
  };
  // PHP とサクラエディタでは、POSIX の文字クラスが英字以外にも広がる（Go は英字などの ASCII だけ）
  const POSIX_NAMES_UNICODE = {
    alpha: '文字（ひらがなや漢字も含む）', digit: '数字（全角数字なども含む）', alnum: '文字と数字（ひらがなや漢字、全角数字も含む）',
    word: '文字・数字と _', blank: '横方向の空白（全角スペースも含む）', space: '空白（全角スペースも含む）', punct: '句読点と記号',
  };

  function upropNoun(node) {
    const key = node.value.replace(/^(?:sc|Script_Extensions|scx)=/, 'Script=');
    const base = UPROP_NAMES[key] || `Unicode の性質「${esc(node.value)}」を持つ文字`;
    return node.negate ? `${base}以外の文字` : base;
  }

  function classItemHtml(it, ctx) {
    if (it.type === 'range') {
      const name = RANGE_NAMES[`${it.from}-${it.to}`];
      const range = `${charHtml(it.from)}〜${charHtml(it.to)}`;
      return name ? `${name}（${range}）` : range;
    }
    if (it.type === 'set') return setItem(it.kind, ctx);
    if (it.type === 'uprop') return upropNoun(it);
    if (it.type === 'posix') {
      const names = !isJsCtx(ctx) && ctx.dialect !== 'go' ? { ...POSIX_NAMES, ...POSIX_NAMES_UNICODE } : POSIX_NAMES;
      const name = `${names[it.name] || esc(it.name)}（[:${esc(it.name)}:]）`;
      return it.negate ? `${name} 以外` : name;
    }
    return charHtml(it.value);
  }

  function classNoun(node, ctx) {
    if (node.items.length === 0) {
      return node.negate ? anyCharNoun(true) : '存在しない文字（[] はどの文字にも一致しない）';
    }
    const parts = node.items.map((it) => classItemHtml(it, ctx));
    if (node.negate) return `${parts.join('、')} 以外の文字`;
    if (parts.length === 1) {
      const it = node.items[0];
      const unnamedRange = it.type === 'range' && !RANGE_NAMES[`${it.from}-${it.to}`];
      return unnamedRange ? `${parts[0]} のどれか` : parts[0];
    }
    return `${parts.join('、')} のどれか`;
  }

  function anyCharNoun(withNewline, ctx) {
    if (isJsCtx(ctx)) return withNewline ? '任意の文字（改行も含む）' : '任意の文字（改行以外）';
    const d = ctx.dialect;
    // サクラエディタは s フラグにかかわらず、. を [^\r\n] に置き換える
    if (withNewline && d !== 'sakura') return '任意の文字（改行も含む）';
    if (d === 'java') return '任意の文字（改行以外。CR や U+0085 なども除く）';
    if (d === 'sakura') return '任意の文字（改行以外。CR と LF を除く）';
    return '任意の文字（LF の改行以外。CR には一致する）';
  }

  // 1 文字に当たる部品なら、その文字を表す名詞を返す。違えば null
  function singleNoun(node, ctx) {
    switch (node.type) {
      case 'char': return charHtml(node.value);
      case 'set': return setNoun(node.kind, ctx);
      case 'dot': return anyCharNoun(ctx.flags.includes('s'), ctx);
      case 'class': return classNoun(node, ctx);
      case 'uprop': return upropNoun(node);
      default: return null;
    }
  }

  function anchorName(node, ctx) {
    const unit = ctx.flags.includes('m') ? '行' : '文字列';
    const beforeFinal = !isJsCtx(ctx) && DL().dollarBeforeFinal(ctx.dialect);
    switch (node.kind) {
      case 'start': return `${unit}の先頭`;
      case 'end': return unit === '文字列' && beforeFinal ? '文字列の末尾（最後の改行の直前も含む）' : `${unit}の末尾`;
      case 'strStart': return '文字列の先頭（複数行のモードでも）';
      case 'strEnd': return '文字列の末尾（最後の改行の直前は含まない）';
      case 'strEndNl': return '文字列の末尾（最後の改行の直前も含む）';
      case 'wordb': return '単語の区切り';
      default: return '単語の区切りではない位置';
    }
  }

  function anchorTree(node, ctx) {
    const name = pos(anchorName(node, ctx));
    switch (node.kind) {
      case 'wordb': {
        const word = !isJsCtx(ctx) && DL().unicodeWord(ctx.dialect) ? `文字・数字・${UNDERSCORE}` : `英数字・${UNDERSCORE}`;
        return `ここが ${name}（${word} と、それ以外の文字との境目）`;
      }
      case 'nonwordb': return `ここは ${pos('単語の区切り')} ではない`;
      default: return `ここが ${name}`;
    }
  }

  function backrefText(node, ctx) {
    if (node.name != null) {
      return `グループ「${esc(node.name)}」と同じ文字列（そこで一致した内容がもう一度現れる）`;
    }
    if (node.missing) return `グループ${node.index}と同じ文字列（ただし、グループ${node.index}はないので、一致しない）`;
    if (isJsCtx(ctx) && node.index > ctx.groupCount) {
      // u フラグがないと、JavaScript はこれをグループの参照ではなく、8進数の文字コードか数字そのものとして読む
      return ctx.flags.includes('u')
        ? `グループ${node.index}と同じ文字列（ただし、グループ${node.index}はありません）`
        : `${stringHtml(legacyBackrefText(node.raw))} という文字列（グループ${node.index}はないので、\\${node.raw} はグループの参照ではなく、8進数の文字コードや数字として読まれる）`;
    }
    return `グループ${node.index}と同じ文字列（そこで一致した内容がもう一度現れる）`;
  }

  // 回数の言い方。unit は「文字」か「回」
  function countText(min, max, unit) {
    if (min === 0 && max === 1) return `1${unit}`;
    if (min === max) return `${min}${unit}`;
    if (max === Infinity) return `${min}${unit}以上`;
    return `${min}〜${max}${unit}`;
  }

  // 回数のあとに添える補足。0 回を許すときと、最短一致のとき
  function quantNote(node, withOptional = true) {
    if (node.max === 0) return '（0回なので、何もないのと同じ）';
    const notes = [];
    if (withOptional && node.min === 0) notes.push('なくてもよい');
    if (node.lazy) notes.push('できるだけ短く');
    if (node.possessive) notes.push('一度一致したら戻って試し直さない');
    return notes.length ? `（${notes.join('・')}）` : '';
  }

  const FLAG_WORDS = {
    i: '大文字と小文字を区別しない',
    m: '^ と $ を各行の先頭と末尾にする',
    s: '. を改行にも一致させる',
  };

  function applyFlags(ctx, on, off) {
    let flags = ctx.flags;
    for (const f of off) flags = flags.replace(f, '');
    for (const f of on) if (!flags.includes(f)) flags += f;
    return { ...ctx, flags };
  }

  // (?i:...) や (?-s:...) の中で使うフラグ
  function innerCtx(node, ctx) {
    if (node.kind !== 'modifier') return ctx;
    return applyFlags(ctx, node.modOn, node.modOff);
  }

  function flagsText(on, off) {
    const parts = [];
    for (const f of on) parts.push(FLAG_WORDS[f]);
    for (const f of off) parts.push(`「${FLAG_WORDS[f]}」をやめる`);
    return parts.join('、');
  }

  // 「または」の 2 つ目からの候補には、前の候補に書いた (?i) なども効く（parse の flagsIn）
  const seqCtx = (seq, ctx) => (seq.flagsIn ? applyFlags(ctx, seq.flagsIn.on, seq.flagsIn.off) : ctx);

  // 並びの部品を順に処理する。(?i) のようなフラグがあれば、そのあとの部品にだけ効かせる
  function mapSeq(items, ctx, fn) {
    let c = ctx;
    return items.map((n) => {
      const r = fn(n, c);
      if (n.type === 'flags') c = applyFlags(c, n.on, n.off);
      return r;
    });
  }

  const LOOK_NOTE = '（確かめるだけで、一致した文字列には含めない）';

  function groupLabel(node) {
    switch (node.kind) {
      case 'capture': return `グループ${node.index}（一致した部分を、あとで番号で取り出せる）`;
      case 'named': return `グループ${node.index}「${esc(node.name)}」（一致した部分を、あとで名前で取り出せる）`;
      case 'noncapture': return '次をひとまとめにする（取り出しはしない）';
      case 'lookahead': return `すぐ後ろに次が続くこと${LOOK_NOTE}`;
      case 'neglookahead': return `すぐ後ろに次が続かないこと${LOOK_NOTE}`;
      case 'lookbehind': return `すぐ前に次があること${LOOK_NOTE}`;
      case 'neglookbehind': return `すぐ前に次がないこと${LOOK_NOTE}`;
      case 'modifier':
        // サクラエディタの a(?i)b|c は、(?i) からグループの終わりまでを 1 つのまとまりとして読む
        if (node.isolated) return `ここから後ろ（グループの終わりまで。あとの「または」の候補も、このまとまりに入る）は、${flagsText(node.modOn, node.modOff)}`;
        return `この中だけ、${flagsText(node.modOn, node.modOff)}`;
      case 'atomic': return '次をひとまとまりにして、一度一致したら戻って試し直さない（アトミックグループ）';
      default: return 'グループ';
    }
  }

  const EMPTY = '何もない（空でも一致する）';

  function bodyChildren(body, ctx) {
    if (body.type === 'seq') {
      ctx = seqCtx(body, ctx);
      if (body.items.length === 0) return [{ html: EMPTY, start: body.start, end: body.end }];
      return mapSeq(body.items, ctx, describe);
    }
    return [describe(body, ctx)];
  }

  // 子を持たない要素の、木での説明
  function leafTree(node, ctx) {
    switch (node.type) {
      case 'char': return `${charHtml(node.value)} という文字`;
      case 'literal': return `${stringHtml(node.value)} という文字列`;
      case 'anchor': return anchorTree(node, ctx);
      case 'backref': return backrefText(node, ctx);
      case 'flags': return `ここから後ろ（グループの終わりまで。あとに続く「または」の候補にも効く）は、${flagsText(node.on, node.off)}`;
      case 'comment': return 'コメント（一致には関係しない）';
      case 'linebreak': return '改行 1 つ（CRLF・LF・CR など）';
      default: {
        const noun = singleNoun(node, ctx);
        return noun ? `${noun}が1文字` : null;
      }
    }
  }

  // 説明の木を作る。各要素は { html, start, end, children, listType }
  function describe(node, ctx) {
    if (node.type === 'seq') ctx = seqCtx(node, ctx);
    const leaf = leafTree(node, ctx);
    if (leaf != null) return { html: leaf, start: node.start, end: node.end };
    const base = { start: node.start, end: node.end };

    switch (node.type) {
      case 'seq':
        if (node.items.length === 0) return { ...base, html: EMPTY };
        if (node.items.length === 1) return describe(node.items[0], ctx);
        return {
          ...base,
          html: '次の並び',
          children: mapSeq(node.items, ctx, describe),
          listType: 'steps',
        };
      case 'alt':
        return {
          ...base,
          html: '次のどれか',
          children: node.alts.map((a) => describe(a, ctx)),
          listType: 'alt',
        };
      case 'group':
        return {
          ...base,
          html: groupLabel(node),
          children: bodyChildren(node.body, innerCtx(node, ctx)),
          listType: 'steps',
        };
      case 'quant':
        return describeQuant(node, ctx);
      default:
        return { ...base, html: esc(node.type) };
    }
  }

  function describeQuant(node, ctx) {
    const base = { start: node.start, end: node.end };
    const t = node.target;

    const noun = singleNoun(t, ctx);
    if (noun) return { ...base, html: `${noun}が${countText(node.min, node.max, '文字')}${quantNote(node)}` };

    const optional = node.min === 0 && node.max === 1;
    const verb = optional ? 'あってもなくてもよい' : `${countText(node.min, node.max, '回')}繰り返す`;
    const lazy = quantNote(node, !optional);

    if (t.type === 'backref' || t.type === 'anchor' || t.type === 'linebreak') {
      return { ...base, html: `${leafTree(t, ctx)}を${verb}${lazy}` };
    }
    // (?:...) は「ひとまとめにする」を挟まず、中身を直接並べる
    if (t.type === 'group' && t.kind === 'noncapture') {
      return {
        ...base,
        html: optional ? `次の並びは${verb}${lazy}` : `次の並びを${verb}${lazy}`,
        children: bodyChildren(t.body, ctx),
        listType: 'steps',
      };
    }
    return {
      ...base,
      html: optional ? `次は${verb}${lazy}` : `次を${verb}${lazy}`,
      children: [describe(t, ctx)],
    };
  }

  // ---------- 1 行の要約 ----------

  const ARROW = '<span class="x-arrow">→</span>';
  const OR = '<span class="x-or">または</span>';

  // 2 つ以上の部品が並ぶ候補を含む「または」は、要約では中身を書かずに数だけ言う。中身は「くわしく」で見る
  const isComplexAlt = (alt) => alt.alts.some((a) => a.type === 'seq' && a.items.length > 1);
  const altCount = (alt) => `${alt.alts.length}通りの並びのどれか`;

  // 「または」で並べる。2 つ以上の部品が並ぶ候補は（ ）で囲み、どこまでが 1 つの候補かを示す
  function altChain(alt, ctx) {
    if (isComplexAlt(alt)) return altCount(alt);
    return alt.alts.map((a) => {
      const text = short(a, ctx);
      return a.type === 'seq' && a.items.length > 1 ? `（${text}）` : text;
    }).join(` ${OR} `);
  }

  // 先読み・後読みの要約。中身が 1 文字なら「すぐ前が数字ではない」のように言う
  function lookShort(node, inner, ctx) {
    const b = node.body;
    const one = b.type === 'seq' && b.items.length === 1 ? b.items[0] : b;
    const noun = singleNoun(one, ctx);
    const side = node.kind.endsWith('ahead') ? 'すぐ後ろ' : 'すぐ前';
    const neg = node.kind.startsWith('neg');
    if (noun) return `〔${side}が ${noun}${neg ? ' ではない' : ''}〕`;
    if (side === 'すぐ後ろ') return `〔すぐ後ろに ${inner} が${neg ? '続かない' : '続く'}〕`;
    return `〔すぐ前に ${inner} が${neg ? 'ない' : 'ある'}〕`;
  }

  function short(node, ctx) {
    switch (node.type) {
      case 'char': return charHtml(node.value);
      case 'literal': return stringHtml(node.value);
      case 'anchor': return pos(anchorName(node, ctx));
      case 'backref':
        if (node.name != null) return `グループ「${esc(node.name)}」と同じ文字列`;
        if (isJsCtx(ctx) && node.index > ctx.groupCount && !ctx.flags.includes('u')) return stringHtml(legacyBackrefText(node.raw));
        return `グループ${node.index}と同じ文字列`;
      case 'seq':
        return node.items.length
          ? mapSeq(node.items, seqCtx(node, ctx), short).filter((t) => t).join(` ${ARROW} `) || '何もない'
          : '何もない';
      case 'flags': return `〔ここから後ろは、${flagsText(node.on, node.off)}〕`;
      case 'comment': return '';
      case 'linebreak': return '改行 1 つ';
      case 'alt':
        return `［${altChain(node, ctx)}］`;
      case 'group': {
        // 中身が「または」だけなら、括弧を二重にしない
        const ictx = innerCtx(node, ctx);
        const inner = node.body.type === 'alt' ? altChain(node.body, ictx) : short(node.body, ictx);
        switch (node.kind) {
          case 'capture': return `［グループ${node.index}: ${inner}］`;
          case 'named': return `［${esc(node.name)}: ${inner}］`;
          case 'lookahead':
          case 'neglookahead':
          case 'lookbehind':
          case 'neglookbehind':
            return lookShort(node, inner, ctx);
          default: return `［${inner}］`;
        }
      }
      case 'quant': {
        const noun = singleNoun(node.target, ctx);
        if (noun) return `${noun}が${countText(node.min, node.max, '文字')}${quantNote(node)}`;
        return node.min === 0 && node.max === 1
          ? `${short(node.target, ctx)}${quantNote(node)}`
          : `${short(node.target, ctx)}を${countText(node.min, node.max, '回')}繰り返す${quantNote(node)}`;
      }
      default: {
        const noun = singleNoun(node, ctx);
        return noun ? `${noun}が1文字` : esc(node.type);
      }
    }
  }

  // 先頭と末尾の ^ $ を「どこに一致するか」の文に移し、残りを 1 つずつの手順（steps）にする。
  // 各手順は { html, start, end }。listType が 'alt' なら「または」で並ぶ候補、'steps' なら順に並ぶ部品
  function summarize(ast, ctx) {
    const unit = ctx.flags.includes('m') ? '行' : '文字列';
    const step = (n, html) => ({ html, start: n.start, end: n.end });
    if (ast.type !== 'seq') {
      return {
        scope: `${unit}の中から、次のどれかに一致する部分を探します。`,
        listType: 'alt',
        steps: ast.alts.map((a) => step(a, a.type === 'seq' && !a.items.length ? '何もない' : short(a, ctx))),
      };
    }
    let items = ast.items;
    const isAnchor = (n, kind) => n && n.type === 'anchor' && n.kind === kind;
    const head = isAnchor(items[0], 'start');
    if (head) items = items.slice(1);
    const tail = isAnchor(items[items.length - 1], 'end');
    if (tail) items = items.slice(0, -1);
    // 文字だけの手順は、1 行で見ても文字だと分かるよう「という文字」を付ける。コメントは手順に入れない
    const steps = mapSeq(items, ctx, (n, c) => (n.type === 'comment' ? null
      : step(n, short(n, c) + (n.type === 'char' || n.type === 'literal' ? ' という文字' : '')))).filter(Boolean);

    let scope;
    if (!items.length) {
      if (head && tail) scope = `空の${unit}にだけ一致します。`;
      else if (head) scope = `${unit}の先頭の位置に一致します（文字は含みません）。`;
      else if (tail) scope = `${unit}の末尾の位置に一致します（文字は含みません）。`;
      else scope = '空の正規表現です。どの位置にも、長さ 0 で一致します。';
    } else if (head && tail) {
      scope = `${unit}全体が次の並びになっているときに一致します。`;
    } else if (head) {
      scope = `${unit}の先頭から始まる、次の並びに一致します。`;
    } else if (tail) {
      scope = `${unit}の末尾で終わる、次の並びに一致します。`;
    } else {
      scope = `${unit}の中から、次の並びに一致する部分を探します。`;
    }
    return { scope, listType: 'steps', steps };
  }

  const FLAG_TEXT = {
    g: 'すべての一致を探す（最初の1つで止めない）',
    i: '大文字と小文字を区別しない',
    m: '^ と $ を、文字列全体ではなく各行の先頭と末尾として扱う',
    s: '. を改行にも一致させる',
    u: 'Unicode モードにする（\\p{…} などが使え、絵文字のような文字も1文字として数える）',
    y: '調べ始める位置（最初は先頭、続けて調べるときは前回の一致の終わり）でだけ一致を調べ、その先は探さない',
    d: '一致した位置の詳しい情報を記録する',
  };

  // ---------- 入力欄の色分け ----------

  // 構文木から、色分けする範囲 [開始, 終了, 種類] の一覧を作る。種類は app.js と style.css の tok-* と同じ名前
  function tokens(ast) {
    const out = [];
    const add = (start, end, kind) => { if (end > start) out.push([start, end, kind]); };
    (function walk(n, depth) {
      switch (n.type) {
        case 'alt':
          n.alts.forEach((a, k) => {
            walk(a, depth);
            if (k < n.alts.length - 1) add(a.end, a.end + 1, 'alt');
          });
          break;
        case 'seq': n.items.forEach((it) => walk(it, depth)); break;
        case 'quant':
          walk(n.target, depth);
          add(n.qStart, n.end, 'quant');
          break;
        case 'group': {
          // サクラエディタの (?i) からグループの終わりまでのまとまりには、閉じ括弧がない
          if (n.isolated) {
            add(n.start, n.body.start, 'look');
            walk(n.body, depth);
            break;
          }
          const kind = n.kind.includes('look') ? 'look' : `group${depth % 3}`;
          add(n.start, n.body.start, kind);
          walk(n.body, depth + 1);
          add(n.end - 1, n.end, kind);
          break;
        }
        case 'class': case 'set': case 'uprop': case 'dot': case 'linebreak': add(n.start, n.end, 'class'); break;
        case 'flags': add(n.start, n.end, 'look'); break;
        case 'comment': add(n.start, n.end, 'esc'); break;
        case 'anchor': add(n.start, n.end, 'anchor'); break;
        case 'backref': add(n.start, n.end, 'ref'); break;
        case 'char': if (n.end - n.start > 1) add(n.start, n.end, 'esc'); break;
        case 'literal':
          // まとめた文字列の中の \. などのエスケープにも色を付ける
          for (const part of n.parts || []) if (part.end - part.start > 1) add(part.start, part.end, 'esc');
          break;
        default: break;
      }
    })(ast, 0);
    return out;
  }

  // JavaScript 以外のフラグの説明。g は正規表現そのものではなく、テストの欄の設定
  const FLAG_TEXT_OTHER = {
    g: 'すべての一致を探す（テストの欄の設定。プログラムでは、すべての一致を返す関数を選んで決める）',
    i: FLAG_TEXT.i,
    m: FLAG_TEXT.m,
    s: FLAG_TEXT.s,
  };

  function explain(src, flags, dialect = 'js') {
    const { ast, groupCount, dialect: d } = parse(src, flags, dialect);
    const forced = d === 'js' ? '' : global.RegexDialects.forcedFlags(d);
    const ctx = { flags: flags + forced, groupCount, dialect: d };
    let tree;
    if (ast.type === 'seq') {
      tree = ast.items.length
        ? mapSeq(ast.items, ctx, describe)
        : [{ html: '空の正規表現（どの位置にも、長さ 0 で一致する）', start: 0, end: 0 }];
    } else {
      tree = [describe(ast, ctx)];
    }
    // 要約の「文字列」「行」は、先頭の (?m) も見て決める。先頭の (?m) は、あとの「または」の候補にも効く
    let sctx = ctx;
    const firstSeq = ast.type === 'alt' ? ast.alts[0] : ast;
    if (firstSeq.type === 'seq') {
      for (const n of firstSeq.items) {
        if (n.type === 'comment') continue;
        if (n.type !== 'flags') break;
        sctx = applyFlags(sctx, n.on, n.off);
      }
    }
    const texts = d === 'js' ? FLAG_TEXT : FLAG_TEXT_OTHER;
    const flagList = [...flags].filter((f) => texts[f]).map((f) => ({ flag: f, text: texts[f] }));
    for (const f of forced) {
      flagList.push({ flag: f, text: `${FLAG_TEXT[f]}（${global.RegexDialects.get(d).name}では常に有効）` });
    }
    return {
      tree,
      summary: summarize(ast, sctx),
      groupCount,
      flags: flagList,
    };
  }

  global.RegexExplain = { parse, explain, tokens, RegexParseError, escapeHtml: esc };
})(window);
