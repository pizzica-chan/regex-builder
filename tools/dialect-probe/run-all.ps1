# Run every engine on cases.json and save the results to results/match-<lang>.json, then compare with verify.js
# and check the "same meaning" results of the portability list with verify-portability.js.
# Requirements: python, java, php, go, dotnet, pwsh (PowerShell 7), node on PATH, WSL with GNU grep and the ja_JP.UTF-8 locale (see match-grep.js), and Sakura Editor's bregonig.dll (32-bit).
# -CasesPath and -ResultsDir run another case file (fuzz.js uses them with -NoVerify).
param(
    [string]$Bregonig = 'C:\Program Files\sakura-tag-v2.4.2-build4203-a3e63915b-Win32-Release-Exe\bregonig.dll',
    [string]$CasesPath = '',
    [string]$ResultsDir = '',
    [switch]$NoVerify
)
$ErrorActionPreference = 'Stop'
$d = $PSScriptRoot
$c = if ($CasesPath) { (Resolve-Path $CasesPath).Path } else { Join-Path $d 'cases.json' }
$r = if ($ResultsDir) { $ResultsDir } else { Join-Path $d 'results' }
New-Item -ItemType Directory -Force $r | Out-Null
$r = (Resolve-Path $r).Path
$env:DOTNET_NOLOGO = '1'; $env:PYTHONIOENCODING = 'utf-8'
python -I "$d\match.py" "$c" | Out-File -Encoding utf8 "$r\match-python.json"
java "$d\Match.java" "$c" | Out-File -Encoding utf8 "$r\match-java.json"
php "$d\match.php" "$c" | Out-File -Encoding utf8 "$r\match-php.json"
Push-Location "$d\go\match"; go run . "$c" | Out-File -Encoding utf8 "$r\match-go.json"; Pop-Location
Push-Location "$d\cs-match"; dotnet run -c Release -- "$c" 2>$null | Out-File -Encoding utf8 "$r\match-cs.json"; Pop-Location
pwsh -NoProfile -File "$d\match-ps.ps1" "$c" | Out-File -Encoding utf8 "$r\match-ps.json"
& "$env:windir\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$d\probe-sakura.ps1" $Bregonig -Cases -CasesPath "$c" | Out-File -Encoding utf8 "$r\match-sakura.json"
node "$d\match-grep.js" ere "$c" | Out-File -Encoding utf8 "$r\match-ere.json"
node "$d\match-grep.js" bre "$c" | Out-File -Encoding utf8 "$r\match-bre.json"
if (-not $NoVerify) {
    node "$d\verify.js"
    node "$d\verify-portability.js"
}
