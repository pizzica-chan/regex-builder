# PHP の正規表現（preg_* 関数、PCRE2）

## 対象と公式の資料

- 調べた処理系: PHP 8.3.9 の `preg_*` 関数（中で使う PCRE2 は 10.42）
- 公式の資料
  - [PHP マニュアル: パターン構文](https://www.php.net/manual/en/reference.pcre.pattern.syntax.php)
  - [エスケープシーケンス](https://www.php.net/manual/en/regexp.reference.escape.php)
  - [Unicode 文字プロパティ](https://www.php.net/manual/en/regexp.reference.unicode.php)
  - [パターン修飾子](https://www.php.net/manual/en/reference.pcre.pattern.modifiers.php)
  - [アンカー](https://www.php.net/manual/en/regexp.reference.anchors.php)、[ドット](https://www.php.net/manual/en/regexp.reference.dot.php)
  - [アサーション（先読み・後読み）](https://www.php.net/manual/en/regexp.reference.assertions.php)
  - [サブパターン](https://www.php.net/manual/en/regexp.reference.subpatterns.php)、[後方参照](https://www.php.net/manual/en/regexp.reference.back-references.php)、[アトミックグループ](https://www.php.net/manual/en/regexp.reference.onlyonce.php)
  - [繰り返し](https://www.php.net/manual/en/regexp.reference.repetition.php)、[文字クラス](https://www.php.net/manual/en/regexp.reference.character-classes.php)、[内部オプション](https://www.php.net/manual/en/regexp.reference.internal-options.php)
  - [PCRE2 のパターンの資料（pcre2pattern）](https://www.pcre.org/current/doc/html/pcre2pattern.html)

## 書き方と修飾子

PHP では正規表現を `'/パターン/修飾子'` のように区切り文字で囲んで渡します。

| 修飾子 | 意味 |
|---|---|
| `u` | パターンと対象の文字列を UTF-8 として扱う。**日本語を 1 文字として扱うために必要** |
| `i` | 大文字と小文字を区別しない |
| `m` | `^` と `$` を各行の先頭と末尾にも一致させる |
| `s` | `.` を改行にも一致させる |
| `x` | 空白を無視し、`#` からをコメントにする |
| `D` | `$` を文字列の末尾だけに一致させる（m があるときは効かない） |
| `U` | 繰り返しの「できるだけ長く」と「できるだけ短く」を入れ替える |
| `J` | 同じ名前のグループを置けるようにする |

`u` がないと、日本語の 1 文字（UTF-8 で 3 バイト）が 3 文字として数えられ、`.` や `[ぁ-ん]` が正しく動きません。このツールの PHP のモードは `u` を付けて使う前提にしています。

正規表現の中では `(?i)` のように書けます。グループの外に書くと、そこから後ろ全体に、グループの中に書くとグループの終わりまで効きます。あとに続く `|` の候補にも効くので、`a(?i)b|c` は `C` にも一致します（実際の結果）。

## 文字の集まり

- PHP マニュアルには、u 修飾子があると `\d` `\s` `\w` が Unicode の性質を使う、とあります。実際に、`\d` は全角数字にも、`\w` はひらがなや漢字にも一致しました
- `\s` は全角スペースと U+0085 にも一致します（実際の結果）
- `\h` は横方向の空白、`\v` は縦方向の空白（LF、VT、FF、CR、U+0085、U+2028、U+2029）です
- `\R` は改行の並び（CRLF か、改行の 1 文字）です。CRLF に一致したあと、CR だけに戻って試し直さないので、`\R\n` は CRLF に一致しません（実際の結果）
- `.` は LF 以外の 1 文字です。CR にも一致します
- POSIX の書き方 `[[:alpha:]]` が使えます。u 修飾子があると、`[:alpha:]` は `\p{L}`、`[:alnum:]` は `\p{L}` と `\p{N}`（① や ² も含む）、`[:punct:]` は `\p{P}` と ASCII の記号（`$` や `+` など）に広がります（実際の結果）

## 位置

- `^` は文字列の先頭、`$` は文字列の末尾と**最後の LF の直前**です。D 修飾子を付けると、末尾だけになります
- m 修飾子のとき、`^` は LF の直後、`$` は LF の直前にも一致します。ただし、文字列が LF で終わるとき、その LF のあと（文字列の末尾）には `^` は一致しません（実際の結果）
- `\A` は先頭、`\z` は末尾、`\Z` は末尾か最後の LF の直前です。m と D の修飾子の影響を受けません
- `\G` は、探し始めた位置です

## グループと参照

- 名前付きグループは `(?P<name>…)`、`(?<name>…)`、`(?'name'…)` のどれでも書けます
- 参照は `(?P=name)`、`\k<name>`、`\k'name'`、`\k{name}`、`\g{name}` です。番号は `\1`、`\g1`、`\g{1}`、相対の `\g{-1}` です
- 一致しなかったグループへの参照は、必ず失敗します
- アトミックグループ `(?>…)` と強欲な繰り返し（`*+` など）が使えます
- `(?#…)` はコメントです
- 同じ名前のグループは `(?J)` か J 修飾子を付けたときだけ置けます

## 後読みの長さ

- PHP 8.3（PCRE2 10.42）では、後読みの中身は、`|` の候補ごとに長さが決まっている必要があります。`(?<=bullock|donkey)` は書けますが、`(?<=a+)` や `(?<=a{1,3})` は誤りです（実際の結果）
- PHP マニュアルによると、PHP 8.4（PCRE2 10.44）からは、上限までの長さの決まらない後読みも書けます

## 量指定子

- `a{,3}` は、PHP 8.3 では文字のまま読みます。PHP マニュアルによると、PHP 8.4 からは `a{0,3}` と同じ意味です

## エスケープ

- `\xhh`、`\x{hhhh}`（u 修飾子のとき Unicode のコードポイント）、`\ddd`（8進数か後方参照）、`\o{…}`、`\cx`、`\e`、`\a` が使えます
- `\12` のような 2 桁以上の数字は、その位置までに同じ数以上のグループがあれば後方参照、なければ8進数の文字コードです。`(a)\12` の `\12` は LF になります（実際の結果）
- `\Q…\E` で囲んだ部分はすべて文字として読みます
- `\u0041` の書き方は使えません（実際に誤りになりました）。`\x{41}` と書きます
- 意味のない英字のエスケープ（`\q` など）は誤りです（PCRE2 の資料と実際の結果）
- `\p{L}`、`\p{Han}`、`\p{Hiragana}`、`\pL` などが使えます

## このツールでの扱い

- PHP のモードは u 修飾子を付けたときの動きに合わせています。コピーするときも u を付けます
- 「試す」の欄では `\d` を `\p{Nd}`、`\w` を `[\p{L}\p{N}_]`、`$` を「末尾か、最後の LF の直前」のように置き換えて動かします
