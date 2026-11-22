"""Python の re で probes.json の各正規表現を試し、結果を JSON で出す。tools/dialect-probe/README.md を参照。"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CLASSES = ['\\d', '\\w', '\\s', '.', '(?s).']


def run(p, s, op):
    try:
        rx = re.compile(p)
    except re.error:
        return 'E'
    hit = rx.fullmatch(s) if op == 'full' else rx.search(s)
    return 'T' if hit else 'F'


def ranges(cls):
    rx = re.compile(cls)
    out, start = [], None
    for cp in range(0x10000):
        ok = not (0xD800 <= cp <= 0xDFFF) and rx.fullmatch(chr(cp)) is not None
        if ok and start is None:
            start = cp
        if not ok and start is not None:
            out.append([start, cp - 1])
            start = None
    if start is not None:
        out.append([start, 0xFFFF])
    return out


def main():
    probes = json.loads((HERE / 'probes.json').read_text(encoding='utf-8'))
    result = {
        'engine': f'Python {sys.version.split()[0]} re',
        'probes': {pr['id']: run(pr['p'], pr['s'], pr['op']) for pr in probes},
        'classes': {c: ranges(c) for c in CLASSES},
    }
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode('utf-8'))


main()
