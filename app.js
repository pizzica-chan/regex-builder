(function () {
  'use strict';

  const { explain, RegexParseError, escapeHtml: esc } = window.RegexExplain;
  const $ = (id) => document.getElementById(id);

  const patternEl = $('pattern');
  const testEl = $('test-input');
  const flagBoxes = [...document.querySelectorAll('.flags input[type="checkbox"]')];

  // 対象の言語（dialects.js の id）。JavaScript 以外は、translate.js で JavaScript に置き換えて動かす
  const Dialects = window.RegexDialects;
  const Translate = window.RegexTranslate;
  const DIALECT_KEY = 'regex-builder:dialect';
  let dialect = 'js';
  const isJs = () => dialect === 'js';

  // desc: 部品の説明。ex: [例のパターン, 例の文字列]。例の一致は表示のたびに実際に計算する
  const PALETTE = [
    {
      title: '文字の種類（1文字）',
      items: [
        { label: '数字', insert: '\\d', desc: '0〜9 の数字1文字に一致します。全角数字（０〜９）には一致しません。', ex: ['\\d+', '部屋は 302 号室、内線は ３０２'], descBy: { 'python php cs sakura': '数字1文字に一致します。全角数字（０〜９）やほかの言語の数字にも一致します。0〜9 だけにしたいときは [0-9] と書きます。', 'ere bre': '0〜9 の数字1文字に一致します。全角数字（０〜９）には一致しません。POSIX には \\d がないので、[[:digit:]] と書きます。' } },
        { label: '数字以外', insert: '\\D', desc: '数字（0〜9）以外の1文字に一致します。英字や記号、空白、全角数字にも一致します。', ex: ['\\D+', 'A12-34b'], descBy: { 'python php cs sakura': '数字以外の1文字に一致します。全角数字なども数字とみなすので、一致しません。', 'ere bre': '数字（0〜9）以外の1文字に一致します。英字や記号、空白、全角数字にも一致します。POSIX には \\D がないので、[^[:digit:]] と書きます。' } },
        { label: '英数字と _', insert: '\\w', desc: '英字（a〜z、A〜Z）、数字（0〜9）、アンダースコア（_）のどれか1文字に一致します。ひらがなや漢字、全角の英数字には一致しません。', ex: ['\\w+', 'user_01 さん@host'], labelBy: { 'python php cs sakura ere bre': '文字・数字と _' }, descBy: { 'python php cs sakura ere bre': '文字・数字・アンダースコア（_）のどれか1文字に一致します。ひらがな・カタカナ・漢字・全角の英数字にも一致します。英数字と _ だけにしたいときは [A-Za-z0-9_] と書きます。' } },
        { label: '空白', insert: '\\s', desc: 'スペース、タブ、改行など、空白に当たる1文字に一致します。全角スペースにも一致します。', ex: ['\\s+', 'a b　c'], descBy: { java: 'スペース、タブ、改行など、空白に当たる1文字に一致します。全角スペースには一致しません。', go: 'スペース、タブ、改行など、空白に当たる1文字に一致します。全角スペースと垂直タブには一致しません。' } },
        { label: '空白以外', insert: '\\S', desc: '空白（スペース、タブ、改行など）以外の1文字に一致します。', ex: ['\\S+', 'hello world'] },
        { label: '任意の文字', insert: '.', desc: '改行以外の、どんな文字でも1文字に一致します。s フラグを付けると改行にも一致します。記号の「.」そのものに一致させたいときは \\. と書きます。', ex: ['a.c', 'abc a-c ac'], descBy: {
          'python php cs go': '改行（LF）以外の、どんな文字でも1文字に一致します。CR（\\r）には一致します。s フラグを付けると改行にも一致します。記号の「.」そのものに一致させたいときは \\. と書きます。',
          java: '改行（LF、CR など）以外の、どんな文字でも1文字に一致します。s フラグを付けると改行にも一致します。記号の「.」そのものに一致させたいときは \\. と書きます。',
          sakura: '改行（CR と LF）以外の、どんな文字でも1文字に一致します。サクラエディタでは、s フラグを付けても改行には一致しません。記号の「.」そのものに一致させたいときは \\. と書きます。',
          'ere bre': 'どんな文字でも1文字に一致します。grep は 1 行ずつ調べるので、改行には一致しません。CR（\\r）には一致します。記号の「.」そのものに一致させたいときは \\. と書きます。',
        } },
        { label: '英小文字', insert: '[a-z]', desc: 'a から z までの英小文字1文字に一致します。i フラグを付けると大文字にも一致します。', ex: ['[a-z]+', 'Hello World'] },
        { label: '英大文字', insert: '[A-Z]', desc: 'A から Z までの英大文字1文字に一致します。', ex: ['[A-Z]', 'Hello World'] },
        { label: '英字', insert: '[A-Za-z]', desc: '英字（大文字と小文字）1文字に一致します。数字には一致しません。', ex: ['[A-Za-z]+', 'abc123DEF'] },
        { label: 'ひらがな', insert: '[ぁ-ん]', desc: '「ぁ」から「ん」までのひらがな1文字に一致します。長音記号の「ー」は含みません。', ex: ['[ぁ-ん]+', 'ひらがなとカタカナ'] },
        { label: 'カタカナ', insert: '[ァ-ヶー]', desc: '「ァ」から「ヶ」までのカタカナと、長音記号の「ー」のどれか1文字に一致します。半角カタカナは含みません。', ex: ['[ァ-ヶー]+', 'コーヒーとお茶'] },
        { label: '漢字', insert: '[一-龯]', except: 'ere bre', desc: 'よく使う漢字（「一」から「龯」までの範囲）1文字に一致します。「々」と、この範囲の外にある一部の漢字は含みません。', ex: ['[一-龯]+', '日々の東京'] },
      ],
    },
    {
      title: '繰り返し（直前の部品に付ける）',
      items: [
        { label: '0回以上', insert: '*', desc: '直前の部品を0回以上繰り返します。1回もないときにも一致します。', ex: ['ab*c', 'ac abc abbbc'] },
        { label: '1回以上', insert: '+', desc: '直前の部品を1回以上繰り返します。', ex: ['ab+c', 'ac abc abbbc'] },
        { label: 'なくてもよい', insert: '?', desc: '直前の部品が1回あっても、なくても一致します。', ex: ['colou?r', 'color colour'] },
        { label: '戻らない繰り返し', insert: '+', only: 'python java php sakura', desc: '*、+、?、{…} のすぐ後ろに付けると、一度一致した繰り返しを戻って試し直しません（強欲な繰り返し）。', ex: ['"[^"]*+"', 'say "hi" and "yo"'] },
        { label: '最短で一致', insert: '?', except: 'ere bre', desc: '*、+、?、{…} のすぐ後ろに付けると、繰り返しをできるだけ短いところで止めます。付けないと、できるだけ長く一致します。', ex: ['<.+?>', '<b>太字</b>'] },
      ],
    },
    {
      title: '位置',
      items: [
        { label: '先頭', insert: '^', desc: '文字列の先頭に一致します。m フラグを付けると、各行の先頭にも一致します。文字ではなく位置に一致するので、一致した文字列には何も加わりません。', ex: ['^\\d+', '123 abc 456'], descBy: { sakura: '行の先頭に一致します。サクラエディタは 1 行ずつ探します。文字ではなく位置に一致するので、一致した文字列には何も加わりません。', 'ere bre': '行の先頭に一致します。grep は 1 行ずつ調べます。文字ではなく位置に一致するので、一致した文字列には何も加わりません。' } },
        { label: '末尾', insert: '$', desc: '文字列の末尾に一致します。m フラグを付けると、各行の末尾にも一致します。文字ではなく位置に一致します。', ex: ['\\d+$', '123 abc 456'], descBy: {
          'python php cs': '文字列の末尾と、文字列の最後の改行（LF）の直前に一致します。m フラグを付けると、各行の末尾にも一致します。文字ではなく位置に一致します。',
          java: '文字列の末尾と、文字列の最後の改行の直前に一致します。m フラグを付けると、各行の末尾にも一致します。文字ではなく位置に一致します。',
          sakura: '行の末尾（行末の改行の直前）に一致します。サクラエディタは 1 行ずつ探し、CR と LF のどちらも改行とみなします。文字ではなく位置に一致します。',
          'ere bre': '行の末尾に一致します。grep は 1 行ずつ調べます。文字ではなく位置に一致します。',
        } },
        { label: '単語の区切り', insert: '\\b', desc: '英数字・_ と、それ以外の文字（または文字列の端）との境目に一致します。文字ではなく位置に一致します。日本語の単語の区切りには使えません。', ex: ['\\bcat\\b', 'cat concat cat_s cat.'], descBy: { 'python php cs sakura ere bre': '文字・数字・_ と、それ以外の文字（または文字列の端）との境目に一致します。ひらがなや漢字も単語の文字とみなします。文字ではなく位置に一致します。' } },
        { label: '文字列の先頭', insert: '\\A', except: 'js ere bre', desc: '文字列全体の先頭だけに一致します。m フラグを付けても、各行の先頭には一致しません。', ex: ['\\A\\d+', '123 abc 456'], descBy: { sakura: '行の先頭に一致します。サクラエディタは 1 行ずつ探すので、^ と同じく各行の先頭に一致します。' } },
        { label: '文字列の末尾', insert: '\\z', insertBy: { python: '\\Z' }, except: 'js ere bre', desc: '文字列全体の末尾だけに一致します。最後の改行の直前には一致しません。m フラグを付けても、各行の末尾には一致しません。', ex: ['\\d+\\z', '123 abc 456'], exBy: { python: ['\\d+\\Z', '123 abc 456'] }, descBy: { sakura: '行の終わりに一致します。サクラエディタは 1 行ずつ、行末の改行を含めて探すので、改行で終わる行では、その改行のあとに一致します。改行の直前に一致させたいときは $ と書きます。' } },
      ],
    },
    {
      title: 'グループと選択',
      // 囲む部品（wrap）は、ボタンに (…) のように「…」を出す
      hint: '「…」の入った部品は文字を選んでから押すと、選んだ部分を囲みます。',
      items: [
        { label: 'グループ', wrap: ['(', ')'], desc: '囲んだ部分をひとまとめにし、一致した内容を番号で取り出せるようにします。\\1 と書くと、1番のグループと同じ内容にもう一度一致します。', ex: ['(ab)+', 'ababab abx'] },
        { label: '名前付きグループ', wrap: ['(?<name>', ')'], except: 'ere bre', desc: 'グループに名前を付けます。一致した内容を、番号の代わりに名前で取り出せます。name の部分を好きな名前に書き換えてください。', ex: ['(?<year>\\d{4})年', '2026年11月'], wrapBy: { python: ['(?P<name>', ')'] }, exBy: { python: ['(?P<year>\\d{4})年', '2026年11月'] } },
        { label: 'まとめるだけ', wrap: ['(?:', ')'], except: 'ere bre', desc: '囲んだ部分をひとまとめにします。グループと違い、一致した内容は記録しません。繰り返しや「または」の範囲を決めるときに使います。', ex: ['(?:ab)+', 'ababab abx'] },
        { label: '戻らないまとまり', wrap: ['(?>', ')'], only: 'python java php cs sakura', desc: '囲んだ部分が一度一致したら、あとで失敗しても、その部分を戻って試し直しません（アトミックグループ）。試し直しが減るので、処理が速くなることがあります。', ex: ['(?>\\d+)円', '100円 100ドル'] },
        { label: 'または', insert: '|', desc: '左右のどちらかに一致します。( ) の中で使うと、その ( ) の中だけで「どちらか」になります。', ex: ['cat|dog', 'cat and dog'] },
        { label: '同じ文字列（番号）', except: 'go', insert: '\\1', select: [1, 2], desc: '1番のグループに一致した文字列と同じものに一致します（後方参照）。グループのパターンではなく、実際に一致した文字列を使います。数字の部分を、参照したいグループの番号に書き換えてください。', ex: ['\\b(\\w+)\\s+\\1\\b', 'this is is a test'] },
        { label: '同じ文字列（名前）', insert: '\\k<name>', select: [3, 7], desc: '名前付きグループに一致した文字列と同じものに一致します（後方参照）。name の部分を、参照したいグループの名前に書き換えてください。', ex: ['(?<q>["\'])(.*?)\\k<q>', 'say "hi" and \'yo"'], except: 'go ere bre', insertBy: { python: '(?P=name)' }, selectBy: { python: [4, 8] }, exBy: { python: ['(?P<q>["\'])(.*?)(?P=q)', 'say "hi" and \'yo"'] } },
        { label: '後ろに続く', except: 'go ere bre', wrap: ['(?=', ')'], desc: 'すぐ後ろに、囲んだ内容が続く位置に一致します。続く部分は確かめるだけで、一致した文字列には含めません。', ex: ['\\d+(?=円)', '100円 200ドル'] },
        { label: '後ろに続かない', except: 'go ere bre', wrap: ['(?!', ')'], desc: 'すぐ後ろに、囲んだ内容が続かない位置に一致します。確かめるだけで、一致した文字列には含めません。', ex: ['foo(?!bar)', 'foobar foobaz'] },
        { label: '前にある', except: 'go ere bre', wrap: ['(?<=', ')'], desc: 'すぐ前に、囲んだ内容がある位置に一致します。確かめるだけで、一致した文字列には含めません。', ex: ['(?<=¥)\\d+', '¥500 と 300円'] },
        { label: '前にない', except: 'go ere bre', wrap: ['(?<!', ')'], desc: 'すぐ前に、囲んだ内容がない位置に一致します。確かめるだけで、一致した文字列には含めません。', ex: ['(?<!¥)\\b\\d+', '¥500 と 300円'] },
      ],
    },
  ];

  // 部品以外のボタンの説明
  const BUTTON_TIPS = {
    'literal-add': { label: '文字をそのまま入れる', desc: '入力した文字を、そのままの文字として入れます。. や ( のように正規表現で特別な意味を持つ記号には \\ を付けます。', ex: ['example\\.com', 'example.com exampleXcom'] },
    'class-add': { label: '文字の集まりから 1 文字', code: '[…]', desc: '入力した文字のどれか1文字に一致する部品を入れます。a-z のように - でつなぐと範囲になります。', ex: ['[aeiou]', 'regex'] },
    'class-neg-add': { label: '文字の集まり以外の 1 文字', code: '[^…]', desc: '入力した文字のどれでもない1文字に一致する部品を入れます。', ex: ['[^aeiou]+', 'regex'] },
    'rep-add': { label: '回数を指定して繰り返す', code: '{n,m}', desc: '直前の部品を、指定した回数だけ繰り返します。{3} はちょうど3回、{2,4} は2〜4回、{2,} は2回以上です。', ex: ['\\d{2,4}', '1 12 123 12345'] },
  };

  // フラグの説明。cmp: [例のパターン, 例の文字列, 付けないときのフラグ, 付けたときのフラグ]。両方の一致を並べて見せる
  const FLAG_TIPS = {
    g: { label: 'すべての一致を探す', desc: '最初の一致で止めずに、文字列の中の一致をすべて探します。付けないと、最初の1つだけを見つけます。「行ごとに判定する」の判定には使いません。', cmp: ['\\d+', '10 個、20 個、30 個', '', 'g'] },
    i: { label: '大文字と小文字を区別しない', desc: '英字の大文字と小文字を同じ文字として扱います。cat は Cat や CAT にも一致し、[a-z] は大文字にも一致します。', cmp: ['cat', 'cat Cat CAT', 'g', 'gi'] },
    m: { label: '各行の先頭と末尾', desc: '^ と $ を文字列全体の先頭と末尾だけでなく、各行の先頭と末尾にも一致させます。付けないと、^ は文字列の最初、$ は文字列の最後にだけ一致します（Python・Java・PHP・C#・PowerShell の $ は、文字列の最後の改行の直前にも一致します）。', cmp: ['^\\d+', '1. りんご\n2. みかん\n3. ぶどう', 'g', 'gm'] },
    s: { label: '. を改行にも一致させる', desc: '. を、改行を含むどんな文字にも一致させます。付けないと . は改行に一致しないので、行をまたいで一致させられません。', cmp: ['「.+」', '「1行目\n2行目」', 'g', 'gs'] },
    u: { label: 'Unicode モード', desc: '\\p{…} で文字の種類（漢字やひらがななど）を指定できるようになり、絵文字のような文字も1文字として数えます。書き方の誤りを厳しく調べるので、付けないと通る書き方がエラーになることがあります。', cmp: ['\\p{Script=Han}+', '日本語の文章', 'g', 'gu'] },
    y: { label: '位置を固定して探す', desc: '前の一致の終わり（最初は文字列の先頭）の位置でだけ一致を調べ、その先は探しません。一致が途切れたところで止まるので、先頭から続く部分だけを取り出せます。「行ごとに判定する」の判定には使いません。', cmp: ['[A-Z]\\d', 'A1B2C3 D4', 'g', 'gy'] },
  };

  // 「行ごとに判定する」の説明。lines: [例のパターン, 例の行]。行ごとに一致するかを並べて見せる
  const LINE_TIP = {
    label: '行ごとに判定する',
    desc: 'テスト文字列の各行を別々の文字列として調べ、一致するかを行ごとに表に出します。それぞれの行で「一致するはず」か「一致しないはず」を選ぶと、期待どおりかを判定します。行ごとに調べるので、m フラグがなくても ^ と $ は各行の先頭と末尾に一致します。g と y のフラグは使いません。',
    lines: ['^\\d{3}-\\d{4}$', ['123-4567', '1234567', '〒123-4567']],
  };

  const PRESETS = [
    { name: '郵便番号（123-4567）', pattern: '^\\d{3}-\\d{4}$', flags: 'gm', test: '123-4567\n1234567\n12-34567\n100-0001' },
    { name: '携帯電話の番号', pattern: '^0[789]0-?\\d{4}-?\\d{4}$', flags: 'gm', test: '090-1234-5678\n08012345678\n03-1234-5678' },
    { name: 'メールアドレス（簡易）', pattern: '^[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+$', patternBy: { ere: '^[[:alnum:]_.+-]+@[[:alnum:]_-]+(\\.[[:alnum:]_-]+)+$', bre: '^[[:alnum:]_.+-]\\+@[[:alnum:]_-]\\+\\(\\.[[:alnum:]_-]\\+\\)\\+$' }, flags: 'gm', test: 'user@example.com\nfoo.bar+tag@mail.example.co.jp\nnot-an-email\n@example.com' },
    { name: '日付（YYYY-MM-DD）', pattern: '(?<year>\\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\\d|3[01])', patternBy: { python: '(?P<year>\\d{4})-(?P<month>0[1-9]|1[0-2])-(?P<day>0[1-9]|[12]\\d|3[01])', ere: '([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])', bre: '\\([0-9]\\{4\\}\\)-\\(0[1-9]\\|1[0-2]\\)-\\(0[1-9]\\|[12][0-9]\\|3[01]\\)' }, flags: 'g', test: '締め切りは 2026-11-30、開始は 2026-12-01 です。2026-13-01 は月が正しくありません。' },
    { name: 'URL（http と https）', pattern: 'https?://[\\w.-]+(?::\\d+)?(?:/[\\w\\-./?%&=#~]*)?', patternBy: { ere: 'https?://[[:alnum:]_.-]+(:[0-9]+)?(/[[:alnum:]_./?%&=#~-]*)?', bre: 'https\\?://[[:alnum:]_.-]\\+\\(:[0-9]\\+\\)\\?\\(/[[:alnum:]_./?%&=#~-]*\\)\\?' }, flags: 'g', test: '詳しくは https://example.com/docs?page=2 を見てください。http://localhost:8080/ も使えます。' },
    { name: 'ひらがなだけの行', pattern: '^[ぁ-んー]+$', flags: 'gm', test: 'ひらがな\nカタカナ\nまぜまぜカナ\nらーめん' },
    { name: 'HTML のタグ（最短一致）', pattern: '<.+?>', except: 'ere bre', flags: 'g', test: '<p>こんにちは <strong>世界</strong></p>' },
    { name: '同じ単語の繰り返し', pattern: '\\b(\\w+)\\s+\\1\\b', flags: 'gi', test: 'This is is a test. The the end.' },
    { name: '金額（3 桁ごとのカンマ）', pattern: '(?<!\\d)\\d{1,3}(?:,\\d{3})*(?=円)', except: 'ere bre', flags: 'g', test: '合計 1,234,567円、送料 500円、品番 12345' },
  ];

  // ---------- 部品の表示 ----------

  // 言語ごとに違う値。〜By の鍵は、空白で区切った言語の id（'python php'）。処理系が同じ言語（PowerShell は C#）にも同じ値を使う
  function forDialect(item, field) {
    const by = item[`${field}By`];
    if (by) {
      for (const [k, v] of Object.entries(by)) if (Dialects.inList(k, dialect)) return v;
    }
    const v = item[field];
    // POSIX の方言では、ほかの言語の書き方の部品と例を、POSIX の書き方に置き換える
    if (field === 'insert' || field === 'pattern') return toPosix(v);
    if (field === 'wrap' && v) return v.map(toPosix);
    if (field === 'ex' && v) return [toPosix(v[0]), v[1]];
    return v;
  }

  // POSIX の文字クラス。中では \ が文字になるので、] は先頭、[ と ^ は後ろ、- は最後に置いて、文字として読ませる
  function posixClass(v, neg) {
    const chars = [...new Set([...v])];
    const rest = chars.filter((c) => !']-^['.includes(c));
    let body = (chars.includes(']') ? ']' : '') + rest.join('') + (chars.includes('[') ? '[' : '') +
      (chars.includes('^') ? '^' : '') + (chars.includes('-') ? '-' : '');
    if (!neg && body === '^') return '\\^'; // [^] は「以外」の書き始めになる
    if (!neg && body.startsWith('^')) body = `${body.slice(1)}^`;
    return `[${neg ? '^' : ''}${body}]`;
  }

  // ほかの言語の書き方の正規表現を、POSIX の書き方にする。\d と \D は [[:digit:]] と [^[:digit:]] にし、
  // BRE では + ? { } | ( ) に \ を付ける。文字クラスの中と、\ の付いた文字はそのまま。もう一度通しても変わらない
  function toPosix(p) {
    if (typeof p !== 'string' || !Dialects.isPosix(dialect)) return p;
    const bre = dialect === 'bre';
    let out = '';
    for (let k = 0; k < p.length;) {
      const c = p[k];
      if (c === '\\' && k + 1 < p.length) {
        const n = p[k + 1];
        out += n === 'd' ? '[[:digit:]]' : n === 'D' ? '[^[:digit:]]' : c + n;
        k += 2;
      } else if (c === '[') {
        let e = k + 1;
        if (p[e] === '^') e++;
        if (p[e] === ']') e++;
        while (e < p.length && p[e] !== ']') e = p.startsWith('[:', e) && p.indexOf(':]', e) > 0 ? p.indexOf(':]', e) + 2 : e + 1;
        out += p.slice(k, e + 1);
        k = e + 1;
      } else {
        out += bre && '+?{}|()'.includes(c) ? `\\${c}` : c;
        k++;
      }
    }
    return out;
  }
  const availableIn = (item) => (!item.only || Dialects.inList(item.only, dialect)) &&
    (!item.except || !Dialects.inList(item.except, dialect));
  const resolveItem = (item) => ({
    ...item,
    label: forDialect(item, 'label'),
    desc: forDialect(item, 'desc'),
    ex: forDialect(item, 'ex'),
    insert: forDialect(item, 'insert'),
    wrap: forDialect(item, 'wrap'),
    select: forDialect(item, 'select'),
  });

  function buildPalette() {
    const root = $('palette');
    root.innerHTML = '';
    for (const group of PALETTE) {
      const box = document.createElement('div');
      box.className = 'palette-group';
      box.innerHTML = `<h3>${esc(group.title)}</h3>${group.hint ? `<p class="hint">${esc(group.hint)}</p>` : ''}`;
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const raw of group.items) {
        if (!availableIn(raw)) continue;
        const item = resolveItem(raw);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        const code = item.insert ?? `${item.wrap[0]}…${item.wrap[1]}`;
        b.innerHTML = `<span>${esc(item.label)}</span><code>${esc(code)}</code>`;
        attachTip(b, item, code);
        // 押してもパターン欄の選択範囲が消えないようにする
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
          if (item.wrap) wrapSelection(item.wrap[0], item.wrap[1]);
          else insertText(item.insert, item.select);
        });
        chips.append(b);
      }
      box.append(chips);
      root.append(box);
    }
  }

  // 部品の欄をたたむ。たたんだかどうかはブラウザに保存する
  const PALETTE_KEY = 'regex-builder:palette-collapsed';
  function setupPaletteToggle() {
    const btn = $('palette-toggle');
    const body = $('palette-body');
    const set = (collapsed) => {
      body.hidden = collapsed;
      btn.setAttribute('aria-expanded', String(!collapsed));
      btn.textContent = collapsed ? 'ひらく' : 'たたむ';
    };
    let saved = null;
    try { saved = localStorage.getItem(PALETTE_KEY); } catch (_) { /* 保存できない環境では開いた状態で始める */ }
    set(saved === '1');
    btn.addEventListener('click', () => {
      const collapsed = !body.hidden;
      set(collapsed);
      try { localStorage.setItem(PALETTE_KEY, collapsed ? '1' : '0'); } catch (_) { /* 保存できなくても切り替えは続ける */ }
    });
  }

  // ---------- 部品の説明（マウスを乗せたときに出す） ----------

  const tipEl = document.createElement('div');
  tipEl.id = 'part-tip';
  tipEl.className = 'part-tip';
  tipEl.setAttribute('role', 'tooltip');
  tipEl.hidden = true;
  document.body.append(tipEl);

  // 例の文字列のうち、例のパターンに一致した部分に印を付ける。g も y も無いときは最初の一致だけを探す
  function exampleMatches(pattern, text, flags) {
    let re;
    try {
      if (isJs()) re = new RegExp(pattern, flags);
      else {
        const t = Translate.translate(pattern, flags, dialect);
        // 長さ 0 の一致のあとの探し方を、テストの欄と同じく言語に合わせる（match-core.js）。POSIX は、いちばん長い一致を探す
        if (flags.includes('g') || t.program) {
          return window.MatchCore.findAll(t.source, t.flags, text, 100, undefined, null, Dialects.emptyMode(dialect), t.program).matches
            .filter((m) => m.text.length).map((m) => Object.assign([m.text], { index: m.index }));
        }
        re = new RegExp(t.source, t.flags);
      }
    } catch (_) {
      return [];
    }
    if (re.global) return [...text.matchAll(re)].filter((m) => m[0].length);
    const m = re.exec(text);
    return m && m[0].length ? [m] : [];
  }

  function exampleHtml(text, matches) {
    let html = '';
    let pos = 0;
    for (const m of matches) {
      // 前の一致とすき間なく続く一致は、別の一致だと分かるように少し離す
      const cls = pos && m.index === pos ? ' class="tip-next"' : '';
      html += esc(text.slice(pos, m.index)) + `<mark${cls}>${esc(m[0])}</mark>`;
      pos = m.index + m[0].length;
    }
    return html + esc(text.slice(pos));
  }

  // 例のパターンの見せ方。JavaScript は /…/flags、ほかの言語はパターンとフラグ
  function patternLabel(pattern, flags) {
    if (isJs()) return `/${esc(pattern)}/${flags}`;
    const f = flags.replace('g', '');
    return esc(pattern) + (f ? `（フラグ ${f}）` : '');
  }

  function exampleBlock(label, pattern, text, flags, showCount) {
    const matches = exampleMatches(pattern, text, flags);
    const count = showCount ? `<span class="tip-count">${matches.length ? `${matches.length} 件` : '一致なし'}</span>` : '';
    return `<div class="tip-ex"><span class="tip-ex-label">${label}</span><code>${patternLabel(pattern, flags)}</code>${count}</div>` +
      `<div class="tip-sample">${exampleHtml(text, matches)}</div>`;
  }

  function tipHtml(item, rawCode) {
    // POSIX の方言では、フラグやボタンの説明の例も POSIX の書き方にする（toPosix は、もう一度通しても変わらない）
    const code = toPosix(rawCode);
    let html = `<div class="tip-head"><strong>${esc(item.label)}</strong>${code ? `<code>${esc(code)}</code>` : ''}</div>`;
    html += `<p>${esc(item.desc)}</p>`;
    if (item.ex) html += exampleBlock('例', toPosix(item.ex[0]), item.ex[1], 'g', false);
    if (item.cmp) {
      const [raw, text, off, on] = item.cmp;
      const pattern = toPosix(raw);
      html += exampleBlock('付けない', pattern, text, off, true);
      html += `<div class="tip-gap"></div>` + exampleBlock('付ける', pattern, text, on, true);
    }
    if (item.lines) {
      const [raw, lines] = item.lines;
      const pattern = toPosix(raw);
      html += `<div class="tip-ex"><span class="tip-ex-label">例</span><code>${patternLabel(pattern, '')}</code></div>`;
      html += '<div class="tip-sample tip-lines">' + lines.map((line) => {
        const matches = exampleMatches(pattern, line, '');
        return `<div><span>${exampleHtml(line, matches)}</span><span class="tip-count">${matches.length ? '一致する' : '一致しない'}</span></div>`;
      }).join('') + '</div>';
    }
    return html;
  }

  // target の下に説明を出す。owner は読み上げ用に説明を結び付ける要素
  function showTip(target, item, code, owner = target) {
    tipEl.innerHTML = tipHtml(item, code);
    tipEl.hidden = false;
    owner.setAttribute('aria-describedby', tipEl.id);
    // 前に出した位置のままだと、右端に寄って幅が縮んだ状態で測ってしまうので、左上に戻してから測る
    tipEl.style.left = '0px';
    tipEl.style.top = '0px';
    const r = target.getBoundingClientRect();
    const gap = 8;
    const margin = 16;
    const w = tipEl.offsetWidth;
    const h = tipEl.offsetHeight;
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - w - margin));
    let top = r.bottom + gap;
    // 下に入りきらなければ、ボタンの上に出す
    if (top + h > window.innerHeight - margin && r.top - gap - h > margin) top = r.top - gap - h;
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${top}px`;
  }

  function hideTip(owner) {
    tipEl.hidden = true;
    owner.removeAttribute('aria-describedby');
  }

  // focusEl を渡すと、el の中のその要素にフォーカスが来たときにも出す（フラグの label と checkbox のように）
  function attachTip(el, item, code, focusEl = el) {
    if (!item.desc) return;
    el.addEventListener('mouseenter', () => showTip(el, item, code, focusEl));
    focusEl.addEventListener('focus', () => showTip(el, item, code, focusEl));
    el.addEventListener('mouseleave', () => hideTip(focusEl));
    focusEl.addEventListener('blur', () => hideTip(focusEl));
    // タッチ操作では mouseleave が起きないので、押したら閉じる
    el.addEventListener('click', () => hideTip(focusEl));
  }

  window.addEventListener('scroll', () => { tipEl.hidden = true; }, { passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') tipEl.hidden = true; });

  // ---------- 入力欄の書き換え ----------

  // execCommand を使うと、Ctrl+Z で元に戻せる
  function replaceRange(el, start, end, text) {
    el.focus({ preventScroll: true });
    el.setSelectionRange(start, end);
    if (start === end && !text) return;
    const ok = document.execCommand && document.execCommand('insertText', false, text);
    if (!ok) {
      const v = el.value;
      el.value = v.slice(0, start) + text + v.slice(end);
    }
  }

  // 中身をまるごと置き換える。Ctrl+Z で前の中身に戻せる
  function setValue(el, text) {
    if (el.value !== text) replaceRange(el, 0, el.value.length, text);
  }

  // select を渡すと、入れた文字列のその範囲を選んだ状態にする（書き換えてほしい部分を示すため）
  function insertText(text, select) {
    const s = patternEl.selectionStart ?? patternEl.value.length;
    const e = patternEl.selectionEnd ?? s;
    replaceRange(patternEl, s, e, text);
    if (select) patternEl.setSelectionRange(s + select[0], s + select[1]);
    else patternEl.setSelectionRange(s + text.length, s + text.length);
    update();
  }

  function wrapSelection(open, close) {
    const s = patternEl.selectionStart ?? patternEl.value.length;
    const e = patternEl.selectionEnd ?? s;
    const selected = patternEl.value.slice(s, e);
    replaceRange(patternEl, s, e, open + selected + close);
    if (selected) {
      const pos = s + open.length + selected.length + close.length;
      patternEl.setSelectionRange(pos, pos);
    } else if (open.includes('name')) {
      const at = open.indexOf('name'); // name を選んだ状態にする
      patternEl.setSelectionRange(s + at, s + at + 4);
    } else {
      patternEl.setSelectionRange(s + open.length, s + open.length);
    }
    update();
  }

  function setupCustomParts() {
    for (const [id, tip] of Object.entries(BUTTON_TIPS)) attachTip($(id), tip, tip.code);
    for (const box of flagBoxes) attachTip(box.closest('label'), FLAG_TIPS[box.value], box.value, box);
    for (const id of ['literal-add', 'class-add', 'class-neg-add', 'rep-add']) {
      $(id).addEventListener('mousedown', (e) => e.preventDefault());
    }
    $('literal-add').addEventListener('click', () => {
      const v = $('literal-text').value;
      if (!v) return;
      // POSIX の BRE では、+ ? ( ) { } | に \ を付けると特別な意味になるので、付けない
      const special = dialect === 'bre' ? /[.*^$[\]\\]/g : /[.*+?^${}()|[\]\\/]/g;
      insertText(v.replace(special, '\\$&'));
    });
    const addClass = (neg) => {
      const v = $('class-text').value;
      if (!v) return;
      if (Dialects.isPosix(dialect)) {
        insertText(posixClass(v, neg));
        return;
      }
      // [ と ] と、先頭の ^ は文字として入れる。[ は Java などで入れ子の文字クラスになり、先頭の ^ は「以外」の意味になる
      insertText(`[${neg ? '^' : ''}${v.replace(/[[\]]/g, '\\$&').replace(/^\^/, '\\^')}]`);
    };
    $('class-add').addEventListener('click', () => addClass(false));
    $('class-neg-add').addEventListener('click', () => addClass(true));
    $('rep-inf').addEventListener('change', (e) => { $('rep-max').disabled = e.target.checked; });
    $('rep-add').addEventListener('click', () => {
      const min = Math.max(0, parseInt($('rep-min').value, 10) || 0);
      let q;
      if ($('rep-inf').checked) q = `{${min},}`;
      else if ($('rep-max').value === '') q = `{${min}}`;
      else {
        const max = Math.max(min, parseInt($('rep-max').value, 10) || 0);
        q = max === min ? `{${min}}` : `{${min},${max}}`;
      }
      insertText(toPosix(q));
    });
    // 入力欄で Enter キーを押したら、data-submit のボタンを押したことにする。変換の確定の Enter は除く
    for (const input of document.querySelectorAll('[data-submit]')) {
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        $(input.dataset.submit).click();
      });
    }
  }

  // ---------- 入力欄の高さ ----------

  // 中身に合わせて textarea の高さを変える。textarea の中でスクロールしなくなるので、重ねた色付きの層と文字の位置がずれない
  function autosize(el) {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }

  function watchWidth(el) {
    let lastWidth = 0;
    new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      autosize(el);
    }).observe(el);
  }

  // ---------- 正規表現の入力欄の色分け ----------

  const patternView = $('pattern-view');
  const pv = { tokens: [], hover: null, errPos: null };

  function renderPatternView() {
    const src = patternEl.value;
    const n = src.length;
    const kind = new Array(n).fill('');
    for (const [s, e, k] of pv.tokens) for (let i = s; i < e && i < n; i++) kind[i] = k;
    const keyAt = (i) => {
      const hl = pv.hover && i >= pv.hover[0] && i < pv.hover[1] ? ' hl' : '';
      const err = i === pv.errPos ? ' err' : '';
      return (kind[i] ? `tok-${kind[i]}` : '') + hl + err;
    };
    let html = '';
    let i = 0;
    while (i < n) {
      const key = keyAt(i);
      let j = i + 1;
      while (j < n && keyAt(j) === key) j++;
      const text = esc(src.slice(i, j));
      html += key ? `<span class="${key.trim()}">${text}</span>` : text;
      i = j;
    }
    // 誤りの場所が末尾（閉じ括弧が足りないなど）のときは、末尾に印を出す
    if (pv.errPos != null && pv.errPos >= n) html += '<span class="err-end"></span>';
    patternView.innerHTML = html;
  }

  function setPatternHover(range) {
    pv.hover = range;
    renderPatternView();
  }

  // ---------- 表示の更新 ----------

  // 今の言語で選べるフラグのうち、付いているもの
  function currentFlags() {
    return flagBoxes.filter((b) => b.checked && !b.closest('label').hidden).map((b) => b.value).join('');
  }

  function showError(msg) {
    const el = $('error');
    el.hidden = !msg;
    el.textContent = msg || '';
  }

  // 説明の項目と、入力欄の範囲の対応。入力欄のカーソルの位置から項目を探すのに使う
  let rowRanges = [];

  function hoverable(el, start, end) {
    el.tabIndex = 0;
    const on = () => setPatternHover([start, end]);
    const off = () => setPatternHover(null);
    el.addEventListener('mouseenter', on);
    el.addEventListener('focus', on);
    el.addEventListener('mouseleave', off);
    el.addEventListener('blur', off);
  }

  function renderTree(nodes, src, listType) {
    const list = document.createElement(listType === 'alt' ? 'ul' : 'ol');
    if (listType === 'alt') list.className = 'alt';
    for (const n of nodes) {
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'row';
      const frag = n.end > n.start ? src.slice(n.start, n.end) : '';
      row.innerHTML = `<span>${n.html}</span>${frag ? `<code class="src" title="${esc(frag)}">${esc(frag)}</code>` : ''}`;
      if (frag) {
        hoverable(row, n.start, n.end);
        rowRanges.push({ row, start: n.start, end: n.end });
      }
      li.append(row);
      if (n.children && n.children.length) li.append(renderTree(n.children, src, n.listType));
      list.append(li);
    }
    return list;
  }

  function renderSummary(el, { scope, listType, steps }) {
    el.innerHTML = `<p class="scope">${scope}</p>`;
    if (!steps.length) return;
    const list = document.createElement(listType === 'alt' ? 'ul' : 'ol');
    list.className = `steps${listType === 'alt' ? ' alt' : ''}${steps.length === 1 ? ' single' : ''}`;
    for (const s of steps) {
      const li = document.createElement('li');
      li.innerHTML = s.html;
      if (s.end > s.start) hoverable(li, s.start, s.end);
      list.append(li);
    }
    el.append(list);
  }

  const PORTA_LABEL = { same: '同じ意味', minor: 'ほぼ同じ意味', differs: '意味が変わる', error: '書けない' };

  function renderPortability(src, flags) {
    const el = $('portability');
    el.innerHTML = '';
    if (!src) return;
    let list;
    try {
      list = Translate.portability(src, flags, dialect);
    } catch (_) {
      return; // 今の言語で書き方に誤りがあるときは出さない
    }
    el.innerHTML = '<h3>ほかの言語で使うと</h3>' +
      '<p class="hint">この正規表現を、ほかの言語でそのまま使ったときの違いです。</p><ul class="porta">' +
      list.map((r) => `<li class="porta-${r.status}"><span class="porta-name">${esc(Dialects.get(r.dialect).name)}</span>` +
        `<span class="porta-status">${PORTA_LABEL[r.status]}</span>` +
        `${r.reasons.length ? `<span class="porta-why">${r.reasons.map(esc).join('。')}</span>` : ''}</li>`).join('') +
      '</ul>';
  }

  // ---------- コード例 ----------

  // コード例に入れるテスト文字列の長さの上限。超えるときと空のときは、例の文字列を入れる
  const MAX_SAMPLE_TEXT = 1000;
  const SAMPLE_TEXT = '調べる文字列';
  const SAMPLE_OPEN_KEY = 'regex-builder:sample-open';
  let sampleCode = '';

  function renderSample(src, flags) {
    const d = Dialects.get(dialect);
    const posix = Dialects.isPosix(dialect);
    const sakura = dialect === 'sakura';
    $('sample-title').textContent = `${sakura ? '検索の手順' : posix ? 'コマンドの例' : 'コード例'}（${d.name}）`;
    sampleCode = '';
    let groups = 0;
    let valid = !!src;
    if (valid) {
      try {
        groups = window.RegexExplain.parse(src, flags, dialect).groupCount;
      } catch (_) {
        valid = isJs() && !!lastRe; // JavaScript は、自前の解析が対応していない書き方でも、ブラウザが受け付ければ出す
      }
    }
    if (valid && isJs() && !lastRe) valid = false;
    let result = null;
    let text = testEl.value;
    let textNote = '';
    if (!text) {
      text = SAMPLE_TEXT;
      textNote = 'テスト文字列が空なので、例の文字列を入れています。';
    } else if (text.length > MAX_SAMPLE_TEXT) {
      text = SAMPLE_TEXT;
      textNote = `テスト文字列が ${MAX_SAMPLE_TEXT} 文字を超えるので、例の文字列を入れています。`;
    }
    if (valid) {
      try {
        result = Dialects.sampleProgram(src, flags, text, dialect, groups);
      } catch (_) {
        result = null;
      }
    }
    $('sample-copy').disabled = !result;
    $('sample-code').textContent = result ? result.code : '';
    $('sample-code').parentElement.hidden = !result;
    if (!result) {
      $('sample-hint').textContent = '正しい正規表現を入れると、ここに出ます。';
      return;
    }
    sampleCode = result.code;
    let hint;
    if (sakura) {
      hint = 'サクラエディタで今の正規表現を使って検索する手順です。';
    } else if (posix) {
      hint = 'テスト文字列を 1 行ずつ grep に渡し、一致した部分を 1 行に 1 つずつ出すコマンドです（bash などのシェルで動かします）。';
    } else {
      hint = `今の正規表現とフラグでテスト文字列を調べ、${flags.includes('g') ? '一致した部分を 1 行に 1 つずつ出す' : '最初の一致を出す'}プログラムです。`;
      if (lineModeEl.checked) hint += '「行ごとに判定する」の判定は入れていません。';
    }
    $('sample-hint').textContent = hint + (sakura ? '' : textNote);
  }

  function setupSample() {
    const box = $('sample');
    let saved = null;
    try { saved = localStorage.getItem(SAMPLE_OPEN_KEY); } catch (_) { /* 保存できない環境では開いた状態で始める */ }
    box.open = saved !== '0';
    box.addEventListener('toggle', () => {
      try { localStorage.setItem(SAMPLE_OPEN_KEY, box.open ? '1' : '0'); } catch (_) { /* 保存できなくても開け閉めは続ける */ }
    });
    $('sample-copy').addEventListener('click', () => {
      if (sampleCode) copy(sampleCode, `${$('sample-title').textContent}をコピーしました`);
    });
  }

  function renderMeaning(src, flags) {
    renderPortability(src, flags);
    const tree = $('tree');
    const summary = $('summary');
    const flagEl = $('flag-explain');
    tree.innerHTML = '';
    flagEl.innerHTML = '';
    rowRanges = [];
    if (!src) {
      summary.innerHTML = '<p class="scope">正規表現を入力すると、ここに意味が出ます。</p>';
      return;
    }
    let result;
    try {
      result = explain(src, flags, dialect);
    } catch (e) {
      const msg = e instanceof RegexParseError
        ? `説明を作れませんでした（${e.message}、${e.pos + 1}文字目）。`
        : '説明を作れませんでした。';
      summary.innerHTML = `<p class="scope">${esc(msg)}</p>`;
      return;
    }
    renderSummary(summary, result.summary);
    tree.append(renderTree(result.tree, src, 'steps'));
    if (result.flags.length) {
      flagEl.innerHTML = '<h3>フラグ</h3><ul>' +
        result.flags.map((f) => `<li><code>${f.flag}</code>：${esc(f.text)}</li>`).join('') +
        '</ul>';
    }
    markCurrentRow();
  }

  // 入力欄のカーソルの位置にある部品の項目に、印を付ける。範囲がいちばん狭い項目を選ぶ
  function markCurrentRow() {
    let best = null;
    if (document.activeElement === patternEl && patternEl.selectionStart === patternEl.selectionEnd) {
      const pos = patternEl.selectionStart;
      // カーソルが部品の中にあればその部品、なければ直前で終わる部品（いま書き終えた部品）
      const inside = rowRanges.filter((r) => r.start <= pos && pos < r.end);
      const candidates = inside.length ? inside : rowRanges.filter((r) => r.end === pos);
      for (const r of candidates) {
        if (!best || r.end - r.start <= best.end - best.start) best = r;
      }
    }
    for (const r of rowRanges) r.row.classList.toggle('current', r === best);
  }

  // ---------- 一致の計算 ----------

  const MAX_MATCHES = 1000;
  const MAX_LINES = 500;
  // 一致の計算をこの時間で打ち切る。(a+)+$ のような正規表現は、文字列によって計算が終わらなくなる
  const MATCH_TIMEOUT_MS = 1500;

  // ワーカーが使えないとき（file:// で開いたときなど）は、画面と同じスレッドで調べる。この場合は打ち切れない
  function findMatchesHere(re, text, lines) {
    try {
      return window.MatchCore.findAll(re.source, re.flags, text, MAX_MATCHES, lines, lastMap, Dialects.emptyMode(dialect), lastProgram);
    } catch (_) {
      return { matches: [], lineHits: null };
    }
  }

  let worker = null;
  let workerUsable = typeof Worker === 'function';
  let job = null; // 計算中の仕事 { id, re, text, lines, resolve, timer }
  let jobSeq = 0;

  function startWorker() {
    if (!workerUsable) return null;
    try {
      const w = new Worker('match-worker.js');
      w.onmessage = (e) => {
        if (!job || e.data.id !== job.id) return;
        finishJob(e.data.error ? { matches: [], lineHits: null } : e.data);
      };
      // ワーカーのファイルを読めなかったときは、以後は画面と同じスレッドで調べる
      w.onerror = (e) => {
        e.preventDefault();
        workerUsable = false;
        stopWorker();
        if (job) finishJob(findMatchesHere(job.re, job.text, job.lines));
      };
      return w;
    } catch (_) {
      workerUsable = false;
      return null;
    }
  }

  function stopWorker() {
    if (worker) worker.terminate();
    worker = null;
  }

  function finishJob(result) {
    const { resolve, timer } = job;
    clearTimeout(timer);
    job = null;
    resolve(result);
  }

  function cancelJob() {
    if (!job) return;
    stopWorker();
    finishJob({ stale: true });
  }

  // 結果は { matches, lineHits } か { timeout: true } か { stale: true }
  function findMatches(re, text, lines) {
    // 前の計算がまだ終わっていなければ、ワーカーごと止めて捨てる
    cancelJob();
    if (!worker) worker = startWorker();
    if (!worker) return Promise.resolve(findMatchesHere(re, text, lines));

    return new Promise((resolve) => {
      const id = ++jobSeq;
      const timer = setTimeout(() => {
        stopWorker();
        finishJob({ timeout: true });
      }, MATCH_TIMEOUT_MS);
      job = { id, re, text, lines, resolve, timer };
      worker.postMessage({ id, source: re.source, flags: re.flags, text, max: MAX_MATCHES, lines, groupMap: lastMap, emptyMode: Dialects.emptyMode(dialect), program: lastProgram });
    });
  }

  // ---------- テスト文字列の色分け ----------

  const testView = $('test-view');
  const GROUP_COLORS = 6;
  // 最後に表示した一致。表の行にマウスを乗せたときに、色分けを描き直すのに使う
  const tv = { matches: [], focus: -1 };

  function renderTestView() {
    const text = testEl.value;
    const n = text.length;
    const matchAt = new Int32Array(n).fill(-1);
    const groupAt = new Int32Array(n);
    const empties = new Map(); // 長さ 0 の一致の位置 → 一致の番号
    tv.matches.forEach((m, k) => {
      const end = m.index + m.text.length;
      if (end === m.index) { if (!empties.has(m.index)) empties.set(m.index, k); return; }
      for (let i = m.index; i < end; i++) matchAt[i] = k;
      // 番号の大きいグループほど内側にあるので、あとから上書きすると内側の色が残る
      (m.ranges || []).forEach((r, g) => {
        if (!r) return;
        for (let i = r[0]; i < r[1] && i < n; i++) groupAt[i] = g + 1;
      });
    });
    const keyAt = (i) => {
      const k = matchAt[i];
      let cls = '';
      if (k >= 0) cls += ` m m${k % 2}${k === tv.focus ? ' m-focus' : ''}`;
      if (groupAt[i]) cls += ` g g${(groupAt[i] - 1) % GROUP_COLORS}`;
      return cls.trim();
    };
    const emptyMark = (k) => `<span class="empty-match${k === tv.focus ? ' m-focus' : ''}"></span>`;
    let html = '';
    let i = 0;
    while (i < n) {
      if (empties.has(i)) html += emptyMark(empties.get(i));
      const key = keyAt(i);
      let j = i + 1;
      while (j < n && !empties.has(j) && keyAt(j) === key) j++;
      const part = esc(text.slice(i, j));
      html += key ? `<span class="${key}">${part}</span>` : part;
      i = j;
    }
    if (empties.has(n)) html += emptyMark(empties.get(n));
    testView.innerHTML = html;
  }

  function focusMatch(k) {
    tv.focus = k;
    renderTestView();
  }

  // ---------- 行ごとの判定 ----------

  const lineModeEl = $('line-mode');
  // 行の中身 → 期待（'+' は一致するはず、'-' は一致しないはず）。行を書き換えても、同じ中身の行には期待が残る
  const expectations = new Map();
  let lastLineHits = null;

  const testLines = () => testEl.value.split('\n').map((l) => l.replace(/\r$/, '')).slice(0, MAX_LINES);

  function judge(hit, expect) {
    if (!expect) return '';
    return (expect === '+') === hit ? 'ok' : 'ng';
  }

  // 期待どおりの行の数と、期待を選んだ行の数
  function lineScore() {
    if (!lastLineHits) return null;
    const lines = testLines();
    let ok = 0;
    let total = 0;
    lines.forEach((line, k) => {
      const result = judge(lastLineHits[k], expectations.get(line));
      if (!result) return;
      total++;
      if (result === 'ok') ok++;
    });
    return { ok, total };
  }

  function renderLines() {
    const panel = $('line-panel');
    const table = $('line-table');
    const summary = $('line-summary');
    panel.hidden = !lineModeEl.checked;
    if (!lineModeEl.checked) return;
    if (!lastLineHits) { table.innerHTML = ''; summary.textContent = ''; return; }
    const lines = testLines();
    let hits = 0;
    let shown = 0;
    let rows = '';
    lines.forEach((line, k) => {
      if (line === '') return;
      shown++;
      const hit = lastLineHits[k];
      if (hit) hits++;
      const expect = expectations.get(line) || '';
      const result = judge(hit, expect);
      const opt = (v, label) => `<option value="${v}"${expect === v ? ' selected' : ''}>${label}</option>`;
      rows += `<tr class="${result}"><td>${k + 1}</td><td><code>${esc(line)}</code></td>` +
        `<td>${hit ? '一致する' : '<span class="none">一致しない</span>'}</td>` +
        `<td><select data-line="${k}" aria-label="${k + 1}行目の期待">${opt('', '指定なし')}${opt('+', '一致するはず')}${opt('-', '一致しないはず')}</select></td>` +
        `<td class="verdict">${result === 'ok' ? '期待どおり' : result === 'ng' ? '期待と違う' : ''}</td></tr>`;
    });
    if (!shown) { table.innerHTML = ''; summary.textContent = '空でない行がありません。'; return; }
    const score = lineScore();
    let text = `${shown}行のうち、一致する行は ${hits}行です。`;
    if (score.total) text += `期待を選んだ ${score.total}行のうち、${score.ok}行が期待どおりです。`;
    const total = testEl.value.split('\n').length;
    if (total > MAX_LINES) text += `（${MAX_LINES}行目までを調べています）`;
    summary.textContent = text;
    summary.className = `line-summary${score.total ? (score.ok === score.total ? ' ok' : ' ng') : ''}`;
    table.innerHTML = '<div class="table-wrap"><table><thead><tr><th>行</th><th>中身</th><th>結果</th><th>期待</th><th>判定</th></tr></thead>' +
      `<tbody>${rows}</tbody></table></div>`;
  }

  function setupLines() {
    attachTip(lineModeEl.closest('label'), LINE_TIP, '', lineModeEl);
    lineModeEl.addEventListener('change', update);
    $('line-table').addEventListener('change', (e) => {
      const sel = e.target.closest('select[data-line]');
      if (!sel) return;
      const line = testLines()[Number(sel.dataset.line)];
      if (sel.value) expectations.set(line, sel.value);
      else expectations.delete(line);
      renderLines();
      renderBadge();
      saveToHash(patternEl.value, currentFlags());
    });
  }

  // ---------- 一致の表示 ----------

  // 正規表現の欄の見出しの横に出す、結果の短い表示。下の欄まで見に行かなくても結果が分かるようにする
  const badge = { state: 'none', count: 0 };

  function renderBadge() {
    const el = $('match-badge');
    let text = '';
    let cls = '';
    if (badge.state === 'error') { text = '書き方に誤りがあります'; cls = 'ng'; }
    else if (badge.state === 'timeout') { text = '時間がかかるので打ち切りました'; cls = 'ng'; }
    else if (badge.state === 'untestable') { text = 'テストの欄では動かせません'; cls = 'ng'; }
    else if (badge.state === 'done') {
      text = badge.count ? `${badge.count}${badge.count >= MAX_MATCHES ? '件以上' : '件'}の一致` : '一致なし';
      const score = lineModeEl.checked ? lineScore() : null;
      if (score && score.total) {
        text += `・期待どおり ${score.ok}/${score.total}行`;
        cls = score.ok === score.total ? 'ok' : 'ng';
      }
    }
    el.hidden = !text;
    el.textContent = text;
    el.className = `badge${cls ? ` ${cls}` : ''}`;
  }

  function groupNames() {
    const nameOf = {};
    // 名前付きグループが何番かは一致の結果から分からないので、パターンを解析して調べる
    try {
      const { ast } = window.RegexExplain.parse(patternEl.value, currentFlags(), dialect);
      (function walk(n) {
        if (!n || typeof n !== 'object') return;
        if (n.type === 'group' && n.kind === 'named') nameOf[n.index] = n.name;
        for (const v of Object.values(n)) {
          if (Array.isArray(v)) v.forEach(walk);
          else if (v && typeof v === 'object') walk(v);
        }
      })(ast);
    } catch (_) { /* 名前が出せなくても表は作る */ }
    return nameOf;
  }

  function renderMatchTable(matches) {
    const table = $('match-table');
    if (!matches.length) { table.innerHTML = ''; return; }
    const groupCount = matches[0].groups.length;
    const nameOf = groupNames();
    const shown = matches.slice(0, 200);
    let rows = shown.map((m, n) => {
      // 一致しなかったグループは undefined。ワーカーからの受け渡しで null になる環境もあるので両方を見る
      const cells = m.groups.map((g) => (g == null
        ? '<td><span class="none">（なし）</span></td>'
        : `<td><code>${esc(g)}</code></td>`));
      return `<tr data-match="${n}" tabindex="0" title="押すと、テスト文字列のこの部分を選びます"><td>${n + 1}</td><td>${m.index}</td><td><code>${esc(m.text)}</code></td>${cells.join('')}</tr>`;
    }).join('');
    const heads = [];
    for (let g = 1; g <= groupCount; g++) {
      const swatch = `<span class="swatch g${(g - 1) % GROUP_COLORS}" aria-hidden="true"></span>`;
      heads.push(`<th>${swatch}グループ ${g}${nameOf[g] ? `「${esc(nameOf[g])}」` : ''}</th>`);
    }
    if (matches.length > shown.length) {
      rows += `<tr><td colspan="${3 + groupCount}" class="none">ほか ${matches.length - shown.length}件は省略</td></tr>`;
    }
    table.innerHTML = `<div class="table-wrap"><table class="matches"><thead><tr><th>#</th><th>位置</th><th>一致した文字列</th>${heads.join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // 一致の表の行と、テスト文字列の色分けを結び付ける
  function setupMatchTable() {
    const table = $('match-table');
    const rowOf = (e) => e.target.closest && e.target.closest('tr[data-match]');
    table.addEventListener('mouseover', (e) => {
      const tr = rowOf(e);
      if (tr) focusMatch(Number(tr.dataset.match));
    });
    table.addEventListener('mouseleave', () => focusMatch(-1));
    table.addEventListener('focusin', (e) => {
      const tr = rowOf(e);
      if (tr) focusMatch(Number(tr.dataset.match));
    });
    table.addEventListener('focusout', () => focusMatch(-1));
    const select = (tr) => {
      const m = tv.matches[Number(tr.dataset.match)];
      if (!m) return;
      testEl.focus({ preventScroll: true });
      testEl.setSelectionRange(m.index, m.index + m.text.length);
    };
    table.addEventListener('click', (e) => { const tr = rowOf(e); if (tr) select(tr); });
    table.addEventListener('keydown', (e) => {
      const tr = rowOf(e);
      if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(tr); }
    });
  }

  function clearMatches(countText) {
    tv.matches = [];
    tv.focus = -1;
    renderTestView();
    $('match-table').innerHTML = '';
    $('match-count').textContent = countText;
    lastLineHits = null;
    renderLines();
  }

  // テストの欄で、JavaScript に置き換えて動かすときの注意
  function renderNotes() {
    const el = $('dialect-notes');
    const notes = isJs() || !patternEl.value ? [] : [...translateNotes, ...Translate.textNotes(testEl.value, dialect)];
    el.hidden = !notes.length;
    el.innerHTML = notes.map((n) => `<li>${esc(n)}</li>`).join('');
  }

  async function renderMatches(re) {
    const text = testEl.value;
    if (!re || !text) cancelJob(); // 計算中の古い結果が、あとから表示を上書きしないようにする
    renderNotes();
    if (!re) {
      badge.state = !patternEl.value ? 'none' : untestable ? 'untestable' : 'error';
      clearMatches(untestable ? `テストの欄では動かせません。${untestable}` : '');
      renderBadge();
      return;
    }
    if (!text) {
      badge.state = 'none';
      clearMatches('テスト文字列を入れてください。');
      renderBadge();
      return;
    }

    const lines = lineModeEl.checked ? testLines() : undefined;
    const result = await findMatches(re, text, lines);
    if (result.stale) return; // あとから入力された内容の結果を待つ
    if (result.timeout) {
      badge.state = 'timeout';
      clearMatches(`一致を調べるのに ${MATCH_TIMEOUT_MS / 1000} 秒以上かかったので、途中でやめました。` +
        '(a+)+ のように繰り返しの中に繰り返しがある正規表現は、文字列によっては計算が終わらなくなります。');
      renderBadge();
      return;
    }

    const { matches } = result;
    tv.matches = matches;
    tv.focus = -1;
    renderTestView();
    $('match-count').textContent = matches.length
      ? `${matches.length}${matches.length >= MAX_MATCHES ? '件以上' : '件'}の一致${re.global ? '' : '（g フラグがないので、最初の1件だけ）'}。表の行にマウスを乗せると、上の文字列の対応する一致に枠が付きます。`
      : '一致しませんでした。';
    renderMatchTable(matches);
    lastLineHits = result.lineHits || null;
    renderLines();
    badge.state = 'done';
    badge.count = matches.length;
    renderBadge();
  }

  // ---------- 全体の更新 ----------

  // 自前の解析で誤りの場所が分かれば、日本語の説明と位置を返す。分からなければ null（ブラウザの英語の説明を使う）
  function japaneseError(src, flags) {
    try {
      window.RegexExplain.parse(src, flags, dialect);
    } catch (e) {
      if (e instanceof RegexParseError) return { message: `${e.message}（${e.pos + 1}文字目）`, pos: e.pos };
    }
    return null;
  }

  // 入力欄の色分けの範囲。書きかけで ) や ] が足りないときは、補って解析し、色分けを消さないようにする
  function patternTokens(src, flags) {
    const { parse, tokens } = window.RegexExplain;
    for (const tail of ['', ')', '))', ')))', ']', '])', ']))']) {
      try {
        return tokens(parse(src + tail, flags, dialect).ast).filter(([s]) => s < src.length);
      } catch (_) { /* 次の補い方を試す */ }
    }
    return [];
  }

  let lastRe = null;
  // JavaScript 以外の言語を置き換えて動かすときの、グループの番号の対応と注意。試せないときはその理由
  let lastMap = null;
  // POSIX のときの状態機械（translate.js の buildProgram）。いちばん長い一致を探すのに使う
  let lastProgram = null;
  let translateNotes = [];
  let untestable = '';

  function update() {
    const src = patternEl.value;
    const flags = currentFlags();
    $('flag-view').textContent = flags;

    lastRe = null;
    lastMap = null;
    lastProgram = null;
    translateNotes = [];
    untestable = '';
    pv.errPos = null;
    if (!src) {
      showError('');
    } else if (isJs()) {
      try {
        lastRe = new RegExp(src, flags);
        showError('');
      } catch (e) {
        const ja = japaneseError(src, flags);
        if (ja) pv.errPos = ja.pos;
        showError(`正規表現の書き方に誤りがあります。${ja ? ja.message : e.message}`);
      }
    } else {
      try {
        const t = Translate.translate(src, flags, dialect);
        lastRe = new RegExp(t.source, t.flags);
        lastMap = t.groupMap;
        lastProgram = t.program || null;
        translateNotes = t.notes;
        showError('');
      } catch (e) {
        if (e instanceof RegexParseError) {
          pv.errPos = e.pos;
          showError(`正規表現の書き方に誤りがあります。${e.message}（${e.pos + 1}文字目）`);
        } else if (e instanceof Translate.Untranslatable) {
          untestable = e.message;
          showError('');
        } else {
          showError(`この正規表現は、テストの欄では動かせませんでした。${e.message}`);
        }
      }
    }

    pv.tokens = patternTokens(src, flags);
    pv.hover = null;
    renderPatternView();
    autosize(patternEl);
    autosize(testEl);

    // 書き方に誤りがあっても、解析できれば説明を出す
    renderMeaning(src, flags);
    renderMatches(src ? lastRe : null);
    renderSample(src, flags);
    saveToHash(src, flags);
  }

  // ---------- 共有 URL ----------

  const MAX_SHARED_TEXT = 2000;

  let hashTimer = null;
  function saveToHash(src, flags) {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      const p = new URLSearchParams();
      if (!isJs()) p.set('d', dialect);
      if (src) p.set('p', src);
      if (flags) p.set('f', flags);
      const text = testEl.value;
      if (text && text.length <= MAX_SHARED_TEXT) {
        p.set('t', text);
        // 期待は、行ごとに + - . の 1 文字で表す
        const marks = testLines().map((line) => expectations.get(line) || '.').join('').replace(/\.+$/, '');
        if (marks) p.set('e', marks);
      }
      if (lineModeEl.checked) p.set('l', '1');
      const hash = p.toString();
      history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
    }, 300);
  }

  function loadFromHash() {
    if (!location.hash) return false;
    const p = new URLSearchParams(location.hash.slice(1));
    if (!p.has('p') && !p.has('t')) return false;
    setDialect(p.get('d') || 'js', false);
    // 正規表現の欄には改行を入れられない（入力のときと同じく \n にする）。改行が残ると、コピーやコード例の文字列が切れる
    patternEl.value = (p.get('p') || '').replace(/\r\n|\r|\n/g, '\\n');
    setFlags(p.get('f') ?? '');
    testEl.value = p.get('t') || '';
    lineModeEl.checked = p.get('l') === '1';
    const marks = p.get('e') || '';
    testLines().forEach((line, k) => {
      if (marks[k] === '+' || marks[k] === '-') expectations.set(line, marks[k]);
    });
    return true;
  }

  function setFlags(flags) {
    for (const b of flagBoxes) b.checked = flags.includes(b.value);
  }

  // ---------- 知らせ ----------

  let toastTimer = null;

  // undo を渡すと「元に戻す」ボタンを付け、少し長めに出す
  function toast(msg, undo) {
    const area = $('toast-area');
    clearTimeout(toastTimer);
    area.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'toast';
    const text = document.createElement('span');
    text.textContent = msg;
    t.append(text);
    if (undo) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = '元に戻す';
      b.addEventListener('click', () => {
        t.remove();
        undo();
      });
      t.append(b);
    }
    area.append(t);
    toastTimer = setTimeout(() => t.remove(), undo ? 6000 : 1800);
  }

  async function copy(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg);
    } catch (_) {
      window.prompt('コピーしてください', text);
    }
  }

  // 正規表現・フラグ・テスト文字列をまとめて覚えておき、あとで戻す
  function snapshot() {
    return { dialect, pattern: patternEl.value, flags: currentFlags(), test: testEl.value, lineMode: lineModeEl.checked };
  }

  function restore(s) {
    setDialect(s.dialect, false);
    setValue(testEl, s.test);
    setValue(patternEl, s.pattern);
    setFlags(s.flags);
    lineModeEl.checked = s.lineMode;
    update();
  }

  // 例の一覧。今の言語で書けない例（Go の後読みなど）は出さない
  function buildPresets() {
    const sel = $('preset');
    sel.length = 1;
    PRESETS.forEach((p, n) => {
      if (p.except && Dialects.inList(p.except, dialect)) return;
      try {
        window.RegexExplain.parse(forDialect(p, 'pattern'), p.flags, dialect);
      } catch (_) {
        return;
      }
      const o = document.createElement('option');
      o.value = String(n);
      o.textContent = p.name;
      sel.append(o);
    });
  }

  // 言語を切り替える。save が true なら、次に開いたときのためにブラウザに覚えておく
  function setDialect(id, save = true) {
    dialect = Dialects.ids.includes(id) ? id : 'js';
    $('dialect').value = dialect;
    const allowed = Dialects.flags(dialect);
    for (const b of flagBoxes) b.closest('label').hidden = !allowed.includes(b.value);
    for (const el of document.querySelectorAll('.slash')) el.hidden = !isJs();
    $('flag-view').hidden = !isJs();
    const d = Dialects.get(dialect);
    // 英字で終わる名前（「… の re」）のあとには空白を入れる
    const engine = /[A-Za-z0-9)]$/.test(d.engine) ? `${d.engine} ` : d.engine;
    // テストの欄で JavaScript に置き換えて動かすことは書かない。結果がずれる場面だけ、テストの欄に注意を出す
    $('dialect-engine').textContent = `${engine}の書き方と意味に合わせています。${d.note || ''}`;
    $('copy-literal').title = isJs() ? '/…/flags の形でコピー' : `${d.name}のコードの形でコピー`;
    buildPalette();
    buildPresets();
    if (save) {
      try { localStorage.setItem(DIALECT_KEY, dialect); } catch (_) { /* 保存できなくても切り替えは続ける */ }
    }
  }

  function setupDialect() {
    const sel = $('dialect');
    for (const d of Dialects.LIST) {
      const o = document.createElement('option');
      o.value = d.id;
      o.textContent = d.name;
      sel.append(o);
    }
    sel.addEventListener('change', () => {
      setDialect(sel.value);
      update();
    });
    let saved = null;
    try { saved = localStorage.getItem(DIALECT_KEY); } catch (_) { /* 保存できない環境では JavaScript で始める */ }
    setDialect(saved || 'js', false);
  }

  function setupTools() {
    const sel = $('preset');
    buildPresets();
    sel.addEventListener('change', () => {
      const p = PRESETS[Number(sel.value)];
      sel.value = '';
      if (!p) return;
      const before = snapshot();
      setValue(testEl, p.test);
      setValue(patternEl, forDialect(p, 'pattern'));
      setFlags(p.flags);
      update();
      toast(`例「${p.name}」を読み込みました`, () => restore(before));
    });
    $('copy-literal').addEventListener('click', () => {
      if (isJs()) {
        if (!lastRe) { toast('正しい正規表現がありません'); return; }
        copy(lastRe.toString(), `${lastRe.toString()} をコピーしました`);
        return;
      }
      const src = patternEl.value;
      try {
        window.RegexExplain.parse(src, currentFlags(), dialect);
      } catch (_) {
        toast('正しい正規表現がありません');
        return;
      }
      const code = Dialects.codeSnippet(src, currentFlags().replace('g', ''), dialect);
      copy(code, `${Dialects.get(dialect).name}の形でコピーしました: ${code}`);
    });
    $('copy-link').addEventListener('click', () => {
      saveToHash(patternEl.value, currentFlags());
      const note = testEl.value.length > MAX_SHARED_TEXT ? `（テスト文字列は ${MAX_SHARED_TEXT} 文字を超えるので、含めていません）` : '';
      setTimeout(() => copy(location.href, `共有 URL をコピーしました${note}`), 350);
    });
    $('clear').addEventListener('click', () => {
      if (!patternEl.value) return;
      const before = snapshot();
      setValue(patternEl, '');
      update();
      toast('正規表現を消しました', () => restore(before));
    });

    // 正規表現は 1 行で書く。Enter キーでは改行せず、貼り付けた改行は \n に置き換える
    patternEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) e.preventDefault();
    });
    patternEl.addEventListener('input', () => {
      if (/[\r\n]/.test(patternEl.value)) {
        const pos = patternEl.selectionStart;
        const fix = (s) => s.replace(/\r\n|\r|\n/g, '\\n');
        const head = fix(patternEl.value.slice(0, pos));
        patternEl.value = head + fix(patternEl.value.slice(pos));
        patternEl.setSelectionRange(head.length, head.length);
      }
      update();
    });
    testEl.addEventListener('input', update);
    flagBoxes.forEach((b) => b.addEventListener('change', update));

    // 入力欄のカーソルが動いたら、説明の項目の印を付け直す
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === patternEl) markCurrentRow();
    });
    patternEl.addEventListener('blur', markCurrentRow);
    watchWidth(patternEl);
    watchWidth(testEl);
  }

  setupDialect();
  setupPaletteToggle();
  setupCustomParts();
  setupLines();
  setupMatchTable();
  setupTools();
  setupSample();
  if (!loadFromHash()) {
    const p = PRESETS[3];
    patternEl.value = forDialect(p, 'pattern');
    setFlags(p.flags);
    testEl.value = p.test;
  }
  update();
})();
