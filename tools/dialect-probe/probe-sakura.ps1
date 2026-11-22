# サクラエディタの正規表現ライブラリ（bregonig.dll）で probes.json の各正規表現を試し、結果を JSON で出す。
# bregonig.dll は 32 ビットなので、32 ビットの Windows PowerShell で動かす:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -NoProfile -File probe-sakura.ps1 <bregonig.dll のパス>
param([Parameter(Mandatory = $true)][string]$DllPath, [string]$Explain, [string]$Text = 'A', [switch]$Cases)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dllDir = Split-Path -Parent $DllPath

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class Breg {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern bool SetDllDirectory(string path);

    [DllImport("bregonig.dll", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.Cdecl)]
    static extern int BMatchExW(string str, IntPtr strstart, IntPtr targetstart, IntPtr targetend,
        ref IntPtr rxp, StringBuilder msg);

    [DllImport("bregonig.dll", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.Cdecl)]
    static extern void BRegfreeW(IntPtr rx);

    [DllImport("bregonig.dll", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr BRegexpVersionW();

    public static string LastMessage = "";

    public static string Version() { return Marshal.PtrToStringUni(BRegexpVersionW()); }

    // 1: 一致, 0: 一致なし, -1: 書き方の誤り
    public static int Match(string pattern, string text) {
        IntPtr rx = IntPtr.Zero;
        var msg = new StringBuilder(256);
        // 空文字列でも指せるよう、終端の NUL を付けて確保する
        IntPtr buf = Marshal.StringToHGlobalUni(text);
        try {
            IntPtr end = IntPtr.Add(buf, text.Length * 2);
            // サクラエディタと同じく、オプション k と m を付けて渡す（ヘルプ「利用可能な正規表現」HLP000089 による）。
            // 区切りの文字には、パターンに出てこない U+0001 を使う
            int r = BMatchExW("m\u0001" + pattern + "\u0001km", buf, buf, end, ref rx, msg);
            LastMessage = msg.ToString();
            return r < 0 ? -1 : r;
        } finally {
            if (rx != IntPtr.Zero) BRegfreeW(rx);
            Marshal.FreeHGlobal(buf);
        }
    }

    // すべての一致の位置（UTF-16 単位の [開始, 終了]）。書き方の誤りなら null。options はサクラエディタと同じく km（と i）
    public static int[][] MatchAll(string pattern, string options, string text) {
        IntPtr rx = IntPtr.Zero;
        var msg = new StringBuilder(256);
        IntPtr buf = Marshal.StringToHGlobalUni(text);
        var list = new System.Collections.Generic.List<int[]>();
        try {
            IntPtr end = IntPtr.Add(buf, text.Length * 2);
            int pos = 0;
            while (pos <= text.Length && list.Count < 100) {
                if (pos == text.Length && text.Length > 0) break;
                int r = BMatchExW("m\u0001" + pattern + "\u0001" + options, buf, IntPtr.Add(buf, pos * 2), end, ref rx, msg);
                if (r < 0) return null;
                if (r == 0) break;
                // BREGEXP 構造体（32 ビット）の startp は 32 バイト目、endp は 36 バイト目にある
                int s = (int)((Marshal.ReadIntPtr(Marshal.ReadIntPtr(rx, 32)).ToInt64() - buf.ToInt64()) / 2);
                int e = (int)((Marshal.ReadIntPtr(Marshal.ReadIntPtr(rx, 36)).ToInt64() - buf.ToInt64()) / 2);
                list.Add(new[] { s, e });
                pos = e > s ? e : e + 1;
            }
            return list.ToArray();
        } finally {
            if (rx != IntPtr.Zero) BRegfreeW(rx);
            Marshal.FreeHGlobal(buf);
        }
    }
}
"@

[Breg]::SetDllDirectory($dllDir) | Out-Null

function Run-Probe($p, $s, $op) {
    # BMatchExW は空の文字列を受け付けないので、書き方の確かめには 1 文字の文字列を使う
    if ([Breg]::Match($p, ' ') -lt 0) { return 'E' }
    $pat = if ($op -eq 'full') { '\A(?:' + $p + ')\z' } else { $p }
    $r = [Breg]::Match($pat, $s)
    if ($r -lt 0) { return 'E' }
    if ($r -gt 0) { return 'T' } else { return 'F' }
}

function Get-Ranges($cls) {
    $pat = '\A(?:' + $cls + ')\z'
    $out = New-Object System.Collections.ArrayList
    $start = -1
    for ($cp = 0; $cp -le 0x10000; $cp++) {
        $ok = $false
        if ($cp -le 0xFFFF -and -not ($cp -ge 0xD800 -and $cp -le 0xDFFF)) {
            $ok = ([Breg]::Match($pat, [string][char]$cp) -eq 1)
        }
        if ($ok -and $start -lt 0) { $start = $cp }
        if (-not $ok -and $start -ge 0) { [void]$out.Add(@($start, ($cp - 1))); $start = -1 }
    }
    return , $out.ToArray()
}

# -Explain に正規表現を渡すと、それぞれの結果と誤りのメッセージだけを出す（調べ直し用）
if ($Explain) {
    # -Text の \n と \r は、改行の文字（LF と CR）にする
    $t = $Text.Replace('\n', "`n").Replace('\r', "`r")
    $r = [Breg]::Match($Explain, $t); Write-Output ("{0}`t{1}`t{2}" -f $Explain, $r, [Breg]::LastMessage)
    return
}

# -Cases を付けると、cases.json の各正規表現の一致の位置（UTF-16 単位）を出す
if ($Cases) {
    $list = Get-Content -Raw -Encoding UTF8 (Join-Path $here 'cases.json') | ConvertFrom-Json
    $results = @()
    foreach ($c in $list) {
        # サクラエディタ本体と同じく、文字クラスと \Q…\E の外の . を [^\r\n] に置き換えてから渡す（ヘルプ HLP000089）
        $p = [regex]::Replace($c.p, '\\Q.*?(?:\\E|$)|\\.|\[(?:\\.|[^\]\\])*\]|\.', { param($m) if ($m.Value -eq '.') { '[^\r\n]' } else { $m.Value } })
        $opt = 'km' + $(if ($c.f.Contains('i')) { 'i' } else { '' })
        if ($c.f.Contains('s')) { $p = '(?s)' + $p }
        $r = [Breg]::MatchAll($p, $opt, $c.s)
        if ($r -eq $null) { $results += , 'E' } else { $results += , @($r | ForEach-Object { , @($_[0], $_[1]) }) }
    }
    $json = [ordered]@{ unit = 'utf16'; results = $results } | ConvertTo-Json -Depth 6 -Compress
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::Out.Write($json)
    return
}

$probes = Get-Content -Raw -Encoding UTF8 (Join-Path $here 'probes.json') | ConvertFrom-Json
$probeResult = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
foreach ($pr in $probes) { $probeResult[$pr.id] = Run-Probe $pr.p $pr.s $pr.op }
$classResult = [ordered]@{}
foreach ($c in @('\d', '\w', '\s', '.', '(?s).')) { $classResult[$c] = Get-Ranges $c }

$result = [ordered]@{
    engine  = 'Sakura Editor bregonig ' + [Breg]::Version()
    probes  = $probeResult
    classes = $classResult
}
$json = $result | ConvertTo-Json -Depth 5 -Compress
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::Out.Write($json)
