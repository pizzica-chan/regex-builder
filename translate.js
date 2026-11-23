/*
 * JavaScript 以外の言語の正規表現を、同じ意味の JavaScript の正規表現（v フラグ）に置き換える。
 * 「テスト」の欄と部品の説明の例は、ブラウザの JavaScript で動くので、ここで置き換えてから動かす。
 *
 * - \d \w \s . ^ $ \b などは、その言語での意味（dialects.js）を、文字クラスと先読み・後読みで書き直す
 * - アトミックグループ (?>X) と強欲な繰り返し X*+ は、(?=(X))\n の形で再現する。
 *   このとき増えるグループの番号は groupMap で元の番号に戻す
 * - 置き換えられない書き方は Untranslatable を投げる
 */
(function (global) {
  'use strict';

  class Untranslatable extends Error {}

  const hex = (cp) => cp.toString(16);
  // v フラグの文字クラスの中でも外でも、そのまま書いてよい文字
  const plain = (cp) => (cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || (cp > 0x7f && cp !== 0x2028 && cp !== 0x2029 && !(cp >= 0x80 && cp <= 0x9f) && !(cp >= 0xd800 && cp <= 0xdfff));
  const lit = (ch) => {
    const cp = ch.codePointAt(0);
    return plain(cp) ? ch : `\\u{${hex(cp)}}`;
  };

  // 大文字と小文字を区別しないときに、同じとみなす文字（1 文字になるものだけ）。
  // JavaScript の i フラグ（v フラグあり）が同じとみなす文字にそろえる。テストの欄で i フラグを使うときと結果を合わせるため
  // mode は言語ごとの違い（tools/dialect-probe で、大文字と小文字で形が変わる 3037 文字すべてを各言語の処理系で調べた結果）。
  // ascii: Java。英字だけ / cs: C#。小文字にすると同じ文字になるものだけ（ſ と s、ς と σ は別の文字）。U+10000 以上の文字には効かない /
  // python: Python。i、I、İ、ı の 4 文字を同じとみなす / なし: JavaScript の i フラグと同じ（PHP、Go、サクラエディタ）
  function caseVariants(ch, mode) {
    if (mode === true || mode === 'ascii') return /[A-Za-z]/.test(ch) ? [...new Set([ch, ch.toLowerCase(), ch.toUpperCase()])] : [ch];
    if (mode === 'cs') {
      if (ch.codePointAt(0) > 0xffff) return [ch];
      if (!csGroups) {
        csGroups = new Map();
        for (const c of casedChars()) {
          if (c.codePointAt(0) > 0xffff) continue;
          const key = csLower(c);
          if (!csGroups.has(key)) csGroups.set(key, []);
          csGroups.get(key).push(c);
        }
      }
      return [ch, ...(csGroups.get(csLower(ch)) || []).filter((c) => c !== ch)];
    }
    if (mode === 'python' && /[Iiİı]/.test(ch)) return [ch, ...['I', 'i', 'İ', 'ı'].filter((c) => c !== ch)];
    // posix: 一致の位置を求めるときの決まり。1 文字の大文字にして同じ文字を同じとみなす
    if (mode === 'posix') {
      if (!posixGroups) {
        posixGroups = new Map();
        for (const c of casedChars()) {
          if (!posixKnown(c)) continue;
          const key = posixUpper(c);
          if (!posixGroups.has(key)) posixGroups.set(key, []);
          posixGroups.get(key).push(c);
        }
      }
      return [ch, ...(posixGroups.get(posixUpper(ch)) || []).filter((c) => c !== ch)];
    }
    // posix-line: 一致する行を選ぶときの決まり（下の POSIX_LONESOME の説明）
    if (mode === 'posix-line') {
      const uc = posixUpper(ch);
      const l = uc.toLowerCase();
      const lc = [...l].length === 1 && posixKnown(l) ? l : uc;
      const out = new Set([ch, uc]);
      if (posixUpper(lc) === uc) out.add(lc);
      for (const li of POSIX_LONESOME) if (posixUpper(li) === uc) out.add(li);
      return [...out];
    }
    if (!caseGroups) buildCaseGroups();
    const group = new Set([...(caseGroups.get(caseKey(ch)) || []), ...(caseGroups.get(`+${ch.toUpperCase()}`) || [])]);
    if (!group.size) return [ch];
    const same = new RegExp(`^${lit(ch)}$`, 'iv');
    return [ch, ...[...group].filter((c) => c !== ch && same.test(c))];
  }

  // GNU grep（POSIX）が大文字と小文字を区別しないときに同じとみなす文字。grep は 2 つの決まりを使い分ける
  // （Ubuntu 24.04 の GNU grep 3.11 の grep -i で、大文字と小文字で形が変わる 3037 文字すべてを調べた。glibc が知らない文字は組にしない）。
  // - 一致する行を選ぶとき（posix-line）: 正規表現の文字 c の大文字 U と、U の小文字（その大文字が U に戻るとき）と、
  //   下の表の文字のうち大文字が U になるものを同じとみなす（gnulib の case_folded_counterparts と同じ決まりと考えられる）。
  //   正規表現の В は ᲀ（U+1C80）に一致しないが、ᲀ は В に一致する
  // - 選んだ行の中で一致の位置を求めるとき（posix）: 1 文字の大文字にして同じ文字を同じとみなす。В と ᲀ も同じ
  // そのため、ᲀ は、ほかに一致がある行でだけ В に一致する。どちらの決まりでも、ſ と s は同じ、ケルビン記号と k は別、ß はほかのどの文字とも別
  let posixGroups = null;
  const POSIX_LONESOME = [0xb5, 0x131, 0x17f, 0x1c5, 0x1c8, 0x1cb, 0x1f2, 0x345, 0x3c2, 0x3d0, 0x3d1, 0x3d5, 0x3d6, 0x3f0, 0x3f1, 0x3f5, 0x1e9b, 0x1fbe].map((cp) => String.fromCodePoint(cp));
  // glibc 2.39 が知らない文字は、大文字と小文字の組にならない（dialects.js の POSIX_UNKNOWN）。
  // 知っている文字でも、相手が知らない文字なら組にならない（ɤ と U+A7CB）
  const posixKnown = (c) => !global.RegexDialects || global.RegexDialects.posixKnown(c);
  // 1 文字の大文字。toUpperCase が 2 文字以上を返す文字は、JavaScript の i フラグで同じとみなすタイトルケースの文字（ᾀ なら ᾈ）とする
  const posixUpperCache = new Map();
  function posixUpper(c) {
    if (!posixUpperCache.has(c)) {
      const u = c.toUpperCase();
      let r = c;
      if (!posixKnown(c)) r = c;
      else if ([...u].length === 1) r = posixKnown(u) ? u : c;
      else {
        const same = new RegExp(`^${lit(c)}$`, 'iv');
        r = casedChars().find((x) => /\p{Lt}/v.test(x) && same.test(x)) || c;
      }
      posixUpperCache.set(c, r);
    }
    return posixUpperCache.get(c);
  }

  // 大文字と小文字で組になる文字の一覧。toLowerCase と toUpperCase だけでは、k に対するケルビン記号（U+212A）や
  // s に対する ſ（U+017F）のような組が見つからないので、使うときに一度だけ全部の文字から作る。
  // 大文字にすると 2 文字以上になる文字（ΐ と ΐ は、どちらも Ϊ́ になる）は、大文字の形（+ を付けた鍵）でも組にする
  let caseGroups = null;
  function caseKey(c) {
    const up = c.toUpperCase();
    const low = ([...up].length === 1 ? up : c).toLowerCase();
    return [...low].length === 1 ? low : c;
  }
  function buildCaseGroups() {
    caseGroups = new Map();
    const add = (key, c) => {
      if (!caseGroups.has(key)) caseGroups.set(key, new Set());
      caseGroups.get(key).add(c);
    };
    for (let cp = 0; cp <= 0x1ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const c = String.fromCodePoint(cp);
      const key = caseKey(c);
      const up = c.toUpperCase();
      if (key === c && up === c) continue; // 大文字と小文字の区別がない文字
      add(key, key);
      add(key, c);
      if ([...up].length > 1) add(`+${up}`, c);
    }
  }

  // 大文字と小文字で形が変わる文字の一覧（foldIf で使う）。それ以外の文字は、大文字と小文字を区別しない指定で結果が変わらない
  let casedList = null;
  function casedChars() {
    if (!casedList) {
      const re = /[\p{Changes_When_Casemapped}\p{Changes_When_Casefolded}]/v;
      casedList = [];
      for (let cp = 0; cp <= 0x1ffff; cp++) {
        if (cp >= 0xd800 && cp <= 0xdfff) continue;
        const c = String.fromCodePoint(cp);
        if (re.test(c)) casedList.push(c);
      }
    }
    return casedList;
  }

  // 1 文字を、大文字と小文字を区別しないで比べるときに広げた形（ß は ss、ŉ は ʼn、İ は i と U+0307）。2 文字以上になるものだけ。
  // Unicode の CaseFolding の F に当たる（小文字にしてから、大文字にして、もう一度小文字にする）
  function fullFold(c) {
    const f = c.toLowerCase().toUpperCase().toLowerCase();
    return [...f].length > 1 ? f : null;
  }
  let multiFolds = null;
  // 広げた形 → その形になる 1 文字の一覧
  function multiFoldMap() {
    if (!multiFolds) {
      multiFolds = new Map();
      for (const c of casedChars()) {
        const f = fullFold(c);
        if (!f) continue;
        if (!multiFolds.has(f)) multiFolds.set(f, []);
        multiFolds.get(f).push(c);
      }
    }
    return multiFolds;
  }
  const multiFoldChars = () => [...multiFoldMap().values()].flat();

  let csGroups = null;
  // C# が大文字と小文字を区別しないときに比べる形（小文字）。İ は i にする。小文字が 2 文字になるものは、そのままにする
  function csLower(c) {
    if (c === 'İ') return 'i';
    const low = c.toLowerCase();
    return [...low].length === 1 ? low : c;
  }

  // 文字クラス cls（[…] や \p{…}）に、JavaScript の i フラグを付けると一致する文字が変わるか。
  // \p{L} や \p{Greek} は U+0345 と µ（U+00B5）の 2 文字だけが変わるので、変わらないものとして扱う（\p{Lu} は 1000 文字以上変わる）
  const foldChangeCache = new Map();
  function foldChanges(cls) {
    if (!foldChangeCache.has(cls)) {
      const a = new RegExp(`^${cls}$`, 'v');
      const b = new RegExp(`^${cls}$`, 'iv');
      foldChangeCache.set(cls, casedChars().filter((c) => a.test(c) !== b.test(c)).length > 2);
    }
    return foldChangeCache.get(cls);
  }

  // 文字の並びを、続いている部分を a-z の形にまとめて、文字クラスの中身にする
  function rangesOf(chars) {
    const cps = chars.map((c) => c.codePointAt(0)).sort((a, b) => a - b);
    let out = '';
    for (let k = 0; k < cps.length; k++) {
      let e = k;
      while (e + 1 < cps.length && cps[e + 1] === cps[e] + 1) e++;
      const from = lit(String.fromCodePoint(cps[k]));
      out += e > k ? `${from}-${lit(String.fromCodePoint(cps[e]))}` : from;
      k = e;
    }
    return out;
  }

  // グループの番号ごとに、一致しないまま終わることがあるか（optional）と、グループの終わりの位置（end）
  function groupInfo(ast) {
    const info = new Map();
    (function walk(n, optional) {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'alt') { n.alts.forEach((a) => walk(a, true)); return; }
      if (n.type === 'quant') { walk(n.target, optional || n.min === 0); return; }
      if (n.type === 'group') {
        if (n.index && !info.has(n.index)) info.set(n.index, { optional, start: n.start, end: n.end });
        // 否定の先読み・後読みの中のグループは、一致したあとには残らない
        walk(n.body, optional || n.kind === 'neglookahead' || n.kind === 'neglookbehind');
        return;
      }
      if (n.type === 'seq') n.items.forEach((it) => walk(it, optional));
    })(ast, false);
    return info;
  }

  // 一致しなかったグループを参照するおそれがあるか。参照がグループの終わりより前にある（\1(a) や (a\1)）ときも、
  // 参照する時点ではグループに何も入っていない
  function mayBeUnset(ref, info) {
    const g = info.get(ref.index);
    return !g || g.optional || ref.start < g.end;
  }

  function translate(src, flags, dialect) {
    const RE = global.RegexExplain;
    const D = global.RegexDialects;
    if (dialect === 'js') throw new Error('JavaScript はそのまま動かす');
    // サクラエディタ本体は、. と $ を置き換えてから bregonig.dll に渡す（dialects.js の sakuraEditorPattern）
    const written = src;
    const edit = {};
    if (dialect === 'sakura') src = D.sakuraEditorPattern(src, edit);
    let parsed;
    try {
      parsed = RE.parse(src, flags, dialect);
    } catch (e) {
      if (src === written || !(e instanceof RE.RegexParseError)) throw e;
      // 書いたままでも誤りなら、その誤りを書いた位置で知らせる
      RE.parse(written, flags, dialect);
      // 置き換えたために誤りになった（(?<=a$) など）。位置は、置き換える前の正規表現の位置にする
      const how = edit.replaced.map((c) => (c === '.' ? '. を [^\\r\\n] に' : '$ を (?<![\\r\\n])(?=\\r|$) に')).join('、');
      const pos = e.pos < edit.from.length ? edit.from[e.pos] : written.length;
      throw new RE.RegexParseError(`${e.message}（サクラエディタ本体は、${how}置き換えてから探すため）`, pos);
    }
    const { ast, groupCount } = parsed;
    // ここから先は、処理系が同じ言語（PowerShell は C#）の id で置き換え方を選ぶ。誤りの文言は、上の parse が選んだ言語の名前で出す
    dialect = D.engine(dialect);
    const asciiCase = D.asciiCaseOnly(dialect);
    const forced = D.forcedFlags(dialect);
    const notes = new Set();
    const has = (f) => flags.includes(f) || forced.includes(f);

    // ---------- 1 回目: JavaScript でのグループの番号を決める ----------
    let next = 0;
    const groupMap = new Array(groupCount + 1).fill(null);
    const groups = groupInfo(ast);
    // 正規表現の先頭の (?i) など（コメントを挟んで並んでいてもよい）。あとの「または」の候補にも効くので、正規表現全体に効く
    const firstSeq = ast.type === 'alt' ? ast.alts[0] : ast;
    const leading = [];
    for (const it of firstSeq.type === 'seq' ? firstSeq.items : []) {
      if (it.type === 'flags') leading.push(it);
      else if (it.type !== 'comment') break;
    }
    let scopedCase = false;
    // 大文字と小文字を区別しない指定で一致する文字が変わる \p{…} か POSIX の文字クラスがある（\p{Lu} や [:upper:]。\p{L} や \p{Han} は変わらない）
    let hasCasedProp = false;
    const propClass = (it) => {
      if (it.type === 'uprop') {
        const p = it.js || D.propToJs(it.value, dialect);
        return p && (p.prop ? `\\p{${p.prop}}` : `[${p.range}]`);
      }
      const body = it.type === 'posix' && D.posixToJs(it.name, dialect);
      return body ? `[${body}]` : null;
    };
    const checkProp = (it) => { const cls = propClass(it); if (cls && !hasCasedProp && foldChanges(cls)) hasCasedProp = true; };
    let hasBackref = false;
    const repeats = []; // 2 回以上繰り返す部分（後方参照が、前の回のグループの値を使えるか）
    (function walk(n) {
      switch (n.type) {
        case 'uprop': if (dialect === 'php') checkProp(n); break;
        case 'class':
          if (dialect === 'php') n.items.forEach((it) => { if (it.type === 'uprop' || it.type === 'posix') checkProp(it); });
          if (n.subtract) walk(n.subtract);
          break;
        case 'seq': n.items.forEach((it) => {
          // 先頭以外の (?i) や、i を外す指定があると、範囲ごとに大文字と小文字を扱う必要がある
          if (it.type === 'flags' && (!leading.includes(it) || /i/.test(it.off)) && /i/.test(it.on + it.off)) scopedCase = true;
          walk(it);
        }); break;
        case 'alt': n.alts.forEach(walk); break;
        case 'quant':
          if (n.possessive) n.jsExtra = ++next;
          if (n.max > 1) repeats.push(n);
          walk(n.target);
          break;
        case 'backref': hasBackref = true; break;
        case 'group':
          if (n.kind === 'modifier' && /i/.test(n.modOn + n.modOff)) scopedCase = true;
          if (n.kind === 'atomic') n.jsExtra = ++next;
          if (n.index) {
            n.jsIndex = ++next;
            if (groupMap[n.index] == null) groupMap[n.index] = n.jsIndex;
            else notes.add('同じ名前のグループが 2 つ以上あります。テストの欄の表には、最初のグループの値を出します。');
          }
          walk(n.body);
          break;
        default: break;
      }
    })(ast);

    // 大文字と小文字を区別しない指定が全体に同じように効くなら、JavaScript の i フラグに任せる
    const topI = has('i') || leading.some((f) => f.on.includes('i'));
    // PHP の大文字と小文字を区別しない指定は、\p{…} と POSIX の文字クラスには効かない（\p{Lu} は a に一致しない）。
    // JavaScript の i フラグは効いてしまうので、使わずに 1 文字ずつ書き出す
    const propNoFold = dialect === 'php';
    // Java（英字だけ）、C#、Python は、同じとみなす文字が JavaScript の i フラグと違う（caseVariants）ので、i フラグを使わない。
    // ただし全体に効く指定で後方参照があるときは、大文字と小文字を区別しない後方参照（(a)\1 が aA に一致する）を優先して、i フラグを使う
    const backrefFirst = topI && !scopedCase && hasBackref;
    const posix = D.isPosix(dialect);
    // POSIX で、後方参照を状態機械で探せないとき（正規表現が大きいとき）の注意
    const POSIX_REF_CASE_NOTE = '後方参照があるので、大文字と小文字を区別しない比べ方は、テストの欄では JavaScript の i フラグの決まりにしています。ケルビン記号（U+212A）と k のように、grep では別とみなす文字も同じとみなします。';
    let caseMode = backrefFirst ? '' : asciiCase ? 'ascii' : ['cs', 'python'].includes(dialect) ? dialect : posix ? 'posix' : '';
    let useJsI = topI && !scopedCase && !caseMode && !(propNoFold && hasCasedProp);
    if (asciiCase && (topI || scopedCase)) {
      notes.add(useJsI
        ? 'Java の大文字と小文字を区別しない指定は英字（A〜Z、a〜z）だけに効きますが、後方参照があるので、テストの欄では英字以外（é と É など）も区別しないで比べています。'
        : 'Java の大文字と小文字を区別しない指定は、英字（A〜Z、a〜z）だけに効かせています。');
    }

    // ---------- 2 回目: 書き出す ----------
    const wordClass = `[${D.set('word', dialect)}]`;
    const dotEx = D.dotExcludes(dialect);

    function setBody(kind) {
      const base = { digit: 'digit', nondigit: 'digit', word: 'word', nonword: 'word', space: 'space', nonspace: 'space', hspace: 'hspace', nonhspace: 'hspace', vspace: 'vspace', nonvspace: 'vspace' }[kind];
      return { neg: /^non/.test(kind), body: D.set(base, dialect) };
    }

    function anchor(kind, ctx) {
      const java = dialect === 'java';
      const endNl = D.dollarBeforeFinal(dialect);
      const atEnd = '(?![^])';
      // Java は、最後の改行が CRLF のとき、CR と LF の間には一致しない
      const beforeFinal = endNl === 'any'
        ? '(?=(?:\\u{d}\\u{a}|(?<!\\u{d})\\u{a}|[\\u{d}\\u{85}\\u{2028}\\u{2029}])?(?![^]))'
        : endNl === 'nl' ? '(?=\\u{a}?(?![^]))' : atEnd;
      switch (kind) {
        case 'start':
          if (!ctx.m) return '(?<![^])';
          if (java) return '(?:(?<![^])|(?:(?<=[\\u{a}\\u{85}\\u{2028}\\u{2029}])|(?<=\\u{d})(?!\\u{a}))(?=[^]))';
          // PHP とサクラエディタは、文字列が改行で終わるとき、その改行のあと（文字列の末尾）には一致しない
          return D.caretNotAtEnd(dialect) ? '(?:(?<![^])|(?<=\\u{a})(?=[^]))' : '(?:(?<![^])|(?<=\\u{a}))';
        case 'end':
          if (!ctx.m) return beforeFinal;
          return java
            ? '(?=\\u{d}\\u{a}|(?<!\\u{d})\\u{a}|[\\u{d}\\u{85}\\u{2028}\\u{2029}]|(?![^]))'
            : '(?=\\u{a}|(?![^]))';
        case 'strStart': return '(?<![^])';
        case 'strEnd': return atEnd;
        case 'strEndNl': return beforeFinal;
        case 'wordb': return `(?:(?<=${wordClass})(?!${wordClass})|(?<!${wordClass})(?=${wordClass}))`;
        case 'nonwordb': return `(?:(?<=${wordClass})(?=${wordClass})|(?<!${wordClass})(?!${wordClass}))`;
        // GNU の \< と \>（単語の始まりと終わり）
        case 'wordStart': return `(?<!${wordClass})(?=${wordClass})`;
        case 'wordEnd': return `(?<=${wordClass})(?!${wordClass})`;
        default: throw new Untranslatable('この位置の部品は、テストの欄では動かせません');
      }
    }

    // 大文字と小文字を区別しないで 1 文字を書く（JavaScript の i フラグを使わないとき）
    function charOut(ch, ctx) {
      if (!ctx.i || useJsI) return lit(ch);
      const vs = caseVariants(ch, caseMode);
      return vs.length > 1 ? `[${vs.map(lit).join('')}]` : lit(ch);
    }

    // サクラエディタ（Onigmo）は、大文字と小文字を区別しないとき、ß と ss、ﬀ と ff、ŉ と ʼn のように、
    // 1 文字と、その文字を広げた 2〜3 文字の並びを同じとみなす（逆向きの ss も ß に一致する。実際の結果）。ほかの言語はみなさない
    const multiFold = dialect === 'sakura';
    // 1 文字の鍵（ſ は s、K は k）。大文字が 2 文字以上になる文字は、小文字にするだけ
    const simpleFold = (ch) => {
      const up = ch.toUpperCase();
      return ([...up].length === 1 ? up : ch).toLowerCase();
    };
    function charsOut(chars, ctx) {
      const all = [...new Set(chars.flatMap((ch) => (ctx.i && !useJsI ? caseVariants(ch, caseMode) : [ch])))];
      return all.length > 1 ? `[${all.map(lit).join('')}]` : lit(all[0]);
    }
    // 1 文字を、2〜3 文字の並びにも一致する形で書く。
    // 後読みの中では、広げた並びだけに一致し、その 1 文字自身には一致しない（(?<=ß) は ss のあとに一致し、ß のあとには一致しない。実際の結果）
    function charOutMulti(ch, ctx) {
      const f = ctx.i && multiFold && fullFold(ch);
      if (!f) return charOut(ch, ctx);
      const seq = [...f].map((c) => charOut(c, ctx)).join('');
      return ctx.behind ? seq : `(?:${charsOut([ch, ...multiFoldMap().get(f)], ctx)}|${seq})`;
    }
    // 続いている文字の並び。ss のように、1 文字を広げた並びと同じ部分は、その 1 文字（ß）にも一致させる。後読みの中では、まとめない
    function charRunOut(chars, ctx) {
      if (!multiFold || !ctx.i || ctx.behind) return chars.map((c) => charOutMulti(c, ctx)).join('');
      // k 文字目から始まる、1 文字（ß）にまとめられる並びの長さ
      const lens = chars.map((_, k) => [2, 3].filter((n) => k + n <= chars.length && multiFoldMap().has(chars.slice(k, k + n).map(simpleFold).join(''))));
      const single = (k, n) => charsOut(multiFoldMap().get(chars.slice(k, k + n).map(simpleFold).join('')), ctx);
      // sss は ßs にも sß にも一致するので、まとめる位置を全部試す。候補が多すぎるときは、前からまとめる
      const manyWays = lens.filter((l) => l.length).length > 6;
      const seg = (k) => {
        if (k >= chars.length) return '';
        if (manyWays && lens[k].length) {
          const n = lens[k][lens[k].length - 1];
          return `(?:${single(k, n)}|${chars.slice(k, k + n).map((c) => charOut(c, ctx)).join('')})${seg(k + n)}`;
        }
        const ways = lens[k].map((n) => `${single(k, n)}${seg(k + n)}`);
        ways.push(`${charOutMulti(chars[k], ctx)}${seg(k + 1)}`);
        return ways.length > 1 ? `(?:${ways.join('|')})` : ways[0];
      };
      return seg(0);
    }
    // 文字クラス [ß] も ss に一致する。否定の文字クラスは、1 文字ずつ比べる。後読みの中の [ß] は、ss だけに一致する
    function classMulti(n, ctx) {
      const out = (node) => foldIf(classOut(node, ctx), ctx);
      if (!ctx.i || !multiFold || n.negate || n.subtract) return out(n);
      const multiChar = (it) => it.type === 'char' && fullFold(it.value);
      const rest = ctx.behind ? { ...n, items: n.items.filter((it) => !multiChar(it)) } : n;
      const cls = rest.items.length ? out(rest) : null;
      const folds = new Set();
      for (const it of n.items) {
        if (it.type === 'char' && fullFold(it.value)) folds.add(fullFold(it.value));
        if (it.type === 'range') {
          const a = it.from.codePointAt(0);
          const b = it.to.codePointAt(0);
          for (const c of multiFoldChars()) {
            const cp = c.codePointAt(0);
            if (cp >= a && cp <= b) folds.add(fullFold(c));
          }
        }
      }
      if (!folds.size) return out(n);
      const seqs = [...folds].map((f) => [...f].map((c) => charOut(c, ctx)).join(''));
      return `(?:${[cls, ...seqs].filter(Boolean).join('|')})`;
    }

    function classItem(it, ctx) {
      switch (it.type) {
        case 'char':
          if (it.equiv) notes.add('[=e=] は、テストの欄では書いた文字だけに一致します（ja_JP.UTF-8 と C.UTF-8 の grep と同じ）。en_US.UTF-8 などのロケールの grep では、é のような同じ扱いの文字にも一致します。');
          if (ctx.i && !useJsI) return caseVariants(it.value, caseMode).map(lit).join('');
          return lit(it.value);
        case 'range': {
          // GNU grep は、大文字と小文字を区別しないとき、範囲の両端を大文字にしてから範囲を作る（[A-z] は [A-Z]、[Z-z] は [Z-Z] になり、
          // そのあとで大文字と小文字を区別しないで比べる。Ubuntu 24.04 の grep 3.11 で ASCII の範囲を調べた）
          const from = posix && ctx.i ? posixUpper(it.from) : it.from;
          const to = posix && ctx.i ? posixUpper(it.to) : it.to;
          let out = `${lit(from)}-${lit(to)}`;
          if (from !== it.from || to !== it.to) {
            // 大文字にしたことで、一致する文字が変わるときだけ知らせる（[a-z] は [A-Z] になるが、一致する文字は同じ）
            const span = (x, y) => {
              const set = new Set();
              for (let cp = x.codePointAt(0); cp <= y.codePointAt(0) && set.size < 6000; cp++) {
                for (const v of caseVariants(String.fromCodePoint(cp), caseMode)) set.add(v);
              }
              return set;
            };
            const before = span(it.from, it.to);
            const after = span(from, to);
            if (before.size !== after.size || [...before].some((c) => !after.has(c))) {
              notes.add(`大文字と小文字を区別しないとき、grep は範囲の両端を大文字にしてから範囲を作ります。${it.from}-${it.to} は ${from}-${to} と同じ意味になります。`);
            }
          }
          // GNU grep の範囲は、ASCII の外ではロケールの照合の順で決まる（ja_JP.UTF-8 の [一-龠] は 6274 字だけ。並び順の表にない文字を端にした [一-龯] と、C.UTF-8 の範囲は誤り）
          if (posix && !D.posixCodepointRange(it.from, it.to)) {
            notes.add('ASCII、ひらがな（ぁ〜ん）、カタカナ（ァ〜ヶ）のどれにも収まらない範囲は、テストの欄では文字の番号（コードポイント）の順で一致を調べます。grep ではロケールの並び順で決まるので、一致する文字が違ったり、誤り（Invalid collation character）になったりすることがあります。');
          }
          if (ctx.i && !useJsI) {
            const a = from.codePointAt(0);
            const b = to.codePointAt(0);
            if (b - a > 5000) {
              notes.add('大きな範囲の文字クラスでは、大文字と小文字の区別をテストの欄で再現できないことがあります。');
            } else {
              const extra = new Set();
              for (let cp = a; cp <= b; cp++) {
                for (const v of caseVariants(String.fromCodePoint(cp), caseMode)) {
                  const vc = v.codePointAt(0);
                  if (vc < a || vc > b) extra.add(v);
                }
              }
              out += [...extra].map(lit).join('');
            }
          }
          return out;
        }
        case 'set': {
          const { neg, body } = setBody(it.kind);
          return neg ? `[^${body}]` : `[${body}]`;
        }
        case 'uprop': return prop(it, ctx);
        case 'posix': {
          // GNU grep は、大文字と小文字を区別しないとき、[:upper:] と [:lower:] を [:alpha:] として扱う（あ にも一致する。実際の結果）
          const name = posix && ctx.i && /^(?:upper|lower)$/.test(it.name) ? 'alpha' : it.name;
          const body = D.posixToJs(name, dialect);
          if (!body) throw new Untranslatable(`POSIX の文字クラス [:${it.name}:] は、テストの欄では動かせません`);
          // Go と POSIX（GNU grep）は、範囲を処理系と照らし合わせて同じにしている（Go は BMP の全文字、POSIX は全コードポイントで調べた）
          if (dialect !== 'go' && !posix) notes.add('POSIX の文字クラス（[:alpha:] など）の範囲は、テストの欄では近い範囲で動かしています。');
          // サクラエディタの [:^lower:] は、大文字と小文字を区別しないとき、小文字以外の文字（A など）と同じとみなす文字（a）にも一致する。
          // JavaScript の i フラグは、[^…] を「同じとみなす文字のどれにも一致しない文字」として扱うので、その文字を書き足す（実際の結果）
          if (it.negate && ctx.i && dialect === 'sakura') {
            const inBody = new RegExp(`^[${body}]$`, 'v');
            const add = casedChars().filter((c) => inBody.test(c) && caseVariants(c, false).some((v) => !inBody.test(v)));
            return add.length ? `[[^${body}]${rangesOf(add)}]` : `[^${body}]`;
          }
          return it.negate ? `[^${body}]` : `[${body}]`;
        }
        default: throw new Untranslatable('この文字クラスは、テストの欄では動かせません');
      }
    }

    function prop(n, ctx) {
      const p = n.js || D.propToJs(n.value, dialect);
      if (!p) throw new Untranslatable(`\\p{${n.value}} は、テストの欄では動かせません`);
      const cased = ctx.i && casedProp(n.value);
      if (cased) return n.negate ? `[^${cased}]` : `[${cased}]`;
      if (p.prop) return `${n.negate ? '\\P' : '\\p'}{${p.prop}}`;
      return n.negate ? `[^${p.range}]` : `[${p.range}]`;
    }

    // 大文字と小文字を区別しないとき、Java と C# の \p{Lu} などは、大文字・小文字・タイトルケースの文字のどれにも一致する
    // （ĸ のように大文字のない小文字にも一致する）。Java の \p{Lower} と \p{Upper} は、英字の大文字と小文字に一致する（実際の結果）
    function casedProp(key) {
      if ((dialect === 'java' || dialect === 'cs') && /^(?:Lu|Ll|Lt)$/.test(key)) return '\\p{Lu}\\p{Ll}\\p{Lt}';
      if (dialect === 'java' && /^(?:Uppercase|Lowercase|Titlecase)$/.test(key)) return '\\p{Uppercase}\\p{Lowercase}\\p{Lt}';
      if (dialect === 'java' && /^Posix=(?:lower|upper)$/.test(key)) return 'A-Za-z';
      return null;
    }

    // 正規表現の一部だけで大文字と小文字を区別しないとき（(?i:…)）は、JavaScript の i フラグを使えない。
    // Go とサクラエディタは、\w や \p{Lu} などの文字の集まりにも大文字と小文字を区別しない指定が効く（\w がケルビン記号に一致する）。
    // JavaScript の i フラグを付けたときと同じ文字に一致するように、足す文字と除く文字を書き足す。
    // C# は、1 文字ずつ小文字にして比べる（caseVariants）ので、JavaScript の i フラグの広がり方にはしない（[^s] は ſ に一致する）
    const foldSets = ['go', 'sakura'].includes(dialect);
    // POSIX（GNU grep）は、文字の集まりの中のどれかと「1 文字の大文字にして同じ」文字にも一致させる（[[:upper:]] は a にも一致する）
    function posixClose(cls) {
      const inCls = new RegExp(`^${cls}$`, 'v');
      const add = casedChars().filter((c) => !inCls.test(c) && caseVariants(c, 'posix').some((v) => inCls.test(v)));
      return add.length ? `[${cls}${rangesOf(add)}]` : cls;
    }
    function foldIf(cls, ctx) {
      if (posix) return ctx.i && !useJsI && !cls.startsWith('[^') ? posixClose(cls) : cls;
      if (!ctx.i || useJsI || !foldSets) return cls;
      const plainRe = new RegExp(`^${cls}$`, 'v');
      const foldRe = new RegExp(`^${cls}$`, 'iv');
      const add = [];
      const remove = [];
      for (const c of casedChars()) {
        const a = plainRe.test(c);
        const b = foldRe.test(c);
        if (b && !a) add.push(c);
        else if (a && !b) remove.push(c);
      }
      let out = add.length ? `[${cls}${rangesOf(add)}]` : cls;
      if (remove.length) out = `[${out}--[${rangesOf(remove)}]]`;
      return out;
    }

    function classOut(n, ctx) {
      const body = n.items.map((it) => classItem(it, ctx)).join('');
      // POSIX で大文字と小文字を区別しないときは、中身を広げてから否定する（[^[:upper:]] は a にも一致しない）
      if (posix && ctx.i && !useJsI) {
        const closed = posixClose(`[${body}]`);
        return n.negate ? `[^${closed}]` : closed;
      }
      const out = n.negate ? `[^${body}]` : `[${body}]`;
      // C# の引き算（[a-z-[aeiou]]）は、v フラグの -- で書く
      return n.subtract ? `[${out}--${classOut(n.subtract, ctx)}]` : out;
    }

    function quantText(n) {
      let q;
      if (n.min === 0 && n.max === Infinity) q = '*';
      else if (n.min === 1 && n.max === Infinity) q = '+';
      else if (n.min === 0 && n.max === 1) q = '?';
      else if (n.min === n.max) q = `{${n.min}}`;
      else q = n.max === Infinity ? `{${n.min},}` : `{${n.min},${n.max}}`;
      return q + (n.lazy ? '?' : '');
    }

    // 一度一致したら戻って試し直さない部分（アトミックグループと強欲な繰り返し）。
    // 先読みで一致させた文字列をグループ extra に覚え、その文字列を後方参照で読み進める。
    // 後読みの中では右から左へ照らし合わせるので、後読みで覚えてから後方参照を置く
    function noBacktrack(body, extra, ctx) {
      return ctx.behind ? `(?:\\${extra}(?<=(${body})))` : `(?:(?=(${body}))\\${extra})`;
    }

    function withFlags(ctx, on, off) {
      const c = { ...ctx };
      for (const f of off) c[f] = false;
      for (const f of on) c[f] = true;
      return c;
    }

    function emit(n, ctx) {
      switch (n.type) {
        case 'seq': {
          let out = '';
          // 「または」の 2 つ目からの候補には、前の候補に書いた (?i) なども効く
          let c = n.flagsIn ? withFlags(ctx, n.flagsIn.on, n.flagsIn.off) : ctx;
          // サクラエディタで大文字と小文字を区別しないときは、続いている文字をまとめて書く（charRunOut）
          let run = [];
          const flush = () => {
            if (run.length) out += charRunOut(run, c);
            run = [];
          };
          for (const it of n.items) {
            if (it.type === 'flags') { flush(); c = withFlags(c, it.on, it.off); continue; }
            if (multiFold && c.i && (it.type === 'char' || it.type === 'literal')) {
              run.push(...(it.type === 'char' ? [it.value] : [...it.value]));
              continue;
            }
            flush();
            out += emit(it, c);
          }
          flush();
          return out;
        }
        case 'alt': return n.alts.map((a) => emit(a, ctx)).join('|');
        case 'char': return charOutMulti(n.value, ctx);
        case 'literal': return charRunOut([...n.value], ctx);
        // サクラエディタは、s フラグにかかわらず . を [^\r\n] に置き換えてから渡す
        case 'dot': return ctx.s && dialect !== 'sakura' ? '[^]' : `[^${dotEx}]`;
        case 'set': {
          const { neg, body } = setBody(n.kind);
          return foldIf(neg ? `[^${body}]` : `[${body}]`, ctx);
        }
        case 'uprop': return foldIf(prop(n, ctx), ctx);
        case 'class': return classMulti(n, ctx);
        // PHP とサクラエディタの \R は、CRLF に一致したら CR だけに戻って試し直さない
        case 'linebreak': return D.atomicLinebreak(dialect)
          ? '(?:\\u{d}\\u{a}|\\u{d}(?!\\u{a})|[\\u{a}-\\u{c}\\u{85}\\u{2028}\\u{2029}])'
          : '(?:\\u{d}\\u{a}|[\\u{a}-\\u{d}\\u{85}\\u{2028}\\u{2029}])';
        case 'anchor': return anchor(n.kind, ctx);
        case 'comment': case 'flags': return '';
        case 'backref': {
          if (n.missing) return '(?!)';
          const js = groupMap[n.index];
          if (js == null) throw new Untranslatable('参照しているグループが見つかりません');
          // \1(a) や (a\1) のように、参照する時点でグループに値が入り得ないときは、必ず失敗する（JavaScript は空文字列として一致する）。
          // 繰り返しの中なら、前の回の値を使える。ただしサクラエディタでは、グループの中からの参照はいつも失敗する（実際の結果）
          const g = groups.get(n.index);
          if (g) {
            const inside = g.start < n.start && n.start < g.end;
            const before = n.start < g.start;
            const repeated = repeats.some((q) => q.start <= Math.min(g.start, n.start) && q.end >= Math.max(g.end, n.end));
            if ((dialect === 'sakura' && inside) || ((inside || before) && !repeated)) return '(?!)';
          }
          if (ctx.i && !useJsI) notes.add('大文字と小文字を区別しない後方参照は、テストの欄では大文字と小文字を区別して比べています。');
          // C# と Python の後方参照は、ſ と s、ς と σ を同じとみなさない。JavaScript の i フラグはみなす（実際の結果）
          if (ctx.i && useJsI && posix) notes.add(POSIX_REF_CASE_NOTE);
          if (ctx.i && useJsI && ['cs', 'python'].includes(dialect)) notes.add('大文字と小文字を区別しない後方参照は、テストの欄では ſ と s、ς と σ のような組も同じとみなします。');
          if (mayBeUnset(n, groups)) {
            notes.add('一致しなかったグループを参照すると、この言語では失敗しますが、テストの欄では空文字列として一致したものとして扱います。');
          }
          return `(?:\\${js})`;
        }
        case 'group': {
          let c = n.kind === 'modifier' ? withFlags(ctx, n.modOn, n.modOff) : ctx;
          // 後読みの中は、JavaScript が右から左へ照らし合わせる。先読みの中では、また左から右へ照らし合わせる
          if (/lookbehind/.test(n.kind)) c = { ...c, behind: true };
          else if (/lookahead/.test(n.kind)) c = { ...c, behind: false };
          const body = emit(n.body, c);
          switch (n.kind) {
            case 'capture': case 'named': return `(${body})`;
            case 'noncapture': case 'modifier': return `(?:${body})`;
            case 'lookahead': return `(?=${body})`;
            case 'neglookahead': return `(?!${body})`;
            case 'lookbehind': return `(?<=${body})`;
            case 'neglookbehind': return `(?<!${body})`;
            case 'atomic': return noBacktrack(body, n.jsExtra, ctx);
            default: throw new Untranslatable('このグループは、テストの欄では動かせません');
          }
        }
        case 'quant': {
          // (\w*?)* や (b*?)? のように、中身が空にもなる部分の繰り返し。ほかの言語は、省ける回が空で終わるとそれで繰り返しを終えるが、
          // JavaScript は空の回を数えずに、中身のほかの候補（長い一致）を試し直すので、一致が変わる（tools/dialect-probe で確かめた）。
          // 0 回か 1 回の繰り返し（? と ??）は、空の回の決まりがない「または」の (?:X|) と (?:|X) で、ほかの言語と同じ動きにする
          const emptyFirst = n.max > n.min && minWidth(n.target) === 0;
          if (emptyFirst && n.min === 0 && n.max === 1 && !n.possessive) {
            const body = emit(n.target, ctx);
            return n.lazy ? `(?:|${body})` : `(?:${body}|)`;
          }
          if (emptyFirst) {
            notes.add('(\\w*?)* のように、空の文字列にも一致する部分を 2 回以上繰り返すと、テストの欄ではこの言語と一致が変わることがあります。');
          }
          const t = `(?:${emit(n.target, ctx)})${quantText(n)}`;
          return n.possessive ? noBacktrack(t, n.jsExtra, ctx) : t;
        }
        default: throw new Untranslatable('この部品は、テストの欄では動かせません');
      }
    }

    const ctx = { i: has('i'), m: has('m'), s: has('s') };
    const source = emit(ast, ctx);
    const jsFlags = `v${useJsI ? 'i' : ''}${flags.includes('g') ? 'g' : ''}`;
    // POSIX は、いちばん左で、いちばん長い一致を選ぶ。JavaScript の正規表現は左から順に試して最初に成り立った候補を選ぶので、
    // 状態機械（NFA）を組み立てて match-core.js の findAllPosix で探す。後方参照は状態機械で扱えないので、JavaScript の正規表現で探す
    let program = null;
    let anyBackref = false; // buildProgram で、後方参照を「どんな文字列でもよい」とみなすか
    let refStates = false; // buildProgram で、グループと後方参照の状態を作るか
    // caseMode と useJsI を一時的に変えて buildProgram を呼ぶ
    const buildWith = (mode, opts = {}) => {
      const saved = [caseMode, useJsI, anyBackref, refStates];
      caseMode = mode;
      useJsI = false;
      anyBackref = !!opts.anyBackref;
      refStates = !!opts.refStates;
      try { return buildProgram(ast, ctx); } finally { [caseMode, useJsI, anyBackref, refStates] = saved; }
    };
    if (posix) {
      program = buildProgram(ast, ctx);
      // 後方参照があるときは、グループと後方参照の状態も持つ状態機械を作り、match-core.js ですべての道筋を試して、いちばん長い一致を探す。
      // 後方参照の比べ方は、一致の位置を求めるときの大文字と小文字の決まり（posix）にする
      if (!program && hasBackref) {
        program = buildWith(ctx.i ? 'posix' : caseMode, { refStates: true });
        if (program) {
          program.refs = true;
          program.fold = !!ctx.i;
          program.unknown = D.posixUnknown;
        }
      }
      // 大文字と小文字を区別しないとき、一致する行を選ぶ決まりで組み立てた状態機械が違えば、filter に持たせる（match-core.js が使う）。
      // 後方参照は「どんな文字列でもよい」とみなす（grep は、後方参照があっても、このようにして行を選ぶ）
      if (program && ctx.i) {
        const filter = buildWith('posix-line', { anyBackref: true });
        const plain = program.refs ? buildWith('posix', { anyBackref: true }) : program;
        if (filter && plain && JSON.stringify(filter.states) !== JSON.stringify(plain.states)) program.filter = filter;
      }
      if (program) {
        notes.delete('(\\w*?)* のように、空の文字列にも一致する部分を 2 回以上繰り返すと、テストの欄ではこの言語と一致が変わることがあります。');
        // 後方参照も状態機械で探すので、JavaScript の正規表現の決まりによる注意は要らない
        notes.delete('一致しなかったグループを参照すると、この言語では失敗しますが、テストの欄では空文字列として一致したものとして扱います。');
        notes.delete(POSIX_REF_CASE_NOTE);
        if (groupCount) notes.add('グループの位置は、テストの欄では JavaScript の決まりで求めるので、POSIX の決まりと違うことがあります（一致の範囲は POSIX と同じ）。');
        if (program.refs && program.fold) notes.add('大文字と小文字を区別しない後方参照は、ȿ（U+023F）のように大文字にするとバイト数が増える文字があると、grep では一致しないことがあります（glibc の欠陥）。テストの欄では、意味どおりに一致させます。');
      } else {
        notes.add('正規表現が大きいので、テストの欄ではいちばん長い一致ではなく、JavaScript と同じく左から順に試して最初に成り立った一致を出します。');
      }
    }
    // サクラエディタ本体は 1 行ずつ（行末の改行を含めて）正規表現に渡す。match-core.js の findAllPerLine で、同じように探す
    if (dialect === 'sakura') program = { perLine: true };
    return { source, flags: jsFlags, groupMap, groupCount, notes: [...notes], program };

    // 構文木を、状態の並びにする。状態は c（1 文字を読む。re はその文字に一致する JavaScript の正規表現）、
    // s（a と b のどちらにも進む）、a（位置の確かめ。k は種類）、m（一致）。どれも next か a・b で次の状態の番号を持つ。
    // 後方参照があるときは、gs と ge（グループ k の始まりと終わり）と b（グループ k の後方参照）も使う
    function buildProgram(root, c) {
      const states = [];
      const MAX_STATES = 20000;
      const add = (st) => {
        if (states.length >= MAX_STATES) throw new Untranslatable('too big');
        states.push(st);
        return states.length - 1;
      };
      // n を読んだあと next に進む状態を作り、入り口の番号を返す（後ろから組み立てる）
      function comp(n, next) {
        switch (n.type) {
          case 'seq': {
            let e = next;
            for (let k = n.items.length - 1; k >= 0; k--) e = comp(n.items[k], e);
            return e;
          }
          case 'alt': {
            const entries = n.alts.map((a) => comp(a, next));
            return entries.reduceRight((rest, e) => add({ t: 's', a: e, b: rest }));
          }
          case 'group': {
            // 後方参照があるときは、グループの始まり（gs）と終わり（ge）で、グループに一致した範囲を覚える
            if (!refStates || !n.index) return comp(n.body, next);
            const end = add({ t: 'ge', k: n.index, next });
            return add({ t: 'gs', k: n.index, next: comp(n.body, end) });
          }
          case 'anchor': return add({ t: 'a', k: n.kind, next });
          case 'quant': {
            let e = next;
            if (n.max === Infinity) {
              const loop = add({ t: 's', a: -1, b: next });
              states[loop].a = comp(n.target, loop);
              e = loop;
            } else {
              for (let k = 0; k < n.max - n.min; k++) e = add({ t: 's', a: comp(n.target, e), b: next });
            }
            for (let k = 0; k < n.min; k++) e = comp(n.target, e);
            return e;
          }
          case 'backref': {
            if (refStates) return add({ t: 'b', k: n.index, next });
            if (!anyBackref) throw new Untranslatable('backref');
            // 行を選ぶための状態機械では、後方参照を「どんな文字列でもよい」とみなす
            const loop = add({ t: 's', a: -1, b: next });
            states[loop].a = add({ t: 'c', re: '[^\\n]', next: loop });
            return loop;
          }
          // まとめた文字の並び（abc）は、1 文字ずつ読む
          case 'literal': {
            let e = next;
            const chars = [...n.value];
            for (let k = chars.length - 1; k >= 0; k--) e = add({ t: 'c', re: charOut(chars[k], c), next: e });
            return e;
          }
          default: return add({ t: 'c', re: emit(n, c), next });
        }
      }
      try {
        const match = add({ t: 'm' });
        const start = comp(root, match);
        return { states, start, flags: `v${useJsI ? 'i' : ''}`, word: wordClass };
      } catch (e) {
        if (e instanceof Untranslatable) return null;
        throw e;
      }
    }
  }

  // テスト文字列の中身によって出す注意
  function textNotes(text, dialect) {
    const D = global.RegexDialects;
    const out = [];
    if (D.codeUnits(dialect) && /[\u{10000}-\u{10ffff}]/u.test(text)) {
      out.push(`${D.get(dialect).name} は絵文字などを 2 文字として数えますが、テストの欄では 1 文字として数えます。. や長さの指定を含む一致は、結果が変わることがあります。`);
    }
    return out;
  }

  // ---------- ほかの言語で使うとどうなるか ----------

  // 構文木から、言語によって意味の変わる部品が使われているかを集める
  function usedFeatures(ast, flags) {
    const f = {
      digit: false, word: false, space: false, dot: false, dollar: false, lineAnchor: false, lineCaret: false, linebreak: false, posix: [], backref: false, named: false, numbered: false, caseless: flags.includes('i'),
      caseChars: new Set(), caseRuns: [], // 大文字と小文字を区別しない部分に書いた文字と、続いている文字の並び
      casedProp: false, dotS: false, endNl: false, selfRef: false, astral: false, canBeEmpty: minWidth(ast) === 0,
    };
    const groups = groupInfo(ast);
    const withMod = (ctx, on, off) => {
      const c = { ...ctx };
      for (const x of 'ims') { if (on.includes(x)) c[x] = true; if (off.includes(x)) c[x] = false; }
      return c;
    };
    const addCaseChar = (ch, ctx) => { if (ctx.i) f.caseChars.add(ch); };
    (function walk(n, ctx) {
      switch (n.type) {
        case 'seq': {
          let c = n.flagsIn ? withMod(ctx, n.flagsIn.on, n.flagsIn.off) : ctx;
          let run = '';
          for (const it of n.items) {
            if (it.type === 'flags') { c = withMod(c, it.on, it.off); if (it.on.includes('i')) f.caseless = true; }
            if ((it.type === 'char' || it.type === 'literal') && c.i) { run += it.value; } else if (it.type !== 'flags') { if (run) f.caseRuns.push(run); run = ''; }
            if (it.type !== 'flags') walk(it, c);
          }
          if (run) f.caseRuns.push(run);
          break;
        }
        case 'alt': f.alt = true; n.alts.forEach((a) => walk(a, ctx)); break;
        case 'quant': walk(n.target, ctx); break;
        case 'group':
          if (n.kind === 'named') f.named = true;
          if (n.kind === 'capture') f.numbered = true;
          if (n.kind === 'modifier' && n.modOn.includes('i')) f.caseless = true;
          walk(n.body, n.kind === 'modifier' ? withMod(ctx, n.modOn, n.modOff) : ctx);
          break;
        case 'class':
          if (n.negate) { f.astral = true; f.crossLine = true; }
          n.items.forEach((it) => {
            // ASCII、ひらがな、カタカナのどれにも収まらない範囲。GNU grep ではロケールの並び順で決まる（dialects.js の posixCodepointRange）
            if (it.type === 'range' && !global.RegexDialects.posixCodepointRange(it.from, it.to)) f.wideRange = true;
            if (it.type === 'char') addCaseChar(it.value, ctx);
            else if (it.type === 'range' && ctx.i) {
              const a = it.from.codePointAt(0);
              const b = it.to.codePointAt(0);
              for (let cp = a; cp <= Math.min(b, a + 5000); cp++) addCaseChar(String.fromCodePoint(cp), ctx);
            } else walk(it, ctx);
          });
          if (n.subtract) walk(n.subtract, ctx);
          break;
        case 'char': addCaseChar(n.value, ctx); if (n.value.codePointAt(0) > 0xffff) f.astral = true; if (/[\r\n]/.test(n.value)) f.newlineChar = true; break;
        case 'literal': for (const ch of n.value) { addCaseChar(ch, ctx); if (ch.codePointAt(0) > 0xffff) f.astral = true; } if (/[\r\n]/.test(n.value)) f.newlineChar = true; break;
        case 'uprop':
          f.prop = true;
          if (n.negate) f.astral = true;
          if (ctx.i && /^(?:Lu|Ll|Lt|Uppercase|Lowercase|Titlecase|Posix=lower|Posix=upper)$/.test(n.value)) f.casedProp = true;
          break;
        case 'set':
          if (/digit/.test(n.kind)) f.digit = true;
          if (/word/.test(n.kind)) f.word = true;
          if (/space/.test(n.kind) && !/[hv]space/.test(n.kind)) f.space = true;
          if (/^non/.test(n.kind)) f.astral = true;
          if (/^non|space/.test(n.kind)) f.crossLine = true;
          break;
        case 'dot': if (!ctx.s) f.dot = true; else { f.dotS = true; f.crossLine = true; } f.astral = true; break;
        case 'linebreak': f.linebreak = true; f.newlineChar = true; break;
        case 'posix':
          f.prop = true;
          if (!f.posix.includes(n.name)) f.posix.push(n.name);
          if (ctx.i && /^(?:upper|lower)$/.test(n.name)) f.casedProp = true;
          break;
        case 'anchor':
          if (n.kind === 'wordb' || n.kind === 'nonwordb') f.word = true;
          if (n.kind === 'end' && !ctx.m) f.dollar = true;
          if (n.kind === 'strEndNl') f.endNl = true;
          if ((n.kind === 'start' || n.kind === 'end') && ctx.m) f.lineAnchor = true;
          if (n.kind === 'start' && ctx.m) f.lineCaret = true;
          if ((n.kind === 'start' || n.kind === 'end') && !ctx.m) f.plainAnchor = true;
          if (/^str/.test(n.kind)) f.strAnchor = true;
          break;
        // 参照する時点でいつも一致しているグループなら、どの言語でも結果は同じ
        case 'backref': {
          if (mayBeUnset(n, groups)) f.backref = true;
          if (ctx.i) f.caseRef = true; // 大文字と小文字を区別しない後方参照
          const g = groups.get(n.index);
          if (g && g.start < n.start && n.start < g.end) f.selfRef = true;
          break;
        }
        default: break;
      }
    })(ast, { i: flags.includes('i'), m: flags.includes('m'), s: flags.includes('s') });
    return f;
  }

  // 一致する長さの最小。0 なら、長さ 0 の一致があり得る
  function minWidth(n) {
    switch (n.type) {
      case 'char': case 'set': case 'class': case 'dot': case 'uprop': case 'linebreak': return 1;
      case 'literal': return [...n.value].length;
      case 'seq': return n.items.reduce((s, it) => s + minWidth(it), 0);
      case 'alt': return Math.min(...n.alts.map(minWidth));
      case 'group': return /look/.test(n.kind) ? 0 : minWidth(n.body);
      case 'quant': return n.min * minWidth(n.target);
      default: return 0;
    }
  }

  // 大文字と小文字を区別しないときに同じとみなす文字が、2 つの言語で違うか（caseVariants、charRunOut）
  function caseDiffers(used, from, to) {
    const D = global.RegexDialects;
    const model = (d) => (D.asciiCaseOnly(d) ? 'ascii' : ['cs', 'python'].includes(d) ? d : D.isPosix(d) ? 'posix' : '');
    if (model(from) === 'ascii' || model(to) === 'ascii') return false; // Java は「英字だけに効く」の理由で知らせる
    const multi = (from === 'sakura') !== (to === 'sakura');
    const same = (ch, m) => caseVariants(ch, m(from)).slice().sort().join('') === caseVariants(ch, m(to)).slice().sort().join('');
    // POSIX（GNU grep）は、一致する行を選ぶときの決まり（posix-line）でも比べる
    const lineModel = (d) => (D.isPosix(d) ? 'posix-line' : model(d));
    // 後方参照は、Python と C# では小文字にして同じかで比べる（ſ と s、ᲀ と В は別）。ほかの言語は、文字を比べるときと同じ決まり
    const refModel = (d) => (['cs', 'python'].includes(d) ? 'cs' : model(d));
    for (const ch of used.caseChars) {
      if (!same(ch, model) || (multi && fullFold(ch))) return true;
      if ((D.isPosix(from) || D.isPosix(to)) && !same(ch, lineModel)) return true;
      if (used.caseRef && !same(ch, refModel)) return true;
    }
    if (multi) {
      const fold = (ch) => { const up = ch.toUpperCase(); return ([...up].length === 1 ? up : ch).toLowerCase(); };
      for (const run of used.caseRuns) {
        const chars = [...run].map(fold);
        for (let k = 0; k < chars.length; k++) {
          if ([2, 3].some((n) => multiFoldMap().has(chars.slice(k, k + n).join('')))) return true;
        }
      }
    }
    return false;
  }

  // 位置などの情報を除いた構文木。2 つの言語で同じ読み方をしたかを比べるのに使う
  const IGNORE_KEYS = ['start', 'end', 'qStart', 'parts', 'raw', 'index', 'missing', 'quoted'];
  const CHILD_KEYS = ['items', 'alts', 'body', 'target'];
  // JavaScript の \p{…} には js（テストの欄で動かす形）がないので、名前のまま補って比べる
  function shape(ast) {
    return JSON.stringify(ast, (k, v) => {
      if (IGNORE_KEYS.includes(k)) return undefined;
      return v && v.type === 'uprop' && !v.js ? { ...v, js: { prop: v.value } } : v;
    });
  }

  // 2 つの構文木で、最初に読み方の違う部品を探す。子の部品まで同じなら null
  function firstDiff(a, b) {
    const own = (n) => shape(n && n.type === 'uprop' ? n : Object.fromEntries(Object.entries(n || {}).filter(([k]) => !CHILD_KEYS.includes(k))));
    if (!a || !b || own(a) !== own(b)) return a || b;
    for (const k of CHILD_KEYS) {
      const x = a[k];
      const y = b[k];
      if (Array.isArray(x) || Array.isArray(y)) {
        if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return a;
        for (let i = 0; i < x.length; i++) { const d = firstDiff(x[i], y[i]); if (d) return d; }
      } else if (x || y) {
        const d = firstDiff(x, y);
        if (d) return d;
      }
    }
    return null;
  }

  // JavaScript では書けない部品
  const NOT_IN_JS = { anchor: ['strStart', 'strEnd', 'strEndNl', 'wordStart', 'wordEnd'], group: ['atomic'], type: ['flags', 'comment', 'linebreak'] };

  function hasNotInJs(ast, src) {
    let found = null;
    (function walk(n) {
      if (!n || typeof n !== 'object' || found) return;
      if (n.type === 'anchor' && NOT_IN_JS.anchor.includes(n.kind)) found = `${src.slice(n.start, n.end)} は使えません`;
      else if (n.type === 'group' && n.kind === 'atomic') found = '(?>…)（アトミックグループ）は使えません';
      else if (n.type === 'group' && n.isolated) found = '(?i) のようなフラグの書き方は使えません';
      else if (n.type === 'quant' && n.possessive) found = '*+ のような強欲な繰り返しは使えません';
      else if (NOT_IN_JS.type.includes(n.type)) found = { flags: '(?i) のようなフラグの書き方は使えません', comment: '(?#…) は使えません', linebreak: '\\R は使えません' }[n.type];
      else if (n.type === 'set' && /[hv]space/.test(n.kind)) found = '\\h や \\v（空白の集まり）は使えません';
      else if (n.type === 'posix') found = '[:alpha:] のような POSIX の文字クラスは使えません';
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') walk(v);
      }
    })(ast);
    return found;
  }

  // from の言語で書いた正規表現を、ほかの各言語で使うとどうなるかを返す。
  // 各要素は { dialect, status: 'same' | 'minor' | 'differs' | 'error', reasons: [...] }。
  // minor は、あまり使わない文字（U+0085 など）でだけ結果が変わるとき
  function portability(src, flags, fromId) {
    const RE = global.RegexExplain;
    const D = global.RegexDialects;
    const base = RE.parse(src, flags, fromId);
    // 書き方と一致の決まりは、処理系が同じ言語（PowerShell は C#）の id で比べる。言語の名前と結果の dialect は、選んだ言語の id にする
    const from = D.engine(fromId);
    const fromFlags = flags + D.forcedFlags(from);
    const used = usedFeatures(base.ast, fromFlags);
    const out = [];
    for (const toId of D.ids) {
      if (toId === fromId) continue;
      const to = D.engine(toId);
      const reasons = [];
      const minor = []; // あまり使わない文字でだけ結果が変わる違い
      const name = D.get(toId).name;
      const sub = D.subject(toId);
      // フラグ。i m s はどの言語にもある。u と y は JavaScript だけ
      const toFlags = [...flags].filter((f) => 'gims'.includes(f) || to === 'js').join('');
      if (from === 'js' && flags.includes('y')) reasons.push('y フラグ（今の位置からだけ探す）に当たるものがありません');
      let parsed;
      try {
        if (to === 'js') {
          const nj = hasNotInJs(base.ast, src);
          if (nj) throw new Error(`JavaScript では ${nj}`);
          try {
            new RegExp(src, toFlags.replace('g', '')); // eslint-disable-line no-new
          } catch (e) {
            // 自前の解析で日本語の説明が作れれば、それを使う
            RE.parse(src, toFlags, 'js');
            throw new Error(`JavaScript では書き方の誤りになります（${e.message}）`);
          }
        }
        parsed = RE.parse(src, toFlags, toId);
      } catch (e) {
        const msg = to === 'js' && e instanceof RE.RegexParseError ? `JavaScript では${e.message}` : e.message;
        out.push({ dialect: toId, status: 'error', reasons: [msg] });
        continue;
      }
      if (shape(parsed.ast) !== shape(base.ast)) {
        const d = firstDiff(base.ast, parsed.ast);
        const part = d && d.end > d.start ? `「${src.slice(d.start, d.end)}」` : '書き方の一部';
        reasons.push(`${sub}では、${part}が別の意味に読まれます`);
      }
      const toAll = toFlags + D.forcedFlags(to);
      const diff = (a, b) => a !== b;
      const uni = (fn, d) => fn(d);
      if (used.digit && diff(uni(D.unicodeDigit, from), uni(D.unicodeDigit, to))) {
        reasons.push(D.unicodeDigit(to) ? '\\d が全角数字やほかの言語の数字にも一致します' : '\\d が 0〜9 だけに一致します（全角数字には一致しません）');
      }
      // 大きな違い（全角の文字や CR など）を先に言い、それがなくても範囲が違えば、めったに使わない文字の違いとして言う
      if (used.word && diff(uni(D.unicodeWord, from), uni(D.unicodeWord, to))) {
        reasons.push(D.unicodeWord(to) ? '\\w と \\b が、ひらがなや漢字も単語の文字として扱います' : '\\w と \\b が、英数字と _ だけを単語の文字として扱います');
      } else if (used.word && diff(D.set('word', from), D.set('word', to))) {
        minor.push('\\w と \\b が単語の文字とみなす範囲が少し違います（① や、アクセント記号を組み合わせた文字など）');
      }
      const fullSpace = (d) => !['java', 'go'].includes(d);
      if (used.space && diff(fullSpace(from), fullSpace(to))) {
        reasons.push(fullSpace(to) ? '\\s が全角スペースにも一致します' : '\\s が全角スペースに一致しません');
      } else if (used.space && diff(D.set('space', from), D.set('space', to))) {
        minor.push('\\s が一致する空白の範囲が少し違います（垂直タブや U+0085 など、あまり使わない文字）');
      }
      const dotCr = (d) => !D.dotExcludes(d).includes('\\r');
      if (used.dot && diff(dotCr(from), dotCr(to))) {
        reasons.push(dotCr(to) ? '. が CR（\\r）にも一致します' : '. が CR（\\r）に一致しません');
      } else if (used.dot && diff(D.dotExcludes(from), D.dotExcludes(to))) {
        minor.push('. が一致しない改行の種類が少し違います（U+0085 や U+2028 など）');
      }
      const beforeFinal = (d) => !!D.dollarBeforeFinal(d);
      if (used.dollar && !toAll.includes('m') && !fromFlags.includes('m')) {
        if (diff(beforeFinal(from), beforeFinal(to))) {
          reasons.push(beforeFinal(to) ? '$ が、文字列の最後の改行の直前にも一致します' : '$ が、文字列の最後の改行の直前には一致しません');
        } else if (diff(D.dollarBeforeFinal(from), D.dollarBeforeFinal(to))) {
          minor.push('$ が直前に一致する、文字列の最後の改行の種類が違います（CR や U+0085 など）');
        }
      }
      if (used.lineCaret && toAll.includes('m') && fromFlags.includes('m') && diff(D.caretNotAtEnd(from), D.caretNotAtEnd(to))) {
        reasons.push(D.caretNotAtEnd(to)
          ? '複数行のモードの ^ が文字列の最後の改行のあと（文字列の末尾）には一致しません'
          : '複数行のモードの ^ が文字列の最後の改行のあと（文字列の末尾）にも一致します');
      }
      if (used.linebreak && diff(D.atomicLinebreak(from), D.atomicLinebreak(to))) {
        reasons.push(D.atomicLinebreak(to)
          ? '\\R が CRLF に一致したあと、CR だけに戻って試し直しません（\\R\\n は CRLF に一致しません）'
          : '\\R が CRLF に一致したあとでも、CR だけに戻って試し直します');
      }
      // POSIX の文字クラスとして読まない言語（Python、C#）は、上の「別の意味に読まれます」で知らせる
      const posixIn = (name, d) => D.can(d, 'posix') && D.posixToJs(name, d);
      if (used.posix.some((name) => posixIn(name, from) && posixIn(name, to) && diff(D.posixToJs(name, from), D.posixToJs(name, to)))) {
        reasons.push('[:alpha:] などの POSIX の文字クラスが一致する範囲が違います');
      }
      const mChanges = toAll.includes('m') !== fromFlags.includes('m');
      if ((used.plainAnchor || used.lineAnchor) && mChanges) {
        reasons.push(toAll.includes('m')
          ? `^ と $ が各行の先頭と末尾に一致します（${sub}では複数行のモードが常に有効）`
          : '^ と $ が、各行ではなく文字列全体の先頭と末尾だけに一致します（m フラグを付けると各行に一致します）');
      }
      if (used.lineAnchor && !mChanges && D.lineBreaks(from) !== D.lineBreaks(to)) {
        reasons.push('複数行のモードで、^ と $ が区切りとみなす改行（CR など）が違います');
      }
      if (used.caseless && diff(D.asciiCaseOnly(from), D.asciiCaseOnly(to))) {
        reasons.push(D.asciiCaseOnly(to) ? '大文字と小文字を区別しない指定が、英字（A〜Z）だけに効きます' : '大文字と小文字を区別しない指定が、英字以外（é と É など）にも効きます');
      }
      if (used.caseless && used.prop && (from === 'php') !== (to === 'php')) {
        reasons.push(to === 'php'
          ? '大文字と小文字を区別しない指定が、\\p{…} と [:upper:] などには効きません（\\p{Lu} は a に一致しません）'
          : '大文字と小文字を区別しない指定が、\\p{…} と [:upper:] などにも効きます（\\p{Lu} が a にも一致します）');
      } else if (used.casedProp && !['php', 'python'].includes(from) && !['php', 'python'].includes(to)
        && ['java', 'cs'].includes(from) !== ['java', 'cs'].includes(to)) {
        // Java と C# の \p{Lu} などは、大文字・小文字・タイトルケースのどれにも一致する（casedProp）
        minor.push('大文字と小文字を区別しないとき、\\p{Lu} などが一致する文字が少し違います（ĸ のように大文字のない小文字など）');
      }
      if (used.caseless && caseDiffers(used, from, to)) {
        reasons.push('大文字と小文字を区別しないときに同じとみなす文字が違います（ı と i、ſ と s、ß と ss など）');
      }
      // GNU grep（glibc）は、大文字と小文字を区別しない後方参照で、大文字にするとバイト数が増える文字（ȿ など 18 文字）があると、
      // 意味どおりに一致しないことがある（docs/dialects/posix.md）
      if (used.caseRef && D.isPosix(from) !== D.isPosix(to)) {
        reasons.push('grep は、大文字と小文字を区別しない後方参照で、ȿ のように大文字にするとバイト数が増える文字があると、一致しないことがあります');
      }
      // サクラエディタは、s フラグにかかわらず . を [^\r\n] に置き換える
      if (used.dotS && (from === 'sakura') !== (to === 'sakura')) {
        reasons.push(to === 'sakura' ? '. が、s フラグを付けても改行（CR と LF）に一致しません' : '. が、s フラグを付けると改行にも一致します');
      }
      if (used.endNl && diff(D.dollarBeforeFinal(from), D.dollarBeforeFinal(to))) {
        minor.push('\\Z が直前に一致する、文字列の最後の改行の種類が違います（CR や U+0085 など）');
      }
      if (used.selfRef && (from === 'sakura') !== (to === 'sakura')) {
        reasons.push(to === 'sakura'
          ? 'グループの中から、そのグループ自身を参照すると（(a|b\\1)+ の \\1）、参照が必ず失敗します'
          : 'グループの中から、そのグループ自身を参照すると（(a|b\\1)+ の \\1）、前の回に一致した文字列と比べます');
      }
      // POSIX（grep）は、いちばん左で、いちばん長い一致を選び、1 行ずつ調べる
      if (D.isPosix(from) !== D.isPosix(to)) {
        if (used.alt) {
          reasons.push(D.isPosix(to)
            ? '「または」の候補のうち、いちばん長く一致するものを選びます（a|ab は ab に一致します）'
            : '「または」の候補を左から順に試し、最初に成り立ったものを選びます（a|ab は ab のうち a に一致します）');
        }
        if (used.crossLine) {
          reasons.push(D.isPosix(to) ? 'grep は 1 行ずつ調べるので、改行をまたいで一致しません' : '1 行ずつではなく文字列全体を調べるので、\\s や [^…] が改行にも一致します');
        }
        if (used.canBeEmpty) {
          reasons.push(D.isPosix(to) ? 'grep は、長さ 0 の一致を出しません（x* は空の一致を数えません）' : '長さ 0 の一致も、一致として数えます');
        }
        if (used.wideRange) {
          reasons.push(D.isPosix(to)
            ? '[一-龠] のような、ASCII、ひらがな、カタカナのどれにも収まらない範囲は、grep ではロケールの並び順で決まるので、一致する文字が変わったり、誤りになったりすることがあります'
            : '[一-龠] のような、ASCII、ひらがな、カタカナのどれにも収まらない範囲は、ロケールの並び順ではなく、文字の番号（コードポイント）の順で決まります');
        }
        if (used.casedProp) {
          reasons.push(D.isPosix(to)
            ? '大文字と小文字を区別しないとき、[:upper:] と [:lower:] が [:alpha:] と同じになります（あ にも一致します）'
            : '大文字と小文字を区別しないとき、[:upper:] と [:lower:] は [:alpha:] と同じになりません');
        }
      }
      // サクラエディタ本体は 1 行ずつ（行末の改行を含めて）探す（match-core.js の findAllPerLine）。POSIX との違いは上の grep の理由で知らせる
      if ((from === 'sakura') !== (to === 'sakura') && !D.isPosix(from) && !D.isPosix(to)) {
        if (used.crossLine || used.newlineChar) {
          reasons.push(to === 'sakura'
            ? 'サクラエディタは 1 行ずつ（行末の改行を含めて）探すので、改行のあとの文字までは一致しません'
            : '1 行ずつではなく文字列全体を調べるので、改行のあとの文字まで一致することがあります');
        }
        if (used.strAnchor) {
          reasons.push(to === 'sakura'
            ? 'サクラエディタは 1 行ずつ探すので、\\A、\\z、\\Z が各行の先頭と末尾に一致します'
            : '\\A、\\z、\\Z が、各行ではなく文字列全体の先頭と末尾に一致します');
        }
      }
      if (used.canBeEmpty && D.emptyMode(from) !== D.emptyMode(to) && !D.isPosix(from) && !D.isPosix(to)) {
        reasons.push('長さ 0 の一致のあとの探し方が違うので、見つかる一致の数が変わることがあります（a?? や x* など）');
      } else if (used.canBeEmpty && (from === 'java') !== (to === 'java') && !D.isPosix(from) && !D.isPosix(to)) {
        // Java は長さ 0 の一致のあと UTF-16 の 1 単位だけ進む（tools/dialect-probe の \x{1F600}??）
        minor.push(to === 'java' ? '長さ 0 の一致が、絵文字などの途中にも出ます' : '長さ 0 の一致が、絵文字などの途中には出ません');
      }
      if (used.astral && D.codeUnits(from) !== D.codeUnits(to)) {
        minor.push(D.codeUnits(to) ? '絵文字などを 2 文字として数えます（. や [^…] が絵文字の半分に一致します）' : '絵文字などを 1 文字として数えます');
      }
      if (used.backref && (from === 'js') !== (to === 'js')) {
        reasons.push(to === 'js' ? '一致しなかったグループを参照すると、空文字列として一致します' : '一致しなかったグループを参照すると、その参照は失敗します');
      }
      if (used.named && used.numbered && (from === 'cs') !== (to === 'cs')) {
        reasons.push('名前付きのグループと名前なしのグループを混ぜたときの、グループの番号の付け方が違います');
      }
      const status = reasons.length ? 'differs' : minor.length ? 'minor' : 'same';
      out.push({ dialect: toId, status, reasons: [...reasons, ...minor] });
    }
    return out;
  }

  global.RegexTranslate = { translate, textNotes, portability, Untranslatable };
})(typeof window !== 'undefined' ? window : globalThis);
