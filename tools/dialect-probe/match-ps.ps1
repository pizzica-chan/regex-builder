# cases.json の各正規表現を、PowerShell が動いている .NET の Regex で動かし、一致した位置（UTF-16 単位）を JSON で出す。
# i のときは RegexOptions.IgnoreCase を付け、付けないときは何も付けずに Regex を作る。
# -Check を付けると、-match（i のとき）、-cmatch（i でないとき）、Select-String の結果が、ここで作った Regex の結果と同じになるかを確かめる。
# PowerShell 7.7 と Windows PowerShell 5.1 で、249 の事例のすべてが同じになった。
# 使い方: pwsh -NoProfile -File match-ps.ps1 cases.json [-Check]
param([Parameter(Mandatory = $true)][string]$CasesPath, [switch]$Check)

$ErrorActionPreference = 'Stop'
$cases = Get-Content -Raw -Encoding utf8 $CasesPath | ConvertFrom-Json
$out = [System.Collections.Generic.List[string]]::new()
$diff = 0
foreach ($c in $cases) {
    $opts = [System.Text.RegularExpressions.RegexOptions]::None
    if ($c.f.Contains('i')) { $opts = $opts -bor 'IgnoreCase' }
    if ($c.f.Contains('m')) { $opts = $opts -bor 'Multiline' }
    if ($c.f.Contains('s')) { $opts = $opts -bor 'Singleline' }
    try { $re = [regex]::new($c.p, $opts) } catch { $out.Add('"E"'); continue }
    $ms = @($re.Matches($c.s) | Select-Object -First 100)
    $out.Add('[' + (($ms | ForEach-Object { "[$($_.Index),$($_.Index + $_.Length)]" }) -join ',') + ']')
    if ($Check) {
        # m と s は、演算子には指定がないので、正規表現の先頭に (?ms) のように書く
        $inline = ($c.f -replace '[^ms]', '')
        $p = if ($inline) { "(?$inline)$($c.p)" } else { $c.p }
        $first = if ($ms.Count) { $ms[0].Value } else { $null }
        $op = if ($c.f.Contains('i')) { $c.s -match $p } else { $c.s -cmatch $p }
        $opValue = if ($op) { $Matches[0] } else { $null }
        $sel = $c.s | Select-String -Pattern $p -AllMatches -CaseSensitive:(-not $c.f.Contains('i'))
        $selAll = if ($sel) { @($sel.Matches | Select-Object -First 100 | ForEach-Object { "$($_.Index),$($_.Length)" }) -join ';' } else { '' }
        $reAll = @($ms | ForEach-Object { "$($_.Index),$($_.Length)" }) -join ';'
        if ($op -ne [bool]$ms.Count -or $opValue -cne $first -or $selAll -ne $reAll) {
            $diff++
            [Console]::Error.WriteLine("different: /$($c.p)/$($c.f)")
        }
    }
}
if ($Check) { [Console]::Error.WriteLine("checked $($cases.Count) cases, different $diff") }
$version = "PowerShell $($PSVersionTable.PSVersion) / $([System.Runtime.InteropServices.RuntimeInformation]::FrameworkDescription)"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::Out.Write('{"unit":"utf16","engine":"' + $version + '","results":[' + ($out -join ',') + ']}')
