<?php
// cases.json の各正規表現を PHP の preg（u 修飾子あり）で動かし、一致した位置（UTF-8 のバイト単位）を JSON で出す
$cases = json_decode(file_get_contents(__DIR__ . '/cases.json'), true);
$results = [];
foreach ($cases as $c) {
    $re = "\x01" . $c['p'] . "\x01" . $c['f'] . 'u';
    if (@preg_match($re, '') === false) { $results[] = 'E'; continue; }
    $n = @preg_match_all($re, $c['s'], $m, PREG_OFFSET_CAPTURE);
    if ($n === false) { $results[] = 'E'; continue; }
    $list = [];
    foreach ($m[0] as [$text, $off]) $list[] = [$off, $off + strlen($text)];
    $results[] = array_slice($list, 0, 100);
}
echo json_encode(['unit' => 'utf8', 'results' => $results]);
