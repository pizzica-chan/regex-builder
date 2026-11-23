# Run every engine on cases.json and save the results to results/match-<lang>.json, then compare with verify.js.
# Requirements: python, java, php, go, dotnet, pwsh (PowerShell 7), node on PATH, WSL with GNU grep and the ja_JP.UTF-8 locale (see match-grep.js), and Sakura Editor's bregonig.dll (32-bit).
param([string]$Bregonig = 'C:\Program Files\sakura-tag-v2.4.2-build4203-a3e63915b-Win32-Release-Exe\bregonig.dll')
$ErrorActionPreference = 'Stop'
$d = $PSScriptRoot
$r = Join-Path $d 'results'
$env:DOTNET_NOLOGO = '1'; $env:PYTHONIOENCODING = 'utf-8'
python -I "$d\match.py" | Out-File -Encoding utf8 "$r\match-python.json"
java "$d\Match.java" "$d\cases.json" | Out-File -Encoding utf8 "$r\match-java.json"
php "$d\match.php" | Out-File -Encoding utf8 "$r\match-php.json"
Push-Location "$d\go\match"; go run . "$d\cases.json" | Out-File -Encoding utf8 "$r\match-go.json"; Pop-Location
Push-Location "$d\cs-match"; dotnet run -c Release -- "$d\cases.json" 2>$null | Out-File -Encoding utf8 "$r\match-cs.json"; Pop-Location
pwsh -NoProfile -File "$d\match-ps.ps1" "$d\cases.json" | Out-File -Encoding utf8 "$r\match-ps.json"
& "$env:windir\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$d\probe-sakura.ps1" $Bregonig -Cases | Out-File -Encoding utf8 "$r\match-sakura.json"
node "$d\match-grep.js" ere | Out-File -Encoding utf8 "$r\match-ere.json"
node "$d\match-grep.js" bre | Out-File -Encoding utf8 "$r\match-bre.json"
node "$d\verify.js"
