"""cases.json の各正規表現を Python の re で動かし、一致した位置（コードポイント単位）を JSON で出す。"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FLAGS = {'i': re.IGNORECASE, 'm': re.MULTILINE, 's': re.DOTALL}


def run(case):
    flags = 0
    for f in case['f']:
        flags |= FLAGS[f]
    try:
        rx = re.compile(case['p'], flags)
    # 繰り返しの回数が大きすぎるときは、re.error ではなく OverflowError になる
    except (re.error, OverflowError):
        return 'E'
    return [[m.start(), m.end()] for m in rx.finditer(case['s'])][:100]


cases = json.loads((HERE / 'cases.json').read_text(encoding='utf-8'))
out = {'unit': 'cp', 'results': [run(c) for c in cases]}
sys.stdout.buffer.write(json.dumps(out).encode('utf-8'))
