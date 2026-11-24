# JavaScript の正規表現

## 対象と公式の資料

- 調べた処理系: Node.js 22（V8）。ブラウザも同じ仕様（ECMAScript）に従います
- 公式の資料: MDN Web Docs の正規表現のリファレンス
  - [正規表現（一覧）](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions)
  - [文字クラスエスケープ（\d \w \s）](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Character_class_escape)
  - [ワイルドカード（.）](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Wildcard)
  - [入力境界アサーション（^ $）](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Input_boundary_assertion)
  - [後方参照](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Backreference)
  - [名前付きキャプチャグループ](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Named_capturing_group)
  - [後読み](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Lookbehind_assertion)
  - [修飾子 (?ims-ims:…)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Modifier)
  - [文字エスケープ](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Character_escape)
  - [量指定子](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Quantifier)
  - [Unicode 文字クラスエスケープ（\p{…}）](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Unicode_character_class_escape)
  - [字句文法（空白と改行の文字）](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Lexical_grammar)

## フラグ

| フラグ | 意味 |
|---|---|
| `d` | 一致した部分の位置（indices）を記録する |
| `g` | すべての一致を探す |
| `i` | 大文字と小文字を区別しない |
| `m` | `^` と `$` を各行の先頭と末尾にする |
| `s` | `.` を改行にも一致させる |
| `u` | Unicode モード。パターンを Unicode のコードポイントの並びとして扱う |
| `v` | u をさらに広げたモード（文字クラスの集合演算など） |
| `y` | 今の位置からだけ探す（sticky） |

フラグは `/…/gi` のように正規表現の外に書きます。正規表現の中に `(?i)` とは書けません。範囲を区切る `(?i:…)` は書けますが、新しい書き方です（MDN では Baseline 2025）。Node.js 22 では書き方の誤りになりました。

i フラグで同じとみなす文字は、u フラグのあるなしで変わります。u フラグがないときは、1 文字の大文字にして同じになる文字を同じとみなしますが、ASCII 以外の文字を ASCII の文字と同じにはしません。そのため、ſ（U+017F）と s、ケルビン記号（U+212A）と k は、u フラグがあるときだけ同じとみなします。ᾀ と ᾈ のように、大文字にすると 2 文字になる文字も、u フラグがあるときだけ同じとみなします。ς と σ、µ と μ は、どちらでも同じとみなします（Node.js 22 で確かめた結果）。

## 文字の集まり

- `\d` は `[0-9]` と同じです。全角数字には一致しません
- `\w` は英字（A〜Z、a〜z）、数字（0〜9）、`_` です。u と i のフラグがあるときは、大文字と小文字を同じとみなして、これらと同じになる文字にも一致します
- `\s` は空白と改行の文字です。空白はタブ、垂直タブ、改ページ、半角スペース、ノーブレークスペース（U+00A0）、U+FEFF、Unicode の空白の区切り文字（Zs）です。改行は LF、CR、U+2028、U+2029 です。全角スペース（U+3000）は Zs なので含まれます
- `.` は改行（LF、CR、U+2028、U+2029）以外の 1 文字です。s フラグで改行にも一致します
- u フラグがないと、`.` は UTF-16 の 1 単位に一致します。絵文字のような文字は 2 単位なので、`.` 2 つで 1 文字になります
- u フラグがあっても、`\B` や `(?![^])` のような位置だけを確かめる正規表現は、絵文字の途中（2 つの単位の間）に一致することがあります。`\B` を `a😀b` に使うと、😀 の途中に一致します。`$` と `(?!a)` では起きませんでした（Node.js 22 で確かめた結果）

## 位置

- `^` は文字列の先頭、`$` は文字列の末尾です。最後の改行の直前には一致しません
- m フラグのとき、`^` は改行の直後、`$` は改行の直前にも一致します。改行は LF、CR、U+2028、U+2029 です
- `\b` と `\B` は `\w` に当たる文字とそれ以外の境目で決まります。日本語の文字は `\w` に当たらないので、日本語の単語の区切りには使えません
- MDN には `\A`、`\z`、`\Z` が「実験的」な機能として載っていて、u フラグがあるときだけ使えるとされています。Node.js 22 では u フラグなしで試し、`\A` を文字 A として読みました。このツールでは、JavaScript の `\A` などは使えないものとして扱います

## グループと参照

- 名前付きグループは `(?<name>…)`、参照は `\k<name>` です。`(?P<name>…)` は使えません
- グループ名は JavaScript の識別子と同じ決まりで、文字・数字と `_` と `$` が使えます。ひらがなや漢字も使えます。1 文字目に数字は使えません。`(?<a-b>…)` は誤りです（Node.js 22 で確かめた結果）
- 同じ名前のグループは `|` の別々の候補の中なら置ける、という新しい仕様があります。Node.js 22 では書き方の誤りになりました
- 一致しなかったグループや、まだ一致していないグループを参照すると、空文字列に一致したものとして成功します（MDN）。ほかの多くの言語では、この参照は失敗します
- 繰り返しの中のグループは、繰り返しの回ごとに値が消えます。`(?:(a)|b)+` を `ab` に使うと、最後の回は `b` なので、グループ 1 は値がありません。そのため、`(?:(a)|b)+\1` は `aba` のうち `ab` だけに一致します。このツールが対応するほかの言語（GNU grep も含む）は、その回に一致しなくても前の回の値を残すので、グループ 1 は `a` になります。後方参照のある言語では、`(?:(a)|b)+\1` は `aba` 全体に一致します（Node.js 22 と各言語の処理系で確かめた結果）
- 同じ理由で、`(a|b\1)+` のように、繰り返しの中でグループが閉じる前にそのグループを参照すると、参照は空文字列として一致します。`(a|b\1)+` は `abab` 全体に一致します。Java、PHP、C# は前の回の値と比べるので、`aba` だけに一致します（Python は書き方の誤り、サクラエディタは参照がいつも失敗します。どれも実際の結果）
- 後読みは長さの決まらない中身（`(?<=a+)`）も書けます
- 後読みの中は右から左へ照らし合わせます。`(?<=\1(a))b` は `aab` の b に一致し、`ab` の b には一致しません。`(?<=(a)\1)b` は、参照する時点でグループ 1 に値がないので、参照が空文字列として成り立ち、`ab` の b に一致します（Node.js 22 で確かめた結果）
- アトミックグループ `(?>…)` と強欲な繰り返し `*+` はありません

## u フラグがないときの古い書き方

u と v のフラグがないとき、互換のために次の書き方が通ります。u フラグがあると、どれも書き方の誤りになります。

- `\0` のあとに数字が続く書き方や、グループの数を超える `\10` などは、8進数の文字コードとして読む（`\012` は LF）
- 意味のないエスケープ（`\q` など）は、その文字として読む
- `\c` のあとに英字がないときは、`\` と `c` の 2 文字として読む
- 量指定子として読めない `{` と `}`、対応しない `]` は、その文字として読む
- 先読みに量指定子を付けられる

## このツールでの扱い

JavaScript のモードでは入力した正規表現をそのままブラウザで動かします。説明は上の仕様と Node.js での結果に合わせて作っています。
