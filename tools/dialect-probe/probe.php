<?php
// PHP の preg（PCRE2）で probes.json の各正規表現を試し、結果を JSON で出す。
// 日本語を 1 文字として扱うため、u 修飾子を付けて試す（このツールの PHP の形でも u を付ける）
$probes = json_decode(file_get_contents(__DIR__ . '/probes.json'), true);
$classes = ['\\d', '\\w', '\\s', '.', '(?s).'];

function rx($p) {
    return "\x01" . $p . "\x01u"; // 区切りには、パターンに出てこない文字を使う
}

function run($p, $s, $op) {
    $re = $op === 'full' ? "\x01\\A(?:" . $p . ")\\z\x01u" : rx($p);
    if (@preg_match(rx($p), '') === false) return 'E';
    $r = @preg_match($re, $s);
    if ($r === false) return 'E';
    return $r ? 'T' : 'F';
}

function ranges($cls) {
    $re = "\x01\\A(?:" . $cls . ")\\z\x01u";
    $out = [];
    $start = null;
    for ($cp = 0; $cp <= 0x10000; $cp++) {
        $ok = $cp <= 0xFFFF && !($cp >= 0xD800 && $cp <= 0xDFFF) && preg_match($re, mb_chr($cp, 'UTF-8')) === 1;
        if ($ok && $start === null) $start = $cp;
        if (!$ok && $start !== null) { $out[] = [$start, $cp - 1]; $start = null; }
    }
    return $out;
}

$result = [
    'engine' => 'PHP ' . PHP_VERSION . ' preg (PCRE2 ' . PCRE_VERSION . ')',
    'probes' => [],
    'classes' => [],
];
foreach ($probes as $pr) $result['probes'][$pr['id']] = run($pr['p'], $pr['s'], $pr['op']);
foreach ($classes as $c) $result['classes'][$c] = ranges($c);
echo json_encode($result, JSON_UNESCAPED_UNICODE);
