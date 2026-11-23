/*
 * 言語ごとの正規表現の違い（方言）の定義。
 * 書き方が使えるか、\d などがどの文字に一致するかは、tools/dialect-probe で各言語の処理系を実際に動かして調べた結果に合わせている。
 * regex-explain.js（解析と説明）と translate.js（テストの欄で動かす形への置き換え）が使う。
 */
(function (global) {
  'use strict';

  // ere と bre は POSIX の拡張正規表現と基本正規表現（GNU grep）。書き方が大きく違うので、regex-explain.js の parsePosix で別に読む。
  // FEATURES の表は、ほかの 7 つの言語のためのもの
  const ALL = ['js', 'python', 'java', 'php', 'cs', 'go', 'sakura', 'ere', 'bre'];
  const BASE = ALL.filter((d) => d !== 'ere' && d !== 'bre');
  const except = (...ids) => BASE.filter((d) => !ids.includes(d));
  const POSIX_DIALECTS = ['ere', 'bre'];

  const LIST = [
    { id: 'js', name: 'JavaScript', engine: 'JavaScript（ブラウザ・Node.js）' },
    { id: 'python', name: 'Python', engine: 'Python 3.13 の re' },
    { id: 'java', name: 'Java', engine: 'Java 21 の java.util.regex（Eclipse の検索・置換も同じ）' },
    { id: 'php', name: 'PHP', engine: 'PHP 8.3 の preg_* 関数（PCRE2 10.42、u 修飾子あり）' },
    { id: 'cs', name: 'C#', engine: '.NET 7 の System.Text.RegularExpressions' },
    { id: 'go', name: 'Go', engine: 'Go 1.27 の regexp（RE2）' },
    { id: 'sakura', name: 'サクラエディタ', engine: 'サクラエディタ 2.4 の bregonig.dll 4.20（Onigmo 6.2.0）' },
    { id: 'ere', name: 'POSIX ERE', engine: 'GNU grep の grep -E（POSIX の拡張正規表現と、GNU 独自の書き方）' },
    { id: 'bre', name: 'POSIX BRE', engine: 'GNU grep の grep（POSIX の基本正規表現と、GNU 独自の書き方）' },
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
    posix: ['php', 'go', 'sakura', 'ere', 'bre'], // [[:alpha:]]
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
    anchorQuant: ['java', 'cs', 'go', 'sakura'], // ^* や \b+ のように、位置を表す部品を繰り返せる（意味は変わらない）
    unknownLetterEscape: ['js', 'sakura'], // \q のような、意味のない英字のエスケープを文字として読む
    classNested: ['java', 'sakura'], // [a[b]] と [a-z&&[^b]]
    classSetDash: ['java', 'cs', 'go'], // [\d-z] の - を文字として読む（ほかの言語は誤り）
    krefQuote: ['php', 'cs', 'sakura'], // \k'name'
    krefBrace: ['php'], // \k{name}
    gref: ['php', 'sakura'], // \g{1} \g{-1} \g{name}
    grefBare: ['php'], // \g1
    conditional: ['python', 'php', 'cs', 'sakura'], // (?(1)a|b)（このツールは対応していない）
    namedChar: ['python', 'java'], // \N{LATIN SMALL LETTER A}（このツールは対応していない）
    upropCaret: ['php', 'go', 'sakura'], // \p{^L}
    upropBare: ['java', 'php', 'go'], // \pL
    grapheme: ['java', 'php', 'sakura'], // \X（このツールは対応していない）
    keepOut: ['php', 'sakura'], // \K（このツールは対応していない）
    notNewline: ['php'], // \N（改行以外の 1 文字）
  };

  // 後読みの中に書けるもの。any: 何でも / bounded: 最大の長さが決まっていればよい /
  // fixed-alt: 「または」の候補ごとに長さが決まっていればよい / fixed: 全体の長さが 1 つに決まっていること
  const LOOKBEHIND = { js: 'any', cs: 'any', java: 'bounded', php: 'fixed-alt', sakura: 'fixed-alt', python: 'fixed' };

  // \d \w \s が一致する文字。JavaScript の u フラグの書き方で表す（tools/dialect-probe/fit-classes.js で照らし合わせた）
  const ASCII_DIGIT = '0-9';
  // GNU grep（POSIX）の文字の分類は、照らし合わせた Ubuntu 24.04 の glibc 2.39 にそろえる。glibc 2.39 は少し古い Unicode を使うので、
  // ブラウザの Unicode で割り当て済みでも、glibc が知らない文字（どの文字の集まりにも入らず、大文字と小文字の組にもならない）がある。
  // 全コードポイントを grep で調べて作った一覧（tools/dialect-probe）
  const POSIX_UNKNOWN = '\\u{88f}\\u{897}\\u{c5c}\\u{cdc}\\u{1acf}-\\u{1add}\\u{1ae0}-\\u{1aeb}\\u{1b4e}-\\u{1b4f}\\u{1b7f}\\u{1c89}-\\u{1c8a}\\u{20c1}\\u{2427}-\\u{2429}\\u{2b96}\\u{31e4}-\\u{31e5}\\u{a7cb}-\\u{a7cf}\\u{a7d2}\\u{a7d4}\\u{a7da}-\\u{a7dc}\\u{a7f1}\\u{fbc3}-\\u{fbd2}\\u{fd90}-\\u{fd91}\\u{fdc8}-\\u{fdce}\\u{105c0}-\\u{105f3}\\u{10940}-\\u{10959}\\u{10d40}-\\u{10d65}\\u{10d69}-\\u{10d85}\\u{10d8e}-\\u{10d8f}\\u{10ec2}-\\u{10ec7}\\u{10ed0}-\\u{10ed8}\\u{10efa}-\\u{10efc}\\u{11380}-\\u{11389}\\u{1138b}\\u{1138e}\\u{11390}-\\u{113b5}\\u{113b7}-\\u{113c0}\\u{113c2}\\u{113c5}\\u{113c7}-\\u{113ca}\\u{113cc}-\\u{113d5}\\u{113d7}-\\u{113d8}\\u{113e1}-\\u{113e2}\\u{116d0}-\\u{116e3}\\u{11b60}-\\u{11b67}\\u{11bc0}-\\u{11be1}\\u{11bf0}-\\u{11bf9}\\u{11db0}-\\u{11ddb}\\u{11de0}-\\u{11de9}\\u{11f5a}\\u{13460}-\\u{143fa}\\u{16100}-\\u{16139}\\u{16d40}-\\u{16d79}\\u{16ea0}-\\u{16eb8}\\u{16ebb}-\\u{16ed3}\\u{16ff2}-\\u{16ff6}\\u{187f8}-\\u{187ff}\\u{18cff}\\u{18d09}-\\u{18d1e}\\u{18d80}-\\u{18df2}\\u{1cc00}-\\u{1ccfc}\\u{1cd00}-\\u{1ceb3}\\u{1ceba}-\\u{1ced0}\\u{1cee0}-\\u{1cef0}\\u{1e5d0}-\\u{1e5fa}\\u{1e5ff}\\u{1e6c0}-\\u{1e6de}\\u{1e6e0}-\\u{1e6f5}\\u{1e6fe}-\\u{1e6ff}\\u{1f6d8}\\u{1f777}-\\u{1f77a}\\u{1f8b2}-\\u{1f8bb}\\u{1f8c0}-\\u{1f8c1}\\u{1f8d0}-\\u{1f8d8}\\u{1fa54}-\\u{1fa57}\\u{1fa89}-\\u{1fa8a}\\u{1fa8e}-\\u{1fa8f}\\u{1fabe}\\u{1fac6}\\u{1fac8}\\u{1facd}\\u{1fadc}\\u{1fadf}\\u{1fae9}-\\u{1faea}\\u{1faef}\\u{1fbcb}-\\u{1fbef}\\u{1fbfa}\\u{2b73a}-\\u{2b73f}\\u{2cea2}-\\u{2cead}\\u{323b0}-\\u{33479}';
  // Unicode 16 で Alphabetic になった結合文字。glibc 2.39 では [:alpha:] に入らない
  const POSIX_OLD_ALPHA = '\\u0363-\\u036f\\u1dd3-\\u1de6';
  const POSIX_ALNUM = `[[[\\p{Alphabetic}\\p{Nd}]--[${POSIX_OLD_ALPHA}]]--[${POSIX_UNKNOWN}]]`;
  const ASCII_WORD = 'A-Za-z0-9_';
  const SETS = {
    // POSIX には \d がない。ere と bre の digit は [:digit:] の範囲（説明と比較に使う）
    digit: { js: ASCII_DIGIT, java: ASCII_DIGIT, go: ASCII_DIGIT, python: '\\p{Nd}', php: '\\p{Nd}', cs: '\\p{Nd}', sakura: '\\p{Nd}', ere: ASCII_DIGIT, bre: ASCII_DIGIT },
    word: {
      js: ASCII_WORD,
      java: ASCII_WORD,
      go: ASCII_WORD,
      python: '\\p{L}\\p{N}_',
      php: '\\p{L}\\p{N}_',
      cs: '\\p{L}\\p{Mn}\\p{Nd}\\p{Pc}',
      sakura: '\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\xb2\\xb3\\xb9\\xbc-\\xbe',
      // GNU grep（glibc）の \w は [[:alnum:]_]（全コードポイントで照らし合わせた）
      ere: `${POSIX_ALNUM}_`,
      bre: `${POSIX_ALNUM}_`,
    },
    space: {
      js: '\\t-\\r\\x20\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff',
      python: '\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000',
      java: '\\t-\\r\\x20',
      php: '\\t-\\r\\x20\\x85\\xa0\\u1680\\u180e\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000',
      cs: '\\t-\\r\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000',
      go: '\\t\\n\\f\\r\\x20',
      sakura: '\\t-\\r\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000',
      // GNU grep（glibc）の \s と [:space:] は、White_Space から U+0085 と、改行させない空白（U+00A0、U+2007、U+202F）を除いたもの
      ere: '\\t-\\r\\x20\\u1680\\u2000-\\u2006\\u2008-\\u200a\\u2028\\u2029\\u205f\\u3000',
      bre: '\\t-\\r\\x20\\u1680\\u2000-\\u2006\\u2008-\\u200a\\u2028\\u2029\\u205f\\u3000',
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
    // grep は 1 行ずつ調べるので、. が改行に出会うことはない。CR には一致する
    ere: '\\n', bre: '\\n',
  };

  // 必ず付いているフラグ。サクラエディタは m（複数行）を付けて bregonig.dll に渡す（ヘルプ HLP000089）
  // grep は 1 行ずつ調べるので、^ と $ はいつも行の先頭と末尾に一致する
  const FORCED_FLAGS = { sakura: 'm', ere: 'm', bre: 'm' };
  // 付けても意味のないフラグ。サクラエディタは . を [^\r\n] に置き換えるので、s が効かない。grep は 1 行ずつ調べるので、s がない
  const NO_EFFECT_FLAGS = { sakura: 's', ere: 's', bre: 's' };

  // $（m フラグなし）が、最後の改行の直前にも一致するか。'nl': \n の直前 / 'any': どの改行の直前でも（Java） / '': 末尾だけ
  const DOLLAR_BEFORE_FINAL = { js: '', go: '', python: 'nl', php: 'nl', cs: 'nl', sakura: 'nl', java: 'any', ere: '', bre: '' };

  // m フラグのとき、^ と $ が区切りとみなす改行
  const LINE_BREAKS = { js: 'js', java: 'java', python: 'lf', php: 'lf', cs: 'lf', go: 'lf', sakura: 'lf', ere: 'lf', bre: 'lf' };

  // m フラグの ^ が文字列の最後の改行のあと（文字列の末尾）には一致しない言語。Java は LINE_BREAKS の 'java' で扱う
  const CARET_NOT_AT_END = ['php', 'sakura'];

  // \R が CRLF を分けない（CRLF に一致したら、CR だけに戻って試し直さない）言語。Java は試し直す
  const ATOMIC_LINEBREAK = ['php', 'sakura'];

  // 長さ 0 の一致のあとの探し方（match-core.js の findAll）。retry: 同じ位置から長さ 1 以上の一致を探し直す /
  // skip: 前の一致のすぐあとの長さ 0 の一致を数えない / なし: JavaScript と同じ（実際の結果）
  // drop: POSIX（grep）。1 行ずつ調べ、長さ 0 の一致は出さない（後方参照があって、状態機械を使わないとき）
  const EMPTY_MODE = { python: 'retry', php: 'retry', go: 'skip', ere: 'drop', bre: 'drop' };

  // 繰り返しの回数の上限（実際の結果）
  const REPEAT_MAX = { go: 1000, php: 65535, sakura: 100000, java: 2147483647, cs: 2147483647, python: 4294967294, ere: 32767, bre: 32767 };

  // 大文字と小文字を区別しない指定が、英字（ASCII）だけに効く言語
  const ASCII_CASE_ONLY = ['java'];

  // 絵文字などを 2 文字（UTF-16 の 2 単位）として数える言語。JavaScript は u フラグがないとき
  const CODE_UNITS = ['cs'];

  // POSIX の文字クラス（[[:alpha:]]）。Go は ASCII だけ、PHP（u 修飾子あり）とサクラエディタは Unicode に広がる。
  // 広がり方は PHP とサクラエディタで違う（tools/dialect-probe/cases.json で各言語の処理系と照らし合わせた）。
  // 値は JavaScript の v フラグの文字クラスの中身。graph と print は、入れ子の文字クラスで書く
  const ASCII_SYMBOLS = '\\x24\\x2b\\x3c-\\x3e\\x5e\\x60\\x7c\\x7e'; // 記号のうち ASCII のもの（$ + < = > ^ ` | ~）
  const POSIX = {
    go: {
      alpha: 'A-Za-z', digit: '0-9', alnum: 'A-Za-z0-9', upper: 'A-Z', lower: 'a-z', space: '\\t-\\r\\x20',
      xdigit: '0-9A-Fa-f', word: 'A-Za-z0-9_', blank: '\\t\\x20', cntrl: '\\x00-\\x1f\\x7f',
      punct: '!-\\/:-@\\[-`\\{-~', print: '\\x20-\\x7e', graph: '!-~',
    },
    php: {
      alpha: '\\p{L}', digit: '\\p{Nd}', alnum: '\\p{L}\\p{N}', upper: '\\p{Lu}', lower: '\\p{Ll}', xdigit: '0-9A-Fa-f',
      word: '\\p{L}\\p{N}_', blank: SETS.hspace, space: SETS.space.php, cntrl: '\\p{Cc}', punct: `\\p{P}${ASCII_SYMBOLS}`,
      // 文字・記号・書式の文字（Cf）。U+061C、U+180E、U+2066〜U+2069 は除く。print は、さらに Zs の空白を含む
      graph: '[[\\p{L}\\p{M}\\p{N}\\p{P}\\p{S}\\p{Cf}]--[\\u061c\\u180e\\u2066-\\u2069]]',
      print: '[[\\p{L}\\p{M}\\p{N}\\p{P}\\p{S}\\p{Cf}\\p{Zs}]--[\\u061c\\u2066-\\u2069]]',
    },
    sakura: {
      alpha: '\\p{Alphabetic}', digit: '\\p{Nd}', alnum: '\\p{Alphabetic}\\p{Nd}', upper: '\\p{Uppercase}', lower: '\\p{Lowercase}',
      xdigit: '0-9A-Fa-f', word: '\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}', blank: '\\t\\p{Zs}', space: SETS.space.sakura,
      cntrl: '\\p{Cc}', punct: `\\p{P}${ASCII_SYMBOLS}`,
      // 空白・制御文字・未割り当て・サロゲート以外。print は、さらに Zs の空白を含む
      graph: '[^\\p{White_Space}\\p{Cc}\\p{Cn}\\p{Cs}]',
      print: '[^\\p{White_Space}\\p{Cc}\\p{Cn}\\p{Cs}]\\p{Zs}',
    },
  };
  // GNU grep（glibc の文字の分類）。Ubuntu 24.04（glibc 2.39）の grep で全コードポイントを調べ、glibc が知らない文字も含めて、
  // どの名前もここに書いた範囲と同じになった（ロケールが ja_JP.UTF-8、en_US.UTF-8、C.UTF-8 のどれでも同じ。tools/dialect-probe）。
  // [:digit:] は 0〜9 だけで、ほかの数字（全角数字など）は [:alpha:] に入る。ǅ のような大文字と小文字の間の文字（Lt）は [:upper:] に入り、
  // そのうち ǅ ǈ ǋ ǲ は [:lower:] にも入る。[:punct:] は [:graph:] のうち [:alnum:] でないもの（書式の文字、私用の文字、結合文字も入る）
  // U+0295 は、Unicode 16 で小文字（Ll）でなくなったが、glibc 2.39 では [:lower:] に入る
  const known = (cls) => `[[${cls}]--[${POSIX_UNKNOWN}]]`;
  const POSIX_GRAPH = known('[^\\p{Cc}\\p{Cs}\\p{Cn}\\p{Z}]\\xa0\\u2007\\u202f');
  POSIX.ere = {
    alpha: `[${POSIX_ALNUM}--[0-9]]`, digit: '0-9', alnum: POSIX_ALNUM, upper: known('\\p{Uppercase}\\p{Lt}'),
    lower: known('\\p{Lowercase}\\u01c5\\u01c8\\u01cb\\u01f2\\u0295'), xdigit: '0-9A-Fa-f',
    blank: '[[\\t\\p{Zs}]--[\\xa0\\u2007\\u202f]]', space: SETS.space.ere, cntrl: '\\p{Cc}\\u2028\\u2029',
    punct: `[${POSIX_GRAPH}--${POSIX_ALNUM}]`, graph: POSIX_GRAPH, print: known('[^\\p{Cc}\\p{Cs}\\p{Cn}\\u2028\\u2029]'),
  };
  POSIX.bre = POSIX.ere;
  const POSIX_UNKNOWN_RE = new RegExp(`[${POSIX_UNKNOWN}]`, 'v');
  function posixToJs(name, dialect) {
    return (POSIX[dialect] || {})[name] || null;
  }

  // ---------- \p{…} の名前 ----------
  // 言語ごとに使える名前と、その意味（tools/dialect-probe で各言語の処理系を動かして確かめた）。
  // PHP、サクラエディタ、Go は、大文字と小文字、空白、-、_ を区別しない（\p{lu} や \p{white_space} が通る）。
  // Java と C# は、書いたとおりの名前だけを受け付ける

  // 用字の名前と、4 文字の略称。略称は PHP とサクラエディタと、Java の \p{Script=Hira} で使える
  const SCRIPTS = {
    Han: 'Hani', Hiragana: 'Hira', Katakana: 'Kana', Latin: 'Latn', Greek: 'Grek', Cyrillic: 'Cyrl',
    Arabic: 'Arab', Hangul: 'Hang', Hebrew: 'Hebr', Thai: 'Thai', Common: 'Zyyy',
  };
  const SCRIPT_NAMES = Object.keys(SCRIPTS);
  // 一般カテゴリ。LC（Lu と Ll と Lt）は、C# にはない
  const CATEGORY_LIST = ['L', 'LC', 'Lu', 'Ll', 'Lt', 'Lm', 'Lo', 'M', 'Mn', 'Mc', 'Me', 'N', 'Nd', 'Nl', 'No',
    'P', 'Pc', 'Pd', 'Ps', 'Pe', 'Pi', 'Pf', 'Po', 'S', 'Sm', 'Sc', 'Sk', 'So', 'Z', 'Zs', 'Zl', 'Zp', 'C', 'Cc', 'Cf', 'Co', 'Cn'];
  // 一般カテゴリの長い名前と別名。サクラエディタと Go で使える（\p{Letter}、\p{Uppercase_Letter}、\p{Punct} など）
  const CATEGORY_LONG = {
    Letter: 'L', Cased_Letter: 'LC', Uppercase_Letter: 'Lu', Lowercase_Letter: 'Ll', Titlecase_Letter: 'Lt',
    Modifier_Letter: 'Lm', Other_Letter: 'Lo', Mark: 'M', Combining_Mark: 'M', Nonspacing_Mark: 'Mn', Spacing_Mark: 'Mc',
    Enclosing_Mark: 'Me', Number: 'N', Decimal_Number: 'Nd', digit: 'Nd', Letter_Number: 'Nl', Other_Number: 'No',
    Punctuation: 'P', punct: 'P', Connector_Punctuation: 'Pc', Dash_Punctuation: 'Pd', Open_Punctuation: 'Ps',
    Close_Punctuation: 'Pe', Initial_Punctuation: 'Pi', Final_Punctuation: 'Pf', Other_Punctuation: 'Po', Symbol: 'S',
    Math_Symbol: 'Sm', Currency_Symbol: 'Sc', Modifier_Symbol: 'Sk', Other_Symbol: 'So', Separator: 'Z',
    Space_Separator: 'Zs', Line_Separator: 'Zl', Paragraph_Separator: 'Zp', Other: 'C', Control: 'Cc', cntrl: 'Cc',
    Format: 'Cf', Surrogate: 'Cs', Private_Use: 'Co', Unassigned: 'Cn',
  };
  // 二値の性質など（JavaScript と同じ名前）。Java は \p{IsAlphabetic} のように Is を付けて書く
  const BINARY = ['Alphabetic', 'Lowercase', 'Uppercase', 'White_Space', 'Ideographic', 'Hex_Digit'];
  const BINARY_BY = {
    php: [...BINARY, 'Emoji', 'Emoji_Presentation', 'Extended_Pictographic', 'ASCII', 'Any'],
    sakura: [...BINARY, 'Emoji', 'Emoji_Presentation', 'Extended_Pictographic', 'ASCII', 'Any', 'Assigned'],
    go: ['ASCII', 'Any', 'Assigned'],
  };
  // 二値の性質の略称。PHP とサクラエディタで使える
  const BINARY_ABBR = { Alpha: 'Alphabetic', Lower: 'Lowercase', Upper: 'Uppercase', WSpace: 'White_Space', space: 'White_Space', Ideo: 'Ideographic', Hex: 'Hex_Digit' };
  // Java の \p{IsLetter} などは、一般カテゴリと同じ
  const JAVA_IS = { Letter: 'L', Digit: 'Nd', Punctuation: 'P' };
  // Java の \p{Lower} などは、ASCII の文字だけに一致する（POSIX の文字クラスと同じ範囲）
  const JAVA_POSIX = { Lower: 'lower', Upper: 'upper', Alpha: 'alpha', Digit: 'digit', Alnum: 'alnum', Punct: 'punct', Graph: 'graph', Print: 'print', Blank: 'blank', Cntrl: 'cntrl', XDigit: 'xdigit', Space: 'space' };
  // サクラエディタの \p{Alnum} などは、POSIX の文字クラスと同じ範囲。alpha と punct などは、上の性質と一般カテゴリになる
  const SAKURA_POSIX = ['alnum', 'word', 'blank', 'graph', 'print', 'xdigit'];
  // PHP（PCRE2）だけの性質
  const PCRE_X = {
    Xan: '\\p{L}\\p{N}', Xwd: '\\p{L}\\p{N}_', Xsp: '\\p{Z}\\t-\\r\\x85\\u180e', Xps: '\\p{Z}\\t-\\r\\x85\\u180e',
    Xuc: '\\x24\\x40\\x60\\xa0-\\ud7ff\\ue000-\\u{10ffff}',
  };
  // ブロック。C# は \p{IsHiragana}、Java は \p{InHiragana}、サクラエディタは \p{In_Hiragana} と書く。
  // JavaScript にはブロックの指定がないので範囲で書く。alias は Java と C# だけが受け付ける別名
  const BLOCKS = [
    { name: 'Basic_Latin', range: '\\x00-\\x7f' },
    { name: 'Greek_and_Coptic', range: '\\u0370-\\u03ff', alias: 'Greek' },
    { name: 'Hiragana', range: '\\u3040-\\u309f' },
    { name: 'Katakana', range: '\\u30a0-\\u30ff' },
    { name: 'CJK_Symbols_and_Punctuation', range: '\\u3000-\\u303f' },
    { name: 'CJK_Unified_Ideographs', range: '\\u4e00-\\u9fff' },
    { name: 'Halfwidth_and_Fullwidth_Forms', range: '\\uff00-\\uffef' },
  ];
  const looseKey = (s) => s.toLowerCase().replace(/[\s_-]/g, '');

  function findBlock(rest, dialect) {
    return BLOCKS.find((b) => {
      const plain = b.name.replace(/_/g, '');
      if (dialect === 'cs') return rest === plain || rest === b.alias;
      if (dialect === 'java') return [plain, b.name, b.alias].some((n) => n && n.toLowerCase() === rest.toLowerCase());
      return looseKey(rest) === looseKey(b.name);
    });
  }

  // 名前を { key, js } にする。key は説明と比較に使う正式な形（Lu、Script=Hiragana、Alphabetic など）、
  // js は JavaScript の v フラグの書き方（{ prop } か、文字クラスの中身の { range }）。使えない名前は null
  function resolveProp(name, dialect) {
    if (dialect === 'js') return { key: name, js: { prop: name } };
    const loose = ['php', 'sakura', 'go'].includes(dialect);
    const eq = (n) => (loose ? looseKey(n) === looseKey(name) : n === name);
    const prop = (k) => ({ key: k, js: { prop: k } });
    const script = (s) => ({ key: `Script=${s}`, js: { prop: `Script=${s}` } });
    const range = (key, r) => ({ key, js: { range: r } });
    let m;
    let hit;
    if (dialect === 'python') return null;
    // 一般カテゴリ
    if ((hit = CATEGORY_LIST.find((c) => eq(c) && !(c === 'LC' && dialect === 'cs')))) return prop(hit);
    if (dialect === 'php' && name === 'L&') return prop('LC');
    if (['sakura', 'go'].includes(dialect) && (hit = Object.keys(CATEGORY_LONG).find(eq))) return prop(CATEGORY_LONG[hit]);
    // 用字
    if (loose && (hit = SCRIPT_NAMES.find((s) => eq(s) || (dialect !== 'go' && eq(SCRIPTS[s]))))) {
      // PHP の \p{Han} は、その用字の文字のほか、「、」のように、ほかの用字と一緒に使う記号（Script_Extensions に Han を含む文字）にも一致する。
      // \p{sc=Han} は、その用字の文字だけに一致する（実際の結果）
      return dialect === 'php'
        ? { key: `Script_Extensions=${hit}`, js: { range: `\\p{Script=${hit}}\\p{Script_Extensions=${hit}}` } }
        : script(hit);
    }
    if ((m = /^(?:script|sc)=(.+)$/i.exec(name))) {
      if (!['java', 'php'].includes(dialect)) return null;
      const v = dialect === 'php' ? looseKey(m[1]) : m[1].toLowerCase();
      const k = dialect === 'php' ? looseKey : (s) => s.toLowerCase();
      hit = SCRIPT_NAMES.find((s) => k(s) === v || k(SCRIPTS[s]) === v);
      return hit ? script(hit) : null;
    }
    // 二値の性質など
    if (BINARY_BY[dialect] && (hit = BINARY_BY[dialect].find(eq))) return prop(hit);
    if (['php', 'sakura'].includes(dialect) && (hit = Object.keys(BINARY_ABBR).find(eq))) return prop(BINARY_ABBR[hit]);
    if (dialect === 'sakura' && (hit = SAKURA_POSIX.find(eq))) return range(`Posix=${hit}`, POSIX.sakura[hit]);
    if (dialect === 'php' && (hit = Object.keys(PCRE_X).find(eq))) return range(hit, PCRE_X[hit]);
    if (dialect === 'java') {
      if (name === 'ASCII') return prop('ASCII');
      if (JAVA_POSIX[name]) return range(`Posix=${JAVA_POSIX[name]}`, POSIX.go[JAVA_POSIX[name]]);
      if ((m = /^Is(\w+)$/.exec(name))) {
        if (CATEGORY_LIST.includes(m[1])) return prop(m[1]);
        if (SCRIPT_NAMES.includes(m[1])) return script(m[1]);
        if (BINARY.includes(m[1])) return prop(m[1]);
        if (JAVA_IS[m[1]]) return prop(JAVA_IS[m[1]]);
        // \p{IsTitlecase} は Lt と同じ文字に一致するが、大文字と小文字を区別しないときの広がり方が \p{Lt} と違う（translate.js）
        if (m[1] === 'Titlecase') return { key: 'Titlecase', js: { prop: 'Lt' } };
      }
    }
    // ブロック
    const blockKey = (b) => `Block=${b.name}`;
    if (dialect === 'cs' && (m = /^Is(.+)$/.exec(name)) && (hit = findBlock(m[1], dialect))) return range(blockKey(hit), hit.range);
    if (dialect === 'java' && (m = /^In(.+)$/.exec(name)) && (hit = findBlock(m[1], dialect))) return range(blockKey(hit), hit.range);
    if (dialect === 'sakura' && (m = /^in(.+)$/.exec(looseKey(name))) && (hit = findBlock(m[1], dialect))) return range(blockKey(hit), hit.range);
    return null;
  }

  function canonicalProp(name, dialect) {
    const r = resolveProp(name, dialect);
    return r ? r.key : name;
  }

  function propToJs(name, dialect) {
    const r = resolveProp(name, dialect);
    return r ? r.js : null;
  }

  // 言語ごとに使えるフラグ。js 以外の g は「テストの欄ですべての一致を探す」だけの意味
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
        // / を区切りに使い、パターンの中の / を \/ にする。日本語を 1 文字として扱うため u を付ける。
        // \Q…\E の中では \/ が \ と / の 2 文字になるので、\E で抜けてから \/ を書き、\Q で戻る（実際の結果）
        let body = '';
        let quoted = false;
        for (let k = 0; k < src.length;) {
          if (quoted) {
            if (src.startsWith('\\E', k)) { quoted = false; body += '\\E'; k += 2; } else { body += src[k] === '/' ? '\\E\\/\\Q' : src[k]; k++; }
          } else if (src.startsWith('\\Q', k)) {
            quoted = true; body += '\\Q'; k += 2;
          } else if (src[k] === '\\' && k + 1 < src.length) {
            body += src.slice(k, k + 2); k += 2;
          } else {
            body += src[k] === '/' ? '\\/' : src[k]; k++;
          }
        }
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
      case 'ere': case 'bre': {
        // シェル（bash など）で打つ grep のコマンド。' は '\'' にする。- で始まるパターンは -e のあとに書く
        const opts = [dialect === 'ere' && '-E', f('i') && '-i', src.startsWith('-') && '-e'].filter(Boolean);
        return `grep ${opts.length ? `${opts.join(' ')} ` : ''}'${src.replace(/'/g, "'\\''")}'`;
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
    caretNotAtEnd: (dialect) => CARET_NOT_AT_END.includes(dialect),
    emptyMode: (dialect) => EMPTY_MODE[dialect] || '',
    repeatMax: (dialect) => REPEAT_MAX[dialect] || Infinity,
    atomicLinebreak: (dialect) => ATOMIC_LINEBREAK.includes(dialect),
    asciiCaseOnly: (dialect) => ASCII_CASE_ONLY.includes(dialect),
    codeUnits: (dialect) => CODE_UNITS.includes(dialect),
    // POSIX の正規表現（grep）。いちばん左のいちばん長い一致を選び、1 行ずつ調べる（match-core.js の findAllPosix）
    posixKnown: (c) => !POSIX_UNKNOWN_RE.test(c),
    posixUnknown: POSIX_UNKNOWN,
    // grep（ja_JP.UTF-8）の範囲が、文字の番号（コードポイント）の順と同じになるか。ASCII の中と、両端が「ぁ〜ん」か「ァ〜ヶ」の中の範囲は同じ。
    // ほかはロケールの並び順で決まる（[一-龠] は 6274 字だけ）か、並び順の表にない文字（龯、ゖ、ヷ など）を端にすると誤りになる（実際の結果）
    posixCodepointRange: (from, to) => {
      const within = (lo, hi) => [from, to].every((c) => c.codePointAt(0) >= lo && c.codePointAt(0) <= hi);
      return within(0, 0x7f) || within(0x3041, 0x3093) || within(0x30a1, 0x30f6);
    },
    isPosix: (dialect) => POSIX_DIALECTS.includes(dialect),
    unicodeDigit: (dialect) => SETS.digit[dialect] !== ASCII_DIGIT,
    unicodeWord: (dialect) => SETS.word[dialect] !== ASCII_WORD,
    propToJs,
    canonicalProp,
    // Java と C# は、\p{Han} のような用字の名前だけの書き方を受け付けない（実際に書き方の誤りになった）
    bareScriptInvalid: (name, dialect) => ['java', 'cs'].includes(dialect) && SCRIPT_NAMES.includes(name),
    posixToJs,
    flags: (dialect) => (dialect === 'js' ? FLAG_SETS.js : FLAG_SETS.other)
      .filter((f) => !(FORCED_FLAGS[dialect] || '').includes(f) && !(NO_EFFECT_FLAGS[dialect] || '').includes(f)),
    forcedFlags: (dialect) => FORCED_FLAGS[dialect] || '',
    codeSnippet,
  };
})(typeof window !== 'undefined' ? window : globalThis);
