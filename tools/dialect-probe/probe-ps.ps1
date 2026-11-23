# PowerShell が動いている .NET の Regex で probes.json の各正規表現を試し、\d \w \s . が一致する文字（BMP）と合わせて JSON で出す。
# 出力の形は cs/Program.cs（C#）と同じ。results/cs.json と比べると、.NET の版による違いが分かる。
# 使い方: pwsh -NoProfile -File probe-ps.ps1 probes.json
param([Parameter(Mandatory = $true)][string]$ProbesPath)

$ErrorActionPreference = 'Stop'
$probes = Get-Content -Raw -Encoding utf8 $ProbesPath | ConvertFrom-Json

function Test-Probe($p, $s, $op) {
    try { $null = [regex]::new($p) } catch { return 'E' }
    $re = if ($op -eq 'full') { [regex]::new("\A(?:$p)\z") } else { [regex]::new($p) }
    if ($re.IsMatch($s)) { 'T' } else { 'F' }
}

# BMP のサロゲート以外の文字を並べた文字列で、1 文字ずつの一致の位置を集める
$sb = [System.Text.StringBuilder]::new()
$codes = [System.Collections.Generic.List[int]]::new()
for ($cp = 0; $cp -le 0xFFFF; $cp++) {
    if ($cp -ge 0xD800 -and $cp -le 0xDFFF) { continue }
    $null = $sb.Append([char]$cp); $codes.Add($cp)
}
$all = $sb.ToString()
function Get-Ranges($cls) {
    $hit = [bool[]]::new(0x10001)
    foreach ($m in [regex]::new("(?:$cls)").Matches($all)) { if ($m.Length -eq 1) { $hit[$codes[$m.Index]] = $true } }
    $ranges = [System.Collections.Generic.List[string]]::new()
    $start = -1
    for ($cp = 0; $cp -le 0x10000; $cp++) {
        if ($hit[$cp] -and $start -lt 0) { $start = $cp }
        if (-not $hit[$cp] -and $start -ge 0) { $ranges.Add("[$start,$($cp - 1)]"); $start = -1 }
    }
    '[' + ($ranges -join ',') + ']'
}

$probeJson = ($probes | ForEach-Object { '"' + $_.id + '":"' + (Test-Probe $_.p $_.s $_.op) + '"' }) -join ','
$classes = [ordered]@{ '\\d' = '\d'; '\\w' = '\w'; '\\s' = '\s'; '.' = '.'; '(?s).' = '(?s).' }
$classJson = ($classes.Keys | ForEach-Object { '"' + $_ + '":' + (Get-Ranges $classes[$_]) }) -join ','
$version = "PowerShell $($PSVersionTable.PSVersion) / $([System.Runtime.InteropServices.RuntimeInformation]::FrameworkDescription)"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::Out.Write('{"engine":"' + $version + '","probes":{' + $probeJson + '},"classes":{' + $classJson + '}}')
