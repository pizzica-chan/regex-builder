/*
 * 言語ごとの正規表現の違い（方言）の定義。
 * 書き方が使えるか、\d などがどの文字に一致するかは、tools/dialect-probe で各言語の処理系を実際に動かして調べた結果に合わせている。
 * regex-explain.js（解析と説明）と translate.js（試す欄で動かす形への置き換え）が使う。
 */
(function (global) {
  'use strict';

  const ALL = ['js', 'python', 'java', 'php', 'cs', 'go', 'sakura'];
  const except = (...ids) => ALL.filter((d) => !ids.includes(d));

  const LIST = [
    { id: 'js', name: 'JavaScript', engine: 'JavaScript（ブラウザ・Node.js）' },
    { id: 'python', name: 'Python', engine: 'Python 3.13 の re' },
    { id: 'java', name: 'Java', engine: 'Java 21 の java.util.regex（Eclipse の検索・置換も同じ）' },
    { id: 'php', name: 'PHP', engine: 'PHP 8.3 の preg_* 関数（PCRE2 10.42、u 修飾子あり）' },
    { id: 'cs', name: 'C#', engine: '.NET 7 の System.Text.RegularExpressions' },
    { id: 'go', name: 'Go', engine: 'Go 1.27 の regexp（RE2）' },
    { id: 'sakura', name: 'サクラエディタ', engine: 'サクラエディタ 2.4 の bregonig.dll 4.20（Onigmo 6.2.0）' },
  ];

  // 書き方ごとに、使える言語
  const FEATURES = {
    namedAngle: except('python'), // (?<name>…)
    namedP: ['python', 'php', 'go', 'sakura'], // (?P<name>…)
    namedQuote: ['php', 'cs', 'sakura'], // (?'name'…)
    krefAngle: ['js', 'java', 'php', 'cs', 'sakura'], // \k<name>
    prefP: ['python', 'php', 'sakura'], // (?P=name)
    backref: except('go'), // \1
    lookahead: except('go'),
    lookbehind: except('go'),
    atomic: ['python', 'java', 'php', 'cs', 'sakura'], // (?>…)
    possessive: ['python', 'java', 'php', 'sakura'], // *+ ++ ?+ {n,m}+
    anchorA: except('js'), // \A
    anchorz: ['java', 'php', 'cs', 'go', 'sakura'], // \z
    anchorZ: ['python', 'java', 'php', 'cs', 'sakura'], // \Z
    inlineFlags: except('js'), // (?i) のように : を付けない書き方
    inlineFlagsMiddle: ['java', 'php', 'cs', 'go', 'sakura'], // 正規表現の途中の (?i)
    comment: ['python', 'php', 'cs', 'sakura'], // (?#…)
    quoteQE: ['java', 'php', 'go', 'sakura'], // \Q…\E
    uprop: except('python'), // \p{…}（JavaScript は u フラグが要る）
    posix: ['php', 'go', 'sakura'], // [[:alpha:]]
    xBrace: ['java', 'php', 'go', 'sakura'], // \x{41}
    xHex2: except('sakura'), // \x41
    uHex4: ['js', 'python', 'java', 'cs'], // \u0041
    ctrlLetter: ['js', 'java', 'php', 'cs', 'sakura'], // \cA
    octal: except('sakura'), // \012
    zeroAlone: except('java', 'sakura'), // \0
    oBrace: ['php', 'sakura'], // \o{101}
    hSpace: ['java', 'php'], // \h \H
    vSpace: ['java', 'php'], // \v \V を縦方向の空白の集まりとして読む
    linebreakR: ['java', 'php', 'sakura'], // \R
    bell: except('js'), // \a
    escChar: ['java', 'php', 'cs', 'sakura'], // \e
    dupNames: ['cs', 'go', 'sakura'], // 同じ名前のグループを 2 つ以上置ける
    nestedQuant: ['sakura'], // a** のように繰り返しを重ねられる
    unknownLetterEscape: ['js', 'sakura'], // \q のような、意味のない英字のエスケープを文字として読む
    classNested: ['java', 'sakura'], // [a[b]] と [a-z&&[^b]]
  };

  // 後読みの中に書けるもの。any: 何でも / bounded: 最大の長さが決まっていればよい /
  // fixed-alt: 「または」の候補ごとに長さが決まっていればよい / fixed: 全体の長さが 1 つに決まっていること
  const LOOKBEHIND = { js: 'any', cs: 'any', java: 'bounded', php: 'fixed-alt', sakura: 'fixed-alt', python: 'fixed' };

  // \d \w \s が一致する文字。JavaScript の u フラグの書き方で表す（tools/dialect-probe/fit-classes.js で照らし合わせた）
  const ASCII_DIGIT = '0-9';
  const ASCII_WORD = 'A-Za-z0-9_';
  const SETS = {
    digit: { js: ASCII_DIGIT, java: ASCII_DIGIT, go: ASCII_DIGIT, python: '\\p{Nd}', php: '\\p{Nd}', cs: '\\p{Nd}', sakura: '\\p{Nd}' },
    word: {
      js: ASCII_WORD,
      java: ASCII_WORD,
      go: ASCII_WORD,
      python: '\\p{L}\\p{N}_',
      php: '\\p{L}\\p{N}_',
      cs: '\\p{L}\\p{Mn}\\p{Nd}\\p{Pc}',
      sakura: '\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\xb2\\xb3\\xb9\\xbc-\\xbe',
    },
    space: {
      js: '\\t-\\r\\x20\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff',
      python: '\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000',
      java: '\\t-\\r\\x20',
      php: '\\t-\\r\\x20\\x85\\xa0\\u1680\\u180e\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000',
      cs: '\\t-\\r\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000',
      go: '\\t\\n\\f\\r\\x20',
      sakura: '\\t-\\r\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000',
    },
    // \h（横方向の空白）と、Java と PHP の \v（縦方向の空白）
    hspace: '\\t\\x20\\xa0\\u1680\\u180e\\u2000-\\u200a\\u202f\\u205f\\u3000',
    vspace: '\\n-\\r\\x85\\u2028\\u2029',
  };

  // . が一致しない文字（s フラグがないとき）
  const DOT_EXCLUDES = {
    js: '\\n\\r\\u2028\\u2029',
    java: '\\n\\r\\x85\\u2028\\u2029',
    python: '\\n', php: '\\n', cs: '\\n', go: '\\n',
    // bregonig.dll だけなら \n 以外に一致するが、サクラエディタ本体が . を [^\r\n] に置き換えてから渡す（ヘルプ HLP000089）
    sakura: '\\n\\r',
  };

  // 必ず付いているフラグ。サクラエディタは m（複数行）を付けて bregonig.dll に渡す（ヘルプ HLP000089）
  const FORCED_FLAGS = { sakura: 'm' };
  // 付けても意味のないフラグ。サクラエディタは . を [^\r\n] に置き換えるので、s が効かない
  const NO_EFFECT_FLAGS = { sakura: 's' };

  // $（m フラグなし）が、最後の改行の直前にも一致するか。'nl': \n の直前 / 'any': どの改行の直前でも（Java） / '': 末尾だけ
  const DOLLAR_BEFORE_FINAL = { js: '', go: '', python: 'nl', php: 'nl', cs: 'nl', sakura: 'nl', java: 'any' };

  // m フラグのとき、^ と $ が区切りとみなす改行
  const LINE_BREAKS = { js: 'js', java: 'java', python: 'lf', php: 'lf', cs: 'lf', go: 'lf', sakura: 'lf' };

  // 大文字と小文字を区別しない指定が、英字（ASCII）だけに効く言語
  const ASCII_CASE_ONLY = ['java'];

  // 絵文字などを 2 文字（UTF-16 の 2 単位）として数える言語。JavaScript は u フラグがないとき
  const CODE_UNITS = ['cs'];

  // \p{…} の名前を、JavaScript の u フラグの書き方に置き換える。置き換えられない名前は null
  const SCRIPTS = ['Han', 'Hiragana', 'Katakana', 'Latin', 'Greek', 'Cyrillic', 'Arabic', 'Hangul', 'Hebrew', 'Thai', 'Common'];
  const CATEGORIES = /^(?:L|Lu|Ll|Lt|Lm|Lo|M|Mn|Mc|Me|N|Nd|Nl|No|P|Pc|Pd|Ps|Pe|Pi|Pf|Po|S|Sm|Sc|Sk|So|Z|Zs|Zl|Zp|C|Cc|Cf|Co|Cn)$/;
  const BLOCKS = { // .NET の Is〜 と Java の In〜（ブロック）。JavaScript にはブロックの指定がないので範囲で書く
    Hiragana: '\\u3040-\\u309f',
    Katakana: '\\u30a0-\\u30ff',
    CJKUnifiedIdeographs: '\\u4e00-\\u9fff',
    BasicLatin: '\\x00-\\x7f',
  };
  function propToJs(name, dialect) {
    if (dialect === 'js') return { prop: name };
    if (CATEGORIES.test(name)) return { prop: name };
    let m;
    if ((m = /^(?:script|sc)=(\w+)$/i.exec(name)) && SCRIPTS.includes(m[1])) {
      return ['java', 'php'].includes(dialect) ? { prop: `Script=${m[1]}` } : null;
    }
    if (SCRIPTS.includes(name) && ['php', 'go', 'sakura'].includes(dialect)) return { prop: `Script=${name}` };
    if ((m = /^Is(\w+)$/.exec(name))) {
      if (dialect === 'java' && (SCRIPTS.includes(m[1]) || CATEGORIES.test(m[1]))) {
        return { prop: SCRIPTS.includes(m[1]) ? `Script=${m[1]}` : m[1] };
      }
      if (dialect === 'cs' && BLOCKS[m[1]]) return { range: BLOCKS[m[1]] };
    }
    if ((m = /^In(\w+)$/.exec(name)) && dialect === 'java' && BLOCKS[m[1]]) return { range: BLOCKS[m[1]] };
    return null;
  }

  // POSIX の文字クラス（[[:alpha:]]）。Go は ASCII だけ、PHP（u 修飾子あり）とサクラエディタは Unicode に広がる
  const POSIX_ASCII = {
    alpha: 'A-Za-z', digit: '0-9', alnum: 'A-Za-z0-9', upper: 'A-Z', lower: 'a-z', space: '\\t-\\r\\x20',
    xdigit: '0-9A-Fa-f', word: 'A-Za-z0-9_', blank: '\\t\\x20', cntrl: '\\x00-\\x1f\\x7f',
    punct: '!-\\/:-@\\[-`{-~', print: '\\x20-\\x7e', graph: '!-~',
  };
  const POSIX_UNICODE = {
    alpha: '\\p{L}', digit: '\\p{Nd}', alnum: '\\p{L}\\p{Nd}', upper: '\\p{Lu}', lower: '\\p{Ll}', xdigit: '0-9A-Fa-f',
    word: '\\p{L}\\p{N}_', blank: '\\t\\x20\\xa0\\u1680\\u2000-\\u200a\\u202f\\u205f\\u3000',
  };
  function posixToJs(name, dialect) {
    if (dialect === 'go') return POSIX_ASCII[name] || null;
    return POSIX_UNICODE[name] || null;
  }

  // 言語ごとに使えるフラグ。js 以外の g は「試す欄ですべての一致を探す」だけの意味
  const FLAG_SETS = {
    js: ['g', 'i', 'm', 's', 'u', 'y'],
    other: ['g', 'i', 'm', 's'],
  };

  // ---------- コードの形でのコピー ----------

  function codeSnippet(src, flags, dialect) {
    const f = (c) => flags.includes(c);
    switch (dialect) {
      case 'python': {
        const opts = [f('i') && 're.IGNORECASE', f('m') && 're.MULTILINE', f('s') && 're.DOTALL'].filter(Boolean);
        return `re.compile(${pyString(src)}${opts.length ? `, ${opts.join(' | ')}` : ''})`;
      }
      case 'java': {
        const opts = [f('i') && 'Pattern.CASE_INSENSITIVE', f('m') && 'Pattern.MULTILINE', f('s') && 'Pattern.DOTALL'].filter(Boolean);
        return `Pattern.compile(${cString(src)}${opts.length ? `, ${opts.join(' | ')}` : ''})`;
      }
      case 'php': {
        // / を区切りに使い、パターンの中の / を \/ にする。日本語を 1 文字として扱うため u を付ける
        const body = src.replace(/\\.|\//g, (m) => (m === '/' ? '\\/' : m));
        const mods = `${f('i') ? 'i' : ''}${f('m') ? 'm' : ''}${f('s') ? 's' : ''}u`;
        return `'/${body.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}/${mods}'`;
      }
      case 'cs': {
        const opts = [f('i') && 'RegexOptions.IgnoreCase', f('m') && 'RegexOptions.Multiline', f('s') && 'RegexOptions.Singleline'].filter(Boolean);
        return `new Regex(@"${src.replace(/"/g, '""')}"${opts.length ? `, ${opts.join(' | ')}` : ''})`;
      }
      case 'go': {
        const inline = `${f('i') ? 'i' : ''}${f('m') ? 'm' : ''}${f('s') ? 's' : ''}`;
        const body = (inline ? `(?${inline})` : '') + src;
        return body.includes('`') ? `regexp.MustCompile(${cString(body)})` : `regexp.MustCompile(\`${body}\`)`;
      }
      case 'sakura': {
        // サクラエディタの検索ダイアログには、パターンをそのまま入れる。フラグは (?i) のように先頭に書く
        const inline = `${f('i') ? 'i' : ''}${f('m') ? 'm' : ''}${f('s') ? 's' : ''}`;
        return (inline ? `(?${inline})` : '') + src;
      }
      default:
        return null; // JavaScript は app.js が /…/flags の形にする
    }
  }

  // Python の文字列。r'…' を基本にし、使えないとき（' と " の両方を含む、\ で終わる）は普通の文字列にする
  function pyString(s) {
    const endsWithOddBackslash = /(?:^|[^\\])(?:\\\\)*\\$/.test(s);
    if (!endsWithOddBackslash && !s.includes("'")) return `r'${s}'`;
    if (!endsWithOddBackslash && !s.includes('"')) return `r"${s}"`;
    return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }

  // Java や Go の "…" の文字列
  function cString(s) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  const byId = Object.fromEntries(LIST.map((d) => [d.id, d]));

  global.RegexDialects = {
    LIST,
    ids: ALL,
    get: (id) => byId[id] || byId.js,
    // 「〜では」の前に置く名前。英字で終わる名前のあとには空白を入れる（「Java では」「サクラエディタでは」）
    subject: (id) => {
      const name = (byId[id] || byId.js).name;
      return /[A-Za-z#]$/.test(name) ? `${name} ` : name;
    },
    can: (dialect, feature) => (FEATURES[feature] || []).includes(dialect),
    lookbehind: (dialect) => LOOKBEHIND[dialect] || null,
    set: (kind, dialect) => (typeof SETS[kind] === 'string' ? SETS[kind] : SETS[kind][dialect]),
    dotExcludes: (dialect) => DOT_EXCLUDES[dialect],
    dollarBeforeFinal: (dialect) => DOLLAR_BEFORE_FINAL[dialect],
    lineBreaks: (dialect) => LINE_BREAKS[dialect],
    asciiCaseOnly: (dialect) => ASCII_CASE_ONLY.includes(dialect),
    codeUnits: (dialect) => CODE_UNITS.includes(dialect),
    unicodeDigit: (dialect) => SETS.digit[dialect] !== ASCII_DIGIT,
    unicodeWord: (dialect) => SETS.word[dialect] !== ASCII_WORD,
    propToJs,
    // Java と C# は、\p{Han} のような用字の名前だけの書き方を受け付けない（実際に書き方の誤りになった）
    bareScriptInvalid: (name, dialect) => ['java', 'cs'].includes(dialect) && SCRIPTS.includes(name),
    posixToJs,
    flags: (dialect) => (dialect === 'js' ? FLAG_SETS.js : FLAG_SETS.other)
      .filter((f) => !(FORCED_FLAGS[dialect] || '').includes(f) && !(NO_EFFECT_FLAGS[dialect] || '').includes(f)),
    forcedFlags: (dialect) => FORCED_FLAGS[dialect] || '',
    codeSnippet,
  };
})(typeof window !== 'undefined' ? window : globalThis);
