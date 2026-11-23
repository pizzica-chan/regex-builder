# PowerShell の正規表現

## 対象と公式の資料

- 調べた処理系: PowerShell 7.7.0（.NET 11.0.0）。違いを見るために Windows PowerShell 5.1（.NET Framework 4.8）でも動かした
- 公式の資料（Microsoft Learn）
  - [about_Regular_Expressions](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_regular_expressions)
  - [about_Comparison_Operators](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_comparison_operators)
  - [about_Split](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_split)
  - [about_Quoting_Rules](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_quoting_rules)

公式の資料には「PowerShell は .NET の正規表現のエンジンを使う」とあります。書き方と一致の決まりは C# と同じなので、[csharp.md](csharp.md) を見てください。この資料には PowerShell だけの違いを書きます。

## C# との照らし合わせ

PowerShell 7.7 で、[cases.json](../../tools/dialect-probe/cases.json) の 253 の事例と、[probes.json](../../tools/dialect-probe/probes.json) の書き方の可否を調べました（`match-ps.ps1` と `probe-ps.ps1`）。どれも C#（.NET 7）と同じ結果でした。

違ったのは、`\w` に一致する文字のうち、Unicode の新しい版で増えた 10 文字（U+0897、U+0ECE、U+1C89、U+1C8A、U+A7CB〜U+A7CD、U+A7DA〜U+A7DC）だけです。.NET 11 のほうが新しい Unicode を使うためです。

## 正規表現を使う場面と、大文字と小文字

| 使い方 | 大文字と小文字 | 区別する書き方 |
|---|---|---|
| `-match`、`-notmatch` | 区別しない | `-cmatch`、`-cnotmatch` |
| `-replace` | 区別しない | `-creplace` |
| `-split` | 区別しない | `-csplit` |
| `switch -Regex` | 区別しない | `switch -Regex -CaseSensitive` |
| `Select-String` | 区別しない | `Select-String -CaseSensitive` |
| `[regex]::Match()` など | 区別する | （.NET の API をそのまま呼ぶ） |

- 演算子と `Select-String` は `RegexOptions.IgnoreCase` を付けた .NET の Regex と同じ結果になりました。253 の事例のすべてで、`-match`、`-cmatch`、`Select-String -AllMatches` の結果を比べました（`match-ps.ps1 -Check`）。`-replace`、`-split`、`switch -Regex` も、`b` で `aBc` の `B` に一致しました（実際の結果）
- 演算子には複数行のモード（Multiline）と、`.` を改行にも一致させるモード（Singleline）の指定がありません。`'(?ms)^a.b'` のように、正規表現の先頭に書きます。`-split` だけは `-split 'b', 0, 'Multiline'` のようにオプションを渡せます
- 大文字と小文字の比べ方は、C# と同じく、カルチャ（言語や地域の設定）で変わります。トルコ語（tr-TR）では、`'I' -match 'i'` が成り立ちません。同じセッションで先に同じ正規表現を使っていると、カルチャを変えても結果が変わりませんでした（実際の結果）。照らし合わせは日本語（ja-JP）の設定で行いました
- 左辺が文字列 1 つのとき、`$Matches` には `-match` の最初の一致だけが入ります。左辺が配列のときは、一致した要素の配列が返り、`$Matches` には何も入りません（実際の結果）。すべての一致は `Select-String -AllMatches` か `[regex]::Matches()` で取り出します

## 文字列の書き方

- 正規表現は `'…'`（単一引用符）で書きます。`"…"` では、PowerShell が `$` で始まる部分を先に変数として展開します。`-replace` の置き換えの `$1` や `${name}` も `'$1'` のように単一引用符で書きます
- `'…'` の中の `'` は `''` のように 2 つ重ねます。PowerShell は曲がった引用符も `'` と同じに扱うので、‘ ’ ‚ ‛ も 2 つ重ねます（公式の資料には ‘ と ’ だけが例に出ています。‚ と ‛ は実際の結果）

## Windows PowerShell 5.1 との違い

Windows PowerShell 5.1 は .NET Framework 4.8 で動きます。同じ事例を動かすと、次の 3 つが PowerShell 7.7 と違いました。

- `\w` が Unicode の古い版の範囲になります（PowerShell 7.7 より 324 文字少なく、U+1734 が 1 文字多い）
- 大文字と小文字を区別しない後方参照 `(.).\1` が、`ⱾⱾȿ` に一致しません（PowerShell 7.7 は一致する）
- `[[:alpha:].]+` が `a.b c` の `.` に一致します（PowerShell 7.7 は一致しない）

このツールは PowerShell 7 に合わせています。

## このツールでの扱い

- 解析、説明、「テスト」の欄の置き換えは、C# と同じものを使います
- 「コピー」のボタンは `$text -match '…'` の形でコピーします。i フラグがないときは `-cmatch` にし、m と s のフラグは `(?ms)` のように正規表現の先頭に書きます
