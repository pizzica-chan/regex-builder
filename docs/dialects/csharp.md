# C#（.NET）の正規表現

## 対象と公式の資料

- 調べた処理系: .NET 7.0.20 の `System.Text.RegularExpressions`
- 公式の資料（Microsoft Learn）
  - [正規表現言語 - クイックリファレンス](https://learn.microsoft.com/en-us/dotnet/standard/base-types/regular-expression-language-quick-reference)
  - [文字クラス](https://learn.microsoft.com/en-us/dotnet/standard/base-types/character-classes-in-regular-expressions)
  - [アンカー](https://learn.microsoft.com/en-us/dotnet/standard/base-types/anchors-in-regular-expressions)
  - [グループ化構成体](https://learn.microsoft.com/en-us/dotnet/standard/base-types/grouping-constructs-in-regular-expressions)
  - [前方参照構成体](https://learn.microsoft.com/en-us/dotnet/standard/base-types/backreference-constructs-in-regular-expressions)
  - [正規表現のオプション](https://learn.microsoft.com/en-us/dotnet/standard/base-types/regular-expression-options)
  - [文字のエスケープ](https://learn.microsoft.com/en-us/dotnet/standard/base-types/character-escapes-in-regular-expressions)
  - [量指定子](https://learn.microsoft.com/en-us/dotnet/standard/base-types/quantifiers-in-regular-expressions)

## オプション

| オプション | 正規表現の中での書き方 | 意味 |
|---|---|---|
| `RegexOptions.IgnoreCase` | `(?i)` | 大文字と小文字を区別しない |
| `RegexOptions.Multiline` | `(?m)` | `^` と `$` を各行の先頭と末尾にも一致させる |
| `RegexOptions.Singleline` | `(?s)` | `.` を改行にも一致させる |
| `RegexOptions.ExplicitCapture` | `(?n)` | 名前か番号を明示したグループだけを記録する |
| `RegexOptions.IgnorePatternWhitespace` | `(?x)` | 空白を無視し、`#` からをコメントにする |
| `RegexOptions.ECMAScript` | （なし） | `\d` などを JavaScript と同じ範囲にする |

`(?i)` は書いた位置から後ろ（グループの中ならグループの終わりまで）に、`(?i:…)` は囲んだ範囲に効きます。`(?i)` は、あとに続く `|` の候補にも効きます（`a(?i)b|c` は `C` にも一致します。実際の結果）。

## 文字の集まり

- `\d` は `\p{Nd}` と同じです。全角数字やほかの言語の数字にも一致します
- `\w` は一般カテゴリ Ll、Lu、Lt、Lo、Lm、Mn、Nd、Pc の文字です。ひらがなや漢字に一致します。Python と違い、² のような数字（No）には一致せず、結合文字（Mn）と ‿ などの連結の句読点（Pc）には一致します（実際の結果）
- `\s` は `\f \n \r \t \v`、U+0085、Unicode の区切り文字（Zs、Zl、Zp）です。全角スペースにも一致します
- `.` は LF（`\n`）以外の 1 文字です。CR（`\r`）にも一致します
- 文字列は UTF-16 で、`.` は UTF-16 の 1 単位に一致します。絵文字のような文字は 2 単位なので、`^.$` は絵文字 1 文字に一致しませんでした（実際の結果）

## 位置

- `^` は文字列の先頭、`$` は文字列の末尾と**最後の LF の直前**です。公式の資料には「`$` は `\n` で成り立つが `\r\n` では成り立たない」とあります
- Multiline のとき、`^` は各行の先頭、`$` は各行の末尾（LF の直前）にも一致します
- `\A` は先頭、`\z` は末尾、`\Z` は末尾か最後の LF の直前です。どれも Multiline の影響を受けません
- `\G` は、前の一致が終わった位置です

## グループと参照

- 名前付きグループは `(?<name>…)` と `(?'name'…)` です。`(?P<name>…)` は使えません。名前には漢字なども使えます（実際の結果）
- 名前の参照は `\k<name>` と `\k'name'` です
- **番号の付け方がほかの言語と違います。** 名前なしのグループに左から番号が付き、そのあとに名前付きのグループの番号が付きます。`(?<n>a)(b)` では、`(b)` が 1 番、`n` が 2 番です（公式の資料と実際の結果）
- 同じ名前のグループを置けます
- 参照は `\1` や `\k<name>`、`\k'name'` です。存在しないグループへの参照は誤り（ArgumentException）です
- 一致しなかったグループへの参照は、一致しません
- アトミックグループ `(?>…)` が使えます。後読みの中身に長さの決まりはありません
- 強欲な繰り返し（`*+` など）はありません。公式の資料の量指定子の一覧にもなく、実際に誤りになりました
- `(?#…)` はコメントです。バランスグループ `(?<name1-name2>…)` という独自の書き方があります

## エスケープ

- `\a \e \t \v \f \n \r`、`\nnn`（8進数）、`\xnn`（16進数 2 桁）、`\unnnn`、`\cX` が使えます
- `\12` のような 2 桁以上の数字は、その番号のグループが正規表現のどこかにあれば後方参照、なければ8進数の文字コードです。`(a)\12` の `\12` は LF になります（実際の結果）
- `\x{…}` の書き方は使えません
- 公式の資料には「エスケープとして認識されない文字が続くと、その文字に一致する」とあり、例は `\*` です。実際には、`\q` のような英字のエスケープは誤りになりました

## このツールでの扱い

- 「テスト」の欄の表のグループの番号は、C# の付け方（名前なしが先）で表示します
- 「テスト」の欄はコードポイント単位で動くので、絵文字などを含む文字列では、C# と結果が変わることがあります
