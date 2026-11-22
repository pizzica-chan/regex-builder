# Run every engine on cases.json and save the results to results/match-<lang>.json, then compare with verify.js.
# Requirements: python, java, php, go, dotnet on PATH, and Sakura Editor's bregonig.dll (32-bit).
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
& "$env:windir\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$d\probe-sakura.ps1" $Bregonig -Cases | Out-File -Encoding utf8 "$r\match-sakura.json"
node "$d\verify.js"
